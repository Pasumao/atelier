/**
 * http.mjs — MCP 2026-07-28 无状态 HTTP 直连端点（FS-DESIGN §10.2，决策 21 配套）。
 *
 * 形态：HTTP 直连 + `Mcp-Method`/`Mcp-Name` 头路由（SEP-2243），无会话粘性——
 * 任意请求落任意实例；initialize/initialized 握手移除（SEP-2575），版本经每次请求的
 * `_meta` 携带（应答 `_meta.protocolVersion = "2026-07-28"`）；状态若存在则以显式句柄
 * 回传（审批 requestState、任务 taskId——SEP-2567 handles 形态），由客户端原样带回。
 *
 * 逻辑单源：方法分发与工具执行复用 mcp/server.mjs 的 handleMessage/callTool（stdio 零
 * 回归）；本文件只做 HTTP 形态层——头校验、体归一、包络/状态码映射、服务端主导的
 * Tasks 创建策略。dev 面 `/__atelier/mcp`（token 门在 dev 插件既有中间件）只接线本文件。
 *
 * 线协议（POST，JSON）：
 *   请求头  Mcp-Method: tools/list | tools/call | tasks/get | tasks/update | tasks/cancel
 *                   | ping | server/discover                       （必填）
 *           Mcp-Name: <tool>                                       （tools/call 必填）
 *   请求体  { arguments?: object, _meta?: { protocolVersion?... } }（tools/call；审批二轮
 *           在 arguments 里携 `_approval: { requestState, decision }`，同 stdio）
 *   应答    200 { ok: true, result: <method result>, _meta: { protocolVersion } }
 *           4xx { ok: false, error: { code, message, fix } }        （协议/传输层错误）
 *   工具级错误走 MCP 语义：200 + result.isError=true + structuredContent（与 stdio 同果）。
 *
 * Tasks 创建策略（SEP-2133 服务端主导）：HTTP 通道 + 长操作清单（TASK_ELIGIBLE）+ 非
 * confirm 受闸工具 → 不内联执行，建任务返回 taskId；客户端以 tasks/get 轮询、可
 * tasks/update 收紧保留窗、tasks/cancel 取消。tasks/list 按 2026-07-28 移除不提供。
 */
import { handleMessage, callTool, listTools, SERVER_INFO, STATELESS_PROTOCOL_VERSION } from "./server.mjs";
import { createTaskStore } from "./tasks.mjs";
import { INPUT_REQUIRED_TAG, isAskGated } from "./confirm.mjs";
import fs from "node:fs";
import path from "node:path";

/** 服务端主导创建的长操作清单（spawn 子进程型/全量型；随长操作入库扩充）。
 * R3 收口（评审 §4.6）扩充长 spawn 型四件——checkpoint.source_list/source_commit（git spawn，
 * 601s 档）、graph.static（构建期图查询，60s 档）、diff.report（git 基线对照）——HTTP 直连下
 * 内联执行会阻塞 dev 面（Vite 事件循环）同端口的一切请求，与握手监督/取消语义的整改动机
 * 精神一致。受闸工具不入（confirm 闸先行，:158 条件）；导出仅供测试钉住清单。 */
export const TASK_ELIGIBLE = new Set([
  "structure.check",
  "test.run",
  "checkpoint.source_list",
  "checkpoint.source_commit",
  "graph.static",
  "diff.report",
]);

const REMOVED_OR_UNSUPPORTED = new Map([
  ["initialize", { message: "initialize/initialized 握手已在 MCP 2026-07-28 无状态形态移除（SEP-2575）", fix: "直接发业务请求；版本/能力信息放每次请求的 _meta（应答 _meta.protocolVersion = 2026-07-28）；能力预取用 server/discover" }],
  ["notifications/initialized", { message: "通知通道不适用于无状态 HTTP 直连（握手已移除，SEP-2575）", fix: "直接发业务请求（Mcp-Method 头路由），无需任何握手/通知序列" }],
  ["tasks/list", { message: "tasks/list 已在 MCP 2026-07-28 移除（SEP-2133：无会话无法安全定界）", fix: "以服务端创建时返回的显式 taskId 句柄直取 tasks/get；句柄过期（ATR-401）则重发长操作" }],
]);

/** 模块级任务存储：进程内 + 显式 taskId 句柄（dev 面 = 单实例；句柄可失效，诚实边界见 tasks.mjs 头） */
let _sharedStore = null;
function sharedStore() {
  _sharedStore ??= createTaskStore();
  return _sharedStore;
}

function res(status, payload) {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(payload) };
}
const okEnvelope = (result) => res(200, { ok: true, result, _meta: { protocolVersion: STATELESS_PROTOCOL_VERSION } });
const errEnvelope = (status, code, message, fix) => res(status, { ok: false, error: { code, message, ...(fix ? { fix } : {}) } });

/** 解析 deps：dev 面接线传入 projectRoot/devUrl/devToken/audit；缺省回退 env（独立跑测试/脚本时） */
function resolveDeps(deps = {}) {
  const projectRoot = deps.projectRoot ?? process.env.ATELIER_PROJECT_ROOT ?? process.cwd();
  let devToken = deps.devToken;
  if (devToken == null) {
    try {
      devToken = fs.readFileSync(path.join(projectRoot, ".atelier", "dev-token"), "utf8").trim();
    } catch {
      devToken = "";
    }
  }
  return {
    projectRoot,
    devUrl: deps.devUrl ?? process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173",
    devToken,
    audit: deps.audit ?? null,
    tasks: deps.tasks ?? sharedStore(),
  };
}

/**
 * 唯一入口：永不 throw——任何内部错误都收敛为 500 结构化应答（dev 面接线保持极简）。
 * @returns {Promise<{status: number, body: string, contentType: string}>}
 */
export async function handleMcpHttp(request, deps = {}) {
  try {
    return await route(request, resolveDeps(deps));
  } catch (e) {
    return errEnvelope(500, "ATR-4xx-dev", `MCP HTTP bridge internal error: ${e?.message ?? e}`, "检查 dev 面日志；如持续复现请带请求头 Mcp-Method 报障");
  }
}

async function route(request, d) {
  const mcpMethod = request.headers.get("mcp-method")?.trim() ?? "";
  if (!mcpMethod) {
    return errEnvelope(400, "ATR-401", "missing Mcp-Method header", "每次请求携 Mcp-Method 头（MCP 2026-07-28 SEP-2243 头路由，无会话粘性）：tools/list | tools/call | tasks/get | tasks/update | tasks/cancel | ping | server/discover");
  }
  const removed = REMOVED_OR_UNSUPPORTED.get(mcpMethod);
  if (removed) return errEnvelope(400, "ATR-401", removed.message, removed.fix);

  const raw = await request.text();
  let body = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return errEnvelope(400, "ATR-401", "request body is not valid JSON", "POST application/json：{ arguments?, _meta? }（tools/call）或 { taskId, ttlMs? }（tasks/*）");
    }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errEnvelope(400, "ATR-401", "request body must be a JSON object", "POST application/json：{ arguments?, _meta? }");
  }

  switch (mcpMethod) {
    case "ping": {
      const reply = await handleMessage({ jsonrpc: "2.0", id: 0, method: "ping" }, ctxOf(d));
      return okEnvelope(reply.result);
    }
    case "tools/list": {
      const reply = await handleMessage({ jsonrpc: "2.0", id: 0, method: "tools/list" }, ctxOf(d));
      return okEnvelope(reply.result);
    }
    case "server/discover": {
      const reply = await handleMessage({ jsonrpc: "2.0", id: 0, method: "server/discover" }, ctxOf(d));
      return okEnvelope(reply.result);
    }
    case "tools/call":
      return toolsCall(body, request, d);
    case "tasks/get":
    case "tasks/update":
    case "tasks/cancel": {
      // P2-M4（2026-09-30 第三遍架构复校）：_meta 是标准体形（本文件头线协议节：版本经每次请求
      // 的 _meta 携带）——构造 params 时剥 _meta 再下发（对齐 tools/call 只取 { name, arguments }
      // 的既有先例）；tasks/update 的未知字段严格闸（tasks.mjs SETTABLE_FIELDS）只对业务键生效，
      // 不再被协议层 _meta 误触 ATR-401。
      const { _meta, ...params } = body ?? {};
      const reply = await handleMessage({ jsonrpc: "2.0", id: 0, method: mcpMethod, params }, ctxOf(d));
      if (reply.error) return errEnvelope(400, "ATR-401", reply.error.message.split("\n")[0], "以服务端创建时返回的 taskId 句柄调用；句柄过期则重发长操作");
      return okEnvelope(reply.result);
    }
    default:
      return errEnvelope(404, "ATR-401", `unknown Mcp-Method "${mcpMethod}"`, "可用：tools/list | tools/call | tasks/get | tasks/update | tasks/cancel | ping | server/discover（initialize/notifications/tasks/list 已随 2026-07-28 移除）");
  }
}

function ctxOf(d) {
  return { projectRoot: d.projectRoot, devUrl: d.devUrl, devToken: d.devToken, tasks: d.tasks };
}

async function toolsCall(body, request, d) {
  const headerName = request.headers.get("mcp-name")?.trim() ?? "";
  const bodyName = typeof body.name === "string" ? body.name.trim() : "";
  if (!headerName && !bodyName) {
    return errEnvelope(400, "ATR-401", "tools/call requires the Mcp-Name header", "头路由（SEP-2243）：Mcp-Name: <tool name>（工具名先 tools/list 查表）");
  }
  if (headerName && bodyName && headerName !== bodyName) {
    return errEnvelope(400, "ATR-401", `Mcp-Name header ("${headerName}") conflicts with body.name ("${bodyName}")`, "头路由是权威寻址位：二选一，或保持两者一致（LB 场景必须走头）");
  }
  const name = headerName || bodyName;
  const args = body.arguments ?? {};
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return errEnvelope(400, "ATR-401", "arguments must be a JSON object", 'POST 体形如 { "arguments": { ... }, "_meta": { ... } }');
  }

  /* 服务端主导创建（SEP-2133）：长操作清单内且非 confirm 受闸（审批必须交互式内联走）的工具，
   * 不内联执行——建任务返回显式 taskId 句柄；客户端 tasks/get 轮询至终态。
   * P1-11：run(signal) 把 store 的 AbortController 透传进 callTool 的长操作子进程——
   * tasks/cancel 即时树杀（spawnCaptured），不再只是对同步 spawnSync 无效的空信号。 */
  if (TASK_ELIGIBLE.has(name) && !isAskGated(name) && !args._approval) {
    let task;
    try {
      task = d.tasks.create({ tool: name, args, run: (signal) => callTool(name, args, ctxOf(d), { signal }) });
    } catch (e) {
      if (e?.atr) return errEnvelope(503, e.atr.code, e.atr.message, e.atr.fix);
      throw e;
    }
    d.audit?.("mcp.task.created", { tool: name, taskId: task.taskId });
    return okEnvelope({
      content: [{ type: "text", text: `task created: ${task.taskId}（服务端主导创建——poll tasks/get { taskId } 至终态；可 tasks/cancel / tasks.update 收紧保留窗）` }],
      isError: false,
      task,
    });
  }

  const reply = await handleMessage({ jsonrpc: "2.0", id: 0, method: "tools/call", params: { name, arguments: args } }, ctxOf(d));
  return okEnvelope(reply.result);
}
