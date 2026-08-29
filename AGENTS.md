# Atelier 工作区说明

> 本文档由 dsh-plugin-agents-gen 生成，可手动编辑。

## 项目概述

本工作区即 **Atelier 框架仓库**：为 AI 编程代理设计的前端框架。`atelier/` 是自足的框架本体——零依赖 runtime 内核、dev 面插件、应用模板、测试与 AI 工具链（MCP/Skills/CLI）全部集成于框架目录内部，与前端运行时零代码耦合。2026-08 整理：原 `prototype/` 已吸收进框架（dev 面 → `atelier/dev/`，runtime 测试 → `atelier/tests/`，应用骨架 → `atelier/templates/app/`）后删除；更早的调研素材可回溯 git 锚点 `4c1d450`。

## 目录结构

| 目录 / 文件 | 说明 |
|---|---|
| `atelier/runtime/` | 零依赖运行时内核（真相源）：core.ts 信号引擎 / template.ts 模板解释器 / expr.ts 表达式求值 / contract.ts 契约校验 / component.ts 注册表 / primitives.ts 三态原语 / bridge.ts dev 状态桥 / index.ts 桶出口。 |
| `atelier/compiler/` | 编译器（P0-2）：`dump.mjs`（②：.atr.ts → 模板 AST JSON，与解释器同一解析器）+ `codegen.mjs`（③：AST → 零 import 静态 effect 图模块）。产物经 `registerCompiled` 注册后该组件走零 tokenize 快路径（语义与解释器同源，golden DOM diff 在 tests/codegen.test.ts）。 |
| `atelier/dev/` | dev 面框架件：`atelier-dev-plugin.mjs`（Vite 插件，/__atelier/* 查询/桥接/审计/token 门禁/SSE 下行）、`dev-screenshot.mjs`（CDP 无头截图）、`gen-tailwind-theme.mjs`（决策 16 token→@theme AOT）、`probe-mount.mjs`（挂载诊断探针，PROBE_URL 可换目标）。init 时 vendor 进应用 `scripts/`。 |
| `atelier/tests/` | runtime 单测（vitest，39 用例，含 codegen golden DOM 对拍）。 |
| `atelier/templates/app/` | 应用 starter 模板：vite.config / index.html / atelier.config.json（token SSOT）/ src/main.ts + HelloCard 三元共置示例（.atr.ts + .atr.md + .atr.spec.ts）/ manifest.json / llms.txt / atelier-ui.css recipe / styling-discipline 守卫测试。`atelier init` 以此组装自包含应用。 |
| `atelier/mcp/` | stdio MCP Server（21 工具单源生成，live 工具需一个运行中的应用 dev 面）。 |
| `atelier/skills/` | 多工具兼容技能包（8 个 kebab-case 目录包）。 |
| `atelier/scripts/` + `cli.mjs` | init（三步组装：模板 + runtime vendor + dev vendor）/ dev / struct / checkpoint / snapshot / skills / mcp，三级诚实标注。 |
| `atelier/docs/` | 框架规格文档：ARCHITECTURE / SPEC / design-decisions 0-16 / BACKLOG / SKILLS-PLAN / TECH-*。 |
| `.dsh/skills/` | 本会话已安装的技能副本（harness 发现目录；源在 `atelier/skills/`）。 |

## 常用命令

| 场景 | 命令 |
|---|---|
| 脚手架新应用 | `node atelier/cli.mjs init --target <dir> --name <Name>`（cd && pnpm install && pnpm dev 即跑） |
| 启动应用 dev server | 应用目录下 `pnpm dev`（或 `atelier dev`；http://127.0.0.1:5173，strictPort） |
| 框架 runtime 测试 | `atelier/` 目录下 `pnpm test`（vitest，39 用例） |
| 编译应用组件（②→③） | `node atelier/compiler/dump.mjs --root <appDir>` 然后 `node atelier/compiler/codegen.mjs --ast <appDir>/.atr/ast`（产物 .atr/compiled/<Component>.mjs，应用侧 registerCompiled 接入） |
| 应用测试（契约/样式守卫） | 应用目录下 `pnpm test` |
| 技能包一致性校验 | `node atelier/scripts/check-skills.mjs`（exit code 可接 CI；改动 skills/mcp-definitions 后必跑） |
| 一键安装技能到项目 | `node atelier/cli.mjs skills install --target <dir> --name <Name>`（双落点 + 模板渲染 + specs 骨架，幂等） |
| 结构地图/结构检查 | `node atelier/cli.mjs struct map` / `check`（六层 OK-WARN-ERROR 分级；在应用目录跑） |
| 视觉回归快照 | 应用目录下 `node <repo>/atelier/cli.mjs snapshot save` / `check [--update]`（绝不自动晋升） |
| MCP server | `node atelier/mcp/server.mjs`（env：`ATELIER_PROJECT_ROOT`=应用目录，`ATELIER_DEV_URL`=应用 dev 面） |
| 读中文 UTF-8 文件 | PowerShell 一律 `Get-Content -Encoding UTF8`（默认 ANSI 会把 em dash 显示成乱码，文件未必真坏） |
| 源码 checkpoint（决策 15） | `node atelier/cli.mjs checkpoint save "<名称>"` / `list` / `rollback <id>`（改代码前先看时间线） |

## 维护纪律

- 框架 runtime 只改 `atelier/runtime/`；应用是 init 时点的 vendor 拷贝，不回写框架。改了 dev 面（`atelier/dev/`）同理——已存在的应用要重新同步 scripts/。
- MCP 工具/命令/错误码三处同步：CLI 表（cli.mjs HELP）/ `atelier/mcp/mcp-definitions.json` / 对应 skill；改后必跑 `node atelier/scripts/check-skills.mjs`。
- 框架规格文档唯一源在 `atelier/docs/`；缺口与改进队列 = `atelier/docs/BACKLOG.md`。
- 所有"未确认"结论必须明确标注，不得写成事实；删除文件前先 `checkpoint save`（git 可恢复）。
