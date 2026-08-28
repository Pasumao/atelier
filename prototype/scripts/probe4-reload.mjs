/**
 * probe4-reload.mjs — 诊断：4 秒窗口内统计页面是否在自刷新。
 * node scripts/probe4-reload.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9399;
const log = (...a) => console.log(...a);

const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-probe-"));
const child = spawn(exe, ["--headless=new", "--remote-debugging-port=9399", `--user-data-dir=${userData}`, "--no-first-run", "--disable-gpu", "--in-process-gpu", "--window-size=1280,860", "about:blank"], { stdio: "ignore" });
let ws;
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { try { if ((await fetch(`http://127.0.0.1:9399/json/version`)).ok) up = true; } catch {} if (!up) await sleep(200); }
  const tab = await (await fetch(`http://127.0.0.1:9399/json/new?url=about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await Promise.race([new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("ws err")); }), sleep(5000).then(() => { throw new Error("ws timeout"); })]);
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(String(ev.data)); if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.t); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => { const id = ++seq; const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, timeoutMs); pending.set(id, { resolve, reject, t }); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.addEventListener('beforeunload',()=>{console.log('[HOOK] beforeunload; initiator:', new Error().stack?.split('\\n').slice(1,4).join(' | '))})` });
  await send("Runtime.enable");
  await send("Log.enable");
  const consoleLines = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.method === "Runtime.consoleAPICalled") {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      if (text.includes("vite") || text.includes("reload") || text.includes("error")) consoleLines.push(`[console] ${text}`);
    }
    if (m.method === "Log.entryAdded") consoleLines.push(`[log] ${m.params.entry.text} url=${m.params.entry.url ?? ""}`);
  });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
  await sleep(3000);
  const expr = `JSON.stringify({nav: performance.getEntriesByType('navigation').length, type: performance.getEntriesByType('navigation')[0]?.type, now: Math.round(performance.now()/1000), appLen: (document.getElementById('app')?.innerHTML||'').length})`;
  const a = JSON.parse((await send("Runtime.evaluate", { expression: expr, returnByValue: true }, 8000)).result.value);
  await sleep(8000);
  const b = JSON.parse((await send("Runtime.evaluate", { expression: expr, returnByValue: true }, 8000)).result.value);
  log(`t0: navigations=${a.nav} pageAge=${a.now}s appLen=${a.appLen}`);
  log(`t1: navigations=${b.nav} pageAge=${b.now}s appLen=${b.appLen}`);
  if (b.nav > a.nav || b.now < a.now || b.appLen === 0) log("RESULT: 页面在自刷新 ❌");
  else log("RESULT: 页面稳定 ✔（无自刷新）");
  log("--- console ---");
  for (const l of consoleLines.slice(-25)) log(l);
  log("--- in-page auth probe ---");
  const auth = await send("Runtime.evaluate", {
    expression: `JSON.stringify({hasTok: !!window.__ATELIER_TOKEN__, withTok: (await fetch('/__atelier/registry', {headers:{'x-atelier-token': window.__ATELIER_TOKEN__ ?? ''}})).status, noTok: (await fetch('/__atelier/registry')).status})`,
    awaitPromise: true,
    returnByValue: true,
  }, 10000);
  log("auth probe:", auth.result.value);
} catch (e) {
  log("PROBE FAIL:", e.message);
} finally {
  try { ws?.close(); } catch {}
  child.kill();
  setTimeout(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} }, 1200);
  process.exit(0);
}
