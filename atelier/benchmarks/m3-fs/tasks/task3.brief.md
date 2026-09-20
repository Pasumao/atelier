# task3-fullstack-rescue — 加难组合：缺陷自救 + 全链贯通 + live 对账（三臂同一任务书 · 北极星层）

> **v2（2026-09-20 评审）**——消歧记录：按参考解实做发现的歧义修订（详见文末"评审消歧清单"）；
> 新增"评分驱动约定"节（评分 harness 按此驱动）；判据编号与语义不变。基线 = 协议 §2
> 预接线全栈应用的 **task3 变体**：setup 注入了一处**半途状态**——`002` 迁移
> 只有 up 侧且**已应用**（库已有 priority 列、schema.ts 已声明），down 侧缺失；端点与前端
> **尚未**消费 priority，也没有 live/乐观对账。你的起点是一个带已知缺陷、迁移半途的应用
> （attempt 已 `pnpm install`）。
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
| D1 | 种子缺陷已修复而非绕过：`002` 迁移 up 侧文件与基线注入件**逐字节一致**（口径：sha256(当前 up 侧字节) == `atelier_migrations` 表中 002 记录的 checksum == setup 注入件的 sha256——down 侧不在 checksum 口径内）；down 侧存在且 `migrate down --to 001` → `migrate up` 往返后数据面与修复前等价（口径：notes 行集（id/body/createdAt）一致，列存在性由 up/down 往返保证）；`migrate verify` exit 0 |
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

## 评分驱动约定（评分 harness 按此驱动，三臂同值）

- **C 类 DOM 钩子**：列表行携带 `data-note-id="<id>"`；待定行另带 `data-pending="true"`；
  提交入口 = 一个文本 `<input>`（body）+ 一个提交按钮；回滚名单 = 带 `data-rollbacked` 的
  元素，内容含被回滚 id；错误信息（含 fix 提示）DOM 可见；**priority 在行内可见文本中出现**。
- **R 类场景形状**（mount=/api）：live 通道 = GET `/api/notes.list/live`，SSE 首连全量即时
  （首帧不计推送窗口）；创建 = POST `/api/notes.create`，成功载荷
  `{id:"<客户端id>", body:"..."}`，另带可选 `priority:0-9` 整数；**id = 客户端生成的正整数
  （JSON number，如 Date.now()）**——基线 notes 表主键为 INTEGER（自增），字符串 id 无法
  落库；违规载荷 `{id:"x", body:""}` → ATR-201 四段式；写后推送断言窗口 ≤1s（自 POST 收到
  2xx 起计；task1/task2 同值）。
- **attempt 口径**：attempt = `setup-baseline-atelier.mjs --variant task3` 产物（应用根目录，
  已 `pnpm install`，dev.db 迁移/种子在账、002 已应用且 down 缺失）；评分前核验 D1 的
  sha256 前提（RUNBOOK 红线：缺陷被提前修掉 = 该 run 作废）。基线含 runtime 单实例化 shim
  （生成物与组件面同一 runtime 实例——否则信号跨实例不追踪，C 类评分假阴性）。

## 评审消歧清单（v1→v2）

1. **D1 校验口径落到可机检**：v1 的"与基线种子逐字节一致（sha256 对得上状态表）"歧义在
   "基线种子"（易误读为数据库种子行）——v2 钉死三方一致：当前 up 侧字节 sha256 ==
   atelier_migrations 的 002 checksum == setup 注入件 sha256；"数据面等价"落到行集口径。
2. attempt 起点口径显式化（`--variant task3` 产物、已 install、评分前 sha256 前提核验）。
3. 继承 task2 v2 的 id 类型钉死（number 正整数）与推送窗口起算点（本任务判据 = task1 ∪
   task2，id/priority 载荷形状以本节"评分驱动约定"为单一口径）。
4. 新增"评分驱动约定"节（DOM 钩子 + R 类载荷/窗口 + attempt 口径）。

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
