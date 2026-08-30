# Atelier 技术缺口与改进 Backlog（2026-08-30 精简版）

> 本文件是缺口与改进队列唯一源。原始逐项规格与验收明细（P0-1~P0-8 / P1-1~9 / P2-1~6）已按
> 「完成即合并」原则归档，需要回溯时看 git 历史（精简前版本锚点：checkpoint `ff35100` 之前的提交）。

## 已完成（合并归档 · 2026-08-27 ~ 08-30 backlog-blitz 全清）

- **内核与编译器**：信号内核（deliver 双策略调度，修同步失效缺陷）· keyed each · Template AST 缓存 ·
  编译器三分期（dump→codegen，golden DOM 对拍，未知节点显式拒绝）· expr fuzz 差分对拍（抓出 ‖/&& 值语义
  bug）· 43 项 vitest。
- **dev 面**：SSE 命令下行 + ack · HMR 保态（51ms，$state 不清零）· 截图常驻实例（~300ms）·
  像素对比三档（MATCH / PIXMATCH / MISMATCH）· token 门禁 · audit JSONL。
- **M3 实验台**：三臂对照 45/45 收官（noskill 100% / skill 93.3% / react 100%；skill 的 −6.7pt 是注释正则
  误伤，修订评分器后三臂 15/15 全平）→ `results/WAVES-1-5-REPORT.md`。定论：天花板效应，核心假设待
  加难任务层；基础设施事件与 prompt 污染处置均如实入档。
- **工具链**：MCP 21/21 接线（stdio E2E）· review UI 最小版（timeline + 双图并排 + 判定写回）· CI 矩阵
  workflow · 结构六层检查 · checkpoint「未检不锚」门禁 · 决策 14 卫生化。
- **P0-8 评分器与 footgun 修复**：硬禁检查剥注释（双向 fixture，注释提及 PASS / 真用 FAIL）·
  expr 三路 ATR-301 前置报错（顺带修掉函数调用静默丢尾）· store 快照按引用语义三层护栏
  （runtime JSDoc + 应用模板守卫测试 + 技能包同步）。
- **性能四指标**：gzip 6.25KB / 10³ 节点挂载 2–3ms / HMR 51ms / 截图回环 ~300ms——全达标。
- **路线决策（2026-08-30，用户定论）**：技能包是核心竞争力、保留；先壮大框架功能（F 线），与 React 的
  对照对决后置。

## 活跃队列

### F 线 — 功能债（决策书承诺未兑现，壮大框架的主菜）

| # | 项 | 内容 | 估量 |
|---|---|---|---|
| F-1 | **事务层完整版（决策 5）** | ✅ **第一期落地（2026-08-30）**：命名合并（同名栈顶幂等锚定，rollback 回到本轮前）+ 增量 patch 事件日志（journal，有界环形可关）+ 依赖图可查询（`store.graph()`，dispose 即注销）。6 用例实证（含 limit 调小裁剪、跨名不合并、derived 出现在依赖边）。诚实边界：恢复仍走全量快照（正确性锚点）；MCP 暴露 graph/log 待接线。**剩余**：无（本期范围全清）；后续增强=回放恢复/编译期静态化归 F-2 | ✅ |
| F-2 | **编译器静态依赖图（决策 3）** | 依赖追踪由运行时移入编译期；快路径性能 + prod 剥离的地基 | L |
| F-3 | **样式纪律收紧（决策 16）** | 颜色试点 → 间距 / 字号纪律（随 recipe 层落地） | M |
| F-4 | **codegen 覆盖扩张** | 未知节点显式拒绝的边界逐步内移（扩一段模板子集，快路径多覆盖一分） | M |

### 设计备忘（半天级，按需触发）

- schema 按「仍扁平」原则扩展 min/max/pattern（无 $ref/oneOf 红线不动）；
- confirm 三档的 `deny` 补场景负例进 specs/；
- 决策 15 gate 接线：source_commit 由测试通过自动触发（接线点 cli.mjs）。

### 尾巴（诚实标注的已知项）

- 已存在应用需重新 vendor 同步，才能拿到 `state-discipline` 守卫测试与更新后的技能包；
- HMR 三边界：旧 effects 不逐个 dispose（dev-only 有界泄漏）/ 模板结构大改时按序还原可能错位 /
  跨交换 checkpoint 不回落新信号；
- CI snapshot-smoke job 已写、待首次运行验证；`atelier review` CLI 为占位；
- P1-9 baseline.png 视觉复核留待用户（`.dsh-trash/smoke-app/.atr/snapshots/`）。

### 挂起区（等 F 线里程碑后启动）

- M3 加难任务层 task4-6（候选见 `benchmarks/m3/results/WAVES-1-5-REPORT.md` §4）；
- 干扰面实验（不给源码只给 CLI/错误输出）——技能包价值（核心竞争力）的决定性检验。
