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
