/**
 * mcp-confirm.test.ts — 决策 15 confirm 三档闸门的单元验收（mcp/confirm.mjs 纯函数）。
 * 对应 specs/guardrails.md 的 deny 负例场景（init 常驻规格）。
 * FS-M6（§10.2）：ask 档从「暂同 auto」诚实边界升级为多轮审批原语
 * （InputRequiredResult + requestState，SEP-2322 对齐）——审批 verdict 单元在此验收。
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { confirmGate, readAgentConfig, approvalSecret } from "../mcp/confirm.mjs";
const confirmMjs = (await import("../mcp/confirm.mjs")) as any;
const { approvalVerdict, createRequestState, verifyRequestState, isAskGated } = confirmMjs;

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DESTRUCTIVE = ["checkpoint.rollback", "state.time_travel", "checkpoint.source_rollback"];
const NON_DESTRUCTIVE = ["state.snapshot", "test.run", "structure.check", "checkpoint.source_commit", "checkpoint.list"];

describe("confirmGate (decision 15 — auto/ask/deny tiers)", () => {
  it("deny 档：三个破坏性工具全部 ATR-402 拒绝，fix 可行动", () => {
    for (const tool of DESTRUCTIVE) {
      const d = confirmGate({ confirm: "deny" }, tool);
      expect(d, tool).not.toBeNull();
      expect(d!.code).toBe("ATR-402");
      expect(d!.message).toContain(tool);
      expect(d!.fix).toContain("atelier.config.json");
    }
  });

  it("deny 档：非破坏性工具不受影响", () => {
    for (const tool of NON_DESTRUCTIVE) {
      expect(confirmGate({ confirm: "deny" }, tool)).toBeNull();
    }
  });

  it("auto / 缺省 / ask / 空 agent 段：confirmGate 墙只拦 deny——ask 的多轮审批在 approvalVerdict 收口（不再暂同 auto）", () => {
    for (const cfg of [{ confirm: "auto" }, {}, undefined, { confirm: "ask" }]) {
      for (const tool of DESTRUCTIVE) {
        expect(confirmGate(cfg as never, tool), `${tool} × ${JSON.stringify(cfg)}`).toBeNull();
      }
    }
  });

  it("未知档位 fail-closed（R3 收口，评审 §4.2）：受闸工具不再静默放行——ATR-402 + fix 指路合法档位（红态：返回 null 放行）", () => {
    for (const tier of ["yolo", "ask ", "Ask", "AUTO"]) {
      const d = confirmGate({ confirm: tier }, "checkpoint.rollback");
      expect(d, `tier=${JSON.stringify(tier)}`).not.toBeNull(); // 红态：null——拼错档位静默放行破坏性工具
      expect(d!.code).toBe("ATR-402");
      expect(d!.fix).toContain("auto");
      expect(d!.fix).toContain("deny");
    }
    // 非受闸工具不受影响（闸只辖破坏性/操作族）
    expect(confirmGate({ confirm: "yolo" }, "state.snapshot")).toBeNull();
  });
});

describe("readAgentConfig", () => {
  it("缺文件/坏 JSON → 空 agent 段（降级 auto，不放大也不误伤）", () => {
    expect(readAgentConfig("/nonexistent-root-xyz")).toEqual({});
  });

  it("读取真实模板应用配置的 agent 段（templates/app 的 agent.confirm=auto）", () => {
    const cfg = readAgentConfig(path.resolve(HERE, "..", "templates", "app"));
    expect(cfg.confirm).toBe("auto");
  });
});

/* ---------- FS-M6②：ask 档多轮审批原语（SEP-2322 InputRequiredResult + requestState） ---------- */

const SECRET = "confirm-test-secret";

describe("isAskGated（受闸面 = 破坏性族 ∪ 操作族）", () => {
  it("破坏性与操作面工具受闸；查询/审计面不受闸", () => {
    for (const tool of [...DESTRUCTIVE, "endpoint.call"]) expect(isAskGated(tool)).toBe(true);
    for (const tool of NON_DESTRUCTIVE) expect(isAskGated(tool)).toBe(false);
    expect(isAskGated("no.such_tool")).toBe(false);
  });
});

describe("requestState 句柄（HMAC 签名显式句柄——无服务端会话态，任意实例可续）", () => {
  it("创建/校验往返：tool+args 绑定，exp 生效", () => {
    const now = 1_000_000;
    const token = createRequestState({ tool: "checkpoint.rollback", args: { id: "cp-9" }, secret: SECRET, now, ttlMs: 60_000 });
    expect(token.startsWith("v1.")).toBe(true);
    const ok = verifyRequestState({ requestState: token, tool: "checkpoint.rollback", args: { id: "cp-9" }, secret: SECRET, now: now + 1 });
    expect(ok.ok).toBe(true);
  });

  it("误用五连：过期 / 密钥不符 / 工具不符 / 参数漂移 / 形态损坏 → ok:false + 分型 reason", () => {
    const now = 1_000_000;
    const token = createRequestState({ tool: "checkpoint.rollback", args: { id: "cp-9" }, secret: SECRET, now, ttlMs: 60_000 });
    expect(verifyRequestState({ requestState: token, tool: "checkpoint.rollback", args: { id: "cp-9" }, secret: SECRET, now: now + 60_001 })).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyRequestState({ requestState: token, tool: "checkpoint.rollback", args: { id: "cp-9" }, secret: "other", now })).toMatchObject({ ok: false, reason: "bad-signature" });
    expect(verifyRequestState({ requestState: token, tool: "state.time_travel", args: { id: "cp-9" }, secret: SECRET, now })).toMatchObject({ ok: false, reason: "tool-mismatch" });
    expect(verifyRequestState({ requestState: token, tool: "checkpoint.rollback", args: { id: "cp-10" }, secret: SECRET, now })).toMatchObject({ ok: false, reason: "args-changed" });
    expect(verifyRequestState({ requestState: "not-a-handle", tool: "checkpoint.rollback", args: { id: "cp-9" }, secret: SECRET, now })).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("_approval 键不参与参数绑定（二次提交时它在 args 里，但句柄校验剥离它）", () => {
    const now = 1_000_000;
    const token = createRequestState({ tool: "endpoint.call", args: { name: "chat.ask", input: { msg: "m" } }, secret: SECRET, now });
    const ok = verifyRequestState({
      requestState: token, tool: "endpoint.call", secret: SECRET, now,
      args: { name: "chat.ask", input: { msg: "m" }, _approval: { requestState: token, decision: "approve" } },
    });
    expect(ok.ok).toBe(true);
  });
});

describe("approvalVerdict（ask 档多轮审批的单一判定点）", () => {
  const GATED = "checkpoint.source_rollback";

  it("auto / 缺省 → allow（既有行为零变化）；deny 档 → deny（沿用 confirmGate 同文同 fix）", () => {
    expect(approvalVerdict({ confirm: "auto" }, GATED, {}, { secret: SECRET })).toMatchObject({ kind: "allow" });
    expect(approvalVerdict(undefined, GATED, {}, { secret: SECRET })).toMatchObject({ kind: "allow" });
    const deny = approvalVerdict({ confirm: "deny" }, GATED, {}, { secret: SECRET });
    expect(deny.kind).toBe("deny");
    expect(deny).toEqual({ ...confirmGate({ confirm: "deny" }, GATED, {})!, kind: "deny" });
  });

  it("ask + 受闸 + 无审批 → inputRequired（携 requestState + 人可读上下文），不执行", () => {
    const v = approvalVerdict({ confirm: "ask" }, GATED, { id: "cp-1" }, { secret: SECRET });
    expect(v.kind).toBe("inputRequired");
    expect(v.requestState.startsWith("v1.")).toBe(true);
    expect(v.message).toContain(GATED);
    expect(v.expiresAt).toBeGreaterThan(0);
  });

  it("ask + approve 有效句柄 → execute；同句柄重放 → refused ATR-401（R3 nonce 一次性台账——红态：重放再次 execute）；deny 决定 → refused(ATR-402)；坏句柄 → refused(ATR-401)", () => {
    const now = 2_000_000;
    const token = createRequestState({ tool: GATED, args: { id: "cp-1" }, secret: SECRET, now });
    const execute = approvalVerdict({ confirm: "ask" }, GATED, { id: "cp-1", _approval: { requestState: token, decision: "approve" } }, { secret: SECRET, now });
    expect(execute.kind).toBe("execute");
    const replay = approvalVerdict({ confirm: "ask" }, GATED, { id: "cp-1", _approval: { requestState: token, decision: "approve" } }, { secret: SECRET, now });
    expect(replay.kind).toBe("refused"); // 红态：execute——TTL 内同一 approve 句柄可无限重放（一次审批→N 次回滚）
    expect(replay.code).toBe("ATR-401");
    expect(replay.message).toContain("一次性");
    const denyToken = createRequestState({ tool: GATED, args: { id: "cp-1" }, secret: SECRET, now });
    const refused = approvalVerdict({ confirm: "ask" }, GATED, { id: "cp-1", _approval: { requestState: denyToken, decision: "deny" } }, { secret: SECRET, now });
    expect(refused.kind).toBe("refused");
    expect(refused.code).toBe("ATR-402");
    const bad = approvalVerdict({ confirm: "ask" }, GATED, { id: "cp-1", _approval: { requestState: "v1.xx.yy", decision: "approve" } }, { secret: SECRET, now });
    expect(bad.kind).toBe("refused");
    expect(bad.code).toBe("ATR-401");
  });

  it("未知档位 fail-closed（R3 收口，评审 §4.2）：受闸工具 refused ATR-402 且 fix 指路合法档位；非受闸工具不受扰（红态：放行/默认 auto 语义）", () => {
    for (const tier of ["ask ", "Ask", "yolo"]) {
      const v = approvalVerdict({ confirm: tier }, GATED, { id: "cp-1" }, { secret: SECRET });
      expect(v.kind, `tier=${JSON.stringify(tier)}`).toBe("refused"); // 红态："allow"——"ask " 尾空格静默放行破坏性工具
      expect(v.code).toBe("ATR-402");
      expect(v.fix).toContain("ask");
    }
    expect(approvalVerdict({ confirm: "yolo" }, "state.snapshot", {}, { secret: SECRET })).toMatchObject({ kind: "allow" });
  });
});

describe("approvalSecret（R3 收口：审批密钥与 dev-token 分离——评审 §4.2：能读 dev-token 的客户端可自行伪造 requestState 自批）", () => {
  it("首用生成 .atelier/approval-secret（独立于 dev-token），读取稳定；句柄跨实例可续（同一文件密钥）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-approval-secret-"));
    try {
      fs.mkdirSync(path.join(root, ".atelier"), { recursive: true });
      fs.writeFileSync(path.join(root, ".atelier", "dev-token"), "readable-dev-token-value", "utf8");
      const first = approvalSecret(root);
      expect(first).toBeTruthy();
      expect(first).not.toBe("readable-dev-token-value"); // 红态：返回 dev-token 原值——持 token 方可自批
      expect(first.length).toBeGreaterThanOrEqual(64); // 32 字节 hex——非平凡弱值
      const onDisk = fs.readFileSync(path.join(root, ".atelier", "approval-secret"), "utf8").trim();
      expect(onDisk).toBe(first); // 落盘即真相——跨进程/跨通道同钥
      expect(approvalSecret(root)).toBe(first); // 二次读取稳定
      // 旧 dev-token 密钥签的句柄不再通过（密钥分离的语义代价，dev 时点工具可接受）
      const legacy = createRequestState({ tool: "checkpoint.rollback", args: { id: "x" }, secret: "readable-dev-token-value" });
      const fresh = createRequestState({ tool: "checkpoint.rollback", args: { id: "x" }, secret: first });
      expect(verifyRequestState({ requestState: fresh, tool: "checkpoint.rollback", args: { id: "x" }, secret: first }).ok).toBe(true);
      expect(verifyRequestState({ requestState: legacy, tool: "checkpoint.rollback", args: { id: "x" }, secret: first }).ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
