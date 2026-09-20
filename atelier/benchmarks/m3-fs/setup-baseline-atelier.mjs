#!/usr/bin/env node
/**
 * setup-baseline-atelier.mjs — M3-FS 预接线全栈基线装配脚本（FS-10 执行半，protocol §2 的实现件）。
 *
 * 用法：
 *   node setup-baseline-atelier.mjs --target <dir> [--variant task3] [--atelier <框架仓库路径>]
 *                                    [--no-ai] [--force]
 *
 *   --target <dir>        应用根目录（attempt 骨架）。不存在或为空目录才允许；--force = 清空重装。
 *   --variant task3       基线完成后注入 task3 种子缺陷（半途状态，见下「变体」节）。
 *   --atelier <path>      框架仓库的 atelier/ 目录（缺省 = 本脚本所在位置向上两级，即本仓 atelier/）。
 *   --no-ai               透传给 `atelier init`：不装技能包/不落 AGENTS.md/llms.txt/specs
 *                         （RUNBOOK §1：noskill 臂必须用此形态；skill 臂用默认形态）。
 *   --force               目标目录非空时先清空再装（危险操作，脚本打印提示后执行）。
 *
 * 幂等语义（诚实口径）：本脚本**不是**幂等重入式——它只装「全新目录」：
 *   · 目标不存在 / 为空目录 → 全新装配（产物字节确定：种子 createdAt 为固定值、迁移内容固定）；
 *   · 目标非空 → 拒绝退出 2（绝不覆盖用户文件）；--force 显式清空后重装 = 与全新目录等价；
 *   · 中途失败会留下半成品目录——修复方式 = --force 重装（不提供断点续装）。
 *
 * 装配步骤 × protocol §2 逐项对应（步骤括号内 = §2 清单行）：
 *   S1  init 组装自包含应用（§2 前提：init 产物 + 预接线基线，两段式）
 *   S2  写 src/contract.ts：noteSchema 等契约常量          （§2 条目 1「noteSchema 契约常量」）
 *   S3  写 src/server/db/schema.ts：notes 表扁平定义       （§2 条目 2「notes 表三列」）
 *   S4  atelier gen db → 001_notes 成对迁移骨架 + crud     （§2 条目 3 前半「001 成对迁移」）
 *   S5  atelier migrate up → 001 已应用、状态表有账        （§2 条目 3「已应用（migrate up 已跑）」）
 *   S6  写种子 SQL + atelier migrate seed → ≥2 行          （§2 条目 3 后半「种子已入」+ 共享契约「≥2 行、幂等 UPSERT」）
 *   S7  写 src/server/endpoints/notes.ts 两端点            （§2 条目 4「notes.list / notes.create」）
 *   S8  atelier gen endpoint → src/generated/api.ts        （§2 条目 5「已生成」）
 *   S9  写 src/components/NotesPage.atr.ts 最小列表        （§2 条目 6「三元共置的最小版」；仅列表无提交入口）
 *   S10 接线 main-server.ts（db 注入）/main.ts（挂载）      —— §2 未列的装配胶水，基线可跑的必要件
 *   S10b runtime 单实例化 shim（vendor runtime → src/runtime 转发）
 *                                        —— RUNBOOK §1 红线「评分假阴性」的基线侧责任件
 *   S11 pnpm install                                        （共享契约「attempt = 已 pnpm install」）
 *   S12 全绿自检：pnpm test + struct check + api-diff snapshot/check（§2 条目 7「snapshot 已落」；
 *       「基线必须 init 即全栈可跑、struct/api-diff/test 全绿」——逐项打印，任一红 = 装配失败 exit 1）
 *   S13 [--variant task3] 注入半途状态（task3.brief 头注口径）：
 *       · 写 002_add_priority.up.sql（priority INTEGER NOT NULL DEFAULT 0）并 migrate up
 *         ——已应用、atelier_migrations 有账、库已有该列；
 *       · schema.ts 声明 priority 列（数据面 half 已到）；
 *       · 端点契约 / handler / 前端**不**消费 priority（下游 half 缺位——task1 参考解成果的
 *         「只做迁移一半」状态）；
 *       · 002 的 down 侧缺失（task3 考点本体 = 补 down，D1 口径：up 侧字节 + sha256 不得动）。
 *       注入后 struct check **预期**报 DB_MIGRATION_PAIR ERROR（不成对）——这是种子缺陷本体，
 *       脚本把它当「注入成功断言」核验，而非失败；其余层保持绿。
 *
 * 环境要求：node ≥22.18（原生 strip-types，框架同款要求）、pnpm、Git Bash/POSIX shell 兼容路径。
 * Windows 注意：已知的控制台中文乱码属 chcp 显示问题，不影响文件内容（UTF-8 落盘）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFAULT_ATELIER = path.resolve(HERE, "..", ".."); // benchmarks/m3-fs → atelier/（框架目录）

/* ---------------- CLI 解析 ---------------- */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const target = flag("target");
const variant = flag("variant") ?? "baseline";
const atelierDir = path.resolve(flag("atelier") ?? DEFAULT_ATELIER);
const force = hasFlag("force");
const noAi = hasFlag("no-ai");

function die(msg, code = 2) {
  console.error(`[setup-baseline] 错误：${msg}`);
  process.exit(code);
}
function say(msg) {
  console.log(`[setup-baseline] ${msg}`);
}

if (!target) die("缺 --target <dir>（应用根目录）");
if (variant !== "baseline" && variant !== "task3") die(`未知 --variant：${variant}（baseline | task3）`);
const cliPath = path.join(atelierDir, "cli.mjs");
if (!fs.existsSync(cliPath)) die(`框架 CLI 不存在：${cliPath}（用 --atelier 指定 atelier/ 目录）`);

const targetDir = path.resolve(target);
const name = pascal(path.basename(targetDir));
if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) die(`目标目录名 ${path.basename(targetDir)} 无法派生合法应用名（须字母开头）`);

function pascal(s) {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .replace(/^[0-9]+/, "");
}

/* 目标目录守卫：不存在或为空才放行；--force 清空重装 */
if (fs.existsSync(targetDir)) {
  const entries = fs.readdirSync(targetDir);
  if (entries.length > 0 && !force) {
    die(`目标目录非空：${targetDir}（${entries.length} 项）。--force = 清空重装`, 2);
  }
  if (entries.length > 0 && force) {
    say(`--force：清空 ${targetDir}`);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

const step = (label) => say(`── ${label}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? targetDir, encoding: "utf8", shell: opts.shell === true, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    console.error((r.stdout ?? "") + (r.stderr ?? ""));
    die(`命令失败（exit ${r.status}）：${cmd} ${args.join(" ")}`, 1);
  }
  return r;
}
/** pnpm 等宿主命令走 shell 单字符串形态（Windows 下 pnpm 是 .cmd；避免 args+shell 的 DEP0190） */
function runShell(commandline) {
  const r = spawnSync(commandline, { cwd: targetDir, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    console.error((r.stdout ?? "") + (r.stderr ?? ""));
    die(`命令失败（exit ${r.status}）：${commandline}`, 1);
  }
  return r;
}
const cli = (...args) => run(process.execPath, [cliPath, ...args]);
function write(rel, content) {
  const abs = path.join(targetDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  say(`     写 ${rel}（${Buffer.byteLength(content)} B）`);
}
function remove(rel) {
  const abs = path.join(targetDir, rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { force: true });
    say(`     删 ${rel}`);
  }
}

/* ================================================================
 * S1 init
 * ================================================================ */
step("S1 init 组装应用骨架");
{
  fs.mkdirSync(targetDir, { recursive: true });
  const args = ["init", "--target", targetDir, "--name", name];
  if (noAi) args.push("--no-ai");
  run(process.execPath, [cliPath, ...args], { cwd: path.dirname(targetDir) });
}

/* ================================================================
 * S2 contract.ts（契约单源）— §2 条目 1
 * ================================================================ */
step("S2 写契约单源 src/contract.ts（noteSchema 等）");
write(
  "src/contract.ts",
  `/**
 * contract.ts — 端点契约单源（决策 6 扁平 schema；§2.1 三域契约统一形态）。
 * gen endpoint 扫描本文件的 export const 常量 + 端点声明，生成 src/generated/api.ts
 * 类型化客户端（FlatOf 投影以这里的常量为单源）——端点文件只 import、不内联契约。
 * 组件 props 契约不在此（组件 schema 跟组件走，三元共置）。
 */
import type { FlatSchema } from "./vendor/atelier/server/index.ts";

/* ---------- example.ts：app.ping（无契约）/ app.echo ---------- */

/** app.echo 输入契约（违规 → ATR-201 400） */
export const echoInput = {
  type: "object",
  reqProps: { message: { type: "string", min: 1 } },
} satisfies FlatSchema;

/** app.echo 输出契约（§2.3）：客户端 FlatOf 投影 + dev 态运行时校验 + OpenAPI 响应 schema 三用 */
export const echoOutput = {
  type: "object",
  reqProps: { echoed: { type: "string" }, length: { type: "number" }, time: { type: "string" } },
} satisfies FlatSchema;

/* ---------- notes 域：notes.list / notes.create（预接线基线，M3-FS 协议 §2） ---------- */

/** note 行契约（扁平 schema 单源）：notes 表（src/server/db/schema.ts）的行形状口径——
 *  notes.create 的输出契约直接引用本常量（存什么返什么）。数组元素级的结构契约 v1 不表
 *  （扁平红线：约束只挂叶子），列表行形状由 notes.list handler 单点构造保证。 */
export const noteSchema = {
  type: "object",
  reqProps: { id: { type: "number" }, body: { type: "string", min: 1 }, createdAt: { type: "number" } },
} satisfies FlatSchema;

/** notes.create 输入契约：body 非空（违规 → ATR-201 400）；id 由服务端生成（自增主键） */
export const noteCreateInput = {
  type: "object",
  reqProps: { body: { type: "string", min: 1 } },
} satisfies FlatSchema;

/** notes.list 输出契约：顶层必须是对象（checkEndpointOutput 红线），列表收在 notes 数组属性里 */
export const noteListOutput = {
  type: "object",
  reqProps: { notes: { type: "array" } },
} satisfies FlatSchema;
`,
);

/* ================================================================
 * S3 schema.ts（数据契约）— §2 条目 2
 * ================================================================ */
step("S3 写数据契约 src/server/db/schema.ts（notes 表）");
write(
  "src/server/db/schema.ts",
  `/**
 * schema.ts — 数据契约单源（FS-DESIGN §5.1）：table() 扁平字面量定义，
 * gen db 扫描本文件产出 tables/crud/迁移骨架；行形状经 rowSchema 与端点契约同规范。
 * 注记：gen-db 扫描器对字面量内部的尾注注释不识别（纯文本扫描边界）——注记写在字面量外。
 * id = INTEGER PK（rowid 别名，自增语义）；createdAt = epoch ms（§5.1：时间 = integer ms）。
 */
import { table } from "../../vendor/atelier/server/db.ts";

export const notes = table("notes", {
  id: { type: "integer", primaryKey: true },
  body: { type: "text", notNull: true },
  createdAt: { type: "integer", notNull: true },
});
`,
);

/* ================================================================
 * S4/S5 gen db + migrate up — §2 条目 3 前半
 * ================================================================ */
step("S4 gen db（001_notes 成对迁移骨架 + tables/crud）");
cli("gen", "db", "--root", targetDir);

step("S5 migrate up（001 已应用，状态表有账）");
cli("migrate", "up", "--root", targetDir);

/* ================================================================
 * S6 种子 — §2 条目 3 后半（≥2 行，幂等 UPSERT）
 * ================================================================ */
step("S6 写 SQL 种子 + migrate seed（≥2 行）");
remove("src/server/db/seeds/001_example.seed.sql");
write(
  "src/server/db/seeds/001_notes.seed.sql",
  `-- notes 种子（D-F17 幂等 UPSERT）：基线 ≥2 行，供列表/影响面演示与评分断言既有行。
-- createdAt 为固定 epoch ms（字节确定性：重复装配产物一致，评分断言可依赖）。
INSERT INTO notes (id, body, createdAt) VALUES (1, 'first seeded note', 1726900000000)
  ON CONFLICT(id) DO UPDATE SET body = excluded.body, createdAt = excluded.createdAt;
INSERT INTO notes (id, body, createdAt) VALUES (2, 'second seeded note', 1726900001000)
  ON CONFLICT(id) DO UPDATE SET body = excluded.body, createdAt = excluded.createdAt;
`,
);
cli("migrate", "seed", "--root", targetDir);

/* ================================================================
 * S7 端点对 — §2 条目 4（notes.list query / notes.create command）
 * ================================================================ */
step("S7 写端点 src/server/endpoints/notes.ts（无 live 无 emits）");
write(
  "src/server/endpoints/notes.ts",
  `/**
 * notes.ts — 预接线基线端点对（M3-FS 协议 §2）：SQLite notes 表的读/写二分。
 * notes.list：query——全部行按 id 升序（无 live 声明：打开页面时拉一次的静态快照）。
 * notes.create：command——入参 { body }（契约校验违规 → ATR-201 400）；id 由服务端生成
 *   （自增主键 lastInsertRowid）；无 live 无 emits 声明（基线形态——live/失效键是后续任务的考点）。
 * 端点命名惯例：notes. 点分命名空间；注册去哪？见 ../main-server.ts 装配点。
 */
import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { noteCreateInput, noteListOutput, noteSchema } from "../../contract.ts";

type NoteRow = { id: number; body: string; createdAt: number };

/** query：POST <mount>/notes.list——全量列表，id 升序 */
export const noteList = defineQuery("notes.list", {
  output: noteListOutput,
  handler: (_input, ctx) => {
    const notes = ctx.db.prepare("SELECT id, body, createdAt FROM notes ORDER BY id ASC").all() as NoteRow[];
    return { notes };
  },
});

/** command：POST <mount>/notes.create——参数化插入（决策 19 红线），服务端生成 id */
export const noteCreate = defineCommand<{ body: string }, NoteRow>("notes.create", {
  contract: noteCreateInput,
  output: noteSchema,
  auth: { type: "none" }, // 显式声明（struct 层 7 消警口径）：基线不设鉴权
  handler: (input, ctx) => {
    const createdAt = Date.now();
    const r = ctx.db.prepare("INSERT INTO notes (body, createdAt) VALUES (?, ?)").run(input.body, createdAt);
    const row: NoteRow = { id: Number(r.lastInsertRowid), body: input.body, createdAt };
    ctx.audit(\`notes.create id=\${row.id}（notes 共 \${String(ctx.db.prepare("SELECT COUNT(*) AS n FROM notes").get()?.n ?? "?")} 行）\`);
    return row;
  },
});
`,
);

/* ================================================================
 * S8 gen endpoint — §2 条目 5
 * ================================================================ */
step("S8 gen endpoint（src/generated/api.ts）");
cli("gen", "endpoint", "--root", targetDir);

/* ================================================================
 * S9/S10 前端与装配胶水 — §2 条目 6
 * ================================================================ */
step("S9 写 NotesPage 最小列表消费（仅列表，无提交入口）");
write(
  "src/components/NotesPage.atr.ts",
  `/**
 * NotesPage.atr.ts — 预接线基线最小列表消费（M3-FS 协议 §2：三元共置的最小版）。
 * 数据面：src/generated/api.ts 的 notesList 客户端（gen endpoint 产物）——打开页面拉一次的
 * 静态快照；无提交入口、无 live 订阅（这些是后续任务的增量考点）。
 * 异步纪律（ATR-323）：异步收敛在三态原语边界——loadInitial 在组件体触发、streamValue 承接，
 * 模板表达式只读同步信号。
 * 表达式纪律（ATR-301）：模板表达式不支持函数调用与可选链（?.）——行集/计数经 $derived
 * 预计算，模板只读 .value 与属性链。
 * 评分钩子：每行携带 data-note-id="<id>"。
 * 三元共置：实现（本文件）/ 意图验收（NotesPage.atr.md）。
 */
import { $derived, $state, component, html, streamValue } from "../runtime";
import { notesList } from "../generated/api";

type NoteRow = { id: number; body: string; createdAt: number };
type NotesFrame = { notes: NoteRow[] };

export const notesPageSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
} as const;

export const NotesPage = component(function NotesPage(props: { title: string }) {
  const list = streamValue<NotesFrame>();
  const loadError = $state<string | null>(null);

  const loadInitial = async (): Promise<void> => {
    try {
      const frame = await notesList.call({}); // 非 2xx 抛 ATR 四段式
      list.push(frame);
      list.finish();
    } catch (e) {
      const atr = e as { code?: string; message?: string; fix?: string };
      loadError.value = \`\${atr.code ?? "ATR-NET"}: \${atr.message ?? String(e)} — fix: \${atr.fix ?? "确认 server 面在跑（pnpm dev 已托管 /api）"}\`;
    }
  };
  void loadInitial(); // 异步在边界触发（模板表达式零异步）

  // 模板表达式子集（ATR-301）的预计算面
  const rows = $derived<NoteRow[]>(() => list.value?.notes ?? []);
  const count = $derived<number>(() => rows.value.length);
  const rowCls = "flex items-center gap-sm py-xs border-b border-surface-2 text-sm";

  return html\`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <p class="text-muted text-sm">共 {count.value} 条（静态快照——打开页面时拉一次）</p>
      {#if loadError.value}
        <div class="rounded-sm p-sm my-xs border border-danger text-sm text-danger">{loadError.value}</div>
      {/if}
      <ul class="list-none m-0 p-0">
        {#each rows.value as row}
          <li class={rowCls} data-note-id={row.id}>
            <span>{row.body}</span>
            <span class="flex-1"></span>
            <span class="text-muted text-xs">{row.createdAt}</span>
          </li>
        {/each}
      </ul>
    </div>
  \`.locals({ props, rows, count, loadError, rowCls });
}, { name: "NotesPage", schema: notesPageSchema });
`,
);
write(
  "src/components/NotesPage.atr.md",
  `# NotesPage — 意图验收单（三元共置 · 最小版）

## 意图

笔记列表页：打开页面即从 server 面拉取一次全量列表并渲染（静态快照）。
基线形态（M3-FS 协议 §2）：只读列表，无提交入口、无 live 订阅。

## 验收（行为化）

1. 挂载后列表区出现 server 面返回的全部笔记行，每行可见笔记正文；
2. 每行携带 \`data-note-id="<id>"\`（评分钩子：按 id 定位行）；
3. server 面不可达时不白屏：错误信息（含 fix 提示）在列表区可见。

## 边界

- 快照在页面打开时拉一次，后续写操作不自动反映（live/对账是后续任务的考点）；
- 行样式全走 token 工具类（决策 16），不引入新颜色。
`,
);

step("S10 接线装配点（main-server.ts 注入 db / main.ts 挂载 NotesPage / 移除模板 live 示例）");
write(
  "src/server/main-server.ts",
  `/**
 * main-server.ts — server 面装配点（FS-7 dev 托管子进程入口）。
 * dev 面 vite 插件把本文件作为子进程托管（/api/* 反代至此，src/server/** 变更热重启）；
 * 未来自托管/生产部署的启动壳同形态：显式注册 → createHandler 装配 → serve 监听。
 * 直接运行：node src/server/main-server.ts
 *
 * env（dev 插件父进程注入，均可缺省）：
 *   ATELIER_SERVER_PORT  — 监听端口，"0" = 自动分配；缺省 5174（§11.1 邻位约定）
 *   ATELIER_SERVER_MOUNT — 端点挂载前缀；缺省 "/api"
 *   ATELIER_DB_PATH      — SQLite dev 库路径；缺省 .atelier/dev.db
 *
 * 就绪握手：listen 成功后由框架 serve() 向 stdout 打印恰好一行
 *   ATELIER_SERVER_READY {"port":<实际端口>} —— 模板不自己写，父进程按此探活。
 */
import { EndpointRegistry, openSqlite, serve } from "../vendor/atelier/server/index.ts";
import { echo, ping } from "./endpoints/example.ts";
import { noteCreate, noteList } from "./endpoints/notes.ts";

// 显式注册表（决策 18：无编译器魔法——端点一个一个 register，重复名 = ATR-313 直接红）
const registry = new EndpointRegistry();
registry.register(ping).register(echo);
registry.register(noteList).register(noteCreate);

// 装配点（§3.2）：无 DI 容器，依赖在入口明文注入。db = SQLite dev 库
//（迁移/种子见 src/server/db/：migrate up 已应用 001，种子经 migrate seed 入库）。
const db = await openSqlite(process.env.ATELIER_DB_PATH ?? ".atelier/dev.db");
const mount = process.env.ATELIER_SERVER_MOUNT ?? "/api";
const handler = registry.createHandler({ mount, db });

// 端口被占 → serve reject：打印诚实错误（含 fix 指路）后 exit(1)，绝不静默。
const port = Number(process.env.ATELIER_SERVER_PORT ?? 5174);
serve(handler, { port, host: "127.0.0.1" }).catch((e: unknown) => {
  console.error(\`[atelier] server 启动失败：127.0.0.1:\${port} —— \${(e as Error)?.message ?? String(e)}\`);
  console.error("[atelier] fix：改 atelier.config.json 的 server.port 换端口，或释放被占端口后重跑。");
  process.exit(1);
});
`,
);

// main.ts / manifest.json：init 产物是模板 vendor 拷贝（内容稳定）——锚点替换 + 硬断言
patchFile(
  "src/main.ts",
  [
    {
      anchor: 'import { LiveNotes } from "./components/LiveNotes.atr.ts"; // FS-7 live 直通 + §4.5 乐观对账演示',
      replacement: 'import { NotesPage } from "./components/NotesPage.atr.ts"; // 预接线基线：notes.list 静态快照列表（M3-FS §2）',
    },
    {
      anchor: `// FS-7 live 直通演示：streamValue + EventSource 手写直通（§4.4，与 gen endpoint 生成物同型）
// + optimisticList 乐观对账（§4.5 协议）。server 面对端：src/server/endpoints/notes.ts
//（app.notes live query + app.addNote command）；pnpm dev 已把 /api/* 托管到 server 子进程。
const liveSection = document.createElement("section");
liveSection.id = "live-demo";
app.appendChild(liveSection);
mountComponent(LiveNotes, { title: "Live Notes — live 直通 + 乐观对账" }, liveSection, registry, validate);`,
      replacement: `// 预接线基线（M3-FS 协议 §2）：notes 列表页——gen endpoint 产物 notesList 客户端的静态快照消费。
// server 面对端：src/server/endpoints/notes.ts（notes.list query + notes.create command，SQLite notes 表）；
// pnpm dev 已把 /api/* 托管到 server 子进程。
const notesSection = document.createElement("section");
notesSection.id = "notes-page";
app.appendChild(notesSection);
mountComponent(NotesPage, { title: "Notes — 预接线基线列表" }, notesSection, registry, validate);`,
    },
  ],
  "main.ts",
);
patchFile(
  "src/manifest.json",
  [
    {
      anchor: `{ "name": "LiveNotes", "file": "components/LiveNotes.atr.ts", "schema": {
        "type": "object",
        "reqProps": { "title": { "type": "string" } }
      }
    }`,
      replacement: `{ "name": "NotesPage", "file": "components/NotesPage.atr.ts", "schema": {
        "type": "object",
        "reqProps": { "title": { "type": "string" } }
      }
    }`,
    },
  ],
  "manifest.json",
);
remove("src/components/LiveNotes.atr.ts");
remove("src/components/LiveNotes.atr.md");
remove("src/components/LiveNotes.atr.spec.ts");

// S10b runtime 单实例化 shim（RUNBOOK §1 红线：「vendored 拷贝会被 vite 视为独立模块实例 →
// 信号跨实例不追踪 → 评分假阴性；基线脚本负责」）：
//   · init 产物有两份 runtime：src/runtime/（前端 canonical，组件经 "../runtime" 引用）
//     与 src/vendor/atelier/runtime/（gen endpoint 产物 api.ts 的 import 面）——两份字节相同
//     但模块身份不同，live 客户端的 streamValue 与组件侧 $state 会跨实例不追踪；
//   · 本脚本把 vendor runtime 入口改写为转发 shim（唯一被前端引用的文件是 index.ts——
//     gen-endpoint 生成面只有 streamValue），统一到 src/runtime 单实例；
//   · server 面（子进程独立 node 进程）不受影响：openSqlite/EndpointRegistry 走 vendor server 面。
write(
  "src/vendor/atelier/runtime/index.ts",
  `// @atelier-baseline（M3-FS 基线装配，S10b）—— runtime 单实例化 shim。
// 本文件原为 src/runtime 的 vendor 拷贝入口；基线将其改为对 canonical 拷贝的纯转发，
// 使 gen endpoint 产物（api.ts 的 streamValue）与组件面（"../runtime"）解析到同一模块实例
// ——防信号跨实例不追踪（live 对账假阴性）。换行：export * 同时转发值与类型。
export * from "../../../runtime/index.ts";
`,
);
say("     改 src/vendor/atelier/runtime/index.ts（单实例化转发 shim → src/runtime）");

function patchFile(rel, pairs, label) {
  const abs = path.join(targetDir, rel);
  if (!fs.existsSync(abs)) die(`init 产物缺 ${rel}——init 版本与装配脚本不匹配？（${label} 锚点替换失败）`);
  // 换行归一：仓库 checkout 可能带 CRLF（autocrlf）——锚点匹配与写盘统一 LF（字节确定性）
  let src = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  for (const { anchor, replacement } of pairs) {
    if (!src.includes(anchor)) die(`${rel} 中找不到预期锚点——init 版本与装配脚本不匹配，拒绝盲改`);
    src = src.replace(anchor, replacement);
  }
  fs.writeFileSync(abs, src, "utf8");
  say(`     改 ${rel}（锚点替换 ×${pairs.length}）`);
}

/* ================================================================
 * S11 pnpm install
 * ================================================================ */
step("S11 pnpm install");
runShell("pnpm install");

/* ================================================================
 * S12 全绿自检 — §2 条目 7 + 共享契约「全绿」
 * ================================================================ */
step("S12 自检：pnpm test / struct check / api-diff snapshot+check（逐项）");
runShell("pnpm test");
say("     [OK] pnpm test 全绿");

const structR = spawnSync(process.execPath, [cliPath, "struct", "check"], { cwd: targetDir, encoding: "utf8" });
if (structR.status !== 0) {
  console.error(structR.stdout + (structR.stderr ?? ""));
  die("struct check 红——基线装配失败", 1);
}
say("     [OK] struct check exit 0（八层无 ERROR）");

cli("api-diff", "snapshot", "--root", targetDir);
const apiR = spawnSync(process.execPath, [cliPath, "api-diff", "check", "--root", targetDir], { cwd: targetDir, encoding: "utf8" });
if (apiR.status !== 0) {
  console.error(apiR.stdout + (apiR.stderr ?? ""));
  die("api-diff check 红——基线装配失败", 1);
}
say("     [OK] api-diff snapshot 已落 + check exit 0（§2 条目 7）");

/* ================================================================
 * S13 [--variant task3] 半途状态注入
 * ================================================================ */
if (variant === "task3") {
  step("S13 [--variant task3] 注入种子缺陷（半途状态：迁移 up 已应用 + schema 已声明，下游未消费，down 缺失）");
  const upRel = "src/server/db/migrations/002_add_priority.up.sql";
  const downRel = "src/server/db/migrations/002_add_priority.down.sql";
  write(
    upRel,
    `-- 002_add_priority：notes 增加优先级列。NOT NULL 必须带 DEFAULT（既有行回填 0——
-- 对已有数据的表加 NOT NULL 列不带缺省值 = up 失败回滚，ATR-334 面）。
-- task3 种子缺陷口径（D1）：本文件字节 + sha256 属已应用迁移完整性口径，永不重写。
ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
`,
  );
  // 迁移器的 up 路径本身拒绝不成对迁移（ATR-331「up 在配齐前拒绝应用」）——注入顺序：
  // 先临时补 down → migrate up（002 已应用、状态表记 up 侧 checksum）→ 删除 down 侧，
  // 得到且仅得到 brief 口径的半途状态（up 已应用 + down 缺失；down 不在 checksum 口径内）。
  write(
    downRel,
    `-- 002_add_priority（临时配对件，migrate up 后由本脚本移除——注入「down 缺失」缺陷）
ALTER TABLE notes DROP COLUMN priority;
`,
  );
  // schema.ts 声明 priority 列（数据面 half 到位）
  const schemaRel = "src/server/db/schema.ts";
  const schemaAbs = path.join(targetDir, schemaRel);
  let schema = fs.readFileSync(schemaAbs, "utf8");
  const anchor = `  createdAt: { type: "integer", notNull: true },`;
  if (!schema.includes(anchor)) die("schema.ts 锚点缺失——装配产物与预期不符");
  schema = schema.replace(
    anchor,
    `${anchor}
  priority: { type: "integer", notNull: true, default: 0 }`,
  );
  fs.writeFileSync(schemaAbs, schema, "utf8");
  say(`     改 ${schemaRel}（priority 列声明）`);
  cli("gen", "db", "--root", targetDir); // 数据面生成物拉齐（tables/crud 含 priority）
  cli("migrate", "up", "--root", targetDir); // 002 已应用 + 状态表有账（up 侧 checksum）
  remove(downRel); // 缺陷本体：down 侧缺失

  // 注入断言（缺陷本体核验——不是失败）：
  const dbPath = path.join(targetDir, ".atelier", "dev.db");
  if (!fs.existsSync(dbPath)) die("注入后找不到 dev.db");
  const structV = spawnSync(process.execPath, [cliPath, "struct", "check"], { cwd: targetDir, encoding: "utf8" });
  const structOut = structV.stdout ?? "";
  const pairError = structOut.includes("DB_MIGRATION_PAIR") && structOut.includes("ERROR");
  say("     注入断言：");
  say(`       · 002 up 已应用（migrate up 零失败）        ${fs.existsSync(path.join(targetDir, upRel)) ? "[OK]" : "[FAIL]"}`);
  say(`       · down 侧缺失（task3 考点本体）             ${!fs.existsSync(path.join(targetDir, downRel)) ? "[OK]" : "[FAIL]"}`);
  say(`       · schema.ts 已声明 priority                  ${schema.includes("priority") ? "[OK]" : "[FAIL]"}`);
  say(`       · struct check 报 DB_MIGRATION_PAIR ERROR    ${pairError ? "[OK]（预期缺陷信号在位）" : "[FAIL]"}`);
  if (fs.existsSync(path.join(targetDir, downRel)) || !pairError) die("task3 变体注入断言未过——半途状态不完整", 1);
  say("     [--variant task3] 半途状态注入完成：端点契约/handler/前端未消费 priority（下游 half 缺位 = 任务起点）");
}

/* ================================================================
 * 完成
 * ================================================================ */
say("");
say(`完成：${variant === "task3" ? "task3 变体基线" : "标准基线"} @ ${targetDir}`);
say("起跑：cd <target> && pnpm dev（前端 http://127.0.0.1:5173 · server 面 http://127.0.0.1:5174 /api）");
say("单独起 server 面：node src/server/main-server.ts（stdout 打印 ATELIER_SERVER_READY 握手行）");
