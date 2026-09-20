#!/usr/bin/env node
/**
 * grade.mjs — M3-FS 评分器（FS-10 执行半）：对单个 attempt 跑全类判据，落 m3fs-grade.json。
 *
 *   node atelier/benchmarks/m3-fs/grade.mjs --task <id> --attempt <appDir> [--out <file>]
 *     <id> = task1-column-change | task2-live-reconcile | task3-fullstack-rescue
 *
 * exit 0 = 全判据过；exit 1 = 有失败。结构化结果默认落 <attempt>/m3fs-grade.json
 * （--out 可改）；checks[].id 逐字用 brief 判据编号，category ∈ S|R|C|T（protocol §4.2）。
 *
 * 前置条件（不满足会在对应判据显式 FAIL，不打哑巴分）：
 *   - attempt 必须是已 `pnpm install` 的应用目录（T 类要跑 `pnpm test`；vendored runtime/server 在位）；
 *   - attempt 的 .atelier/dev.db 为基线装配态（001 已应用）。
 *
 * --baseline 场景说明：本评分器**不依赖** baseline 目录——全部判据只对 attempt 本身取证
 * （checksum 体检由迁移器对照库内状态表自证，D1 同理）。需要基线目录的是
 * negative-check.mjs（--baseline <基线应用目录>，见其头注）。
 *
 * 类别分工（与 harness/acceptance.spec.ts 的 R/C 类互补，结果由本文件合并成一份 grade.json）：
 *   S/T 类 → 本文件直接取证：
 *     · struct check / api-diff check / `pnpm test`（spawnSync，win32 一律 shell:true）；
 *     · regen 字节幂等（M6：快照 src/generated/api.ts → gen endpoint → 字节比对 → 有差原样归还，评分不改 attempt）；
 *     · 迁移干跑（M3/D1：把 attempt 的 .atelier/dev.db 拷到系统临时副本，对副本跑
 *       `migrate up/down/verify --db <副本>`，绝不碰原库；库内检查 node:sqlite 只读打开副本）；
 *     · 端点与 schema 内省（M1/M2：node 类型剥离动态 import attempt 的 schema.ts /
 *       endpoints/notes.ts，只读 def 元数据，不执行 handler）。
 *   R/C 类 → 一次 `pnpm exec vitest run benchmarks/m3-fs/harness/acceptance.spec.ts`
 *     （env 注入 ATELIER_M3FS_TASK / ATELIER_M3FS_ATTEMPT / ATELIER_M3FS_OUT，母本 m3 同款组织；
 *     spec 把逐判据结果写进 ATELIER_M3FS_OUT 指向的 JSON，本文件读入合并）。
 *
 * 判据→类别映射与 task3 编号合并规则见 harness/scenario-spec.md（单一文档锚）。
 * 复合判据拆行约定：brief 把多道门合并进一条编号时（M8 / task2-M3 / D2），按 S/T 两类拆成
 * 两行同 id 记录（pass = 两行全绿）；negative-check 的 expectedFailIds 以"该 id 任一行 fail
 * 即判据未过"语义匹配。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ATELIER = path.resolve(HERE, "..", ".."); // atelier/（框架目录——CLI 与 vitest 都从这里跑）
const CLI = path.join(ATELIER, "cli.mjs");

const TASKS = ["task1-column-change", "task2-live-reconcile", "task3-fullstack-rescue"];

const KEY_RE = /^(?:table:[A-Za-z0-9_]+|key:.+)$/; // §4.1 失效键语法（与 server/endpoints.ts 同口径）

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

/* ---------------- 小件 ---------------- */

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);

const task = argOf("--task");
const attempt = path.resolve(argOf("--attempt") ?? ".");
if (!TASKS.includes(task)) die(`unknown task "${task}"`, `one of: ${TASKS.join(", ")}`);
if (!fs.existsSync(attempt)) die(`attempt 目录不存在：${attempt}`, "attempt 必须是已装配并解完任务的应用目录");

let infraError = null;
const setInfra = (msg) => { infraError = infraError ?? msg; };

/** spawnSync 包装：win32 必须 shell:true（pnpm / `node x.ts` 均然，m3 grade.mjs 先例） */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 120000,
    shell: process.platform === "win32",
    cwd: opts.cwd ?? attempt,
    env: opts.env ?? process.env,
  });
  return { code: r.status, out: `${r.stdout ?? ""}`, err: `${r.stderr ?? ""}` };
}

const tail = (s, n = 4) => s.split("\n").map((l) => l.trim()).filter(Boolean).slice(-n).join(" | ");

const row = (id, category, desc, pass, detail) => ({ id, category, desc, pass: pass === true, ...(detail ? { detail } : {}) });

/** 动态 import attempt 内的 TS 模块（node ≥22.18 类型剥离；只读模块顶层 def 元数据） */
async function importAttemptTs(...rel) {
  return await import(url.pathToFileURL(path.join(attempt, ...rel)).href);
}

/** 在模块导出里找端点 def（kind/name/handler 形状——与 server/endpoints.ts EndpointDef 同构） */
function findDef(mod, name) {
  for (const v of Object.values(mod)) {
    if (v && (v.kind === "query" || v.kind === "command") && v.name === name && typeof v.handler === "function") return v;
  }
  return null;
}

/** live 声明规范化：true = 端点全名自键（§4.1 向后兼容形）；对象 = 显式 invalidate */
function invalidateKeysOf(def) {
  if (def.live === true) return [`key:${def.name}`];
  if (def.live && typeof def.live === "object") return Array.isArray(def.live.invalidate) ? def.live.invalidate : [];
  return [];
}

function allDefs(mod) {
  return Object.values(mod).filter((v) => v && (v.kind === "query" || v.kind === "command") && typeof v.handler === "function");
}

/* ---------------- S 类：内省（schema / 端点声明） ---------------- */

async function task1M1() {
  const desc = "schema.ts 的 notes 表含 priority 列（integer、notNull、default 0）";
  try {
    const mod = await importAttemptTs("src", "server", "db", "schema.ts");
    const t = Object.values(mod).find((v) => v && typeof v === "object" && v.name === "notes" && v.columns && Array.isArray(v.primaryKey));
    if (!t) return row("M1", "S", desc, false, "schema.ts 无 notes 表 def（table(\"notes\", …) 导出缺失）");
    const p = t.columns.priority;
    if (!p) return row("M1", "S", desc, false, "notes 表缺 priority 列");
    const ok = p.type === "integer" && p.notNull === true && p.default === 0;
    return row("M1", "S", desc, ok, ok ? undefined : `实际 = ${JSON.stringify(p)}`);
  } catch (e) {
    setInfra(`M1 schema 内省异常：${e.message}`);
    return row("M1", "S", desc, false, `schema.ts 无法加载：${e.message}`);
  }
}

async function task2M1() {
  const desc = "notes.list 声明 live 且失效键含 table:notes；notes.create 显式 emits 含 table:notes";
  try {
    const mod = await importAttemptTs("src", "server", "endpoints", "notes.ts");
    const q = findDef(mod, "notes.list");
    const c = findDef(mod, "notes.create");
    if (!q || !c) return row("M1", "S", desc, false, `端点缺失：notes.list=${!!q} notes.create=${!!c}（src/server/endpoints/notes.ts）`);
    const inv = invalidateKeysOf(q);
    const emits = c.emits ?? [];
    const ok = q.live != null && inv.includes("table:notes") && emits.includes("table:notes");
    return row("M1", "S", desc, ok, ok ? undefined : `invalidate=${JSON.stringify(inv)} emits=${JSON.stringify(emits)} live=${JSON.stringify(q.live ?? null)}`);
  } catch (e) {
    setInfra(`M1 端点内省异常：${e.message}`);
    return row("M1", "S", desc, false, `endpoints/notes.ts 无法加载：${e.message}`);
  }
}

async function task2M2() {
  const desc = "最终产物不含非法失效键（§4.1 语法 table:<name>|key:<串>；非法键注册期 ATR-314）";
  try {
    const mod = await importAttemptTs("src", "server", "endpoints", "notes.ts");
    const keys = allDefs(mod).flatMap((d) => [...invalidateKeysOf(d), ...(d.emits ?? [])]);
    const bad = keys.filter((k) => typeof k !== "string" || !KEY_RE.test(k));
    return row("M2", "S", desc, bad.length === 0, bad.length === 0 ? `全部 ${keys.length} 枚键合法` : `非法键：${bad.map((k) => JSON.stringify(k)).join(", ")}`);
  } catch (e) {
    setInfra(`M2 端点内省异常：${e.message}`);
    return row("M2", "S", desc, false, `endpoints/notes.ts 无法加载：${e.message}`);
  }
}

/* ---------------- S 类：迁移判据（M3 / D1——库副本干跑，绝不碰原库） ---------------- */

function notesRows(db) {
  return db.prepare("SELECT id, body, createdAt, priority FROM notes ORDER BY rowid").all()
    .map((r) => ({ id: String(r.id), body: String(r.body), createdAt: Number(r.createdAt), priority: r.priority === null ? null : Number(r.priority) }));
}

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name));
}

/** 把 attempt 的 dev.db 拷到临时副本；返回 null = 原库不存在 */
function copyDevDb() {
  const src = path.join(attempt, ".atelier", "dev.db");
  if (!fs.existsSync(src)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-grade-db-"));
  const file = path.join(dir, "dev-copy.db");
  fs.copyFileSync(src, file);
  return {
    file,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp 收尾失败不影响判定 */ }
    },
  };
}

function migrate(args) {
  return run(process.execPath, [CLI, "migrate", ...args, "--root", attempt], { timeout: 120000, cwd: ATELIER });
}

/** task1 M3：副本 up 得列且既有行=0 → down --to 001 列消失 → verify 干跑 exit 0 */
function task1M3() {
  const desc = "基线库副本：migrate up 得 priority 列且既有行=0；down --to 001 后列消失；verify exit 0";
  const copy = copyDevDb();
  if (!copy) return row("M3", "S", desc, false, "attempt 缺 .atelier/dev.db（基线未装配或未迁移）");
  const { file, cleanup } = copy;
  try {
    const up = migrate(["up", "--db", file]);
    if (up.code !== 0) return row("M3", "S", desc, false, `migrate up 失败：${tail(up.err || up.out)}`);
    const db = new DatabaseSync(file, { readOnly: true });
    const cols = columnsOf(db, "notes");
    const rows = notesRows(db);
    db.close();
    if (!cols.includes("priority")) return row("M3", "S", desc, false, `up 后 notes 列集缺 priority：${cols.join(", ")}`);
    const bad = rows.filter((r) => r.priority !== 0);
    if (bad.length > 0) return row("M3", "S", desc, false, `既有行 priority≠0：${JSON.stringify(bad.slice(0, 3))}`);
    const down = migrate(["down", "--to", "001", "--db", file]);
    if (down.code !== 0) return row("M3", "S", desc, false, `migrate down --to 001 失败：${tail(down.err || down.out)}`);
    const db2 = new DatabaseSync(file, { readOnly: true });
    const cols2 = columnsOf(db2, "notes");
    db2.close();
    if (cols2.includes("priority")) return row("M3", "S", desc, false, "down 后 priority 列仍在（down 未精确撤销 up）");
    const verify = migrate(["verify"]);
    if (verify.code !== 0) return row("M3", "S", desc, false, `migrate verify 失败（up→down→up 影子干跑）：${tail(verify.err || verify.out)}`);
    return row("M3", "S", desc, true, `up/down/verify 全过（副本干跑，${rows.length} 行既有数据 priority=0）`);
  } finally {
    cleanup();
  }
}

/** task3 M3（brief 修正语义：up 步骤 = 已应用状态保持一致）+ down --to 001 / verify 同样要过 */
function task3M3() {
  const desc = "已应用状态保持一致（副本 up 零待应用）；down --to 001 后列消失；verify exit 0";
  const copy = copyDevDb();
  if (!copy) return row("M3", "S", desc, false, "attempt 缺 .atelier/dev.db");
  const { file, cleanup } = copy;
  try {
    const db0 = new DatabaseSync(file, { readOnly: true });
    const cols0 = columnsOf(db0, "notes");
    db0.close();
    if (!cols0.includes("priority")) return row("M3", "S", desc, false, "副本库缺 priority 列（种子缺陷态被意外清除？）");
    const up = migrate(["up", "--db", file]);
    if (up.code !== 0) return row("M3", "S", desc, false, `migrate up 失败：${tail(up.err || up.out)}`);
    const down = migrate(["down", "--to", "001", "--db", file]);
    if (down.code !== 0) return row("M3", "S", desc, false, `migrate down --to 001 失败：${tail(down.err || down.out)}`);
    const db2 = new DatabaseSync(file, { readOnly: true });
    const gone = !columnsOf(db2, "notes").includes("priority");
    db2.close();
    if (!gone) return row("M3", "S", desc, false, "down 后 priority 列仍在（down 未精确撤销 up）");
    const verify = migrate(["verify"]);
    if (verify.code !== 0) return row("M3", "S", desc, false, `migrate verify 失败：${tail(verify.err || verify.out)}`);
    return row("M3", "S", desc, true, "up 零待应用 + down/verify 全过（副本干跑）");
  } finally {
    cleanup();
  }
}

/** task3 D1：种子缺陷修复而非绕过——verify（sha256 对状态表）+ down→up 往返数据面等价 */
function task3D1() {
  const desc = "002 up 侧与库内 checksum 一致（sha256 状态表）；down→up 往返后数据面等价；verify exit 0";
  const copy = copyDevDb();
  if (!copy) return row("D1", "S", desc, false, "attempt 缺 .atelier/dev.db");
  const { file, cleanup } = copy;
  try {
    const verify0 = migrate(["verify"]);
    if (verify0.code !== 0) return row("D1", "S", desc, false, `verify 失败（up 侧被改 = ATR-332 面或缺 down = ATR-331 面）：${tail(verify0.err || verify0.out)}`);
    const db0 = new DatabaseSync(file, { readOnly: true });
    const before = notesRows(db0);
    db0.close();
    const down = migrate(["down", "--to", "001", "--db", file]);
    if (down.code !== 0) return row("D1", "S", desc, false, `down --to 001 失败：${tail(down.err || down.out)}`);
    const up = migrate(["up", "--db", file]);
    if (up.code !== 0) return row("D1", "S", desc, false, `往返 up 失败：${tail(up.err || up.out)}`);
    const db1 = new DatabaseSync(file, { readOnly: true });
    const after = notesRows(db1);
    const cols = columnsOf(db1, "notes");
    db1.close();
    const core = (rs) => JSON.stringify(rs.map(({ priority, ...r }) => r));
    if (core(before) !== core(after)) {
      const d = before.find((r, i) => !after[i] || after[i].id !== r.id || after[i].body !== r.body || after[i].createdAt !== r.createdAt);
      return row("D1", "S", desc, false, `往返后数据面不等价（down 侧绕过式修复？）：${d ? JSON.stringify(d) : "行集变化"}`);
    }
    if (!cols.includes("priority")) return row("D1", "S", desc, false, "往返后 priority 列丢失（down 撤销了不该撤销的）");
    return row("D1", "S", desc, true, `verify 过 + down→up 往返 ${before.length} 行等价、priority 列复原`);
  } finally {
    cleanup();
  }
}

/* ---------------- S 类：迁移成对性（M2，文件级） ---------------- */

function task1M2() {
  const desc = "migrations 出现 002_*.up.sql + 同名 .down.sql 成对迁移（001 系零改动由 M3/D1 的 checksum 体检兜底）";
  const dir = path.join(attempt, "src", "server", "db", "migrations");
  if (!fs.existsSync(dir)) return row("M2", "S", desc, false, "缺 src/server/db/migrations 目录");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const stems = [...new Set(files.map((f) => f.replace(/\.(up|down)\.sql$/, "")))];
  const m2 = stems.find((s) => /^002_/.test(s));
  if (!m2) return row("M2", "S", desc, false, `无 002_* 迁移（现有：${stems.join(", ") || "空"}）`);
  const hasUp = files.includes(`${m2}.up.sql`);
  const hasDown = files.includes(`${m2}.down.sql`);
  return row("M2", "S", desc, hasUp && hasDown, hasUp && hasDown ? `${m2} 成对` : `${m2}：up=${hasUp} down=${hasDown}（缺 down = ATR-331 面）`);
}

/* ---------------- S 类：regen 字节幂等（M6） ---------------- */

function m6() {
  const desc = "src/generated/api.ts 经 regen 后 diff 为空（生成物零手改，契约同源）";
  const genFile = path.join(attempt, "src", "generated", "api.ts");
  if (!fs.existsSync(genFile)) return row("M6", "S", desc, false, "缺 src/generated/api.ts（未跑 gen endpoint）");
  const before = fs.readFileSync(genFile);
  const r = run(process.execPath, [CLI, "gen", "endpoint", "--root", attempt, "--mount", "/api"], { timeout: 120000, cwd: ATELIER });
  if (r.code !== 0) {
    fs.writeFileSync(genFile, before); // regen 失败不遗留半写产物
    return row("M6", "S", desc, false, `gen endpoint 失败：${tail(r.err || r.out)}`);
  }
  const ok = before.equals(fs.readFileSync(genFile));
  if (!ok) fs.writeFileSync(genFile, before); // 评分不改 attempt：字节有差则原样归还
  return row("M6", "S", desc, ok, ok ? "regen 字节幂等" : "regen 产物与在盘 api.ts 有字节差（手改或未 regen）");
}

/* ---------------- S/T 类：门禁命令 ---------------- */

function structApiDiffRow(id) {
  const desc = "struct check exit 0（八层无 ERROR）且 api-diff check exit 0（无未豁免 breaking；snapshot 可按既定流程刷新）";
  const st = run(process.execPath, [CLI, "struct", "check", "--root", attempt], { timeout: 120000, cwd: ATELIER });
  if (st.code !== 0) return row(id, "S", desc, false, `struct check exit ${st.code}：${tail(st.out || st.err, 5)}`);
  const ad = run(process.execPath, [CLI, "api-diff", "check", "--root", attempt], { timeout: 120000, cwd: ATELIER });
  if (ad.code !== 0) return row(id, "S", desc, false, `api-diff check exit ${ad.code}：${tail(ad.out || ad.err, 5)}`);
  return row(id, "S", desc, true, "struct + api-diff 双绿");
}

function pnpmTestRow(id) {
  const desc = "应用 pnpm test 全绿（契约/样式守卫）";
  const r = run("pnpm", ["test"], { timeout: 300000 });
  return row(id, "T", desc, r.code === 0, r.code === 0 ? "应用测试全绿" : `exit ${r.code}：${tail(r.out || r.err, 5)}`);
}

/* ---------------- R/C 类：一次 vitest run（acceptance.spec.ts） ---------------- */

/** 每任务 R/C 判据清单：[id, category, desc]——desc 与 acceptance.spec / scenario-spec 同文 */
const RC = {
  "task1-column-change": [
    ["M4", "R", "notes.create 输入契约含可选 priority（0-9）；带 priority 调用落库值一致；省略按 0"],
    ["M5", "R", "notes.list 返回行含 priority（dev 态输出校验不红 = HTTP 200）"],
    ["M7", "C", "前端组件渲染优先级（挂载后行内可见既有行 priority 值）"],
  ],
  "task2-live-reconcile": [
    ["R1", "R", "SSE 订阅列表 live 通道，首连收到全量 data 帧"],
    ["R2", "R", "POST 成功创建（客户端 id）后 ≤1s 窗口内同一订阅收到含该 id 的 data 帧"],
    ["R3", "R", "POST 违规输入收到 ATR-201 四段式，且 live 通道无新帧、订阅保持"],
    ["C1", "C", "成功提交：待定项出现→推送窗口后列表含该 id 且仅一次、状态已确认"],
    ["C2", "C", "失败提交：待定项消失、回滚名单含该 id、错误态含 fix 可见"],
  ],
  "task3-fullstack-rescue": [
    ["M4", "R", "notes.create 输入契约含可选 priority（0-9）；带 priority 调用落库值一致；省略按 0"],
    ["M5", "R", "notes.list 返回行含 priority（dev 态输出校验不红 = HTTP 200）"],
    ["M7", "C", "前端组件渲染优先级（挂载后行内可见既有行 priority 值）"],
    ["R1", "R", "SSE 订阅列表 live 通道，首连收到全量 data 帧"],
    ["R2", "R", "POST 成功创建（客户端 id）后 ≤1s 窗口内同一订阅收到含该 id 的 data 帧"],
    ["R3", "R", "POST 违规输入收到 ATR-201 四段式，且 live 通道无新帧、订阅保持"],
    ["C1", "C", "成功提交：待定项出现→推送窗口后列表含该 id 且仅一次、状态已确认"],
    ["C2", "C", "失败提交：待定项消失、回滚名单含该 id、错误态含 fix 可见"],
  ],
};

/** 跑一次 acceptance.spec，返回 {id: checkRow}；spec 未产出结果 = 基础设施错误（非判据失败） */
function runRcChecks(taskId) {
  const want = RC[taskId];
  const map = Object.fromEntries(want.map(([id, category, desc]) => [id, row(id, category, desc, false, "harness 未产出结果（基础设施错误，非判据失败）")]));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-grade-rc-"));
  const outFile = path.join(tmpDir, "rc-results.json");
  try {
    const r = spawnSync("pnpm", ["exec", "vitest", "run", "benchmarks/m3-fs/harness/acceptance.spec.ts"], {
      cwd: ATELIER,
      env: { ...process.env, ATELIER_M3FS_TASK: taskId, ATELIER_M3FS_ATTEMPT: attempt, ATELIER_M3FS_OUT: outFile },
      encoding: "utf8",
      timeout: 300000,
      shell: process.platform === "win32",
    });
    let produced = null;
    try {
      produced = JSON.parse(fs.readFileSync(outFile, "utf8"));
    } catch {
      produced = null;
    }
    if (!produced || !Array.isArray(produced.checks)) {
      setInfra(`R/C harness 未产出结果（vitest exit ${r.status}）——${want.map(([id]) => id).join("/")} 无法诚实判定`);
      return map;
    }
    for (const c of produced.checks) {
      if (map[c.id]) map[c.id] = { id: c.id, category: c.category, desc: c.desc, pass: c.pass === true, ...(c.detail ? { detail: c.detail } : {}) };
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* temp 收尾 */ }
  }
  return map;
}

/* ---------------- 主流程 ---------------- */

const rc = runRcChecks(task);
const rcRow = (id) => rc[id];
const checks = [];

if (task === "task1-column-change") {
  checks.push(await task1M1());
  checks.push(task1M2());
  checks.push(task1M3());
  checks.push(rcRow("M4"), rcRow("M5"), rcRow("M7"));
  checks.push(m6());
  checks.push(structApiDiffRow("M8")); // S 半：struct + api-diff
  checks.push(pnpmTestRow("M8")); // T 半：pnpm test（M8 复合判据拆行，pass = 两行全绿）
} else if (task === "task2-live-reconcile") {
  checks.push(await task2M1());
  checks.push(await task2M2());
  checks.push(rcRow("R1"), rcRow("R2"), rcRow("R3"), rcRow("C1"), rcRow("C2"));
  checks.push(structApiDiffRow("M3")); // S 半
  checks.push(pnpmTestRow("M3")); // T 半（M3 复合判据拆行）
} else {
  // task3：判据 = task1（M1-M8）∪ task2（M1-M3、R1-R3、C1-C2）∪ D1/D2。
  // 编号冲突合并（同类别双源 → 一行双语义；M8 的门禁半已覆盖 task2-M3 的 S 半，T 半同源）：
  // 合并规则见表 harness/scenario-spec.md「判据编号↔类别映射表」。
  const m1a = await task1M1();
  const m1b = await task2M1();
  checks.push(
    row("M1", "S", "task1-M1 schema priority 列（integer/notNull/default 0）∧ task2-M1 live/emits 失效键 table:notes", m1a.pass && m1b.pass, `[schema] ${m1a.detail ?? "ok"} / [live] ${m1b.detail ?? "ok"}`),
  );
  const m2a = task1M2();
  const m2b = await task2M2();
  checks.push(
    row("M2", "S", "task1-M2 002 成对迁移 ∧ task2-M2 无非法失效键（001 系零改动由 M3/D1 checksum 兜底）", m2a.pass && m2b.pass, `[pair] ${m2a.detail ?? "ok"} / [keys] ${m2b.detail ?? "ok"}`),
  );
  checks.push(task3M3());
  checks.push(rcRow("M4"), rcRow("M5"));
  checks.push(m6());
  checks.push(rcRow("M7"));
  const m8s = structApiDiffRow("M8");
  checks.push(m8s);
  checks.push(rcRow("R1"), rcRow("R2"), rcRow("R3"), rcRow("C1"), rcRow("C2"));
  const m8t = pnpmTestRow("M8"); // T 半殿后（与 task1 行序一致）
  checks.push(m8t);
  checks.push(task3D1());
  const d2ok = m8s.pass && m8t.pass; // D2 与 M8 同源取证（struct 含 7/8 层 + pnpm test），语义 = 完成态全绿
  checks.push(
    row("D2", "S", "全部完成态 struct check exit 0（含数据契约层与 server 边界层）且应用 pnpm test 全绿（命令与 M8 同源取证）", d2ok, d2ok ? "struct + pnpm test 双绿（同 M8 取证）" : `[struct] ${m8s.detail ?? "ok"} / [test] ${m8t.detail ?? "ok"}`),
  );
}

/* ---------------- 落盘 ---------------- */

const pass = checks.filter((c) => c.pass).length;
const fail = checks.length - pass;
const ok = fail === 0 && infraError === null;
const grade = {
  ok,
  task,
  attempt: attempt.replaceAll("\\", "/"),
  at: new Date().toISOString(),
  ...(infraError ? { error: infraError } : {}),
  checks,
  summary: { pass, fail },
};
const outPath = argOf("--out") ?? path.join(attempt, "m3fs-grade.json");
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(grade, null, 2) + "\n", "utf8");
for (const c of checks) console.log(`  ${c.pass ? "✔" : "✘"} [${c.category}] ${c.id} — ${c.pass ? "pass" : c.detail ?? "fail"}`);
if (infraError) console.error(`[m3fs-grade] 基础设施错误（非判据失败）：${infraError}`);
console.log(`[m3fs-grade] ${task} ${path.basename(attempt)}: ${ok ? "PASS" : "FAIL"}（${pass}/${checks.length}）→ ${outPath}`);
process.exit(ok ? 0 : 1);
