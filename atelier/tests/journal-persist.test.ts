/**
 * journal-persist.test.ts — command journal 持久化（B5 差距批，决策 29：追加事件表
 * atelier_command_journal，atelier_migration_journal 同款模式——追加式 / 惰性建表 /
 * 框架自管不进应用迁移序列 / 一行 = 一次事件非当前态）。
 *
 * 为什么进程内测试钉得住：重启不灭 = 同一库文件先后起两个 handler 实例（A 写 → close →
 * B 起），server-status journal 段仍见 A 的条目——introspect 读路径（有持久表读库尾部 N 条，
 * 无表/无 db 回落内存环形）的端到端证据链；journal-subprocess.test.ts 是它的真实子进程镜像。
 *
 * 断言面（全部以实现契约为准）：
 *   ① 重启不灭（核心）：A 实例 command 入账落库 → 释放 → B 实例同库文件起 → 快照 journal 段
 *      仍见 A 的条目（改前现状 = 内存环形重启清零，本用例红检转绿）；
 *   ② 形状兼容（红线）：库尾投影条目与内存条目字段逐一对照——ts(ISO)/name/kind/input/
 *      status/principal/durMs/notes?/error?（error 四段式 code/message/fix 可结构化消费；
 *      ok 条目无 error 位、失败条目无 notes 位——非空才携带同内存形状）；
 *   ③ 两态入账 + query 永不入账不变（表恰两行 ok/failed，query 调用后行数不动）；
 *   ④ payload 脱敏后落库（W2 词根同款：password/api_key/accessToken → "[redacted]"，非敏感键
 *      原样——复用 journalPush 单源脱敏产物，持久层不二次实现）；
 *   ⑤ persist:false 显式关闭 → 零落库（表都不建）且内存环形照常；无 db 同样纯内存现状零变化；
 *   ⑥ maxRows 行数基裁剪（缺省 1 万）：超限后最老行消失、总量 ≤ maxRows、近期条目完好；
 *   ⑦ 落库失败降级：坏句柄注入 → command 响应仍 2xx + console.warn + 内存环形照常（审计不挡业务）；
 *   ⑧ error 列截断：超 2KB 失败摘要降级为 code + 截断 message（JSON 恒合法，不落半截串）；
 *   ⑨ 列形状镜像钉：id/ts/endpoint/principal/dur_ms/status/payload/error/notes（notes 列 =
 *      内存条目 notes 位的持久镜像——introspect 形状兼容红线的载体，见模块头注）；
 *   ⑩ 收槽先于入账：持久化 INSERT 不混入本 command 的自动失效键（写捕获槽顺序注记，
 *      endpoints.ts/sqlite.ts/command-journal.ts 三处注释互指）。
 *
 * 诚实边界：live 引擎的 query 重算失败条目（ATR-321）是诊断非命令审计，持久层只收 command
 * 条目（留在内存环形）；notes 不持久化则 introspect 形状兼容破缺（journal-subprocess ①钉
 * ctx.audit 随行）——故列形状在任务 8 列草图上多一列 notes TEXT，其余逐列一致。
 * skip 策略：宿主无 node:sqlite → 整组诚实 skip（migrate.test.ts 同款 guard）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { defineCommand, defineQuery, EndpointRegistry } from "../server/endpoints";
import { INTROSPECT_NAME, serverStatusSnapshot } from "../server/introspect";

/** 物理表名钉死（字面量而非框架常量 import——形状测试钉的是库内实体，不随单源改名漂移） */
const COMMAND_JOURNAL_TABLE = "atelier_command_journal";

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用（migrate.test.ts 同款 skip-guard）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-journal-persist-"));
  tmpDirs.push(dir);
  return path.join(dir, "journal.db");
}

function post(handler: (req: Request) => Promise<Response>, name: string, body: unknown): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", body: JSON.stringify(body) }));
}

async function getStatus(handler: (req: Request) => Promise<Response>): Promise<{ journal: any[] }> {
  const res = await handler(new Request(`http://local.test/${INTROSPECT_NAME}`, { method: "GET" }));
  expect(res.status).toBe(200);
  return (await res.json()) as { journal: any[] };
}

function journalRows(db: SqliteDb): { id: number; endpoint: string; status: string; payload: string | null; error: string | null; notes: string | null }[] {
  return db.prepare(`SELECT id, endpoint, status, payload, error, notes FROM ${COMMAND_JOURNAL_TABLE} ORDER BY id`).all() as never;
}

function tableExists(db: SqliteDb): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(COMMAND_JOURNAL_TABLE) !== undefined;
}

describeSqlite("command journal 持久化（B5 差距批，决策 29：追加事件表，重启不灭）", () => {
  it("红检核心：重启不灭——handler A 写 command → 释放 → handler B（新实例同库文件）起 → server-status journal 段仍见 A 的条目", async () => {
    const file = makeDbFile();
    const regA = new EndpointRegistry();
    regA.register(defineCommand("note.write", { handler: async (input: { text: string }) => ({ echoed: input.text }) }));
    const dbA = await openSqlite(file);
    const handlerA = regA.createHandler({ db: dbA });
    const put = await post(handlerA, "note.write", { text: " survive restart" });
    expect(put.status).toBe(200);
    dbA.close(); // 释放 A（重启语义 = 新实例新句柄）

    const regB = new EndpointRegistry();
    regB.register(defineCommand("note.write", { handler: async (input: { text: string }) => ({ echoed: input.text }) }));
    const dbB = await openSqlite(file);
    const handlerB = regB.createHandler({ db: dbB });
    const snap = await getStatus(handlerB);
    expect(snap.journal).toHaveLength(1); // 改前现状：内存环形重启清零 → []（红）
    expect(snap.journal[0]).toMatchObject({ name: "note.write", kind: "command", status: "ok", input: { text: " survive restart" } });
    dbB.close();
  });

  it("introspect journal 段形状兼容（红线）：库尾投影条目与内存条目字段逐一对照——ts/name/kind/input/status/principal/durMs/notes?/error?", async () => {
    const file = makeDbFile();
    const regA = new EndpointRegistry();
    regA.register(
      defineCommand("audit.write", {
        handler: async (input: { n: number }, ctx) => {
          ctx.audit("写入 audit 表 1 行");
          return { ok: true };
        },
      })
    );
    regA.register(
      defineCommand("audit.explode", {
        handler: async () => {
          throw new Error("persist probe 故意炸");
        },
      })
    );
    const dbA = await openSqlite(file);
    const handlerA = regA.createHandler({ db: dbA });
    expect((await post(handlerA, "audit.write", { n: 1 })).status).toBe(200);
    expect((await post(handlerA, "audit.explode", { n: 2 })).status).toBe(500);
    dbA.close();

    // 新实例读库尾（持久行的投影形状 = 被钉对象；内存环形为空 → 段内容只能来自库）
    const regB = new EndpointRegistry();
    const dbB = await openSqlite(file);
    const snap = serverStatusSnapshot(regB, { db: dbB });
    const j = snap.journal as Record<string, unknown>[];
    expect(j).toHaveLength(2);
    expect(j.map((e) => e.name)).toEqual(["audit.write", "audit.explode"]); // 追加序 = 入账序（内存环形同口径）

    const okEntry = j[0];
    expect(typeof okEntry.ts).toBe("string"); // 内存条目 ts = ISO 串——库内 ms 投影回 ISO
    expect(Number.isNaN(Date.parse(String(okEntry.ts)))).toBe(false);
    expect(okEntry).toMatchObject({
      name: "audit.write",
      kind: "command", // 表只收 command——投影恒 "command"（内存条目 kind 位同源）
      status: "ok",
      input: { n: 1 }, // payload 列 JSON.parse 回 input 位
      principal: null, // 无 auth 装配 → 如实 null
    });
    expect(typeof okEntry.durMs).toBe("number");
    expect(okEntry.durMs).toBeGreaterThanOrEqual(0);
    expect(okEntry.notes).toEqual(["写入 audit 表 1 行"]); // notes 列镜像 ctx.audit（journal-subprocess ① 同款钉）
    expect(okEntry.error).toBeUndefined(); // 成功条目无 error 位（非空才携带——内存形状同款）

    const failEntry = j[1];
    expect(failEntry).toMatchObject({ name: "audit.explode", kind: "command", status: "failed", input: { n: 2 }, principal: null });
    expect((failEntry.error as { code: string }).code).toBe("ATR-320");
    expect((failEntry.error as { message: string }).message).toContain("persist probe 故意炸");
    expect((failEntry.error as { fix: string }).fix).toContain("audit.explode"); // 四段式 fix 随行可结构化消费
    expect(failEntry.notes).toBeUndefined(); // 失败路径无 audit 即无键（非空才携带）
    dbB.close();
  });

  it("command 成功/失败条目落库两态（payload/error JSON 列）；query 永不入账不变", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    reg.register(defineCommand("chat.send", { handler: async (input: { id: number }) => ({ id: input.id }) }));
    reg.register(
      defineCommand("chat.boom", {
        handler: async () => {
          throw new Error("boom probe");
        },
      })
    );
    reg.register(defineQuery("chat.peek", { handler: async () => ({ ok: true }) }));
    const handler = reg.createHandler({ db });
    expect((await post(handler, "chat.send", { id: 5 })).status).toBe(200);
    expect((await post(handler, "chat.boom", { id: 6 })).status).toBe(500);
    expect((await post(handler, "chat.peek", {})).status).toBe(200); // query：不入账语义不变

    const rows = journalRows(db);
    expect(rows).toHaveLength(2); // query 调用后行数不动（负例钉住）
    expect(rows.map((r) => [r.endpoint, r.status])).toEqual([
      ["chat.send", "ok"],
      ["chat.boom", "failed"],
    ]);
    expect(JSON.parse(rows[0]!.payload!)).toEqual({ id: 5 }); // payload = 脱敏后 input JSON
    expect(rows[0]!.error).toBeNull(); // 成功条目无 error
    const err = JSON.parse(rows[1]!.error!);
    expect(err.code).toBe("ATR-320");
    expect(err.message).toContain("boom probe");
    // 内存环形照常（增益层不是替代——现状零变化）
    expect(reg.journal().map((e) => e.status)).toEqual(["ok", "failed"]);
    db.close();
  });

  it("payload 脱敏后落库（W2 词根同款：password/api_key/accessToken → \"[redacted]\"，非敏感键原样）", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    reg.register(defineCommand("auth.probe", { handler: async (input: { user: string }) => ({ ok: true, user: input.user }) }));
    const handler = reg.createHandler({ db });
    expect(
      (await post(handler, "auth.probe", { user: "u1", password: "明文密码", api_key: "sk-123", accessToken: "tok-1", memo: "普通字段" })).status
    ).toBe(200);
    const row = journalRows(db)[0]!;
    const payload = JSON.parse(row.payload!) as Record<string, unknown>;
    expect(payload.password).toBe("[redacted]"); // W2 递归脱敏单源产物直落库（持久层不二次实现）
    expect(payload.api_key).toBe("[redacted]");
    expect(payload.accessToken).toBe("[redacted]");
    expect(payload.user).toBe("u1"); // 非敏感键原样保留（排查可用）
    expect(payload.memo).toBe("普通字段");
    expect(JSON.stringify(row)).not.toContain("明文密码");
    db.close();
  });

  it("persist:false 显式关闭 → 零落库（表都不建）且内存环形照常；无 db 同样纯内存现状零变化", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    reg.register(defineCommand("note.write", { handler: async () => ({ ok: true }) }));
    const handler = reg.createHandler({ db, journal: { persist: false } }); // 显式关闭（红线用例）
    expect((await post(handler, "note.write", {})).status).toBe(200);
    expect(tableExists(db)).toBe(false); // 零落库：连惰性建表都不发生
    expect(reg.journal()).toHaveLength(1); // 内存环形照常

    const regNoDb = new EndpointRegistry();
    regNoDb.register(defineCommand("note.write", { handler: async () => ({ ok: true }) }));
    const handlerNoDb = regNoDb.createHandler({}); // 无 db：恒内存环形（现状零变化）
    expect((await post(handlerNoDb, "note.write", {})).status).toBe(200);
    expect(regNoDb.journal()).toHaveLength(1);
    db.close();
  });

  it("maxRows 行数基裁剪（缺省 1 万）：超限后最老行消失、总量 ≤ maxRows、近期条目完好", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    reg.register(defineCommand("tick.run", { handler: async (input: { n: number }) => ({ n: input.n }) }));
    const handler = reg.createHandler({ db, journal: { maxRows: 3 } });
    for (let n = 1; n <= 5; n++) expect((await post(handler, "tick.run", { n })).status).toBe(200);

    const rows = journalRows(db);
    expect(rows).toHaveLength(3); // 总量 ≤ maxRows
    expect(rows.map((r) => JSON.parse(r.payload!).n)).toEqual([3, 4, 5]); // 最老两行消失，近期条目完好（追加序）
    const snap = serverStatusSnapshot(reg, { db });
    expect((snap.journal as unknown[]).length).toBe(3); // introspect 尾部同步有界
    expect((snap.journal as { input: { n: number } }[]).map((e) => e.input.n)).toEqual([3, 4, 5]);
    db.close();
  });

  it("journal 落库失败降级：坏句柄注入 → command 响应仍 2xx + console.warn + 内存环形照常（审计不挡业务）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const badDb = { exec: () => { throw new Error("simulated db failure"); } }; // 坏句柄（惰性建表即炸）
    const reg = new EndpointRegistry();
    reg.register(defineCommand("note.write", { handler: async () => ({ ok: true }) }));
    const handler = reg.createHandler({ db: badDb }); // db 已装配 → persist 缺省 true
    const res = await post(handler, "note.write", {});
    expect(res.status).toBe(200); // 落库失败不反噬 command 响应
    expect(await res.json()).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledTimes(1); // 降级可见（console.warn 诚实边界）
    expect(String(warn.mock.calls[0]?.[0])).toContain("command journal 落库失败");
    expect(reg.journal()).toHaveLength(1); // 内存环形照常——审计不丢，只是不持久
  });

  it("error 列截断：超 2KB 失败摘要降级为 code + 截断 message（JSON 恒合法，不落半截串）", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand("big.boom", {
        handler: async () => {
          throw new Error("X".repeat(10_000));
        },
      })
    );
    const handler = reg.createHandler({ db });
    expect((await post(handler, "big.boom", {})).status).toBe(500);
    const row = journalRows(db)[0]!;
    expect(row.error!.length).toBeLessThanOrEqual(2200); // 截断如 2KB（转义余量内）
    const err = JSON.parse(row.error!); // 恒合法 JSON——不落半截串
    expect(err.code).toBe("ATR-320");
    expect(String(err.message).length).toBeLessThan(10_000);
    expect(String(err.message).endsWith("…（journal 落库截断）")).toBe(true);
    db.close();
  });

  it("列形状镜像钉：id/ts/endpoint/principal/dur_ms/status/payload/error/notes（notes 列 = 内存条目 notes 位的持久镜像）", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    reg.register(defineCommand("note.write", { handler: async () => ({ ok: true }) }));
    const handler = reg.createHandler({ db });
    await post(handler, "note.write", {});
    const columns = db.prepare(`PRAGMA table_info(${COMMAND_JOURNAL_TABLE})`).all() as { name: string; notnull: number; pk: number }[];
    expect(columns.map((c) => c.name)).toEqual(["id", "ts", "endpoint", "principal", "dur_ms", "status", "payload", "error", "notes"]);
    const statusCol = columns.find((c) => c.name === "status")!;
    expect(statusCol.notnull).toBe(1); // status TEXT NOT NULL CHECK(status IN ('ok','failed'))
    expect(columns.find((c) => c.name === "id")!.pk).toBe(1); // INTEGER PRIMARY KEY AUTOINCREMENT
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(COMMAND_JOURNAL_TABLE) as { sql: string }).sql;
    expect(sql).toContain("AUTOINCREMENT");
    expect(sql).toContain("CHECK(status IN ('ok','failed'))");
    // 框架自管表：不进应用迁移序列——sqlite_master 实查（直接 SELECT COUNT(*) 不存在的表会抛
    // "no such table"，红检版此断言写法有误已修正）：atelier_migrations 状态表未建 = 迁移序列零感知
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atelier_migrations'").get()).toBeUndefined();
    db.close();
  });

  it("收槽先于入账（B5 顺序注记）：持久化 INSERT 不混入本 command 的自动失效键——写捕获槽不收自家账", async () => {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE memo (id INTEGER PRIMARY KEY, text TEXT NOT NULL)");
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand("memo.write", {
        handler: async (input: { text: string }, ctx) => {
          (ctx.db as SqliteDb).prepare("INSERT INTO memo (text) VALUES (?)").run(input.text); // 真写库 → 自动表名启发式有物可捕
          return { ok: true };
        },
      })
    );
    const spy = vi.spyOn(reg.liveEngine, "onCommandSuccess"); // 默认透传原实现——只观测广播键面
    const handler = reg.createHandler({ db });
    expect((await post(handler, "memo.write", { text: "x" })).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const keys = spy.mock.calls[0]![1] as string[];
    expect(keys).toContain("table:memo"); // 自动表名启发式照常工作（捕获槽语义不变）
    expect(keys).not.toContain("table:atelier_command_journal"); // 收槽先于入账：框架自写不混入失效键
    expect(journalRows(db)).toHaveLength(1); // 持久化照常发生（断言有实义：写发生了，只是不在槽活跃期）
    db.close();
  });
});
