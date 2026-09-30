/**
 * dev-face-routes.test.ts — R3 结构债批（B 件）：dev 中间件路由表化直测（评审 §2.2 风险 2 / §4.6）。
 *
 * 动机（P1-14 教训）：mount 前缀边界 bug 能活到今天，正说明路由匹配逻辑无法被单独测试——
 * atelier-dev-plugin.mjs 的 atelierFace 原为约 470 行 if-chain（20+ 路由整链黑盒）。本批抽出：
 *   · isAtelierFace(rawUrl)   mount 边界判别（/__atelier/ 前缀，trailing slash 语义显式钉住）
 *   · stripQuery(rawUrl)      路由键归一（path-only，query 剥离）
 *   · matchRoute(table, url)  exact-match 路由表匹配（纯函数）
 *   · plugin.__atelierRouteTable  路由表直测面（configureServer 期挂到插件实例，运行时零消费）
 *   · pruneResolved(map, cap) resolved Map 有界修剪（§4.6：永不清理 → cap FIFO 逐出）
 *
 * 红检口径（实现前实测为红）：上述导出面不存在（undefined / 表缺失 / 无修剪）→ 对应用例红；
 * 「行为逐字节等价」半边（既有分派行为钉）实现前后恒绿——既有 dev-face-security / dev-port-drift /
 * dev-review / mcp-http / snapshot-paths 断言零修改全绿为本件成功标准。
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod: any = await import("../dev/atelier-dev-plugin.mjs");

/* ---------------- 纯函数直测：mount 边界 / 路由键归一 ---------------- */

describe("R3-B 件①：路由匹配纯函数（P1-14 教训——匹配逻辑可直测）", () => {
  it("isAtelierFace：/__atellite 前缀边界——带尾斜杠命中，裸前缀/异前缀/子串不命中", () => {
    const { isAtelierFace } = mod;
    expect(typeof isAtelierFace).toBe("function");
    // 命中面：dev 面全部路由形态（含带 query 的原始 URL——判别发生在 query 剥离前）
    expect(isAtelierFace("/__atelier/registry")).toBe(true);
    expect(isAtelierFace("/__atelier/bridge/state")).toBe(true);
    expect(isAtelierFace("/__atelier/state-snapshot?x=1")).toBe(true);
    // 边界（P1-14 同族）：裸 "/__atelier"（无尾斜杠）不属 dev 面 → next() 交还 Vite
    expect(isAtelierFace("/__atelier")).toBe(false);
    expect(isAtelierFace("/__atelier/")).toBe(true);
    // 前缀吞噬防线：/__atelierEvil、/api/__atelier/x 这类同子串路径绝不误判
    expect(isAtelierFace("/__atelierEvil/state-snapshot")).toBe(false);
    expect(isAtelierFace("/api/__atelier/registry")).toBe(false);
    expect(isAtelierFace("/")).toBe(false);
    expect(isAtelierFace("")).toBe(false);
    expect(isAtelierFace(undefined)).toBe(false);
  });

  it("stripQuery：路由键 = path-only（首个 ? 起剥离；无 query 原样）", () => {
    const { stripQuery } = mod;
    expect(typeof stripQuery).toBe("function");
    expect(stripQuery("/__atelier/audit?lines=50")).toBe("/__atelier/audit");
    expect(stripQuery("/__atelier/registry")).toBe("/__atelier/registry");
    expect(stripQuery("/?token=abc")).toBe("/");
    expect(stripQuery("?x=1")).toBe("");
    expect(stripQuery(undefined)).toBe("");
  });

  it("matchRoute：exact-match——完整路径相等才命中，绝不前缀吞噬", () => {
    const { matchRoute } = mod;
    expect(typeof matchRoute).toBe("function");
    const h1 = async () => {};
    const h2 = async () => {};
    const table = [
      { path: "/__atelier/review", handle: h1 },
      { path: "/__atelier/review-data", handle: h2 },
    ];
    // exact 命中：/review 不吞 /review-data，反之亦然（真实表里的字符串前缀对）
    expect(matchRoute(table, "/__atelier/review")).toBe(table[0]);
    expect(matchRoute(table, "/__atelier/review-data")).toBe(table[1]);
    // 近邻不命中：更长/更短/大小写/带 query（调用方负责先 stripQuery）
    expect(matchRoute(table, "/__atelier/reviewx")).toBeNull();
    expect(matchRoute(table, "/__atelier/review-data/x")).toBeNull();
    expect(matchRoute(table, "/__atelier/revi")).toBeNull();
    expect(matchRoute(table, "/__atelier/REVIEW")).toBeNull();
    expect(matchRoute(table, "/__atelier/review?x=1")).toBeNull();
    expect(matchRoute([], "/__atelier/x")).toBeNull();
    // 同路径重复登记 → 首条胜（find 语义，文档化）
    const dup = [
      { path: "/x", handle: h1 },
      { path: "/x", handle: h2 },
    ];
    expect(matchRoute(dup, "/x")).toBe(dup[0]);
  });
});

/* ---------------- 路由表直测面 + 分派等价钉（假 server harness） ---------------- */

describe("R3-B 件①：插件路由表（__atelierRouteTable 直测面）+ 分派行为等价", () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-face-routes-"));
  const prevCwd = process.cwd();
  let handlers: ((req: any, res: any, next: () => void) => Promise<void> | void)[] = [];
  let token = "";
  let plugin: any = null;

  /** 23 条路由（= 原 if-chain 源顺序；exact-match 互斥，顺序仅为可读性保序） */
  const EXPECTED_PATHS = [
    "/__atelier/mcp",
    "/__atelier/agent-health",
    "/__atelier/server-status",
    "/__atelier/endpoints",
    "/__atelier/review-data",
    "/__atelier/review-ext.js",
    "/__atelier/registry",
    "/__atelier/tokens",
    "/__atelier/state-snapshot",
    "/__atelier/audit",
    "/__atelier/docs",
    "/__atelier/stream-intro",
    "/__atelier/screenshot",
    "/__atelier/a11y",
    "/__atelier/feedback",
    "/__atelier/snapshot-image",
    "/__atelier/review",
    "/__atelier/feedback-history",
    "/__atelier/bridge/state",
    "/__atelier/bridge/commands",
    "/__atelier/bridge/enqueue",
    "/__atelier/bridge/ack",
    "/__atelier/bridge/cmd-status",
  ];

  function mockRes() {
    const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: null as unknown, ended: false };
    res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
    res.end = (b?: unknown) => { res.body = b; res.ended = true; };
    res.write = () => {};
    res.writeHead = (code: number) => { res.statusCode = code; };
    res.destroy = () => {};
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
  /** 返回 res + nexted 标记：nexted=true = dev 面未受理（交还 Vite）——边界行为的可见证据 */
  async function call(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
    const res = mockRes();
    let nexted = false;
    for (const h of handlers) {
      nexted = false;
      await h(makeReq(url, init), res, () => { nexted = true; });
      if (!nexted) return { res, nexted };
    }
    return { res, nexted };
  }

  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  // 与 dev-face-security 同序：先 chdir 再实例化（ROOT 工厂期捕获），只实例化一次
  process.chdir(TMP);
  plugin = mod.atelierDevPlugin();
  const captured: unknown[] = [];
  plugin.configureServer({
    middlewares: { use: (fn: unknown) => captured.push(fn) },
    config: { server: { port: 5173 } },
    watcher: { add() {}, on() {} },
    httpServer: null,
  });
  handlers = captured as typeof handlers;
  token = fs.readFileSync(path.join(TMP, ".atelier", "dev-token"), "utf8").trim();

  it("路由表直测面：23 条、路径唯一、全带 /__atelier/ 前缀、与原 if-chain 清单一一对应", () => {
    const table = plugin.__atelierRouteTable;
    expect(Array.isArray(table), "__atelierRouteTable 应为路由表数组（直测面）").toBe(true);
    expect(table).toHaveLength(EXPECTED_PATHS.length);
    expect(table.map((r: any) => r.path)).toEqual(EXPECTED_PATHS);
    for (const r of table) {
      expect(mod.isAtelierFace(r.path), `表项 ${r.path} 必须带 dev 面前缀`).toBe(true);
      expect(typeof r.handle).toBe("function");
    }
    expect(new Set(table.map((r: any) => r.path)).size).toBe(table.length);
  });

  it("表 × 纯函数集成：matchRoute 对每条表项 exact 命中自身；近邻路径绝不误命中", () => {
    const table = plugin.__atelierRouteTable;
    for (const r of table) {
      expect(mod.matchRoute(table, r.path)).toBe(r);
      expect(mod.matchRoute(table, r.path + "x")).toBeNull(); // 右延不吞噬
    }
    // 真实表中的字符串前缀对：/review ≠ /review-data ≠ /review-ext.js（exact-match 无吞噬）
    expect(mod.matchRoute(table, "/__atelier/review").path).toBe("/__atelier/review");
    expect(mod.matchRoute(table, "/__atelier/review-data").path).toBe("/__atelier/review-data");
    expect(mod.matchRoute(table, "/__atelier/review-ext.js").path).toBe("/__atelier/review-ext.js");
    // 前缀边界：裸 /__atelier、/__atelier/bridge（无子路由路径）、/__atelierEvil 都不命中任何表项
    for (const miss of ["/__atelier", "/__atelier/", "/__atelier/bridge", "/__atelierEvil/state-snapshot", "/__atelier/bridge/state/x"]) {
      expect(mod.matchRoute(table, miss), `${miss} 不应命中任何表项`).toBeNull();
    }
  });

  it("分派等价（行为钉，实现前后恒绿）：query 剥离后 exact 分派——带 query 的路由照常受理", async () => {
    const { res, nexted } = await call("/__atelier/state-snapshot?junk=1", { headers: { "x-atelier-token": token } });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(200);
    const j = JSON.parse(String(res.body));
    expect(j.ok).toBe(false); // 无浏览器上报 → 诚实降级 note（原行为）
    expect(String(j.note)).toContain("no browser has reported yet");
  });

  it("分派等价：/__atelier/bridge（无此路由）与裸 /__atelier、/__atelierEvil → next() 交还 Vite", async () => {
    for (const miss of ["/__atelier/bridge", "/__atelier", "/__atelierEvil/state-snapshot"]) {
      const { nexted } = await call(miss, { headers: { "x-atelier-token": token } });
      expect(nexted, `${miss} 应 next() 放行`).toBe(true);
    }
  });

  it("分派等价：只读路由直 达（tokens/agent-health/audit）+ 缺文件路由走错误围栏（registry/docs → 500 ATR-500）", async () => {
    const tokens = await call("/__atelier/tokens", { headers: { "x-atelier-token": token } });
    expect(tokens.nexted).toBe(false);
    expect(tokens.res.statusCode).toBe(200);
    expect(JSON.parse(String(tokens.res.body)).ok).toBe(true);

    const health = await call("/__atelier/agent-health", { headers: { "x-atelier-token": token } });
    expect(health.res.statusCode).toBe(200);
    expect(JSON.parse(String(health.res.body)).ok).toBe(true);

    const audit = await call("/__atelier/audit?lines=5", { headers: { "x-atelier-token": token } });
    expect(audit.res.statusCode).toBe(200);
    expect(JSON.parse(String(audit.res.body)).rows).toEqual([]);

    // harness TMP 无 src/manifest.json、src/llms.txt —— 读文件失败经外层错误围栏 500（P1 #12 行为）
    const registry = await call("/__atelier/registry", { headers: { "x-atelier-token": token } });
    expect(registry.res.statusCode).toBe(500);
    expect(String(registry.res.body)).toContain("ATR-500");
    const docs = await call("/__atelier/docs", { headers: { "x-atelier-token": token } });
    expect(docs.res.statusCode).toBe(500);
    expect(String(docs.res.body)).toContain("ATR-500");
  });

  it("分派等价：token 一次性通道先于前缀判别（任意路径导航 GET ?token= → 302 清洗）", async () => {
    const res = await call(`/__atelier/review?token=${token}`, { headers: { accept: "text/html" } });
    expect(res.res.statusCode).toBe(302);
    expect(res.res.headers["location"]).toBe("/__atelier/review");
  });
});

/* ---------------- §4.6：resolved Map 有界修剪（cap FIFO 逐出） ---------------- */

describe("R3-B 件④b：resolved 命令回执台账有界修剪", () => {
  it("pruneResolved（纯函数）：超 cap 按插入序逐出最旧；cap 内幂等零逐出", () => {
    const { pruneResolved } = mod;
    expect(typeof pruneResolved).toBe("function");
    const m = new Map<string, unknown>([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    pruneResolved(m, 2);
    expect([...m.keys()]).toEqual(["c", "d"]); // 最旧的 a/b 被逐出
    pruneResolved(m, 2); // 已在 cap 内 → 零变化（幂等）
    expect([...m.keys()]).toEqual(["c", "d"]);
    pruneResolved(m, 0); // cap 0 → 清空（防御性边界）
    expect(m.size).toBe(0);
  });

  it("行为钉：ack 洪峰后旧命令 id 回落 pending（修复前：永不清理 → 恒 done 即红）", async () => {
    // 独立插件实例（上一 describe 的实例已被其他用例污染台账）
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-face-prune-"));
    const prevCwd = process.cwd();
    process.chdir(tmp);
    try {
      const p = mod.atelierDevPlugin();
      const hs: any[] = [];
      p.configureServer({
        middlewares: { use: (fn: unknown) => hs.push(fn) },
        config: { server: { port: 5173 } },
        watcher: { add() {}, on() {} },
        httpServer: null,
      });
      const tok = fs.readFileSync(path.join(tmp, ".atelier", "dev-token"), "utf8").trim();
      const callOne = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const res: any = { statusCode: 200, headers: {}, body: null };
        res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
        res.end = (b?: unknown) => { res.body = b; };
        res.write = () => {};
        res.writeHead = () => {};
        res.destroy = () => {};
        const req: any = {
          url,
          method: init?.method ?? "GET",
          headers: init?.headers ?? {},
          on(ev: string, cb: (c?: unknown) => void) {
            if (ev === "data" && init?.body) cb(Buffer.from(init.body));
            if (ev === "end") cb();
          },
        };
        let nexted = false;
        for (const h of hs) {
          nexted = false;
          await h(req, res, () => { nexted = true; });
          if (!nexted) return res;
        }
        return res;
      };
      const cap: number = mod.MAX_RESOLVED;
      expect(Number.isInteger(cap) && cap > 0).toBe(true);
      const total = cap + 10;
      for (let i = 1; i <= total; i++) {
        const r = await callOne("/__atelier/bridge/ack", {
          method: "POST",
          headers: { "x-atelier-token": tok, "content-type": "application/json" },
          body: JSON.stringify({ id: `cmd-${i}`, ok: true, result: null }),
        });
        expect(r.statusCode).toBe(200);
      }
      const statusOf = async (id: string) => {
        const r = await callOne(`/__atelier/bridge/cmd-status?id=${id}`, { headers: { "x-atelier-token": tok } });
        return JSON.parse(String(r.body)).status;
      };
      // 洪峰 cap+10 条 → 窗口保留最新 cap 条（cmd-11..cmd-total），最旧 10 条逐出 → pending
      expect(await statusOf("cmd-5")).toBe("pending");
      expect(await statusOf("cmd-10")).toBe("pending"); // 恰被挤出的最后一条
      expect(await statusOf("cmd-11")).toBe("done"); // 窗口内最旧存活
      expect(await statusOf(`cmd-${total}`)).toBe("done");
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
