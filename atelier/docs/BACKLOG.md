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
| F-2 | 编译器静态依赖图（决策 3） | 🔄 一期 ✅（清单+差分对拍，语法级超集）；二期 1/3 ✅（09-06 构建期图查询：buildGraph/`--graph`/`graph.static`） | **跳过追踪快路径**（逐挂点 exactness：无短路+无函数调用的叶子挂点静态预订阅；核心=`$effectStatic` 内核手术，golden DOM+差分对拍护航）· **prod 剥离** | 
| F-3 | 样式纪律收紧（决策 16） | ✅ 二期（R1-R5 全链：颜色/间距/字号；recipe 层同责；诚实边界：reset 豁免、border/line-height/阴影不辖、radius 留候选） | radius 纪律候选 |
| F-4 | codegen 覆盖扩张 | ✅ 两批（08-30）：else-if 链/void 元素/ATR-101/错位闭合拒绝/对象数组字面量/配对花括号 | 属性级指令（on:/bind: 族）= 新方向候选，需先出设计 |
| **F-5** | **组件模型补强（响应式 props + effect 所有权）** | 🆕 **2026-09-06 锐评立项，优先级高于 F-2 二期剩余**（可用性地基先于性能优化与叙事）。取证：props 挂载期一次性 `evalExpr`（template.ts:607-608，codegen.test.ts:382 测试名自认"不随信号后续变化"）⇒ 跨组件数据流瘫痪；分支切换丢弃 `bindExpr` 的 dispose（template.ts:590-595/662）⇒ 已脱离节点仍被订阅写入。**开工第一步 = 红检复现两项取证**（锐评为二手取证），再出设计（props 信号传导语义 + effect 所有权树，对位 Solid ownership/Vue effectScope） | L |

**锐评后置增补（2026-09-06，出数前置）**：M3 三臂出数前必须补——① **负控 fixture 集**：task4-6 各造 ≥2 个"差一点错"变异样本，断言评分器必须红（当前判别力只有正控六绿，负控为零）；② **react 臂评分去利益冲突**：评分者 ≠ 作者，或双人独立盲评取一致（rubric 主观分与 atelier 臂机械评分不对称）；③ RUNBOOK 增补对应附录。样本量口径诚实化：每格 5 个二值 run 的置信区间宽于 +15pt 判据，结论措辞按此克制。

### 候选池（锐评衍生 + 既有候选，按需触发，未排期）

- **struct check 检出力补强**：当前 ERROR 仅 4 种（config/manifest/existsSync 级）——把 `.atr.spec.ts` 用例与 manifest 组件集不一致、token 引用不存在键等真实违例升 ERROR，或诚实降调"六层结构公理"措辞（名实对齐，与 README 措辞终审合并处理）。
- **schema 编译期提取**：contract.ts 完整版承诺（TS 类型 AST → schema），替代手写组件元数据。
- **真实浏览器测试转正**：113 用例全跑在 dom-shim 上；snapshot-smoke 是唯一真实浏览器路径且 continue-on-error——候选 = CI 中把 snapshot-smoke 升正式 gate（需 per-platform baseline）。
- 属性级指令（on:/bind: 族，归 F-4 剩余）· radius 纪律（F-3 剩余）。

### 设计备忘（半天级，按需触发）

- ✅ 三项全清（P1-5，08-30）：schema min/max/pattern · confirm deny 闸（ask 档暂同 auto，stdio 无人工通道）· checkpoint 测试门禁。

### 尾巴（诚实标注的已知项）

- HMR 边界②：模板结构大改按序还原可能错位——已文档化启发式（正修复需编译器闭包捕获，归 F-2 二期后评估）；边界③：跨交换 checkpoint 不回落新信号——已文档化边界。
- CI snapshot-smoke：本地等价验证通过（08-30）；真实 CI 首跑待 push 远端（本仓尚无 remote）。
- 本仓 snapshot 基线未武装：`checkpoint save` 快照门一直 vacuous——`atelier snapshot save` 一次即武装。
- checkpoint.mjs 仓库发现只认 cwd 下 `.git`：候选修法 = cwd 无 `.git` 时向上 `rev-parse` 找根（AGENTS.md 已加"仓库根运行"提示兜底）。
- ~~P1-9 baseline.png 视觉复核留待用户~~ → **已处置（09-06 整理）**：`.dsh-trash/` 全区清除（含 wave-1~5 原始 attempt 产物与 smoke-app；评分事实保留在 `benchmarks/m3/results/` 与 WAVES 报告；视觉基线可随时 `atelier snapshot save` 重生成）。

### 挂起区（等 F 线里程碑后启动）

- 干扰面实验（不给源码只给 CLI/错误输出）——技能包价值（核心竞争力）的决定性检验；执行方式同 M3 三臂（逐臂独立会话，RUNBOOK 同款纪律）。
