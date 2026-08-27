# 「为 AI 编程代理设计的新前端框架」生态调研

## 一句话判断
**没有已被市场验证的"直接竞品"**——这是一个刚被命名、主要由几个小型开源实验项目先行占领的新赛道（ArrowJS 1.0、cedar-OS、morph 等），而主流大厂仍停留在"React 组件库层"（assistant-ui、CopilotKit、Vercel AI SDK ai/rsc）与"协议层"（AG-UI / MCP-UI / A2UI）之争，**尚未出现被广泛采用的、面向代理的前端运行时本体**。

## 生态地图

| 类别 | 产品/项目 | 类型 | 技术栈 | 当前状态 | 来源 |
|---|---|---|---|---|---|
| 代理 UI 组件库 | Vercel AI SDK v5 | 库 | React, ai/rsc, Streamable UI, 新 agentic 架构 | v5 主线活跃，RSC 流式渲染 UI | [Sean Kim 深度解析](https://blog.imseankim.com/vercel-ai-sdk-5-streaming-tool-calls-rsc-agentic-architecture/)、[vercel/ai](https://github.com/vercel/ai) |
| 代理 UI 组件库 | assistant-ui | 库 | React + shadcn 风格组件 | 成熟开源，chat 场景 | [designrevision 替代清单](https://designrevision.com/alternatives/assistant-ui)、[GitHub](https://github.com/gabrielschmith/assistant-ui) |
| 代理 UI 组件库 | CopilotKit | 库 | React, agentic UI + AG-UI 协议 | 活跃，主推 AG-UI | [CopilotKit vs assistant-ui](https://champsignal.com/comparisons/copilotkit.ai-vs-assistant-ui.com)、[State of Agentic UI](https://webflow.copilotkit.ai/blog/the-state-of-agentic-ui-comparing-ag-ui-mcp-ui-and-a2ui-protocols) |
| 代理 UI 组件库 | Stream Chat（getstream）| 库 | 开源 AI assistant SDK | 活跃 | [GetStream AI 助手构建](https://getstream.io/blog/react-assistant/) |
| 描述→UI 生成器 | v0.dev | 产品 | React + shadcn/ui | 商业化运行 | [how v0 works](https://howworks.ai/blog/how-v0-works)、[v0 vs Lovable](https://vercel.com/i/v0-vs-lovable) |
| 描述→UI 生成器 | bolt.new | 产品 | StackBlitz WebContainers（浏览器内）| 商业化，$20M+ ARR | [PostHog 拆解](https://posthog.com/newsletter/inside-bolt-dot-new)、[skywork](https://skywork.ai/blog/what-is-bolt-new/) |
| 描述→UI 生成器 | Lovable | 产品 | React + shadcn + Supabase 后端 | 商业化 | [App builders under hood](https://webtwizz.com/blog/what-ai-app-builders-actually-use-under-the-hood)、[dev.to](https://dev.to/pickuma/boltnew-vs-lovable-two-ai-app-builders-two-very-different-philosophies-jhk) |
| AI 生成应用形态 | Claude Artifacts | 产品 | Anthropic；2025-06-25 扩展支持 AI 生成应用 | 已上量 | [ppc.land](https://ppc.land/claude-artifacts-expand-to-enable-ai-powered-app-creation/) |
| **新框架/运行时** | ArrowJS 1.0 | 框架 | 微型响应式 + **WASM 沙箱**，自称"代理时代首个 UI 框架" | 1.0 已发布，FormKit 创始人主导 | [InfoQ](https://www.infoq.com/news/2026/06/arrowjs-v1-agentic/)、[GitHub](https://github.com/standardagents/arrow-js) |
| **新框架/运行时** | cedar-OS | 框架 | 构建 AI-native 前端 | 早期开源 | [GitHub](https://github.com/CedarCopilot/cedar-OS) |
| **新框架/运行时** | morph | 运行时 | 声明式 agent-UI，stable-ID 组件 + View Transitions 活性仪表盘，**替代聊天转写** | 早期 | [GitHub eumemic/morph](https://github.com/eumemic/morph) |
| **新框架/运行时** | ainative / stratos | 框架 | LLM 驱动接口；agentic UI"vibe coding" | 早期 | [ainative](https://github.com/hari7261/ainative)、[stratos](https://github.com/ContextSphere/stratos) |
| **新框架/运行时** | OpenTiny NEXT | 框架 | 生成式 UI × MCP（企业级）| 发布中 | [华为云博客](https://bbs.huaweicloud.com/blogs/461443) |
| 协议层 | AG-UI / MCP-UI / A2UI | 协议 | 接口契约标准化 | 竞争初期 | [CopilotKit State of Agentic UI](https://webflow.copilotkit.ai/blog/the-state-of-agentic-ui-comparing-ag-ui-mcp-ui-and-a2ui-protocols) |
| 沙箱运行时 | StackBlitz WebContainers | 运行时 | 浏览器内 Node/WASM | 成熟 | [Madrona](https://www.madrona.com/investing-in-stackblitz/) |
| 沙箱运行时 | E2B | 运行时 | 云沙箱 VM，AI 代理执行 | $21M Series A，覆盖 88% F100 | [E2B 融资公告](https://e2b.dev/blog/series-a)、[VentureBeat](https://venturebeat.com/ai/how-e2b-became-essential-to-88-of-fortune-100-companies-and-raised-21-million) |

> 未确认项：**Yeyu**、**Lindy**（未找到对应产品/技术栈文章）、**CodeSandbox**、**Manus**（未获可靠架构文章）。均标"未确认"。

## 关键洞察
1. 赛道呈两极化：**组件库层成熟且以聊天为中心**（assistant-ui/CopilotKit/Stream），**"AI-native 前端框架/运行时"极早期**（多为单维护者单仓库实验，定位口号 > 实际采用）。
2. Vercel AI SDK 的 ai/rsc + Streamable UI 是主流"模型流式渲染 React UI"机制，但**被锁定在 React/Next.js**，属库而非独立框架——恰是空缺所在。
3. 真正的"所有权之战"发生在**协议层**而非框架层：AG-UI（CopilotKit 主推）、MCP-UI、A2UI 在争夺"代理与界面之间谁定义接口契约"。
4. 生成器（v0/bolt/Lovable）是**商业应用而非框架**；它们内部用 E2B/WebContainers 跑生成代码，恰好映射出"代理框架必须解决的沙箱问题"。
5. 沙箱运行时收敛为三模：浏览器内 WASM（WebContainers/ArrowJS WASM）、云端 VM（E2B）、及新兴端侧 WebGPU 推理——**无统一标准**，是自修改 AI UI 真正的架构瓶颈。
6. ArrowJS 1.0 值得关注：成熟作者（FormKit 创始人 Justin Schroeder）主动"重新定位"为代理时代框架，说明这是可被认真商业化的品类。
7. 多数 "AI-native framework" 仓库缺采用证据（stars/发布少），**定位先于现实**，需谨慎看待宣传。
8. Claude Artifacts 扩展（2025-06）+ "Software as Content" 论题表明：**"AI 生成应用"的产品侧正主流化，快于框架/工具侧**——把"代理渲染界面"的运行时缺口暴露出来。

## 空白机会点
- **框架无关的"代理→界面"声明式契约**：AG-UI 偏 CopilotKit 自研，MCP-UI 初期；无被共同采纳的标准层。
- **跨会话自修改 UI 的运行时本体**：morph 探索稳定 ID 组件 + View Transitions "活性仪表盘"，但无持久化/状态不变模型来"热切换"代理渲染 UI。
- **默认安全组件沙箱**：WASM/VM 隔离各家重造，缺"安全渲染代理 UI 组件"的标准原语。
- **非 React 或框架无关的代理 UI 运行时**：现有件几乎全部 React-locked（AI SDK RSC、assistant-ui、CopilotKit），这条未被占领。
- **人机控制权模型**：AI 生成的 UI 中"人类拥有什么、代理可变什么"（stable-ID 边界），有零星探索但无协议化标准。
