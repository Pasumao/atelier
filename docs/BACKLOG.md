# Atelier 技术缺口与改进 Backlog（2026-08-27 快照）

> 来源：v0.2 全仓盘点 + TECH-COMPARISON 借力清单 + 自查发现的诚实性问题。
> 分级：**P0 = 不做则核心承诺落空 · P1 = 结构性提升 · P2 = 增强**。
> 估量：S(半天) / M(1-3天) / L(一周+)。每项含「问题 → 技术 → 验收」。

---

## P0 — 承诺落空区（先还债再谈增长）

### P0-1 页面↔dev 命令下行通道 ★当前最大虚假面
- **问题**：state/checkpoint 能力活在页面进程内，dev 面只做了单向推送桥——wire 上 `checkpoint.rollback/time_travel` 等标 implemented 实为不可达（已在本快照修正为 pending，live 口径 8→5）。
- **技术**：dev 面 SSE 端点 `/__atelier/bridge/commands`（零依赖：`res.write` 持续流 + 模块级命令队列）；页面 bridge 注册 `EventSource` 监听 `{op:"rollback"|"time_travel", args}` → 调 store → POST ack；MCP dispatch 入队。顺带打通 `snapshot promote` 与未来 `audit` 事件流。
- **验收**：MCP `checkpoint.rollback` 在无头实例上真实改变 `state.snapshot` 返回值；双向各一条断言。

### P0-2 编译器 MVP（决策 3 的 0% 现状）
- **问题**：H1「仅编译器改写调用图」完全未启动；静态依赖图、模板优化全部缺席——框架的头号差异化承诺停留在解释器。
- **技术分期**：① Template 解析结果缓存 + AST dump（编译器的地基，本身就是 P1 性能项）② .atr.ts → 展开模板 AST 到 JSON③ 代码生成器输出静态 effect 图。每期独立可合。
- **验收**：demo 组件经管线后运行时不再 tokenize；产物行为与解释器逐帧一致（golden DOM diff）。

### P0-3 M3 首遍正确率对照实验
- **问题**：「小 DSL+技能包可补偿分布外劣势」是立项最大假设，至今 0 数据；不测=整个 agent-first 论点悬空。
- **技术**：同一任务组（新组件/流式卡片/状态回滚）×（无 skill / 有 skill / React 基线）三臂；记录首遍正确率与返工次数。
- **验收**：SPEC §7 判据出数（≥ +15pt 或 ≥60%）——无论正负都改写路线图权重。

### P0-4 性能基线台
- **问题**：§7 四指标一个没测；docs 里所有性能叙述目前都是推断。
- **技术**：bench 脚本：10³ 节点 mount/P500、HMR 保存到可见延迟（Performance API + CDP 时间戳）、gzip -9 尺寸表。
- **验收**：四个数字进 README；不达标的项自动转成 P0 修复工单（预期 each 渲染最先爆）。

---

## P1 — 结构性提升

| # | 项 | 问题 → 技术 | 估量 |
|---|---|---|---|
| P1-1 | **keyed each reconcile** | 全清重建 O(n)·大列表痛点 → 最长递增子序列算法（Vue 公开实现思路），支持 `key(expr)` | M |
| P1-2 | **Template 解析缓存** | 同一组件重挂重解析 → 以 strings 数组为 key 缓存 AST（lit-html 思路），同时为 P0-2 打底 | S |
| P1-3 | **表达式求值器测试+fuzz** | expr.ts 是手写 parser 安全面 → 单测全运算符矩阵 + 差分 fuzz（同义 JS eval 对拍于 Node 子进程内白名单样本） | S |
| P1-4 | **vitest 接入 + 四模块单测** | 全仓零自动化测试（smoke 都是即焚脚本）→ core/template/contract/expr 各建用例集，进 CI | M |
| P1-5 | **HMR 保态验证** | .atr.ts 热替换大概率重建组件→$state 清零 = agent 迭代体验断裂 → 先实验定性，若丢态做 acceptHMR 式信号保留 | M |
| P1-6 | **audit.log 最小实现** | 决策12承诺全部写操作入审计，现无任何落地 → dev 面 JSONL（时间/op/root/files）+ MCP 读端 | S |
| P1-7 | **requireToken 实现** | config 有字段无实现 → dev 一次性 token 注入 + 中间件校验（agent 配置从 init 输出物取 token） | S |
| P1-8 | **像素级快照对比** | sha256 字节对比太脆（字体抗锯齿即抖动）→ 复用截图 headless 实例内 canvas evaluate 计 mismatchRatio（零 npm 依赖），阈值进 config | M |
| P1-9 | **契约路径充实 demo** | DeepSeekIntro 空 props 挂载，ATR-201 校验路径几乎未锻炼 → 加一个带 reqProps+错误注入的演示页 | S |

---

## P2 — 增强

- **P2-1 错误边界泛化**：errBox fallback 目前仅覆盖未知组件（template.ts:334）；表达式运行时抛错应同样渲染 ATR 卡片而非冒泡白屏（S）
- **P2-2 baseline 提交守卫**：snapshot.mjs 与 checkpoint.source_commit 门禁联动（未检不锚）（S）
- **P2-3 skill 触发器自动化**：structure.map 输出携带「建议加载包」字段，由 agent 端路由消费，替代纯文本触发词（S）
- **P2-4 CI 矩阵**：GitHub Actions windows/ubuntu × node LTS，跑 check-skills/snapshot/struct/vitest（M）
- **P2-5 review UI 原型**：spec L5 最小版（timeline + 双图并排 + approve/disapprove 写回 specs/）（L）
- **P2-6 决策14 卫生化**：映射表中遗留 fnh 引用清点归档（XS）

## 设计层面备忘（非执行项）

- schema 表达力边界：需要 min/max/pattern 时按「仍扁平」原则扩展，坚守无 $ref/oneOf 红线
- confirm 三档中 `deny` 无场景示例；specs/ 里补一节负例
- 双轨回滚的 source_commit 应由 P1-4 测试通过自动触发（决策15 原文 gate），接线点在 cli.mjs
