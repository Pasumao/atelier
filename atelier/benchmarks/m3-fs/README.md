# m3-fs — M3-FS 全栈三臂对照实验台（FS-10 · 已武装，出数前过 RUNBOOK §5 前置门）

> FS-10 两半均已落地（2026-09-20 集成批）：设计先行半（协议/任务书/RUNBOOK）+ 执行半
> （基线装配脚本×2、grade 评分器×2 + S/R/C/T 场景 harness×2、atelier 臂正控参考解×3、
> 负控 fixtures×7 与 negative-check 前置门、report.mjs、对照臂转译件×3、对照臂正控参考解×3）。
> 集成认证：官方基线×参考解×评分器 正控 9/9 + 9/9 + 16/16 全 PASS（atelier 臂）、
> 8/8 + 8/8×2 + 18/18 全 PASS（next 臂，红证 M2/M3/M8 与 R2/R3 定向不误伤）、负控 7/7 全红；
> 框架回归 380 绿 + 8 skip、check-skills 56/0、api-diff PASS、docs-numbers PASS。
> 拍板记录：D-F21 对照臂 = Next.js（按 protocol §1.1 建议采纳）；D-F22 相对 ≥+15pt 为主 +
> 绝对 ≥60% 副之；D-F23 rubric 降诊断件；D-F24 task3 v1 不叠加 gen auth（观察位保留）。
> 判据观察留档（不阻断出数，引用判据时须知）：next/README §8.3 三枚（M1 探针脆弱窗口/
> M2 冻结 manifest 严于 brief 文面/R2 from:2xx 口径下同步广播竞态——参考解以 next `after()`
> 稳定通过）。

## 导航

| 文件 | 内容 | 状态 |
|---|---|---|
| [protocol.md](protocol.md) | 三臂协议书：臂设计（Next.js 已拍板落地 + §1.1 对表论证）、预接线基线、任务设计原则、评分器开放协议（判据类别表/四角分离/Wilson 强制口径）、§6 判据 | v0.1（执行半注记已并入） |
| [tasks/task1.brief.md](tasks/task1.brief.md) | 基础跨端：一列的全链路传播（契约→迁移→端点→前端→门禁） | v2（评审消歧 + 评分驱动约定） |
| [tasks/task2.brief.md](tasks/task2.brief.md) | live 对账考点：live 端点 + emits 失效 + §4.5 五步对账协议含 revert | v2（同上） |
| [tasks/task3.brief.md](tasks/task3.brief.md) | 加难组合：种子缺陷自救（ATR-331/332）+ task1+2 叠加 | v2（同上） |
| [harness/scenario-spec.md](harness/scenario-spec.md) | 场景规格单一文档（三臂语义同文锚：断言窗口/DOM 钩子契约/判据↔类别映射） | ✅ 执行半 |
| [harness/acceptance.spec.ts](harness/acceptance.spec.ts) | R 类（真实 server SSE 黑盒）× C 类（dom-shim 对账）判据实现 | ✅ 执行半 |
| [grade.mjs](grade.mjs) / [next/grade-next.mjs](next/grade-next.mjs) | 评分 CLI（S/R/C/T 全类；grade.json 落 attempt 目录） | ✅ 执行半 |
| [setup-baseline-atelier.mjs](setup-baseline-atelier.mjs) / [next/setup-baseline-next.mjs](next/setup-baseline-next.mjs) | 预接线基线装配（`--variant task3` 缺陷注入；`--no-ai` noskill 形态） | ✅ 执行半 |
| [reference/](reference/) | atelier 臂正控参考解×3（overlay + solution.md 判据自查表） | ✅ 已认证 |
| [next/reference/](next/reference/) | 对照臂正控参考解×3 | ✅ 已认证（8/8+8/8×2+18/18；判据观察留档 README §8.3） |
| [harness/fixtures/negative/](harness/fixtures/negative/) + [negative-check.mjs](negative-check.mjs) | 负控×7（冻结参考解 + 单点变异）+ 前置门（失败集须与 manifest 恰好一致） | ✅ 7/7 全红 |
| [report.mjs](report.mjs) | 三臂出数 + §6 判定（n<5→N/A；相对主判据+绝对副判据；Wilson 限定语强制） | ✅ 执行半 |
| [RUNBOOK.md](RUNBOOK.md) | 逐臂出数操作卡（setup/单 run 循环/判定/红线清单） | ✅ 武装版 |
| [results/](results/) | runs.json 只追加台账 + 波次报告 | 随首波建立 |

## 与 m3（`../m3/`）的关系

结构母本 = m3 三臂协议。**复用**：RUNBOOK 纪律（独立会话/prompt 原文/污染处置/串行）、
harness 组织（grade CLI → vitest env 注入 → 落盘 grade.json）、正控/负控前置门、评分独立性、
runs.json 只追加。**更换**：对照臂（react 纯客户端 → Next.js 全栈，D-F21）、任务域（前端组件 →
跨端三处改动+迁移+live 对账）、应用基线（init 产物 → 预接线全栈基线，setup 脚本一次装配）、
评分对称性（判据语义三臂全同的机械评分，rubric 降诊断件）、主判据（相对口径为主，
Wave-7 天花板教训）。

## 启动前置条件（拍板与交付状态）

1. ✅ 对照臂选择 = **Next.js**（D-F21，protocol §1.1 建议采纳；SvelteKit 留候补——pilot 实证
   映射不成立时按换臂条款修订协议留痕）；
2. ✅ §6 判据阈值（D-F22：相对 ≥+15pt 为主 + 绝对 ≥60% 副之）；
3. ✅ rubric 降级为诊断件（D-F23，protocol §4.2）；
4. ✅ task3 第二考点 = 不叠加 gen auth（D-F24 执行半裁定：v1 判据面已足够大，auth 装配留观察位）；
5. ✅ 任务书三件评审（brief v1 → v2：消歧清单见各 brief 尾节——客户端 id 钉死 JSON number、
   R2 窗口自 2xx 应答起计、评分驱动约定节、task1 api-diff 口径修正等）；
6. ✅ 执行半交付件（见上导航表；next/reference 为收尾件）。

规格出处：`atelier/docs/FS-DESIGN.md` §14.3 / §4.5 / §17；决策 21-④（评分器开放协议）、
决策 23（对外可比口径）；波次教训源 = `atelier/docs/BACKLOG.md`「M3 实验波次记录」
（Wave-6/7）。执行队列唯一源仍是 `BACKLOG.md`（FS-10 行）。
