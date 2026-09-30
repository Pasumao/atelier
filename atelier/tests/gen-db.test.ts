import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { genDb, GenDbError, parseSchema } from "../gen/gen-db.mjs";
import { openSqlite } from "../server/sqlite";
import { migrateUp } from "../server/migrate";

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用（migrate.test.ts 同款 skip-guard，
// Bun 不在场——bun 路径不实测，诚实边界同 sqlite.ts 头注）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqliteFts = nodeSqlite ? describe : describe.skip;

/* ---------- fixture：扁平字面量纪律的 schema.ts（含注释/字符串干扰项检验扫描器） ---------- */
const SCHEMA_V1 = `// 应用数据契约（fixture）——形态对齐 FS-DESIGN §5.1
import { table } from "../../vendor/atelier/server/db.ts";

// 干扰项：注释里的 table( 与字符串内的伪调用都必须被状态感知扫描跳过
// const fake = table("fake", { id: { type: "integer" } });
const hint = "export const ghost = table('ghost', {})";

export const chats = table("chats", {
  id: { type: "integer", primaryKey: true },
  name: { type: "text", notNull: true },
});

export const messages = table("messages", {
  id: { type: "integer", primaryKey: true },
  chatId: { type: "integer", notNull: true, references: "chats.id" },
  role: { type: "text", notNull: true, enum: ["user", "assistant"] },
  content: { type: "text", notNull: true },
  note: { type: "text", default: null },
}, {
  indexes: [{ name: "idx_messages_chat", columns: ["chatId"] }],
});
`;

const SCHEMA_V2 = SCHEMA_V1 + `
export const comments = table("comments", {
  id: { type: "integer", primaryKey: true },
  messageId: { type: "integer", notNull: true, references: "messages.id" },
  body: { type: "text", notNull: true },
});
`;

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeFixtureRoot(schema: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-gendb-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "src", "server", "db"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "server", "db", "schema.ts"), schema);
  return root;
}

const migDirOf = (root: string) => path.join(root, "src", "server", "db", "migrations");
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("gen db 生成器（FS-DESIGN §5.2，FS-M2(m2b)；纯文本扫描 + 回灌 table() 复验）", () => {
  it("扫描器：注释/字符串里的伪 table() 调用被跳过；解析结果带 rowSchema（回灌 db.ts 单源）", () => {
    const tables = parseSchema(SCHEMA_V1, "schema.ts");
    expect(tables.map((t) => t.def.name)).toEqual(["chats", "messages"]); // fake/ghost 均未混入
    const messages = tables[1].def;
    expect(messages.primaryKey).toEqual(["id"]);
    expect(messages.rowSchema.reqProps).toEqual({
      id: { type: "number" },
      chatId: { type: "number" },
      role: { type: "string", enum: ["user", "assistant"] },
      content: { type: "string" },
    });
    expect(messages.rowSchema.optProps).toEqual({ note: { type: "string" } });
  });

  it("tables.ts：显式 import schema.ts（相对路径正确）+ Row 类型（enum 字面量联合/可空 | null）", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    genDb(root);
    const text = read(root, "src/generated/db/tables.ts");
    expect(text).toContain('import { chats, messages } from "../../server/db/schema.ts";');
    expect(text).toContain('import type { TableDef } from "../../vendor/atelier/server/db.ts";');
    expect(text).toContain("export const messagesTable: TableDef = messages;");
    expect(text).toContain('role: "user" | "assistant";'); // enum 透传为联合类型
    expect(text).toContain("note: string | null;"); // 可空列
    expect(text).toContain("@atelier-generated"); // §6.3 生成物标记
  });

  it("crud.ts：四薄函数 + vendor 类型 import + 全参数化（零值拼接红线——INSERT 全 ?，UPDATE 值经 ? 绑定）", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    genDb(root);
    const text = read(root, "src/generated/db/crud.ts");
    expect(text).toContain('import type { SqliteDb, SqliteRunResult } from "../../vendor/atelier/server/sqlite.ts";');
    expect(text).toContain('import type { ChatsInsert, ChatsRow, MessagesInsert, MessagesRow } from "./tables.ts";');
    // 四函数 × 二表
    for (const t of ["chats", "messages"]) {
      for (const op of ["GetByPk", "Insert", "Update", "Delete"]) {
        expect(text).toContain(`export function ${t}${op}(`);
      }
    }
    // 参数化：INSERT 值全 ?（messages 五列）；值拼接为零
    expect(text).toContain("INSERT INTO messages (id, chatId, role, content, note) VALUES (?, ?, ?, ?, ?)");
    expect(text).not.toMatch(/VALUES\s*\(\s*\$\{/); // 零值拼接红线
    expect(text).toContain("values.id ?? null"); // INTEGER 单主键可省（rowid 自增）
    expect(text).toContain("messagesUpdateColumns"); // UPDATE 列名允许清单（contract 定义，非运行时输入）
    expect(text).toContain("DELETE FROM messages WHERE id = ?");
  });

  it("crud.ts：分页二原语（B7）——每 PK 表追加 ListPaged/Count、LIMIT/OFFSET 全参数化 + 非负整数硬守卫", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    genDb(root);
    const text = read(root, "src/generated/db/crud.ts");
    // 六函数 × 二表：既有四原语不动，ListPaged/Count 同款签名（db: Pick<SqliteDb, "prepare">）
    for (const t of ["chats", "messages"]) {
      expect(text).toContain(`export function ${t}ListPaged(db: Pick<SqliteDb, "prepare">, opts: { limit: number; offset?: number }): `);
      expect(text).toContain(`export function ${t}Count(db: Pick<SqliteDb, "prepare">): number {`);
    }
    // 分页 SQL：ORDER BY 主键升序（分页窗口决定论）+ LIMIT/OFFSET 全 ? 绑定（零值拼接红线不因分页破例）
    expect(text).toContain("SELECT id, name FROM chats ORDER BY id LIMIT ? OFFSET ?");
    expect(text).toContain('.all(opts.limit, opts.offset ?? 0) as ChatsRow[];');
    expect(text).toContain("offset 缺省 0"); // offset 缺省 0（opts.offset ?? 0）
    expect(text).toContain("SELECT COUNT(*) AS n FROM chats");
    expect(text).toContain("SELECT COUNT(*) AS n FROM messages");
    expect(text).toContain('(db.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n'); // 对齐 GetByPk 取值风格
    // 负 limit = SQLite 无界查询语义：生成代码内一行显式守卫硬错（不静默），中文报错指明用法
    expect(text).toContain("Number.isInteger(opts.limit) || opts.limit < 0");
    expect(text).toContain("Number.isInteger(opts.offset ?? 0) || (opts.offset ?? 0) < 0");
    expect(text).toContain("throw new Error(");
    expect(text).toContain("非负整数");
    expect(text).not.toMatch(/LIMIT\s+\$\{/); // LIMIT 不做插值拼接
  });

  it("crud.ts：复合主键表 ListPaged——ORDER BY 全主键列（决定论分页窗口）+ Count 同步生成", () => {
    const root = makeFixtureRoot(`import { table } from "../../vendor/atelier/server/db.ts";
export const members = table("members", {
  groupId: { type: "integer", primaryKey: true },
  userId: { type: "integer", primaryKey: true },
  role: { type: "text", notNull: true },
});
`);
    genDb(root);
    const text = read(root, "src/generated/db/crud.ts");
    expect(text).toContain(
      "SELECT groupId, userId, role FROM members ORDER BY groupId, userId LIMIT ? OFFSET ?"
    );
    expect(text).toContain("SELECT COUNT(*) AS n FROM members");
  });

  it("迁移骨架：拓扑序编号（messages 依赖 chats → 001/002）+ up/down 成对 + 已存在文件永不重写（追加式）", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    const { written, migrationsAppended } = genDb(root);
    expect(migrationsAppended).toEqual(["chats", "messages"]); // 依赖序
    expect(written).toContain("src/server/db/migrations/001_chats.up.sql");
    expect(written).toContain("src/server/db/migrations/001_chats.down.sql");
    expect(written).toContain("src/server/db/migrations/002_messages.up.sql");
    const up = read(root, "src/server/db/migrations/002_messages.up.sql");
    expect(up).toContain("CREATE TABLE IF NOT EXISTS messages (");
    expect(up).toContain("chatId INTEGER NOT NULL REFERENCES chats(id)"); // DDL 与 db.ts 同源
    expect(up).toContain("CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chatId);");
    const down = read(root, "src/server/db/migrations/001_chats.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS chats;");
    expect(down).toContain("级联不隐式"); // §5.1 纪律随骨架落盘
  });

  it("regen 幂等：二跑仅重写 tables.ts/crud.ts 且字节全同；迁移零新增", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    genDb(root);
    const snapshot = (rel: string) => fs.readFileSync(path.join(root, rel));
    const before = ["src/generated/db/tables.ts", "src/generated/db/crud.ts", "src/server/db/migrations/001_chats.up.sql", "src/server/db/migrations/002_messages.down.sql"].map(snapshot);
    const second = genDb(root);
    expect(second.written.sort()).toEqual(["src/generated/db/crud.ts", "src/generated/db/tables.ts"]); // 迁移不在清单
    expect(second.migrationsAppended).toEqual([]);
    const after = ["src/generated/db/tables.ts", "src/generated/db/crud.ts", "src/server/db/migrations/001_chats.up.sql", "src/server/db/migrations/002_messages.down.sql"].map(snapshot);
    expect(after.map((b) => b.toString("utf8"))).toEqual(before.map((b) => b.toString("utf8")));
  });

  it("新表追加：编号 = 现有最大 NNN+1；旧迁移文件字节未动（已应用迁移永不重写）", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    genDb(root);
    const oldUp = fs.readFileSync(path.join(migDirOf(root), "001_chats.up.sql"));
    const oldDown = fs.readFileSync(path.join(migDirOf(root), "002_messages.down.sql"));
    fs.writeFileSync(path.join(root, "src", "server", "db", "schema.ts"), SCHEMA_V2);
    const { migrationsAppended } = genDb(root);
    expect(migrationsAppended).toEqual(["comments"]);
    expect(fs.existsSync(path.join(migDirOf(root), "003_comments.up.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migDirOf(root), "003_comments.down.sql"))).toBe(true);
    expect(fs.readFileSync(path.join(migDirOf(root), "003_comments.up.sql"), "utf8")).toContain("messageId INTEGER NOT NULL REFERENCES messages(id)");
    expect(fs.readFileSync(path.join(migDirOf(root), "001_chats.up.sql"))).toEqual(oldUp);
    expect(fs.readFileSync(path.join(migDirOf(root), "002_messages.down.sql"))).toEqual(oldDown);
  });

  it("红检：计算值列定义（Date.now()）→ GenDbError 硬错（扁平纪律边界即解析器能力边界）", () => {
    const root = makeFixtureRoot(`import { table } from "../../vendor/atelier/server/db.ts";
export const logs = table("logs", {
  id: { type: "integer", primaryKey: true },
  createdAt: { type: "integer", notNull: true, default: Date.now() },
});
`);
    expect(() => genDb(root)).toThrow(GenDbError);
    try {
      genDb(root);
    } catch (e) {
      expect((e as GenDbError).message).toContain("无法静态解析");
      expect((e as GenDbError).fix).toContain("扁平字面量纪律");
    }
  });

  it("CLI 独立运行：node gen-db.mjs --root <fixture> 输出诚实清单（写入文件逐条列出）", () => {
    const root = makeFixtureRoot(SCHEMA_V1);
    const script = fileURLToPath(new URL("../gen/gen-db.mjs", import.meta.url));
    const stdout = execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
    expect(stdout).toContain("gen db：");
    expect(stdout).toContain("- 写入 src/generated/db/tables.ts");
    expect(stdout).toContain("- 写入 src/generated/db/crud.ts");
    expect(stdout).toContain("- 写入 src/server/db/migrations/001_chats.up.sql");
    expect(stdout).toContain("done：");
  });

  it("红检 P1-8：表名 _1（下划线开头）→ ATR-343 硬错，绝不产出 export type 1Row 非法 TS", () => {
    const root = makeFixtureRoot(`import { table } from "../../vendor/atelier/server/db.ts";
export const weird = table("_1", {
  id: { type: "integer", primaryKey: true },
});
`);
    let err: GenDbError | null = null;
    try {
      genDb(root);
    } catch (e) {
      err = e as GenDbError;
    }
    expect(err, `下划线开头的表名必须生成器侧拒绝（toPascal("_1") = "1" → export type 1Row 编译不过）`).toBeTruthy();
    expect(err!.code).toBe("ATR-343");
    expect(err!.message).toContain("_1");
    expect(err!.fix).toContain("字母开头");
    expect(fs.existsSync(path.join(root, "src", "generated", "db", "tables.ts"))).toBe(false); // 破产物未落盘
  });

  it("回归：字母开头的表名带下划线/数字（t_1）照常生成（口径不过紧）", () => {
    const root = makeFixtureRoot(`import { table } from "../../vendor/atelier/server/db.ts";
export const logs = table("t_1", {
  id: { type: "integer", primaryKey: true },
  note: { type: "text" },
});
`);
    genDb(root);
    const text = read(root, "src/generated/db/tables.ts");
    expect(text).toContain("export type T1Row = {");
    expect(text).toContain("export const t_1Table: TableDef = logs;");
    const crud = read(root, "src/generated/db/crud.ts");
    expect(crud).toContain("export function t1GetByPk(");
  });

  it("红检 R1-C：表名撞保留字（delete）→ ATR-343 die 而非产出破 SQL 产物（表名以裸标识符进 SQLite DDL/CRUD——CREATE TABLE delete = 语法错误）", () => {
    const root = makeFixtureRoot(`import { table } from "../../vendor/atelier/server/db.ts";
export const logs = table("delete", {
  id: { type: "integer", primaryKey: true },
  note: { type: "text" },
});
`);
    let err: GenDbError | null = null;
    try {
      genDb(root);
    } catch (e) {
      err = e as GenDbError;
    }
    expect(err, "保留字表名必须生成器侧 die（生成的迁移 DDL 与 CRUD SQL 会以裸标识符进 SQLite——实证 CREATE TABLE delete 为语法错误）").toBeTruthy();
    expect(err!.code).toBe("ATR-343");
    expect(err!.message).toContain("delete");
    expect(err!.fix, "die 必须带 fix 指引（四段式）").toBeTruthy();
    expect(fs.existsSync(path.join(root, "src", "generated", "db", "tables.ts"))).toBe(false); // 破产物未落盘
    expect(fs.existsSync(path.join(root, "src", "server", "db", "migrations", "001_delete.up.sql"))).toBe(false);
  });

  it("红检 R1-C 回归面：大写保留字（Delete）经 toCamel 同样闸下（SQLite 关键字大小写不敏感）；非保留字表名零影响", () => {
    const root = makeFixtureRoot(`import { table } from "../../vendor/atelier/server/db.ts";
export const logs = table("Delete", {
  id: { type: "integer", primaryKey: true },
});
`);
    let err: GenDbError | null = null;
    try {
      genDb(root);
    } catch (e) {
      err = e as GenDbError;
    }
    expect(err?.code).toBe("ATR-343");
    expect(err!.fix).toBeTruthy();
  });
});

/* ---------- B6：fts 全文搜索（FS-DESIGN §5.1/§5.2；FTS5 external-content 虚表 + 触发器同步 + CRUD 投影） ---------- */

const SCHEMA_FTS = `import { table } from "../../vendor/atelier/server/db.ts";

export const articles = table("articles", {
  id: { type: "integer", primaryKey: true },
  title: { type: "text", notNull: true },
  body: { type: "text", notNull: true },
}, {
  fts: { columns: ["title", "body"] },
});

export const plain = table("plain", {
  id: { type: "integer", primaryKey: true },
  note: { type: "text" },
});
`;

type FtsCrud = {
  articlesInsert: (db: unknown, v: { id?: number; title: string; body: string }) => unknown;
  articlesUpdate: (db: unknown, pk: { id: number }, patch: { title?: string; body?: string }) => unknown;
  articlesDelete: (db: unknown, pk: { id: number }) => unknown;
  articlesFtsSearch: (db: unknown, query: string, opts?: { limit?: number; offset?: number }) => { id: number; title: string; body: string }[];
  articlesFtsCount: (db: unknown, query: string) => number;
};

describe("gen db fts 全文搜索（B6）：opts 解析透传 + crud 投影 + 迁移 DDL 三件套", () => {
  it("parseSchema：opts.fts 纯文本解析为纯值并透传 TableDef（回灌 table() 复验）；无 fts 的表无该键", () => {
    const tables = parseSchema(SCHEMA_FTS, "schema.ts");
    expect(tables.map((t) => t.def.name)).toEqual(["articles", "plain"]);
    expect(tables[0].def.fts).toEqual({ columns: ["title", "body"] });
    expect(tables[1].def.fts).toBeUndefined();
  });

  it("crud.ts：fts 表追加 FtsSearch/FtsCount 二原语（MATCH ?/bm25/LIMIT ? OFFSET ? 全绑定 + B7 同款非负整数守卫）；非 fts 表零生成", () => {
    const root = makeFixtureRoot(SCHEMA_FTS);
    genDb(root);
    const text = read(root, "src/generated/db/crud.ts");
    expect(text).toContain(
      'export function articlesFtsSearch(db: Pick<SqliteDb, "prepare">, query: string, opts: { limit?: number; offset?: number } = {}): ArticlesRow[] {'
    );
    expect(text).toContain('export function articlesFtsCount(db: Pick<SqliteDb, "prepare">, query: string): number {');
    // 查询形状：主表 JOIN 虚表 + MATCH ? + bm25 排序；列名表名限定（external-content 虚表
    // 暴露同名列，裸列名 JOIN ambiguous——运行时对拍抓出后修正）；query/LIMIT/OFFSET 全 ? 绑定
    expect(text).toContain(
      "SELECT articles.id, articles.title, articles.body FROM articles JOIN articles_fts ON articles.id = articles_fts.rowid WHERE articles_fts MATCH ? ORDER BY bm25(articles_fts)"
    );
    expect(text).toContain("LIMIT ? OFFSET ?");
    expect(text).toContain("SELECT COUNT(*) AS n FROM articles_fts WHERE articles_fts MATCH ?");
    expect(text).not.toMatch(/MATCH\s+\$\{/); // query 不做插值拼接
    // 守卫：与 B7 ListPaged 同款非负整数硬错（注释互指 B7）
    expect(text).toContain("Number.isInteger(opts.limit)");
    expect(text).toContain("Number.isInteger(opts.offset)");
    expect(text).toContain("非负整数");
    expect(text).toContain("ListPaged 同款守卫");
    // JSDoc 诚实注记：MATCH 语法归属应用侧 + unicode61 中文边界
    expect(text).toContain("FTS5 MATCH 语法");
    expect(text).toContain("unicode61");
    // 非 fts 表零生成（纯加法：无 fts 声明 = 零新函数）
    expect(text).not.toContain("plainFtsSearch");
    expect(text).not.toContain("plainFtsCount");
  });

  it("迁移骨架：up 携带 FTS 虚表 + 触发器三元组 DDL（与 db.ts 同源）；down 先触发器 ×3 后虚表最后主表；追加式幂等不破", () => {
    const root = makeFixtureRoot(SCHEMA_FTS);
    const first = genDb(root);
    expect(first.migrationsAppended).toEqual(["articles", "plain"]);
    const up = read(root, "src/server/db/migrations/001_articles.up.sql");
    expect(up).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, body, content='articles', content_rowid='id');");
    expect(up).toContain("CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN");
    expect(up).toContain("INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);");
    expect(up).toContain("CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE ON articles BEGIN");
    const down = read(root, "src/server/db/migrations/001_articles.down.sql");
    const iT = down.indexOf("DROP TRIGGER IF EXISTS articles_fts_au;");
    const iV = down.indexOf("DROP TABLE IF EXISTS articles_fts;");
    const iM = down.indexOf("DROP TABLE IF EXISTS articles;");
    expect(iT).toBeGreaterThan(-1);
    expect(iV).toBeGreaterThan(iT); // 触发器先删
    expect(iM).toBeGreaterThan(iV); // 主表最后
    expect(read(root, "src/server/db/migrations/002_plain.down.sql")).toContain("DROP TABLE IF EXISTS plain;");
    // regen 幂等：二跑迁移零新增、DDL 字节全同（追加式纪律不因 fts 破例）
    const before = [up, down];
    const second = genDb(root);
    expect(second.migrationsAppended).toEqual([]);
    expect([read(root, "src/server/db/migrations/001_articles.up.sql"), read(root, "src/server/db/migrations/001_articles.down.sql")]).toEqual(before);
  });
});

describeSqliteFts("gen db fts 运行时对拍（B6）：真实 node:sqlite 应用迁移 DDL + 执行生成 FtsSearch/FtsCount", () => {
  async function setup() {
    const root = makeFixtureRoot(SCHEMA_FTS);
    genDb(root);
    const db = await openSqlite(":memory:");
    migrateUp(db, migDirOf(root)); // 生成的迁移对（含 FTS 虚表 + 触发器）真跑
    const crudUrl = pathToFileURL(path.join(root, "src", "generated", "db", "crud.ts")).href;
    const crud = (await import(crudUrl)) as FtsCrud;
    return { db, crud };
  }

  it("insert→命中 + bm25 相关度排序 + FtsCount 计数 + unicode61 中文整串/前缀诚实边界", async () => {
    const { db, crud } = await setup();
    crud.articlesInsert(db, { id: 1, title: "alpha", body: "gamma" });
    crud.articlesInsert(db, { id: 2, title: "beta", body: "gamma gamma gamma" }); // 命中多 → bm25 更负 → 排前
    crud.articlesInsert(db, { id: 3, title: "delta", body: "nothing here" });
    expect(crud.articlesFtsSearch(db, "gamma").map((r) => r.id)).toEqual([2, 1]); // bm25 升序：3 命中在 1 命中前（与插入序相反，实证排序生效）
    expect(crud.articlesFtsSearch(db, "alpha").map((r) => r.id)).toEqual([1]);
    expect(crud.articlesFtsSearch(db, "missing")).toEqual([]);
    expect(crud.articlesFtsCount(db, "gamma")).toBe(2);
    expect(crud.articlesFtsCount(db, "missing")).toBe(0);
    // unicode61 诚实边界（实证钉住，docs §5.2 注记依据）：连续中文串 = 整串单 token（不按字切）
    crud.articlesInsert(db, { id: 4, title: "笔记", body: "苹果很好吃" });
    expect(crud.articlesFtsSearch(db, "苹果很好吃").map((r) => r.id)).toEqual([4]); // 整串查询命中
    expect(crud.articlesFtsSearch(db, "苹果*").map((r) => r.id)).toEqual([4]); // 前缀 * 命中（应用侧拼接）
    expect(crud.articlesFtsSearch(db, "苹果")).toEqual([]); // 子串/单字查询不命中——需真分词走手改迁移 tokenize
    db.close();
  });

  it("update→新词命中旧词失；delete→不命中且 FtsCount 归零（触发器同步 external-content 索引）", async () => {
    const { db, crud } = await setup();
    crud.articlesInsert(db, { id: 1, title: "alpha", body: "gamma" });
    crud.articlesInsert(db, { id: 2, title: "beta", body: "gamma" });
    crud.articlesUpdate(db, { id: 2 }, { body: "epsilon" });
    expect(crud.articlesFtsSearch(db, "gamma").map((r) => r.id)).toEqual([1]); // 旧词失
    expect(crud.articlesFtsSearch(db, "epsilon").map((r) => r.id)).toEqual([2]); // 新词命中
    crud.articlesDelete(db, { id: 2 });
    expect(crud.articlesFtsSearch(db, "epsilon")).toEqual([]); // 删除后不命中
    expect(crud.articlesFtsCount(db, "epsilon")).toBe(0); // 且计数归零
    expect(crud.articlesFtsCount(db, "gamma")).toBe(1);
    db.close();
  });

  it("limit/offset 分页 + 非负整数守卫硬错（含 offset 须与 limit 同传）+ MATCH 语法错误诚实冒泡 + 非 fts 表零投影", async () => {
    const { db, crud } = await setup();
    crud.articlesInsert(db, { id: 1, title: "alpha", body: "gamma" });
    crud.articlesInsert(db, { id: 2, title: "beta", body: "gamma gamma gamma" });
    crud.articlesInsert(db, { id: 3, title: "delta", body: "gamma" });
    expect(crud.articlesFtsSearch(db, "gamma").map((r) => r.id)).toEqual([2, 1, 3]); // bm25：2（3 命中）> 1、3（1 命中，声明序稳定）
    expect(crud.articlesFtsSearch(db, "gamma", { limit: 2 }).map((r) => r.id)).toEqual([2, 1]);
    expect(crud.articlesFtsSearch(db, "gamma", { limit: 2, offset: 2 }).map((r) => r.id)).toEqual([3]);
    expect(crud.articlesFtsSearch(db, "gamma", { limit: 0 }).map((r) => r.id)).toEqual([]); // limit 0 合法：空窗
    // 守卫（B7 ListPaged 同款）：负/小数硬错；offset 单传无分页窗口 → 硬错不静默
    expect(() => crud.articlesFtsSearch(db, "gamma", { limit: -1 })).toThrow(/非负整数/);
    expect(() => crud.articlesFtsSearch(db, "gamma", { limit: 1.5 })).toThrow(/非负整数/);
    expect(() => crud.articlesFtsSearch(db, "gamma", { offset: -1 })).toThrow(/非负整数/);
    expect(() => crud.articlesFtsSearch(db, "gamma", { offset: 1 })).toThrow(/offset 必须与 limit 同传/);
    // MATCH 语法错误诚实冒泡为 SQLite 异常（生成代码不加 try/catch 掩盖）
    expect(() => crud.articlesFtsSearch(db, "(")).toThrow(/fts5: syntax error/i);
    db.close();
  });
});
