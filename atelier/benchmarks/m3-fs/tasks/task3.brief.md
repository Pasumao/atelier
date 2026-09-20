# task3-fullstack-rescue — 加难组合：缺陷自救 + 全链贯通 + live 对账（三臂同一任务书 · 北极星层）

> **草案 v1，待评审，未武装**（FS-10 设计先行稿；评分 harness 未实现，本任务书不可出数）。
> 基线 = 协议 §2 预接线全栈应用的 **task3 变体**：setup 注入了一处**半途状态**——`002` 迁移
> 只有 up 侧且**已应用**（库已有 priority 列、schema.ts 已声明），down 侧缺失；端点与前端
> **尚未**消费 priority，也没有 live/乐观对账。你的起点是一个带已知缺陷、迁移半途的应用。
> 只描述目标状态；实现路径由你自己决定。**两处推送时序语义与 task2 相同（异步到达，
> 轮询窗口断言）**。

## 目标状态

1. **缺陷已修复**：应用处于迁移完整状态——成对、可逆、`migrate verify` 干跑通过，
   结构检查无错误；（提示语义到此为止：诊断信息用框架自己的命令与错误输出获取，
   四段式错误的 code 与 fix 字段就是导航面）
2. **列已全线贯通**：创建笔记可附带优先级（0-9 整数，可省略按 0），列表返回并渲染优先级；
3. **列表是活的**：创建提交成功后所有订阅者无需刷新即收到更新；失效键读写两侧显式声明；
4. **乐观对账完整**：待定先行渲染、成功转已确认、推送以服务端值为准同 id 合并不重复、
   失败（ATR-201 拒绝）回滚 + 回滚名单 + 错误态 fix 可见。

## 机械验收判据（评分器逐条判定；不满足任一条 = fail）

判据 = task1 判据表（M1-M8，其中 M3 的 up 步骤对本任务为"已应用状态保持一致"）∪
task2 判据表（M1-M3、R1-R3、C1-C2），另加：

| # | 判据 |
|---|---|
| D1 | 种子缺陷已修复而非绕过：`002` 迁移 up 侧文件内容与基线种子逐字节一致（sha256 对得上状态表）；down 侧存在且 `migrate down --to 001` → `migrate up` 往返后数据面与修复前等价；`migrate verify` exit 0 |
| D2 | 全部完成态下 `struct check` exit 0（含数据契约层与 server 边界层）且应用 `pnpm test` 全绿 |

## 已知陷阱（真实边界取材，非虚构）

- 缺 down 的迁移在 `migrate down`/`verify` 路径上是 ATR-331/333 面，在结构检查上是
  DB_MIGRATION_PAIR ERROR——三条诊断路径指向同一事实；
- **不要想着"重新生成整个迁移"**：已应用迁移的 up 侧文件被改 = 完整性体检 ATR-332
  （checksum = sha256(up 侧内容)，up/down 两路径同口径——`server/migrate.ts` 头注）；
  down 侧不在 checksum 口径内，缺什么补什么；
- 其余陷阱与 task1（NOT NULL 缺省/ATR-215/ATR-323/api-diff 有意变更流程）和
  task2（ATR-314/321/311、真相源规则）相同，不重复罗列；
- 边界注记（不要求做）：源码锚点回滚若跨迁移 head，联动规则是**先 `migrate down` 再
  rollback**（checkpoint 会拒绝并指路，绝不自动执行——决策 21-③）。

## 产出布局（attempt 目录，相对路径）

```
src/server/db/migrations/002_*.down.sql    # 缺失的 down 侧（命名对齐既有 up 侧 stem）
src/server/endpoints/notes.ts              # priority 契约 + live/emits 声明
src/generated/api.ts                       # regen 产物
src/components/NotesPage.atr.ts            # priority 渲染 + 乐观对账
（其余基线文件按需）
```

## 对照臂评分件（诊断用 rubric，10 分制 ≥8 计 pass——不作为首遍判据，见协议 §4.2）

- 从诊断信息定位并最小修复种子缺陷（未破坏已应用迁移完整性）（3）
- 列贯通三处一致（2）
- live 推送 + 乐观对账三态完整（3）
- 代码可读（命名/结构）（2）

> 对照臂会话拿到转译件（种子缺陷以其栈等价物注入：迁移半途 + 缺 down，语义同构）；
> 转译件随执行半产出并评审冻结。
>
> 〔议：评审待决项〕task3 候选第二考点 = **gen auth 鉴权装配**替代或叠加种子缺陷
> （auth 声明缺失的 SERVER_AUTH_MISSING WARN 消警路径 / ATR-340/341 行为面）——
> 若拍板叠加，判据表相应扩 D3（鉴权装配 + 未通过行为）；v1 不含。
