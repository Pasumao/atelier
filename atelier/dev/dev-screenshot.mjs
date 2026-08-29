/**
 * dev-screenshot.mjs — decision 7/12: `ui.screenshot` implementation (zero-dependency mini CDP client).
 *
 * 两种捕获模式，共享同一条捕获序列（captureOnSession 单一来源）：
 *  - 瞬态（capturePage）：每拍瞬态无头实例 spawn → 捕获 → kill。兼容 API，独立捕获不串扰。
 *  - 常驻（capturePagePersistent，P0-6）：模块级持有一只常驻无头实例，截图复用同一 tab
 *    重新导航捕获，省掉每拍浏览器冷启动；任何失败（崩溃/挂起/断连）→ 销毁重建，只重试一次。
 *    dev 进程退出时同步 kill（不留孤儿浏览器）。
 *
 * 捕获序列（两模式共用）：
 *   Page.navigate(appUrl) → wait loadEventFired → poll "#app > *"（框架挂载，非仅 DOM ready）
 *   → 未就绪则 Page.reload 一次再轮询（绝不拍白屏当基线）→ settle → Page.captureScreenshot
 *   → （有 compareBase64 时）同实例 canvas evaluate 逐像素归一化距离（P1-8）。
 *
 * Node >= 22 provides the native WebSocket client used here.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.ATELIER_EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  throw new Error("msedge.exe not found — set ATELIER_EDGE_PATH to the browser executable");
}

async function waitEndpoint(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error(`CDP endpoint not ready within ${timeoutMs}ms: ${url}`);
}

class MiniCdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      // 每条 CDP 命令都有时限：任何一步挂起都应变成可诊断错误而非黑挂
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp send timeout (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.pending.get(id).timer = timer;
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async waitEvent(method, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i >= 0) return this.events.splice(i, 1)[0];
      await sleep(100);
    }
    throw new Error(`CDP event timeout: ${method}`);
  }
}

/** Spawn a headless browser and attach a CDP session (no navigation).
 *  Transient 模式的底座，也是常驻实例的出生路径——spawn/attach 序列只写这一份。 */
export async function openTransientBrowser({ debugPort = 9345 } = {}) {
  const exe = findBrowser();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-shot-"));
  const child = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userData}`,
      "--no-first-run",
      "--disable-gpu",
      // 决策 7/12 加固：独立 GPU 进程在频繁起杀无头实例后可能卡死合成器，
      // 导致 Page.captureScreenshot 永久挂起（2026-08-27 实测事故）。
      // 进程内 GPU 规避该故障域；常驻实例无起杀churn，该 flag 继续保留（自愈兜底仍在）。
      "--in-process-gpu",
      "--window-size=1280,860",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const close = () => {
    try { child.kill(); } catch { /* already gone */ }
    setTimeout(() => {
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* next time */ }
    }, 1500);
  };
  try {
    await waitEndpoint(`http://127.0.0.1:${debugPort}/json/version`, 10000);
    // attach on a fresh tab BEFORE navigating so no lifecycle event is missed
    const tabRes = await fetch(`http://127.0.0.1:${debugPort}/json/new?url=about:blank`, {
      method: "PUT",
      signal: AbortSignal.timeout(5000),
    });
    if (!tabRes.ok) throw new Error(`/json/new returned HTTP ${tabRes.status}`);
    const tab = await tabRes.json();
    if (!tab.webSocketDebuggerUrl) throw new Error("target has no webSocketDebuggerUrl");
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    // 看门狗：ws 握手必须有时限——无界 onopen 等待曾让 screenshotInflight 永久挂起，
    // 级联卡死后续所有截图请求（dev 面级联超时）
    await Promise.race([
      new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("cdp websocket failed"));
      }),
      sleep(5000).then(() => { throw new Error("cdp websocket open timeout (5s)"); }),
    ]);
    return { child, close, cdp: new MiniCdp(ws) };
  } catch (e) {
    close();
    throw e;
  }
}

/* ---------- 共享捕获序列（瞬态 / 常驻单一来源） ---------- */

function drainEvents(cdp, method) {
  // 常驻实例的事件队列跨拍累积：navigate/reload 前先清掉同名陈旧事件，
  // 防止 waitEvent 消费上一轮的遗留而误判「已加载」（复用场景独有，瞬态天然无此问题）
  for (let i = cdp.events.length - 1; i >= 0; i--) {
    if (cdp.events[i].method === method) cdp.events.splice(i, 1);
  }
}

async function captureOnSession(cdp, { url, settleMs, compareBase64 = null, threshold = 0.12, readyPollMs = 250 }) {
  if (!cdp.__pageEnabled) {
    await cdp.send("Page.enable");
    cdp.__pageEnabled = true;
  }
  drainEvents(cdp, "Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await cdp.waitEvent("Page.loadEventFired", 15000);

  // framework-level readiness: #app actually has children (signals mounted & rendered)
  // 冷服务器首载会触发依赖优化 → vite 自动整页 reload，首轮轮询可能全空；
  // 未就绪则 Page.reload 一次再轮询（仍 15s 上限），绝不拍白屏当基线
  const ready = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "!!document.querySelector('#app > *')",
        returnByValue: true,
      });
      if (r.result?.value === true) return true;
      await sleep(readyPollMs);
    }
    return false;
  };
  if (!(await ready(10000))) {
    drainEvents(cdp, "Page.loadEventFired");
    await cdp.send("Page.reload", {}, 10000);
    await cdp.waitEvent("Page.loadEventFired", 15000);
    if (!(await ready(15000))) {
      throw new Error("app did not mount before capture (#app stayed empty)");
    }
  }
  await sleep(settleMs); // let microtask renders / fonts settle

  // 捕获 + 单次重试：captureScreenshot 偶发瞬态挂起（合成器），重试即成功；
  // 重试前重验挂载——防止「优化重载清空 DOM 后把白屏当成功」污染基线
  const mountOk = async () => {
    const r = await cdp.send("Runtime.evaluate", {
      expression: "!!document.querySelector('#app > *')",
      returnByValue: true,
    }, 8000);
    return r.result?.value === true;
  };
  const shot = await (async () => {
    try {
      return await cdp.send("Page.captureScreenshot", { format: "png" }, 15000);
    } catch {
      if (!(await mountOk())) throw new Error("app wiped before capture (vite reload race)");
      return await cdp.send("Page.captureScreenshot", { format: "png" }, 15000);
    }
  })();
  let pixelDiff = null;
  if (compareBase64) {
    // P1-8 像素级对比：同一实例内 canvas evaluate——sha256 字节对比对字体抗锯齿太脆，
    // 逐像素归一化距离才是视觉真相。零 npm 依赖（Image+canvas 全在页面里跑）。
    const expr = `(async () => {
      const load = (b64) => new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("image decode failed"));
        i.src = "data:image/png;base64," + b64;
      });
      const [ia, ib] = await Promise.all([load(${JSON.stringify(shot.data)}), load(${JSON.stringify(compareBase64)})]);
      const dimsDiffer = ia.width !== ib.width || ia.height !== ib.height;
      const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
      const draw = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
        return c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, img.width, img.height).data;
      };
      const da = draw(ia), db = draw(ib);
      let diff = 0;
      const norm = Math.sqrt(3) * 255;
      for (let p = 0; p < w * h; p++) {
        const i4 = p * 4;
        const d = Math.sqrt((da[i4]-db[i4])**2 + (da[i4+1]-db[i4+1])**2 + (da[i4+2]-db[i4+2])**2) / norm;
        if (d > ${Number(threshold || 0.12)}) diff++;
      }
      return { mismatchRatio: dimsDiffer ? 1 : diff / (w * h), diffPixels: dimsDiffer ? w * h : diff, width: w, height: h, dimsDiffer };
    })()`;
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, 20000);
    if (r.exceptionDetails) throw new Error(`pixel compare failed: ${r.exceptionDetails.text}`);
    pixelDiff = r.result?.value ?? null;
  }
  return { imageBase64: shot.data, pixelDiff }; // base64 PNG (+ P1-8 pixel verdict when requested)
}

/** Transient capture: 每拍一只无头实例（兼容 API；独立捕获/排查场景用）。
 *  Optional compareBase64 (previous PNG): computes a per-pixel mismatchRatio in the same
 *  session via canvas evaluate (P1-8) — zero npm dependencies. */
export async function capturePage({ url, settleMs = 1200, compareBase64 = null, threshold = 0.12 }) {
  const session = await openTransientBrowser();
  try {
    return await captureOnSession(session.cdp, { url, settleMs, compareBase64, threshold });
  } finally {
    session.close(); // ws close + browser kill + delayed profile cleanup
  }
}

/* ---------- P0-6：常驻无头实例（崩溃自愈） ---------- */

let persistentSession = null; // { child, close, cdp, dead }
let persistentStarting = null;
let exitHookInstalled = false;

const persistentPort = () => Number(process.env.ATELIER_SHOT_PORT ?? 9345);

function registerExitCleanup() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // 同步 best-effort：dev 进程退出不能留下孤儿无头浏览器（临时 profile 交给 OS 清）
  process.on("exit", () => {
    if (persistentSession) { try { persistentSession.child.kill(); } catch { /* already gone */ } }
  });
}

async function getPersistentSession() {
  if (persistentSession && !persistentSession.dead) return persistentSession;
  if (persistentStarting) return persistentStarting;
  const starting = (async () => {
    const s = await openTransientBrowser({ debugPort: persistentPort() });
    s.dead = false;
    s.child.on("exit", () => { s.dead = true; });
    s.cdp.ws.addEventListener("close", () => { s.dead = true; });
    persistentSession = s;
    registerExitCleanup();
    return s;
  })();
  persistentStarting = starting;
  try {
    return await starting;
  } finally {
    if (persistentStarting === starting) persistentStarting = null;
  }
}

async function destroyPersistentSession() {
  const s = persistentSession;
  persistentSession = null;
  if (!s) return;
  s.dead = true;
  try { s.close(); } catch { /* already gone */ }
}

/** 显式关闭常驻实例（dev server 关停钩子 / 测试收尾用）。幂等。 */
export async function closePersistentBrowser() {
  await destroyPersistentSession();
}

/** P0-6 常驻实例捕获：同一 tab 重新导航捕获；失败（崩溃/挂起/断连）→ 销毁重建，只重试一次。
 *  warm 拍摄省掉浏览器冷启动：settle 与就绪轮询都用更紧的节奏（语义不变，只是不等已成定局的事）。
 *  Optional compareBase64 (previous PNG): computes a per-pixel mismatchRatio in the same
 *  session via canvas evaluate (P1-8) — zero npm dependencies. */
export async function capturePagePersistent({ url, settleMs = 120, compareBase64 = null, threshold = 0.12, readyPollMs = 50 }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const session = await getPersistentSession();
    try {
      // 复用前快速活性探针（2s 上限）：死会话上的正式命令要等满超时，探针先把最坏情况短路
      await session.cdp.send("Runtime.evaluate", { expression: "1", returnByValue: true }, 2000);
      return await captureOnSession(session.cdp, { url, settleMs, compareBase64, threshold, readyPollMs });
    } catch (e) {
      lastErr = e;
      await destroyPersistentSession();
      // 不额外 sleep：重建 spawn 的开销本身就是退避
    }
  }
  throw lastErr;
}
