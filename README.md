# Atelier — 为 AI 编程代理设计的前端框架

> Slogan：**意图进，界面出 / *Intent in, interface out.***
> 定位一句话：不参与"更快渲染"的主流竞赛；下注"当编码代理成为前端第一类使用者，框架应内建契约、检视、恢复与结构公理"。
>
> 系统是什么 → `atelier/docs/ARCHITECTURE.md`；代理怎么用 → `atelier/docs/SPEC-Agentic-DX-v0.2.md`；完整文档地图见文末。

![version](https://img.shields.io/badge/version-1.0.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)

**v1.0.0**（2026-09-27，首个正式版本）· 变更史见 [CHANGELOG.md](CHANGELOG.md)（Keep a Changelog + 语义化版本，兼容性执行器 = `atelier api-diff`，见决策 28）。1.0 = release-ready：npm publish 等发布日外部动作见 [`atelier/docs/RELEASE-CHECKLIST.md`](atelier/docs/RELEASE-CHECKLIST.md)。

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

## 架构：五层 + 服务层 S0（详见 ARCHITECTURE.md）

```
L5 人对界面    atelier review —— 预览 / checkpoint 时间轴 / 批准-驳回-点踩
L4 反馈通道    atelier dev —— 亚秒 HMR · 截图回环 · 审计日志
L3 代理层      stdio MCP Server —— 查询 / 操作 / 审计三面工具（token 鉴权）
L2 契约层      扁平 schema 单一真相 —— 组件 ∪ 端点 ∪ 数据一份多用
L1 内核        零依赖运行时 —— 信号引擎 · 事务状态层 · 三态原语 · 模板渲染
S0 服务层      atelier/server —— defineQuery/defineCommand 读写二分 · 契约校验 · 审计 journal（FS-M1 已落地）
```

工具链与前端运行时**零代码耦合**：runtime 不 import 任何工具链模块，工具链只通过 HTTP dev 面 / git / 文件系统与应用交互。新应用 = `atelier init` 三步组装（应用模板 + 拷贝 runtime + 拷贝 dev 面工具），生成自包含可跑的目录。

## 获取与运行

> 框架版本 1.0.0（release-ready）；**尚未发布 npm**（发布日外部动作，见 RELEASE-CHECKLIST），目前需 clone 仓库使用。前置要求：Node.js ≥ 22（实测 Node 24）与 pnpm。

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
实测：框架 <!--@num:tests-->789<!--@/--> 用例 vitest 通过（另有 8 例实验台用例按环境跳过）；<!--@num:tools-->36<!--@/--> 工具单源接线，一致性校验全绿。
复现：`node atelier/scripts/check-skills.mjs` · `atelier/pnpm test`。

**② 事务状态层 + 双轨回滚** —— 应用状态：命名合并 checkpoint（同名栈顶幂等，即轮级回滚）+ 增量事件日志（journal）+ 依赖图查询（`store.graph()` 与 journal 已接进 MCP，代理可直接问"现在哪些状态依赖什么"）；源码：git 源码锚，锚定前强制过三道门禁（测试绿 + 截图快照无漂移 + API 面无破坏性变更）。危险操作走 `agent.confirm` 确认闸，拒绝时返回结构化错误而非静默失败。
实测：事务层与确认闸有专项用例；stdio 快乐径端到端实证活页面返回依赖图。
复现：`node atelier/cli.mjs checkpoint save "..."`（看门禁输出）· `atelier/pnpm test`。

**③ 结构规则机检开箱即用** —— `atelier struct check` 对项目做六层结构检查，输出 OK / WARN / ERROR 三级；ERROR 只对应真实缺陷，不假红。
复现：`node atelier/scripts/struct.mjs check atelier/templates/app`。

**④ 可执行意图规格（spec = executable test）** —— 规格用 EARS 需求句式（Easy Approach to Requirements Syntax：WHEN/IF/WHILE … THE SYSTEM SHALL …），每条验收语句落点为 `.atr.spec.ts` 命名测试用例；`specs/constitution.md`（项目宪法）+ `guardrails.md`（常驻负例）随脚手架分发。对比 Spec Kit 的自然语言规格——规格在这里是测试。
复现：`node atelier/cli.mjs init --target my-app --name App` 后查看 `my-app/specs/`。

## 与标准对齐（地板，不是卖点）

AGENTS.md · Agent Skills（agentskills.io 格式门禁全过）· MCP（<!--@num:tools-->36<!--@/--> 工具；structured error = `structuredContent{code,message,fix}`；`ATELIER_TOOLSETS` 按面分组按需启用）· W3C Design Tokens（DTCG）标准互导（`atelier tokens export|import`）· 无障碍树快照（`ui.a11y`，语义优先于像素）· agent 体检（`/__atelier/agent-health`）。

## 性能基线（`atelier bench` 实测 2026-09-27 / Windows / Node 24 · 1.0.0 复测口径）

| 指标 | 目标 | 实测 | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **12.28 KB** | PASS |
| 10³ 节点挂载+首渲染 | ≤ 50 ms | **3.7 ms** | PASS |
| HMR（保存→可见） | ≤ 100 ms | **51 ms**（热交换按名锚定保留 `$state`，不清零） | PASS |
| 截图回环 | ≤ 500 ms | **318 ms**（常驻无头实例） | PASS |

复现：`node atelier/cli.mjs init --target my-app --name App && cd my-app && pnpm install && node <atelier仓库路径>/atelier/cli.mjs bench --app ./my-app`。
诚实性：FAIL 不粉饰、不豁免；数字会随修复移动（HMR 曾 108ms → 51ms，截图曾 1933ms → 318ms；体积自 09-06 的 9.09KB 随 bind 指令族/事件修饰/schema 提取/error 语义增长至 12.28KB，仍远低于判据）。

## 路线与现状（详见 ROADMAP.md）

- **三条主轴**：壮大框架本体（编译期静态化）· 深挖 agent 纵深（契约联动/依赖图/可回滚）· 标准对齐与受控验证。
- **北极星指标**（可证伪）：加难任务层上的 agent 首遍正确率（≥ +15pt 或绝对值 ≥ 60%）。
- **执行队列**：`atelier/docs/BACKLOG.md`。

## Known Limitations（已知限制，1.0.0 时点）

面向使用者的诚实清单——每条一句限制 + 影响 + 出路。内部缺口与候选池台账见 `BACKLOG.md`；这里只列使用者可感知项。

- **未发布 npm**：框架 1.0.0 = release-ready，安装仍需 clone 仓库（`atelier init` 产物自包含、不依赖框架仓库驻留）。影响：没有 `npm create atelier` 一键脚手架。出路：按上文 clone + init 三步；`create-atelier` 脚手架列发布日动作（RELEASE-CHECKLIST）。
- **平台覆盖以 Windows 实证为主**：常规测试门禁与视觉快照基线在 win32 实武装；linux/darwin 的快照基线未武装（快照门在这些平台如实 vacuous，不假红）。影响：非 Windows 用户的视觉回归门禁需先在本地 `atelier snapshot save` 捕获基线。出路：per-platform 布局已就绪，各平台本地武装即启用。
- **Bun 路径实测过但无 CI 常规覆盖**：SQLite 薄宿主适配经真实 Bun 1.4.2 全语义面冒烟 + 全栈落库/持久化验证；但冒烟脚本需 bun 宿主手动跑（`scripts/bun-adapter-smoke.mjs`），未进常规测试门禁。影响：bun 回归依赖手动冒烟，报错文案匹配归一可能随 bun 升级失效（失效=差异重新可见，非静默）。出路：`atelier build --target=bun` 产物冒烟自证兜底。
- **真实 CI 未首跑**：CI 矩阵已接线（linux/windows × node 22/24），但仓库未 push 远端，视觉冒烟作业保留 continue-on-error。影响：CI 门禁承诺（测试/结构/API 面）尚未在第三方环境兑现。出路：push 远端 + 首跑后摘除 continue-on-error（RELEASE-CHECKLIST 发布日动作）。
- **Windows 进程收尾语义**：`atelier dev` 托管的 server 子进程在 Windows 上 kill = 即终止，优雅关停兜底窗口形同保障。影响：热重启瞬间可能有极小概率的端口/句柄残留。出路：监督器 SIGTERM 1.5s 兜底 + 未就绪 503 自愈，重启即恢复。
- **command journal 保留窗口为行数基**：命令审计 journal 持久化为追加事件表（db 已装配即写、重启不灭；缺省保留 1 万行、写时裁最老，`createHandler({ journal: { persist: false } })` 可显式关闭回内存环形）；live 重算失败诊断条目仍只在内存。影响：超出保留窗口的最老事件滚出即不可查（时间基窗口 v1 不做）；删除库文件即丢失全部审计史（同迁移 journal 口径）。出路：窗口经 `journal.maxRows` 调大；关键节点以 checkpoint 台账为锚；库文件进常规备份（`atelier db backup`）。
- **server 面 prod 激活为行为级**：服务面无打包器，prod 语义靠旗关断（调试面隐身/校验跳过），代码仍在产物内；构建期 DCE 只覆盖浏览器面。影响：server 产物体积不是最小。出路：单容器整目录部署语义（`atelier build`），体积优化非 1.0 目标。
- **vendored 应用按 init 时点冻结**：应用获得的是 init 时刻的框架拷贝；新能力（MCP HTTP 直连、全页快照等）需 `atelier sync` 拉齐。影响：未 sync 的旧应用 MCP 直连 503（诚实指路 stdio）。出路：`node atelier/cli.mjs sync --target <dir>` 幂等拉齐，应用源码不受影响。
- **正确率主张克制**：三臂对照实验在简单层与加难层（Wave-7 正式波 45 run）均全平——绝对口径 100% 达标、相对区分力为零；「技能包优势」主张悬置待干扰面/混合实验出数，我们不引用任何"首遍正确率优势"数字，请引用者同样克制。
- **性能数字为单机实测**（2026-09-27 / Windows / Node 24，1.0.0 复测口径），会随修复移动；FAIL 不粉饰、不豁免。
- **未实现即明说**：CLI 命令按实现程度标注（完整 / 最小 / 未实现），未实现的命令返回 exit 4 并指路规格文档，永不伪造成功。
- 所有"未确认"结论明确标注，不写成事实。

## 文档地图

| 文档 | 回答的问题 |
|---|---|
| `CHANGELOG.md` | 版本变更史（Keep a Changelog + 语义化版本；1.0.0 起对外） |
| `atelier/docs/README.md` | 文档导航（每份一行：定位 + 状态 + 时点） |
| `atelier/docs/ARCHITECTURE.md` | 系统是什么（五层 + S0 服务层、仓库布局、模块边界） |
| `atelier/docs/SPEC-Agentic-DX-v0.2.md` | 代理怎么用（硬约定 / 错误导航表 / DoD / 工作循环 / 全站化行为契约；v0.1 留档 superseded） |
| `atelier/docs/design-decisions.md` | 为什么这样设计（决策 0-28 + 未决项） |
| `atelier/docs/AI-OPTIMAL-STRUCTURE.md` | 六层 AI 友好结构公理与机检规则集 |
| `atelier/docs/ROADMAP.md` | 路线计划（方向与里程碑） |
| `atelier/docs/BACKLOG.md` | 缺口与改进执行队列（唯一源） |
| `atelier/docs/SKILLS-PLAN.md` | 技能包设计规格（已落地转规格） |
| `atelier/docs/research/` | 2026-09 三路深度调研（决策 17-23 证据基线） |
| `AGENTS.md` | 本仓库的常用命令与维护纪律 |

## License

MIT（见 LICENSE）。
