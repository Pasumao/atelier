#!/usr/bin/env node
/**
 * checkpoint.mjs — Decision 15 minimal path: SOURCE-track checkpoints anchored on git.
 *
 * Two-layer rollback model (decision 15):
 *   · App state  → runtime `store.rollback()` inside a running Atelier app (signal snapshots)
 *   · Source     → THIS tool: named git anchors per AI turn ("one round = one checkpoint")
 *
 * Commands:
 *   save <name>       snapshot the working tree as a named checkpoint (git commit; auto `git init` on first use)
 *                     [--no-gate] skip the 未检不锚 gates (deliberate wip anchors only)
 *                     [--db <file>] migration-head source db (default .atelier/dev.db, FS-M2(m2d) 决策 21-③)
 *                     gate 1 (决策 15 test gate): the package.json test suite must pass — a red suite refuses the anchor
 *                     gate 2 (P2-2 snapshot gate): if a snapshot baseline exists (per-platform resolveBaseline,
 *                     legacy flat .atr/snapshots/baseline.png is a read-only fallback) and the dev face answers,
 *                     the live render must MATCH it — MISMATCH refuses the anchor (fix via `atelier snapshot check --update`)
 *                     gate 3 (P3-4 api-diff gate): if .atelier/api-surface.json exists, unexempted public API breaking drift
 *                     refuses the anchor (re-baseline via `atelier api-diff snapshot`; carve-outs via `--allow`);
 *                     a baseline that exists but is UNREADABLE (corrupt JSON / unknown schema, api-diff exit 3)
 *                     also refuses the anchor — never a vacuous pass (P1 #8)
 *   list [--json]     show the human-visible timeline (.atelier/checkpoints.jsonl — local-only
 *                     ledger since 15d9059: deliberately gitignored, recoverability comes from
 *                     the anchor commits themselves; tracked-ledger repos still get meta commits)
 *   rollback <id>     move the branch window back to a checkpoint; a backup tag keeps the future reachable
 *                     (time-travel back: `git checkout <backup-tag>`), refuses when the tree is dirty
 *                     [--db <file>] and (决策 21-③): refuses when the target anchor's migrationHead is
 *                     BELOW the db's current migration head — run `migrate down --to <head>` first
 *                     (never auto-down: destructive ops need explicit human consent)
 *
 * Identity rule: checkpoint id = short commit sha — the jsonl entry IS the git anchor.
 *
 * Migration linkage (决策 21-③, FS-M2(m2d)): save records the db's atelier_migrations head
 * (max id + name) as `migrationHead` on the ledger entry; no db / no table / no node:sqlite →
 * vacuous skip, printed honestly (same honesty convention as the three gates above).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import url from "node:url";
import { spawnSync } from "node:child_process";
// m10 批 C：快照门基线路径消费 snapshot.mjs 单源导出（per-platform + legacy 回退，
// 替换原先双文件重复的路径构造——语义阶梯不变：无基线→vacuous / 不可达→vacuous / MISMATCH→拒锚）
// R3 结构债（评审 §4.8）：sourceFingerprint 同批单源化——原先 checkpoint 内联逐行同构副本靠
// 「MUST stay in sync」注释维系，现改为消费 snapshot.mjs 同一导出（对拍钉 = tests/source-fingerprint-parity）
import { currentPathFor, resolveBaseline, sourceFingerprint } from "./snapshot.mjs";

const STORE_DIR = ".atelier";
const STORE_FILE = path.join(STORE_DIR, "checkpoints.jsonl");

// die 签名全仓大一统（建议书 A5）：die(msg, code = 2)——原 (code, message, fix) 参数序相反（全仓孤例），
// 是 P1-9 同族隐患源；fix 文案以 "\nfix: " 并入 msg
function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

function git(repo, args) {
  // inject identity locally so fresh machines can still commit without global config
  const full = ["-C", repo, "-c", "user.name=atelier-bot", "-c", "user.email=atelier@local", ...args];
  const r = spawnSync("git", full, { encoding: "utf8" });
  if (r.status !== 0) {
    const out = (r.stderr || r.stdout || "").trim();
    die(`error: git ${args.join(" ")} failed${out ? `\nfix: ${out}` : ""}`, 1);
  }
  return (r.stdout ?? "").trim();
}

/**
 * Timeline meta commit：只在台账会被 git 跟踪时执行。
 * 15d9059 起台账有意为本地态（.gitignore `.atelier/*`）——被 ignore 的文件不进 status，
 * 不会弄脏工作树（meta commit 的存在理由），此时 `git add` 会硬失败。探测走 check-ignore -q
 * 的退出码（0 = 被忽略 → 跳过；旧仓库台账仍被跟踪 → 保持原行为）。
 */
function ledgerMetaCommit(repo, message) {
  const ignored = spawnSync("git", ["-C", repo, "check-ignore", "-q", STORE_FILE], { encoding: "utf8" }).status === 0;
  if (ignored) return false;
  git(repo, ["add", STORE_FILE]);
  git(repo, ["commit", "-m", message]);
  return true;
}

function readStore(repo) {
  const p = path.join(repo, STORE_FILE);
  if (!fs.existsSync(p)) return [];
  // P2-C4：台账是 gitignore 本地态 append 型 jsonl——中途 kill 可留半行；坏行裸 JSON.parse
  // 让 list 裸崩栈、save/rollback 被 async catch 吞成 cryptic SyntaxError 文案。逐行
  // try/catch，坏行 die 1 指明行号（struct.mjs probeTimelineLayer 同族同步收口）。
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      rows.push(JSON.parse(lines[i]));
    } catch {
      die(
        `error: 台账损坏：${p} 第 ${i + 1} 行不是完整 JSON（append 型台账中途 kill 可留半行）——拒绝在损坏台账上继续\n` +
        `fix: 修复或删除该行后重跑（锚点本体在 git commit，台账只是本地时间线；行内容片段：${lines[i].slice(0, 60)}）`,
        1,
      );
    }
  }
  return rows;
}
function appendStore(repo, entry) {
  fs.mkdirSync(path.join(repo, STORE_DIR), { recursive: true });
  fs.appendFileSync(path.join(repo, STORE_FILE), JSON.stringify(entry) + "\n");
}

function ensureRepo(repo) {
  if (!fs.existsSync(path.join(repo, ".git"))) {
    git(repo, ["init"]);
    console.error("[atelier-checkpoint] initialized new git repository (first-use bootstrap)");
  }
}
function headSha(repo) {
  try { return git(repo, ["rev-parse", "HEAD"]); } catch { return null; }
}

/* ---- 决策 21-③ 迁移联动（FS-M2(m2d)，全站双轨回滚的地基）------------------------
 * save：读当前库的 atelier_migrations head（最大 id + name）记入台账 migrationHead 字段；
 * rollback：目标锚点 head 低于当前库 head → 拒绝执行，指路"先 migrate down --to <目标 head>
 * 再 rollback"——绝不自动执行 down（破坏性操作走 confirm=ask 语义，v1 = 人工先跑）。
 * 无库 / 无表 / node:sqlite 不可用 / 目标 head >= 当前 → vacuous（诚实打印，行为零变化）。
 */
const MIGRATION_STATUS_TABLE = "atelier_migrations";
const DEFAULT_MIG_DB = path.join(".atelier", "dev.db");

/** 从 rest 参数剥离 --db <file>（缺省 .atelier/dev.db）；返回 { dbRel, rest: 剥离后的参数 } */
function takeDbFlag(args) {
  const i = args.indexOf("--db");
  if (i < 0) return { dbRel: DEFAULT_MIG_DB, rest: args };
  const dbRel = args[i + 1] ?? DEFAULT_MIG_DB;
  return { dbRel, rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}

async function readMigrationHead(repo, dbRel) {
  const dbFile = path.isAbsolute(dbRel) ? dbRel : path.join(repo, dbRel);
  if (!fs.existsSync(dbFile)) return { head: null, note: `no db at ${path.relative(repo, dbFile) || dbFile} — migration head not recorded` };
  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbFile);
  } catch (e) {
    return { head: null, note: `sqlite unavailable (${e?.message ?? e}) — migration head not recorded` };
  }
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(MIGRATION_STATUS_TABLE);
    if (!has) return { head: null, note: "no atelier_migrations table (migrate up first) — migration head not recorded" };
    const row = db.prepare("SELECT id, name FROM atelier_migrations ORDER BY id DESC LIMIT 1").get();
    return { head: row ? { id: Number(row.id), name: String(row.name) } : null, note: null };
  } catch (e) {
    return { head: null, note: `migration head unreadable (${e?.message ?? e}) — vacuous` };
  } finally {
    db.close();
  }
}

/* ---- P2-2 未检不锚 gate ----------------------------------------------
 * A checkpoint anchors "a good tree"; if a snapshot baseline exists and the dev
 * face is reachable, the render must still match it. MISMATCH → refuse the anchor
 * (escape hatches: `snapshot check --update` after human review, or `--no-gate`
 * for deliberate wip anchors). Unreachable dev face / no baseline → vacuous pass,
 * printed honestly rather than silently skipped.
 */
/* ---- 决策 15 提交闸门接线（P1-5 设计备忘）：atelier test 通过才允许锚定 ——「未检不锚」的测试半边 ----
 * 定位 package.json 的 test 脚本（应用根优先，其次框架仓 atelier/ 布局），pnpm 优先、缺则退 npm。
 * 无 test 脚本 → vacuous pass（诚实打印，不静默）。逃生口与快照门禁同口径：--no-gate / ATELIER_TEST_GATE=off。
 * MCP checkpoint.source_commit 走同一 save 路径 ⇒ 闸门对 MCP 来源的锚定同样生效。
 */
function testGate(repo, skip) {
  if (skip) return; // --no-gate（deliberate wip anchor）跳过全部门禁
  if (process.env.ATELIER_TEST_GATE === "off") { console.log("[gate] test gate off (ATELIER_TEST_GATE=off)"); return; }
  for (const p of [path.join(repo, "package.json"), path.join(repo, "atelier", "package.json")]) {
    if (!fs.existsSync(p)) continue;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    if (!pkg.scripts?.test) continue;
    const cwd = path.dirname(p);
    const shell = process.platform === "win32";
    // win32 下 pnpm 是 .cmd 需要 shell；此时命令须为单串（args+shell 触发 Node DEP0190 弃用告警）
    const run = (cmd) =>
      shell ? spawnSync(`${cmd} test`, { cwd, encoding: "utf8", shell }) : spawnSync(cmd, ["test"], { cwd, encoding: "utf8" });
    console.log(`[gate] running test suite (${path.relative(repo, cwd) || "."} — 未检不锚·测试半边)...`);
    let r = run("pnpm");
    if (r.error && r.error.code === "ENOENT") r = run("npm");
    if (r.status === 0) { console.log("[gate] tests green — anchor permitted ✔"); return; }
    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean).slice(-12).join("\n  ");
    die(
      `error: 未检不锚 — test suite failed; refusing to anchor this checkpoint\nfix: fix the failing tests first (tail below), or deliberate wip anchor → 'atelier checkpoint save <name> --no-gate'.\n  ${tail}`,
      1,
    );
  }
  console.log("[gate] no package.json test script found — test gate vacuous");
}

async function snapshotGate(repo, skip) {
  if (skip) { console.log("[gate] snapshot gate skipped (--no-gate)"); return; }
  if (process.env.ATELIER_SNAPSHOT_GATE === "off") { console.log("[gate] snapshot gate off (ATELIER_SNAPSHOT_GATE=off)"); return; }
  // m10 批 C：per-platform 基线解析（snapshot.mjs 单源；旧布局只读回退——语义阶梯不变）
  const resolved = resolveBaseline(repo, process.platform);
  if (resolved.missing) { console.log("[gate] no snapshot baseline — gate vacuous (run 'atelier snapshot save' to arm it)"); return; }
  const snapDir = path.dirname(resolved.path);
  const base = resolved.path;
  const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const baseSha = sha256File(base);
  // source fingerprint — snapshot.mjs 单源导出（R3 结构债：内联逐行同构副本已删；对拍钉 =
  // tests/source-fingerprint-parity.test.ts——checkpoint 门消费的指纹值与 snapshot.mjs 逐位一致）
  const curFp = sourceFingerprint(repo);
  // fast path: a fresh MATCH receipt against the SAME baseline AND the SAME sources satisfies the
  // gate without a recapture — a source change since the check forces a live capture (that is the
  // exact agent loop: edit → checkpoint, which a stale receipt must never wave through).
  // m11 收口：full 变体 receipt 显式排除（评审 minor ②）——快路径只认默认变体（m11 归档行口径
  // 「full 检查不替代」）；否则 baseline.png 与 baseline-full.png 字节相同时（不可滚动页）仅靠
  // baselineSha 不等性隔离不够，full MATCH receipt 会被误食。
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(repo, ".atelier", "snapshot-lastcheck.json"), "utf8"));
    const ageMin = (Date.now() - Date.parse(rc.at)) / 60000;
    if (rc.variant !== "full" && (rc.result === "MATCH" || rc.result === "PIXMATCH") && rc.baselineSha === baseSha && rc.sourceFp === curFp && ageMin >= 0 && ageMin < 5) {
      console.log(`[gate] fresh MATCH receipt (${ageMin.toFixed(1)} min old, same baseline & sources) — 未检不锚 satisfied ✔`);
      return;
    }
  } catch { /* no/!fresh receipt → live check below */ }
  // live check: capture spawns a transient headless browser (mount wait + settle, slow on Windows
  // cold start) — same 40s budget as snapshot.mjs; an absent dev face still fails in <1s (ECONNREFUSED)
  const dev = process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173";
  let token = "";
  try { token = fs.readFileSync(path.join(repo, ".atelier", "dev-token"), "utf8").trim(); } catch { /* empty token → 401 path */ }
  let r;
  try {
    r = await fetch(`${dev}/__atelier/screenshot`, {
      signal: AbortSignal.timeout(40000),
      headers: { "x-atelier-token": token },
    });
  } catch {
    console.log("[gate] dev face unreachable (capture timed out) — snapshot gate vacuous this anchor");
    return;
  }
  if (!r.ok) { console.log(`[gate] dev face HTTP ${r.status} — snapshot gate vacuous this anchor`); return; }
  const j = await r.json().catch(() => null);
  if (!j?.ok || !j.imageBase64) { console.log("[gate] screenshot payload missing — snapshot gate vacuous this anchor"); return; }
  const curPath = currentPathFor(repo);
  fs.mkdirSync(path.dirname(curPath), { recursive: true });
  fs.writeFileSync(curPath, Buffer.from(j.imageBase64, "base64"));
  const same = baseSha === sha256File(curPath);
  // refresh the receipt: the gate just performed a full check, so record it (same schema as snapshot.mjs)
  try {
    fs.mkdirSync(path.join(repo, ".atelier"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".atelier", "snapshot-lastcheck.json"),
      JSON.stringify({ result: same ? "MATCH" : "MISMATCH", baselineSha: baseSha, currentSha: sha256File(curPath), sourceFp: curFp, at: new Date().toISOString() }, null, 2) + "\n",
    );
  } catch { /* receipt is best-effort */ }
  if (same) { console.log("[gate] snapshot MATCH — 未检不锚 satisfied ✔"); return; }
  die(
    `error: 未检不锚 — render MISMATCHES the snapshot baseline; refusing to anchor this checkpoint\nfix: review both images ('atelier snapshot check' prints the paths). Intended change → 'atelier snapshot check --update' after human review, then re-save. Deliberate wip anchor → 'atelier checkpoint save <name> --no-gate'.`,
    1,
  );
}

/* ---- P3-4 api-diff gate（未检不锚·API 半边）----------------------------------
 * baseline（.atelier/api-surface.json）存在时，锚定前必须通过公共 API 面漂移门禁：
 * 未豁免的 removed/changed（公共 API 被删/被改）→ 拒绝锚定。诚实口径与另两道门一致：
 * 无 baseline → vacuous pass（打印武装指引）；布局不可判 → vacuous；布局错误不该被静默吞掉。
 * 有意变更的再武装路径 = 'atelier api-diff snapshot'（新面入档，漂移留痕于 git 历史）；
 * 个别刻意的破坏 = '--allow' 清单登记；逃生口 = --no-gate / ATELIER_API_GATE=off。
 */
function apiDiffGate(repo, skip) {
  if (skip) { console.log("[gate] api gate skipped (--no-gate)"); return; }
  if (process.env.ATELIER_API_GATE === "off") { console.log("[gate] api gate off (ATELIER_API_GATE=off)"); return; }
  const baseline = path.join(repo, ".atelier", "api-surface.json");
  if (!fs.existsSync(baseline)) { console.log("[gate] no api-surface baseline — gate vacuous (run 'atelier api-diff snapshot' to arm it)"); return; }
  const scriptPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "api-diff.mjs");
  const r = spawnSync(process.execPath, [scriptPath, "check", "--root", repo, "--json"], { encoding: "utf8" });
  if (r.status === 2) { console.log("[gate] api surface layout undetectable — gate vacuous this anchor"); return; }
  /* P1 #8：基线「存在但不可评估」（api-diff exit 3 = JSON 损坏 / schema 不识别）→ 拒锚，绝不
   * vacuous pass——此前 exit 2 被一律解释为布局不可判，坏基线静默锚定击穿「未检不锚」（与上方
   * :261 诚实口径自相矛盾）。不可评估 ≠ 无从评估：基线在，就先修基线再锚。 */
  if (r.status === 3) {
    die(
      `error: 未检不锚 — api-surface 基线存在但不可评估（损坏 / schema 不识别）；refusing to anchor on an unevaluable baseline\n` +
      `fix: 检查 ${baseline}——确认后重跑 'atelier api-diff snapshot' 重新基线化（旧基线经 git 历史留痕），或 deliberate wip anchor → 'atelier checkpoint save <name> --no-gate'.`,
      1,
    );
  }
  let result;
  try { result = JSON.parse(r.stdout); } catch { console.log("[gate] api-diff output unparseable — gate vacuous this anchor"); return; }
  if (r.status === 0 && result.violations?.length === 0) {
    const churn = (result.summary.churn * 100).toFixed(2);
    console.log(`[gate] api surface clean (churn ${churn}%) — 未检不锚 satisfied ✔`);
    return;
  }
  const list = (result.violations ?? []).map((v) => `  · ${v.surface}:${v.id} [${v.kind}]`).join("\n");
  die(
    `error: 未检不锚 — public API surface drifted with ${result.violations?.length ?? "?"} unexempted breaking change(s); refusing to anchor\nfix: intended change → re-baseline with 'atelier api-diff snapshot' (drift stays recorded in git history);\n  deliberate carve-out → register the entry in an '--allow' allowlist;\n  deliberate wip anchor → 'atelier checkpoint save <name> --no-gate'.\n${list}`,
    1,
  );
}

async function cmdSave(repo, name, skipGate, jsonMode, dbRel) {
  if (!name) die('usage: checkpoint save <name> [--no-gate] [--db <file>] [--json]\nfix: e.g. atelier checkpoint save "AI round 4: added ModelCard"', 1);
  ensureRepo(repo);
  const dirty = git(repo, ["status", "--porcelain"]).length > 0;
  if (!dirty) {
    const last = readStore(repo).filter((r) => r.type === "save").at(-1);
    if (jsonMode) { console.log(JSON.stringify({ ok: true, noop: true, last: last ?? null })); return; }
    console.log(`nothing changed since last checkpoint ${last ? `${last.id} "${last.name}"` : "(fresh repo)"}`);
    return;
  }
  await testGate(repo, skipGate); // 决策 15 提交闸门（测试半边）: a red suite must not be silently anchored
  await snapshotGate(repo, skipGate); // P2-2 未检不锚: a red render must not be silently anchored
  apiDiffGate(repo, skipGate); // P3-4 未检不锚: unexempted public API breaking drift must not be silently anchored
  // 决策 21-③：锚定时刻读迁移 head 入台账（无库/无表 → vacuous 诚实打印，条目不带该字段）
  const mig = await readMigrationHead(repo, dbRel);
  if (mig.head) console.log(`[ledger] migration head recorded: #${mig.head.id} ${mig.head.name}`);
  else if (mig.note) console.log(`[ledger] ${mig.note}`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", `checkpoint(${name}): AI turn snapshot`]);
  const anchor = headSha(repo);
  const entry = { type: "save", id: anchor.slice(0, 7), sha: anchor, name, at: new Date().toISOString(), ...(mig.head ? { migrationHead: mig.head } : {}) };
  appendStore(repo, entry);
  // fold the timeline row itself into a meta commit — otherwise the store file would keep the
  // tree permanently dirty and the rollback safety gate would deadlock (found in e2e).
  // （台账被 .gitignore 忽略时跳过——见 ledgerMetaCommit 注记。）
  const metaDone = ledgerMetaCommit(repo, `timeline(${entry.id})`);
  if (jsonMode) { console.log(JSON.stringify({ ok: true, ...entry })); return; }
  console.log(`saved ${entry.id} "${name}" (${entry.at}) — files anchored at commit ${anchor}`);
  console.log(`timeline grows at ${STORE_FILE}${metaDone ? "" : " (local-only — gitignored per 15d9059)"}; rollback anytime: atelier checkpoint rollback ${entry.id}`);
}

function cmdList(repo, json) {
  const rows = readStore(repo);
  if (!rows.length) { console.log("(empty timeline — first checkpoint: atelier checkpoint save <name>)"); return; }
  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const r of rows) {
    if (r.type === "save") console.log(`${r.id}  save      ${JSON.stringify(r.name)}  ${r.at}${r.migrationHead ? `  head=#${r.migrationHead.id} ${r.migrationHead.name}` : ""}`);
    else if (r.type === "rollback") console.log(`${r.id}  rollback  → target ${r.target}  (future kept at tag ${r.backup})  ${r.at}`);
  }
}

async function cmdRollback(repo, id, jsonMode, dbRel) {
  if (!id) die("usage: checkpoint rollback <id> [--db <file>]\nfix: pick an id from: atelier checkpoint list", 1);
  const rows = readStore(repo);
  const target = rows.find((r) => r.type === "save" && (r.id === id || r.sha.startsWith(id)));
  if (!target) {
    const known = rows.filter((r) => r.type === "save").map((r) => r.id).join(", ");
    die(`error: unknown checkpoint id "${id}"\nfix: known checkpoints: ${known || "(none)"}`, 1);
  }
  ensureRepo(repo);
  if (git(repo, ["status", "--porcelain"]).length > 0) {
    die(`error: refusing rollback with uncommitted changes\nfix: one round = one checkpoint — run 'atelier checkpoint save "wip"' first, then roll back`, 1);
  }
  // 决策 21-③：锚点带的 migrationHead 低于当前库 head → 拒绝（代码回滚 ≠ 数据回滚——库状态
  // 不随 git 回退，双轨必须显式各走各的）。绝不自动执行 down（破坏性操作 confirm=ask，v1 = 人工先跑）。
  const mig = await readMigrationHead(repo, dbRel);
  if (target.migrationHead && mig.head && target.migrationHead.id < mig.head.id) {
    die(
      `error: refusing rollback — checkpoint ${target.id} anchors migration head #${target.migrationHead.id} (${target.migrationHead.name}) but the db is already at #${mig.head.id} (${mig.head.name})\nfix: rewind the db first: run 'migrate down --to ${target.migrationHead.id}' (destructive — review what is dropped), then re-run 'atelier checkpoint rollback ${target.id}'`,
      1,
    );
  }
  const cur = headSha(repo);
  if (cur && cur.startsWith(target.id)) {
    if (jsonMode) console.log(JSON.stringify({ ok: true, noop: true, at: target.id }));
    else console.log(`already at checkpoint ${target.id} — nothing to do`);
    return;
  }
  const backupTag = `atelier-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  git(repo, ["tag", backupTag]);
  git(repo, ["reset", "--hard", target.sha]);
  const entry = { type: "rollback", id: `rb-${cur ? cur.slice(0, 5) : "root"}`, target: target.id, backup: backupTag, at: new Date().toISOString() };
  appendStore(repo, entry);
  // fold the rollback row so the tree ends clean, otherwise the next gate would self-lock (same bug as in save)
  ledgerMetaCommit(repo, `timeline(rollback→${target.id})`);
  if (jsonMode) { console.log(JSON.stringify({ ok: true, ...entry })); return; }
  console.log(`rolled back → ${target.id} "${target.name}". The discarded future stays reachable:`);
  console.log(`  time-travel forward:  git checkout ${backupTag}`);
  console.log(`  re-anchor it later:   atelier checkpoint save "<name>" after checking out that tag`);
}

/* ---- dispatch ---- */
// 仓库发现：cwd 无 .git 时向上找最近祖先（2026-08-30 实证：在 atelier/ 子目录跑会误 init 嵌套仓——
// AGENTS.md 曾只能靠"务必在仓库根运行"提示兜底；尾巴区候选修法落地）。
function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start); // 到盘根仍无 .git → 维持旧行为（ensureRepo 会 init）
    dir = parent;
  }
}
const repo = findRepoRoot(process.cwd());
if (repo !== path.resolve(process.cwd())) console.log(`[atelier-checkpoint] repo root discovered upward: ${repo}`);
const [, , cmd, ...rest] = process.argv;
const jsonMode = rest.includes("--json");
if (cmd === "save") {
  const skipGate = rest.includes("--no-gate");
  const { dbRel, rest: restClean } = takeDbFlag(rest);
  cmdSave(repo, restClean.filter((a) => !a.startsWith("--")).join(" "), skipGate, jsonMode, dbRel).catch((e) => die(`error: ${e?.message ?? e}`, 1));
}
else if (cmd === "list") cmdList(repo, jsonMode);
else if (cmd === "rollback") {
  const { dbRel, rest: restClean } = takeDbFlag(rest);
  cmdRollback(repo, restClean.find((a) => !a.startsWith("--")), jsonMode, dbRel).catch((e) => die(`error: ${e?.message ?? e}`, 1));
}
else {
  console.error("usage: checkpoint save <name> [--no-gate] [--db <file>] [--json] | list [--json] | rollback <id> [--db <file>] [--json]");
  process.exit(2);
}
