# 前端框架深度调研报告（2025H2–2026）

> 报告一（前端部分）· 深度版。检索日期：2026-09-19（所有"检索 npm registry"字样均指当日经 npm CLI 查询 registry.npmjs.org 得到的版本与发布时间戳；Web 检索交叉验证）。
> 委托方：Atelier——AI 代理优先的前端框架，正立项全栈化。北极星指标：AI agent 基准任务首遍正确率。评估每个框架时均对照：零依赖内核、显式优于隐式、契约单源、dev 面 MCP、Tauri 类桌面分发、Bun/Web 标准 API 倾向。
> 基线：`atelier/docs/research/2026-fullstack-survey.md` 报告一（简版）。本报告逐项复核其事实，修正见 §十三；不确定项清单见 §十四，未确认说法一律显式标注"（未确认）"。

---

## 0. 结论速览

| 框架 | 最新版本（检索 2026-09-19） | 架构范式 | AI 友好度 | 可取 / 应避一句话 |
|---|---|---|---|---|
| React 19.3.0 | 19.3.0（2026-09-09） | VDOM + 编译器自动 memo + RSC/Flight | ★★★★★（语料之王，RSC/Flight 边界是幻觉与攻击双雷区） | 可取：编译器纪律、codemod 文化；应避：内联魔法指令（"use client"/"use cache"）与隐式序列化边界 |
| Next.js 16.3.5 | 16.3.5（2026-09-11） | 元框架：Turbopack + Cache Components + agent 基建 | ★★★★☆（16.3 后 agent 基建业界最强） | 可取：AGENTS.md 随包、first-party skills、Agent Browser；应避：缓存语义仍在一轮轮翻转 |
| React Router 8.4.0 | 8.4.0（2026-09-15） | 类型安全路由 + loader/action + RSC 预览 | ★★★★☆ | 可取：yearly cadence 的"boring"纪律；应避：RSC 仍是 early preview |
| Remix v3 RC | RC（2026-08-31） | 抛弃 React，Preact fork，零依赖单包，model-first for LLM | ★★☆☆☆（语料几乎为零） | 可取："模型优先"设计原则清单本身就是蓝图；应避：与 RR8 双线并行撕裂语料 |
| Vue 3.5.43 / 3.6.0-rc.9 | 3.6 仍 RC（rc.9，2026-09-18） | 细粒度响应式（alien-signals 重写）+ 可选 Vapor 无 VDOM 编译 | ★★★★☆ | 可取：同语义双产物渐进迁移；应避：opt-in 双轨拖一年以上，文档分裂 |
| Nuxt 4.5.2 | 4.5.2（2026-08-05） | Vue 元框架，Nitro/h3 服务端 | ★★★★☆ | 可取：shared/ 类型安全数据层；应避：自动导入掩盖符号来源 |
| Svelte 5.57.1 | 5.57.1（2026-09-18） | runes 编译期响应式（信号编译走） | ★★★☆☆（S4/S5 双峰语料尚未愈合） | 可取：remote functions 显式 RPC 原语；应避：破坏性重写语料的代价已被实证 |
| SvelteKit 2.70.3 / 3.0 RC | 3 RC（2026-08-13） | 文件路由 + form actions + remote functions | ★★★☆☆ | 可取：`.remote.ts` 单文件即契约；应避：实验期 API 漂移 |
| Solid 2.0.0-rc.9 | RC（2026-09-18） | 最纯细粒度信号 + async 一等公民 + Oxc 编译器 | ★★☆☆☆ | 可取：async 进响应式图、split effects 提升可静态分析性；应避：连续大版本重写 API 面 |
| Angular 22.1.7 | 22.1.7（2026-09-16） | 信号 + zoneless 默认 + DI + 内置 MCP | ★★★★☆（规则最明确，token 成本高） | 可取：CLI 内置 MCP（devserver.start/stop）+ 迁移 SOP 工具化；应避：多层样板 |
| Qwik 1.20.0 / 2.0-beta.43 | 2 仍 beta（2026-09-01） | resumability（序列化恢复而非 hydration） | ★★☆☆☆ | 可取：resumability 是"agent 接管会话"的最佳隐喻；应避：$ 闭包约束难内化 |
| Astro 7.3.3 | 7.3.3（2026-09-16） | 岛屿 + Server Islands + Rust 编译器 | ★★★★☆ | 可取：默认零 JS、"静/动隔离"心智、7.0 显式拒绝静默修 HTML；应避：内容站之外的全栈表达力有限 |
| TanStack Start（1.168.56，文档仍标 RC） | RC 满一年 | 纯 TS 端到端类型，无自研渲染模型 | ★★★★☆ | 可取：全链路类型即 AI 验收 harness；应避：RC 长跑的 API 漂移风险 |
| TanStack DB 0.4.1 | beta（2025-08 起） | 客户端响应式集合库 + 差分数据流 | ★★★☆☆ | 可取：live query + 事务式乐观 mutator；应避：未 GA 前别锁进内核 |
| Preact 10.29.8 / 11-rc | 11.0.0-rc.2（2026-09-08） | 3KB VDOM + signals | ★★★★☆ | 可取：被 Remix 3 选作底座说明其成熟度；应避：— |
| Lit 3.3.3 | 3.3.3（2026-05） | Web Components | ★★★☆☆ | 可取：桌面端（Tauri 内嵌）标准件路线；应避：模板字符串类型反馈弱 |
| Alpine 3.17.3 | 3.17.3（2026-09-14） | HTML 内指令 | ★★★★☆ | 可取：HTML 即真相源；应避：复杂状态逻辑失控 |
| htmx 2.0.10 / 4.0.0 | 4.0.0（2026-08-28，npm next tag） | 超媒体：HTML 片段交换 | ★★★★★ | 可取：4.0 显式化属性继承（opt-in）是对 AI 友好的正确修正；应避：表达力天花板 |
| Datastar 1.0 | 1.0（约 2026 Q1，未确认精确日） | SSE 驱动超媒体 + 细粒度信号 | ★★★☆☆ | 可取：SSE 下行 + 服务端状态收敛与 Atelier 桥接器同构；应避：语料少 |
| Nue 2.0 | 2.0（2025-10-14） | 无构建、标准 Web 原语 | ★★☆☆☆ | 可取：零构建哲学与"标准件优先"；应避：1→2 不兼容的重写 |

AI 友好度评级口径（本报告自定义）：训练语料量级 + 幻觉高发面大小 + 类型反馈质量 + 官方 agent 基建四项加权，五档。评级是调研员判断，非测量结果。

---

## 1. React 19.x 全系（含 Compiler、Actions、RSC/Flight 与 React2Shell）

### 1.1 现状与版本时间线

| 版本 | 日期（npm registry，2026-09-19 检索） | 要点 |
|---|---|---|
| 19.0.0 | 2024-12-05 | RSC/Actions/`use`/ref as prop 正式 |
| 19.1.0 | 2025-03-28 | Owner Stack 等诊断增强 |
| 19.2.0 | 2025-10-01 | `<Activity>`、`useEffectEvent`、Performance Tracks、compiler 驱动的 ESLint 规则（[react.dev/blog](https://react.dev/blog)） |
| 19.2.1 | 2025-12-03 | **React2Shell 安全修复日**（同日披露） |
| 19.2.3 | 2025-12-11 | 后续跟进修复 |
| 19.3.0 | 2026-09-09 | `<ViewTransition>` 转正（基于浏览器 View Transition API 的进出场/位移/共享元素动画）（[react.dev](https://react.dev)） |

- 截至 2026-09-19 **没有 React 20**：npm `latest` = 19.3.0。网上流传的"React 20"说法均未获官方渠道证实（未确认）。
- React Compiler：**v1.0 stable 于 2025-10-07**（[React Blog](https://react.dev)）。2026 年生态落点：lint 规则并入 `eslint-plugin-react-hooks` v6；Oxlint 宣布实现 22 条 React Compiler 规则（[oxc.rs](https://oxc.rs)，2026-08-17）；`@vitejs/plugin-react` 6.1.0 集成（同源，单一来源未二次复核）。Compiler 只处理函数组件与 hooks 规则内的自动 memo 化，不改变 VDOM/协调器本身。
- Actions 与 `useActionState`：语料已充分成熟，表单渐进增强是 19 系最稳定的"新范式"，AI 生成正确率高。

### 1.2 内部架构与技术实现

- **渲染模型仍是 VDOM**：组件函数重跑 → 新树 diff → 最小 DOM 变更。React Compiler 的角色是把"开发者手写 memo 契约"变成"编译器证明等价性后自动插入缓存"，本质是把响应性责任从运行时挪到编译期，但**没有**消除 diff（与 Vue Vapor / Solid / Svelte 5 的"跳过 diff"路线有本质区别）。
- **RSC/Flight**：Server Component 在服务端渲染成 Flight 流（一种可恢复的序列化格式，含组件引用、props、Suspense 边界），客户端重建树并按 `"use client"` 边界拼接。关键点：**Flight 是协议层而非 HTML**，客户端需要 React 运行时解释 payload——这正是 2025-12 漏洞的根：**协议解码器在攻击面内**。
- **调度**：Lane 优先级 + Scheduler（MessageChannel 时间片）+ 可中断并发渲染。19 系的 `useEffectEvent` 解决 effect 内"读最新值但不触发订阅"的长期痛点；`<Activity>` 提供状态保全的显示/隐藏原语（display:none 级卸载语义）；19.3 的 `<ViewTransition>` 把动画塞进并发协调流程（transition 触发点挂在 commit 阶段）。

### 1.3 React2Shell 事件与修复态势（2025-12 至今）

- 2025-12-03 披露 **CVE-2025-55182**（别名 React2Shell）：React Server Components 的 Flight 协议在解码未受信 payload 时未充分校验，导致**无需认证的 RCE**，CVSS 10.0（[NVD](https://nvd.nist.gov)；[react.dev 公告](https://react.dev)）。
- 受影响：19.0.0 / 19.1.0 / 19.1.1 及 19.2.0-19.2.2（各源表述略有差异）；修复版 **19.0.1 / 19.1.2 / 19.2.1**（19.2.3 为后续跟进）。RSC 是 Next.js 等元框架的地基，故波及面远超 React 用户（[Microsoft 应急响应](https://www.microsoft.com)、[Google Cloud](https://cloud.google.com/blog/products/identity-security/responding-to-cve-2025-55182)）。
- 利用态势：Qualys、Unit42 在披露后两周内记录到在野利用与蜜罐捕获（[Unit42 分析](https://unit42.paloaltonetworks.com)，2025-12-12）。具体威胁行为者归因未有权威结论（未确认）。
- 修复态势（截至 2026-09）：主分支已修复并加硬 payload 校验；各大托管平台完成强制升级；**没有**出现"Flight 协议格式重构"级别的跟进——即攻击面模型（可恢复序列化协议暴露在公网）未变，只是校验收紧。

### 1.4 优缺点

- 技术：并发原语完备、Compiler 消除手写 memo；但运行时 VDOM 的固有成本仍在，RSC 把"服务端组件树"变成分布式对象图，调试与安全审计面扩大。
- 工程：codemod 化升级、语义化警告、DevTools Performance Tracks——工程化纪律业界最佳；但缓存/边界心智（client/server/cache 三重边界）认知负担为全生态最高。
- 生态：无可撼动的第一；RSC 相关库（标记边界、序列化适配）生态仍在沉淀中。

### 1.5 AI 生成友好度

- 语料：全生态最大（含 19 系新 API 的训练语料在 2026 年模型中已较充分）。
- 幻觉高发面：`"use client"` 边界摆放、"use cache" 语义、Server/Client 组件 props 序列化限制（函数不可传）、Flight 内联指令混用。React2Shell 后新增一类风险：**agent 会照抄旧教程里未校验 Flight 反序列化的模式**（低概率，主要影响自建 Flight 端点的场景）。
- 类型反馈质量：好；TS 类型 + ESLint（含 compiler 规则）构成可执行的反馈回路。
- agent 基建：React 本体无；见 Next.js 一节。

### 1.6 对 Atelier 的可取 / 应避

- 可取：①Compiler 证明"同语义、编译器兜底"可以产品化——印证 Atelier codegen（AST → effect 图）路线；②19.2/19.3 显示"原语补全"式小版本节奏（Activity→ViewTransition）比大爆炸重写更保护语料。
- 应避：①一切内联魔法指令（"use xxx"）——Atelier 已明确反对，React2Shell 证明隐式序列化边界还会成为攻击面；②把解码不可信输入的协议层藏进运行时而不暴露给静态检查。

---

## 2. Next.js 16.x / React Router 7-8 / Remix v3

### 2.1 Next.js 16.x

**① 现状与版本时间线**（npm registry）：16.0.0（2025-10-22 发布，官宣 10-21）→ 16.1.0（2025-12-18）→ 16.2.0（2026-03-18）→ 16.3.0（2026-08-03）→ 16.3.5（2026-09-11，检索时最新）。

- 16.0（[nextjs.org](https://nextjs.org)）：Turbopack 成为默认 bundler（生产构建宣称 2–5× 提升）；**Cache Components** 取代 PPR 实验——`"use cache"` 指令 + `cacheLife()`/`cacheTag()` 三件套，缓存从默认隐式改为显式 opt-in；`middleware.ts` 更名 `proxy.ts`；内置 React 19.2 与 Compiler 支持。
- 16.3：Instant Navigations（流式/缓存两种页面切换提速策略）+ **AI Improvements**（官宣 2026-06-26，[nextjs.org](https://nextjs.org)）：**随包捆绑 AGENTS.md 形态的框架文档、first-party Skills、带 React 组件树内省的 Agent Browser、actionable errors、更小而专注的 MCP**。配套仓库 `vercel/next-devtools-mcp` 把 dev server 能力以 MCP 暴露给编码 agent。

**② 内部架构与技术实现**

- Turbopack：Rust 实现的增量引擎，按函数粒度做持久化缓存；16 起生产构建稳定，dev 与 prod 收敛到同一引擎（Webpack 时代"两套打包器行为差"的 bug 类被结构性消灭）。
- Cache Components：编译期把带 `"use cache"` 的组件/函数切成可独立缓存的渲染段，运行时"预渲染壳 + 按需填洞"——即 PPR（Partial Pre-Rendering）的产品化形态。`cacheTag()` 提供标签失效，`cacheLife()` 提供生命周期档位。三个 API 全部显式，无全局默认缓存。
- 服务端：Route Handlers / Server Actions 合并为"单函数即 API"；代理层（原 middleware）运行在边缘兼容运行时，更名 proxy.ts 以正名其"转发"而非"中间件"语义。
- 关键模块划分：编译（Turbopack/SWC + Compiler 集成）/ 路由（App Router 文件约定）/ 渲染（RSC 运行时 + Cache Components 调度）/ 代理（proxy.ts）/ dev 面与 MCP（16.3 起）。

**③ 优缺点**

- 技术：一体感最强、RSC/缓存/路由全自研闭环；代价是抽象层数最多，出问题时定位链条最长（用户代码 → 编译宏 → RSC 运行时 → bundler）。
- 工程：codemod 化升级 + major 频率克制（16 系半年三个 minor）；但缓存语义三年三变，升级文档是必读项。
- 生态：React 生态全部可复用；Vercel 平台倾向仍是社区争议点（部署 target 的"一等公民"是 Vercel）。

**④ AI 生成友好度**：语料最大 + 16.3 起 agent 基建第一梯队（AGENTS.md、skills、MCP、浏览器内省四件套）。幻觉高发面：缓存语义——App Router 时代缓存默认值已翻转三次（2023 隐式全缓存 → 15 移除默认缓存 → 16 "use cache" 显式化），旧语料与新语义混杂是长期错误源；`"use client"` 边界摆放次之。

**⑤ 对 Atelier**：可取——"框架文档随包分发 + agent 可内省的运行时（Agent Browser 与 Atelier dev 面桥接器同构）+ actionable errors"验证了 dev 面即 agent 界面的路线，Atelier 应把 Agent Browser 式"运行时组件树/信号图内省"列入 dev 面 roadmap；应避——缓存语义翻转：Atelier 的缓存策略若引入，应一步到位显式契约化，不留隐式默认值。

### 2.2 React Router 7 → 8

- RR 7（2024-11-22，npm）：Remix v2 并入为 Framework Mode。
- 2025-09-17/18：Middleware 与 **RSC Framework Mode Preview**（[remix.run/blog](https://remix.run/blog)）。
- **RR 8.0.0（2026-06-17）**：官方称"deliberately boring"的大版本——放弃 CJS 仅 ESM、要求 React 19.2 + Vite 7、RSC 与 Server Actions 以 early preview 附带（不建议生产采用）、确立**年度大版本节奏**（[remix.run](https://remix.run/blog/react-router-v8)；React Status #479 报道，2026-06-19）。现 8.4.0（2026-09-15）；v7 分支继续安全维护。
- 架构不变量：路由树即类型源（类型化 params/loaderData）、loader/action 读写二分、无自研渲染模型（渲染交给 React 本体）。

### 2.3 Remix v3：脱离 React 的豪赌

时间线（[remix.run/blog](https://remix.run/blog) 全目录，2026-09-19 检索）：
- 2025-05-28《Wake up, Remix!》：宣布 v3 **不用 React**，从 **Preact fork** 起步，追求零关键依赖（目标是零依赖）、Web API 优先、不依赖 bundler/静态分析、单包分发，并明确列出 **"model-first development, optimized for LLMs"** 设计原则。
- 2026-04-30 Remix 3 Beta Preview；2026-05-06 A Brand New Remix；2026-08-31 **Remix 3 Release Candidate**（"built on web primitives and shipped as a single dependency"）。**尚未 stable**（截至 2026-09-19）。
- 社区分裂代价：React Router 8 与 Remix 3 双线并行，v3 语料接近零，只能靠官方原则文档与技能包补。

**对 Atelier**：Remix v3 的原则清单（模型优先、零依赖、Web API、无 bundler 依赖、单包）与 Atelier 零依赖内核 + 契约单源高度同频——这份清单本身值得逐条对齐进 specs/guardrails；教训是"双框架并行的语料撕裂"：Atelier runtime 与 codegen 双产物必须保证 golden DOM diff 同源，不出现"两套写法"。

---

## 3. Vue 3.6（Vapor）/ Nuxt 4.x → 5

### 3.1 Vue 3.6：仍卡在 RC

**版本事实（npm registry，2026-09-19）**：`latest` 仍是 **3.5.43**（2026-09-17）；3.6 线：alpha.1（2025-07-12）→ beta.1（2025-12-23）→ rc.1（2026-07-18）→ **rc.9（2026-09-18）**。即 **Vue 3.6 截至 2026-09-19 仍是 RC，未 stable**。

> 复核提示：网络上有文章（2026 年初起）宣称"Vue 3.6 已 stable/已发布 Vapor stable"——与 npm registry 相悖，属不实或超前表述。旧报告"截至 2026 年中仍为 RC/opt-in"判断正确且在 2026-09 依然成立。

**内部架构**：
- **响应式重写**：3.6 把响应式系统重建在 **alien-signals**（Evan You 的无类信号库）之上，替代原 `@vue/reactivity` 的依赖收集实现；官方口径为性能与内存双改善。API（ref/computed/effect）保持同语义——是"换引擎不换接口"的典型。
- **Vapor Mode**：编译策略而非运行时开关——编译器不生成 VNode/diff 调用，直接产出操作 DOM 的代码；`<Suspense>` 长期为最后的功能对齐缺口（beta 公告口径）。**使用方式为 opt-in**（组件级 `vapor` 属性或编译配置），VDOM 模式与 Vapor 模式在同一应用长期并存（[clearmedia.pl 综述](https://clearmedia.pl)，2026-08）。
- 编译期/运行时分工：模板 SFC 静态分析（patch flags、block tree）在 3.5 已高度成熟，Vapor 把这一分工推到极致——运行时只剩细粒度 effect 接线。

**优缺点**：技术——alien-signals 引擎 + 可选无 VDOM 是性能与包体双赢，且同语义双产物保住存量生态；工程——opt-in 双轨从 2025-07 alpha 算起已超 14 个月，文档/示例分裂真实发生；生态——3.5 线继续小步维护，npm latest 长期不切 3.6 说明官方对 stable 门槛谨慎。

**AI 友好度**：模板指令规则明确、语料第二充足；类型反馈（Volar）质量高。风险：Vapor 写法与经典写法混用——AI 可能把 `useTemplateRef` 这类 3.5 API 与 Vapor 专有用法杂交；Vapor 语料在 2026-09 仍薄（未 stable）。

**对 Atelier**：可取——"同语义双产物 + golden 对拍"恰是 Atelier codegen 的思路，Vue 证明该路线在真实生态可行但耗时远超预期，应把"双产物同源测试"当一阶段目标而非长期状态；应避——opt-in 双轨长期化：Atelier 的解释器/codegen 应从第一天就语义收敛，避免"解释器模式 vs 编译模式"两套用户心智。

### 3.2 Nuxt 4.x / 5

- 4.0.0（2025-07-15，npm）：`app/` 目录重构、shared/ 类型安全数据层；4.1.0（2025-09-02）；**4.5.2**（2026-08-05，检索时最新）。Nuxt 3 EOL 2026-07-31。
- **Nuxt 5 未发布**：官方（4.0 公告）口径"会在 Nuxt 5 上带 Nitro v3 与 h3 v2"；第三方追踪（alisoueidan.com、HeroDevs）估计 **Q4 2026**，前提是 Nitro 3 稳定（均未获官方日期承诺，未确认）。
- 架构：Nitro 服务引擎（部署 target 即编译期配置）+ 自动导入 + `server/api` 文件即 API；类型从 server routes 自动推导到客户端。
- AI 友好：语料充足、约定清晰；自动导入使"符号从哪来"对 agent 不透明——与 Atelier 显式 import 哲学相反。
- 对 Atelier：可取——Nitro 的"部署 target 作为编译期配置"（对应 Atelier 未来 server 侧的 Bun/Node/edge 多 target）；应避——自动导入这类"省人手、坑 agent"的隐式性。

---

## 4. Svelte 5.x / SvelteKit 2 → 3

### 4.1 Svelte 5：runes 稳定深耕 + 实验性 async

- npm：5.0.0（2024-10-19）→ 5.36.0（2025-07-14）→ **5.57.1**（2026-09-18，检索时最新）。无 Svelte 6 官方消息（截至 2026-09-19，未确认任何 Svelte 6 计划）。
- **实验性 async（重要拐点）**：5.36 起编译选项 `experimental.async` 允许在组件 `<script>`、`$derived` 表达式、模板中直接 `await`；2025-10 起实验性 async SSR 落地（[svelte.dev What's new 2025-10](https://svelte.dev)）。这与 Solid 2 的"async 进响应式图"是同一趋势的两种实现。
- runes（`$state`/`$derived`/`$effect`/`$props`，可放 `.svelte.ts`）已稳定三年制；编译器把 rune 声明编译为 `@priomtime/signals` 驱动的细粒度更新——**运行时其实是信号引擎，模板编译产出定向 DOM 更新，无 VDOM diff**。

### 4.2 SvelteKit 2 → 3 与 remote functions

- SvelteKit 2.70.3（检索时最新）；**3.0 RC（2026-08-13，[svelte.dev](https://svelte.dev)）**，npm `next` tag 为 3.0.0-next.27。RC 口径"不再有破坏性变更"，新增更可读的诊断输出。
- **remote functions**：`.remote.ts` 文件中声明 `query`/`command`/`form` 原语，客户端直接 import 调用，框架自动补 RPC 边界与类型（官方 RFC/讨论 [sveltejs/kit#13897](https://github.com/sveltejs/kit/discussions/13897)，2025-06 起）。第三方文章称其在 2.56+ 转 stable（**未确认**——未能对官方文档核实确切转正版本）。这是 2025H2–2026 全栈原语浪潮中最"显式"的设计之一：一个文件一类意图，读写二分（query/command）。

### 4.3 优缺点 / AI 友好度 / 对 Atelier

**优缺点**：
- 技术——编译期把 rune 声明降级为定向 DOM 更新，运行时包体与性能是第一梯队；代价是"魔法感"：响应性规则由编译器解释，违反规则（如解构 reactive state）时静默失效多于显式报错（3.0 RC 的诊断增强正是冲着这个去的）。
- 工程——SvelteKit 的 form actions 与 `+server.ts` 边界显式干净；adapter 体系让部署 target 成为编译期选择（与 Nitro 同构）。
- 生态——组件生态规模小于 Vue/React 一个量级，UI 库多为 Svelte 4 遗产，runes 化迁移仍在进行。

**AI 友好度**：S4/S5 双峰语料仍是最大伤——社区实证多次显示模型混写两代语法（旧报告已引证，本轮未见推翻）；runes 的显式声明本身利于静态分析与 lint。remote functions 语料薄，但 `.remote.ts` 的结构强约定对 agent 是"少自由度=高正确率"的好设计。类型反馈（PageData 自动推导）质量中上，弱于 TanStack/Angular 的显式类型。

**对 Atelier**：可取——remote functions 的"单文件即契约 + 读写二分"可直接映射 Atelier 契约单源（schema → server function 定义）；3.0 RC 的"更可读诊断"方向值得 struct check 借鉴；应避——把核心 API 语义重写一遍（runes 之于 S4）的语料代价已被 Svelte 实证：Atelier 若做 API 调整，必须走"新增 API + 老API 弃用期 + codemod"，不搞语义重写。

---

## 5. SolidJS 2.0 / SolidStart

### 5.1 版本事实

- 稳定线：1.9.15（2026-08-17，npm）——1.9.0（2024-09-24）后持续维护。
- 2.0 线：路线图讨论 2025-02（[solid-js#2425](https://github.com/solidjs/solid/discussions/2425)）；beta 约 2026-05（[InfoQ 报道](https://www.infoq.com)）；**RC 2026-08-12 官宣《Solid 2.0 RC: The Big <Reveal>》（[solidjs.com](https://www.solidjs.com)）**；npm `next` tag：2.0.0-rc.1（2026-08-19）→ **rc.9（2026-09-18）**。**未 stable**（截至 2026-09-19）。
- SolidStart：`@solidjs/start` **2.0.0 已于 2026-08-04 发布 stable**，现 2.0.5——版本号先于 core 2.0 对齐（core 还在 RC）。1.1.0 时代为 2025-02-10。

### 5.2 内部架构：async 成为一等公民

- 核心命题（RC 官宣语）："async is a property of the reactive system itself"——promise 可直接流入 `createMemo`/信号，未决议即产生"待定错误"，由新的 **`<Reveal>`** 边界统一处理 pending/errored。`createResource` 移除；`batch`/`startTransition` 移除（天然 microtask 批处理 + 显式 `flush()`）；effects 拆分为 compute/apply 两段以提升可静态分析性（对编译器与 lint 友好）（官方博客 + 社区迁移手记互证）。
- 编译器：基于 **Oxc（Rust）** 的编译工具链替代 Babel 插件——旧报告记"宣称最高 355× 提升"，本轮未能在官方渠道复核该数字（未确认）。
- JSX 无 VDOM：组件函数只运行一次，JSX 表达式即细粒度订阅——与 React 语义的系统性差异（解构 props 失响应等）延续到 2.0。

**AI 友好度**：JSX"形似 React 神不似"是高幻觉温床；1→2 又一次重写 API 面，1.x 与 2.x 语料并存加剧混乱；类型反馈好（TS 优先）。对 Atelier：可取——async-in-graph 与 split effects 都指向"响应式图可静态分析"，这直接影响 Atelier 模板解释器对异步表达式的求值策略设计；应避——连续两个大版本重写核心 API（Atelier API 面 snapshot 门禁正是为此设的护栏）。

---

## 6. Angular 21 / 22

### 6.1 版本事实

- 20.0.0（2025-05-28）；**21.0.0（2025-11-19）**；**22.0.0（2026-06-03）**；22.1.7（2026-09-16，检索时最新）。
- 21（[blog.angular.dev](https://blog.angular.dev)）：**zoneless 成为默认**（Zone.js 退出变更检测触发链）、Signal Forms 实验性、**Vitest 取代 Karma** 成默认测试器、**增强的 CLI 内置 MCP server**（文档落点 angular.dev/ai/mcp）。
- 22（同上，2026-06-03）：**Signal Forms stable**、zoneless 生产级稳定 + OnPush 稳定、MCP 增加 `devserver.start`/`devserver.stop` 等工具、移除一批弃用 API。

### 6.2 内部架构

- 变更检测：信号驱动——模板编译产出对信号的表达式级绑定，脏检查退化为"订阅图触达的视图子集"；zoneless 后调度由信号写事件直接驱动。Signal Forms 把表单字段本身建模为信号（`form` 绑定 `$state`），替代 RxJS 化的 Reactive Forms。
- DI/装饰器体系不变；控制流（@if/@for）与增量 hydration 延续 20 的转正成果。
- MCP server 由 CLI 内嵌：`ng mcp` 一类入口暴露项目上下文、迁移指导、dev server 控制工具——是"框架自带 agent 基建"最完整的第一方实现（与 Next 16.3 并列第一梯队）。

**AI 友好度**：规则极其明确（装饰器 + 强类型 + CLI 强约束），错误信息业界最佳；幻觉高发面：RxJS 旧模式 vs 信号新模式的混用、module-era 语料残留。Token 成本高是结构性缺点。对 Atelier：可取——①CLI 内置 MCP 直接对标 Atelier dev 面 MCP；②"迁移分析器 + agent 可执行迁移 SOP"值得抄进 struct/api-diff 工作流；应避——多层样板（模块/装饰器/注入符）推高每次生成的 token 预算与遗漏概率。

---

## 7. Qwik 2.0 / Astro 6-7

### 7.1 Qwik：v1 长青，v2 仍在 beta

- npm：`qwik`（legacy 包）latest **1.20.0**；v2 迁至 **`@qwik.dev/core`**：beta.1（2025-06-04）→ **beta.43（2026-09-01）**。**未 stable**（截至 2026-09-19）。包作用域从 @builder.io 迁到 @qwik.dev 反映组织独立化。
- resumability 不变：SSR 后不执行 hydration，执行状态序列化进 HTML，事件触发时按需懒加载对应 chunk（官方口径启动 JS ≈1kb）。v2 为 core 重写 + 新 API + 构建提速（社区口径），QRL/`component$` 约束延续。
- AI 友好度：`$` 闭包序列化约束（不可捕获外部变量等规则）是高幻觉区；语料薄；v1/v2 双包又添一层混乱。对 Atelier：可取——resumability 的"状态显式序列化、接管者读快照而非重放"正是 Atelier 桥接器/checkpoint 的理论原型；应避——把序列化约束交给用户手写规则，而应编译器自动保障。

### 7.2 Astro：一年两个大版本

- 5.0.0（2024-12-03）：Server Islands/Actions/Sessions/Content Layer 以实验形态引入。
- **6.0.0（2026-03-10）**：Server Islands、Actions、Sessions 转正为 stable；**CSP 稳定**、内置 Fonts API；dev server 重构（跨运行时更稳，[The New Stack 报道](https://thenewstack.io)）；6.1（2026-03-31）补图片优化/i18n hooks。
- **7.0.0（2026-06-22，[astro.build/blog/astro-7](https://astro.build/blog/astro-7)）**："speed release"——`.astro` 编译器从 Go 重写为 **Rust**（配合 Rust Markdown 管线，宣称构建快至 61%）、升级 Vite 8、Advanced Routing、后台 dev server、结构化日志、**面向 AI 编码 agent 的支持特性**；**破坏性变更：不再静默修正非法 HTML**（旧 Go 编译器会自动重排/修复）。
- 7.3.3（2026-09-16，检索时最新）。
- AI 友好度：`.astro` 模板近乎 HTML，生成难度低；岛屿边界（client: 指令）需要规则但规则少而显式；"拒绝静默修 HTML"对 AI 反而是利好——错误显式化而非吞掉。对 Atelier：可取——①"静/动隔离 + Server Islands 占位注入"适合 Atelier 全栈后的内容面；②"编译器不再静默纠错"与 Atelier 契约校验哲学一致，值得作为原则写进 guardrails；应避——为内容站优化的心智不可直接搬到应用框架。

---

## 8. TanStack 全家桶

### 8.1 版本事实（检索 2026-09-19）

| 包 | 最新（npm） | 状态 |
|---|---|---|
| @tanstack/react-router | 1.170.38（2026-09-16） | 稳定长跑（1.0 于 2023-12） |
| @tanstack/react-start | 1.168.56（2026-09-16） | **官方文档仍标 RC**（RC 起于 2025-09-23；[docs](https://tanstack.com/start/latest/docs/framework/react/overview)） |
| @tanstack/react-query | 5.103.1 | 稳定 |
| @tanstack/react-form | 1.33.5 | v2 alpha（2026-08-06 官宣） |
| @tanstack/react-db | 0.4.1 | **beta（2025-08 起），未 GA** |
| Table V9 | — | 2026-08-04 官宣（树摇特性 + 细粒度响应式） |
| TanStack AI | RC（2026-08-21 官宣） | 含"一次 `chat()` 调用跑沙箱编码 agent"方向 |

- 2026 年大事：与 **Vercel 达成合作**（2026-09-08 官宣）、Lovable/Render 合作；**《We Stopped Using RSC on TanStack.com》**（2026-07-24，Tanner Linsley）——官方站点弃用 RSC（文章正文未能抓取，细节未确认，仅标题与日期经博客目录核实）。
- Start 的特殊性：npm 版本号与 Router 共线（1.16x），但**文档持续标 RC 近一年**——"1.0 GA"始终未官宣。RSC 支持在其文档中仍标 experimental。

### 8.2 架构与评价

- Start 不发明渲染模型：文件路由树（Router）+ server functions（要求 schema 校验）+ Query 请求状态机，全部跑在 Vite 上；类型端到端推导、无 codegen。
- TanStack DB：typed collections + live queries（差分数据流驱动）+ 事务式乐观 mutator + 可插拔 sync（ElectricSQL 等集成展示）（[InfoQ 2025-08-30](https://www.infoq.com)）。
- AI 友好度：纯 TS、无 DSL、错误信息直白——类型即验收 harness 的最佳样本；但 Start/DB/AI 三个产品线同时在 RC/beta，agent 训练语料必然滞后且互相污染。对 Atelier：可取——①server function 强制 schema 校验=契约单源思想；②"不造渲染模型、只做类型与状态层"证明薄内核全栈可行；应避——多产品线 RC 长跑导致的 API 漂移与文档分裂（Atelier 单一版本节奏 + api-diff 门禁是对冲）。

---

## 9. 轻量线与超媒体（Preact / Lit / Alpine / htmx / Datastar / Nue）

- **Preact**：10.29.8（2026-09-08，npm latest）仍为 latest；**11.0.0 进入 RC**（rc.1 2026-08-26、rc.2 2026-09-08，npm `rc` tag）——11.0 内容本轮未逐一核实（未确认）。signals 被广泛复用；被 Remix v3 选作 fork 底座是其实力的旁证。
- **Lit**：3.3.3（2026-05-14，npm）稳定维护，无 4.0 消息（截至 2026-09-19）。Web Components 路线在 Tauri 类桌面壳内嵌场景有独特价值（与宿主框架解耦）。
- **Alpine**：3.17.3（2026-09-14，npm）小步迭代（旧报告"版本号未确认"现已确认）。
- **htmx**：latest 仍 **2.0.10**；**htmx 4.0.0 于 2026-08-28 发布**（[four.htmx.org](https://four.htmx.org)），npm 走 `next` tag（官方称约至 2027 年初才切 latest，避免误升级）——两大新特性：**morph swaps**（形态保持的 DOM 替换）与**基于 fetch() 的请求**（弃 XHR）；**破坏性变更：属性继承从默认改为显式 opt-in**（htmx 2 里父元素属性默认向下继承），并提供 htmx-2-compat 兼容开关。这是超媒体阵营"从隐式默认走向显式声明"的标志性事件。
- **Datastar**：SSE 驱动的超媒体框架（服务端下行 patch DOM + 细粒度信号），**1.0 已发布**——社区来源（HN 讨论、官方播客口径）指向约 2026 Q1，未能核到官方 changelog 精确日期（未确认精确日期）。其"服务端状态收敛 + SSE 下行"与 Atelier dev 面桥接器同构。
- **Nue**：2.0（2025-10-14，[nuejs.org](https://nuejs.org)）"UNIX of the web"，无构建路线，1→2 不兼容。

**AI 友好度**：htmx/Alpine/Datastar 生成物是 HTML 片段——无运行时心智、后端模板即真相源、验证面小，AI 首遍正确率天然高；代价是富交互表达力天花板与"逻辑散落服务端模板"的重构摩擦。对 Atelier：可取——①htmx 4 的显式化修正再次证明"显式优于隐式"是跨阵营公理；②超媒体+islands 混合是 Atelier 内容面/低交互面的低成本选项；应避——把超媒体当主渲染模型（与 Atelier 信号内核冲突），只宜作为全栈后的可选输出形态。

---

## 10. 标准与基建（TC39 Signals / Vite 8 Rolldown / Tailwind v4 / TypeScript 5.9→7）

### 10.1 TC39 Signals

- 状态：**Stage 1**（2024-04 进入），截至 2026-09 **未进 Stage 2**（[github.com/tc39/proposal-signals](https://github.com/tc39/proposal-signals)）。2026 年社区仍在讨论跨框架统一信号原语的价值（如 2026-07 评论文章），但规范草案与实现分歧（与各框架信号语义差异）仍在。对 Atelier：自研信号引擎保留——语言级信号即使推进也需数年，且 API 形状未必贴合模板解释器需求；可预留适配层。

### 10.2 Vite 8 / Rolldown

- 时间线：Vite 7.0.0（2025-06-24）→ 8.0 beta（2025-12-03 官宣"Rolldown-powered Vite"，[vite.dev](https://vite.dev)）→ **8.0.0 stable（2026-03-12，npm）** → 8.3.0（2026-09-10，检索时最新）。
- 架构变化：**Rolldown（Rust）成为默认 bundler**，替代 esbuild（dev 转换）+ Rollup（生产构建）组合；配合 **Oxc** 做转译、Lightning CSS；社区口径构建提速 10–30×（各源数字不一，取区间）。8.x 保留 Rollup 回退路径（配置切换）。
- 背景本底：Rolldown/Oxc/Oxlint 由 VoidZero 统一推进，形成"Vite+Rolldown+Oxc+Vitest+TS 原生化"的全 Rust 工具链盘子。
- 对 Atelier：dev 面插件（Vite 插件形态）要为 Rolldown 时代做回归——atelier/dev 的钩子面在 Vite 8 下必须过一遍测试；编译器（dump/codegen 的 mjs 纯 JS 实现）性能瓶颈暂不构成问题，但 Oxc 的 parser/transformer 可作为未来 codegen 的可选加速底座（（未确认）收益需实测）。

### 10.3 Tailwind v4.x

- 4.0.0（2025-01-21）→ 4.1.0（2025-04-01）→ 4.3.0（2026-05-08）→ 4.3.3（2026-07-16，npm latest 检索时最新）。CSS-first 配置（`@theme`）、原生级引擎在 4.0 已定；4.1–4.3 为渐进增强（4.1 加 text-shadow/mask 等，4.3 线细节本轮未逐一核实（未确认））。Atelier 决策 16（token→@theme AOT）与之兼容良好。

### 10.4 TypeScript 5.9 → 6 → 7（Go 原生编译器落地——对编译器型框架影响最大的一条）

**npm registry 时间线（2026-09-19 检索）**：

| 版本 | 日期 | 说明 |
|---|---|---|
| 5.9.2 | 2025-07-31 | 5.9 线开始（5.9.3 为 2025-09-30） |
| 6.0.0-beta | 2026-02-11 | "桥接版本" beta：JS 实现 + 破坏性默认值调整 |
| 6.0.2 / 6.0.3 | 2026-03-23 / 2026-04-16 | 6.0 线 stable（npm 上无 6.0.0/6.0.1——版本跳跃，疑似未发布或撤回，原因未确认） |
| 7.0.1-rc | 2026-06-18 | Go 原生版 RC |
| **7.0.2** | **2026-07-08** | **TypeScript 7 GA** |

- **TypeScript 7 = Go 原生 port（项目代号 Corsa，2025-03 立项）正式落地**：官方宣布约 **10× 快**（InfoQ 口径构建 8–12×）；实测量级示例：VS Code 代码库类型检查 77.8s → 7.5s；内存约减半；编译器二进制名 `tsgo`（[Microsoft DevBlogs](https://devblogs.microsoft.com)，2026-07-08；[InfoQ](https://www.infoq.com)）。
- 版本策略：6.0（JS 实现）承担破坏性默认值与过渡（bridge release），7.0（Go 实现）承担性能。npm 版本号存在 6.0.0/6.0.1 与 7.0.0/7.0.1 缺位现象（检索确证，官方解释未确认）。
- **对编译器型框架的影响（Atelier 视角）**：
  1. **类型反馈回路提速 10×** → agent 的"改代码→tsc→读错"循环从秒级进入亚秒级，类型即验收 harness 的迭代成本大降，Atelier 的 contract 校验/守卫测试可纳入更密的循环。
  2. **框架自己的编译器不再独扛解析**：Oxc/tsgo 均为亚秒级全量分析，Atelier 的 dump.mjs 若需 TS 级语义（类型感知的 effect 依赖推导），可考虑借原生分析器而非自研（（未确认）可行性需评估 tsgo 的 API 暴露面——API 兼容性细节官方文档本轮未完整核实）。
  3. 风险：6.0 的破坏性默认值 + 7.0 双实现过渡期，第三方类型工具生态会有半年级的混乱，Atelier 的类型守卫测试要同时钉住 tsc 与 tsgo 的行为差。

---

## 11. 2025H2–2026 新出现框架 / 范式动向

- **超媒体复兴具体化**：htmx 4（morph + fetch）、Datastar 1.0、Nue 2.0、"无构建前端"讨论回潮（37signals ONCE 路线延续）。共性：服务端状态收敛、HTML 即契约、显式声明取代隐式继承。
- **agent 原生框架基建成为 2026 一线竞争力**：Next.js 16.3（AGENTS.md 随包/first-party skills/Agent Browser/MCP）、Angular 21-22（CLI 内置 MCP）、Astro 7（AI agent 支持特性）、TanStack AI（chat() 跑沙箱 agent）——"框架给 agent 开门"从卖点变标配。Atelier 的 25 工具 MCP 仍在第一梯队，但"Agent Browser 式运行时内省 + 随包 agent 文档"两项应列为跟进项。
- **async 进入响应式图**成为 2025H2-2026 最一致的响应式趋势：Solid 2（async 一等公民 + <Reveal>）、Svelte 5.36+（await 进 $derived/模板，experimental.async）、TanStack DB（异步集合 live query）。信号原语的"异步语义统一"是下一个三年决战点。
- **工具链全面 Rust/Go 化**：Rolldown（Rust）、Oxc（Rust）、Astro 编译器 Go→Rust、Solid 编译器 Oxc、TS7（Go）——"JS 框架的外壳 + 原生语言的工具链心脏"成型。纯 JS 编译器的性能故事到此终结。
- **安全事件改变叙事**：React2Shell（CVSS 10.0 RCE）把"序列化边界=攻击面"写进全行业认知；随后各框架在 2026 年公告中普遍强调 payload 校验与显式边界（系统性证据本轮仅覆盖 React 系，其他框架未逐一核实（未确认））。
- **全栈原语收敛为三种**：①单文件 RPC（SvelteKit remote functions / server functions 系）、②缓存指令（"use cache" 系）、③服务端片段注入（Server Islands / Server Components）。Atelier 全栈化需在三者中做显式取舍，避免三样都做。
- 有第三方评论称 2025H2-2026 出现"AI-first 重设计"的新框架（dev.to 2026-01 综述提及，未能定位到具体项目名与官方源，未确认——不作为结论依据）。

---

## 12. 横向综合：2025H2–2026 共性趋势（7 条）

1. **显式化是唯一不可逆的潮流**：Next.js "use cache" 把缓存从隐式改显式、htmx 4 把属性继承改 opt-in、Astro 7 拒绝静默修 HTML、Remix 3 立"零隐式依赖"原则——与 Atelier 现有哲学完全同向，且已从"风格之争"升级为"安全之别"（React2Shell）。
2. **编译期接管运行时责任**：React Compiler（自动 memo）、Vue Vapor/Svelte runes/Solid Oxc（绕过 diff）、Rolldown/tsgo（原生工具链）——"运行时聪明"全面让位于"编译期证明 + 原生执行"。Atelier 的 dump→codegen 双步管线站在正确一侧，且 TS7/Oxc 使"codegen 引入类型语义"首次变得廉价。
3. **async-in-graph 是响应式的下一个标准形态**：Solid 2 与 Svelte 异步实验从两端（运行时信号 vs 编译期降级）逼近同一语义。Atelier expr 求值器应尽早确定异步表达式的一等策略（显式 await 原语 or 拒绝），避免日后破坏性补课。
4. **agent 基建成为框架的第四层**（runtime/编译器/CLI 之外）：随包 AGENTS.md、first-party skills、内嵌 MCP、运行时内省（Agent Browser）已是 2026 一线标配。Atelier 需补的是"agent 可内省的运行时状态视图"与"随包可执行的框架文档"，MCP 工具数不是瓶颈，**工具与首遍正确率的因果闭环**才是。
5. **全栈原语收敛、但 nobody 全都要**：单文件 RPC / 缓存指令 / 服务端片段三条线各有旗舰，无一框架三者皆精。Atelier 全栈化宜"契约单源 + 单文件 RPC（读写二分）"起步，缓存与服务端片段列为 B 队。
6. **版本纪律分化明显**：RR8 "boring yearly"、Astro 一年双 major、TanStack RC 长跑、Vue 3.6 RC 十四个月——**稳定的交付节奏本身就是 AI 友好性**（语料与文档不漂移）。Atelier 的 checkpoint + api-diff 门禁是制度级对冲，应保持"宁可 boring"。
7. **超媒体路线没有被 SPA 阵营吃掉，反而完成了显式化改造**：对 Atelier 的意义是内容面/低交互面可以有一条"HTML 即契约"的降级输出路径（零 runtime JS），与信号内核并不冲突。

### 12.1 AI 友好度横向对比（本报告口径的展开）

| 维度 | 领先者 | 落后/风险者 | 说明 |
|---|---|---|---|
| 训练语料量级 | React（含 19 系）> Vue > Angular > Svelte | Remix 3 / Qwik 2 / Solid 2 / TanStack AI / remote functions | 2024-2026 的大重写制造了"新旧语料并存"的双峰问题 |
| 幻觉高发面 | 最小：htmx 4（显式继承）、Alpine、Astro（HTML 近似物） | 最大：RSC 边界、Qwik `$` 闭包、Solid 2 async、Svelte 4/5 混写 | 幻觉率与"隐式规则数量"正相关，与"结构自由度"负相关 |
| 类型反馈质量 | TanStack 全家桶、Angular、Solid（TS-first） | htmx/Alpine（无类型面）、Lit（模板字符串弱推断） | TS7 的 10× 提速把"类型反馈回路"的成本降到可纳入 agent 每步循环 |
| 官方 agent 基建 | Next.js 16.3、Angular 21-22（MCP+devserver 工具）、TanStack AI | React 本体（无）、Preact/Lit/Alpine/htmx（无） | "框架给 agent 开门"在 2026 成为一线标配 |
| 结构可验证性 | Angular（CLI 强约束）、SvelteKit `.remote.ts`、TanStack server functions | Remix 3（未 stable 无从验证）、Nuxt 自动导入 | 结构机检（Atelier struct check 同类能力）是首遍正确率的直接杠杆 |

### 12.2 对 Atelier 全栈化的行动建议（由本次调研导出）

1. **server function 起步即读写二分 + 契约单源**：参照 SvelteKit `query/command` 与 TanStack server function 的 schema 强制校验，Atelier 的扁平 TS schema 一源多用（运行时校验 / server function 签名 / MCP 工具定义）正是这两者的合流形态，方向已被业界验证。
2. **补"运行时内省"能力**：对标 Next 16.3 Agent Browser——dev 面桥接器应暴露组件树、信号依赖图、effect 队列的机器可读快照，让 agent 能"看"运行时而不只是"猜"。
3. **框架文档随包 + first-party skills 双落点已是共识**：Atelier 已有 skills install 双落点机制，补"随包 AGENTS.md 式框架速查"即可对齐 Next 16.3。
4. **异步表达式策略尽快定案**：Solid 2 / Svelte async 的方向信号明确，Atelier expr.ts 至少要在契约层声明"异步表达式是显式原语还是拒绝"。
5. **缓存与服务端片段列为 B 队**：观察 "use cache" 与 Server Islands 的语义稳定期，不抢跑；一旦引入，走显式契约（无隐式默认缓存）。
6. **保持 boring 交付**：RR8 的年度节奏 + Semver 纪律证明"可预测"对 AI 语料的价值；Atelier 的 api-diff 门禁 + checkpoint 是同构制度，勿放松。

---

## 13. 对旧报告的修正（`2026-fullstack-survey.md` 报告一）

| # | 旧报告表述 | 复核结论 | 修正 |
|---|---|---|---|
| 1 | "Remix v3 具体形态仍在演进（未确认）" | 已确认 | 形态=Preact fork + 零依赖单包 + model-first for LLM；2026-04-30 beta、2026-08-31 RC，尚未 stable。另：旧报告未提 **React Router v8（2026-06-17，ESM-only，RSC early preview）** |
| 2 | "19.2 加入 useEffectEvent、cacheSignal、Performance Tracks、PPR、批量 Suspense reveal" | 部分不准 | 19.2（2025-10-01）头牌特性是 **`<Activity>`**（旧报告漏掉）；useEffectEvent/Performance Tracks/compiler ESLint 规则属实；cacheSignal/PPR 表述与官方博客重点不符（PPR 是 Next 侧概念） |
| 3 | "React2Shell 19.0.0–19.2.2 受影响" | 需精确化 | 官方修复版为 **19.0.1 / 19.1.2 / 19.2.1**（2025-12-03 同日），19.2.3（2025-12-11）为跟进；受影响区间按版本对照应为 19.0.0–19.2.0/19.2.2 各线有别（各公告表述不一，以官方 advisory 为准） |
| 4 | "Vue 3.6 stable 日期未确认 / 截至 2026 年中仍 RC" | 判断正确并延续 | 截至 2026-09-18 仍是 rc.9，npm latest 仍为 3.5.43；另补：响应式引擎已重写为 **alien-signals** |
| 5 | "TanStack Start v1.0 RC（2025-09-23），正式 1.0 未确认" | 成立且风险升级 | 官方文档 2026-09-19 仍标 RC（近一年）；npm 版本号与 Router 共线（1.168.x）易被误读为已 GA。另补：**TanStack DB 仍为 beta（0.4.1），未 GA**；Form v2 alpha、Table V9、TanStack AI RC 均为新事实 |

其余复核为"确认无误"：Next 16（2025-10-21/22，Turbopack 默认 + Cache Components）、Nuxt 4（2025-07-15）、Svelte 5 语料实证、Solid 1.9 稳定 + 2.0 方向（async/batch 移除/split effects 与 RC 实况一致）、Angular 21 zoneless 默认 + MCP + Vitest（日期精确为 2025-11-19）、Qwik 2 beta、Astro Server Islands/Actions/Sessions、Preact 10/Lit 3 稳定（新事实：Preact 11 RC、htmx 4.0.0、Datastar 1.0、Astro 6/7、Vite 8、TS7）。

---

## 14. 不确定项清单（每条注明未确认原因）

1. **TanStack Start "1.0 GA"**：文档仍标 RC，但 npm 版本号（1.168.56）与 Router 共线；为何近一年不官宣 GA——官方未解释，无法判定 GA 时点。
2. **Vue 3.6 / Solid 2.0 / Qwik 2.0 / Remix 3 stable 日期**：四者均已到 RC/beta 后段，官方未给日期（npm registry 只能证明"截至 2026-09-18/19 未 stable"）。
3. **Nuxt 5 日期**：官方仅承诺"带 Nitro 3"；Q4 2026 为第三方估计，未获官方背书。
4. **Datastar 1.0 精确发布日**：HN/播客口径约 2026 Q1，未能核到官方 changelog 日期。
5. **Svelte remote functions 转正版本（2.56+ 之说）**：来自第三方文章，官方文档未核实到确切版本号。
6. **TanStack《We Stopped Using RSC》文章内容**：仅目录级标题+日期核实，正文抓取 404，弃用 RSC 的具体论据未确认。
7. **TS 7 API 兼容完整度与 npm 缺号（6.0.0/6.0.1、7.0.0/7.0.1）原因**：官方博客本轮未逐条核对；缺号仅是 registry 观察。
8. **Solid Oxc 编译器"355×"数字**：旧报告遗留 claim，本轮未在官方渠道复核。
9. **Astro 7 "AI coding agent support" 具体特性清单**：仅来自发布博文的检索摘要，未逐条核对官方文档。
10. **Oxlint 22 条 React Compiler 规则 / Vite plugin 6.1.0 集成**：单一来源（oxc.rs），未二次复核。
11. **Preact 11.0 变更清单**：仅确认 RC 存在与日期，未读 changelog。
12. **React 20 是否在规划中**：无任何官方信息，"无 React 20"仅指当前 npm latest 事实。
13. **React2Shell 在野利用的威胁行为者归因**：Unit42 记录了利用活动，归因无权威结论。
14. **"AI-first 新框架"具体项目**：第三方综述提及但无法定位官方源，不作为结论。

---

## 附：主要来源

- npm registry（版本/日期经 npm CLI 于 2026-09-19 查询）：vue / nuxt / svelte / @sveltejs/kit / solid-js / @solidjs/start / @angular/core / qwik / @qwik.dev/core / astro / @tanstack/* / preact / lit / alpinejs / htmx.org / typescript / vite / tailwindcss / next / react / react-router
- React：<https://react.dev/blog>、<https://react.dev>（19.2/19.3/Compiler v1.0）、<https://nvd.nist.gov>、<https://cloud.google.com/blog/products/identity-security/responding-to-cve-2025-55182>、<https://unit42.paloaltonetworks.com>、<https://oxc.rs>
- Next.js / RR / Remix：<https://nextjs.org>、<https://github.com/vercel/next-devtools-mcp>、<https://remix.run/blog/wake-up-remix>、<https://remix.run/blog>（RR8 与 Remix 3 时间线）、<https://reactrouter.com>
- Vue / Nuxt：<https://github.com/vuejs/core>（releases）、<https://clearmedia.pl>（Vapor opt-in 现状）、<https://nuxt.com>、<https://alisoueidan.com>、<https://www.herodevs.com>
- Svelte：<https://svelte.dev>（What's new 2025-10、SvelteKit 3 RC）、<https://github.com/sveltejs/kit/discussions/13897>
- Solid：<https://www.solidjs.com>（Solid 2.0 RC: The Big <Reveal>）、<https://github.com/solidjs/solid/discussions/2425>、<https://www.infoq.com>
- Angular：<https://blog.angular.dev>（v21、v22 公告）、<https://angular.dev/ai/mcp>
- Qwik / Astro：<https://github.com/QwikDev/qwik>、<https://qwik.dev>、<https://astro.build/blog/astro-7>、<https://astro.build>（2026-03 月报）、<https://thenewstack.io>
- TanStack：<https://tanstack.com/start/latest/docs/framework/react/overview>、<https://tanstack.com/blog>、<https://www.infoq.com>（DB beta、Start v1 报道）
- 超媒体/轻量：<https://four.htmx.org>（htmx 4.0.0）、<https://news.ycombinator.com>（Datastar 1.0）、<https://data-star.dev>、<https://nuejs.org>
- 标准与基建：<https://github.com/tc39/proposal-signals>、<https://vite.dev>（Vite 8 beta）、<https://devblogs.microsoft.com>（Announcing TypeScript 7.0）、<https://www.infoq.com>（TS 7 报道）
