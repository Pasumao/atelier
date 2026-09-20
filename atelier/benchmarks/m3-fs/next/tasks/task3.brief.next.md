# task3-fullstack-rescue — 加难组合：缺陷自救 + 全链贯通 + live 对账（对照臂 next 转译件 · 北极星层）

> **对照臂转译件 v1（FS-10 执行半，评审冻结中）**。语义源 = `../task3.brief.md`（三臂同一
> 任务书）：目标状态与判据语义**逐条保持，判据编号逐字不变**；栈名词按对照臂等价替换。
> 评分 = `node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task3-fullstack-rescue
> --attempt <本目录>`。
> 基线 = next 臂预接线基线的 **task3 变体**：setup 注入了一处**半途状态**——
> `002_add_priority` 迁移只有 up 侧且**已应用**（库里已有 priority 列、`src/db/schema.ts`
> 已声明，`db.mjs up` 视其为已应用并按 up 侧内容记账 checksum），down 侧缺失；端点契约与
> 前端**尚未**消费 priority，也没有 live/乐观对账。你的起点是一个带已知缺陷、迁移半途的
> 应用。只描述目标状态；实现路径由你自己决定。**两处推送时序语义与 task2 相同（异步到达，
> 轮询窗口断言：成功推送 ≤1s、失败后无帧观察窗 1.2s）**。

## 目标状态

1. **缺陷已修复**：应用处于迁移完整状态——002 成对、可逆、`db.mjs verify` 干跑通过，
   `tsc --noEmit` / lint 无错；（提示语义到此为止：诊断信息用基线自带的命令与错误输出获取
   ——`node scripts/db.mjs verify` / `pnpm dev` 的报错输出就是导航面，读它，别猜）
2. **列已全线贯通**：创建笔记可附带优先级（0-9 整数，可省略按 0），列表返回并渲染优先级；
3. **列表是活的**：创建提交成功后所有订阅者无需刷新即收到更新（live 通道 =
   `GET /api/notes/stream`，SSE 语义；写侧显式触发失效——等价读写两侧显式声明）；
4. **乐观对账完整**：待定先行渲染（`data-pending="true"`）、成功转已确认、推送以服务端值为
   准同 id 合并不重复、失败（结构化 400 拒绝）回滚 + 回滚名单（`data-rollbacked` 含 id）+
   错误态 fix 可见。

## 乐观对账协议（FS-DESIGN §4.5 原文保留——本任务的考点本体）

```
1. optimisticAdd(item)                     → pending 态渲染
2. 创建请求提交（POST /api/notes）
3a. 成功 → commit(id)；live 推送到达 → 以服务端数据覆盖对账（同 id 幂等合并）
3b. 失败 → revert(id) + rollbacked 记录；错误对象进入 UI error 态（fix 可展示）
```

对账规则：live 推送是**真相源**，optimistic 状态只是其先行渲染；id 冲突时服务端值胜出。

## 机械验收判据（评分器逐条判定；不满足任一条 = fail）

判据 = task1 判据表（M1-M8，其中 M3 的 up 步骤对本任务为"已应用状态保持一致"）∪
task2 判据表（M1-M3、R1-R3、C1-C2），另加：

| # | 判据 |
|---|---|
| D1 | 种子缺陷已修复而非绕过：`002_add_priority.up.sql` 文件内容与基线种子**逐字节一致**（sha256 对表冻结 manifest——等价状态表 checksum 口径）；down 侧存在且 `db.mjs down --to 001` → `db.mjs up` 往返后数据面等价；`db.mjs verify` exit 0 |
| D2 | 全部完成态下静态门禁全绿（tsc + lint + 迁移成对）且 `pnpm test` 全绿 |

（评分报告中 task1/task2 同号判据以 desc 前缀 `[task1]`/`[task2]` 区分，id 保持逐字。）

## 评分驱动约定（转译件钉死的黑盒接口）

与 task2 转译件**逐字相同**（R 类载荷与窗口：live 通道 = `GET /api/notes/stream`、创建 =
`POST /api/notes` 带 `{id, body}`（id 为评分器生成的 **JSON number 正整数**，如 `Date.now()`
——契约层须钉死该类型，`{id: "x"}` 属违规应 400）、违规 = `{body: ""}` 或 `{id: "x", body: …}`
期待结构化 400、成功推送窗口 = **≤1s 墙钟自 2xx 响应起计、首连全量帧不计窗口**、失败后无帧
观察窗 1.2s、心跳必须用 SSE 注释行；C 类以 jsdom 挂载 `src/components/NotesList` +
fetch/EventSource 模拟服务端驱动提交入口），另加 task1 的 priority 探针（挂载后探针行
id=777 的行内可见文本含 priority 值 9）。

**C 类 DOM 钩子契约（原文收录——你的组件同样适用）**：

- 列表行携带 `data-note-id="<id>"`；
- 待定行另带 `data-pending="true"`；
- 提交入口 = 一个文本 `<input>`（body）+ 一个提交按钮；
- 回滚名单 = 带 `data-rollbacked` 的元素含被回滚 id；
- 错误信息（含 fix 提示）DOM 可见；
- priority 在行内可见文本中出现（task1/task3）。

## 已知陷阱（Next/Drizzle 真实边界，非虚构）

- 缺 down 侧的迁移，在 `db.mjs down` / `db.mjs verify` 路径上直接报错拒做，`pnpm dev` 的
  predev 虽能跑 up 但会告警——三条诊断路径指向同一事实（等价 ATR-331/333 + 结构检查
  DB_MIGRATION_PAIR 的三路诊断语义）；
- **不要想着"重新生成整个迁移"**：已应用迁移的 up 侧文件被改 = `scripts/db.mjs` 的
  integrity 体检红（checksum = sha256(up 侧内容)，up/verify 两路径同口径——等价 ATR-332
  语义）；down 侧不在 checksum 口径内，缺什么补什么；评分侧的 sha256 对表对象 = 冻结
  manifest（基线装配时生成），改一个字节都会被抓；
- SQLite 对已有数据的表加 NOT NULL 列必须带 DEFAULT（本变体 up 侧已带
  `DEFAULT 0`，保持即可）；down 侧用 `ALTER TABLE ... DROP COLUMN`（SQLite 3.35+ 支持，
  better-sqlite3 内置的 SQLite 版本满足）；
- 其余陷阱与 task1 转译件（NOT NULL 缺省 / drizzle-kit 无 down / 契约单源 / tsc 严格模式）
  和 task2 转译件（Server Action 不可黑盒直驱 / SSE Route Handler 写法 / route 文件不得导出
  辅助函数 / 订阅表作用域 / force-dynamic / 真相源规则 / 客户端生成 id）相同，不重复罗列
  ——先读那两份；
- 边界注记（不要求做）：源码锚点回滚若跨迁移 head，联动规则是**先迁移回滚再回滚源码**
  （等价 checkpoint 拒绝并指路的语义），绝不自动执行。

## 产出布局（attempt 目录，相对路径）

```
drizzle/migrations/002_*.down.sql          # 缺失的 down 侧（命名对齐既有 up 侧 stem）
src/lib/contract.ts                        # priority 契约 + 输出契约
src/app/api/notes/route.ts                 # priority 消费 + 失效触发
src/app/api/notes/stream/route.ts          # live 通道（SSE Route Handler）
src/components/NotesList.tsx               # priority 渲染 + 乐观对账
（其余基线文件按需；基线守卫测试 src/lib/contract.test.ts 属你维护——契约改了测试要跟上）
```

## 对照臂评分件（诊断用 rubric，10 分制 ≥8 计 pass——不进 firstPass，见协议 §4.2）

- 从诊断信息定位并最小修复种子缺陷（未破坏已应用迁移完整性）（3）
- 列贯通三处一致（2）
- live 推送 + 乐观对账三态完整（3）
- 代码可读（命名/结构）（2）

> 本转译件与源任务书同批评审冻结；种子缺陷以栈等价物注入（迁移半途 + 缺 down，语义同构）。
> 〔议：评审待决项〕task3 候选第二考点 = gen auth 鉴权装配（源任务书尾注）——若拍板叠加，
> 转译件对应扩 D3（Next 臂等价物 = 中间件/会话装配行为面）；v1 不含。
