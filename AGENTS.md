# Atelier 工作区说明

> 本文档由 dsh-plugin-agents-gen 生成，可手动编辑。

## 项目概述

本工作区即 **Atelier 框架仓库**：为 AI 编程代理设计的前端框架。`atelier/` 是自足的框架本体——零依赖 runtime 内核、dev 面插件、应用模板、测试与 AI 工具链（MCP/Skills/CLI）全部集成于框架目录内部，与前端运行时零代码耦合。2026-08 整理：原 `prototype/` 已吸收进框架（dev 面 → `atelier/dev/`，runtime 测试 → `atelier/tests/`，应用骨架 → `atelier/templates/app/`）后删除；更早的调研素材可回溯 git 锚点 `4c1d450`。

## 目录结构

| 目录 / 文件 | 说明 |
|---|---|
| `atelier/runtime/` | 零依赖运行时内核（真相源）：core.ts 信号引擎 / template.ts 模板解释器 / expr.ts 表达式求值 / contract.ts 契约校验 / component.ts 注册表 / primitives.ts 三态原语 / bridge.ts dev 状态桥 / index.ts 桶出口。 |
| `atelier/compiler/` | 编译器（P0-2）：`dump.mjs`（②：.atr.ts → 模板 AST JSON，与解释器同一解析器）+ `codegen.mjs`（③：AST → 零 import 静态 effect 图模块）。产物经 `registerCompiled` 注册后该组件走零 tokenize 快路径（语义与解释器同源，golden DOM diff 在 tests/codegen.test.ts）。 |
| `atelier/benchmarks/m3/` | M3 三臂对照实验台（P0-3）：protocol.md（noskill/skill/react × 首遍正确率）+ 6 任务书（task1-3 冒烟正控层 + task4-6 加难层：流式 keyed each / 跨组件事务 / token 纪律）+ grade.mjs 评分器（acceptance harness，正控参考解在 reference/）+ report.mjs §7 出数 + RUNBOOK.md 逐臂出数操作卡。改评分器后必跑六正控回归。 |
| `atelier/dev/` | dev 面框架件：`atelier-dev-plugin.mjs`（Vite 插件，/__atelier/* 查询/桥接/审计/token 门禁/SSE 下行）、`dev-screenshot.mjs`（CDP 无头截图）、`gen-tailwind-theme.mjs`（决策 16 token→@theme AOT）、`probe-mount.mjs`（挂载诊断探针，PROBE_URL 可换目标）。init 时 vendor 进应用 `scripts/`。 |
| `atelier/tests/` | runtime 单测（vitest，<!--@num:tests-->122<!--@/--> 用例：内核/契约/表达式 fuzz/codegen golden DOM 对拍/F-2 静态依赖差分对拍/桥接/HMR/token DTCG/mcp-confirm 闸；M3 评分 harness 无 env 时整体 skip）。 |
| `atelier/templates/app/` | 应用 starter 模板：vite.config / index.html / atelier.config.json（token SSOT）/ src/main.ts + HelloCard 与 ContractProbe 三元共置示例（.atr.ts + .atr.md + .atr.spec.ts）/ manifest.json / llms.txt / atelier-ui.css recipe / styling-discipline + state-discipline 守卫测试。`atelier init` 以此组装自包含应用（specs/ 骨架含 guardrails.md 常驻负例）。 |
| `atelier/mcp/` | stdio MCP Server（<!--@num:tools-->25<!--@/--> 工具单源生成，live 工具需一个运行中的应用 dev 面）。 |
| `atelier/skills/` | 多工具兼容技能包（8 个 kebab-case 目录包）。 |
| `atelier/scripts/` + `cli.mjs` | init（三步组装：模板 + runtime vendor + dev vendor）/ dev / struct / checkpoint / snapshot / skills / mcp，三级诚实标注。 |
| `atelier/docs/` | 框架规格文档：ARCHITECTURE / design-decisions 0-16 / BACKLOG（执行队列唯一源）/ ROADMAP（2026H2→2027H1 路线计划书）/ SKILLS-PLAN / TECH-*。 |
| `.dsh/skills/` | 本会话已安装的技能副本（harness 发现目录；源在 `atelier/skills/`）。 |

## 常用命令

| 场景 | 命令 |
|---|---|
| 脚手架新应用 | `node atelier/cli.mjs init --target <dir> --name <Name>`（cd && pnpm install && pnpm dev 即跑） |
| 启动应用 dev server | 应用目录下 `pnpm dev`（或 `atelier dev`；http://127.0.0.1:5173，strictPort） |
| 框架 runtime 测试 | `atelier/` 目录下 `pnpm test`（vitest，93 用例） |
| 编译应用组件（②→③） | `node atelier/compiler/dump.mjs --root <appDir>` 然后 `node atelier/compiler/codegen.mjs --ast <appDir>/.atr/ast`（产物 .atr/compiled/<Component>.mjs，应用侧 registerCompiled 接入） |
| 应用测试（契约/样式守卫） | 应用目录下 `pnpm test` |
| 技能包一致性校验 | `node atelier/scripts/check-skills.mjs`（exit code 可接 CI；改动 skills/mcp-definitions 后必跑） |
| 一键安装技能到项目 | `node atelier/cli.mjs skills install --target <dir> --name <Name>`（双落点 + 模板渲染 + specs 骨架，幂等） |
| 结构地图/结构检查 | `node atelier/cli.mjs struct map` / `check`（六层 OK-WARN-ERROR 分级；在应用目录跑） |
| 已有应用拉齐 vendor | `node atelier/cli.mjs sync [--target <dir>]`（runtime + dev 面全量覆盖到框架当前时点；specs 模板补种；应用源码/config 不碰） |
| 打开 review UI | 应用目录下 `node atelier/cli.mjs review [--open]`（dev 面 /__atelier/review：timeline + 双图判定写回；需 pnpm dev 在跑） |
| 视觉回归快照 | 应用目录下 `node <repo>/atelier/cli.mjs snapshot save` / `check [--update]`（绝不自动晋升） |
| API 面漂移门禁 | 仓库根/应用目录下 `node atelier/cli.mjs api-diff snapshot` / `check`（P3-4：公共 API 面 snapshot→diff；removed/changed=breaking exit 1，`--allow` 豁免，`--strict` 连新增也红） |
| MCP server | `node atelier/mcp/server.mjs`（env：`ATELIER_PROJECT_ROOT`=应用目录，`ATELIER_DEV_URL`=应用 dev 面） |
| 读中文 UTF-8 文件 | PowerShell 一律 `Get-Content -Encoding UTF8`（默认 ANSI 会把 em dash 显示成乱码，文件未必真坏） |
| 源码 checkpoint（决策 15） | **仓库根目录下** `node atelier/cli.mjs checkpoint save "<名称>"` / `list` / `rollback <id>`（改代码前先看时间线；save 内建门禁=测试套件绿+快照 MATCH+API 面无未豁免破坏漂移（P3-4，`.atelier/api-surface.json` 存在时）才许锚定，`--no-gate` 为 wip 锚逃生口。**务必在仓库根运行**——在子目录跑会因找不到 `.git` 误引导嵌套 git 仓，2026-08-30 实证） |

## 维护纪律

- 框架 runtime 只改 `atelier/runtime/`；应用是 init 时点的 vendor 拷贝，不回写框架。改了 dev 面（`atelier/dev/`）同理——已存在的应用要重新同步 scripts/。
- MCP 工具/命令/错误码三处同步：CLI 表（cli.mjs HELP）/ `atelier/mcp/mcp-definitions.json` / 对应 skill；改后必跑 `node atelier/scripts/check-skills.mjs`。
- 框架规格文档唯一源在 `atelier/docs/`；缺口与改进队列 = `atelier/docs/BACKLOG.md`。
- 所有"未确认"结论必须明确标注，不得写成事实；删除文件前先 `checkpoint save`（git 可恢复）。
- 对外数字单一**生成**源：README/AGENTS 的用例数与工具数是标记位（`<!--@num:tests|tools-->N<!--@/-->`），由 `node atelier/scripts/docs-numbers.mjs` sync 重写 / check 校验（CI 已接）——禁止手写这两个数字（2026-09-06 锐评整改：曾出现 README 93 用例/24 工具与实际失守）；性能数字仍以 README 性能表为唯一人工口径。
