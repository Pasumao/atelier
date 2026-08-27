# 08 —— "人只写意图、机器写代码、人验收"的高效可靠工作流调研

> 调研时间：2025–2026（联网核实，12 轮 web_search）
> 调研目的：为"全新前端框架完全由 AI 编程代理操作、人类完全不干预框架内部代码"设定**人在环外的验收回路**与**代理自主运行的边界**。
> 前置背景：`AI前端框架调研报告.md`（七大支柱，尤以 #3 可逆回放、#5 三态模型、#7 人机控制权模型为立足点）与 `research/02-agentic-dx-findings.md`（Agentic DX 方法论）。
> 未核实到确定事实者，已标 **未确认**。

---

## 0. 结论摘要（TL;DR）

**"人在环外"的实操形态，业界已从"凭 prompt 祈祷"收敛为一套可组合的工程实践**，但**没有单一产品把它内建成完整的"意图规格 → 代理生成 → 自动验收 → 人只拍板"闭环**。当前最强的部分是：**意图规格化（Spec-Driven Development，SDD）+ 预览部署（preview deploy）+ 自动验收（视觉回归 / E2E / lint 三重夹逼）**；最弱、也最值得框架补位的是：**"意图即验收"的可执行断言生成、无人值守的漂移/成本兜底、以及把代理改动当作"可评论的 diff"的协作层**。

一句话判断：**人类应该做"意图定义 + 结果验收 + 边界设定 + 纠偏反馈"四件事；机器做"计划实现 + 自我验证 + 状态可逆 + 沙箱执行 + 报告产出"。边界画在"结果层"而非"逐编辑层"——人对最终产物的判断远准于人坐在每一条 diff 前，但高风险/首次生成/涉密钥部署时要临时下沉到更细的批准粒度。**

| 关键结论 | 依据 |
|---|---|
| 意图规格化是当前最成熟环节，SDD 已是主流 | Jira agentic-engineering 明确 SDD；Cursor/Codex spec 模式；Replit/ChatPRD "spec→app" |
| "意图即验收"需求真实，但**可执行验收断言由 agent 自动生成**尚无成熟产品落地 | Gherkin/BDD 多为 skill 模板，"产品化自动验收脚本生成"仍是空白 |
| 预览部署 + 自动验收是事实标准的验收闭环 | Vercel/Netlify preview、GitHub Actions 对 preview 跑 Playwright、Argos 视觉回归 |
| 信任心理学印证：人要"看得见、可比较、像真的"才敢信 | 视觉回归对比、预览、文本呈现方式显著影响对 AI 产物的信任 |
| 可逆性/会话恢复/分支是自治的底层前提 | Claude Code sessions、Azure fork-based sessions、LangGraph checkpoint |
| 验收粒度取决策略：**产物验收为主，嵌套过细则负担爆炸** | Cursor auto-review vs YOLO、Codex granular approval |

---

## 1. 模式表（模式 / 现状 / 代表产品 / 来源）

### 1.1 意图表达形态

| 模式 | 现状 | 代表产品 / 机制 | 来源 |
|---|---|---|---|
| Spec-Driven Development (SDD) | 成熟，已成主流方法论 | Jira agentic-engineering、Cursor `/specify /plan /tasks`、Replit "plan first then code"、ChatPRD | https://www.atlassian.com/zh/software/jira/guides/agentic-engineering/spec-driven-development-jira 、https://github.com/madebyaris/spec-kit-command-cursor 、https://replit.discourse.group/t/a-better-way-to-work-with-agent-plan-first-then-code/6413/6
| 一页式意图规格 → 分派 | 社区多套编码模板，规模差异大 | spec-kit / specky（13 agents + 58 MCP tools + 10-phase pipeline，transcript→PR）、gmoncor/agentic-engineering-framework、SpecRoute | https://github.com/paulasilvatech/specky 、https://github.com/WojcikMM/spec-development-protocol 、https://github.com/gmoncor/agentic-engineering-framework |
| 意图即验收（Gherkin/BDD） | 多存在于 agent skill 模板，**产品级"可执行验收脚本自动生成"未确认** | gherkin-expert skill、acceptance-criteria-generator、TDD/BDD 建议 | https://raw.githubusercontent.com/rysweet/amplihack/main/docs/claude/skills/gherkin-expert/SKILL.md 、https://skill4agent.com/en/skill/gustavogutierrez-engineering-skills/acceptance-criteria-generator |
| 计划/行动双模式（plan/act） | 头部 IDE 标配 | Claude Code plan vs build/act、Cursor spec/auto-review、Lovable plan mode + build mode | https://code.claude.com/docs/en/permission-modes 、https://github.com/cporter202/lovable-for-beginners/blob/main/module-03-understanding-lovable-modes.md |
| 一句 prompt → 预览迭代 | 商业化最顺、增长最快 | Lovable / bolt.new / v0.dev | https://tms-outsource.com/blog/posts/v0-vibe-coding/ 、https://ai.elevationcapital.com/blogs/vibe-coding-lovable |

### 1.2 验收与信任机制

| 模式 | 现状 | 代表产品 / 机制 | 来源 |
|---|---|---|---|
| 预览部署 = 人看真实成品 | 事实层标准，即"信任入口" | Vercel/Netlify preview branches、每个 PR 一个环境 | https://github.com/vercel/community/discussions/1609 |
| 自动验收（E2E/视觉回归） | 成熟且已与预览联动 | GitHub Actions e2e-on-preview.yml（Playwright 打 Vercel preview）、Argos CI 截图对比 | https://github.com/Autonoma-Tools/shift-left-testing-for-small-engineering-teams/blob/main/.github/workflows/e2e-on-preview.yml 、https://argos-ci.com/docs |
| AI 生成 UI 的视觉回归 | 专门方法论已出现 | Augment Code "Visual Regression Testing in the Age of AI UIs"、production-ready validation | https://www.augmentcode.com/guides/visual-regression-testing-ai-generated-uis 、https://github.com/martparve/production-ready/blob/main/chapters/11-validation.md |
| 信任心理学 | 实证研究：**呈现方式 / 逼真度 / 可对比**决定信任 | "Thoughtful, Confused, or Untrustworthy"（文本呈现）、UX Designer's Trust in AI Design、越像真的越少被当 AI | https://arxiv.org/abs/2504.20365 、http://hh.diva-portal.org/smash/record.jsf?pid=diva2:1968229 、https://empirical-software.engineering/blog/trust-in-ai-assistants |
| 组件级预览/自描述 | 强化"可阅性"，间接信誉 | Storybook MCP + Storybook Visual Tests | https://storybook.js.org/docs/ai/mcp/overview 、https://storybook.js.org/blog/storybook-mcp-for-react/ |

### 1.3 代理自主运行的可靠性机制

| 模式 | 现状 | 代表产品 / 机制 | 来源 |
|---|---|---|---|
| 会话级 checkpoint / 恢复 | 成熟，是自治的底层 | Claude Code agent SDK sessions、Azure forked-based sessions + conversation resumption、LangGraph checkpoint | https://code.claude.com/docs/en/agent-sdk/sessions 、https://learn.microsoft.com/en-us/training/modules/aaai-design-agentic-loops-azure-ai-agent-service/6-implement-fork-based-sessions 、https://pypi.org/project/langgraph-checkpoint-aws/1.0.0/ |
| per-task 分支 / fork 会话 | 成熟，配 SDD 正好 | fork-based sessions、SDD 的 per-task 分支 | https://github.com/WojcikMM/spec-development-protocol |
| 长任务 / 后台 / solo 模式 | Devin 云端 24h、Claude Code 后台子代理；"sleep/wake"语义**多靠会话恢复模拟** | Devin framework（cloud 24h）、Claude Code sub-agents、Continuous-Claude-v3（ledgers/handoffs） | https://www.agentpatternscatalog.org/compositions/devin/ 、https://code.claude.com/docs/en/sub-agents 、https://github.com/namesreallyblank/Continuous-Claude-v3 |
| 上下文/状态漂移检测（antidrift） | 新兴，直接回应"坏了怎么发现" | ironclaw anti-drift self-checks、state-integrity-protocol（State Decay 度量） | https://github.com/nearai/ironclaw/issues/1634 、https://github.com/sijan324/state-integrity-protocol |

### 1.4 沙箱与权限边界

| 模式 | 现状 | 代表产品 / 机制 | 来源 |
|---|---|---|---|
| 权限分层 + deny list | 头部 CLI 标配 | Claude Code permissions / sandbox .json / permission modes、Codex CLI granular approval + auto-review | https://code.claude.com/docs/en/permissions 、https://code.claude.com/docs/en/sandboxing 、https://github.com/openai/codex/issues/13062 、https://codex.danielvaughan.com/2026/05/07/codex-cli-granular-approval-policies-auto-review-subagent-autonomous-secure-workflows/ |
| 写文件 vs 执行 shell 分权 | 关键安全缺口：脚本改文件可绕过逐条 diff | Codex "separate approval policy for file edits vs shell commands"、Claude Code manual permission mode 绕过提示 | https://github.com/openai/codex/issues/13062 、https://github.com/anthropics/claude-code/issues/85511 |
| 隔离执行环境（生成产物不污染运行时） | 成熟 tooling | agent-sandbox-skill、E2B 沙箱模板、WebContainers（浏览器内 WASM） | https://github.com/disler/agent-sandbox-skill 、https://gdplabs.gitbook.io/sdk/common-modules/guides/build-template-and-sandbox-e2b.md |

### 1.5 人类监督模式

| 模式 | 现状 | 代表产品 / 机制 | 来源 |
|---|---|---|---|
| 批准粒度谱系 | 关键设计取舍：per-edit 太重、结果/无人值守太险 | 谱系 = per-edit → plan 门 → 结果验收 → auto/YOLO；Cursor "auto-review vs YOLO 中间安全档"、Claude permission modes、Codex granular | https://dev.to/dzhuneyt/cursor-auto-review-vs-yolo-picking-the-middle-safety-tier-1d2b 、https://code.claude.com/docs/en/permission-modes |
| RLHF 式点踩反馈 | 已从"聊天反馈"进化为"硬规则门" | ThumbGate（thumbs up/down → 硬性执行规则）、rlhf-feedback-loop、AI Feedback Loops | https://lobehub.com/skills/igorganapolsky-thumbgate 、https://www.npmjs.com/package/rlhf-feedback-loop 、https://claudskills.com/skills/ai-feedback-loops/ |
| "修改即对话"（diff 可评论） | 降低监督成本的有效范式 | Diffsmith（comment on agent's code）、superset inline comments in diff view 给 agent 发指令 | https://www.producthunt.com/products/diffsmith-code-review-studio 、https://github.com/superset-sh/superset/issues/2835 |
| 自治 vs 审查边界 | 团队仍在探索该画在哪 | 社区问答、leaddev 事故增速讨论 | https://moltq.chat/zh/questions/d43b349c-3190-4cfc-bc6f-9e6c7ea56993 、https://leaddev.com/ai/ai-coding-made-us-faster-why-did-incidents-increase |

### 1.6 失败兜底

| 模式 | 现状 | 代表产品 / 机制 | 来源 |
|---|---|---|---|
| 事故/回归显式化 | 已观察到"变快但事故增" | leaddev 分析、harness experimentation | https://leaddev.com/ai/ai-coding-made-us-faster-why-did-incidents-increase 、https://www.harness.io/resources/experimentation-your-secret-weapon |
| 漂移 / 成本失控兜底 | 多为 agent 自检与使用侧计费，**框架级自动降级未确认** | ironclaw anti-drift、Devin usage/billing（context 成本）、上下文窗口成本 | https://github.com/nearai/ironclaw/issues/1634 、https://docs.devin.ai/admin/billing/usage |
| 结果质量是可预测的信任信号 | 实证：**生成质量分越高越可能被接受** | ACM 研究（acceptance + model quality score） | https://dl.acm.org/doi/pdf/10.1145/3664646 |

---

## 2. 人机边界图（推荐边界）

```
 ┌──────────────────────────── 人类（意图 + 验收 + 边界） ───────────────────────────┐
 │ ① 描述意图   自然语言 / spec / PRD / issue / 验收清单（Gherkin·given-when-then）         │
 │ ② 定义"done" 写成可执行断言（结构/交互/视觉基线）+ 不可变锁定区（stable-ID）            │
 │ ③ 验收拍板   看预览 + diff 报告 + 断言报告 → 批准 / 驳回 / 点踩                          │
 │ ④ 纠偏反馈   在 diff 上评论、给点踩；沉淀为硬规则                                        │
 └────────────────────────────┬────────────────────────────────────────────────┘
                            │ 意图规格（机器可读、单源）
 ┌────────────────────────────▼────────────── 机器（实现 + 自治 + 自证） ──────────────┐
 │ ⑤ 计划→实现 从 spec 生成 plan → code，遵守锁定区                                       │
 │ ⑥ 自我验证  lint / 类型 / 单测 / E2E / 截图断言，失败自修（不无限自旋）                    │
 │ ⑦ 可逆      每次改动 checkpoint + commit/rollback + per-task 分支，会话级可恢复          │
 │ ⑧ 沙箱执行  产物在隔离环境（preview/demo）跑，不污染真实运行时                            │
 │ ⑨ 报告产出  diff 报告（人类可读）+ 预览 + 断言结果 + 行为日志/审计                          │
 │ ⑩ 阈值自治  在权限 + 预算 + 漂移监测内无人值守；命中阈值 → 自动停下请求人                    │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

**边界核心三原则**
1. **验收落在"结果层"而非"逐编辑层"**：人看最终预览 + 断言报告，一次拍板；只在高风险（首次生成、涉密钥/部署、跨锁定区）临时下沉到 plan 门或 per-edit。
2. **控制权要"写死"而非"靠 prompt 祈祷"**：人类锁定区用 stable-ID 显式声明，机器只改解锁区；约束写成可校验机器规则（lint/类型/测试夹逼），而非自然语言说明。
3. **自治必须"可逆 + 可停 + 可回放"**：无 checkpoint 就无人值守；机器命中"漂移/成本/断言失败"阈值时必须停下来等人，不得静默降级或无限重试。

---

## 3. 框架该内建清单（按优先级）

| 优先级 | 内建项 | 对应解决的问题 | 先例 |
|---|---|---|---|
| **P0** | 意图规格文件模板 + **可执行验收断言生成器**（Gherkin/结构断言） | "意图即验收"的产品级落地 | SDD、gherkin skill、Jira SDD |
| **P0** | **一键预览 / 演示环境**（沙箱隔离、安全渲染代理生成 UI） | 人的信任入口 + 运行时兜底 | Vercel/Netlify preview、E2B/WebContainers |
| **P0** | 可逆性：checkpoint + commit/rollback + 会话级状态恢复 | 无人值守的前提，"改坏能回退" | Claude sessions、fork-based sessions、LangGraph checkpoint |
| **P0** | 人类可读的 **diff 报告 + 一键回滚按钮** | 人快速验收、快速反悔 | Diffsmith、superset diff 评论、版本化 UI 状态 |
| **P1** | 自动验收 CI（视觉回归 + E2E，对 preview 跑） | 把"验收"交回机器证明 | Argos、e2e-on-preview.yml、Storybook Visual Tests |
| **P1** | 权限模型（deny list + sandbox 配置；**写文件 vs 执行 shell 分权**） | 沙箱与权限边界 | Claude permissions、Codex granular approval |
| **P1** | 运行状态仪表盘 + agent 行为日志/审计（可回放） | 监督可见性、漂移追因 | agentharness、state-integrity-protocol |
| **P2** | stable-ID 锁定区（人机控制权显式化） | "哪些人锁、哪些机器可改" | morph、本项目支柱 #7 |
| **P2** | RLHF 式点踩反馈循环（沉淀为硬规则） | 纠偏闭环 | ThumbGate、rlhf-feedback-loop |
| **P2** | 漂移/预算监测 + 命中即自动请求人 + 降级 | 长期无监督兜底 | ironclaw anti-drift、Devin usage |

**对现有项目支柱的增量贡献**：本调研把支柱 #3（可逆回放）、#5（三态模型）、#7（人机控制权）从"框架内部机制"**上升为面向人的产品功能**——即**可回滚按钮、可视化 diff、一键预览**这些人类可感知的验收界面，而非仅供代理调用的内部 API。

---

## 4. 未确认项

- **产品级"意图规格 → 自动生成可执行验收脚本"**：Gherkin/BDD 多停留在 agent skill 模板，未确认有头部产品（Lovable/v0/bolt/Cursor）把它内建为"验收即规格"的端到端闭环。
- **"agent sleep/wake"长任务语义**：Devin 靠云端 24h，Claude Code 靠会话恢复/后台子代理模拟；未确认有统一的一等"休眠/唤醒"原语。
- **框架级自动降级（漂移/成本命中即停）**：多为 agent 自检或使用侧计费，未确认有产品把"无人值守自动请求人"做成框架层机制。
- **无人值守模式在生产的采用率 / 实证收益**：未见权威大规模量化研究；leaddev 事故增速仅为趋势观察。
- **批准粒度（产物 vs 逐编辑）的最优解**：社区观点分歧（Cursor 中间档 vs Codex 细化），未确认统一结论。
