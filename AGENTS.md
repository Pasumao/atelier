# Atelier 工作区说明

> 本文档由 dsh-plugin-agents-gen 生成，可手动编辑。

## 项目概述

本工作区即 **Atelier 框架仓库**：为 AI 编程代理设计的前端框架。2026-08 整理后，仓库只保留框架本体与 AI 工具链（MCP / Skills / CLI 全部集成在 `atelier/` 框架目录内部，与前端运行时零代码耦合）；历史调研素材（`research/`、两份调研报告、根目录杂图）已删除，可在 git 锚点 `4c1d450`（重构前 checkpoint）恢复。

## 目录结构

| 目录 / 文件 | 说明 |
|---|---|
| `atelier/` | **框架本体（framework home）**。`runtime/` 零依赖运行时内核（core.ts 信号引擎 / template.ts 模板解释器 / expr.ts 表达式求值 / contract.ts 契约校验 / component.ts 注册表 / primitives.ts 三态原语 / bridge.ts dev 状态桥 / index.ts 桶出口）；`mcp/` stdio MCP Server（21 工具单源生成，13 live）；`skills/` 多工具兼容技能包（8 个 kebab-case 目录包）；`scripts/` + `cli.mjs` 工具链（init/dev/struct/checkpoint/snapshot/mcp，三级诚实标注）；`templates/` AGENTS.md/llms.txt 模板；`docs/` 框架规格文档（ARCHITECTURE/SPEC/design-decisions 0-16/BACKLOG/SKILLS-PLAN/TECH-* 等，含原根目录 design-decisions.md）。 |
| `prototype/` | 演示应用 & 脚手架 starter（Vite dev）。`src/runtime/` 是 `atelier/runtime` 的**供应商拷贝**（自包含；改框架先改 `atelier/runtime`，再整拷同步，`tests/runtime-sync.test.ts` 守卫字节一致）；`src/components/` 演示组件（.atr.ts，import `../runtime` 不感知拷贝）；`tests/` 34 用例；dev 面 `/__atelier/*`（token 门禁/审计/SSE 命令下行/截图）。 |
| `.dsh/skills/` | 本会话已安装的技能副本（harness 发现目录，勿手改；源在 `atelier/skills/`）。 |

## 常用命令

<!-- 框架与原型工作流 -->

| 场景 | 命令 |
|---|---|
| 启动原型 dev server | 在 `prototype/` 下 `pnpm dev`（http://127.0.0.1:5173，strictPort） |
| 跑框架/原型测试 | 在 `prototype/` 下 `pnpm test`（vitest；含 runtime 供应商拷贝同步守卫） |
| 同步框架 runtime 到 demo | `Copy-Item atelier/runtime/*.ts prototype/src/runtime/`（改完框架侧必做，测试会拦不一致） |
| 技能包一致性校验 | `node atelier/scripts/check-skills.mjs`（exit code 可接 CI；改动 skills/mcp-definitions 后必跑） |
| 一键安装技能到项目 | `node atelier/cli.mjs skills install --target <dir> --name <Name>`（双落点 + 模板渲染 + specs 骨架，幂等） |
| 脚手架新应用 | `node atelier/cli.mjs init --target <dir> --name <Name>`（prototype starter 全拷 + agent 层；cd && pnpm install && pnpm dev 即跑） |
| 结构地图/结构检查 | `node atelier/cli.mjs struct map` / `check`（六层 OK-WARN-ERROR 分级；亦可用 MCP `structure.map` 本地计算） |
| 视觉回归快照 | `node atelier/cli.mjs snapshot save` / `check [--update]`（经 dev 面 `/__atelier/screenshot`；绝不自动晋升） |
| 读中文 UTF-8 文件 | PowerShell 一律 `Get-Content -Encoding UTF8`（默认 ANSI 会把 em dash 显示成乱码，文件未必真坏） |
| 源码 checkpoint（决策 15） | `node atelier/cli.mjs checkpoint save "<名称>"` / `list` / `rollback <id>`（首次 save 自动 git init；改代码前先看时间线） |

## 维护纪律

- 框架 runtime 只改 `atelier/runtime/`，随后整拷同步 `prototype/src/runtime/`（`pnpm test` 会拦不一致）；脚手架应用天然自包含，不回写框架。
- MCP 工具/命令/错误码三处同步：CLI 表（cli.mjs HELP）/ `atelier/mcp/mcp-definitions.json` / 对应 skill；改后必跑 `node atelier/scripts/check-skills.mjs`。
- 框架规格文档唯一源在 `atelier/docs/`（SPEC/ARCHITECTURE/design-decisions）；缺口与改进队列 = `atelier/docs/BACKLOG.md`。
- 所有"未确认"结论必须明确标注，不得写成事实；删除文件前先 `checkpoint save`（git 可恢复）。
