/**
 * restful-get.test.ts — 差距批 A7「GET for query（REST 互操作）运行时分发」（决策 34，
 * D-F11 留门的运行时扩张）验收：
 *   · 路由：声明 restful:true 的 query 端点接受 GET <mount>/<name>?<query> 分发（插在既有
 *     POST 分发 405 兜底之前；与 /live SSE 后缀路由天然无冲突——带后缀先被截走）；未声明
 *     restful / command / 未知名 GET → 维持 405 ATR-311 兜底（默认关零变化），文案补导航指路。
 *   · 输入构造：URL 查询串按端点输入契约（FlatSchema）做**显式类型投影**——number = Number(v)
 *     （空串/NaN → 400 ATR-312 指明字段与原因）、boolean 只认 "true"/"false"（不猜 "1"/"yes"）、
 *     string 原样、array 按重复键收集（URLSearchParams.getAll）；未知参数显式拒绝（POST JSON 体
 *     未知键经 validateFlat 静默放行是既有口径——GET 查询串有意更严：URL 是代理日志/浏览器历史
 *     里的公共面，寄生参数不得静默流进 handler；两通道差异钉死）；标量字段重复键显式拒绝；
 *     无契约端点带参拒绝（无投影依据，fix 指路补契约）。
 *   · 校验同链：投影产物照走 validateFlat——缺必填/范围违规 → 400 ATR-201，与 POST 同码同文风
 *     （一致性钉死，GET 与 POST 对同一违约给出逐字相同错误）。
 *   · 鉴权/限流全同链：session/apikey 双通道先于输入构造（被拒之门前不触碰 handler）；
 *     readAuth 每请求恰一次；限流闸（分发器最前）对 GET 计数。
 *   · A5 cache 联动：GET 与 POST 共用分发成功路径构造 → Cache-Control 注入两通道一致；
 *     ATR 错误路径无头（错误响应不该被缓存）。
 *   · journal 语义不变：query 永不入账（GET query 亦然——被拒之门的 400 同样不入账）。
 *   · live×restful 两不误：GET <name> 返回 JSON（对齐 POST 直调 live 端点的现状语义）、
 *     GET <name>/live 仍走 SSE。
 *   · 内省零形状（拍板 v1 不进内省）：EndpointSummary / server-status 端点行无 restful 键。
 *   · node-host serve() 真实端口一轮（uploads.test.ts ⑨ 同款风格）。
 * 纪律：先红后绿——红检证据见红检 commit 说明（restful GET 现状落 405 ATR-311 兜底）。
 */
import { describe, expect, it } from "vitest";
import { AtrEndpointError, defineCommand, defineQuery, EndpointRegistry, endpointError } from "../server/endpoints";
import type { AtrError, FlatSchema } from "../runtime/contract";
import { introspectResponse } from "../server/introspect";
import { serve } from "../server/node-host";

/** 取 AtrEndpointError 内嵌的四段式 AtrError（注册期抛错形态——err.atr 才是结构化错误本体；cache-meta.test.ts 同款） */
function atrOf(fn: () => unknown): AtrError {
  try {
    fn();
  } catch (e) {
    if (e instanceof AtrEndpointError) return e.atr;
    throw e;
  }
  throw new Error("期望注册期硬错，实际未抛");
}

function get(handler: (req: Request) => Promise<Response>, url: string): Promise<Response> {
  return handler(new Request(url, { method: "GET" }));
}

function post(handler: (req: Request) => Promise<Response>, name: string, body: unknown): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", body: JSON.stringify(body) }));
}

/** 主夹具契约：req + 四类叶子 opt（number/string/boolean/array）——投影全集一表打尽 */
const browseInput: FlatSchema = {
  type: "object",
  reqProps: { chatId: { type: "number", min: 1 } },
  optProps: {
    limit: { type: "number", max: 100 },
    q: { type: "string" },
    flag: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
  },
};

/** restful query 夹具：handler 回显输入与类型事实（投影是否真落成 number/boolean/array 可断言） */
function restfulReg(handler2?: (req: Request) => { type: "session"; principal: string } | null): { reg: EndpointRegistry; handler: (req: Request) => Promise<Response>; seen: { value: unknown } } {
  const reg = new EndpointRegistry();
  const seen = { value: null as unknown };
  reg.register(
    defineQuery("browse.list", {
      contract: browseInput,
      restful: true,
      handler: (input) => {
        seen.value = input;
        return { echo: input as Record<string, unknown> };
      },
    })
  );
  const handler = reg.createHandler({ ...(handler2 ? { auth: handler2 as never } : {}) });
  return { reg, handler, seen };
}

/* ================= ① 路由：restful GET 分发 + 405 兜底文案 ================= */

describe("restful GET 路由（决策 34）：声明 restful:true 的 query 端点 GET 分发，其余维持 405 兜底", () => {
  it("happy path：GET /browse.list?chatId=42 → 200（查询串按契约投影，handler 拿到真 number）", async () => {
    const { handler, seen } = restfulReg();
    const res = await get(handler, "http://local.test/browse.list?chatId=42&limit=5&q=hello&flag=true&tags=a&tags=b");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: { chatId: 42, limit: 5, q: "hello", flag: true, tags: ["a", "b"] } });
    expect(seen.value).toEqual({ chatId: 42, limit: 5, q: "hello", flag: true, tags: ["a", "b"] });
    // 投影是显式类型投影不是字符串透传：number 字段在 handler 里是真 number
    expect(typeof (seen.value as { chatId: unknown }).chatId).toBe("number");
    expect(typeof (seen.value as { flag: unknown }).flag).toBe("boolean");
    expect(res.headers.get("x-atelier-endpoint")).toBe("browse.list"); // 成功响应头与 POST 同构造
  });

  it("POST 通道保留：restful 端点 POST JSON 直调照常 200（加法不替换——双通道并存）", async () => {
    const { handler } = restfulReg();
    const res = await post(handler, "browse.list", { chatId: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: { chatId: 7 } });
  });

  it("未声明 restful 的 query GET → 405 ATR-311 新文案（fix 补指路 restful:true 导航，message 前缀不动）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("plain.q", { handler: () => ({ ok: true }) }));
    const res = await get(reg.createHandler(), "http://local.test/plain.q");
    expect(res.status).toBe(405);
    const err = (await res.json()) as { code: string; message: string; fix: string };
    expect(err.code).toBe("ATR-311");
    expect(err.message).toContain("只接受 POST"); // 既有 message 前缀（journal-subprocess 钉住）不动
    expect(err.fix).toContain("restful:true"); // 新导航：GET 分发仅限声明 restful:true 的 query 端点
    expect(err.fix).toContain("改 POST");
  });

  it("command GET → 405 ATR-311（写端点无 GET 分发，读写二分纪律不动）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineCommand("chat.send", { handler: () => ({ ok: true }) }));
    const res = await get(reg.createHandler(), "http://local.test/chat.send");
    expect(res.status).toBe(405);
    expect(((await res.json()) as { code: string }).code).toBe("ATR-311");
  });

  it("command 声明 restful:true → 注册期 ATR-313 硬错（与 export-openapi 扫描器同规则 fail-closed——声明不可能被静默吞）", () => {
    const err = atrOf(() =>
      new EndpointRegistry().register(defineCommand("chat.send", { restful: true, handler: () => ({ ok: true }) }))
    );
    expect(err.code).toBe("ATR-313");
    expect(err.message).toContain("command");
    expect(err.message).toContain("restful");
  });

  it("未知端点 GET → 仍 405 ATR-311（分发器顺序保持：405 兜底先于 404，零变化）", async () => {
    const reg = new EndpointRegistry();
    const res = await get(reg.createHandler(), "http://local.test/nope.ep");
    expect(res.status).toBe(405);
    expect(((await res.json()) as { code: string }).code).toBe("ATR-311");
  });
});

/* ================= ② 输入构造：URL 查询串 → 契约显式类型投影 ================= */

describe("restful GET 输入构造（显式类型投影——有什么类型投影什么，不猜）", () => {
  it("number 两态：\"42\" → 42；\"abc\" → 400 ATR-312 指明字段与原因；空串 → 400（Number(\"\")=0 的陷阱显式封死）", async () => {
    const { handler } = restfulReg();
    const ok = await get(handler, "http://local.test/browse.list?chatId=42");
    expect(ok.status).toBe(200);
    const bad = await get(handler, "http://local.test/browse.list?chatId=abc");
    expect(bad.status).toBe(400);
    const err = (await bad.json()) as { code: string; message: string };
    expect(err.code).toBe("ATR-312");
    expect(err.message).toContain("chatId");
    const empty = await get(handler, "http://local.test/browse.list?chatId=");
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe("ATR-312");
  });

  it("boolean 只认 \"true\"/\"false\"：两值各投影为真 boolean；\"1\"/\"yes\" → 400 ATR-312（不猜）", async () => {
    const { handler, seen } = restfulReg();
    expect((await get(handler, "http://local.test/browse.list?chatId=1&flag=true")).status).toBe(200);
    expect((seen.value as { flag: unknown }).flag).toBe(true);
    expect((await get(handler, "http://local.test/browse.list?chatId=1&flag=false")).status).toBe(200);
    expect((seen.value as { flag: unknown }).flag).toBe(false);
    for (const v of ["1", "yes", "TRUE"]) {
      const res = await get(handler, `http://local.test/browse.list?chatId=1&flag=${v}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("ATR-312");
    }
  });

  it("string 原样（URLSearchParams 解码后透传，不做类型加工）；optProps number 投影失败同码同拒绝", async () => {
    const { handler } = restfulReg();
    const res = await get(handler, `http://local.test/browse.list?chatId=1&q=${encodeURIComponent("空格 与 ünïcode")}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { echo: { q: string } }).toEqual({ echo: { chatId: 1, q: "空格 与 ünïcode" } });
    const badOpt = await get(handler, "http://local.test/browse.list?chatId=1&limit=abc");
    expect(badOpt.status).toBe(400);
    expect(((await badOpt.json()) as { code: string }).code).toBe("ATR-312");
  });

  it("array 按重复键收集（getAll）：多值 → 数组逐元素投影；单值 → 单元素数组；number items 同规则", async () => {
    const reg = new EndpointRegistry();
    const seen = { value: null as unknown };
    reg.register(
      defineQuery("nums.pick", {
        contract: {
          type: "object",
          reqProps: {},
          optProps: { tags: { type: "array", items: { type: "string" } }, nums: { type: "array", items: { type: "number" } } },
        },
        restful: true,
        handler: (input) => ((seen.value = input), {}),
      })
    );
    const handler = reg.createHandler();
    const res = await get(handler, "http://local.test/nums.pick?tags=a&tags=b&nums=1&nums=2");
    expect(res.status).toBe(200);
    expect(seen.value).toEqual({ tags: ["a", "b"], nums: [1, 2] });
    expect((seen.value as { nums: unknown[] }).nums[0]).toBe(1); // 元素真 number（非 "1"）
    const single = await get(handler, "http://local.test/nums.pick?tags=only");
    expect(single.status).toBe(200);
    expect(seen.value).toEqual({ tags: ["only"] });
  });

  it("未知参数显式拒绝 → 400 ATR-312；同键 POST JSON 体静默放行（两通道差异钉死：URL 是公共面）", async () => {
    const { handler } = restfulReg();
    const res = await get(handler, "http://local.test/browse.list?chatId=1&utm_source=twitter");
    expect(res.status).toBe(400);
    const err = (await res.json()) as { code: string; message: string; fix: string };
    expect(err.code).toBe("ATR-312");
    expect(err.message).toContain("utm_source");
    expect(err.fix).toContain("POST"); // fix 指路 POST 直调（携带契约外数据的通道）
    // POST 未知键：validateFlat 既有口径静默放行（runtime/contract.ts 零改动）——差异是有意设计
    const postRes = await post(handler, "browse.list", { chatId: 1, utm_source: "twitter" });
    expect(postRes.status).toBe(200);
  });

  it("标量字段重复键 → 400 ATR-312（get() 取首值是无声猜测，不猜）；无契约端点带参 → 400（无投影依据）、无参 → 200", async () => {
    const { handler } = restfulReg();
    const dup = await get(handler, "http://local.test/browse.list?chatId=1&chatId=2");
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { code: string }).code).toBe("ATR-312");

    const reg = new EndpointRegistry();
    reg.register(defineQuery("free.q", { restful: true, handler: (input) => ({ got: input as Record<string, unknown> }) }));
    const h2 = reg.createHandler();
    const withParams = await get(h2, "http://local.test/free.q?anything=1");
    expect(withParams.status).toBe(400);
    const err = (await withParams.json()) as { code: string; fix: string };
    expect(err.code).toBe("ATR-312");
    expect(err.fix).toContain("contract"); // fix 指路补契约
    const noParams = await get(h2, "http://local.test/free.q");
    expect(noParams.status).toBe(200);
    expect(await noParams.json()).toEqual({ got: {} }); // 空查询 = {} 输入（POST {} 同语义）
  });
});

/* ================= ③ 校验同链：GET 与 POST 对同一违约逐字同错 ================= */

describe("契约校验同链（投影产物照走 validateFlat——不绕过）", () => {
  it("缺必填：GET 与 POST 同码 ATR-201、同 message（「缺少必填属性 chatId（number）」逐字一致）", async () => {
    const { handler } = restfulReg();
    const g = await get(handler, "http://local.test/browse.list?limit=5"); // 缺 chatId
    expect(g.status).toBe(400);
    const gErr = (await g.json()) as { code: string; message: string };
    expect(gErr.code).toBe("ATR-201");
    expect(gErr.message).toContain("缺少必填属性 chatId");
    const p = await post(handler, "browse.list", { limit: 5 });
    expect(p.status).toBe(400);
    const pErr = (await p.json()) as { code: string; message: string };
    expect(pErr.code).toBe("ATR-201");
    expect(pErr.message).toBe(gErr.message); // GET/POST 一致性钉死
  });

  it("契约范围（min/max）：?chatId=0 → ATR-201 小于下限，与 POST JSON 同文风", async () => {
    const { handler } = restfulReg();
    const g = await get(handler, "http://local.test/browse.list?chatId=0");
    expect(g.status).toBe(400);
    const gErr = (await g.json()) as { code: string; message: string };
    expect(gErr.code).toBe("ATR-201");
    expect(gErr.message).toContain("chatId");
    const p = await post(handler, "browse.list", { chatId: 0 });
    const pErr = (await p.json()) as { code: string; message: string };
    expect(pErr.message).toBe(gErr.message);
  });
});

/* ================= ④ 鉴权/限流全同链 ================= */

describe("restful GET 鉴权与限流（与 POST 全同链——gateAuth 单源 + 分发器最前限流闸）", () => {
  it("restful + session：无会话 → 401 ATR-340 且 handler 不执行（被拒之门前不触碰 handler）；有会话 → 200", async () => {
    let called = false;
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("secret.list", {
        contract: { type: "object", reqProps: {}, optProps: { q: { type: "string" } } },
        restful: true,
        auth: { type: "session" },
        handler: () => ((called = true), { ok: true }),
      })
    );
    const handler = reg.createHandler({ auth: (req) => (req.headers.get("x-token") === "good" ? { type: "session", principal: "u1" } : null) });
    const denied = await get(handler, "http://local.test/secret.list?q=x");
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { code: string }).code).toBe("ATR-340");
    expect(called).toBe(false); // 鉴权先于输入构造与 handler——同 POST「被拒之门前不触碰」语义
    const ok = await handler(new Request("http://local.test/secret.list?q=x", { method: "GET", headers: { "x-token": "good" } }));
    expect(ok.status).toBe(200);
    expect(called).toBe(true);
  });

  it("restful + apikey：携 x-api-key → 200；缺头/错 key → 401 ATR-340（决策 30 通道对 GET 同样开放）", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("machine.list", {
        contract: { type: "object", reqProps: {}, optProps: { q: { type: "string" } } },
        restful: true,
        auth: { type: "apikey" },
        handler: () => ({ ok: true }),
      })
    );
    const handler = reg.createHandler({ apiKeys: { keys: ["sk-1"] } });
    const ok = await handler(new Request("http://local.test/machine.list?q=x", { method: "GET", headers: { "x-api-key": "sk-1" } }));
    expect(ok.status).toBe(200);
    const denied = await get(handler, "http://local.test/machine.list?q=x");
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { code: string }).code).toBe("ATR-340");
  });

  it("readAuth 每请求恰一次（GET 无 auth 声明端点与 POST 同款时机——ctx 装配处调用）", async () => {
    let calls = 0;
    const { handler } = restfulReg(() => {
      calls++;
      return null;
    });
    await get(handler, "http://local.test/browse.list?chatId=1");
    expect(calls).toBe(1);
    await post(handler, "browse.list", { chatId: 1 });
    expect(calls).toBe(2);
  });

  it("限流闸对 GET 计数（闸在分发器最前——方法分派之前）：第 2 个 GET → 429 ATR-344 + Retry-After", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("throttled.q", { restful: true, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ rateLimit: { windowMs: 60_000, max: 1 } });
    const first = await get(handler, "http://local.test/throttled.q");
    expect(first.status).toBe(200);
    const second = await get(handler, "http://local.test/throttled.q");
    expect(second.status).toBe(429);
    const err = (await second.json()) as { code: string };
    expect(err.code).toBe("ATR-344");
    expect(second.headers.get("retry-after")).toBeTruthy();
  });
});

/* ================= ⑤ A5 cache 联动：GET/POST 两路一致 ================= */

describe("restful + cache（A5 决策 33 联动）：GET 与 POST 共用成功路径构造 → 响应头一致", () => {
  it("restful+cache GET → 200 + Cache-Control: private, max-age=30；同端点 POST 同头（两路零差）", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("cached.list", {
        contract: { type: "object", reqProps: {}, optProps: { q: { type: "string" } } },
        restful: true,
        cache: { visibility: "private", maxAge: 30 },
        handler: () => ({ ok: true }),
      })
    );
    const handler = reg.createHandler();
    const g = await get(handler, "http://local.test/cached.list?q=x");
    expect(g.status).toBe(200);
    expect(g.headers.get("cache-control")).toBe("private, max-age=30");
    expect(g.headers.get("x-atelier-endpoint-kind")).toBe("query");
    const p = await post(handler, "cached.list", { q: "x" });
    expect(p.status).toBe(200);
    expect(p.headers.get("cache-control")).toBe("private, max-age=30"); // 与 GET 逐字节一致
  });

  it("GET ATR 错误路径（投影失败 400）无 Cache-Control 头（错误响应不该被缓存——cache-meta 同款负例）", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("cached.list", {
        contract: { type: "object", reqProps: { chatId: { type: "number" } } },
        restful: true,
        cache: { visibility: "private", maxAge: 30 },
        handler: () => ({ ok: true }),
      })
    );
    const res = await get(reg.createHandler(), "http://local.test/cached.list?chatId=abc");
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});

/* ================= ⑥ live × restful 两不误 ================= */

describe("restful live 端点（GET <name> JSON 与 GET <name>/live SSE 两不误）", () => {
  /** SSE 首块读取（最小实现——live.test.ts SseReader 的单帧版） */
  async function firstSseChunk(url: string): Promise<{ contentType: string; chunk: string }> {
    const ac = new AbortController();
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "text/event-stream" } });
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const { value } = await reader.read();
    ac.abort();
    await reader.cancel().catch(() => {});
    return { contentType, chunk: dec.decode(value) };
  }

  it("live+restful：GET <name> → 200 JSON（对齐 POST 直调 live 现状语义）；POST 直调同形；GET <name>/live → SSE 首帧 retry: 3000", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("feed.stream", {
        contract: { type: "object", reqProps: {}, optProps: { limit: { type: "number" } } },
        restful: true,
        live: { invalidate: ["table:messages"] },
        handler: (input) => ({ got: (input as Record<string, unknown>).limit ?? 0 }),
      })
    );
    const handler = reg.createHandler({ mount: "/api" });
    const json = await get(handler, "http://local.test/api/feed.stream?limit=5");
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ got: 5 }); // GET 分发 = 普通 JSON（非 SSE）
    expect(json.headers.get("content-type")).toContain("application/json");
    const postJson = await post(handler, "feed.stream", { limit: 6 });
    expect(await postJson.json()).toEqual({ got: 6 }); // POST 直调 live = 普通 JSON（现状语义不变）
    const sse = await firstSseChunk("http://local.test/api/feed.stream/live");
    expect(sse.contentType).toContain("text/event-stream");
    expect(sse.chunk).toContain("retry: 3000"); // §4.3 线协议：retry 帧先行——/live 通道未被 GET 分发挤占
  });

  it("live 未声明 restful：GET <name> 仍 405（现状不变——restful 默认关零变化）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("feed.legacy", { live: true, handler: () => ({ ok: true }) }));
    const res = await get(reg.createHandler(), "http://local.test/feed.legacy");
    expect(res.status).toBe(405);
    expect(((await res.json()) as { code: string }).code).toBe("ATR-311");
  });
});

/* ================= ⑦ journal 语义与内省零形状 ================= */

describe("journal 与内省（语义不变 + 形状零变化负例）", () => {
  it("GET query 成功与投影失败均不入 journal（query 永不入账——GET query 亦是 query）", async () => {
    const { reg, handler } = restfulReg();
    await get(handler, "http://local.test/browse.list?chatId=1");
    await get(handler, "http://local.test/browse.list?chatId=abc"); // 400 投影失败
    expect(reg.journal().length).toBe(0);
  });

  it("内省零形状：EndpointSummary 与 server-status 端点行无 restful 键（v1 不进内省——拍板留门）", async () => {
    const { reg } = restfulReg();
    const rows = reg.list();
    expect(rows).toHaveLength(1);
    expect("restful" in rows[0]!).toBe(false); // EndpointSummary 零形状变化
    const res = introspectResponse(reg, { mount: "/" });
    expect(res).not.toBeNull();
    const snap = (await res!.json()) as { endpoints: Record<string, unknown>[] };
    expect(snap.endpoints).toHaveLength(1);
    expect("restful" in snap.endpoints[0]!).toBe(false); // server-status 端点行同步零变化
  });
});

/* ================= ⑧ node-host serve() 真实端口一轮（uploads.test.ts ⑨ 同款风格） ================= */

describe("node-host serve() 真实端口：restful GET 过真 socket 一轮", () => {
  it("GET /api/browse.list?chatId=42&flag=true → 200 JSON + x-atelier-endpoint 头（查询串经真 URL 解析）", async () => {
    const { handler } = restfulReg();
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write; // serve 就绪握手行静音（uploads 同款）
    let server: import("node:http").Server;
    try {
      server = await serve(handler, { port: 0 });
    } finally {
      process.stdout.write = orig;
    }
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/browse.list?chatId=42&flag=true`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-atelier-endpoint")).toBe("browse.list");
      expect(await res.json()).toEqual({ echo: { chatId: 42, flag: true } });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

/* 环境注记：restful 分发零宿主依赖（Web 标准 URLSearchParams/Request/URL）——无全局资源需
 * afterAll 清理；serve 用例自带 server.close。__ATELIER_PROD__ 未触碰（本批不改 prod 语义）。 */
