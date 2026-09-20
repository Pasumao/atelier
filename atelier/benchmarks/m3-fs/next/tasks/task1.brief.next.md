# task1-column-change — 基础跨端：一列的全链路传播（对照臂 next 转译件 · 冒烟层）

> **对照臂转译件 v1（FS-10 执行半，评审冻结中）**。语义源 = `../task1.brief.md`（三臂同一
> 任务书）：目标状态与判据语义**逐条保持，判据编号逐字不变**；栈名词按对照臂等价替换
> （协议 §1.1/§4.2 公平性纪律）。评分 = `node atelier/benchmarks/m3-fs/next/grade-next.mjs
> --task task1-column-change --attempt <本目录>`（判据语义全同、实现分臂）。
> 基线 = next 臂预接线基线（Next.js App Router + Drizzle/SQLite + zod 契约单源；notes 链路
> 已通，001 迁移已应用，`GET/POST /api/notes` 可用）。只描述目标状态；实现路径由你自己
> 决定。文档与既有代码就是你的证据面。

## 目标状态

基线应用的 notes 数据已全线贯通。现在给笔记增加**优先级**能力，终点状态满足：

1. `notes` 表有 `priority` 列：整数、非空、既有行缺省 0；
2. 用户新建笔记时可附带优先级（0-9 的整数，可省略，省略按 0）；既有笔记的优先级可随列表读出；
3. 前端笔记列表把每条笔记的优先级渲染出来（用户看得见即可，样式不作要求）；
4. 变更后应用处于"全绿"状态：`tsc --noEmit` 绿、lint 绿、迁移成对可逆、应用测试全通过
   （等价于源任务书的结构检查 + API 面门禁 + 测试门，判据实现分臂）。

## 机械验收判据（评分器逐条判定；不满足任一条 = fail）

| # | 判据 |
|---|---|
| M1 | `src/db/schema.ts` 中 notes 表定义含 `priority` 列（integer、notNull、default 0） |
| M2 | `drizzle/migrations/` 出现新成对迁移（`002_*.up.sql` + 同名 `.down.sql`）；001 系文件零改动（sha256 对表冻结基线） |
| M3 | 对基线库副本（影子库）up：notes 表获得该列且既有行 priority=0；`db.mjs down --to 001` 一步后该列消失；`db.mjs verify` 干跑 exit 0 |
| M4 | `POST /api/notes` 输入契约含可选 `priority`（integer，0-9）；带 priority 的调用落库值一致；越界（10）/小数（2.5）/非整数（"7"）被结构化 400 拒；省略按 0 |
| M5 | `GET /api/notes` 返回行含 `priority`，且其输出契约（`src/lib/contract.ts` 的 noteRow）已声明该字段（输出校验不红，非 500） |
| M6 | 契约单源完好：`src/app/api/notes/route.ts` 从契约模块 import 解析器（无内联复本），契约源码含可选 priority 的 0-9 整数声明 |
| M7 | 前端组件渲染优先级（挂载后 DOM 中可见基线既有行的 priority 值） |
| M8 | 全绿门：`tsc --noEmit` 绿 + lint 绿 + 迁移成对 + `pnpm test` 全绿 |

## 评分驱动约定（C 类 DOM 钩子契约，原文收录——你的组件同样适用）

- 列表行携带 `data-note-id="<id>"`；
- 待定行另带 `data-pending="true"`；
- 提交入口 = 一个文本 `<input>`（body）+ 一个提交按钮；
- 回滚名单 = 带 `data-rollbacked` 的元素含被回滚 id；
- 错误信息（含 fix 提示）DOM 可见；
- priority 在行内可见文本中出现（task1/task3）。

本任务 C 类只考两条：挂载 `src/components/NotesList`（默认导出或命名导出 `NotesList`）后
行带 `data-note-id`、探针行（id=777）行内可见文本含 priority 值。评分器以 fetch/EventSource
模拟服务端（GET /api/notes 返回含 `{id:777, body:"probe-alpha", createdAt:1700000000000,
priority:9}` 的列表）——探针值 9 是刻意选择的：它不出现在 createdAt 的常见渲染形态
（epoch 毫秒 / ISO 串）里，防止把时间戳数字误当优先级。

## 已知陷阱（Next/Drizzle 真实边界，非虚构）

- **drizzle-kit 生成的是单向迁移**：`drizzle-kit generate` 产出 `0000_*.sql` + `meta/_journal.json`，
  没有 down 侧；而本基线的可逆口径（S 类硬判据）只认 `drizzle/migrations/` 下成对的
  `NNN_<name>.up.sql` + 同 stem `.down.sql`（`scripts/db.mjs` 不识别 drizzle-kit journal 形态）。
  用 drizzle-kit 生成后必须把产物整理成该形态；手写这对 SQL 往往更快；
- 对**已有数据**的表加 NOT NULL 列，SQLite 的 `ALTER TABLE ... ADD COLUMN` 若不带
  `DEFAULT`，迁移 up 会直接失败——SQLite 强制 NOT NULL 列必须带非 NULL 缺省；
- 已应用的迁移文件**永不重写**：`scripts/db.mjs` 的状态表（`_migrations`）按
  sha256(up 侧内容) 记账，改动已应用迁移的内容会被 up/verify 的 integrity 体检抓红；
  down 侧不在 checksum 口径内（缺什么补什么）；
- 契约单源是评分判据（M5/M6）：`noteRow` 输出契约不声明 priority 时，route 的输出校验
  会把该字段剥掉——列表读不到；route 里内联一套解析器而不 import 契约模块 = M6 红；
- tsc 严格模式（`strict: true`）下，`z.infer` 推导与 `parsed.data` 的可选链若处理不当，
  S 类门直接红；先 `pnpm exec tsc --noEmit` 再交卷；
- Next 的 Route Handler 对 `POST` 的 JSON 解析需要 `await request.json()`（bad JSON 也应
  回结构化 400——基线已示范）；输出校验失败的 500 是基线的契约守卫在抓你，别绕过它，
  把契约与实现对齐。

## 产出布局（attempt 目录，相对路径）

```
src/db/schema.ts                     # priority 列定义
drizzle/migrations/002_*.up.sql      # 新成对迁移（编号随既有惯例 001 → 002）
drizzle/migrations/002_*.down.sql
src/lib/contract.ts                  # 契约单源更新
src/app/api/notes/route.ts           # Route Handler 消费 priority
src/components/NotesList.tsx         # 前端渲染 priority
（其余基线文件按需；m3fs-grade.json 由评分器落盘）
```

## 对照臂评分件（诊断用 rubric，10 分制 ≥8 计 pass——不进 firstPass，见协议 §4.2）

- 迁移可逆且既有数据安全（缺省值处理正确）（3）
- 契约/端点/前端三处类型与行为一致（3）
- 静态检查与测试全绿（2）
- 代码可读（命名/结构）（2）

> 本转译件与源任务书同批评审冻结；评审发现语义偏差 = 整批转译件退回（协议 §8.3 公平性纪律）。
