# M3 三臂对照实验台（P0-3 / SPEC §7「agent 正确性」）

> 立项最大假设：「小 DSL + 技能包可补偿分布外劣势」。本实验台把它变成可测量命题。
> **诚实边界**：本目录自动化的是【评分】与【出数】；三臂的 agent 运行由人或 AI 会话按本协议
> 逐臂执行（每一臂都是独立会话，本仓库无法在会话内部可信地模拟"无技能代理"）。

## 臂（arms）

| 臂 | 设置 | 评分方式 |
|---|---|---|
| `noskill` | Atelier 应用 + init 产物；**不加载任何 atelier skill**，只给任务书 | harness 自动（acceptance.spec.ts） |
| `skill` | 同上 + `atelier skills install`（8 包全装，代理按触发词加载） | harness 自动（同一评分器） |
| `react` | `pnpm create vite --template react-ts` 等价脚手架；同一任务书 | rubric 人工/模型评分（briefs 内嵌，10 分制；≥8 分计 pass） |

## 任务组（tasks/，与框架耦合度递进）

1. `task1-counter` — 新组件：props 契约 + $state + 事件（自动评分）
2. `task2-stream` — 流式卡片：streamValue push/finish（自动评分 + 源码禁打字机检查）
3. `task3-rollback` — 状态回滚：store.commit/rollback 可视化（自动评分）

### 加难层（P3-1 转正；任务层落地 2026-08-31，六正控回归 2026-09-04 全绿；天花板效应的解药）

4. `task4-agent-cards` — 工具调用卡片：流式输入 + $derived 解析 + keyed each 按 id 复用 + {:else if} 状态徽标 + 迟到推送（自动评分：含乱序流顺序断言）
5. `task5-txn-board` — 跨组件状态事务：父子组合（registry 接线）+ 对象字面量 props + store commit/add/rollback；子组件禁 $state（静态检查）（自动评分）
6. `task6-token-discipline` — 样式纪律陷阱：config 增补语义 token + scoped 逃生舱登记 + ATR-204 运行时校验（harness 以 attempt 配置 initTokens 后挂载，引用未定义 token = 错误卡 = fail）（自动评分：多文件产出）

难度递进 rationale：task1-3 单文件单机制（冒烟正控层，已知全平）；task4-6 要求多机制组合/多文件纪律/
对守卫文档的阅读理解——预期拉开 skill 臂与 noskill/react 臂差距，使 §7 判据重新有效。
`reference/` 六分任务参考解为正控样本：**改评分器后必跑六正控回归**（grade.mjs 逐个 PASS）。

## 首遍正确率（first-pass rate）与返工

- 一次 run = 一个全新臂会话完成任务书，产出 attempt 目录（约定布局见 briefs）。
- 评分：`node atelier/benchmarks/m3/grade.mjs --task <id> --attempt <dir>`——写 `<attempt>/m3-grade.json`。
- `firstPass` = 第 1 个 attempt 的 grade.ok；`attempts` = 达到 ok 所需 attempt 数（上限 3，封顶记 3）。
- 每臂 × 每任务 × ≥5 runs 才有统计意义；run 记录汇总进 `results.json`（schema 见 report.mjs 头注）。

## §7 判据（出数后改写路线图权重，无论正负）

- 绝对口径：`skill` 臂首遍正确率 ≥ 60%。
- 相对口径：`skill` − `react` ≥ +15pt。
- 达到任一 → agent-first 论点获得数据支撑；双不达 → 假设降级，路线图向工具链/编译器倾斜。

## 运行

    node atelier/benchmarks/m3/grade.mjs --task task1-counter --attempt <dir>   # 评一个 attempt
    node atelier/benchmarks/m3/report.mjs --results <dir|file>                  # 汇总出数 + §7 判定

`reference/` 内有三分任务的参考解（**正控样本**：评分器必须给 pass；改动评分器后必跑正控回归）。

> 实现注记（2026-08-29）：atelier 臂 attempt 的 src/runtime 以 junction 指向框架 atelier/runtime（同一份实现），保证评分 harness 单一模块实例——vendored 拷贝会被 vite 视为独立模块，导致跨实例信号不追踪（对受控代理透明，不影响臂设定）。
