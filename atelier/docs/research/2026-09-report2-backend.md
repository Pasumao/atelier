# 后端框架与数据层深度调研（2025H2–2026）——报告二

> 性质：《全站化调研原始报告归档》（`2026-fullstack-survey.md`）中"报告二：现代后端/Web 服务框架"的深化重写版。本轮为后端部分单独深挖，逐项复核旧报告事实并给出修正。
> 检索日期：2026-09-19（检索工具：WebSearch/WebFetch 多轮交叉验证；优先官方 changelog/blog/GitHub releases/npm）。
> 委托方背景：Atelier 立项升级为全栈 AI 框架（atelier-server 服务层：读写二分 query/command 端点、SQLite+生成式类型数据层、契约 schema 五用、文件位置式前后端边界）。北极星指标：**AI agent 首遍正确率**。硬约束：零运行时依赖、显式优于隐式、扁平 TS schema（禁 $ref/oneOf）、Web 标准 API 优先、运行时倾向 Bun、桌面 exe 一级分发、框架不内嵌 LLM。
> 所有"未确认"说法均显式标注；关键事实附来源 URL。

---

## 0. 结论速览

| 框架/库 | 版本（检索日 2026-09-19） | 架构范式 | AI 友好度 | 对 atelier-server 的可取/应避（一句话） |
|---|---|---|---|---|
| Hono | 4.13.7 | Web 标准 API、零依赖小内核、RegExpRouter 编译式路由 | 高（语料大、显式、错误直白） | 可取：路由/中间件内核形态与 Web 标准姿势可对照自研；应避：生态胶水全自组装的空档别照抄 |
| Fastify | 5.12.4 | 插件封装树 + JSON Schema 三用（校验/序列化/文档） | 中高（语料大但封装作用域是隐式魔法） | 可取：schema 编译期三用思路与契约五用同构；应避：addHook/封装作用域的隐式传播 |
| Express 5 | 5.2.1 | 回调链 + 中间件管线（历史包袱型） | 高语料/低类型（回调错误处理仍靠约定） | 仅作兼容参照；架构不可取 |
| Elysia | 1.4 stable / 2 beta（2026-09） | Bun 原生、schema 即单一真相源、Eden 类型贯通 | 中（语料少、大版本漂移快） | 可取："TS→OpenAPI 无注解导出"与契约五用直接同题；应避：API 版本快速漂移 + 绑 Bun 私有 API |
| Nitro v3 / H3 v2 | v3 beta / v2 beta | 文件路由 + 部署 preset 编译期多 target | 中 | 可取：preset=编译期部署目标思想；应避：beta 期 API 不稳 |
| NestJS | 11.1.x（12 已出，2026-08） | 装饰器 + DI + 反射元编程 | 低-中（反面参照） | 应避：DI 容器/装饰器对 AI 是高幻觉面；仅借鉴其 NestJS 12 拥抱 Standard Schema 的信号 |
| Bun 运行时 | 1.4.x（2026-08 Rust 重写；**2025-12 被 Anthropic 收购**） | 全工具链运行时（SQL/Redis/SQLite 内建） | 高（Claude Code 底座 = 语料与投入双加成） | 可取：bun:sqlite/Bun.compile 支撑"单二进制+SQLite"默认形态；应避：已非中立社区项目，属 Anthropic 战略资产 |
| Deno | 2.8.x | 权限沙箱 + V8 + compile 单文件 | 中高 | 观察位：self-extracting 二进制对桌面分发有参照价值 |
| tRPC | 11.18.0 | procedure + Standard Schema 校验、端到端类型零 codegen | 高 | 可取：其"任何 Standard Schema 校验器可插"证明扁平自有 schema 路线可行；应避：无 OpenAPI 面向外部 |
| oRPC | 1.0（2025） | RPC + 原生 OpenAPI 双面 | 中（语料少但成熟度升） | 对照组：验证"RPC 内面 + OpenAPI 外面"双面导出的可行性 |
| **Standard Schema** | V1（Typed/Schema/JSON Schema 三接口） | 纯 TS 接口规范（~60 行，无运行时依赖） | 规范本身即 AI 互操作层 | **关键结论：Atelier 自有扁平 schema 应实现 `~standard` 接口（copy-paste 即可，零依赖），以此换生态互操作，不必引入 zod 作契约源** |
| Zod | 4.5（z.compile AOT） | 运行时 schema + 类型推断 | 极高（事实标准） | 仍不作契约源（双源/不扁平理由成立）；但需适配其 Standard Schema 接口形态 |
| Drizzle | 0.45.2 stable / 1.0.0-rc.4；团队已加入 PlanetScale | 贴 SQL 的类型化查询构造器，无查询引擎 | 高 | vendor 候选第一名，但 1.0 未 stable + 归属变动 = 引入时机风险；自研薄生成层仍有一席 |
| Prisma | 7.x（2025-11 rust-free） | DSL schema + 生成客户端（TS 化运行时） | 中（generate 步骤仍是 AI 出错点） | 应避：多步 generate、DSL 与 TS 双源；rust-free 改善了部署面但流程复杂度未消 |
| Kysely | 0.29.5 | 纯类型 SQL 构造器 | 中高 | 备选：若要"贴 SQL 但不要 ORM"，Kysely 是成熟 vendor 项 |
| bun:sqlite / Bun.SQL | Bun 1.3+ | 内建同步 SQLite / 统一 SQL API | 高 | **数据层基座首选**：零依赖、同步快、单文件 |
| Turso/libSQL | 转向 Rust 重写（2025-01），libSQL/sqld 维护态 | 内嵌 libSQL + embedded replicas | 中 | 应避：libSQL 依赖进入维护期；embedded replicas 概念可借鉴 |
| Litestream | 2025-05 VFS 重构 | SQLite 流式复制/备份 | 中 | 借鉴对象：VFS 层复制是"单文件数据库 + 容灾"的正解方向 |
| Better Auth | 1.5（2026-02-28）/ 1.4（2025-11-21） | 框架无关 + 插件树 + 官方 MCP 插件（OAuth 2.1 server） | 中高 | 不整体 vendor；借鉴其"auth 生成器式产物 + MCP 授权插件"方向 |
| OpenAuth | beta（2024-12 起） | 自托管 OAuth 2.1 server | 低-中（维护波动） | 不建议依赖 |
| Lucia | 已停更（2025-03 前后）→ 转教学资源 | 会话式 auth 教学 | — | 其"文档即产物"的停更方式本身值得借鉴 |
| BullMQ / pg-boss / Graphile Worker / River | 12.x / 12.33.x / 0.14+ / 多 major | Redis / PG / PG / PG | 中高 | 对 SQLite 单文件形态均不适配 → 自研极薄 SQLite 队列有空位（2026 已有"删 Redis"实证趋势） |
| Rails 8.x | 8.0（2024-11）/ 8.1 | 约定优于配置 + 生成器可读产物 + Solid 三件套 | 高 | **生成器路线最佳参照**：authentication 生成器"明文可读可改"正是 atelier init 应走形态 |
| Laravel 12 | 12.x（2025 初） | 约定 + 官方 starter kits | 高 | starter kits（React/Vue/Livewire）= "init 即组装完整切片"的对照样本 |
| Phoenix 1.8 | 1.8.13 | 生成器 + 可读产物天花板 | 高 | phx.gen.auth 默认 magic link 化 = 生成器跟随最佳实践演进，产物永远"当前正确" |

---

## 1. TS 服务框架

### 1.1 Hono 4.x（当前 4.13.7）

**① 现状与时间线**（检索日 2026-09-19）：4.12.2（2026-02-23）修复 `X-Forwarded-*` 头处理安全问题；4.12.x 系列一路 patch 到 4.12.32；当前 minor 线 4.13.x，npm 最新 4.13.7（约 2026-09-04 发布）。4.13 release notes 主题是一串微优化：跳过不必要的 `Headers` 分配、把正则 test 换成 `indexOf`、削减内部状态分配。发布节奏极快（一周多 patch）。来源：https://github.com/honojs/hono/releases 、https://www.npmjs.com/package/hono

**② 内部架构**：Hono 的核心资产是三件套——(a) **RegExpRouter**：注册期把所有路由 compile 成少数几个大正则，匹配 O(1) 次 exec，这是它宣称"ultrafast"的机制基础（相对逐条遍历）；(b) **SmartRouter**：启动时按运行时能力在 RegExpRouter 与线性 TrieRouter 间择优；(c) **Web 标准 API 单抽象**：全框架只面向 `Request`/`Response`/`URL`/`Headers`，因此一个内核跑 Cloudflare Workers/Deno/Bun/Node（Node 侧垫 @hono/node-server）。中间件是洋葱模型（组合函数），RPC 面（`hc` 客户端）通过链式调用把 handler 类型贯通到客户端。2026 年生态关键变化：官方新增 **`hono/standard-validator`**（约 2026-08 更新），用 Standard Schema 规范接受任意校验器（Zod/Valibot/ArkType…），替代此前一个个库单独出 validator 中间件的碎片做法（`@hono/valibot-validator` 等仍在）。来源：https://hono.dev/middleware/third-party 、https://github.com/honojs/middleware

**③ 优缺点**：优点——零依赖、可移植面最广、路由与中间件内核可被静态理解；`hc` RPC 让"不用 tRPC 也有类型贯通"。缺点——认证/ORM/DI 等"胶水层"全靠自组装，项目结构无约定；类型贯通依赖中间件书写顺序，写错 validator 位置类型链会静默断裂（社区常见 issue，未系统统计）。

**②补充（类型机制）**：Hono 的类型贯通不走代码生成也不走运行时反射，而是**纯 TS 链式泛型累积**：`new Hono<{Bindings: Env}>()` 把环境类型绑进实例泛型，`.get(path, handler)` 的路径字符串以模板字面量类型参与推导（`:id` 段推导为 `string`，`:id{[0-9]+}` 推导出约束），中间件按注册顺序以函数重载累积进 `Env`/上下文交叉类型——所以"validator 写在 handler 前才有 c.req.valid() 类型"是链式泛型的必然结果而非文档约定。这条路线的代价是类型链深度随中间件数量线性增长，tsc 报错位置与根因距离拉大；收益是运行时零类型开销（对比 NestJS 的 emitDecoratorMetadata 反射路线）。**对 AI 的含义**：类型错误发生在"写错的那个调用点"附近，可定位性好于反射路线，但链式泛型一旦断裂，修复需要理解整条链——Atelier 若走"注册表 + 编译期展开"，可在展开期把此类错误前置为编译器诊断，比 Hono 又进一步。

**④ AI 友好度**：语料量在 TS 服务框架中仅次于 Express/Fastify；代码形态"每文件显式 import + 链式定义"，首遍正确率高。幻觉高发面：版本敏感的 API 差异（如 `hono/vercel`、adapter 命名）与 middleware 泛型参数。类型反馈质量：`hc` 的类型链错误信息可读，但深嵌套时 TS 报错点离根因远。

**⑤ 对 Atelier**：可取——Web 标准单抽象 + "路由表编译成静态结构"的内核思想，与 Atelier 编译器"模板→静态 effect 图"同构，atelier-server 的 query/command 端点注册表可以走同一条"编译期展开"路线。应避——Hono 生态的"中间件拼装无约定"正是 Atelier 该用文件位置约定补掉的部分。

### 1.2 Fastify 5.x（当前 5.12.4）

**① 现状与时间线**：5.0.0 发布于 2024-09-17（Node ≥20）；v4 LTS 已于 2025-06-30 关闭，v5 是唯一受支持大版本；当前 5.12.4（2026-09 中旬）。有明确 LTS 政策。来源：https://github.com/fastify/fastify/releases 、https://fastify.dev/docs/latest/Reference/LTS/

**② 内部架构**：三个机制值得讲透——(a) **插件封装树**：`register` 产生子作用域，装饰器/hook 只对子树可见，这是它的"隐式魔法"来源（AI 常错在"为什么这个 decorator 在那里不可见"）；(b) **JSON Schema 三用**：route 上挂 `schema` 对象后，请求校验用 ajv、响应序列化用 fast-json-stringify（按 schema 生成专用 stringify 函数，比 JSON.stringify 快数倍）、OpenAPI 文档由 @fastify/swagger 从同一 schema 生成——"一份 schema 三处消费"是业界最早把契约复用做进运行时的框架；(c) **avvio 引导**：插件树按依赖序异步加载，`fastify-plugin` 用来打破封装。缺点面：JSON Schema 本身带 $ref/$defs，与 Atelier"禁 $ref/oneOf"的扁平 schema 纪律冲突。

**②补充（生命周期管线）**：Fastify 对每个请求跑一条固定的生命周期钩子序列：`onRequest → preParsing → preValidation → preHandler → handler → onSend → onError`（还有 preSerialization 等），每级钩子都在封装树的当前作用域内解析——同一个钩子名在父子作用域可以有不同实现，这是性能模型的来源（每级钩子编译进请求快路径）也是认知模型的负担（AI 必须在脑内重建"这个装饰器/钩子在树里挂在哪"）。与 Hono 的自由洋葱模型相比，Fastify 把顺序做成了**固定槽位**——顺序显式化是对 AI 有利的方向，但"槽位 × 封装树"二维耦合仍隐式。

**③ 优缺点**：优点——性能与工程成熟度（LTS、官方插件面、OpenTelemetry 集成）都是 Node 生态第一梯队；schema 三用思想先进。缺点——封装作用域的隐式性、JSON Schema 的非扁平性、TS 类型与 JSON Schema 双源（typeBox/zod 桥接补丁感）。

**④ AI 友好度**：语料充足；错误处理与生命周期钩子文档化程度高。幻觉高发面：hook 触发顺序与封装层级、Type Provider（typebox vs zod vs json-schema-to-ts 三条路线混杂在语料里）。

**⑤ 对 Atelier**：可取——**"契约单源多处编译消费"的架构证明**（Fastify 证明了 schema→校验器+序列化器+文档的三编译管线在工程上成立，Atelier 契约五用是它的超集：+MCP 工具定义+客户端类型+注册表）。应避——JSON Schema 形态本身与封装作用域。

### 1.3 Express 5（当前 5.2.1）

**① 现状**：5.1.0 于 2025-03 成为 npm `latest`（`npm i express` 即装 5）；当前 5.2.1（npm 页显示约 2025-12-01 前后发布）。来源：https://expressjs.com 、https://www.npmjs.com/package/express

**② 架构**：仍是回调链中间件管线 + path-to-regexp；5 的实质变化是路径语法收紧、promise rejection 自动转发到 error handler、`req.query` getter 化等清理。无类型推导、无 schema 概念，契约靠社区补（express-validator 等）。

**③④⑤**：存量生态最大 → AI 语料最多，但新旧 4/5 写法混杂造成"时代错乱"型幻觉（典型：`res.send(status)` 数字签名在 5 移除、`req.query` 语义变化，AI 常按 4 的语料生成 5 的代码）。迁移现实：大量存量应用滞留 4.x，社区教程/Stack Overflow 答案 4/5 混杂且无版本标注——**"无版本标注语料"是 Express 对 AI 的独有负资产**（其他框架语料少但新，反而是"时代单一"的）。对 Atelier：仅作兼容/迁移目标参照，架构不可取。旧报告判断（"生态存量稳态、4/5 混杂致混淆"）本轮复核**仍成立**。

### 1.4 Elysia 1.4 / 2 beta（Bun 系）

**① 现状与时间线**：1.4 加入 **Standard Schema** 支持（bring-your-own-validator：Zod/Valibot/ArkType/Effect 均可插，且保留类型推断与 OpenAPI 生成）；Eden 客户端最新 1.4.9（2026-03-31）；**Elysia 2 进入 beta（约 2026-09，"DayDream"），为完全的模块化重写**。来源：https://elysiajs.com 、https://github.com/elysiajs/eden 、GitHub Discussion #1776

**② 内部架构**：核心命题是"**schema 即单一真相源**"——路由上挂的校验 schema 同时驱动：请求校验、TS 类型推断（`t.Object({...})` 静态推导出 handler 上下文类型）、OpenAPI 文档、Eden 客户端类型。2 beta 期宣传的杀手锏是 **"TypeScript to OpenAPI"：直接从 TS 类型（含 Prisma/Drizzle 推导类型）生成 OpenAPI spec，无需注解/配置/CLI**（vendor 宣传口径，机制细节未深核，标注未确认）。实时面用 µWebSockets.js（Node 上）/Bun 原生 WS。性能宣称 21× Express / 6× Fastify（vendor benchmark，未独立复核）。

**③ 优缺点**：优点——TS 生态里"框架核心内建类型契约"的最完整实现；性能激进。缺点——大版本 API 漂移快（1→2 重写）、深度绑定 Bun 私有 API（`Bun.serve` 内建对象）、语料薄。

**④ AI 友好度**：语料少是最大短板；`t.*` schema DSL 与 Zod 相似但不同名，AI 混写两套 API 是实证高发错误（社区 issue 与讨论常见，未系统统计）。2 beta 落地后会重演"S4/S5 双峰语料"问题。

**⑤ 对 Atelier**：可取——**"schema 四用（校验/类型/OpenAPI/客户端）做进框架核心"证明 Atelier 契约五用不是空想**，且 Elysia 的"TS→OpenAPI"直接是 Atelier 五用之一（OpenAPI 导出）的先行者；其失败点（DSL 私有化、漂移快）提示 Atelier 应让契约就是普通 TS 类型+值对象而非私有 DSL。应避——绑定 Bun 私有 API（Atelier 需保持 Web 标准 API 优先）。

### 1.5 Nitro v3 / H3 v2

**① 现状**：H3 v2 beta 宣布于 2025-06-10；Nitro v3 beta 升级到 H3 v2；Nuxt 3 EOL 定在 2026-07-31，生态正迁移到 Nuxt 4 / Nitro v3 + H3 v2。来源：https://h3.dev 、https://nitro.build 、https://www.herodevs.com

**② 架构**：H3 v2 **完全重写为 Web 标准原语**（`Request`/`Response`/`Headers`/`URL`），事件对象（`event.node.res` 等）私有形态退场——这与 Hono 的姿势合流，等于宣告"Web 标准 API 优先"已是 TS 服务层共识底座。Nitro 的差异化资产是 **presets**：同一份代码编译期决定输出为 Node server / Cloudflare Workers / Vercel / Bun 等 target（unenv 垫片补 API 差异）。

**③④⑤**：AI 友好度中——文件路由约定清晰，但 Nitro 配置面（runtime config、storage 层、preset 差异）幻觉多。对 Atelier：可取"部署 target = 编译期配置"思想（Atelier 已有编译器，preset 机制成本低）；应避 beta 期直接 vendor。

### 1.6 NestJS 11 → 12（反面参照）

**① 现状**：11 发布于 2025-01-22，patch 到 11.1.28（2026-07）；**12 已发布（2026-08 前后）**：ESM-ready 包、CLI 默认值更新、**一等 Standard Schema 支持**。来源：https://docs.nestjs.com/migration-guide 、https://trilon.io/blog/announcing-nestjs-11 、https://github.com/nestjs/nest/releases

**② 架构**：装饰器 + 反射元数据 + DI 容器 + 模块树。运行时靠 `emitDecoratorMetadata` 反射出参数类型做依赖注入——这是一层"编译期不可见的隐式图"：AI 读单个文件无法知道依赖从哪来、生命周期归谁管，必须读全项目才能建立图景。

**③④⑤**：作为反面参照的价值在 2026 反而更清晰——企业级大项目仍选它（结构强制、testability），但 **AI 首遍正确率场景下 DI/装饰器是系统性负资产**：(a) 符号解析跳转多——一个请求路径要跨 controller/provider/module 三类文件；(b) 依赖注入靠构造函数参数类型反射，读代码无法静态确认依赖从哪来；(c) 生命周期钩子（onModuleInit 等）与 DI 范围（singleton/request-scoped）组合出运行时才暴露的错误；(d) 装饰器语法本身依赖实验性 TS 编译选项（`experimentalDecorators`），AI 在新旧两套装饰器语义（TS 5 标准装饰器 vs 旧实验版）间混写是实证错误面。NestJS 12 拥抱 Standard Schema 是重要信号：连最"重"的框架都在向互操作规范收敛。对 Atelier：**文件位置式边界 + 显式 import 的注册表**就是"无 DI 容器的依赖注入"，坚持显式。

### 1.7 Bun 作为底座（1.2 → 1.4）：两个重磅事实

**① 现状与时间线**（全部官方 blog 双源确认）：
- 1.2（2025-01）：大版本节奏起点，Node 兼容大扩展。
- 1.3（2025-10-10）：定位从"快运行时"转向"完整 JS 工具链"——**Bun.SQL 统一 SQL API（MySQL/MariaDB/PostgreSQL/SQLite 零依赖零配置）**、内建 Redis 客户端、package catalogs、异步堆栈追踪。来源：https://bun.com/blog/bun-v1.3 、https://www.infoq.com（2026-01-01 报道）
- **2025-12-02：Bun 被 Anthropic 收购**（Claude Code 本身就是 Bun 可执行分发；官方声明用途为 Claude Code / Claude Agent SDK / 未来 AI 编码工具的基础设施）。来源：https://bun.com/blog（"Bun is joining Anthropic"）、https://www.anthropic.com（"Anthropic acquires Bun as Claude Code hits $1B"，2025-12-03）
- 1.4（2026-08-20）：**从 Zig 重写为 Rust**（为什么重写的专文 2026-07-08 发布）；修复 2900+ issue；idle CPU 降 5×、内存最多降 35%、Linux 启动快 50%；Bun.WebView（内建无头浏览器自动化）、Bun.Image、Bun.markdown、cron、Node 26.3 兼容、Windows ARM64。1.4.1（2026-09-04）：**`Bun.serve` 支持 HTTP/2**、`bun install --offline`、crypto.argon2、**编译产物更小**；1.4.2（2026-09-05）修了影响 Elysia 的回归。来源：https://bun.com/blog

**② 架构**：`bun:sqlite` 是内建同步 SQLite（C 层直绑，无 IPC）；Bun.serve 是"框架功能下沉运行时"的极限形态（HTTP 路由/WS/文件路由宏）。1.3 的 Bun.SQL 把多数据库客户端统一成一套 API——这是运行时层"数据访问标准化"的信号。

**③④⑤ 对 Atelier**：Bun 1.3/1.4 的内建面（SQLite 同步 API、compile 单文件、HTTP/2）恰好覆盖 atelier-server 的全部底座需求（SQLite 数据层 + 桌面 exe 一级分发）。**但 Anthropic 收购是必须写进决策文档的新变量**：正读——北极星指标同为 AI agent，Anthropic 有持续投入动机，Claude Code 以 Bun 分发 = 语料与实战加成；负读——运行时不再是中立社区项目，路线图服务于 Anthropic 产品（1.4 就修了 Claude Code 相关的优先项，未确认哪一项具体对应）。缓解：Atelier 保持 Web 标准 API 优先即保有机动性（代码可在 Node/Deno 跑，Bun 是优化态而非绑定态）。

### 1.8 Deno 2.x（当前 2.8.2）

2.7（2026 年中）稳定 **Temporal** 日期 API、加入 **self-extracting compiled binaries**（自解压编译二进制）；2.8.2（2026-06-03）改进 `deno compile --bundle` 依赖解析、npm 包按需嵌入（只嵌入实际 reach 的包）、`--minify`。安全模型仍是零默认权限。来源：https://deno.com/blog 、GitHub releases。对 Atelier：观察位——Deno compile 的"按需嵌入 npm 依赖"思路对桌面 exe 体积优化有直接参照价值；Deno 2.x 的 npm 兼容已使 Atelier 的 vendor 产物（零依赖 TS）天然可跑。

---

## 2. 类型安全 API 层与 Standard Schema（本次调研关键问题）

### 2.1 tRPC v11（当前 11.18.0）

**① 现状**：v11 正式发布 2025-03-21；当前 11.18.0，维护活跃。来源：https://trpc.io/blog/announcing-trpc-v11 、npm

**② 架构**：procedure（query/mutation）+ input/output 校验器 + 链式中间件；类型经 `AppRouter` 类型对象端到端贯通客户端，**零 codegen**。内部机制要点：(a) procedure 是可组合单元（`publicProcedure.input(schema).use(mw).query(fn)`），中间件以链式泛型累积出 `ctx` 交叉类型——与 Hono 同一类型路线但组合语义更强；(b) 客户端 `createTRPCReact` 从 `AppRouter` 类型直接推导出所有可调用过程与入参出参类型，**服务器改动即时在客户端编译报错**——这是"类型即验收 harness"的最纯样本；(c) 传输层默认 HTTP batch link（N 个调用合一个请求），流式/订阅（SSE/WS）在 v11 稳定。关键 2026 事实：**v11 的 input/output 校验器已支持任何 Standard Schema 兼容库**（Zod 为默认推荐，Valibot/ArkType 开箱即用）。来源：https://trpc.io/blog/announcing-trpc-v11 、https://trpc.io/docs/validators

**③④⑤**：AI 友好度高（语料大、模式收敛成"procedure + z.object"两件套）；幻觉高发面：v10/v11 混杂、batch linking 等客户端进阶件。对 Atelier：tRPC 的教训是"与 OpenAPI 世界隔离"（trpc-openapi 插件 2024-11 后无更新）——**Atelier 契约五用里 OpenAPI 导出必须是内建一等能力，不能走插件补丁**；tRPC 接受任意 Standard Schema 校验器这一事实直接支持"Atelier 自有扁平 schema 也能插进 tRPC 式消费端"的判断。

### 2.2 oRPC 1.0

**① 现状**：v1 发布约 2025-04（Zuplo 报道 2025-04-22），InfoQ 2025-12-19 专题报道其 1.0 "full OpenAPI integration"。来源：https://zuplo.com/blog（oRPC v1）、InfoQ

**② 架构**：对标 tRPC 的 procedure 模型，差异点：(a) **原生 OpenAPI 生成**——同一份 procedure 定义可同时以类型化 RPC 与 OpenAPI REST 两种面暴露；(b) 多运行时/多框架适配；(c) v2 期在无专用转换器时**回退用 Standard Schema 的 JSON 转换**生成 OpenAPI——即把 Standard Schema JSON Schema 接口当作类型→OpenAPI 的通用桥。

**③④⑤**：AI 语料仍少（2025 崛起的新库），但成熟度与旧报告"较新，语料少"时点比已上台阶。对 Atelier：oRPC 是"RPC 内面 + OpenAPI 外面双面导出"路线的最小可行性证明，可直接作为 atelier-server 契约五用中"MCP 工具定义 ↔ OpenAPI 导出"双面形态的对照实现。

### 2.3 Standard Schema 规范（关键问题，独立小节）

**① 规范现状**：官网 standardschema.dev，作者为 Zod（colinhacks）/Valibot（fabianhiller）/ArkType（ssalbdivad）三方作者联合设计；npm 包 `@standard-schema/spec`（npm + JSR）；GitHub 约 3.6k stars。**规范是三个纯 TypeScript 接口，约 60 行**：
- **Standard Typed V1**：`~standard` 属性 + vendor 名/版本 + input/output 类型推断；
- **Standard Schema V1**：加 `validate()` 函数（同步或异步返回 value/issues）；
- **Standard JSON Schema V1**：加 **JSON Schema 生成器接口，目标显式支持 `"draft-2020-12"`、`"draft-07"`、`"openapi-3.0"`**（不支持的 target 库应 throw，其余 best-effort）。
来源：https://standardschema.dev 、https://github.com/standard-schema/standard-schema

**② 实现库（schema 侧）**：Zod、Valibot、ArkType、Effect Schema 四大主流实现；TypeBox 尚为 open issue（其 issue 里注明 zod/valibot/arktype 经 `standard-json-schema` 包导出）；Superstruct/io-ts/Runtypes 等长尾未见官方实现。来源：https://standardschema.dev 、Inngest 博客（2026-06-10）、TypeBox GitHub issue

**③ 消费端（工具侧）——2025H2–2026 的采纳面是本轮最重要的新证据**：
- **tRPC v11**：input/output 校验器接受任意 Standard Schema；
- **Hono**：官方 `hono/standard-validator`（约 2026-08 更新），且与 `hc` RPC 类型贯通兼容；
- **TanStack Router/Start/Form**：全家族支持 Standard Schema 输入（官方文档与迁移文档明确"定义工具时用 ArkType/Valibot 可以整个丢掉 zod"）；
- **oRPC**：以 Standard Schema JSON 转换为 OpenAPI 生成的回退桥；
- **NestJS 12**：一等 Standard Schema 支持。
来源：https://trpc.io/docs/validators 、https://hono.dev 、https://tanstack.com 、InfoQ/oRPC、https://docs.nestjs.com

**④ 对 Atelier 决策 6（否决 zod/TypeBox/valibot 作为契约源）的影响——结论**：
1. **否决的理由不变**：双源（schema DSL ≠ 类型）、非扁平（$ref/oneOf 能力诱惑）、API 变动快（Zod 3→4 迁移成本刚发生过）——这三条在 2026 全部仍然成立（Zod 4.5 仍在快速加 API，如 `z.compile()` AOT）。
2. **但否决的隐含前提被推翻**：旧前提是"不引入这些库就没有生态互操作"。Standard Schema 是**纯接口规范，无运行时依赖**——库通过 `~standard` 属性实现，规范代码块官方明示可 copy-paste。**Atelier 自有的扁平 TS schema 对象完全可以实现 Standard Schema 三接口**：`~standard.validate`（Atelier contract.ts 校验器已有等价能力）、`~standard.jsonSchema`（扁平 schema→JSON Schema/openapi-3.0 的单向导出生成器，方向是从扁平 schema 生成，不引入 $ref 解析）。这一步给 Atelier 免费换来：tRPC/Hono/TanStack/Form 生态直接可消费 Atelier 契约。
3. **建议形态**：在 `contract.ts` 增加 `~standard` 属性（纯 TS 类型 + 现有校验逻辑的适配，零新依赖、不 vendor 任何包）；JSON Schema V1 接口做成**编译期生成器**（放 compiler/ 侧，而非 runtime），这样 runtime 内核仍零依赖且不背 JSON Schema 全语义。**即：兼容 Standard Schema 规范 = 是；引入 schema 库 = 否。**（此为本轮调研给出的独立结论，详见 §12 综合。）

   形态 sketch（示意，非实现）：
   ```ts
   // runtime/contract.ts 侧：适配层，~30 行量级
   interface AtelierSchema<T> { /* 现有扁平 schema：type:"object", fields:{...}, … */ }
   // 挂载 ~standard 后即满足 Standard Schema V1 消费端（tRPC/Hono/TanStack Form…）
   const s = defineSchema({ kind: "object", fields: { id: integer() } });
   s["~standard"].validate(input);   // 委托给现有 contract.ts 校验器，issues 映射为标准 issues 列表
   // compiler/ 侧：s["~standard"].jsonSchema.convert("openapi-3.0")
   //   由 codegen.mjs 从扁平 schema 生成（仅 object/array/string/number/boolean 等扁平关键字投影）
   ```
   关键取舍：`validate` 是运行时适配（已有逻辑换壳），`jsonSchema` 是编译期投影（不承诺 JSON Schema 全语义、不引入 $ref/$defs——输出即扁平投影，超出的 JSON Schema 语义显式不支持而非静默降级）。

### 2.4 Zod 4 / 校验库格局

**① 现状**：Zod 4.5（2026-08-28）发布 `z.compile()`——schema 预编译（AOT），宣称每 schema 内存最多省 9×；Zod 4 相对 3 的基准：字符串解析 14×/数组 7×/对象 6.5× 提速（InfoQ 2025-08 口径）；v3→v4 提供渐进升级路径。Valibot/ArkType 持续以体积（Valibot）与"运行时 TS 类型等价"（ArkType）差异化；三库作者已把精力投向 Standard Schema 共同层。来源：https://zod.dev 、InfoQ

**② 对 Atelier**：格局判断——校验库竞争已经从"谁的 API 好"转向"谁的互操作面好 + 谁能 AOT 化"。Atelier 的扁平 schema 走的是第四条路（**schema 即普通 TS 值，编译期展开为静态 effect 图**），与 Zod 4.5 的 `z.compile()` AOT 化方向不谋而合，证明"校验逻辑编译期化"是行业正确方向。仍不建议 vendor：Atelier 契约需要同时服务五个消费面，zod 对象承载不了注册表/MCP 工具描述等非校验元数据而不膨胀。

**四库对照（对 AI 生成友好度视角）**：

| 库 | 最新版（2026-09 检索） | 形态 | 扁平度 | Standard Schema | AI 语料 | 幻觉高发面 |
|---|---|---|---|---|---|---|
| Zod | 4.5（z.compile AOT） | 运行时对象 + 类型推断 | 中（链式方法多） | ✓ | 最大 | v3/v4 时代错乱 |
| Valibot | 1.x 线 | 函数组合、tree-shakeable | 中高 | ✓（发起方之一） | 中 | v0.31→v1 API 变动 |
| ArkType | 2.x | TS 类型语法的运行时镜像（`type("string>5")`） | 高 | ✓（发起方之一） | 小 | 关键字语法与 TS 类型系统差异处 |
| TypeBox | 1.x 线（未确认） | 直接写 JSON Schema 对象 | 低（$ref/$defs 全语义） | ✗（open issue） | 中 | 与 ajv 编译配置耦合 |

（ArkType 的"运行时 TS 等价"路线值得一提：其目标恰是"类型与校验器同源"，与 Atelier 契约同源目标一致，但它仍需私有 DSL 字符串/构造器承载，Atelier 用"普通 TS 值 + 编译器"达到同目标而少一层 DSL。）

---

## 3. 数据层

### 3.1 Drizzle ORM（0.45.2 stable / 1.0.0-rc.4）

**① 现状与时间线**：stable 线仍是 **0.45.2**；**1.0 仍是 RC**——GitHub 最新 release v1.0.0-rc.4（2026-06-27），官方有 v0→v1 迁移指南，1.0 重做了内部实现（关系查询等）。注意信息噪声：pkgpulse（2026-03）宣称"1.0 已 stable"，与 GitHub release 事实矛盾，**以 GitHub 为准：未 stable**。**团队已加入 PlanetScale**（makerkit.dev 2026-01 报道，PlanetScale 官方文档有 Drizzle 集成页），PlanetScale（MySQL/Postgres）成为一等支持目标。来源：https://github.com/drizzle-team/drizzle-orm/releases 、https://orm.drizzle.team 、https://www.makerkit.dev

**② 架构**：贴 SQL 的类型化查询构造器——schema 是普通 TS 对象（`pgTable`/`sqliteTable`），查询是链式构造器直接产出 SQL，**无查询引擎、无中间 DSL、无 generate 步骤**；drizzle-kit 负责 migration 与 introspect。类型机制：`sqliteTable("users", { id: integer().primaryKey(), name: text() })` 返回的表对象同时是值（供构造器引用列）与类型源（`InferSelectModel<typeof users>` 从表对象推导行类型），列方法链（`text({ enum: [...] })`）把约束编进类型——**schema 即普通 TS 值**这一点与 Atelier 扁平 schema 哲学同向，是所有主流 ORM 里最接近 Atelier 形态的。1.0 的内部重写方向未完全公开（release note 只见 View 类型/自定义类型 JSON 字段修复，未确认重写范围）。

**③④⑤**：AI 友好度高——"TS 对象进、SQL 字符串出"单文件可完整理解，无隐藏步骤；幻觉高发面：drizzle-kit 命令面与 config 格式在 0.x 期间多次变动、`db.query` 关系 API 与 join 写法混用。对 Atelier：**vendor 候选第一名，但有两个新保留意见**——(a) 1.0 未 stable，现在 vendor 会锚定在 0.45 或吃 RC 漂移；(b) 团队归属 PlanetScale 后，SQLite 是否仍是一等目标存在路线疑问（D1/Turso/libSQL 仍支持，但投入重心未确认）。Atelier 的"生成式类型数据层"若自研，Drizzle 的价值恰在于被对照：它证明"TS 对象→SQL"可以零引擎直出，Atelier 可把同思想收缩到 SQLite 单方言 + 编译期生成，面积小一个量级。

### 3.2 Prisma 7（rust-free 已落地）

**① 现状与时间线**：**Prisma 7 于 2025-11-19 发布**：客户端运行时**完全 TypeScript 化（Rust 引擎退场）**，宣称 bundle 小 90%、查询快 3×；7.3–7.8 在 2026-01 至 2026-04 间高频迭代；社区文章提到 Prisma 8 RC（makerkit 2026-01，未确认）。来源：https://www.prisma.io/blog（Prisma 7 Release，2025-11-19）、https://www.infoq.com（2026-01-20）

**② 架构**：schema.prisma DSL + `prisma generate` 产出类型化客户端；rust-free 化把查询编译从 Rust 引擎换到 TS 侧（queryCompiler），生成产物路径与支持平台在 7 有迁移破坏。多步流程（写 DSL → generate → migrate）仍是核心心智。

**③④⑤**：AI 友好度中——DSL 语料巨大，但 **"改了 schema 忘了 generate"仍是最高频 AI 失败面**（rust-free 不改变流程多步性）；另外 DSL 与 TS 是双源，AI 常在"哪里是真相"上出错。对 Atelier：Prisma 7 证明"运行时 TS 化 + 去原生引擎"是行业正确方向（与 Atelier 零依赖纯 TS 一致），但**其流程复杂度反向证明 Atelier "生成式类型 + 无 generate 步骤"路线的价值**：契约/数据层一切产物应是编译器一次性可重算的，不是需要开发者记住执行的命令。

### 3.3 Kysely / Effect / sqlc 思想

- **Kysely 0.29.5**：纯类型 SQL 构造器（Knex 思想 + 完整类型推导），周下载约 900 万（Snyk 口径，未独立复核）；**2026-03 披露 CVE-2026-33442：≤0.28.12 存在 SQL 注入**，需升级。kysely-ctl 0.21.0。来源：https://github.com/kysely-org/kysely 。对 Atelier：若走 vendor，Kysely 是"贴 SQL"路线的成熟选项；CVE 提醒：任何"类型化查询构造器"的安全面都在 SQL 拼接层，自研薄层必须把参数化作为唯一路径（无字符串拼接逃生门）。
- **Effect（@effect/sql 0.52.1，2026-07）**：Effect Schema 有 Standard Schema 支持；@effect/sql 提供连接池/查询构造/迁移抽象。对 Atelier：Effect 的 Generator/Effect 类型系统范式与"AI 首遍正确率"目标冲突（错误类型嵌套深、范式学习成本高），不 vendor。
- **sqlc 思想**：SQL 即类型源、编译期生成类型化查询函数。Go 生态已成熟；**TS 侧官方插件 sqlc-gen-typescript 仍是 preview**（2023-12 宣布至今）。来源：https://github.com/sqlc-dev/sqlc-gen-typescript 。**这是数据层决策的关键空位证据：TS 生态至今没有成熟"SQL→TS 类型函数"的 AOT 生成器**——Atelier 自研薄生成层（SQLite 方言 + 扁平 schema → 类型化查询模块）恰好落在这个空位上，与 Atelier 已有的 dump.mjs/codegen.mjs 编译管线同构。

### 3.4 SQLite 生态

- **Turso/libSQL**：2025-01 Turso 宣布 "We will rewrite SQLite"，全面转向 Rust 重写（turso 仓库定位 "an in-process SQL database written in Rust"）；**libSQL/sqld 进入维护态**；embedded replicas 仍是 Turso Cloud 特性但绑定其生态。来源：https://turso.tech/blog/we-will-rewrite-sqlite-and-we-are-going-all-in 、https://github.com/tursodatabase/turso 。**对 Atelier：应避免引入 libSQL 依赖**（维护态 + 供方转向）；本地读副本思想在单机桌面场景无需求。
- **Litestream / LiteFS**：Litestream 于 2025-05-20 重构（**VFS 架构**：复制下沉到 VFS 层）；两者均未停更，但 2026-02 有 Fly.io 侧 issue 讨论用 Litestream VFS 取代 LiteFS（指向 Tigris 桶）——LiteFS 实际上正被 Litestream VFS 路线取代。来源：https://fly.io/blog（"Litestream: Revamped"，2025-05-20）。对 Atelier：若未来需要"桌面 exe 数据容灾/多机"，Litestream VFS 是正确参照层（应用无需改查询代码）。
- **bun:sqlite**：仍是 Bun 内建 SQLite 直绑（支持 serialize/deserialize 到内存）；`node:sqlite` 在 Bun 中**尚未实现**（issue #27092，2026-05），官方建议用 `bun:sqlite` 或 Bun.SQL。来源：https://bun.com/docs 、https://github.com/oven-sh/bun/issues/27092 。**Atelier 数据层基座首选 bun:sqlite**；Node 兜底路径可用 `node:sqlite`（Node ≥22.5 内建）做薄适配——两个宿主都有零依赖内建 SQLite，"数据层零运行时依赖"成立。适配注意：两套内建模块 API 形状并不相同（bun:sqlite 的 Statement/prepare 语义与 node:sqlite 的 StatementSync 有差异，参数绑定风格与返回结构均有出入，未逐项核对），薄适配层应定义在 Atelier 自己的最小 SQL 执行接口后面（prepare/run/all/get 四原语量级），把宿主差异锁死在一个文件内——这与 Atelier dev 面对多运行时的既有 vendor 策略一致。
- **Bun.SQL**（1.3）：SQLite/Postgres/MySQL/MariaDB 统一 API。对 Atelier：**不建议依赖**——统一多方言是"贴抽象"路线，与"SQLite 单方言贴 SQL"纪律冲突；但作为"若未来支持 PG 后端"的观察位。
- **浏览器端**：官方 `@sqlite.org/sqlite-wasm`（OPFS VFS，SQLite 团队维护）vs wa-sqlite（可插拔 JS VFS，IDBBatchAtomicVFS 写入快 2–3×）；PowerSync 2026-05 有现状综述。来源：https://sqlite.org/wasm 、https://github.com/rhashimoto/wa-sqlite 、https://powersync.com/blog/sqlite-persistence-on-the-web 。对 Atelier："同一 SQLite 方言贯通服务端与浏览器端"技术上成立——生成式类型数据层可以同构编译到 wa-sqlite/OPFS 后端，为离线桌面/本地优先形态留门。
- **ORM 对 AI 生成友好度的实证对比**：2026 年的对比文章（Encore 2026-03、vibecoder 2026-04、makerkit 2026-01）共识方向：**Drizzle 因贴 SQL/少步骤/少魔法更适合 AI 工作流；Prisma 在 DX/工具成熟度/类型检查速度上反超**（Prisma 官方 2025-09-09 发布"为什么我们的类型检查比 Drizzle 快 72%"基准，vendor benchmark 口径）。**注意：没有发现严格控制的"LLM 首遍正确率 × ORM"学术实证**——现有均为 vendor/媒体基准，旧报告"Drizzle 更受 AI 工作流青睐"的判断维持为**方向性成立但无严格实证**。来源：https://www.prisma.io/blog（2025-09-09）、https://wasp.sh 等对比文。

---

## 4. 鉴权与会话

### 4.1 Better Auth（事实标准接近成立）

**① 现状**：1.4（2025-11-21）；**1.5（2026-02-28）**：600+ commits、70 新特性、200 修复、7 个新包；后续 1.6/1.7 线持续（SSO/OIDC 强化、稳定数据库 join、MCP 拆为独立包——releasebot 口径，未逐条核实）。来源：https://better-auth.com/blog

**② 架构**：框架无关（Next/Hono/Express/SvelteKit…）、数据库无关（含 bun:sqlite 适配，但截至 2025-11 尚无 Bun.SQL PG/MySQL 集成）；核心是 plugin 树（each plugin = 路由 + 表 + 客户端方法三件套）；**官方 MCP 插件**（`better-auth/mcp`）把应用变成 **OAuth 2.1 授权服务器 + 受保护资源**，供 MCP 客户端接入——这是"auth 基础设施为 agent 时代重构"的第一个大规模落地样本。来源：https://better-auth.com/docs/plugins/mcp

**③④⑤**：AI 友好度中高——API 显式、文档全；但插件生态膨胀快，AI 在"该用哪个插件/插件配置项"上幻觉多发（社区 issue 常见，未统计）。升级节奏快（2025-11→2026-02 两个大 minor）意味着语料版本错位风险在积累——Better Auth 正在重演"快速增长期框架"的语料分裂窗口。对 Atelier：**不建议整体 vendor**（运行时重、数据库 schema 由它定义、与 Atelier 契约注册表无整合）；**建议吸收两点**：(a) 其 plugin 三件套"路由+表+客户端方法同源"与 Atelier 契约五用同构；(b) MCP 授权插件证明 atelier-server 未来需要"作为 OAuth 资源服务器暴露给 agent"的能力，契约层设计时应预留。

### 4.2 OpenAuth / Lucia / Auth.js

- **OpenAuth**（SST 团队，openauth.js.org）：自托管 OAuth 2.1 server，beta 自 2024-12；2026-03 GitHub issue #326 反映维护波动（团队转投 OpenCode 后恢复，细节未确认）。**不建议依赖**。
- **Lucia**：维护者 2024-10 宣布停更（"Lucia, in the current state, is not working"），v3 维护 6 个月后于 **2025-03 前后转为"学习资源"**（lucia-auth.com 变成"从零实现会话式 auth"的教程库）。来源：https://github.com/lucia-auth/lucia/discussions/1707 。旧报告未提，本轮补上；其"库退场、文档留场"对框架文档策略有参照意义。
- **Auth.js**：社区对比文称其进入维护模式（未确认，官方未声明）。
- **格局结论**：TS 生态鉴权已收敛为 **Better Auth 一家事实标准 + 框架内建生成器两条路线并存**。

### 4.3 框架内建生成器路线（对照）

- **Rails 8 `bin/rails generate authentication`**：生成 session 式 auth（含密码重置），**产物是明文可读可改的普通 Ruby 文件**，且跟踪全部会话历史（vs Devise 只记最近会话）；官方至今没有完整 auth 指南——因为生成器产物本身就是文档。来源：https://blog.appsignal.com（Rails 8 Guide）、https://avohq.io
- **Phoenix 1.8 `mix phx.gen.auth`**：1.8（2025-08-05 发布 1.8.0，当前 1.8.13）起**默认 magic link** 登录/注册（密码式仍可选），生成器产物随框架最佳实践演进。来源：https://www.phoenixframework.org/blog/phoenix-1-8-released 、https://hexdocs.pm/phoenix/mix_phx_gen_auth.html
- **对 Atelier 的建议**：auth 走**生成器路线而非运行时库路线**——`atelier init` / `atelier auth` 产出基于契约注册表的会话管理明文 TS 模块（落在应用 specs 可审计范围内），升级走 regen+diff 而非依赖升级。这同时避免 Better Auth 类库"表结构由库定义"与 Atelier 契约单源的冲突。

---

## 5. 后台任务/队列（轻量嵌入式盘点）

| 选项 | 底座 | 版本 | 关键事实 | 对 Atelier（SQLite 单文件形态）适配度 |
|---|---|---|---|---|
| BullMQ | Redis | 12.x+（持续） | Node 队料事实标准：flows/父子任务/限流/Bull Board；需独立 Redis 运维 | ✗ 引入第二基础设施 |
| pg-boss | Postgres | 12.33.2 | JS 中心 API；事务一致性 | ✗ 需 PG |
| Graphile Worker | Postgres | 0.14+ | PG 中心 API；0.14 起基准 18 万 trivial jobs/s | ✗ 需 PG |
| River | Postgres（Go 首发） | 多 major | 结构健壮（brandur 设计文）；提供跨语言 insert-only 客户端 | ✗ 但**设计文档是"如何把队列做对"最佳教材** |

来源：https://www.pkgpulse.com（2026-03-09 对比文）、https://brandur.org/river 、https://github.com/riverqueue/river

**趋势（2026 实证）**：多篇 2026 文章记录团队**删 Redis 换 PG 内置队列**（甚至 60 行自定义队列表扛 10 万 jobs/天），也有从 Graphile Worker 回迁 BullMQ 的反向案例（运维手感问题）。来源：pkgpulse/imqueue 2026 对比文。

**对 Atelier 的结论**：现有四家无一适配"零依赖 + 单文件 SQLite + 桌面 exe"形态——**这是真实空位**。建议自研极薄 SQLite 队列，最小面 sketch（供设计讨论，非结论）：一张 `jobs` 表（id/queue/payload JSON/status/priority/attempts/run_at/locked_by/locked_at）+ 事务内 `UPDATE ... WHERE status='pending' AND run_at<=? LIMIT n RETURNING`（SQLite 3.35+ RETURNING）原子取出 + 指数退避重试列 + 完成即删或归档；不引入 LISTEN/NOTIFY（SQLite 无此机制）而用轮询间隔自适应（忙时短闲时长）。设计参照 River 的健壮性清单（可见性超时/崩溃恢复/严格一次语义的边界诚实化）与 pg-boss 的 API 形态；规模上限定位与 SQLite 本身一致（单机中小流量）。此判断与 Atelier"读写二分 + 事务边界在同一进程内"的架构天然契合：command 事务内投递 job 表即可获得"业务写入与任务投递原子化"——这是 Redis 队列给不了的性质。

---

## 6. 跨语言对照（简节）

### 6.1 Python：Django 6.0 / FastAPI / Litestar 2.x
- **Django 6.0（2025-12-03）**：模板 partials、async 面继续扩张；Python 3.12–3.14。来源：https://docs.djangoproject.com/en/dev/releases/6.0/ 。admin+ORM+迁移一条龙仍是"约定优先"天花板；魔法密度（ORM querySet 惰性求值、信号）在非常见组合上仍伤 AI。
- **FastAPI**：仍 0.x 高频发版；类型注解即 schema + 自动 OpenAPI + 显式 Depends——仍是"显式扁平 + 契约导出"的跨语言参照第一样本。Pydantic 是其契约层，形态为"类定义式 schema"，与 Atelier 扁平对象同向。
- **Litestar 2.x**（changelog 活跃，2025-10-05 一例）：显式 DI、分层引导、DTO 层内建；吞吐约为 FastAPI 2×（Better Stack 2025-08 口径）。语料仍少。旧报告判断复核**成立**。

### 6.2 Go：net/http 1.22+ / sqlc
- 标准库 1.22+ 方法+路径模式路由使"无框架 Go"成为主流；显式零魔法，AI 正确率极高（旧报告判断维持，本轮无反向证据）。
- sqlc 在 Go 生态成熟；TS 侧 sqlc-gen-typescript 仍 preview（§3.3）——**"SQL 即类型源"在 TS 没有成熟对应物**，是 Atelier 自研薄生成层的空位证据。
- 队列侧 River（Go+PG）的设计文档（brandur.org）是自研队列的最佳教材（§5）。

### 6.3 Rust：Axum 0.8 / Loco.rs
- **Axum 0.8.0（2025-01-01）**：路径参数改 `{id}` 语法（与 Hono/Nitro 的 Web 惯例对齐——三大生态路由语法在 2025 集体收敛）；0.8.9（2026-04-14）。extractor 即校验 + 类型安全天花板；编译期错误信息对 LLM 不友好（旧报告判断维持）。来源：https://tokio.rs/blog/announcing-axum-0.8.0
- **Loco.rs 0.16.x**（0.16.4，2025-10-19）："Rust 上的 Rails"，生成器+scaffold+JWT auth+scheduler；生成产物经"生成后零修改可编译"验证（release 流程内建该门禁，值得 Atelier checkpoint 门禁借鉴）。语料极少。来源：https://github.com/loco-rs/loco/releases

---

## 7. "约定+生成器"路线：生成器可读产物形态对 AI 的价值

### 7.1 Rails 8.x（8.0 2024-11-07 / 8.1 迭代）
- **Solid 三件套**（Solid Queue/Cache/Cable）：SQLite 替代 Redis 全家桶，2026 持续深化（8.1 性能与 DX 改进）——"默认单文件数据库承载一切"的路线已在最大 MVC 框架完成主流化，**直接支撑 Atelier "SQLite 默认"决策的行业合法性**。
- **authentication 生成器**：产物为普通代码（非 DSL/非黑盒 gem），AI 可直接读改；无官方 auth 指南恰说明"产物即文档"。
- **Kamal 2**：自托管复兴（详见 §8）。
- 来源：https://blog.appsignal.com 、https://rubyroidlabs.com

### 7.2 Laravel 12（2025 初）
- 官方 starter kits：React/Vue/Livewire 三件（含 auth/注册/设置/最佳实践）；12.2（2025-03）开放社区 starter kits。官网口号 "The clean stack for Artisans and agents"——**把 agent 写进框架口号**，说明"starter kit = AI 友好起点"已被厂商当卖点。魔法密度仍高于 Rails（Facades/宏/服务容器）。来源：https://laravel.com/docs/starter-kits
- 对 Atelier：starter kit 与 Atelier init 的差异在于 Laravel kits 是"clone 产物"而 Atelier init 是"组装产物"（模板+vendor+specs 骨架）——后者可注入项目级规范文件，对 AI 更优（与旧报告三"规范文件是框架产物"结论互证）。

### 7.3 Phoenix 1.8（1.8.0 2025-08-05，当前 1.8.13）
- **生成器产物形态是最重要样本**：`phx.gen.html/live/auth/json` 产出完整 CRUD/auth 切片，代码风格即框架最佳实践展示；1.8 的 phx.gen.auth 默认 magic link 化证明**生成器可以让"最佳实践升级"随框架版本下发到存量应用**（regen 即升级），这是运行时库路线做不到的。
- 来源：https://www.phoenixframework.org/blog/phoenix-1-8-released 、https://hexdocs.pm/phoenix/mix_phx_gen_auth.html

### 7.4 生成器产物形态的分类学（对 AI 价值分级）
把本轮考察到的生成器产物按"AI 可消费度"分四级：
1. **黑盒产物**（编译进运行时、无源码落盘）：无——本轮主流框架已无此形态（历史上有 Ember CLI 的部分 addon 行为），说明行业已淘汰此形态。
2. **DSL 产物**（生成 DSL/中间表示，需框架运行时解释）：Laravel 的部分 migration 魔法、Wasp 的 DSL 单文件——AI 需要额外学会一层 DSL 语义，语料盲区风险高。
3. **可读代码产物但依赖隐式全局约定**（Rails 大多数生成器）：产物是普通代码，但正确运行依赖命名约定/自动加载等框架全局魔法——AI 读单文件可懂、改偏离惯例处易幻觉钩子。
4. **可读代码产物且显式 import 闭合**（Phoenix 生成器整体、Atelier 模板已走形态）：产物文件间依赖全部显式 import，单文件上下文即可静态理解——**AI 价值最高级**。
结论：Atelier 生成器应锚定第 4 级，并把"产物显式 import 闭合"写进生成器测试门禁（Loco 的"生成后零修改可编译"是可抄的验收形态）。

### 7.5 小结：可读产物的三条 AI 价值
1. **产物即上下文**：AI 读生成产物 = 读框架最佳实践的完整展示，不需要读框架源码；
2. **regen 即升级**：最佳实践演进随生成器版本下发，不产生"库 API 漂移"型幻觉；
3. **可审计**：产物落在应用仓库内（Atelier specs/guardrails 可覆盖），AI 违反纪律可被守卫测试捕获——这正是 Atelier 已有 spec 守卫测试路线。

---

## 8. 部署形态

- **Nitro presets**：编译期决定部署 target（§1.5）；Cloudflare Workers 生态因 `nodejs_compat`+unenv 已可跑大多数 Node 中间件。
- **Cloudflare Containers**：2025-06-24 公测——Workers 旁挂可编程 Docker 容器，"边缘平台跑重容器"补上最后一块。来源：https://blog.cloudflare.com
- **Kamal 2 / 自托管复兴**：Kamal 2（随 Rails 8）把"一台 VPS 跑容器+零停机+SSL"做成一条命令；2026 自托管叙事与边缘叙事并行（Northflank/Sliplane 等 2026-02/03 对比文为证）。对 Atelier 桌面 exe 路线：自托管是同一光谱的另一端（"单文件/单容器 + 本地数据库"），Kamal 的"零 PaaS 依赖"哲学与 Atelier"零运行时依赖"同源。
- **单二进制趋势**：Bun compile（1.4.1 编译产物进一步变小）+ **Deno compile self-extracting 二进制（2.7）与按需嵌入 npm 依赖（2.8）**——两大运行时 2026 同时把"TS→单可执行"做成一级能力。**对"桌面 exe 一级分发"的 Atelier：底座已就绪且在快速变好，决策窗口正确。**
- **对 Atelier 的部署矩阵建议**（基于本轮证据，供设计书引用）：(a) 桌面 exe：Bun compile（SQLite 文件随 exe 同目录/用户目录，Litestream 思路可选做容灾）；(b) 自托管单容器：Node/Bun 跑同一 Web 标准 API 产物 + SQLite 卷挂载（Kamal 式一条命令可后续做成 `atelier deploy` 但非本期）；(c) serverless/edge：**降级为编译期 target**（Nitro preset 思想），SQLite 换 Turso/D1 适配——但本期不做，避免数据层双方言过早分裂。三条产线共享"Web 标准 API handler + 扁平契约"内核，差异全部收在编译期——这是 Nitro/H3 v2 用一整个 preset 体系验证过的分层。
- 来源：https://bun.com/blog 、https://deno.com/blog 、https://blog.cloudflare.com

---

## 9. 2025H2–2026 新出现的后端框架/运行时扫描

多轮检索（"new backend framework 2026 typescript"等）结论：**没有出现支配性的新 TS 后端框架**。2026 的实际动态是：
1. **存量框架的功能性合流**：Web 标准 API（Hono/H3 v2/Elysia/Axum `{id}` 语法全部对齐）、Standard Schema 互操作（tRPC/Hono/TanStack/NestJS 12/oRPC 全接入）、部署 target 编译期化（Nitro/Bun compile/Deno compile）——**三个收敛方向全部利好 Atelier 现有架构选型**。
2. **"typed functions as backend"成为 2026 主叙事**（LogRocket 2026 趋势文：后端表达为类型化函数而非长驻服务）——与 Atelier 的 command/query 端点 + 契约五用同向。
3. 值得留意的次新项目：Encore.ts（源码→OpenAPI/类型化客户端，旧报告三已有；2026 仍活跃，云锁定争议未消——其"从源码注解推导整个 API 面"与 Atelier 编译器路线同族，但依赖自有 runtime 而非 Web 标准 API，这是 Atelier 不该跟的差异点）、oRPC（§2.2）、Wasp（DSL 路线，语料盲区问题未解）。**未发现"嵌入式服务层"直接竞品**：TS 生态还没有"框架内嵌 query/command 服务层 + 文件位置式前后端边界"的成熟实现——TanStack Start 的 server functions 最接近，但其 schema 校验依赖外部校验库而非框架内建扁平契约，Atelier 的差异化空间仍然存在。来源：https://blog.logrocket.com/8-trends-web-dev-2026 、https://encore.dev

---

## 10. 对旧报告的修正

| # | 旧报告说法 | 复核结论 | 修正内容 |
|---|---|---|---|
| 1 | "Hono：零依赖小内核 + 中间件生态。坑：生态胶水（认证/ORM/DI）全自组装" | 部分过时 | 补充 2026 关键新事实：官方 `hono/standard-validator` + `hc` RPC 类型贯通已把"校验器碎片化"问题收敛到 Standard Schema 一层；Hono 现在是"内核 + RPC 类型面"而非纯路由器，其 RPC 面可作为 Atelier query/command 端点类型贯通的对照实现 |
| 2 | "Drizzle：AI 友好度高（2026 Q1 周下载约 500 万级，未核实）" | 未证实且漏关键变量 | 下载量仍未核实；**1.0 至今仍是 RC（rc.4，2026-06-27）**，stable 为 0.45.2——任何"1.0 已 stable"的第三方文章（pkgpulse 2026-03）与 GitHub release 事实矛盾；**团队已加入 PlanetScale**，SQLite 优先级存在路线疑问，vendor 决策需加此风险项 |
| 3 | "Prisma：工程成熟但多步 generate 流程是 AI 出错点" | 方向对但事实需更新 | Prisma 7（2025-11-19）已 rust-free（客户端纯 TS、bundle 小 90%）；generate 多步流程仍在、AI 出错点判断维持成立；另有 Prisma 8 RC 传言（未确认） |
| 4 | "Rails 8：内置 authentication 生成器……phx.gen.auth（magic link + sudo mode）" | 成立并加强 | phx.gen.auth 1.8 起 **magic link 为默认**（密码式可选）；Rails 8.1 持续深化 Solid；两条生成器路线 2026 无回摆，"生成器可读产物"结论加强 |
| 5 | "oRPC：较新，语料少" | 需更新 | oRPC 1.0 已发布（2025-04 宣布，InfoQ 2025-12 报道），原生 OpenAPI + Standard Schema JSON 回退桥；语料仍少但成熟度上台阶，已可作为双面导出（RPC+OpenAPI）的可行性对照物 |
| — | **旧报告完全缺失的关键事实** | — | (a) **Standard Schema 规范及其采纳面**（本轮关键问题）；(b) **Anthropic 收购 Bun（2025-12-02）与 Bun 1.4 Rust 重写（2026-08）**；(c) Turso 弃 libSQL 转向 Rust 重写（2025-01）与 Litestream VFS 重构（2025-05）；(d) Better Auth 官方 MCP 插件（OAuth 2.1 server for MCP）；(e) NestJS 12 一等 Standard Schema 支持 |

---

## 11. 横向综合

### 11.1 "显式扁平内核 + 生成器约定"是否仍成立？——成立，且证据加强

1. **Web 标准 API 已是 TS 服务层共识底座**（Hono/H3 v2 重写/Elysia/Axum 语法收敛四证）——Atelier "Web 标准 API 优先"从选型偏好变成行业收敛点，追认正确。
2. **契约单源多处编译消费被三家独立证明**：Fastify（schema→校验+序列化+文档）、Elysia（schema→校验+类型+OpenAPI+客户端）、tRPC/Hono（schema→校验+类型贯通）——Atelier 契约五用是这条曲线的自然延伸（多出 MCP 工具定义与注册表两个消费面，恰好是 Atelier 已有 MCP 资产）。值得注意的行业细节：三家实现"多消费"的技术路线完全不同（Fastify 走 JSON Schema 编译、Elysia 走私有 DSL 泛型、tRPC 走 procedure 类型对象），但都收敛到"**一份定义、编译派生**"的结构——范式胜出与技术路线无关，这减弱了 Atelier 选自有扁平 schema（第四条路线）的范式风险。
3. **生成器路线在 2026 持续强化**：Rails/Phoenix 生成器产物随版本携带最佳实践升级（regen 即升级）、Laravel 把 agent 写进 starter kit 卖点、Loco 生成后零修改可编译的门禁——"生成器 + 可读产物"对 AI 的价值从假说变成多生态实证。Atelier init 的"模板+vendor+specs 骨架"组装形态与 Laravel kit 的 clone 形态相比，多出的规范文件注入恰是 AI 需要的。
4. **数据层"少步骤、贴 SQL、显式"共识未变**：Prisma rust-free 化（承认运行时复杂度负债）、Drizzle 贴 SQL 路线的持续强势、sqlc 思想跨语言扩散、2026 "删 Redis 删 PaaS"运维趋势——全部指向显式派。Atelier 自研薄生成层的空位证据：**TS 生态没有成熟的"SQL→TS 类型函数"AOT 生成器（sqlc-gen-typescript 仍 preview）**。
5. **唯一需要更新谨慎度的判断**：Bun 归属 Anthropic（§1.7）。"运行时倾向 Bun"仍正确（内建 SQLite/compile/HTTP2 恰好覆盖需求），但决策文档应写明：Bun 是优化态而非绑定态，Web 标准 API 优先是机动性保险。

### 11.2 Standard Schema 独立结论（关键问题）

**问题**：Atelier 契约层是否需要兼容 Standard Schema 规范？它是否推翻决策 6（否决 zod/TypeBox/valibot 作为契约源）？

**结论**：
1. **需要兼容，且兼容成本近零**：Standard Schema V1 是约 60 行的纯 TS 接口（`~standard` 属性 + validate + 可选 jsonSchema 生成器），官方明示可 copy-paste 实现，无运行时依赖——与 Atelier 零依赖原则无冲突。Atelier `contract.ts` 的校验器包装出 `~standard.validate` 是纯适配工作。
2. **它不推翻决策 6，反而加固决策 6**：否决理由（双源/不扁平/API 变动快）2026 全部仍成立；但否决的隐含代价（失去生态互操作）已被 Standard Schema 消除。**"自有扁平 schema + 实现 Standard Schema 接口"是两全解**：契约源仍是 Atelier 扁平 TS schema（单源），互操作面（tRPC/Hono/TanStack/Form 消费）由 `~standard` 适配层提供。
3. **落点建议**：(a) runtime：`~standard.validate` 适配（types-only 接口定义 vendored/内联）；(b) compiler：扁平 schema→JSON Schema（draft-2020-12 / openapi-3.0 target）的**编译期生成器**——Standard Schema JSON Schema V1 的 openapi-3.0 target 意味着契约五用中的 OpenAPI 导出可以直接挂在这个接口上，MCP 工具定义与 OpenAPI 导出共用同一生成管线；(c) 保持禁 $ref/oneOf 纪律：Atelier 生成的 JSON Schema 是"扁平投影"（只输出 object/array/string 等基本关键字），不承诺 JSON Schema 全语义。
4. **风险标注**：Standard Schema 无正式治理委员会（官网未描述治理流程，三位作者个人背书）；JSON Schema V1 接口相对新（未确认各实现库的覆盖完成度）；若未来 spec v2 变动，适配层需跟着动——但接口面积小，风险可控。

**决策 6 复核表**（本轮证据 → 决策影响）：

| 决策 6 的否决理由 | 2026-09 证据复核 | 是否仍成立 |
|---|---|---|
| 双源（schema DSL ≠ TS 类型） | Zod 4/ArkType 2 仍在为"类型与校验同源"补课（ArkType 的整个卖点就是补这个），证明该问题在引入 schema 库时无法根除 | ✓ 成立 |
| 不扁平（$ref/oneOf 能力诱惑） | TypeBox 直接暴露 JSON Schema 全语义（Standard Schema 未支持恰因其扁平性难保证）；Fastify 三用依赖 $defs | ✓ 成立 |
| API 变动快 | Zod 3→4 迁移刚发生、4.5 又在加 API（z.compile）；Valibot v0.31→v1 变动 | ✓ 成立 |
| （旧隐含代价）失去生态互操作 | **被 Standard Schema 消除**——自有 schema 实现 `~standard` 即可被 tRPC/Hono/TanStack/Form/NestJS 12 消费 | ✗ 不再成立 |
| （新增）互操作收益 | Standard Schema JSON Schema V1 的 openapi-3.0 target 直接可挂 Atelier 契约五用中的 OpenAPI 导出 | 新增收益 |

### 11.3 数据层：自研薄生成层 vs vendor 现成库——证据汇总

| 维度 | vendor（Drizzle/Kysely） | 自研薄生成层 |
|---|---|---|
| 零运行时依赖 | Drizzle/Kysely 本体零依赖，但 drizzle-kit 依赖重 | 完全可控 |
| AI 首遍正确率 | 语料多（Drizzle）；但 1.0 RC/0.x 双形态是漂移源 | 产物为生成 TS 模块，可读可审计；语料为零但生成器产物 = 项目内自洽规范 |
| SQLite 深度 | Drizzle 支持但非重心（PlanetScale 归属疑问） | 单方言贴死 bun:sqlite/node:sqlite，参数化唯一路径 |
| 契约整合 | 表结构与 Atelier 契约注册表双源 | 与契约五用共享同一扁平 schema 单源（生成式类型） |
| 迁移 | drizzle-kit/prisma migrate 成熟 | 需自研最小迁移（SQL 文件序 + checksum，可参照 Loco/Rails 产物形态） |
| 风险 | 上游路线变动（1.0 重写/CVE 教训 Kysely 2026-03） | 自研面扩大；SQLite 方言边界要守住 |

**倾向**：**混合**——数据层基座 vendor 底座 API（bun:sqlite，零选择成本）+ 查询/类型走自研编译期生成层（落 sqlc 空位）；Drizzle 保持为 fallback 选项（若 1.0 stable 后 SQLite 支持不变，vendor 成本评估重开）。这与旧报告"数据层 SQL 显式派"结论一致，但从"选哪个 ORM"细化为"生成器路线优先、ORM 为 fallback"。

---

## 12. 不确定项清单

1. **Drizzle 1.0 stable 日期**与 1.0 重写的完整范围（release note 只见局部修复）。
2. **Prisma 8 RC** 是否属实（仅 makerkit 一处提及，官方未确认）。
3. **Bun 1.4 Rust 重写的完成度**：1.4.x 是否全部模块完成 Zig→Rust 切换，官方专文未逐模块披露（未确认）。
4. **Elysia 2 "TypeScript to OpenAPI" 的实现机制与限制**（从 TS 类型生成 OpenAPI 是否依赖 emitDecoratorMetadata 等编译开关，vendor 宣传口径，未深核）；Elysia 2 stable 日期。
5. **Better Auth 1.7 的具体内容**（SSO/OIDC 强化、数据库 join 稳定、MCP 拆包——来自 releasebot 二手口径）。
6. **OpenAuth 维护状态**（2026-03 issue 后的恢复程度未确认）。
7. **Auth.js 维护模式**（社区口径，官方未声明）。
8. **Kysely 周下载 ~900 万**与 **Drizzle 周下载 ~500 万级**均为第三方统计口径，未独立复核。
9. **Standard Schema 无正式治理结构**；JSON Schema V1 接口在各实现库的覆盖完成度未逐一验证。
10. **ORM × LLM 首遍正确率的严格实证**：未发现学术级对照实验，现有均为 vendor/媒体基准——"Drizzle 对 AI 更友好"应表述为方向性共识而非实证结论。
11. NestJS 12 发布的确切日期与 Standard Schema 支持的具体形态（docs migration guide 存在，细节未逐条核实）。
12. Hono 4.13.7 的发布日（npm 口径约 2026-09-04）与 4.12.2 安全修复的 CVE 编号（未查到编号）。

---

*检索口径备注：本报告所有版本号与日期以 2026-09-19 检索时的官方 GitHub releases/npm/官方 blog 为准；第三方汇总站（pkgpulse/makerkit/releasebot/tech-insider 等）仅作交叉参考，凡与其矛盾处以官方源为准并已在正文标注。*
