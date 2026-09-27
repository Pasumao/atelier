/**
 * dev-face-security.test.ts — P1-12 红检（唯一信任锚 dev-token 的三个暴露面收口）。
 *
 * 建议书 P1-12：dev-token 同时暴露于 ① 每个页面 HTML（window.__ATELIER_TOKEN__）/ ② 明文落盘
 * 默认 0644 / ③ CDP 固定端口 9345 无鉴权；且 /__atelier/* 无 Origin/Host 校验、readBody 不查
 * content-type（no-cors text/plain 可伪装 JSON 体跨站写）。
 *
 * 被测件 = dev/atelier-dev-plugin.mjs（导出安全原语 + configureServer 中间件 harness）与
 * dev/dev-screenshot.mjs（CDP spawn 形态）。harness 沿用 dev-review.test.ts 的假 server 注入
 * 模式（插件以 process.cwd() 为 ROOT——chdir 进 tmp，dev-token 落 tmp，绝不污染工作树）。
 * 红检口径（实现前实测为红，实现后转绿）：伪造 Origin → 403；text/plain JSON 体 → 415；
 * token 出 HTML（transformIndexHtml/review 页/endpoints 页/review-ext.js 均不含 token）；
 * 首访 ?token= → Set-Cookie(HttpOnly+SameSite=Strict) + 302 清洗；cookie 通道鉴权可达；
 * dev-token 0600（POSIX 行为级 / win32 形态机检——win32 chmod 仅只读位，语义注记见插件）；
 * CDP 随机端口 + 显式回环绑定 + 常驻空闲即杀（形态机检 + pickFreePort 单元）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEV_COOKIE = "atelier_dev_token";
const SELF_PORT = 5173;

/* ---------------- 单元：Origin/Host 白名单原语（① 导出面） ---------------- */

describe("P1-12 ①：Origin/Host 白名单原语（导出可测）", () => {
  let originAllowlist: (port: number, extraHosts?: unknown) => string[];
  let originAllowed: (origin: unknown, allowlist: string[], hostHeader?: unknown) => boolean;
  let isJsonContentType: (ct: unknown) => boolean;

  beforeAll(async () => {
    const mod: any = await import("../dev/atelier-dev-plugin.mjs");
    originAllowlist = mod.originAllowlist;
    originAllowed = mod.originAllowed;
    isJsonContentType = mod.isJsonContentType;
  });

  it("originAllowlist：127.0.0.1/localhost/[::1] × 配置 host，http+https 双 scheme", () => {
    expect(originAllowlist).toBeTypeOf("function");
    const list = originAllowlist(SELF_PORT, "devbox.local");
    expect(list).toContain(`http://127.0.0.1:${SELF_PORT}`);
    expect(list).toContain(`http://localhost:${SELF_PORT}`);
    expect(list).toContain(`http://[::1]:${SELF_PORT}`);
    expect(list).toContain(`http://devbox.local:${SELF_PORT}`);
    expect(list).toContain(`https://127.0.0.1:${SELF_PORT}`);
  });

  it("originAllowlist：通配 host（0.0.0.0/::/*/true）不进白名单——它们不是『自身 host』", () => {
    for (const wildcard of ["0.0.0.0", "::", "*", true]) {
      const list = originAllowlist(SELF_PORT, wildcard);
      expect(list.some((o) => o.includes("0.0.0.0") || o.includes("devbox"))).toBe(false);
    }
  });

  it("originAllowed：白名单命中 / Host 头同授权方 → true；伪造 / null / 乱值 → false", () => {
    expect(originAllowed).toBeTypeOf("function");
    const list = originAllowlist(SELF_PORT);
    expect(originAllowed(`http://127.0.0.1:${SELF_PORT}`, list)).toBe(true);
    expect(originAllowed(`http://localhost:${SELF_PORT}`, list)).toBe(true);
    // Host 头 = 浏览器实际连接授权方——同授权方即同源（自定义 host/局域网 IP 场景）
    expect(originAllowed("http://devbox.local:5173", list, "devbox.local:5173")).toBe(true);
    expect(originAllowed("http://evil.example", list, "127.0.0.1:5173")).toBe(false);
    expect(originAllowed("http://evil.example:5173", list)).toBe(false);
    expect(originAllowed("null", list)).toBe(false);
    expect(originAllowed("not a url", list)).toBe(false);
    expect(originAllowed("", list)).toBe(false);
  });

  it("isJsonContentType：仅 application/json（可带参数）受理；text/plain/缺失/近似名拒绝", () => {
    expect(isJsonContentType).toBeTypeOf("function");
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("Application/JSON")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
    expect(isJsonContentType("")).toBe(false);
    expect(isJsonContentType("application/jsonx")).toBe(false);
  });
});

/* ---------------- 集成：/__atelier/* 中间件（假 server harness） ---------------- */

describe("P1-12 ①②：dev 插件中间件 Origin 闸 / content-type 闸 / token 一次性通道", () => {
  let handlers: ((req: any, res: any, next: () => void) => Promise<void> | void)[] = [];
  let token = "";
  let pluginInstance: any = null;
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-devsec-"));
  const prevCwd = process.cwd();

  function mockRes() {
    const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: null as unknown, ended: false };
    res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
    res.end = (b?: unknown) => { res.body = b; res.ended = true; };
    res.write = () => {};
    res.writeHead = (code: number) => { res.statusCode = code; };
    return res;
  }
  function makeReq(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
    const body = init?.body;
    return {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      on(ev: string, cb: (c?: unknown) => void) {
        if (ev === "data" && body) cb(Buffer.from(body));
        if (ev === "end") cb();
      },
    };
  }
  async function call(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
    const res = mockRes();
    let nexted = false;
    for (const h of handlers) {
      nexted = false;
      await h(makeReq(url, init), res, () => { nexted = true; });
      if (!nexted) return res;
    }
    return res;
  }

  beforeAll(async () => {
    process.chdir(TMP);
    const { atelierDevPlugin } = await import("../dev/atelier-dev-plugin.mjs");
    pluginInstance = atelierDevPlugin(); // 只实例化一次——工厂每调用一次就铸造一枚新 token 并重写 dev-token
    const captured: unknown[] = [];
    const fakeServer: any = { middlewares: { use: (fn: unknown) => captured.push(fn) }, config: { server: { port: SELF_PORT } } };
    pluginInstance.configureServer?.(fakeServer);
    handlers = captured as typeof handlers;
    token = fs.readFileSync(path.join(TMP, ".atelier", "dev-token"), "utf8").trim();
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("红检①：伪造 Origin（跨站页面驱动）+ 有效 token → 403 拒绝", async () => {
    const res = await call("/__atelier/server-status", { headers: { "x-atelier-token": token, origin: "http://evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(String(res.body)).toContain("origin");
  });

  it("红检①：Origin: null（沙箱iframe/跨源伪装）→ 403", async () => {
    const res = await call("/__atelier/server-status", { headers: { "x-atelier-token": token, origin: "null" } });
    expect(res.statusCode).toBe(403);
  });

  it("同源放行：Origin=127.0.0.1:5173 / Host 头同授权方 / 无 Origin（curl·MCP 直连）三路均 200", async () => {
    const sameOrigin = await call("/__atelier/server-status", { headers: { "x-atelier-token": token, origin: `http://127.0.0.1:${SELF_PORT}` } });
    expect(sameOrigin.statusCode).toBe(200);
    const hostMatch = await call("/__atelier/server-status", { headers: { "x-atelier-token": token, origin: "http://devbox.local:5173", host: "devbox.local:5173" } });
    expect(hostMatch.statusCode).toBe(200);
    const noOrigin = await call("/__atelier/server-status", { headers: { "x-atelier-token": token } });
    expect(noOrigin.statusCode).toBe(200);
  });

  it("红检①：no-cors text/plain 伪装 JSON 体 → 415 拒收（bridge/enqueue + mcp 直连）", async () => {
    const enqueue = await call("/__atelier/bridge/enqueue", {
      method: "POST",
      headers: { "x-atelier-token": token, "content-type": "text/plain" },
      body: JSON.stringify({ op: "checkpoint.rollback", args: {} }),
    });
    expect(enqueue.statusCode).toBe(415);
    const mcp = await call("/__atelier/mcp", {
      method: "POST",
      headers: { "x-atelier-token": token, "content-type": "text/plain", "mcp-method": "tools/call" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1 }),
    });
    expect(mcp.statusCode).toBe(415);
  });

  it("content-type 缺失 = 非浏览器工具链通道，放行（浏览器带体 POST 必有 CT；写主闸是 Origin 门）", async () => {
    const noCt = await call("/__atelier/bridge/enqueue", {
      method: "POST",
      headers: { "x-atelier-token": token },
      body: JSON.stringify({ op: "state.graph", args: {} }),
    });
    expect(noCt.statusCode).toBe(200);
  });

  it("application/json 照常受理（工具链/页面桥既有通道不破）", async () => {
    const enqueue = await call("/__atelier/bridge/enqueue", {
      method: "POST",
      headers: { "x-atelier-token": token, "content-type": "application/json" },
      body: JSON.stringify({ op: "state.graph", args: {} }),
    });
    expect(enqueue.statusCode).toBe(200);
    expect(JSON.parse(String(enqueue.body)).ok).toBe(true);
    const mcp = await call("/__atelier/mcp", {
      method: "POST",
      headers: { "x-atelier-token": token, "content-type": "application/json", "mcp-method": "ping" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1 }),
    });
    expect(mcp.statusCode).not.toBe(415);
    expect(mcp.statusCode).not.toBe(403);
  });

  it("红检②：首访带 token 的页面导航 → 302 清洗 URL + Set-Cookie(HttpOnly+SameSite=Strict)", async () => {
    const res = await call(`/?token=${token}&snapshot=1`, { headers: { accept: "text/html,application/xhtml+xml" } });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toBe("/?snapshot=1"); // token 从 URL 清洗
    const cookie = String(res.headers["set-cookie"] ?? "");
    expect(cookie).toContain(`${DEV_COOKIE}-${SELF_PORT}=${token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("红检②：/__atelier/review?token= 导航同样走一次性通道（review --open 流程）", async () => {
    const res = await call(`/__atelier/review?token=${token}`, { headers: { accept: "text/html" } });
    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toBe("/__atelier/review");
  });

  it("非导航 GET（工具链 curl / EventSource）不重定向——token 查询通道保留", async () => {
    const curlish = await call(`/__atelier/review-ext.js?token=${token}`, { headers: { accept: "*/*" } });
    expect(curlish.statusCode).toBe(200);
    expect(curlish.headers["set-cookie"]).toBeUndefined();
  });

  it("红检②：cookie 通道鉴权可达（此后页面/API 不再需要 token 头）", async () => {
    const res = await call("/__atelier/server-status", { headers: { cookie: `${DEV_COOKIE}-${SELF_PORT}=${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("红检②：transformIndexHtml 不再内嵌 token（token 出 HTML）", async () => {
    const out = pluginInstance.transformIndexHtml?.("<html><head></head><body></body></html>");
    expect(String(out ?? "")).not.toContain(token);
  });

  it("红检②：review 页 / endpoints 调试页 / review-ext.js 均不含 token（插件自供页面同步出 HTML）", async () => {
    const review = await call("/__atelier/review", { headers: { "x-atelier-token": token } });
    expect(review.statusCode).toBe(200);
    expect(String(review.body)).not.toContain(token);
    const endpoints = await call("/__atelier/endpoints", { headers: { "x-atelier-token": token } });
    expect(endpoints.statusCode).toBe(200);
    expect(String(endpoints.body)).not.toContain(token);
    const ext = await call(`/__atelier/review-ext.js?token=${token}`);
    expect(String(ext.body)).not.toContain(token);
  });

  it("红检②：dev-token 落盘 0600（POSIX 行为级；win32 仅只读位可设——形态机检 + 平台语义注记）", async () => {
    const tokenFile = path.join(TMP, ".atelier", "dev-token");
    if (process.platform === "win32") {
      // win32 chmod 语义：仅 read-only 位可设（0o600 含写位 → 可写文件，模式位不上盘）——
      // 尽力而为：断言源码带 0o600 意图位；行为级断言归 POSIX CI。
      const src = fs.readFileSync(new URL("../dev/atelier-dev-plugin.mjs", import.meta.url), "utf8");
      expect(src).toContain("0o600");
    } else {
      expect(fs.statSync(tokenFile).mode & 0o777).toBe(0o600);
    }
  });
});

/* ---------------- ③：CDP 面形态机检 + pickFreePort 单元 ---------------- */

describe("P1-12 ③：CDP 暴露面收紧（随机端口 + 显式回环 + 生命周期）", () => {
  it("pickFreePort：返回可用端口号（int 1-65535）", async () => {
    const mod: any = await import("../dev/dev-screenshot.mjs");
    expect(mod.pickFreePort).toBeTypeOf("function");
    const p1: number = await mod.pickFreePort();
    expect(Number.isInteger(p1)).toBe(true);
    expect(p1).toBeGreaterThanOrEqual(1);
    expect(p1).toBeLessThanOrEqual(65535);
  });

  it("形态机检：不再默认固定 9345；显式绑 127.0.0.1；常驻实例空闲即杀", () => {
    const src = fs.readFileSync(new URL("../dev/dev-screenshot.mjs", import.meta.url), "utf8");
    expect(src, "固定端口缺省值已移除（每次随机，ATELIER_SHOT_PORT 仅作显式覆盖）").not.toMatch(/debugPort\s*=\s*9345/);
    expect(src, "显式回环绑定（Chromium 缺省即 127.0.0.1，写明意图）").toContain("--remote-debugging-address=127.0.0.1");
    expect(src, "随机端口经 pickFreePort 探测").toContain("pickFreePort");
    expect(src, "常驻实例空闲即杀（收紧暴露窗）").toContain("ATELIER_SHOT_IDLE_MS");
  });
});
