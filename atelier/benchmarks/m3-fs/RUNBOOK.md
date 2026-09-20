# M3-FS 全栈三臂出数逐臂操作卡（骨架 · 未武装）

> 面向执行者的一页纸跑法骨架。协议唯一源 = [protocol.md](protocol.md)；本卡把协议翻译成
> 逐步操作——**骨架版**：凡「未武装」标注的步骤，其脚本/评分器/参考解尚未实现（FS-10
> 执行半交付件），不得执行。结构照抄 [../m3/RUNBOOK.md](../m3/RUNBOOK.md)，差异点逐节标注。
> **铁律（照抄 m3 protocol 诚实边界）**：每一臂的每个 run 都是一个**全新独立会话**；本仓库
> 无法在会话内部可信地模拟"无技能代理"——noskill 臂绝不能在本框架工作区会话内跑。
> 会话之间除任务书外零共享。

## 0. 计划矩阵与约定

- 规模：**3 臂 × 3 任务 × ≥5 runs = ≥45 run**；pilot 波（n=1/cell）先行，天花板护栏见
  协议 §3.3（pilot 全平 → 先加难任务层，不出正式数——Wave-7 教训成文）。〔未武装〕
- attempt 目录：`<scratch>/m3fs/<arm>.<task>.r<run>/`（如 `m3fs/skill.task2-live-reconcile.r1/`）。
- 计分：`firstPass` = 第 1 个 attempt 的 grade.ok；`attempts` = 达到 ok 所需 attempt 数
  （**上限 3，封顶记 3**）；返工限定同一会话内修（m3 同款）。
- 会话 prompt 纪律：**只准粘贴该任务 `tasks/<id>.brief.md` 原文**（对照臂粘贴其评审冻结的
  转译件）。任何会话内追加的提示 = 污染 → 废弃该 run 产物、骨架 diff 归零后重来。
- 串行单发，一个 run 跑完再开下一个（m3 wave-4/5 实证 0 崩溃的跑法；Wave-7 的"3 路并发"
  是已记录偏差，**不默认沿用**——恢复并发须重新授权并记录）。
- **与 m3 的差异**：任务域全栈；基线为预接线全栈应用（§1 setup 差异的主项）。

## 1. 每臂一次性 setup

| 臂 | setup | 状态 |
|---|---|---|
| `noskill` | 基线装配脚本跑 atelier 全栈基线（协议 §2）`--no-ai` 形态——**不装技能包、不落 AGENTS.md/SKILL.md/llms.txt/specs** | 脚本〔未武装〕 |
| `skill` | 同上，默认 init-ai 形态（skills 双落点 + AGENTS.md/llms.txt + specs 骨架 + MCP 客户端配置） | 脚本〔未武装〕 |
| `next`（〔议：臂选择待拍板〕） | Next.js 等价基线装配脚本（协议 §2 最小惯用形态）+ 官方 agent 脚手架（版本如实登记） | 脚本〔未武装〕 |

- **公平性红线**：两 atelier 臂基线逐字节同源（同一脚本两种 flag）；对照臂基线经独立评审
  冻结；基线差异清单 = 出数有效威胁清单（协议 §8.3）。
- atelier 两臂的 runtime 模块单实例化处理照 m3 junction 惯例（vendored 拷贝会被 vite 视为
  独立模块实例 → 信号跨实例不追踪 → 评分假阴性）；**M3-FS 新增注意**：server 面代码与前端
  面必须解析到同一 runtime 实例（基线脚本负责，评审时专查）。〔未武装〕
- task3 臂 setup 追加：种子缺陷注入（002 up 侧已应用 + down 侧缺失，对照臂注入同构缺陷）。
  〔未武装〕

## 2. 单 run 循环（三臂同构）

1. 组 attempt 骨架（§1 对应脚本）→ 记目录名。〔未武装〕
2. 开全新会话（cwd = attempt 目录），粘贴该任务 brief 原文（对照臂 = 转译件），让 agent
   产出任务书"产出布局"的文件。
3. 评分：`node atelier/benchmarks/m3-fs/grade.mjs --task <id> --attempt <attempt目录>`——
   exit 0 = ok；exit 1 = 未过（`m3fs-grade.json` 留在 attempt 目录）。未过可让**同一会话**修
   （attempts=2，最多 3）；3 次仍红 → `firstPass=false, attempts=3`。〔评分器未武装〕
4. 逐 run **append** 进 `atelier/benchmarks/m3-fs/results/runs.json`（schema 照 m3
   report.mjs 头注）；runs.json 只追加不改写。〔results 目录未建，随执行半武装〕
5. 诊断件（可选）：盲评 rubric 按 §4.3 模板执行（去臂名化 attempt 目录；评分者 ≠ 编排者 ≠
   brief 作者 ≠ 参考解作者）。

**与 m3 的差异**：m3 第 3 步只跑 dom-shim 挂载断言；M3-FS 评分含 R/C 类运行时场景
（grade.mjs 负责起停 server——`ATELIER_SERVER_READY` 握手探活、SSE/HTTP 黑盒驱动、
库副本迁移干跑），场景窗口对三臂同值（协议 §8.4）。〔执行半实现，未武装〕

## 3. 出数与判定

    node atelier/benchmarks/m3-fs/report.mjs --results atelier/benchmarks/m3-fs/results/runs.json

§6 判据（协议）：主判据相对口径 skill − next ≥ +15pt（加难层 task3 为准）；副判据绝对口径
skill 首遍 ≥ 60%；两判据都报。**无论正负回写 ROADMAP 权重**。引用必带
"FORMAL n=5/cell、Wilson 区间宽于判据间距" 限定语；全平只许读作"任务层无区分力"。
〔report.mjs 未武装〕

## 4. 红线清单（出数有效性）

- [ ] 每个 run 独立会话、独立 attempt 目录、串行执行
- [ ] prompt = brief 原文（对照臂 = 冻结转译件），零追加（怀疑污染 → 废弃重来）
- [ ] noskill 臂零技能可见性（含 .dsh/、AGENTS.md、skills/ 目录均不可达）
- [ ] runtime 模块单实例化已做（前端/server 同实例，否则评分假阴性）
- [ ] task3 种子缺陷在位（评分前核验 D1 的 sha256 前提——缺陷被提前修掉 = 该 run 作废）
- [ ] m3fs-grade.json 留在每个 attempt 目录（评分工件可回溯）
- [ ] runs.json 只追加不改写；报告引用与 runs.json 一致
- [ ] 出数前置门全过：正控参考解全 PASS + 负控 fixtures 全 FAIL（缺任一 = 不得出数，m3 §5 同款）

## 5. 出数前置（2026-09 纪律继承，未过不得出数）

- **负控 fixture 集**〔未武装〕：每任务至少一枚"差一点错"变异样本（task1：迁移缺 down /
  已应用 up 被改；task2：失效键语法错 / 失败路径不回滚；task3：复用 task1/2 变异 + 绕过式
  修复样本），评分器必须全数判 FAIL——正控只证明"对的能给过"，负控才证明"错的抓得住"；
- **正控参考解**〔未武装〕：三任务参考解先行（评分器必须给 PASS），且与 brief 作者分离
  （四角分离，协议 §4.3）；
- **外部第三方执行**：三臂 run 由非编排者的独立会话执行；编排者不担任任何一臂的代理会话
  （m3 RUNBOOK §5 原口径照抄）。
