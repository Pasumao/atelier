# 《AI 编程代理优先的前端框架》前期调研报告

> 调研时间：2025–2026（联网核实）
> 调研方式：四路并行联网调研（生态竞品 / 底层技术栈 / Agentic DX 方法论 / AI 场景渲染与状态），全部经 web_search 实搜核实，未核实项已标注。
> 原始素材：`research/01-render-state-findings.md`、`research/02-agentic-dx-findings.md`、`research/03-tech-stack-findings.md`、`research/04-ecosystem-findings.md`

> **状态注**：本文为第一轮调研快照。文末"待拍板"的设计决策点（§8 下一步 1）已由 `design-decisions.md` 决策 0-15 拍板；技术基线表述（如 SSR 建议）以决策记录为准（决策 4 将 SSR 降为后期可选插件）。

---

## 0. 结论先行（TL;DR）

**定位一句话**：做一个**给 AI 编程代理用的前端框架**——框架的 API、契约、诊断、元数据全部面向机器设计（自描述、可推导、确定性、可回放）；人不再是"开发者"，而是"意图表达者与验收者"：描述想要的效果，AI 代理负责实现。

**赛道判断**：**没有已被市场验证的直接竞品**。现有生态两极——"React 组件库层"成熟但被 React 锁死（Vercel AI SDK / assistant-ui / CopilotKit），"AI-native 框架/运行时"极早期（ArrowJS 1.0、cedar-OS、morph 等小型实验，定位先于现实）。真正的关键战争发生在**协议层**（AG-UI / MCP-UI / A2UI 争夺"代理↔界面契约"定义权）。

**推荐技术基线**：自建信号内核（TC39 Signals 仅作未来适配层，现仍 Stage 2）+ 编译时细粒度响应式 + Web Streams 流式 SSR/渲染 + islands 部分水合 + `erasableSyntaxOnly` 类型剥离（Node/Bun/Deno 直跑 .ts）+ Vite 7（Rollup）基线 / Rolldown 1.0 备选 + WASM 仅作插件基座。

**七大设计支柱**（详见 §4）：

| # | 支柱 | 一句话 |
|---|---|---|
| 1 | 自描述内核 | 类型即契约：TS → JSON Schema → MCP 工具定义单源；框架自带 MCP Server，组件/约定/API 可被代理自查询 |
| 2 | 确定性执行 | 显式约定 > 魔法；无隐式上下文依赖；错误机器可解析（错误码+上下文+修复建议） |
| 3 | 可逆与回放 | 状态树 + checkpoint + commit/rollback；time-travel 是一等 API——AI 主开发者范式的前提是"改坏了能回退" |
| 4 | 流式一等公民 | StreamedValue/异步迭代器原语，废弃 useEffect 打字机；增量 JSON 解析器解决工具参数流式痛点 |
| 5 | 三态状态模型 | 流式 value + 增量 patch + 乐观回滚；会话建模为"消息树+分支+checkpoint+CRDT 历史" |
| 6 | 编译时响应式 | 自建信号内核 + 编译作用域追踪，换取 bundle 与性能红利（Svelte/Solid 路线） |
| 7 | 人机控制权模型 | stable-ID 组件边界：人锁定部分、代理可改部分；生成→渲染→断言验收闭环 |

**主要风险**：编译器维护成本、TC39 信号未定、沙箱三模异构、无统一 Agentic DX 方法论、赛道"定位先于现实"存在虚火（详见 §6）。

---

## 1. 定位与愿景

### 1.1 目标用户与视角转换

传统框架优化对象是**人类开发者**（可读性、记忆负担、心智模型）。本项目反其道：

- **主用户是 AI 编程代理**（Claude Code / Cursor / Codex / 自研 agent），人退居"产品意图者 + 验收者"。
- 衡量框架好坏的新指标：**agent 可推导性**——代理首次即正确使用 API 的概率、生成的代码可审阅性、错误时可恢复性。
- 人的体验 = "说几句 → 东西做出来"。这要求框架把**意图→代码→运行→验收**的闭环做短、做稳。

### 1.2 隐含需求推导

| 人的诉求 | 框架必须提供 |
|---|---|
| "想要什么效果"用自然语言描述 | 从意图到 UI 的生成路径短；框架本身文档/约定可被代理直接读取 |
| AI 做出来的东西可信 | 确定性行为；无魔法；行为可预测；可单元断言 |
| AI 做坏了能改回来 | 状态可逆、可回放、可 diff；组件 stable-ID 边界 |
| 生成过程中的 AI 中间态可见 | 流式渲染一等公民；增量更新；渐进披露 |
| 想介入时能介入 | 人机控制权显式化（哪些部分人锁定）|

---

## 2. 现状扫描：生态地图

### 2.1 直接竞品：尚无

**未被占领的核心空缺**：*框架无关的"代理→界面"声明式运行时本体*。现有方案几乎全部 React-locked（AI SDK RSC、assistant-ui、CopilotKit），而 AI-native 框架实验多为单维护者项目。

值得重点跟踪的竞品：

- **ArrowJS 1.0**：FormKit 创始人 Justin Schroeder 主导，微型响应式 + WASM 沙箱，自称"代理时代首个 UI 框架"——**最接近本项目定位**，且作者成熟，需认真对待。
- **morph**：声明式 agent-UI，stable-ID 组件 + View Transitions"活性仪表盘"，主张替代聊天转写（launch 页面而非聊天流）。
- **cedar-OS / ainative / stratos / OpenTiny NEXT**：早期实验，定位口号为主，缺采用证据（"定位先于现实"）。

### 2.2 生态地图（四层）

| 层 | 代表 | 状态 | 对本项目的启示 |
|---|---|---|---|
| 代理 UI 组件库 | Vercel AI SDK v5（ai/rsc + Streamable UI）、assistant-ui、CopilotKit、Stream Chat | 成熟、React 锁死 | 借鉴流式 UI 原语；但库不是框架，框架空缺仍在 |
| 描述→UI 生成器 | v0.dev、bolt.new、Lovable、Claude Artifacts | 商业化、增长快 | 证明市场需求；它们的技术栈=生成代码+沙箱运行，正是我们要解决的运行时问题 |
| AI-native 框架/运行时 | ArrowJS 1.0、morph、cedar-OS 等 | 极早期、实验性 | 直接竞技场；竞品之间尚无差异化壁垒 |
| 协议层 | AG-UI（CopilotKit 主推）、MCP-UI、A2UI | 竞争初期 | **真正决定生态位置的战场**；新框架宜主动参与/定义协议 |

### 2.3 空白机会点

1. **框架无关的代理 UI 声明式契约**（对标当年 JSX 先于框架获胜的路径）。
2. **跨会话自修改 UI 的运行时本体**：稳定 ID + 状态不变模型支撑"热切换"代理重渲染。
3. **默认安全的组件沙箱原语**：WebContainers（浏览器内 WASM）/ E2B（云端 VM）/ 端侧 WebGPU 三模异构、各有重造，**无统一标准**。
4. **人机控制权模型协议化**："人类拥有什么、代理可变什么"尚无标准。
5. **统一"流式 value + 增量 patch + 乐观回滚"三态原语库**——目前的打字机方案是框架羞耻。

---

## 3. 技术选型矩阵

> 详细依据见 `research/03-tech-stack-findings.md`。标注 **★** 为推荐采纳项。

| 领域 | 选项 | 2025–2026 现状 | 采纳建议 |
|---|---|---|---|
| 响应式内核 ★ | 自建信号 + TC39 适配层 | TC39 Signals **Stage 2（未确认进 Stage 3/4）**；Svelte 5 runes / Solid / Preact / Angular 各自实现，调度语义不统一 | 自建内核、明确脏标记/批处理语义，预留标准 Signal 透传接口；**不押注标准落地时间** |
| 编译策略 ★ | 编译时细粒度响应式 | Svelte 5 编译 runes、Solid 编译+运行时、Vue Vapor（3.6 alpha）、React Compiler 1.0（2025-10 稳定） | 走"编译时作用域追踪"路线（性能红利），但**评估编译器维护成本**——建议"选择性编译"，避免全编译器负担 |
| 构建链 ★ | Vite 7 + Rolldown 备选 | Vite 7 默认仍 Rollup；Rolldown 1.0 已发布、Vite 8 beta 信号默认 Rolldown；Oxc 增长中 | Vite 7（Rollup）为稳健基线，Rolldown 1.0 作性能备选并提前做插件兼容测试；**勿以未默认的 Rolldown 为唯一依赖** |
| 类型系统 ★ | erasableSyntaxOnly + 类型剥离 | TS 6.0 破坏性默认值；**TS 7.0 = Go 原生重写（tsgo），计划 2026 年初交付**；Node/Bun 1.3/Deno 2 可直跑 .ts | 强锁 `erasableSyntaxOnly`，保证 .ts 可直接执行；把 tsgo 当升级通道，避免重型转译链 |
| SSR/渲染 ★ | Web Streams 流式 + islands | streaming SSR + Suspense 标配；Web Streams 广泛落地 | Web Streams 作为统一传输层；**默认部分水合/islands；内建 View Transitions API** |
| 服务器驱动 UI | HTMX/LiveView 思路 | 2025 仍活跃，与客户端水合并行 | 作**可选模式**（低交互/高延迟场景），而非默认 |
| 状态 ★ | 树+分支+checkpoint + 三态模型 | 线性数组→"树/分支/checkpoint"（LangChain branching、Cloudflare）；乐观回滚组件化（hx-optimistic） | 会话与应用状态统一为"消息树+分支+checkpoint"；增量 patch + 乐观回滚三态原语 |
| 协作 | CRDT（Yjs/Automerge） | 研究转生产 | 仅协作场景使用；**不与逐 token 流式混用**（合并语义冲突） |
| 流式原语 ★ | StreamedValue / AsyncIterable | React use() + Suspense + AI SDK 已提供 | 框架原生提供流值原语 + **浏览器端增量 JSON 流解析器**（工具参数流式是最大痛点，后端常整体缓冲） |
| 互操作 | Web Components | 原生成熟，整框架采用少 | 仅作跨框架边界，不作核心数据流基底 |
| 插件/扩展 | WASM（GC/JSPI/组件模型） | Wasm GC 成熟；JSPI 跨浏览器推进中；组件模型前沿（有 CVE-2025-5959 安全事件） | 仅作插件/运行时扩展基座；不进核心依赖 |
| 端侧 AI | WebGPU/WebNN + WebLLM/Transformers.js 4.0 | 可跑但受限（内存/量化/设备兼容、WebNN 达标率未确认） | 作可选推理抽象（统一流式接口后接端侧或云端，按能力降级），非核心 |

---

## 4. 核心架构建议：框架的灵魂设计

### 4.1 自描述内核（Agent Introspection Layer）—— 本项目最大差异化

- **类型即契约**：TS 类型为单一真相，自动生成 JSON Schema / MCP 工具定义 / 运行时校验（先例：schema-forge、LlamaIndexTS Autotool）。
- **框架自带 MCP Server**（先例：Storybook MCP）：暴露组件清单、组件 schema、框架约定、API 文档、模板——代理可**自发现**一切，消除隐式上下文依赖（"面对面 LLM 的 API 首要瓶颈是发现"）。
- **AGENTS.md / CLAUDE.md 生成向导**：项目初始化时自动生成机器可读的项目约定文件，跨代理共享。
- **约定即数据**：设计 token、组件命名、状态模型用 JSON 表达，而非散落文档。
- **约束表达结构化**：代理"忠实遵从约束"是盲区——约束应写成可校验的机器规则（lint/类型/测试三重夹逼），而非仅自然语言说明。

### 4.2 确定性执行

- **显式约定 > 魔法**：禁止隐式魔法（自动注入、隐式上下文），每个效果都有显式声明；魔法是 agent 出错高发源。
- **可预测命名与结构**：与 LLM 高频词表对齐；命名即文档。
- **错误机器可解析**：统一错误对象 `{ code, message, context, fix }`；结构化诊断（不是人看，是 agent 看）。
- **确定性构建**：可复现构建、可 diff 的产物；生成的 UI 有规范化约束（lint 防"vibe 乱码"）。

### 4.3 可逆与回放（Reversibility）

- 状态树 + **checkpoint**；commit/rollback 原生语义（先例模式：agentharness 的可检查/可重放状态机）。
- **time-travel 一等 API**：agent 长会话调试的关键——回放/中断恢复/分支回溯写进框架而非之外。
- **版本化 UI 状态**：代理每轮修改产生可 diff 的版本代际，人类可"回到上一版"。

### 4.4 流式与增量渲染原语

- **StreamedValue / AsyncIterable 一等公民**：取代 `useEffect` 拼字符串的打字机 hack（现有实践：AI SDK Streaming Values）。
- **增量 JSON 流解析器**：直接对接 tool-call / structured-output 的 token 流（当前生态最大痛点：后端整体缓冲 arguments，vllm #47998）。
- **三态模型原语**：`streaming value / incremental patch / optimistic rollback` 三位一体，保持单一事实源（回滚/重放顺序确定）。
- 取消与中断：AbortController 语义内建，interrupt 后恢复。

### 4.5 人机控制权模型（Human-in-the-loop）

- **stable-ID 组件边界**：组件有稳定标识（先例：morph），人可声明"锁定区"，代理只在解锁区修改——控制权显式化，而非靠 prompt 祈祷。
- **意图→产物→验收闭环**：框架提供断言原语（结构/视觉/交互），代理生成后跑验收脚本，形成可证明的完成定义。

### 4.6 沙箱与安全

- 代理生成的代码如果在**运行时**被执行，必须沙箱化：WebContainers（浏览器内）/ E2B（云 VM）/ WASM 三模，按场景选择；**框架默认提供"安全渲染"路径**（渲染代理输出的 UI 数据而非任意代码）。
- 默认 CSP、最小权限；把"安全渲染代理 UI 组件"做成标准原语——这是生态空白。

---

## 5. 可直接吸收的既有模式

| 模式 | 出处 | 吸收方式 |
|---|---|---|
| 源码即库 | shadcn | 组件/约定以**源码分发给代理**（agent 爱读源码而非黑洞包）——影响组件分发形态 |
| 框架自描述 | Storybook MCP | 框架自带 MCP Server 暴露组件与约定 |
| 项目记忆 | AGENTS.md / CLAUDE.md | 自动生成跨代理共享的项目约定文件 |
| 乐观回滚组件化 | hx-optimistic、Phoenix syncing-changes | 三态模型中的乐观/回滚原语 |
| 流值原语 | AI SDK StreamedValue | 流式值抽象（框架无关化） |
| 服务器驱动 UI | LiveView / HTMX 融合 | 可选模式，SSE+差分更新 |
| stable-ID + 活性仪表盘 | morph | 组件稳定标识 + View Transitions 平滑切换 |
| 代理框架定位 | ArrowJS 1.0 | WASE 沙箱 + 微型响应式；也是要防的竞品 |
| 会话树 | LangChain branching / Cloudflare compaction | 消息树+分支+checkpoint 数据层 |
| 端侧推理 | WebLLM / Transformers.js 4.0 | 统一推理抽象的可选后端 |

---

## 6. 反模式与风险

| 风险 | 说明 | 对策 |
|---|---|---|
| 押注 TC39 Signals | 仍在 Stage 2 | 自建内核 + 适配层，不赌标准 |
| 全编译器成本 | Svelte 5/React Compiler 证明可行也证明难 | 选择性编译；核心运行时先行 |
| 定位先于现实（虚火） | AI-native 框架多为单维护者实验 | 尽早做可测 demo 与真实用例验证 |
| 工具参数流式落差 | 后端整体缓冲 arguments | 定协议时明确增量 JSON 规范，前端原语+后端适配器 |
| 沙箱异构 | WebContainers/E2B/WASM 三模无统一 | 抽象沙箱接口层 |
| CRDT×流式冲突 | 合并语义与逐 token 追加冲突 | 状态分层：流式层（追加）+ 持久层（CRDT 可选） |
| 无成熟方法论 | Agentic DX 无统一规范、无可测"可推导性"指标 | 自定 Agentic DX 规范 v0.1 并版本化；建立内部基准（agent 首遍正确率） |
| 可读性塌方 | AI 生成 UI 风格漂移 | 编译期/运行时规范化约束 + lint 强制 |
| WASM 前沿安全性 | 组件模型有 CVE-2025-5959 | 插件基座隔离，不进核心 |

---

## 7. 推荐路线图

### Phase 0 —— 验证与立规（2–4 周）
1. **框架 DNA 文档**：定位、非目标、七大支柱、设计原则（一页纸 + ADR 模板）。
2. **Agentic DX 规范 v0.1**：自描述、错误格式、命名约定、确定性规则——先立"机器契约"。
3. **最小原型**（可部署 demo）：信号内核微内核 + 一个流式渲染原语（StreamedValue + 增量 JSON 解析器）+ MCP Server 草稿（暴露组件注册表）。

### Phase 1 —— 最小闭环（1–2 月）
4. 渲染器 + 编译器骨架（选择性编译）+ 类型即契约工具链（TS→Schema→MCP）。
5. **杀手级验证场景**：用户用自然语言描述一个 widget（如"AI 对话卡片：流式输出+工具调用卡片+可回退"），代理借助 MCP Server 自查询 API，生成组件→渲染→断言通过。测量**首遍正确率**。
6. 状态树 + checkpoint + commit/rollback 雏形。

### Phase 2 —— 完整化（2–3 月）
7. 三态模型 + 会话树/分支 + time-travel 回放 API。
8. 沙箱抽象层（安全渲染 + 运行时隔离）。
9. stable-ID 人机锁定模型；模板/组件源码库（源码即库分发）。

### 关键验证指标
- **agent 可推导性**：自然语言任务首遍正确率（对比用错/返工次数）。
- **回放可靠性**：checkpoint/回滚后 UI 状态一致性。
- **可审阅性**：生成代码 diff 的可读性评分。
- **性能**：bundle 体积、首屏（相对 React/Solid 基线）。

---

## 8. 未确认事项与下一步

**未确认**：TC39 Signals 精确 Stage；JSPI 跨浏览器落地进度；WebNN 浏览器达标率；端侧模型显存/量化阈值；CRDT 与逐 token 流合并最优解；Bun/Deno 具体小版本。均不影响本次结论。

**下一步建议**：
1. 与用户确认 4–6 个关键设计决策点（如：运行时是否执行代理生成代码 or 仅渲染 UI 数据？框架是否下沉到协议层参与 AG-UI/MCP-UI 竞争？编译器自研 or 复用 SWC/Oxc？）。
2. 同步跟踪 ArrowJS 1.0 与 morph 的动态（竞品雷达）。
3. 启动 Phase 0（框架 DNA + Agentic DX 规范 v0.1 + 最小原型）。
