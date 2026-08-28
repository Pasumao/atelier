/**
 * dev-screenshot.mjs — decision 7/12: `ui.screenshot` implementation (zero-dependency mini CDP client).
 *
 * Spawns a TRANSIENT headless Chromium/Edge instance attached only to the capture request:
 *   spawn --headless=new → wait CDP endpoint → open blank tab → Page.navigate(appUrl)
 *   → wait loadEventFired → poll "#app > *" (framework mounted, not just DOM ready)
 *   → settle delay → Page.captureScreenshot → base64 PNG.
 *
 * Everything is cleaned up in finally (browser killed, temp profile removed).
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

/** Spawn a transient headless browser and attach a CDP session (no navigation).
 *  Shared primitive for capturePage and bench.mjs — spawn/attach sequence lives here once. */
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
      // 一次性截图实例用进程内 GPU，规避该故障域。
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

/** Capture a full-page PNG (base64) of the given URL using a transient headless browser.
 *  Optional compareBase64 (previous PNG): computes a per-pixel mismatchRatio in the same
 *  transient session via canvas evaluate (P1-8) — zero npm dependencies. */
export async function capturePage({ url, settleMs = 1200, compareBase64 = null, threshold = 0.12 }) {
  const session = await openTransientBrowser();
  const { cdp } = session;
  try {
    await cdp.send("Page.enable");
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
        await sleep(250);
      }
      return false;
    };
    if (!(await ready(10000))) {
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
      // P1-8 像素级对比：同一瞬态实例内 canvas evaluate——sha256 字节对比对字体抗锯齿太脆，
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
  } finally {
    session.close(); // ws close + browser kill + delayed profile cleanup
  }
}
