# M3-FS 全栈三臂出数逐臂操作卡（武装版 · 2026-09-20）

> 面向执行者的一页纸跑法。协议唯一源 = [protocol.md](protocol.md)；本卡把协议翻译成逐步操作。
> 执行半交付件已落地：基线装配脚本×2、grade 评分器×2、场景 harness×2、atelier 臂参考解×3
> （`reference/`，正控认证 9/9+9/9+16/16）、负控 fixtures×7（`negative-check` 前置门 7/7 全红）、
> report.mjs；对照臂正控参考解见 §5 状态。结构照抄 [../m3/RUNBOOK.md](../m3/RUNBOOK.md)。
> **铁律（照抄 m3 protocol 诚实边界）**：每一臂的每个 run 都是一个**全新独立会话**；本仓库
> 无法在会话内部可信地模拟"无技能代理"——noskill 臂绝不能在本框架工作区会话内跑。
> 会话之间除任务书外零共享。

## 0. 计划矩阵与约定

- 规模：**3 臂 × 3 任务 × ≥5 runs = ≥45 run**；pilot 波（n=1/cell）先行，天花板护栏见
  协议 §3.3（pilot 全平 → 先加难任务层，不出正式数——Wave-7 教训成文）。
- attempt 目录：`<scratch>/m3fs/<arm>.<task>.r<run>/`（如 `m3fs/skill.task2-live-reconcile.r1/`）。
- 计分：`firstPass` = 第 1 个 attempt 的 grade.ok；`attempts` = 达到 ok 所需 attempt 数
  （**上限 3，封顶记 3**）；返工限定同一会话内修（m3 同款）。
- 会话 prompt 纪律：**只准粘贴该任务 `tasks/<id>.brief.md` 原文**（对照臂粘贴其评审冻结的
  转译件 `next/tasks/<id>.brief.next.md`）。任何会话内追加的提示 = 污染 → 废弃该 run 产物、
  骨架 diff 归零后重来。
- 串行单发，一个 run 跑完再开下一个（m3 wave-4/5 实证 0 崩溃的跑法；Wave-7 的"3 路并发"
  是已记录偏差，**不默认沿用**——恢复并发须重新授权并记录）。
- **与 m3 的差异**：任务域全栈；基线为预接线全栈应用（§1 setup 差异的主项）。

## 1. 每臂一次性 setup

| 臂 | setup 命令（在仓库根执行） | 状态 |
|---|---|---|
| `noskill` | `node atelier/benchmarks/m3-fs/setup-baseline-atelier.mjs --target <attempt目录> --no-ai`——**不装技能包、不落 AGENTS.md/llms.txt/specs** | ✅ 武装 |
| `skill` | `node atelier/benchmarks/m3-fs/setup-baseline-atelier.mjs --target <attempt目录>`（默认 init-ai 形态） | ✅ 武装 |
| `next` | `node atelier/benchmarks/m3-fs/next/setup-baseline-next.mjs --target <attempt目录>` + 其官方 agent 脚手架（版本如实登记进 run 记录） | ✅ 武装 |

- task3 三臂追加 `--variant task3`（atelier 臂：002 up 已应用 + down 缺失 + schema 已声明、
  端点/前端未消费；next 臂：同构缺陷注入，脚本自带注入断言）。
- **公平性红线**：两 atelier 臂基线逐字节同源（同一脚本两种 flag）；对照臂基线经独立评审
  冻结（版本表/路由表/等价对表 = `next/README.md`）；基线差异清单 = 出数有效威胁清单
  （协议 §8.3）。
- runtime 单实例化（S10b shim）已内建在基线脚本——生成物 import 面与组件面解析到同一
  runtime 实例，否则 live 帧 push 与组件 $state 跨实例不追踪 → C 类评分假阴性。
- 出数前核验 task3 缺陷在位：`struct check` 须报 `DB_MIGRATION_PAIR ERROR`（缺陷被提前修掉
  = 该 run 作废）。

## 2. 单 run 循环（三臂同构）

1. §1 命令组 attempt 骨架 → 记目录名。
2. 开全新会话（cwd = attempt 目录），粘贴该任务 brief 原文（对照臂 = 转译件），让 agent
   产出任务书"产出布局"的文件。
3. 评分：
   - atelier 臂：`node atelier/benchmarks/m3-fs/grade.mjs --task <id> --attempt <attempt目录>`
   - next 臂：`node atelier/benchmarks/m3-fs/next/grade-next.mjs --task <id> --attempt <attempt目录>`
   - exit 0 = ok；exit 1 = 未过（`m3fs-grade.json` 留在 attempt 目录，逐判据 pass/fail 可回溯）。
     未过可让**同一会话**修（attempts=2，最多 3）；3 次仍红 → `firstPass=false, attempts=3`。
4. 逐 run **append** 进 `atelier/benchmarks/m3-fs/results/runs.json`（schema 见
   `results/README.md` 与 report.mjs 头注）；runs.json 只追加不改写。
5. 诊断件（可选）：盲评 rubric 按 §4.3 模板执行（去臂名化 attempt 目录；评分者 ≠ 编排者 ≠
   brief 作者 ≠ 参考解作者）。

**与 m3 的差异**：m3 第 3 步只跑 dom-shim 挂载断言；M3-FS 评分含 R/C 类运行时场景
（grade 负责起停 server——`ATELIER_SERVER_READY` 握手探活、SSE/HTTP 黑盒驱动、库副本迁移
干跑），场景窗口对三臂同值（场景规格单一文档 = `harness/scenario-spec.md`；断言窗口见其
§4：R2 推送 ≤1s 自 2xx 应答起计、首连帧不计窗口——规格不公 = 数据作废）。

## 3. 出数与判定

    node atelier/benchmarks/m3-fs/report.mjs --results atelier/benchmarks/m3-fs/results/runs.json --tier pilot|formal

§6 判据（协议）：主判据相对口径 skill − next ≥ +15pt（加难层 task3 为准）；副判据绝对口径
skill 首遍 ≥ 60%；两判据都报；n<5 → N/A 诚实拒绝。**无论正负回写 ROADMAP 权重**。引用必带
"FORMAL n=5/cell、Wilson 区间宽于判据间距" 限定语；全平只许读作"任务层无区分力"。

## 4. 红线清单（出数有效性）

- [ ] 每个 run 独立会话、独立 attempt 目录、串行执行
- [ ] prompt = brief 原文（对照臂 = 冻结转译件），零追加（怀疑污染 → 废弃重来）
- [ ] noskill 臂零技能可见性（含 .dsh/、AGENTS.md、skills/ 目录均不可达；setup 用 `--no-ai`）
- [ ] runtime 模块单实例化在位（基线脚本 S10b 内建；若手搓基线必须复刻，否则 C 类假阴性）
- [ ] task3 种子缺陷在位（评分前核验 struct 报 DB_MIGRATION_PAIR + D1 的 sha256 前提）
- [ ] m3fs-grade.json 留在每个 attempt 目录（评分工件可回溯）
- [ ] runs.json 只追加不改写；报告引用与 runs.json 一致
- [ ] 出数前置门全过（§5）：正控参考解全 PASS + 负控 fixtures 全 FAIL（缺任一 = 不得出数）

## 5. 出数前置（未过不得出数）

- **负控前置门 ✅ 已武装**：`node atelier/benchmarks/m3-fs/negative-check.mjs --baseline <基线副本> --baseline-task3 <task3变体副本>`——7 枚负控（每枚 = 冻结参考解 + 单点变异）评分器必须全数判 FAIL 且失败判据集与 manifest 恰好一致。2026-09-20 集成认证 7/7 全红（正控只证明"对的能给过"，负控才证明"错的抓得住"）。**改判据后必跑**（m3 同款纪律）。
- **正控参考解**：
  - atelier 臂 ✅ 已武装并认证：`reference/task{1,2,3}/`（overlay + solution.md；官方基线×参考解×评分器交叉认证 9/9 + 9/9 + 16/16 全 PASS，2026-09-20）；与 brief 作者分离（四角分离，协议 §4.3——brief v1 作者 = 设计批，参考解作者 = 执行批另一会话）。
  - next 臂 ✅ 已武装并认证：`next/reference/task{1,2,3}/`（对照臂正控 8/8 + 8/8×2 + 18/18 全 PASS；
    红证两枚——删 down 侧 = M2/M3/M8 恰好红、删 after() 失效广播 = R2/R3 恰好红；判据观察
    留档 `next/README.md` §8.3；2026-09-20，合并后于 main 复核）。
- **外部第三方执行**：三臂 run 由非编排者的独立会话执行；编排者不担任任何一臂的代理会话
  （m3 RUNBOOK §5 原口径照抄）。
