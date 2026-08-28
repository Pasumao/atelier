# Atelier v0.2 技术评估与竞品对照

> 口径：以当前工作区**实际交付物**为准（prototype 引擎 + atelier 工具链 + MCP/skills 层），证据分级【实测｜分析｜假设】。市场对照取 2026-02 时点公开信息；凡属未确认判断均标注 ⚠️。

## 1. 评估对象快照（有什么 / 没什么）

**已落地（可运行实证）**
| 域 | 内容 |
|---|---|
| 运行时内核 | `$state/$derived/$effect` 显式信号 + 微任务批处理 flush；显式读取订阅（无 Proxy 魔法） |
| 模板 | `html` 标签模板解释器：插值/{#if}{:else}/{#each}/事件具名函数/scoped style/tokens 注入 |
| 事务 | store 全量快照 checkpoint + rollback/timeTravel（$derived 自动豁免） |
| 契约 | 扁平 schema（reqProps/optProps，无 $ref/oneOf）：props 校验 ∪ MCP 参数 ∪ token 校验三用单源 |
| dev 面 | `/__atelier/*` 六端点：registry·tokens·docs·stream·bridge-state·screenshot |
| 检视桥 | 页面哨兵 effect → state.snapshot（15 信号实测）；瞬态 CDP 截图（74KB PNG 实测） |
| Agent 面 | stdio MCP server **21 工具（9 live 实达）**由 defs 单源生成；8 个技能包（dsh 实测热加载+调用）；structure.map/check 六层引擎本地计算 |
| 时间线 | checkpoint.mjs 决策15 双轨（git 锚 + backup tag + jsonl 审计）；工作区 5 事件实跑 |
| CLI v0.2 | init(FULL scaffold+agent 层) · struct/check/snapshot(mimi·MATCH 实测) · mcp/skills/checkpoint(FULL) · lint/test/e2e/build/package/review(STUB 诚实 exit4) |

**明确没有（≠有而不谈）**
- ❌ 编译器：H1「仅编译器改写调用图」的静态图改写为 **0%** —— 当前全是运行时解释
- ❌ 细粒度 DOM diff：`{#each}` 依赖变化即全清空重建（template.ts:407），无 keyed reconcile
- ❌ SSR/hydration、review UI、打包链路、audit.log/test.run 实现
- ❌ 性能实测（SPEC §7 四项基线一项未测）；仅 Windows/Edge 手测，无 CI 矩阵

## 2. 七维评估（等级：●优 ◐中 ○缺/未做）

| 维度 | 等级 | 依据与分析 |
|---|---|---|
| A 心智模型·首遍正确率 | ◐(假设) | 语法面极小+黄金代码+技能包补偿分布外风险；但 ⚠️ **新 DSL 不在 LLM 预训练分布**，与 React/Vue 海量语料相比是无实证的逆风——M3 对照实验是唯一裁判 |
| B 反应性·渲染 | ◐(现状) | 实测口径：**叶级细粒度**（textContent/setAttribute 各自 effect，template.ts:323/362）+ **块级重挂**（{#each} 全清重建无 key reconcile :407；模板无解析缓存）。混合策略可用但大列表/高频挂载场景落后 Vue keyed diff 与 lit-html Template 缓存一个身位；追赶路径 = 决策3编译器 + §15 借力清单（见 docs/TECH-COMPARISON.md） |
| C 契约·类型纪律 | ●设计 | 扁平 schema 一份三用（props/MCP/token），LLM 各厂商安全子集（规避 $ref/oneOf 支持碎片化）；别家同类能力散在 zod+代码生成两个独立环节 |
| D 错误·可恢复性 | ●(独特) | AtrError 四段式 + 每个 code 对应修法页 + fix 直连建议动作；**双轨时间旅行**（应用态快照 + git 源码锚/backup tag）内建为一等公民—— Redux DevTools time-travel 仅状态层且属外挂 devtools，无人覆盖源码轨 |
| E Agent 表面 | ●(核心差异化) | 见 §4 对照——该维度主流框架得分为零或接近零 |
| F 工程化成熟度 | ○ | v0.2 脚本态、单仓单人、无包发布、无 CI；诚实标注避免"demo 充产品" |
| G 性能 | 未测 | §7 目标（gzip≤30KB · 10³ nodes≤50ms · HMR≤100ms）全部待验；当前架构理论上限受解释器+重建策略压制 |

## 3. 主流框架对照（逐维度）

| 维度 | React19+Next | Vue3.5/Nuxt | Svelte5 runes | SolidJS | Angular21 | Elm | **Atelier v0.2** |
|---|---|---|---|---|---|---|---|
| 反应性 | VDOM+hooks 规则 | proxy 自动追踪 | 编译期 signals | 编译期细粒度 | zones/signals | Elm 架构 | 运行时信号(区块级更新) |
| 模板形态 | JSX | SFC/模板 | 近 HTML 模板 | JSX | HTML 模板 | ML | 近 HTML 标签模板 ✓ 同向 |
| Schema 契约 | 生态库(zod) | 库 | 库 | 库 | Forms/类型 | 类型系统 | **语言级扁平 schema 三用** |
| 错误文化 | dev overlay | 一般 | 一般 | 一般 | 一般 | **传奇级报错** | 四段式+码页+fix 动作 |
| 时间旅行 | devtools 外挂(态) | – | – | – | – | – | **双轨内建(态+源)** |
| Agent 工具面 | 生态拼装* | 少量 | llms.txt 只读 | – | agentic 辅助 | – | **21 工具单源+9 live 实达** |
| 项目结构守卫 | 社区约定 | 约定 | 约定 | 约定 | 约定严格但非 agent 向 | 严格 | **六层规则机检(WARN 不假红)** |
| 性能 | 强(先 compiler 后 RSC) | 强 | 强 | 最强梯队 | 中 | 强 | **未测** |
| 生态/成熟 | 最大 | 大 | 中 | 小 | 大 | 小而稳 | **零(实验)** |

\* React 的 agent 能力靠 Playwright/ChromeDevTools MCP、Storybook MCP、Vercel MCP **外部拼装**——工具面向部署/测试而非框架内核。

## 4. "近似 AI 向"玩家辨析（关键：赛道错位）

| 玩家 | 它做什么 | 与 Atelier 关系 |
|---|---|---|
| [Cedar-OS](https://github.com/CedarCopilot/cedar-OS)、[Tambo 1.0](https://www.80aj.com/2026/02/11/tambo-ai-react-ui/#respond) | **AI 原生前端组件层**：agent 为*终端用户*生成/渲染 React 组件（生成式 UI/chat 驱动界面） | 正交赛道：他们服务"agent 当 runtime"，我们服务"agent 当 developer"。无直接冲突，且他们的 agent 开发体验恰恰需要我们这类底座 |
| [Angular v21 agentic](https://avenkara.ai/blog/angular-s-agentic-renaissance-why-v21-is-the-framework-for-the-ai-era) | 大厂官方把 LLM 辅助/codegen 接进 CLI 与文档 | 同向竞速但途径不同：Angular 是十年框架补 agent 课，Atelier 从第一行就把 H1-H6 契约写给代理；其旧债(巨型心智模型)恰是我们回避的 |
| ServiceStack AI-First 模板、v0/Lovable | 模板/生成器层面"对 AI 友好"（prompt→app） | 停留在入口层与脚手架层；无运行时契约/事务/检视协议。覆盖我们六层模型的 ~1 层 |
| Playwright/ChromeDevTools/Storybook MCP | 通用浏览器与组件查询工具 | 替代我们的部分查询/截图面，但**框架无关=无内省深度**（不知晓组件契约/tokens/事务边界），也无所谓 source 双轨 |
| Svelte [llms.txt/AI docs](https://svelte.dev/docs/ai/mcp/llms.txt) | 只读文档暴露 | 我们 l1 入口层的等价物；无执行面 |

## 5. 结论：优势清单与代价

### 五个差异化优势（对手结构性难以快速跟进）
1. **内核级代理契约**：MCP 工具 schema 与组件 props 契约同源于一份扁平 schema；runtime 原生上报状态桥与截图——agent 面不是插件外挂而是内核器官。主流框架要做到同等深度须重排内核数据流。
2. **双轨时间旅行**：应用态 checkpoint 与 git 源码锚（backup tag 保未来）联合，覆盖"AI 多轮改坏了想退"的全场景；业内只有状态层方案。
3. **错误即指令**：ATR 码 + fix 字段 + 码页三位一体；配合 skills/errors 包让失败成为代理的下一步导航而非死胡同。
4. **结构公理机检**：六层 OK/WARN/INFO 分级门禁（WARN 不假红），init 出厂项目开箱通过——"好结构"从口头约定变成 CI exit code。
5. **发行形态即兼容**：skills 为 kebab-case 目录包双落点安装，dsh/Claude Code/Codex/Cursor 通吃，且 **dsh 运行时热发现已实测**；CLI/MCP/技能三层引用一致性由校验器强制（防文档漂移这一 agent 杀手）。

### 四个真实劣势（不粉饰）
1. 渲染短板：解释器 + 无 keyed each，大规模动态列表会疼；编译器（头号承诺）进度为零。
2. 分布外逆风：自有 DSL 缺预训练语料，首次正确率假设未获 M3 数据支撑——这是立项最大单点风险。
3. 生态真空：路由/表单/组件库/社区均为零；独立采用成本极高，现实路径只能依托 starter+agent 代劳。
4. 平台验证面窄：仅 Windows/Edge 实测，无跨平台 CI 矩阵，安全基线(token/审计)仍是纸面。

### 定位声明
> Atelier 不参与"更快地渲染"的主流竞赛——那个战场 Solid/Svelte 已足够好且无关代理。
> 它下注的是新维度：**当编码代理成为前端的第一类使用者时，框架本身应当内建契约、检视、恢复与结构公理。**
> 该维度在所有主流框架上的得分为零或近零，因为它们从未把这当作需求。

## 6. 可证伪指标（把本报告的主张放上断头台）

| 主张 | 指标 | 判据 |
|---|---|---|
| A 首遍正确率补偿有效 | M3 三任务 A/B（无 skill vs 有 skill） | ≥ +15pt 或绝对值 ≥60%（SPEC §7） |
| 性能可用 | 10³ nodes 渲染 / gzip / HMR | ≤50ms / ≤30KB / ≤100ms（当前架构大概率不达标→驱动编译器立项） |
| 结构公理有效 | 违规拦截率 in demo agents | struct ERROR 数 > 0 且全部对应真实缺陷（本轮已 2 例实证） |
