# M3-FS 全栈三臂对照实验协议（FS-10 · 设计先行稿 v0.1）

> 状态：**执行半已武装（2026-09-20 集成批）**——本协议与 [tasks/](tasks/)、[RUNBOOK.md](RUNBOOK.md)
> 的设计先行半交付件 + 执行半交付件（基线装配脚本×2、grade 评分器×2 + S/R/C/T 场景 harness×2、
> atelier 臂正控参考解×3〔交叉认证 9/9+9/9+16/16〕、负控 fixtures×7〔negative-check 7/7 全红〕、
> report.mjs、对照臂转译件×3）均已落地；出数仍须先过 RUNBOOK §5 前置门 + §4.4 样本量口径。
> 拍板记录：D-F21 对照臂 = Next.js（按 §1.1 建议采纳，集成批落地；若 pilot 实证映射不成立，
> 换臂 = 修订本协议留痕）；D-F22 判据阈值（相对 ≥+15pt 为主 + 绝对 ≥60% 副之）与 D-F23
> （rubric 降诊断件）按建议采纳；D-F24 task3 v1 不叠加 gen auth（观察位保留，见 tasks/task3 尾注）。
> 结构母本 = [../m3/protocol.md](../m3/protocol.md)
> （三臂协议结构照抄，任务域全栈化）；规格出处 = `atelier/docs/FS-DESIGN.md` §14.3。
> 立项最大假设（FS-10 专属，继承 m3 假设并全栈化）：**「契约单源 + 机器门禁 + 技能包能把
> 跨端三处改动的首遍正确率抬到可区分于主流全栈栈的水平」**——本实验台把它变成可测量命题。
> 诚实边界（照抄 m3 并扩两条）：①三臂的 agent 运行由人或独立 AI 会话按本协议逐臂执行，
> 本仓库无法在会话内部可信地模拟"无技能代理"；②全栈任务含运行时行为判据（SSE/HTTP/DB 态），
> 其评分 harness 与 m3 的 dom-shim 挂载式 harness 不是同一件东西——已随执行半实现
> （`grade.mjs` S/T 直跑 + `harness/acceptance.spec.ts` R=真实 server SSE 黑盒 × C=dom-shim
> 对账；场景规格单一文档 = `harness/scenario-spec.md`，三臂语义同文）。

---

## 0. 与 m3 三臂的关系

**复用（纪律与组织，照抄不改）**：

- RUNBOOK 纪律：每臂每 run 全新独立会话、prompt = brief 原文零追加、污染即废弃、串行单发
  （Wave-7 的"授权 3 路并发"偏差须重新授权，不得默认沿用）；
- harness 组织：`grade.mjs`（CLI 入口，exit 0/1）→ vitest spec（env 注入 task/attempt）→
  落 `m3fs-grade.json` 进 attempt 目录（工件可回溯）；`reference/` 正控参考解 + 负控 fixtures
  前置门（正控六绿只证明"对的能给过"，负控才证明"错的抓得住"——m3 RUNBOOK §5 原口径）；
- 评分独立性：评分者/盲评者 ≠ 实验编排者 ≠ 任务书作者 ≠ 参考解作者（四角分离，见 §4.3）；
- 入账：`runs.json` 只追加不改写；attempt 目录布局 `<scratch>/m3fs/<arm>.<task>.r<run>/`；
- 样本量措辞：**一切正确率引用必带 "FORMAL n=5/cell、Wilson 区间宽于判据间距" 限定语**（§4.4）。

**更换（任务域升级的必然）**：

| 项 | m3 | M3-FS |
|---|---|---|
| 对照臂 | `react`（Vite React-TS 纯客户端——无服务面，考不了全栈） | 主流**全栈**框架对照臂（§1.1 对表选定，〔议：待拍板〕） |
| 任务域 | 前端单机制组件任务 | 跨端三处改动 + 迁移 + live 对账（§3） |
| 应用基线 | init 产物直接考 | 预接线全栈基线（§2——"改"必须发生在已有链路上才考得到增量迁移与影响面） |
| 评分对称性 | atelier 两臂机械评分、react 臂 rubric 主观评分（不对称是已知偏置源） | **判据语义三臂全同的机械评分**，rubric 降级为诊断件（§4.2，〔议〕） |
| 判据 | 绝对 ≥60% 或相对 ≥+15pt 任一 | 相对口径为主判据（Wave-7 天花板教训，§6，〔议：阈值待拍板〕） |

---

## 1. 臂（arms）

| 臂 | 设置 | 评分方式 |
|---|---|---|
| `noskill` | Atelier 全栈基线应用（§2）；**零技能可见性**（不装 skills、不落 AGENTS.md/llms.txt/specs/，会话不得有本仓技能可见性） | 全机械（§4.2 判据表） |
| `skill` | 同上 + `atelier skills install`（8 包全装 + AGENTS.md/llms.txt + specs 骨架 + MCP 客户端配置，init-ai 默认产物） | **同一评分器**（与 noskill 逐字节同判据） |
| `next`（〔议：臂选择待拍板〕） | Next.js 等价基线（App Router + Server Actions + Drizzle/SQLite，§2）；含其官方 agent 脚手架（彼时版本的 AGENTS.md/文档随包产物，如实记录版本） | 判据语义全同、判据实现分臂（§4.2 明写的不对称） |

### 1.1 对照臂对表论证：Next.js vs SvelteKit（remote functions）

FS-DESIGN §14.3 留的两个候选，按四维对表（依据：`atelier/docs/FS-DESIGN.md` §16.2/§10.1、
决策 21-④"对外可比"意图）：

| 维度 | Next.js（App Router + Server Actions） | SvelteKit（remote functions） |
|---|---|---|
| **任务可映射性**（三处改动 + 迁移 + live 对账的等价物） | 契约 = zod schema；端点 = Server Action / Route Handler；前端调用 = client component；迁移 = Drizzle Kit 生成 + up/down 可逆，全部 1:1 映射；**live 对账无内建原语**——SSE Route Handler + useOptimistic + revalidate 由 agent 从生态件手工装配 | query/command/query.live() 与 Atelier 三件几乎同构（FS-DESIGN §16.2 已对表）；迁移仍需外挂 Drizzle；乐观失效大半内建（command → invalidate）——映射最贴，但**考点被框架内建消解的风险最高** |
| **语料量 / 训练截止覆盖** | 最大：App Router / Server Actions / useOptimistic 语料海量且全部早于主流模型训练截止 | 总量大，但 remote functions 是 2026 新面（本仓调研口径：query.live() 2026-06 才有，§16.2）——截止覆盖最薄，臂间差异会被"语料缺失"系统性混淆 |
| **评分公平性**（机械判据在对臂怎么落） | 行为判据全同（HTTP/SSE/DB 态黑盒脚本）；客户端对账层用 jsdom + testing-library（语料厚、实现路径成熟） | 判据落点同；但其 live/对账行为大半是框架内建——"做出来了"证明的是框架会话知识，不是 agent 在无内建协议面的自救能力，比较叙事变弱 |
| **agent 工具链生态** | 官方 `/_next/mcp` 8 工具 + AGENTS.md 脚手架 + 文档随包——正是本仓可观测性对表的**超集基线本身**（FS-DESIGN §10.1/§16.1） | 无同级官方 agent 工具链；对照偏弱则"赢了"证明力虚（Wave-7 三臂全平的前车：对照臂必须足够强） |

**建议：选 Next.js 为对照臂。**核心理由三句：①主考点（live 对账协议）在 Next 上必须由 agent
手工装配，恰好检验"Atelier 给协议 vs 主流给零件"这一核心命题；②其语料量与官方 agent 工具链
都是最强对照，赢在这样的对手才算数（对外可比性是决策 21-④ 的本意）；③SvelteKit 结构同构
但语料截止薄、内建消解考点，**留作候补**——若 pilot 波（§3.3）实证三处改动在 Next 上映射
不成立（如迁移面无法等价），换臂 = 修订本协议并留痕，不是悄悄换。

〔议：臂选择待拍板〕——拍板前本协议的所有臂名 `next` 均读作"对照臂占位符"。

---

## 2. 应用基线（与 m3 最大的 setup 差异）

m3 从 init 产物直接考**新**组件；M3-FS 的任务本质是**改**（增量迁移、契约传播、调用点跟进），
"改"必须发生在已有全栈链路上才考得到纪律面。故两 atelier 臂的 attempt 骨架 = init 产物 +
**预接线基线**（由 setup 脚本一次装配；脚本属执行半实现件，**未武装**）：

- `src/contract.ts`：`noteSchema` 契约常量（扁平 schema 单源，`gen/gen-endpoint.mjs` 扫描口径）；
- `src/server/db/schema.ts`：`notes` 表（`id` integer PK / `body` text notNull / `createdAt`
  integer notNull，形态照 `server/db.ts` 的 `table()` 键位）；
- `001_create_notes.up/.down.sql` 迁移对已应用（`migrate up` 已跑）+ 种子已入（`migrate seed`）；
- `src/server/endpoints/notes.ts`：`notes.list`（query）/ `notes.create`（command）两个端点；
- `src/generated/api.ts` 已生成（gen endpoint 产物）；
- `src/components/NotesPage.atr.ts` 消费列表（三元共置的最小版）；
- `.atelier/api-surface.json` 已落 snapshot（api-diff 门禁武装）。

`next` 臂等价基线：Next.js + Drizzle `notes` 表（同构列）+ notes list/create（Server Action）
+ 最小惯用客户端列表——**最小惯用形态**，不许夹带任何"帮忙/坑人"的偏置件；基线脚本两臂各自
评审冻结后逐字节复现，基线差异本身列入有效威胁清单（fairness 纪律：基线不对等 = 数据作废）。

---

## 3. 任务设计原则（FS-DESIGN §14.3 照抄并细化）

### 3.1 硬性构成（每任务全部满足，缺一即设计不合格）

1. **跨端三处改动**：数据/端点契约（单源）→ 端点定义 → 前端调用/模板——三处必须同任务内
   全部发生且相互一致（影响面链条是考点本身）；
2. **至少一次迁移**：含 up/down 成对与可逆性（`migrate verify` 干跑口径）；
3. **至少一次 live 对账**：§4.5 乐观对账协议（optimisticList 五步，含 revert 路径）即考点——
   "live 推送是真相源，optimistic 状态只是先行渲染；id 冲突服务端值胜出"（FS-DESIGN §4.5 原文）；
4. **目标状态式任务书**：只描述终点可观察状态 + 机械验收判据，不给实现路径指令（m3 任务书
   同款纪律——让模型自己找路，路径选择差异本身是实验数据）；
5. **已知陷阱取材自真实边界**：任务书"陷阱提示"节只引用真实存在的错误码与框架边界
   （ATR-201/215/314/321/331/334/403 等，出处 = `atelier/docs/FS-DESIGN.md` §15 与
   `server/live.ts`/`endpoints.ts`/`migrate.ts` 头注），禁止虚构。

### 3.2 任务组（tasks/，组合度递进；全部草案待评审）

1. `task1-column-change` — 基础跨端：已有 notes 链路新增一列，契约→迁移→端点→前端四处一致
   + struct/api-diff 门禁全绿（自动评分）；
2. `task2-live-reconcile` — live 对账考点：live 端点 + command emits 失效 + §4.5 五步对账协议
   含 revert 路径（自动评分：含服务端场景 + 客户端对账两层）；
3. `task3-fullstack-rescue` — 加难组合：task1+2 叠加 + **基线种子缺陷**（执行半 setup 注入）
   需要读四段式错误自救（ATR 码导航）〔议：候选第二考点 = gen auth 鉴权装配，评审定〕。

难度递进 rationale 照抄 m3：task1 冒烟正控层（预期三臂差距不大，作下限锚），task2 引入
异步协议面（wave-6 教训高发区：同步/异步歧义必须在 brief v1 就消歧——task2 brief 已显式
写明推送异步语义与断言窗口），task3 加难层 = 北极星判据主战场。

### 3.3 天花板护栏（Wave-7 教训成文，强制）

- **pilot 先行**：正式波之前必须跑 pilot（n=1/cell）；若加难层全平（三臂 firstPass 全 100%），
  **先加难任务层再出正式数**——直接出数 = 重演 Wave-7"天花板在加难层复现"；
- brief 歧义即整改：pilot 中任何一臂因任务书歧义（非能力）判 FAIL → brief 升 v2，消歧后
  **重跑验证**（Wave-6 task4 同步/异步歧义 → brief v2 → skill.task4 r2 PASS 的既定闭环）；
- 全平不是"框架无用"的证据，是"任务层无区分力"的证据——引用纪律写进 §4.4。

---

## 4. 评分器开放协议（决策 21-④：对外可比）

### 4.1 三件开源化口径

任务书（`tasks/*.brief.md`）、评分器（`grade.mjs` + harness，执行半实现）、RUNBOOK 三件
**随仓库开源**，任何第三方可复现（Supabase Evals 2026-08 先例，决策 21-④ 原文口径）：

- 机械判据全部可复现：判据 = 文件存在性 / 结构守卫 exit code / 测试通过 / 运行时场景断言 /
  API 契约符合（§4.2 类别表），每条判据在评分报告中有机器可读的 pass/fail 记录
  （`m3fs-grade.json` 留存于每个 attempt 目录）；
- 出数配套开源：`runs.json` 原始逐 run 记录（只追加）+ 每波报告（pilot/formal 分档标注）+
  负控/正控 fixture 集 + 基线装配脚本——**引用者能下钻到每次 run**；
- 不可复现件（对照臂模型版本/会话工具版本/时点）在波报告中如实登记为环境元数据。

### 4.2 机械判据类别表（firstPass = 全类全绿；对照臂判据语义全同、实现分臂）

| 类 | 判据类别 | 内容（atelier 臂口径） | 对照臂等价物 |
|---|---|---|---|
| S | 结构守卫 | `struct check` exit 0（八层无 ERROR）；`api-diff check` 无未豁免 breaking；gen 产物 regen 字节幂等 | `tsc --noEmit` 绿 + lint 绿 + drizzle-kit 迁移成对且 `up→down→up` 影子库干跑幂等 |
| R | 运行时场景（黑盒） | 起 server（`ATELIER_SERVER_READY` 握手探活）→ 按任务场景驱动 HTTP/SSE/DB：如 SSE 首连全量、写后推送窗口、失败路径 ATR 响应 | 同一脚本语义打 Next 的端点面（Server Action 经 HTTP 可驱动的等价封装，场景规格同文） |
| C | 客户端对账 | dom-shim 挂载组件驱动提交入口：失败 create → 乐观项 revert + rollbacked 含 id + 错误态含 fix 可见 | jsdom + testing-library 驱动同语义断言（同一场景规格） |
| T | 测试门 | 应用侧 `pnpm test` 全绿（契约/样式守卫） | 同（vitest） |

**不对称性明写**（诚实纪律）：S 类在 atelier 臂是框架门禁本身（被考能力的一部分），在对照臂
以等价强度替代（tsc/lint/迁移可逆）；C 类实现分臂但**断言语义逐条同文**（场景规格是单一
文档，两臂 harness 各自实现同一规格）。**rubric 主观评分降级为诊断件**〔议〕：不再作为
firstPass 判定输入（修正 m3 react 臂"机械 vs 主观"不对称偏置）；保留 rubric 用于
(a) 对照臂习惯法质量诊断报告、(b) 机械判据边缘案例的人工复核留痕。

### 4.3 盲评与四角分离（评分者≠作者，Wave-6/7 纪律照抄）

- 四角分离：任务书作者 / 参考解作者 / 实验编排者 / 评分·盲评者四角不得同一人；
- 盲评 rubric 模板（诊断用）：每任务 5 行 × 0-2 分，行 = 维度（正确性/协议完整度/错误处理/
  可读性/惯用法），每行给 0/1/2 分锚例（行为化描述）；评分时 attempt 目录名去臂名化
  （`blind-<序号>/`），出分后回填映射；
- 分歧处置：双人独立盲评分差 >2 分 → 第三人仲裁（m3 RUNBOOK §5 原口径）；
- 评分器改动纪律照抄 m3：**改判据后必跑正控全绿 + 负控全 FAIL**（`negative-check` 同款
  前置门，未过不得出数）。

### 4.4 n 与区间限定语（Wave-7 教训直接写入，强制口径）

- 规模：3 臂 × 3 任务 × **≥5 runs**（≥45 run）才有统计意义；每格 n<5 的数据只许以 pilot
  名义出现，禁止进结论段；
- 每格 5 个二值 run 的 95% Wilson 区间宽度**远宽于** +15pt 判据间距——一切正确率引用必须
  携带 "FORMAL n=5/cell、Wilson 区间宽于判据间距，方向性参考而非定论" 限定语，禁止把小样本
  差异写成定论；
- 三臂全平的正确引用方式："任务层无区分力"（同 Wave-7 诚实判读），禁止反推"框架无用"或
  "技能包无用"——那是 P3-2 干扰面 / P3-3 混合实验的问题域；
- 实验档位标注强制：pilot 与 formal 分档，引用必须注明档位（禁止拿 pilot 当卖点，同 m3
  "禁止拿 task1-3 全平数据当卖点"条款）。

---

## 5. 首遍正确率与返工（口径照抄 m3）

- 一次 run = 一个全新臂会话完成任务书，产出 attempt 目录（布局见各 brief）；
- 评分：`node atelier/benchmarks/m3-fs/grade.mjs --task <id> --attempt <dir>`——写
  `<attempt>/m3fs-grade.json`（**未武装**：grade.mjs 属执行半）；
- `firstPass` = 第 1 个 attempt 的 grade.ok；`attempts` = 达到 ok 所需 attempt 数
  （**上限 3，封顶记 3**）；返工限定同一会话内修（m3 同款）；
- run 记录逐条 append 进 `atelier/benchmarks/m3-fs/results/runs.json`
  （schema 同 m3 report.mjs 头注）。

---

## 6. 判据（FS 版 §7 判据）〔议：阈值待拍板〕

出数后改写路线图权重，无论正负（m3 §7 原纪律）：

- **主判据（相对口径）**：`skill` − `next` 首遍正确率 ≥ **+15pt**，以加难层（task3）为准；
- **副判据（绝对口径）**：`skill` 首遍正确率 ≥ **60%**；
- 与 m3 的差异：m3 为"任一即 PASS"；M3-FS 建议**两判据都报、以相对为主**——理由：Wave-7
  实证绝对口径易天花板饱和（三臂全 100% 时绝对判据失去信息量），且对照臂按 §1.1 本就是
  强臂，相对口径才是"契约单源+门禁+技能包是否交付正确率优势"的直接回答；
- 双不达 → 假设降级，路线图向工具链/编译器倾斜（m3 原话照抄）；
- 阈值（+15pt / 60%）沿 m3 沿用属**默认提议非拍板**，拍板项见 §19 清单（回写
  FS-DESIGN §19 时统一编 D-F 号）。

---

## 7. 运行（已武装；逐臂操作卡 = RUNBOOK.md）

    node atelier/benchmarks/m3-fs/grade.mjs --task task1-column-change --attempt <dir>       # atelier 臂评分
    node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task1-column-change --attempt <dir>  # 对照臂评分
    node atelier/benchmarks/m3-fs/negative-check.mjs --baseline <基线> --baseline-task3 <task3变体>  # 负控前置门
    node atelier/benchmarks/m3-fs/report.mjs --results atelier/benchmarks/m3-fs/results/runs.json --tier formal  # 汇总出数 + §6 判定

正控参考解（`reference/`＝atelier 臂已认证 9/9+9/9+16/16；`next/reference/`＝对照臂已认证
8/8+8/8×2+18/18，红证 M2/M3/M8 与 R2/R3 定向）与
负控 fixtures（`harness/fixtures/negative/`，`negative-check.mjs` 前置门）**先于任何出数存在**
（2026-09-20 落地）。基线装配：`setup-baseline-atelier.mjs`（`--no-ai`/默认两臂形态 +
`--variant task3` 缺陷注入）/ `next/setup-baseline-next.mjs`。

---

## 8. 诚实边界汇总

1. 设计件 ≠ 武装件：本目录现有全部文件是协议/任务书/RUNBOOK 设计稿，任何"已可出数"的表述
   均为名实差距（R8 红线）；
2. 三臂 agent 运行依赖人会话/独立 AI 会话，本仓库不可自证无污染——RUNBOOK 红线清单是出数
   有效的必要条件而非充分条件；
3. 对照臂等价基线的"等价"由人评审冻结，基线差异是本协议最大的有效威胁——两臂基线脚本
   必须同批评审、同批开源；
4. live 场景判据受时限窗口影响（coalesce ~50ms + 网络抖动）：断言窗口写进场景规格并对三臂
   同值（规格不公 = 数据作废）；
5. 全平结果的唯一合法解读是"任务层无区分力"（§4.4）。
