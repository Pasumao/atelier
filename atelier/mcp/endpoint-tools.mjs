/**
 * endpoint-tools.mjs — FS-6 L3 MCP 全栈工具族实现（FS-DESIGN §10.1，净增 8 工具，
 * 对 Next `/_next/mcp` 8 工具做超集对表；四面扩张批 +4：jobs.status / email.log /
 * uploads.status / server.health——覆盖 jobs/uploads/email/health 四个新 server 面）。
 *
 * 数据源分两类（诚实边界）：
 *   live 组（10 个）消费应用 dev 面 GET /__atelier/server-status（§10.3；host 由 dev 托管线
 *   提供，本模块只按数据源契约消费）；dev face 不在 → 四段式结构化错误（fix 指路 pnpm dev），
 *   绝不静默空结果。段级缺省（jobs/email/uploads 未装配 = 键不出现）→ 诚实 null + 装配指路
 *   note（dbMigrations 同款纪律），绝不编造空结果。
 *   直连组（server.health）GET <mount>/__atelier/health 探活——不经 server-status；非 200 是
 *   数据（health.ts orchestrator 报警语义），传输层不通才四段式。
 *   静态组（endpoint.impact）复用 gen/impact.mjs impactReport——两跳链路原样，不依赖 dev 面。
 *
 * 投影红线（§2.4）：endpoint.contract 的 JSON Schema 投影 import compiler/project-json.mjs
 * 单管线（OpenAPI 导出 / MCP inputSchema / ~standard.jsonSchema 三消费同源），绝不另写投影；
 * 扁平语义之外的结构由投影器显式 ATR-107，绝不静默降级。
 *
 * confirm 闸：endpoint.call 三档（auto/ask/deny）在 mcp/confirm.mjs 收口，server.mjs callTool
 * 统一先过闸——本模块不重复判档；ask 档 = 多轮审批（InputRequiredResult + requestState，
 * FS-M6 §10.2），见 confirm.mjs 头。
 */
import { impactReport } from "../gen/impact.mjs";
import { projectJsonSchema, PROJECT_TARGETS } from "../compiler/project-json.mjs";

/** FS-6 工具名单（server.mjs callTool 以此分流） */
export const FS6_TOOLS = new Set([
  "endpoint.list",
  "endpoint.contract",
  "endpoint.impact",
  "db.schema",
  "db.migrations",
  "server.introspect",
  "endpoint.call",
  "endpoint.journal",
  "jobs.status",
  "email.log",
  "uploads.status",
  "server.health",
]);

/** 四段式错误工厂（server.mjs toolError 同款形态：ATR 码解析进 e.atr，宿主可结构化消费） */
export function toolError(codeText, fixText) {
  const e = new Error(`${codeText}\nfix: ${fixText}`);
  const m = /^(ATR-[\w-]+):\s*([\s\S]*)$/.exec(codeText);
  e.atr = { code: m ? m[1] : "ATR-ERR", message: m ? m[2] : codeText, fix: fixText };
  return e;
}

const SERVER_STATUS_PATH = "/__atelier/server-status";

async function fetchServerStatus(devUrl, devToken) {
  const r = await fetch(`${devUrl}${SERVER_STATUS_PATH}`, {
    headers: { "x-atelier-token": devToken },
    signal: AbortSignal.timeout(10000),
  }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${devUrl} (${e.cause?.code ?? e.name})`,
      "启动应用 dev server（应用目录 pnpm dev）后再试；或设 ATELIER_DEV_URL 指向运行中的 dev 面",
    );
  });
  if (r.status === 401) {
    throw toolError("ATR-402: dev token rejected", "读取应用根 .atelier/dev-token 作为 x-atelier-token（server-status 在 dev 面 token 门内）");
  }
  if (!r.ok) {
    throw toolError(`ATR-4xx-dev: server-status HTTP ${r.status}`, "检查应用 dev 面日志（server-status 段由 dev 托管线提供）");
  }
  const j = await r.json().catch(() => {
    throw toolError(`ATR-4xx-dev: ${SERVER_STATUS_PATH} 返回非法 JSON`, "检查应用 dev 面日志");
  });
  if (j?.ok !== true) {
    throw toolError("ATR-4xx-dev: server-status 报告未就绪", "确认应用 server 面已挂接端点（defineQuery/defineCommand 注册后 dev 面才可报告）");
  }
  return j;
}

function endpointByName(status, name) {
  const list = status.endpoints ?? [];
  const hit = list.find((e) => e?.name === name);
  if (!hit) {
    throw toolError(
      `ATR-401: endpoint "${name}" not registered`,
      `registered: ${list.map((e) => e?.name).join(", ") || "(none)"} — 先 endpoint.list 查全表`,
    );
  }
  return hit;
}

/* ---------- live 组（消费 server-status） ---------- */

function endpointList(status) {
  // 摘要位：name/kind/live/失效键/auth/timeout/idempotent；schema 体留给 endpoint.contract（token 纪律）
  const rows = (status.endpoints ?? []).map(({ contract, output, ...summary }) => summary);
  return { count: rows.length, endpoints: rows, source: SERVER_STATUS_PATH };
}

function projectOrThrow(flat, target, label) {
  if (flat == null) return null;
  try {
    return projectJsonSchema(flat, target, { label });
  } catch (e) {
    if (e?.code === "ATR-107") throw toolError(e.message, e.fix); // 扁平之外的结构：四段式透传，绝不静默降级
    throw e;
  }
}

function endpointContract(status, args) {
  const name = String(args?.name ?? "").trim();
  if (!name) {
    throw toolError("ATR-401: endpoint.contract requires args.name", "先 endpoint.list 拿端点名");
  }
  const hit = endpointByName(status, name);
  const target = args?.target ?? null;
  if (target != null) {
    if (!PROJECT_TARGETS.includes(target)) {
      throw toolError(`ATR-401: 未知投影 target "${target}"`, `可用：${PROJECT_TARGETS.join(" | ")}（缺省 = FlatSchema 原样直读）`);
    }
    return {
      name,
      target,
      contract: projectOrThrow(hit.contract, target, `${name}.contract`),
      output: projectOrThrow(hit.output, target, `${name}.output`),
    };
  }
  const flat = {
    name,
    target: null,
    contract: hit.contract ?? null,
    output: hit.output ?? null,
  };
  if (flat.contract === null && flat.output === null) {
    flat.note = "该端点未声明契约（defineQuery/defineCommand 的 contract/output 位缺省 = 不校验）";
  }
  return flat;
}

function endpointImpact(projectRoot, contractKey) {
  const key = String(contractKey ?? "").trim();
  if (!key) {
    throw toolError("ATR-401: endpoint.impact requires args.contractKey", "契约单源（src/contract.ts）常量标识符，如 chatInputSchema");
  }
  const r = impactReport(projectRoot, key);
  // "impact 是导航不是门禁"（§2.5）：未命中也返回报告（notes 指路），绝不抛错
  return { ...r, projectRoot, note: "两跳静态链（契约 → 端点 → 调用点）——导航报告，不阻断；动态引用由运行时契约校验拦截" };
}

function dbSchema(status, args) {
  const db = status.db;
  if (!db || !Array.isArray(db.tables)) {
    throw toolError("ATR-4xx-dev: server-status 未携带 db 段", "确认应用已挂接数据面（src/server/db/schema.ts + atelier gen db）后再试");
  }
  const wanted = args?.table;
  if (wanted != null) {
    const hit = db.tables.find((t) => t?.name === wanted);
    if (!hit) {
      throw toolError(`ATR-401: table "${wanted}" not in schema`, `tables: ${db.tables.map((t) => t?.name).join(", ") || "(none)"} — 先 db.schema 查全量`);
    }
    return { table: hit };
  }
  return { count: db.tables.length, tables: db.tables, source: SERVER_STATUS_PATH };
}

function dbMigrations(status) {
  const m = status.db?.migrations;
  if (m == null) {
    return { migrations: null, note: "dev face 未报告迁移状态（db 未初始化或无迁移记录）——CLI `atelier migrate status --root <appDir>` 可直查" };
  }
  const out = { head: m.head ?? null, applied: m.applied ?? [], pending: m.pending ?? [] };
  if (out.pending.length > 0) {
    out.note = "有未应用迁移——`atelier migrate up --root <appDir>`；可逆迁移器 down 可回，不可逆 down 须 --force（人工 CLI）";
  }
  return { migrations: out, source: SERVER_STATUS_PATH };
}

function serverIntrospect(status) {
  const journal = status.journal ?? [];
  return {
    server: status.server ?? null,
    live: status.live ?? null,
    endpointCount: (status.endpoints ?? []).length,
    journal: { size: journal.length, tail: journal.slice(-10) },
    source: SERVER_STATUS_PATH,
  };
}

function endpointJournal(status, args) {
  const all = status.journal ?? [];
  const lines = Math.max(1, Math.min(50, Number(args?.lines ?? 50) || 50)); // dev face journal 上限 50
  const entries = all.slice(-lines);
  return {
    total: all.length,
    count: entries.length,
    failed: entries.filter((e) => e?.status === "failed").length,
    entries,
    note: "command 审计（成功与失败同源呈现）——\"代理改了什么、砸了什么\"从这里查；query 不入账",
  };
}

/* ---------- 四面扩张批（jobs/email/uploads 段投影 + health 探活；缺省诚实返回 = dbMigrations 同款） ---------- */

function jobsStatus(status) {
  // server-status jobs 段（server/jobs.ts JobsStats：counts 四态计数 + recent 尾部 ~20 条）原样投影
  if (status.jobs == null) {
    return {
      jobs: null,
      note: "未装配 jobs 面（createHandler({ jobs })）——装配后本工具报告队列计数与尾部",
      source: SERVER_STATUS_PATH,
    };
  }
  return { jobs: status.jobs, source: SERVER_STATUS_PATH };
}

function emailLog(status) {
  const email = status.email;
  if (email == null) {
    return {
      email: null,
      note: "未装配 email 面（createHandler({ email })，决策 31）——装配后本工具报告投递记账尾部",
      source: SERVER_STATUS_PATH,
    };
  }
  return {
    count: email.length,
    // failed 过滤取值源 = server/email.ts EmailLogEntry.status（"ok" | "failed"——send 抛错/拒绝 = failed）
    failed: email.filter((e) => e?.status === "failed").length,
    entries: email,
    note: "dev 面 tail 有界（~20 条）——全量台账走 atelier_email_log SQL 直读",
    source: SERVER_STATUS_PATH,
  };
}

function uploadsStatus(status) {
  if (status.uploads == null) {
    return {
      uploads: null,
      note: "未装配 uploads 面（createHandler({ uploads })，决策 32）——装配后本工具报告注册表与资产台账",
      source: SERVER_STATUS_PATH,
    };
  }
  // 透传不投影：字段级再投影会让本工具与 A 分支 uploads 段契约形成漂移面——透传把漂移面压到零
  return { ...status.uploads, source: SERVER_STATUS_PATH };
}

async function serverHealth(args, { devUrl, devToken }) {
  // mount 清洗与 endpointCall 同式：剥首尾斜杠再补前缀（"/degraded/" → "/degraded"）
  const mountPath = "/" + String(args?.mount ?? "/api").replace(/^\/+|\/+$/g, "");
  const t0 = Date.now();
  const r = await fetch(`${devUrl}${mountPath}/__atelier/health`, {
    headers: { "x-atelier-token": devToken }, // health 本身无 token 门（server/health.ts），带头无害——endpoint.call 先例
    signal: AbortSignal.timeout(10000),
  }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: server.health unreachable at ${devUrl} (${e.cause?.code ?? e.name})`,
      "启动应用 dev server（应用目录 pnpm dev）后再试；或设 ATELIER_DEV_URL 指向运行中的 dev 面",
    );
  });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  // 非 200 是数据不抛（health.ts 口径：探活的语义就是非 200 可报警——orchestrator 靠状态码，
  // db 探活失败 = 503 + ok:false 是健康面的事实呈现）；传输层不通才走上方四段式
  return { ok: r.ok, status: r.status, durMs: Date.now() - t0, body };
}

/** 端点名 = 注册表标识符（字母开头 + 字母数字.-）；挡路径注入/查询串拼接 */
const EP_NAME_RE = /^[A-Za-z][\w.-]*$/;

async function endpointCall(args, { devUrl, devToken }) {
  const name = String(args?.name ?? "").trim();
  if (!name) {
    throw toolError("ATR-401: endpoint.call requires args.name", "先 endpoint.list；写端点（command）受 agent.confirm 三档约束（deny → ATR-402）");
  }
  if (!EP_NAME_RE.test(name)) {
    throw toolError(`ATR-401: 非法端点名 "${name}"`, "端点名是注册表标识符（字母开头，字母数字与 . -）——本工具不做路径拼接之外的解释");
  }
  const mount = "/" + String(args?.mount ?? "/api").replace(/^\/+|\/+$/g, "");
  const t0 = Date.now();
  const r = await fetch(`${devUrl}${mount}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-atelier-token": devToken },
    body: JSON.stringify(args?.input ?? {}),
    signal: AbortSignal.timeout(45000),
  }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: endpoint.call "${name}" unreachable at ${devUrl} (${e.cause?.code ?? e.name})`,
      "启动应用 dev server（应用目录 pnpm dev）后再试；或设 ATELIER_DEV_URL 指向运行中的 dev 面",
    );
  });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  // 端点级错误（4xx/5xx + AtrError 体）原样透传为数据——不吞响应体；传输层不通才走四段式
  return { name, ok: r.ok, status: r.status, durMs: Date.now() - t0, body };
}

/** server.mjs callTool 的 FS-6 分流入口 */
export async function callEndpointTool(name, args, { devUrl, devToken, projectRoot }) {
  if (name === "endpoint.impact") return endpointImpact(projectRoot, args?.contractKey);
  if (name === "server.health") return serverHealth(args, { devUrl, devToken }); // 直探 server 面健康端点——不经 server-status
  const status = await fetchServerStatus(devUrl, devToken);
  switch (name) {
    case "endpoint.list": return endpointList(status);
    case "endpoint.contract": return endpointContract(status, args);
    case "db.schema": return dbSchema(status, args);
    case "db.migrations": return dbMigrations(status);
    case "server.introspect": return serverIntrospect(status);
    case "endpoint.journal": return endpointJournal(status, args);
    case "endpoint.call": return endpointCall(args, { devUrl, devToken });
    case "jobs.status": return jobsStatus(status);
    case "email.log": return emailLog(status);
    case "uploads.status": return uploadsStatus(status);
    default:
      throw toolError(`ATR-404: unknown tool "${name}"`, "pick a tool from tools/list output");
  }
}
