# 调研报告三：全栈框架与 AI/Agent 导向开发生态（2025H2–2026）

> 性质：全栈 + AI 部分的深度调研（对比简版 `2026-fullstack-survey.md` 报告三，本轮逐项复核并加深）。
> 检索日期：2026-09-19。方法：约 30 轮 WebSearch + 若干官方页 WebFetch 全文抓取（Next.js MCP 指南、MCP 2026-07-28 发布公告、AI SDK 7 博客、TanStack Start overview、Builder.io agent-native README 等），关键事实交叉验证，优先官方 changelog/blog/docs/GitHub releases；第三方聚合口径单独标注。所有版本号/日期均以检索所得为准；未确认说法显式标注"（未确认）"。
> 委托方背景：Atelier（AI 代理优先前端框架）拟升级为全栈 AI 框架，差异化主阵地="agent 全栈基建"（契约贯通 API 面 / 全站结构机检 / 全站双轨回滚 / endpoint.*/db.schema MCP 工具族），北极星指标=AI agent 首遍正确率。

---

## 0. 结论速览

| 框架/项目 | 类型 | 核心机制 | agent 基建成熟度 | 对 Atelier 可取/应避一句话 |
|---|---|---|---|---|
| Next.js 16.x | React 全栈 | RSC/Server Actions + Turbopack + Cache Components | **高**（dev MCP/AGENTS.md/捆绑文档/next-browser） | 可取：dev 面 MCP 工具清单与文档随包分发；应避：隐式序列化边界与缓存语义漂移 |
| Vercel 平台 | 云+agent 运行时 | Fluid/Sandbox/Open Agents/AI SDK/Better Auth | **高**（平台级闭环） | 可取：agent 运行时原语分层；应避：全栈=平台锁定 |
| Nuxt 4.x | Vue 全栈 | Nitro + 自动导入 + server/api 类型推导 | 中低（官方 docs MCP） | 可取：Nitro 部署 preset 思想；应避：自动导入隐式性 |
| SvelteKit 2→3 RC | Svelte 全栈 | **remote functions（query/command/form/prerender）** | 低（无内置 MCP） | 可取：query/command 原语已被主流化，需在其上叠契约+订阅；应避：编译器魔法取代显式注册 |
| TanStack Start（RC） | 框架无关全栈 | server functions + Standard Schema 校验 | 低 | 可取：标准 schema 校验即契约、无 codegen；应避：RC 两年不 1.0 的漂移风险 |
| Solid 2.0（RC） | 信号 UI | async 入响应式图、Start mode 取代 SolidStart | 低 | 可取：async-in-signal-graph 与 Atelier 信号内核同构；应避：连续大版本重写语料 |
| Astro 6 | 岛屿静态 | Server Islands（已稳定）/CSP/Fonts | 低 | 可取：默认零 JS 的"防过度工程"；应避：内容站定位与全栈诉求错配 |
| Encore.ts | 后端 SDK | 源码→应用模型→OpenAPI+类型化客户端 | 中（契约生成强） | 可取：`encore gen client` 式"编译即契约"；应避：云/运行时绑定 |
| Wasp | DSL 全栈 | .was DSL + React/Node/Prisma | 低 | 可取：意图 DSL 收敛 agent 编辑面；应避：DSL=语料盲区（beta 至今未 1.0） |
| AdonisJS 6→7 | 古典全栈 | 显式 IOC、生成器 | 低 | 可取：生成器产出可读惯例代码；应避：DI 魔法密度 |
| Redwood→RedwoodSDK/Cedar | 已收尾 | 团队转 Cloudflare Workers；社区分叉 CedarJS | — | 教训：概念负债压垮复杂度预算；AI 时代框架必须"少概念" |
| Convex | 反应式后端 | 函数即查询、订阅式推送、@convex-dev/agent | **高**（数据面 agent 化最激进） | 可取：query=订阅与信号引擎同构；应避：闭源平台+自有 DB 锁定 |
| ElectricSQL | 读路径同步 | Postgres shapes over HTTP + 边缘缓存 | 中（自称"agent platform on sync"） | 可取：读/写路径分离的坦率设计；应避：写路径要拼 TanStack DB |
| Zero（Rocicorp） | 全栈同步 | zero-cache + 查询端点 + 自定义 mutation | 中（1.0 于 2026-06） | 可取：查询即同步协议；应避：另一套自研查询层 |
| Supabase | BaaS | Postgres+PostgREST+MCP+Evals | **高**（首个 agent 评测基准开源） | 可取：Evals=平台级 M3 对标；应避：RLS 隐式安全模型 |
| Firebase/SQL Connect | BaaS | Data Connect→Realtime PostgreSQL | 中 | 可取：GQL→原生 SQL 的回调；应避：Google 生态孤岛 |
| Better Auth | 鉴权 | 框架无关 TS auth，插件生态 | 中（被 Vercel 收购后主打 agent 身份） | 可取：鉴权独立成库+插件；应避：不自带——集成即可 |
| Vercel AI SDK 7 | agent 原语库 | ToolLoopAgent/工具审批/持久 workflow/遥测 | 高（原语下沉事实标准） | 可取：共性原语清单直接映射 Atelier agent 原语；应避：框架不内嵌 LLM 原则仍成立 |
| Mastra 1.0 | TS agent 框架 | workflow/memory/evals/Mastra Code | 中高 | 可取：evals 内置=验证闭环；应避：全家桶重 |
| LangGraph.js 1.0 | 图编排 | stateful graph + checkpoint | 中 | 可取：checkpoint 恢复语义；应避：JS 二等公民历史 |
| Playwright/Vitest | 测试回路 | Test Agents（planner/generator/healer）/Browser Mode 稳定 | 高 | 可取：Trace View+确定性断言=agent 验收通道 |
| Tauri 2 | 桌面壳 | sidecar exe + IPC | 低 | 可取：bun build --compile 产 sidecar exe=桌面一级分发路径 |

**总判断：** "agent 全栈基建"已从无人区变成"半有人区"——dev 可观测性 MCP、AGENTS.md 供给、文档随包分发、平台级 agent 运行时已被 Vercel/Next.js/Convex/Supabase 抢跑；但**全站结构机检、双轨回滚、API 面漂移门禁、以首遍正确率为北极星的框架级 harness** 截至 2026-09 仍无主流框架做（详见 §11）。

---

## 1. 全栈框架横向

### 1.1 Next.js 16.x（含 16.2 "AI Improvements"）

**① 现状与时间线**（检索日 2026-09-19）：Next 16 于 2025-10-21 发布：Turbopack 默认（生产构建 2–5×）、Cache Components（`"use cache"` 取代 PPR 实验）、内置 React 19.2。**16.2（2026-03-18）主题即 AI**：agent-ready `create-next-app`（默认脚手架生成 AGENTS.md）、完整文档捆绑进 `node_modules/next/dist/docs/`、`next-browser` CLI（agent 与 dev server 交互）、实验性 Agent DevTools，dev 启动约 400% 提速；2026-03-25 随 OpenNext/Netlify/Cloudflare/AWS Amplify 落地稳定 Adapter API。16.3 线（至 16.3.x，docs 页 lastUpdated 2026-07-08；2026-09 有 16.3.1 维护版（未确认精确最新号））：Turbopack 内存 -90%、Rust 版 React Compiler、"为 AI 编码 agent 构建的一套工具"。安全：2026-07-21 一次补丁修 16.2.11/15.5.21 的 9 个漏洞（thehackernews 报道）。

**② 机制**：服务端面仍是 RSC payload 序列化 + Server Actions（`get_server_action_by_id` 这类 MCP 工具反过来证明 action ID 是 agent 需要的显式锚点）。agent 通道：Next 16+ dev server 内建 `/_next/mcp` 端点，官方 `next-devtools-mcp` 包自动发现并转发，暴露 8 个工具——`get_errors`（构建/运行时/类型错误）、`get_logs`、`get_page_metadata`、`get_project_metadata`、`get_routes`（按 appRouter/pagesRouter 分组的文件路由扫描）、`get_server_action_by_id`、`get_compilation_issues`、`compile_route`（按需编译单路由，Turbopack）——即"运行时可观测 + 文档网关（指向随装版本 docs）+ Playwright MCP 转接"三合一（来源：nextjs.org/docs/app/guides/mcp，已抓取全文）。

**③ 优缺点**：优——agent 上下文供给最完整（错误/路由/文档/日志全机器可读）、升级 codemod 化。缺——RSC 边界与缓存语义依旧是隐式魔法；2025-12 RSC 序列化漏洞（React2Shell，CVE-2025-55182）证明序列化边界即攻击面。

**④ 对 agent 全栈价值**：正面——它把"dev 面即 MCP"从 Atelier 的假设变成了行业默认。负面——Server Actions 的隐式契约（无 schema 强制）在生成场景仍高幻觉。

**⑤ 对 Atelier**：`/_next/mcp` 的工具清单（errors/routes/logs/compile）应作为 Atelier dev 面 25 工具的对标基线；Atelier 的差异化要落在 Next 没有的：结构机检、回滚、契约门禁。AGENTS.md 应成为 `atelier init` 产物（Next 已做，Atelier 不能缺席）。文档随包分发（vendor llms.txt/docs 进应用）已被验证为正确做法。

### 1.2 Nuxt 4.x / 5（Nitro 3）

**① 现状**：Nuxt 4（2025-07）app/ 目录重构 + shared/ 类型安全数据层；**4.3（2026-01-21）**（layouts/缓存/DX 改进与底层性能优化）；Nuxt 3 于 2026-01-31 计划性 EOL；**Nuxt 5 预计 2026 Q4**，随 Nitro 3 稳定发布（第三方社区口径，非官方承诺，未确认），官方承诺 Nuxt 4 在 Nuxt 5 发布后至少维护 6 个月。

**② 机制**：Nitro 3 = 通用服务引擎（内建 task runner、cron 调度、跨环境 WebSocket、H3 v2/srvx），"部署 target 即编译期配置"（Node/serverless/edge preset 一套代码多端出）；server/api 文件即端点，客户端调用类型自动推导（"零 schema 端到端类型"——契约隐含在文件系统与推导链里，而非显式 schema 对象）。agent 面：官方 MCP server（2025-11-12 官宣，nuxt.com/blog）提供**文档**结构化访问（非应用 dev 面）；社区 nuxt-modules/mcp-toolkit 提供构建 MCP server 的 Agent Skills；2026-04 Vercel 亦有"如何用 Nuxt 构建 MCP server"教程，说明 Nuxt 更多被当作 MCP server 的宿主而非自带应用面 MCP。

**③ 优缺点**：优——Nitro 可移植部署是全栈框架里最工程化的部署抽象；文件约定让"单文件上下文可预测全局结构"。缺——自动导入（components/composables/auto-imported utils）让 agent 难以静态定位符号来源，IDE 能补全但模型语料里符号无 import 痕迹，幻觉"不存在的 composable"是社区常见抱怨；两层约定（Nuxt 层+Nitro 层）心智叠加。

**④ 对 agent 全栈价值**：正——结构可预测性高、Nitro 目标多端；负——隐式符号解析与"类型推导即契约"（无 schema 对象）意味着错误要运行时才暴露，agent 缺一个可校验的中间层。

**⑤ 对 Atelier**：Nitro 的"部署 target 即编译期配置"值得吸收进全栈形态（Atelier 可定义 deploy target 元数据但保持显式）；自动导入是 Atelier 显式 import 原则的反面教材（旧报告结论维持成立，并获 2026 社区反馈佐证）；官方选择只做"文档 MCP"不做"应用 dev 面 MCP"，留下 Atelier dev 面的生态位空档（但见 §11：Next 已占）。

### 1.3 SvelteKit 2.x → 3.0 RC：remote functions（重点研究）

**① 现状**：remote functions 2025-06 以 RFC（sveltejs/kit discussion #13897）引入，`kit.experimental.remoteFunctions` 显式 opt-in；2025-10 起持续加批处理/懒发现；2026-06 新增 `query.live()`；**SvelteKit 3.0 RC（2026-08，The Register 2026-08-19 报道）**，remote functions 仍标实验性。

**② 机制**（对 Atelier query/command 拟议最关键）：函数写在 `.remote.ts`（不进 src/lib/server），编译器将其编译成 HTTP 端点并生成客户端 fetch 包装，端到端类型安全无手写 API 层。四种原语：
- `query`：读，渲染周期内去重+批处理，`query.batch` 解决 n+1；**`query.live()`（2026-06）= 订阅式响应查询**；
- `command`：非表单变更（按钮/拖拽），可失效/刷新 query 缓存；
- `form`：渐进增强表单（无 JS 可用），`preflight` 做客户端预校验；
- `prerender`：构建期取数，结果进 CDN。
校验：第一参数收 Standard Schema（Valibot/Zod 等），失败返回 4xx——官方立场"每个 remote function 都是公网端点，校验必须"；无内建鉴权，会话/权限写在函数体内。

**③ 优缺点**：优——读写二分（query/command/form）心智极适合 agent；端点即函数即契约。缺——靠编译器魔法（无显式注册表）；实验期 API 漂移；缓存/失效语义学习曲线。

**④ 对 agent 全栈价值**：这是目前与 Atelier 拟议 `query.*/command.*` 端点**同构度最高**的主流原语，且 `query.live()` 验证了"端点即订阅"方向。

**⑤ 对 Atelier**：必须与之对表——Atelier 的差异化应做成：显式注册（无编译魔法）+ 契约单源（endpoint 契约可被 MCP/机检消费，而非只藏在 .remote.ts 源码）+ 信号桥（live 端点直接写进信号图，做细粒度而非整查询 refetch）。SvelteKit 验证了原语命名可行，但"隐式编译"恰恰是 Atelier 显式优于隐式原则的靶子。

### 1.4 TanStack Start（仍 RC）

**① 现状**：2025-09-23/24 进入 RC；**截至 2026-09 官方 docs 仍标 RC**（本轮已抓取 overview 页原文："currently in the Release Candidate stage…feature-complete and its API is considered stable…road to v1 will likely be a quick one"），2025-11-30 有 GitHub 讨论（#5999）追问 1.0 日期——**1.0 正式版仍未发布**。2026-04-10 宣布支持 Solid 2.0 beta（`@tanstack/solid-start` 2.0.0-rc.8），可跨 UI 框架复用同一条全栈内核（React/Solid/Svelte 适配逐步落位）。

**② 机制**：文件路由（类型安全路由树）+ server functions（同函数经 `isServer` 双端执行，客户端拿到类型化代理）+ 全链路 TS 类型推断**无 codegen 步骤**；服务端中间件与 context 链（`inputValidator` 在进入 middleware/handler 前改写与校验）；server function 校验经 **Standard Schema**（Zod/Valibot/ArkType 统一接口）挂在函数选项，进入 handler 前完成验证与变形——注意：**校验是"惯例强"而非"语言级强制"**（不挂 validator 也能定义端点，旧报告称"强制 schema 校验"偏乐观，见 §12）；另有 API routes、experimental RSC。部署经 Vite/Rsbuild 双打包器（universal deploy）。

**③ 优缺点**：优——"不发明渲染模型"的克制使类型链路成为现成的验收 harness（类型错误即 agent 可读错误）；Standard Schema 使契约可交换。缺——RC 超 12 个月，文档/示例随 alpha→RC 演进分裂（AI 语料里新旧混杂）；生态位与 Next/TanStack Router 之间的取舍文档需要 agent 自行拼装。

**④ 对 agent 全栈价值**：全链路类型 = 天然的 agent 验收面（编译错误收敛生成回路）；server function 模式证明"单函数即 API"可零样板。

**⑤ 对 Atelier**：**Standard Schema 应成为 Atelier endpoint 契约的校验接口**（契约单源产出 standard-schema 兼容验证器，校验器再被 MCP 工具与机检复用——一源三用）；RC 拖期本身是"API 面漂移管理失败"的反例，反衬 Atelier api-diff 门禁价值：框架可以 RC，但 API 面漂移必须被机器看见。

### 1.5 SolidJS 2.0 / SolidStart

**①**：Solid 2.0 beta 2026 春（InfoQ 2026-05 报道），**RC API 冻结约 2026-07**（官方博客 "Solid 2.0 RC: The Big <Reveal>"）；1.9.x 仍是 npm stable。**②**：async 一等进响应式图、createResource 移除、新 Suspense/`<Loading>`、Oxc Rust 编译器；**"Start mode" 取代独立 SolidStart**（维护期迁移指南已出）。**③–⑤**：async-in-signal-graph 与 Atelier 信号内核同构，值得跟踪其分层语义；教训=连续两个大版本重写 API 面，agent 语料双峰。SolidStart 之死再次证明"内核好≠全栈好"。

### 1.6 Astro 6

**①**：**6.0（2026-03-10）**：内建 Fonts API、CSP API、Live Content Collections、**Server Islands 稳定**、重写 dev server、一等 Cloudflare Workers；6.x 系列至 6.4（SVG 优化器等增量特性）。运行时支持面扩大（Deno/Bun 社区适配，未确认官方级别）。

**② 机制**：Server Islands = 静态页内动态洞——组件以占位符形式出现在静态 HTML 中，请求到达时由服务器（或边缘）单独注入真实内容，页面其余部分保持 100% 静态可缓存；与客户端 islands（ hydration 边界）正交，形成"静态骨架 + 服务端动态洞 + 客户端交互岛"三层边界模型。Live Content Collections 让内容集合可接活数据源；CSP API 把安全策略从手写 meta 变为框架 API。

**③ 优缺点**：优——默认零 JS 的"防过度工程"纪律、边界显式（每个动态点都是显式声明）、HTML 优先对 agent 生成友好（产物即人可读）。缺——无应用级服务端状态模型（session/事务/工作流仍靠 Actions+适配器拼装），内容站心智与全栈应用诉求错配；多 target 下 dev server 重写后的行为一致性待观察（未确认）。

**④ 对 agent 全栈价值**：islands 边界模型是"让 agent 显式声明动态范围"的好范式；Server Islands 的占位符协议（HTML 内可序列化占位）与 Atelier 桥"状态显式序列化"思路同源。

**⑤ 对 Atelier**：可取——动态边界显式化 + 安全原语框架化（CSP API）两条趋势都该吸收进全栈形态设计；应避——不要学其"多套 islands 概念并存"的文档分裂方式。

### 1.7 Encore.ts

**①–②**：开源基础设施 SDK（TS/Go）。机制：API 定义即源码（注解/封装于 `Service_encore.ts`），`encore build` 编译出"应用模型"，据此处理请求校验、路由，并生成 OpenAPI 与类型化客户端（`encore gen client`，2026-03 对比文确认仍是主路径）；GitHub Action 可在代码变更时自动重生成 TS/OpenAPI/Swift 客户端。**③**：单一真相源全链路类型的最佳实现之一；缺=云产品倾向 + 运行时模型（service/pubsub/cron 全代码化）带来的心智绑定。**⑤**：Atelier 的 endpoint.* 契约→MCP/OpenAPI 双向导出应参考其"编译即契约"而非"运行时反射即契约"。

### 1.8 Wasp

**①**：截至 2026-02-24 官网仍写 "rapidly approaching a 1.0 release (currently in beta)"——**1.0 仍未发布**（比旧报告的印象更进一步确认：beta 状态延续）。**②–⑤**：.was DSL 单文件声明 auth/routes/operations + React/Node/Prisma；agent 只改业务文件、DSL 极小 API 面是优点，但 DSL 是语料盲区、beta 期漂移使 agent 训练语料永远追不上。对 Atelier：意图清单（manifest/specs）应是**生成物之外的机器可读层**而非自有语言。

### 1.9 AdonisJS 6 / v7

**①**：v6 为 stable 生产版；**v7 已 feature-complete，进入 Insiders 闭门预览**（官网公告，2026 年内），endoflife.date 已收录其发布政策（2026-08 更新）。**②–⑤**：显式 IOC + 生成器 + 全栈一条龙（Lucid ORM/auth/session）；DI 容器是隐式魔法重灾区但错误信息质量好。可取：生成器输出"可读惯例代码"；Atelier 的 templates/app 三元共置示例同思路。

### 1.10 RedwoodJS 崩塌复盘（2025-04 之后）

2025-04-04 团队公告 "The Future of Redwood"：原框架更名 **Redwood GraphQL** 进入维护收尾（release notes 明言 winding down）；核心团队转向 **RedwoodSDK**（React on Cloudflare Workers，非 GraphQL）；社区分叉 **CedarJS**（cedarjs.com）延续原全栈 GraphQL 路线。教训固化：概念过多（services/cells/directives/GraphQL 三层）是负债；当"复杂度预算"被 AI 收紧，框架价值与概念数成反比。RedwoodSDK 的 Cloudflare 单一 target 值得注意——**收敛部署面反而救活了团队**。

### 1.11 React Router v7/v8 与 Remix 3（旧报告遗留疑点的解决）

React Router Framework Mode（=Remix v2 的正统延续）持续发版至 2026；**React Router v8 已于 2026-06 发布**（Wikipedia 口径，未在官方博客二次核验——待复核）。**Remix 3 = 放弃 React 的重写**（Preact fork + 自研 web 原语组件模型，单依赖），2026 年处于 RC（未确认 GA）。对 agent：又一处"品牌同名、内核换代"的语料陷阱。loader/action 读/写二分的心智遗产被 SvelteKit remote functions 与 TanStack server functions 继承。

---

## 2. 响应式后端 / 同步引擎（与信号前端同构）

### 2.1 Convex（重点：与 Atelier 信号引擎契合度专析）

**① 现状**：官网自述 "The reactive backend platform that keeps up with you and **your agents**"；后端已开源（get-convex/convex-backend，约 20 万行）；2026 年加入 Python/Rust 原生订阅支持。

**② 机制**：函数即查询——`queries`（确定性、可订阅）与 `mutations`（事务、串行调度）分置；客户端 `useQuery` 建立订阅：任何写事务若影响某查询结果集，服务端重算该查询并**把新结果推送到订阅者**；存储为其自研文档型事务数据库（非 Postgres）。agent 面：**`@convex-dev/agent` 组件**（持久会话线程、工具调用、流式、RAG、与 AI SDK 集成）+ 官方 deployment MCP（内省部署状态、执行函数、读写数据）。

**③ 与 Atelier 信号引擎的契合度（专析）**：
- 结构同构：Convex 的"查询=订阅"是**服务端粗粒度信号**——依赖（查询读集）由运行时追踪，写触发失效-重算-推送；Atelier core.ts 是客户端细粒度信号。两者天然可串联：endpoint.query 订阅端点的 SSE 推送可直接写进前端信号图，形成"服务端粗粒度 → 客户端细粒度"的两级依赖图。
- 关键差异：Convex 依赖**数据库层读集追踪**（这要求自有 DB）；Atelier 若不内嵌数据库（原则），只能在 endpoint 层做"查询→订阅"声明式衔接（如 live query = 每次写后重放查询），细粒度做不到 Convex 的增量，但换来 Postgres/SQLite 自由。
- agent 价值：Convex 把"状态变更→UI 自动一致"做成了免心智负担的默认，这正是 agent 生成代码最易错的"手动缓存失效"问题的平台级解法；代价是平台锁定。

**⑤ 对 Atelier**：不要造 Convex 型数据库；要造 **"endpoint 订阅原语"**（query 端点可选声明为 live，经 dev 桥/SSE 进信号图），并把 Convex 的 queries/mutations 二分吸收为 endpoint 契约的读写二分。

### 2.2 ElectricSQL

**①**：**1.0 GA（2025-03-17）**（"electric-next" 重建后）；2026 年 GitHub 定位语改为 "**The agent platform built on sync**"。安全：CVE-2026-40906（/v1/shape 的 order_by 注入面，1.1.12–<1.5.0 受影响）。**②**：纯读路径同步——Postgres → shapes（部分复制集）→ HTTP 流 → 客户端存储（PGlite/SQLite），边缘可缓存、百万级 fan-out；写路径明确外包（TanStack DB 批量乐观写是官方推荐组合）。**⑤**：读/写分离的坦率性值得学习；Atelier 若做 live 端点不必造全量同步，只要"订阅失效推送"一层。

### 2.3 Zero（Rocicorp）

**①**：**Zero 1.0（2026-06，InfoQ）**，首个 stable，伴随 schema 变更；npm 出现 @rocicorp/zero-virtual（2026-07）。**②**：zero-cache 居中——客户端查询（ZQL，自研查询语言）直达缓存，服务端必须实现 **query endpoint** 供 zero-cache 回源自定义查询；mutation 走 push→服务端自定义 mutation 处理器。**⑤**：与 Atelier 相关的启发："查询即同步协议"意味着**查询端点是公开契约**——需要 schema 化与校验（Atelier 契约单源正好补位）。另一套自研查询语言（ZQL）= 语料盲区，应避。

### 2.4 PowerSync / InstantDB / Triplit / Turso

- **PowerSync**：Postgres→客户端 SQLite，sync rules 声明同步范围（哪些表/行到哪类设备），离线写回放+冲突上传；SDK 覆盖 JS/React Native/Flutter 等。2026 对比基准约 1.5–2.2s 同步同数据集（kanopylabs，未复核方法学）。定位=工程化离线优先（企业/工业场景多），agent 叙事弱；自我定位是"同步基建"而非平台。
- **InstantDB**：2026 官网自述 "In 2026 Instant entered the AI era. Instant is the database for that future"（10k+ 并发连接、1k+ qps 自述值，未复核）；"前端里的数据库"+ 三合一（DB/auth/permissions，instml 声明权限规则）；与 AI 结合点是"agent 生成的应用天然需要实时协作状态"。2026 年亦见于与 TanStack DB/LiveStore 并列的选型对比。
- **Triplit**：**2026 无新动态可检索**（最近公开信息停留在 2024 HN 发布与对比文），活跃度存疑（未确认）——local-first 赛道洗牌的信号：叙事先发的项目若无平台/生态承接会被边缘化。
- **Turso**：embedded replicas——云库的本地只读副本，读微秒、写转发云主库；Turso 数据库本体是 SQLite 的完全重写（libSQL 后继）；2026 年生态文章（yusuke.cloud 2026-07、dev.to 2026-01）仍以 embedded replicas 为核心卖点。对 Atelier 桌面形态：**"本地 exe + 嵌入式库 + 云同步"** 是自包含工坊的可选底座（互补而非威胁）；SQLite 路线与 Bun 内建 SQLite（Bun.sql/统一 SQL API）天然兼容。

**格局小结（2026）**：local-first 阵营已分化为"读路径同步（Electric）/全栈同步（Zero）/离线工程化（PowerSync）/前端数据库（Instant）/嵌入式（Turso）"五个生态位，且都在向 agent 叙事靠拢（Electric 改口号、Instant 官宣 AI era、Convex 自称 keeps up with your agents）——**"响应式数据层=agent 基建的一部分"已是行业共识**。但注意：所有这些方案解决的是"数据如何到端上并保持一致"，没有任何一家做"端点的契约如何被 agent 工具消费与校验"的门禁层——这正是 Atelier db.schema/endpoint.* 工具族的空位。

---

## 3. BaaS 格局

### 3.1 Supabase

**①**：2026 月度 changelog 持续：**2026-07**（OpenCode 编码 agent 与 Supabase 集成、**TanStack DB 同步接入 Supabase**——本地乐观写+官方同步桥、Wrappers 加 MongoDB FDW）；**2026-08 Supabase Evals 开源**——把 Claude Code/Codex 等编码 agent 放到真实 Supabase 任务上跑分（平台级 agent 评测基准，目前唯一与 Atelier M3 同构的行业实践）；2026-01 发布安全进展+2026 安全路线图。定位已从"开源 Firebase 替代"变为"AI 原生应用平台"。

**②**：Postgres + PostgREST 自动 API（表→REST 即契约，OpenAPI 随库生成）+ Auth（GoTrue）/Storage/Edge Functions/Realtime；官方 MCP server（supabase-community/supabase-mcp）经 Management API（建项目/branch/迁移）+ PostgREST（查数）暴露，PAT 鉴权；branch 工作流与 agent 组合（agent 在分支上试、人工晋升）是其 2025-2026 的主推安全叙事。

**③ 优缺点**：优——开放 Postgres 生态、迁移零锁定（数据库可搬）、branch 隔离天然适配 agent 实验；缺——RLS 隐式安全模型（策略藏在 SQL 里，agent 极易漏写或写错策略——生成代码"能跑但越权"的高发区）、PostgREST 契约是"表结构投影"而非"意图契约"（业务规则不在 API 面上）。

**④ 对 agent 全栈价值**：branch+MCP+Evals 组合是目前 BaaS 里最完整的 agent 工作流；但安全边界靠 RLS 意味着 agent 的错误是静默的。

**⑤ 对 Atelier**：Evals 证明"框架/平台自带 agent 评分 harness"成为 2026 新竞争维度——Atelier M3 应从内部实验升级为对外可比口径（评分器已开源化即可趁势）；branch 思想与 Atelier checkpoint 的差异要讲清楚：branch=云端状态分叉，checkpoint=代码+快照+门禁的锚定，两者可互补不可互替。对"自包含工坊"定位：Supabase 是云端互补项（部署 target 之一），不是威胁——威胁来自其 agent 工作流体验本身足够顺滑。

### 3.2 Firebase（Data Connect → SQL Connect）

Data Connect（Postgres+GraphQL，2024 末 GA）于 **2026-04 Cloud Next 升格为 Firebase SQL Connect**：Realtime PostgreSQL、**native SQL 直连**（绕开 GraphQL）、自定义 resolvers（官方博客 2026-04-29）。解读：Google 承认"schema→GQL 生成"的间接层在 AI 时代是摩擦（agent 更会写 SQL 与 TS，不会写专有 SDL），回调显式 SQL。对 Atelier：直接验证"扁平 SQL/TS 契约优于 DSL 中间层"。

### 3.3 PocketBase

单文件 Go 后端（库+exe），2026-08-14 仍有发布；**仍 pre-1.0（官方 FAQ 明言不保证向后兼容）**；2026 动态=FLOSS/fund 赞助 + UI 重写（HN 帖）。对"自包含工坊"定位：PocketBase 是"单 exe 全栈后端"的极限形态——**威胁**（自包含叙事重叠）与**互补**（Atelier 可把它列为可选后端 target）并存；其 pre-1.0 漂移恰是 Atelier API 面门禁的反面参照。

---

## 4. 跨栈鉴权事实标准：Better Auth

**①**：2024-09 首发；**2026-07-07 被 Vercel 收购**（官方博客：创始团队加入，保持免费 MIT，4.6M+ 周下载），收购叙事明说"为 apps **and agents** 加速开源鉴权"——即 **agent 身份/agent 工作流安全**成为鉴权库的新战场；**1.7（2026-08-17）** OAuth/OIDC 大改。第三方对比宣称 5ms vs 67ms（对 Clerk/NextAuth）的性能差（未复核方法学）。**②**：框架无关 TS、email/password+OAuth+插件生态、schema 可控（Drizzle/Prisma/Kysely 适配）。**⑤**：Atelier 不应内嵌鉴权实现（框架不内嵌 LLM 的同构原则：框架不内嵌重资产业务件），但应在 endpoint 契约里**为 auth 预留显式位**（如端点元数据声明鉴权需求，供机检与 MCP 工具读取），并把 Better Auth 列为 init 可选集成。

---

## 5. AI 应用框架（agent 原语下沉）

### 5.1 Vercel AI SDK 7（2026-06-25 stable）

**① 时间线**：v5（2025 年中）→ v6 beta（2025-10，引入工具执行审批与 agent 抽象）→ **v7 stable（2026-06-25）**，16M+ 周下载；v6→v7 有 codemod。**② 原语清单**（官方博客已抓取）：
- Agent 抽象：`ToolLoopAgent`（工具循环）、实验性 `HarnessAgent`（把 Claude Code/Codex/Pi 等现成 harness 统一接口，兼容 useChat 与 TUI）；
- 工具：完全类型的 **tool context**（`contextSchema` 按工具隔离上下文如 API key）、typed runtime context 进入 `prepareStep` 与审批函数；
- 审批：每工具/兜底审批函数 + HMAC 签名审批与输入重验证（防伪造/重放）；
- 持久执行：`@ai-sdk/workflow` + `WorkflowAgent`（进程重启/部署/中断/延迟审批后可恢复）；
- 超时：`timeout: { totalMs, stepMs, chunkMs, toolMs }` 四级；
- 沙箱：`SandboxSession` 可移植命令执行抽象（Vercel Sandbox 等）；
- 遥测：启动时 `registerTelemetry(new OpenTelemetry())` 全覆盖 + 生命周期事件 + 每步性能指标；
- MCP Apps（`experimental_MCPAppRenderer`，服务端 UI 进沙箱 iframe，动作走同一审计/同意路径）；
- 实时语音/视频（实验）、`uploadFile/uploadSkill`、`@ai-sdk/tui`。
**⑤ 对 Atelier**：这份清单就是 2026 年"agent 原语"的行业标准定义（工具+上下文+审批+持久+遥测+沙箱）。Atelier 原则"框架不内嵌 LLM"不受冲击——AI SDK 是**库**不是内嵌 LLM；Atelier 应做的是把 endpoint 契约**作为 AI SDK 工具的一等来源**（endpoint → typed tool 的桥），而非重造这些原语。

### 5.2 Mastra

**1.0 stable（2026-01）**；2026-02 观察式记忆（observational memory）、**Mastra Code**（自研编码 agent）、supervisor 模式；workflow 可挂起恢复、evals、observability、deploy 内置。TS-first（Gatsby 创始人出品）。对 Atelier：evals 内置 = 验证闭环产品化，再次印证"生成+评测一体"趋势。

### 5.3 LangGraph.js / LangChain 1.0

**LangChain 1.0 与 LangGraph 1.0（2025-10-22，Python/JS 同发）**：LangChain 收敛为 core agent loop（AgentExecutor 废弃维护模式）；LangGraph 1.0 主打稳定性（持久化、可观测、HITL）。JS 版长期被社区质疑二等公民（docs/特性落后 Python，2025-07 论坛帖延续）。**⑤**：graph 编排对"全栈框架"过重；Atelier 只需吸收其 checkpoint/恢复语义（与 Atelier 全站回滚呼应）。

### 5.4 LlamaIndex.TS

Workflows 1.0（2025-06）：事件驱动编排、typed state、资源注入、可观测；定位检索密集型 agent，TS 一等（run-llama/ts-agents 示例仓库持续更新；2026 年 Braintrust/LangChain 两份横评均保留其席位）。

### 5.5 横向对表与共性原语提炼

| 维度 | AI SDK 7 | Mastra 1.0 | LangGraph.js 1.0 | LlamaIndex Workflows |
|---|---|---|---|---|
| 定位 | 模型路由+agent 原语库 | TS 全家桶 agent 框架 | 有状态图编排 | 事件驱动编排+RAG |
| agent 循环 | ToolLoopAgent/HarnessAgent | Agent 抽象+supervisor | 图节点+边 | 事件流+步骤 |
| 持久执行 | @ai-sdk/workflow（可恢复） | workflow 挂起/恢复 | checkpoint 恢复 | 流式恢复（弱） |
| 记忆 | runtime context+workflow 状态 | 观察式记忆（2026-02） | 状态通道 | 资源注入 |
| 审批/HITL | 工具级审批（HMAC 防伪造） | suspend-and-resume | interrupt 原语 | 事件等待 |
| 评测/遥测 | OTel 一键注册+指标 | evals 内置 | LangSmith 绑定 | 可观测事件 |
| 对全栈框架的意义 | 原语事实标准 | 验证闭环产品化样板 | 恢复语义参考 | 检索增强位 |

**共性原语提炼（2026 口径）**：① 类型化工具注册（schema 即接口）；② 上下文注入（context/runtime context）；③ 审批/HITL；④ 持久执行与恢复；⑤ 遥测/评测；⑥ 记忆（会话线程或观察式）；⑦ MCP 互通。**这七条可作为 Atelier agent 原语下沉的 checklist**——Atelier 的独特位：七条全部应能挂在"契约单源"之上（工具 schema 来自 endpoint 契约而非各框架私有定义），并让 ⑤ 直接复用 M3 评分器与 dev 桥审计。

---

## 6. Agent 基建标准化

### 6.1 MCP 规范 2026-07-28（继 2025-11-25 后的大版本）

RC 于 2026-05-21 锁定，**终版 2026-07-28 发布**，官方称"发布以来最大修订"，含破坏性变更（来源：blog.modelcontextprotocol.io，已抓取全文）：
- **协议层无状态化**：initialize/initialized 握手移除（SEP-2575），版本/客户端信息/能力改经每次请求的 `_meta` 携带，新增 `server/discover` 预取能力；
- **会话移除**（SEP-2567）：`Mcp-Session-Id` 与协议级 session 取消——任意请求可落任意实例，无需粘性路由；有状态服务改发**显式句柄（handles）**由模型作为参数回传（官方称这比隐藏会话状态更强，因为模型可推理组合句柄）；
- 服务端发起请求仅在处理客户端请求期间允许（SEP-2260，"用户不会凭空被弹窗"）；
- **多轮请求**（SEP-2322）：`InputRequiredResult` + `requestState` 取代挂起的 SSE 流，任意实例可续；
- 强制 `Mcp-Method`/`Mcp-Name` 头供 LB 路由（SEP-2243）；列表/读取结果带 `ttlMs`/`cacheScope`（SEP-2549）；W3C Trace Context 定死（SEP-414）；
- **扩展机制**（SEP-2133）：reverse-DNS ID + 协商 + 独立版本化；两个官方扩展：**MCP Apps**（SEP-1865，沙箱 iframe UI）与 **Tasks**（重构生命周期：`tasks/get|update|cancel`，创建由服务端主导，`tasks/list` 因无会话无法安全定界而移除——2025-11-25 的实验 API 需迁移）；
- OAuth 加固（iss 校验/application_type/凭证绑定等 6 项 SEP）；
- **Roots/Sampling/Logging 被废弃**（SEP-2577，注解性废弃，替换=工具参数/资源 URI、直连 LLM 供应商、stderr/OTel；至少保留一年）；
- **工具 schema 采纳完整 JSON Schema 2020-12（SEP-2106）**：支持组合/条件/$ref/$defs；外部 $ref 自动解引用被禁止。
- 治理：特性生命周期 Active/Deprecated/Removed，废弃→移除≥12 个月；Tier 1 SDK 十周内随版。

**对 Atelier 的三点直接影响**：① Atelier dev 桥若走 MCP，应直接对齐 2026-07-28 无状态形态（HTTP 直连+头路由，无需会话粘性），dev 面 25 工具的 MCP 实现需声明规范版本与迁移计划；② "禁 $ref"原则与规范不冲突（$ref 是允许而非强制），扁平 TS 契约单源仍是**更利于 LLM 阅读**的选择，但要在文档里显式说明这是有意降采；③ Tasks 转正为扩展 + 服务端主导创建——Atelier 的 checkpoint/长任务（结构检查、编译流水）若经 MCP 暴露，应按 Tasks 扩展建模。

### 6.2 MCP Registry 与生态规模

官方 Registry 2025-09 上线后：2026-03 约 3,012 个唯一 server（NimbleBrain 安全报告口径）→ **2026-05-24 官方 API 拉 latest 记录 9,652 条**（server/version 记录 28,959；digitalapplied 统计）→ 第三方聚合（Smithery/mcp.so/Glama/PulseMCP）合计 listings 超 12 万（2026-09 口径，口径混杂仅供参考）。旧报告 5 月数字准确，维持。

### 6.3 各框架 CLI/平台内置 MCP 盘点（2026-09）

| 框架/平台 | MCP 形态 | 工具面 | 备注 |
|---|---|---|---|
| Next.js 16 | dev server 内建 `/_next/mcp` + `next-devtools-mcp` 桥 | 8 工具（errors/routes/logs/page/project metadata/server action id/compilation/compile_route）+ 文档网关 + Playwright 转接 | 与 Atelier dev 面定位**正面重叠** |
| Angular 21 | CLI 内建 MCP server | 文档检索、代码现代化、交互式教程 | scaffold 时询问配置哪些 AI 工具；zoneless 默认 |
| Nuxt | 官方 MCP（2025-11-12 官宣） | 文档结构化访问（非应用 dev 面） | 另有 mcp-toolkit（Agent Skills） |
| Vercel | 托管 Vercel MCP（2025-08-06） | 部署/项目/日志管理 | 平台面非应用面 |
| Convex | 官方 deployment MCP | 内省部署、跑函数、读写数据 | 数据/部署面 |
| Supabase | 官方 MCP | Management API + PostgREST | PAT 鉴权 |
| SvelteKit / TanStack / Astro / Solid | **未见官方内置 MCP**（未确认——2026-09 检索无果） | — | 留白 |
| Remix v3 / RedwoodSDK | 未见 | — | — |

**判断**：**"文档 MCP"已普及、"dev 面运行时可观测 MCP"被 Next.js 旗舰化、"平台管理 MCP"被云厂商包圆**。格局可概括为三层渗透率：文档层（~人人都有）＞可观测层（Next 一家做深）＞治理层（无人）。Atelier 的 dev 面 MCP 若只对标"运行时可观测"已无差异化，必须叠加结构机检/回滚/契约门禁/评分（§11），并利用 SvelteKit/TanStack/Astro 等框架的 MCP 空窗期抢"第二家做应用面 MCP"的心智——同时把工具清单按 Next 的 8 工具作超集对表（Atelier 的 endpoint/db/struct/checkpoint 工具族已覆盖其全部观测点，缺的是 get_routes 式"路由枚举"这类低成本对标项，可列入 backlog）。

### 6.4 AGENTS.md

2025-08 由 OpenAI 发起，2026-09 口径：**60,000+ 开源项目采用、30+ agent 读取**（kingy.ai/Morph 转述）；分层发现（根目录→子目录就近覆盖）已是文档化惯例；Next.js 16.2 起 `create-next-app` 默认生成；2026-02 有 arXiv 论文评估其作为 repo 级上下文的效果（旧报告引 2601.20404，本轮未能二次核验该编号，另见 Drexel 2601.15195——两文编号待复核）。对 Atelier：AGENTS.md 升格为 init 必产（含 specs 索引、结构地图入口、guardrails 负例链接），并与 llms.txt 一起做分层。

### 6.5 llms.txt

仍是社区提案非标准；采用率约 10.13%（300K+ 域名研究口径，limy.ai 2026-05）；Google 二次拒绝（2025-07 Illyes；**2026-06-15 Google AI 优化指南明言对 Search 排名无影响**）；但 Next.js/TanStack 等文档站均供 `/docs/llms.txt`（本轮实测 nextjs.org/docs/llms.txt 可抓取），实际定位收敛为 **agent-readiness 信号**而非 SEO。对 Atelier：维持现状正确（模板已有 llms.txt），且应像 Next 一样**文档随包分发**（vendor 进应用），llms.txt 作索引不作依赖。

---

## 7. AI 代码生成实证研究（2025H2–2026 新证据）

1. **包幻觉/slopsquatting 持续恶化**：Cloud Security Alliance Labs（2026-04-19）：开源权重模型幻觉包名平均 **21.7%**；Cap Tech/学术研究（2025-08，即 USENIX Security 2025 Spracklen 等）：约 **20%**（75.6 万条 AI 生成代码样本）含幻觉包名，去重后 20.5 万个唯一虚构包（旧报告记 205,474 与"商业模型 ≥5.2%"与本口径一致；样本总数 576K/756K 两说并存，未确认精确值）；Endor Labs（2026-07）：幻觉名**跨查询复现**且**外观合法**——可预测性使其成为投毒理想标的；Trend Micro 公开数据集。对策矩阵不变：锁定依赖+内部 import 校验（Atelier 结构机检应加"import 白名单校验"位）。
2. **agent PR 失败实证**：**"Where Do AI Coding Agents Fail?"（Drexel，arXiv 2601.15195，2026-01；MSR 2026）**：3.3 万条 agent PR（5 个 agent）+ 600 条定性——文档/CI/构建类任务合并率最高，**性能与 bug 修复最差**；未合并 PR 特征=改动更大、触达文件更多、CI 失败更频；拒因分类超出技术缺陷：缺乏有效评审、重复 PR、实现没人要的功能、**agent 与仓库意图错位**。→ 直接支撑 Atelier 的 specs 意图规格与"改动面收敛"（结构机检）路线。
3. **失败模式分类学**：**"What Breaks When LLMs Code?"（arXiv，2026-08-13）**：547 起事件中 326 起高/危级；**ICML 2026**：长程交互暴露单轮评测看不到的错误级联与脆弱工具调用；**Columbia DAP Lab（2026-01）**：9 类关键失败模式；**"AI-Generated Code Is Not Reproducible (Yet)"（SRI 2026）**：LLM 代码引入新的不可复现失败。**"Agent Skills Can Be Harmful"（arXiv，2026-08-12）**：技能包本身可诱发失败——对 Atelier skills 包的直接警示：技能要有版本、示例一致性校验（check-skills.mjs 的存在正当化）。
4. **文档结构对生成质量**：ACM 2025（Hossain 等）：**错误文档严重损害模型表现，缺失文档的影响反而更小**——"错文档比没文档更糟"。对 Atelier：specs 必须与代码共置+机检同步（文档漂移即 bug 的学术佐证）；llms.txt/MCP 文档网关必须机器生成而非手写。

---

## 8. AI 原生生成器与"source as context"共识

- **v0**：Vercel 生态 UI/全栈生成，深绑 Next.js/shadcn；无自有后端（对比文口径），2026 年 v0 app 支持 agent 式多步（细节未确认）。
- **Bolt.new**：**Bolt v2**——agent 覆盖代码生成、自动测试、Figma/GitHub 导入、托管、数据库开通。
- **Lovable**：全栈生成 + Supabase auth/托管绑定（约 $25/月档），2026 年继续增长（未确认具体份额）。
- **Builder.io Fusion**：2025-06-18 发布，**Fusion 1.0（2025-11-06）**——对**现有代码库**做可视画布编辑（理解你的仓库+设计系统，产出真实提交而非快照）。Builder.io 另开源 **agent-native 框架**（GitHub ~4.8k stars，本轮已抓取）：**Shared actions**——每个能力定义一次，agent 当工具调、UI 当代码调，同一校验/权限/实现，**自动暴露为 HTTP/MCP/A2A/CLI 四通道**；shared data（生产 Postgres/本地 PGlite）；shared app state（agent 拿到当前页/选中记录）；明确"agent 不抓 UI，走与 UI 相同的 action 层"。
- **Vercel Open Agents**（2026-04-30，InfoQ）：开源后台编码 agent 参考实现（Fluid Compute + AI SDK + Sandbox 闭环）。
- 第三方引用 Stanford 结论 "80% AI 建应用可成功上线"（未确认原始研究口径）。

**逐项机制与判断**：
- **v0**：Vercel 生态 UI/全栈生成，深绑 Next.js/shadcn/Tailwind；无自有后端（对比文口径），2026 年 v0 app 支持多步 agent 式迭代（细节未确认）。价值=把"生成结果直接就是 Vercel 部署单元"，v0→部署→agent 反馈的回路最短；风险=生态绑定。
- **Bolt.new**：**Bolt v2**——agent 覆盖代码生成、自动测试、Figma/GitHub 导入、托管、数据库开通（lovable.dev 对比文口径）；浏览器内 WebContainer 起家的架构使其"全在客户端跑"的路径独特，但重型后端仍受限（社区反馈，未确认）。
- **Lovable**：全栈生成 + Supabase auth/托管绑定（约 $25/月档），面向非工程师（"apps for the 80%"）；风险讨论集中在安全与代码所有权（particula.tech 对比）。
- **Builder.io Fusion**：2025-06-18 发布，**Fusion 1.0（2025-11-06）**——对**现有代码库**做可视画布编辑（连接真实仓库+设计系统，产出真实提交而非快照）；目标用户是 PM/设计/工程协作。
- **Builder.io agent-native 框架**（开源，~4.8k stars，本轮已抓取 README）：**Shared actions**——每个能力定义一次，agent 当工具调、UI 当代码调，同一校验/权限/实现，**自动暴露为 HTTP/MCP/A2A/CLI 四通道**；shared data（生产 Postgres/本地 PGlite）；shared app state（agent 拿到当前页/选中记录/活动视图作为上下文）；明确"agent 不抓 UI、不点 UI，走与 UI 相同的 action 层"；内置 agent 聊天面、权限、skills/memory、自动化（定时/事件）、agent 团队委派；附带 Clips/Slides/Mail 等示例 agent。
- **Vercel Open Agents**（2026-04-30，InfoQ）：开源后台编码 agent 参考实现（Fluid Compute 长时运行 + AI SDK + Sandbox 闭环），"fork-and-adapt"定位。
- 第三方引用 Stanford 结论 "80% AI 建应用可成功上线"（未确认原始研究口径）。

**共识演进判定**："source as context"（生成器尊重既有仓库而非吐一次性代码）已从 Builder.io 一家主张变成 v0（ecosystem 模式）/Fusion/Copilot 类产品共同方向；2026 年的第二层共识是 **"agent 与人共用同一 action/契约层，而非 agent 走旁路"**——agent-native 框架把它做成了通用件。**这层共识与 Atelier "契约贯通的 API 面"立项动机完全同频**：Atelier 的独特位只剩"契约是编译期单源 TS（禁 $ref、可机检）+ 契约面接入结构门禁与回滚"，若不在机检/门禁上落地，"契约贯通"四个字将被 agent-native 这类通用框架吃掉。

---

## 9. Agent-friendly 测试回路

- **Playwright**：MCP 已成 agent 驱动浏览器标准通道（next-devtools-mcp 也直接转接它，见 §1.1）；2026 新增**三个内置 Test Agents**（planner 生成测试计划 / generator 产测试 / healer 自愈定位器，playwright.dev release notes + currents.dev 2026-03 口径）；生态讨论"MCP→CLI 转移"与会话稳定性从约 15 次交互提升到 50+（kualitatem 口径，未确认——官方未直接证实该数字）；规模化门槛共识≈200 条稳定测试+确定性 locator+标准化报告（testquality 2026-05）。
- **Vitest**：**4.0（2025-10-21）Browser Mode 转 stable**，内置视觉回归测试支持与 Playwright Trace 支持（voidzero.dev 官宣，InfoQ 2025-12-05 报道）；**5.0（2026-09-03）** Browser Mode 内建 **Trace View**（`browser.traceView` 记录每次交互/断言/页面事件）——组件级测试也开始具备 agent 可消费的"执行轨迹"输出。
- **视觉回归纪律**：快照 save/check 分离、"绝不自动晋升"（Atelier snapshot 纪律）与 Vitest/Playwright 生态默认（截图 diff 需人工 accept）一致，2026 无主流工具做自动晋升——Atelier 立场保持；healer 类"自愈"工具只动 locator 不动断言语义，是同一条纪律的变体。

**对 Atelier**：验收回路配置=Playwright MCP（E2E/浏览器）+ Vitest Browser Mode（组件/契约探针）+ snapshot（视觉）三件套已在模板 recipe 层成立；M3 评分器可复用这三层作为 acceptance harness。2026 新增的两个落点：① dev 面 MCP 应把"测试运行结果"做成机器可读工具输出（agent 改完代码→自跑→回喂，闭环内化）；② Trace View 证明"轨迹即调试上下文"，Atelier dev 桥的审计日志应向同构方向（事件化、可回放）对齐。

---

## 10. 本地全栈形态：Tauri 2 与运行时底座

- **Tauri 2 sidecar 实践**：`bundle.externalBin` 打包外部二进制 + capabilities 里授予 sidecar `execute/spawn` 权限（官方文档 2026-06 口径）；Node 不能内嵌进 Tauri 进程（Issue #7037 明确：sidecar 的 Node 是独立进程），标准做法=把 Node/Bun 后端编译成单文件二进制（`bun build --compile` / pkg 系）作 sidecar，经 stdio/本地 HTTP/WS/Unix socket IPC 与 webview 通信；Rust 主进程负责窗口/托盘/权限，后端仍用 TS 全栈逻辑——"前端 webview + TS 后端 sidecar + Rust 壳"三明治在 2026 年已是成熟模式（evil martians 2025-04 实战文、digitalapplied 2026-06 对比）；极简应用 <600KB（OS WebView）。2026 年对比文将 Tauri v2 列为桌面默认（对 Electron：无需捆绑 Chromium，代价是 WebView 一致性与原生模块生态差异）。
- **Bun 底座剧变**：Bun 1.3（2025-10-10）从 runtime 转型全工具链（零配置前端 dev、统一 SQL API、内建 Redis 客户端、Bun.secrets OS 级凭据、包 catalog、Bake 服务端宣布）；**2025-12-02/03 Anthropic 宣布收购 Bun**（官方公告，时点恰逢 Claude Code 达 $1B run-rate），Bun 定位=Claude Code/Claude Agent SDK 的核心基础设施；社区评论普遍解读为"agent 厂商开始垂直整合 JS 工具链"。
- **对 Atelier**："运行时倾向 Bun"原则获得战略层确认（agent 头部厂商亲自下场做 JS 工具链，Bun 单文件编译对桌面 exe 一级分发是直接利好）与治理层新风险（中立方变 Anthropic 子项：上游优先级、许可与 roadmap 可能向 Claude 工具链倾斜——未确认，需在 runtime vendor 纪律上保持 Bun/Node 双可运行的逃生门）。桌面 exe 一级分发的推荐路径固化：**`bun build --compile` → 单文件后端 exe → Tauri 2 sidecar + 显式 capabilities → 本地 dev 面端口供 MCP/桥接**——这条链路每个环节都有 2026 实践背书，且本地 dev 面与"桌面版=自带 dev 面的应用"在架构上是同一个服务面，边际成本低。

---

## 11. Agent 全栈基建竞争格局（单列重点）

逐项盘点 2026-09 各家已落地的 agent 基建（CLI MCP / AGENTS.md 生成 / 结构图 / 回滚 / 门禁 / 评测）：

| 能力 | Next.js/Vercel | Angular | Nuxt | Convex | Supabase | SvelteKit/TanStack/Astro | Atelier 现状 |
|---|---|---|---|---|---|---|---|
| dev 面应用 MCP（运行时错误/路由/日志） | ✅ /_next/mcp + 8 工具 | ✗（仅文档/迁移面） | ✗（仅文档） | ✅（部署/数据面） | ✅（平台面） | ✗ | ✅ 25 工具 |
| AGENTS.md 由脚手架生成 | ✅（16.2 create-next-app） | ✅（scaffold 询问 AI 工具） | ✗ | ✗ | ✗ | ✗ | 部分（specs 骨架，AGENTS.md 生成未见） |
| 文档随包分发/版本精确 | ✅ node_modules/next/dist/docs | ✅ CLI 文档工具 | ✅ docs MCP | ✗ | ✗ | 部分站点 llms.txt | ✅ vendor llms.txt |
| 结构机检（分层 OK/WARN/ERROR） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ struct check |
| 全站回滚/checkpoint | ✗（无；仅平台级 redeploy） | ✗ | ✗ | ✗ | ✗（branch 是开发分支非回滚） | ✗ | ✅ 三级标注+门禁 |
| API 面漂移门禁（快照 diff） | ✗（codemod 事后补救） | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ api-diff |
| agent 评测基准（harness） | 部分（Vercel 内部，未公开为标准） | ✗ | ✗ | ✗ | ✅ Supabase Evals（开源） | ✗ | ✅ M3（内部） |
| 契约→agent 工具自动暴露 | 部分（Server Action 可查 ID，无 schema 契约） | ✗ | ✗ | 部分（函数可跑无契约 schema 面） | 部分（PostgREST schema≠工具面） | 部分（Standard Schema 但不进工具面） | 拟议 endpoint.* 工具族 |
| "单 action 层多通道"（UI/agent 同权） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **Builder.io agent-native 已实现此模式** |

**结论**：
1. **已被抢跑的**：dev 可观测 MCP（Next 旗舰化）、AGENTS.md 脚手架（Next/Angular）、文档供给（各家）、平台 agent 运行时（Vercel 全家桶）、agent 评测（Supabase 率先开源）、"共享 action 层"（Builder.io 开源框架）。"agent 全栈基建"作为口号已不成立为无人区。
2. **仍无人的**：结构机检作为框架纪律、全站双轨回滚（代码锚定+快照+API 面门禁的组合拳）、API 面漂移 CI 门禁、**以首遍正确率为公开北极星的框架级对照实验**（Supabase Evals 是平台任务分，不是框架 A/B 协议）。这四件是 Atelier 立项全栈后仍成立的差异核心。
3. **战略修正在于叙事**：Atelier 不该再说"提供 agent 基建"（已被默认），应说"提供**可验证性基建**"——别人给 agent 上下文，Atelier 给 agent 证据（机检/门禁/回滚/评分）。

**逐家一句话定性（2026-09）**：
- **Next.js/Vercel**：agent 体验的"平台整合者"——从 dev 面 MCP 到 Open Agents 到 Better Auth，纵向闭环最深；Atelier 不与其拼平台，拼框架纪律。
- **Angular**：AI 工具链最自觉的"大厂框架"（CLI MCP+scaffold 询问），但语料重、全栈叙事弱。
- **Nuxt/SvelteKit/Astro/Solid**：agent 基建基本缺位（文档 MCP 除外），把宝押在"原语正确"上（Nitro/remote functions/islands/信号图）——这正是 Atelier 可乘之机：这些框架的用户是 Atelier 全栈版最可能的第一批迁移者。
- **Convex/Supabase**：数据面 agent 化最强，但都是"平台即边界"；Atelier 的自包含+可迁移立场与其错位竞争。
- **Builder.io agent-native**：模式层最大威胁（共享 action 层已开源）；应对=把 endpoint.* 工具族做成"契约单源"而非又一套 action 框架，强调机检与门禁这个它们没有的下游。
- **TanStack**：理念最近（显式类型链路、Standard Schema），但 RC 拖期+无 agent 基建；合作想象空间大于竞争（Atelier 可把 Standard Schema 作为契约输出格式之一）。

---

## 12. 对旧报告的修正（2026-fullstack-survey.md 报告三为主）

1. **Vercel AI SDK 5 → 已过时**：现为 **AI SDK 7 stable（2026-06-25）**（v6 beta 2025-10 未提及），stopWhen/prepareStep 之外新增审批签名、持久 workflow、HarnessAgent、遥测等；旧报告"agent 原语下沉"结论成立但清单需整体更新。
2. **TanStack Start "强制 schema 校验"偏乐观**：实际为 server function 选项挂 Standard Schema 校验（惯用且被生态推为标准），非语言级强制；且**截至 2026-09 仍是 RC、1.0 未发布**（旧报告存疑正确，状态未变）。
3. **Remix v3 形态已明**：旧报告"品牌回归 v3 具体形态仍在演进（未确认）"→ 已确认 **Remix 3 弃 React（Preact fork）重写、2026 处 RC**；React 系正统是 React Router Framework Mode（v8 于 2026-06 发布，Wikipedia 口径待复核）。
4. **SvelteKit remote functions 整节缺失**：旧报告只记 form actions；`query/command/form/prerender`（含 `query.live()`）与 SvelteKit 3.0 RC（2026-08）为重大新事实，直接关系 Atelier query/command 端点立项。
5. **MCP 一节需大改**：旧报告停在 2025-11-25 规范；**2026-07-28 规范无状态化重写**（握手/会话移除、Tasks 转扩展并重构、工具 schema 采纳 JSON Schema 2020-12 含 $ref）——旧报告"MCP 已是异步可交互可审计"的定性仍对，但 Atelier 桥接实现与"禁 $ref"论述需按新规范重写。另：旧报告 Registry 9,652 条（2026-05）数字经复核无误。

（报告一/二范围外修正简记：Bun 2025-12-02 被 Anthropic 收购、Better Auth 2026-07-07 被 Vercel 收购、SolidStart 独立框架退役转 Start mode、Wasp 1.0 仍未发布、Nuxt 3 已 EOL——均未见于旧报告。）

---

## 13. 横向综合

1. **上下文供给已商品化，可验证性仍是荒地**：dev MCP/AGENTS.md/文档网关在 12 个月内成为头部框架标配；机检/回滚/API 门禁/首遍正确率对照无人做——Atelier 全栈化的差异化必须全部押在"证据层"。
2. **读写二分原语完成行业收敛**：SvelteKit query/command、Convex queries/mutations、Zero query/mutation、旧 Remix loader/action——Atelier 的 endpoint.query/command 命名站在了行业收敛线上，做显式注册+契约单源+MCP 双通道即可领先半个身位。
3. **"响应式数据层=agent 基建"成为 2026 共识**（Convex/Electric/Instant 全部改口向 agent），Atelier 信号引擎的纵向优势在"细粒度"，需补横向的"端点订阅原语"（live endpoint→信号图）与 Convex 型体验对表。
4. **MCP 2026-07-28 是架构对齐窗口**：无状态+句柄+头路由意味着 dev 面桥可以做成纯 HTTP 多实例服务；Atelier 应把 25 工具桥升版到新规范，并评估 Tasks 扩展承载 checkpoint/长任务。
5. **契约的敌人从"没有"变成"太隐式"**：SvelteKit 靠编译器、TanStack 靠约定选项、Next 靠 action ID——都不产出"机器可消费的契约面"；Encore（编译即契约）与 Builder.io agent-native（单 action 层多通道）是仅有的两个显式参照系。
6. **错文档比没文档更糟（实证）**：specs 共置+机检同步从工程直觉升级为有学术支撑的纪律；技能包可致害（2026-08 论文）要求 check-skills 类一致性校验成为标配。
7. **平台吸附加速**：Vercel 一年连收 Better Auth（+推 Open Agents/AI SDK 7/Supabase 竞对叙事），Anthropic 收 Bun——"框架中立层"正被超大型 agent 厂商收编为基础设施；Atelier 的应对不是对抗平台，而是保证**框架产物可迁移**（Postgres/SQLite、标准 MCP、标准 schema）。
8. **桌面一级分发路径成熟**：bun build --compile + Tauri sidecar + 显式 capabilities 已是无争议 recipe，Atelier 全栈桌面形态（含本地 dev 面 MCP）技术风险低。
9. **评测即营销**：Supabase Evals 开源后，"你的平台 agent 跑分"成为新品类；Atelier M3 应开放协议与评分器，把首遍正确率做成对外可比指标。

---

## 14. 不确定项清单

- Next.js 当前精确最新版（16.3.1 维护版 2026-09 与 docs 页 16.3.5 并存）；React Router v8 发布月份仅 Wikipedia 口径（待复核）。
- Remix 3 GA 日期；Solid 2.0 正式 GA 日期（RC API 冻结约 2026-07 已确认）。
- Nuxt 5 "Q4 2026" 为社区估计非官方承诺；Nitro 3 特性清单以 masteringnuxt 转述为准。
- TanStack Start server function 校验是否在 1.0 转为强制（现 RC 仍为选项式）。
- 旧报告所引 AGENTS.md arXiv 论文编号 2601.20404 本轮未复核成功（存在 2026-02 相关论文，编号待查）。
- Playwright MCP→CLI 转移与"50+ 交互稳定"为第三方测试口径；Test Agents 三件套细节以官方 release notes 为准。
- 三方聚合 MCP 列表 12 万+ 条目口径混杂，仅作量级参考。
- Stanford "80% AI 应用成功上线"原始研究未溯源。
- Triplit 是否仍在活跃开发（未确认）；v0 2026 年 agent 能力细节（未确认）。
- Convex 2026 年内是否有新主版本号（检索未获精确版本号，仅有平台动态）。

---

*报告完。检索与撰写：2026-09-19。*
