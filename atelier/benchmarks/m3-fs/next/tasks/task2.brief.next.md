# task2-live-reconcile — live 对账考点（对照臂 next 转译件 · 协议层）

> **对照臂转译件 v1（FS-10 执行半，评审冻结中）**。语义源 = `../task2.brief.md`（三臂同一
> 任务书）：目标状态与判据语义**逐条保持，判据编号逐字不变**；栈名词按对照臂等价替换。
> 评分 = `node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task2-live-reconcile
> --attempt <本目录>`。
> 基线 = next 臂预接线基线（notes 链路已通；本任务不改动表结构）。**Next.js 没有内建的
> live/推送原语**——转译件如实保留"订阅 + 乐观对账"的行为目标（FS-DESIGN §4.5 协议原文
> 见下），栈零件（SSE Route Handler、EventSource/useOptimistic 等）由你自己选配装配。
> 只描述目标状态；实现路径由你自己决定。
> **本任务的一切推送都是异步到达的**：写后服务端重算有合并窗口 + SSE 传输时延，任何
> "调用返回即列表已收敛"的假设都是错的——验收断言按轮询窗口进行（判据 R2/R3 的窗口
> 对三臂同值：成功推送 ≤1s、失败后无帧观察窗 1.2s）。

## 目标状态

基线的笔记列表是"打开页面时拉一次"的静态快照。改造终点状态：

1. 服务端：笔记列表订阅化——**live 通道以 SSE 语义存在于 `GET /api/notes/stream`**（等价于
   源任务书的 live 查询声明 + 失效键 `table:notes`：订阅即收到全量快照，写侧变更使其失效
   重算并推送；写侧端点显式声明它触发什么失效）；笔记创建提交成功后，**所有已连接的列表
   订阅者无需刷新即收到含新笔记的更新**；
2. 客户端：用户提交新笔记后，该笔记**立即**以待定状态出现在列表中（不等服务端）；提交成功后
   该项转为已确认；live 推送到达时以服务端数据为准对账（同 id 幂等合并，服务端值胜出，
   不得出现重复行）；提交失败（如输入违反契约被结构化 400 拒绝）时，该待定项**从列表消失**、
   记入回滚名单，且错误信息（含 fix 提示）在界面上可见；
3. 失败路径与成功路径都不弄脏列表的其余部分。

## 乐观对账协议（FS-DESIGN §4.5 原文保留——本任务的考点本体）

```
1. optimisticAdd(item)                     → pending 态渲染
2. 创建请求提交（POST /api/notes）
3a. 成功 → commit(id)；live 推送到达 → 以服务端数据覆盖对账（同 id 幂等合并）
3b. 失败 → revert(id) + rollbacked 记录；错误对象进入 UI error 态（fix 可展示）
```

对账规则：live 推送是**真相源**，optimistic 状态只是其先行渲染；id 冲突时服务端值胜出。

## 机械验收判据（评分器逐条判定；不满足任一条 = fail）

| # | 判据 |
|---|---|
| M1 | 列表 live 通道存在且以 SSE 语义可达：`GET /api/notes/stream` 响应 `content-type: text/event-stream`（等价 live 声明 + 注册表可查；失效联动由 R2/R3 行为判定） |
| M2 | 最终产物不含占位/非法残留：stream 路由为真实 SSE 装配（ReadableStream / text/event-stream），无 not-implemented / TODO stub（等价"非法失效键不残留"） |
| R1 | 黑盒场景：SSE 订阅 `GET /api/notes/stream`，首连收到全量 data 帧（帧行 ⊇ `GET /api/notes` 当前行且非空） |
| R2 | 场景续：`POST /api/notes`（带 `{id, body}`，id 为评分器生成的 JSON number 正整数）成功创建后，**≤1s 墙钟内**（自 POST 收到 2xx 响应起计，首连全量帧不计窗口）同一订阅收到含该 id 新行的 data 帧 |
| R3 | 场景续：`POST /api/notes` 违规输入（`{body: ""}`，或 `{id: "x", body: …}`——id 类型违规）收到**结构化 400**（JSON 错误体，含 code/message/error/issues 之一），且其后 **1.2s 窗口内 live 通道无新 data 帧**、订阅保持（后续一次成功写仍在 1s 内到帧） |
| C1 | 客户端层（挂载驱动提交入口）：成功提交后待定项出现（`data-pending="true"`），推送窗口过后列表含该 id 且**仅一次**（无重复行），状态为已确认 |
| C2 | 客户端层：失败提交后该待定项从列表消失、回滚名单（`data-rollbacked` 元素）含该 id、错误态渲染含 fix 提示 |
| M3 | 静态门禁全绿（tsc + lint + 迁移成对且 verify 幂等）+ `pnpm test` 全绿 |

## 评分驱动约定（转译件钉死的黑盒接口——R/C 两类评分都从这里驱动）

**R 类载荷与窗口**（与 atelier 臂场景规格同文、窗口同值）：

- live 通道 = `GET /api/notes/stream`（SSE；data 帧为 JSON——`{notes:[...]}` 或裸数组皆可，
  行按 `id` 匹配）；
- 创建 = `POST /api/notes` 带 `{id, body}`（本任务起 id 为**客户端生成**并随请求上行：
  **JSON number 正整数**（如 `Date.now()`）——这是钉死口径：表主键为 INTEGER 自增，字符串
  id 无法落库，`{id: "x"}` 属契约违规应被 400 拒绝，你的输入契约须钉死该类型；服务端按
  同 id 幂等合并——这是 §4.5 对账协议成立的前提）；
- 违规 = `POST /api/notes` 带 `{body: ""}`，或带 `{id: "x", body: …}`（id 类型违规），
  期待结构化 400；
- R2 成功推送窗口 = **≤1s 墙钟，自 POST 收到 2xx 响应起计；首连全量帧不计窗口**；
  R3 失败后无帧观察窗 1.2s，随后一次成功写验证订阅保持；
- **心跳/保活必须用 SSE 注释行（`: ping`）**——评分窗口内出现任何 data 帧（含重复全量帧）
  即记为"有新推送"，R3 判红；
- SSE 帧按事件名不限（评分器解析所有 `data:` 行），但 **C 类客户端 harness 以无名 data 帧
  （EventSource `message` 事件 / `onmessage`）驱动**——你的组件按此接收。

**C 类 DOM 钩子契约（原文收录——你的组件同样适用）**：

- 列表行携带 `data-note-id="<id>"`；
- 待定行另带 `data-pending="true"`；
- 提交入口 = 一个文本 `<input>`（body）+ 一个提交按钮；
- 回滚名单 = 带 `data-rollbacked` 的元素含被回滚 id；
- 错误信息（含 fix 提示）DOM 可见；
- priority 在行内可见文本中出现（task1/task3，本任务不考）。

C 类评分 = jsdom + @testing-library/react 挂载 `src/components/NotesList`（默认导出或命名
导出 `NotesList`），以 fetch/EventSource 模拟服务端驱动提交入口：成功提交后推送一帧含该
id 的全量列表断言合并；失败提交（模拟服务端返回 400，错误体含 `code`/`message`/`fix`）断言
回滚三态。组件的提交路径须真实走 `fetch("/api/notes")`——**Server Action 提交在 jsdom 网络面
不可见**（真实边界，见陷阱节），UI 提交若选 Server Action，C 类将无法驱动而判红。

## 已知陷阱（Next/Drizzle 真实边界，非虚构）

- **Server Actions 无法被评分器黑盒直驱**：Action 是编译期绑定的 RPC 形态，没有稳定 HTTP
  面。协议授权的等价封装 = Route Handler：创建/列表行为必须经 `POST/GET /api/notes` 与
  `GET /api/notes/stream` 暴露（UI 提交路径 Server Action 或 fetch 皆可——但见上一节的
  C 类可见性约束）；
- Next Route Handler 里写 SSE = 返回 `new Response(readableStream, { headers: {
  "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } })`，
  流体用 `new ReadableStream({ start(controller) {...} })` + `TextEncoder` 编码；
  别忘了把订阅表挂到模块级单例——Route Handler 每次请求是新函数调用，订阅表放请求作用域
  = 永远只有创建者自己收到推送；
- Next 15 的 GET Route Handler 默认不缓存，但为稳妥请显式 `export const dynamic =
  "force-dynamic"`——静态化是真实存在的缓存边界（stream 被静态化 = 订阅静默失效）；
- **Route Handler 文件只能导出 HTTP 方法（GET/POST/…）与路由配置段（`dynamic` 等）**：
  Next 生成的路由类型体检（`.next/types/**`，tsc 的 include 里有）会把其余导出判为非法
  （`Property 'x' is incompatible with index signature` → tsc 红，S 类门）——订阅表、广播
  函数等辅助件必须放独立模块（如 `src/lib/notes-bus.ts`），route 文件 import 消费；
- 进程内订阅表（模块级数组/Map）= 单实例语义，重启即清：EventSource 自动重连 + 首连全量
  帧自愈，别把"出错即断开重连"写成必要逻辑——重连语义浏览器已处理（重连 = 重新首连全量）；
- 写侧失效触发不要轮询数据库：在创建成功路径上显式通知订阅表（等价 atelier 臂的显式
  `emits` 声明）——"写后无推送"或"失败也推送"都会被 R2/R3 抓红；
- React 客户端组件需要 `"use client"`；`EventSource` 只存在于浏览器运行时——在组件 effect
  /事件处理器内使用，不要在模块顶层直接 new；
- 乐观对账协议的既定规则：**live 推送是真相源，乐观状态只是先行渲染**（§4.5 原文）；
- 客户端生成 id 是本任务的合法设计（也是同 id 幂等合并能成立的前提）；服务端不生成 id
  就不会与你乐观插入的行"撞车"。R2 的评分器 id 是整数（落 `INTEGER PRIMARY KEY` 无类型
  冲突）；
- tsc 严格模式下，订阅表的清理函数、`controller.enqueue` 的类型与 effect 的返回值若处理
  不当，S 类门直接红。

## 产出布局（attempt 目录，相对路径）

```
src/app/api/notes/stream/route.ts         # live 通道（SSE Route Handler）
src/app/api/notes/route.ts                # 创建路径的失效触发（幂等 upsert 语义按 §4.5）
src/components/NotesList.tsx              # 乐观对账消费面（提交入口 + 订阅 + 对账）
（其余基线文件按需）
```

## 对照臂评分件（诊断用 rubric，10 分制 ≥8 计 pass——不进 firstPass，见协议 §4.2）

- 写后推送链路真实可用（订阅者无需刷新收到新行）（3）
- 乐观插入 + 失败回滚 + 错误可见三态完整（3）
- 无重复行/无幽灵行（对账正确）（2）
- 代码可读（命名/结构）（2）

> 本转译件与源任务书同批评审冻结；评审发现语义偏差 = 整批转译件退回（协议 §8.3 公平性纪律）。
