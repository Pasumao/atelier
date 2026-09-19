/**
 * struct-guards.test.ts — FS-M2-a：struct 八层新增规则的红绿双证（FS-DESIGN §9 / §15 ATR-105/106）。
 *
 * 方法论对齐 FACT_TOKEN_REFS 先例：每条规则正例（违规被抓住）+ 反例（合规不报）+
 * 健康缺省（对象文件不存在 → 整条静默、零新 finding）三态实证。
 * "健康的部分建成不得炸门禁"（不假红）本身就是被测行为，不是注释。
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { inspectStructure } from "../scripts/struct.mjs";

/* ---------- fixture 工具 ---------- */

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

let seq = 0;
function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atelier-struct-${++seq}-`));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  roots.push(root);
  return root;
}

function ids(res: ReturnType<typeof inspectStructure>): Set<string> {
  return new Set(res.layers.flatMap((l) => l.findings.map((f) => f.id)));
}
function finding(res: ReturnType<typeof inspectStructure>, id: string) {
  const f = res.layers.flatMap((l) => l.findings).find((x) => x.id === id);
  expect(f, `finding ${id} should exist`).toBeDefined();
  return f!;
}
function severity(res: ReturnType<typeof inspectStructure>, id: string): string | null {
  return finding(res, id).severity ?? null;
}
function detail(res: ReturnType<typeof inspectStructure>, id: string): string {
  return finding(res, id).detail;
}

/** 造 .atelier/dev.db：atelier_migrations 状态表 schema 固定（FS-DESIGN §5.4），可附带业务表。 */
function makeDevDb(root: string, opts: { rows?: { name: string; checksum: string }[]; tables?: string[]; withStateTable?: boolean } = {}) {
  fs.mkdirSync(path.join(root, ".atelier"), { recursive: true });
  const db = new DatabaseSync(path.join(root, ".atelier", "dev.db"));
  if (opts.withStateTable !== false) {
    db.exec(
      "CREATE TABLE atelier_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL, down_verified INTEGER DEFAULT 0)",
    );
    for (const [i, r] of (opts.rows ?? []).entries()) {
      db.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at) VALUES (?, ?, ?)").run(r.name, r.checksum, i + 1);
    }
  }
  for (const t of opts.tables ?? []) db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY)`);
  db.close();
}
const sha256 = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/* ---------- 健康缺省（所有新规则共享的不假红基线） ---------- */

describe("struct 八层：健康缺省", () => {
  it("无 src/server/** 与 src/main.ts 的项目：7 条新规则全部静默（零新 finding）", () => {
    const res = inspectStructure(makeProject({ "README.md": "hello" }));
    const fresh = [
      "SERVER_IMPORT_LEAK",
      "SERVER_AUTH_MISSING",
      "SERVER_JOURNAL_SILENT",
      "IMPORT_ALLOWLIST",
      "DB_MIGRATION_PAIR",
      "DB_MIGRATION_CHECKSUM",
      "DB_SCHEMA_DRIFT",
    ];
    const present = [...ids(res)].filter((id) => fresh.includes(id));
    expect(present).toEqual([]);
  });

  it("结构显示：layers 恰为 8 层，7=boundary、8=data，modelVersion 升级", () => {
    const res = inspectStructure(makeProject({}));
    expect(res.layers).toHaveLength(8);
    expect(res.layers[6].title).toContain("boundary");
    expect(res.layers[7].title).toContain("data");
    expect(res.modelVersion).toBe("eight-layer/v0.3");
  });

  it("CLI 行为不变：map --json 仍可管线消费（输出含 8 层）", () => {
    const root = makeProject({});
    const out = execFileSync(process.execPath, ["scripts/struct.mjs", "map", root, "--json"], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });
    const parsed = JSON.parse(out);
    expect(parsed.layers).toHaveLength(8);
    expect(parsed.summary).toHaveProperty("errors");
  });
});

/* ---------- layer 7：SERVER_IMPORT_LEAK（ATR-105） ---------- */

describe("SERVER_IMPORT_LEAK（ATR-105）", () => {
  it("红：src/main.ts 直接 import src/server/** → ERROR，detail 指认泄漏文件", () => {
    const root = makeProject({
      "src/main.ts": `import { mount } from "./app.ts";\nimport { api } from "./server/api.ts";\nmount(api);\n`,
      "src/app.ts": `export const mount = (x: unknown) => x;\n`,
      "src/server/api.ts": `import { db } from "./db.ts";\nexport const api = db;\n`,
      "src/server/db.ts": `export const db = 1;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_IMPORT_LEAK")).toBe("ERROR");
    expect(detail(res, "SERVER_IMPORT_LEAK")).toContain("src/server/api.ts");
  });

  it("红：BFS 间接可达（main → ui → vendor/atelier/server）→ ERROR", () => {
    const root = makeProject({
      "src/main.ts": `import "./ui.ts";\n`,
      "src/ui.ts": `import { x } from "./vendor/atelier/server/index.ts";\nexport const y = x;\n`,
      "src/vendor/atelier/server/index.ts": `export const x = 1;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_IMPORT_LEAK")).toBe("ERROR");
    expect(detail(res, "SERVER_IMPORT_LEAK")).toContain("src/vendor/atelier/server/index.ts");
  });

  it("红：server 模块内部互相 import 不炸不重报（循环依赖只记一条 ERROR）", () => {
    const root = makeProject({
      "src/main.ts": `import { a } from "./server/a.ts";\nexport const main = a;\n`,
      "src/server/a.ts": `import { b } from "./b.ts";\nexport const a = b;\n`,
      "src/server/b.ts": `import { a } from "./a.ts";\nexport const b = 1;\n`,
    });
    const res = inspectStructure(root);
    const leaks = res.layers.flatMap((l) => l.findings).filter((f) => f.id === "SERVER_IMPORT_LEAK");
    expect(leaks).toHaveLength(1);
    expect(leaks[0].severity).toBe("ERROR");
  });

  it("绿：main 图只达 runtime（vendor/atelier/runtime 合法）→ ok", () => {
    const root = makeProject({
      "src/main.ts": `import { core } from "./vendor/atelier/runtime/index.ts";\nexport const ready = core;\n`,
      "src/vendor/atelier/runtime/index.ts": `export const core = 1;\n`,
      "src/server/api.ts": `export const api = 1;\n`, // server 存在但不可达
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_IMPORT_LEAK")).toBeNull();
    expect(detail(res, "SERVER_IMPORT_LEAK")).toContain("reaches no");
  });

  it("绿：type-only import（编译后消失）不进可达图 → ok", () => {
    const root = makeProject({
      "src/main.ts": `import type { ServerType } from "./server/types.ts";\nexport const t: ServerType = null as never;\n`,
      "src/server/types.ts": `export type ServerType = { x: number };\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_IMPORT_LEAK")).toBeNull();
  });

  it("绿：字符串里长得像 import 的文本（fixture 常见）不触发误报", () => {
    const root = makeProject({
      "src/main.ts": `export const sample = 'import { api } from "./server/api.ts";';\nimport { ok } from "./app.ts";\nexport const main = ok + sample.length;\n`,
      "src/app.ts": `export const ok = 1;\n`,
      "src/server/api.ts": `export const api = 1;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_IMPORT_LEAK")).toBeNull();
  });
});

/* ---------- layer 7：IMPORT_ALLOWLIST（ATR-106） ---------- */

describe("IMPORT_ALLOWLIST（ATR-106）", () => {
  it("红：幻觉包（不在 dependencies/devDependencies）→ ERROR，逐文件列包名", () => {
    const root = makeProject({
      "package.json": `{"name":"app","dependencies":{"react":"19.0.0"},"devDependencies":{}}`,
      "src/main.ts": `import { ghost } from "hallucinated-pkg";\nimport { r } from "react";\nexport const m = ghost + r;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "IMPORT_ALLOWLIST")).toBe("ERROR");
    expect(detail(res, "IMPORT_ALLOWLIST")).toContain("hallucinated-pkg");
    expect(detail(res, "IMPORT_ALLOWLIST")).toContain("src/main.ts");
    expect(detail(res, "IMPORT_ALLOWLIST")).not.toContain("react");
  });

  it("红：.mjs 也在扫描域（scripts 工具脚本 import 幻觉包）→ ERROR", () => {
    const root = makeProject({
      "package.json": `{"name":"app","devDependencies":{"vitest":"4"}}`,
      "scripts/tool.mjs": `import { x } from "ghost-mjs";\nexport const t = x;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "IMPORT_ALLOWLIST")).toBe("ERROR");
    expect(detail(res, "IMPORT_ALLOWLIST")).toContain("ghost-mjs");
  });

  it("绿：node: 内建 / 相对 / # 内部别名 / @scope 两段名 / devDeps 包全合规 → ok", () => {
    const root = makeProject({
      "package.json": `{"name":"app","dependencies":{"react":"19.0.0","@scope/pkg":"1"},"devDependencies":{"vitest":"4"}}`,
      "src/main.ts": [
        `import fs from "node:fs";`,
        `import { r } from "react";`,
        `import { p } from "@scope/pkg/sub";`,
        `import { v } from "vitest";`,
        `import "#alias/app";`,
        `import { l } from "./lib.ts";`,
        `export const m = fs + r + p + v + l;`,
      ].join("\n"),
      "src/lib.ts": `export const l = 1;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "IMPORT_ALLOWLIST")).toBeNull();
  });

  it("绿：type-only import 不对账（类型包未安装也合法）→ ok", () => {
    const root = makeProject({
      "package.json": `{"name":"app","dependencies":{},"devDependencies":{}}`,
      "src/main.ts": `import type { Plugin } from "vite";\nexport const m: Plugin | null = null;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "IMPORT_ALLOWLIST")).toBeNull();
  });

  it("绿：动态 import() 运行时分支 v1 不查（诚实边界，B 队）→ ok", () => {
    const root = makeProject({
      "package.json": `{"name":"app","dependencies":{},"devDependencies":{}}`,
      "src/main.ts": `export async function lazy() { return await import("conditional-pkg"); }\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "IMPORT_ALLOWLIST")).toBeNull();
  });

  it("健康缺省：无 package.json（meta 仓库形态）→ 整条静默", () => {
    const root = makeProject({ "src/main.ts": `import { g } from "hallucinated-pkg";\nexport const m = g;\n` });
    const res = inspectStructure(root);
    expect(ids(res).has("IMPORT_ALLOWLIST")).toBe(false);
  });
});

/* ---------- layer 7：SERVER_AUTH_MISSING（WARN） ---------- */

const CMD_WITHOUT_AUTH = `export const chatAsk = defineCommand("chat.ask", {\n  contract: {},\n  handler: async (input) => input,\n});\n`;
const CMD_WITH_AUTH_NONE = `export const chatAsk = defineCommand("chat.ask", {\n  contract: {},\n  auth: { type: "none" },\n  handler: async (input) => input,\n});\n`;

describe("SERVER_AUTH_MISSING（WARN）", () => {
  it("红：defineCommand 缺 auth 键 → WARN，detail 指认文件", () => {
    const root = makeProject({ "src/server/endpoints/chat.ts": CMD_WITHOUT_AUTH });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_AUTH_MISSING")).toBe("WARN");
    expect(detail(res, "SERVER_AUTH_MISSING")).toContain("chat.ts");
    expect(detail(res, "SERVER_AUTH_MISSING")).toContain("1/1");
  });

  it("绿：显式 auth: { type: \"none\" } 消警（沉默缺省才是 agent 高错区）", () => {
    const root = makeProject({ "src/server/endpoints/chat.ts": CMD_WITH_AUTH_NONE });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_AUTH_MISSING")).toBeNull();
  });

  it("绿：显式 auth: { type: \"session\" } 同样消警", () => {
    const root = makeProject({
      "src/server/endpoints/chat.ts": CMD_WITH_AUTH_NONE.replace('"none"', '"session"'),
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_AUTH_MISSING")).toBeNull();
  });

  it("红：handler 体内的同名标识符/嵌套对象不消警（骨架只认顶层键）", () => {
    const root = makeProject({
      "src/server/endpoints/chat.ts": `export const chatAsk = defineCommand("chat.ask", {\n  contract: {},\n  handler: async (input, ctx) => {\n    const auth = ctx.auth;\n    return { auth, ok: true };\n  },\n});\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_AUTH_MISSING")).toBe("WARN");
  });

  it("绿：defineQuery 无 auth 位要求（规则只盯 defineCommand）→ ok", () => {
    const root = makeProject({
      "src/server/endpoints/list.ts": `export const chatList = defineQuery("chat.list", {\n  contract: {},\n  handler: (input) => input,\n});\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_AUTH_MISSING")).toBeNull();
  });

  it("健康缺省：注释里的 defineCommand 示例不算调用位 → ok（0 调用位）", () => {
    const root = makeProject({
      "src/server/notes.ts": `// 示例：defineCommand("x", { handler }) 以后再写\nexport const note = 1;\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_AUTH_MISSING")).toBeNull();
    expect(detail(res, "SERVER_AUTH_MISSING")).toContain("0 defineCommand");
  });
});

/* ---------- layer 7：SERVER_JOURNAL_SILENT（WARN） ---------- */

describe("SERVER_JOURNAL_SILENT（WARN）", () => {
  const A_COMMAND = `export const c = defineCommand("app.wipe", {\n  auth: { type: "none" },\n  handler: async () => 1,\n});\n`;

  it("红：atelier.config.json 声明 server.journal=false → WARN", () => {
    const root = makeProject({
      "atelier.config.json": `{"server":{"journal":false}}`,
      "src/server/endpoints/wipe.ts": A_COMMAND,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_JOURNAL_SILENT")).toBe("WARN");
    expect(detail(res, "SERVER_JOURNAL_SILENT")).toContain("server.journal=false");
  });

  it("红：main-server.ts 构造处 journalLimit: 0 文本特征 → WARN", () => {
    const root = makeProject({
      "src/server/endpoints/wipe.ts": A_COMMAND,
      "src/main-server.ts": `import { createHandler } from "./server/index.ts";\nexport const handler = createHandler({ journalLimit: 0 });\n`,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_JOURNAL_SILENT")).toBe("WARN");
    expect(detail(res, "SERVER_JOURNAL_SILENT")).toContain("src/main-server.ts");
  });

  it("绿：command 存在且无任何关闭特征 → ok（审计默认在）", () => {
    const root = makeProject({
      "atelier.config.json": `{"tokens":{}}`,
      "src/server/endpoints/wipe.ts": A_COMMAND,
    });
    const res = inspectStructure(root);
    expect(severity(res, "SERVER_JOURNAL_SILENT")).toBeNull();
  });

  it("健康缺省：只有 query 没有 command → 整条静默", () => {
    const root = makeProject({
      "atelier.config.json": `{"server":{"journal":false}}`,
      "src/server/endpoints/list.ts": `export const q = defineQuery("app.list", { handler: () => [] });\n`,
    });
    const res = inspectStructure(root);
    expect(ids(res).has("SERVER_JOURNAL_SILENT")).toBe(false);
  });
});

/* ---------- layer 8：DB_MIGRATION_PAIR / DB_MIGRATION_CHECKSUM / DB_SCHEMA_DRIFT ---------- */

describe("DB_MIGRATION_PAIR（可逆性硬门槛）", () => {
  it("红：up 缺 down 与 down 缺 up 双向都抓 → ERROR", () => {
    const root = makeProject({
      "src/server/db/migrations/001_create_chats.up.sql": "CREATE TABLE chats (id INTEGER PRIMARY KEY);",
      "src/server/db/migrations/002_add_messages.down.sql": "DROP TABLE messages;",
    });
    const res = inspectStructure(root);
    expect(severity(res, "DB_MIGRATION_PAIR")).toBe("ERROR");
    const d = detail(res, "DB_MIGRATION_PAIR");
    expect(d).toContain("001_create_chats");
    expect(d).toContain("down missing");
    expect(d).toContain("002_add_messages");
    expect(d).toContain("up missing");
  });

  it("绿：成对迁移 → ok", () => {
    const root = makeProject({
      "src/server/db/migrations/001_create_chats.up.sql": "CREATE TABLE chats (id INTEGER PRIMARY KEY);",
      "src/server/db/migrations/001_create_chats.down.sql": "DROP TABLE chats;",
    });
    const res = inspectStructure(root);
    expect(severity(res, "DB_MIGRATION_PAIR")).toBeNull();
    expect(detail(res, "DB_MIGRATION_PAIR")).toContain("1 migration pair(s)");
  });

  it("健康缺省：无 migrations 目录 → 整条静默", () => {
    const root = makeProject({ "src/server/db/schema.ts": "export const x = 1;\n" });
    const res = inspectStructure(root);
    expect(ids(res).has("DB_MIGRATION_PAIR")).toBe(false);
  });
});

describe("DB_MIGRATION_CHECKSUM（已应用迁移不可改）", () => {
  const MIG = "CREATE TABLE chats (id INTEGER PRIMARY KEY);";

  it("绿：库内 checksum 与文件字节 sha256 一致 → ok", () => {
    const root = makeProject({ "src/server/db/migrations/001_create_chats.up.sql": MIG });
    makeDevDb(root, { rows: [{ name: "001_create_chats", checksum: sha256(path.join(root, "src/server/db/migrations/001_create_chats.up.sql")) }] });
    const res = inspectStructure(root);
    expect(severity(res, "DB_MIGRATION_CHECKSUM")).toBeNull();
    expect(detail(res, "DB_MIGRATION_CHECKSUM")).toContain("1 applied migration(s)");
  });

  it("红：应用后文件被改（checksum 不匹配）→ ERROR", () => {
    const root = makeProject({ "src/server/db/migrations/001_create_chats.up.sql": `${MIG}\n-- 有人手贱加了一列\n` });
    makeDevDb(root, { rows: [{ name: "001_create_chats", checksum: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }] });
    const res = inspectStructure(root);
    expect(severity(res, "DB_MIGRATION_CHECKSUM")).toBe("ERROR");
    expect(detail(res, "DB_MIGRATION_CHECKSUM")).toContain("001_create_chats");
  });

  it("红：库内已应用但迁移文件丢失 → ERROR", () => {
    const root = makeProject({ "src/server/db/migrations/001_create_chats.up.sql": MIG });
    makeDevDb(root, { rows: [{ name: "002_gone", checksum: sha256(path.join(root, "src/server/db/migrations/001_create_chats.up.sql")) }] });
    const res = inspectStructure(root);
    expect(severity(res, "DB_MIGRATION_CHECKSUM")).toBe("ERROR");
    expect(detail(res, "DB_MIGRATION_CHECKSUM")).toContain("file missing");
  });

  it("健康缺省：dev.db 存在但无 atelier_migrations 表 → 静默", () => {
    const root = makeProject({ "src/server/db/migrations/001_create_chats.up.sql": MIG });
    makeDevDb(root, { withStateTable: false, tables: ["chats"] });
    const res = inspectStructure(root);
    expect(ids(res).has("DB_MIGRATION_CHECKSUM")).toBe(false);
  });

  it("健康缺省：无 dev.db → 静默", () => {
    const root = makeProject({ "src/server/db/migrations/001_create_chats.up.sql": MIG });
    const res = inspectStructure(root);
    expect(ids(res).has("DB_MIGRATION_CHECKSUM")).toBe(false);
  });
});

describe("DB_SCHEMA_DRIFT（该出一次迁移了）", () => {
  it("红：schema.ts 声明的表在 dev.db 缺失 → WARN，detail 列缺失表", () => {
    const root = makeProject({
      "src/server/db/schema.ts": `export const chats = table("chats", {});\nexport const messages = table("messages", {});\n`,
    });
    makeDevDb(root, { tables: ["chats"] });
    const res = inspectStructure(root);
    expect(severity(res, "DB_SCHEMA_DRIFT")).toBe("WARN");
    expect(detail(res, "DB_SCHEMA_DRIFT")).toContain("messages");
    expect(detail(res, "DB_SCHEMA_DRIFT")).not.toContain("chats,"); // chats 已在库，不进缺失清单
  });

  it("绿：声明表全部在库 → ok；atelier_migrations 不参与对账", () => {
    const root = makeProject({
      "src/server/db/schema.ts": `export const messages = table("messages", {});\n`,
    });
    makeDevDb(root, { tables: ["messages"] });
    const res = inspectStructure(root);
    expect(severity(res, "DB_SCHEMA_DRIFT")).toBeNull();
  });

  it("健康缺省：schema.ts 存在但无 dev.db → 静默（谈不上漂移）", () => {
    const root = makeProject({ "src/server/db/schema.ts": `export const messages = table("messages", {});\n` });
    const res = inspectStructure(root);
    expect(ids(res).has("DB_SCHEMA_DRIFT")).toBe(false);
  });
});
