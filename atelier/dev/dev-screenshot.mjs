/**
 * dev-screenshot.mjs — decision 7/12: `ui.screenshot` implementation (zero-dependency mini CDP client).
 *
 * 两种捕获模式，共享同一条捕获序列（captureOnSession 单一来源）：
 *  - 瞬态（capturePage）：每拍瞬态无头实例 spawn → 捕获 → kill。兼容 API，独立捕获不串扰。
 *  - 常驻（capturePagePersistent，P0-6）：模块级持有一只常驻无头实例，截图复用同一 tab
 *    重新导航捕获，省掉每拍浏览器冷启动；任何失败（崩溃/挂起/断连）→ 销毁重建，只重试一次。
 *    dev 进程退出时同步 kill（不留孤儿浏览器）；空闲超时即杀（P1-12，收紧 CDP 暴露窗）。
 *
 * CDP 暴露面（P1-12 ③）：CDP 端口无任何鉴权——能连上即全权控制浏览器。评估过
 * --remote-debugging-pipe：本文件的 CDP 客户端经 HTTP /json 端点发现 target + WebSocket
 * attach（MiniCdp），改 pipe 需要 Target.attachToTarget(flatten) 会话层重写，回归风险大于收益，
 * 故取 fallback 束：显式绑回环 + 每次随机端口 + 一次性 profile + 瞬态用后即杀/常驻空闲即杀。
 * 残余风险：本机其他用户/进程在实例存活窗口内仍可扫到端口接入（win32 无 per-user 网络隔离）。
 *
 * 捕获序列（两模式共用）：
 *   Page.navigate(appUrl) → wait loadEventFired → poll "#app > *"（框架挂载，非仅 DOM ready）
 *   → 未就绪则 Page.reload 一次再轮询（绝不拍白屏当基线）→ settle → Page.captureScreenshot
 *   → （有 compareBase64 时）同实例 canvas evaluate 逐像素归一化距离（P1-8）。
 *
 * Node >= 22 provides the native WebSocket client used here.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** P1-12 ③：向 OS 要一个当前空闲的回环端口（net 探测后释放）。随机端口关掉「固定 9345 被抢占
 *  接错实例」与「扫描即达」两扇门。探测与浏览器真正 bind 之间有窄竞态窗口——waitEndpoint 会如实
 *  失败暴露，不做隐藏重试。 */
export async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function findBrowser() {
  const candidates = [
    process.env.ATELIER_EDGE_PATH,
    // Linux CI/桌面候选（GitHub runner 预装 google-chrome-stable；容器常见 chromium 系）
    ...(process.platform === "linux"
      ? ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
      : []),
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
 *  Transient 模式的底座，也是常驻实例的出生路径——spawn/attach 序列只写这一份。
 *  P1-12 ③：debugPort 缺省 = 每次随机空闲端口（显式传参/env ATELIER_SHOT_PORT 可覆盖）；
 *  --remote-debugging-address=127.0.0.1 是显式化（Chromium 缺省即回环，写明意图防漂移）。 */
export async function openTransientBrowser({ debugPort } = {}) {
  const exe = findBrowser();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-shot-"));
  const port = Number(debugPort) || (await pickFreePort());
  const child = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${userData}`,
      "--no-first-run",
      "--disable-gpu",
      // 决策 7/12 加固：独立 GPU 进程在频繁起杀无头实例后可能卡死合成器，
      // 导致 Page.captureScreenshot 永久挂起（2026-08-27 实测事故）。
      // 进程内 GPU 规避该故障域；常驻实例无起杀churn，该 flag 继续保留（自愈兜底仍在）。
      "--in-process-gpu",
      // Linux CI（root/无 user namespace 容器）沙箱不可用时实例起不来——加 no-sandbox
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "--window-size=1280,860",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  // close = ws 关闭 + win32 树杀 + unref 延迟清理——三面全清后事件循环可自然清空（进程自然落出）。
  // 幂等（二次调用 no-op，含 open 失败 catch 路径与消费方重复 close）；保持同步调用形态，
  // fire-and-forget 消费方（capturePage finally / bench finally / destroyPersistentSession）不破坏。
  let ws = null; // CDP WebSocket：close 先于主体可达（open 中途失败也要能关），主体内赋值
  let closed = false;
  // win32 树杀（bench.mjs killTree 先例同款 spawnSync 同步等待）：无头 Edge/Chrome 是
  // crashpad/gpu/renderer 进程树，child.kill() 只杀直属进程。且 Edge 直属启动进程会让位真
  // 浏览器后自退——child.pid 在 close 时多半已死，taskkill /T 以死根起步直接 not found、整树
  // 漏杀（2026-09-29 bench E2E 实证 9346 残留）。故按 debug port 的 LISTENING 套接字反查真
  // 浏览器 pid 再树杀（根活着 /T 才走得到子树）；反查不到（open 早败/尚未 bind）退回 child.pid
  // 兜底。spawnSync 返回即整树已死，close 后接显式 exit 也不会把树杀赛跑进 exit 之后。
  const killTreeWin32 = () => {
    const pids = new Set();
    if (child.pid) pids.add(child.pid);
    try {
      const { stdout } = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
      // 数据行不随系统本地化（LISTENING 为英文态），只认 127.0.0.1 显式回环上的监听行
      for (const m of String(stdout ?? "").matchAll(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/gm)) {
        if (Number(m[1]) === port) pids.add(Number(m[2]));
      }
    } catch { /* netstat 失败仍有 child.pid 兜底 */ }
    for (const pid of pids) {
      try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
    }
  };
  const close = () => {
    if (closed) return; // 幂等：ws 重复 close 会抛、浏览器已死再杀无意义
    closed = true;
    // ① 先关 CDP WebSocket：开放 ws 无限期吊住事件循环（bench 挂死主因——开放连接是活句柄，
    //    不 close 进程永不落出）。对端随后被树杀，TCP 断连让关闭握手即刻收敛。
    try { ws?.close(); } catch { /* already closed */ }
    // ② 树杀浏览器（win32 见 killTreeWin32；非 win32 child.kill() 兜底——SIGTERM 下 Chromium 自行收树）
    if (process.platform === "win32") killTreeWin32();
    else try { child.kill(); } catch { /* already gone */ }
    // ③ 一次性 profile 延迟删（等文件锁随进程死释放）：unref——进程活得久就照删，进程要退
    //    绝不拦这 1.5s（快速退出方如 bench 留给 OS 清 temp，与既有语义同域）
    const cleanupTimer = setTimeout(() => {
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* next time */ }
    }, 1500);
    cleanupTimer.unref?.();
  };
  try {
    await waitEndpoint(`http://127.0.0.1:${port}/json/version`, 10000);
    // attach on a fresh tab BEFORE navigating so no lifecycle event is missed
    const tabRes = await fetch(`http://127.0.0.1:${port}/json/new?url=about:blank`, {
      method: "PUT",
      signal: AbortSignal.timeout(5000),
    });
    if (!tabRes.ok) throw new Error(`/json/new returned HTTP ${tabRes.status}`);
    const tab = await tabRes.json();
    if (!tab.webSocketDebuggerUrl) throw new Error("target has no webSocketDebuggerUrl");
    ws = new WebSocket(tab.webSocketDebuggerUrl);
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

/** 导航 + 框架级就绪（#app 实际有子节点）——截图与 a11y 快照共用的单一来源（P2-2③ 抽取） */
async function navigateAndSettle(cdp, { url, settleMs, readyPollMs = 250 }) {
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
}

async function captureOnSession(cdp, { url, settleMs, compareBase64 = null, threshold = 0.12, readyPollMs = 250, fullPage = false }) {
  // fullPage（m11 批 C 快照门全页变体）：Page.getLayoutMetrics 取整页滚动尺寸 →
  // captureBeyondViewport + clip 拍下视口外内容。视口捕获路径零变化（默认变体逐字不破）。
  const shotParams = async () => {
    if (!fullPage) return { format: "png" };
    const m = await cdp.send("Page.getLayoutMetrics", {}, 8000);
    const size = m.cssContentSize ?? m.contentSize;
    return { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } };
  };
  await navigateAndSettle(cdp, { url, settleMs, readyPollMs });

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
      return await cdp.send("Page.captureScreenshot", await shotParams(), 15000);
    } catch {
      if (!(await mountOk())) throw new Error("app wiped before capture (vite reload race)");
      return await cdp.send("Page.captureScreenshot", await shotParams(), 15000);
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
export async function capturePage({ url, settleMs = 1200, compareBase64 = null, threshold = 0.12, fullPage = false }) {
  const session = await openTransientBrowser();
  try {
    return await captureOnSession(session.cdp, { url, settleMs, compareBase64, threshold, fullPage });
  } finally {
    session.close(); // ws close + browser kill + delayed profile cleanup
  }
}

/* ---------- P2-2③：a11y 快照（无障碍树文本化——agent 检视界面语义优先于像素） ---------- */

/** AX 树 → 缩进文本（role "name" value=…；ignored 节点跳过但其子树照走；封顶 400 行防刷屏） */
function formatA11yTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const referenced = new Set();
  for (const n of nodes) for (const c of n.childIds ?? []) referenced.add(c);
  const out = [];
  const walk = (id, depth) => {
    const n = byId.get(id);
    if (!n) return;
    if (!n.ignored) {
      const role = n.role?.value ?? "";
      const name = String(n.name?.value ?? "").trim();
      const val = n.value?.value;
      const parts = [role];
      if (name) parts.push(JSON.stringify(name.slice(0, 80)));
      if (val !== undefined && val !== null && String(val).length) parts.push(`value=${String(val).slice(0, 60)}`);
      if (parts.length > 1 || role) out.push(`${"  ".repeat(depth)}- ${parts.join(" ")}`);
    }
    for (const c of n.childIds ?? []) walk(c, depth + 1);
  };
  for (const n of nodes) if (!referenced.has(n.nodeId)) walk(n.nodeId, 0);
  return out.slice(0, 400).join("\n");
}

async function a11yOnSession(cdp, { url, readyPollMs = 250 }) {
  await navigateAndSettle(cdp, { url, settleMs: 150, readyPollMs });
  const r = await cdp.send("Accessibility.getFullAXTree", {}, 15000);
  const nodes = (r.nodes ?? []).filter((n) => !n.ignored);
  return { a11y: formatA11yTree(nodes), nodeCount: nodes.length };
}

/** P2-2③ 常驻实例 a11y 捕获：与截图共用同一只无头浏览器与崩溃自愈模式（探针→失败销毁重建 ×2）。 */
export async function captureA11yPersistent({ url, readyPollMs = 50 }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const session = await getPersistentSession();
    touchPersistentIdle(session); // P1-12 ③：每拍触摸空闲看门狗
    try {
      await session.cdp.send("Runtime.evaluate", { expression: "1", returnByValue: true }, 2000);
      return await a11yOnSession(session.cdp, { url, readyPollMs });
    } catch (e) {
      lastErr = e;
      await destroyPersistentSession();
    }
  }
  throw lastErr;
}

/* ---------- P0-6：常驻无头实例（崩溃自愈） ---------- */

let persistentSession = null; // { child, close, cdp, dead }
let persistentStarting = null;
let exitHookInstalled = false;

const persistentPort = () => (process.env.ATELIER_SHOT_PORT ? Number(process.env.ATELIER_SHOT_PORT) : undefined); // 缺省 = 每次随机（P1-12 ③）
// P1-12 ③：常驻实例空闲即杀（默认 10min；warm 复用收益保留在空闲窗内）。0 = 禁用（显式逃生口）。
// env 非数字值按缺省处理（NaN 落进 setTimeout 会即刻触发——绝不允许「配置错误变成立即杀」）。
const PERSISTENT_IDLE_MS = (() => {
  const n = Number(process.env.ATELIER_SHOT_IDLE_MS);
  return Number.isFinite(n) ? Math.max(0, n) : 600000;
})();
let persistentIdleTimer = null;

/** 空闲看门狗：每拍触摸归零；到点即杀常驻实例（CDP 无鉴权面——实例少活一分钟，窗口就窄一分钟） */
function touchPersistentIdle(session) {
  if (!PERSISTENT_IDLE_MS) return;
  clearTimeout(persistentIdleTimer);
  persistentIdleTimer = setTimeout(() => {
    if (persistentSession === session) void destroyPersistentSession();
  }, PERSISTENT_IDLE_MS);
  persistentIdleTimer.unref?.(); // 不拖住 dev 进程退出
}

function registerExitCleanup() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // 同步 best-effort：dev 进程退出不能留下孤儿无头浏览器（临时 profile 交给 OS 清）。
  // 走 close() 不走 child.kill()——后者只杀直属启动进程（win32 下它早已让位自退），
  // 真浏览器树会挂死 PID 之下漏杀（vite 热重启/被杀场景同受害）。
  process.on("exit", () => {
    if (persistentSession) { try { persistentSession.close(); } catch { /* already gone */ } }
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
    touchPersistentIdle(s);
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
  clearTimeout(persistentIdleTimer);
  persistentIdleTimer = null;
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
export async function capturePagePersistent({ url, settleMs = 120, compareBase64 = null, threshold = 0.12, readyPollMs = 50, fullPage = false }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const session = await getPersistentSession();
    touchPersistentIdle(session); // P1-12 ③：每拍触摸空闲看门狗
    try {
      // 复用前快速活性探针（2s 上限）：死会话上的正式命令要等满超时，探针先把最坏情况短路
      await session.cdp.send("Runtime.evaluate", { expression: "1", returnByValue: true }, 2000);
      return await captureOnSession(session.cdp, { url, settleMs, compareBase64, threshold, readyPollMs, fullPage });
    } catch (e) {
      lastErr = e;
      await destroyPersistentSession();
      // 不额外 sleep：重建 spawn 的开销本身就是退避
    }
  }
  throw lastErr;
}
