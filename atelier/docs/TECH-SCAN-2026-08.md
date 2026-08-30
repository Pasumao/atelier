# Atelier 技术市场扫描（2025H2 – 2026.08）

> 扫描日期：2026-08-30。方法：四路并行检索（主流框架 / AI×前端生态 / 协议与标准 / agent 需求侧工程实践），重要条目经官方页面 WebFetch 核实，社区转述一律降级标注。
> 诚实分级沿用仓库惯例：**✅ = 官方原文确认**；**⚠️ = 仅搜索摘要/二手信源，引用前请复核原始链接**。本文是研究输入，不是决策记录；立项取舍以 `design-decisions.md` 与用户定论为准。
> 上游文档：`TECH-ASSESSMENT.md`（2026-02 时点竞品对照）与 `TECH-COMPARISON.md`（逐项机制对照）。本文覆盖其后约半年的增量。

## 0. 一页总判断

1. **方向被全面验证**：Atelier 的立身主张——"AI 编程代理是框架第一类使用者"——已被 Next.js 官方逐字写进博客（2026-02-12 *"treating agents as first-class users of Next.js"*，✅）；GitHub Spark（闭盒玩具运行时）官方弃用（2026-08，✅）；Next.js/Angular/Astro/Svelte 全部内建了 MCP 或 agent 工具面。我们不再需要向任何人论证这个赛道存在。
2. **窗口在收窄**：主流框架正以"内建 agent 基建"的方式进入我们开创的空间（AGENTS.md 生成、内嵌 MCP、官方 Agent Skills、agent 检测 dev server）。**Atelier 的 agent 面从"差异化"降级为"及格线"**；无人区收缩到三处：扁平 schema 契约三用、事务状态层（双轨回滚）、结构公理机检（见 §6）。
3. **最需要消化的一条反证**：Vercel 官方 evals 称"AGENTS.md 内联文档的 agent 通过率 100%，优于 skills 方案的 79%"（✅ Vercel 博客，经 Next.js 16.2 博客引用）。这与 2026-08-30 用户定论"技能包是核心竞争力"存在张力——注意其 eval 是 Vercel 自选任务集、不可直接外推，但混合策略（内联文档为底 + skills 为渐进披露增强）值得立项评估（§7-B1）。
4. **标准层全部就位且对我们有利**：AGENTS.md（6 万+ 项目 / 23 工具，✅）、Agent Skills（40+ 客户端，✅）、MCP（Registry + Linux 基金会 AAIF 治理，✅）都已成熟。Atelier 的自建物与标准同构，**做格式符合性校验即可获得跨工具分发能力**，成本极低。
5. **技术内核方向无虞**：TC39 Signals 仍停 Stage 1（✅，最后推送 2026-01-25），自研信号内核短期无被标准取代之虞；Vue Vapor 仍在 RC（3.6.0-rc.6，2026-08-28 ✅）、Solid 2.0 RC（2026-08-12 ✅，OXC 编译器）——"编译期细粒度"已成主流共识，F-2 编译器静态化路线正确且是时间敏感项。

---

## 1. 主流框架动向（2025H2 → 2026.08）

| 框架 | 关键事实 | 核实 | 对 Atelier |
|---|---|---|---|
| React/Next.js | React Compiler v1.0 稳定（2025-10-07）；Next.js 16 Turbopack 默认（2025-10-21）；**Next.js 16.2（2026-03-18）AI 专项：create-next-app 默认生成 AGENTS.md（npm 内联随包）、浏览器日志转发、dev server 锁文件、实验性 next-browser**；Next.js v16 起内建 MCP server 暴露运行时内部状态（errors/routes/rendered segments）并路线图化进 `next dev`（✅ nextjs.org/blog/agentic-future） | ✅ | 编译器路线被验证（React Compiler）；**正面撞型**：我们的 AGENTS.md 生成、dev 面 MCP 全部有了主流对标；差异点在组件级状态快照与契约联动（Next 只暴露 routes/segments 层） |
| Vue | 3.6 仍未 stable，最新 3.6.0-rc.6（2026-08-28）；Vapor Mode feature-complete（100% opt-in、不支持 Options API）；@vue/reactivity 改用 alien-signals | ✅ GitHub releases | "模板编译→细粒度信号"是正确方向；Vue 尚未 stable，时间差仍在 |
| Svelte | Svelte MCP server（2025-11）；实验性 async 组件（2025-08）；SvelteKit 3 预览（2026-08-01） | ✅ svelte.dev/blog | 各框架加 MCP 后，内建 MCP 从差异化变及格线；async-in-template 可纳入 DSL 演进参考 |
| Solid | 2.0 RC（2026-08-12）：默认 Rust/OXC 编译器、async 一等公民进响应图 | ✅ 官方博客（细节 ⚠️ 站点反爬） | 信号根基无恙；OXC 路线与决策 3"SWC 或后续迁 Oxc"呼应 |
| Angular | v21（2025-11-19）新应用默认 zoneless、实验 Signal Forms；**v22（2026-06-03）官方 Agent Skills（angular-developer 等，<140 行渐进披露 SKILL.md）+ MCP devserver 工具转正** | ✅ 官方博客三篇 | **最直接的正面竞争**：skills 包 + MCP + 渐进披露被整体内建。拉开身位靠契约 schema 三用与事务层 |
| Astro | Astro 7（2026-06-22）：`astro dev --background` 自动检测 AI agent、JSON 结构化日志；Cloudflare 收购 Astro 公司（2026-01-16，✅） | ✅ | "agent 检测 + 结构化日志"是 dev 面基础设施范例，可直接借鉴进 atelier dev |
| Qwik | 2.0 仍 beta（@qwik.dev/core 全量重写） | ✅（版本号 ⚠️） | 无直接影响 |
| TC39 Signals | 仍 Stage 1（README 声明，最后推送 2026-01-25，13+ 框架参与、策略是集成验证后再推进） | ✅ | 自研内核 2-3 年内无标准取代风险；建议对齐 signal-polyfill 语义留兼容出口 |
| AI-first 新框架 | **未发现与 Atelier 同定位（agent 当开发者、运行时级）的独立前端框架**。相邻动作：Google **A2UI**（2025-12 开源，agent 生成富 UI 的跨端声明式 spec，含 Angular/Lit/React/Flutter 渲染器，✅ a2ui.org） | ✅/⚠️ | 蓝海仍在；但竞争轴已变成"主流框架内建 agent 基建"，且 A2UI 是 UI-as-data 赛道的重量级标准 |
| 宏观 | State of JS 2025：40% 纯 TS、约 29% 代码 AI 生成（⚠️ 二手摘要）；模板 DSL 支撑免 VDOM 编译优化成共识，signal 渲染在 React 之外已是默认范式 | ⚠️ | 类 HTML 模板 DSL 处于顺风位（可静态分析=可编译=agent 可审计） |

## 2. AI×前端生态（三条赛道全部活跃）

- **AI 应用构建平台**：v0 转全栈平台（Next.js+Tailwind+shadcn/ui 完整工程，✅）；Replit Agent 4 Design Canvas（✅）；Lovable 扩通用任务（⚠️）；**GitHub Spark 官方弃用（2026-08-04 公告 / 08-31 下线，✅ changelog）**，理由是"agent 开发工具已成熟，用户转向 VS Code/Copilot CLI"。→ Spark 之死是"agent 当开发者"路线对"闭盒生成器"路线的路线胜利证据。威胁：平台把用户锁进 Next.js/React 生态，且均无开放"代理友好"接口。
- **生成式 UI（agent 当 runtime，正交赛道）**：**MCP Apps 成为首个官方 MCP 扩展（SEP-1865，Anthropic+OpenAI 联合，2025-11-21 官宣 / 2026-01-26 规范落地 ext-apps，✅）**，`ui://` 资源+沙箱 iframe，ChatGPT/Claude/VS Code 已支持；Google A2UI v0.9（⚠️）；CopilotKit 的 AG-UI 协议 day-0 支持各标准；Tambo 1.0、Cedar-OS 独立存在（无合并实据）。→ 收敛为 A2UI / AG-UI / MCP Apps 三标准。Atelier 应对：D 子集 schema 渲染天然接近 UI-as-data，若未来要嵌入聊天宿主需留适配面。
- **Claude/Codex 侧**：Agent Skills 规范 2025-10-16 开放（✅）；Claude Code 2.1 skills 热重载（⚠️）；Claude Code Artifacts beta（2026-06-18，⚠️ 二手）；GPT-5.2-Codex 进 GitHub Copilot GA（2026-01-14，✅）。
- **代理工具格局**：Cursor 领跑 IDE；Cognition 收编 Windsurf；GPT-5.3-Codex（2026-02-05，✅）。官方"代理友好"建议文档：Anthropic《Claude Code best practices》（2025-04-18，✅）、《Writing tools for agents》（2025-09，工具即契约/高信噪比/错误要教学/llms.txt/MCP，✅）、《Effective context engineering》（✅）；OpenAI 侧 AGENTS.md 开放标准（✅）。→ **Atelier 的契约/检视/回滚/结构门禁正是这些官方建议的框架化实现，可对外讲成"官方最佳实践的开源标杆"**。
- **相邻层创业卡位**：**Entire.io**（Git 联合创始人 Scott Chacon 参与：Git 兼容数据库+语义层，存储"代码+意图+约束"，为 agent 重构版本控制，✅ 官网/The New Stack）；Oak、Praxis、Superpowers 等（⚠️ 存在性核实、未深挖）；**Cloudflare Agents Week（2026-08，✅）：ADLC（替代 SDLC）、WebMCP（让网站可被 agent 发现/调用）、Kitesurf（agent 优先浏览器）**。→ 版本控制/基建层已被卡位，"前端框架内核为代理设计"仍是空白窗口。
- **术语演进**：vibe coding（2025-02）→ **agentic engineering**（Karpathy，Sequoia Ascent 2026-02，⚠️ 视频+转述）、**context engineering**（Anthropic，✅）、**AX / Agent Experience**（Netlify CEO Mathias Biilmann 提出，agentexperience.ax，⚠️）。→ 文档与官网应对齐这些已成型的心智词汇。

## 3. 协议与标准层（对 Atelier 自建物的一致性判定）

| 标准 | 现状 | 核实 | Atelier 一致/偏差 |
|---|---|---|---|
| MCP | Registry 2025-09-08 上线（✅）；2025-11-25 版：URL elicitation、sampling 携带 tools、实验性 Tasks、正式 extensions 机制（✅ changelog）；**2026-07-28 RC：移除 session/初始化握手转无状态核心，stdio 传输保留**（✅）；捐 Linux 基金会 AAIF（2025-12-09，✅）；工具发现方向 = 按需发现/代码编排（Anthropic Code execution with MCP + advanced tool use，✅） | ✅ | 自建 stdio JSON-RPC 与规范核心一致；**偏差：错误未映射 MCP structured error/isError；21 工具单列表未做分组按需启用；未提交官方 Registry** |
| AGENTS.md | 6 万+ 开源项目、23 具名工具（Codex/Cursor/Copilot/Zed/Devin/Gemini CLI…）；纯 Markdown 无版本化；治理归 AAIF；monorepo"最近文件优先" | ✅ 官网直读 | `init --ai` 生成一致；可补嵌套规则文档 |
| Agent Skills | agentskills.io：**40+ 具名客户端**（ChatGPT/Codex、Cursor、Gemini CLI、opencode、Copilot、VS Code、Kiro…）；格式 = 目录 + SKILL.md（frontmatter：name ≤64 字符 kebab-case + description）+ scripts/references/assets；三段渐进披露 | ✅ | 技能包方向正确且已获跨工具分发的标准通道；**待办：check-skills 增加标准符合性校验（frontmatter 字段约束）** |
| llms.txt | 采用停滞：Ahrefs"无主流 LLM 提供商使用"（⚠️ 二手）；Google 明确非搜索信号（⚠️）；但 Anthropic/Stripe/Vercel 仍发布 | ⚠️ | 继续生成（成本极低）但定位降级为"站点级目录"；AGENTS.md/SKILL.md 才是主通道 |
| Spec-driven development | **GitHub Spec Kit**：constitution→specify→plan→tasks→implement + converge（1.0.0，13.2 万 stars ⚠️）；**Kiro**：requirements（EARS 记法）→design→tasks（✅）；Tessl 转向 agent enablement 平台（⚠️）；实践痛点 = spec 漂移/维护成本 | ✅/⚠️ | specs/ 方向与三巨头一致；**Atelier 差异点：规格是可执行测试（.atr.spec.ts）而非纯英文，比 Spec Kit"English unit tests"更进一步**——应保留并对外讲清；可借鉴 EARS 记法与 constitution（项目级原则文件） |
| A2A / ACP | A2A：150+ 组织、企业生产（✅ LF）；ACP（Zed）：编辑器↔代理标准（类比 LSP），复用 MCP 类型，Zed/Neovim/JetBrains/VS Code 采用（✅） | ✅ | 面向 agent↔agent/编辑器↔代理，非"框架→代理"通道；监控即可，dev 面未来多编辑器驱动时可走 ACP |
| 开发类 MCP server | Playwright MCP（**无障碍树快照驱动**，事实标准）；GitHub MCP（toolsets 分组 + `--toolsets` 白名单 + 动态发现；2025-10-14 官方主动"合并 PR 工具为更少更强"省 token，✅）；shadcn MCP（registry-as-API：浏览/搜索/安装组件，✅） | ✅ | 三条设计共识可搬：① a11y 快照优于截图；② 工具面少而强+分组按需启用；③ registry 交互与 Atelier 组件模板分发同构 |

## 4. 需求侧工程实践（验证我们的主张 / 发现空白）

1. **大厂共识清单**（✅ 原文确认）：Anthropic——机检验证回路（测试/构建退出码/lint/截图比对）、CLAUDE.md 保持短小、hooks 做确定性门禁；Sourcegraph《Agentic Coding in 2026》（2026-05-21）——80% 问题本质是上下文问题、"把 agent 当有提交权的承包商：过同样 CI、review 其 diff、搜残留引用"；Vercel《Teaching agents product design》（2026-06-25）——把产品决策当代码进仓库（skill+linter+evals），决策树"机器可检→lint 规则 / 判断型→agent 指引"，规则带稳定 ID；Shopify——1/8 合并 PR 由 agent 共著（✅）。→ Atelier 的验证回路/结构门禁与 Vercel 决策树高度同构，属第一梯队；**业界尚无"框架内建扁平契约 schema"对标物，specs/ 比 Vercel 的 skill 文件夹更结构化**。
2. **设计系统×AI**：shadcn CLI 3.0+MCP（2025-08，✅，多 registry 命名空间+私有 registry）；**W3C DTCG 设计 token 规范首个稳定版 2025-10-28（✅）**；"设计系统即 AI 生成控制面"论述出现（O'Reilly，⚠️ 403）。→ token SSOT 与 DTCG 汇合；**可做 DTCG 格式互导让 token 被任意 agent 消费**。
3. **测试与验证**：chrome-devtools-mcp（Google 2025-09-23，✅）；Playwright MCP 事实标准（微软内部有"部分场景建议 CLI 而非 MCP"的转向讨论 ⚠️）；视觉回归社区模式成熟（baseline diff 作门禁 + diff 图喂多模态 agent 自述差异自修），**无正式"agent 验收"标准**。→ dev-screenshot + snapshot（绝不自动晋升）与最佳实践一致且更严格；"diff 图反馈回路"可写进推荐工作流文档。
4. **UI 状态检视（最强对标出现）**：Next.js v16 内建 MCP 暴露运行时内部状态 + next-devtools-mcp 发现运行中 dev server（✅ 原文逐字确认）；React 官方 DevTools 无 MCP（未查到），社区 react-devtools-mcp 项目多个（⚠️）；Nuxt 官方文档 MCP（⚠️）。→ **主张被一线框架直接验证**；Atelier 深度优势在组件级状态快照（store.graph() 依赖图）与契约联动。
5. **人机协作**：Claude Code plan mode（计划即 markdown，agent 可自行进入，✅）；审批疲劳数据（per-prompt 审批率 93-97%、plan 层拒绝率 39%，⚠️ 二手）→ **审查粒度上移是明确趋势，checkpoint 命名合并（一轮=一个回滚点）正踩在这个趋势上**；双轨（状态+源码）checkpoint 仍无业界对标。
6. **记忆与上下文**：Anthropic context engineering 正式化（2025-09-29，✅）；记忆工具生态爆发（Mem0/Zep/Letta，⚠️）；Next.js 用 codemod 生成压缩版文档索引（⚠️）。→ 可借鉴"框架级压缩文档索引"生成命令。
7. **AI slop / 质量漂移**：讨论从"AI 写得烂"演进为"agent 模仿并放大代码库坏模式"；对策三类：量化门禁（复杂度预算/API diff 限制）、证据化验收、卫生清扫（多数 ⚠️ 二手；Vercel 机制 ✅）。→ token 门禁+六层 struct check+golden DOM 对拍是业界少见的框架内建防线；**可补：公共 API diff 门禁与漂移度量指标**。

## 5. 新概念速查（对外表述可直接对齐的词汇）

| 概念 | 一句话 | 与 Atelier 的映射 |
|---|---|---|
| Agentic engineering | Karpathy 2026-02：spec 设计、diff 审查、eval 循环为工作流核心 | specs/ + review + M3 evals 就是其框架化 |
| AX（Agent Experience） | 代码库/框架对代理的"用户体验"，对标 UX | 六层结构公理 = AX 的框架级实现 |
| Context engineering | 上下文是稀缺资源，按需渐进披露 | skills 分包 ≤200 行 / AGENTS.md ≤120 行预算 |
| Spec-driven development | 规格先于代码，规格即验收 | specs/ 三段式 + 可执行 .atr.spec.ts |
| MCP Apps（SEP-1865） | MCP 官方 UI 扩展：工具返回沙箱交互 UI | D 子集白名单渲染的远亲；预留适配面 |
| A2UI / AG-UI | agent 生成 UI 的跨端声明式 spec / agent↔UI 事件协议 | UI-as-data 同族；D 子集可对齐 |
| ADLC / WebMCP | Cloudflare 2026-08：agent 时代的开发生命周期 / 让网站可被 agent 调用 | 营销语境借力；WebMCP 可监控 |
| Registry-as-API | 组件库即 API（shadcn MCP） | app.registry.json + 未来模板分发 |
| DTCG tokens | W3C 设计 token 稳定版（2025-10-28） | atelier.config.json tokens 可导出 DTCG |
| AI slop / harness engineering | agent 放大坏模式；用门禁而非 review 兜底 | token 门禁 / struct check / golden DOM |
| 双轨 checkpoint | 状态回滚 + 源码回滚 | **仍无业界对标，保持独占** |

## 6. 战略判断：机会 / 威胁 / 无人区

**机会（按投入产出排序）**
1. 标准符合性即分发：Agent Skills 格式校验 + MCP Registry 提交 + AGENTS.md 嵌套规则——三项都是小工作量，换来 40+ 客户端生态的分发通道。
2. "官方最佳实践的框架化实现"叙事：Anthropic/Vercel/Sourcegraph 的代理友好建议清单，Atelier 已逐条内建——这是现成的对外话语体系，写进 README/官网即可。
3. specs/ 可执行规格 vs Spec Kit 英文规格：SDD 赛道火热且痛点明确（spec 漂移），我们的"规格=可执行测试"是直接差异点。
4. D 子集 × UI-as-data 标准潮（MCP Apps/A2UI/AG-UI）：schema 渲染是现成地基，留适配面即可搭车。

**威胁（按紧迫度排序）**
1. 主流框架内建 agent 基建的速度：Next 16.2（2026-03）/ Angular v22（2026-06）/ Astro 7（2026-06）半年内全部落地。Atelier 必须把纵深（契约联动、组件级状态图、事务层）讲清楚，否则 agent 面被视为及格线配置。
2. Vercel"AGENTS.md 优于 skills"evals：直接挑战技能包核心竞争力定论。反驳与吸收并行：其 eval 集不可外推 + 渐进披露解决的是上下文稀缺问题；但"内联文档为底 + skills 为增强"的混合值得实验（可与 M3 加难任务层合并做受控对照）。
3. 生态真空仍在：v0/Lovable 等平台把用户锁进 Next.js/React；我们的现实采用路径仍依赖 starter+agent 代劳。

**无人区（对比全部扫描对象后仍独占的能力）**
① 扁平 schema 一份三用（契约/MCP/注册表）；② 事务状态层 + 双轨回滚（状态快照+git 源码锚，业界只有状态层外挂或对话级 rewind）；③ 六层结构公理机检开箱即用；④ 可执行意图规格（specs=.atr.spec.ts）。对外表述应聚焦这四点，其余能力（MCP/AGENTS.md/skills）定位为"与标准对齐的地板"而非卖点。

## 7. 建议清单（研究输入，立项需另行决策）

**A. 低成本跟进（工具链层）**
1. check-skills 增加 Agent Skills 标准符合性门禁（frontmatter name ≤64 kebab-case + description 语义）。
2. MCP：四段式错误映射标准 structured error/isError；工具面按 toolsets 分组+按需启用（GitHub MCP 模式）；评估向官方 Registry 提交。
3. dev 面增加 a11y 快照端点（Playwright MCP 验证了无障碍树优于视觉模型）。
4. token 层支持 DTCG 格式导出/导入。
5. 信号内核对齐 TC39 signal-polyfill 语义，留标准兼容出口。

**B. 需要实验/决策的项**
1. 技能包 vs 内联文档：设计"内联文档为底 + skills 增强"混合策略，用 M3 加难任务层做受控对照（回应 Vercel evals 反证）。
2. specs/ 吸收 EARS 记法与 constitution 概念；对外讲"可执行规格"故事。
3. 公共 API diff 门禁与漂移度量（AI slop 对策的框架化）。
4. D 子集与 MCP Apps/A2UI 的适配面预研。
5. dev 面 agent 检测 + JSON 结构化日志（Astro 7 模式借鉴）。

**C. 明确不跟进**
- A2A/AGNTCY（agent↔agent 互操作，非本层）；llms.txt 重投入（降级为生成物之一）；SSR 流式服务器（决策 4 不变）；独立 atelier-mcp 进程（决策 7 不变）。

## 8. 主要来源（合并四路，去重）

主流框架：nextjs.org/blog/next-16 · nextjs.org/blog/next-16-2-ai · nextjs.org/blog/agentic-future · react.dev/blog/2025/10/07/react-compiler-1 · github.com/vuejs/core/releases · svelte.dev/blog · solidjs.com/blog/solid-2-0-rc-the-big-reveal · blog.angular.dev（v21/v22 宣告文）· astro.build/blog/astro-7 · blog.cloudflare.com/astro-joins-cloudflare/ · github.com/tc39/proposal-signals · developers.googleblog.com（A2UI）· a2ui.org

AI×前端生态：github.blog/changelog/2026-08-04-upcoming-deprecation-of-github-spark · blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps · developers.googleblog.com/a2ui-v0-9-generative-ui · anthropic.com/engineering/writing-tools-for-agents · anthropic.com/engineering/effective-context-engineering-for-ai-agents · anthropic.com/engineering/claude-code-best-practices · openai.com/index/introducing-gpt-5-3-codex · entire.io · thenewstack.io/entire-git-for-agents · blog.cloudflare.com/agents-week-review-august-2026 · agentexperience.ax · marmelab.com/blog/2026/01/21/agent-experience.html

协议标准：blog.modelcontextprotocol.io（registry-preview / 2025-11-25 changelog / 2026-07-28-rc / mcp-joins-agentic-ai-foundation）· agents.md · agentskills.io · anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills · ppc.land/llms-txt-adoption-stalls · github.com/github/spec-kit · kiro.dev/docs/specs · martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html · linuxfoundation.org（A2A 一周年）· agentclientprotocol.com · github.com/microsoft/playwright-mcp · github.com/github/github-mcp-server · ui.shadcn.com/docs/mcp

需求侧：sourcegraph.com/blog/agentic-coding · vercel.com/blog/teaching-agents-product-design-at-vercel · vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals · shopify.engineering/under-the-river · ui.shadcn.com/docs/changelog/2025-08-cli-3-mcp · w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version · developer.chrome.com/blog/chrome-devtools-mcp · github.com/vercel/next-devtools-mcp · lucumr.pocoo.org（plan mode 分析）· letta.com/blog/letta-code · argos-ci.com/blog

> 未确认项汇总（引用时保留限定语）：Registry 精确规模、Spec Kit star 数、agentskills.io 版本字段、llms.txt 全部（二手）、审批疲劳百分比、browser-use star 数、Solid 2.0 RC 细节、Qwik 2.0 版本号、State of JS signals 数据、React 官方 DevTools MCP（未查到）、"agent 验收"正式标准（未查到）、与 Atelier 同定位竞品（未发现）。
