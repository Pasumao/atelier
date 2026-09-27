# Atelier 框架文档导航

> 框架规格文档唯一源在 `atelier/docs/`；缺口与改进队列 = `BACKLOG.md`。本文只做导航：每份一行「定位 + 状态 + 时点」。
> 推荐阅读顺序：**ARCHITECTURE**（系统是什么）→ **SPEC**（代理怎么用）→ **design-decisions**（为什么这样设计）→ **ROADMAP**（去哪里）→ **BACKLOG**（现在做什么）。

## 核心活文档（现状口径）

| 文档 | 定位 | 状态（2026-09-27 · 1.0 口径） |
|---|---|---|
| `ARCHITECTURE.md` | 系统是什么：五层 + S0 服务层、仓库布局、编译流水线、模块边界 | v0.2 · 依据决策 0-28 |
| `SPEC-Agentic-DX-v0.2.md` | 代理怎么用：硬约定 / 错误导航表 / DoD / 工作循环（组件 + 端点）/ 全站化行为契约（契约三域/端点面/数据面/struct 八层/MCP/dev·build/生成器纪律） | **v0.2 现行（2026-09-25）** · 决策 17-24 已并入；25-28（bind 族/prod 剥离/schema 提取/1.0 版本化）未并入，随下版升版收口 |
| `design-decisions.md` | 为什么这样设计：决策 0-28 逐条留档 + 未决项 | 至 2026-09-27（25-28 = bind 族/prod 批/schema 批/1.0 版本化） |
| `AI-OPTIMAL-STRUCTURE.md` | 六层 AI 友好结构公理与机检规则集（struct 的公理源） | v0.2 · struct 八层已实现（FS-6 ✅，含 server 边界层 + 数据契约层） |
| `ROADMAP.md` | 路线计划书：方向与里程碑（2026H2 → 2027H1） | v0.2 · 阶段一/二/三/3.5 全收口；**1.0.0 版本正式化完成（2026-09-27）**，npm publish = 发布日动作（D-3） |
| `BACKLOG.md` | **执行队列唯一源**：活跃队列 / 候选池 / 挂起区 / M3 波次 | F 线/FS 线全 ✅ 清零 · 1.0 达成（制作型队列三态清点归档） |
| `FS-DESIGN.md` | 全站化细化设计：决策 17-23 之下的实现级规格（端点 v2/live/迁移器/生成器/守卫/MCP 工具族/OpenAPI）+ 前沿概念穷尽评估表 + 拍板清单 D-F11+ | v0.1 · 实现级规格全部落地（FS-1~11 销账，落地注记见各 §） |
| `SKILLS-PLAN.md` | Agent Skills 包规格：八包设计原则 / 行数预算 / 校验门禁 | 已落地转规格（8 包在 `atelier/skills/`；行数预算为 `check-skills.mjs` 硬门禁规格源） |
| `RELEASE-CHECKLIST.md` | 发布检查单：npm publish 前本地可验项 + 发布日外部动作两段式 | 1.0.0（2026-09-27）· ① 段 12 道全过在档；② 段 9 项待发布日 |

## 调研证据（`research/`）

| 文档 | 定位 | 状态 |
|---|---|---|
| `research/2026-09-report1-frontend.md` | 前端框架深度调研（决策 17/23 证据） | 2026-09-19 检索口径 · 现势 |
| `research/2026-09-report2-backend.md` | 后端与数据层深度调研（决策 18/19/22 证据） | 同上 · 现势 |
| `research/2026-09-report3-fullstack-ai.md` | 全栈框架与 AI/agent 生态调研（决策 17/20/21 证据） | 同上 · 现势 |

## 已归档（文档整理时删除；git 可回溯）

| 文档 | 结论去向 |
|---|---|
| `SPEC-Agentic-DX-v0.1.md`（Agentic DX 规范 v0.1） | 已被 v0.2 取代（决策 17-24 并入；v0.1 内容 = v0.2 的前端段基线）；2026-09-27 仓库整理移出工作区，git 历史可溯 |
| `FULLSTACK-DESIGN.md`（全站化设计书 v0.2） | 决策定稿 = design-decisions 17-23；执行 = BACKLOG FS 线；不做清单已并入 ROADMAP §6（2026-09-19 整理删除，锚点 `6d25ef7`） |
| `P3-5-D-SUBSET-RESEARCH.md`（D 子集适配面预研） | 定论在 ROADMAP §5 D-4（不立项深投入，最小切口留观察）（2026-09-19 整理删除） |
| `TECH-ASSESSMENT.md`（2026-02 技术评估快照） | 定位声明活在 ROADMAP §1 与根 README；可证伪指标在 ROADMAP §7（2026-09-19 整理删除） |
| `TECH-COMPARISON.md`（逐机制技术对照） | 根源路线选择已被决策 2/3/7 吸收（2026-09-19 整理删除） |
| `TECH-SCAN-2026-08.md`（2026-08 市场扫描） | 已被 `research/2026-09-report{1,2,3}` 逐项深化取代；建议清单全部销账（2026-09-19 整理删除） |
| `research/2026-fullstack-survey.md`（v0.1 简版调研） | 已被三份 2026-09 报告逐项复核修正取代（2026-09-19 整理删除） |
| `SKILL_DRAFT.md`（根 SKILL.md 草案） | 演进为 8 分包，见 `SKILLS-PLAN.md` 演进史（git 可溯） |

## 维护纪律

- 测试用例数 / MCP 工具数是**标记位**（`<!--@num:tests|tools-->`），由 `node atelier/scripts/docs-numbers.mjs` sync/check 机检——**禁止手写**；性能数字唯一人工口径 = 仓库根 README 性能表。
- 新文档落盘时在本表加一行；文档过时时**先迁移结论、再删除归档**（git 可回溯，删除须在本文留「结论去向」）。
- 所有「未确认」结论必须明确标注，不得写成事实。
