/**
 * dev-port-drift.test.ts — P1 #10 红绿：dev 面 actualPort 单源化（评审 #10）。
 *
 * 背景：Vite strictPort 缺省 false——配置端口被占时自动 +1，config.server.port 不变。
 * 插件 7 处硬用 `config.server.port ?? 5173`（fetchChildStatus host / selfPort（cookie 名 +
 * Origin 白名单）/ mcp devUrl / screenshot appUrl+navUrl / a11y appUrl+navUrl），漂移后全错：
 * 截图导航打到错误端口（可能拍到另一个项目）、cookie `atelier_dev_token-5173` 两实例互踩
 * （P1-12 注释承诺的并行隔离恰在并行场景失效）。修法 = listen 后取
 * `server.httpServer.address().port` 缓存单一 actualPort，7 处改引。
 *
 * 被测形态：假 server harness（dev-face-security 同款）+ 真 http.Server 当 httpServer——
 * 「already-listening」（configureServer 晚于 listen，编程式启动）与「pre-listen」（真实 Vite
 * 时序：configureServer 先于 listen，listening 事件里 adopt）两种时序都钉。
 * 无头捕获经 vi.mock 打桩——绝不 spawn 真浏览器，探针只记录 navUrl。
 * 红检口径（实现前实测为红）：漂移现场下 cookie 名 / 截图导航与 capturedFrom / a11y capturedFrom
 * 一律用实际端口，绝不出现配置端口。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/* 无头捕获打桩：记录导航 URL（P1 #10 断言「截图/a11y 导航用实际端口」的探针），同步返回定值 */
const shotCalls: string[] = [];
vi.mock("../dev/dev-screenshot.mjs", () => ({
  capturePagePersistent: vi.fn(async (opts: { url: string }) => {
    shotCalls.push(opts.url);
    return { imageBase64: "ZmFrZQ==", pixelDiff: null };
  }),
  captureA11yPersistent: vi.fn(async (opts: { url: string }) => {
    shotCalls.push(opts.url);
    return { a11y: { role: "WebArea" }, nodeCount: 1 };
  }),
}));

const { atelierDevPlugin } = await import("../dev/atelier-dev-plugin.mjs");

const CONFIG_PORT = 4321; // 假配置端口（≠ 实际端口 = 随机漂移现场）

const tmpDirs: string[] = [];
const servers: http.Server[] = [];
afterAll(() => {
  while (servers.length) servers.pop()?.close();
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function listen(real: http.Server): Promise<void> {
  return new Promise((resolve) => real.listen(0, "127.0.0.1", () => resolve()));
}

/** 漂移现场 harness：插件实例 + 真 httpServer（实际端口 ≠ 配置端口）+ 中间件调用器 */
async function setupDrift(mode: "already-listening" | "pre-listen") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-port-drift-"));
  tmpDirs.push(tmp);
  const prevCwd = process.cwd();
  process.chdir(tmp);
  const real = http.createServer(() => {});
  servers.push(real);
  if (mode === "already-listening") await listen(real);
  const plugin = atelierDevPlugin();
  const handlers: any[] = [];
  plugin.configureServer({
    middlewares: { use: (fn: any) => handlers.push(fn) },
    config: { server: { port: CONFIG_PORT } },
    watcher: { add() {}, on() {} },
    httpServer: real,
  });
  if (mode === "pre-listen") await listen(real); // 真实 Vite 时序：configureServer 之后才 listen
  const actualPort = (real.address() as AddressInfo).port;
  expect(actualPort).not.toBe(CONFIG_PORT); // 漂移现场成立
  const token = fs.readFileSync(path.join(tmp, ".atelier", "dev-token"), "utf8").trim();
  const call = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const body = init?.body;
    const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: null as unknown, ended: false };
    res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
    res.end = (b?: unknown) => { res.body = b; res.ended = true; };
    res.write = () => {};
    res.writeHead = (code: number) => { res.statusCode = code; };
    res.destroy = () => {};
    const req: any = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      on(ev: string, cb: (c?: unknown) => void) {
        if (ev === "data" && body) cb(Buffer.from(body));
        if (ev === "end") cb();
      },
    };
    return (async () => {
      for (const h of handlers) {
        let nexted = false;
        await h(req, res, () => { nexted = true; });
        if (!nexted) return res;
      }
      return res;
    })();
  };
  const restore = () => process.chdir(prevCwd);
  return { call, actualPort, token, restore };
}

describe("P1 #10：端口漂移后 cookie / 截图 / a11y 一律用实际端口（actualPort 单源）", () => {
  it("红检（真实 Vite 时序 pre-listen）：token→cookie 一次性通道的 cookie 名用实际端口", async () => {
    const { call, actualPort, token, restore } = await setupDrift("pre-listen");
    try {
      const res = await call(`/?token=${token}`, { headers: { accept: "text/html,application/xhtml+xml" } });
      expect(res.statusCode).toBe(302);
      const cookie = String(res.headers["set-cookie"] ?? "");
      expect(cookie).toContain(`atelier_dev_token-${actualPort}=${token}`); // 修复前：名字里是配置端口 4321 → 红
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      // cookie 门同样用实际端口名读回
      const viaCookie = await call("/__atelier/state-snapshot", { headers: { cookie: `atelier_dev_token-${actualPort}=${token}` } });
      expect(viaCookie.statusCode).toBe(200);
    } finally {
      restore();
    }
  });

  it("红检（pre-listen）：截图导航 URL 与 capturedFrom 用实际端口（无头捕获已打桩不 spawn）", async () => {
    const { call, actualPort, token, restore } = await setupDrift("pre-listen");
    try {
      const res = await call("/__atelier/screenshot", { headers: { "x-atelier-token": token } });
      expect(res.statusCode).toBe(200);
      const j = JSON.parse(String(res.body)) as { ok: boolean; capturedFrom: string };
      expect(j.ok).toBe(true);
      expect(j.capturedFrom.startsWith(`http://127.0.0.1:${actualPort}/`)).toBe(true); // 修复前：4321 → 红
      const nav = shotCalls.at(-1) ?? "";
      expect(nav.startsWith(`http://127.0.0.1:${actualPort}/`)).toBe(true); // 导航 URL（修复前：4321 → 红）
      expect(nav).toContain("token="); // P1-12 一次性通道形态保持
    } finally {
      restore();
    }
  });

  it("红检（already-listening 时序）：a11y 捕获 URL 与 capturedFrom 同口径", async () => {
    const { call, actualPort, token, restore } = await setupDrift("already-listening");
    try {
      const res = await call("/__atelier/a11y", { headers: { "x-atelier-token": token } });
      expect(res.statusCode).toBe(200);
      const j = JSON.parse(String(res.body)) as { ok: boolean; capturedFrom: string };
      expect(j.ok).toBe(true);
      expect(j.capturedFrom.startsWith(`http://127.0.0.1:${actualPort}/`)).toBe(true); // 修复前：4321 → 红
      expect((shotCalls.at(-1) ?? "").startsWith(`http://127.0.0.1:${actualPort}/`)).toBe(true);
    } finally {
      restore();
    }
  });
});
