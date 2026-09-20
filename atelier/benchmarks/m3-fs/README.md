# m3-fs — M3-FS 全栈三臂对照实验台（FS-10 · 设计稿目录）

> **本目录当前是设计稿，不是可运行的实验台。**FS-10 分两半：设计先行半（本目录现有全部
> 内容，2026-09-20）+ 执行半（评分 harness / 参考解 / 负控 / 基线脚本，全部未实现）。
> 武装完成前，任何"M3-FS 出数"的表述都是名实差距（R8 红线）。

## 导航

| 文件 | 内容 | 状态 |
|---|---|---|
| [protocol.md](protocol.md) | 三臂协议书：臂设计（对照臂 Next/SvelteKit 对表 + 建议）、预接线基线、任务设计原则、评分器开放协议（判据类别表/四角分离/Wilson 强制口径）、§6 判据 | 设计稿 v0.1 |
| [tasks/task1.brief.md](tasks/task1.brief.md) | 基础跨端：一列的全链路传播（契约→迁移→端点→前端→门禁） | 草案 v1 待评审 |
| [tasks/task2.brief.md](tasks/task2.brief.md) | live 对账考点：live 端点 + emits 失效 + §4.5 五步对账协议含 revert | 草案 v1 待评审 |
| [tasks/task3.brief.md](tasks/task3.brief.md) | 加难组合：种子缺陷自救（ATR-331/332）+ task1+2 叠加 | 草案 v1 待评审 |
| [RUNBOOK.md](RUNBOOK.md) | 逐臂操作卡骨架（未执行项全部标注未武装） | 骨架 |

## 与 m3（`../m3/`）的关系

结构母本 = m3 三臂协议。**复用**：RUNBOOK 纪律（独立会话/prompt 原文/污染处置/串行）、
harness 组织（grade CLI → vitest env 注入 → 落盘 grade.json）、正控/负控前置门、评分独立性、
runs.json 只追加。**更换**：对照臂（react 纯客户端 → 主流全栈栈，建议 Next.js 待拍板）、
任务域（前端组件 → 跨端三处改动+迁移+live 对账）、应用基线（init 产物 → 预接线全栈基线）、
评分对称性（rubric 主观判 pass → 判据语义全同的机械评分，rubric 降诊断件）、主判据
（绝对 → 相对口径，Wave-7 天花板教训）。

## 启动前置条件（未决拍板项——全部未决，逐项拍板后才可武装）

1. 〔议〕对照臂选择（protocol §1.1 建议 Next.js；SvelteKit remote functions 为候补）；
2. 〔议〕§6 判据阈值（建议相对 ≥+15pt 为主 + 绝对 ≥60% 副之，沿 m3 数值属默认提议）；
3. 〔议〕rubric 降级为诊断件（protocol §4.2——偏离 m3 react 臂评分惯例的显式提案）；
4. 〔议〕task3 第二考点是否叠加 gen auth 鉴权装配（task3 brief 尾注）；
5. 任务书三件评审（brief v1 → v2 才可进 pilot）；
6. 执行半交付件：基线装配脚本 ×2、grade.mjs + R/C 类场景 harness、参考解 ×3、负控 fixtures、
   report.mjs、对照臂转译件 ×3。

规格出处：`atelier/docs/FS-DESIGN.md` §14.3 / §4.5 / §17；决策 21-④（评分器开放协议）、
决策 23（对外可比口径）；波次教训源 = `atelier/docs/BACKLOG.md`「M3 实验波次记录」
（Wave-6/7）。执行队列唯一源仍是 `BACKLOG.md`（FS-10 行）。
