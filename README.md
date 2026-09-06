# Atelier — 为 AI 编程代理设计的前端框架

> Slogan（措辞终审 2026-09-06，用户全权委托拍板）：**意图进，界面出 / *Intent in, interface out.***
> 定位一句话：不参与"更快渲染"的主流竞赛；下注"当编码代理成为前端第一类使用者，框架应内建契约、检视、恢复与结构公理"。
>
> 本工作区即框架仓库（script-form v0.2）。系统是什么 → `atelier/docs/ARCHITECTURE.md`；代理怎么用 → `atelier/docs/SPEC-Agentic-DX-v0.1.md`；完整文档地图见文末。

## Why：AX（Agentic Experience）是新的第一公民

主流框架在 2026 年把 agent 基建当**外挂**补上（AGENTS.md 生成器、MCP 检视插件、agent 检测 dev server）——已成为及格线。Atelier 的路径不同：把 agent 当**第一类使用者**，从框架第一行开始内建它需要的东西——机器可读契约、可检视状态、双轨可逆、机检门禁。对应的新词汇：**AX**（Agentic Experience，相对 UX）、**agentic engineering**（相对 frontend engineering）。框架本体就是 agent 最佳实践的框架化实现，而不是另一份文档。

## 架构：五层（详见 ARCHITECTURE.md）

```
L5 人对界面    atelier review —— 预览 / checkpoint 时间轴 / 批准-驳回-点踩
L4 反馈通道    atelier dev —— 亚秒 HMR · 截图回环 · 审计日志
L3 代理层      stdio MCP Server —— 查询 / 操作 / 审计三面工具（token 鉴权）
L2 契约层      扁平 schema 单一真相 —— 组件契约 / MCP 工具定义 / 注册表白名单一份三用
L1 内核        零依赖运行时 —— 信号引擎 · 事务状态层 · 三态原语 · 模板渲染
```

工具链与前端运行时**零代码耦合**：runtime 不 import 任何工具链模块，工具链仅经 HTTP dev 面 / git / 文件系统与应用交互。新应用 = `atelier init` 三步组装（模板 + runtime vendor + dev vendor），自包含可跑。

## 仓库结构

| 目录 / 文件 | 说明 |
|---|---|
| `atelier/runtime/` | 零依赖运行时内核（真相源）：信号引擎 / 模板解释器 / 表达式求值 / 契约校验 / 组件注册表 / 三态原语 / dev 状态桥 |
| `atelier/compiler/` | 模板编译器：.atr.ts → 模板 AST（②）→ 零 import 静态 effect 图模块（③），golden DOM 对拍守门 |
| `atelier/dev/` | dev 面框架件：Vite 插件（/__atelier/* 面）、无头截图、token→@theme 生成、挂载探针 |
| `atelier/mcp/` | 零依赖 stdio MCP Server（<!--@num:tools-->25<!--@/--> 工具，`mcp-definitions.json` 单源生成） |
| `atelier/skills/` | 多工具兼容技能包（8 个 kebab-case 目录包） |
| `atelier/scripts/` + `cli.mjs` | init / dev / struct / checkpoint / snapshot / skills / mcp 等统一入口，三级诚实标注 |
| `atelier/templates/app/` | 应用 starter 模板（.atr.ts + .atr.md + .atr.spec.ts 三元共置示例 / token SSOT / 守卫测试） |
| `atelier/tests/` | runtime 单测（vitest，<!--@num:tests-->125<!--@/--> 用例） |
| `atelier/benchmarks/m3/` | M3 三臂对照实验台（noskill/skill/react × 首遍正确率） |
| `atelier/docs/` | 框架规格文档（地图见文末） |

## 四无人区（对比 2026-08 全量扫描后仍独占；每条按四段式自检：主张/机制/实测/复现）

**① 扁平 schema 一份三用** —— 同一个 `{reqProps, optProps}` 扁平形态同时充当组件契约（`validateFlat` + token 校验，错误 ATR-201/204/205 四段式）、MCP 工具参数（`mcp-definitions.json` 单源生成 tools/list）、注册表白名单渲染校验。无 $ref/oneOf，代理不猜。
实测：框架 <!--@num:tests-->125<!--@/--> 用例 vitest 全绿（契约/守卫/对拍在内）；<!--@num:tools-->25<!--@/--> 工具单源接线，check-skills 56/0。
复现：`node atelier/scripts/check-skills.mjs` · `atelier/pnpm test`。

**② 事务状态层 + 双轨回滚** —— 应用状态：命名合并 checkpoint（同名栈顶幂等=轮级回滚）+ 增量事件日志（journal）+ 依赖图查询（`store.graph()`/journal 已接进 MCP）；源码：决策 15 git 源码锚，「未检不锚」三道门禁（测试绿 + 快照 MATCH + API 面无未豁免破坏漂移，才许锚定）。破坏性操作过 `agent.confirm` 三档（deny = ATR-402 结构化拒绝）。
实测：事务层与 confirm 闸有专项用例；stdio 快乐径 e2e 实证活页面返回依赖图。
复现：`node atelier/cli.mjs checkpoint save "..."`（看门禁输出）· `atelier/pnpm test`。

**③ 六层结构公理机检开箱即用** —— `atelier struct check` 六层 OK-WARN-ERROR 分级；「不假红」纪律：ERROR 对应真实缺陷。
复现：`node atelier/scripts/struct.mjs check atelier/templates/app`。

**④ 可执行意图规格（spec = executable test）** —— 规格用 EARS 记法（WHEN/IF/WHILE/WHERE … THE SYSTEM SHALL …），每条验收语句落点为 `.atr.spec.ts` 命名用例；`specs/constitution.md`（H1-H6 宪法）+ `guardrails.md`（deny 档等常驻负例）随脚手架分发。对位 Spec Kit 的英文不可执行规格——规格在这里是测试。
复现：`node atelier/cli.mjs init --target /tmp/app --name App` 后查看 `/tmp/app/specs/`。

## 与标准对齐（地板，不是卖点）

AGENTS.md（6 万+ 项目）· Agent Skills（agentskills.io 格式门禁，S 检查 100% 过）· MCP（<!--@num:tools-->25<!--@/--> 工具；structured error = `structuredContent{code,message,fix}`；`ATELIER_TOOLSETS` 按 face 分组）· W3C DTCG 令牌互导（`atelier tokens export|import`）· 无障碍树快照（`ui.a11y`，语义优先于像素）· agent 体检（`/__atelier/agent-health`，UA 分类台账）。

## Quick start

```bash
node atelier/cli.mjs init --target my-app --name MyApp   # 三步组装：模板 + runtime vendor + dev vendor
cd my-app && pnpm install && pnpm dev                     # http://127.0.0.1:5173
node <repo>/atelier/cli.mjs skills install --target . --name MyApp   # 技能包双落点 + specs 骨架
node <repo>/atelier/mcp/server.mjs                        # <!--@num:tools-->25<!--@/--> 工具 MCP（ATELIER_PROJECT_ROOT=应用目录）
```

## 性能基线（SPEC §7，`atelier bench` 实测 2026-09-06 / Windows / Node 24 · F-5 内核补强 + F-2 快路径后复测全 PASS）

> 数字口径：本表 = 当前唯一现状口径；ROADMAP §2 的 6.25KB/2-3ms/51ms/~300ms 为阶段零历史基线留档，勿混引。

| 指标 | 目标 | 实测 | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **9.09 KB**（F-5 内核补强 +0.3KB、F-2 快路径 +0.25KB） | PASS |
| 10³ 节点挂载+首渲染 | ≤ 50 ms | **3.2 ms** | PASS |
| HMR（保存→可见） | ≤ 100 ms | **52 ms**（保值热交换，$state 不清零） | PASS |
| 截图回环 | ≤ 500 ms | **267 ms**（常驻无头实例） | PASS |

复现：`node atelier/cli.mjs init --target /tmp/app --name App && cd /tmp/app && pnpm install && node <repo>/atelier/cli.mjs bench --app /tmp/app`。
诚实性：FAIL 不粉饰、不豁免，按 SPEC §7 自动转 P0 工单；数字会随修复移动（HMR 曾 108ms FAIL→保值热交换后 PASS；截图曾 1933ms FAIL→常驻实例后 PASS）。

## 路线与现状（详见 ROADMAP.md）

- **三条主轴**：壮大框架本体（编译期静态化）· 深挖 agent 纵深（契约联动/依赖图/双轨可逆）· 标准对齐与受控验证。
- **北极星指标**（可证伪）：加难任务层上的 agent 首遍正确率（≥ +15pt 或绝对值 ≥ 60%）。在它落地前，我们不引用任何"首遍正确率"数字（见下「诚实纪律」）。
- **执行队列唯一源**：`atelier/docs/BACKLOG.md`；路线里程碑只管方向。

## 文档地图

| 文档 | 回答的问题 |
|---|---|
| `atelier/docs/ARCHITECTURE.md` | 系统是什么（五层架构、模块边界） |
| `atelier/docs/SPEC-Agentic-DX-v0.1.md` | 代理怎么用（硬约定 / 错误四段式 / DoD / 性能基线闸门） |
| `atelier/docs/design-decisions.md` | 为什么这样设计（决策 0-16 + 未决项） |
| `atelier/docs/AI-OPTIMAL-STRUCTURE.md` | 六层 AI 友好结构公理与机检规则集 |
| `atelier/docs/ROADMAP.md` | 2026H2→2027H1 路线计划（方向与里程碑） |
| `atelier/docs/BACKLOG.md` | 缺口与改进执行队列（唯一源） |
| `atelier/docs/TECH-*` / `SKILLS-PLAN.md` | 调研底稿与技能包设计依据 |
| `AGENTS.md` | 本仓库的常用命令与维护纪律 |

## 诚实纪律（引用本仓库任何数字前先读这段）

- **正确率主张**：M3 三臂对照实验在简单任务层全平（天花板效应）。在加难任务层落地前，我们不引用任何"首遍正确率"数字——请引用者同样克制。
- CLI 命令三级诚实标注 FULL / MINI / STUB，STUB 永不伪造成功（exit 4 + spec 指路）。
- 所有"未确认"结论明确标注，不写成事实；checkpoint 锚定前强制过测试+快照+API 面三道门禁。
- 对外数字单一口径：用例数/工具数/性能以本文为现状源；改动测试面或工具面时必须同步本文（ROADMAP §2 只留历史基线）。

## License

MIT（见 LICENSE）。
