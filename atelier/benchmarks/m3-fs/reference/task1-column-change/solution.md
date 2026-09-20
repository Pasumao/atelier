# task1-column-change 参考解（正控 · solution.md）

> 参考解作者与任务书作者分离（协议 §4.3 四角分离）。本文记录：命令序列、关键决策、
> 逐条判据自查。`overlay/` = 按 app 根相对路径摆放的解题后文件全集（含 regen 产物与
> api-surface 刷新件）。attempt 起点 = `setup-baseline-atelier.mjs` 标准基线（已 pnpm install）。

## 1. 命令序列（在 attempt 应用根目录执行）

```
# ① 写迁移对（手写——gen db 只为新表生成骨架，改列迁移属人写范围，FS-DESIGN §5.4 边界）
#    src/server/db/migrations/002_add_priority.up.sql
#    src/server/db/migrations/002_add_priority.down.sql
# ② schema.ts 契约列：notes 表加 priority: { type: "integer", notNull: true, default: 0 }
# ③ 契约单源：contract.ts 的 noteSchema 加 priority（行内必有）；
#    noteCreateInput 加 optProps.priority = { type: "number", min: 0, max: 9 }（可省略，0-9）
# ④ 端点：notes.ts 两端点 SELECT/INSERT 显式带 priority；create 端 Math.trunc(input.priority ?? 0)
# ⑤ 前端：NotesPage 行内渲染优先级（评分钩子：行内可见文本 + data-note-id 保留）
node <repo>/atelier/cli.mjs gen db --root .            # tables/crud 拉齐（追加式，001 不动）
node <repo>/atelier/cli.mjs gen endpoint --root .      # api.ts regen（本任务类型面不变→字节同前）
node <repo>/atelier/cli.mjs migrate up --root .        # 002 应用到 dev 库（既有行回填 0）
node <repo>/atelier/cli.mjs migrate verify --root .    # up→down→up 影子干跑幂等
node <repo>/atelier/cli.mjs api-diff snapshot --root . # 有意变更流程：刷新 snapshot
node <repo>/atelier/cli.mjs api-diff check --root .    # exit 0
node <repo>/atelier/cli.mjs struct check               # exit 0（八层无 ERROR）
pnpm test                                              # 全绿
```

## 2. 关键决策

1. **002 up 带 `DEFAULT 0`**：对已有数据的表加 NOT NULL 列必须带缺省值，否则 `migrate up`
   失败事务回滚（ATR-334 面）；既有两行种子回填 priority=0（M3 口径）。
2. **down = `ALTER TABLE notes DROP COLUMN priority`**：SQLite ≥3.35 支持；`migrate verify`
   影子库以 force 回放 down，幂等通过。
3. **契约 0-9 挂输入、整数性挂 handler**：扁平 schema 无整数类型——`optProps.priority`
   用 `min:0, max:9`（越界 = ATR-201），handler 里 `Math.trunc` 归一（2.5 → 2）。
   行契约（noteSchema.reqProps.priority）用无约束 number（输出面，落库值已受输入约束）。
4. **notes.list/notes.create 的 SELECT/INSERT 全部显式列名**：不写 `SELECT *`（决策 19 贴 SQL
   纪律；列变更时影响面可 grep）。
5. **api.ts regen 后字节不变**（本任务只改契约字段，api.ts 是 `FlatOf<typeof 常量>` 的类型
   引用面）——M6 的 regen 幂等以"再跑一次 diff 为空"口径验证。
6. **api-diff 实测口径**：应用布局的 snapshot 面 = 组件契约 + token 键 + openapi 面（本基线
   未导出 openapi.json → 空面）。本任务不增删端点、不改组件契约 → 零漂移，check 恒绿；
   刷新 snapshot 是**流程纪律**（checkpoint 门禁消费同一文件），照做不扣分。

## 3. 逐条判据自查（M1-M8）

| # | 判据 | 自查证据 |
|---|---|---|
| M1 | schema.ts 含 priority（integer/notNull/default 0） | PASS——overlay `src/server/db/schema.ts` 字面量声明 |
| M2 | 002 成对迁移出现；001 系零改动 | PASS——`002_add_priority.{up,down}.sql` 成对；001 文件字节未动（struct 层 8 checksum 体检 OK） |
| M3 | 基线库副本 migrate up 得列且既有行=0；down --to 一步列消失；verify exit 0 | PASS——实测：down 后列消失且行数据完好，再 up 列回来既有行 priority=0；`migrate verify` OK |
| M4 | notes.create 输入契约含可选 priority(0-9)；落库一致 | PASS——optProps min0/max9；`priority:7` 落库 7；`priority:11` → ATR-201"超过上限 9"；省略 → 0 |
| M5 | notes.list 行含 priority；dev 态输出校验不红 | PASS——行含 priority 字段；server 面 dev 态无 ATR-215（output 契约 = 顶层对象红线内的数组属性，元素级结构 v1 不表——handler 单点构造保证） |
| M6 | api.ts regen diff 为空 | PASS——regen 幂等（"内容未变——regen 幂等"输出；overlay 内 api.ts 即 regen 产物） |
| M7 | 前端渲染 priority（DOM 可见既有行 priority 值） | PASS——dom-shim 挂载冒烟（模板 LiveNotes.atr.spec 同款手法）：行内"优先级 0/5"可见，行带 data-note-id |
| M8 | struct check exit 0；api-diff check exit 0；pnpm test 全绿 | PASS——0 error · 0 warn；gate PASS；19/19 |

## 4. 诚实边界

- 模板表达式子集（ATR-301）不支持可选链与函数调用——行集/计数必须 `$derived` 预计算，
  这是参考解踩过并修正的真实坑（初版模板内 `list.value?.notes` 直接 ATR-301）。
- overlay 的 `.atelier/api-surface.json` 的 `root`/`generatedAt` 是环境元数据（验证目录名
  与时刻）；评分如需逐字节对齐，以 attempt 现场重跑 snapshot 为准——面内容（组件契约/token
  键）才是判据本体。
