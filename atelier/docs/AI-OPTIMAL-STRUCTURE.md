# 六层 AI 友好结构 — Atelier 设计公理（v0.2）

> 本文是框架的结构宪法：从调研结论（`research/05`、`AI前端框架调研报告02.md`）提炼为**六层模型**，并给出每层在 Atelier 中的物理机制与 agent 端执行点。
> 核心指标不是"整洁"，而是 **agent 可推导性**：陌生代理进入仓库后，能否以最小读取量首次即正确行动，出错后能否自我修复。

## 一句话总纲

**入口回答"怎么运转"，注册表回答"现在是什么"，specs 回答"应该是什么"，技能分包回答"该怎么做"，错误码回答"坏了怎么办"，checkpoint 回答"砸了怎么退"。**

## 六层 × 机制映射

| 层 | 结论 | Atelier 物理机制 | Agent 端执行点 |
|---|---|---|---|
| **1 入口** | 显式路由表 + 权威排序 | `AGENTS.md`（init 生成）· `llms.txt` | 读入口 ≤120 行预算（`ENTRY_AGENTS_MD_BUDGET` 结构检查强制） |
| **2 知识** | 渐进披露，禁读半仓 | `skills/<kebab>/SKILL.md` 目录包（≤200 行/包）· docs 拆分规则 | skill 工具按触发词加载；`KNOW_DOC_BUDGET` 监控超长文档漂移 |
| **3 事实** | SSOT 注册表 > 零散文档 | `atelier.config.json`（token/locked/confirm）· `app.registry.json` 组件注册表 | MCP `registry.get_component` 直查契约；`FACT_MANIFEST_GHOST` 抓幽灵注册 |
| **4 意图** | 人机边界物化 | `specs/_spec-template.md` 三段式（目标/约束/验收清单），人拥有 | 工作循环第 1 步必读；验收=命令序列而非形容词 |
| **5 错误** | 失败即导航 | `{code,message,context,fix}` 四段式 · `skills/atelier-error-codes` | 代理见错→读 fix→执行（ERR_CATALOG 保证码页可达） |
| **6 时间线** | 可回退给探索胆量 | `.atelier/checkpoints.jsonl` + git 双轨（决策 15）· 应用态 store 快照 | `checkpoint.save/rollback` CLI；source_commit 门禁后续接 check+test |

## 结构规则集 STRUCTURE-RULES v0.2（机检子集）

分级哲学本身是一条结论：**健康的部分建成不得炸门禁**——
- **ERROR** = 声明与现实矛盾（信任被破坏）：幽灵组件、config 解析失败、有 AGENTS.md 却无 .gitignore → `struct check` exit 1
- **WARN** = 该层缺失于此类项目（无 specs/、无 AGENTS.md、知识层空）→ 报告不阻断
- **INFO** = 建议（llms.txt 未生成、时间线未开始、文档 >600 行拆分建议）

| 规则 id | 层 | 级别 | 含义 |
|---|---|---|---|
| ENTRY_AGENTS_MD / _BUDGET | 1 | WARN/WARN>120 行 | 入口存在且保持薄 |
| KNOW_SKILL_PACKS / DOC_BUDGET | 2 | WARN/INFO | 分包存在 / 超长文档拆分提示 |
| FACT_CONFIG_PARSE / _GHOST | 3 | ERROR | config 可解析；注册表无幽灵条目 |
| TRUST_GITIGNORE | 3 | ERROR | 请代理进门必须先拉隔离网 |
| INTENT_SPECS / _TEMPLATE | 4 | WARN/INFO | 意图目录与模板 |
| ERR_CATALOG | 5 | INFO | 错误码页可达 |
| TIMELINE_STORE | 6 | INFO | 时间线已启动 |

执行点三通道同源（单份引擎 `scripts/struct.mjs`）：CLI `node atelier/cli.mjs struct map|check` → MCP `structure.map/check`（server 本地计算，无需 dev server）。

## Agent 端优化结论（skill/MCP 执行原则）

1. **结构不是文档而是接口**：代理第一动作调 `structure.map` 而非自由探索仓库
2. **能力诚实分层**：CLI/MCP 每个命令标注 FULL / MINI / STUB 三级，STUB 永不伪造成功（exit 4）
3. **破坏性操作不做进查询面**：`snapshot.diff` 只报告 match+双路径；晋升 `--update` 是人审后的 CLI 行为
4. **一致性用机器保**：check-skills 七项门禁（frontmatter/行数/命令白名单/错误码/工具名/导入面/话术）；新增能力三处同步（CLI 表/MCP 清单/skill 文本）

## 未确认项（沿用 research/05 §3 标注）

⚠️ "文件小而多 vs 大而少"、JSX vs 类 HTML、≤200 行阈值均无受控实验数据——当前为最优假设集，M3 对照实测（首遍正确率 ≥+15pt 或 ≥60%）是把假设变定律的路径。

## 变更纪律

改本公理须同步：`STRUCTURE-RULES` 实现（struct.mjs）× `skills` 引用文本 × `ARCHITECTURE §6/§8` 清单——由 check-skills 与评审共同把守。
