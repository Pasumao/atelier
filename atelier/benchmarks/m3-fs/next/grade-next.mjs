#!/usr/bin/env node
/**
 * grade-next.mjs — M3-FS 对照臂（next）评分器：对单个 attempt 跑机械判据，落 m3fs-grade.json。
 *
 *   node atelier/benchmarks/m3-fs/next/grade-next.mjs --task <id> --attempt <appDir> [--out <file>]
 *
 * exit 0 = 全判据绿（ok:true）；exit 1 = 任一判据红。grade JSON 形状与 atelier 臂完全一致：
 *   { ok, task, attempt, at, checks:[{id,category:"S"|"R"|"C"|"T",desc,pass,detail?}], summary:{pass,fail}, tail? }
 * checks[].id 逐字用 brief 判据编号（M1..M8 / R1..R3 / C1..C2 / D1..D2）；task3 的判据表
 * = task1 ∪ task2（同号判据以 desc 前缀 [task1]/[task2] 区分，id 保持逐字）。
 *
 * 判据语义全同、实现分臂（protocol §4.2 明写的不对称）：
 * - S = tsc --noEmit 绿 + lint 绿 + drizzle 迁移成对且 up→down→up 影子库干跑幂等；
 * - R = 同语义场景黑盒（起 next dev 驱动 HTTP+SSE：首连全量、写后推送 ≤1s 窗口、
 *       违规输入结构化 400、失败路径无新推送且订阅保持）；
 * - C = jsdom + @testing-library/react 挂载 NotesList 驱动提交入口，断言语义同文；
 * - T = 应用 pnpm test 全绿。
 *
 * 评分确定性：评分开始即清空 attempt/data（库由 predev 从迁移+种子文件重建）——一切
 * S/迁移类判据只依赖 attempt 的文件态，不依赖解题者本地库历史。评分会在 attempt 内
 * 写入并删除 m3fs-c-acceptance.spec.tsx（C 类 harness），落盘 m3fs-grade.json（评分工件）。
 * 注意：attempt 路径含空格时 Windows shell 派生不可靠——attempt 请放无空格路径。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WIN = process.platform === "win32";
const SPEC_NAME = "m3fs-c-acceptance.spec.tsx";

const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, "baseline-manifest.json"), "utf8"));

function die(message, fix) {
  console.error("[m3fs-grade] error: " + message + (fix ? "\nfix: " + fix : ""));
  process.exit(1);
}

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const task = argOf("--task");
const attempt = path.resolve(argOf("--attempt") ?? ".");
if (!["task1-column-change", "task2-live-reconcile", "task3-fullstack-rescue"].includes(task)) {
  die('unknown task "' + task + '"', "one of: task1-column-change, task2-live-reconcile, task3-fullstack-rescue");
}
if (!fs.existsSync(attempt)) die("attempt 目录不存在: " + attempt);
if (/\s/.test(attempt)) die("attempt 路径含空格（Windows shell 派生不可靠）: " + attempt, "请把 attempt 放到无空格路径再评分");

const rel = (p) => path.join(attempt, p);
const read = (p) => (fs.existsSync(rel(p)) ? fs.readFileSync(rel(p), "utf8") : null);

/* ------------------------------------------------------------------ */
/* 进程工具                                                            */
/* ------------------------------------------------------------------ */

function q(a) {
  return /[\s"]/.test(a) ? '"' + a.replaceAll('"', '\\"') + '"' : a;
}
function run(cmdline, opts = {}) {
  const r = spawnSync(cmdline, {
    cwd: opts.cwd ?? attempt,
    env: opts.env ?? process.env,
    encoding: "utf8",
    timeout: opts.timeout ?? 180000,
    shell: WIN,
    windowsHide: true,
  });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!child || !child.pid || child.exitCode !== null) return;
  if (WIN) {
    try { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch {}
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
  }
}

/** 起 pnpm dev（predev 迁移+种子 → next dev），轮询 GET /api/notes 就绪。 */
async function bootServer() {
  const port = await freePort();
  const child = spawn("pnpm dev", { cwd: attempt, env: { ...process.env, PORT: String(port) }, shell: WIN, windowsHide: true });
  const logLines = [];
  const push = (s) => {
    for (const line of String(s).split(/\r?\n/)) {
      if (line.trim()) logLines.push(line);
    }
    if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  const hosts = ["127.0.0.1", "localhost"];
  const deadline = Date.now() + 180000;
  let base = null;
  while (Date.now() < deadline && child.exitCode === null) {
    await sleep(700);
    for (const h of hosts) {
      try {
        const res = await fetch("http://" + h + ":" + port + "/api/notes", { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const j = await res.json();
          if (j && Array.isArray(j.notes)) {
            base = "http://" + h + ":" + port;
            break;
          }
        }
      } catch {}
    }
    if (base) break;
  }
  return { child, port, base, logLines };
}

async function fetchJson(base, pathname, opts = {}) {
  const res = await fetch(base + pathname, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

/* ------------------------------------------------------------------ */
/* SSE 黑盒客户端（R 类）                                              */
/* ------------------------------------------------------------------ */

async function connectSSE(base, pathname) {
  const ac = new AbortController();
  const res = await fetch(base + pathname, {
    headers: { accept: "text/event-stream" },
    cache: "no-store",
    signal: ac.signal,
  });
  const frames = [];
  const contentType = res.headers.get("content-type") || "";
  let closed = !res.ok || !res.body;
  if (res.ok && res.body) {
    (async () => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          for (;;) {
            const m = /\r?\n\r?\n/.exec(buf);
            if (!m) break;
            const chunk = buf.slice(0, m.index);
            buf = buf.slice(m.index + m[0].length);
            const data = chunk
              .split(/\r?\n/)
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("\n");
            if (data) frames.push({ data, at: Date.now() });
          }
        }
      } catch {
        /* aborted */
      }
      closed = true;
    })();
  } else {
    try { ac.abort(); } catch {}
  }
  return { res, contentType, frames, isClosed: () => closed, close: () => ac.abort() };
}

function frameRows(frame) {
  try {
    const v = JSON.parse(frame.data);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.notes)) return v.notes;
  } catch {}
  return null;
}

async function waitForFrame(sse, pred, opts = {}) {
  const from = opts.from ?? 0;
  // 窗口口径（B 臂接口修订钉死）：≤1s 墙钟，可显式给 deadline（自 POST 收到 2xx 起计）
  const deadline = opts.deadline ?? Date.now() + (opts.timeout ?? 5000);
  for (;;) {
    const hit = sse.frames.find((f) => f.at >= from && (!pred || pred(f)));
    if (hit) return hit;
    if (Date.now() > deadline) return null;
    await sleep(25);
  }
}

async function framesInWindow(sse, from, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) await sleep(50);
  return sse.frames.filter((f) => f.at >= from);
}

/* ------------------------------------------------------------------ */
/* 判据登记（先占位，后赋值；顺序 = brief 判据表顺序）                  */
/* ------------------------------------------------------------------ */

const checks = [];
const logTail = [];
function check(id, category, desc) {
  const c = { id, category, desc, pass: false };
  checks.push(c);
  return c;
}
function note(msg) {
  logTail.push(String(msg));
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const plan = task === "task1-column-change" ? "task1" : task === "task2-live-reconcile" ? "task2" : "task3";

/* ---- 判据占位 ---- */
if (plan === "task1") {
  check("M1", "S", "src/db/schema.ts 的 notes 表定义含 priority 列（integer、notNull、default 0）");
  check("M2", "S", "drizzle/migrations 出现新成对迁移（002_*.up.sql + 同名 .down.sql）；001 系文件零改动");
  check("M3", "S", "对基线库副本（影子库）up：notes 获得该列且既有行 priority=0；down --to 001 一步后该列消失；verify 干跑 exit 0");
  check("M4", "R", "POST /api/notes 输入契约含可选 priority（integer 0-9）：带 priority 落库一致；越界/小数/非整数被结构化 400 拒；省略按 0");
  check("M5", "R", "GET /api/notes 返回行含 priority，且输出契约已声明该字段（输出校验不红，非 500）");
  check("M6", "S", "契约单源完好：api/notes/route.ts 从契约模块 import 解析器（无内联复本），契约源码含可选 priority 的 0-9 整数声明");
  check("M7", "C", "挂载 NotesList：DOM 行含基线既有行的 priority 值（探针 id=777、值 9）+ data-note-id 钩子在位");
  check("M8", "S", "变更后应用全绿（等价 struct check + api-diff + test 门）：tsc --noEmit 绿；lint 绿；迁移成对；pnpm test 全绿");
} else if (plan === "task2") {
  check("M1", "S", "列表 live 通道存在且以 SSE 语义可达（等价 live 声明：GET /api/notes/stream，content-type text/event-stream）");
  check("M2", "S", "最终产物不含占位/非法残留（stream 路由为真实 SSE 装配，非 stub）");
  check("R1", "R", "黑盒场景：SSE 订阅列表 live 通道（GET /api/notes/stream），首连收到全量 data 帧（帧行 ⊇ GET /api/notes 当前行且非空）");
  check("R2", "R", "场景续：POST 成功创建（客户端生成 id 随请求提交）后，≤1s 窗口内同一订阅收到含该 id 新行的 data 帧");
  check("R3", "R", "场景续：POST 违规输入（空 body）收到结构化 400，且窗口内 live 通道无新 data 帧、订阅保持（后续写仍收到帧）");
  check("C1", "C", "客户端层（挂载驱动提交入口）：成功提交后待定项出现，推送窗口过后列表含该 id 且仅一次（无重复行），状态为已确认");
  check("C2", "C", "客户端层：失败提交后该待定项从列表消失、回滚名单含该 id、错误态渲染含 fix 提示");
  check("M3", "S", "静态门禁全绿（等价 struct check + api-diff：tsc + lint + 迁移成对且 verify 幂等）+ pnpm test 全绿");
} else {
  check("M1", "S", "[task1] src/db/schema.ts 的 notes 表定义含 priority 列（integer、notNull、default 0）——本任务起点已声明，判保持");
  check("M2", "S", "[task1] 002 迁移成对（补缺的 down 侧）；001 与 002-up 零改动（sha 对表冻结基线）");
  check("M3", "S", "[task1] 影子库干跑（已应用状态保持一致）：up 后列在且既有行 priority=0；down --to 001 后列消失；verify exit 0");
  check("M4", "R", "[task1] POST /api/notes 输入契约含可选 priority（integer 0-9）：带 priority 落库一致；越界/小数/非整数被结构化 400 拒；省略按 0");
  check("M5", "R", "[task1] GET /api/notes 返回行含 priority，且输出契约已声明该字段（输出校验不红，非 500）");
  check("M6", "S", "[task1] 契约单源完好：api/notes/route.ts 从契约模块 import 解析器（无内联复本），契约源码含可选 priority 的 0-9 整数声明");
  check("M7", "C", "[task1] 挂载 NotesList：DOM 行含 priority 值（探针 id=777、值 9）+ data-note-id 钩子在位");
  check("M8", "S", "[task1] 全绿门：tsc --noEmit 绿；lint 绿；迁移成对；pnpm test 全绿");
  check("M1", "S", "[task2] 列表 live 通道存在且以 SSE 语义可达（等价 live 声明：GET /api/notes/stream，content-type text/event-stream）");
  check("M2", "S", "[task2] 最终产物不含占位/非法残留（stream 路由为真实 SSE 装配，非 stub）");
  check("M3", "S", "[task2] 静态门禁全绿（tsc + lint + 迁移成对且 verify 幂等）+ pnpm test 全绿");
  check("R1", "R", "[task2] 黑盒场景：SSE 订阅列表 live 通道（GET /api/notes/stream），首连收到全量 data 帧（帧行 ⊇ GET /api/notes 当前行且非空）");
  check("R2", "R", "[task2] 场景续：POST 成功创建（客户端生成 id 随请求提交）后，≤1s 窗口内同一订阅收到含该 id 新行的 data 帧");
  check("R3", "R", "[task2] 场景续：POST 违规输入（空 body）收到结构化 400，且窗口内 live 通道无新 data 帧、订阅保持（后续写仍收到帧）");
  check("C1", "C", "[task2] 客户端层（挂载驱动提交入口）：成功提交后待定项出现，推送窗口过后列表含该 id 且仅一次（无重复行），状态为已确认");
  check("C2", "C", "[task2] 客户端层：失败提交后该待定项从列表消失、回滚名单含该 id、错误态渲染含 fix 提示");
  check("D1", "S", "种子缺陷已修复而非绕过：002 up 侧与基线种子逐字节一致（sha256 对表）；down 侧存在；down→up 往返后数据面等价；verify exit 0");
  check("D2", "S", "全部完成态下静态门禁全绿（tsc + lint + 迁移成对）且 pnpm test 全绿");
}

const byId = (id, prefix) => checks.filter((c) => c.id === id && (!prefix || c.desc.startsWith(prefix)))[0];
const failDetail = (msg) => ({ ok: false, detail: msg });

/* ------------------------------------------------------------------ */
/* S 类探针                                                            */
/* ------------------------------------------------------------------ */

function migrationPairCheck() {
  const dir = rel("drizzle/migrations");
  if (!fs.existsSync(dir)) return failDetail("缺 drizzle/migrations 目录");
  const files = fs.readdirSync(dir);
  const ups = files.filter((f) => f.endsWith(".up.sql")).sort();
  const detail = [];
  let ok = true;

  for (const f of ["drizzle/migrations/001_create_notes.up.sql", "drizzle/migrations/001_create_notes.down.sql"]) {
    const cur = read(f);
    const want = MANIFEST.files[f];
    if (cur === null) {
      ok = false;
      detail.push(f + " 缺失");
    } else if (want && sha256(cur) !== want) {
      ok = false;
      detail.push(f + " 被改动（sha256 与冻结基线不符）");
    } else {
      detail.push(f.replace("drizzle/migrations/", "") + " ✓");
    }
  }

  const unpaired = ups.filter((u) => !files.includes(u.slice(0, -".up.sql".length) + ".down.sql"));
  if (unpaired.length) {
    ok = false;
    detail.push("缺 down 侧: " + unpaired.join(", "));
  } else {
    detail.push("成对(" + ups.length + ") ✓");
  }
  return { ok, detail: detail.join("; ") };
}

function migration002Check() {
  const dir = rel("drizzle/migrations");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const stem = files.filter((f) => f.startsWith("002_") && f.endsWith(".up.sql")).sort()[0];
  if (!stem) return { stem: null, ok: false, detail: "未出现 002_* 迁移" };
  const detail = [];
  let ok = true;
  const upSha = sha256(read("drizzle/migrations/" + stem));
  if (upSha !== (MANIFEST.files["drizzle/migrations/002_add_priority.up.sql"] ?? "")) {
    ok = false;
    detail.push(stem + " up 侧被改动（sha256 与基线种子不符——已应用迁移永不重写）");
  } else {
    detail.push(stem + " up 侧与基线种子一致 ✓");
  }
  const down = files.includes(stem.slice(0, -".up.sql".length) + ".down.sql");
  if (!down) {
    ok = false;
    detail.push(stem + " 缺 down 侧");
  } else {
    detail.push("down 侧在位 ✓");
  }
  return { stem: stem.slice(0, -".up.sql".length), ok, detail: detail.join("; ") };
}

const dbm = (args) => run(["node", "scripts/db.mjs", ...args].map(q).join(" "), { timeout: 60000 });

/** 影子库干跑：fresh 临时库 up→seed→探列→down --to 001→探列→verify。只依赖文件态。 */
function shadowDryRun({ needPriority }) {
  if (!fs.existsSync(rel("scripts/db.mjs"))) return failDetail("缺 scripts/db.mjs（基线迁移器被移除）");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-shadow-"));
  const sdb = path.join(tmp, "shadow.db");
  const colsOf = () => {
    const r = dbm(["query", "--db", sdb, "--sql", "PRAGMA table_info(notes)"]);
    try { return JSON.parse(r.stdout); } catch { return []; }
  };
  const detail = [];
  try {
    const up = dbm(["up", "--db", sdb]);
    if (up.code !== 0) return failDetail("影子库 up 失败: " + ((up.stderr || up.stdout) + "").slice(-400));
    const seed = dbm(["seed", "--db", sdb]);
    if (seed.code !== 0) return failDetail("影子库 seed 失败: " + ((seed.stderr || seed.stdout) + "").slice(-400));

    const cols = colsOf();
    const hasPriority = cols.some((c) => c.name === "priority");
    detail.push("up+seed 后列: " + cols.map((c) => c.name).join(","));
    if (needPriority && !hasPriority) return { ok: false, detail: detail.join("; ") + "；缺 priority 列" };
    if (hasPriority) {
      const rowsRes = dbm(["query", "--db", sdb, "--sql", "SELECT id, body, created_at, priority FROM notes ORDER BY id"]);
      let rows = [];
      try { rows = JSON.parse(rowsRes.stdout); } catch {}
      const allZero = rows.length >= 2 && rows.every((r) => Number(r.priority) === 0);
      detail.push("既有行(" + rows.length + ") priority 全 0: " + (allZero ? "✓" : "✗"));
      if (!allZero) return { ok: false, detail: detail.join("; ") };

      const stem = (fs.existsSync(rel("drizzle/migrations")) ? fs.readdirSync(rel("drizzle/migrations")) : [])
        .filter((f) => f.startsWith("002_") && f.endsWith(".up.sql"))
        .sort()[0];
      if (stem) {
        // down 一步 = 回滚到 001 之后（002 及以后全部回滚）；--to 002 自身是"回滚到 002 之后"的无操作
        const downTo = dbm(["down", "--db", sdb, "--to", "001_create_notes"]);
        const gone = !colsOf().some((c) => c.name === "priority");
        detail.push("down --to 001_create_notes 后列消失: " + (gone && downTo.code === 0 ? "✓" : "✗"));
        if (!gone || downTo.code !== 0) return { ok: false, detail: detail.join("; ") };
      }
    }
    const ver = dbm(["verify", "--db", sdb]);
    detail.push("verify(干跑): " + (ver.code === 0 ? "OK" : "红 " + ((ver.stderr || ver.stdout) + "").slice(-300)));
    return { ok: ver.code === 0, detail: detail.join("; ") };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/** D1 往返数据面等价探针：fresh up+seed → 快照 → down --to 001 → up → 快照比对。 */
function d1Roundtrip(stem) {
  if (!fs.existsSync(rel("scripts/db.mjs"))) return failDetail("缺 scripts/db.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-d1-"));
  const sdb = path.join(tmp, "rt.db");
  const snap = () => {
    const r = dbm(["query", "--db", sdb, "--sql", "SELECT id, body, created_at, priority FROM notes ORDER BY id"]);
    try { return JSON.stringify(JSON.parse(r.stdout)); } catch { return null; }
  };
  try {
    if (dbm(["up", "--db", sdb]).code !== 0) return failDetail("up 失败");
    if (dbm(["seed", "--db", sdb]).code !== 0) return failDetail("seed 失败");
    const before = snap();
    if (dbm(["down", "--db", sdb, "--to", "001_create_notes"]).code !== 0) {
      return failDetail("down --to 001_create_notes 失败（down 侧缺失或 SQL 红）");
    }
    if (dbm(["up", "--db", sdb]).code !== 0) return failDetail("回滚后再 up 失败");
    const after = snap();
    const ok = before !== null && before === after;
    return { ok, detail: "往返数据面等价: " + (ok ? "✓ " : "✗ ") + (before ?? "n/a") + " → " + (after ?? "n/a") };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function streamRouteProbe() {
  for (const p of ["src/app/api/notes/stream/route.ts", "src/app/api/notes/stream/route.tsx"]) {
    if (fs.existsSync(rel(p))) return { exists: true, src: read(p), path: p };
  }
  return { exists: false, src: null, path: "src/app/api/notes/stream/route.ts" };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

console.log("[m3fs-grade] " + task + " ← " + attempt);

// 0) 评分确定性前置：清空库态（一切判据只依赖文件态），清残留 C spec
try { fs.rmSync(rel("data"), { recursive: true, force: true, maxRetries: 3, retryDelay: 400 }); } catch {}
try { fs.rmSync(rel(SPEC_NAME), { force: true }); } catch {}

// 1) S/T 静态门：tsc / lint / pnpm test 各跑一次，bundle 判据复用结果
console.log("[m3fs-grade] S: tsc --noEmit …");
const tsc = run("pnpm exec tsc --noEmit", { timeout: 300000 });
console.log("[m3fs-grade] S: eslint …");
const lint = run("pnpm exec eslint .", { timeout: 240000 });
console.log("[m3fs-grade] T: pnpm test …");
const tests = run("pnpm test", { timeout: 420000 });
note("tsc exit=" + tsc.code + "; eslint exit=" + lint.code + "; vitest exit=" + tests.code);
if (tsc.code !== 0) note("tsc 输出尾: " + ((tsc.stdout || "") + (tsc.stderr || "")).slice(-600));
if (lint.code !== 0) note("eslint 输出尾: " + ((lint.stdout || "") + (lint.stderr || "")).slice(-600));
if (tests.code !== 0) note("vitest 输出尾: " + ((tests.stdout || "") + (tests.stderr || "")).slice(-600));

const gateSummary =
  [tsc.code === 0 ? "tsc ✓" : "tsc 红", lint.code === 0 ? "eslint ✓" : "eslint 红", tests.code === 0 ? "pnpm test ✓" : "pnpm test 红"].join("; ");
const gateOk = tsc.code === 0 && lint.code === 0 && tests.code === 0;

/* ---- S 类静态判定（M1/M2/M3(task1)/M6/M8/D1/D2） ---- */
{
  // M1
  if (plan !== "task2") {
    const schema = read("src/db/schema.ts") ?? "";
    const pIdx = schema.indexOf("priority");
    let ok = false;
    let d = "src/db/schema.ts 无 priority 声明";
    if (pIdx >= 0) {
      const slice = schema.slice(pIdx, pIdx + 220);
      ok = /integer\s*\(/.test(slice) && /notNull\s*\(/.test(slice) && /default\s*\(\s*0\s*\)/.test(slice);
      d = ok ? "priority integer notNull default 0 ✓" : "priority 声明缺 integer/notNull/default(0) 之一: " + slice.slice(0, 120);
    }
    Object.assign(byId("M1", plan === "task3" ? "[task1]" : ""), { pass: ok, detail: d });
  }

  // M2（task1 语义：新成对 002；task3 语义：补 down + 零改动）
  if (plan !== "task2") {
    const pair = migrationPairCheck();
    const m002 = migration002Check();
    const ok = pair.ok && m002.ok;
    byId("M2", plan === "task3" ? "[task1]" : "").pass = ok;
    byId("M2", plan === "task3" ? "[task1]" : "").detail = pair.detail + "；" + m002.detail;
  }

  // M3 task1 语义（影子库干跑）与 task2/task3 语义（门禁 + 成对 + 干跑）
  if (plan === "task1") {
    const shadow = shadowDryRun({ needPriority: true });
    Object.assign(byId("M3"), { pass: shadow.ok, detail: shadow.detail });
  } else {
    const pair = migrationPairCheck();
    const shadow = shadowDryRun({ needPriority: plan === "task3" });
    if (plan === "task2") {
      const c = byId("M3");
      c.pass = gateOk && pair.ok && shadow.ok;
      c.detail = "门禁: " + gateSummary + "；成对: " + pair.detail + "；影子干跑: " + shadow.detail;
    } else {
      // task3：task1 语义的 M3（影子干跑，已应用状态保持一致）与 task2 语义的 M3（门禁束）分别赋值
      const c1 = byId("M3", "[task1]");
      c1.pass = shadow.ok;
      c1.detail = shadow.detail;
      const c2 = byId("M3", "[task2]");
      c2.pass = gateOk && pair.ok && shadow.ok;
      c2.detail = "门禁: " + gateSummary + "；成对: " + pair.detail + "；影子干跑: " + shadow.detail;
    }
  }

  // M6
  if (plan !== "task2") {
    const routeSrc = read("src/app/api/notes/route.ts") ?? "";
    const contractSrc = read("src/lib/contract.ts") ?? "";
    const imports = /import\s+[^;]*\bfrom\s+["'][^"']*contract["']/.test(routeSrc);
    const declares =
      /priority/.test(contractSrc) &&
      /\.int(eger)?\s*\(/.test(contractSrc) &&
      /(\.max|\.lte)\s*\(\s*9\s*\)/.test(contractSrc) &&
      /\.optional\s*\(\)/.test(contractSrc);
    const c = byId("M6", plan === "task3" ? "[task1]" : "");
    c.pass = imports && declares;
    c.detail =
      (imports ? "route 从契约模块 import ✓" : "route 未从契约模块 import（契约单源断裂或内联复本）") +
      "; " +
      (declares ? "契约含可选 priority（int, max 9, optional）✓" : "契约缺 priority 的 optional/integer/0-9 声明");
  }

  // M8 / D2
  if (plan !== "task2") {
    const pair = migrationPairCheck();
    const c = byId("M8", plan === "task3" ? "[task1]" : "");
    c.pass = gateOk && pair.ok;
    c.detail = "门禁: " + gateSummary + "；成对与 001 完整性: " + pair.detail;
  }
  if (plan === "task3") {
    const pair = migrationPairCheck();
    const c = byId("D2");
    c.pass = gateOk && pair.ok;
    c.detail = "完成态门禁: " + gateSummary + "；成对: " + pair.detail;
  }

  // D1
  if (plan === "task3") {
    const m002 = migration002Check();
    const rt = m002.stem ? d1Roundtrip(m002.stem) : failDetail("无 002 stem");
    // verify 用 fresh 库：先建再验（data 目录此时为空——干跑不依赖解题者库态）
    let verOk = false;
    let verDetail = "";
    const probeDb = path.join(attempt, "data", "fresh-probe.db");
    if (dbm(["up", "--db", probeDb]).code === 0) {
      const v = dbm(["verify", "--db", probeDb]);
      verOk = v.code === 0;
      verDetail = ((v.stderr || "") + (v.stdout || "")).slice(-200);
    } else {
      verDetail = "fresh 库 up 失败";
    }
    try { fs.rmSync(rel("data"), { recursive: true, force: true }); } catch {}
    const c = byId("D1");
    c.pass = m002.ok && rt.ok && verOk;
    c.detail = m002.detail + "；" + rt.detail + "；verify: " + (verOk ? "OK" : "红 " + verDetail);
  }
}

/* ---- R 类（boot 后执行；赋值占位判据） ---- */
async function gradeRuntime() {
  const boot = await bootServer();
  try {
    if (!boot.base) {
      note("server 日志尾: " + boot.logLines.slice(-15).join(" / "));
      const d = "next dev 未就绪（predev 迁移/编译失败或超时 180s）";
      for (const c of checks) {
        if (c.category === "R") { c.pass = false; c.detail = d; }
        if ((c.id === "M1" && c.desc.includes("SSE")) || (c.id === "M2" && c.desc.includes("残留"))) {
          c.pass = false;
          c.detail = d;
        }
      }
      return;
    }
    note("server ready: " + boot.base);

    /* -- M4 / M5（task1 判据组） -- */
    for (const c of checks) {
      if (c.id !== "M4" && c.id !== "M5") continue;
      try {
        const post7 = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { body: "m3fs-m4-p7", priority: 7 } });
        const post10 = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { body: "m3fs-m4-p10", priority: 10 } });
        const post25 = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { body: "m3fs-m4-p25", priority: 2.5 } });
        const postStr = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { body: "m3fs-m4-str", priority: "7" } });
        const postOmit = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { body: "m3fs-m4-omit" } });
        const list = await fetchJson(boot.base, "/api/notes");
        const rows = (list.json && Array.isArray(list.json.notes) ? list.json.notes : []) ?? [];
        const rowOf = (b) => rows.find((x) => x && x.body === b);
        if (c.id === "M4") {
          const ok =
            post7.status >= 200 && post7.status < 300 &&
            post10.status === 400 && post25.status === 400 && postStr.status === 400 &&
            postOmit.status >= 200 && postOmit.status < 300 &&
            Number(rowOf("m3fs-m4-p7")?.priority) === 7 &&
            Number(rowOf("m3fs-m4-omit")?.priority) === 0;
          c.pass = ok;
          c.detail = [
            "POST{priority:7}→" + post7.status + " 落库=" + String(rowOf("m3fs-m4-p7")?.priority),
            "{priority:10}→" + post10.status,
            "{priority:2.5}→" + post25.status,
            '{priority:"7"}→' + postStr.status,
            "省略→" + postOmit.status + " 落库=" + String(rowOf("m3fs-m4-omit")?.priority),
          ].join("; ");
        } else {
          const ok = list.status === 200 && rows.length > 0 && rows.every((x) => typeof x?.priority === "number");
          c.pass = ok;
          c.detail = "GET → " + list.status + "，行数 " + rows.length + "，行均含 number 型 priority: " + ok;
        }
      } catch (e) {
        c.pass = false;
        c.detail = "请求异常: " + e;
      }
    }

    /* -- task2 判据组：M1 / M2 / R1 / R2 / R3 -- */
    const task2M1 = checks.find((c) => c.id === "M1" && c.desc.includes("SSE"));
    const task2M2 = checks.find((c) => c.id === "M2" && c.desc.includes("残留"));
    if (task2M1) {
      const stream = streamRouteProbe();
      let sse = null;
      try { sse = await connectSSE(boot.base, "/api/notes/stream"); } catch (e) {
        task2M1.pass = false;
        task2M1.detail = "SSE 连接异常: " + e;
      }
      if (sse) {
        const ok = sse.res.ok && sse.contentType.includes("text/event-stream");
        task2M1.pass = ok;
        task2M1.detail = stream.exists
          ? "stream 路由 " + stream.path + "；HTTP " + sse.res.status + "; content-type=" + sse.contentType
          : "缺 src/app/api/notes/stream/route.ts";
        if (task2M2) {
          const noStub =
            stream.exists &&
            /ReadableStream|text\/event-stream|TextEncoder/.test(stream.src) &&
            !/not\s+implemented|unimplemented|TODO:\s*implement/i.test(stream.src);
          task2M2.pass = noStub;
          task2M2.detail = stream.exists
            ? "stream 路由 " + stream.path + (noStub ? " 含真实 SSE 装配且无 stub ✓" : " 缺 SSE 装配或含 stub")
            : "缺 src/app/api/notes/stream/route.ts";
        }

        // R1 首连全量
        const r1 = byId("R1", plan === "task3" ? "[task2]" : "");
        const f1 = await waitForFrame(sse, () => true, { timeout: 10000 });
        const rows1 = f1 ? frameRows(f1) : null;
        let list = null;
        try { list = await fetchJson(boot.base, "/api/notes"); } catch {}
        const getRows = (list?.json ?? {}).notes ?? [];
        const getIds = new Set(getRows.map((x) => Number(x.id)));
        const covered = getIds.size > 0 && rows1 !== null && rows1.length > 0 && [...getIds].every((gid) => rows1.some((x) => Number(x?.id) === gid));
        r1.pass = covered;
        r1.detail = f1
          ? "首帧 " + (rows1 ? rows1.length + " 行" : "非 JSON 列表帧") + "; GET 行数 " + getIds.size + (sse.isClosed() ? "；流已关闭" : "")
          : "10s 内未收到任何 data 帧" + (sse.isClosed() ? "（连接被关闭）" : "");

        // R2 写后 ≤1s 推送（窗口口径：≤1s 墙钟，自 POST 收到 2xx 响应起计；首连全量帧不计窗口）
        const r2 = byId("R2", plan === "task3" ? "[task2]" : "");
        const id2 = Date.now(); // 客户端生成 id = JSON number 正整数（B 臂接口修订钉死）
        let post2 = null;
        try { post2 = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { id: id2, body: "m3fs-r2-note" } }); } catch {}
        const t2resp = Date.now(); // 2xx 响应收到时刻
        const f2 = post2 && post2.status >= 200 && post2.status < 300
          ? await waitForFrame(sse, (fr) => (frameRows(fr) ?? []).some((x) => Number(x?.id) === id2), {
              from: t2resp,
              deadline: t2resp + 1000,
            })
          : null;
        r2.pass = !!f2;
        r2.detail = post2
          ? "POST(id=" + id2 + " number) → " + post2.status + "；" + (f2 ? "2xx 后 1s 墙钟内收到含该 id 新行的帧 ✓" : "2xx 后 1s 墙钟内未收到含该 id 新行的帧")
          : "POST 异常";

        // R3 违规 → 结构化 400 + 无新帧 + 订阅保持
        // 违规载荷双探针（B 臂接口修订对齐）：{body:""}（缺省违规）与 {id:"x", body:…}（id 类型违规——
        // 客户端 id 钉死 JSON number 正整数，字符串 id 是契约违规）
        const r3 = byId("R3", plan === "task3" ? "[task2]" : "");
        const t3 = Date.now();
        let bad = null;
        let badType = null;
        try { bad = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { body: "" } }); } catch {}
        try { badType = await fetchJson(boot.base, "/api/notes", { method: "POST", body: { id: "x", body: "m3fs-r3-typeviol" } }); } catch {}
        const badBody = bad?.json ?? null;
        const structured400 = bad && bad.status === 400 && badBody && ["code", "message", "error", "issues"].some((k) => k in badBody);
        const type400 = badType ? badType.status === 400 : false;
        const stray = await framesInWindow(sse, t3, 1200);
        let aliveOk = false;
        if (!sse.isClosed()) {
          const id3 = Date.now() + 1;
          const t4 = Date.now();
          try { await fetchJson(boot.base, "/api/notes", { method: "POST", body: { id: id3, body: "m3fs-r3-alive" } }); } catch {}
          aliveOk = !!(await waitForFrame(sse, (fr) => (frameRows(fr) ?? []).some((x) => Number(x?.id) === id3), {
            from: t4,
            deadline: t4 + 1000,
          }));
        }
        r3.pass = !!structured400 && type400 && stray.length === 0 && aliveOk;
        r3.detail =
          "400 结构化: " + (structured400 ? "✓({body:\"\"}→" + bad.status + ")" : "✗(" + (bad ? bad.status : "异常") + ")") +
          "; id 类型违规 {id:\"x\"}→" + (type400 ? "400 ✓" : (badType ? badType.status + " ✗" : "异常")) +
          "; 失败后 1.2s 窗口新 data 帧: " + stray.length + " 条（须 0）" +
          "; 订阅保持（后续写 1s 内到帧）: " + (aliveOk ? "✓" : "✗") +
          (stray.length ? "；注意：心跳须用 SSE 注释行（: ping），不得占用 data 帧" : "");
        sse.close();
      }
    }
  } finally {
    killTree(boot.child);
    await sleep(600);
  }
}

/* ---- C 类（注入 spec → attempt 自身 vitest → 删除） ---- */
function runCCases() {
  const specSrc = fs.readFileSync(path.join(HERE, "harness", "acceptance-c.spec.tsx"), "utf8");
  const specPath = rel(SPEC_NAME);
  // 场景结果走文件不走 stdout：vitest 失败输出的代码帧会回显 spec 源码，字面标记会被污染
  const outFile = path.join(os.tmpdir(), "m3fs-c-results-" + Date.now() + "-" + process.pid + ".json");
  try { fs.rmSync(outFile, { force: true }); } catch {}
  fs.writeFileSync(specPath, specSrc);
  try {
    const r = run(["pnpm", "exec", "vitest", "run", SPEC_NAME].map(q).join(" "), {
      env: { ...process.env, ATELIER_M3FS_TASK: task, ATELIER_M3FS_C_OUT: outFile },
      timeout: 300000,
    });
    const out = (r.stdout || "") + "\n" + (r.stderr || "");
    let results = {};
    try { results = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
    return { out, results };
  } finally {
    try { fs.rmSync(specPath, { force: true }); } catch {}
    try { fs.rmSync(outFile, { force: true }); } catch {}
  }
}

/* ---- 执行 ---- */
await gradeRuntime();

{
  let result = null;
  try {
    result = runCCases();
  } catch (e) {
    note("C harness 异常: " + e);
  }
  const caseIdMap = { m7: "M7", c1: "C1", c2: "C2" };
  for (const c of checks) {
    if (c.category !== "C") continue;
    const caseKey = Object.keys(caseIdMap).find((k) => caseIdMap[k] === c.id);
    const passed = result && caseKey && result.results[caseKey] === "PASS";
    c.pass = !!passed;
    c.detail = passed
      ? "harness 场景 " + caseKey + " 通过（jsdom 挂载 + fetch/EventSource 模拟服务端，场景规格见 next/README.md）"
      : "harness 场景 " + (caseKey ?? c.id) + " 未通过" + (result ? "——vitest 输出尾: " + result.out.slice(-500).replace(/\s+/g, " ") : "（harness 未运行）");
  }
  if (result) note("C harness vitest 输出尾: " + result.out.slice(-400).replace(/\s+/g, " "));
}

/* ---- summary + 落盘 ---- */
const pass = checks.filter((c) => c.pass).length;
const ok = checks.length > 0 && pass === checks.length;
const grade = {
  ok,
  task,
  attempt: attempt.replaceAll("\\", "/"),
  at: new Date().toISOString(),
  checks,
  summary: { pass, fail: checks.length - pass },
  tail: logTail.slice(-12),
};
const outPath = path.resolve(argOf("--out") ?? path.join(attempt, "m3fs-grade.json"));
fs.writeFileSync(outPath, JSON.stringify(grade, null, 2) + "\n", "utf8");
for (const c of checks) {
  console.log("  " + (c.pass ? "PASS" : "FAIL") + "  [" + c.category + "] " + c.id + " — " + c.desc.slice(0, 72));
}
console.log("[m3fs-grade] " + task + " " + path.basename(attempt) + ": " + (ok ? "PASS" : "FAIL") + " (" + pass + "/" + checks.length + ") → " + outPath);
process.exit(ok ? 0 : 1);
