/**
 * mcp-confirm.test.ts — 决策 15 confirm 三档闸门的单元验收（mcp/confirm.mjs 纯函数）。
 * 对应 specs/guardrails.md 的 deny 负例场景（init 常驻规格）。
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmGate, readAgentConfig } from "../mcp/confirm.mjs";

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

  it("auto / 缺省 / ask / 空 agent 段：破坏性工具放行（ask 档诚实边界=暂同 auto）", () => {
    for (const cfg of [{ confirm: "auto" }, {}, undefined, { confirm: "ask" }]) {
      for (const tool of DESTRUCTIVE) {
        expect(confirmGate(cfg as never, tool), `${tool} × ${JSON.stringify(cfg)}`).toBeNull();
      }
    }
  });

  it("未知档位值按缺省 auto 处理（不误伤），但可被 deny 之外值放行", () => {
    expect(confirmGate({ confirm: "yolo" }, "checkpoint.rollback")).toBeNull();
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
