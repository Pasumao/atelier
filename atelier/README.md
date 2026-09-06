# atelier/ — 框架本体目录

Atelier 框架的全部实现都在本目录内，自足、零第三方依赖（runtime 层）：新应用由 `atelier init` 从这里组装，不依赖 npm 包。

| 子目录 / 文件 | 是什么 |
|---|---|
| `runtime/` | 零依赖运行时内核（真相源）：信号引擎、模板解释器、表达式求值、契约校验、组件注册表、事务状态层、dev 状态桥 |
| `compiler/` | 模板编译器：`.atr.ts` → 模板 AST（dump.mjs）→ 零 import 静态 effect 图模块（codegen.mjs），产物与解释器逐节点比对守护语义一致 |
| `dev/` | dev 面框架件：Vite 插件（`/__atelier/*` 查询/桥接/审计面）、无头截图、token→@theme 生成、挂载探针；init 时 vendor 进应用 `scripts/` |
| `mcp/` | stdio MCP Server，工具面由 `mcp-definitions.json` 单源生成 |
| `skills/` | 多工具兼容技能包（kebab-case 目录包），设计依据 `docs/SKILLS-PLAN.md` |
| `scripts/` + `cli.mjs` | 统一 CLI：init / dev / struct / checkpoint / snapshot / skills / mcp / bench 等，每条命令按实现程度诚实标注 |
| `templates/app/` | 应用 starter 模板：契约-实现-规格三元共置示例（`.atr.ts` + `.atr.md` + `.atr.spec.ts`）、token 配置（单一真相源）、样式/状态守卫测试 |
| `tests/` | runtime 单测（vitest）：内核、契约、表达式 fuzz、编译产物与解释器对拍、桥接、HMR、token |
| `benchmarks/m3/` | 三臂对照实验台（无技能 / 有技能 / React × agent 首遍正确率），操作卡见 `RUNBOOK.md` |
| `docs/` | 框架规格文档；入口地图见仓库根 README「文档地图」 |

- 总览、Quick start、性能基线：仓库根 [README.md](../README.md)
- 系统架构：`docs/ARCHITECTURE.md`；代理行为契约：`docs/SPEC-Agentic-DX-v0.1.md`
- 改动纪律：runtime 只改 `runtime/`；改 MCP 工具/命令/错误码需三处同步（CLI HELP / `mcp/mcp-definitions.json` / 对应 skill），改完跑 `node atelier/scripts/check-skills.mjs`（exit code 可接 CI）
