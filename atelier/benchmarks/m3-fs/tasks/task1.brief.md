# task1-column-change — 基础跨端：一列的全链路传播（三臂同一任务书 · 冒烟层）

> **草案 v1，待评审，未武装**（FS-10 设计先行稿；评分 harness 未实现，本任务书不可出数）。
> 基线 = 协议 §2 预接线全栈应用（notes 契约/表/端点/前端已通，001 迁移已应用）。
> 只描述目标状态；实现路径由你自己决定。文档与既有代码就是你的证据面。

## 目标状态

基线应用的 notes 数据已全线贯通。现在给笔记增加**优先级**能力，终点状态满足：

1. `notes` 表有 `priority` 列：整数、非空、既有行缺省 0；
2. 用户新建笔记时可附带优先级（0-9 的整数，可省略，省略按 0）；既有笔记的优先级可随列表读出；
3. 前端笔记列表把每条笔记的优先级渲染出来（用户看得见即可，样式不作要求）；
4. 变更后应用处于"全绿"状态：结构检查无错误、API 面无未豁免破坏性漂移、应用测试全通过。

## 机械验收判据（评分器逐条判定；不满足任一条 = fail）

| # | 判据 |
|---|---|
| M1 | `src/server/db/schema.ts` 中 notes 表定义含 `priority` 列（integer、notNull、default 0） |
| M2 | `src/server/db/migrations/` 出现新成对迁移（`002_*.up.sql` + 同名 `.down.sql`）；001 系文件零改动 |
| M3 | 对基线库副本 `migrate up`：notes 表获得该列且既有行 priority=0；`migrate down --to` 一步后该列消失；`migrate verify` exit 0 |
| M4 | `notes.create` 输入契约含可选 `priority`（integer，0-9）；带 priority 的调用落库值一致 |
| M5 | `notes.list` 返回行含 `priority`，且其 output 契约已声明该字段（dev 态输出校验不红） |
| M6 | `src/generated/api.ts` 经 regen 后 diff 为空（生成物零手改，契约同源） |
| M7 | 前端组件渲染优先级（挂载后 DOM 中可见基线既有行的 priority 值） |
| M8 | `struct check` exit 0（八层无 ERROR）；`api-diff check` exit 0（允许按既定流程刷新 snapshot 记录有意变更）；应用 `pnpm test` 全绿 |

## 已知陷阱（真实边界取材，非虚构）

- 对**已有数据**的表加 NOT NULL 列，DDL 若不带缺省值，`migrate up` 会失败回滚
  （ATR-334，up 失败事务回滚——迁移器行为见 `server/migrate.ts`）；
- 已应用的迁移文件**永不重写**：改 001 的内容会被 checksum 体检抓成 ATR-332；
- 数据面骨架生成器的适用范围有边界——**指望一条命令完成全部数据面变更会落空**；边界本身
  有文档（`atelier gen db` 只为尚无迁移的**新表**生成骨架；改列迁移的负责方见 FS-DESIGN §5.4）；
- 迁移不成对（缺 down）= struct 数据契约层 DB_MIGRATION_PAIR ERROR（ATR-331 族）；
- output 契约声明了字段而 handler 没返回 → dev 态 ATR-215（这是框架在替你抓，别绕过它）；
- 端点输出契约变了 = API 面 breaking 漂移——`api-diff check` 会红，按有意变更流程处置
  （snapshot 刷新），不要去改 snapshot 之外的历史记录；
- 前端模板表达式里不能出现异步调用形态（ATR-323 显式拒绝——Promise 不得进响应式图）。

## 产出布局（attempt 目录，相对路径）

```
src/server/db/schema.ts                    # priority 列定义
src/server/db/migrations/002_*.up.sql      # 新成对迁移（命名随既有编号惯例）
src/server/db/migrations/002_*.down.sql
src/server/endpoints/notes.ts              # 契约与 handler 更新
src/generated/api.ts                       # regen 产物
src/components/NotesPage.atr.ts            # 前端消费
（其余基线文件按需；m3fs-grade.json 由评分器落盘）
```

## 对照臂评分件（诊断用 rubric，10 分制 ≥8 计 pass——不作为首遍判据，见协议 §4.2）

- 迁移可逆且既有数据安全（缺省值处理正确）（3）
- 契约/端点/前端三处类型与行为一致（3）
- 静态检查与测试全绿（2）
- 代码可读（命名/结构）（2）

> 对照臂会话拿到的是本任务书的**转译件**（栈名词等价替换、目标态与判据语义逐条保持）——
> 转译件随执行半产出并评审冻结（协议 §1.1 公平性纪律）。
