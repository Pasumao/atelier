#!/usr/bin/env node
/**
 * snapshot-smoke.mjs — 真实浏览器快照门禁的本地正式 runner（m10 批 C：候选池「真实浏览器测试转正」销账）。
 *
 * 定位：CI 的 snapshot-smoke job 此前是 continue-on-error 的冒烟（环境敏感、无 per-platform 基线）。
 * 本脚本把同一条链路落成本地正式门禁——退出码即门禁：任何一步失败 → exit 1。
 *
 * 链路（CI job 同款 + 门禁牙齿探针）：
 *   ① 临时目录 init 冒烟应用（模板 = 框架仓单一真相）→ pnpm install
 *   ② 后台 pnpm dev（dev 面 127.0.0.1:5173）→ 轮询就绪 + 等 dev-token
 *   ③ snapshot save（per-platform 基线落位）→ snapshot check → 必须 MATCH
 *   ④ 门禁牙齿负探针：基线篡改为垃圾字节 → snapshot check 必须 exit ≠ 0（字节比对红）
 *      → 还原基线 → snapshot check 再次 MATCH（恢复性正证）
 *   ⑤ 清理：杀 dev 面（win32 taskkill /T 树杀）+ 删临时目录（best-effort）
 *
 * 诚实边界：真实 CI 首跑维持挂账（本仓无 remote）；非 Windows 平台基线由同一脚本在各平台
 * 本地武装（per-platform 结构已就位，CI 侧摘除 continue-on-error 待真实首跑验证后进行）。
 * 语义保命线不变：check --update 人工显式晋升，绝不自动晋升。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(REPO, "atelier", "cli.mjs");
const DEV_URL = process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173";
const win = process.platform === "win32";

const die = (msg, fix) => {
  console.error(`error: ${msg}`);
  if (fix) console.error(`fix: ${fix}`);
  process.exit(1);
};
const run = (cmd, opts = {}) => {
  // win32 下 pnpm 是 .cmd 需要 shell；此时命令须为单串（checkpoint.mjs testGate 同款，DEP0190 规避）
  const r = win ? spawnSync(cmd, { encoding: "utf8", shell: true, ...opts }) : spawnSync(cmd, { encoding: "utf8", ...opts });
  return r;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-snapshot-smoke-"));
let devProc = null;
const killDev = () => {
  if (!devProc) return;
  try {
    if (win) spawnSync(`taskkill /pid ${devProc.pid} /T /F`, { shell: true });
    else devProc.kill("SIGTERM");
  } catch { /* best-effort */ }
  devProc = null;
};

try {
  console.log(`[1/5] init smoke app → ${scratch}`);
  const init = run(`node "${CLI}" init --target "${scratch}" --name SnapshotSmoke --no-ai`);
  if (init.status !== 0) die("init failed", (init.stderr ?? "") + (init.stdout ?? ""));

  console.log("[2/5] pnpm install（模板与框架仓同源，冷装约 1 分钟）");
  const install = run("pnpm install", { cwd: scratch });
  if (install.status !== 0) die("pnpm install failed", (install.stderr ?? "").slice(-600));

  console.log("[3/5] 起 dev face 并等就绪");
  devProc = win ? spawn("pnpm dev", { cwd: scratch, shell: true, stdio: "ignore" }) : spawn("pnpm", ["dev"], { cwd: scratch, stdio: "ignore" });
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 60000) {
    try {
      const r = await fetch(DEV_URL, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { up = true; break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!up) die("dev face never came up on " + DEV_URL);
  const tokenAt = path.join(scratch, ".atelier", "dev-token");
  let tokenT0 = Date.now();
  while (!fs.existsSync(tokenAt) && Date.now() - tokenT0 < 10000) await sleep(300);
  if (!fs.existsSync(tokenAt)) die("dev-token never appeared (dev face auth unwritable?)");

  console.log("[4/5] snapshot save → check（门禁正证）");
  const save = run(`node "${CLI}" snapshot save`, { cwd: scratch });
  if (save.status !== 0) die("snapshot save failed", (save.stderr ?? "") + (save.stdout ?? ""));
  const platformDir = path.join(scratch, ".atr", "snapshots", process.platform, "baseline.png");
  if (!fs.existsSync(platformDir)) die(`per-platform baseline missing at ${platformDir}`);
  const check = run(`node "${CLI}" snapshot check`, { cwd: scratch });
  const checkOut = (check.stdout ?? "") + (check.stderr ?? "");
  if (check.status !== 0 || !checkOut.includes("MATCH")) die(`snapshot check did not MATCH (exit=${check.status})`, checkOut.slice(-600));
  console.log(checkOut.trim().split("\n").slice(-1)[0]);

  console.log("[5/5] 门禁牙齿负探针：篡改基线 → check 必须红 → 还原 → check 再绿");
  const good = fs.readFileSync(platformDir);
  fs.writeFileSync(platformDir, Buffer.from("corrupted-baseline-not-a-png"));
  const bad = run(`node "${CLI}" snapshot check`, { cwd: scratch });
  if (bad.status === 0) die("tampered baseline did NOT fail check — gate has no teeth");
  fs.writeFileSync(platformDir, good);
  const again = run(`node "${CLI}" snapshot check`, { cwd: scratch });
  const againOut = (again.stdout ?? "") + (again.stderr ?? "");
  if (again.status !== 0 || !againOut.includes("MATCH")) die("restored baseline did not re-MATCH", againOut.slice(-400));
  console.log("restored baseline re-MATCH ✔ — gate teeth verified");

  console.log(`\nsnapshot-smoke PASS — 真实浏览器快照门禁全链绿（${process.platform}）`);
} catch (e) {
  die(e?.message ?? String(e));
} finally {
  killDev();
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort */ }
}
