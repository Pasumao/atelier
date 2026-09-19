# Atelier 技术缺口与改进 Backlog（2026-09-06 整理版）

> 本文件是缺口与改进队列唯一源。**已完成项一律压缩为索引**——逐项规格与验收明细按「完成即合并」
> 原则归档于 git 历史（checkpoint 锚点见 `.atelier/checkpoints.jsonl` 与 `git log`），此处只留结论与出处。

## 已完成归档（索引；明细溯 git）

| 时段 | 交付 | 锚点 |
|---|---|---|
| 08-27~30 | backlog-blitz 全清：信号内核（keyed each/AST 缓存/deliver 调度）· dev 面（SSE 下行/HMR 保态 51ms/截图 ~300ms/像素三档/token 门禁/audit）· M3 三臂 45 run（天花板效应定论）· 工具链（MCP 全接线/review UI/CI 矩阵/struct/checkpoint 未检不锚）· P0-8 评分器 footgun · 性能四指标全达标 | git log 08 月段 |
| 08-30 | 阶段一收口：P1-1 F-2 一期（静态依赖清单+差分对拍）· P1-2 F-4 两批（else-if/void/ATR-101/对象字面量）· P1-3 F-3 二期（R4/R5 间距字号）· P1-4（sync/review MINI/HMR 泄漏关闭）· P1-5（schema 约束/deny 闸/测试门禁）。阶段二收口：P2-1 graph/journal 接线 · P2-2 标准五件套（S 门禁/structured error/toolsets/a11y/DTCG/equals）· P2-3 specs v2（constitution+EARS）· P2-4 agent 体检 · P2-5 README 定位面（措辞终审待用户）。93 绿 · check-skills 56/0 | `0c3636a`→`464efe7` |
| 08-31 | P3-1 前置：M3 加难任务层 task4-6 落地（brief+参考解+harness 扩张+protocol/grade 同步）；2026-09-04 六正控复核全 PASS | `d27a34f` |
| 09-06 | P3-4 全收口：`atelier api-diff snapshot\|check`（框架四面/应用两面，breaking/additive/relaxed/valueDrift+churn，--allow/--strict/--budget）· checkpoint 第三道门（API 漂移拒锚）· CI 接线 · 负例红检实证。F-2 二期·构建期图查询：buildGraph + codegen `--graph`/`--graph-only` + MCP `graph.static`（25 工具，stdio 双径 e2e）。M3 RUNBOOK 逐臂操作卡 | `6b12b99`→`c0bc95d` |
| 09-06 | **仓库整理**（删 SKILL_DRAFT/.dsh-trash；SKILLS-PLAN/BACKLOG 索引化）+ **独立子代理锐评**（8/10 side-project 坐标 / 3/10 框架坐标；整改=F-5 立项、出数前置增补、README 数字修正、名实对齐候选池、生死判据入 ROADMAP §7） | `83e4a7a`→ |
| 09-06(锐评整改批次) | 锐评三件事收口：F-5 组件模型补强红检转绿（响应式 props + effect 所有权，`tests/f5-kernel.test.ts`）· 负控集六枚 + `negative-check.mjs` 机检 6/6 + CI 接线 · README/AGENTS 数字改标记位（docs-numbers sync/check 机检）· R6 radius 纪律（F-3 收口）· struct `FACT_TOKEN_REFS` token 对账 · checkpoint 仓库发现向上查找 · M3 Wave-6 先导波（抓出 task4 brief 歧义 → brief v2 消歧并验证）· P3-5 D 子集预研报告（MCP Apps/A2UI 正交，定论不立项深投入） | `83e4a7a`→`a2e18a8` |
| 09-19 | **FS-M1 全站化第一里程碑**：决策 17-23 定稿 · `atelier/server/` S0 端点运行时（defineQuery/defineCommand 读写二分 + 显式注册表 + Web 标准 Request/Response 分发 + ATR-2xx 契约校验 + command 审计 journal）· `~standard` 互操作口（contract.ts 抽 collectFlatIssues，文案逐字不变）· SQLite 薄宿主适配（bun:sqlite/node:sqlite 四原语，差异锁死 sqlite.ts）· 测试 135→160 绿 · docs-numbers sync。同日 M3 Wave-7 正式波 45 run 出数（三臂全 100%，诚实判读见 M3 波次记录） | `b592847` |
| 09-19 | **FS-M2 第一批（主/子智能体 git worktree 协作，三分支并行 `111fb2c`/`a25630c`/`150263c`）**：FS-8 边界守卫（struct 八层：SERVER_IMPORT_LEAK/IMPORT_ALLOWLIST/SERVER_AUTH_MISSING/SERVER_JOURNAL_SILENT + DB_MIGRATION_PAIR/CHECKSUM/SCHEMA_DRIFT，ATR-105/106，红绿双证）· FS-3 剩余数据契约（`server/db.ts` table() 扁平定义→rowSchema/DDL 单源 + `tx` 事务原语）· FS-4 可逆迁移器（status/up/down/verify 影子库干跑 + sha256 体检 + 不可逆 force 约定，ATR-331~334）· 端点 v2（ctx 显式注入 db/auth/signal/audit + 输出契约 ATR-215/216 + timeoutMs ATR-322 + live/emits 键语法 ATR-314 + journal 记失败条目 D-F12 建议采纳 + AtrEndpointError httpStatus 缺省 422）· 生成器半（gen db：tables/crud/迁移骨架追加式 regen 幂等；gen endpoint：api.ts 类型化客户端 FlatOf 投影 + specs 骨架；impact 两跳导航）· CLI 接线 gen/migrate/impact + 主智能体旗舰链路端到端冒烟（gen db→migrate up/status/verify→gen endpoint→impact→struct check 全通）· 测试 160→248 绿 · docs-numbers sync。诚实边界：gen auth/seed=M2-d 未做 · live SSE 引擎=FS-7 · checkpoint 迁移联动未接 · tsc 零修改可编译门禁未接线 | 本批合并链 `f115e40`→`0c0ec46` |

## 活跃队列

### F 线 — 功能债（壮大框架的主菜）

| # | 项 | 状态 | 剩余 |
|---|---|---|---|
| F-1 | 事务层完整版（决策 5） | ✅ 一期+MCP 接线（08-30）：命名合并/journal/store.graph/bridge 下行；诚实边界：恢复走全量快照 | 无（回放恢复/静态化归 F-2） |
| F-2 | 编译器静态依赖图（决策 3） | 🔄 一期 ✅（清单+差分对拍，语法级超集）；二期 2/3 ✅（09-06 构建期图查询 buildGraph/`--graph`/`graph.static` + 跳过追踪快路径 `$effectStatic`：exactness 判据=无函数调用+全根标识符解析为信号，不确定即回退动态追踪宁慢勿错；短路=良性超订阅；模板层 ATR-301 拒括号使 paren 守卫为纵深防御；5 专项用例+122 全绿+六正控 6/6+bench 全 PASS） | **prod 剥离**（dev 校验/追踪簿记的发布面剥离；需构建面设计，阶段四） |
| F-3 | 样式纪律收紧（决策 16） | ✅ R1-R6 全链（08-30 二期 R4/R5 间距字号 + 09-06 R6 radius：border-radius 只准 var(--radius-*)/0、rounded-* 类限 config 键，starter 真违例迁移实证；recipe 层同责；诚实边界：reset 豁免、border/line-height/阴影不辖） | 无 |
| F-4 | codegen 覆盖扩张 | ✅ 两批（08-30）：else-if 链/void 元素/ATR-101/错位闭合拒绝/对象数组字面量/配对花括号 | 属性级指令（on:/bind: 族）= 新方向候选，需先出设计 |
| **F-5** | **组件模型补强（响应式 props + effect 所有权）** | ✅ **红检转绿（2026-09-06 同日）**：① 红检复现锐评双取证（`tests/f5-kernel.test.ts` 红检①②，先红后绿）→ ② effect 所有权：teardown 栈（if 换支/each 无 key 全清/keyed 行移除三路 cleanup，嵌套实例级联 dispose，与 HMR `__effectSink` 两级正交）→ ③ 响应式 props：prop 信号+getter（子组件 `props.x` 语法不变），父侧 effect 回写，解释器/codegen 双路同源（`rt.bindProp`/`rt.validateProps`）。回归：115+8skip 绿 · golden DOM parity（含旧一次性语义测试翻转为传导对拍）· M3 六正控 6/6 PASS · starter 应用 18/18。诚实边界：函数体内 props 直读仍 initial-only；prop 信号入依赖图/journal | **无**（性能四指标复测 2026-09-06 全 PASS；数字以根 README 性能表为唯一人工口径，此处不重复记录） |

**锐评三件事收口（2026-09-06 当日）**：① 组件模型 = F-5 ✅（见上）；② 负控集 ✅ ——
`harness/fixtures/negative/` 六枚变异样本（task4 乱序顺序/徽标缺失、task5 私用 $state/计数过期、
task6 缺 token/未登记引用）+ 机检门 `negative-check.mjs` 6/6 抓住 + CI 接线；react 臂评分独立性
与外部第三方执行入 RUNBOOK §5（组织项，出数时执行）；③ 数字生成源 ✅ —— README/AGENTS 数字
改标记位，`docs-numbers.mjs` sync/check 机检（CI 已接），性能数字人工口径不变。
**锐评后置增补原文（存档）**：M3 三臂出数前必须补——① 负控 fixture 集 ✅；② **react 臂评分去利益
冲突**：评分者 ≠ 作者，或双人独立盲评取一致（rubric 主观分与 atelier 臂机械评分不对称）；
③ RUNBOOK 增补对应附录 ✅。样本量口径诚实化：每格 5 个二值 run 的置信区间宽于 +15pt 判据，
结论措辞按此克制。

### FS 线 — 全站化（2026-09-19 立项：决策 17-23 定稿；调研 `research/2026-09-report{1,2,3}-*.md`；全站化设计书已归档 git）

| # | 项 | 状态 | 剩余 |
|---|---|---|---|
| FS-1 | S0 端点运行时（`atelier/server/`）：defineQuery/defineCommand 显式注册表 + Web 标准 Request/Response 分发 + 契约校验（复用 validateFlat，ATR-2xx 四段式）+ command 审计 journal + live 端点元数据位 | ✅ M1（2026-09-19，`endpoints.ts`，10 专项用例）+ ✅ v2（09-19 M2 第一批：ctx 注入/输出契约/journal 强化） | dev 托管归 FS-7 |
| FS-2 | `~standard` 互操作口（决策 22）：schema 对象挂 `~standard` 属性，validate 委托 validateFlat | ✅ M1（2026-09-19，`standard-schema.ts`，9 专项用例） | 编译期 JSON Schema/openapi-3.0 投影（归 FS-9，compiler 侧） |
| FS-3 | SQLite 薄宿主适配（bun:sqlite/node:sqlite，四原语 prepare/run/all/get 锁差异）+ 数据契约 + gen db 薄生成层 | ✅ 宿主适配 M1（2026-09-19，`sqlite.ts`）+ ✅ 数据契约+gen db M2 第一批（`db.ts`/`gen/gen-db.mjs`） | bun 路径待 Bun 环境回归（挂账） |
| FS-4 | 可逆迁移器（up/down）+ checkpoint 联动回滚（检出未逆迁移强制先 down，confirm=ask） | ✅ 迁移器 M2 第一批（`migrate.ts` + `atelier migrate`，verify 干跑/checksum/不可逆 force） | checkpoint 联动强制先 down 未接（下批） |
| FS-5 | gen endpoint / gen auth 生成器（产物显式 import 闭合 + 生成后零修改可编译门禁） | 🔄 gen endpoint ✅ M2 第一批（api.ts 客户端 + specs 骨架 + impact）；regen 幂等红绿已证 | gen auth（M2-d）· tsc 零修改可编译门禁接线 |
| FS-6 | MCP endpoint.*/db.schema 工具族（超集对表 Next 8 工具）+ struct 八层（+server 边界层/+数据契约层/import 白名单） | 🔄 struct 八层 ✅ M2 第一批（7 规则红绿双证 + ATR-105/106） | MCP 工具族（M3-FS，注册表数据源已备：EndpointSummary 已扩 invalidate/output/timeoutMs/idempotent） |
| FS-7 | dev 面集成：atelier dev 托管 server 面 watch/重启 + live 端点 SSE→streamValue 直通信号图 | 未开工（live 声明位/键语法/客户端 EventSource 消费形态 M2 第一批已备） | |
| FS-8 | 边界守卫：src/server import 越界 = ATR-1xx 红错 | ✅ M2 第一批（SERVER_IMPORT_LEAK/IMPORT_ALLOWLIST struct 接线，红绿双证） | 无（动态 import() 不查=诚实边界记 B 队） |
| FS-9 | `atelier export openapi`（挂 ~standard JSON Schema 投影，内建一等） | 未开工 | 投影器可与 FS-6 并行（同管线 §2.4） |
| FS-10 | M3 全栈任务臂（跨端任务三臂照抄）+ 评分器开放协议对外可比 | 未开工（后置） | |
| FS-11 | 异步表达式策略原型验证（D-F9 前置：倾向显式拒绝，异步收敛在三态原语/live 端点边界） | 未开工（端点 v2 已把 Promise 列入 ATR-216 非法序列化面——独立防线先行） | 定稿后回写 design-decisions |

### 候选池（锐评衍生 + 既有候选，按需触发，未排期）

- ~~struct check 检出力补强~~ → **已落地（2026-09-06）**：新增 `FACT_TOKEN_REFS`（*.atr.ts style 块
  var(--token) 对账 config 单源；未解析引用 = ERROR——构建期镜像运行时 ATR-204，"不假红"不破；
  红检/绿检双实证）。名实对齐：六层现在有真实代码级 ERROR 检查三种（幽灵组件/manifest 解析/token 对账）。
- **schema 编译期提取**：contract.ts 完整版承诺（TS 类型 AST → schema），替代手写组件元数据。
- **真实浏览器测试转正**：113 用例全跑在 dom-shim 上；snapshot-smoke 是唯一真实浏览器路径且 continue-on-error——候选 = CI 中把 snapshot-smoke 升正式 gate（需 per-platform baseline）。
- **属性级指令设计备忘（F-4 剩余，未立项）**：`bind:value={sig}` 双向绑定——糖化=动态 attr effect（已有 bindExpr）+ 元素事件监听回写 `sig.value`；仅限表单元素（input.value/checked/select）；只接受可写 $state（对 $derived 写 → 沿用 ATR-305）；codegen emit 与解释器同构；护栏=双向环检测（同信号同元素同 attr 只订一次）。事件修饰族（.prevent/.stop）候选后置。先出设计评审再立项。
- **schema 编译期提取设计备忘（候选池，未立项）**：dump.mjs 扫描器扩 `(props: {...})` 类型注解提取——花括号配对（复用 matchBrace）取属性名+类型文本，映射 string/number/boolean/array（=Array<T>）/枚举（字面量联合）；产物随 stage ② dump 落 `.atr/ast`，component() 未显式传 schema 时从 dump 工件取（显式 schema 仍优先=向后兼容）；边界：泛型/交叉类型/工具类型显式拒绝（ATR-1xx 四段式），复杂类型手写 schema 不变。
- ~~radius 纪律（F-3 剩余）~~ → **已落地（2026-09-06，R6）**：border-radius 只准 var(--radius-*)/0、rounded-* 类只准 config radius 键；starter 真违例抓到并迁移（.tab 999px → 新增 token radius.pill）；红检 6px 实证被抓 + 冒烟应用 19/19。

### 设计备忘（半天级，按需触发）

- ✅ 三项全清（P1-5，08-30）：schema min/max/pattern · confirm deny 闸（ask 档暂同 auto，stdio 无人工通道）· checkpoint 测试门禁。

### 尾巴（诚实标注的已知项）

- HMR 边界②：模板结构大改按序还原可能错位——已文档化启发式（正修复需编译器闭包捕获，归 F-2 二期后评估）；边界③：跨交换 checkpoint 不回落新信号——已文档化边界。
- CI snapshot-smoke：本地等价验证通过（08-30）；真实 CI 首跑待 push 远端（本仓尚无 remote）。
- 本仓 snapshot 基线未武装：`checkpoint save` 快照门一直 vacuous——`atelier snapshot save` 一次即武装。
- checkpoint.mjs 仓库发现：~~只认 cwd 下 `.git`~~ → **已处置（2026-09-06）**：cwd 无 `.git` 时向上找最近祖先（误建嵌套仓的根因关闭；AGENTS.md"仓库根运行"提示保留为文档）。
- ~~P1-9 baseline.png 视觉复核留待用户~~ → **已处置（09-06 整理）**：`.dsh-trash/` 全区清除（含 wave-1~5 原始 attempt 产物与 smoke-app；评分事实保留在 `benchmarks/m3/results/` 与 WAVES 报告；视觉基线可随时 `atelier snapshot save` 重生成）。

### 挂起区（等 F 线里程碑后启动）

- 干扰面实验（不给源码只给 CLI/错误输出，= ROADMAP P3-2）——技能包价值的决定性检验；执行方式同 M3 三臂（逐臂独立会话，RUNBOOK 同款纪律）。**启动条件已满足（2026-09-06）**：M3 加难层正式波（Wave-7，45 run）出数完成，三臂全平，技能包价值悬念移交本实验 + 混合实验回答。
- 混合实验（内联文档 vs skills vs 混合三臂，= ROADMAP P3-3；D-1 已拍板立项 2026-09-06）——正面回应 Vercel evals 反证；启动条件同上已满足，可与干扰面实验并联排期；**结论可推翻"纯 skills"定论**，若混合更优则修订 design-decisions 相应决策并出迁移方案。

### M3 实验波次记录

- **Wave-6 先导波（2026-09-06，PILOT n=1/cell，无统计结论）**：task4-6 × 三臂各 1 run = 9 run，
  经独立子代理会话执行（noskill 仅任务书 / skill 任务书+技能包 / react 同任务书转译；react 臂独立
  盲评 rubric 9/8.5/9.5 全过）。记分：noskill 3/3 · skill 2/3 · react 3/3；report.mjs 判定 N/A
  （诚实拒绝）。**真实产出**：①抓出 task4 brief 同步/异步歧义（skill 臂合法异步流被 harness 同步
  断言 FAIL）→ brief v2 已消歧；②逐臂管线全链路（attempt+junction+子代理单发+机械评分+盲评）走通；
  D-1/D-4 已拍板（§5）。明细 `results/WAVE6-PILOT-REPORT.md` · `results/runs-wave6-pilot.json`。
  **brief v2 已验证**（skill.task4 r2 重跑 PASS，整改闭环）。**下一步**：正式波（每臂×每任务×5 runs）。
- **Wave-7 正式波（2026-09-06，FORMAL n=5/cell，共 45 run）**：task4-6 × 三臂 × 5 runs，独立子代理
  会话逐 run 执行（RUNBOOK 偏差已记录：授权改最多 3 路并发批处理，评分/盲评/入账串行）；出数前置
  负控 6/6 + 六正控 6/6 先行通过；react 臂独立评审代理盲评（评分者≠编排者）。记分：**三臂全
  15/15（100%），全部 attempts=1 零返工**；report.mjs §7 判定 PASS（绝对口径 100% ≥ 60%），
  相对口径 skill−react = 0pt 不成立。**诚实解读**：天花板在加难层复现——本任务层对基线模型已无
  区分力，技能包价值悬念按既定安排移交 P3-2 干扰面实验 + P3-3 混合实验（两者启动条件均已满足），
  生死判据 1 走向"定论破产"侧；所有引用须带 "FORMAL n=5/cell、Wilson 区间宽于判据" 限定语。
  明细 `results/WAVE7-FORMAL-REPORT.md` · `results/runs-wave7-formal.json`。
