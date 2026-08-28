/**
 * probe-mount.mjs — 一次性诊断（用完可删）：无头打开应用页，
 * 抓 console / 未捕获异常 / 失败网络请求 / #app 挂载状态。
 * 复用 dev-screenshot.mjs 的 mini CDP 模式。
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
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { /* ignore */ } }
  throw new Error("msedge.exe not found");
}

const debugPort = 9347;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-probe-"));
const exe = findBrowser();
const child = spawn(exe, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`,
  "--no-first-run", "--disable-gpu", "--in-process-gpu", "about:blank",
], { stdio: "ignore" });
const logs = [];
const netFails = [];

function wire(cdp) {
  cdp.ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      logs.push(`[console.${msg.params.type}] ${text.slice(0, 400)}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      logs.push(`[exception] ${d.text} ${d.exception?.description ?? ""}`.slice(0, 600));
    } else if (msg.method === "Log.entryAdded") {
      logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`.slice(0, 400));
    } else if (msg.method === "Network.responseReceived") {
      const { status, url } = msg.params.response;
      if (status >= 400) netFails.push(`[http ${status}] ${url}`);
    } else if (msg.method === "Network.loadingFailed") {
      netFails.push(`[net-fail ${msg.params.errorText}] ${msg.params.requestId}`);
    }
  });
}

async function main() {
  await new Promise(async (resolve, reject) => {
    const t0 = Date.now();
    (async () => {
      while (Date.now() - t0 < 10000) {
        try { const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`); if (r.ok) return resolve(); } catch { /* retry */ }
        await sleep(200);
      }
      reject(new Error("cdp endpoint timeout"));
    })();
  });
  const tabRes = await fetch(`http://127.0.0.1:${debugPort}/json/new?url=about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
  const tab = await tabRes.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("ws fail")); setTimeout(() => reject(new Error("ws timeout")), 5000); });
  const nextId = { n: 0 };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId.n;
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener("message", onMsg); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  wire({ ws });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: process.env.PROBE_URL ?? "http://127.0.0.1:5173/?snapshot=1" });
  await sleep(15000);
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true });
    return r.result?.value;
  };
  console.log("mounted:", await evalJs("!!document.querySelector('#app > *')"));
  console.log("appChildren:", await evalJs("document.querySelectorAll('#app > *').length"));
  console.log("appHtmlHead:", String(await evalJs("document.querySelector('#app').innerHTML")).slice(0, 300));
  console.log("mainScriptLoaded:", await evalJs("!!document.querySelector('script[src*=\"main.ts\"]')"));
  console.log("--- network fails ---");
  netFails.forEach((l) => console.log(l));
  console.log("--- console/log ---");
  logs.slice(0, 40).forEach((l) => console.log(l));
}

main().catch((e) => { console.error("probe error:", e.message); process.exitCode = 1; }).finally(() => {
  try { child.kill(); } catch { /* */ }
  setTimeout(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* */ } }, 1500);
});
