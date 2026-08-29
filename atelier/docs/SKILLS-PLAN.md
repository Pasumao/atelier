# Atelier Agent Skills 包 · 计划书（v0.1 草案）

> 状态：待拍板 ｜ 依据：`research/05`（AI 友好结构十原则）、`research/06`（MCP/Skills 生态）、`AI前端框架调研报告02.md` §2（工具层）、`design-decisions.md` 决策 6/7/9/10、`docs/SKILL_DRAFT.md`（根草案）。产出物实施时间视拍板而定。

---

## 1. 目标与范围

**目标**：为 Atelier 框架生成一套 **Agent Skills 包**——SKILL.md 技能体系 + 配套模板 + 机器可校验清单，使任何 SKILL.md 兼容代理（Claude Code / Cursor / Codex 等）**首次即能正确使用框架**，且失败时能按错误码自愈。

**范围界定**（本计划做什么 / 不做什么）：

| ✅ 做 | ❌ 暂不做 |
|---|---|
| 根 SKILL.md（入口 + 路由 + DoD + 禁用清单） | MCP Server 本体（已有查询面雏形，协议化接入另立计划） |
| `skills/` 分包 8 件（渐进披露） | 代理运行时/SKILL 自动生成器（agent 生成内容质量差，v1 手写） |
| AGENTS.md / llms.txt 生成模板 | 界面契约协议（AG-UI/A2UI 适配层，P2） |
| `mcp-definitions.json`（P0 工具 flat schema，与注册表/未来 MCP Server 共用单源） | 图形化 skill 商店/分发站点 |
| `scripts/check-skills.mjs`（技能包自身的一致性校验） | 运行时 skill 热加载（dev 期不需要） |

**一句话**：先给代理一份"会呼吸的说明书"——不是文档搬运，而是「怎么用 + 常见失败 + 修法」三层，全部可机器校验。

---

## 2. 设计原则（每条带依据）

1. **渐进披露**：入口只放速查与路由；每个分包单文件 ≤ 200 行、错误词条 ≤ 80 行；禁止"一次读半仓"。
   ── `research/05` §1 维度 1（8K token 问题、curated context window）、`research/06` §2（Anthropic 渐进式披露）
2. **机器可校验 > 自然语言**：约束必须落成可执行命令/lint/type-check（`atelier check/lint/test`、`ATR-xxx` code），skill 里禁止出现不可执行的"应该""尽量"。
   ── `research/05` 原则 5/7、报告 02 §1.2（约束可机器校验）
3. **错误即指令**：每个分包以"错误读法"起始，错误码 = 成因/示例/修法三步；代理见 code 直接行动。
   ── `research/05` 原则 7、`SPEC` §3（AtrError 四段式）
4. **示例即黄金代码**：示例必须可直接复制运行（原型已验证的语法子集）；禁用虚构 API/参数。优先 literal 判别 + 显式导入，不出现魔法。
   ── `research/05` 原则 3/6、决策 1（类 HTML + 显式）
5. **零幻觉命令**：所有 CLI/工具名以 `ARCHITECTURE.md` §8 CLI 表与 §6 MCP 清单为唯一源；新增命令必须同步三处（CLI 表/MCP 清单/skill）。
   ── 一致性纪律（由 check-skills.mjs 强制）
6. **来源单一**：skill 不复制文档内容，写"怎么用 + 常见失败"；细节指向 `llms.txt`、MCP 查询面（`/__atelier/registry`）。
   ── `research/06` §2（MCP 给工具、Skills 给如何用）
7. **双通道**：每条规则同时给"代理行为"和"人审阅点"（对应 DoD 六条），避免"测试通过但 agent 仍坏了"。
   ── `research/05` §1 维度 6（快照 diff 须审阅、不得自动 accept）
8. **自含元信息**：每文件 frontmatter `name`/`description`（触发词，供按需加载路由）；内容以第一人称"你（代理）"语气，拒绝说教段。
   ── `research/06` §2（skill 命名/触发惯例）、SKILL_DRAFT 分包表

---

## 3. 产出物清单与内容规格

### 3.1 目录结构（master copies，`atelier/` —— 多工具兼容形态）

```
atelier/
├─ README.md                      # 兼容矩阵 + 安装说明（见 §3.5）
├─ skills/                        # 技能发现根：全部为 kebab-case 目录包（dsh/Anthropic 通用形态）
│  ├─ atelier/SKILL.md            # 根：入口（v0.1 草案）
│  ├─ atelier-component-model/SKILL.md    # 写/改组件（A 模板 DSL + 契约纪律）
│  ├─ atelier-streaming/SKILL.md          # 流式 UI（streamValue/optimisticList）
│  ├─ atelier-state-transactions/SKILL.md # 状态/回滚/时间旅行（store + 决策 15）
│  ├─ atelier-styling/SKILL.md            # 样式 token/布局（ATR-204 专讲）
│  ├─ atelier-testing/SKILL.md            # 验收自证（check/lint/test/snapshot/e2e）
│  ├─ atelier-mcp-tools/SKILL.md          # 内建工具面（查询/操作/审计）
│  └─ atelier-error-codes/SKILL.md        # 错误码总表（ATR-1xx/2xx/3xx/4xx 逐条）
└─ templates/
   ├─ AGENTS.md.template           # atelier init --ai 生成的 AGENTS.md
   └─ llms.txt.template            # 框架 API 全列表（决策 7）
```

> 说明：`docs/SKILL_DRAFT.md` 保留为根 SKILL.md 的内容源与历史基线（顶部已标注"已取代"）。

### 3.2 各文件内容纲目（行数上限为硬约束，超限即不合规）

| 文件（技能包） | 何时加载（触发词） | 核心内容 | 上限 |
|---|---|---|---|
| `atelier/SKILL.md` | 任何任务开始前（项目级） | frontmatter；骨架速查（组件写成什么样/原语一行表）；**工作循环**（读 specs/ → MCP 查询 → 改 .atr.ts → 自证 → diff 报告）；DoD 六条；禁用清单（硬错误级）；子技能路由表 | 70 行 |
| `atelier-component-model/SKILL.md` | 写/改组件时 | 组件文件结构（.atr.ts 模板示例=黄金代码）；props 契约纪律（纯数据 + literal 判别、禁泛型）；`$state` 作用域限定；三处常见失败（契约不满足→ATR-201、未显式导入、作用域越界） | 180 行 |
| `atelier-streaming/SKILL.md` | 流式输出/工具调用卡片时 | streamValue 用法（push/finish/依赖重渲染）；optimisticList（pending→committed/revert）；**禁手写 setInterval 打字机**；常见失败（在 effect 外读信号） | 160 行 |
| `atelier-state-transactions/SKILL.md` | 状态/回滚/时间旅行时 | store.commit 命名合并（一轮=一个 checkpoint）；rollback/timeTravel（只回状态，源码回滚走 git，见决策 15）；共享状态禁裸全局；常见失败（想回滚源码却只 rollback 了 UI） | 160 行 |
| `atelier-styling/SKILL.md` | 样式/布局/token 时 | 只允许 `var(--token)` / utility 类；`atelier.config.json` token 单源；ATR-204 修法（列出可用值）；scoped 块写法；禁硬编码色值/间距 | 140 行 |
| `atelier-testing/SKILL.md` | 跑验证时 | `atelier check/lint/test/snapshot/e2e` 各自语义；DoD 与验证命令对照表；截图 diff **必须审阅**（snapshot.review_diff），禁 `--update` 自动掩盖；常见失败（测试绿但视觉坏） | 150 行 |
| `atelier-mcp-tools/SKILL.md` | 需要查/改框架状态时 | 三面工具表（查询/操作/审计）；命令→MCP 工具对照（如 rollback 对应 checkpoint.rollback）；confirm 档（auto/ask/deny）与审计必录；工具参数 = 扁平 schema（无 $ref/oneOf） | 130 行 |
| `atelier-error-codes/SKILL.md` | 任何 ATR-xxx 出现时 | 错误码总表：每个 code 三段式（成因/示例/修法）。首批收录：ATR-1xx 编译（含 ATR-103 模板语法）、ATR-201（props 契约）、ATR-204（token）、ATR-305（派生只读）、ATR-4xx（组件未注册/MCP 权限）；每 code ≤ 12 行 | 200 行 |
| `templates/AGENTS.md.template` | 项目初始化 | 项目结构地图 + 工具链命令 + specs/ 约定 + "人锁定区"说明（决策 11） | 60 行 |
| `templates/llms.txt.template` | 框架 API 全量查询 | 组件 API/原语/CLI/错误码聚合入口（与 `/__atelier/docs` 同构） | 120 行 |

### 3.3 `mcp-definitions.json`（P0 工具定义，与注册表共用单源）

对应 `ARCHITECTURE.md` §6 与原型已实现的查询面，v0.1 首批 8 个工具（均为扁平 schema，无 $ref/oneOf）：

| 工具 | 面 | 参数（摘要） | 状态 |
|---|---|---|---|
| `registry.list_components` | 查询 | （无） | ✅ 原型已实现（HTTP 面） |
| `registry.get_component` | 查询 | name: string | ✅ |
| `tokens.list` | 查询 | group?: string | ✅（atelier.config.json） |
| `state.snapshot` | 查询 | root?: string | ✅（dev 桥状态序列化推送，P0-1 后含下行） |
| `ui.screenshot` | 查询 | format?: "png" | ✅（常驻无头实例，P0-6） |
| `checkpoint.list` / `checkpoint.rollback` | 操作 | id / name | ✅ 原型已实现（store） |
| `test.run` | 操作 | filter?: string | ✅（`pnpm test`=vitest run 同一表面，180s 上限；2026-08-29 接线） |

> 一致性纪律：skill 中提及的工具名必须在此清单或 ARCHITECTURE §6 中存在；check-skills.mjs 校验双向一致。

### 3.4 一致性校验器 `scripts/check-skills.mjs`

输出绿/红清单，检查：
1. 每个 markdown 有 `name`/`description` frontmatter；行数 ≤ 上限
2. 命令引用 ⊆ CLI 表白名单（atelier check/lint/test/snapshot/e2e/build/package/review/dev/init）
3. 错误码引用 ⊆ errors/codes.md 收录表
4. 工具名引用 ⊆ mcp-definitions.json ∪ ARCHITECTURE §6
5. 无"应该是/尽量不要"类不可执行话术（词表匹配，报告行号）
6. 示例代码块可被 `pnpm` 单测引用（黄金代码抽取 → 原型环境跑通）

### 3.5 多工具兼容（dsh 优先，硬约束）

> 记录为计划原则；详细矩阵见 `atelier/README.md`。

| 约束 | 值 | 理由 |
|---|---|---|
| 形态 | kebab-case 目录包 `<name>/SKILL.md`（无嵌套发现） | dsh 与 Anthropic Agent Skills 规范共同形态；Claude Code/Codex/Cursor 同认 |
| frontmatter | 仅 `name`（=目录名）+ `description`（≤500 字符、含触发词） | dsh 默认渲染上限 500；名称必须 `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| 调用面 | 默认模型+用户双面；单面加 `disable-model-invocation` / `user-invocable` | dsh 规范键；其他工具忽略即默认 |
| 发现目录 | dsh：`.dsh/skills`（P100）· `.agents/skills`（P200）· `customSkillDirs`（P300）· `<dshHome>/skills`（P400）· `<agentsHome>/skills`（P500）· `DSH_BUNDLED_SKILL_DIR`（P600）；Claude Code：`~/.claude/skills` + `.claude/skills` + 插件；通用：`.agents/skills` | 单一技能包多处可挂；init --ai 默认复制 `.dsh/skills/` + `.agents/skills/` |
| 模板 | 放 `templates/`（不与技能混放） | 避免被工具当 skill 候选（无 frontmatter/名称非 kebab → 快速失败） |

## 4. 生成方式与分发

- **M1 手写**：内容质量是 skill 成败关键；AI 批量生成易出"说教式长文 + 幻觉命令"（引用研究 05 未确认项：无统一 skill 生成标准）。手写 + check-skills 兜底。
- **M2 机器化**：与 MCP 查询面双源对齐；skill 更新命令 `atelier skills update`（保留本地修改 diff，复用"源码即库"）。
- **分发**：**源码即库**（技能包复制进项目技能发现目录、代理可读可改——研究铁律）：`atelier init --ai` 复制 `atelier/skills/*` 到 **`.dsh/skills/`（dsh 项目级）与 `.agents/skills/`（AGENTS.md 生态，跨工具）**，并生成 AGENTS.md/SKILL.md/llms.txt（决策 7 落地）；`@atelier/skills` npm 包仅为分发介质。

## 5. 验收标准（实证口径）

1. `node scripts/check-skills.mjs` 全绿（零违规零遗留）
2. 代理实测 3 任务组（① 新建组件卡片 ② 流式消息+工具卡片 ③ 状态回滚分支），对照"无 skill / 有 skill"：**首遍正确率提升 ≥ 15pt 或达到 SPEC §7 门槛（≥60%）**，记录返工次数
3. 人审 checklist：无说教段；示例可复制运行；无幻觉命令；错误码与实现一致；行数达标
4. 与 `SPEC` §5 DoD、`docs/SKILL_DRAFT.md` 语义零冲突（diff 审阅）

## 6. 里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M1** 技能包手写（核心价值） | 根 SKILL.md + 8 分包 + errors/codes.md + 2 模板 | 拍板 → ✅ 已交付（后升级为多工具兼容目录包形态并实证 dsh 热加载） |
| **M2** 机器化 | mcp-definitions.json + check-skills.mjs + atelier init --ai 集成演示 | M1 → ✅ 已交付（19 工具 flat-schema 单源；校验器 31 项全绿；init-ai 幂等演示通过） |
| **M2.5** MCP Server 接入 | 零依赖 stdio server（tools/list 由单源生成）+ init 自动写三家客户端配置 | M2 → ✅ 已交付（协议冒烟 7 项 + live 真数据/ATR-401/pending 三态验证通过；dsh 无 MCP client 事实已记录，插件路线待评估） |
| **M3** 实测校准 | 3 任务组对照实测 + 按数据删废话段 + 发布 v0.1 | M2 → ⏳ 待做（前置已备：dsh 运行时热发现实证通过） |

## 7. 与既有文档的关系

- `docs/SKILL_DRAFT.md` → 演变为 `skills/SKILL.md` 内容源（保留原文件，顶部标注"已取代"）
- `docs/SPEC-Agentic-DX-v0.1.md` → skill 的"正确性权威"（DoD/错误格式/工作循环，skill 只做速查与路由）
- `docs/ARCHITECTURE.md` → 命令/工具名唯一源
- `design-decisions.md` 决策 7 → 分发与生成依据（init --ai + 渐进披露分包）

## 8. 待拍板（决定 M1 开写内容）

> ✅ 已拍板（2026-08）：**语言=中英混合**（frontmatter/命令/示例英文，正文中文）；**分发=源码即库**（`atelier init --ai` 复制 `.atelier/skills/`，`@atelier/skills` 仅作分发介质）；**范围=全量 8 分包**。
> ✅ M1 状态：已交付（见 `atelier/skills/`；本计划书 §7 关联已落实）。剩余：M2（mcp-definitions.json + check-skills.mjs + init 集成）、M3（代理实测校准）。

1. **语言**：中英混合（✅ 已选）
2. **分发方式**：源码即库复制 `.atelier/skills/`（✅ 已选）
3. **首批范围**：全量 8 分包（✅ 已选）
