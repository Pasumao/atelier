# Atelier — 为 AI 编程代理设计的前端框架

> Slogan：**意图进，界面出 / *Intent in, interface out.***
> 定位一句话：不参与"更快渲染"的主流竞赛；下注"当编码代理成为前端第一类使用者，框架应内建契约、检视、恢复与结构公理"。
>
> 系统是什么 → `atelier/docs/ARCHITECTURE.md`；代理怎么用 → `atelier/docs/SPEC-Agentic-DX-v0.1.md`；完整文档地图见文末。

## Why：AX（Agentic Experience）是新的第一公民

主流框架在 2026 年把 agent 基建当**外挂**补上（AGENTS.md 生成器、MCP 检视插件、agent 检测 dev server）。Atelier 的路径不同：把 agent 当**第一类使用者**，从框架第一行开始内建它需要的东西——机器可读契约、可检视状态、双轨可逆、机检门禁。对应的新词汇：**AX**（Agentic Experience，相对 UX）、**agentic engineering**（相对 frontend engineering）。框架本体就是 agent 最佳实践的框架化实现，而不是另一份文档。

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
| `atelier/scripts/` + `cli.mjs` | init / dev / struct / checkpoint / snapshot / skills / mcp 等统一入口，FULL / MINI / STUB 三级诚实标注 |
| `atelier/templates/app/` | 应用 starter 模板（.atr.ts + .atr.md + .atr.spec.ts 三元共置示例 / token SSOT / 守卫测试） |
| `atelier/tests/` | runtime 单测（vitest，<!--@num:tests-->125<!--@/--> 用例） |
| `atelier/benchmarks/m3/` | 三臂对照实验台（无技能 / 有技能 / React × 首遍正确率） |
| `atelier/docs/` | 框架规格文档（地图见文末） |

## 四项独有能力

以下四点是 Atelier 与现有框架的实质差异，每条附实测与复现命令：

**① 扁平 schema 一份三用** —— 同一个 `{reqProps, optProps}` 扁平形态同时充当组件契约（`validateFlat` + token 校验，错误带错误码与 fix 行动指令）、MCP 工具参数（`mcp-definitions.json` 单源生成 tools/list）、注册表白名单渲染校验。无 $ref/oneOf，代理不猜。
实测：框架 <!--@num:tests-->125<!--@/--> 用例 vitest 全绿（契约/守卫/对拍在内）；<!--@num:tools-->25<!--@/--> 工具单源接线，一致性校验全绿。
复现：`node atelier/scripts/check-skills.mjs` · `atelier/pnpm test`。

**② 事务状态层 + 双轨回滚** —— 应用状态：命名合并 checkpoint（同名栈顶幂等=轮级回滚）+ 增量事件日志（journal）+ 依赖图查询（`store.graph()`/journal 已接进 MCP）；源码：git 源码锚，「未检不锚」三道门禁（测试绿 + 快照 MATCH + API 面无破坏漂移，才许锚定）。破坏性操作过 `agent.confirm` 三档（deny = 结构化拒绝）。
实测：事务层与 confirm 闸有专项用例；stdio 快乐径 e2e 实证活页面返回依赖图。
复现：`node atelier/cli.mjs checkpoint save "..."`（看门禁输出）· `atelier/pnpm test`。

**③ 六层结构公理机检开箱即用** —— `atelier struct check` 六层 OK-WARN-ERROR 分级；ERROR 只对应真实缺陷，不假红。
复现：`node atelier/scripts/struct.mjs check atelier/templates/app`。

**④ 可执行意图规格（spec = executable test）** —— 规格用 EARS 记法（WHEN/IF/WHILE/WHERE … THE SYSTEM SHALL …），每条验收语句落点为 `.atr.spec.ts` 命名用例；`specs/constitution.md`（宪法）+ `guardrails.md`（常驻负例）随脚手架分发。对比 Spec Kit 的自然语言规格——规格在这里是测试。
复现：`node atelier/cli.mjs init --target /tmp/app --name App` 后查看 `/tmp/app/specs/`。

## 与标准对齐（地板，不是卖点）

AGENTS.md · Agent Skills（格式门禁全过）· MCP（<!--@num:tools-->25<!--@/--> 工具；structured error = `structuredContent{code,message,fix}`；`ATELIER_TOOLSETS` 按面分组）· W3C DTCG 令牌互导（`atelier tokens export|import`）· 无障碍树快照（`ui.a11y`，语义优先于像素）· agent 体检（`/__atelier/agent-health`）。

## Quick start

```bash
node atelier/cli.mjs init --target my-app --name MyApp   # 三步组装：模板 + runtime vendor + dev vendor
cd my-app && pnpm install && pnpm dev                     # http://127.0.0.1:5173
node <repo>/atelier/cli.mjs skills install --target . --name MyApp   # 技能包双落点 + specs 骨架
node <repo>/atelier/mcp/server.mjs                        # <!--@num:tools-->25<!--@/--> 工具 MCP（ATELIER_PROJECT_ROOT=应用目录）
```

## 性能基线（`atelier bench` 实测 2026-09-06 / Windows / Node 24）

| 指标 | 目标 | 实测 | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **9.09 KB** | PASS |
| 10³ 节点挂载+首渲染 | ≤ 50 ms | **3.2 ms** | PASS |
| HMR（保存→可见） | ≤ 100 ms | **52 ms**（保值热交换，$state 不清零） | PASS |
| 截图回环 | ≤ 500 ms | **267 ms**（常驻无头实例） | PASS |

复现：`node atelier/cli.mjs init --target /tmp/app --name App && cd /tmp/app && pnpm install && node <repo>/atelier/cli.mjs bench --app /tmp/app`。
诚实性：FAIL 不粉饰、不豁免；数字会随修复移动（HMR 曾 108ms → 52ms，截图曾 1933ms → 267ms）。

## 路线与现状（详见 ROADMAP.md）

- **三条主轴**：壮大框架本体（编译期静态化）· 深挖 agent 纵深（契约联动/依赖图/双轨可逆）· 标准对齐与受控验证。
- **北极星指标**（可证伪）：加难任务层上的 agent 首遍正确率（≥ +15pt 或绝对值 ≥ 60%）。在它落地前，我们不引用任何"首遍正确率"数字（见下「诚实纪律」）。
- **执行队列**：`atelier/docs/BACKLOG.md`。

## 文档地图

| 文档 | 回答的问题 |
|---|---|
| `atelier/docs/ARCHITECTURE.md` | 系统是什么（五层架构、模块边界） |
| `atelier/docs/SPEC-Agentic-DX-v0.1.md` | 代理怎么用（硬约定 / 错误规范 / DoD / 性能基线闸门） |
| `atelier/docs/design-decisions.md` | 为什么这样设计（决策 0-16 + 未决项） |
| `atelier/docs/AI-OPTIMAL-STRUCTURE.md` | 六层 AI 友好结构公理与机检规则集 |
| `atelier/docs/ROADMAP.md` | 路线计划（方向与里程碑） |
| `atelier/docs/BACKLOG.md` | 缺口与改进执行队列 |
| `atelier/docs/TECH-*` / `SKILLS-PLAN.md` | 调研底稿与技能包设计依据 |
| `AGENTS.md` | 本仓库的常用命令与维护纪律 |

## 诚实纪律（引用本仓库任何数字前先读这段）

- **正确率主张**：三臂对照实验在简单任务层全平（天花板效应）。在加难任务层落地前，我们不引用任何"首遍正确率"数字——请引用者同样克制。
- CLI 命令三级诚实标注 FULL / MINI / STUB，STUB 永不伪造成功（exit 4 + spec 指路）。
- 所有"未确认"结论明确标注，不写成事实。

## License

MIT（见 LICENSE）。
