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
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
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

/** Capture a full-page PNG (base64) of the given URL using a transient headless browser. */
export async function capturePage({ url, debugPort = 9345, settleMs = 1200 }) {
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
      "--window-size=1280,860",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let ws;
  try {
    await waitEndpoint(`http://127.0.0.1:${debugPort}/json/version`, 10000);

    // attach BEFORE navigating so no lifecycle event is missed
    const tabRes = await fetch(`http://127.0.0.1:${debugPort}/json/new?url=about:blank`, { method: "PUT" });
    if (!tabRes.ok) throw new Error(`/json/new returned HTTP ${tabRes.status}`);
    const tab = await tabRes.json();
    if (!tab.webSocketDebuggerUrl) throw new Error("target has no webSocketDebuggerUrl");

    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("cdp websocket failed"));
    });
    const cdp = new MiniCdp(ws);

    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url });
    await cdp.waitEvent("Page.loadEventFired", 15000);

    // framework-level readiness: #app actually has children (signals mounted & rendered)
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "!!document.querySelector('#app > *')",
        returnByValue: true,
      });
      if (r.result?.value === true) break;
      await sleep(250);
    }
    await sleep(settleMs); // let microtask renders / fonts settle

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    return shot.data; // base64 PNG
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    child.kill();
    // profile dir may still be held briefly by the exiting browser — best-effort delayed cleanup
    setTimeout(() => {
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* next time */ }
    }, 1500);
  }
}
