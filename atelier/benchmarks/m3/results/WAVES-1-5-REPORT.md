# M3 三臂对照实验 — 全量结果报告（wave-1~5 收官，45/45，2026-08-30）

> 状态：**实验收官**。三臂 × 三任务 × 5 runs = 45 个独立代理会话全部完成并评分。
> wave-1/2/3（27 run）2026-08-29 完成；wave-4/5（18 run）因基础设施事件暂停后于 2026-08-30
> 串行恢复并全部完成（见 §6）。历史过程报告见 git 锚点（原 WAVES-1-3-REPORT.md）。

## 1. 设置摘要

- 三臂：`noskill`（仅 runtime 源码 + llms.txt）/ `skill`（+ 应用内 8 技能包副本）/ `react`（React18+Vite+TS 脚手架，rubric 人工评分）
- 三任务：`task1-counter`（契约+$state+事件）/ `task2-stream`（streamValue，禁定时器）/ `task3-rollback`（store.commit/rollback）
- atelier 臂评分：`grade.mjs`（acceptance harness，机械评分，契约违规自动拦成 ATR-201 卡，硬禁词对源码全文正则）
- 计分（protocol.md）：`firstPass` = 第 1 个 attempt 的 grade.ok；`attempts` = 达到 ok 所需 attempt 数（上限 3）
- 实现修正：atelier 臂 attempt 的 `src/runtime` 用 junction 指向框架 runtime（vendored 拷贝会被 vite 视为独立模块实例 → 信号跨实例不追踪，评分假阴性；协议已注记）

## 2. 记分板（45 run）

| 臂 | task1 | task2 | task3 | 合计（首遍） |
|---|---|---|---|---|
| noskill | ✅✅✅✅✅ | ✅✅✅✅✅ | ✅✅✅✅✅ | 15/15 = 100% |
| skill | ✅✅✅✅✅ | ✅✅❌✅✅ | ✅✅✅✅✅ | 14/15 = 93.3% |
| react（rubric 10 分制） | ✅10×5 | ✅10×5 | ✅10×5 | 15/15 = 100%，全 10 分 |

唯一非首遍：`skill.task2-stream.r4` —— 实现（streamValue push/finish + 模板 each/if 渲染）完全合规，
但文件**头注释**里写了「硬禁手写 setInterval/setTimeout 打字机」字样，触发评分器对源码全文的
`/setInterval|setTimeout/` 硬禁正则 → 机械 FAIL；修复轮（attempts=2）仅改注释措辞后 PASS。
这是"禁令复述进注释"被机械检查误伤，不是流式能力缺陷。

`report.mjs` 官方输出：

```
noskill  runs=15  firstPass=100%
skill    runs=15  firstPass=93.3%
react    runs=15  firstPass=100%
§7 判定: PASS（绝对口径：skill 首遍 93.3% ≥ 60%）
```

## 3. 诚实解读（比判定本身更重要）

- **绝对口径 PASS，但任务集判别力失败（天花板效应），45 run 后依然成立**：三臂 100% / 93.3% / 100%，
  `skill − react` 仍为 0pt（甚至 −6.7pt，且该 6.7pt 来自注释正则误伤而非能力差异）。相对口径
  （≥+15pt）在此任务难度下不可能被测量。结论只能表述为：
  1. Atelier 的可推导性下限不弱：noskill 臂 15/15 首遍——仅凭源码+llms.txt 无一失败；
  2. 「小 DSL+技能包补偿分布外劣势」的核心假设（skill 臂显著优于 React 基线）**在当前任务层级
     既未被证实也未被证伪**——任务太简单，三臂都几乎无失误空间。
- 定性观察（有区分价值，跨 45 run 稳定复现）：
  - noskill 臂代理独立发现关键运行时约束（expr 求值器不支持箭头函数/赋值 → 须绑 locals 函数名；
    vite SSR transform 改内联函数名 → 须显式 opts.name；**store 快照按引用记录信号值 → mutate 必须
    整体替换数组而非原地 push，否则 rollback 跳过赋值**——r4/r5 两轮均被独立推出并写进自验）；
  - skill 臂代理严格走黄金模式（扁平契约三元共置、临时自检 spec 写完即删、样式守卫纳入自验）；
  - react 臂持续出现 `useSyncExternalStore` 级最优解（task2 五连），基线代理同样强势。
- 实验操作偏差（如实申报，见 §6）：wave-5 noskill.task2-stream.r5 首次派发时编排者误在 prompt 中
  追加了一句评分机制提示（偏离预制 prompt，构成污染），已废弃该次产物、目录复位后用预制 prompt
  原文重跑，账本只记重跑结果。

## 4. 下一步实验设计含义（写进路线图的依据）

要真正测量假设，需要**加难任务层级**（候选：嵌套作用域 + keyed each 复用 + 流式乐观更新组合的
"工具调用卡片"；跨组件状态事务；带 ATR-204 token 陷阱的样式任务），或引入**干扰面**（不给 runtime
源码、只给公开 CLI/错误输出）。当前三任务保留为「冒烟正控」层。

## 5. 基础设施事件记录（影响可信度的因素，如实申报）

- wave-1~3（2026-08-29）：子代理批跑高崩溃率——wave-1 首发 9 个死 4；wave-2 死 5/9；重试批全秒挂；
  降并发（≤3 → 最终 ≤1）后单发仍秒挂 → 判定基础设施问题而非负载问题。恢复模式：崩溃会话落盘
  `[ready]`，`send_message` 续跑可救回；个别"霉运会话"弃用换新鲜会话即成功。
- wave-4/5（2026-08-30 恢复）：**基础设施已自行恢复**——18 run 全部串行单发，0 崩溃 0 秒挂，
  无需 [ready] 续跑。两次基础设施状态的巨大差异本身即证据：此前的暂停判定（而非烧重试）是对的。
- **对数据有效性的影响**：所有崩溃都发生在评分前且产物按 attempt 目录隔离、评分器机械——
  45 条数据均不受崩溃影响；崩溃率若作为混淆变量，本记录即证据。

## 6. 恢复执行记录（wave-4/5，2026-08-30）

- 按 §6（原报告）方法串行派发，每轮 ≤1 并发；槽位顺序：task1 三臂 → task2 三臂 → task3 三臂，先 r4 后 r5。
- `noskill.task1-counter.r4`（暂停前 3 连秒挂的槽位）首单即成功，无需任何特殊处理。
- 派发后逐 run 机械评分（grade.mjs）+ react 臂 rubric 读源码评分，逐条 append 进 `runs.json`。
- 一次编排者失误（prompt 污染）与处置：noskill.task2-stream.r5 首派时误加了"评分器对源码全文
  正则检查"提示 → 判定污染 → 删除该次产物（组件文件 + install 产物），目录与干净骨架 diff 归零
  （仅剩 node_modules）→ 用预制 prompt 原文重派 → 机械评分 PASS 后才记账。被废弃的派发不计入任何统计。

## 7. 产物与账本

- 账本：`atelier/benchmarks/m3/results/runs.json`（45 条，含 react 臂 rubric 分数；skill.task2-stream.r4
  记 `firstPass=false, attempts=2`）
- 出数：`node atelier/benchmarks/m3/report.mjs --results atelier/benchmarks/m3/results/runs.json`
- 各 attempt 目录（`.dsh-trash/m3/<arm>.<task>.r<run>`）内含 `m3-grade.json` 评分工件
