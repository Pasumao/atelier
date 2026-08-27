# 「AI 编程代理用什么工具/技能/MCP 做前端开发」调研报告

> 调研时间：2025–2026（本轮 web_search 联网核实 16 次）
> 主题：**代理当前做前端依赖的工具/技能/MCP 全景，以及一个新框架应为代理内建什么**。
> 定位：承接 `AI前端框架调研报告.md` §4 "自描述内核/自带 MCP Server" 与 `02-agentic-dx-findings.md`，本报告聚焦**工具层与协议层**的可落地清单，非重复框架定位论述。
> 未核实项一律标 **⚠️未确认**。

---

## 0. 结论摘要（TL;DR）

1. **MCP 已是跨厂商事实标准，且工具生态极大、但极度碎片化**。官方 Registry 已随 MCP 捐赠给 Agentic AI Foundation 而成为正式目录（2025-11-25），注册服务器规模按"万里挑五"的形容约 **10,000+**（一份 2026-06 同步数据集约 **5,033** 个活跃服务器）。前端相关的高价值服务器是少数（Playwright / Chrome DevTools / Storybook / Figma / Supabase / GitHub）。
2. **Agent Skills（SKILL.md）是 MCP 之外的"技能层"正在建立，且比 MCP 更快被跨厂商接受**。Anthropic 2025-10 发布，轻量文件夹 + 渐进式披露（按需加载），已被一批"写一次到处跑"项目（agentpack、codex-skills-alternative）扩展向 Cursor/Codex/Copilot 等——**这是新框架最值得复刻的元数据形态**。
3. **前端 agent 的主循环是"截图→改码→截图对比"回环**，运行侧靠沙箱（WebContainers/E2B）。SWE 类前端基准（WebDevBench、SWE-WebDevBench、WebArena 系）量化出的**成败关键不是写代码，而是"视觉回归可感知 + 状态可回退 + 环境可复现"**。
4. **协议层仍在混战、无胜者**：AG-UI（CopilotKit）、MCP-UI、A2UI、A2A/AGP（Google）、ACP（Zed 系）、ADP（IETF）各有定位且互不兼容。**新框架不要押注单边，而应"自身实现 MCP 工具集 + 自描述 skill"，把协议参与留给社区**。
5. **对"框架内建代理层"最重要的先例是"框架自我暴露"**：Vercel MCP、Svelte AI docs（llms.txt + mcp）、Storybook MCP 都证明——**框架把组件/约定/主题以机器可查的工具暴露，是代理高效使用它的先决条件**。安全上 2025-11 MCP 规范已补 OAuth 2.1 授权与供应链警示。

---

## 1. 工具生态表（前端开发相关 MCP / 技能）

| 工具 | 类型 | 能力 | 2025–2026 成熟度 | 来源 |
|---|---|---|---|---|
| **Playwright MCP** | 浏览器自动化 | 打开页面、点击/输入/断言、截图、网络与状态检查——UI agent 的"手与眼睛" | 成熟，Web 前端测试事实标准 | [Playwright MCP 解析](https://developer.aliyun.com/article/1682978)、[skywork 概览](https://skywork.ai/blog/playwright-mcp-mcp-server-overview/#1) |
| **Chrome DevTools MCP** | 调试 | 让 coding agent 连接真实浏览器会话做性能剖析、DOM/网络/CPU 检查 | 2025 官方化，中高成熟 | [Chrome DevTools MCP 博客](https://developer.chrome.com/blog/chrome-devtools-mcp)、[性能调试](https://www.debugbear.com/blog/chrome-devtools-mcp-performance-debugging) |
| **Storybook MCP** | 组件库暴露 | 把组件清单/schema/故事以 MCP 工具暴露给 AI，代理可查询并渲染组件 | 官方维护，**"框架自描述"直接先例** | [storybookjs/mcp](https://github.com/storybookjs/mcp)、[Storybook MCP](https://devblogs.sh/posts/storybook-mcp-for-ai-aware-component-libraries) |
| **Figma MCP（Dev Mode）** | 设计稿 | 从设计稿取样式/组件/变量，**设计转代码**，把设计上下文喂给代理 | Beta→成熟化，官方推"Design Content Everywhere" | [Figma 引入 MCP Server](https://www.figma.com/fr-fr/blog/introducing-figma-mcp-server/)、[Design Context 博客](https://www.figma.com/blog/design-context-everywhere-you-build/) |
| **Supabase MCP** | 后端/数据 | 数据库 schema/迁移/表格操作、生成 schema 文档、管理贴纸等；供代理读写数据层 | 官方、中高成熟 | [supabase/mcp](https://github.com/supabase/mcp)、[generate_schema_docs PR](https://github.com/supabase/mcp/pull/278) |
| **GitHub MCP** | 版本控制 | 仓库管理、issue/PR、代码/函数读写、工作流；**写权限需 OAuth 授权** | 官方、成熟 | [github/github-mcp-server](https://github.com/github/github-mcp-server)、[OAuth 403 案例](https://github.com/github/github-mcp-server/issues/1314) |
| **filesystem MCP** | 文件 | 读/写/编辑/搜索项目文件，最基础代理工具 | 官方、稳定 | [Starter](https://modelcontextprotocol.info/blog/mcp-registry-preview/) |
| **browser-use / computer-use MCP** | GUI 自动化 | vision 驱动的浏览器/GUI 操作（截图理解+点击输入），与 Playwright 互补 | 社区→整合中 | [mcp-browser-use](https://github.com/murattasdemir/mcp-browser-use)、[PyPI browser-use-mcp-server](https://pypi.org/project/browser-use-mcp-server/) |
| **Vercel MCP / v0-dev skill** | 框架+部署 | 拉取/生成项目、部署、预览链接；v0 生成 UI 的 skill | 官方、成熟 | [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)、[AI Agents on Vercel](https://vercel.com/guides/ai-agents)、[v0-dev skill](https://lobehub.com/skills/vercel-vercel-plugin-v0-dev) |
| **Svelte AI docs / mcp** | 框架文档 | 用 `llms.txt` + MCP 暴露框架 API/组件/教程，agent 可自文档化用框架 | 官方、示范性强 | [Svelte AI MCP docs](https://svelte.dev/docs/ai/mcp/llms.txt)、[Svelte AI 总览](https://sveltefr.dev/docs/ai/mcp) |

> **MCP Registry 规模**：官方 Registry 预览 + 捐赠给 [Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)（2025-11-25）；"生态在 2026 是 10,000+ 服务器"形容见 [astanahub 2026 盘点](https://astanahub.com/ru/blog/mcp-ekosistema-v-2026-kakie-gotovye-servery-realno-stoit-podkliuchit)；活跃同步数据集约 [5,033 服务器](https://huggingface.co/datasets/RenatoMarinho/mcp-registry/blob/main/README.md)（2026-06-21）。**两者口径不同（注册 vs 活跃），不矛盾**。

---

## 2. Agent Skills 技能层现状

- **Anthropic Agent Skills（2025-10）**：一个 skill = 一个带 `SKILL.md` 的文件夹，内含指令+可选资源文件；采用**渐进式披露**（按需加载，不占上下文），与 MCP 互补——**MCP 给"工具"，Skills 给"如何用"**。来源：[Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)、[anthropics/skills agent_skills_spec.md](https://github.com/anthropics/skills/blob/c74d647e56e6daa12029b6acb11a821348ad044b/agent_skills_spec.md)。
- **跨厂商化正在进行，尚无统一硬标准**：`agentpack` 主张"写一次，分发到 Cursor/Claude Code/Codex/Copilot 等任何 SKILL.md 兼容 agent"；github.com/DKeken/codex-skills-alternative 用 17 个厂商无关 SKILL.md 复刻 Codex 插件工作流。→ **SKILL.md 正成为事实上的厂商无关格式**，但规范化引用/版本仍属社区提案。来源：[agentpack](https://github.com/superman2003/agentpack)、[codex-skills-alternative](https://github.com/DKeken/codex-skills-alternative)。
- **skill 生态目录在增长**：skillsmp、LobeHub 等已收录第三方 skills（含 v0-dev、heimdall 前端类 skill）。→ 对框架启示：**"组件/约定/范例"应做成 SKILL.md 包**，供代理按需加载。

---

## 3. 前端 agent 典型工作流与基准教训

- **主循环 = 截图→改码→截图对比**：Warp 提供把 mock/截图作为上下文喂给 agent 的官方用法；v0 的 prompting 指南、Heimdall 的组件脚手架 skill 都围绕"看视觉稿→生成→再校验"。来源：[Warp images-as-context](https://docs.warp.dev/guides/agent-workflows/using-images-as-context-with-warp/)、[v0 prompting guide](https://sureprompts.com/blog/v0-prompting-guide)、[Heimdall component skill](https://skillsmp.com/creators/kinncj/heimdall/claude-skills-component-scaffold)。
- **运行侧靠沙箱**：`bolt.new`（[StackBlitz WebContainers 浏览器内运行](https://skywork.ai/blog/what-is-bolt-new/)）、v0/Lovable（E2B 云 VM）跑生成代码。**沙箱收敛为"浏览器内 WASM / 云 VM / 端侧 WebGPU"三模，无统一标准**（承接 `04-ecosystem-findings.md` 结论）。
- **基准揭示的成败关键**（非"写代码"，而是下列能力）：
  - **视觉回归可感知**：agent 需要"改完看有没有视觉破绽"的闭环能力。
  - **状态可回退**：改坏了能回滚，是长迭代的前提（对应框架 checkpoint 支柱）。
  - **环境可复现**：确定性构建与固定 seed，让"再来一次"有意义。
  - 来源：[SWE-WebDevBench 评估发布竞品平台](https://huggingface.co/papers/2605.04637)、[GUI-Agents Paper List（WebArena 系）](https://github.com/OSU-NLP-Group/GUI-Agents-Paper-List)、[2026 browser-use agents 六类失效模式](https://futureagi.com/blog/evaluating-browser-use-agents-2026/)。

---

## 4. 协议层竞逐判断

| 协议 | 主张方/出身 | 定位 | 现状 | 来源 |
|---|---|---|---|---|
| **AG-UI** | CopilotKit | 代理↔UI 的接口契约（消息/工具/UI 事件） | 竞争初期，与 MCP-UI、A2A 并列 | [CopilotKit State of Agentic UI](https://www.copilotkit.ai/blog/the-state-of-agentic-ui-comparing-ag-ui-mcp-ui-and-a2ui-protocols) |
| **MCP-UI** | 社区 | 用 MCP 粘合 UI 交互与代理工具 | 初期 | 同上比较文 |
| **A2UI** | a2ui-project | 代理生成交互式 UI 的标准 | 初期，自有比较文档 | [a2ui agent-ui-ecosystem](https://github.com/a2ui-project/a2ui/blob/6a82313a/docs/introduction/agent-ui-ecosystem.md) |
| **A2A / AGP** | Google（a2a 扩展） | 代理间通信 + Gateway 传输封装（AGP） | 企业采纳中 | [AGP spec](https://github.com/a2aproject/a2a-samples/blob/main/extensions/agp/spec.md) |
| **ACP** | Zed / 编辑器侧 | 编辑器↔编码 agent 的标准化通信（"编码时代的 LSP"） | 有讨论，见 [cline ACP support](https://github.com/cline/cline/discussions/5994)、[ACP 解析](https://www.cnblogs.com/know-data/p/22670597) |
| **ADP** | IETF 提案 | 代理发现/元数据+交互层 | 草案阶段 | [ADP v1.1 IETF draft](https://datatracker.ietf.org/doc/html/draft-pro-adp-agent-discovery-02) |

**判断**：这些协议**分属不同层次、互不一定竞争**（ACP 管"编辑器-代理"，A2A/AGP 管"代理-代理"，AG-UI/MCP-UI/A2UI 管"代理-界面"）。界面契约层 AG-UI 有 CopilotKit 背书但仍锁死其生态，**尚无被共同采纳的标准层**。**给"框架内建代理层"的建议**：不押注任何单一协议；框架自身对外只暴露**MCP 工具集 + 自描述 SKILL.md**，把"界面契约"作为可选适配层（未来可接 AG-UI/A2UI），以换生态主动权。

---

## 5. 框架应内建的代理工具清单（推荐表，含优先级）

> 对应 §1 先例与 `主报告` §4 支柱，标注优先级（**P0=最小闭环必需 / P1=完整化 / P2=进阶**）。

| 优先级 | 内建能力 | 说明 / 形态 | 先例 |
|---|---|---|---|
| **P0** | 组件注册表查询（自描述 MCP） | 暴露"有哪些组件/用什么 props/如何用"，代理可自发现 | `Storybook MCP` |
| **P0** | 设计 token / 主题查询 | 颜色/间距/字体等以结构化 JSON + MCP 工具输出 | `Figma MCP`、Svelte 主题变量 |
| **P0** | 当前 UI 状态快照 / 截图 | 序列化组件树+状态+截图，供"截图→改码→对比"回环 | `Playwright MCP`、`v0`/`Warp` 回环 |
| **P0** | diff / checkpoint / 回滚 | 每轮改动的版本化 + 可回退（对应"可逆回放"支柱） | `GitHub MCP`、`agentharness` |
| **P0** | 测试运行器接入 | 运行/断言前端测试（单元+视觉回归），让 agent 自验收 | `Playwright MCP`、`SWE-WebDevBench` 教训 |
| **P1** | 运行时状态检查 | 暴露当前 state/响应式依赖图/渲染树，辅助调试 | `Chrome DevTools MCP` |
| **P1** | 框架文档 / 约定 AGENTS.md 生成 | 自动写 `llms.txt` + `SKILL.md` + AGENTS.md，跨代理共享 | `Svelte AI docs`、`AGENTS.md` |
| **P1** | 约束表达结构化 | 组件约束写成可 lint/type-check 的机器规则而非自然语言 | `schema-forge`（类型即契约） |
| **P2** | LLM 生成片段的安全执行沙箱 | 提供"安全渲染代理 UI 数据"而非任意代码的原语；or 隔离执行 | `WebContainers`/`E2B`、`ArrowJS` WASM |
| **P2** | 副作用审计 | 记录 agent 修改触及的文件/资源/网络，供人审阅 | `MCP OAuth`/权限模型、GitHub write 审计 |

---

## 6. 安全与权限（2025-11 新范式）

- **MCP 2025-11-25 规范新增授权**：引入 **OAuth 2.1 授权**（AI 助手/第三方可交换已授权上下文）、CIMD（合规元数据）、XAA 与资源模板；安全从传输层延伸到授权层。来源：[MCP Nov 2025 规范更新（Auth0）](https://auth0.com/blog/mcp-november-2025-specification-update/)、[MCP 2025-11-25 指南](https://raw.githubusercontent.com/giantswarm/mcp-oauth/refs/tags/v0.2.106/docs/mcp-2025-11-25.md)。
- **写权限需显式授权**：GitHub MCP 的写操作（create/update PR、写代码）依赖 OAuth token 作用域；已知问题如 [Docker MCP Toolkit OAuth 写操作 403](https://github.com/github/github-mcp-server/issues/1314)。
- **Claude Code 权限模型**：默认 **ask/allow/deny 许可制 + 目录/工具级作用域**，配合 `--dangerously-skip-permissions` 之下的最小权限原则，是"代理改代码"权限控制的代表。来源：[Claude Code permissions](https://code.claude.com/docs/fr/permissions)、[permission-model 设计解读](https://github.com/6551Team/claude-code-design-guide/blob/main/part8/22-permission-model.md)。
- **供应链风险**：MCP 服务器被投毒/可疑服务器已列为企业级风险，强调**registry 未经审查的服务器**、skill 注入、动态客户端（browser-use）偏好劫持等威胁。来源：[MCP Server Security: Enterprise Guide](https://safeguard.sh/resources/blog/securing-mcp-servers-and-agent-skills-in-the-enterprise)、[MCP Registry 未审查服务器风险](https://safeguard.sh/resources/blog/securing-mcp-server-registries-risks-of-unvetted-ai-tool-servers)。

---

## 7. 未确认项标注

- **⚠️未确认**：AG-UI / MCP-UI / A2UI 三者中是否有任一在 2026 被官方/多厂商采纳（无明确公开证据）；ACP 是否成为 Zed 之外（如 Codex 官方）的主流编辑器协议。
- **⚠️未确认**：Agent Skills 是否已有**跨厂商统一、带版本号**的规范（目前"去厂商化"仍靠 agentpack/codex-skills-alternative 等社区拼装，无官方背书）。
- **⚠️未确认**：MCP Registry 的确切服务器总数（注册 10,000+ 与活跃同步 5,033 两个口径并存，且随 AI Foundation 治理而动态变化）。
- **⚠️未确认**：Figma MCP 的"设计转代码"在真实工作流中的**端到端质量**（Beta→正式，可能仍以设计上下文为主、而非全自动生成）。
- **⚠️未确认**：是否有任何框架已实现"LLM 生成片段的安全执行沙箱"作为**框架级默认原语**（目前多是平台级如 WebContainers/E2B，非框架内建）。
- **⚠️未确认**：SWE 类前端基准（WebDevBench、SWE-WebDevBench、WebArena 系）的**统一/tab 外权威排名**——各基准口径差异大，无法据此给出"代理前端能力排名"。

---

> 相关既有素材：`research/02-agentic-dx-findings.md`（Agentic DX/找发现瓶颈）、`research/04-ecosystem-findings.md`（生态/协议层）、`AI前端框架调研报告.md` §4（自描述内核/自带 MCP）。本报告聚焦**工具/技能/协议/安全**，与前作互补不重叠。
