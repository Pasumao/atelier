import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { migrateStatus, migrateUp, migrateDown, migrateVerify, MIGRATIONS_TABLE_DDL, MIGRATION_JOURNAL_DDL, readMigrationJournal } from "../server/migrate";
import { seedAll } from "../server/seed";
import { AtrEndpointError } from "../server/endpoints";

/* ---------- 迁移目录 fixture ---------- */
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeMigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-mig-"));
  tmpDirs.push(dir);
  return dir;
}

function writeMig(dir: string, n: number, name: string, up: string, down?: string): string {
  const stem = `${String(n).padStart(3, "0")}_${name}`;
  fs.writeFileSync(path.join(dir, `${stem}.up.sql`), up);
  if (down !== undefined) fs.writeFileSync(path.join(dir, `${stem}.down.sql`), down);
  return stem;
}

const CHATS_UP = "CREATE TABLE chats (id INTEGER PRIMARY KEY, name TEXT NOT NULL);";
const CHATS_DOWN = "DROP TABLE chats;";
const MSG_UP = "CREATE TABLE messages (id INTEGER PRIMARY KEY, chatId INTEGER NOT NULL, content TEXT NOT NULL);";
const MSG_DOWN = "DROP TABLE messages;";

async function setup(migFiles: (dir: string) => void): Promise<{ db: SqliteDb; dir: string }> {
  const db = await openSqlite(":memory:");
  const dir = makeMigDir();
  migFiles(dir);
  return { db, dir };
}

function tableNames(db: SqliteDb): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name
  );
}

function atrCode(e: unknown): string {
  expect(e).toBeInstanceOf(AtrEndpointError);
  return (e as AtrEndpointError).atr.code;
}

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用。Bun 不在场——bun 路径无法集成
// 测试（诚实边界同 sqlite.ts 头注），此处只真测 node 路径（skip-guard 模式沿 server.test.ts）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

describeSqlite("migrate 可逆迁移器（FS-DESIGN §5.4，FS-M2(m2b)；node 路径实测）", () => {
  it("status：未迁移库/空目录 → applied/pending 双空（纯读，不建状态表）；状态表 DDL 形状冻结", async () => {
    const { db, dir } = await setup(() => {});
    expect(migrateStatus(db, dir)).toEqual({ applied: [], pending: [] });
    expect(tableNames(db)).toEqual([]); // status 是纯读——连 atelier_migrations 都不建
    expect(MIGRATIONS_TABLE_DDL).toContain("down_verified INTEGER DEFAULT 0");
    db.close();
  });

  it("up：逐条顺序应用 + 记录 {name, checksum, durMs}；status 反映已应用/待应用", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, MSG_DOWN);
    });
    const steps = migrateUp(db, dir);
    expect(steps.map((s) => s.name)).toEqual(["001_create_chats", "002_add_messages"]);
    expect(steps[0].checksum).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(steps[0].durMs).toBeTypeOf("number");
    expect(tableNames(db)).toEqual(["atelier_migration_journal", "atelier_migrations", "chats", "messages"]); // journal 随 up 惰性建表
    const status = migrateStatus(db, dir);
    expect(status.applied.map((a) => a.name)).toEqual(["001_create_chats", "002_add_messages"]);
    expect(status.applied.every((a) => a.checksumOk && !a.fileMissing && !a.irreversible)).toBe(true);
    expect(status.pending).toEqual([]);
    db.close();
  });

  it("up --to：只应用到目标（编号或 stem）；重复 up 幂等（已应用条目再次体检通过）", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, MSG_DOWN);
    });
    const steps = migrateUp(db, dir, { to: "001" });
    expect(steps.map((s) => s.name)).toEqual(["001_create_chats"]);
    expect(migrateStatus(db, dir).pending.map((p) => p.name)).toEqual(["002_add_messages"]);
    migrateUp(db, dir, { to: "2" }); // 纯数字 = NNN 编号
    expect(tableNames(db)).toContain("messages");
    expect(migrateUp(db, dir)).toEqual([]); // 无 pending，再次体检全绿
    db.close();
  });

  it("down：无 to 回滚最后一条（破坏面最小缺省）；down --to 保留目标本身；down 成功删状态行", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, MSG_DOWN);
    });
    migrateUp(db, dir);
    const steps = migrateDown(db, dir);
    expect(steps.map((s) => s.name)).toEqual(["002_add_messages"]);
    expect(tableNames(db)).not.toContain("messages");
    expect(migrateStatus(db, dir).applied.map((a) => a.name)).toEqual(["001_create_chats"]);
    // 状态行已随 down 删除（§5.4：down 成功删状态行）
    expect(db.prepare("SELECT COUNT(*) AS n FROM atelier_migrations WHERE name = '002_add_messages'").get()!.n).toBe(0);
    db.close();
  });

  it("down --to '001'：回滚 002 保留 001（checkpoint 强制先 down 的地基语义）", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, MSG_DOWN);
    });
    migrateUp(db, dir);
    const steps = migrateDown(db, dir, { to: "001" });
    expect(steps.map((s) => s.name)).toEqual(["002_add_messages"]);
    expect(tableNames(db)).toEqual(["atelier_migration_journal", "atelier_migrations", "chats"]);
    db.close();
  });

  it("红检 ATR-332：已应用迁移文件被改（sha256 不符）→ up 拒绝（无 pending 也体检）；down 同口径", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
    });
    migrateUp(db, dir);
    fs.writeFileSync(path.join(dir, "001_create_chats.up.sql"), CHATS_UP + "\n-- 被人改了一行");
    expect(() => migrateUp(db, dir)).toThrow(/ATR-332/);
    expect(() => migrateDown(db, dir)).toThrow(/ATR-332/);
    try {
      migrateUp(db, dir);
    } catch (e) {
      expect((e as AtrEndpointError).atr.fix).toContain("永不重写");
      expect((e as AtrEndpointError).atr.context.hints).toContain("001_create_chats");
    }
    db.close();
  });

  it("红检 ATR-332：已应用迁移文件被删 → up 体检即拦（fileMissing 同属完整性域）", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
    });
    migrateUp(db, dir);
    fs.rmSync(path.join(dir, "001_create_chats.up.sql"));
    const status = migrateStatus(db, dir);
    expect(status.applied[0].fileMissing).toBe(true);
    expect(status.applied[0].checksumOk).toBe(false);
    try {
      migrateUp(db, dir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-332");
    }
    db.close();
  });

  it("红检 ATR-331：缺 down 配对 → up 拒绝应用（可逆性是硬门槛）", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP); // 无 down
    });
    try {
      migrateUp(db, dir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-331");
      expect((e as AtrEndpointError).message).toContain("001_create_chats");
    }
    expect(tableNames(db)).not.toContain("chats"); // 未应用（up 前置建的状态表在，业务表不在）
    db.close();
  });

  it("红检 ATR-333：不可逆标记无 force → 拒绝且 fix 说明风险约定；force 放行；down 文件缺失 → 拒绝", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, `-- 不可逆：干跑影子库外的演示表，数据可弃\nDROP TABLE messages;`);
    });
    migrateUp(db, dir);
    // 002 有不可逆标记：无 force → ATR-333（fix 提到 force 与标记约定，§18 R7）
    try {
      migrateDown(db, dir); // 无 to = 回滚 head（002）
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-333");
      expect((e as AtrEndpointError).message).toContain("002_add_messages");
      expect((e as AtrEndpointError).atr.fix).toContain("force: true");
      expect((e as AtrEndpointError).atr.fix).toContain("不可逆");
    }
    expect(migrateStatus(db, dir).applied.find((a) => a.name === "002_add_messages")!.irreversible).toBe(true);
    // force: true = 显式确认 → 放行 002
    expect(migrateDown(db, dir, { force: true }).map((s) => s.name)).toEqual(["002_add_messages"]);
    // 001 的 down 文件已删 → down 拒绝（缺失域）
    fs.rmSync(path.join(dir, "001_create_chats.down.sql"));
    try {
      migrateDown(db, dir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-333");
      expect((e as AtrEndpointError).message).toContain("001_create_chats");
    }
    db.close();
  });

  it("红检 ATR-334：up SQL 失败 → 事务回滚（库无残留、状态行不落）+ 四段式", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "broken", "CREATE TABEL oops (id INTEGER);", "DROP TABLE oops;");
    });
    migrateUp(db, dir, { to: "001" });
    try {
      migrateUp(db, dir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-334");
      expect((e as AtrEndpointError).message).toContain("002_broken");
      expect((e as AtrEndpointError).message).toContain("回滚");
    }
    expect(tableNames(db)).toEqual(["atelier_migration_journal", "atelier_migrations", "chats"]); // 002 无残留（failed 行也在 journal 落案）
    expect(db.prepare("SELECT COUNT(*) AS n FROM atelier_migrations WHERE name = '002_broken'").get()!.n).toBe(0);
    db.close();
  });

  it("红检：up 目标不存在 → ATR-334（up 域）；down 目标不存在 → ATR-333（down 域）", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
    });
    expect(() => migrateUp(db, dir, { to: "009_ghost" })).toThrow(/ATR-334/);
    expect(() => migrateDown(db, dir, { to: "009_ghost" })).toThrow(/ATR-333/);
    db.close();
  });

  it("verify：干跑影子库 up→down(force)→up 幂等通过；影子库不外溢（宿主库无表）", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, MSG_DOWN);
    });
    const result = await migrateVerify(dir);
    expect(result.ok).toBe(true);
    expect(result.mismatch).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.steps.map((s) => s.name)).toEqual([
      "001_create_chats",
      "002_add_messages", // 首次 up
      "002_add_messages",
      "001_create_chats", // down 循环清空（逆序）
      "001_create_chats",
      "002_add_messages", // 重放 up
    ]);
    expect(tableNames(db)).toEqual([]); // 干跑用 :memory: 影子库，宿主不动
    db.close();
  });

  it("verify：down 留下残留对象 → ok:false + mismatch 指出幂等破坏点", async () => {
    const { dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, "DROP TABLE chats; CREATE TABLE leftover (id INTEGER);");
    });
    const result = await migrateVerify(dir);
    expect(result.ok).toBe(false);
    expect(result.mismatch).toContain("leftover");
  });

  it("verify：干跑撞上缺 down（ATR-331）→ ok:false + error 结构化摘要（verify 是报告不是炸弹）", async () => {
    const { dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP); // 无 down
    });
    const result = await migrateVerify(dir);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ATR-331");
  });
});

describeSqlite("迁移持久 journal（决策 21 台账预留位关闭：追加式 atelier_migration_journal，M6 挂账候选池第二枚）", () => {
  function rawJournalRows(db: SqliteDb): Record<string, unknown>[] {
    return db
      .prepare("SELECT id, ts, name, action, status, principal, dur_ms, checksum FROM atelier_migration_journal ORDER BY id")
      .all() as Record<string, unknown>[];
  }

  it("up→down 后 journal 含 down 历史：状态行已删而 journal 仍在（down 不再丢史）；head 语义零变化", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "add_messages", MSG_UP, MSG_DOWN);
    });
    migrateUp(db, dir);
    migrateDown(db, dir); // 无 to = 回滚 head（002）
    const rows = rawJournalRows(db);
    expect(rows.map((r) => [r.action, r.name, r.status])).toEqual([
      ["up", "001_create_chats", "ok"],
      ["up", "002_add_messages", "ok"],
      ["down", "002_add_messages", "ok"], // 状态表里该行已删——journal 是唯一持久历史
    ]);
    expect(rows.every((r) => typeof r.ts === "number" && (r.ts as number) > 0)).toBe(true);
    expect(rows.every((r) => r.principal === "cli")).toBe(true); // CLI 场景缺省主体
    expect(rows.every((r) => typeof r.dur_ms === "number")).toBe(true);
    expect(rows[2].checksum).toMatch(/^[0-9a-f]{64}$/); // down 行记的是迁移身份 checksum（up.sql 的 sha256）
    // head 真相语义完全不变：状态表只剩 001
    expect(migrateStatus(db, dir).applied.map((a) => a.name)).toEqual(["001_create_chats"]);
    db.close();
  });

  it("失败迁移写 failed 行（§3.5 审计失败条目同纪律）：ATR-334 照抛且 journal 落案", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
      writeMig(d, 2, "broken", "CREATE TABEL oops (id INTEGER);", "DROP TABLE oops;");
    });
    migrateUp(db, dir, { to: "001" });
    expect(() => migrateUp(db, dir)).toThrow(/ATR-334/);
    const rows = rawJournalRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: "up", name: "002_broken", status: "failed", principal: "cli" });
    expect(typeof rows[1].dur_ms).toBe("number"); // 失败也有实测时长
    expect(rows[1].checksum).toMatch(/^[0-9a-f]{64}$/);
    db.close();
    // down 域执行位失败同口径：down SQL 本身炸 → ATR-333 照抛 + journal 落 action=down failed 行
    const db2 = await openSqlite(":memory:");
    const dir2 = makeMigDir();
    writeMig(dir2, 1, "chats_bad_down", CHATS_UP, "DROP TABE chats;"); // down SQL 语法错
    migrateUp(db2, dir2);
    expect(() => migrateDown(db2, dir2)).toThrow(/ATR-333/);
    const r2 = readMigrationJournal(db2);
    expect(r2.ok).toBe(true);
    expect(r2.rows.map((j) => [j.action, j.name, j.status])).toEqual([
      ["up", "001_chats_bad_down", "ok"],
      ["down", "001_chats_bad_down", "failed"],
    ]);
    db2.close();
  });

  it("旧库升级路径：只有状态表行（无 journal 表）→ up 惰性建表不炸；既有行不追溯补记", async () => {
    const db = await openSqlite(":memory:");
    const dir = makeMigDir();
    writeMig(dir, 1, "create_chats", CHATS_UP, CHATS_DOWN);
    writeMig(dir, 2, "add_messages", MSG_UP, MSG_DOWN);
    // 模拟 journal 时代之前的旧库：状态表 + 已应用 001，journal 表不存在
    db.exec(MIGRATIONS_TABLE_DDL);
    db.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at, down_verified) VALUES (?, ?, ?, 0)").run(
      "001_create_chats",
      createHash("sha256").update(CHATS_UP, "utf8").digest("hex"),
      1727000000000
    );
    const steps = migrateUp(db, dir); // 002 应用 + journal 惰性建表
    expect(steps.map((s) => s.name)).toEqual(["002_add_messages"]);
    const r = readMigrationJournal(db);
    expect(r.ok).toBe(true);
    expect(r.rows.map((j) => [j.action, j.name])).toEqual([["up", "002_add_messages"]]); // 001 不追溯
    db.close();
  });

  it("down 后再 up 往返：journal 序列 up→down→up（同名迁移多轮历史全保留）；verify 干跑不写宿主 journal", async () => {
    const { db, dir } = await setup((d) => {
      writeMig(d, 1, "create_chats", CHATS_UP, CHATS_DOWN);
    });
    migrateUp(db, dir);
    migrateDown(db, dir);
    migrateUp(db, dir);
    const r = readMigrationJournal(db);
    expect(r.ok).toBe(true);
    expect(r.rows.map((j) => j.action)).toEqual(["up", "down", "up"]);
    expect(new Set(r.rows.map((j) => j.name))).toEqual(new Set(["001_create_chats"]));
    const before = r.rows.length;
    const v = await migrateVerify(dir); // 影子库 :memory: 干跑——宿主 journal 不得增长
    expect(v.ok).toBe(true);
    expect(readMigrationJournal(db).rows).toHaveLength(before);
    db.close();
  });

  it("journal 形状冻结 + 纯读面零写：status/journal 读都不建表；无 journal 表读取 → ok:false 诚实降级", async () => {
    const { db, dir } = await setup(() => {});
    expect(migrateStatus(db, dir)).toEqual({ applied: [], pending: [] });
    expect(tableNames(db)).toEqual([]); // 纯读不落任何表（journal 表也不建）
    expect(MIGRATION_JOURNAL_DDL).toContain("atelier_migration_journal");
    expect(MIGRATION_JOURNAL_DDL).toContain("action TEXT NOT NULL CHECK(action IN ('up','down'))");
    expect(MIGRATION_JOURNAL_DDL).toContain("status TEXT NOT NULL CHECK(status IN ('ok','failed'))");
    expect(MIGRATION_JOURNAL_DDL).toContain("principal TEXT");
    expect(MIGRATION_JOURNAL_DDL).toContain("dur_ms INTEGER");
    const r = readMigrationJournal(db);
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(String(r.note)).toContain("journal");
    db.close();
  });
});

describeSqlite("SqliteDb.tx 事务原语（§5.5，FS-M2(m2b) 加法扩展；node 路径实测）", () => {
  it("同步 fn：提交持久化；异常回滚 + 原样 rethrow（journal 在事务提交后才入账的前提件）", async () => {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    await db.tx((tx) => {
      tx.prepare("INSERT INTO t (v) VALUES (?)").run(1);
      tx.prepare("INSERT INTO t (v) VALUES (?)").run(2);
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()!.n).toBe(2);
    await expect(
      db.tx((tx) => {
        tx.prepare("INSERT INTO t (v) VALUES (?)").run(3);
        throw new Error("业务原子操作失败");
      })
    ).rejects.toThrow("业务原子操作失败");
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()!.n).toBe(2); // 3 已回滚
    db.close();
  });

  it("async fn：await 后再写仍在同一事务（异常同样回滚）", async () => {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    await db.tx(async (tx) => {
      tx.prepare("INSERT INTO t (v) VALUES (?)").run(1);
      await Promise.resolve();
      tx.prepare("INSERT INTO t (v) VALUES (?)").run(2);
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()!.n).toBe(2);
    await expect(
      db.tx(async (tx) => {
        tx.prepare("INSERT INTO t (v) VALUES (?)").run(99);
        await Promise.resolve();
        throw new Error("async 中途炸");
      })
    ).rejects.toThrow("async 中途炸");
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()!.n).toBe(2);
    db.close();
  });

  it("嵌套 tx 显式失败（SQLite 无嵌套事务——显式报错优于隐式合并，诚实边界）", async () => {
    const db = await openSqlite(":memory:");
    await expect(db.tx((tx) => tx.tx(() => 1))).rejects.toThrow();
    db.close();
  });
});

/* ================= migrate seed（D-F17，FS-M2(m2d)；SQL 种子——server/seed.ts 有偏离声明） ================= */
describeSqlite("migrate seed（D-F17 SQL 种子：逐文件 tx + atelier_seeds 记账 + 幂等重跑）", () => {
  const GOOD_SEED = [
    "-- 示例种子（幂等：INSERT OR REPLACE，重复执行安全）",
    "INSERT OR REPLACE INTO chats (id, name) VALUES (1, '示例会话');",
    "",
  ].join("\n");
  const GOOD_SEED_2 = [
    "-- 第二个种子（UPSERT 语义：ON CONFLICT DO UPDATE）",
    "INSERT INTO chats (id, name) VALUES (2, '第二行') ON CONFLICT(id) DO UPDATE SET name = excluded.name;",
    "",
  ].join("\n");

  function makeSeedsDir(files: Record<string, string>): { root: string; seedsDir: string } {
    const root = makeMigDir(); // 复用迁移测试的 tmp 目录生命周期
    const seedsDir = path.join(root, "seeds");
    fs.mkdirSync(seedsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(seedsDir, name), content);
    return { root, seedsDir };
  }

  async function makeDb(): Promise<SqliteDb> {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE chats (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");
    return db;
  }

  it("seedAll：应用 + atelier_seeds 记账（name/checksum/applied_at）；无 ON CONFLICT 的 OR REPLACE 也放行", async () => {
    const db = await makeDb();
    const { seedsDir } = makeSeedsDir({ "001_example.seed.sql": GOOD_SEED });
    const r = seedAll(db, seedsDir);
    expect(r.applied.map((s) => s.name)).toEqual(["001_example.seed.sql"]);
    expect(r.skipped).toEqual([]);
    expect(r.applied[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(db.prepare("SELECT id, name FROM chats WHERE id = 1").get()).toEqual({ id: 1, name: "示例会话" });
    const row = db.prepare("SELECT name, checksum, applied_at FROM atelier_seeds WHERE name = ?").get("001_example.seed.sql") as { name: string; checksum: string; applied_at: number };
    expect(row.checksum).toBe(r.applied[0].checksum);
    expect(row.applied_at).toBeGreaterThan(0);
    db.close();
  });

  it("幂等重跑：第二次全 skipped、数据不重复；多文件按名排序应用", async () => {
    const db = await makeDb();
    const { seedsDir } = makeSeedsDir({
      "002_b.seed.sql": GOOD_SEED_2,
      "001_a.seed.sql": GOOD_SEED,
    });
    const first = seedAll(db, seedsDir);
    expect(first.applied.map((s) => s.name)).toEqual(["001_a.seed.sql", "002_b.seed.sql"]); // 文件名升序
    const second = seedAll(db, seedsDir);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["001_a.seed.sql", "002_b.seed.sql"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM chats").get()!.n).toBe(2); // UPSERT 语义：不重复
    db.close();
  });

  it("红检 ATR-335：已应用种子被改（sha256 不符）→ 拒绝且 fix 给出恢复/追加/开发态逃生口三路", async () => {
    const db = await makeDb();
    const { seedsDir } = makeSeedsDir({ "001_example.seed.sql": GOOD_SEED });
    seedAll(db, seedsDir);
    fs.writeFileSync(path.join(seedsDir, "001_example.seed.sql"), GOOD_SEED + "-- 被改了一行\n");
    try {
      seedAll(db, seedsDir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-335");
      expect((e as AtrEndpointError).message).toContain("001_example.seed.sql");
      expect((e as AtrEndpointError).atr.fix).toContain("另起新");
      expect((e as AtrEndpointError).atr.fix).toContain("atelier_seeds");
    }
    db.close();
  });

  it("红检 ATR-336：裸 INSERT 无 ON CONFLICT → 应用前静态拦截（不落状态行）；执行失败 → 事务回滚无残留", async () => {
    const db = await makeDb();
    const { seedsDir } = makeSeedsDir({
      "001_bad.seed.sql": "INSERT INTO chats (id, name) VALUES (1, '非幂等');",
    });
    try {
      seedAll(db, seedsDir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-336");
      expect((e as AtrEndpointError).atr.fix).toContain("INSERT OR REPLACE");
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM chats").get()!.n).toBe(0); // 未执行
    expect(db.prepare("SELECT COUNT(*) AS n FROM atelier_seeds").get()!.n).toBe(0); // 未记账
    // 执行失败（SQL 语法错）：tx 已回滚——前面文件的提交不受影响，坏文件无残留
    const ok = makeSeedsDir({
      "001_good.seed.sql": GOOD_SEED,
      "002_broken.seed.sql": "INSERT OR REPLACE INTO chats (id, name) VALUES ('x', 1, 2);", // 列数不符 → 执行炸
    });
    const db2 = await makeDb();
    try {
      seedAll(db2, ok.seedsDir);
      throw new Error("应当抛出");
    } catch (e) {
      expect(atrCode(e)).toBe("ATR-336");
      expect((e as AtrEndpointError).message).toContain("002_broken.seed.sql");
      expect((e as AtrEndpointError).message).toContain("回滚");
    }
    expect(db2.prepare("SELECT COUNT(*) AS n FROM chats WHERE id = 1").get()!.n).toBe(1); // 001 已提交
    expect((db2.prepare("SELECT COUNT(*) AS n FROM atelier_seeds WHERE name = '002_broken.seed.sql'").get() as { n: number }).n).toBe(0);
    db2.close();
    db.close();
  });

  it("空目录/缺目录 = vacuous 空清单；纯注释种子可应用（占位骨架安全）", async () => {
    const db = await makeDb();
    const empty = makeSeedsDir({});
    expect(seedAll(db, empty.seedsDir)).toEqual({ applied: [], skipped: [] });
    const missing = makeSeedsDir({});
    fs.rmdirSync(missing.seedsDir);
    expect(seedAll(db, missing.seedsDir)).toEqual({ applied: [], skipped: [] });
    const commentOnly = makeSeedsDir({ "001_placeholder.seed.sql": "-- 只注释占位（gen db 骨架形态）\n" });
    const r = seedAll(db, commentOnly.seedsDir);
    expect(r.applied).toHaveLength(1);
    db.close();
  });

  it("CLI：seed 不静默建库（库缺失 → exit 1 + 指路 migrate up）；有库有种子 → 诚实清单输出", async () => {
    const script = fileURLToPath(new URL("../scripts/migrate.mjs", import.meta.url));
    // 红路径：库不存在 → 指路不静默建库
    const bareRoot = makeMigDir();
    fs.mkdirSync(path.join(bareRoot, "src", "server", "db", "seeds"), { recursive: true });
    fs.writeFileSync(path.join(bareRoot, "src", "server", "db", "seeds", "001_example.seed.sql"), GOOD_SEED);
    let thrown = false;
    try {
      execFileSync(process.execPath, [script, "seed", "--root", bareRoot], { encoding: "utf8" });
    } catch (e) {
      thrown = true;
      const err = e as { status: number; stderr: string };
      expect(err.status).toBe(1);
      expect(err.stderr).toContain("不静默建库");
      expect(err.stderr).toContain("migrate up");
    }
    expect(thrown).toBe(true);
    expect(fs.existsSync(path.join(bareRoot, ".atelier", "dev.db"))).toBe(false); // 未静默建库
    // 绿路径：先建库（migrate up 造的库形态）→ seed 应用 + 幂等重跑
    const root = makeMigDir();
    const migDir = path.join(root, "src", "server", "db", "migrations");
    const seedsDir = path.join(root, "src", "server", "db", "seeds");
    fs.mkdirSync(migDir, { recursive: true });
    fs.mkdirSync(seedsDir, { recursive: true });
    fs.writeFileSync(path.join(migDir, "001_chats.up.sql"), "CREATE TABLE chats (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");
    fs.writeFileSync(path.join(migDir, "001_chats.down.sql"), "DROP TABLE chats;");
    fs.writeFileSync(path.join(seedsDir, "001_example.seed.sql"), GOOD_SEED);
    execFileSync(process.execPath, [script, "up", "--root", root], { encoding: "utf8" });
    const out1 = execFileSync(process.execPath, [script, "seed", "--root", root], { encoding: "utf8" });
    expect(out1).toContain("seeded 001_example.seed.sql");
    const out2 = execFileSync(process.execPath, [script, "seed", "--root", root], { encoding: "utf8" });
    expect(out2).toContain("skipped 001_example.seed.sql"); // 幂等重跑
  });
});
