/**
 * Atelier 全站服务层 — Node http ↔ Web 标准 fetch 桥（FS-7 dev 托管，FS-DESIGN §11.1）：
 * 把 Web 标准 handler（createHandler 产出形态）挂上 node:http——dev 插件以子进程方式
 * `node src/server/main-server.ts` 拉起应用 server 面（Node 原生 type stripping 直接跑 .ts），
 * <mount>/* 请求经 Vite 代理转进本桥；同一文件也是 `atelier build --target=node` 自托管
 * 启动壳的框架侧单源（D-F14：约 30 行的 serve() 即壳）。
 *
 * 三方契约（dev 插件父进程 ↔ 本桥子进程，签名即契约）：
 * - env（ATELIER_SERVER_PORT "0"=OS 自动缺省 5174 / ATELIER_DB_PATH / ATELIER_SERVER_MOUNT）
 *   的读取归子进程入口（应用 main-server.ts / 未来 build 产物）——serve() 只收解析后的值；
 * - 就绪握手：listen 成功后向 stdout 输出恰好一行 `ATELIER_SERVER_READY {"port":<实际端口>}`
 *   （前缀 + 空格 + JSON；port 0 时报实际绑定端口——serve() 负责，父进程按此解析）；
 * - 固定端口被占 → EADDRINUSE 原样上抛（应用侧负责打印诚实错误并退出；框架层不静默换口）。
 *
 * 差异锁本文件（框架纪律）：Node 宿主差异只允许出现在本文件——只用 node:http 内置模块、
 * 零新依赖、TS 仅 erasable 语法（type stripping 直接可跑）；Bun 侧桥归 Bun 启动壳，不经此文件。
 *
 * 诚实边界：
 * - 请求体缓冲读取（JSON 端点为主的 dev 形态；流式上传不做——出现真实场景再议增量请求桥）；
 *   响应侧 ReadableStream 逐 chunk 增量 write 不缓冲（SSE 依赖），socket 背压经 drain 对接；
 * - 多 Set-Cookie 用 Response.headers.getSetCookie() 逐条回写（auth 会话依赖，绝不能逗号合并）；
 *   其余响应头经 Headers 迭代回写——同 name 多值按 Web Headers 规范合并为逗号连接
 *   （HTTP 语义等价）；请求侧头用 rawHeaders 逐条 append 保真；
 * - handler 抛错 → 500 ATR-320 形态 JSON 兜底（与 endpoints.ts 分发器同码；分发器已把 handler
 *   抛错转成错误 Response，本兜底只接直挂裸 handler 的漏网——socket 断连则 destroy 不硬写）；
 * - 仅 HTTP/1.1 明文（dev/自托管单容器形态，TLS 归反代）；listen host 缺省 127.0.0.1（不对外暴露）；
 *   请求缺 Host 头（HTTP/1.0 罕见形态）时 Request URL 的 authority 用缺省 host 拼装
 *   （pathname/search 仍正确——handler 依赖 URL 的部分实际只有这两样）。
 */
import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** 桥选项（最小开面：Request URL 的 authority fallback——缺 Host 头时用） */
export type NodeHostOptions = {
  /** 缺省 127.0.0.1（与 serve() 的 listen host 同语义） */
  host?: string;
};

/** Web 标准 handler 形态（endpoints.ts createHandler 产出的签名——桥不关心 handler 内部） */
export type WebHandler = (req: Request) => Promise<Response>;

/**
 * Node http ↔ Web 标准 fetch 桥：Request 构造（rawHeaders 保真 + 请求体缓冲）→ handler →
 * 响应回写（多 Set-Cookie 逐条 + ReadableStream 增量 write 不缓冲 + 错误 500 兜底）。
 * 只建不 listen——serve() 负责监听与握手。
 */
export function createNodeServer(handler: WebHandler, opts?: NodeHostOptions): Server {
  return http.createServer((nodeReq, nodeRes) => {
    // socket 层错误（客户端中途断开 ECONNRESET/EPIPE）是常态，吞掉防 uncaught 崩进程
    nodeReq.on("error", () => {});
    nodeRes.on("error", () => {});
    void dispatch(nodeReq, nodeRes, handler, opts);
  });
}

/** 单请求处理：任何路径的异常都收口到 500 兜底（socket 断连则 destroy），绝不悬挂连接 */
async function dispatch(
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
  handler: WebHandler,
  opts?: NodeHostOptions
): Promise<void> {
  try {
    const res = await handler(await toWebRequest(nodeReq, opts));
    await writeResponse(nodeRes, res);
  } catch (e) {
    if (nodeRes.writableEnded || nodeRes.destroyed) return;
    if (nodeRes.headersSent) {
      nodeRes.destroy(); // 流式响应中途出错——头已发出，无法回改状态码，只能断连（诚实失败）
      return;
    }
    nodeRes.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    nodeRes.end(
      JSON.stringify({
        error: {
          code: "ATR-320",
          message: `node-host 桥内未捕获错误：${(e as Error)?.message ?? String(e)}`,
          fix: "handler 应返回 Response（含错误响应）；此兜底只接直挂裸 handler 的漏网抛错",
        },
      })
    );
  }
}

/** node:http 请求 → Web 标准 Request（头 rawHeaders 逐条 append 保真；体缓冲读取） */
async function toWebRequest(nodeReq: IncomingMessage, opts?: NodeHostOptions): Promise<Request> {
  const host = nodeReq.headers.host ?? opts?.host ?? "127.0.0.1";
  const url = new URL(nodeReq.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (let i = 0; i < nodeReq.rawHeaders.length; i += 2) {
    headers.append(nodeReq.rawHeaders[i]!, nodeReq.rawHeaders[i + 1]!);
  }
  return new Request(url, { method: nodeReq.method ?? "GET", headers, body: await readBody(nodeReq) });
}

/**
 * 请求体缓冲读取（诚实边界：JSON 端点为主，不做流式上传）。GET/HEAD 无体时 for-await
 * 立即 end → 返回 undefined（Request 构造不携带 body——GET 带 body 会被 Web 标准拒绝）。
 * 返回类型钉死 Uint8Array<ArrayBuffer>（BodyInit 所需——TS 5.7+ TypedArray 泛型化）。
 */
async function readBody(nodeReq: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of nodeReq) chunks.push(chunk as Uint8Array);
  if (chunks.length === 0) return undefined;
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  return body;
}

/** Web 标准 Response → node:http 回写（多 Set-Cookie 逐条 + ReadableStream 增量 write 不缓冲） */
async function writeResponse(nodeRes: ServerResponse, res: Response): Promise<void> {
  const head: [string, string][] = [];
  // set-cookie 必须单列：Web Headers 迭代会把它按逗号合并（fetch 规范）——auth 会话绝不接受；
  // getSetCookie() 逐条取回原始串，逐条进 raw 头数组（独立行回写）。
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") head.push([key, value]);
  });
  for (const cookie of res.headers.getSetCookie()) head.push(["set-cookie", cookie]);
  nodeRes.writeHead(res.status, res.statusText || undefined, head);

  if (!res.body) {
    nodeRes.end();
    return;
  }
  const reader = res.body.getReader();
  // 客户端断开（SSE 常态）→ 取消上游流（live 引擎 cancel → 退订），防桥层空转泄漏
  nodeRes.on("close", () => {
    if (!nodeRes.writableEnded) void reader.cancel().catch(() => {});
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value == null || nodeRes.destroyed) continue;
    // 增量 write 不缓冲（SSE 依赖）；返回 false = 内核缓冲满 → 等 drain 再读下一块（背压对接：
    // close 也放行——上游 cancel 已由 close 监听排程，循环随即收尾）
    if (nodeRes.write(value) === false) {
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          nodeRes.off("drain", onDrain);
          nodeRes.off("close", onClose);
        };
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          resolve();
        };
        nodeRes.once("drain", onDrain);
        nodeRes.once("close", onClose);
      });
    }
  }
  try {
    nodeRes.end();
  } catch {
    /* socket 已断——推送目的已达 */
  }
}

/**
 * serve：createNodeServer + listen + 就绪握手行——即 D-F14 `atelier build --target=node`
 * 自托管启动壳的框架侧单源（应用启动壳 = 本函数 + env 解析 + db 装配，约 30 行）。
 * 固定端口被占 → EADDRINUSE 原样上抛（契约：不静默换口，应用侧负责诚实报错退出）。
 */
export async function serve(handler: WebHandler, opts: { port: number; host?: string }): Promise<Server> {
  const host = opts.host ?? "127.0.0.1";
  const server = createNodeServer(handler, { host });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); // listen 期错误（EADDRINUSE 等）原样上抛；resolve 后再触发即 no-op
    server.listen(opts.port, host, () => resolve());
  });
  const addr = server.address();
  const bound = typeof addr === "object" && addr !== null ? addr.port : opts.port;
  // 就绪握手（契约第 3 条）：恰好一行 `ATELIER_SERVER_READY {"port":N}`——port 0 报实际绑定端口
  process.stdout.write(`ATELIER_SERVER_READY {"port":${bound}}\n`);
  return server;
}
