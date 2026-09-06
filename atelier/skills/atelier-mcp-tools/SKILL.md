---
name: atelier-mcp-tools
description: Atelier built-in tool surface. Query / operation / audit faces, command-to-tool mapping, confirm tiers, audit logging, flat-schema params. Load when you need to inspect or change framework state.
---

# Built-in Tool Surface (MCP, in-process with `atelier dev`)

## Three faces (never mix privileges)

| Face | Tools | Power |
|---|---|---|
| **Query (read-only)** | `structure.map` · `structure.check` · `graph.static` · `registry.list_components` · `registry.get_component` · `tokens.list` · `state.snapshot` · `state.get` · `state.graph` · `state.journal` · `ui.screenshot` · `ui.a11y` · `docs.search` | inspect only — `structure.*`/`graph.static` computed server-locally, no dev server needed |
| **Operation** | `checkpoint.list` · `checkpoint.rollback` · `checkpoint.source_list` · `checkpoint.source_commit` · `checkpoint.source_rollback` · `state.time_travel` · `test.run` · `snapshot.diff` · `snapshot.review_diff` · `diff.report` | changes state; **audit-logged**, confirm tier applies |
| **Audit** | `audit.log` · `feedback.read` | read side effects + human feedback |

## Command ↔ tool mapping (use the tool when the CLI is not enough)

| CLI | MCP tool |
|---|---|
| `atelier dev` (start) | (tools become available) |
| `atelier test` | `test.run` |
| `atelier snapshot` | `snapshot.diff` / `snapshot.review_diff` |
| `atelier review` | `diff.report` + `feedback.read` |
| rollback (any) | `checkpoint.rollback` / `checkpoint.source_rollback` |
| `atelier checkpoint save` | `checkpoint.source_commit` (same code path — 未检不锚 snapshot gate applies; `--no-gate` escape hatch is CLI-only) |

## Confirm tiers & audit (decision 12)

- `atelier.config.json → agent.confirm`: `auto` (AI may auto-rollback, default) | `ask` | `deny`
- Destructive ops (rollback/source_rollback) always: confirm tier + audit-log entry
- dev/MCP binds 127.0.0.1 only + one-time token (`requireToken`)

## Params = flat schema (decision 6)

Tools accept **flat** schemas (no `$ref`/`oneOf`) — identical to component contracts. If a tool's `fix`/schema is unfamiliar, query `docs.search` instead of guessing.

## Wire notes (v0.2 — 全部 25 工具已接线)

- `state.get`：path = `sig-<n>[.子路径]`（信号按安装序编号，无 debugName——bridge 已知边界）；拿不准先 `state.snapshot` 看全貌。
- `state.graph`：活依赖图——signals（sig-N 键+kind）与每条 effect 依赖边；sig-N 与 `state.snapshot.signals` 同一键空间；适合改代码前判断"动哪个信号会影响哪些 effect"。
- `graph.static`：构建期静态依赖图（F-2/决策 3）——每组件 reactive/mount/events 标识符桶，读 stage ② dump 即得（**不跑应用、不需要 dev face**；前置 `atelier compile --root <appDir>` 生成 .atr/ast）；与 `state.graph` 互补：静态图=改代码前的影响面速查，活图=运行时真实依赖。诚实边界：语法级引用集 ⊇ 运行时追踪集（含未执行分支）。
- `state.journal`：$state 变更事件日志（时间升序，sig/from/to）——`state.snapshot` 推送只带最近 50 条，本工具可 `lines` 取更深（≤500）；"谁改了 sig-2"从这里查。
- `ui.a11y`：无障碍树缩进文本（role/name/value）——检视界面语义优先于像素（Playwright MCP 同款结论）；`ATELIER_TOOLSETS=query` 可按 face 只暴露子集工具。
- `agent-health` 端点（`/__atelier/agent-health`，token 门内）：连接 UA 分类台账（human/headless/tooling）+ 最近错误——"页面上是谁在操作"从这里看；UA 启发式面向检视不面向鉴权。
- MCP 错误为结构化四段：`isError=true` + `structuredContent{code,message,fix}`，文本形态不变（`\nfix: ...`）——两种消费方式任选。
- `docs.search`：语料 = 框架 `atelier/docs/` + skill 包 + 工作区 `AGENTS.md` + 应用 `llms.txt`；返回 top-5 带摘录。
- `test.run`：跑应用 `pnpm test`（vitest run 同一表面），180s 上限；`filter` 是 vitest 文件名过滤（禁 shell 元字符）。
- `diff.report`：基线 = 最近一条 source checkpoint；产出 `.atelier` 下的 diff-report.md（文件级事实）——提交评审时由 agent 附上每处改动的语义摘要，结论等 `feedback.read`。
- `feedback.read`：读 specs/ 下的人类反馈；**下一轮开工前必读**。落盘约定：

```text
specs/feedback.jsonl      # 每条判定一行 JSON：{at, verdict: "approve"|"disapprove", target, note}
specs/<name>.feedback.md  # 自由格式 markdown，原文返回
```

## Common failures

| Symptom | Fix |
|---|---|
| `ATR-402` permission denied | Check `agent.confirm` tier; ask human to raise to auto for this op, or perform via CLI with approval |
| Registry missing component | Component file not imported/registered (`opts.name` mismatch — pass `name` explicitly) |
| Diff can't be reviewed | Use `snapshot.review_diff` (image + baseline), review before `--update` |
