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
 * - 请求体缓冲读取（JSON 端点为主的 dev 形态；流式上传不做——出现真实场景再议增量请求桥），
 *   但设体上限闸（A2 硬化3）：超 maxBodyBytes（缺省 1MiB）即**读体中途截断**直答 413 ATR-346，
 *   残余不进 JS——公网形态下单请求打爆内存的路已封；上限经 createNodeServer/serve({ maxBodyBytes }) 可配；
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
import { createHash } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** 桥选项（最小开面：Request URL 的 authority fallback——缺 Host 头时用） */
export type NodeHostOptions = {
  /** 缺省 127.0.0.1（与 serve() 的 listen host 同语义） */
  host?: string;
  /**
   * 请求体上限字节（A2 硬化3）：读体**中途截断**（不等读完整再拒——超限即停，残余不再进 JS），
   * 桥直答 413 ATR-346。缺省 1MiB（endpoints.ts DEFAULT_MAX_BODY_BYTES 同值单点复制——不跨模块
   * 开私有口，与 isProd 双写同款纪律，两处注释互指）；createHandler({ maxBodyBytes }) 是另一道
   * 兜底闸（JSON 解析处），两道都设时取小者生效。B1（决策 32）：multipart/form-data（上传面
   * 流量）按 max(maxBodyBytes, 20MB) 放行——JSON 全局闸不受影响，两道闸语义见下方常量注释。
   */
  maxBodyBytes?: number;
};

/** 请求体上限缺省值（A2 硬化3，与 endpoints.ts DEFAULT_MAX_BODY_BYTES 互指同值） */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * 上传 multipart 桥面放行上限（B1 差距批，2026-09-28，决策 32）：uploads.ts UPLOADS_DEFAULT_MAX_BYTES
 * 同值单点复制（本桥零 server 依赖不开 import——与 DEFAULT_MAX_BODY_BYTES 双写同款纪律，两处注释互指）。
 * 两道闸语义（决策 32）：本桥 = **粗闸**（读体中途截断，只保证内存上界——multipart 请求放行到
 * max(maxBodyBytes, 本值)，JSON 全局闸不动）；上传面 = **精闸**（defineUpload maxBytes 按定义生效，
 * 缺省同值，413 ATR-346）。与 A2「两道都设取小者」不冲突：A2 管同一资源（JSON 体）的两道闸，
 * B1 是不同资源（multipart 独立上限）——粗闸 ≥ 精闸缺省恒成立；定义 maxBytes > 20MB 的部署须
 * 同步上调 createNodeServer/serve({ maxBodyBytes })（v1 不单开桥配置位——诚实边界）。
 */
const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

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
    const maxBodyBytes = opts?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    // B1（决策 32）粗闸分派：multipart/form-data（上传面流量）放行到 max(装配上限, 20MB)——
    // JSON 全局闸不动（端点面兜底闸在分发器内自行校验）。按头判定而非路由（本桥零 server 依赖，
    // 不识别上传注册面）——错报 multipart 的 JSON 请求至多得放行到 20MB 桥闸，仍被分发器
    // maxBodyBytes 兜底拦住，语义闭合。
    const isMultipart = /^multipart\/form-data/i.test(String(nodeReq.headers["content-type"] ?? ""));
    const cap = isMultipart ? Math.max(maxBodyBytes, DEFAULT_UPLOAD_MAX_BYTES) : maxBodyBytes;
    const read = await readBody(nodeReq, cap);
    if (read.overLimit) {
      // A2 硬化3：读体已中途截断（残余不再进 JS）——桥直答 413 ATR-346（四段式与 endpoints 同款线型）。
      // 超限是客户端问题，不入 handler。收尾纪律：**drain 后再断**——若此刻直接 destroy，客户端仍在
      // 发送，RST 会把它接收缓冲里的 413 一并丢掉（超限方反而看不到明确错误）；改为 resume() 以
      // discard 模式放完残余（无 data 监听器 = 纯丢弃，不进 JS 不占内存），请求侧到 end（内核接收
      // 缓冲已空）再断连接（此时是 FIN 不是 RST，响应可达）。30s 失败保护（unref 不阻进程退出）
      // 防恶意慢发把连接吊死——那时客户端拿不拿得到 413 已无所谓。
      const body413 = JSON.stringify({
        code: "ATR-346",
        message: `请求体超限：读入 ${read.seenBytes} 字节后超过桥上限 ${cap}（读体中途截断）`,
        context: { component: "atelier-node-host" },
        fix: isMultipart
          ? `缩小上传文件；multipart 桥面放行上限 = max(maxBodyBytes, 20MB)（决策 32 粗闸），上传面定义精闸（defineUpload maxBytes）在其内生效；更大面上调须同步 createNodeServer/serve({ maxBodyBytes })`
          : `缩小请求体；上限可配：createNodeServer/serve({ maxBodyBytes })（缺省 1MiB = ${DEFAULT_MAX_BODY_BYTES} 字节）`,
      });
      nodeRes.writeHead(413, { "content-type": "application/json; charset=utf-8", "connection": "close" });
      nodeRes.end(body413);
      const teardown = () => nodeReq.destroy();
      nodeReq.on("end", teardown);
      const failsafe = setTimeout(teardown, 30_000);
      (failsafe as unknown as { unref?: () => void }).unref?.();
      nodeReq.on("close", () => clearTimeout(failsafe));
      nodeReq.resume();
      return;
    }
    const res = await handler(await toWebRequest(nodeReq, opts, read.body));
    await writeResponse(nodeRes, res);
  } catch (e) {
    if (nodeRes.writableEnded || nodeRes.destroyed) return;
    if (nodeRes.headersSent) {
      nodeRes.destroy(); // 流式响应中途出错——头已发出，无法回改状态码，只能断连（诚实失败）
      return;
    }
    nodeRes.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    // A2 硬化4：console 侧恒保留原始错误（dev/prod 都不真丢——SSE 客户端断连等传输噪声也在此可见；
    // 对外 message 经 foldProdMessage 收敛，见下）
    console.error("[atelier node-host] 未捕获错误（兜底 500）：", e);
    nodeRes.end(
      JSON.stringify({
        error: {
          code: "ATR-320",
          message: `node-host 桥内未捕获错误：${foldProdMessage((e as Error)?.message ?? String(e))}`,
          fix: "handler 应返回 Response（含错误响应）；此兜底只接直挂裸 handler 的漏网抛错；完整原始错误见 server 进程 console（A2 硬化4：日志侧不真丢）",
        },
      })
    );
  }
}

/**
 * prod 错误 message 收敛（A2 硬化4，endpoints.ts foldProdMessage 同语义同值单点复制——本桥零
 * server 依赖不开 import，两处注释互指）：prod 态（__ATELIER_PROD__，与 endpoints isProd 同读法）
 * 对外 message 收敛为通用文案 + 短指纹（sha256 前 8 位，node:crypto）；dev 态逐字保留。
 */
function foldProdMessage(raw: string): string {
  const prod = (globalThis as { __ATELIER_PROD__?: boolean }).__ATELIER_PROD__ === true;
  if (!prod) return raw;
  const fp = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 8);
  return `内部错误（prod 已收敛，指纹 ${fp}；server 侧日志保留完整根因，可按指纹检索）`;
}

/** node:http 请求 → Web 标准 Request（头 rawHeaders 逐条 append 保真；体缓冲读取） */
async function toWebRequest(nodeReq: IncomingMessage, opts: NodeHostOptions | undefined, body: Uint8Array<ArrayBuffer> | undefined): Promise<Request> {
  const host = nodeReq.headers.host ?? opts?.host ?? "127.0.0.1";
  const url = new URL(nodeReq.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (let i = 0; i < nodeReq.rawHeaders.length; i += 2) {
    headers.append(nodeReq.rawHeaders[i]!, nodeReq.rawHeaders[i + 1]!);
  }
  // A2 功能7（限流 v1 键源）：socket 对端地址注入 x-atelier-remote-addr——**覆盖**入站同名头
  // （该头只有桥签发才可信，入站伪造一律作废）；限流 keyBy 缺省读它。请求侧头保真原则的显式
  // 例外（同 Set-Cookie 特例并列）：新增/覆盖桥自签头，其余头零改动。
  headers.set("x-atelier-remote-addr", nodeReq.socket.remoteAddress ?? "unknown");
  return new Request(url, { method: nodeReq.method ?? "GET", headers, body });
}

/**
 * 请求体缓冲读取（诚实边界：JSON 端点为主，不做流式上传）。GET/HEAD 无体时 data 事件不来、
 * 立即 end → 返回 undefined（Request 构造不携带 body——GET 带 body 会被 Web 标准拒绝）。
 * A2 硬化3：按 maxBodyBytes **中途截断**——超限即停（不等读完整再拒），残余不再进 JS。
 * 显式 data/end/error 监听器而非 async iterator：iterator 的 early-return/break 会触发流的
 * return() → destroy → socket 断，413 就写不出去了；显式监听器让"停读不毁流"成为可控动作
 * （pause 后由 dispatch 决定 drain 收尾节奏）。
 */
type BodyRead = { body: Uint8Array<ArrayBuffer> | undefined; overLimit: boolean; seenBytes: number };

function readBody(nodeReq: IncomingMessage, maxBodyBytes: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const detach = () => {
      nodeReq.off("data", onData);
      nodeReq.off("end", onEnd);
      nodeReq.off("error", onError);
    };
    const finish = (r: BodyRead): void => {
      if (settled) return;
      settled = true;
      detach();
      resolve(r);
    };
    const onData = (chunk: Uint8Array): void => {
      if (total + chunk.byteLength > maxBodyBytes) {
        nodeReq.pause(); // 停止消费（残余留内核/流缓冲）——收尾节奏归 dispatch（drain 后断）
        finish({ body: undefined, overLimit: true, seenBytes: total });
        return;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    };
    const onEnd = (): void => {
      if (chunks.length === 0) {
        finish({ body: undefined, overLimit: false, seenBytes: 0 });
        return;
      }
      const body = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        body.set(c, off);
        off += c.byteLength;
      }
      finish({ body, overLimit: false, seenBytes: total });
    };
    const onError = (e: unknown): void => {
      if (settled) return;
      settled = true;
      detach();
      reject(e);
    };
    nodeReq.on("data", onData);
    nodeReq.on("end", onEnd);
    nodeReq.on("error", onError);
  });
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
export async function serve(handler: WebHandler, opts: { port: number; host?: string; maxBodyBytes?: number }): Promise<Server> {
  const host = opts.host ?? "127.0.0.1";
  const server = createNodeServer(handler, { host, maxBodyBytes: opts.maxBodyBytes });
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
