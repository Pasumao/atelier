/**
 * cache-meta.test.ts — 差距批 A5 cache 元数据档位（决策 33，FS-DESIGN §2.2「位先固化」的兑现）验收：
 *   · 形状 cache?: "none" | { visibility: "private" | "public"; maxAge: number }——未声明 = 零变化
 *     （响应不发 Cache-Control 头）；无隐式默认（缺 maxAge = 定义期硬错，不给默认值——显式优于
 *     隐式正是本决策的存在理由）。
 *   · 只许 query 端点声明：command 带 cache（写端点缓存语义自相矛盾）/ live query 带 cache
 *     （SSE 通道有自己的头语义）→ 注册期硬错（ATR-313，registerUpload 参数校验同码先例——
 *     「契约错误炸在定义处」文风对齐 assertInvalidateKeys/ATR-315）。
 *   · public × auth(≠none) 互斥：共享缓存缓存鉴权响应 = 泄露面，注册期显式拒绝；private 任意 auth 可。
 *   · 分发：声明对象档的 query 端点 200 响应带 Cache-Control: private|public, max-age=N；
 *     ATR 结构化错误路径不加缓存头（错误响应不该被缓存）；未声明与 "none" 显式零档均无头。
 *   · 内省：EndpointSummary / server-status 端点行加法字段 cache（未声明无键 / 声明有值原样 /
 *     "none" 诚实呈现——三态）。
 *   · OpenAPI：x-atelier-cache 扩展（声明了才出现；未声明端点投影零变化——openapi-golden 未动）。
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AtrEndpointError, defineCommand, defineQuery, EndpointRegistry, endpointError } from "../server/endpoints";
import { introspectResponse } from "../server/introspect";
import { buildOpenApi, scanOpenApiEndpoints } from "../gen/export-openapi.mjs";

/** 取 AtrEndpointError（定义期硬错的断言替身——与 server-v2/apikey 同款取错形态） */
function atrOf(fn: () => unknown): { code: string; message: string; fix: string } {
  try {
    fn();
  } catch (e) {
    return e as never;
  }
  throw new Error("期望定义期硬错，实际未抛");
}

function post(handler: (req: Request) => Promise<Response>, name: string): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", body: "{}" }));
}

describe("cache 定义期硬错（A5 决策 33：契约错误炸在定义处——register() 注册期 ATR-313）", () => {
  it("command 带 cache → 硬错（写端点缓存响应语义自相矛盾）", () => {
    const reg = new EndpointRegistry();
    const err = atrOf(() =>
      reg.register(defineCommand("chat.send", { cache: { visibility: "private", maxAge: 30 }, handler: () => ({ ok: true }) }))
    );
    expect(err.code).toBe("ATR-313");
    expect(err.message).toContain("chat.send");
    expect(err.message).toContain("command");
  });

  it("live query 带 cache → 硬错（SSE 通道有自己的头语义）；live:false = 显式无 live 不触发", () => {
    const reg = new EndpointRegistry();
    const err = atrOf(() =>
      reg.register(defineQuery("chat.stream", { live: true, cache: { visibility: "private", maxAge: 30 }, handler: () => ({}) }))
    );
    expect(err.code).toBe("ATR-313");
    expect(err.message).toContain("live");
    const errObj = atrOf(() =>
      new EndpointRegistry().register(
        defineQuery("chat.feed", { live: { invalidate: ["table:messages"] }, cache: { visibility: "private", maxAge: 30 }, handler: () => ({}) }))
    );
    expect(errObj.code).toBe("ATR-313");
    // live:false 与 ATR-315 同口径（isLiveDeclared）——显式声明无 live 的 query 可声明 cache
    expect(() =>
      new EndpointRegistry().register(defineQuery("chat.calm", { live: false, cache: { visibility: "private", maxAge: 30 }, handler: () => ({}) }))
    ).not.toThrow();
  });

  it("public × auth(≠none) → 硬错（共享缓存缓存鉴权响应 = 泄露面）；private × session 可；public × auth:none 可", () => {
    const err = atrOf(() =>
      new EndpointRegistry().register(
        defineQuery("user.me", { auth: { type: "session" }, cache: { visibility: "public", maxAge: 60 }, handler: () => ({}) }))
    );
    expect(err.code).toBe("ATR-313");
    expect(err.message).toContain("public");
    const errKey = atrOf(() =>
      new EndpointRegistry().register(
        defineQuery("data.export", { auth: { type: "apikey" }, cache: { visibility: "public", maxAge: 60 }, handler: () => ({}) }))
    );
    expect(errKey.code).toBe("ATR-313");
    expect(() =>
      new EndpointRegistry().register(
        defineQuery("userPrivate.feed", { auth: { type: "session" }, cache: { visibility: "private", maxAge: 30 }, handler: () => ({}) }))
    ).not.toThrow();
    expect(() =>
      new EndpointRegistry().register(
        defineQuery("public.explicit", { auth: { type: "none" }, cache: { visibility: "public", maxAge: 60 }, handler: () => ({}) }))
    ).not.toThrow();
  });

  it("maxAge 缺失 → 硬错（无隐式默认——显式优于隐式正是本决策的存在理由）", () => {
    const err = atrOf(() =>
      new EndpointRegistry().register(defineQuery("feed.list", { cache: { visibility: "public" } as never, handler: () => ({}) }))
    );
    expect(err.code).toBe("ATR-313");
    expect(err.message).toContain("maxAge");
  });

  it("maxAge 非法（负数/小数/非数值）→ 硬错（须非负整数）", () => {
    for (const maxAge of [-1, 1.5, 0.5, "30", null, Number.NaN]) {
      const err = atrOf(() =>
        new EndpointRegistry().register(
          defineQuery("feed.list", { cache: { visibility: "private", maxAge } as never, handler: () => ({}) }))
      );
      expect(err.code).toBe("ATR-313");
      expect(err.message).toContain("maxAge");
    }
    expect(() =>
      new EndpointRegistry().register(defineQuery("feed.zero", { cache: { visibility: "private", maxAge: 0 }, handler: () => ({}) }))
    ).not.toThrow(); // 0 = 非负整数合法（no-store 邻域的显式零秒）
  });

  it("visibility 非法 → 硬错（只认 private|public）；档位只认 \"none\" 或对象；对象未知键 → 硬错", () => {
    const err = atrOf(() =>
      new EndpointRegistry().register(
        defineQuery("feed.list", { cache: { visibility: "shared", maxAge: 60 } as never, handler: () => ({}) }))
    );
    expect(err.code).toBe("ATR-313");
    expect(err.message).toContain("visibility");
    const errTier = atrOf(() =>
      new EndpointRegistry().register(defineQuery("feed.list2", { cache: "private" as never, handler: () => ({}) }))
    );
    expect(errTier.code).toBe("ATR-313");
    const errKey = atrOf(() =>
      new EndpointRegistry().register(
        defineQuery("feed.list3", { cache: { visibility: "private", maxAge: 30, staleWhileRevalidate: 300 } as never, handler: () => ({}) }))
    );
    expect(errKey.code).toBe("ATR-313");
  });
});

describe("cache 分发：200 成功路径注入 Cache-Control；错误路径与零档不加", () => {
  it("private → 响应头 cache-control: private, max-age=30", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("feed.personal", { cache: { visibility: "private", maxAge: 30 }, handler: () => ({ items: [] }) }));
    const res = await post(reg.createHandler(), "feed.personal");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("public + auth:none → cache-control: public, max-age=60", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("time.now", { auth: { type: "none" }, cache: { visibility: "public", maxAge: 60 }, handler: () => ({ now: 1_700_000_000 }) }));
    const res = await post(reg.createHandler(), "time.now");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("未声明 → 响应无 Cache-Control 头（负例钉住现状零变化）；cache:\"none\" 显式零档同样无头", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("feed.plain", { handler: () => ({ ok: true }) }));
    reg.register(defineQuery("feed.none", { cache: "none", handler: () => ({ ok: true }) }));
    for (const name of ["feed.plain", "feed.none"]) {
      const res = await post(reg.createHandler(), name);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBeNull();
    }
  });

  it("错误响应（ATR 结构化错误路径）无缓存头：handler 抛 AtrEndpointError → 422 无 cache-control", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("feed.boom", {
        cache: { visibility: "private", maxAge: 30 },
        handler: () => {
          throw new AtrEndpointError(endpointError("ATR-999", "业务失败", "修 handler"), 422);
        },
      })
    );
    const res = await post(reg.createHandler(), "feed.boom");
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("ATR-999");
    expect(res.headers.get("cache-control")).toBeNull(); // 错误响应不加缓存头（负例钉住）
  });
});

describe("内省加法形状（EndpointSummary / server-status 端点行 cache：未声明无键 / 声明有值 / \"none\" 诚实呈现）", () => {
  it("registry.list() 三态 + GET /__atelier/server-status 端点行同步", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("a.plain", { handler: () => ({}) }));
    reg.register(defineQuery("b.cached", { cache: { visibility: "private", maxAge: 30 }, handler: () => ({}) }));
    reg.register(defineQuery("c.none", { cache: "none", handler: () => ({}) }));
    const rows = reg.list();
    expect("cache" in rows.find((r) => r.name === "a.plain")!).toBe(false); // 未声明 = 键不出现（零变化）
    expect(rows.find((r) => r.name === "b.cached")!.cache).toEqual({ visibility: "private", maxAge: 30 });
    expect(rows.find((r) => r.name === "c.none")!.cache).toBe("none");
    const res = introspectResponse(reg, { mount: "/" });
    expect(res).not.toBeNull();
    const snap = (await res!.json()) as { endpoints: Record<string, unknown>[] };
    const eps = Object.fromEntries(snap.endpoints.map((e) => [e.name as string, e]));
    expect("cache" in eps["a.plain"]).toBe(false);
    expect(eps["b.cached"].cache).toEqual({ visibility: "private", maxAge: 30 });
    expect(eps["c.none"].cache).toBe("none");
  });
});

/* ---------- OpenAPI 投影（x-atelier-cache：声明了才出现，未声明 golden 零变化） ---------- */

const tmpRoots: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-cache-meta-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

describe("OpenAPI 投影：x-atelier-cache 扩展（A5：扫描器提取 cache 值，禁 TS 解析器纪律不破）", () => {
  it("scanOpenApiEndpoints 提取 cache：\"none\" 字符串 / { visibility, maxAge } 对象 / 未声明 = null", () => {
    const src = `export const a = defineQuery("x.a", { cache: "none", handler: () => ({}) });
export const b = defineQuery("x.b", { cache: { visibility: "public", maxAge: 60 }, handler: () => ({}) });
export const c = defineQuery("x.c", { handler: () => ({}) });
`;
    const eps = scanOpenApiEndpoints(src);
    expect(eps).toHaveLength(3);
    expect(eps[0].cache).toBe("none");
    expect(eps[1].cache).toEqual({ visibility: "public", maxAge: 60 });
    expect(eps[2].cache).toBeNull();
  });

  it("buildOpenApi：声明 cache 端点带 x-atelier-cache（对象与 \"none\" 两态）；未声明端点无该键（既有 golden 零变化）", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src", "server", "endpoints"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "server", "endpoints", "time.ts"),
      `export const cachedNow = defineQuery("time.now", {
  cache: { visibility: "public", maxAge: 60 },
  handler: () => ({ now: 0 }),
});
export const noneTier = defineQuery("time.hold", {
  cache: "none",
  handler: () => ({ ok: true }),
});
export const plainPing = defineQuery("time.ping", {
  handler: () => ({ pong: true }),
});
`,
      "utf8"
    );
    const { doc } = buildOpenApi(root);
    expect(doc.paths["/api/time.now"].post["x-atelier-cache"]).toEqual({ visibility: "public", maxAge: 60 });
    expect(doc.paths["/api/time.hold"].post["x-atelier-cache"]).toBe("none");
    expect(doc.paths["/api/time.ping"].post["x-atelier-cache"]).toBeUndefined(); // 未声明 = 扩展键不出现
  });
});
