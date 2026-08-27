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
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEV = process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173";
const SNAPDIR = path.join(process.cwd(), ".atr", "snapshots");
const BASE = path.join(SNAPDIR, "baseline.png");
const CURR = path.join(SNAPDIR, "current.png");

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

async function captureTo(file) {
  const r = await fetch(`${DEV}/__atelier/screenshot`, { signal: AbortSignal.timeout(40000) });
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
    console.log(`baseline saved → ${path.relative(process.cwd(), BASE)} (${Math.round(fs.statSync(BASE).size / 1024)} KB)`);
    console.log('remember: the baseline is git-managed truth — commit it with the change it validates.');
  } else if (cmd === "check" || cmd === undefined) {
    await captureTo(CURR);
    if (!fs.existsSync(BASE)) {
      console.error(`error: no baseline at ${path.relative(process.cwd(), BASE)}`);
      console.error("fix: run 'atelier snapshot save' once the page looks right, then treat it as the regression floor.");
      process.exit(1);
    }
    const same = sha256(BASE) === sha256(CURR);
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
