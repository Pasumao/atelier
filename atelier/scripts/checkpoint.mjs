#!/usr/bin/env node
/**
 * checkpoint.mjs — Decision 15 minimal path: SOURCE-track checkpoints anchored on git.
 *
 * Two-layer rollback model (decision 15):
 *   · App state  → runtime `store.rollback()` inside the prototype (signal snapshots)
 *   · Source     → THIS tool: named git anchors per AI turn ("one round = one checkpoint")
 *
 * Commands:
 *   save <name>       snapshot the working tree as a named checkpoint (git commit; auto `git init` on first use)
 *   list [--json]     show the human-visible timeline (.atelier/checkpoints.jsonl — versioned & auditable)
 *   rollback <id>     move the branch window back to a checkpoint; a backup tag keeps the future reachable
 *                     (time-travel back: `git checkout <backup-tag>`), refuses when the tree is dirty
 *
 * Identity rule: checkpoint id = short commit sha — the jsonl entry IS the git anchor.
 */
import fs from "node:fs";
import path from "node:path";
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

function cmdSave(repo, name) {
  if (!name) die(1, 'usage: checkpoint save <name>', 'e.g. atelier checkpoint save "AI round 4: added ModelCard"');
  ensureRepo(repo);
  const dirty = git(repo, ["status", "--porcelain"]).length > 0;
  if (!dirty) {
    const last = readStore(repo).filter((r) => r.type === "save").at(-1);
    console.log(`nothing changed since last checkpoint ${last ? `${last.id} "${last.name}"` : "(fresh repo)"}`);
    return;
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", `checkpoint(${name}): AI turn snapshot`]);
  const anchor = headSha(repo);
  const entry = { type: "save", id: anchor.slice(0, 7), sha: anchor, name, at: new Date().toISOString() };
  appendStore(repo, entry);
  // fold the timeline row itself into a meta commit — otherwise the store file would keep the
  // tree permanently dirty and the rollback safety gate would deadlock (found in e2e).
  git(repo, ["add", STORE_FILE]);
  git(repo, ["commit", "-m", `timeline(${entry.id})`]);
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

function cmdRollback(repo, id) {
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
  if (cur && cur.startsWith(target.id)) { console.log(`already at checkpoint ${target.id} — nothing to do`); return; }
  const backupTag = `atelier-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  git(repo, ["tag", backupTag]);
  git(repo, ["reset", "--hard", target.sha]);
  appendStore(repo, { type: "rollback", id: `rb-${cur ? cur.slice(0, 5) : "root"}`, target: target.id, backup: backupTag, at: new Date().toISOString() });
  console.log(`rolled back → ${target.id} "${target.name}". The discarded future stays reachable:`);
  console.log(`  time-travel forward:  git checkout ${backupTag}`);
  console.log(`  re-anchor it later:   atelier checkpoint save "<name>" after checking out that tag`);
}

/* ---- dispatch ---- */
const repo = process.cwd();
const [, , cmd, ...rest] = process.argv;
if (cmd === "save") cmdSave(repo, rest.join(" "));
else if (cmd === "list") cmdList(repo, rest.includes("--json"));
else if (cmd === "rollback") cmdRollback(repo, rest.find((a) => !a.startsWith("--")));
else {
  console.error("usage: checkpoint save <name> | list [--json] | rollback <id>");
  process.exit(2);
}
