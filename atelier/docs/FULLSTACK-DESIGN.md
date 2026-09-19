# Atelier 全站框架设计书（v0.2 提案稿）

> 版本：v0.2 草案（2026-09-19）。性质：**设计书，非实现计划**——本文先立方向，逐项落 BACKLOG 前需用户拍板。
> 证据基线：三路深度调研报告（2026-09-19 检索口径，各自含对 v0.1 证据归档的逐项复核与修正，事实/版本/URL 以报告内标注为准）：
> - 报告一（前端）：`research/2026-09-report1-frontend.md`
> - 报告二（后端与数据层）：`research/2026-09-report2-backend.md`
> - 报告三（全栈框架与 AI/agent 生态）：`research/2026-09-report3-fullstack-ai.md`
> 上轮简版归档 `research/2026-fullstack-survey.md` 保留作 v0.1 溯源基线（其中已被修正的表述以三份新报告为准）。
> 依据之二：既有 `design-decisions.md` 决策 0-16 × `ROADMAP.md` 态势。
> 标注约定：〔定〕= 有既有决策支撑，直接延续；〔议〕= 本文新提案，待用户拍板（拍板后进 design-decisions）；〔险〕= 风险项。
> 总原则不变（决策 10 总则）：**框架不内嵌 LLM**——一切生成/理解由外部代理完成，框架只提供原语、协议、执行器。全站化不改变这条红线。
> **拍板状态（2026-09-19）**：用户指令「开始制作」= D-F1~D-F10 整体拍板通过（D-F9 为方向拍板：倾向显式拒绝，原型验证 FS-11 后定稿）。决策定稿已写入 `design-decisions.md` 决策 17-23；执行队列 = `BACKLOG.md` FS 线；本文转入**背景文献**地位（后续以决策记录与 BACKLOG 为准）。

---

## 0. v0.1 → v0.2 修订摘要（本轮调研改变了什么）

| # | v0.1 判断 | 2026-09 新证据 | v0.2 修订 |
|---|---|---|---|
| 1 | "agent 全栈基建仍是无人区" | dev 面可观测 MCP（Next 16.2 起 `/_next/mcp` + 官方 8 工具）、AGENTS.md 脚手架生成、文档随包分发已被 Next 旗舰化；平台 agent 运行时（Vercel 全家桶）、agent 评测基准（Supabase Evals 开源）、"共享 action 层"（Builder.io agent-native，单 action 自动暴露 HTTP/MCP/A2A/CLI）均已进场 | 无人区收窄为四件：**全站结构机检、全站双轨回滚、API 面漂移 CI 门禁、以首遍正确率为北极星的框架级对照实验**；叙事从"agent 基建"升级为"**可验证性基建**"——别人给 agent 上下文，Atelier 给证据（§1.2/§1.3/§4.4） |
| 2 | 读写二分端点为自创提案 | 行业收敛完成：SvelteKit remote functions（`query`/`command`/`form`/`prerender` + `query.live()`）、Convex `queries`/`mutations`、Zero query/mutation；"typed functions as backend" 成 2026 主叙事 | 方向被验证；差异位 = **显式注册（反编译器魔法）+ 契约单源可被 MCP/机检消费 + live 端点直通信号图做细粒度订阅**（§4.1/§4.3） |
| 3 | 契约五用，禁 $ref 红线 | **Standard Schema V1**（约 60 行纯 TS 接口，零运行时依赖）被 tRPC v11 / Hono（官方 standard-validator）/ TanStack 全家 / oRPC / NestJS 12 全面采纳；其 JSON Schema 接口显式支持 `openapi-3.0` target | **新增互操作层**：自有扁平 schema 实现 `~standard` 接口即可换生态互操作；否决 zod/TypeBox/valibot 的理由全部仍成立——决策 6 被**加固而非推翻**（§4.6） |
| 4 | "运行时绑定 Bun" | **Anthropic 收购 Bun（2025-12-02）**；Bun 1.4 Rust 重写（2026-08）；bun:sqlite 与 node:sqlite 双宿主均零依赖内建 SQLite | 改为 **"Bun 优化态、Node 兜底"**：Web 标准 API + 薄宿主适配层，保持机动性（§4.1） |
| 5 | 数据层"倾向自研薄生成层" | Drizzle 1.0 仍 RC（rc.4，2026-06-27）且团队加入 PlanetScale；TS 生态无成熟"SQL→TS 类型函数"AOT 生成器（sqlc-gen-typescript 仍 preview）；Prisma 7 rust-free 但多步 generate 流程未变 | 自研薄生成层**确认落位**（正落 sqlc 空位）；Drizzle 降为 fallback（§4.2） |
| 6 | MCP 工具族按自拟协议扩展 | **MCP 2026-07-28 规范无状态化重写**：握手/会话移除、显式 handles、Tasks 转扩展、工具 schema 采纳 JSON Schema 2020-12（$ref 允许非强制） | dev 桥按 2026-07-28 对齐；长任务（编译流水/struct 检查）按 Tasks 扩展建模；扁平红线与新规范不冲突（§4.4） |
| 7 | （未涉及） | TS 7.0 GA（2026-07-08，Go 原生 10×）→ 类型反馈回路成本降一个量级；async 进响应式图成最一致响应式趋势（Solid 2 RC / Svelte 5.36+ experimental.async）；Vercel 收购 Better Auth（2026-07-07）；Rails/Phoenix 生成器"regen 即升级"实证；**错文档比没文档更糟（ACM 2025）**；技能包可致害（arXiv 2026-08） | 新增决策提案：**异步表达式策略**（D-F9，时间敏感）；auth 生成器路线获"生成器形态学"支撑；specs 共置 + 机检同步获学术支撑；check-skills 门禁正当化 |

---

## 1. 问题定义：从"前端框架"到"全站框架"

### 1.1 现状边界

Atelier 今天覆盖：信号内核 → 模板编译 → dev 面 → MCP 代理层 → specs/review 人机回路。**后端面为零**：数据获取靠三态原语（`streamValue`/`optimisticList`）消费外部 HTTP，契约层只管组件 props/events，没有 API 契约、持久化、鉴权、部署的一等概念。

### 1.2 为什么必须全站化（2026-09 实证刷新）

- **类型断裂 = AI 最大失败面之一**（维持，证据加强）：读写二分与端到端类型贯通已是行业收敛线（SvelteKit/Convex/Zero/TanStack）；断裂处（手写 fetch + 手写类型）仍是 agent 幻觉高发区。Atelier 契约层若止步于组件 props，等于把最难的一段留给 agent 猜。
- **边界隐式魔法已被证伪**（维持）：RSC "use client" 边界是公认幻觉重灾区；React2Shell（CVE-2025-55182，CVSS 10.0）修复版 19.0.1/19.1.2/19.2.1（2025-12-03）后 **Flight 协议攻击面模型未变**——"序列化边界即攻击面"已写进全行业认知。Atelier 的显式路线反而升值。
- **agent 基建已成及格线，且上下文供给已商品化**（证据大幅加强）：Next 16.2/16.3（dev MCP + AGENTS.md + 捆绑文档 + Agent Browser）、Angular 21/22（CLI MCP + devserver 工具）、Astro 7 全部内建；"框架给 agent 开门"从卖点变标配。**但上下文 ≠ 证据**。
- **全栈原语收敛为三种，且无一框架三者皆精**：①单文件 RPC（SvelteKit remote functions / server functions 系）、②缓存指令（"use cache" 系）、③服务端片段注入（Server Islands / RSC）。Atelier 全栈化选 ①（读写二分 + 契约单源），②③列 B 队观察。
- **后端格局三面收敛、全部利好现有选型**：Web 标准 API（Hono/H3 v2/Elysia/Axum 四证）、Standard Schema 互操作、部署 target 编译期化（Nitro preset / Bun compile / Deno compile）；且 **"框架内嵌 query/command 服务层 + 文件位置式前后端边界"在 TS 生态仍无成熟实现**（TanStack Start 最接近，但其 schema 校验依赖外部校验库、非框架内建扁平契约）。
- **AI 生成失败模式的新实证**（报告三 §7）：slopsquatting 恶化（开源模型幻觉包率 21.7%）→ 最小可数 API 面 + import 白名单机检是对策；agent PR 失败主因含"与仓库意图错位"（Drexel 33k PR 研究）→ specs 意图规格获支撑；**错误文档比缺失文档更损害模型表现（ACM 2025）**→ specs 共置 + 机检同步从工程直觉升级为学术结论；"Agent Skills Can Be Harmful"（2026-08）→ 技能包需版本与一致性校验，check-skills 门禁正当化。

### 1.3 一句话定位（提案，v0.2 修订）

〔议〕**Atelier 全站 = 一间完整工坊 + 可验证性基建**：人写意图（前端界面 + 服务行为），代理从契约单源出发砌出全栈；框架提供同一套契约、同一套 MCP、同一套 checkpoint 回滚横跨两端。与 2026 主流框架的分野：**它们给 agent 上下文（文档/错误/日志），Atelier 给 agent 证据（机检、门禁、回滚、可复现评分）**。slogan 顺势延展：意图进，界面出 → **意图进，全站出 / Intent in, full stack out.**（对外措辞待终审。）

---

## 2. 调研综合：取长补短矩阵（v0.2 刷新）

> 逐框架详细论证（版本时间线/内部机制/AI 友好度）见三份报告；此处只留设计决策所需的取/舍结论。标（新）者为 v0.1 未有之行。

### 2.1 前端线（报告一）

| 来源 | 取 | 舍/避 |
|---|---|---|
| SvelteKit remote functions（新） | `query`/`command` 读写二分 + `.remote.ts` 单文件即契约——与拟议端点同构度最高，命名已被主流化验证 | 编译器魔法取代显式注册；实验期 API 漂移 |
| TanStack Start | 类型即验收 harness；server function 挂 Standard Schema 校验的惯例 | RC 长跑一年未 1.0——API 漂移管理反例，反衬 api-diff 门禁价值 |
| Next 16 | AGENTS.md 随包、first-party skills、Agent Browser 式运行时内省、codemod 化升级 | 缓存语义三年三变；RSC 隐式序列化边界（安全前科，攻击面模型未变） |
| React 19 | Compiler 产品化证明"编译器兜底"可行；19.2/19.3 原语补全式小版本节奏保护语料 | 内联魔法指令（"use xxx"）；协议解码器藏进运行时不受静态检查 |
| Angular 21/22 | CLI 内置 MCP（含 devserver.start/stop）；迁移 SOP 工具化 | 多层样板 token 成本 |
| Solid 2 / Svelte 5.36+（新） | async 进响应式图是下一代信号语义的决战点——Atelier expr 求值器需尽快定案异步策略 | 连续大版本重写 API 面（Solid 教训） |
| Vue 3.6 Vapor | "同语义双产物 + golden 对拍"可行（Atelier codegen 同思路）——但 14 个月仍未 stable | opt-in 双轨长期化的文档分裂 |
| Qwik | resumability 隐喻：状态显式序列化而非重放 = checkpoint/journal 理论原型 | 序列化约束应编译器自动保障，不应交给用户手写规则 |
| htmx 4 / Datastar（新） | htmx 4 属性继承改显式 opt-in——超媒体阵营也完成显式化改造；超媒体 = 内容面/低交互面的降级输出路径（零 runtime JS） | 不作主渲染模型（与信号内核冲突） |
| Astro 7 | "编译器不再静默修非法 HTML"与 Atelier 契约校验哲学一致；静/动隔离 | 多套 islands 概念并存的文档分裂 |
| 标准（新） | **TS 7.0 GA**：类型反馈回路 10×，"codegen 引入类型语义"首次廉价；Vite 8 Rolldown 默认；TC39 Signals 仍 Stage 1（自研引擎无标准取代风险，留适配口） | Vite 8 下 dev 插件钩子面需回归测试；TS 6/7 双实现过渡期的类型工具混乱 |

### 2.2 后端线（报告二）

| 来源 | 取 | 舍/避 |
|---|---|---|
| Hono | Web 标准单抽象 + RegExpRouter"注册期编译成静态结构"（与模板→静态 effect 图同构）；standard-validator + hc RPC 类型贯通 | 生态胶水无约定——恰由 Atelier 文件位置约定补掉 |
| Fastify | schema→校验+序列化+文档**三编译管线**：契约五用的工程可行性证明 | JSON Schema 非扁平 + 插件封装作用域隐式魔法 |
| Elysia | "schema 四用做进框架核心"（校验/类型/OpenAPI/客户端）——契约五用不是空想；TS→OpenAPI 无注解导出先行 | 私有 DSL、1→2 重写漂移快、绑 Bun 私有 API |
| tRPC / oRPC | 任意 Standard Schema 校验器可插——证明自有扁平 schema 路线可行；oRPC 双面导出（RPC 内面 + OpenAPI 外面）可行 | tRPC 的 OpenAPI 靠插件补丁——Atelier 导出必须内建一等 |
| **Standard Schema**（新） | ~60 行纯接口、零运行时依赖、官方明示可 copy-paste 实现；JSON Schema 接口 openapi-3.0 target 直接挂 OpenAPI 导出 | 治理为三位作者个人背书；JSON Schema V1 覆盖完成度未逐一验证（未确认） |
| Drizzle | schema 即普通 TS 值——最接近 Atelier 形态的 ORM；贴 SQL、无引擎、无 generate | 1.0 仍 RC + 团队归属 PlanetScale（SQLite 优先级存疑）→ 降为 fallback |
| Prisma 7 | rust-free 证明"运行时 TS 化"行业方向 | 多步 generate 流程未变——反向证明"无 generate 步骤"路线价值 |
| bun:sqlite / node:sqlite（新） | 双宿主零依赖内建 SQLite——"数据层零运行时依赖"成立 | 两套 API 形状不同 → 差异锁死在薄宿主适配层（prepare/run/all/get 四原语量级） |
| Turso/libSQL / Litestream | Litestream VFS 重构 = "单文件数据库 + 容灾"正解参照 | 避免引入 libSQL 依赖（维护态 + 供方转 Rust 重写） |
| Better Auth | plugin 三件套（路由+表+客户端方法同源）与契约五用同构；官方 MCP 插件证明"应用作为 OAuth 资源服务器暴露给 agent"是真实需求位 | 不整体 vendor（表结构由库定义，与契约单源冲突）——auth 走生成器路线 |
| Rails 8 / Phoenix 1.8 | 生成器产物即文档；**regen 即升级**（最佳实践随生成器版本下发存量应用）；Solid 三件套 = SQLite 默认化在最大 MVC 框架主流化 | 运行时隐式魔法（concern/回调链/自动加载） |
| 队列格局（新） | BullMQ/pg-boss/Graphile/River 均不适配"零依赖+单文件 SQLite+桌面 exe"——真实空位；River 设计文档 = 自研教材；2026 有"删 Redis"实证趋势 | 不引入 Redis/PG 等第二基础设施 |

### 2.3 全栈 + AI 线（报告三）

| 来源 | 取 | 舍/避 |
|---|---|---|
| Convex | "查询=订阅"是服务端粗粒度信号，与 Atelier 客户端细粒度信号**天然两级串联**；queries/mutations 二分再证读写模型 | 不造 Convex 型数据库（依赖自有 DB 才能做读集追踪）——只做"端点订阅原语"（live 端点 → SSE → 信号图） |
| Encore.ts | "编译即契约"：从服务端源码生成 OpenAPI + 类型化客户端 | 云/runtime 锁定；依赖自有 runtime 而非 Web 标准 API——不跟 |
| Builder.io agent-native（新） | "共享 action 层"（UI 与 agent 同权同校验、自动暴露 HTTP/MCP/A2A/CLI 四通道）与"契约贯通 API 面"同频——模式层最大威胁，必须对表 | 应对 = 不做又一套 action 框架；差异押在机检/门禁/回滚这个它没有的下游 |
| Vercel AI SDK 7（新） | 七条共性 agent 原语（类型化工具/上下文注入/审批 HITL/持久执行/遥测评测/记忆/MCP 互通）= agent 原语行业标准 checklist | 不重造原语——endpoint 契约应成为 AI SDK 式 typed tool 的一等来源；"不内嵌 LLM"红线不冲突（它是库） |
| MCP 2026-07-28（新） | 无状态化 + 显式 handles + Tasks 扩展 = dev 桥架构对齐窗口；长任务建模有现成规范 | Roots/Sampling/Logging 被废弃——dev 桥若用过需迁移 |
| Supabase（新） | Evals 开源 = 平台级 agent 评分基准先例——M3 应开放协议做对外可比指标；branch 工作流与 agent 组合成熟 | RLS 隐式安全模型 = agent 静默越权高发区（反衬 Atelier 契约显式安全位）；平台锁定 |
| Wasp / RedwoodJS | 极小 API 面 + agent 只改业务文件 | Redwood 教训固化：概念过多是负债，复杂度预算被 AI 收紧；DSL 是语料盲区 |
| Tauri 2 + Bun compile（新） | `bun build --compile` 单文件后端 exe → Tauri sidecar + 显式 capabilities：桌面全栈路径每环节有 2026 实践背书，技术风险低 | Bun 已非中立项目（治理风险，见 §7） |
| 实证研究（新） | slopsquatting 21.7%（对策：锁依赖 + import 白名单机检）；"与仓库意图错位"是 PR 失败主因（对策：specs）；错文档比没文档更糟（对策：specs 共置 + 机检同步 + 文档机器生成）；技能包可致害（对策：check-skills） | — |

### 2.4 综合设计公理（v0.2 增补为十二条）

1. **显式内核 + 生成器约定**（Hono×Phoenix 综合）：默认路径显式可读，省力部分由 codegen 承担而非运行时魔法。
2. **契约单源三用 → 全栈五用 + 一个互操作接口**〔定+议〕：决策 6 的"TS 契约单源"从组件扩到端点/数据，同一份扁平 schema 用于：运行时校验 / MCP 工具定义 / 注册表元数据 / 客户端类型生成 / OpenAPI 导出；外加 **Standard Schema `~standard` 接口**作为互操作通道（§4.6）。
3. **读写二分**作为 API 心智模型（query/command，行业已收敛，对齐 loader/action 与 CQRS 浅层版）。
4. **类型错误即反馈**：全链路任何违规最终坍缩为类型错误、契约校验错误（ATR-2xx）或断言失败——TS 7 后类型反馈回路成本降一个量级，可纳入 agent 每步循环。
5. **边界显式可静态判定**：服务端/客户端边界用文件位置 + 编译器校验表达，禁用内联边界指令式魔法（反 RSC）。
6. **数据层 SQL 显式派**：schema 单源 + 编译期生成类型，无运行时查询引擎魔法、无 generate 步骤。
7. **规范文件是框架产物**：AGENTS.md / SKILL.md / llms.txt / struct map 随 init 生成并随 `atelier sync` 同步，文档漂移纳入机检——**"错文档比没文档更糟"已获学术实证，文档必须机器生成而非手写**。
8. **双轨回滚横跨全栈**：状态 checkpoint + 源码 checkpoint 之外，schema 迁移必须有逆（§4.2）。
9. **API 面冻结纪律**：`atelier api-diff`（已落地 P3-4）从 CLI 门禁升级为框架演进纪律本身〔险→纪律〕；交付节奏"宁可 boring"（RR8 年度节奏实证）。
10. **agent 原语与宿主原语同源**：框架既被 agent 开发，也可构建 agent 应用——两用同一套 schema 化工具/流式原语，但零 LLM 依赖。
11. （新）**互操作通过纯接口规范获取**：需要生态兼容时实现 Standard Schema 式纯 TS 接口（copy-paste、零依赖），**不以引入重资产库为代价**。
12. （新）**生成器产物锚定"显式 import 闭合"形态**（生成器形态学第四级：单文件上下文可静态理解），并把"生成后零修改可编译"写进生成器测试门禁（Loco 实证形态）；升级走 regen+diff 而非依赖升级。

---

## 3. 全站架构：五层 → 七层

在既有五层上插入 S0 服务层与扩展 L2 契约层职责（改动最小化，L1/L4/L5 不动）：

```
┌─ L5 人对界面 ──────────────────────────────────────────────────┐
│ review 扩展：端点行为 diff · schema 迁移时间轴 · 全站 checkpoint  │
├─ L4 反馈通道 ──────────────────────────────────────────────────┤
│ atelier dev：前端 HMR + server 面 watch/重启 · 全站审计日志       │
│ （MCP 桥按 2026-07-28 无状态规范对齐；长任务走 Tasks 扩展）       │
├─ L3 代理层（MCP）──────────────────────────────────────────────┤
│ 原有 25 工具 + 全站扩展：endpoint.*（列出/调用/契约查询）         │
│ db.schema（读 schema/迁移状态）· 路由枚举（对标 Next get_routes） │
│ · 运行时内省（组件树/信号图/effect 队列快照，对标 Agent Browser） │
├─ L2 契约层（单一真相，全站化核心）───────────────────────────────┤
│ 前端契约（props/events，〔定〕）+ 端点契约（query/command）       │
│ + 数据契约（表/列/关系）——同一扁平 schema 规范，五用（§2.4-2）    │
│ + `~standard` 互操作口（validate 运行时适配；JSON Schema/openapi │
│   -3.0 为编译期投影，不承诺全语义、不引入 $ref）                 │
├─ S0 服务层（新增，〔议〕核心提案）───────────────────────────────┤
│ atelier-server：端点运行时（读写二分）· 契约校验中间件 · 鉴权原语  │
│ · live 端点（SSE→streamValue 直通信号图）· SQLite 数据访问      │
│ （bun:sqlite/node:sqlite 薄宿主适配）· 可逆迁移器                │
│ ——Web 标准 API 优先，Bun 优化态、Node 兜底（§4.1）              │
├─ L1 内核（〔定〕不动）──────────────────────────────────────────┤
│ 信号引擎 · 事务状态层 · 三态原语 · 渲染器 · 微型校验器            │
│ 扩展口：streamValue 数据源从"任意 URL"升级为"类型化端点引用"      │
│ 待定案：异步表达式策略（D-F9，Solid 2/Svelte async 趋势）        │
└────────────────────────────────────────────────────────────────┘
```

**关键贯通点（全站化的技术心脏）**〔议〕：

```
specs/ 意图规格
   → atelier gen endpoint   生成器：契约 → 端点骨架 + 客户端类型 + MCP 描述（三处同源）
   → contract.ts 单源：组件契约 ∪ 端点契约 ∪ 数据契约（+ ~standard 互操作口）
   → 前端 streamValue(chatQuery, ...) 直连类型化端点（无手写 fetch/无手写类型）
   → live 端点可选：服务端推送 → SSE → 直接写进前端信号图（两级依赖图：
      服务端粗粒度信号 → 客户端细粒度信号，Convex 结构同构但无 DB 锁定）
   → 同一 schema → MCP 工具参数 + OpenAPI 导出 + 注册表
```

即：**契约层从"组件的合同"升维为"全栈的合同"**。agent 改端点契约时，编译器立即报出所有受影响前端调用点（`graph.static` 静态依赖图思想在 API 面的镜像）。

---

## 4. 分项设计（逐条〔议〕，拍板后编号进 design-decisions）

### 4.1 决策提案 A：服务层形态 —— `atelier-server` 内嵌

- **提案**：服务层作为框架内置包（非独立进程），dev 时由 `atelier dev` 同进程/子进程托管，prod 编译为单入口产物。**Web 标准 Request/Response 优先**（Hono/H3 v2/Elysia/Axum 四证收敛的行业底座），**Bun 优化态、Node 兜底**——v0.1 的"运行时绑定 Bun"因 Anthropic 收购（2025-12-02）修订为"优化态而非绑定态"：代码路径全部走 Web 标准 API + 薄宿主适配层，Bun（内建 SQLite/compile/HTTP2）作为默认优化宿主，Node（node:sqlite 内建）作为兜底宿主，桌面 exe = `bun build --compile` 单文件 sidecar。
- **读写二分**：端点声明为 `query`（读，可缓存语义显式声明）或 `command`（写，自动纳入审计 journal）；表单提交天然落 command。命名与 SvelteKit remote functions 同形（行业已验证），差异在**显式注册表**（无编译器魔法）与契约单源。
- **鉴权**：v1 只做原语级——`atelier gen auth` 生成**可读可改的明文会话代码**进应用（Rails 8/Phoenix 1.8 生成器路线，产物显式 import 闭合）；升级走 regen+diff。端点契约元数据预留**鉴权声明位**（供机检与 MCP 读取）；"应用作为 OAuth 资源服务器暴露给 agent"（Better Auth MCP 插件实证的需求位）列为远期扩展口。不 vendor Better Auth。
- **取**：显式扁平内核 + 生成器约定。**避**：DI 容器（NestJS 式，AI 高错区）、装饰器路由、RSC 式内联边界、Bun 私有 API 绑定。

### 4.2 决策提案 B：数据层 —— SQLite 内建基座 + 自研薄生成层

- **提案**：默认库 SQLite。基座 = **bun:sqlite（Bun）/ node:sqlite（Node ≥22.5）双宿主零依赖内建**，差异锁死在 `prepare/run/all/get` 四原语量级的薄适配层（与 dev 面多运行时 vendor 策略一致）。数据契约（表/列/关系）用扁平 TS 定义单源；`atelier gen db` 生成类型化访问层——**正落 TS 生态空位**（sqlc-gen-typescript 仍 preview，无成熟"SQL→TS 类型函数"AOT 生成器），与既有 dump.mjs/codegen.mjs 编译管线同构。迁移器要求**每个迁移可逆**（up/down），迁移即 checkpoint 审计对象。
- **vendor 对照（v0.2 证据）**：Drizzle（schema 即普通 TS 值，最接近）降为 fallback——1.0 仍 RC + 团队归属 PlanetScale 两个路线风险；若其 1.0 stable 后 SQLite 支持不变，vendor 成本评估可重开。Prisma 7 rust-free 但多步 generate 流程未变，仍排除。
- **队列（新增候选）**：后台任务不引 Redis/PG——现有四家队列均不适配单文件 SQLite 形态（真实空位）。候选 = **自研极薄 SQLite 队列**（jobs 表 + 事务内 RETURNING 原子取出 + 指数退避；参照 River 设计清单），红利：command 事务内投递 job = "业务写入与任务投递原子化"。定位 P2+ 候选，先不承诺。
- **边界（诚实）**：v1 不做云端复制（Litestream VFS 为容灾参照；Turso embedded replicas 留观察）；Postgres 适配器为后续可选，先不承诺；浏览器端同方言 SQLite（@sqlite.org/sqlite-wasm / wa-sqlite）留门不实现。
- **避**：运行时查询引擎黑盒、隐式懒加载关系、多步 generate 工作流、libSQL 依赖（维护态）、Bun.SQL 多方言统一 API（与"SQLite 单方言贴 SQL"纪律冲突）。

### 4.3 决策提案 C：客户端-服务端边界 + live 端点

- **提案**：边界 = **文件位置**（`src/server/` 内的代码只在服务端跑，编译器静态校验前端 import 越界即 ATR-1xx 红错），非内联指令。跨边界数据 = 契约 schema 显式声明（扁平、无 $ref 红线〔定〕延续——设计上规避 RSC 式复杂序列化面及其安全前科）。
- **流式与订阅**：`streamValue`（〔定〕决策 5）升级为全栈原语：前端引用类型化 query 端点 → 服务端 SSE 推流 → 同一三态模型消费。**live 端点**（对应 SvelteKit `query.live()` / Convex 订阅）：query 端点可选声明为 live，服务端在写事务后重算受影响查询并推送——"服务端粗粒度信号 → 客户端细粒度信号"两级依赖图；不做 Convex 型 DB 读集追踪，以"写后重放查询"换取数据库自由。**服务器驱动 UI 不做**（决策 4〔定〕冲突重申：live 端点推数据不推 UI 指令，与 LiveView 有本质区别）。
- **异步表达式策略**（时间敏感，联动 D-F9）：Solid 2 / Svelte 5.36+ 均在把 await 纳入响应式图；Atelier expr 求值器需尽快定案"异步表达式是显式原语还是显式拒绝"，避免日后破坏性补课。

### 4.4 决策提案 D：可验证性基建（v0.1"agent 全栈基建"的重新定位）

调研结论：dev 可观测 MCP、AGENTS.md 供给、文档随包已被抢跑；**结构机检、双轨回滚、API 面门禁、首遍正确率对照实验仍无人做**。因此本提案的全部重量压在后四件，工具族按"超集对表"设计：

- **endpoint.\* MCP 工具族**：`endpoint.list`（契约摘要+路由枚举，对标并超集 Next `get_routes`）/ `endpoint.call`（受 confirm 档管束，写审计）/ `endpoint.contract`（扁平 schema 直读）；`db.schema`（schema + 迁移状态只读）。
- **全站 struct**：六层结构机检扩为全栈八层（+server 边界层、+数据契约层）；新增 **import 白名单校验位**（slopsquatting 对策：机检捕获包幻觉 import）。
- **全站双轨回滚**：源码 checkpoint（决策 15〔定〕）覆盖 schema 迁移；迁移回滚与源码回滚联动——`checkpoint.rollback` 检出含未逆迁移的 checkpoint 时强制先执行 down 迁移（confirm=ask 起步）。
- **MCP 桥升级**：按 **2026-07-28 无状态规范**对齐（HTTP 直连+头路由，无会话粘性）；编译流水/struct 检查等长任务按 **Tasks 扩展**建模；扁平红线不变（新规范 $ref 允许非强制，文档显式说明扁平是有意的 LLM 可读性选择）。
- **运行时内省**（对标 Next Agent Browser）：dev 面暴露组件树、信号依赖图、effect 队列的机器可读快照（`store.graph()`/journal 已有基础，扩到服务端面）。
- **agent 应用原语**（框架的第二种用法）：以 AI SDK 7 七条共性原语（类型化工具/上下文/审批/持久执行/遥测/记忆/MCP 互通）为 checklist，全部挂在契约单源之上（工具 schema 来自端点契约而非私有定义）；定位 P2+ 远期，规范先行不实现。
- **OpenAPI 导出**：`atelier export openapi`——挂在 Standard Schema JSON Schema 接口的 openapi-3.0 target 上（§4.6），与 MCP 工具定义共用同一生成管线（tRPC 教训：导出必须内建一等，不能靠插件补丁）。

### 4.5 决策提案 E：语法与语料纪律〔险〕

调研最响的警钟仍是语料断裂（Svelte 5 / Solid 2 双峰实证）。配套纪律（v0.1 三条沿用 + v0.2 一条新增）：

- 语法冻结：前端模板语法（决策 1〔定〕）在全站化期间冻结，扩展只走 codegen 覆盖扩张；
- 示例先行：每个新特性落地时，starter 模板 + 技能包同步更新（check-skills 门禁〔定〕已管；技能包可致害的新实证要求版本与一致性校验更严）；
- API 面 snapshot（P3-4〔定〕）把服务端公共面一并纳入；
- （新）**生成器产物纪律**：全部生成器（gen endpoint/db/auth）产物为"显式 import 闭合"的普通 TS（形态学第四级），进"生成后零修改可编译"门禁测试。

### 4.6 决策提案 F（新增）：Standard Schema 互操作

- **提案**：`contract.ts` 的扁平 schema 对象实现 **Standard Schema V1 `~standard` 接口**（约 60 行纯 TS 类型，官方明示可 copy-paste，零依赖）：`~standard.validate` 委托既有微型校验器（issues 映射为标准 issues）；`~standard.jsonSchema` 为**编译期投影**（放 compiler/ 侧，从扁平 schema 单向生成 draft-2020-12 / openapi-3.0 target，超出扁平语义的 JSON Schema 能力显式不支持而非静默降级）。
- **与决策 6 的关系**：否决 zod/TypeBox/valibot 作契约源的理由（双源/不扁平/API 变动快）2026 全部复核仍成立——决策 6 **加固而非推翻**；被消除的是"不引入这些库就失去互操作"的隐含代价。换得：tRPC/Hono/TanStack/oRPC/NestJS 12 生态可直接消费 Atelier 契约。
- **红线**：禁 $ref/oneOf 不动；不 vendor 任何 schema 库；JSON Schema 投影不承诺全语义。
- **风险标注**：Standard Schema 无正式治理结构（三位作者个人背书）；JSON Schema V1 接口较新（各实现覆盖度未确认）——但接口面积小，适配层风险可控。

### 4.7 决策提案 G（新增）：异步表达式策略

- **提案**：在 L1 内核 expr 层尽快定案（时间敏感：Solid 2 RC 与 Svelte experimental.async 已把"async 进响应式图"推成趋势，拖到全栈化中途定案会重演破坏性补课）。两个候选：①显式 await 原语（模板/派生层显式标注异步点，编译器静态可见）；②显式拒绝（异步只许出现在三态原语与 live 端点边界，expr 保持纯同步）。**倾向②**：与"显式优于隐式"、静态依赖图可判定性、语法冻结纪律三者一致；异步语义收敛在数据边界（三态原语/live 端点）而非表达式内部。待原型验证后拍板。

---

## 5. 应用形态与目录（全站版 init 产物，示意）

```
my-app/
├─ atelier.config.json        # token + agent 档 + build（ssr/build-target 新键）
├─ specs/                     # 意图规格〔定〕——扩端点/数据意图段
├─ src/
│  ├─ main.ts                 # 前端入口
│  ├─ components/*.atr.ts     # 前端组件（决策 1〔定〕，语法冻结）
│  ├─ contract.ts             # ★ 全栈契约单源（组件∪端点∪数据 + ~standard 口）
│  ├─ server/
│  │  ├─ endpoints/*.ts       # query/command 端点（生成骨架 + 手写业务）
│  │  ├─ db/schema.ts + migrations/
│  │  └─ auth.ts              # gen auth 产物，明文可改
│  └─ generated/              # 客户端类型化调用层（勿手改，机检）
├─ AGENTS.md / llms.txt / .mcp.json
└─ tests/                     # 契约守卫 + 边界守卫 + 迁移可逆性守卫
```

CLI 增量：`atelier gen endpoint|db|auth`（生成器族，产物显式 import 闭合 + regen 即升级）、`atelier export openapi`、`atelier migrate`（up/down，接 checkpoint 审计）。MCP 25 → 约 30 工具（endpoint.*/db.schema 三处同步纪律〔定〕照旧；按 Next 8 工具基线做超集对表）。

---

## 6. 不做清单（全站化后的完整版）

沿用 ROADMAP §6〔定〕并新增：
- **不做** RSC/服务器组件、服务器驱动 UI（LiveView）、内联边界指令（"use xxx"式）——§4.3；
- **不做** 运行时魔法 ORM / DI 容器 / GraphQL 层（Redwood 教训 + 复杂度预算）；
- **不做** 云数据库复制、serverless 一等支持（编译期 target 预留，运行时不分支）；
- **不做** 微服务/多服务编排——全站 = **单体工坊**（单仓、单 dev 进程、单产物）；
- **不做** Convex 型响应式数据库、全量同步引擎（ElectricSQL/Zero 类——只做"端点订阅原语"一层）、Redis/独立队列基建（自研薄 SQLite 队列为 P2+ 候选）、libSQL/Bun.SQL 依赖；
- **不做** 缓存指令与服务端片段（全栈原语②③——B 队观察，引入时走显式契约无隐式默认）；
- **仍不做** 内嵌 LLM（红线）。

---

## 7. 与既有决策/路线的关系（诚实的冲突清单）

| 既有定论 | 全站化关系 | 处置 |
|---|---|---|
| 决策 4：SSR 服务器=后期可选插件 | `atelier-server` 是**数据服务层**，非 SSR 渲染服务器 | 不冲突，但须在决策 4 补注记区分，防概念混淆 |
| 决策 0：桌面 exe 一级分发 | SQLite/本地优先/单产物**强化**该决策；bun compile + Tauri sidecar 路径 2026 已成熟 | 顺势；server 面在 exe 内 = sidecar 进程 |
| 决策 5：三态原语 | streamValue 升维为全栈流式 + live 端点 | 兼容扩展，向后兼容 |
| 决策 6：扁平 schema 红线 | 端点/数据契约沿用同规范；`~standard` 互操作不改单源 | 直接延续 + 加固（§4.6） |
| 决策 13a：Bun 官方运行时 | **Anthropic 收购 Bun（2025-12-02）引入治理风险**〔险〕 | Bun 保持优化态：Web 标准 API + 宿主适配层，Node 兜底逃生门常开；runtime vendor 纪律钉住双宿主可运行 |
| 决策 15：git 源码 checkpoint | 扩为全栈双轨（+迁移联动回滚） | 延伸，不冲突 |
| ROADMAP 不做清单：SSR 流式服务器 | 同决策 4 处置 | 需用户确认措辞修订 |
| ROADMAP 阶段四（2027H1 发布） | 全站化是新增大块，**建议插在阶段三之后、发布之前**，否则 npm 首发=前端-only 定位锁死 | 〔议〕路线修订提案 |

**风险登记**：① 服务层是 L 级工程量，可能挤压 F 线收尾（F-2 二期 prod 剥离）；② 自研数据生成层是第二个"重工程件"（缓解：sqlc 空位证据 + fallback Drizzle + 只支持 SQLite 单方言子集）；③ MCP 工具数膨胀逼近 token/描述维护成本（toolsets 分组〔定〕已有解，须严格执行）；④ Bun 治理风险（§7 处置）；⑤ Standard Schema 治理弱（个人背书，接口小、风险可控）。

---

## 8. 度量（沿用北极星，新增全栈判据）

- 北极星不变〔定〕：M3 难任务 agent 首遍正确率；全站化后新增 **全栈任务臂**（含端点+schema 变更的跨端任务，三臂协议照抄）；**M3 评分器开放协议对外可比**（Supabase Evals 2026-08 开源先例——"平台/框架自带 agent 评分"已成新品类）；
- 类型贯通判据：改一条契约，`atelier check` 能报出全部受影响前端调用点（影响面召回 = 机检可证）；
- 迁移可逆判据：迁移守卫测试红检先红后绿；
- API 面判据：服务端公共面 snapshot diff 零未豁免 breaking；
- （新）互操作判据：Atelier 契约对象可被 tRPC/Hono 式 Standard Schema 消费端直接 validate（一个 golden 测试即判据）。

---

## 9. 拍板清单（本文全部〔议〕项汇总）

| # | 提案 | 一句话 |
|---|---|---|
| D-F1 | 立项全站化方向 | 采纳 §1.3 定位（工坊 + **可验证性基建**）与 §3 七层架构 |
| D-F2 | 服务层形态 | `atelier-server` 内嵌、读写二分、gen auth 明文产物、**Bun 优化态 + Node 兜底**（§4.1） |
| D-F3 | 数据层 | SQLite 内建基座（bun:sqlite/node:sqlite 宿主适配）+ 扁平数据契约 + 自研薄生成层 + 可逆迁移；Drizzle 为 fallback（§4.2） |
| D-F4 | 边界模型 | 文件位置边界 + 契约显式跨界，否决 RSC/内联指令（§4.3） |
| D-F5 | 可验证性基建 | endpoint.*/db.schema 工具族（超集对表 Next 8 工具）+ 全站 struct（含 import 白名单）+ 迁移联动回滚 + 运行时内省 + MCP 2026-07-28 对齐（§4.4） |
| D-F6 | 路线修订 | 全站化插入阶段三后、npm 发布前（§7）；F 线收尾优先级不变 |
| D-F7 | 语法冻结纪律 | 全站化期间前端 DSL 冻结；生成器产物"显式 import 闭合 + 生成后零修改可编译"门禁（§4.5） |
| D-F8 | Standard Schema 互操作 | 自有扁平 schema 实现 `~standard` 接口 + 编译期 JSON Schema/openapi-3.0 投影；禁 $ref 不动；不引入 schema 库（§4.6） |
| D-F9 | 异步表达式策略 | expr 层尽快定案：显式 await 原语 or 显式拒绝（倾向后者：异步收敛在三态原语/live 端点边界）（§4.7） |
| D-F10 | 叙事与度量 | "agent 基建"→"可验证性基建"叙事修订；M3 评分器开放协议对外可比（§1.3/§8） |

> 本文为设计书，不携带实现承诺。拍板后：每项抄送 BACKLOG 立项、决策定稿写入 design-decisions（编号顺延 17+）、本文降级为背景文献。事实性结论（版本/日期/采纳面）以三份调研报告及其"不确定项清单"为准；报告中标注（未确认）的条目在本文引用处均已弱化为方向性表述。
