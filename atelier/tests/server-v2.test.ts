/**
 * server-v2.test.ts — 端点运行时 v2（FS-M2，FS-DESIGN §2.3/§3/§15）验收：
 *   ctx 注入（db/auth/signal/audit，§3.2）· 输出契约 ATR-215（dev 强制 / prod 剥离，§3.7）
 *   · JSON-safe ATR-216（dev+prod 都启用——对外设防）· AtrEndpointError.httpStatus 映射（§3.3）
 *   · timeoutMs → ATR-322（真定时器小毫秒值，§3.6）· journal v2 失败入账（D-F12，§3.5）
 *   · live/emits 键语法注册期校验 ATR-314（§4.1）
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  AtrEndpointError,
  defineCommand,
  defineQuery,
  endpointError,
  EndpointRegistry,
} from "../server/endpoints";
import type { FlatSchema } from "../runtime/contract";

const G = globalThis as { __ATELIER_PROD__?: boolean };
afterAll(() => {
  G.__ATELIER_PROD__ = false; // 恢复 dev 语义，防污染同进程后续测试（同 prod-strip.test.ts 约定）
});

function post(handler: (req: Request) => Promise<Response>, name: string, body: unknown): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", body: JSON.stringify(body) }));
}

const okOutput: FlatSchema = {
  type: "object",
  reqProps: { id: { type: "number" }, role: { type: "string", enum: ["user", "assistant"] } },
};

describe("端点运行时 v2（FS-M2：ctx 注入 / 输出契约 / 错误映射 / journal D-F12）", () => {
  it("ctx 装配（§3.2）：db 句柄可达、auth 读取器产出、signal 直通、audit 备注并入 journal", async () => {
    const fakeDb = { tag: "fake-db-handle" };
    const reg = new EndpointRegistry();
    let seenSignal: AbortSignal | null = null;
    reg.register(
      defineCommand("chat.send", {
        handler: async (input, ctx) => {
          expect(ctx.name).toBe("chat.send");
          expect(ctx.kind).toBe("command");
          expect(ctx.db).toBe(fakeDb); // db = createHandler 装配注入（无 DI 容器）
          expect(ctx.auth).toEqual({ type: "session", principal: "agent-1" }); // 会话读取器产出
          seenSignal = ctx.signal;
          ctx.audit("写入 messages 表 1 行");
          ctx.audit("失效 key:chat:1");
          return { ok: true };
        },
      })
    );
    const req = new Request("http://local.test/chat.send", { method: "POST", body: JSON.stringify({}) });
    const captured = req.signal; // 无 timeoutMs 声明 → ctx.signal 即 req.signal（Web 标准）
    const res = await reg.createHandler({ db: fakeDb, auth: () => ({ type: "session", principal: "agent-1" }) })(req);
    expect(res.status).toBe(200);
    expect(seenSignal).toBe(captured);
    expect(reg.journal().length).toBe(1);
    expect(reg.journal()[0]).toMatchObject({ name: "chat.send", status: "ok", principal: "agent-1", notes: ["写入 messages 表 1 行", "失效 key:chat:1"] });
  });

  it("未装配 db/auth：ctx.db undefined、ctx.auth null、journal principal=null（诚实呈现）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.free", { handler: (_input, ctx) => ({ db: ctx.db, auth: ctx.auth }) }));
    const res = await post(reg.createHandler(), "q.free", {});
    expect(await res.json()).toEqual({ db: undefined, auth: null });
    const cmdReg = new EndpointRegistry();
    cmdReg.register(defineCommand("cmd.free", { handler: () => ({}) }));
    await post(cmdReg.createHandler(), "cmd.free", {});
    expect(cmdReg.journal()[0].principal).toBe(null);
  });

  it("输出契约违规 → 500 ATR-215（开发者错误，与输入侧 ATR-201 区分；非对象输出同码）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("chat.get", { output: okOutput, handler: () => ({ id: "不是数字" }) as never }));
    const res = await post(reg.createHandler(), "chat.get", {});
    expect(res.status).toBe(500);
    const err = await res.json();
    expect(err.code).toBe("ATR-215");
    expect(err.fix).toContain("chat.get");
    expect(err.fix).toContain("ATR-201"); // fix 显式点破与输入侧的区分

    reg.register(defineQuery("chat.none", { output: okOutput, handler: () => null }));
    const res2 = await post(reg.createHandler(), "chat.none", {});
    expect(res2.status).toBe(500);
    expect((await res2.json()).code).toBe("ATR-215");
  });

  it("输出非 JSON-safe → 500 ATR-216：函数/Symbol/BigInt/循环引用全数拦截；undefined 属性放行", async () => {
    const reg = new EndpointRegistry();
    const cases: Record<string, unknown>[] = [
      { fn: () => 1 },
      { sym: Symbol("x") },
      { big: 1n },
      (() => {
        const c: Record<string, unknown> = { name: "root" };
        c.self = c; // 循环引用
        return c;
      })(),
    ];
    for (const bad of cases) {
      reg.register(defineQuery(`bad.${reg.names().length}`, { handler: () => bad }));
      const res = await post(reg.createHandler(), `bad.${reg.names().length - 1}`, {});
      expect(res.status).toBe(500);
      const err = await res.json();
      expect(err.code).toBe("ATR-216");
      expect(err.message).toContain("$."); // 定位路径随行（fix 指明端点名 + 位置）
    }
    reg.register(defineQuery("bad.ok", { handler: () => ({ fine: 1, skipped: undefined }) }));
    const ok = await post(reg.createHandler(), "bad.ok", {});
    expect(ok.status).toBe(200); // undefined 属性不报（JSON.stringify 本就跳过）
  });

  it("AtrEndpointError 自带 httpStatus → HTTP 映射（401）；未带 → 缺省 422（§3.3）", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand("auth.login", {
        handler: () => {
          throw new AtrEndpointError(endpointError("ATR-340", "会话无效", "重新登录获取会话"), 401);
        },
      })
    );
    reg.register(
      defineCommand("biz.conflict", {
        handler: () => {
          throw new AtrEndpointError(endpointError("ATR-320", "业务冲突", "先解决冲突再提交"));
        },
      })
    );
    const unauth = await post(reg.createHandler(), "auth.login", {});
    expect(unauth.status).toBe(401);
    expect((await unauth.json()).code).toBe("ATR-340");
    const conflict = await post(reg.createHandler(), "biz.conflict", {});
    expect(conflict.status).toBe(422); // 缺省 422：结构化错误才是导航面，HTTP 只是传输层映射
    expect((await conflict.json()).code).toBe("ATR-320");
  });

  it("timeoutMs 超时 → 503 ATR-322（真定时器）；失败 command 入 journal（status/principal/durMs/error）", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand("slow.write", {
        timeoutMs: 25,
        handler: () => new Promise(() => {}), // 挂起不退——分发 race 停等，ATR-322 兜底
      })
    );
    const res = await post(
      reg.createHandler({ auth: () => ({ type: "session", principal: "agent-9" }) }),
      "slow.write",
      {}
    );
    expect(res.status).toBe(503);
    const err = await res.json();
    expect(err.code).toBe("ATR-322");
    expect(err.fix).toContain("timeoutMs");
    const entry = reg.journal()[0];
    expect(entry.status).toBe("failed");
    expect(entry.principal).toBe("agent-9");
    expect(entry.durMs).toBeGreaterThanOrEqual(20); // durMs = handler 耗时（真实测量）
    expect(entry.error?.code).toBe("ATR-322");
  });

  it("失败 command 入 journal（D-F12）：ATR-320 根因、AtrEndpointError 码、audit 备注随行；query 永不入账", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand("boom.cmd", {
        handler: (_input, ctx) => {
          ctx.audit("事务已开但即将回滚");
          throw new Error("内部炸了");
        },
      })
    );
    reg.register(
      defineCommand("denied.cmd", {
        handler: () => {
          throw new AtrEndpointError(endpointError("ATR-341", "权限不足", "提升角色后再试"), 403);
        },
      })
    );
    reg.register(defineQuery("boom.query", { handler: () => { throw new Error("query 炸了"); } }));
    const handler = reg.createHandler({ auth: () => ({ type: "session", principal: "agent-2" }) });
    await post(handler, "boom.cmd", {});
    await post(handler, "denied.cmd", {});
    await post(handler, "boom.query", {});
    expect(reg.journal().length).toBe(2); // query 失败不入账（不变语义）
    const [boom, denied] = reg.journal();
    expect(boom).toMatchObject({ name: "boom.cmd", status: "failed", principal: "agent-2", notes: ["事务已开但即将回滚"] });
    expect(boom.error?.code).toBe("ATR-320");
    expect(boom.error?.message).toContain("内部炸了");
    expect(typeof boom.durMs).toBe("number");
    expect(denied).toMatchObject({ name: "denied.cmd", status: "failed" });
    expect(denied.error?.code).toBe("ATR-341");
  });

  it("prod 旗（__ATELIER_PROD__）：output 校验剥离（违规放行 200）；JSON-safe 保留（对外设防 §3.7）", async () => {
    G.__ATELIER_PROD__ = true;
    try {
      const reg = new EndpointRegistry();
      reg.register(defineQuery("prod.lax", { output: okOutput, handler: () => ({ id: "违规但不校验" }) as never }));
      reg.register(defineQuery("prod.safe", { handler: () => ({ leak: () => 1 }) }));
      const lax = await post(reg.createHandler(), "prod.lax", {});
      expect(lax.status).toBe(200); // prod 剥离输出校验（开发者错误不设在对外边界）
      const safe = await post(reg.createHandler(), "prod.safe", {});
      expect(safe.status).toBe(500); // JSON-safe dev+prod 都启用
      expect((await safe.json()).code).toBe("ATR-216");
    } finally {
      G.__ATELIER_PROD__ = false;
    }
  });

  it("live invalidate / emits 键语法非法 → 注册期 ATR-314（table:/key: 语法，§4.1）", () => {
    const reg = new EndpointRegistry();
    expect(() =>
      reg.register(defineQuery("live.bad", { live: { invalidate: ["messages"] }, handler: () => 1 }))
    ).toThrow(/ATR-314/);
    expect(() =>
      reg.register(defineCommand("cmd.bad", { emits: ["table:messages", "nope"], handler: () => 1 }))
    ).toThrow(/ATR-314/);
    expect(() =>
      reg.register(defineCommand("cmd.worse", { emits: "table:messages" as never, handler: () => 1 }))
    ).toThrow(/ATR-314/); // 非数组声明同码拦截
    // 合法键放行：表级 + 业务键 + live:true 自键
    reg.register(defineQuery("live.good", { live: { invalidate: ["table:messages", "key:chat:1"] }, handler: () => 1 }));
    reg.register(defineCommand("cmd.good", { emits: ["table:messages"], handler: () => 1 }));
    expect(reg.has("live.good")).toBe(true);
  });

  it("EndpointSummary v2 位（MCP 消费位）：hasOutput/invalidateKeys/emits/timeoutMs/idempotent", () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("feed.list", { live: true, output: okOutput, handler: () => 1 }));
    reg.register(
      defineCommand("feed.post", {
        output: okOutput,
        emits: ["table:messages"],
        timeoutMs: 5_000,
        idempotent: true,
        cache: "none",
        handler: () => 1,
      })
    );
    const summaries = reg.list();
    const list = summaries.find((s) => s.name === "feed.list")!;
    expect(list.live).toBe(true); // live:true 摘要位向后兼容
    expect(list.hasOutput).toBe(true);
    expect(list.invalidateKeys).toEqual(["key:feed.list"]); // 自键 = 端点全名（§4.1 向后兼容语义）
    const postSummary = summaries.find((s) => s.name === "feed.post")!;
    expect(postSummary.emits).toEqual(["table:messages"]);
    expect(postSummary.timeoutMs).toBe(5_000);
    expect(postSummary.idempotent).toBe(true);
    expect(postSummary.invalidateKeys).toBeUndefined(); // 非 live 声明 → 无失效键位
  });
});

/* ================= 鉴权拦截（§6.2，FS-M2(m2d) 加法） =================
 * 端点声明 auth: { type }（type !== "none"）→ 分发层自动拦截：
 *   未装配读取器 / 读取结果 null → 401 ATR-340；role 声明与 ctx.auth.role 不符 → 403 ATR-341。
 * auth: { type: "none" } = 显式消警；未声明 auth 的端点行为零变化（readAuth 调用时机/次数不变）。
 */
describe("鉴权拦截（FS-DESIGN §6.2，FS-M2(m2d)：ATR-340/341 + setCookie 透传）", () => {
  it("声明了 auth 但 createHandler 未装配读取器 → 401 ATR-340，fix 指向装配点（装配遗漏与调用方问题分流）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("secret.get", { auth: { type: "session" }, handler: () => 1 }));
    const res = await post(reg.createHandler(), "secret.get", {});
    expect(res.status).toBe(401);
    const err = await res.json();
    expect(err.code).toBe("ATR-340");
    expect(err.message).toContain("未装配 auth 会话读取器");
    expect(err.fix).toContain("createSessionReader");
  });

  it("装配了读取器但会话无效（null）→ 401 ATR-340；会话有效 → 200 且 ctx.auth 直通 handler", async () => {
    const reg = new EndpointRegistry();
    let seen: unknown = null;
    reg.register(defineQuery("secret.get", { auth: { type: "session" }, handler: (_i, ctx) => ((seen = ctx.auth), { ok: true }) }));
    const handler = reg.createHandler({ auth: (req) => (req.headers.get("x-token") === "good" ? { type: "session", principal: "u1" } : null) });
    const denied = await post(handler, "secret.get", {});
    expect(denied.status).toBe(401);
    expect((await denied.json()).code).toBe("ATR-340");
    expect(seen).toBeNull(); // 拦截在 handler 之前——未过门 handler 不执行
    const allowed = await handler(new Request("http://local.test/secret.get", { method: "POST", headers: { "x-token": "good" }, body: "{}" }));
    expect(allowed.status).toBe(200);
    expect(seen).toEqual({ type: "session", principal: "u1" });
  });

  it("role 声明：不匹配 → 403 ATR-341（消息带要求角色与实际角色）；匹配 → 200", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("admin.only", { auth: { type: "session", role: "admin" }, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({
      auth: (req) => {
        const role = req.headers.get("x-role");
        return role ? { type: "session", principal: "u1", role } : null;
      },
    });
    const req = (role: string) => new Request("http://local.test/admin.only", { method: "POST", headers: { "x-role": role }, body: "{}" });
    const forbidden = await handler(req("user"));
    expect(forbidden.status).toBe(403);
    const err = await forbidden.json();
    expect(err.code).toBe("ATR-341");
    expect(err.message).toContain("admin"); // 要求的角色
    expect(err.message).toContain("user"); // 实际角色
    const allowed = await handler(req("admin"));
    expect(allowed.status).toBe(200);
  });

  it('auth: { type: "none" } = 显式消警：无读取器也放行；未声明端点零变化（readAuth 每请求恰一次，时机不变）', async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("public.explicit", { auth: { type: "none" }, handler: () => ({ ok: true }) }));
    reg.register(defineQuery("public.legacy", { handler: () => ({ ok: true }) }));
    let calls = 0;
    const handler = reg.createHandler({
      auth: () => {
        calls++;
        return null;
      },
    });
    expect((await post(handler, "public.explicit", {})).status).toBe(200);
    expect((await post(handler, "public.legacy", {})).status).toBe(200);
    expect(calls).toBe(2); // 每请求一次（ctx 装配路径，与既有行为一致——none/未声明都不在拦截处调用）
  });

  it("setCookie（§6.1 装配语义）：成功响应透传多枚 Set-Cookie；AtrEndpointError 失败路径不携带；非法值（换行）→ handler 抛错路径", async () => {
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand("login.ok", {
        auth: { type: "none" },
        handler: (_i, ctx) => {
          ctx.setCookie?.("a=1; Path=/; HttpOnly");
          ctx.setCookie?.("b=2; Path=/; HttpOnly");
          return { ok: true };
        },
      })
    );
    reg.register(
      defineCommand("login.fail", {
        auth: { type: "none" },
        handler: (_i, ctx) => {
          ctx.setCookie?.("a=1; Path=/");
          throw new AtrEndpointError(endpointError("ATR-340", "登录失败", "核对凭据"), 401);
        },
      })
    );
    const ok = await post(reg.createHandler(), "login.ok", {});
    expect(ok.status).toBe(200);
    const raw = ok.headers.getSetCookie ? ok.headers.getSetCookie() : [ok.headers.get("set-cookie") ?? ""];
    expect(raw).toHaveLength(2); // Headers.append：多枚 set-cookie 独立承载
    expect(raw.some((c) => c.startsWith("a=1"))).toBe(true);
    expect(raw.some((c) => c.startsWith("b=2"))).toBe(true);
    const fail = await post(reg.createHandler(), "login.fail", {});
    expect(fail.status).toBe(401);
    expect(fail.headers.get("set-cookie")).toBeNull(); // 登录失败不种 cookie
    reg.register(
      defineCommand("cookie.bad", {
        auth: { type: "none" },
        handler: (_i, ctx) => {
          ctx.setCookie?.("bad=1\r\nX-Inject: 1"); // 头注入面
          return { ok: true };
        },
      })
    );
    const injected = await post(reg.createHandler(), "cookie.bad", {});
    expect(injected.status).toBe(500); // 开发者传值护栏 → handler 抛错路径（ATR-320 兜底）
  });

  it("journal/summary 联动：拦截端点成功入账 principal；summary 暴露 authType + authRole（MCP 消费位）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineCommand("doc.write", { auth: { type: "session", role: "editor" }, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ auth: () => ({ type: "session", principal: "agent-7", role: "editor" }) });
    await post(handler, "doc.write", {});
    expect(reg.journal()[0]).toMatchObject({ name: "doc.write", status: "ok", principal: "agent-7" });
    const summary = reg.list().find((s) => s.name === "doc.write")!;
    expect(summary.authType).toBe("session");
    expect(summary.authRole).toBe("editor");
  });
});

/* ================= journal 敏感键脱敏（P1-6：写入单源 journalPush 收口） =================
 * EndpointJournalEntry.input 记录完整输入对象（成功与失败条目同记），并经 GET /__atelier/server-status
 * 全量吐出（introspect.ts）——auth.login 的密码明文由此进入 review 页/MCP 工具整条消费链。
 * 修在 journal 写入单源（registry.journalPush 窄口，POST 分发与 live 引擎 ATR-321 失败条目同源）：
 * 递归敏感键脱敏——键名含 password/secret/token/authorization 等词根（不区分大小写）→ 值替换 "[redacted]"。
 */
describe("journal 敏感键脱敏（P1-6：分发层源头收口，server-status/review/MCP 消费面同受保护）", () => {
  it("红检：含 password 的 command 成功与失败两条，journal 条目不含明文密码；非敏感字段与键结构照常（回归）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineCommand("auth.login", { handler: (input) => ({ ok: true, user: (input as { username?: string }).username }) }));
    reg.register(
      defineCommand("boom.cmd", {
        handler: () => {
          throw new Error("内部炸了");
        },
      })
    );
    const handler = reg.createHandler();
    await post(handler, "auth.login", { username: "alice", password: "s3cret-pw-1", remember: true });
    await post(handler, "boom.cmd", { username: "bob", password: "s3cret-pw-2", meta: { apiKey: "key-xyz", retries: 3, tags: ["a"] } });

    expect(reg.journal().length).toBe(2);
    const [okEntry, failEntry] = reg.journal();
    // 成功条目：敏感键 → 占位，非敏感键照常
    expect(okEntry.status).toBe("ok");
    expect(okEntry.input).toEqual({ username: "alice", password: "[redacted]", remember: true });
    // 失败条目同记同脱敏；嵌套对象递归
    expect(failEntry.status).toBe("failed");
    expect(failEntry.input).toEqual({ username: "bob", password: "[redacted]", meta: { apiKey: "[redacted]", retries: 3, tags: ["a"] } });
    // 明文断言：整份 journal 序列化后不含任何明文敏感值
    const dump = JSON.stringify(reg.journal());
    expect(dump).not.toContain("s3cret-pw-1");
    expect(dump).not.toContain("s3cret-pw-2");
    expect(dump).not.toContain("key-xyz");
  });

  it("脱敏面：键名不区分大小写、词根命中（token/authorization/PASSWORD）即替换；数组内对象同脱敏；无敏感键输入原形状（回归）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineCommand("sweep.cmd", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    await post(handler, "sweep.cmd", {
      Password: "pw-upper",
      accessToken: "tok-1",
      AUTHORIZATION: "Bearer x",
      api_key: "k-1",
      identity: { Secret: "s-1", nested: [{ token: "t-2" }] },
      plain: { note: "普通调试信息", nums: [1, 2] },
    });
    expect(reg.journal()[0].input).toEqual({
      Password: "[redacted]",
      accessToken: "[redacted]",
      AUTHORIZATION: "[redacted]",
      api_key: "[redacted]",
      identity: { Secret: "[redacted]", nested: [{ token: "[redacted]" }] },
      plain: { note: "普通调试信息", nums: [1, 2] }, // 非敏感结构原形状照常（排查可用）
    });
  });
});
