#!/usr/bin/env node
/**
 * bench.mjs — P0-4 性能基线台：SPEC §7 四指标实测（v0.1 发布闸门）。
 *
 *   ① 核心运行时体积   gzip -9(vite build+minify runtime)          目标 ≤ 30 KB
 *   ② 渲染性能         10³ 节点组件 mount+首渲染（7 样本取中位）   目标 ≤ 50 ms
 *   ③ 开发反馈         HMR/整页 reload 保存→可见延迟               目标 ≤ 100 ms
 *   ④ 截图回环         dev 单组件截图（compare=1）往返             目标 ≤ 500 ms
 *
 * 用法：node atelier/scripts/bench.mjs --app <appDir> [--port 5199] [--json] [--keep]
 *   --app   已 init 的 Atelier 应用（node_modules 已装）。bench 会写入 bench.html /
 *           bench-main.ts（生成物，结束后删除，--keep 保留）
 *   --json  仅输出机器可读结果（stdout 单行 JSON）
 *
 * 诚实标注：④ 的目标是"持久实例"语境下的数字；当前实现每次截图拉起瞬态无头浏览器，
 * 实测值会显著超标——超标项按 SPEC 落成 P0 修复工单（见 BACKLOG），不粉饰。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { openTransientBrowser } from "../dev/dev-screenshot.mjs";

const TARGETS = { bundleGzipKB: 30, mountMs: 50, hmrMs: 100, screenshotMs: 500 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const APP = path.resolve(argOf("--app") ?? process.cwd());
const PORT = Number(argOf("--port") ?? 5199);
const JSON_OUT = argv.includes("--json");
const KEEP = argv.includes("--keep");
const DEV = `http://127.0.0.1:${PORT}`;

if (!fs.existsSync(path.join(APP, "package.json"))) die(`no app at ${APP}`, "pass an init'd Atelier app (--app <dir>)");
if (!fs.existsSync(path.join(APP, "node_modules"))) die("app deps not installed", `cd ${APP} && pnpm install`);
if (!fs.existsSync(path.join(APP, "src", "runtime"))) die("no vendored runtime at src/runtime", "re-init the app: atelier init --target . --name <Name>");

const results = {};
const BENCH_HTML = path.join(APP, "bench.html");
const BENCH_TS = path.join(APP, "bench-main.ts");
const BENCH_PROBE = path.join(APP, "bench-probe.atr.ts"); // .atr.ts 后缀 → dev 插件注入 HMR accept（P0-5 路径）
const BENCH_DIST = path.join(APP, ".atelier", "bench-dist");
const generated = [];

function writeBenchFiles() {
  generated.push(BENCH_HTML, BENCH_TS, BENCH_PROBE);
  fs.writeFileSync(
    BENCH_HTML,
    `<!doctype html><html><head><meta charset="utf-8"><title>atelier-bench</title></head>
<body><div id="app"></div><script type="module" src="./bench-main.ts"></script></body></html>`,
  );
  fs.writeFileSync(
    BENCH_PROBE,
    `import { component, $state, html } from "./src/runtime";

export const BenchProbe = component(function BenchProbe() {
  const n = $state(0);
  return html\`
    <div class="ppanel"><p class="text-muted">bench probe HMRV0 · clicks {n.value}</p></div>
  \`.locals({ n });
}, { name: "BenchProbe", schema: { type: "object", reqProps: {}, optProps: {} } });
`,
  );
  // 10³ 节点：250 行 × 4 元素。HMR 探针：bench-probe.atr.ts 的 HMRV0 → 重写为 HMRV2 后轮询可见性。
  fs.writeFileSync(
    BENCH_TS,
    `import { component, $state, html, initTokens, mountComponent, registry, validateFlat } from "./src/runtime";
import { BenchProbe } from "./bench-probe.atr.ts";
import config from "./atelier.config.json";

initTokens(config as { tokens: Record<string, Record<string, string>> });
(window as unknown as Record<string, unknown>).__BENCH_READY__ = false;

const probeHost = document.createElement("div");
document.body.appendChild(probeHost);
mountComponent(BenchProbe, {}, probeHost, registry, (schema, d) => validateFlat(schema as never, d));

const data = Array.from({ length: 250 }, (_, i) => ({ id: i, label: "row-" + i }));
const Bench = component(function Bench() {
  const probe = $state("bench marker HMRV0");
  return html\`
    <div class="ppanel">
      <h2 class="text-base font-semibold">{probe}</h2>
      {#each data as d, i}
        <div class="row" data-i={i}><span>{d.label}</span><span class="text-muted">x</span><span>·</span><b>{i}</b></div>
      {/each}
    </div>
  \`.locals({ probe, data });
}, { name: "Bench", schema: { type: "object", reqProps: {}, optProps: {} } });

const host = document.getElementById("app")!;
mountComponent(Bench, {}, host, registry, (schema, d) => validateFlat(schema as never, d));

(window as unknown as Record<string, unknown>).__benchMount = async (samples: number) => {
  const times: number[] = [];
  for (let s = 0; s < samples; s++) {
    host.innerHTML = "";
    const t0 = performance.now();
    mountComponent(Bench, {}, host, registry, (schema, d) => validateFlat(schema as never, d));
    await Promise.resolve(); await Promise.resolve(); // signal engine microtask flush
    times.push(performance.now() - t0);
  }
  const nodes = host.querySelectorAll("*").length;
  (window as unknown as Record<string, unknown>).__BENCH_NODES__ = nodes;
  (window as unknown as Record<string, unknown>).__BENCH_READY__ = true;
  return { times, nodes };
};
(window as unknown as Record<string, unknown>).__BENCH_READY__ = true;
`,
  );
}

function cleanupBenchFiles() {
  if (KEEP) return;
  for (const f of generated) fs.rmSync(f, { force: true });
  fs.rmSync(BENCH_DIST, { recursive: true, force: true });
}

/* ---------- dev server (spawn vite on a dedicated strict port) ---------- */
function startDevServer() {
  const child = spawn("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort"], {
    cwd: APP, stdio: ["ignore", "pipe", "pipe"], shell: true,
  });
  child.stderr.on("data", () => { /* surfaced via wait failure */ });
  // shell:true on Windows leaves the vite grandchild alive after child.kill() (orphan holding the
  // port) — tree-kill instead
  child.killTree = () => {
    if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
  };
  return child;
}
async function waitUp(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(DEV + "/"); if (r.status) return true; } catch { /* retry */ }
    await sleep(400);
  }
  return false;
}

/* ---------- dynamic benches (CDP) ---------- */
async function evalIn(cdp, expression, awaitPromise = false) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, 30000);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
  return r.result?.value;
}

async function benchMount(cdp) {
  const r = await evalIn(cdp, `window.__benchMount(7)`, true);
  const times = [...r.times].sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times[times.length - 1], nodes: r.nodes };
}

async function benchHmr(cdp) {
  // P0-4/P0-5：探针走 .atr.ts（代理真实编辑路径，dev 插件注入 accept → 保值热交换）
  const before = fs.readFileSync(BENCH_PROBE, "utf8");
  if (!before.includes("HMRV0")) return { latencyMs: null, note: "probe marker missing — skipped" };
  const t0 = Date.now();
  fs.writeFileSync(BENCH_PROBE, before.replace("HMRV0", "HMRV2"));
  const t0w = Date.now();
  while (Date.now() - t0w < 10000) {
    try {
      if (await evalIn(cdp, "document.body.innerText.includes('HMRV2')")) {
        const latencyMs = Date.now() - t0;
        fs.writeFileSync(BENCH_PROBE, before); // restore for byte-clean teardown
        return { latencyMs, note: "save→visible (.atr.ts accept path: value-preserving remount)" };
      }
    } catch { /* evaluate races update — retry */ }
    await sleep(40);
  }
  fs.writeFileSync(BENCH_PROBE, before);
  return { latencyMs: null, note: "HMR change never became visible within 10s" };
}

async function benchScreenshot() {
  let token = "";
  try { token = fs.readFileSync(path.join(APP, ".atelier", "dev-token"), "utf8").trim(); } catch { /* empty → 401 */ }
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await fetch(`${DEV}/__atelier/screenshot?compare=1`, {
      signal: AbortSignal.timeout(60000), headers: { "x-atelier-token": token },
    });
    await r.json();
    samples.push(Date.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[1], samples };
}

/* ---------- static bundle (app's own vite) ---------- */
async function benchBundle() {
  const script = `
    const vite = await import("vite");
    await vite.build({
      root: ${JSON.stringify(APP)},
      configFile: false, // bench 独立入口：不带应用 config（token/tailwind 生成与被测运行时无关）
      logLevel: "error",
      build: { outDir: ${JSON.stringify(BENCH_DIST)}, emptyOutDir: true, write: true,
        rollupOptions: { input: ${JSON.stringify(BENCH_HTML)} } },
    });
    console.log("BENCH_BUILD_OK");
  `;
  const r = spawnSync(process.execPath, ["-e", script], { cwd: APP, encoding: "utf8", timeout: 120000 });
  if (!r.stdout?.includes("BENCH_BUILD_OK")) {
    throw new Error(`vite build failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  const assetsDir = path.join(BENCH_DIST, "assets");
  let raw = 0, gz = 0;
  for (const f of fs.readdirSync(assetsDir)) {
    if (!f.endsWith(".js")) continue;
    const buf = fs.readFileSync(path.join(assetsDir, f));
    raw += buf.length;
    gz += zlib.gzipSync(buf, { level: 9 }).length;
  }
  return { rawBytes: raw, gzipBytes: gz };
}

/* ---------- run ---------- */
const log = (m) => { if (!JSON_OUT) console.error(`[bench] ${m}`); };
const server = startDevServer();
let cdpSession = null;
try {
  log(`starting dev server on :${PORT} …`);
  if (!(await waitUp(60000))) die("dev server never came up on port " + PORT, "check the app starts: pnpm dev");
  log("dev server up");

  writeBenchFiles();
  // bench.html 首次写入发生在 server 起来之后没关系——vite 按请求转换
  log("spawning transient browser (cdp :9346) …");
  cdpSession = await openTransientBrowser({ debugPort: 9346 });
  const { cdp } = cdpSession;
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: `${DEV}/bench.html` });
  await cdp.waitEvent("Page.loadEventFired", 20000);
  log("bench page navigating …");

  // wait for page bootstrap
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if (await evalIn(cdp, "window.__BENCH_READY__ === true")) { ready = true; break; } } catch { /* retry */ }
    await sleep(500);
  }
  if (!ready) die("bench page never became ready", "check bench-main.ts compiled (vite logs)");

  log("①/② mount bench (7 samples, 10³ nodes) …");
  results.mount = await benchMount(cdp);
  log(`③ HMR probe …`);
  results.hmr = await benchHmr(cdp);
  log("④ screenshot roundtrip (3 samples) …");
  results.screenshot = await benchScreenshot();
  log("runtime bundle + gzip -9 (app's vite build) …");
  results.bundle = await benchBundle();

  const verdicts = {
    bundleGzipKB: { value: +(results.bundle.gzipBytes / 1024).toFixed(2), target: TARGETS.bundleGzipKB, pass: results.bundle.gzipBytes / 1024 <= TARGETS.bundleGzipKB, unit: "KB gzip -9" },
    mountMedianMs: { value: +results.mount.median.toFixed(2), target: TARGETS.mountMs, pass: results.mount.median <= TARGETS.mountMs, unit: "ms (10³ nodes, median/7)", extra: `nodes=${results.mount.nodes}` },
    hmrMs: { value: results.hmr.latencyMs, target: TARGETS.hmrMs, pass: results.hmr.latencyMs !== null && results.hmr.latencyMs <= TARGETS.hmrMs, unit: "ms save→visible", note: results.hmr.note },
    screenshotMs: { value: results.screenshot.median, target: TARGETS.screenshotMs, pass: results.screenshot.median <= TARGETS.screenshotMs, unit: "ms roundtrip (median/3)" },
  };
  results.verdicts = verdicts;

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\nAtelier 性能基线 — SPEC §7 (${new Date().toISOString()})`);
    console.log("─".repeat(74));
    for (const [k, v] of Object.entries(verdicts)) {
      const val = v.value === null ? "n/a" : `${v.value}${v.unit.startsWith("KB") ? " " + v.unit.split(" ")[0] : " ms"}`;
      console.log(`${v.pass ? "PASS" : "FAIL"}  ${k.padEnd(16)} ${String(val).padEnd(16)} 目标 ${v.target}${v.note ? `  — ${v.note}` : ""}${v.extra ? `  (${v.extra})` : ""}`);
    }
    console.log("─".repeat(74));
    const fails = Object.entries(verdicts).filter(([, v]) => !v.pass);
    if (fails.length) {
      console.log(`FAIL×${fails.length} — 按 SPEC §7，超标项转为 P0 修复工单（详见 docs/BACKLOG.md），不默认豁免。`);
    } else console.log("ALL PASS ✔");
    console.log(`full results → ${path.join(APP, ".atelier", "bench.json")}`);
  }
  fs.mkdirSync(path.join(APP, ".atelier"), { recursive: true });
  fs.writeFileSync(path.join(APP, ".atelier", "bench.json"), JSON.stringify(results, null, 2) + "\n");
} finally {
  try { cdpSession?.close(); } catch { /* already gone */ }
  try { server.killTree(); } catch { /* already gone */ }
  cleanupBenchFiles();
}
