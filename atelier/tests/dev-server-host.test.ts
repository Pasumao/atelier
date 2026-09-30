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
/* P1 #11 专用 root：永不知就绪 / 换装握手 fixture 的第二现场（与主 root 隔离，防用例互踩） */
const TMP_ROOT_TIMEOUT = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-dev-host-timeout-"));
const TIMEOUT_ENTRY = path.join(TMP_ROOT_TIMEOUT, "src", "server", "main-server.ts");

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
  writeFixtureAt(TMP_ROOT, tag);
}

/** 通用版：向任意 root 写握手 fixture（P1 #11 re-entry 用例换装入口内容用） */
function writeFixtureAt(root: string, tag: string): void {
  const entry = path.join(root, "src", "server", "main-server.ts");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, fixtureSource(tag), "utf8");
}

/** P1 #11 fixture：假 server 子进程——写 pid 文件后永不知就绪（空转）。 */
function writeNeverReadyFixture(root: string, pidFile: string): void {
  const entry = path.join(root, "src", "server", "main-server.ts");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(
    entry,
    `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 10000);\n`,
    "utf8",
  );
}

/** 轮询断言 pid 已死（win32 SIGTERM/taskkill 均为即时终止语义；pid 复用窗口极小可接受）。 */
async function expectPidDead(pid: number, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) return;
    if (Date.now() > deadline) throw new Error(`pid ${pid} 仍在运行（${timeoutMs}ms 内未被终止）`);
    await new Promise((r) => setTimeout(r, 100));
  }
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
  fs.rmSync(TMP_ROOT_TIMEOUT, { recursive: true, force: true });
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
    expect(after.tag).toBe("v2");
  });
});

/* ---------------- P1 #3：反代写面 Origin 闸（镜像 P1-12，原语单源） ----------------
 * 威胁模型（评审 #3）：P1-12 闸只盖 /__atelier/*，承载写副作用的 <mount>/* 反代零防护——
 * 恶意网页可用 no-cors fetch 跨站驱动 POST /api/<写端点>。修法 = 反代中间件复用同一闸
 * （同 self port 口径）：Origin 存在且不在白名单也不与 Host 头同授权方 → 403；
 * 无 Origin = 非浏览器客户端（curl/MCP stdio）放行。 */
describe("P1 #3：反代 <mount>/* Origin 闸（语义严格镜像 P1-12 闸）", () => {
  function supWithSelfPort(): Supervisor {
    // selfPort = dev 面自身端口（反代上游 server 端口与此无关——白名单口径是页面所在的 dev 面）
    const sup = createServerSupervisor({ root: TMP_ROOT, port: 0, mount: "/api", dbPath: ".atelier/dev.db", selfPort: 5173 });
    supervisors.push(sup);
    return sup;
  }

  it("红检：伪造 Origin（跨站 no-cors 写）→ 403 ATR JSON，绝不转发到 server 面", async () => {
    const sup = supWithSelfPort();
    await sup.start();
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const evil = await fetch(`http://127.0.0.1:${port}/api/echo`, {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ stolen: true }),
    });
    expect(evil.status).toBe(403); // 修复前：200——请求被原样转发（写面洞）
    const j = (await evil.json()) as { ok: boolean; error: string; fix: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("ATR-403-dev");
    expect(typeof j.fix).toBe("string");
  });

  it("红检：Origin: null（沙箱 iframe / 跨源伪装）→ 403", async () => {
    const sup = supWithSelfPort();
    await sup.start();
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);
    const res = await fetch(`http://127.0.0.1:${port}/api/echo`, { headers: { origin: "null" } });
    expect(res.status).toBe(403); // 修复前：200
  });

  it("同源放行三路：Origin ∈ 白名单（selfPort）/ Origin ≡ Host 头（同授权方）/ 无 Origin（curl·MCP stdio）", async () => {
    const sup = supWithSelfPort();
    await sup.start();
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const allowlisted = await fetch(`http://127.0.0.1:${port}/api/echo`, { headers: { origin: "http://localhost:5173" } });
    expect(allowlisted.status).toBe(200);
    expect(((await allowlisted.json()) as { ok: boolean }).ok).toBe(true);

    // 浏览器同源 POST：Origin 必然 ≡ 实际连接授权方（Host）——放行（既有同源页面 /api 调用零影响）
    const hostMatch = await fetch(`http://127.0.0.1:${port}/api/echo`, { headers: { origin: `http://127.0.0.1:${port}` } });
    expect(hostMatch.status).toBe(200);

    const noOrigin = await fetch(`http://127.0.0.1:${port}/api/echo`); // undici 不发 Origin = 工具链通道
    expect(noOrigin.status).toBe(200);
  });

  it("selfPort 支持函数口径（端口漂移后白名单跟随实际端口——P1 #10 联动）", async () => {
    let actual = 5173;
    const sup = createServerSupervisor({ root: TMP_ROOT, port: 0, mount: "/api", dbPath: ".atelier/dev.db", selfPort: () => actual });
    supervisors.push(sup);
    await sup.start();
    const { srv, port } = await listenOn(sup.middleware());
    httpServers.push(srv);

    const drifted = await fetch(`http://127.0.0.1:${port}/api/echo`, { headers: { origin: "http://127.0.0.1:5174" } });
    expect(drifted.status).toBe(403); // 漂移前 5174 不在白名单
    actual = 5174; // 漂移发生
    const after = await fetch(`http://127.0.0.1:${port}/api/echo`, { headers: { origin: "http://127.0.0.1:5174" } });
    expect(after.status).toBe(200); // 白名单跟随实际端口
  });
});

/* ---------------- P1 #11：握手超时杀子进程 + start() re-entry 防孤儿 ----------------
 * 评审 #11：超时只 reject，child 永活（占端口持 SQLite 句柄）；再 start() 会 spawn 新 child
 * 覆盖引用，旧进程彻底孤儿——与 :29-30 注释承诺「超时杀子进程并如实报错」相悖。 */
describe("P1 #11：握手超时杀子进程（假子进程钉住）+ re-entry 防孤儿", () => {
  it("红检：握手超时 → start() reject 且子进程被终止（pid 数秒内不可 kill(0)）", { timeout: 15000 }, async () => {
    const pidFile = path.join(TMP_ROOT_TIMEOUT, "child.pid");
    writeNeverReadyFixture(TMP_ROOT_TIMEOUT, pidFile);
    const sup = createServerSupervisor({ root: TMP_ROOT_TIMEOUT, port: 0, mount: "/api", dbPath: ".atelier/dev.db", readyTimeoutMs: 600 });
    supervisors.push(sup);
    await expect(sup.start()).rejects.toThrow(/握手超时/);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(Number.isFinite(pid) && pid > 0).toBe(true);
    await expectPidDead(pid); // 修复前：子进程永活（占端口持句柄）→ 轮询超时即红
  });

  it("红检：超时后 re-entry start() → 新握手正常，且旧子进程绝不孤儿", { timeout: 15000 }, async () => {
    const pidFile = path.join(TMP_ROOT_TIMEOUT, "child2.pid");
    writeNeverReadyFixture(TMP_ROOT_TIMEOUT, pidFile);
    const sup = createServerSupervisor({ root: TMP_ROOT_TIMEOUT, port: 0, mount: "/api", dbPath: ".atelier/dev.db", readyTimeoutMs: 500 });
    supervisors.push(sup);
    await expect(sup.start()).rejects.toThrow(/握手超时/);
    const oldPid = Number(fs.readFileSync(pidFile, "utf8"));

    writeFixtureAt(TMP_ROOT_TIMEOUT, "v-reentry"); // 入口换装成守约 fixture，再 start
    const started = await sup.start();
    expect(started).not.toBeNull();
    expect(sup.isReady()).toBe(true);
    await expectPidDead(oldPid); // 修复前：旧 child 被覆盖引用成孤儿 → 仍活 → 红
  });
});
