/**
 * apikey.test.ts — A6 API key 最小切口（2026-09-28，决策 30）验收：
 *   · auth.type:"apikey" 端点 = 机器客户端静态 key 比对装配项（createHandler({ apiKeys })，
 *     缺省不启用 = key 通道恒拒 fail-closed）；人机双通道并存（会话优先，readAuth 链不受影响）；
 *   · 类型互斥：auth.type:"session" 端点不读 key 头（key 不能越权拿用户身份）；
 *   · 恒时比较（node:crypto timingSafeEqual，长度不齐与等长 dummy 跑同形时间——不泄长度侧信道）；
 *   · introspect/list authType 照常反映；live×apikey 注册期 ATR-315 照常 fail-closed。
 * OpenAPI securitySchemes apiKeyAuth 投影归 openapi.test.ts（auth 非法类型用例同处翻转）。
 */
import { describe, expect, it } from "vitest";
import {
  defineCommand,
  defineQuery,
  EndpointRegistry,
  apiKeyMatches,
} from "../server/endpoints";
import { introspectResponse } from "../server/introspect";

type Seen = { auth: unknown } | null;

/** 模拟会话读取器：x-token: good → 会话身份（gen auth createSessionReader 的测试替身形态） */
const sessionReader = (req: Request) =>
  req.headers.get("x-token") === "good" ? { type: "session", principal: "u1" } : null;

function post(
  handler: (req: Request) => Promise<Response>,
  name: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", headers, body: "{}" }));
}

describe("API key 装配拦截（A6 决策 30：auth.type:\"apikey\" 机器客户端通道）", () => {
  it("正确 key → 200；ctx.auth = { type:'apikey', principal:'api-key' }（label 缺省）；handler 收到 apikey 身份", async () => {
    const reg = new EndpointRegistry();
    let seen: unknown = null;
    reg.register(
      defineQuery("data.export", {
        auth: { type: "apikey" },
        handler: (_i, ctx) => ((seen = ctx.auth), { ok: true }),
      })
    );
    const handler = reg.createHandler({ auth: sessionReader, apiKeys: { keys: ["robot-key-1"] } });
    const res = await post(handler, "data.export", { "x-api-key": "robot-key-1" });
    expect(res.status).toBe(200);
    expect(seen).toEqual({ type: "apikey", principal: "api-key" });
  });

  it("label 装配自报 → principal = label；command 成功入账 journal.principal 同步（装配级审计主体）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineCommand("data.import", { auth: { type: "apikey" }, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({
      apiKeys: { keys: ["robot-key-1"], label: "ci-robot" },
    });
    const res = await post(handler, "data.import", { "x-api-key": "robot-key-1" });
    expect(res.status).toBe(200);
    expect(reg.journal()[0]).toMatchObject({ name: "data.import", status: "ok", principal: "ci-robot" });
  });

  it("错 key / 无头 → 401 ATR-340（与既有鉴权域同码同语义）；拦截在 handler 之前（handler 不执行）", async () => {
    const reg = new EndpointRegistry();
    let ran = false;
    reg.register(defineQuery("data.export", { auth: { type: "apikey" }, handler: () => ((ran = true), { ok: true }) }));
    const handler = reg.createHandler({ auth: sessionReader, apiKeys: { keys: ["robot-key-1"] } });
    const wrong = await post(handler, "data.export", { "x-api-key": "not-the-key" });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe("ATR-340");
    const missing = await post(handler, "data.export", {});
    expect(missing.status).toBe(401);
    const missingErr = await missing.json();
    expect(missingErr.code).toBe("ATR-340");
    expect(missingErr.message).toContain("x-api-key"); // 缺头文案带装配头名
    expect(ran).toBe(false);
  });

  it("缺省不启用（fail-closed）：未装配 apiKeys 时 key 通道恒拒——对错 key 都 401，fix 指向装配点", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("data.export", { auth: { type: "apikey" }, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ auth: sessionReader }); // 有会话读取器、无 apiKeys
    const wrongKey = await post(handler, "data.export", { "x-api-key": "robot-key-1" });
    expect(wrongKey.status).toBe(401);
    const err = await wrongKey.json();
    expect(err.code).toBe("ATR-340");
    expect(err.fix).toContain("apiKeys");
    const noHeader = await post(handler, "data.export", {});
    expect(noHeader.status).toBe(401);
    expect((await noHeader.json()).code).toBe("ATR-340");
  });

  it("会话优先共存：有效会话 → 会话身份（带不带 key 头都一样）；无会话 + 有效 key → apikey 身份；都无 → 拒", async () => {
    const reg = new EndpointRegistry();
    let seen: unknown = null;
    reg.register(
      defineQuery("data.export", {
        auth: { type: "apikey" },
        handler: (_i, ctx) => ((seen = ctx.auth), { ok: true }),
      })
    );
    const handler = reg.createHandler({ auth: sessionReader, apiKeys: { keys: ["robot-key-1"] } });
    // 会话 + key 并带 → 会话优先（人机同权限时人先行）
    const both = await post(handler, "data.export", { "x-token": "good", "x-api-key": "robot-key-1" });
    expect(both.status).toBe(200);
    expect(seen).toEqual({ type: "session", principal: "u1" });
    // 仅会话（key 通道对 apikey 端点不设限——会话是更强身份）
    const sessionOnly = await post(handler, "data.export", { "x-token": "good" });
    expect(sessionOnly.status).toBe(200);
    expect(seen).toEqual({ type: "session", principal: "u1" });
    // 仅 key → apikey 身份
    const keyOnly = await post(handler, "data.export", { "x-api-key": "robot-key-1" });
    expect(keyOnly.status).toBe(200);
    expect(seen).toEqual({ type: "apikey", principal: "api-key" });
    // 都无 → 401
    const none = await post(handler, "data.export", {});
    expect(none.status).toBe(401);
    expect((await none.json()).code).toBe("ATR-340");
  });

  it("类型互斥：auth.type:'session' 端点不读 key 头——仅携有效 key → 401 ATR-340（key 不能拿用户身份）", async () => {
    const reg = new EndpointRegistry();
    let ran = false;
    reg.register(defineQuery("user.me", { auth: { type: "session" }, handler: () => ((ran = true), { ok: true }) }));
    const handler = reg.createHandler({ auth: sessionReader, apiKeys: { keys: ["robot-key-1"] } });
    const res = await post(handler, "user.me", { "x-api-key": "robot-key-1" });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("ATR-340");
    expect(ran).toBe(false);
  });

  it("自定义头：装配 apiKeys.header 生效（缺省头失效）；端点 auth 声明 header 覆盖装配缺省（文档即真相同源）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("data.export", { auth: { type: "apikey" }, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ apiKeys: { keys: ["k-1"], header: "x-robot-key" } });
    const hit = await post(handler, "data.export", { "x-robot-key": "k-1" });
    expect(hit.status).toBe(200);
    const miss = await post(handler, "data.export", { "x-api-key": "k-1" });
    expect(miss.status).toBe(401);

    // meta.header 覆盖：装配未自定义头、端点声明 x-meta-key → 该端点按声明收
    const reg2 = new EndpointRegistry();
    reg2.register(
      defineQuery("data.pull", { auth: { type: "apikey", header: "x-meta-key" }, handler: () => ({ ok: true }) })
    );
    const handler2 = reg2.createHandler({ apiKeys: { keys: ["k-1"] } });
    expect((await post(handler2, "data.pull", { "x-meta-key": "k-1" })).status).toBe(200);
    expect((await post(handler2, "data.pull", { "x-api-key": "k-1" })).status).toBe(401);
  });

  it("auth.type:'none' 与未声明端点行为零变化：带不带 key 头均放行（key 头对免鉴权面无语义）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("public.explicit", { auth: { type: "none" }, handler: () => ({ ok: true }) }));
    reg.register(defineQuery("public.legacy", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ apiKeys: { keys: ["k-1"] } });
    for (const name of ["public.explicit", "public.legacy"]) {
      expect((await post(handler, name, {})).status).toBe(200);
      expect((await post(handler, name, { "x-api-key": "k-1" })).status).toBe(200);
    }
  });

  it("live×apikey 组合：注册期 ATR-315 照常 fail-closed（SSE 通道不设 per-subscriber key 门禁）", () => {
    const reg = new EndpointRegistry();
    expect(() =>
      reg.register(defineQuery("live.secret", { live: true, auth: { type: "apikey" }, handler: () => 1 }))
    ).toThrow(/ATR-315/);
  });

  it("role 诚实边界：apikey 身份无角色面——声明 role 的 apikey 端点对 key 调用 403 ATR-341（v1 不做 per-key 角色）", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineQuery("admin.export", { auth: { type: "apikey", role: "admin" }, handler: () => ({ ok: true }) })
    );
    const handler = reg.createHandler({ apiKeys: { keys: ["k-1"] } });
    const res = await post(handler, "admin.export", { "x-api-key": "k-1" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ATR-341");
  });

  it("introspect：registry.list() 与 GET /__atelier/server-status 端点表 authType:'apikey' 照常反映（MCP 消费位）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("data.export", { auth: { type: "apikey" }, handler: () => ({ ok: true }) }));
    expect(reg.list().find((s) => s.name === "data.export")!.authType).toBe("apikey");
    const res = introspectResponse(reg, { mount: "/" });
    expect(res).not.toBeNull();
    const snap = (await res!.json()) as { endpoints: { name: string; authType?: string }[] };
    expect(snap.endpoints.find((e) => e.name === "data.export")?.authType).toBe("apikey");
  });
});

describe("apiKeyMatches 恒时比较（单元：node:crypto timingSafeEqual，长度不齐与等长 dummy 同形）", () => {
  it("正确 key 命中 true；逐一比完不提前返回（合法项混非法项仍命中）", () => {
    expect(apiKeyMatches("robot-key-1", ["robot-key-1"])).toBe(true);
    expect(apiKeyMatches("robot-key-1", ["", "junk", "robot-key-1"])).toBe(true);
    expect(apiKeyMatches("robot-key-1", ["robot-key-1", "other"])).toBe(true);
  });

  it("长度不齐恒 false 不抛；空串 presented / 空串 key 恒 false", () => {
    expect(apiKeyMatches("short", ["a-much-longer-key-value"])).toBe(false);
    expect(apiKeyMatches("a-much-longer-key-value", ["short"])).toBe(false);
    expect(apiKeyMatches("", [""])).toBe(false);
    expect(apiKeyMatches("", ["k"])).toBe(false);
    expect(apiKeyMatches("k", [""])).toBe(false);
    expect(apiKeyMatches("k", [])).toBe(false);
  });

  it("非字符串输入不抛恒 false（presented 与装配项双向防御）", () => {
    expect(apiKeyMatches(null, ["k"])).toBe(false);
    expect(apiKeyMatches(123, ["k"])).toBe(false);
    expect(apiKeyMatches({ k: 1 } as never, ["k"])).toBe(false);
    expect(apiKeyMatches(undefined, ["k"])).toBe(false);
    expect(apiKeyMatches("k", [null, 123, undefined, {}] as never[])).toBe(false);
  });
});
