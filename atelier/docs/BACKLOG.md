# Atelier 技术缺口与改进 Backlog（2026-08-27 快照）

> **进度面板（backlog-blitz 回合后）**
> | 项 | 状态 |
> |---|---|
> | P0-1 命令下行通道 | ✅ SSE→页面执行→ack 全链实证（checkpoint.list/time_travel/rollback 五断言过）；live 9→12/21 |
> | P0-2 编译器 MVP | ✅ 三分期全落地：①Template 缓存（随 P1-2）②**AST dump ✅（atelier/compiler/dump.mjs：单解析器同源、scanner 模式栈、dump↔parseTemplate 同树断言）** ③**代码生成 ✅（2026-08-29，atelier/compiler/codegen.mjs）：AST → 零 import 静态 effect 图模块（直线 createElement + 定点 $effect 接线，运行时能力经 ctx.rt=__compiledRT 注入，与解释器同函数）；runtime 按 raw 精确命中 compiledByRaw → 该组件零 tokenize。验收双实证：vitest golden DOM diff（micro-DOM shim，6 模板用例含 keyed 重排/事件/契约错误卡，39/39 绿）+ 应用级 P2-2 门禁 MATCH（smoke-app 真接线 HelloCard+ContractProbe，ratio 0 ≤ 0.01）。CLI：dump --root → codegen --ast；诚实边界：codegen 覆盖 text/expr/element/if/each 全解释器子集，未知节点 ATR-1xx-codegen 显式拒绝（无静默降级）** |
> | P0-3 M3 实验台 | ✅ 实验台落地（2026-08-29，atelier/benchmarks/m3/）：protocol.md（三臂定义：noskill/skill/react + 首遍/返工计分规则 + §7 判据）× 3 任务书（counter/stream/rollback，atelier 臂自动评分 + react 臂 rubric 人工评分）+ grade.mjs（acceptance harness：契约违规→ATR-201 卡→fail，禁打字机源码检查，BOM 容忍）+ report.mjs（每臂首遍率 + §7 三分支判定）+ reference/ 三任务参考解。**评分器正控回归 3/3 PASS、负控（错组件）结构化拒绝 ✓**。诚实边界：本台自动化评分与出数；三臂 agent 运行按 protocol 由独立会话执行。**全量实测收官（wave-1~3 共 27 run 于 2026-08-29 + wave-4/5 共 18 run 于 2026-08-30 恢复后串行完成，45/45）：report.mjs 官方出数——noskill 15/15=100% / skill 14/15=93.3% / react 15/15=100%（rubric 全 10 分），§7 绝对口径 PASS。唯一非首遍 skill.task2-stream.r4：实现合规但头注释复述禁令字样触发硬禁正则误伤，修复轮（attempts=2）仅改注释后 PASS。天花板效应 45 run 后依然成立（skill−react=0pt，−6.7pt 来自注释正则误伤而非能力差异），相对口径（skill−react≥+15pt）在此难度不可测——核心假设「未被证实亦未被证伪」，需加难任务层级或干扰面（见 results/WAVES-1-5-REPORT.md §4）。基础设施事件如实申报：wave-1~3 批跑高崩溃（判定为基础设施问题而暂停正确——wave-4/5 恢复日 18 run 串行 0 崩溃）；一次编排者 prompt 污染（noskill.task2 r5）已废弃重跑，账本只记干净数据** |
> | P0-4 性能基线台 | ✅ `atelier bench`（scripts/bench.mjs）：四指标实测进 README——gzip 6.25KB ✔ / 10³ 节点挂载 2–2.9ms ✔ / HMR 46–61ms ✔（P0-5 修复）/ 截图回环 298–304ms ✔（P0-6 修复）；四项全 PASS（2026-08-29 复测） |
> | **P0-5（新）HMR 保态与提速** | ✅ dev 插件 transform 给 *.atr.ts 注入 `import.meta.hot.accept` → runtime 保值热交换（活实例登记 + 栈式信号收集 + 重挂载按序还原值）。实测：编辑可见 108ms→**51ms**，**$state 不再清零**（点击 count:3 → 改源码 → count:3 实证）。已知边界（诚实标注）：旧树 effects 不逐个 dispose（dev-only 有界泄漏）；模板结构大改时按序还原可能错位（多出新信号保持初值）；跨交换的旧 checkpoint 不回落新信号 |
> | **P0-6（新）截图回环持久实例** | ✅ dev-screenshot.mjs 常驻会话：同一 tab 重新导航捕获（共享序列 captureOnSession 单一来源），崩溃/挂起自愈——复用前 2s 活性探针 + child exit/ws close 双死亡信号 → 销毁重建仅重试一次；进程 exit 同步 kill 防孤儿浏览器；跨拍陈旧 loadEventFired 事件清理（复用场景独有坑）。实测：温拍 1937→**298–304ms** ✔ 达标、P1-8 像素对比走常驻路径 MATCH（ratio 0）、杀 16 个无头进程后下一拍自愈重建并拍出正确图；瞬态 `capturePage` 保留为兼容 API，`ATELIER_SHOT_PORT` 可换端口（默认 9345） |
| **P0-7（新）MCP pending×5 转绿** | ✅ 21/21 全接线（mcp-definitions v0.2.0）：`state.get`（sig-N 路径解析 + ATR-401 诚实报错）/ `docs.search`（框架 docs+skills+AGENTS.md+llms.txt 语料 top-5）/ `test.run`（pnpm test=vitest run 同表面，180s 上限，smoke 实测 14/14）/ `diff.report`（vs 最近 source checkpoint，落盘 .atelier/diff-report.md）/ `feedback.read`（specs/feedback.jsonl + *.feedback.md 约定，与 P2-5 review UI 同格式）；五工具 stdio JSON-RPC E2E 实证；ARCHITECTURE/SKILLS-PLAN 口径同步，check-skills 31/31 |
> | P1-1 keyed each | ✅ `{#each … by keyExpr}` reconcile 落地（无 by 保持旧语义） |
> | P1-2 Template 缓存 | ✅ strings-key AST 缓存（容量 500 兜底清空） |
> | P1-3 expr fuzz-lite | ✅ vitest 差分对拍 200 样本 + 运算符矩阵；**抓出并修复 ‖/&& 值语义 bug** |
> | P1-4 vitest 接入 | ✅ **26/26 绿**（core/contract/primitives/expr）；`pnpm test` |
> | P1-5 HMR 保态实验 | ✅ 实验定性完成（2026-08-28 实测）：starter 组件未接 HMR accept → 编辑 .atr.ts 走整页 reload（108ms 可见），**$state 必然清零**（点击 count:3 → 改源码 → count:0 实证）。按验收标准转为修复工单 → **P0-5** |
> | P1-6 audit.log | ✅ JSONL 入账（写路由/命令 enqueue/ack/截图）+ MCP 尾读工具 |
> | P1-7 requireToken | ✅ UUID 门禁 401 断言过；transformIndexHtml 注入页面；.atelier/dev-token 供工具读取 |
> | P1-8 像素级对比 | ✅ 截图端点 `?compare=1`：同一无头实例内 canvas evaluate 逐像素归一化距离（零 npm 依赖）；阈值 `atelier.config.json → snapshot.mismatchThreshold`（模板 0.01）；判定三档 MATCH / **PIXMATCH**（字节差但像素比 ≤ 阈值，字体抗锯齿不算回归）/ MISMATCH（报像素比）；门禁回执同步接受 PIXMATCH。实测：单字改动 3.23e-3 ✔ 通过、整行删除 5.93e-2 ✔ 拒绝 |
> | P1-9 契约 demo | ✅ 模板新增 ContractProbe 三元共置组件（reqProps title+level）+ main.ts 双实例演示段：合法实例 + 缺 level 违规实例（ATR-201 错误卡，P2-1 边界兜底）；spec 4 例机检绿；init→install→test 14/14 绿；snapshot 管线实机 MATCH。【视觉复核留待用户：.dsh-trash/smoke-app/.atr/snapshots/baseline.png】 |
> | P2-1 错误边界泛化 | ✅ bindExpr catch→错误卡文本 / mount 层兜底 / flush 循环保活 + __ATELIER_LAST_ERROR__ 暴露 |
> | P2-2 baseline 提交守卫 | ✅ checkpoint save 锚前实拍比对（未检不锚：MISMATCH 拒绝锚定，实机三路径验证：新回执快速通道/实拍 MATCH 放行/可见改动实拍 MISMATCH 拒绝 exit 1）；`--no-gate`/env 逃生口；快照回执含源码指纹（陈旧回执不放行）；**连带把 MCP `checkpoint.source_commit/source_list/source_rollback` 三件从 pending 转绿**（同代码路径，已 e2e 实证） |
> | P2-3 skill 触发器自动化 | ✅ structure.map 输出携带 `suggestSkills` 字段（信号驱动：组件/流式/状态/测试/dev 面各自触发，有界扫描 ≤30 文件）；CLI 人读/JSON 与 MCP structure.map 同源 |
> | P2-4 CI 矩阵 | ✅ workflow 已写（.github/workflows/ci.yml）：ubuntu/windows × node 22/24 跑 vitest/check-skills/struct check/init smoke；另加 snapshot-smoke job（dev 面→截图→P2-2 门禁锚定全链，continue-on-error 诚实标注，待首次 CI 运行验证） |
> | P2-5 review UI | ✅ spec L5 最小版落地（2026-08-29）：dev 面 `/__atelier/review`（自包含 HTML，token 注入）——checkpoint timeline（读 state-snapshot 桥缓存）+ 双图并排（`/__atelier/snapshot-image?name=baseline\|current`，白名单外 404 防穿越）+ Fresh capture（走 P0-6 常驻实例端点）+ Approve/Disapprove 写回 `specs/feedback.jsonl`（`/__atelier/feedback` POST，审计入账；历史 `feedback-history`）。与 MCP `feedback.read` 同一落盘约定（e2e 实测：POST→磁盘→MCP 可读同 schema）；`atelier review` CLI 仍是占位（打开浏览器属增强，非本最小版范围） |
> | P2-6 决策14 卫生化 | ✅ 全仓清点（含隐藏目录）活体 fnh 引用 = 0；决策 14 映射表降级为历史归档，别名兼容期确认关闭 |
>
> **额外收获**：内核同步失效缺陷修复（derived 写后同 tick stale → 订阅模型重构为 deliver() 双策略分发）；‖/&& 从布尔改回 JS 值语义；ATR-205 与实现对齐；TRUST_GITIGNORE/幽灵注册表在实战各抓一例。
> 诚实性修正：checkpoint 三件曾虚标 implemented，本轮真正转绿（见 P0-1）。

---

# 原始条目（保留作为详细规格）

> 来源：v0.2 全仓盘点 + TECH-COMPARISON 借力清单 + 自查发现的诚实性问题。
> 分级：**P0 = 不做则核心承诺落空 · P1 = 结构性提升 · P2 = 增强**。
> 估量：S(半天) / M(1-3天) / L(一周+)。每项含「问题 → 技术 → 验收」。

---

## P0 — 承诺落空区（先还债再谈增长）

### P0-1 页面↔dev 命令下行通道 ★当前最大虚假面
- **问题**：state/checkpoint 能力活在页面进程内，dev 面只做了单向推送桥——wire 上 `checkpoint.rollback/time_travel` 等曾标 implemented 实为不可达（已在本快照修正为 pending；勘误：此前文档称 live 12/22 系口径虚高，wire 实达 **9/21**；锚点 8831edf 提交说明中"live 8→5"同为笔误）。
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
