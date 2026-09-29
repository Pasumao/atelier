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
 * 诚实标注：④ 自 P0-6 起走常驻无头实例（同 tab 复用 + 崩溃自愈），实测 ~300ms 达标；
 * 瞬态路径（openTransientBrowser）保留用于 bench 自己的驱动实例与独立捕获。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { openTransientBrowser } from "../dev/dev-screenshot.mjs";

const TARGETS = { bundleGzipKB: 30, mountMs: 50, hmrMs: 100, screenshotMs: 500 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// P1-10（建议书 A5）：die 改抛专用错误——退出统一收口到外层 catch/finally 之后，失败路径也走
// finally 清理（关浏览器/killTree/删生成物），不再有 process.exit 跳过 finally 留下孤儿 dev server
// 占住 strictPort（下次 bench 的 waitUp 只探端口可达，会对陈旧实例出数）
class DieExit extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = "DieExit";
    this.dieExit = true;
    this.code = code;
  }
}
// die 签名全仓大一统（建议书 A5）：die(msg, code = 2)——msg 单串自含 error/fix 全部文案
function die(msg, code = 2) {
  throw new DieExit(msg, code);
}

const argv = process.argv.slice(2);
const argOf = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const APP = path.resolve(argOf("--app") ?? process.cwd());
const PORT = Number(argOf("--port") ?? 5199);
const JSON_OUT = argv.includes("--json");
const KEEP = argv.includes("--keep");
const DEV = `http://127.0.0.1:${PORT}`;

const results = {};
const BENCH_HTML = path.join(APP, "bench.html");
const BENCH_TS = path.join(APP, "bench-main.ts");
const BENCH_PROBE = path.join(APP, "bench-probe.atr.ts"); // .atr.ts 后缀 → dev 插件注入 HMR accept（P0-5 路径）
const BENCH_DIST = path.join(APP, ".atelier", "bench-dist");
const generated = [];
const APP_OK = () => {
  // 前提检查（原在模块顶层的三个 die 前置门——die 改 throw 后移入 run 的 try 由外层 catch 承接，
  // 语义不变：缺件即非零退出 + error/fix 双行）
  if (!fs.existsSync(path.join(APP, "package.json"))) die(`error: no app at ${APP}\nfix: pass an init'd Atelier app (--app <dir>)`, 1);
  if (!fs.existsSync(path.join(APP, "node_modules"))) die(`error: app deps not installed\nfix: cd ${APP} && pnpm install`, 1);
  if (!fs.existsSync(path.join(APP, "src", "runtime"))) die(`error: no vendored runtime at src/runtime\nfix: re-init the app: atelier init --target . --name <Name>`, 1);
};

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

/* ---------- 无头浏览器残留差分收口（win32） ---------- */
// ④ 截图回环的 persistent 实例挂在 vite 进程内：bench 对 vite 是 taskkill 强杀
// （TerminateProcess 不走 exit 钩子，dev-screenshot 的退出清理与空闲看门狗同死）——
// persistent 浏览器必漏成孤儿（2026-09-29 E2E 实证 16 PID）。杀者侧按 atelier-shot
// 一次性 profile 标记（dev-screenshot spawn 实例 cmdline 独有，不误伤日常 Edge）做
// 基线差分：基线外出现的实例都是本 run 产物，逐树 taskkill（根=真浏览器活着，/T 走
// 得到子树；启动器让位自退后 child.pid 已死，必须按标记反查）。concurrently 存量实例
// 在基线内，绝不动。
function listShotBrowserPids() {
  if (process.platform !== "win32") return [];
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'atelier-shot' } | " +
    "ForEach-Object { $_.ProcessId }";
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 15000 });
    return String(r.stdout ?? "").split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  } catch { return []; }
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
// P1-10：外层 try/catch 收口——die 抛 DieExit 由 catch 记录，finally（关浏览器/killTree/清理）
// 在任何失败路径都先执行，之后才以非零码退出。成功/失败对称显式收口（flushExit）：close 已把
// CDP ws 等句柄面清到最好，但进程退出不再赌「事件循环自然清空」——句柄清空判定不归本进程控制
// （1.1.0 批出数后挂死 8 分钟实证），成功路径同样显式 exit，仅保 stdout 冲刷先行。
let exitCode = 0;
try {
  APP_OK();
  const shotBaseline = new Set(listShotBrowserPids()); // 差分基线：只收本 run 期间新出现的实例
  const server = startDevServer();
  let cdpSession = null;
  try {
    log(`starting dev server on :${PORT} …`);
    if (!(await waitUp(60000))) die(`error: dev server never came up on port ${PORT}\nfix: check the app starts: pnpm dev`, 1);
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
    if (!ready) die(`error: bench page never became ready\nfix: check bench-main.ts compiled (vite logs)`, 1);

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
    // persistent 实例差分补刀（见 listShotBrowserPids 注）：killTree 之后扫，新出现的
    // atelier-shot 实例逐树 taskkill——已死 pid 报 not found 无害
    for (const pid of listShotBrowserPids()) {
      if (!shotBaseline.has(pid)) {
        try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
      }
    }
  }
} catch (e) {
  // die（DieExit）= 已格式化文案直接上报；意外异常 = 连栈上报（诊断面不缩水）；exit 一律非零
  if (e?.dieExit) {
    console.error(e.message);
    exitCode = e.code ?? 1;
  } else {
    console.error(e?.stack ?? String(e));
    exitCode = 1;
  }
}
/**
 * 显式收口（成功/失败对称，P1-10 同一出口）：管道下 stdout 可能尚未冲刷完——writableLength > 0
 * 时等一次 drain 再退（对端消失则 error/close 兜底同退，绝不因等冲刷引入新挂点），否则直接退。
 * stderr 同理可略：诊断文案短，无截断之虞。
 */
function flushExit(code) {
  const out = process.stdout;
  if (out.writableLength <= 0) { process.exit(code); }
  out.once("drain", () => process.exit(code));
  out.once("error", () => process.exit(code));
  out.once("close", () => process.exit(code));
}
if (exitCode) flushExit(exitCode);
flushExit(0);
