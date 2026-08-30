/**
 * confirm.mjs — MCP 操作面 confirm 三档（决策 15：auto / ask / deny）的单一执行点。
 *
 * 配置：atelier.config.json → agent.confirm（缺省 auto）。
 * 破坏性操作（状态回滚族）必须过闸：deny 档以 ATR-402 结构化拒绝，auto 放行。
 * 诚实边界：ask 档当前与 auto 同效——stdio MCP 无人工审批通道，审批面接线属后续
 * （skills 已如实标注 ATR-402 的适用面）；本模块把语义收口在一处，接审批面时只改这里。
 */
import fs from "node:fs";

/** 破坏性操作清单（回滚族——丢弃当前状态/回退文件树） */
const DESTRUCTIVE_TOOLS = new Set([
  "checkpoint.rollback", // 应用状态回滚（dev 面执行）
  "state.time_travel", // 信号时间旅行（dev 面执行）
  "checkpoint.source_rollback", // 源码文件树回滚（决策 15）
]);

/** 读取应用配置的 agent 段；缺文件/坏 JSON 一律降级为 auto（不因配置问题放大权限，也不误伤） */
export function readAgentConfig(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(`${projectRoot}/atelier.config.json`, "utf8")).agent ?? {};
  } catch {
    return {};
  }
}

/**
 * 闸门：破坏性工具 × confirm 档 → null（放行）或 { code, message, fix }（拒绝）。
 * 纯函数，无 IO——MCP server 调用前先 readAgentConfig；测试直接喂配置。
 */
export function confirmGate(agentConfig, toolName) {
  if (!DESTRUCTIVE_TOOLS.has(toolName)) return null;
  const tier = agentConfig?.confirm ?? "auto";
  if (tier === "deny") {
    return {
      code: "ATR-402",
      message: `agent.confirm = deny：拒绝执行破坏性操作 ${toolName}`,
      fix: "由人工在 CLI 执行回滚（atelier checkpoint rollback / atelier cli checkpoint），或经用户确认后把 atelier.config.json 的 agent.confirm 调为 auto / ask",
    };
  }
  return null; // auto 放行；ask 档暂同 auto（诚实边界，见文件头）
}
