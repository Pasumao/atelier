# 全站化调研原始报告归档（2025-2026 检索口径）

> 性质：《FULLSTACK-DESIGN.md》的三份原始调研报告全文归档（三路并行子代理产出），供设计书结论溯源。事实均来自公开检索；不确定处各报告内已标注。

---
---

# 报告一：现代前端框架（2025-2026）

## 一、React 19+ / Next.js 15–16 / Remix→React Router 7

**现状**：React 19（2024-12 stable）落地 Server Components（RSC）、Actions、`use` API、ref as prop；19.2（2025-10-01）加入 `useEffectEvent`、`cacheSignal`、Performance Tracks、Partial Pre-rendering、流式 SSR 批量 Suspense reveal。注意：2025-12 披露了影响 RSC 的多个严重漏洞（含 RCE，19.0.0–19.2.2 受影响），RSC 序列化协议是新的攻击面。React Compiler 已稳定，自动 memo 化。Next.js 16（2025-10-21）：Turbopack 默认（构建 2–5× 提升）、Cache Components（`"use cache"`）取代 PPR 实验、内置 React 19.2、codemod 化升级。Remix 已于 2024-12 正式并入 React Router 7 "Framework Mode"（loaders/actions/SSR/类型安全路由）；Remix 品牌宣布回归为独立项目，v3 具体形态仍在演进（未确认）。

**架构思想**：运行时 VDOM + 编译器优化；`"use client"` 边界标注；数据流 = RSC payload 序列化。

**AI 友好度**：最高——语料最多、JSX 通用、类型推断成熟；但 RSC 边界与缓存指令是幻觉高发区；App Router 缓存语义多变，规则漂移伤 AI。

**可借鉴**：Server/Client 二分心智模型、codemod 化升级。**应避免**：缓存语义频繁翻转、隐式序列化边界、RSC payload 二进制化不利于模型静态推理。

## 二、Vue 3.6（Vapor）/ Nuxt 4

**现状**：Vapor Mode 是编译期策略——不生成 VNode、不做 diff，编译器生成直接操作 DOM 的代码；2025-12-23 发布 3.6.0-beta.1，官方宣布 Vapor 达成与 VDOM 模式（除 Suspense）的功能对齐；截至 2026 年中仍为 RC/opt-in（stable 日期未确认）。Nuxt 4（2025-07）引入 app/ 目录重构与 shared/ 类型安全数据层。

**架构思想**：运行时细粒度依赖收集 + 可选编译时消除 VDOM；SFC 模板 DSL。

**AI 友好度**：模板指令规则明确、语料第二充足；Vapor 造成"一组件两产物"心智；响应式 API 类型推断好于 hooks。

**可借鉴**：模板 DSL 强结构利于解析；编译期"同语义、双产物"渐进落地。**应避免**：opt-in 模式长期并存导致文档/示例分裂、AI 混用两套写法。

## 三、Svelte 5 / SvelteKit 2

**现状**：Svelte 5 用 runes（`$state`/`$derived`/`$effect`/`$props`）统一响应式、可移植到 `.svelte.ts`；SvelteKit 2 内置 store 迁移为 runes 版 `$app/state`。实证：社区 benchmark 显示 LLM 写 Svelte 5 明显弱于 React——大量回退 Svelte 4 语法或幻觉 runes 用法。

**AI 友好度**：负面教材——大改造成"S4 vs S5"双峰语料，混写出错率高；隐式响应式类型推断弱于显式 signal。

**可借鉴**：runes 显式化方向正确。**应避免**：破坏性语法重写生态示例语料；隐式与显式 API 混杂。

## 四、SolidJS 2 / SolidStart

**现状**：1.9.x 仍为稳定版；Solid 2.0 已 RC：`createResource` 移除（async 直接进响应式图）、`batch`/`startTransition` 移除（天然 microtask 批处理 + `flush()`）、split effects（compute 与 apply 分离）、新 Loading/Errored 边界、Rust 编译器（Oxc，宣称最高 355×）、Vite 插件 "Start 模式"取代独立 SolidStart。2.0 正式版未确认。

**架构思想**：最纯粹的细粒度信号 + 无 VDOM 的 JSX；组件函数只运行一次。

**AI 友好度**：JSX 语义反直觉（解构 props 失响应、一次执行），语料小；连续两个大版本重写 API 面是教训。

**可借鉴**：async 进信号图简化异步；split effects 提高可静态分析性。**应避免**：JSX 偏离 React 直觉的隐性陷阱；核心 API 连续重写。

## 五、Qwik / Astro

**现状**：Qwik 主打 resumability——SSR 后不 hydration，执行状态序列化进 HTML，按需懒加载 handler；Qwik 2.0（core 重写）处于 beta，stable 未定。Astro 5：islands + Server Islands（占位符+独立请求注入）、Actions、Sessions、Content Layer；有 @qwikdev/astro 实验集成。

**AI 友好度**：Qwik 的 `component$`/闭包序列化约束是高幻觉区；.astro 模板接近 HTML，生成容易但岛间边界需规则。

**可借鉴**：resumability 对"代理反复接管会话"极具隐喻价值（状态显式序列化而非重放）；islands 隔离交互与静态。**应避免**：$ 闭包约束难以被模型内化。

## 六、Angular

**现状**：Angular 20（2025-05）Signals、incremental hydration、新控制流转正；Angular 21（2025-11-20）**zoneless 默认**、Signal Forms（experimental）、Vitest 取代 Karma、**CLI 内置 MCP server**——AI 工具链最激进的框架厂商。

**AI 友好度**：样板大但规则极明确、错误信息质量业界最佳、类型安全最强。

**可借鉴**：CLI 内置 MCP、migration analyzer（给代理可执行的迁移 SOP）、信号即显式依赖。**应避免**：多层样板增加 token 成本与遗漏点。

## 七、轻量/新锐：Preact、Lit、Alpine、htmx

**现状**：Preact 10 稳定（signals 被 Lit/TC39 借用）；Lit 3 稳定；Alpine 3 小版本迭代（最新版号未确认）；htmx 2.x 稳定，HDA 理念成熟：HATEOAS、服务端片段、事件通信、islands 隔离。

**AI 友好度**：htmx/Alpine 生成的是 HTML——无运行时心智、后端模板即真相源、调试面小，对 AI 极友好；代价是富交互表达力天花板。

**可借鉴**："HTML 为契约、少一层客户端状态"可验证事务式交互缩小出错面；应配 islands 混合以补表达力。

## 八、TanStack（Start/Query/Router）

**现状**：Start v1.0 RC（2025-09-23），正式 1.0 未确认；类型安全全栈：文件路由 + server functions + Query 请求状态机；与 Cloudflare、Prisma 官方合作。

**架构思想**：不发明渲染模型，纯 TS 端到端类型推断、无 codegen。

**可借鉴**：全链路类型可作为 AI 验收 harness；server functions"单函数即 API"减样板。**应避免**：RC 期 API 漂移。

## 九、横向综合

1. 显式优于隐式：显式依赖图才能被静态验证。
2. 语料分布即框架命运：破坏性语法重写致模型"时代错乱"；新框架要么贴 React 语义，要么配大规模技能包补偿。
3. 类型即验收 harness：让任何错误坍缩为类型错误或可执行断言。
4. 超媒体路线值得一等公民：可验证事务缩小出错面。
5. 状态显式序列化：代理接管应读快照而非重放。
6. 迁移 SOP 工具化。
7. 应避免：语义频繁翻转、隐式序列化魔法（RSC 安全事件）、难内化的转译规则、多套并行语法长期并存。

**不确定项**：Vue 3.6 stable 日期、Qwik 2.0 stable、TanStack Start 1.0 正式版、Remix v3 形态、Alpine 最新版本号。

---
---

# 报告二：现代后端/Web 服务框架（2025-2026）

## 0. 总纲：两条路线对 AI 代码生成的影响

- **约定优于配置**（Rails/Laravel/Phoenix/Loco）：AI 生成友好度极高——命名即路由、生成器产出符合惯例的完整切片，"单文件上下文即可预测全局结构"。坑：约定背后有大量隐式魔法（自动加载、concern、回调链），AI 在"偏离惯例后如何修"时容易幻觉出不存在的钩子。
- **显式扁平**（Hono/FastAPI/Fastify/Elysia）：每个文件自解释，import 即真相，AI 首遍正确率高、错误信息直白。坑：样板量由 AI 承担（恰好是 AI 的强项），但缺全局约定时 AI 需项目级规范文件补齐架构决策。
- **综合启示**：两者不互斥——"显式的内核 + 生成器注入的约定切片"（Phoenix 路线）是 AI 时代最优解。

## 1. Node / Bun / Deno 系

- **Hono**：Web 标准 API 优先，全运行时可移植；零依赖小内核 + 中间件生态。借鉴：单一 Request/Response 抽象 + 多运行时可移植；坑：生态胶水（认证/ORM/DI）全自组装。
- **Fastify**：JSON Schema 一等公民（schema 即验证+序列化+文档三用）；插件作用域是隐式魔法来源。
- **Express 5**（2024-10）：路径语法收紧、promise 拒绝自动转发；生态存量稳态；4/5 新旧混杂致混淆错误（社区报告，未系统统计）。
- **Elysia**（Bun 系）：端到端类型推导到 Eden client，等效"内置 tRPC"；借鉴：类型契约做进框架核心；坑：语料少、API 版本易错。
- **Nitro/H3**：文件路由 + 可移植部署 preset；借鉴：部署 target 作为编译期配置。
- **Bun.serve**：框架功能下沉运行时的极限形态，属底座。
- **Deno Fresh 2**：islands + 默认零 JS；热度偏低（未核实）。借鉴：默认 no-JS 性能底线。

## 2. TS 元框架后端面

- **Next Route Handlers / Server Actions**：RPC+表单+渐进增强压成一个 async function；隐式约定多、版本敏感。
- **Nuxt server routes / Nitro**：文件即 API，约定清晰。
- **SvelteKit form actions**：表单优先全栈的干净范式——显式、少魔法、AI 首遍正确率高。
- **Remix loaders/actions**：web 原语当 API 模型；借鉴：**loader/action 二分（读/写）是极适合 AI 的心智模型**。

## 3. 类型安全 API 层

- **tRPC**：procedures + Zod，端到端类型零 codegen；坑：与 OpenAPI 世界隔离。
- **oRPC**（2025 崛起）：对标 tRPC，原生 OpenAPI、多运行时；较新，语料少。
- **Schema-first**（NestJS 等）：装饰器/DI 是隐式魔法重灾区；借鉴：契约单源向 AI 工具与 OpenAPI 双向导出是 TS 全栈共识。

## 4. Python 系

- **FastAPI**：类型注解即 schema，自动 OpenAPI，显式 DI——"AI 友好"教科书。
- **Django 5**：admin+ORM+迁移一条龙；魔法密度双刃剑（常见模式正确率高，非常见组合易错）。
- **Litestar**：FastAPI 工程化修正版（更快、显式 DI、分层引导）；语料少。借鉴：框架引导"正确项目分层"。

## 5. Go 系

- **net/http 1.22+**：无框架 Go 成主流；显式零魔法，AI 正确率极高。
- **Echo/Fiber/Gin**：API 相似度高，AI 可互替换位。
- **sqlc / Ent**：sqlc = "SQL 即类型源"，对 AI 生成特别友好；借鉴：数据层选"SQL/契约单源 + 生成"而非运行时魔法 ORM。

## 6. Rust 系

- **Axum 0.8**：无宏路由、extractor 即校验、类型安全天花板；但编译期错误信息对 LLM 不友好。
- **Loco.rs**："Rust 上的 Rails"，生成器+scaffold；借鉴 auth 生成器与 starter 思路；语料极少。

## 7. Rails 8 / Laravel 11–12

- **Rails 8**：Solid 三件套（SQLite 替代 Redis 全家桶）、内置 authentication 生成器（明文可读可改）、Kamal 2；"无构建、无 PaaS、无 Redis"。AI 友好度极高：生成器产出普通代码。
- **Laravel 11/12**：11 瘦身；12 维护版 + 官方 starter kits；魔法密度高于 Rails。
- 共同启示：**全栈一条龙的竞争力在"生成器 + 可读产物"**。

## 8. Phoenix 1.8 / LiveView

服务器驱动 UI 天花板：WebSocket + 服务端 diff。1.8：phx.gen.live、phx.gen.auth（magic link + sudo mode，代码更少）、新核心组件集。**生成器思路是最重要样本**：输出展示性最佳实践代码，降级路径清晰。服务端驱动 UI + 生成器切片 = AI 全栈生成天然高正确率组合（状态收敛服务端一处）。

## 9. 数据库 / ORM 层

- **Drizzle**：贴 SQL、无查询引擎、无 codegen 步骤——AI 友好度高（2026 Q1 周下载约 500 万级，第三方数字未核实）。
- **Prisma**：工程成熟但多步 generate 流程是 AI 出错点。
- **Kysely**：纯类型化 SQL 构造器。
- **共识**：Drizzle 因贴 SQL、少步骤、少魔法更受 AI 工作流青睐。

## 10. 部署形态

Serverless/Edge 多 target；Kamal 2 自托管复兴；**SQLite 复兴**（Turso embedded replicas、Litestream、Rails Solid）——"每个请求本地读"+简单复制 = 可预测数据层、极低运维面。

## 11. 综合建议

1. 显式扁平内核 + 生成器注入约定；2. 契约单源向 MCP 与 OpenAPI 双向导出；3. 读写二分心智模型；4. 数据层 SQL 显式派；5. 服务器驱动 UI 需评估信号引擎与 SSE/WS 桥整合成本；6. 单容器+SQLite 默认，serverless 作编译期 target。

---
---

# 报告三：全栈框架与 AI 导向开发（2025-2026）

## A. 全栈框架横向

- **Next.js 16**：一体化最强但心智复杂；React2Shell（CVE-2025-55182）证明序列化边界即攻击面；"use client" 边界是 AI 幻觉重灾区。
- **Nuxt 4**：server/api → 客户端类型自动推导（"零 schema 端到端类型"）；坑：自动导入隐式性让 AI 难定位符号来源。
- **SvelteKit 2**：`PageData` 自动生成类型、`+server.ts`/`@transfer` 显式边界；坑：S4/S5 语料过渡期。
- **TanStack Start**（v1 RC）：全类型路由树 + server functions 强制 schema 校验——对 AI 最友好的显式契约形态。
- **SolidStart**：内核好≠全栈好，语料稀少会被 agent 生态排除。
- **Astro 5**：islands + Server Islands；"默认零 JS"防过度工程。
- **Remix/RR7**：loader/action 显式数据流；教训：品牌/API 摇摆伤害生态与语料一致性。
- **Encore.ts**：后端源码生成 OpenAPI/类型化客户端——单一真相源全链路类型最佳实现之一；坑：runtime/云锁定。
- **Wasp**：DSL 单文件意图清单 + 极小 API 面，agent 只改业务文件；坑：DSL 是语料盲区。
- **RedwoodJS**（2025-04 收尾）：教训——概念过多是负债，AI 时代复杂度预算大幅收缩。
- **AdonisJS 6**：显式少魔法的古典路线依然可维护性强。
- **Tauri 2 / Electron**：sidecar/IPC 本地后端应为一等能力。

## B. AI/agent 导向开发实践

1. **llms.txt**：仍是提案非标准；Anthropic/Perplexity 读取，Google 拒绝；作内容地图部分有效，作 SEO 无效——低成本生成可以，不作唯一依赖。
2. **指令文件**：AGENTS.md 成为事实标准（Codex/Cursor/Copilot/Jules/Amp/Zed 等）；分层发现已文档化；arXiv 2601.20404 初步研究效率影响。框架应把规范文件定义为 init 产物。
3. **MCP**：官方 Registry 2025-09 上线；2026-05 实测 9,652 条 latest 记录；**2025-11-25 规范**：Tasks（异步任务句柄）、URL Elicitation、Sampling with Tools、Extensions 协商、client credentials、Streamable HTTP——MCP 已是异步、可交互、可审计的 agent 基础设施。
4. **失败模式**：包幻觉（USENIX 2025：商业模型 ≥5.2%，205,474 个虚构包，slopsquatting 投毒面）；隐式约定不遵守（React 以 eslint+compiler 编译期捕获）；过度生成（收敛 API 面/结构地图应对）；验证缺失（闭合回路：schema 边界校验、端到端类型、lint/test 回喂）。
5. **AI 应用框架**：Vercel AI SDK 5（stopWhen/prepareStep/schema 化工具——agent 原语下沉内核）；LangGraph 重但可控；Mastra TS-first（~300K 周下载，第三方统计）；共性 = workflow 编排 + 持久 memory + 类型化工具注册 + tracing。
6. **AI 原生尝试**：v0；Builder.io Fusion 1.0（尊重现有代码库上下文）；共识："源码即上下文"——最小化 agent 需读的文件数与隐式知识。
7. **测试回路**：Playwright MCP 成标准通道；Vitest Browser Mode；视觉回归禁自动晋升；共识 = 确定性断言 + 少文件定位 + 机器可读输出。

## C. 十条提炼启示

1. 显式边界优先于魔法；2. 最小可数 API 面；3. 单一真相源驱动类型贯通；4. 规范文件是框架产物（文档漂移即 bug）；5. 结构地图机器可读 + API 面快照门禁；6. dev 面即 MCP server（不造自有协议）；7. 防包幻觉（锁定依赖 + 内部模块 import 校验）；8. 验证回路内置（机器可读结果回喂）；9. agent 原语下沉内核（"被 agent 用"与"构建 agent 应用"共享原语）；10. 演进纪律（API 面稳定、codemod 兜底、概念不反复重命名）。
