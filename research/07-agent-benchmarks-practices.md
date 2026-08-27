# 07 · 实证证据：哪些框架/代码结构让 AI 编程代理更成功

> 调研方式：~18 次 web_search 联网核实。**前提声明**：本领域"严格受控 A/B 实验"极少，大量结论来自基准(WebArena/SWE-WebDevBench/WebGen-V)、代理平台实测报告与一线工程讨论。下表对每条标注了证据强度（**实证=有可复现基准/对照**，**经验=社区工程共识**），据此区分"被证实"与"被广泛相信"。

## 一句话判断
**让 agent 更成功的不是"用了哪个框架"，而是"结构的可推断性与约束的可机器校验性"**：类型/契约单源、语义化令牌而非魔法值、可读源码而非黑盒依赖、单向声明式数据流、明确的文件/上下文边界。这些在多个基准（WebGen-V、SWE-WebDevBench）与大量失败案例中反复出现；反之，无约束自由格式、复杂隐式状态、深层黑盒依赖是主失败源。

## 实证表（基准 / 研究 / 结论 / 来源）

| 类别 | 基准 / 研究 | 关键结论（决定成败的结构因素） | 证据强度 | 来源 |
|---|---|---|---|---|
| 前端生成基准 | **WebGen-V Bench**（2510.15306） | 用**结构化表示**（分层设计 / 语义组件树）替代自然语言提示，可显著提升 LLM 网页生成质量与可评测性——直接支持"约束性 schema/结构比自由文本更利于 agent"论。 | 实证 | https://arxiv.org/pdf/2510.15306v1 |
| 代理平台基准 | **SWE-WebDevBench**（2605.04637，"virtual software agencies"） | 评估"编码 agent 应用平台"从自然语言到部署应用的端到端能力，平台间差异极大；规约/脚手架/产物结构的质量决定成败，而非模型单点。 | 实证 | https://huggingface.co/papers/2605.04637 ； https://scirate.com/arxiv/2605.04637 |
| Web 操作基准 | **WebArena**（2307.13854） | 衡量 agent *操作已有 Web 应用/站点* 的能力（表单、购物、内容管理），末端任务成功率仅~14–19%；关键在**可达 DOM 结构清晰、可定位性高**——语义化、可访问命名影响 agent 命中率。 | 实证 | https://ar5iv.labs.arxiv.org/html/2307.13854 |
| 代码能力基准 | **SWE-bench / LiveCodeBench / SWE-Gym** | 衡量通用代码修复/生成；前端仅是其子集。结论：**契约与测试可写性**越高，agent 越易被验证；无测试/无类型的目标使"完成"不可判定。 | 实证 | https://www.codesota.com/llm/coding-benchmarks ； https://www.datalearner.com/en/leaderboards/category/code |
| 框架对比 | **React vs Vue vs Svelte vs HTMX（实测讨论）** | 无严格受控实验。主流观点：**Svelte 编译期、规则少、无虚拟 DOM** 更利 agent 推导；**Vue 是 DSL 而非纯 JS**，模板语法/魔法偏多，agent 更易依赖其"约定"出错，故模型默认爱用 React；**HTMX 服务端渲染片段**复杂度最低、agent 介入面小、更可验证。 | 经验 | https://zackwebster.com/blog/why-svelte-is-better-than-react-in-the-ai-era ； https://blog.vibecoder.me/react-vs-vue-vs-svelte-vibe-coding ； https://guibai.dev/a/7661833071121530926/ ； https://claudify.tech/blog/claude-code-htmx |
| 失败模式 | **Vibe Coding 布局漂移 / 视觉 bug** | Agent 生成的界面在**视觉一致性、跨组件样式复用**上系统性失败；缺设计令牌约束时尤其严重。 | 经验 | https://overlayqa.com/blog/vibe-coding-problems/ ； https://overlayqa.com/blog/vibe-coding-qa/ ； https://cloud.tencent.cn/developer/article/2703642 |
| 失败模式 | **幻觉 API / 无限修复循环** | Agent 反复"修一个错引入两个新错"，**无类型/无 lint 强约束**时无限循环；Playwright/IDE 幻觉循环是典型案例。 | 经验 | https://codepup.ai/blog/escaping-infinite-fix-loop ； https://discuss.ai.google.dev/t/forced-ide-updates-wiped-workspaces-and-the-infinite-playwright-hallucination-loop/145691 ； https://goliathdynamics.com/vibe-coding-is-just-not-there-yet |

## 失败模式清单（附对策）

| # | 失败模式 | 症状 | 结构层面的根因 | 对策 | 来源 |
|---|---|---|---|---|---|
| 1 | **布局/样式漂移** | 每页视觉不一致、间距配色乱、组件难复用 | 无语义令牌；硬编码颜色值；重复内联样式 | 语义化 design token（YAML 定义语义令牌而非颜色值）＋规范化样式系统（Tailwind 约定） | https://developer.aliyun.com/article/1756098 ； https://cloud.tencent.cn/developer/article/2703642 |
| 2 | **不可维护** | 改一处处处崩，agent 来回"击鼓传花" | 无边界、无类型契约、隐式全局状态 | 类型即契约（TS 单源→schema）、单向数据流、小文件/模块边界（<~400 行/文件） | https://github.com/abczsl520/nodejs-project-arch ； https://github.com/mojoatomic/eslint-plugin-ai-code-snifftest/issues/77 |
| 3 | **幻觉 API/方法** | 调用不存在的库/接口，编译即错 | 契约不可机器校验；黑盒依赖 | 强类型＋lint 硬约束＋编译时类型错误即时反馈；schema 校验（zod/typebox） | https://ar5iv.labs.arxiv.org/html/2602.00180 ； https://github.com/Pluviobyte/ContractSpec |
| 4 | **无限修复循环** | 修一个错引入两个新错 | 无验收判据，agent 无法"确认完成" | spec-driven：可机器断言的用例/快照/截图文凭作为完成判据 | https://www.softwareseni.com/spec-driven-development-and-the-end-of-vibe-coding-what-engineering-leaders-need-to-know/ ； https://codepup.ai/blog/escaping-infinite-fix-loop |
| 5 | **上下文爆炸** | agent 越改越糊，丢失早期意图 | 上下文/记忆无边界 | 声明式项目上下文（AGENTS.md）、模块化分层上下文、显式 mem 边界 | https://aiproductivity.ai/news/claude-code-project-structure-real-world-tested/ ； https://dev.to/salt_creative/from-monolithic-prompts-to-modular-context-a-practical-architecture-for-agent-memory-1lcp |

## 既有 AI-native 框架结构设计对照

| 框架 | 为"代理操作"做的关键结构设计 | 共同点 | 来源 |
|---|---|---|---|
| **ArrowJS 1.0**（Justin Schroeder / FormKit） | 信号（signal）式响应、**无虚拟 DOM、纯类型、极简 API**、无框架税；重新定位为"代理时代首个 UI 框架"——目标正是让 agent 生成正确、可推导、结构简单的代码。 | 类型安全、推导简单、API 面小 | https://www.infoq.com/news/2026/06/arrowjs-v1-agentic/ ； https://github.com/justin-schroeder/arrow-js |
| **morph**（eumemic） | **stable-ID 组件 + View Transitions**：agent 通过"实时动画仪表盘"而非聊天记录通信，声明式、状态可稳定追踪。 | 可检查/可定位状态、结构化界面 | https://github.com/eumemic/morph |
| **cedar-OS** | 构建"AI-native 前端"框架，把 AI 从聊天窗解放为**状态感知 copilot**；面向 agent 的前端运行容器。 | 状态感知、agent 可追踪 | https://github.com/CedarCopilot/cedar-OS |
| **OpenTiny NEXT** | 明确给出 **web-agent 架构分层**（agent 编排 + 前端框架 + 设计系统），把"代理会操作的部分"显式分层，减少隐式耦合。 | 显式分层、契约边界 | https://docs.opentiny.design/web-agent/guide/architecture.html |

**共同模式**：① 类型/契约单源；② 状态可检查、可定位（stable-ID / 信号 / 快照）；③ API 与结构面小、反向与"魔法"；④ 显式分层/边界，减少 agent 需要跨层推断的范围。
**差异方向**：ArrowJS 与 cedar-OS 偏向"让 agent 生成正确代码"，morph 偏向"让 agent 的交互过程可观察"，OpenTiny NEXT 偏向"为 agent 建一个可编排的分层运行时"。两路线（生成正确 vs 过程可观察）值得未来融合。

## 源码即库与 CLI 形态（附注）
- **shadcn/ui = "源码即库"**：把组件以**可读源码**复制进项目而非黑盒依赖。refine/shadcn 分析指出核心机制是"**组件代码集成而非依赖**"——agent 可直接读、改、审，避免黑盒包不可见。这解释了它在 agent 时代高采用率。来源：https://refine.dev/blog/shadcn-blog/ ； https://ui.beste.co/blog/copy-paste-vs-library ； https://aiskill.market/blog/shadcn-ui-design-system-as-agent-knowledge
- **CLI 而非 IDE 是 agent 主界面**：agent 天然爱"声明式配置＋可脚本命令"，**shadcn/cli v4**、`create-*`、Tailwind 配置、registry 属于"纯文本可 diff 声明"，远优于依赖 GUI/IDE 状态。来源：https://ui.shadcn.com/docs/changelog/2026-03-cli-v4

## 未确认项标注
- **无**严格受控的、跨框架（React/Vue/Svelte/HTMX）让同一 LLM 生成同任务前端并测质量的 A/B 实验——目前都是社区讨论与间接推断（**未确证**）。
- **无**统一、可复现的"agent 可推导性"量化指标；WebArena/WebDevBench 测的是"agent 平台/Web 操作"而非"框架结构对 agent 的增益"（**未确证**存在专门度量）。
- 各 AI-native 框架（ArrowJS 1.0 / morph / cedar-OS / OpenTiny NEXT）内部设计细节多来自 README/文档，**未经第三方对照实验验证其相对优劣**（**未确证**）。
- Autonomy 边界（24h 无人值守、Devin/Replit 案例）多为现象级报告，**缺**稳定的失败率/成功率基线（**未确证**）。
