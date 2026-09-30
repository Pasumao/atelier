#!/usr/bin/env node
/**
 * server.mjs — Atelier built-in MCP Server (stdio transport, zero-dependency)
 *
 * Decision 7: "framework-embedded agent layer". This server exposes the
 * Atelier tool surface (query / operation / audit faces) to any MCP-capable
 * coding agent (Claude Code, Cursor, Codex, VS Code Copilot).
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (MCP spec).
 *   handled: initialize · notifications/initialized · ping · tools/list · tools/call
 *            · server/discover · tasks/get | tasks/update | tasks/cancel（FS-M6 §10.2：
 *              2026-07-28 无状态原语——多轮审批 InputRequiredResult + requestState、Tasks 扩展）
 *            (+ empty prompts/resources lists so hosts probe cleanly)
 *   HTTP 直连（无握手、头路由）见 mcp/http.mjs——与本文件共用 handleMessage/callTool 单源。
 *
 * Single-source discipline (scripts/check-skills.mjs enforced):
 *   tools/list is GENERATED from ../mcp/mcp-definitions.json — flat schema
 *   (reqProps/optProps) is translated to standard JSON Schema here.
 *
 * Tool execution: forwarded to the running dev surface (default
 * http://127.0.0.1:5173, override with ATELIER_DEV_URL) via ENDPOINT_MAP.
 * Tools with status != "implemented" answer with a structured, actionable
 * error (ATR style) instead of being hidden — agents see the full design.
 *
 * Security baseline (ARCHITECTURE §9): localhost only, no exec of raw model
 * strings; every mutation goes through the dev surface confirm tiers later.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import readline from "node:readline";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { inspectStructure } from "../scripts/struct.mjs";
import {
  readAgentConfig,
  approvalVerdict,
  approvalSecret,
  auditApproval,
  INPUT_REQUIRED_TAG,
} from "./confirm.mjs";
import { callEndpointTool, FS6_TOOLS } from "./endpoint-tools.mjs";
import { createTaskStore } from "./tasks.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFS = JSON.parse(fs.readFileSync(path.join(HERE, "mcp-definitions.json"), "utf8"));
const SERVER_INFO = { name: "atelier", version: DEFS.$meta?.version ?? "0.1.0" };
const PROTOCOL_LATEST = "2025-06-18";
/** FS-M6 §10.2：MCP 2026-07-28 无状态形态的协议版本位（HTTP 直连 _meta / server/discover 携带） */
const STATELESS_PROTOCOL_VERSION = "2026-07-28";
const BASE = (process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const PROJECT_ROOT_ENV = process.env.ATELIER_PROJECT_ROOT;
/** 直接执行判定（gen/impact.mjs 同款）：库形态 import（测试直调 callTool）不启动 stdio 循环 */
const INVOKED_DIRECTLY =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

/** dev-surface routes used by implemented tools (extend as endpoints land) */
const ENDPOINT_MAP = {
  "registry.list_components": "/__atelier/registry",
  "registry.get_component": "/__atelier/registry", // list; filtered by args.name below
  "tokens.list": "/__atelier/tokens",
  "state.snapshot": "/__atelier/state-snapshot",
  "ui.screenshot": "/__atelier/screenshot",
};

/* ---------- schema translation: flat (decision 6) → standard JSON Schema ---------- */
/** R3 收口（评审 §4.1）：flat 约束键 min/max → JSON Schema 标准键 minimum/maximum——原样
 * clone 时做入参校验的严格 MCP 宿主不识别 min/max（校验失效）。 */
function translateConstraintKeys(node) {
  if (Array.isArray(node)) return node.map(translateConstraintKeys);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = translateConstraintKeys(v);
  if (out.min !== undefined) {
    out[out.type === "string" ? "minLength" : "minimum"] = out.min;
    delete out.min;
  }
  if (out.max !== undefined) {
    out[out.type === "string" ? "maxLength" : "maximum"] = out.max;
    delete out.max;
  }
  return out;
}
function flatToJsonSchema(params) {
  if (!params || params.type !== "object") return { type: "object", properties: {}, required: [] };
  const req = params.reqProps ?? {};
  const opt = params.optProps ?? {};
  return {
    type: "object",
    properties: { ...translateConstraintKeys(structuredClone(req)), ...translateConstraintKeys(structuredClone(opt)) },
    required: Object.keys(req),
    additionalProperties: false,
  };
}

/** P2-2② toolsets 分组按需启用：ATELIER_TOOLSETS=query,operation（逗号分隔 face 名）只暴露
 * 子集——上下文窗口紧张或权限面收敛时用；缺省全部暴露。face 取值见 mcp-definitions.json。 */
const TOOLSETS = (process.env.ATELIER_TOOLSETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TOOLS = DEFS.tools
  .filter((t) => TOOLSETS.length === 0 || TOOLSETS.includes(t.face))
  .map((t) => ({
    name: t.name,
    description: `[${t.face}]${t.status === "pending" ? " (specified, wiring pending)" : ""} ${t.summary}`,
    inputSchema: flatToJsonSchema(t.params),
  }));

/** tools/list 载荷（stdio 与 HTTP 直连同源） */
export function listTools() {
  return TOOLS;
}

/** 广告名集（P2-M2 执行闸单源，2026-09-30 第三遍架构复校）：TOOLSETS 过滤后的 tools/list 广告
 * 面。callTool 入口据此拒绝未广告名——ATELIER_TOOLSETS 的「权限面收敛」语义由此成真（旧口径
 * 只滤 tools/list 广告不滤执行，客户端凭名直呼被隐藏工具照常执行）。 */
const ADVERTISED_NAMES = new Set(TOOLS.map((t) => t.name));

/** 执行上下文：stdio 通道从 env 取缺省；HTTP 直连（mcp/http.mjs）由 dev 面显式注入。
 * tasks = Tasks 扩展存储（进程内 + 显式句柄——无会话粘性，句柄随客户端回传）。 */
function defaultCtx() {
  return {
    projectRoot: process.env.ATELIER_PROJECT_ROOT ?? process.cwd(),
    devUrl: BASE,
    devToken: DEV_TOKEN,
    tasks: defaultTaskStore(),
  };
}
let _taskStore = null;
function defaultTaskStore() {
  _taskStore ??= createTaskStore();
  return _taskStore;
}

/** P2-2② 四段式错误 → MCP structured error：isError=true + structuredContent{code,message,fix}，
 * 文本保持原形（"\nfix: ..."）——不破坏既有解析方，宿主可二选一消费。 */
function toolError(codeText, fixText) {
  const e = new Error(`${codeText}\nfix: ${fixText}`);
  const m = /^(ATR-[\w-]+):\s*([\s\S]*)$/.exec(codeText);
  e.atr = { code: m ? m[1] : "ATR-ERR", message: m ? m[2] : codeText, fix: fixText };
  return e;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const DEV_TOKEN = (() => {
  for (const p of [path.join(PROJECT_ROOT_ENV ?? process.cwd(), ".atelier", "dev-token")]) {
    try { return fs.readFileSync(p, "utf8").trim(); } catch { /* next */ }
  }
  return "";
})();
async function devJson(pathWithQuery, init = {}, ctx = defaultCtx()) {
  const headers = { ...(init.headers ?? {}), "x-atelier-token": ctx.devToken };
  const r = await fetch(`${ctx.devUrl}${pathWithQuery}`, { signal: AbortSignal.timeout(45000), ...init, headers }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${ctx.devUrl} (${e.cause?.code ?? e.name})`,
      `start the dev server ('atelier dev' inside your Atelier app dir) or set ATELIER_DEV_URL`,
    );
  });
  if (!r.ok && r.status === 401) {
    // P2-M1（2026-09-30 第三遍架构复校）：认证失败 = ATR-405（R3 402→405 拆分的漏改补钉）——
    // ATR-402 归 confirm 档拒绝，同码双语义让消费方无法区分「token 错」与「审批被拒」。
    // 文案对齐 endpoint-tools.mjs fetchServerStatus 的 ATR-405 位。
    throw toolError("ATR-405: dev token rejected", "读取应用根 .atelier/dev-token 作为 x-atelier-token（dev 面 token 门内资源）");
  }
  return r.json();
}

/** P0-1 downlink: enqueue a command for the open page over SSE, then poll its ack. */
async function bridgeCall(op, args = {}, ctx = defaultCtx()) {
  const enq = await devJson("/__atelier/bridge/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, args }),
  }, ctx);
  const clients = enq.clients ?? 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    await sleepMs(250);
    const st = await devJson(`/__atelier/bridge/cmd-status?id=${encodeURIComponent(enq.id)}`, {}, ctx);
    if (st.status === "done") {
      if (st.ok) return st.result;
      throw toolError("ATR-4xx-dev: downlink op failed on the page", st.error ?? "see the page console");
    }
  }
  throw toolError(
    `ATR-4xx-dev: no open page answered "${op}" within 10s${clients ? "" : ` (SSE subscribers: ${clients})`}`,
    "keep the app open in a dev preview — transient screenshot/headless instances are closed by design",
  );
}

/* ---------- P1-11：长操作异步 spawn。spawnSync 在 /__atelier/mcp 直连形态下跑在 Vite 进程内，
 * checkpoint/test.run 一触发即冻结页面服务/HMR/SSE 到子进程结束，且 Tasks 的 abort 信号对其无效。
 * 这里改为 spawn + stdio 流式收集（promise 包装），超时/abort 一律树杀——win32 参照仓库既有
 * taskkill /T /F 写法（scripts/bench.mjs:135 / scripts/snapshot-smoke.mjs:48），POSIX 用独立
 * 进程组负 pid 组杀；结果形状与 spawnSync 同构（{ status, stdout, stderr, error }，超时
 * ETIMEDOUT / 取消 ABORT_ERR 同款错误码），调用面最小改动。 */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return; // 已退出
  try {
    if (process.platform === "win32") {
      // 树杀必须同步落地：fire-and-forget 的异步 taskkill 在宿主紧随 cancel 退出时会被
      // process.exit 连线程池里未分发的 CreateProcess 一起丢弃——实测整树漏杀（红检④）。
      // 同步开销有界（taskkill /F 树走查典型 50~300ms，10s 自保超时），仅发生在
      // cancel/timeout 路径，且完成后才 settle——resolution 即树已死。
      if (child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } // detached → 独立进程组，组杀含孙进程
      catch { child.kill("SIGTERM"); }
    }
  } catch { /* best-effort：kill 失败不改变 promise 的 settle 语义 */ }
}

export function spawnCaptured(cmd, args, { cwd, timeoutMs, shell = false, signal, env } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer = null;
    const child = spawn(cmd, args, {
      cwd,
      shell,
      env,
      windowsHide: true,
      detached: process.platform !== "win32", // POSIX 树杀依赖独立进程组
    });
    const finish = (patch) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ status: null, stdout, stderr, error: null, ...patch });
    };
    const onAbort = () => {
      killTree(child);
      finish({ error: Object.assign(new Error("operation was aborted"), { code: "ABORT_ERR" }), aborted: true });
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs) {
      timer = setTimeout(() => {
        killTree(child);
        finish({ error: Object.assign(new Error("operation timed out"), { code: "ETIMEDOUT" }), timedOut: true });
      }, timeoutMs);
      timer.unref?.(); // 子进程被外部收尸时不让 timer 单独挂住宿主事件循环
    }
    child.stdout?.on("data", (c) => { stdout += c; });
    child.stderr?.on("data", (c) => { stderr += c; });
    child.on("error", (e) => finish({ error: e })); // spawn 失败（ENOENT 等；close 可能不触发）
    child.on("close", (code) => finish({ status: code }));
  });
}

/** run scripts/checkpoint.mjs in the app root; its --json payload is stdout (pretty for list, single-line for save/rollback)
 *  P1-11：异步 spawn（门禁内建跑全量测试套件，CHECKPOINT_TIMEOUT_MS 兜底超时防无限悬挂）；signal 供 Tasks cancel 树杀。
 *  R3 收口：超时字面值提为 CHECKPOINT_TIMEOUT_MS 单源（TOOL_META checkpoint.source_* 三件与
 *  diff.report 的 list 前置同源引用——字面值不变，只收敛声明位）。 */
const CHECKPOINT_TIMEOUT_MS = 601_000;
async function checkpointCli(args, cwd, signal = null, timeoutMs = CHECKPOINT_TIMEOUT_MS) {
  const script = path.join(HERE, "..", "scripts", "checkpoint.mjs");
  const r = await spawnCaptured(process.execPath, [script, ...args], { cwd, timeoutMs, signal });
  if (r.error) {
    if (r.error.code === "ETIMEDOUT") {
      throw toolError("ATR-4xx-checkpoint: checkpoint run timed out after 601s", "run checkpoint via CLI ('atelier checkpoint <verb>') to inspect — the gate suite may be hung");
    }
    if (r.error.code === "ABORT_ERR") {
      throw toolError("ATR-4xx-checkpoint: checkpoint run cancelled", "re-issue the checkpoint tool when ready");
    }
    throw toolError(`ATR-4xx-checkpoint: checkpoint run terminated (${r.error.code ?? "killed"})`, "run checkpoint via CLI ('atelier checkpoint <verb>') to inspect");
  }
  const errLines = (r.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (r.status !== 0) {
    const msg = (errLines.find((l) => l.startsWith("error: ")) ?? errLines.at(-1) ?? `checkpoint exited ${r.status}`).replace(/^error: /, "");
    const fix = errLines.find((l) => l.startsWith("fix: "))?.slice(5);
    throw toolError(`ATR-4xx-checkpoint: ${msg}`, fix ?? "run checkpoint.source_list for the timeline");
  }
  const out = (r.stdout ?? "").trim();
  try { return JSON.parse(out); } catch { /* fall through: last line may still be the payload */ }
  const last = out.split("\n").at(-1) ?? "";
  try { return JSON.parse(last); } catch { return { ok: true, raw: last }; }
}

/* ---- R3 收口（评审 §2.2 风险 2 / §6 批次 R3）：callTool 分发 Map + per-tool 元数据 ----
 * 原形：callTool 约 430 行七段 if-chain——bridge / local spawn / state+docs+test / snapshot /
 * FS6 / tasks / dev-face 通用路径全部名字平铺。现在：TOOL_HANDLERS = Map<工具名, handler>，
 * 键集 = tools/list 广告实现面（一件不缺、一件不幻影——tests/r3-mcp-dispatch.test.ts 机检）；
 * confirm 三档闸与 _approval 剥离留在 Map 之前的公共闸位（对全部工具一致——闸序零变化）；
 * 未命中 Map 的名字落既有兜底链（未知 404 / pending 诚实报错 / no-route 报错 → dev-face 通用
 * 路径）。TOOL_META = per-tool 元数据：timeoutMs（该工具**自有**下游 spawn/fetch 的兜底超时——
 * handler 从表取值，字面值与收口前逐字节一致）+ args（参数白名单位：handler 逐名消费的入参键，
 * 透传页面桥的桥接工具额外标 passthrough——消费面 ⊆ 广告面，机检钉死 §4.1「广告参数静默丢弃」
 * 的反向漂移）。FS6 工具族消费面元数据在 endpoint-tools.mjs 单源（不入本表——两处手抄即漂移温床）。 ---- */
const TOOL_META = {
  "checkpoint.list": { args: [] },
  "checkpoint.rollback": { args: ["id"], passthrough: true }, // args 整体透传页面桥（桥侧按名取用）
  "state.time_travel": { args: ["id"], passthrough: true },
  "state.graph": { args: [] },
  "state.journal": { args: ["lines"] },
  "ui.a11y": { args: [] },
  "audit.log": { args: ["lines"] },
  "structure.map": { args: ["root"] },
  "structure.check": { args: ["root"] },
  "checkpoint.source_list": { args: [], timeoutMs: CHECKPOINT_TIMEOUT_MS },
  "checkpoint.source_commit": { args: ["message"], timeoutMs: CHECKPOINT_TIMEOUT_MS },
  "checkpoint.source_rollback": { args: ["id"], timeoutMs: CHECKPOINT_TIMEOUT_MS },
  "graph.static": { args: ["root"], timeoutMs: 60_000 },
  "state.get": { args: ["path"] },
  "docs.search": { args: ["q"] },
  "test.run": { args: ["filter"], timeoutMs: 180_000 },
  "diff.report": { args: [], timeoutMs: 30_000 },
  "feedback.read": { args: [] },
  "snapshot.diff": { args: [], timeoutMs: 60_000 },
  "snapshot.review_diff": { args: [], timeoutMs: 60_000 },
  "tasks.get": { args: ["taskId"] },
  "tasks.update": { args: ["taskId", "ttlMs"] },
  "tasks.cancel": { args: ["taskId"] },
  // dev-face 通用路径五件（路由单源 = ENDPOINT_MAP；fetch 兜底超时原通用路径内联 4s）。
  // P2-M5：ui.screenshot 与 snapshot.diff 同端点（/__atelier/screenshot）同档 60s——旧 4s 与
  // dev-screenshot 冷路径（看门狗杀常驻浏览器后首拍需拉起浏览器+就绪轮询）必超时自相矛盾；
  // 其余四件是轻量 JSON 读，4s 档不变。
  "registry.list_components": { args: [], timeoutMs: 4_000 },
  "registry.get_component": { args: ["name"], timeoutMs: 4_000 },
  "tokens.list": { args: [], timeoutMs: 4_000 },
  "state.snapshot": { args: [], timeoutMs: 4_000 },
  "ui.screenshot": { args: [], timeoutMs: 60_000 },
};

/* ---- R3 收口（评审 §4.1 末件）：snapshot.diff 基线路径平台感知 ----
 * dev 面/CLI 已平台感知（scripts/snapshot.mjs m10 批 C 单源：.atr/snapshots/<platform>/
 * baseline.png，旧平铺 baseline.png 只读回落）——MCP 侧此前写死平铺，per-platform 布局下失明，
 * 口径三处分裂。本函数对表 scripts/snapshot.mjs 的 platformKey/snapshotsDir/baselinePathFor/
 * currentPathFor/legacyBaselinePath 内联同构；vendor 闭包红线（mcp-vendor.test.ts 机械核对：
 * 相对 import 闭包 = vendor 名单精确相等）禁止新增本地 import，故 MUST stay in sync with
 * scripts/snapshot.mjs——漂移由 tests/r3-mcp-dispatch.test.ts 布局形状用例 +
 * tests/snapshot-paths.test.ts（CLI 侧既有单源）两侧钉住。 */
export function snapshotLayout(root, platform = process.platform) {
  const dir = path.join(root, ".atr", "snapshots", platform);
  return {
    dir,
    baseline: path.join(dir, "baseline.png"),
    current: path.join(dir, "current.png"),
    legacyBaseline: path.join(root, ".atr", "snapshots", "baseline.png"), // 旧平铺（pre-m10）：只读回落位，绝不自动迁移
  };
}

/** snapshot.diff / snapshot.review_diff 共享 handler（R3 收口：基线解析与 CLI resolveBaseline
 * 同阶梯——平台基线胜出 → 仅旧平铺在 = 只读回落并标 paths.legacy → 都缺 = 引导 note；
 * verdict 阶梯同 scripts/snapshot.mjs（P1-8：MATCH/PIXMATCH/MISMATCH）不变）。 */
async function snapshotDiffHandler(name, args, ctx) {
  const shot = await fetch(`${ctx.devUrl}/__atelier/screenshot?compare=1`, {
    signal: AbortSignal.timeout(TOOL_META["snapshot.diff"].timeoutMs),
    headers: { "x-atelier-token": ctx.devToken },
  }).catch((e) => {
    throw toolError(`ATR-4xx-dev: dev surface unreachable at ${ctx.devUrl} (${e.cause?.code ?? e.name})`, "start the dev server ('atelier dev' inside your Atelier app dir) first");
  });
  const j = await shot.json();
  if (!j.ok) throw toolError("ATR-4xx-dev: capture failed", j.error ?? "inspect dev server logs");
  const layout = snapshotLayout(ctx.projectRoot);
  fs.mkdirSync(layout.dir, { recursive: true });
  fs.writeFileSync(layout.current, Buffer.from(j.imageBase64, "base64"));
  const platBase = fs.existsSync(layout.baseline);
  const legacyBase = !platBase && fs.existsSync(layout.legacyBaseline); // 旧平铺只读回落（不迁移不晋升）
  const out = {
    paths: {
      current: layout.current,
      baseline: platBase || legacyBase ? (platBase ? layout.baseline : layout.legacyBaseline) : null,
      ...(legacyBase ? { legacy: true } : {}),
    },
  };
  if (!platBase && !legacyBase) {
    out.match = null;
    out.note = "no baseline yet — review current; promote intentionally via 'atelier snapshot check --update' or save a first baseline";
  } else {
    const h = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    const byteSame = h(layout.current) === h(out.paths.baseline);
    const threshold = Number(j.threshold ?? 0.12);
    const ratio = j.pixelDiff ? j.pixelDiff.mismatchRatio : null;
    // same verdict ladder as scripts/snapshot.mjs (P1-8): MATCH / PIXMATCH / MISMATCH
    out.byteMatch = byteSame;
    out.pixelDiff = j.pixelDiff ?? null;
    out.threshold = threshold;
    out.verdict = byteSame ? "MATCH" : ratio !== null && !j.pixelDiff.dimsDiffer && ratio <= threshold ? "PIXMATCH" : "MISMATCH";
    out.note = out.verdict === "MATCH"
      ? "pixel-stable against baseline"
      : out.verdict === "PIXMATCH"
        ? `bytes differ but mismatchRatio ${ratio.toExponential(2)} ≤ ${threshold} (fonts/AA jitter is not a regression)`
        : `differs from baseline${ratio !== null ? ` (mismatchRatio ${ratio.toExponential(2)} > ${threshold})` : ""} — review both images side by side; promotion is a CLI/human act`;
  }
  if (name === "snapshot.review_diff") out.imageBase64 = j.imageBase64;
  return out;
}

/** FS-M6③ Tasks 扩展同名点工具（SEP-2133）共享 handler：stdio/HTTP 共用同一存储视图；
 * 创建是服务端主导（长操作获准执行时），故无 tasks.create——这里只读写已有句柄。 */
function tasksToolHandler(name, args, ctx) {
  const store = ctx.tasks ?? defaultTaskStore();
  const id = String(args?.taskId ?? "");
  if (!id) {
    throw toolError(
      `ATR-401: ${name} requires args.taskId`,
      "task 句柄由服务端在长操作获准执行时创建并随 tools/call 结果返回（stateless HTTP 通道主导）",
    );
  }
  let t = null;
  try {
    t = name === "tasks.get" ? store.get(id) : name === "tasks.cancel" ? store.cancel(id) : store.update(id, args ?? {});
  } catch (e) {
    if (e?.atr) throw toolError(e.message, e.atr.fix ?? "见 tasks 扩展文档");
    throw e;
  }
  if (!t) {
    throw toolError(
      `ATR-401: task "${id}" 未找到（或保留窗已过）`,
      "任务句柄只在创建它的实例上可解析（dev 面 = 单实例）；重新发起长操作获取新句柄",
    );
  }
  return t;
}

/** dev-face 通用路径单源（原 callTool 尾段提取）：ENDPOINT_MAP 路由 + per-tool 兜底超时
 * （TOOL_META）+ 401/非 ok 映射 + registry.get_component 名字过滤投影。五件 dev-face 工具
 * 的 Map 条目与「已实现已广告但无 handler」兜底共用本函数。 */
async function callDevFaceTool(name, args, ctx) {
  const route = ENDPOINT_MAP[name];
  // fetch the route; never interpolate raw values into paths except whitelisted query params below
  const res = await fetch(ctx.devUrl + route, {
    signal: AbortSignal.timeout(TOOL_META[name]?.timeoutMs ?? 4000),
    headers: { "x-atelier-token": ctx.devToken },
  }).catch((e) => {
    // P2-M5（2026-09-30 第三遍架构复校）：fetch 超时单列——AbortSignal.timeout 的拒绝形态是
    // DOMException name "TimeoutError"，与「连接拒绝」（cause.code = ECONNREFUSED 等）是两种
    // 故障两种指路：超时 = dev 面在但响应慢（截图冷路径首拍要拉起浏览器），指路重试；
    // 不可达 = 没启动，指路 pnpm dev。旧文案把超时也说成 unreachable，排查方向指错。
    if (e?.name === "TimeoutError" || e?.code === "ETIMEDOUT") {
      const budgetSec = Math.round((TOOL_META[name]?.timeoutMs ?? 4000) / 1000);
      throw toolError(
        `ATR-4xx-dev: dev surface timed out at ${ctx.devUrl}${route} (over ${budgetSec}s)`,
        "dev surface is up but answered slowly — cold-path captures spawn a browser on the first shot; retry once, then inspect dev server logs",
      );
    }
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${ctx.devUrl} (${e.cause?.code ?? e.name})`,
      "start the dev server ('atelier dev' inside your Atelier app dir) or set ATELIER_DEV_URL",
    );
  });
  if (res.status === 401) {
    // P2-M1：与 devJson 401 映射同批补钉——认证失败恒 ATR-405（非 confirm 拒绝的 ATR-402）。
    throw toolError("ATR-405: dev token rejected", "读取应用根 .atelier/dev-token 作为 x-atelier-token（dev 面 token 门内资源）");
  }
  if (!res.ok) {
    throw toolError(`ATR-4xx-dev: dev surface returned HTTP ${res.status} for ${route}`, "check dev server logs");
  }
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { data = body; }

  if (name === "registry.get_component") {
    const wanted = args?.name;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.components)
        ? data.components
        : [];
    const hit = list.find((c) => c?.name === wanted || c?.id === wanted);
    if (!hit) {
      throw toolError(
        `ATR-401: component "${wanted ?? "(none)"}" not registered`,
        `registered names: ${list.map((c) => c?.name ?? c?.id).join(", ") || "(empty)"} — import the component file and pass opts.name explicitly`
      );
    }
    return hit;
  }
  return data;
}

/* ---- 分发 Map（键集 = tools/list 广告实现面，40 件）：各 handler 语句 = 原 if 段逐字搬运 ---- */
const TOOL_HANDLERS = new Map([
  /* ---- downlink-executed tools (runtime lives in the open page; P0-1 SSE channel) ---- */
  ["checkpoint.list", (args, ctx) => bridgeCall("checkpoint.list", {}, ctx)],
  ["checkpoint.rollback", (args, ctx) => bridgeCall("checkpoint.rollback", args ?? {}, ctx)],
  ["state.time_travel", (args, ctx) => bridgeCall("state.time_travel", args ?? {}, ctx)],
  ["state.graph", (_args, ctx) => bridgeCall("state.graph", {}, ctx)], // P2-1：依赖图（F-1 收尾）
  ["state.journal", (args, ctx) => bridgeCall("state.journal", { lines: Math.max(1, Math.min(500, Number(args?.lines ?? 100))) }, ctx)],
  ["ui.a11y", (_args, ctx) => devJson("/__atelier/a11y", {}, ctx)], // P2-2③：无障碍树文本化
  ["audit.log", (args, ctx) => devJson(`/__atelier/audit?lines=${Math.max(1, Math.min(500, Number(args?.lines ?? 50)))}`, {}, ctx).then((j) => j.rows)],

  /* ---- locally computed tools (no dev-surface round trip) ---- */
  ["structure.map", (args, ctx) => inspectStructure(args?.root ?? ctx.projectRoot)],
  ["structure.check", (args, ctx) => {
    const res = inspectStructure(args?.root ?? ctx.projectRoot);
    return { verdict: res.summary.errors > 0 ? "FAILED" : "PASSED", ...res };
  }],
  /* decision-15 source checkpoints: thin spawn over scripts/checkpoint.mjs — same code path as the
   * CLI, so the P2-2 未检不锚 snapshot gate applies identically to MCP-originated anchors. No
   * --no-gate over the wire: the escape hatch stays a human CLI act. */
  ["checkpoint.source_list", (args, ctx, opts) => checkpointCli(["list", "--json"], ctx.projectRoot, opts?.signal ?? null)],
  ["checkpoint.source_commit", (args, ctx, opts) => checkpointCli(["save", String(args?.message ?? `AI turn ${new Date().toISOString()}`), "--json"], ctx.projectRoot, opts?.signal ?? null)],
  ["checkpoint.source_rollback", (args, ctx, opts) => {
    if (!args?.id) throw toolError("ATR-401: checkpoint.source_rollback requires args.id", "pick one from checkpoint.source_list output");
    return checkpointCli(["rollback", String(args.id), "--json"], ctx.projectRoot, opts?.signal ?? null);
  }],

  /* ---- F-2 二期：构建期静态依赖图查询（read-only，不跑应用、不需要 dev face）----
   * thin spawn over compiler/codegen.mjs --graph-only（单源 = 同一收集器），读 stage ② dump
   * 出组件级 deps 清单；无 dump 时结构化报错指路 compile。 */
  ["graph.static", async (args, ctx, opts) => {
    const root = path.resolve(String(args?.root ?? ctx.projectRoot));
    const astDir = path.join(root, ".atr", "ast");
    if (!fs.existsSync(path.join(astDir, "index.json"))) {
      throw toolError(
        `ATR-401: no stage-② dump at ${astDir}`,
        "run 'node <repo>/atelier/cli.mjs compile --root <appDir>' first, then retry graph.static",
      );
    }
    const codegen = path.join(HERE, "..", "compiler", "codegen.mjs");
    const r = await spawnCaptured(process.execPath, [codegen, "--ast", astDir, "--graph-only", "--quiet"], { timeoutMs: TOOL_META["graph.static"].timeoutMs, signal: opts?.signal ?? null });
    if (r.error) {
      if (r.error.code === "ETIMEDOUT") {
        throw toolError("ATR-500: static graph build failed (ETIMEDOUT after 60s)", "inspect .atr/ast dump integrity — codegen --graph-only did not finish within 60s");
      }
      if (r.error.code === "ABORT_ERR") {
        throw toolError("ATR-500: static graph build cancelled", "re-issue graph.static when ready");
      }
    }
    if (r.status !== 0) {
      throw toolError("ATR-500: static graph build failed", (r.stderr ?? "").trim().split("\n").slice(-3).join(" | ") || "inspect .atr/ast dump integrity");
    }
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw toolError("ATR-500: graph payload unparseable", "rerun graph.static; if it persists, check codegen.mjs --graph-only output");
    }
  }],

  /* ---- P0 backlog 批次转绿（2026-08-29）：state.get / test.run / diff.report / feedback.read / docs.search ---- */
  ["state.get", async (args, ctx) => {
    const p = String(args?.path ?? "").trim();
    if (!p) {
      throw toolError(
        "ATR-401: state.get requires args.path",
        'syntax "sig-<n>" or "sig-<n>.<sub.path>" (e.g. "sig-0" / "sig-0.items.2.label") — wire shape via state.snapshot',
      );
    }
    const snap = await devJson("/__atelier/state-snapshot", {}, ctx);
    if (!snap || snap.ok === false) {
      throw toolError("ATR-4xx-dev: no bridge state available yet", snap?.note ?? "open the app once in dev preview so the page pushes its signal graph");
    }
    const parts = p.split(".").filter(Boolean);
    const head = parts[0] ?? "";
    const idx = head.startsWith("sig-") ? Number(head.slice(4)) : /^\d+$/.test(head) ? Number(head) : NaN;
    if (Number.isNaN(idx)) {
      throw toolError(
        `ATR-401: state.get path must start at a signal key ("sig-<n>"), got "${head}"`,
        `the live graph exposes sig-0 … sig-${Math.max(0, (snap.signalCount ?? 1) - 1)} — full shape via state.snapshot`,
      );
    }
    const sig = (snap.signals ?? [])[idx];
    if (!sig) {
      throw toolError(
        `ATR-401: no signal "${head}" in the live graph`,
        `snapshot has ${snap.signalCount ?? 0} signals; known boundary: signals mounted after bridge install are invisible until reload`,
      );
    }
    let value = sig.value;
    for (const seg of parts.slice(1)) {
      if (value === null || typeof value !== "object" || !(seg in value)) {
        throw toolError(`ATR-401: path "${p}" breaks at segment "${seg}"`, `value at this depth: ${JSON.stringify(value)?.slice(0, 240) ?? String(value)}`);
      }
      value = value[seg];
    }
    return { path: p, signalKey: sig.key, value, snapshotAt: snap.at, href: snap.href };
  }],

  ["docs.search", (args, ctx) => {
    const PROJECT_ROOT = ctx.projectRoot;
    const q = String(args?.q ?? "").trim().toLowerCase();
    if (!q) throw toolError("ATR-401: docs.search requires args.q", 'e.g. "HMR state preserve" or "ATR-204"');
    const terms = q.split(/\s+/).filter(Boolean);
    const files = [];
    const walk = (dir, depth = 0) => {
      if (depth > 4) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p2 = path.join(dir, e.name);
        if (e.isDirectory()) walk(p2, depth + 1);
        else if (/\.(md|txt)$/i.test(e.name)) files.push(p2);
      }
    };
    // 语料（ARCHITECTURE §工具表）：框架规格文档单源 + skill 包 + 工作区 AGENTS.md + 应用 llms.txt
    walk(path.join(HERE, "..", "docs"));
    walk(path.join(HERE, "..", "skills"));
    try { if (fs.statSync(path.join(HERE, "..", "..", "AGENTS.md")).isFile()) files.push(path.join(HERE, "..", "..", "AGENTS.md")); } catch { /* absent */ }
    try { if (fs.statSync(path.join(PROJECT_ROOT, "llms.txt")).isFile()) files.push(path.join(PROJECT_ROOT, "llms.txt")); } catch { /* absent */ }
    const scored = [];
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      const lower = text.toLowerCase();
      let score = 0;
      const hits = [];
      for (const t of terms) {
        const n = t ? lower.split(t).length - 1 : 0;
        if (n > 0) { score += n; hits.push({ term: t, count: n }); }
      }
      if (!score) continue;
      const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(f)).trim();
      if (title.toLowerCase().includes(terms[0]) || lower.split("\n")[0]?.includes(terms[0])) score += 10;
      const lines = text.split("\n");
      const li = lines.findIndex((l) => l.toLowerCase().includes(terms[0]));
      const excerpt = li >= 0 ? lines.slice(Math.max(0, li - 1), li + 3).join(" ⏎ ").slice(0, 300) : title;
      scored.push({ file: f, title, score, hits, excerpt });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    return {
      query: q,
      scanned: files.length,
      results: top,
      note: top.length ? undefined : `no hit for ${JSON.stringify(q)} in framework docs / skill packages / AGENTS.md / llms.txt`,
    };
  }],

  ["test.run", async (args, ctx, opts) => {
    const filter = args?.filter ? String(args.filter).trim() : "";
    if (/["'`|;&<>]/.test(filter)) {
      throw toolError("ATR-401: test.run filter must be a plain file-name pattern", `got ${JSON.stringify(filter)} — no shell metacharacters; e.g. "contract" or "src/greeting"`);
    }
    // 与应用 package.json "test" 同一表面（vitest run）；filter 作 vitest 位置参数（文件名过滤）。
    // P1-11：异步 spawn + 兜底超时（TOOL_META 单源 180s）；signal 使 tasks.cancel 真正树杀 pnpm 子进程树。
    const r = await spawnCaptured("pnpm", filter ? ["test", filter] : ["test"], {
      cwd: ctx.projectRoot, timeoutMs: TOOL_META["test.run"].timeoutMs, signal: opts?.signal ?? null,
      shell: process.platform === "win32", // pnpm 在 Windows 是 .cmd
    });
    if (r.error) {
      if (r.error.code === "ETIMEDOUT") {
        throw toolError("ATR-4xx-test: test run terminated (ETIMEDOUT after 180s)", "run the suite locally ('pnpm test') to inspect the hanging test");
      }
      if (r.error.code === "ABORT_ERR") {
        throw toolError("ATR-4xx-test: test run cancelled", "re-issue test.run when ready");
      }
      if (r.error.code === "ENOENT") throw toolError("ATR-4xx-test: pnpm not found on PATH", "install pnpm, or run the suite via CLI ('atelier test')");
      throw toolError(`ATR-4xx-test: test run terminated (${r.error.code ?? "killed"})`, "run the suite locally ('pnpm test') to inspect the hanging test");
    }
    const lines = (r.stdout ?? "").split("\n").map((l) => l.trimEnd());
    return {
      ok: r.status === 0,
      exitCode: r.status,
      filter: filter || null,
      summary: {
        testFiles: lines.find((l) => /Test Files\s+\S/.test(l))?.trim() ?? null,
        tests: lines.find((l) => /Tests\s+\S/.test(l))?.trim() ?? null,
      },
      outputTail: lines.filter(Boolean).slice(-60),
    };
  }],

  ["diff.report", async (args, ctx, opts) => {
    // 基线 = 最近一条 source checkpoint 锚点；本工具提供机器可核的文件级事实
    //（per-change 语义摘要由发起评审的 agent 附在报告后），落盘 .atelier/diff-report.md 供人审。
    const PROJECT_ROOT = ctx.projectRoot;
    const signal = opts?.signal ?? null;
    const cps = await checkpointCli(["list", "--json"], PROJECT_ROOT, signal);
    // checkpoints.jsonl 的锚字段是 sha（旧条目兼容 commit）；回滚条目无 sha，自然被过滤
    const base = [...(Array.isArray(cps) ? cps : [])].reverse().find((c) => c?.sha || c?.commit) ?? null;
    if (!base?.sha && !base?.commit) {
      throw toolError("ATR-4xx-checkpoint: no source checkpoint to diff against", "create one first: checkpoint.source_commit (or CLI 'atelier checkpoint save')");
    }
    const baseCommit = base.sha ?? base.commit;
    const baseId = base.id ?? "?";
    const baseName = base.name ?? "";
    const git = async (gitArgs) => {
      // P1-11：git 补兜底超时（TOOL_META 单源 30s——修前无超时：网络盘/钩子卡死即永久冻结宿主）；signal 同参透传
      const g = await spawnCaptured("git", gitArgs, { cwd: PROJECT_ROOT, timeoutMs: TOOL_META["diff.report"].timeoutMs, signal });
      if (g.status !== 0) {
        throw toolError(`ATR-4xx-git: git ${gitArgs[0]} failed`, (g.stderr ?? "").trim() || "run inside a git-managed app workspace");
      }
      return g.stdout ?? "";
    };
    const stat = (await git(["diff", "--stat", baseCommit])).trim();
    const numstat = (await git(["diff", "--numstat", baseCommit])).trim();
    const status = (await git(["status", "--short"])).trim();
    const short = String(baseCommit).slice(0, 7);
    const report = [
      "# Atelier diff report",
      "",
      `- Generated: ${new Date().toISOString()}`,
      `- Baseline: checkpoint ${baseId} "${baseName}" (${short})`,
      "- Scope: working tree vs baseline（文件级事实；语义摘要由发起评审的 agent 补充）",
      "",
      "## Diff stat",
      "",
      "```",
      stat || "(no tracked changes)",
      "```",
      "",
      "## Working tree status",
      "",
      "```",
      status || "(clean)",
      "```",
      "",
      "## Per-file adds/deletes",
      "",
      numstat || "(none)",
      "",
    ].join("\n");
    const reportPath = path.join(PROJECT_ROOT, ".atelier", "diff-report.md");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, report, "utf8");
    return { reportPath, baseline: { id: baseId, commit: baseCommit, name: baseName }, report };
  }],

  ["feedback.read", (args, ctx) => {
    const specsDir = path.join(ctx.projectRoot, "specs");
    const rows = [];
    try {
      const jl = fs.readFileSync(path.join(specsDir, "feedback.jsonl"), "utf8");
      for (const line of jl.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try { rows.push({ kind: "jsonl", ...JSON.parse(t) }); } catch { rows.push({ kind: "jsonl", raw: t, note: "unparsable line" }); }
      }
    } catch { /* no feedback.jsonl yet */ }
    try {
      for (const f of fs.readdirSync(specsDir)) {
        if (f.endsWith(".feedback.md")) {
          rows.push({ kind: "markdown", file: path.join(specsDir, f), content: fs.readFileSync(path.join(specsDir, f), "utf8") });
        }
      }
    } catch { /* no specs/ dir yet */ }
    return {
      rows,
      note: rows.length
        ? undefined
        : 'no human feedback recorded yet. Convention: append one JSON line per verdict to specs/feedback.jsonl ({at, verdict: "approve"|"disapprove", target, note}) or drop a free-form specs/<name>.feedback.md — the review UI (P2-5) writes the same format',
    };
  }],

  /* ---- snapshot 对比（R3 收口：基线路径平台感知——见 snapshotLayout/snapshotDiffHandler） ---- */
  ["snapshot.diff", (args, ctx) => snapshotDiffHandler("snapshot.diff", args, ctx)],
  ["snapshot.review_diff", (args, ctx) => snapshotDiffHandler("snapshot.review_diff", args, ctx)],

  /* ---- FS-M6③ Tasks 扩展同名点工具（SEP-2133）——共享 handler 见 tasksToolHandler ---- */
  ["tasks.get", (args, ctx) => tasksToolHandler("tasks.get", args, ctx)],
  ["tasks.update", (args, ctx) => tasksToolHandler("tasks.update", args, ctx)],
  ["tasks.cancel", (args, ctx) => tasksToolHandler("tasks.cancel", args, ctx)],

  /* ---- dev-face 通用路径五件（ENDPOINT_MAP 路由单源，共享 handler 见 callDevFaceTool） ---- */
  ["registry.list_components", (args, ctx) => callDevFaceTool("registry.list_components", args, ctx)],
  ["registry.get_component", (args, ctx) => callDevFaceTool("registry.get_component", args, ctx)],
  ["tokens.list", (args, ctx) => callDevFaceTool("tokens.list", args, ctx)],
  ["state.snapshot", (args, ctx) => callDevFaceTool("state.snapshot", args, ctx)],
  ["ui.screenshot", (args, ctx) => callDevFaceTool("ui.screenshot", args, ctx)],
]);

/* ---- FS-6（§10.1）：L3 全栈工具族 —— live 组消费 dev 面 server-status（§10.3），
 *      endpoint.impact 走 gen/impact.mjs 静态两跳链（不依赖 dev 面）；
 *      endpoint.call 的 confirm 三档已在闸口收口。实现见 mcp/endpoint-tools.mjs ----
 *      R3 收口：整族入分发 Map（消费面元数据单源在 endpoint-tools.mjs，不入 TOOL_META）。 */
for (const fs6Name of FS6_TOOLS) {
  TOOL_HANDLERS.set(fs6Name, (args, ctx) => callEndpointTool(fs6Name, args, { devUrl: ctx.devUrl, devToken: ctx.devToken, projectRoot: ctx.projectRoot }));
}

export async function callTool(name, args, ctx = defaultCtx(), opts = {}) {
  /* ---- P2-M2（2026-09-30 第三遍架构复校）：TOOLSETS 执行闸（闸序最前——未广告名 = 不可见
   * 亦不可达，先于 confirm 闸：被 TOOLSETS 隐藏的工具连审批面都不进）。未广告名按未知工具
   * ATR-404，码与文案与兜底链一致。 ---- */
  if (!ADVERTISED_NAMES.has(name)) {
    throw toolError(`ATR-404: unknown tool "${name}"`, "pick a tool from tools/list output");
  }
  /** P1-11：可选取消信号（Tasks 扩展 server 主导创建时经 http.mjs 注入）——长操作子进程随
   * tasks.cancel 即时树杀；stdio 直调不传，行为与既有完全一致。 */
  const signal = opts?.signal ?? null;

  /* ---- confirm 三档（决策 15 + FS-M6 §10.2 多轮审批）：deny 墙语义照旧；ask 档走
   *      InputRequiredResult + requestState 两轮——首轮不执行只发审批句柄，二轮携
   *      _approval{requestState, decision} 放行/拒绝；审批动作全量入审计。 ---- */
  const verdict = approvalVerdict(readAgentConfig(ctx.projectRoot), name, args, { secret: approvalSecret(ctx.projectRoot) });
  if (verdict.kind === "deny" || verdict.kind === "refused") {
    auditApproval(ctx.projectRoot, {
      event: verdict.code === "ATR-402" ? "denied" : "refused",
      tool: name,
      code: verdict.code,
      reason: verdict.message,
    });
    throw toolError(`${verdict.code}: ${verdict.message}`, verdict.fix);
  }
  if (verdict.kind === "inputRequired") {
    auditApproval(ctx.projectRoot, { event: "requested", tool: name, expiresAt: verdict.expiresAt });
    return {
      [INPUT_REQUIRED_TAG]: true,
      tool: name,
      requestState: verdict.requestState,
      message: verdict.message,
      context: verdict.context,
      expiresAt: verdict.expiresAt,
    };
  }
  if (verdict.kind === "execute") {
    auditApproval(ctx.projectRoot, { event: "granted", tool: name, decision: "approve" });
  }
  if (args && typeof args === "object" && "_approval" in args) {
    const { _approval, ...rest } = args; // 审批参数只服务闸门，绝不进工具实现
    args = rest;
  }

  /* ---- R3 收口：分发 Map（公共闸位之后）——confirm 闸对全部工具一致（闸序零变化）；
   *      signal 仅透传给声明了它的 handler（opts 原样下传）。 ---- */
  const handler = TOOL_HANDLERS.get(name);
  if (handler != null) return handler(args, ctx, { signal });

  /* ---- 兜底链（未命中 Map 的名字）：未知 404 → pending 诚实报错 → no-route 报错 → dev-face
   *      通用路径。当前 40 件广告实现工具全数入 Map，本链对既有工具面是不可达防线——防未来
   *      新增工具漏接（tests/r3-mcp-dispatch.test.ts 键集机检先红）。 ---- */
  const def = DEFS.tools.find((t) => t.name === name);
  if (!def) {
    throw toolError(`ATR-404: unknown tool "${name}"`, "pick a tool from tools/list output");
  }
  if (def.status !== "implemented") {
    throw toolError(
      `ATR-4xx-dev: "${name}" is specified but not wired yet (status=pending)`,
      `implement its route in the dev plugin (see mcp-definitions.json summary), then run 'atelier dev'; usage guidance: skill "atelier-mcp-tools"`
    );
  }
  if (!ENDPOINT_MAP[name]) {
    throw toolError(
      `ATR-4xx-dev: no route mapped for "${name}"`,
      "add it to ENDPOINT_MAP in mcp/server.mjs once the dev endpoint exists"
    );
  }
  return callDevFaceTool(name, args, ctx);
}

/* ---------- JSON-RPC 方法分发（stdio 与 HTTP 直连共用单源；ctx 注入 project/dev/task 面） ---------- */
function replyObj(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function replyErrObj(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function toolOkResult(out) {
  return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }], isError: false };
}
function toolResultFromError(e) {
  const result = { content: [{ type: "text", text: e?.message ?? String(e) }], isError: true };
  if (e?.atr) result.structuredContent = e.atr; // P2-2②：四段式结构化映射
  return result;
}
/** FS-M6②：SEP-2322 多轮审批首轮结果——InputRequiredResult + requestState（任意实例可续） */
function inputRequiredResult(out) {
  return {
    content: [{ type: "text", text: `APPROVAL REQUIRED — ${out.message}\nfix: ${out.context?.howToResume ?? "re-invoke with _approval { requestState, decision }"}` }],
    isError: false,
    inputRequired: { tool: out.tool, message: out.message, context: out.context, expiresAt: out.expiresAt },
    requestState: out.requestState,
  };
}

/** tasks/* 协议方法（SEP-2133）与同名点工具共用同一存储视图 */
function taskStoreMethod(method, params, ctx) {
  const store = ctx?.tasks ?? defaultTaskStore();
  const id = String(params?.taskId ?? "");
  if (!id) {
    throw toolError(
      `ATR-401: ${method} requires params.taskId`,
      "task 句柄由服务端主导创建（长操作获准执行时，stateless HTTP 通道）并随 tools/call 结果返回",
    );
  }
  const t = method === "tasks/get" ? store.get(id) : method === "tasks/cancel" ? store.cancel(id) : store.update(id, params ?? {});
  if (!t) {
    throw toolError(
      `ATR-401: task "${id}" 未找到（或保留窗已过）`,
      "任务句柄只在创建它的实例上可解析（dev 面 = 单实例）；重新发起长操作获取新句柄",
    );
  }
  return t;
}

async function handleMessage(msg, ctx = defaultCtx()) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return replyObj(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_LATEST,
        capabilities: { tools: { listChanged: false }, tasks: {} },
        serverInfo: SERVER_INFO,
      });
    case "notifications/initialized":
    case "$/cancelRequest":
      return null; // notifications: no reply
    case "ping":
      return replyObj(id, {});
    case "tools/list":
      return replyObj(id, { tools: listTools() });
    case "prompts/list":
      return replyObj(id, { prompts: [] });
    case "resources/list":
      return replyObj(id, { resources: [] });
    case "server/discover":
      // 2026-07-28 无状态预取（SEP-2575）：单请求拿 server 概貌——握手移除后的能力发现位
      return replyObj(id, {
        serverInfo: SERVER_INFO,
        protocolVersion: STATELESS_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, tasks: {} },
        tools: listTools(),
      });
    case "tasks/list":
      // 2026-07-28 移除该 method（SEP-2133：无会话无法安全定界）——诚实拒绝，不静默假装
      return id !== undefined
        ? replyErrObj(id, -32601, "ATR-401: tasks/list removed in MCP 2026-07-28 (no session → cannot safely scope)\nfix: address tasks by the explicit taskId returned from server-initiated creation")
        : null;
    case "tasks/get":
    case "tasks/update":
    case "tasks/cancel": {
      try {
        return replyObj(id, taskStoreMethod(method, params, ctx));
      } catch (e) {
        return e?.atr ? replyObj(id, toolResultFromError(e)) : replyErrObj(id, -32603, e?.message ?? String(e));
      }
    }
    case "tools/call": {
      const name = params?.name;
      try {
        const out = await callTool(name, params?.arguments, ctx);
        return replyObj(id, out?.[INPUT_REQUIRED_TAG] ? inputRequiredResult(out) : toolOkResult(out));
      } catch (e) {
        return replyObj(id, toolResultFromError(e));
      }
    }
    default:
      if (id !== undefined) return replyErrObj(id, -32601, `method not supported: ${method}`);
      return null;
  }
}

/* ---------- stdio plumbing（分发单源在 handleMessage；这里只管行协议与 stdout） ---------- */
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function replyError(id, code, message) {
  send(replyErrObj(id, code, message));
}

async function handle(msg) {
  const reply = await handleMessage(msg, defaultCtx());
  if (reply) send(reply);
}

/* ---------- lifecycle（仅直接执行时启动 stdio 循环；import 消费只取 callTool）---------- */
function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    Promise.resolve(handle(msg)).catch((e) => {
      // last-resort containment: an unexpected crash must not kill the session
      if (msg?.id !== undefined && msg?.id !== null) {
        replyError(msg.id, -32603, `internal error: ${e?.message ?? String(e)}`);
      }
    });
  });
  rl.on("close", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGHUP", () => process.exit(0));

  process.stderr.write(`[atelier-mcp] ${SERVER_INFO.name}@${SERVER_INFO.version}: ${TOOLS.length} tools, dev=${BASE}\n`);
}

/* TOOL_HANDLERS/TOOL_META 一并导出（R3 收口）：机检面（tests/r3-mcp-dispatch.test.ts 键集 =
 * 广告实现面 / 超时字面值 / 参数白名单位 ⊆ 广告 schema）——http.mjs 消费 callTool/listTools 不经此。 */
export { handleMessage, defaultCtx, SERVER_INFO, STATELESS_PROTOCOL_VERSION, TOOL_HANDLERS, TOOL_META };
if (INVOKED_DIRECTLY) main();
