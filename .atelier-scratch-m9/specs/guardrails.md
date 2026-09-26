# Guardrails — 破坏性操作与 confirm 三档（决策 15）

> 常驻负例规格（human-owned）。执行锚点：框架测试 tests/mcp-confirm.test.ts + MCP stdio E2E。

## 场景：agent.confirm = deny 时破坏性操作被拒（负例）
- **Given** atelier.config.json 设置 `"agent": { "confirm": "deny" }`
- **When** agent 经 MCP 调用 checkpoint.rollback / state.time_travel / checkpoint.source_rollback
- **Then** 服务器返回结构化错误 **ATR-402**（isError=true），消息含工具名与档位说明；
  fix 指向"人工 CLI 执行或用户确认后调档"；
- **And** 非破坏性工具（state.snapshot / test.run / structure.check …）不受 deny 影响。

## 场景：confirm 缺省 = auto
- **Given** 配置缺 agent 段或文件缺失
- **When** 调用破坏性工具
- **Then** 正常执行（auto 档），并写审计日志。

## 诚实边界
- `ask` 档当前与 auto 同效（stdio 无人工审批通道，审批面接线属后续）——变更前请人工盯守。
