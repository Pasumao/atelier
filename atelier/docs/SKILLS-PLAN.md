# Atelier Agent Skills 包 · 规格书（原计划书 v0.1，已落地转规格）

> 状态：**已落地**（8 包在 `skills/`；`check-skills.mjs` 按 §2 行数预算与 §3 目录清单做硬门禁，
> 行数预算同时硬编码于该脚本——改预算两处同步）。
> 演进史：根 SKILL.md 草案 → 8 分包计划 → 多工具兼容目录包（dsh/Anthropic 通用形态）→
> Agent Skills 标准（agentskills.io）门禁（P2-2①）。被取代的 `docs/SKILL_DRAFT.md` 已删（git 可溯）。
> 实测校准（原 M3 里程碑）→ 由 `benchmarks/m3/`（protocol + RUNBOOK）承接。

## 1. 设计原则（八条，示例与禁令的出处）

1. **渐进披露**：入口只放速查与路由；分包单文件 ≤200 行、错误词条 ≤80 行。
2. **机器可校验 > 自然语言**：约束必须落成可执行命令/lint/type-check；禁"应该/尽量"话术（校验器词表匹配）。
3. **错误即指令**：错误码 = 成因/示例/修法三步，代理见 code 直接行动。
4. **示例即黄金代码**：可直接复制运行；禁虚构 API/参数。
5. **零幻觉命令**：CLI/工具名以 ARCHITECTURE §8 与 mcp-definitions.json 为唯一源，新增同步三处。
6. **来源单一**：skill 写"怎么用 + 常见失败"，细节指向 llms.txt 与 MCP 查询面。
7. **双通道**：每条规则同时给"代理行为"与"人审阅点"（快照 diff 必须人审，禁自动 accept）。
8. **自含元信息**：frontmatter `name`/`description` 触发词路由；第一人称语气，拒绝说教。

## 2. 行数预算（硬约束；`check-skills.mjs` B 检查强制）

| 文件（技能包） | 何时加载 | 上限 |
|---|---|---|
| `atelier/SKILL.md` | 任何任务开始前 | 70 |
| `atelier-component-model/SKILL.md` | 写/改组件 | 180 |
| `atelier-streaming/SKILL.md` | 流式输出/工具卡片 | 160 |
| `atelier-state-transactions/SKILL.md` | 状态/回滚/时间旅行 | 160 |
| `atelier-styling/SKILL.md` | 样式/token | 140 |
| `atelier-testing/SKILL.md` | 跑验证 | 150 |
| `atelier-mcp-tools/SKILL.md` | 查/改框架状态 | 130 |
| `atelier-error-codes/SKILL.md` | ATR-xxx 出现 | 200 |
| `templates/AGENTS.md.template` / `llms.txt.template` | init 生成 | 60 / 120 |

## 3. 包结构与形态约束

- 目录 = kebab-case 技能发现根 `atelier/skills/<name>/SKILL.md`（无嵌套发现）；
  校验器只认 §2 表声明的目录，新增包 = 先扩 §2 再建目录。
- frontmatter：仅 `name`（=目录名）+ `description`（20–500 字符含触发词）；Agent Skills 标准字段
  白名单 `{name, description, license, allowed-tools, metadata}`，未知字段拒绝（name ≤64 / desc ≤1024）。
- 模板放 `templates/`（不与技能混放，防误当 skill 候选）。
- 发现目录（安装落点）：`.dsh/skills/` + `.agents/skills/` 双落点（`atelier skills install` 幂等）。

## 4. 一致性校验器（`scripts/check-skills.mjs`，exit code 可接 CI）

A frontmatter/命名 · B 行数预算 · C 命令引用 ⊆ CLI 表 · D 错误码 ⊆ 收录表 ·
E 工具名 ⊆ mcp-definitions.json · S Agent Skills 标准符合性 · 话术黑名单 · 示例黄金代码可抽取。

## 5. 与既有文档的关系

- `docs/SPEC-Agentic-DX-v0.1.md` → skill 的"正确性权威"（DoD/错误格式/工作循环）
- `docs/ARCHITECTURE.md` §8 → 命令/工具名唯一源；`design-decisions.md` 决策 7 → 分发依据（源码即库）
- 实测对照（首遍正确率）→ `benchmarks/m3/`（RUNBOOK 逐臂操作卡）
