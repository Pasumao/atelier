/**
 * email.test.ts — B3 email 适配边界（2026-09-28 差距批；决策 31：显式 transport 接口 +
 * 内建可验证的投递记账——框架不内建真实发送（SMTP/Resend/SES 一律应用自接），内建唯一
 * transport = mock（零 IO 恒成功、dev/prod 同语义可审计）。依据
 * docs/research/2026-09-28-fullstack-feature-gap.md §3-B3 与 FS-DESIGN §5.8 落地注记。
 *
 * 断言面（全部以实现契约为准）：
 *   ① mock send → 记账行六事实（transport/to/subject/payload/status=ok）+ tail 读回
 *      （payload 只收在场字段：from/cc?/bcc?/text?/html?）；
 *   ② 缺省 transport = mock（createEmailRecorder 不传 transport = 零发送落账可审计）；
 *   ③ failing transport → send **不抛**（resolve { id, status: "failed", error }）+ 记账 failed
 *      行带 error 摘要——用例钉死语义：投递失败是记账事实不是异常，调用方拿 status 自行决定；
 *   ④ 记账本身失败（坏句柄）→ send 原样上抛（不可记账 ≠ 假账，诚实暴露——与 journal 落库
 *      console.warn 降级的差异见 email.ts 头注：记账是 send 返回值的组成部分）；
 *   ⑤ ctx.email 端点内 send 端到端（记账行落 ctx.db 同连接的库）；未装配 = ctx.email 缺位（诚实呈现）；
 *   ⑥ tx 内 send（mock）→ 业务写 + 记账行同事务提交；tx 抛错两者齐回滚（mock 零外部 IO = 完全原子）；
 *   ⑦ maxRows 行数基裁剪（缺省 1 万，写时惰性裁最老——决策 29 同款；常量钉死）；
 *   ⑧ payload 脱敏：W2 词根单源复用（endpoints.ts redactSensitiveInput 同一词根表——journal input
 *      与 email payload 同源受保护，持久层不二次实现脱敏）；
 *   ⑨ 列形状镜像钉：id/ts/transport/to/subject/payload/status/error（"to" = SQLite 保留字，
 *      DDL/查询恒双引号——红检前实证：裸 to 报 syntax error）；
 *   ⑩ error 摘要截断（2048 上限，恒合法字符串不落半截）；
 *   ⑪ introspect email 段两态：装配 = 尾部 ~20 条六字段投影（id/ts(ISO)/transport/to/subject/status，
 *      不含 payload/error——调试面最小呈现）；未装配 = 段整体缺省（零假数据）。
 *
 * skip 策略：宿主无 node:sqlite → 整组诚实 skip（jobs.test.ts 同款 guard）。
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmailRecorder, mockTransport, DEFAULT_EMAIL_LOG_MAX_ROWS, type EmailTransport, type OutgoingEmail } from "../server/email";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { defineCommand, defineQuery, EndpointRegistry } from "../server/endpoints";
import { serverStatusSnapshot } from "../server/introspect";

/** 物理表名钉死（字面量而非框架常量 import——形状测试钉的是库内实体，不随单源改名漂移） */
const EMAIL_LOG_TABLE = "atelier_email_log";

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用（jobs.test.ts 同款 skip-guard）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

const tmpDirs: string[] = [];
const openDbs: SqliteDb[] = [];
afterEach(() => {
  while (openDbs.length > 0) {
    try {
      openDbs.pop()!.close();
    } catch {
      /* 重复 close 幂等跳过 */
    }
  }
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

async function memoryDb(): Promise<SqliteDb> {
  const db = await openSqlite(":memory:");
  openDbs.push(db);
  return db;
}

function emailRows(db: SqliteDb): { id: number; ts: number; transport: string; to: string; subject: string; payload: string | null; status: string; error: string | null }[] {
  return db.prepare(`SELECT id, ts, transport, "to" AS to_addr, subject, payload, status, error FROM ${EMAIL_LOG_TABLE} ORDER BY id`).all() as never;
}

function tableExists(db: SqliteDb): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(EMAIL_LOG_TABLE) !== undefined;
}

describeSqlite("B3 email 记账：mock send / 缺省 transport / tail 读回", () => {
  it("mock send → 记账行六事实（transport/to/subject/payload/status=ok）+ tail 读回（payload 只收在场字段）+ send 返回 id 与行对齐", async () => {
    const db = await memoryDb();
    const recorder = createEmailRecorder({ db, transport: mockTransport() });
    const r = await recorder.send({ to: "agent@example.com", subject: "欢迎", from: "noreply@example.com", text: "你好", html: "<p>你好</p>" });
    expect(r.status).toBe("ok");
    expect(r.error).toBeUndefined();

    const rows = emailRows(db);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.transport).toBe("mock"); // transport 自报名进记账列
    expect(row.to).toBe("agent@example.com");
    expect(row.subject).toBe("欢迎");
    expect(row.status).toBe("ok");
    expect(row.error).toBeNull();
    expect(Number.isFinite(row.ts)).toBe(true); // ts = ms epoch
    const payload = JSON.parse(row.payload!) as Record<string, unknown>;
    expect(payload).toEqual({ from: "noreply@example.com", text: "你好", html: "<p>你好</p>" }); // 可选字段缺省不落 null 键

    const tail = recorder.tail(10);
    expect(tail).toHaveLength(1);
    expect(tail[0]).toMatchObject({ id: r.id, transport: "mock", to: "agent@example.com", subject: "欢迎", status: "ok" });
    expect(typeof tail[0]!.ts).toBe("string"); // tail 读回 ts = ISO（journal 条目同款人/agent 可读形态）
    expect(Number.isNaN(Date.parse(tail[0]!.ts))).toBe(false);
    expect(tail[0]!.payload).toEqual({ from: "noreply@example.com", text: "你好", html: "<p>你好</p>" }); // JSON round-trip

    // 可选字段全缺省：payload 收窄为在场字段（无 from/cc/bcc/text/html 键不虚构）
    await recorder.send({ to: "b@example.com", subject: "s" });
    const second = JSON.parse(emailRows(db)[1]!.payload!) as Record<string, unknown>;
    expect(second).toEqual({});
  });

  it("缺省 transport = mock：不传 transport 仍零发送落账（内建唯一 transport 纪律）", async () => {
    const db = await memoryDb();
    const recorder = createEmailRecorder({ db });
    const r = await recorder.send({ to: "x@example.com", subject: "缺省 mock" });
    expect(r.status).toBe("ok");
    expect(emailRows(db)[0]!.transport).toBe("mock");
    expect(tableExists(db)).toBe(true);
  });
});

describeSqlite("B3 email send 失败语义：不抛 + failed 记账 / 记账失败上抛", () => {
  it("failing transport → send 不抛（resolve {id, status:'failed', error}）+ 记账 failed 行带 error 摘要——投递失败是记账事实不是异常", async () => {
    const db = await memoryDb();
    const failing: EmailTransport = {
      name: "failing-probe",
      send(_msg: OutgoingEmail) {
        throw new Error("SMTP 连接被拒（probe）");
      },
    };
    const recorder = createEmailRecorder({ db, transport: failing });
    // 语义钉死：不抛——调用方拿 status 自行决定重试/告警
    const r = await recorder.send({ to: "y@example.com", subject: "会失败" });
    expect(r.status).toBe("failed");
    expect(r.error).toContain("SMTP 连接被拒");
    expect(r.id).toBeGreaterThan(0);

    const row = emailRows(db)[0]!;
    expect(row.status).toBe("failed"); // 失败两态也入账（成功/失败都记）
    expect(row.transport).toBe("failing-probe");
    expect(row.to).toBe("y@example.com");
    expect(row.subject).toBe("会失败");
    expect(row.error).toContain("SMTP 连接被拒"); // error 摘要落库可查
    expect(recorder.tail(10)[0]!.status).toBe("failed");

    // async transport 的 rejection 同语义（Promise 拒绝路径与同步抛错同收口）
    const asyncFailing: EmailTransport = {
      name: "async-failing",
      send: async () => {
        throw new Error("Resend 429");
      },
    };
    const recorder2 = createEmailRecorder({ db, transport: asyncFailing });
    const r2 = await recorder2.send({ to: "z@example.com", subject: "async 失败" });
    expect(r2.status).toBe("failed");
    expect(r2.error).toContain("Resend 429");
  });

  it("记账本身失败（坏句柄）→ send 原样上抛：不可记账 ≠ 假账（与 journal 落库降级 warn 的有意差异）", async () => {
    const badDb = { exec: () => { throw new Error("simulated db failure"); }, prepare: () => { throw new Error("simulated db failure"); } } as unknown as SqliteDb;
    const recorder = createEmailRecorder({ db: badDb });
    await expect(recorder.send({ to: "a@example.com", subject: "s" })).rejects.toThrow("simulated db failure");
  });
});

describeSqlite("B3 ctx 集成：ctx.email 端到端 / 未装配缺位 / tx 原子", () => {
  it("ctx.email：端点内 send 端到端（记账行落 ctx.db 同连接）；未装配 = ctx.email undefined（诚实缺位）", async () => {
    const db = await memoryDb();
    const recorder = createEmailRecorder({ db });
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand<{ to: string; subject: string }, { id: number; status: string }, SqliteDb>("mail.send", {
        handler: async (input, ctx) => {
          expect(ctx.email).toBeDefined();
          const r = await ctx.email!.send({ to: input.to, subject: input.subject, text: "端点内发送" });
          return { id: r.id, status: r.status };
        },
      })
    );
    reg.register(defineQuery("ctx.free", { handler: (_i, ctx) => ({ email: ctx.email }) }));
    const bare = await reg.createHandler({ db })(new Request("http://local.test/ctx.free", { method: "POST", body: "{}" }));
    expect(await bare.json()).toEqual({ email: undefined }); // 未装配 = 不存在（jobs/kv 同款诚实呈现）

    const res = await reg.createHandler({ db, email: recorder })(new Request("http://local.test/mail.send", { method: "POST", body: JSON.stringify({ to: "u@example.com", subject: "ctx 直通" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: expect.any(Number), status: "ok" });
    const row = emailRows(db)[0]!;
    expect(row).toMatchObject({ transport: "mock", to: "u@example.com", subject: "ctx 直通", status: "ok" });
  });

  it("tx 内 send（mock）→ 业务写 + 记账行同事务提交（mock 零外部 IO = 完全原子）", async () => {
    const db = await memoryDb();
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    const recorder = createEmailRecorder({ db });
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand<{ body: string }, { id: number }, SqliteDb>("note.add", {
        handler: async (input, ctx) => {
          let id = 0;
          await ctx.db.tx(() => {
            id = Number(ctx.db.prepare("INSERT INTO notes (body) VALUES (?)").run(input.body).lastInsertRowid);
            return ctx.email!.send({ to: "u@example.com", subject: `笔记 ${id}`, text: input.body });
          });
          return { id };
        },
      })
    );
    const res = await reg.createHandler({ db, email: recorder })(new Request("http://local.test/note.add", { method: "POST", body: JSON.stringify({ body: "hi" }) }));
    expect(res.status).toBe(200);
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n)).toBe(1); // 业务写在
    expect(emailRows(db)).toHaveLength(1); // 记账行同事务提交
    expect(emailRows(db)[0]!.subject).toBe("笔记 1");
  });

  it("tx 抛错 → 业务写 + 记账行齐回滚（mock 无外部 IO 可回滚；真实 transport 无分布式事务=诚实边界）", async () => {
    const db = await memoryDb();
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    const recorder = createEmailRecorder({ db });
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand<{ body: string; boom: boolean }, { id: number }, SqliteDb>("note.add", {
        handler: async (input, ctx) => {
          let id = 0;
          await ctx.db.tx(async () => {
            id = Number(ctx.db.prepare("INSERT INTO notes (body) VALUES (?)").run(input.body).lastInsertRowid);
            await ctx.email!.send({ to: "u@example.com", subject: `笔记 ${id}`, text: input.body });
            if (input.boom) throw new Error("业务炸点——整体回滚");
          });
          return { id };
        },
      })
    );
    const call = (body: Record<string, unknown>): Promise<Response> =>
      reg.createHandler({ db, email: recorder })(new Request("http://local.test/note.add", { method: "POST", body: JSON.stringify(body) }));
    const boom = await call({ body: "x", boom: true });
    expect(boom.status).toBe(500); // 业务异常（ATR-320 域）
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n)).toBe(0); // 业务写回滚
    expect(emailRows(db)).toHaveLength(0); // 记账行随 tx 回滚——绝无孤儿账
  });
});

describeSqlite("B3 记账表面：maxRows 裁剪 / payload 脱敏 / 列形状 / error 截断", () => {
  it("maxRows 行数基裁剪：超限后最老行消失、总量 ≤ maxRows、近期条目完好；缺省常量 1 万（决策 29 同款）", async () => {
    expect(DEFAULT_EMAIL_LOG_MAX_ROWS).toBe(10_000);
    const db = await memoryDb();
    const recorder = createEmailRecorder({ db, maxRows: 3 });
    for (let n = 1; n <= 5; n++) await recorder.send({ to: `u${n}@example.com`, subject: `第 ${n} 封` });
    const rows = emailRows(db);
    expect(rows).toHaveLength(3); // 总量 ≤ maxRows
    expect(rows.map((r) => r.subject)).toEqual(["第 3 封", "第 4 封", "第 5 封"]); // 最老两行消失（追加序）
    expect(recorder.tail(10).map((e) => e.subject)).toEqual(["第 3 封", "第 4 封", "第 5 封"]);
  });

  it("payload 脱敏（W2 词根单源复用）：嵌套敏感键 → \"[redacted]\"，非敏感键原样", async () => {
    const db = await memoryDb();
    const recorder = createEmailRecorder({ db });
    // JS 侧调用方可能把对象塞进 text/cc（类型面之外）——脱敏按 W2 词根递归兜底（与 journal input 同一收口）
    const msg = {
      to: "u@example.com",
      subject: "带敏感字段的投递",
      from: "noreply@example.com",
      text: { intro: "正文", password: "明文密码", smtpToken: "tok-1" },
      cc: [{ apiKey: "sk-1", addr: "a@example.com" }],
    } as unknown as OutgoingEmail;
    await recorder.send(msg);
    const payload = JSON.parse(emailRows(db)[0]!.payload!) as Record<string, unknown>;
    const text = payload.text as Record<string, unknown>;
    expect(text.password).toBe("[redacted]");
    expect(text.smtpToken).toBe("[redacted]");
    expect(text.intro).toBe("正文"); // 非敏感键原样保留（排查可用）
    const cc0 = (payload.cc as Record<string, unknown>[])[0]!;
    expect(cc0.apiKey).toBe("[redacted]");
    expect(cc0.addr).toBe("a@example.com");
    expect(payload.from).toBe("noreply@example.com"); // from 非敏感词根不误伤
    expect(JSON.stringify(payload)).not.toContain("明文密码");
  });

  it("列形状镜像钉：id/ts/transport/to/subject/payload/status/error（\"to\" = SQLite 保留字恒双引号）", async () => {
    const db = await memoryDb();
    const recorder = createEmailRecorder({ db });
    await recorder.send({ to: "u@example.com", subject: "形状钉" });
    const columns = db.prepare(`PRAGMA table_info(${EMAIL_LOG_TABLE})`).all() as { name: string; notnull: number; pk: number }[];
    expect(columns.map((c) => c.name)).toEqual(["id", "ts", "transport", "to", "subject", "payload", "status", "error"]);
    expect(columns.find((c) => c.name === "status")!.notnull).toBe(1); // CHECK(status IN ('ok','failed'))
    expect(columns.find((c) => c.name === "id")!.pk).toBe(1);
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(EMAIL_LOG_TABLE) as { sql: string }).sql;
    expect(sql).toContain("AUTOINCREMENT");
    expect(sql).toContain("CHECK(status IN ('ok','failed'))");
    // 框架自管表：不进应用迁移序列——atelier_migrations 状态表未建 = 迁移序列零感知（journal 同款断言）
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atelier_migrations'").get()).toBeUndefined();
  });

  it("error 摘要截断（2048 上限）：超长 transport 错误不落全量（恒合法字符串，不落半截 JSON）", async () => {
    const db = await memoryDb();
    const failing: EmailTransport = {
      name: "noisy",
      send() {
        throw new Error("E".repeat(10_000));
      },
    };
    const recorder = createEmailRecorder({ db, transport: failing });
    const r = await recorder.send({ to: "u@example.com", subject: "长错误" });
    expect(r.status).toBe("failed");
    expect(r.error!.length).toBeLessThanOrEqual(2048);
    expect(emailRows(db)[0]!.error!.length).toBeLessThanOrEqual(2048);
  });
});

describeSqlite("B3 内省：server-status email 段两态（装配 / 未装配，零假数据）", () => {
  it("装配 = 尾部 ~20 条六字段投影（id/ts/transport/to/subject/status，不含 payload/error）；未装配 = 段整体缺省", async () => {
    const db = await memoryDb();
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.plain", { handler: () => ({ ok: true }) }));
    const recorder = createEmailRecorder({ db });
    for (let n = 1; n <= 3; n++) await recorder.send({ to: `u${n}@example.com`, subject: `第 ${n} 封`, text: "x" });
    const withEmail = serverStatusSnapshot(reg, { db, email: recorder });
    expect(Array.isArray(withEmail.email)).toBe(true);
    const entries = withEmail.email as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3); // 尾部投影（未超 20 全量呈现）
    expect(entries.map((e) => e.subject)).toEqual(["第 1 封", "第 2 封", "第 3 封"]); // 入账序
    expect(entries[0]).toMatchObject({ id: expect.any(Number), transport: "mock", to: "u1@example.com", status: "ok" });
    expect(typeof entries[0]!.ts).toBe("string"); // ts = ISO
    expect(Object.keys(entries[0]!).sort()).toEqual(["id", "status", "subject", "to", "transport", "ts"]); // 恰六字段（不含 payload/error）
    // 装配但零投递：段如实空数组（真实事实，非假数据）
    const emptyDb = await memoryDb();
    const emptyRecorder = createEmailRecorder({ db: emptyDb });
    const noSend = serverStatusSnapshot(reg, { db: emptyDb, email: emptyRecorder });
    expect(noSend.email).toEqual([]);

    const withoutEmail = serverStatusSnapshot(reg, { db }); // 未装配：段整体缺省（零假数据）
    expect("email" in withoutEmail).toBe(false);
  });
});
