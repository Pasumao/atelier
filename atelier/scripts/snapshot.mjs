#!/usr/bin/env node
/**
 * snapshot.mjs — `atelier snapshot save|check [--update]` (visual regression MINI tier).
 *
 * Requires the dev face running (default http://127.0.0.1:5173): captures through
 * POST-free GET /__atelier/screenshot (transient headless instance, waits for mount).
 *
 * Semantics honour the acceptance discipline (SPEC §5):
 *   save          capture → .atr/snapshots/baseline.png (git-managed truth)
 *   check         capture fresh → sha256 vs baseline
 *                 MATCH → ok ; MISMATCH → print BOTH paths for mandatory review + exit 1.
 *                 Never auto-promotes: only explicit `--update` promotes after human review.
 *   check --update compare-then-promote (intended for intentional changes reviewed by humans)
 *
 * Every save/check writes a receipt to .atelier/snapshot-lastcheck.json (P2-2) so
 * `checkpoint save` can enforce 未检不锚 (no anchoring a tree whose snapshot gate is red).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEV = process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173";
const SNAPDIR = path.join(process.cwd(), ".atr", "snapshots");
const BASE = path.join(SNAPDIR, "baseline.png");
const CURR = path.join(SNAPDIR, "current.png");

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** render-relevant source fingerprint (P2-2 gate) — MUST stay in sync with scripts/checkpoint.mjs */
function sourceFingerprint(root = process.cwd()) {
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

async function captureTo(file) {
  const r = await fetch(`${DEV}/__atelier/screenshot`, {
    signal: AbortSignal.timeout(40000),
    headers: { "x-atelier-token": devToken() },
  });
  if (r.status === 401) throw new Error("ATR-402: dev token rejected — read .atelier/dev-token from the app root");
  if (!r.ok) throw new Error(`dev face HTTP ${r.status} (is 'atelier dev' running at ${DEV}?)`);
  const j = await r.json();
  if (!j.ok || !j.imageBase64) throw new Error(j.error ?? "screenshot payload missing");
  fs.mkdirSync(SNAPDIR, { recursive: true });
  fs.writeFileSync(file, Buffer.from(j.imageBase64, "base64"));
}

const [, , cmd, ...flags] = process.argv;
try {
  if (cmd === "save") {
    await captureTo(BASE);
    writeReceipt({ result: "SAVED", baselineSha: sha256(BASE), sourceFp: sourceFingerprint() });
    console.log(`baseline saved → ${path.relative(process.cwd(), BASE)} (${Math.round(fs.statSync(BASE).size / 1024)} KB)`);
    console.log('remember: the baseline is git-managed truth — commit it with the change it validates.');
  } else if (cmd === "check" || cmd === undefined) {
    await captureTo(CURR);
    if (!fs.existsSync(BASE)) {
      console.error(`error: no baseline at ${path.relative(process.cwd(), BASE)}`);
      console.error("fix: run 'atelier snapshot save' once the page looks right, then treat it as the regression floor.");
      process.exit(1);
    }
    const baseSha = sha256(BASE);
    const curSha = sha256(CURR);
    const same = baseSha === curSha;
    writeReceipt({ result: same ? "MATCH" : "MISMATCH", baselineSha: baseSha, currentSha: curSha, sourceFp: sourceFingerprint() });
    console.log(`current  → ${path.relative(process.cwd(), CURR)}`);
    console.log(`baseline → ${path.relative(process.cwd(), BASE)}`);
    if (same) {
      console.log("MATCH — pixel-stable against baseline ✔");
    } else {
      console.error("MISMATCH — render differs from baseline (bytes).");
      console.error("fix: REVIEW both images side by side; if the change is intended, run 'atelier snapshot check --update' to promote. Never auto-promote to silence red.");
      if (flags.includes("--update")) {
        fs.copyFileSync(CURR, BASE);
        console.log("promoted (--update): current → baseline. Commit both together with the change rationale.");
      } else process.exit(1);
    }
  } else {
    console.error("usage: snapshot save | check [--update]");
    process.exit(2);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
