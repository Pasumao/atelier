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
 *                     gate 1 (决策 15 test gate): the package.json test suite must pass — a red suite refuses the anchor
 *                     gate 2 (P2-2 snapshot gate): if .atr/snapshots/baseline.png exists and the dev face answers, the live render
 *                     must MATCH it — MISMATCH refuses the anchor (fix via `atelier snapshot check --update`)
 *   list [--json]     show the human-visible timeline (.atelier/checkpoints.jsonl — versioned & auditable)
 *   rollback <id>     move the branch window back to a checkpoint; a backup tag keeps the future reachable
 *                     (time-travel back: `git checkout <backup-tag>`), refuses when the tree is dirty
 *
 * Identity rule: checkpoint id = short commit sha — the jsonl entry IS the git anchor.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const STORE_DIR = ".atelier";
const STORE_FILE = path.join(STORE_DIR, "checkpoints.jsonl");

function die(code, message, fix) {
  console.error(`${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(code);
}

function git(repo, args) {
  // inject identity locally so fresh machines can still commit without global config
  const full = ["-C", repo, "-c", "user.name=atelier-bot", "-c", "user.email=atelier@local", ...args];
  const r = spawnSync("git", full, { encoding: "utf8" });
  if (r.status !== 0) die(1, `error: git ${args.join(" ")} failed`, (r.stderr || r.stdout || "").trim());
  return (r.stdout ?? "").trim();
}

function readStore(repo) {
  const p = path.join(repo, STORE_FILE);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
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
    die(1,
      "error: 未检不锚 — test suite failed; refusing to anchor this checkpoint",
      `fix the failing tests first (tail below), or deliberate wip anchor → 'atelier checkpoint save <name> --no-gate'.\n  ${tail}`,
    );
  }
  console.log("[gate] no package.json test script found — test gate vacuous");
}

async function snapshotGate(repo, skip) {
  if (skip) { console.log("[gate] snapshot gate skipped (--no-gate)"); return; }
  if (process.env.ATELIER_SNAPSHOT_GATE === "off") { console.log("[gate] snapshot gate off (ATELIER_SNAPSHOT_GATE=off)"); return; }
  const snapDir = path.join(repo, ".atr", "snapshots");
  const base = path.join(snapDir, "baseline.png");
  if (!fs.existsSync(base)) { console.log("[gate] no snapshot baseline — gate vacuous (run 'atelier snapshot save' to arm it)"); return; }
  const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const baseSha = sha256File(base);
  // source fingerprint — MUST stay in sync with scripts/snapshot.mjs sourceFingerprint()
  const sourceFingerprint = () => {
    const h = crypto.createHash("sha256");
    const files = [];
    const walk = (dir, depth) => {
      if (depth > 6 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "dist") continue;
          walk(path.join(dir, e.name), depth + 1);
        } else if (/\.atr\.ts$|\.atr\.md$|\.css$|\.json$/.test(e.name) || e.name === "main.ts") files.push(path.join(dir, e.name));
      }
    };
    walk(path.join(repo, "src"), 0);
    for (const f of ["atelier.config.json", "index.html"]) files.push(path.join(repo, f));
    files.sort();
    for (const f of files) {
      try { h.update(path.relative(repo, f) + ":" + fs.statSync(f).size + ":" + fs.readFileSync(f)); } catch { /* vanished */ }
    }
    return h.digest("hex").slice(0, 16);
  };
  const curFp = sourceFingerprint();
  // fast path: a fresh MATCH receipt against the SAME baseline AND the SAME sources satisfies the
  // gate without a recapture — a source change since the check forces a live capture (that is the
  // exact agent loop: edit → checkpoint, which a stale receipt must never wave through)
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(repo, ".atelier", "snapshot-lastcheck.json"), "utf8"));
    const ageMin = (Date.now() - Date.parse(rc.at)) / 60000;
    if ((rc.result === "MATCH" || rc.result === "PIXMATCH") && rc.baselineSha === baseSha && rc.sourceFp === curFp && ageMin >= 0 && ageMin < 5) {
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
  const curPath = path.join(snapDir, "current.png");
  fs.mkdirSync(snapDir, { recursive: true });
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
  die(1,
    "error: 未检不锚 — render MISMATCHES the snapshot baseline; refusing to anchor this checkpoint",
    "review both images ('atelier snapshot check' prints the paths). Intended change → 'atelier snapshot check --update' after human review, then re-save. Deliberate wip anchor → 'atelier checkpoint save <name> --no-gate'.",
  );
}

async function cmdSave(repo, name, skipGate, jsonMode) {
  if (!name) die(1, 'usage: checkpoint save <name> [--no-gate] [--json]', 'e.g. atelier checkpoint save "AI round 4: added ModelCard"');
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
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", `checkpoint(${name}): AI turn snapshot`]);
  const anchor = headSha(repo);
  const entry = { type: "save", id: anchor.slice(0, 7), sha: anchor, name, at: new Date().toISOString() };
  appendStore(repo, entry);
  // fold the timeline row itself into a meta commit — otherwise the store file would keep the
  // tree permanently dirty and the rollback safety gate would deadlock (found in e2e).
  git(repo, ["add", STORE_FILE]);
  git(repo, ["commit", "-m", `timeline(${entry.id})`]);
  if (jsonMode) { console.log(JSON.stringify({ ok: true, ...entry })); return; }
  console.log(`saved ${entry.id} "${name}" (${entry.at}) — files anchored at commit ${anchor}`);
  console.log(`timeline grows at ${STORE_FILE}; rollback anytime: atelier checkpoint rollback ${entry.id}`);
}

function cmdList(repo, json) {
  const rows = readStore(repo);
  if (!rows.length) { console.log("(empty timeline — first checkpoint: atelier checkpoint save <name>)"); return; }
  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const r of rows) {
    if (r.type === "save") console.log(`${r.id}  save      ${JSON.stringify(r.name)}  ${r.at}`);
    else if (r.type === "rollback") console.log(`${r.id}  rollback  → target ${r.target}  (future kept at tag ${r.backup})  ${r.at}`);
  }
}

function cmdRollback(repo, id, jsonMode) {
  if (!id) die(1, "usage: checkpoint rollback <id>", "pick an id from: atelier checkpoint list");
  const rows = readStore(repo);
  const target = rows.find((r) => r.type === "save" && (r.id === id || r.sha.startsWith(id)));
  if (!target) {
    const known = rows.filter((r) => r.type === "save").map((r) => r.id).join(", ");
    die(1, `error: unknown checkpoint id "${id}"`, `known checkpoints: ${known || "(none)"}`);
  }
  ensureRepo(repo);
  if (git(repo, ["status", "--porcelain"]).length > 0) {
    die(1, `error: refusing rollback with uncommitted changes`,
      `one round = one checkpoint — run 'atelier checkpoint save "wip"' first, then roll back`);
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
  git(repo, ["add", STORE_FILE]);
  git(repo, ["commit", "-m", `timeline(rollback→${target.id})`]);
  if (jsonMode) { console.log(JSON.stringify({ ok: true, ...entry })); return; }
  console.log(`rolled back → ${target.id} "${target.name}". The discarded future stays reachable:`);
  console.log(`  time-travel forward:  git checkout ${backupTag}`);
  console.log(`  re-anchor it later:   atelier checkpoint save "<name>" after checking out that tag`);
}

/* ---- dispatch ---- */
const repo = process.cwd();
const [, , cmd, ...rest] = process.argv;
const jsonMode = rest.includes("--json");
if (cmd === "save") {
  const skipGate = rest.includes("--no-gate");
  cmdSave(repo, rest.filter((a) => !a.startsWith("--")).join(" "), skipGate, jsonMode).catch((e) => die(1, `error: ${e?.message ?? e}`));
}
else if (cmd === "list") cmdList(repo, jsonMode);
else if (cmd === "rollback") cmdRollback(repo, rest.find((a) => !a.startsWith("--")), jsonMode);
else {
  console.error("usage: checkpoint save <name> [--no-gate] [--json] | list [--json] | rollback <id> [--json]");
  process.exit(2);
}
