/**
 * confirm.mjs — MCP 操作面 confirm 三档（决策 15：auto / ask / deny）的单一执行点。
 *
 * 配置：atelier.config.json → agent.confirm（缺省 auto）。
 * 破坏性操作（状态回滚族）必须过闸：deny 档以 ATR-402 结构化拒绝，auto 放行。
 *
 * FS-M6（FS-DESIGN §10.2，MCP 2026-07-28 对齐）：ask 档的「暂同 auto」诚实边界升格为
 * 真正的多轮审批——SEP-2322 InputRequiredResult + requestState 原语：
 *   首轮调用受闸工具 → 不执行，返回 inputRequired 结果 + HMAC 签名的 requestState 句柄；
 *   客户端二轮携 `_approval { requestState, decision: "approve" | "deny" }` 重新提交 →
 *   放行执行 / ATR-402 拒绝。句柄 = 显式句柄（SEP-2567 handles 形态）：签名密钥取项目
 *   `.atelier/approval-secret`（R3 收口起与 dev-token 分离——dev-token 可被 dev 面客户端读取，
 *   能读即能伪造自批；审批密钥首用生成、独立落盘，旧句柄失效 = dev 时点工具可接受），状态
 *   尽量在句柄内——无服务端会话态，stdio 与 HTTP 直连双通道任意实例可续（同一密钥文件）。
 *   诚实边界：句柄短时有效（缺省 5 分钟）；nonce 一次性台账为**进程内**消费——TTL 内重放拒绝
 *   （R3 收口，评审 §4.2「一次审批→N 次回滚」关闭），跨进程重启窗的残留重放仍由审计
 *   mcp.approval 流检出（台账持久化 = 服务端状态，违背无状态对齐，维持不做）。
 * 审批动作全量入审计（.atelier/audit.jsonl，与 dev 面同格式：kind = "mcp.approval"）。
 */
import fs from "node:fs";
import crypto from "node:crypto";

/** 破坏性操作清单（回滚族——丢弃当前状态/回退文件树） */
const DESTRUCTIVE_TOOLS = new Set([
  "checkpoint.rollback", // 应用状态回滚（dev 面执行）
  "state.time_travel", // 信号时间旅行（dev 面执行）
  "checkpoint.source_rollback", // 源码文件树回滚（决策 15）
]);

/** 操作面工具（FS-DESIGN §10.1）：endpoint.call 真调应用端点（写端点 = 副作用出闸），
 * 同样过 confirm 三档；deny → ATR-402 结构化拒绝。 */
const OPERATION_TOOLS = new Set(["endpoint.call"]);

/** ask 档受闸面 = 破坏性族 ∪ 操作族（deny 档受闸面 = 各自清单，见 confirmGate） */
export function isAskGated(toolName) {
  return DESTRUCTIVE_TOOLS.has(toolName) || OPERATION_TOOLS.has(toolName);
}

/** InputRequiredResult 的返回标记位（callTool 返回对象携带；server.mjs 负责包络成 MCP 形态） */
export const INPUT_REQUIRED_TAG = "__atelierInputRequired";

/** 读取应用配置的 agent 段；缺文件/坏 JSON 一律降级为 auto（不因配置问题放大权限，也不误伤） */
export function readAgentConfig(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(`${projectRoot}/atelier.config.json`, "utf8")).agent ?? {};
  } catch {
    return {};
  }
}

/**
 * 闸门：受闸工具 × confirm 档 → null（放行）或 { code, message, fix }（拒绝）。
 * 纯函数，无 IO——MCP server 调用前先 readAgentConfig；测试直接喂配置。
 * FS-M6 后本函数只承担 deny 墙；ask 档多轮审批在 approvalVerdict 收口。
 */
/** R3 收口（评审 §4.2）：合法档位集 + 未知档位 fail-closed 拒绝（"ask " 尾空格 / "Ask" /
 * 拼错不再静默放行破坏性工具）；非受闸工具不受扰（闸只辖破坏性/操作族）。 */
const CONFIRM_TIERS = new Set(["auto", "ask", "deny"]);
function unknownTierDenial(toolName, tier) {
  return {
    code: "ATR-402",
    message: `agent.confirm 档位非法：${JSON.stringify(tier)}——拒绝执行受闸操作 ${toolName}（fail-closed）`,
    fix: 'atelier.config.json → agent.confirm 仅接受 "auto" | "ask" | "deny"（缺省 auto）',
  };
}

export function confirmGate(agentConfig, toolName, args) {
  const tier = agentConfig?.confirm ?? "auto";
  if ((DESTRUCTIVE_TOOLS.has(toolName) || OPERATION_TOOLS.has(toolName)) && !CONFIRM_TIERS.has(tier)) {
    return unknownTierDenial(toolName, tier);
  }
  if (DESTRUCTIVE_TOOLS.has(toolName) && tier === "deny") {
    return {
      code: "ATR-402",
      message: `agent.confirm = deny：拒绝执行破坏性操作 ${toolName}`,
      fix: "由人工在 CLI 执行回滚（atelier checkpoint rollback / atelier cli checkpoint），或经用户确认后把 atelier.config.json 的 agent.confirm 调为 auto / ask",
    };
  }
  if (OPERATION_TOOLS.has(toolName) && tier === "deny") {
    const ep = args?.name ? `（端点 ${args.name}）` : "";
    return {
      code: "ATR-402",
      message: `agent.confirm = deny：拒绝调用应用端点${ep}（${toolName}）`,
      fix: "由人工经应用界面/生成客户端（src/generated/api.ts）调用该端点，或经用户确认后把 atelier.config.json 的 agent.confirm 调为 auto / ask",
    };
  }
  return null; // deny 墙外放行（auto 直执行；ask 由 approvalVerdict 接手）
}

/* ---------- FS-M6②：requestState 显式句柄（SEP-2322/2567 对齐） ---------- */

const HANDLE_TTL_MS_DEFAULT = 5 * 60_000;

/** 签名密钥（R3 收口，评审 §4.2）：项目 `.atelier/approval-secret`，首用生成（32 字节 hex，
 * 0600 落盘）——与 dev-token 分离（dev-token 可被 dev 面客户端读取，能读即能伪造 requestState
 * 自批，ask 档对持 token 方沦为荣誉制）。落盘即真相：stdio 与 HTTP 直连双通道跨实例同钥，
 * 句柄可续。旧 dev-token 密钥句柄失效 = dev 时点工具可接受。只读盘等无法落盘场景降级为
 * 项目根路径派生（密级等同既有缺位兜底，本地单机信任模型）。 */
export function approvalSecret(projectRoot) {
  const file = path2join(String(projectRoot ?? ""), ".atelier", "approval-secret");
  try {
    const cur = fs.readFileSync(file, "utf8").trim();
    if (cur) return cur;
  } catch { /* 首用生成 */ }
  try {
    fs.mkdirSync(path2join(String(projectRoot ?? ""), ".atelier"), { recursive: true });
    const fresh = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
    return fresh;
  } catch {
    return pathFallback(projectRoot);
  }
}
function path2join(...segs) {
  return segs.join("/");
}
function pathFallback(projectRoot) {
  return crypto.createHash("sha256").update(String(projectRoot)).digest("hex");
}

/** 键排序稳定序列化（参数绑定用；数组保序） */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** 二轮提交的审批参数（首轮 args 里不存在；绑定时不参与哈希） */
function stripApproval(args) {
  if (args === null || typeof args !== "object") return args;
  const { _approval, ...rest } = args;
  return rest;
}
function argsHash(args) {
  return crypto.createHash("sha256").update(stableStringify(stripApproval(args))).digest("hex");
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/**
 * 签发审批句柄：`v1.<b64url(payload)>.<hmac(payload)>`
 * payload = { t: tool, h: argsHash, e: exp(ms), n: nonce }——状态全在句柄内，无服务端会话态。
 * 纯函数（除 crypto），secret/now 可注入以便测试。
 */
export function createRequestState({ tool, args, secret, now = Date.now(), ttlMs = HANDLE_TTL_MS_DEFAULT }) {
  const payload = { t: String(tool), h: argsHash(args), e: Number(now) + Number(ttlMs), n: crypto.randomUUID() };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", String(secret)).update(body).digest("base64url");
  return `v1.${body}.${sig}`;
}

/**
 * 校验审批句柄：签名 → 有效期 → 工具绑定 → 参数绑定（_approval 键剥离后比对）。
 * 返回 { ok: true } 或 { ok: false, reason: "malformed" | "bad-signature" | "expired" | "tool-mismatch" | "args-changed" }。
 */
export function verifyRequestState({ requestState, tool, args, secret, now = Date.now() }) {
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(requestState ?? ""));
  if (!m) return { ok: false, reason: "malformed" };
  const [, body, sig] = m;
  const expect = crypto.createHmac("sha256", String(secret)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (Number(payload.e) <= Number(now)) return { ok: false, reason: "expired" };
  if (payload.t !== String(tool)) return { ok: false, reason: "tool-mismatch" };
  if (payload.h !== argsHash(args)) return { ok: false, reason: "args-changed" };
  return { ok: true, payload };
}

/**
 * ask 档多轮审批的单一判定点（FS-M6②）：
 *   { kind: "allow" }         — 未受闸，或 auto/缺省档（既有行为零变化）
 *   { kind: "deny", code, message, fix }            — deny 档（confirmGate 同文）
 *   { kind: "inputRequired", requestState, message, context, expiresAt } — ask 首轮：不执行，等审批
 *   { kind: "execute" }       — ask 二轮：approve + 有效句柄，放行执行
 *   { kind: "refused", code, message, fix }         — ask 二轮被拒（人工 deny / 句柄无效过期）
 * 纯判定（secret/now 可注入）；审计由调用方（server.mjs）落，见 auditApproval。
 */
/** nonce 一次性台账（R3 收口，评审 §4.2）：进程内 Set——同一句柄 nonce 二次呈现即拒
 * （「一次审批→N 次回滚」关闭）。进程生命周期即台账边界（诚实边界见文件头：跨进程重启窗
 * 的残留重放由审计流检出）。 */
const consumedNonces = new Set();

export function approvalVerdict(agentConfig, toolName, args = {}, { secret, now = Date.now(), ttlMs } = {}) {
  const tier = agentConfig?.confirm ?? "auto";
  if (!isAskGated(toolName)) {
    const denial = confirmGate(agentConfig, toolName, args);
    return denial ? { kind: "deny", ...denial } : { kind: "allow" };
  }
  if (!CONFIRM_TIERS.has(tier)) {
    const denial = unknownTierDenial(toolName, tier); // fail-closed：未知档位不再静默放行
    return { kind: "refused", ...denial };
  }
  if (tier === "deny") {
    const denial = confirmGate(agentConfig, toolName, args);
    return denial ? { kind: "deny", ...denial } : { kind: "allow" }; // deny 墙语义与既有完全一致
  }
  if (tier !== "ask") return { kind: "allow" }; // auto / 缺省：放行（ask 分支在下方）

  const approval = args?._approval;
  if (!approval || typeof approval !== "object" || !approval.requestState) {
    const token = createRequestState({ tool: toolName, args, secret, now, ttlMs });
    return {
      kind: "inputRequired",
      requestState: token,
      message: `${toolName} 受 agent.confirm = ask 约束：需要人工审批后才能执行`,
      context: {
        tool: toolName,
        args: stripApproval(args),
        howToResume: "以相同参数重新调用本工具，并附加 _approval: { requestState, decision: \"approve\" | \"deny\" }",
        reason: "confirm=ask",
      },
      expiresAt: Number(now) + Number(ttlMs ?? HANDLE_TTL_MS_DEFAULT),
    };
  }
  const decision = String(approval.decision ?? "");
  const check = verifyRequestState({ requestState: approval.requestState, tool: toolName, args, secret, now });
  if (!check.ok) {
    const why = check.reason === "expired"
      ? "审批句柄已过期（5 分钟窗，重发请求可重新取句柄）"
      : check.reason === "args-changed"
        ? "审批句柄与本次参数不绑定（参数漂移）——以首轮完全相同的参数重试"
        : check.reason === "tool-mismatch"
          ? "审批句柄绑定的是其他工具"
          : "审批句柄无效或被篡改";
    return {
      kind: "refused",
      code: "ATR-401",
      message: `${toolName} 审批未通过（${check.reason}）：${why}`,
      fix: `重新调用 ${toolName}（不带 _approval）获取新 requestState，再由人工决定 approve / deny`,
    };
  }
  if (decision === "approve") {
    const nonce = String(check.payload.n ?? "");
    if (nonce && consumedNonces.has(nonce)) {
      return {
        kind: "refused",
        code: "ATR-401",
        message: `${toolName} 审批句柄已被使用（nonce 一次性台账）：重放拒绝`,
        fix: `重新调用 ${toolName}（不带 _approval）获取新 requestState，再由人工决定 approve / deny`,
      };
    }
    if (nonce) consumedNonces.add(nonce);
    return { kind: "execute" };
  }
  if (decision === "deny") {
    const nonce = String(check.payload.n ?? "");
    if (nonce) consumedNonces.add(nonce); // deny 同样消费句柄——同一句柄不能先拒后批
    return {
      kind: "refused",
      code: "ATR-402",
      message: `${toolName} 被人工审批拒绝（decision = deny）`,
      fix: "尊重人工决定；如需该操作请向用户说明理由后再次请求审批",
    };
  }
  return {
    kind: "refused",
    code: "ATR-401",
    message: `${toolName} 审批决定非法：decision 必须是 "approve" 或 "deny"，收到 ${JSON.stringify(decision)}`,
    fix: '以 _approval: { requestState, decision: "approve" | "deny" } 重新提交',
  };
}

/** 审批动作入审计（audit 既有面：.atelier/audit.jsonl，与 dev 面同格式；审计绝不破坏主流程） */
export function auditApproval(projectRoot, detail) {
  try {
    const file = path2join(String(projectRoot ?? ""), ".atelier", "audit.jsonl");
    fs.mkdirSync(path2join(String(projectRoot ?? ""), ".atelier"), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ kind: "mcp.approval", detail, at: new Date().toISOString() }) + "\n");
  } catch { /* audit must never break the tool call */ }
}
