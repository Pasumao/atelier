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

## 活跃队列

### F 线 — 功能债（壮大框架的主菜）

| # | 项 | 状态 | 剩余 |
|---|---|---|---|
| F-1 | 事务层完整版（决策 5） | ✅ 一期+MCP 接线（08-30）：命名合并/journal/store.graph/bridge 下行；诚实边界：恢复走全量快照 | 无（回放恢复/静态化归 F-2） |
| F-2 | 编译器静态依赖图（决策 3） | 🔄 一期 ✅（清单+差分对拍，语法级超集）；二期 2/3 ✅（09-06 构建期图查询 buildGraph/`--graph`/`graph.static` + 跳过追踪快路径 `$effectStatic`：exactness 判据=无函数调用+全根标识符解析为信号，不确定即回退动态追踪宁慢勿错；短路=良性超订阅；模板层 ATR-301 拒括号使 paren 守卫为纵深防御；5 专项用例+122 全绿+六正控 6/6+bench 全 PASS） | **prod 剥离**（dev 校验/追踪簿记的发布面剥离；需构建面设计，阶段四） |
| F-3 | 样式纪律收紧（决策 16） | ✅ 二期（R1-R5 全链：颜色/间距/字号；recipe 层同责；诚实边界：reset 豁免、border/line-height/阴影不辖、radius 留候选） | radius 纪律候选 |
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

- 干扰面实验（不给源码只给 CLI/错误输出）——技能包价值（核心竞争力）的决定性检验；执行方式同 M3 三臂（逐臂独立会话，RUNBOOK 同款纪律）。

### M3 实验波次记录

- **Wave-6 先导波（2026-09-06，PILOT n=1/cell，无统计结论）**：task4-6 × 三臂各 1 run = 9 run，
  经独立子代理会话执行（noskill 仅任务书 / skill 任务书+技能包 / react 同任务书转译；react 臂独立
  盲评 rubric 9/8.5/9.5 全过）。记分：noskill 3/3 · skill 2/3 · react 3/3；report.mjs 判定 N/A
  （诚实拒绝）。**真实产出**：①抓出 task4 brief 同步/异步歧义（skill 臂合法异步流被 harness 同步
  断言 FAIL）→ brief v2 已消歧；②逐臂管线全链路（attempt+junction+子代理单发+机械评分+盲评）走通；
  D-1/D-4 已拍板（§5）。明细 `results/WAVE6-PILOT-REPORT.md` · `results/runs-wave6-pilot.json`。
  **brief v2 已验证**（skill.task4 r2 重跑 PASS，整改闭环）。**下一步**：正式波（每臂×每任务×5 runs）。
