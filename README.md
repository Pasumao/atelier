# Atelier — 为 AI 编程代理设计的前端框架

> Slogan：**意图进，界面出 / *Intent in, interface out.***
> 定位一句话：不参与"更快渲染"的主流竞赛；下注"当编码代理成为前端第一类使用者，框架应内建契约、检视、恢复与结构公理"。
>
> 系统是什么 → `atelier/docs/ARCHITECTURE.md`；代理怎么用 → `atelier/docs/SPEC-Agentic-DX-v0.1.md`；完整文档地图见文末。

## Why：AX（Agentic Experience）是新的第一公民

主流框架在 2026 年把 agent 基建当**外挂**补上（AGENTS.md 生成器、MCP 检视插件、agent 检测 dev server）。Atelier 的路径不同：把 agent 当**第一类使用者**，从框架第一行开始内建它需要的东西——机器可读契约、可检视状态、可回滚、机检门禁。对应的新词汇：**AX**（Agentic Experience，相对 UX）、**agentic engineering**（相对 frontend engineering）。框架本体就是 agent 最佳实践的框架化实现，而不是另一份文档。

## 一个组件长这样

```ts
// my-app/src/components/HelloCard.atr.ts —— 来自脚手架生成的 starter 应用
import { component, $state, html } from "../runtime";

export const helloCardSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
  optProps: { start: { type: "number" } },
} as const;

export const HelloCard = component(function HelloCard(props) {
  const count = $state(props.start ?? 0);
  const inc = () => { count.value += 1; };
  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <button class="btn btn-primary" on:click={inc}>count: {count.value}</button>
    </div>
  `.locals({ props, count, inc });
}, { name: "HelloCard", schema: helloCardSchema });
```

组件 = 契约（`reqProps/optProps` 扁平 schema）+ 实现（显式 `$state` + `html` 模板）。这份 schema 不是注释：代理写代码前就能用它校验 props（错误带修复建议），运行时用它做白名单渲染，同一个形态还直接充当 MCP 工具参数定义——一份三用。

## 架构：五层（详见 ARCHITECTURE.md）

```
L5 人对界面    atelier review —— 预览 / checkpoint 时间轴 / 批准-驳回-点踩
L4 反馈通道    atelier dev —— 亚秒 HMR · 截图回环 · 审计日志
L3 代理层      stdio MCP Server —— 查询 / 操作 / 审计三面工具（token 鉴权）
L2 契约层      扁平 schema 单一真相 —— 组件契约 / MCP 工具定义 / 注册表白名单一份三用
L1 内核        零依赖运行时 —— 信号引擎 · 事务状态层 · 三态原语 · 模板渲染
```

工具链与前端运行时**零代码耦合**：runtime 不 import 任何工具链模块，工具链只通过 HTTP dev 面 / git / 文件系统与应用交互。新应用 = `atelier init` 三步组装（应用模板 + 拷贝 runtime + 拷贝 dev 面工具），生成自包含可跑的目录。

## 获取与运行

> 本项目尚未发布 npm，目前需 clone 仓库使用。前置要求：Node.js ≥ 22（实测 Node 24）与 pnpm。

```bash
git clone https://github.com/Pasumao/atelier.git
cd atelier

# 脚手架一个新应用（模板 + 拷贝 runtime + 拷贝 dev 面，自包含）
node atelier/cli.mjs init --target my-app --name MyApp

cd my-app && pnpm install && pnpm dev        # http://127.0.0.1:5173

# 给你的 agent 装上配套技能包与 MCP 工具（可选，但这是本框架的意义所在）
node <atelier仓库路径>/atelier/cli.mjs skills install --target . --name MyApp
node <atelier仓库路径>/atelier/mcp/server.mjs   # MCP 工具面（ATELIER_PROJECT_ROOT=应用目录）
```

`<atelier仓库路径>` 即上面 clone 出来的仓库目录（应用是独立目录，框架仓库不随应用走）。

## 四项独有能力

以下四点是 Atelier 与现有框架的实质差异，每条附实测与复现命令：

**① 扁平 schema 一份三用** —— 同一个 `{reqProps, optProps}` 扁平形态同时充当组件契约（运行时校验 + token 校验，错误带错误码与 fix 行动指令）、MCP 工具参数（`mcp-definitions.json` 单源生成 tools/list）、注册表白名单渲染校验。无 $ref/oneOf，代理不猜。
实测：框架 <!--@num:tests-->125<!--@/--> 用例 vitest 通过（另有 8 例实验台用例按环境跳过）；<!--@num:tools-->25<!--@/--> 工具单源接线，一致性校验全绿。
复现：`node atelier/scripts/check-skills.mjs` · `atelier/pnpm test`。

**② 事务状态层 + 双轨回滚** —— 应用状态：命名合并 checkpoint（同名栈顶幂等，即轮级回滚）+ 增量事件日志（journal）+ 依赖图查询（`store.graph()` 与 journal 已接进 MCP，代理可直接问"现在哪些状态依赖什么"）；源码：git 源码锚，锚定前强制过三道门禁（测试绿 + 截图快照无漂移 + API 面无破坏性变更）。危险操作走 `agent.confirm` 确认闸，拒绝时返回结构化错误而非静默失败。
实测：事务层与确认闸有专项用例；stdio 快乐径端到端实证活页面返回依赖图。
复现：`node atelier/cli.mjs checkpoint save "..."`（看门禁输出）· `atelier/pnpm test`。

**③ 结构规则机检开箱即用** —— `atelier struct check` 对项目做六层结构检查，输出 OK / WARN / ERROR 三级；ERROR 只对应真实缺陷，不假红。
复现：`node atelier/scripts/struct.mjs check atelier/templates/app`。

**④ 可执行意图规格（spec = executable test）** —— 规格用 EARS 需求句式（Easy Approach to Requirements Syntax：WHEN/IF/WHILE … THE SYSTEM SHALL …），每条验收语句落点为 `.atr.spec.ts` 命名测试用例；`specs/constitution.md`（项目宪法）+ `guardrails.md`（常驻负例）随脚手架分发。对比 Spec Kit 的自然语言规格——规格在这里是测试。
复现：`node atelier/cli.mjs init --target my-app --name App` 后查看 `my-app/specs/`。

## 与标准对齐（地板，不是卖点）

AGENTS.md · Agent Skills（agentskills.io 格式门禁全过）· MCP（<!--@num:tools-->25<!--@/--> 工具；structured error = `structuredContent{code,message,fix}`；`ATELIER_TOOLSETS` 按面分组按需启用）· W3C Design Tokens（DTCG）标准互导（`atelier tokens export|import`）· 无障碍树快照（`ui.a11y`，语义优先于像素）· agent 体检（`/__atelier/agent-health`）。

## 性能基线（`atelier bench` 实测 2026-09-06 / Windows / Node 24）

| 指标 | 目标 | 实测 | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **9.09 KB** | PASS |
| 10³ 节点挂载+首渲染 | ≤ 50 ms | **3.2 ms** | PASS |
| HMR（保存→可见） | ≤ 100 ms | **52 ms**（热交换保留 `$state`，不清零） | PASS |
| 截图回环 | ≤ 500 ms | **267 ms**（常驻无头实例） | PASS |

复现：`node atelier/cli.mjs init --target my-app --name App && cd my-app && pnpm install && node <atelier仓库路径>/atelier/cli.mjs bench --app ./my-app`。
诚实性：FAIL 不粉饰、不豁免；数字会随修复移动（HMR 曾 108ms → 52ms，截图曾 1933ms → 267ms）。

## 路线与现状（详见 ROADMAP.md）

- **三条主轴**：壮大框架本体（编译期静态化）· 深挖 agent 纵深（契约联动/依赖图/可回滚）· 标准对齐与受控验证。
- **北极星指标**（可证伪）：加难任务层上的 agent 首遍正确率（≥ +15pt 或绝对值 ≥ 60%）。
- **执行队列**：`atelier/docs/BACKLOG.md`。

## 当前状态与已知边界

- **未发布 npm**：需 clone 仓库使用；无第三方生产用户。
- **正确率数据待补**：三臂对照实验在简单任务层全平（天花板效应）；加难任务层数据落地前，我们不引用任何"首遍正确率"数字，请引用者同样克制。
- **性能数字为单机实测**（2026-09-06 / Windows / Node 24），会随修复移动。
- **未实现即明说**：CLI 命令按实现程度标注（完整 / 最小 / 未实现），未实现的命令返回 exit 4 并指路规格文档，永不伪造成功。
- 所有"未确认"结论明确标注，不写成事实。

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

## License

MIT（见 LICENSE）。
