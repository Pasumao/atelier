# Wave-7 正式波报告（FORMAL · task4-6 三臂 · n=5/cell，共 45 run）

> **样本量诚实声明**：每格 n=5、每臂聚合 n=15，二值（首遍过/不过）计分。每臂 15/15 的
> Wilson 95% 置信区间 ≈ [79.6%, 100%]，每格 5/5 ≈ [56.6%, 100%]——区间宽于 ±15pt 判据，
> 一切结论按此克制措辞，禁止把小样本差异写成定论（RUNBOOK §5 措辞纪律）。
> 出数前置（2026-09-06，先于任何 run）：负控机检 6/6 抓住（`negative-check.mjs` exit 0）
> + 六正控回归 6/6 PASS。react 臂盲评由独立评审代理执行（评分者 ≠ 编排者，rubric 只见源码）。

## 执行方式（与 RUNBOOK 的偏差记录）

- 每 run = 全新独立子代理会话 + 全新 attempt 目录（`.m3-runs/wave7/<arm>.<task>.r<N>`），
  prompt = brief v2 原文，零追加；评分串行，与先导波同款纪律。
- **偏差**：RUNBOOK §0 写"串行单发"；本波经编排授权改为**最多 3 路并发批处理**
  （同批 run 互不同目录不共享状态，评分/盲评/入账仍串行）。全程无崩溃、无污染。
- 两会话因平台限额/超时中断（skill.task4.r5、skill.task5.r1），均按协议**废弃 attempt、
  全新重跑**（中断会话的半成品与遗留 dev server 进程已清理，不计入任何 run）。
- atelier 两臂 attempt 的 `src/runtime` 为 junction 指框架 runtime（协议实现注记）；
  noskill 臂会话无技能可见性（init `--no-ai`，无 .dsh/、AGENTS.md、skills/）。

## 记分板（45 run，全部 attempts=1，零返工轮）

| 臂 | task4 | task5 | task6 | 合计 firstPass |
|---|---|---|---|---|
| noskill（机械评分） | 5/5 | 5/5 | 5/5 | **15/15（100%）** |
| skill（机械评分） | 5/5 | 5/5 | 5/5 | **15/15（100%）** |
| react（盲评 rubric ≥8 计过） | 5/5（10×5） | 5/5（10×5） | 5/5（10,9,9,10,9） | **15/15（100%）** |

数据：`runs-wave7-formal.json`（report.mjs 判定见下）。atelier 两臂每 attempt 留有
`m3-grade.json` 评分工件；react 臂盲评分与理由见各 attempt 对应评审记录（入账字段 rubricScore）。

## §7 判定（protocol 口径）

    noskill  runs=15  firstPass=100%
    skill    runs=15  firstPass=100%
    react    runs=15  firstPass=100%
    §7 判定: PASS（绝对口径：skill 首遍 100% ≥ 60%）

## 诚实解读（本报告的真实产出）

1. **天花板在加难层复现**：三臂全 100% 全平，skill − react = 0pt，相对口径（≥+15pt）不成立。
   绝对口径 PASS 是"基线模型能力已覆盖本任务层"的陈述，**不是**技能包价值的证据。
2. **生死判据 1（ROADMAP §7，锐评口径）走向"定论破产"侧**：skill−react ≥ +15pt 未成立，
   "技能包是核心竞争力"定论在加难层未获得数据支点。按既定安排：D-1 已立项的
   **P3-3 技能包混合实验启动条件已满足**（正式波数据已出）；**P3-2 干扰面实验**（不给源码、
   只给 CLI/错误输出）成为技能包价值的下一个决定性检验；路线权重按 protocol §7 约定
   向工具链/编译器与实验链（P3-2/P3-3）倾斜。
3. **区分度诊断**：45 run 零返工轮（全部 attempts=1），noskill 与 skill 臂在机械评分下
   无一失败——当前 task4-6 在本基线模型能力下已无区分力。后续若重启正确率类实验，
   需要比 task4-6 更高一档的任务层（或把判据移到干扰面/混合维度），否则数据必然全平。
4. **react 臂观察（非主张）**：rubric 全过但质量有层次——task6 的 r2/r3/r5 交付了任务书
   三件套但应用不可运行（缺入口/runtime vendor，评审员如实扣至 9 分仍过 ≥8 线）；
   atelier 臂同任务全部经行为断言机械评分通过。这提示 rubric 主观分与机械分的不对称
   依然存在（RUNBOOK §5 的评分独立性只是缓解，未消除）。

## 有效性红线自查（RUNBOOK §4）

- [x] 每 run 独立会话、独立 attempt 目录（并发批内亦然）
- [x] prompt = brief v2 原文，零追加（两处中断按废弃重来处置）
- [x] noskill 臂零技能可见性
- [x] src/runtime junction 已做（atelier 两臂）
- [x] m3-grade.json 留在每个 atelier 臂 attempt 目录
- [x] runs.json 只追加不改写（m3-ledger.mjs 拒绝同格覆写）；报告引用与账本一致

## 后续

- P3-2 干扰面实验：启动条件已就绪（本波出数完成），执行方式沿用三臂纪律（RUNBOOK 同款）。
- P3-3 混合实验（D-1）：启动条件已满足，与 P3-2 共同回答"技能包价值"两面。
- 所有引用本波数据的场合必须带 "FORMAL n=5/cell、区间宽于判据" 限定语。
