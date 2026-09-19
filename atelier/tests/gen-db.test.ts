import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genDb, GenDbError, parseSchema } from "../gen/gen-db.mjs";

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
});
