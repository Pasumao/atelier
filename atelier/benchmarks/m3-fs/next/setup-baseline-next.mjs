#!/usr/bin/env node
/**
 * setup-baseline-next.mjs — M3-FS 对照臂（next）预接线基线装配脚本（FS-10 执行半交付件）。
 *
 *   node setup-baseline-next.mjs --target <dir> [--force] [--variant baseline|task3]
 *                                 [--no-install] [--no-check] [--emit-manifest <file>]
 *
 * 幂等语义：产物 = 对同一 target 的逐字节确定输出（全部文件来自本脚本内嵌模板，版本精确
 * 钉死）。target 非空拒绝（--force 先清空再装）；对同一空 target 重复执行产出一致。
 * pnpm install 结果（node_modules/pnpm-lock.yaml）不计入幂等承诺（依赖解析有传输面抖动），
 * 但直接依赖全部精确钉版（无 ^~），锁文件首次生成后复装幂等。
 *
 * 公平性声明（protocol §2 / §8.3）：本基线 = Next.js 的**最小惯用形态**——App Router + TS +
 * Drizzle/SQLite + zod 契约单源 + 一个 GET/POST Route Handler 对 + 一个仅列表无提交入口的
 * 客户端组件。不含任何"帮忙/坑人"的偏置件：没有 live 推送（task2 由解题者装配）、没有
 * priority 列（task1 由解题者迁移）、没有乐观对账、没有 SSE 脚手架。唯一超出裸骨架的件是
 * 评分可驱动面所必需的：①成对可逆迁移器 scripts/db.mjs（判据 S 类要求 up→down→up 干跑，
 * drizzle-kit 无 down 生成，故基线自带极小成对口径——等价于 atelier 臂基线的 migrate）；②
 * zod 契约 + 输出校验（等价于 atelier 臂的端点契约校验与 dev 态输出校验，是 M5/M6 判据的
 * 语义载体）；③DOM 评分钩子 data-note-id（C 类 DOM 钩子契约的测量面，非功能代码）。
 * 基线与 atelier 臂基线的逐项等价对表与已知差异 = 有效威胁清单，见 ../next/README.md。
 *
 * task3 变体（--variant task3）：注入与 atelier 臂同构的种子缺陷——002_add_priority 迁移
 * 只有 up 侧且已应用（库已有 priority 列、schema.ts 已声明），down 侧缺失；端点契约与前端
 * 尚未消费 priority。自检会验证缺陷在位（db.mjs verify 必须 exit 1）。
 *
 * 自检（默认开启，--no-check 跳过）：tsc --noEmit 绿 → 起 next dev（随机端口）→
 * GET /api/notes 返回种子 2 行 → 收尾杀进程。task3 变体另验缺陷在位。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* 内嵌基线模板（逐字节冻结口径；改任何模板须重跑 --emit-manifest 并评审） */
/* ------------------------------------------------------------------ */

const T_PACKAGE_JSON = `{
  "name": "__APP_NAME__",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "predev": "node scripts/db.mjs up && node scripts/db.mjs seed",
    "dev": "next dev",
    "build": "next build",
    "prestart": "node scripts/db.mjs up && node scripts/db.mjs seed",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "db:migrate": "node scripts/db.mjs up",
    "db:seed": "node scripts/db.mjs seed",
    "db:verify": "node scripts/db.mjs verify"
  },
  "dependencies": {
    "better-sqlite3": "12.11.1",
    "drizzle-orm": "0.44.7",
    "next": "15.5.25",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@eslint/eslintrc": "3.3.7",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "24.13.6",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "drizzle-kit": "0.31.10",
    "eslint": "9.39.5",
    "eslint-config-next": "15.5.25",
    "jsdom": "26.1.0",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  }
}
`;

// pnpm ≥10/11 不再读 package.json 的 pnpm 字段：构建脚本白名单的唯一生效位是本文件
// （better-sqlite3 的 prebuild-install 与 esbuild/unrs-resolver 的安装脚本需要放行）
const T_PNPM_WORKSPACE = `onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
  - unrs-resolver
allowBuilds:
  better-sqlite3: true
  esbuild: true
  unrs-resolver: true
`;

const T_TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const T_NEXT_ENV = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;

const T_NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是 native 模块：必须声明为 server 外部包，不进 server bundle
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
`;

const T_ESLINT_CONFIG = `import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "data/**", "scripts/**", "next-env.d.ts", "m3fs-c-acceptance.spec.tsx"],
  },
];

export default eslintConfig;
`;

const T_VITEST_CONFIG = `import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig 的 jsx: "preserve" 是 Next 的要求；测试转换用 automatic runtime 覆盖之
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
  test: {
    environment: "node",
  },
});
`;

const T_GITIGNORE = `node_modules/
.next/
data/
*.tsbuildinfo
`;

const T_SCHEMA_BASELINE = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// notes 表：与 atelier 臂基线同构列（id 自增主键 / body 非空 / createdAt epoch ms）
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});
`;

const T_SCHEMA_TASK3 = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// notes 表：与 atelier 臂基线同构列（id 自增主键 / body 非空 / createdAt epoch ms）
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  priority: integer("priority").notNull().default(0),
});
`;

const T_DB_INDEX = `import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const dbPath = process.env.APP_DB_PATH ?? path.join(process.cwd(), "data", "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export { schema };
`;

const T_CONTRACT = `import { z } from "zod";

// 契约单源：notes 的输入/输出契约（Route Handler 的唯一解析器来源，等价 atelier 臂 src/contract.ts）
export const createNoteInput = z.object({
  body: z.string().trim().min(1),
});

export const noteRow = z.object({
  id: z.number(),
  body: z.string(),
  createdAt: z.number(),
});

export const noteList = z.object({
  notes: z.array(noteRow),
});

export type CreateNoteInput = z.infer<typeof createNoteInput>;
export type NoteRow = z.infer<typeof noteRow>;
`;

const T_CONTRACT_TEST = `import { describe, expect, it } from "vitest";
import { createNoteInput, noteList } from "./contract";

// 基线契约守卫测试（T 类判据的最小载体；等价 atelier 臂基线的契约守卫测试）
describe("contract: notes", () => {
  it("createNoteInput 拒绝空 body", () => {
    expect(createNoteInput.safeParse({ body: "" }).success).toBe(false);
    expect(createNoteInput.safeParse({ body: "   " }).success).toBe(false);
  });

  it("createNoteInput 接受非空 body", () => {
    expect(createNoteInput.safeParse({ body: "hello" }).success).toBe(true);
  });

  it("noteList 接受合法列表帧", () => {
    expect(noteList.safeParse({ notes: [{ id: 1, body: "x", createdAt: 0 }] }).success).toBe(true);
  });
});
`;

const T_LAYOUT = `import type { ReactNode } from "react";

export const metadata = { title: "M3-FS next baseline" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
`;

const T_PAGE = `import NotesList from "@/components/NotesList";

export default function Home() {
  return (
    <main>
      <h1>Notes</h1>
      <NotesList />
    </main>
  );
}
`;

const T_NOTES_ROUTE = `import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { createNoteInput, noteList } from "@/lib/contract";

export const dynamic = "force-dynamic";

// GET /api/notes — 列表查询（打开页面时拉一次的静态快照；输出经契约校验）
export async function GET() {
  const rows = db.select().from(notes).orderBy(desc(notes.id)).all();
  const parsed = noteList.safeParse({ notes: rows });
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_OUTPUT", message: "输出不符合契约", fix: "检查 noteRow 契约与表列的一致性" },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}

// POST /api/notes — 创建笔记（契约违规 → 结构化 400：code/message/fix + issues）
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { code: "BAD_JSON", message: "请求体不是合法 JSON", fix: "以 application/json 提交 { body: string }" },
      { status: 400 },
    );
  }
  const parsed = createNoteInput.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_INPUT", message: "输入不符合契约", fix: "body 必须是非空字符串", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const inserted = db
    .insert(notes)
    .values({ body: parsed.data.body, createdAt: Date.now() })
    .returning()
    .get();
  return NextResponse.json(inserted, { status: 201 });
}
`;

const T_NOTES_LIST = `"use client";

import { useEffect, useState } from "react";

type Note = {
  id: number;
  body: string;
  createdAt: number;
};

// 最小惯用列表：打开页面时拉一次（GET /api/notes）；无提交入口（后续任务由解题者加）。
// data-note-id 是评分钩子（C 类 DOM 契约的测量面），不是功能代码。
export default function NotesList() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        setNotes(data.notes ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id} data-note-id={note.id}>
          {note.body}
        </li>
      ))}
      {loaded && notes.length === 0 ? <li>（暂无笔记）</li> : null}
    </ul>
  );
}
`;

const T_MIGRATION_001_UP = `-- 001_create_notes：notes 表基线（id 自增主键 / body 非空 / created_at epoch ms）
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const T_MIGRATION_001_DOWN = `-- 001 down：删除 notes 表（可逆性硬门槛）
DROP TABLE notes;
`;

const T_MIGRATION_002_UP = `-- 002_add_priority：既有行缺省 0（对已有数据的表加 NOT NULL 列必须带 DEFAULT）
ALTER TABLE notes ADD priority INTEGER NOT NULL DEFAULT 0;
`;

const T_MIGRATION_002_DOWN = `-- 002 down：移除 priority 列（SQLite 3.35+ 支持 DROP COLUMN）
ALTER TABLE notes DROP COLUMN priority;
`;

const T_SEED = `-- 种子：幂等（OR IGNORE），id 固定（1/2）便于评分断言；≥2 行
INSERT OR IGNORE INTO notes (id, body, created_at) VALUES
  (1, '第一条种子笔记：基线冒烟', 1700000000000),
  (2, '第二条种子笔记：live 对账起点', 1700000000001);
`;

const T_DB_MJS = `#!/usr/bin/env node
/**
 * scripts/db.mjs — 基线极小可逆迁移器（M3-FS next 臂冻结口径）。
 *
 * 为什么手写而不用 drizzle-kit migrate：drizzle-kit 生成单向迁移（无 down 侧），而本实验台
 * 的 S 类硬判据要求迁移可逆（成对 + up→down→up 影子库幂等干跑）。本文件只认
 * drizzle/migrations/ 下的成对文件 NNN_<name>.up.sql 与同 stem 的 .down.sql；不识别
 * drizzle-kit 的 0000_*.sql + meta/_journal.json 形态——如用 drizzle-kit 生成，请把产物
 * 整理成本口径（已应用文件不得改名或改动，否则 checksum 体检会红）。
 *
 * 命令：
 *   node scripts/db.mjs up    [--db <file>] [--to <stem>]   应用未应用迁移（编号序，含 --to）
 *   node scripts/db.mjs down  [--db <file>] [--to <stem>|0]  回滚到 <stem> 之后（0 = 全回滚）
 *   node scripts/db.mjs seed  [--db <file>]                 应用 drizzle/seeds/*.sql（幂等）
 *   node scripts/db.mjs verify [--db <file>]                影子库干跑：成对 + up→down→up 幂等 + checksum
 *   node scripts/db.mjs query --db <file> --sql "<sql>"     只读查询（评分探针用）
 *
 * 状态表 _migrations(name, checksum, applied_at)：checksum = sha256(up 侧文件内容)。
 * 已应用迁移的 up 侧被改动 → up/verify 报 integrity 错并 exit 1（完整性体检）；
 * down 侧不在 checksum 口径内（缺什么补什么）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG_DIR = path.join(ROOT, "drizzle", "migrations");
const SEED_DIR = path.join(ROOT, "drizzle", "seeds");
const DEFAULT_DB = path.join(ROOT, "data", "app.db");

function argOf(k) {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function die(msg) {
  console.error("db.mjs: " + msg);
  process.exit(1);
}
function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function listMigrations() {
  if (!fs.existsSync(MIG_DIR)) die("缺迁移目录: " + MIG_DIR);
  const ups = fs
    .readdirSync(MIG_DIR)
    .filter(function (f) {
      return f.endsWith(".up.sql");
    })
    .sort();
  return ups.map(function (f) {
    const stem = f.slice(0, -".up.sql".length);
    return { stem: stem, up: path.join(MIG_DIR, f), down: path.join(MIG_DIR, stem + ".down.sql") };
  });
}

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  return db;
}

function ensureState(db) {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)");
}

function appliedMap(db) {
  const rows = db.prepare("SELECT name, checksum FROM _migrations").all();
  const m = new Map();
  for (const r of rows) m.set(r.name, r.checksum);
  return m;
}

function applyUp(db, opt) {
  opt = opt || {};
  ensureState(db);
  const applied = appliedMap(db);
  const to = opt.to;
  for (const m of listMigrations()) {
    if (to && m.stem > to) break;
    const sql = fs.readFileSync(m.up, "utf8");
    if (applied.has(m.stem)) {
      if (applied.get(m.stem) !== sha256(sql)) {
        die("integrity: 已应用迁移被改动（checksum 不符）: " + m.stem + "（已应用迁移永不重写）");
      }
      continue;
    }
    if (!fs.existsSync(m.down)) {
      console.warn("db.mjs: 警告 " + m.stem + " 缺 down 侧（up 可跑；down/verify 会红）");
    }
    db.transaction(function () {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)").run(m.stem, sha256(sql), Date.now());
    })();
    console.log("up: applied " + m.stem);
  }
}

function revertDown(db, opt) {
  opt = opt || {};
  ensureState(db);
  const applied = appliedMap(db);
  const to = opt.to === undefined || opt.to === null ? "0" : opt.to;
  const list = listMigrations()
    .filter(function (m) {
      return applied.has(m.stem) && (to === "0" || m.stem > to);
    })
    .sort(function (a, b) {
      return a.stem < b.stem ? 1 : -1;
    });
  for (const m of list) {
    if (!fs.existsSync(m.down)) die("缺 down 侧，拒绝回滚（先补 " + path.basename(m.down) + "）: " + m.stem);
    db.transaction(function () {
      db.exec(fs.readFileSync(m.down, "utf8"));
      db.prepare("DELETE FROM _migrations WHERE name = ?").run(m.stem);
    })();
    console.log("down: reverted " + m.stem);
  }
}

function applySeeds(db) {
  if (!fs.existsSync(SEED_DIR)) {
    console.log("seed: 无种子目录，跳过");
    return;
  }
  const files = fs
    .readdirSync(SEED_DIR)
    .filter(function (f) {
      return f.endsWith(".sql");
    })
    .sort();
  for (const f of files) {
    db.exec(fs.readFileSync(path.join(SEED_DIR, f), "utf8"));
    console.log("seed: applied " + f);
  }
}

async function verifyCmd(dbFile) {
  const missing = listMigrations()
    .filter(function (m) {
      return !fs.existsSync(m.down);
    })
    .map(function (m) {
      return m.stem;
    });
  if (missing.length) die("verify: 迁移不成对（缺 down 侧）: " + missing.join(", "));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-verify-"));
  const shadow = path.join(tmpDir, "shadow.db");
  try {
    if (fs.existsSync(dbFile)) {
      const src = new Database(dbFile);
      await src.backup(shadow);
      src.close();
    }
    const db = openDb(shadow);
    const snap = function () {
      return JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all());
    };
    applyUp(db, {});
    const afterUp = snap();
    revertDown(db, { to: "0" });
    applyUp(db, {});
    const afterRound = snap();
    db.close();
    if (afterUp !== afterRound) die("verify: up→down→up 后 schema 不等价（迁移不幂等）");
    console.log("verify: OK（成对 + 影子库 up→down→up 幂等 + checksum 体检通过）");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  const cmd = process.argv[2];
  const dbFile = argOf("--db") || DEFAULT_DB;
  if (cmd === "up") {
    const db = openDb(dbFile);
    applyUp(db, { to: argOf("--to") });
    db.close();
    return;
  }
  if (cmd === "down") {
    const db = openDb(dbFile);
    revertDown(db, { to: argOf("--to") });
    db.close();
    return;
  }
  if (cmd === "seed") {
    const db = openDb(dbFile);
    applySeeds(db);
    db.close();
    return;
  }
  if (cmd === "verify") {
    verifyCmd(dbFile);
    return;
  }
  if (cmd === "query") {
    const sql = argOf("--sql");
    if (!sql) die("query 需要 --sql");
    if (!fs.existsSync(dbFile)) die("库文件不存在: " + dbFile);
    const db = new Database(dbFile);
    const rows = db.prepare(sql).all();
    db.close();
    console.log(JSON.stringify(rows));
    return;
  }
  die("未知命令: " + cmd + "（可用: up | down | seed | verify | query）");
}

main();
`;

const T_BASELINE_MD = `# M3-FS next 基线（装配产物 · 冻结口径）

由 atelier/benchmarks/m3-fs/next/setup-baseline-next.mjs 装配。冻结口径与等价对表见
atelier/benchmarks/m3-fs/next/README.md（单一真相源），此处只留运行卡。

## 运行

    pnpm install        # 装依赖（直接依赖全部精确钉版）
    pnpm dev            # predev（迁移 up + 种子）后起 next dev
    pnpm test           # vitest（契约守卫）
    pnpm lint           # eslint
    pnpm exec tsc --noEmit

## 数据面

- 迁移：drizzle/migrations/NNN_*.up.sql 与同 stem .down.sql 成对（可逆硬门槛）；
  管理命令 = node scripts/db.mjs up | down --to <stem> | seed | verify | query。
- 库文件：data/app.db（WAL；APP_DB_PATH 可换路径）；predev 自动 up+seed。

## task3 变体注记（仅 --variant task3 装配的实例）

002_add_priority 迁移只有 up 侧且已应用（库里已有 priority 列、schema.ts 已声明），
down 侧缺失；端点契约与前端尚未消费 priority。这是待修复的种子缺陷，不是基线错误。
`;

/* ------------------------------------------------------------------ */
/* 装配                                                                */
/* ------------------------------------------------------------------ */

function die(msg, fix) {
  console.error("[m3fs-setup] error: " + msg + (fix ? "\nfix: " + fix : ""));
  process.exit(1);
}

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const has = (k) => argv.includes(k);

const variant = argOf("--variant") ?? "baseline";
if (!["baseline", "task3"].includes(variant)) die("未知 --variant: " + variant, "baseline | task3");
const targetArg = argOf("--target");
const manifestOnly = has("--manifest-only");
if (!targetArg && !manifestOnly) die("缺 --target <dir>", "例：node setup-baseline-next.mjs --target D:/tmp/m3fs-next-base");
const target = targetArg ? path.resolve(targetArg) : null;
if (target && ["/", "\\", path.parse(target).root].includes(target)) die("拒绝装配到根目录: " + target);
if (target && (target === HERE || path.relative(HERE, target) === "")) die("拒绝装配到基准目录自身");

// --emit-manifest <file>：从内嵌模板生成基线冻结 manifest（sha256），供 grade-next 对表
const emitManifest = argOf("--emit-manifest");
if (emitManifest) {
  const files = {
    "drizzle/migrations/001_create_notes.up.sql": T_MIGRATION_001_UP,
    "drizzle/migrations/001_create_notes.down.sql": T_MIGRATION_001_DOWN,
    "drizzle/migrations/002_add_priority.up.sql": T_MIGRATION_002_UP,
    "drizzle/migrations/002_add_priority.down.sql": T_MIGRATION_002_DOWN,
    "drizzle/seeds/001_seed_notes.sql": T_SEED,
  };
  const out = {};
  for (const [rel, content] of Object.entries(files)) {
    out[rel] = crypto.createHash("sha256").update(content).digest("hex");
  }
  const manifest = {
    note: "基线冻结 manifest——grade-next 用它做 001 零改动（task1 M2）与 task3 D1 的 sha256 对表。由 setup-baseline-next.mjs --emit-manifest 从内嵌模板生成；改模板必须重新生成并评审（公平性红线）。",
    files: out,
  };
  fs.mkdirSync(path.dirname(path.resolve(emitManifest)), { recursive: true });
  fs.writeFileSync(path.resolve(emitManifest), JSON.stringify(manifest, null, 2) + "\n");
  console.log("[m3fs-setup] manifest → " + path.resolve(emitManifest));
  if (manifestOnly) process.exit(0);
}

// 非空拒绝 / --force 清空
if (fs.existsSync(target)) {
  const entries = fs.readdirSync(target);
  if (entries.length > 0) {
    if (!has("--force")) {
      die("目标目录非空: " + target, "加 --force 先清空再装配（不可逆，自己确认路径）");
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
}
fs.mkdirSync(target, { recursive: true });
const appName = path.basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "m3fs-next-baseline";

const isTask3 = variant === "task3";
const schema = isTask3 ? T_SCHEMA_TASK3 : T_SCHEMA_BASELINE;

/** 相对路径 → 内容 的装配单（task3 变体差异在此收口） */
const files = [
  ["package.json", T_PACKAGE_JSON.replaceAll("__APP_NAME__", appName)],
  ["pnpm-workspace.yaml", T_PNPM_WORKSPACE],
  ["tsconfig.json", T_TSCONFIG_JSON],
  ["next-env.d.ts", T_NEXT_ENV],
  ["next.config.ts", T_NEXT_CONFIG],
  ["eslint.config.mjs", T_ESLINT_CONFIG],
  ["vitest.config.ts", T_VITEST_CONFIG],
  [".gitignore", T_GITIGNORE],
  ["BASELINE-NEXT.md", T_BASELINE_MD],
  ["drizzle/migrations/001_create_notes.up.sql", T_MIGRATION_001_UP],
  ["drizzle/migrations/001_create_notes.down.sql", T_MIGRATION_001_DOWN],
  ["drizzle/seeds/001_seed_notes.sql", T_SEED],
  ["scripts/db.mjs", T_DB_MJS],
  ["src/db/schema.ts", schema],
  ["src/db/index.ts", T_DB_INDEX],
  ["src/lib/contract.ts", T_CONTRACT],
  ["src/lib/contract.test.ts", T_CONTRACT_TEST],
  ["src/app/layout.tsx", T_LAYOUT],
  ["src/app/page.tsx", T_PAGE],
  ["src/app/api/notes/route.ts", T_NOTES_ROUTE],
  ["src/components/NotesList.tsx", T_NOTES_LIST],
];

if (isTask3) {
  // 种子缺陷：002 只有 up 侧且已应用（库的构建在自检步跑 up+seed 时落账）
  files.push(["drizzle/migrations/002_add_priority.up.sql", T_MIGRATION_002_UP]);
} 

for (const [rel, content] of files) {
  const abs = path.join(target, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
console.log("[m3fs-setup] 装配 " + files.length + " 个文件 → " + target + "（variant=" + variant + "）");

/* ---- pnpm install ---- */
const win = process.platform === "win32";
function run(cmdline, opts = {}) {
  const r = spawnSync(cmdline, {
    cwd: opts.cwd ?? target,
    encoding: "utf8",
    timeout: opts.timeout ?? 600000,
    shell: win,
    windowsHide: true,
    stdio: opts.inherit ? "inherit" : undefined,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

if (!has("--no-install")) {
  console.log("[m3fs-setup] pnpm install（首装需网络与 better-sqlite3 预编译产物，数分钟量级）…");
  let inst = run("pnpm install", { inherit: true, timeout: 900000 });
  // 原生绑定探针：better-sqlite3 的 prebuild 下载偶发中断（网络抖动）→ 缓存后 rebuild 重试
  const bindingProbe = () => run("node -e \"require('better-sqlite3'); console.log('binding ok')\"", { timeout: 60000 });
  for (let i = 0; i < 2 && bindingProbe().code !== 0; i++) {
    console.log("[m3fs-setup] better-sqlite3 原生绑定缺失 → pnpm rebuild better-sqlite3（重试 " + (i + 1) + "/2）…");
    run("pnpm rebuild better-sqlite3", { inherit: true, timeout: 600000 });
  }
  if (bindingProbe().code !== 0) {
    die("better-sqlite3 原生绑定不可用", "看上方输出；prebuild 下载/编译卡死时换环境或用 @libsql/client 等价重装（须改基线并重新评审）");
  }
  if (inst.code !== 0) die("pnpm install 失败（exit " + inst.code + "）", "看上方输出");
}

/* ---- 构建级自检：tsc → 起 dev → GET /api/notes == 种子 → 杀进程 ---- */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (win) {
    try { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch {}
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function selfCheck() {
  if (!has("--no-check")) {
    console.log("[m3fs-setup] 自检 1/3：tsc --noEmit …");
    const tsc = run("pnpm exec tsc --noEmit", { timeout: 300000 });
    if (tsc.code !== 0) {
      console.error((tsc.stdout || "") + (tsc.stderr || ""));
      die("tsc --noEmit 红", "基线模板必须零 TS 错误——这暴露的是装配缺陷，不是解题面");
    }

    console.log("[m3fs-setup] 自检 2/3：起 next dev（predev 迁移+种子）…");
    const port = await freePort();
    const child = spawn("pnpm dev", { cwd: target, env: { ...process.env, PORT: String(port) }, shell: win, windowsHide: true });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    const base = "http://127.0.0.1:" + port + "/api/notes";
    let ready = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(700);
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(base, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const j = await res.json();
          if (j && Array.isArray(j.notes)) { ready = j; break; }
        }
      } catch {}
    }
    try {
      if (!ready) {
        console.error(log.slice(-3000));
        die("dev server 未就绪或 /api/notes 未返回列表", "看日志：predev 迁移失败 / 端口被占 / 编译错误");
      }
      const ids = ready.notes.map((n) => Number(n.id)).sort();
      if (ids.join(",") !== "1,2") die("GET /api/notes 未返回种子 2 行（得: " + ids.join(",") + "）");
      console.log("[m3fs-setup] 自检 3/3：GET /api/notes == 种子 2 行 ✓");
    } finally {
      killTree(child);
      await sleep(500);
    }

    if (isTask3) {
      // 缺陷在位校验：verify 必须红（缺 down），up 侧 checksum 与状态表一致
      const ver = run("node scripts/db.mjs verify", { timeout: 60000 });
      if (ver.code === 0) die("task3 变体缺陷未在位：verify 意外通过", "002 down 侧必须缺失且 002 已应用");
      console.log("[m3fs-setup] task3 缺陷在位：verify 红（缺 down 侧）✓");
    }
  }

  console.log("");
  console.log("[m3fs-setup] 完成：" + target);
  console.log("  variant    = " + variant);
  console.log("  依赖钉版    = next 15.5.25 / react 19.3.0 / drizzle-orm 0.44.7 / better-sqlite3 12.11.1 / zod 3.25.76 / vitest 3.2.7 / ts 5.9.3");
  console.log("  运行        = cd " + target + " && pnpm dev  →  http://localhost:" + "PORT" + "（/api/notes）");
  console.log("  公平性      = 最小惯用形态，无偏置件；等价对表与威胁清单见 atelier/benchmarks/m3-fs/next/README.md");
}

await selfCheck();
