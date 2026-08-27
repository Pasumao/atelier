/**
 * qa-fullpage.mjs — 临时全页视觉 QA（不改动正式插件）。
 * 复用 dev-screenshot 的 CDP 思路，仅把 --window-size 拉高到全页高度，
 * 让 Page.captureScreenshot 一次拍到整页内容。
 * 用法：在 prototype/ 下 node scripts/qa-fullpage.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_TO_SHOT = "http://127.0.0.1:5173/";
const OUT = path.resolve(import.meta.dirname, "..", "..", "review-full.png");
const WIDTH = 1280, HEIGHT = 5600;

function findBrowser() {
  const candidates = [
    process.env.ATELIER_EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  throw new Error("msedge.exe not found");
}
async function waitEndpoint(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`CDP endpoint not ready: ${url}`);
}
class MiniCdp {
  constructor(ws) { this.ws = ws; this.nextId = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", (ev) => { const m = JSON.parse(String(ev.data));
      if (m.id !== undefined && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else if (m.method) this.events.push(m); });
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.nextId; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async waitEvent(method, timeoutMs) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const i = this.events.findIndex((e) => e.method === method); if (i >= 0) return this.events.splice(i, 1)[0]; await sleep(100); } throw new Error(`event timeout: ${method}`); }
}

const exe = findBrowser();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-qa-"));
const child = spawn(exe, ["--headless=new", "--remote-debugging-port=9366", `--user-data-dir=${userData}`, "--no-first-run", "--disable-gpu", `--window-size=${WIDTH},${HEIGHT}`, "about:blank"], { stdio: "ignore" });
let ws;
try {
  await waitEndpoint("http://127.0.0.1:9366/json/version", 10000);
  const tabRes = await fetch(`http://127.0.0.1:9366/json/new?url=about:blank`, { method: "PUT" });
  const tab = await tabRes.json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws failed")); });
  const cdp = new MiniCdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: URL_TO_SHOT });
  await cdp.waitEvent("Page.loadEventFired", 15000);
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const r = await cdp.send("Runtime.evaluate", { expression: "!!document.querySelector('#app > *')", returnByValue: true });
    if (r.result?.value === true) break;
    await sleep(250);
  }
  await sleep(3200); // 流式+注册表+stats tick 充分落定
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log("saved", OUT, `viewport ${WIDTH}x${HEIGHT}`);

  // 逐页签点击 → 截图，作为交互面板的视觉证据
  for (let i = 0; i < 6; i++) {
    await cdp.send("Runtime.evaluate", {
      expression: `(function(){const b=document.querySelectorAll('.lab__tab')[${i}];if(b)b.click();return true;})()`,
      returnByValue: true,
    });
    await sleep(1400);
    const probe = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({on:document.querySelector('.lab__tab--on')?.textContent||null,panels:document.querySelectorAll('.ppanel').length})`,
      returnByValue: true,
    });
    console.log(`after click[${i}] active=${probe.result?.value}`);
    const tabShot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.resolve(import.meta.dirname, "..", "..", `review-tab${i}.png`), Buffer.from(tabShot.data, "base64"));
    console.log("saved review-tab" + i + ".png");
  }
} finally {
  try { ws?.close(); } catch {}
  child.kill();
  setTimeout(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} }, 1500);
}
