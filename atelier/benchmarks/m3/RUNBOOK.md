# M3 三臂出数逐臂操作卡（P3-1 剩余 · RUNBOOK）

> 面向执行者的一页纸跑法。协议唯一源 = [protocol.md](protocol.md)；本卡只是把协议翻译成逐步操作。
> **铁律（protocol 诚实边界）**：每一臂的每个 run 都是一个**全新独立会话**；本仓库无法在会话内部
> 可信地模拟"无技能代理"——noskill 臂绝不能在本框架工作区会话内跑。会话之间除任务书外零共享。

## 0. 计划矩阵与约定

- 规模：**3 臂 × 6 任务 × ≥5 runs = ≥90 run**（task1-3 冒烟正控层 + task4-6 加难层；北极星判据以加难层为准）。
- attempt 目录（沿用 wave-1~5 惯例）：`<scratch>/m3/<arm>.<task>.r<run>/`，如 `m3/noskill.task4-agent-cards.r1/`。
- 计分：`firstPass` = 第 1 个 attempt 的 grade.ok；`attempts` = 达到 ok 所需 attempt 数（**上限 3，封顶记 3**）。
- 会话 prompt 纪律：**只准粘贴该任务 `tasks/<id>/brief.md` 原文**。任何会话内追加的提示（含"评分器
  会检查 X"类提醒）= 污染 → 废弃该 run 产物、骨架 diff 归零后重来（wave-3 有先例，见 WAVES 报告 §3）。
- 串行单发，一个 run 跑完再开下一个（wave-4/5 实证 0 崩溃的跑法）。

## 1. 每臂一次性 setup

| 臂 | setup |
|---|---|
| `noskill` | `node atelier/cli.mjs init --target <attempt> --name M3NoSkill --no-ai`——**不装技能包、不落 AGENTS.md/SKILL.md/llms.txt**；会话不得有本仓技能可见性 |
| `skill` | `node atelier/cli.mjs init --target <attempt> --name M3Skill`——默认即含 agent 层（init-ai：skills 双落点 + AGENTS.md/llms.txt + specs/ + MCP 客户端配置）；会话可见技能包与 AGENTS.md |
| `react` | `pnpm create vite --template react-ts`（等价脚手架）；同任务书；评分走 rubric 人工/模型（brief 内嵌，10 分制 ≥8 计 pass） |

每个 run 用全新 attempt 目录 + 全新会话；atelier 两臂的 `src/runtime` 用 **junction 指向框架
`atelier/runtime/`**（vendored 拷贝会被 vite 视为独立模块实例 → 信号跨实例不追踪 → 评分假阴性；
对受控代理透明，不构成臂间差异）。

## 2. 单 run 循环（atelier 两臂）

1. 组 attempt 骨架（§1 对应命令）→ 记目录名。
2. 开全新会话（cwd = attempt 目录），粘贴 brief.md 原文，让 agent 产出任务书"产出布局"的文件。
3. 评分：`node atelier/benchmarks/m3/grade.mjs --task <id> --attempt <attempt目录>`——
   exit 0 = ok；exit 1 = 未过。未过可让**同一会话**修（记 attempts=2，最多 3）；3 次仍红 →
   `firstPass=false, attempts=3`。
4. 逐 run **append** 进 `atelier/benchmarks/m3/results/runs.json`（schema 见 report.mjs 头注）：
   `{ "arm": "...", "task": "...", "run": N, "firstPass": true|false, "attempts": N }`。
5. react 臂同任务书跑完，按 brief 内 rubric 逐条读源码打分（≥8 计 firstPass=true），同样入册。

任务特记：`task5` 产出还需 `TxnItem.atr.ts`（父子组合）；`task6` 的 initTokens/守卫由 harness
以 attempt 配置挂载（组件文件 + config 增补 + 逃生舱登记都要在 attempt 里）。

## 3. 出数与判定

    node atelier/benchmarks/m3/report.mjs --results atelier/benchmarks/m3/results/runs.json

§7 判据（protocol）：绝对口径 skill 首遍 ≥ 60%，或相对口径 skill−react ≥ +15pt；**无论正负回写
ROADMAP 权重**。正确率引用必注实验档位（加难层），禁止拿 task1-3 全平数据当卖点（诚实纪律条款）。

## 4. 红线清单（出数有效性）

- [ ] 每个 run 独立会话、独立 attempt 目录、串行执行
- [ ] prompt = brief 原文，零追加（怀疑污染 → 废弃重来）
- [ ] noskill 臂零技能可见性（含 .dsh/、AGENTS.md、skills/ 目录均不可达）
- [ ] src/runtime junction 已做（否则评分假阴性）
- [ ] m3-grade.json 留在每个 attempt 目录（评分工件可回溯）
- [ ] runs.json 只追加不改写；报告引用与 runs.json 一致
