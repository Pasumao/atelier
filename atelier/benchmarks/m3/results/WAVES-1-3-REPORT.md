# M3 三臂对照实验 — wave-1~3 结果报告（2026-08-29，暂停于 27/45）

> 状态：wave-1/2/3（每臂 × 每任务 × 3 runs = 27 个独立代理会话）**全部完成并机械/rubric 评分**；
> wave-4/5 因**子代理基础设施持续秒挂**（单发也秒挂，见 §5）经用户指令暂停。恢复方法见 §6。

## 1. 设置摘要

- 三臂：`noskill`（仅 runtime 源码 + llms.txt）/ `skill`（+ 应用内 8 技能包副本）/ `react`（React18+Vite+TS 脚手架，rubric 人工评分）
- 三任务：`task1-counter`（契约+$state+事件）/ `task2-stream`（streamValue，禁定时器）/ `task3-rollback`（store.commit/rollback）
- atelier 臂评分：`grade.mjs`（acceptance harness，机械评分，契约违规自动拦成 ATR-201 卡）
- 实现修正：atelier 臂 attempt 的 `src/runtime` 用 junction 指向框架 runtime（vendored 拷贝会被 vite 视为独立模块实例 → 信号跨实例不追踪，评分假阴性；协议已注记）

## 2. 记分板（全部 firstPass=首遍即过，attempts=1）

| 臂 | task1 | task2 | task3 | 合计 |
|---|---|---|---|---|
| noskill | ✅✅✅ | ✅✅✅ | ✅✅✅ | 9/9 |
| skill | ✅✅✅ | ✅✅✅ | ✅✅✅ | 9/9 |
| react | ✅10 ✅10 ✅10 | ✅10 ✅10 ✅10 | ✅10 ✅10 ✅10 | 9/9 |

`report.mjs` 官方输出：

```
noskill  runs=9  firstPass=100%
skill    runs=9  firstPass=100%
react    runs=9  firstPass=100%
§7 判定: PASS（绝对口径：skill 首遍 100% ≥ 60%）
```

## 3. 诚实解读（比判定本身更重要）

- **绝对口径 PASS，但任务集判别力失败（天花板效应）**：三臂全部 100%，`skill − react = 0pt`——
  相对口径（≥+15pt）在此任务难度下**不可能被测量**。结论只能表述为：
  1. Atelier 的可推导性下限不弱：noskill 臂仅凭源码+llms.txt 即 100% 首遍；
  2. 「小 DSL+技能包补偿分布外劣势」的核心假设（skill 臂显著优于 React 基线）**尚未被证实也未被证伪**——
     任务太简单，三臂都无失误空间。
- 定性观察（有区分价值）：
  - noskill 臂代理独立发现了关键运行时约束（expr 求值器不支持箭头函数/赋值 → 须绑 locals 函数名；vite SSR transform 改内联函数名 → 须显式 opts.name），并在交付语中正确引用 ATR-201 契约错误语义；
  - skill 臂代理严格走黄金模式（扁平契约三元共置、临时自检 spec 写完即删、样式守卫纳入自验）；
  - react 臂出现 `useSyncExternalStore` 级最优解——基线代理同样强势。

## 4. 下一步实验设计含义（写进路线图的依据）

要真正测量假设，需要**加难任务层级**（候选：嵌套作用域 + keyed each 复用 + 流式乐观更新组合的"工具调用卡片"；跨组件状态事务；带 ATR-204 token 陷阱的样式任务），或引入**干扰面**（不给 runtime 源码、只给公开 CLI/错误输出）。当前三任务保留为「冒烟正控」层。

## 5. 基础设施事件记录（影响可信度的因素，如实申报）

- 子代理批跑高崩溃率：wave-1 首发 9 个死 4；wave-2 死 5/9；重试批全秒挂。恢复模式：崩溃会话落盘 `[ready]`，`send_message` 续跑可救回；个别"霉运会话"（3 连挂零产出，如 ae29a2af、c06ea74f/e5e21767）弃用换新鲜会话即成功。
- 用户中途指令降并发（≤3 → 最终 ≤1），降并发后单发仍秒挂 → 判定为**基础设施问题而非负载问题**。
- **对数据有效性的影响**：崩溃都发生在评分前且产物按 attempt 目录隔离、评分器机械——27 条数据不受影响；但若后续统计需要"崩溃率"作为混淆变量，本记录即证据。

## 6. 恢复方法（wave-4/5）

```
# 目录与 prompt 已全部预制：.dsh-trash/m3/<arm>.<task>.r4|r5（atelier 臂含 runtime junction + 技能包）
# prompt：.dsh-trash/m3/prompts/<arm>.<task>.r<run>.prompt.txt
# 派发（每轮 ≤1-2 并发，崩溃→续跑 1 次→仍挂则换新会话）：
读取 D:\Agentic\.dsh-trash\m3\prompts\noskill.task1-counter.r4.prompt.txt ...（子代理短 prompt）
# 评分：node atelier/benchmarks/m3/grade.mjs --task <id> --attempt .dsh-trash/m3/<dir>
# react 臂：读组件源码按 brief 内 rubric 评分（≥8 pass），记 score
# 账本：atelier/benchmarks/m3/results/runs.json（append）；出数：report.mjs
```

产物工件目录：`atelier/benchmarks/m3/results/`（runs.json + 本报告）；各 attempt 目录内 `m3-grade.json`。
