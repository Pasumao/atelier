/**
 * probe3-capture.mjs — 稳定截图工具（探针流程：无轮询、固定 settle、capture 单次重试）。
 * node scripts/probe3-capture.mjs [out.png] [url]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGET = process.argv[3] ?? "http://127.0.0.1:5173/?snapshot=1";
const OUT = path.resolve(process.argv[2] ?? "../review-shot.png");
const PORT = 9399;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function findBrowser() {
  for (const p of [process.env.ATELIER_EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  throw new Error("no edge");
}

const exe = findBrowser();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-probe-"));
const child = spawn(exe, ["--headless=new", "--remote-debugging-port=9399", `--user-data-dir=${userData}`, "--no-first-run", "--disable-gpu", "--in-process-gpu", "--window-size=1280,860", "about:blank"], { stdio: "ignore" });
let ws;
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { try { if ((await fetch(`http://127.0.0.1:9399/json/version`)).ok) up = true; } catch {} if (!up) await sleep(200); }
  log("cdp:", up);
  const tab = await (await fetch(`http://127.0.0.1:9399/json/new?url=about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await Promise.race([new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("ws err")); }), sleep(5000).then(() => { throw new Error("ws open timeout"); })]);
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(String(ev.data)); if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.t); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => { const id = ++seq; const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, timeoutMs); pending.set(id, { resolve: (v) => resolve(v), reject, t }); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  await send("Page.navigate", { url: TARGET });
  await sleep(3000);
  for (let i = 0; i < 20; i++) {
    const r = await send("Runtime.evaluate", { expression: "!!document.querySelector('#app > *')", returnByValue: true }, 8000);
    if (r.result?.value === true) break;
    await sleep(300);
  }
  await sleep(1500);
  let shot;
  try {
    shot = await send("Page.captureScreenshot", { format: "png" }, 15000);
  } catch {
    log("capture retry…");
    shot = await send("Page.captureScreenshot", { format: "png" }, 15000);
  }
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  log("saved", OUT, fs.statSync(OUT).size, "bytes");
} catch (e) {
  log("FAIL:", e.message);
} finally {
  try { ws?.close(); } catch {}
  child.kill();
  setTimeout(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} }, 1200);
  process.exit(0);
}
