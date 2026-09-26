---
name: atelier-mcp-tools
description: Atelier built-in tool surface. Query / operation / audit faces, command-to-tool mapping, confirm tiers, audit logging, flat-schema params. Load when you need to inspect or change framework state.
---

# Built-in Tool Surface (MCP, in-process with `atelier dev`)

## Four face groups (never mix privileges)

| Face | Tools | Power |
|---|---|---|
| **Query (read-only)** | `structure.map` · `structure.check` · `graph.static` · `registry.list_components` · `registry.get_component` · `tokens.list` · `state.snapshot` · `state.get` · `state.graph` · `state.journal` · `ui.screenshot` · `ui.a11y` · `docs.search` · `tasks.get` | inspect only — `structure.*`/`graph.static` computed server-locally, no dev server needed |
| **Query (server face)** | `endpoint.list` · `endpoint.contract` · `endpoint.impact` · `db.schema` · `db.migrations` · `server.introspect` | inspect the full-stack surface — served from the app dev face `server-status`; `endpoint.impact` is static (no dev face) |
| **Operation** | `checkpoint.list` · `checkpoint.rollback` · `checkpoint.source_list` · `checkpoint.source_commit` · `checkpoint.source_rollback` · `state.time_travel` · `test.run` · `snapshot.diff` · `snapshot.review_diff` · `diff.report` · `endpoint.call` · `tasks.update` · `tasks.cancel` | changes state; **audit-logged**, confirm tier applies |
| **Audit** | `audit.log` · `feedback.read` · `endpoint.journal` | read side effects + human feedback |

## Command ↔ tool mapping (use the tool when the CLI is not enough)

| CLI | MCP tool |
|---|---|
| `atelier dev` (start) | (tools become available) |
| `atelier test` | `test.run` |
| `atelier snapshot` | `snapshot.diff` / `snapshot.review_diff` |
| `atelier review` | `diff.report` + `feedback.read` |
| rollback (any) | `checkpoint.rollback` / `checkpoint.source_rollback` |
| `atelier checkpoint save` | `checkpoint.source_commit` (same code path — 未检不锚 snapshot gate applies; `--no-gate` escape hatch is CLI-only) |
| `atelier impact <contractKey>` | `endpoint.impact` (same engine — two-hop static chain) |
| `atelier migrate status` | `db.migrations` |

## Confirm tiers & audit (decision 12 + FS-M6 multi-round approval)

- `atelier.config.json → agent.confirm`: `auto` (AI may auto-rollback, default) | `ask` | `deny`
- Destructive ops (rollback family) + `endpoint.call` always: confirm tier + audit-log entry (`mcp.approval` lines in the app audit journal under `.atelier/`)
- `ask` = real approval round (MCP 2026-07-28 `InputRequiredResult` + `requestState`): first response does NOT execute — it returns a requestState handle; resubmit the SAME args plus `_approval: { requestState, decision: "approve" | "deny" }`; deny/bad/expired handle = deterministic refusal (ATR-402 / ATR-401), never executed
- `deny` tier = ATR-402 structured refusal before anything runs
- dev/MCP binds 127.0.0.1 only + one-time token (`requireToken`)

## Params = flat schema (decision 6)

Tools accept **flat** schemas (no `$ref`/`oneOf`) — identical to component contracts. If a tool's `fix`/schema is unfamiliar, query `docs.search` instead of guessing.

## Wire notes (v0.4 — 36 tools defined; the server-face 8 consume the app dev face `server-status`)

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

## Server-face tools (FS-6, FS-DESIGN §10.1 — 超集对表 Next `/_next/mcp`)

- `endpoint.list`：端点注册表摘要（name/kind/live+失效键/emits/auth/timeout/idempotent）——路由枚举先查表不猜路径；schema 体归 `endpoint.contract`（token 纪律）。
- `endpoint.contract`：输入/输出 FlatSchema 原样直读；可选 `target: "draft-2020-12" | "openapi-3.0"` 走编译器单管线投影成 JSON Schema（§2.4 三消费同源）——扁平语义之外 ATR-107，绝不静默降级。
- `endpoint.impact`：契约 → 端点 → 前端调用点两跳静态链（§2.5，与 CLI 同引擎）；导航报告不阻断；**不依赖 dev face**。
- `db.schema`（表/列/索引，可按 `table` 聚焦）/ `db.migrations`（head/applied/pending——不可逆 down 仍是人工 CLI `--force`）/ `server.introspect`（server 摘要 + live 订阅 + journal 尾部）。
- `endpoint.journal`：command 审计（成功与失败同源呈现）——"代理改了什么、砸了什么"从这里查。
- `endpoint.call`：POST `<mount|/api>/<name>` JSON 体；响应体/状态/耗时返回，端点级 ATR 错误原样留在 body 作数据（不吞）；confirm=ask 时走多轮审批（见上节——首轮 inputRequired + requestState，二次提交 `_approval`）。
- live 组在 dev face 不在时返回四段式结构化错误（fix 指路应用目录 `pnpm dev`），绝不静默空结果。
- 长任务口径（`src/server/jobs/README.md` 同源）：**v1 无内建队列**——command 内联执行，长任务的 command 必须声明 `timeoutMs`（超时 ATR-322；handler 监听 `ctx.signal` 提前退出）；需要异步推进就拆多个 command 分步调用，不在 handler 里挂住等待。

## Stateless HTTP direct connect + Tasks (FS-M6, MCP 2026-07-28 对齐)

- dev 面 `POST /__atelier/mcp`：无状态 HTTP 直连——`Mcp-Method`/`Mcp-Name` 头路由，无握手无会话（版本走 `_meta`，应答 `2026-07-28`）；与 stdio 同一工具核心同果。方法：`tools/list · tools/call · tasks/get|update|cancel · ping · server/discover`（initialize/notifications/tasks/list 已随 2026-07-28 移除，诚实 4xx）。
- Vendored apps（FS-M7）：`atelier init`/`atelier sync` 已 vendor 整棵 import 闭包（`mcp/` 五件 + `mcp-definitions.json` + `scripts/struct.mjs` + `gen/impact.mjs` + `gen/gen-endpoint.mjs` + `compiler/project-json.mjs`）——init/sync 后应用内直连可用；未 sync 的旧应用 503 诚实指路 stdio（fix 文案给可执行的 sync 命令）。
- Tasks 扩展（服务端主导创建）：HTTP 通道调长操作（`structure.check`/`test.run`）→ 返回 `task.taskId` 句柄而非内联结果；`tasks/get` 轮询至 completed/failed/cancelled，`tasks.update` 收紧保留窗（ttlMs），`tasks.cancel` 取消。句柄只在创建实例可解析（dev 面单实例）；过期 ATR-401 = 重跑该工具。

## Common failures

| Symptom | Fix |
|---|---|
| `ATR-402` permission denied | confirm=deny tier or human said no — ask the user; do not retry the same call |
| Result carries `inputRequired` + `requestState` | confirm=ask approval round: get human approve/deny, then resubmit SAME args + `_approval: { requestState, decision }` |
| `ATR-401` on `_approval` resubmit | handle expired (5 min) / args drifted / tampered — rerun without `_approval` to mint a fresh requestState |
| Registry missing component | Component file not imported/registered (`opts.name` mismatch — pass `name` explicitly) |
| Diff can't be reviewed | Use `snapshot.review_diff` (image + baseline), review before `--update` |
| `ATR-4xx-dev` dev surface unreachable | Start the app dev server (`pnpm dev` in the app dir) or set `ATELIER_DEV_URL` |
