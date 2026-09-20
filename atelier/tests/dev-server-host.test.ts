/**
 * dev-server-host.test.ts — FS-7 dev 托管监督器（FS-DESIGN §11.1）验收：
 *   配置解析（缺省 5174 / "/api" / ".atelier/dev.db"，port 0=自动透传，env ATELIER_DB_PATH 优先）
 *   · 就绪行严格解析（ATELIER_SERVER_READY 前缀 + JSON；噪声/坏 JSON/缺 port → null 不 throw）
 *   · 集成：spawn 子进程 → stdout 握手 → middleware() 反向代理 JSON roundtrip（方法/体/env 透传）
 *     + SSE 首事件透传（双向流式、不缓冲）+ 未就绪 503 ATR-403 + 非挂载路径 next() 放行
 *     + forwardRequest 独立导出的 ECONNREFUSED → 503 ATR-403 + 热重启（改 fixture → restart → 新响应）。
 *
 * fixture 等价内联入口（三方契约第 4 条）：本 worktree 的 atelier/server 桶出口尚无 serve()（node-host.ts
 * 由并行分支 A 落地），fixture 自写 node:http 内联入口——echo query（JSON roundtrip 用）+ live-tick
 * SSE 型 query（流式透传用），listen 后 stdout 恰好一行 `ATELIER_SERVER_READY {"port":<实际端口>}`。
 * A 的 node-host 合入后，此 fixture 可无缝切换为 `import { serve } from <pathToFileURL(index.ts)>` 形态。
 *
 * 纪律（§14.2）：先红后绿——本文件先于 dev-server-host.mjs 落盘跑红（模块不存在 → import 失败），
 * 实现后跑绿（证据见提交说明）。时序断言一律轮询 + 截止时间（SSE 首帧 5s 窗口）。Windows 孤儿进程
 * 零容忍：afterEach/afterAll 必须 stop() 全部 supervisor、close() 全部 http server，tmpdir 才允许删除。
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServerSupervisor, forwardRequest, parseReadyLine, resolveServerConfig } from "../dev/dev-server-host.mjs";

/* ---------------- 基建：fixture 应用目录 + 代理测试用小 http server ---------------- */

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-dev-host-"));
const FIXTURE_ENTRY = path.join(TMP_ROOT, "src", "server", "main-server.ts");

/** fixture 内联入口源码：TAG 嵌在文件内容里（热重启用例改文件 → 新进程行为随之变）。 */
function fixtureSource(tag: string): string {
  return `
// fixture：dev 托管集成测试等价内联入口（三方契约第 3 条：listen 后 stdout 恰好一行就绪行）
import http from "node:http";
const TAG = ${JSON.stringify(tag)};
const port = Number(process.env.ATELIER_SERVER_PORT ?? "5174") || 0; // "0" = 自动
const mount = process.env.ATELIER_SERVER_MOUNT ?? "/api";
const server = http.createServer((req, res) => {
  const url = (req.url ?? "").split("?")[0];
  if (url === mount + "/echo") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, tag: TAG, echo: body ? JSON.parse(body) : null, mount, dbPath: process.env.ATELIER_DB_PATH ?? null }));
    });
    return;
  }
  if (url === mount + "/live-tick") {
    // SSE 型 query：首事件立即写、之后周期续推（验证代理下行不缓冲）
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write("event: tick\\ndata: " + JSON.stringify({ tag: TAG, n: 1 }) + "\\n\\n");
    const timer = setInterval(() => res.write("event: tick\\ndata: " + JSON.stringify({ tag: TAG, n: 2 }) + "\\n\\n"), 200);
    req.on("close", () => clearInterval(timer));
    return;
  }
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: "no route" }));
});
server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  console.log("ATELIER_SERVER_READY " + JSON.stringify({ port: addr.port }));
});
`;
}

function writeFixture(tag: string): void {
  fs.mkdirSync(path.dirname(FIXTURE_ENTRY), { recursive: true });
  fs.writeFileSync(FIXTURE_ENTRY, fixtureSource(tag), "utf8");
}

type Supervisor = ReturnType<typeof createServerSupervisor>;

const supervisors: Supervisor[] = [];
const httpServers: http.Server[] = [];

/** 把 supervisor.middleware()（或任意 handler）挂到 127.0.0.1 随机端口的小 http server 上。 */
function listenOn(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ srv: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) =>
      handler(req, res, () => {
        res.statusCode = 404;
        res.end("next-called"); // next() 被调的可见证据（非挂载路径放行）
      }),
    );
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: (srv.address() as AddressInfo).port }));
  });
}

/** 领一个确定空闲的端口（listen(0) 后立刻关闭——用于 ECONNREFUSED 用例）。 */
async function freePort(): Promise<number> {
  const srv = http.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const p = (srv.address() as AddressInfo).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return p;
}

async function stopAll(): Promise<void> {
  await Promise.all(supervisors.splice(0).map((s) => s.stop()));
  await Promise.all(
    httpServers.splice(0).map((s) => new Promise<void>((r) => (s.listening ? s.close(() => r()) : r()))),
  );
}

writeFixture("v1");

afterEach(stopAll);
afterAll(async () => {
  await stopAll();
  // Windows 孤儿进程零容忍：目录删除失败即测试失败（说明有子进程还活着占着 cwd）
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/* ---------------- 用例 ---------------- */

describe("resolveServerConfig（配置解析：缺省 / 0=自动 / 覆盖）", () => {
  it("全缺省：无 server 键 → 5174 / /api / .atelier/dev.db", () => {
    expect(resolveServerConfig({})).toEqual({ port: 5174, mount: "/api", dbPath: ".atelier/dev.db" });
    // 读不到的 config（null/undefined）同样落全缺省
    expect(resolveServerConfig(undefined)).toEqual({ port: 5174, mount: "/api", dbPath: ".atelier/dev.db" });
  });

  it("port 0 = 自动合法透传（falsy 不吞）+ mount 缺斜杠归一", () => {
    expect(resolveServerConfig({ server: { port: 0, mount: "rpc" } })).toEqual({
      port: 0,
      mount: "/rpc",
      dbPath: ".atelier/dev.db",
    });
  });

  it("覆盖优先级：env ATELIER_DB_PATH > config server.dbPath > 缺省；port/mount 显式覆盖", () => {
    const cfg = { server: { port: 9001, mount: "/x", dbPath: "data/dev.db" } };
    expect(resolveServerConfig(cfg, { ATELIER_DB_PATH: "D:/prod/app.db" })).toEqual({
      port: 9001,
      mount: "/x",
      dbPath: "D:/prod/app.db",
    });
    expect(resolveServerConfig(cfg, {}).dbPath).toBe("data/dev.db");
  });
});

describe("parseReadyLine（就绪行严格解析）", () => {
  it("合法就绪行 → {port}", () => {
    expect(parseReadyLine('ATELIER_SERVER_READY {"port":5174}')).toEqual({ port: 5174 });
    expect(parseReadyLine('ATELIER_SERVER_READY {"port":0}')).toEqual({ port: 0 }); // 自动端口实测值总 >0，但 0 不吞
  });

  it("噪声行 / 前缀不在行首 → null", () => {
    expect(parseReadyLine("[server] listening on http://127.0.0.1:5174")).toBeNull();
    expect(parseReadyLine('x ATELIER_SERVER_READY {"port":1}')).toBeNull(); // 严格前缀：不在行首不算
    expect(parseReadyLine("")).toBeNull();
  });

  it("坏 JSON / 缺 port → null 不 throw", () => {
    expect(parseReadyLine("ATELIER_SERVER_READY {bad json")).toBeNull();
    expect(parseReadyLine("ATELIER_SERVER_READY [1,2,3]")).toBeNull();
    expect(parseReadyLine('ATELIER_SERVER_READY {"nope":1}')).toBeNull();
    expect(parseReadyLine('ATELIER_SERVER_READY {"port":"5174"}')).toBeNull(); // port 必须是数字
  });
});

describe("createServerSupervisor + middleware（集成：spawn → 握手 → 反向代理）", () => {
  it("JSON roundtrip：方法/体/env 透传 + targetPort 来自握手行（port 0=自动实测）", async () => {
    const dbPath = path.join(TMP_ROOT, ".atelier", "dev.db");
    const sup = createServerSupervisor({ root: TMP_ROOT, port: 0, mount: "/api", dbPath });
    supervisors.push(sup);
    const started = await sup.start();
    expect(started).not.toBeNull();
    expect(sup.isReady()).toBe(true);
    expect(sup.targetPort()).toBe((started as { port: number }).port);
    expect(sup.targetPort()!).toBeGreaterThan(0); // 0=自动 → 握手行回报实际端口

    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const res = await fetch(`http://127.0.0.1:${port}/api/echo?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-probe": "fs7" },
      body: JSON.stringify({ hello: "atelier" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; tag: string; echo: unknown; mount: string; dbPath: string };
    expect(j.ok).toBe(true);
    expect(j.tag).toBe("v1");
    expect(j.echo).toEqual({ hello: "atelier" }); // 上行体透传
    expect(j.mount).toBe("/api"); // ATELIER_SERVER_MOUNT 注入
    expect(j.dbPath).toBe(dbPath); // ATELIER_DB_PATH 注入
  });

  it("SSE 首事件透传：下行不缓冲，首帧 5s 窗口内到达", async () => {
    const sup = createServerSupervisor({ root: TMP_ROOT, port: 0, mount: "/api", dbPath: ".atelier/dev.db" });
    supervisors.push(sup);
    await sup.start();
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const ctrl = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/live-tick`, { signal: ctrl.signal });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 5000;
      while (!buf.includes("event: tick") && Date.now() < deadline) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
      }
      expect(buf).toContain("event: tick"); // SSE 线协议原样
      expect(buf).toContain('"tag":"v1"'); // 首事件载荷透传
    } finally {
      ctrl.abort(); // 读完首帧即断，不让周期续推挂住用例
    }
  });

  it("未 start 的 supervisor → 代理 503 且 body 含 ATR 码与可执行 fix；非挂载路径 next() 放行", async () => {
    const sup = createServerSupervisor({ root: TMP_ROOT, port: 0, mount: "/api", dbPath: ".atelier/dev.db" });
    supervisors.push(sup); // 有意不 start()
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const res = await fetch(`http://127.0.0.1:${port}/api/echo`);
    expect(res.status).toBe(503);
    const j = (await res.json()) as { ok: boolean; error: string; fix: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("ATR-403");
    expect(j.fix).toContain("main-server.ts"); // fix 必须可执行：指到入口文件

    const other = await fetch(`http://127.0.0.1:${port}/__atelier/registry`); // 非挂载前缀
    expect(other.status).toBe(404);
    expect(await other.text()).toBe("next-called");
  });

  it("forwardRequest 独立导出：ECONNREFUSED → 503 ATR JSON", async () => {
    const dead = await freePort(); // 无人监听的端口
    const { srv, port } = await listenOn((req, res) => forwardRequest(dead, req, res));
    httpServers.push(srv);
    const res = await fetch(`http://127.0.0.1:${port}/api/anything`);
    expect(res.status).toBe(503);
    const j = (await res.json()) as { ok: boolean; error: string; fix: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("ATR-403");
    expect(typeof j.fix).toBe("string");
    expect(j.fix.length).toBeGreaterThan(0);
  });

  it("热重启：改写 fixture → restart(reason) → 新进程新响应（不测 chokidar 事件本身）", async () => {
    const sup = createServerSupervisor({ root: TMP_ROOT, port: 0, mount: "/api", dbPath: ".atelier/dev.db" });
    supervisors.push(sup);
    await sup.start();
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const before = (await (await fetch(`http://127.0.0.1:${port}/api/echo`)).json()) as { tag: string };
    expect(before.tag).toBe("v1");

    writeFixture("v2"); // 模拟 watcher 变更后的实际动作：直接调 restart
    const restarted = await sup.restart("test");
    expect(restarted).not.toBeNull();
    expect(sup.isReady()).toBe(true);
    expect(sup.targetPort()).toBe((restarted as { port: number }).port);

    const after = (await (await fetch(`http://127.0.0.1:${port}/api/echo`)).json()) as { tag: string };
    expect(after.tag).toBe("v2"); // 新进程行为生效
  });
});
