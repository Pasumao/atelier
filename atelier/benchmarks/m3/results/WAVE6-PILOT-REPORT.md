# Wave-6 先导波报告（PILOT · task4-6 三臂 · n=1/cell）

> **样本量诚实声明**：本波每格 n=1（共 9 run），**不构成任何统计结论**——protocol §首遍正确率
> 要求每臂×每任务×≥5 runs。本波目的是：验证逐臂执行管线可跑通、抓评分器/任务书歧义、产出首批
> 观察信号。§7 判定输出为 N/A（report.mjs 诚实拒绝），正确性主张克制条款全程适用。
> 执行方式：每 run 一个独立子代理会话（noskill 臂仅任务书原文；skill 臂任务书+应用内技能包；
> react 臂同任务书 React 转译），react 臂由独立评审代理盲评 rubric（评分者≠编排者）。

## 记分板（9 run）

| 臂 | firstPass | 明细 |
|---|---|---|
| noskill | 3/3 | task4/5/6 全 PASS（机械评分） |
| skill | 2/3 | task4 FAIL（见发现①）；task5/6 PASS |
| react | 3/3 | 盲评 9 / 8.5 / 9.5（≥8 计 pass） |

数据：`runs-wave6-pilot.json`（report.mjs 判定：N/A — 数据不足，诚实拒绝出结论）。

## 发现（先导波的真实产出）

1. **任务书歧义被负例式抓出**：skill 臂把 `runDemo` 实现为异步间隔推送（20ms/行）——完全合法的
   流式语义，但 harness 在挂载后立即断言卡片存在 ⇒ FAIL。brief 的"依次 push 恰好三行后 finish()"
   未限定同步/异步。**整改**：brief v2 需明确"push 同步完成后 finish()（评分 harness 同步断言）"，
   或 harness 改为等待流 finish。此发现先于三臂正式出数抓到 = 先导波价值实证。
2. **管线验证**：attempt 目录 + junction + 子代理单发（并发上限实测 ~2，11 并发全拒后改串行对跑）
   + 机械评分 + 盲评 rubric 全链路走通；RUNBOOK §5 的评分独立性要求（盲评）已实证可行。
3. **观察信号（不作主张）**：noskill 全过的"天花板"苗头在加难层仍有迹象（n=1 不可引用）；
   skill 臂唯一 FAIL 恰是行为差异（异步流）而非能力缺失——提醒判据要区分"错误"与"合法但
   不合 harness 预设"。

## 后续

- brief v2 消歧（task4 同步语义写明）→ 正式波：每臂×每任务×5 runs（45 run/波，跨会话执行）；
- react 臂盲评流程沿用本波（独立评审代理 + rubric）；
- 所有引用本波数据的场合必须带 "PILOT n=1/cell" 限定语。
