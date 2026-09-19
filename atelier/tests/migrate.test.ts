import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { migrateStatus, migrateUp, migrateDown, migrateVerify, MIGRATIONS_TABLE_DDL } from "../server/migrate";
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
    expect(tableNames(db)).toEqual(["atelier_migrations", "chats", "messages"]);
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
    expect(tableNames(db)).toEqual(["atelier_migrations", "chats"]);
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
    expect(tableNames(db)).toEqual(["atelier_migrations", "chats"]); // 002 无残留
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
