# task3-fullstack-rescue 参考解（正控 · solution.md）

> 参考解作者与任务书作者分离（协议 §4.3）。attempt 起点 = `setup-baseline-atelier.mjs
> --variant task3`（半途状态：002 up 已应用且 down 缺失、schema.ts 已声明 priority、
> 端点契约/handler/前端未消费 priority；attempt 已 pnpm install）。
> `overlay/` = 解题后文件全集——**唯一迁移文件是 002 的 down 侧**（up 侧逐字节不动，D1）。

## 1. 命令序列（在 attempt 应用根目录执行）

```
# ① 缺陷自救（诊断路径任选：migrate down/verify 的 ATR-333 / struct check 的 DB_MIGRATION_PAIR
#    ERROR——三条诊断路径指向同一事实：002 缺 down）
node <repo>/atelier/cli.mjs migrate status --root .   # 002 applied · hasDown=false → 定位缺陷
# ② 补 down 侧：src/server/db/migrations/002_add_priority.down.sql（命名对齐 up 侧 stem；
#    内容 = ALTER TABLE notes DROP COLUMN priority；**不碰 up 侧一个字节**）
node <repo>/atelier/cli.mjs migrate verify --root .   # up→down→up 影子干跑幂等 → 缺陷修复
# ③ priority 贯通（task1 合成半）：
#    contract.ts（noteSchema.reqProps + noteCreateInput.optProps 0-9）
#    notes.ts（SELECT/INSERT 带 priority，Math.trunc 归一）
node <repo>/atelier/cli.mjs gen db --root .           # tables/crud 拉齐 priority
# ④ live + 乐观对账（task2 合成半）：
#    notes.ts（live/emits/idempotent/upsert，id 客户端生成）+ NotesPage 五步对账
node <repo>/atelier/cli.mjs gen endpoint --root .     # api.ts regen（live 客户端）
node <repo>/atelier/cli.mjs api-diff snapshot --root .
node <repo>/atelier/cli.mjs api-diff check --root .   # exit 0
node <repo>/atelier/cli.mjs struct check              # exit 0（含数据契约层/server 边界层）
pnpm test                                             # 全绿
```

## 2. 关键决策

1. **最小修复，不重生成迁移**：已应用迁移的 up 侧被改 = ATR-332（checksum = sha256(up 字节)，
   up/down 两路径同口径）——缺什么补什么，down 侧不在 checksum 口径内。gen db 对改列迁移
   本就无能为力（§5.4：只为新表生成骨架），"重新生成整个迁移"既不可行也不必要。
2. **down 语义**：`ALTER TABLE notes DROP COLUMN priority`（SQLite ≥3.35）；verify 影子库
   以 force 回放——up→down→up 后 sqlite_master 与首 up 逐对象一致 = 幂等通过。
3. **D1 的 sha256 口径实测**：up 侧文件字节 sha256 = `b0ab9dca…c0653`，与 atelier_migrations
   表中 002 记录的 checksum 逐字节一致（注入时点起未动）；down 往返
   `migrate down --to 001 → migrate up` 后行集完好、既有行 priority=0。
4. **合成态复用**：priority 贯通 = task1 决策（契约 0-9 挂输入、整数性 Math.trunc 挂 handler、
   SELECT/INSERT 显式列名）；live+对账 = task2 决策（客户端正整数 id、upsert、id 双域、
   ATR-301 预计算纪律）——两半共用同一 notes.ts/NotesPage，不再重复。
5. **struct 恢复全绿的信号面**：修复后 DB_MIGRATION_PAIR OK（成对）、DB_MIGRATION_CHECKSUM
   OK（002 checksum 与文件字节一致）、DB_SCHEMA_DRIFT OK（1 表全在库）。

## 3. 逐条判据自查（task1 M1-M8 ∪ task2 M1-M3/R1-R3/C1-C2 ∪ D1-D2）

> M3 对本任务为"已应用状态保持一致"（002 在 attempt 库本就已应用；verify 补验可逆性）。

| # | 判据 | 自查证据 |
|---|---|---|
| M1 | schema.ts priority 列 | PASS——基线注入件已声明（起点即满足，保持不动） |
| M2 | 002 成对迁移；001 系零改动 | PASS——补 down 后成对；001 文件未动（struct checksum OK） |
| M3 | up 步骤=已应用状态一致；down --to 列消失；verify exit 0 | PASS——verify OK；down 往返实测列消失/恢复、数据完好 |
| M4 | notes.create 可选 priority(0-9) 落库一致 | PASS——`{id:987654321, body:"prio live", priority:8}` 落库 8；越界 ATR-201 |
| M5 | notes.list 行含 priority 且 dev 输出校验不红 | PASS——行含 priority；无 ATR-215 |
| M6 | api.ts regen diff 为空 | PASS——regen 幂等（overlay 内即 regen 产物） |
| M7 | 前端渲染 priority | PASS——dom-shim 冒烟：行内"优先级 7"可见 |
| M8 | struct/api-diff exit 0；pnpm test 全绿 | PASS——0 error · 0 warn；gate PASS；19/19 |
| M1(t2) | live 声明 + 失效键 table:notes + emits 显式 | PASS——notes.ts 声明；注册期无 ATR-314 |
| M2(t2) | 无非法失效键 | PASS——唯二键 table:notes 合法 |
| R1 | SSE 首连全量帧 | PASS——首帧含种子行（task3 库） |
| R2 | POST 创建 ≤1s 推帧含该 id | PASS——实测 ~45ms |
| R3 | 违规 ATR-201 四段式 + 无新帧 + 订阅保持 | PASS——400 四段式；1s 无帧；同连接后续写仍收帧 |
| C1 | 待定出现 → 窗口后该 id 恰一次已确认 | PASS——dom-shim 冒烟（含 priority 帧） |
| C2 | 失败回滚 + 名单含 id + fix 可见 | PASS——同 task2 路径，其余行（priority=3 种子行）不受影响 |
| D1 | up 侧逐字节一致（sha256 对上状态表）；down 存在且往返等价；verify exit 0 | PASS——sha256(up)=b0ab9dca…c0653 = 状态表 002 checksum = 注入件；down --to 001 → up 往返行集完好；verify OK |
| D2 | 完成态 struct check exit 0（含第 7/8 层）且 pnpm test 全绿 | PASS——summary 0 error · 0 warn；19/19 |

## 4. 诚实边界

- runtime 单实例化口径同 task2 solution.md §4（基线 S10b shim 为前提件）。
- overlay 不含 `src/server/db/migrations/002_add_priority.up.sql`——**有意缺席**：attempt
  起点已带该文件，参考解零改动即 D1 本体（评分 harness 可先核验 attempt 起点的 sha256 前提，
  RUNBOOK §4 红线第 5 条）。
- api-surface.json 环境元数据口径同 task1 solution.md §4。
