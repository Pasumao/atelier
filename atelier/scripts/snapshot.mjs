#!/usr/bin/env node
/**
 * snapshot.mjs — `atelier snapshot save|check [--update]` (visual regression MINI tier).
 *
 * Requires the dev face running (default http://127.0.0.1:5173): captures through
 * POST-free GET /__atelier/screenshot (transient headless instance, waits for mount).
 *
 * Semantics honour the acceptance discipline (SPEC §5):
 *   save          capture → .atr/snapshots/<platform>/baseline.png (git-managed truth; per-platform
 *                 since m10 批 C — win32/linux/darwin render differently, one baseline per platform)
 *   check         capture fresh → compare vs baseline on TWO tiers (P1-8):
 *                 byte sha256 equal → MATCH
 *                 bytes differ, pixel mismatchRatio (in-instance canvas evaluate) ≤
 *                 config snapshot.mismatchThreshold (default 0.12) → PIXMATCH
 *                 (fonts/AA jitter is not a regression)
 *                 otherwise → MISMATCH → print BOTH paths for mandatory review + exit 1.
 *                 Never auto-promotes: only explicit `--update` promotes after human review.
 *   check --update compare-then-promote (intended for intentional changes reviewed by humans)
 *   save|check --full   全页捕获变体（m11 批 C：首屏盲区销账）——CDP captureBeyondViewport 拍
 *                 整页滚动高度，基线文件名独立（baseline-full.png / current-full.png），与 m10
 *                 视口基线互不相扰；receipt 加 variant:"full"（纯加法，checkpoint 消费只读
 *                 result/sha 字段不受扰）。
 *
 * Per-platform resolution is exported here as pure functions and consumed by
 * scripts/checkpoint.mjs's snapshot gate (single source — the old duplicated path
 * construction in checkpoint.mjs is gone; m10 批 C). Legacy flat baselines
 * (.atr/snapshots/baseline.png, pre-m10) are still READ as a fallback (with a re-save
 * hint) — never auto-migrated, never auto-promoted.
 *
 * Every save/check writes a receipt to .atelier/snapshot-lastcheck.json (P2-2) so
 * `checkpoint save` can enforce 未检不锚 (no anchoring a tree whose snapshot gate is red).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEV = process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173";

/* ---- per-platform baseline path resolution (m10 批 C) — exported pure functions,
 *      consumed by snapshot CLI below AND scripts/checkpoint.mjs (single source) ---- */

/** Baseline directory platform key: win32 / linux / darwin (process.platform). */
export function platformKey(platform = process.platform) {
  return platform;
}

/** `.atr/snapshots/<platform>/` under the given root (app dir or repo root). */
export function snapshotsDir(root = process.cwd(), platform = process.platform) {
  return path.join(root, ".atr", "snapshots", platformKey(platform));
}

/** Per-platform baseline path. */
export function baselinePathFor(root = process.cwd(), platform = process.platform) {
  return path.join(snapshotsDir(root, platform), "baseline.png");
}

/** Per-platform FULL-PAGE baseline path（m11 批 C：快照门首屏盲区销账——full 变体用独立
 * 文件名，绝不与 m10 视口基线 baseline.png 相互迁移/覆盖；默认变体行为逐字不变）。 */
export function baselineFullPathFor(root = process.cwd(), platform = process.platform) {
  return path.join(snapshotsDir(root, platform), "baseline-full.png");
}

/** Per-platform current-capture path. */
export function currentPathFor(root = process.cwd(), platform = process.platform) {
  return path.join(snapshotsDir(root, platform), "current.png");
}

/** Per-platform current FULL-PAGE capture path（同上，full 变体独立文件名）。 */
export function currentFullPathFor(root = process.cwd(), platform = process.platform) {
  return path.join(snapshotsDir(root, platform), "current-full.png");
}

/** Legacy flat baseline (pre-m10 layout) — read-only fallback, never auto-migrated. */
export function legacyBaselinePath(root = process.cwd()) {
  return path.join(root, ".atr", "snapshots", "baseline.png");
}

/** Effective baseline resolution: platform baseline wins; legacy flat baseline is a
 * read-only fallback (legacy: true → caller prints the re-save hint); neither →
 * missing: true (the snapshot gate's vacuous-ladder input). */
export function resolveBaseline(root = process.cwd(), platform = process.platform) {
  const base = baselinePathFor(root, platform);
  if (fs.existsSync(base)) return { path: base, legacy: false };
  const legacy = legacyBaselinePath(root);
  if (fs.existsSync(legacy)) return { path: legacy, legacy: true };
  return { path: base, legacy: false, missing: true };
}

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** render-relevant source fingerprint (P2-2 gate) — R3 结构债起为唯一实现：checkpoint.mjs 快照门
 * 消费本导出（原 checkpoint 内联逐行同构副本已删——对拍钉见 tests/source-fingerprint-parity.test.ts） */
export function sourceFingerprint(root = process.cwd()) {
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
  walk(path.join(root, "src"), 0);
  for (const f of ["atelier.config.json", "index.html"]) files.push(path.join(root, f));
  files.sort();
  for (const f of files) {
    try { h.update(path.relative(root, f) + ":" + fs.statSync(f).size + ":" + fs.readFileSync(f)); } catch { /* vanished between scan and read */ }
  }
  return h.digest("hex").slice(0, 16);
}

/** receipt of the last check result — read by `checkpoint save`'s 未检不锚 gate (P2-2) and audit tails */
function writeReceipt(entry) {
  try {
    fs.mkdirSync(path.join(process.cwd(), ".atelier"), { recursive: true });
    fs.writeFileSync(
      path.join(process.cwd(), ".atelier", "snapshot-lastcheck.json"),
      JSON.stringify({ ...entry, at: new Date().toISOString() }, null, 2) + "\n",
    );
  } catch { /* receipt is best-effort; never fail the check itself */ }
}

/** dev one-time token (P1-7): the app writes .atelier/dev-token at boot; tools read and send it */
function devToken() {
  // the app writes .atelier/dev-token at boot; run from the app dir (or set ATELIER_DEV_URL's host accordingly)
  try { return fs.readFileSync(path.join(process.cwd(), ".atelier", "dev-token"), "utf8").trim(); } catch { return ""; }
}

async function captureTo(file, query = "") {
  const r = await fetch(`${DEV}/__atelier/screenshot${query}`, {
    signal: AbortSignal.timeout(40000),
    headers: { "x-atelier-token": devToken() },
  });
  if (r.status === 401) throw new Error("ATR-405: dev token rejected — read .atelier/dev-token from the app root");
  if (!r.ok) throw new Error(`dev face HTTP ${r.status} (is 'atelier dev' running at ${DEV}?)`);
  const j = await r.json();
  if (!j.ok || !j.imageBase64) throw new Error(j.error ?? "screenshot payload missing");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(j.imageBase64, "base64"));
  return j;
}

/* ---- CLI body — main-module guarded (m10 批 C) so tests can import the pure
 *      functions above without executing the capture flow. cli.mjs spawns this file
 *      directly, so the guard holds for the real CLI path (argv[1] = this file). ---- */
const [, , cmd, ...flags] = process.argv;
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  try {
    const FULL = flags.includes("--full"); // m11 批 C：全页捕获变体（独立基线文件名，dev 面走 full=1）
    if (cmd === "save") {
      const BASE = FULL ? baselineFullPathFor() : baselinePathFor();
      await captureTo(BASE, FULL ? "?full=1" : "");
      writeReceipt({ result: "SAVED", baselineSha: sha256(BASE), sourceFp: sourceFingerprint(), ...(FULL ? { variant: "full" } : {}) });
      console.log(`baseline${FULL ? "-full (整页)" : ""} saved → ${path.relative(process.cwd(), BASE)} (${Math.round(fs.statSync(BASE).size / 1024)} KB)`);
      console.log('remember: the baseline is git-managed truth — commit it with the change it validates.');
    } else if (cmd === "check" || cmd === undefined) {
      const CURR = FULL ? currentFullPathFor() : currentPathFor();
      const j = await captureTo(CURR, FULL ? "?compare=1&full=1" : "?compare=1"); // P1-8: 同实例像素级对比
      const BASE = FULL ? baselineFullPathFor() : resolveBaseline().path;
      if (!fs.existsSync(BASE)) {
        console.error(`error: no baseline at ${path.relative(process.cwd(), BASE)}`);
        console.error(`fix: run 'atelier snapshot save${FULL ? " --full" : ""}' once the page looks right, then treat it as the regression floor.`);
        process.exit(1);
      }
      if (!FULL) {
        const resolved = resolveBaseline();
        if (resolved.legacy) {
          console.log("note: legacy flat baseline (.atr/snapshots/baseline.png) detected — re-run 'snapshot save' to arm the per-platform layout (win32/linux/darwin). Read-only fallback; never auto-migrated.");
        }
      }
      const baseSha = sha256(BASE);
      const curSha = sha256(CURR);
      const same = baseSha === curSha;
      const threshold = Number(j.threshold ?? 0.12);
      const ratio = j.pixelDiff ? j.pixelDiff.mismatchRatio : null;
      // verdict ladder: byte-equal → MATCH；bytes differ but pixels within threshold → PIXMATCH
      // （字体抗锯齿/亚像素抖动不是回归）；否则 MISMATCH
      const verdict = same ? "MATCH" : ratio !== null && !j.pixelDiff.dimsDiffer && ratio <= threshold ? "PIXMATCH" : "MISMATCH";
      // m11 收口：check 路径 receipt 同款 variant 标记（save/--update 已有）——check 是唯一能产出
      // MATCH/PIXMATCH 的写入者，漏标则 checkpoint 快路径的 full 变体排除对真实写入形状失效
      writeReceipt({ result: verdict, baselineSha: baseSha, currentSha: curSha, sourceFp: sourceFingerprint(), pixelRatio: ratio, threshold, ...(FULL ? { variant: "full" } : {}) });
      console.log(`current  → ${path.relative(process.cwd(), CURR)}`);
      console.log(`baseline → ${path.relative(process.cwd(), BASE)}`);
      if (verdict === "MATCH") {
        console.log("MATCH — pixel-stable against baseline ✔");
      } else if (verdict === "PIXMATCH") {
        console.log(`PIXMATCH — bytes differ but pixel mismatchRatio ${ratio.toExponential(2)} ≤ threshold ${threshold} ✔ (fonts/AA jitter is not a regression)`);
        console.log("review note: promotion still requires human eyes — never auto-promote to silence red.");
      } else {
        const ratioNote = ratio !== null ? ` (pixel mismatchRatio ${ratio.toExponential(2)} > threshold ${threshold})` : "";
        console.error(`MISMATCH — render differs from baseline${ratioNote}.`);
        console.error("fix: REVIEW both images side by side; if the change is intended, run 'atelier snapshot check --update' to promote. Never auto-promote to silence red.");
        if (flags.includes("--update")) {
          // --update 晋升到 per-platform 新布局路径（旧布局文件保持只读——绝不自动迁移/删除）
          const target = FULL ? baselineFullPathFor() : baselinePathFor();
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(CURR, target);
          writeReceipt({ result: "SAVED", baselineSha: sha256(target), sourceFp: sourceFingerprint(), ...(FULL ? { variant: "full" } : {}) });
          console.log("promoted (--update): current → baseline. Commit both together with the change rationale.");
        } else process.exit(1);
      }
    } else {
      console.error("usage: snapshot save | check [--update] [--full]");
      process.exit(2);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
