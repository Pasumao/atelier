# task3-fullstack-rescue 参考解（正控 · solution.md）

> 参考解作者与任务书作者分离（协议 §4.3）。attempt 起点 = `setup-baseline-next.mjs
> --variant task3`（半途状态：002_add_priority 只有 up 侧且已应用、down 侧缺失、
> `db.mjs verify` 红；schema.ts 已声明 priority；契约/端点/前端未消费 priority；无
> live/对账）。`overlay/` = 解题后文件全集——**唯一迁移文件是 002 的 down 侧**（up 侧
> 逐字节不动，D1 本体；schema.ts 亦零改动，起点已声明即判保持）。

## 1. 命令序列（在 attempt 应用根目录执行）

```
# ① 缺陷自救（诊断三路同指一处：node scripts/db.mjs verify / down 的
#    "缺 down 侧，拒绝回滚（先补 …）" / predev 的 up 告警——读输出，别猜）
node scripts/db.mjs verify        # 红：verify: 迁移不成对（缺 down 侧）: 002_add_priority
# ② 补 down 侧：drizzle/migrations/002_add_priority.down.sql（命名对齐 up 侧 stem；
#    内容 = ALTER TABLE notes DROP COLUMN priority；**不碰 up 侧一个字节**）
node scripts/db.mjs verify        # 绿：成对 + 影子库 up→down→up 幂等 + checksum 体检
# ③ priority 贯通（task1 合成半）：
#    src/lib/contract.ts（createNoteInput 加可选 priority 0-9；noteRow 补 priority）
#    src/app/api/notes/route.ts（POST 落库带 priority ?? 0）
# ④ live + 乐观对账（task2 合成半）：
#    src/lib/notes-bus.ts + src/app/api/notes/stream/route.ts + NotesList.tsx 对账
#    + POST 幂等合并与 after() 失效触发（本任务 id 契约为**可选**，见 §2-3）
# ⑤ src/lib/contract.test.ts：守卫测试与合成契约同步
pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm test
# 评分
node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task3-fullstack-rescue --attempt <attempt>
```

## 2. 关键决策

1. **最小修复，不重新生成迁移**：已应用迁移的 up 侧被改 = `db.mjs` integrity 体检红
   （checksum = sha256(up 字节)，up/verify 两路径同口径）；评分侧 D1 的对表对象 = 冻结
   manifest。down 侧不在 checksum 口径内——缺什么补什么，命名对齐既有 stem
   （`002_add_priority.down.sql`）。
2. **down 语义**：`ALTER TABLE notes DROP COLUMN priority`（SQLite 3.35+）；D1 的往返
   探针（fresh up+seed → down --to 001 → up → 快照比对）实测数据面逐字段等价，既有行
   priority=0 完好。
3. **id 契约改"可选"是 task3 合成态与 task2 的唯一实质分歧**：task1 语义的 M4 判据以
   `{body, priority}`（**无 id**）省略式创建并期待 2xx；task2 语义的 R2/R3 以 `{id, body}`
   驱动并要求 `{id:"x"}` 400。取 `id: z.number().int().min(1).optional()` 同时满足两侧：
   省略 = 服务端自增插入；给则同 id 幂等 upsert；类型违规照 400。
   （对照：task2 参考解把 id 钉成必填——两份参考解按各自任务的判据表取局部最优，
   这正是"判据语义是唯一验收"的体现。）
4. **after() 失效触发与 task2 同解**（响应落定后广播全量帧；R2 窗口口径的必要条件，
   论证见 task2 solution.md §2-3）；心跳 = SSE 注释行；stream route force-dynamic。
5. **合成组件**：task2 的对账骨架（帧即真相源整表覆盖 / optimisticAdd / revert+rollbacked
   +错误态）+ task1 的 priority 行内渲染（`优先级 {priority ?? 0}`，探针 id=777 值 9 落
   行内可见文本）——一个组件承载 task1∪task2 的全部 DOM 钩子契约。
6. **守卫测试同步**：合成契约（id 可选 + priority 0-9 可选）的拒绝/接受两翼各一组断言。

## 3. 逐条判据自查（task1 M1-M8 ∪ task2 M1-M3/R1-R3/C1-C2 ∪ D1-D2；2026-09-20 实测 18/18）

> [task1] M3 对本任务为"已应用状态保持一致"（002 在起点已应用；影子干跑补验可逆性）。

| # | 判据 | 自查证据 |
|---|---|---|
| [task1] M1 | schema.ts priority 列 | PASS——起点已声明，零改动即判保持 |
| [task1] M2 | 002 成对；001 与 002-up 零改动 | PASS——补 down 后成对；up 侧 sha256 与冻结 manifest 一致 |
| [task1] M3 | 影子干跑（列在/既有行 0/down 列消失/verify） | PASS——grade 实录四段全 ✓ |
| [task1] M4 | 可选 priority(0-9) 落库一致；越界/小数/非整数 400；省略按 0 | PASS——`{body, priority:7}`→201 落库 7；`{10/2.5/"7"}→400`；`{body}`→201 落库 0 |
| [task1] M5 | GET 行含 priority 且输出契约声明 | PASS——行均含 number 型 priority，非 500 |
| [task1] M6 | 契约单源完好 | PASS——route import 契约；契约含 int/max(9)/optional |
| [task1] M7 | 探针行 priority 值 9 可见 + data-note-id | PASS——C harness "m7: PASS" |
| [task1] M8 | 全绿门 | PASS——tsc ✓ / eslint ✓ / 成对 ✓ / vitest 5 用例 ✓ |
| [task2] M1/M2 | live 通道 SSE 可达、真实装配无 stub | PASS——HTTP 200 text/event-stream；ReadableStream 装配 |
| [task2] M3 | 静态门禁 + pnpm test | PASS——同 M8 门面 |
| R1/R2/R3 | 首连全量 / 2xx 后 ≤1s 推帧 / 违规 400 + 1.2s 无帧 + 订阅保持 | PASS——R2 实录 "POST(id=1789916276495 number) → 201；2xx 后 1s 墙钟内收到含该 id 新行的帧 ✓"；R3 双探针 400 + 窗口 0 帧 + 后续写到帧 |
| C1/C2 | 待定先行→单行已确认 / 失败回滚三态 | PASS——C harness "c1/c2: PASS" |
| D1 | 种子缺陷修复而非绕过：up 侧逐字节一致；down 在位；往返数据面等价；verify exit 0 | PASS——grade 实录：sha 一致 ✓ / down 在位 ✓ / 往返快照逐字段相等（含 priority=0）/ verify OK |
| D2 | 完成态门禁全绿 + pnpm test | PASS——tsc ✓ / eslint ✓ / 成对 ✓ / vitest 5 用例 ✓ |

## 4. 诚实边界

1. **overlay 不含 `002_add_priority.up.sql` 与 `src/db/schema.ts`——有意缺席**：attempt
   起点已带且参考解零改动即 D1/M1 本体（"已应用迁移永不重写"的正面践行）。
2. id 可选（§2-3）是按判据表并集反推的合成态契约——若集成方对 task3 的 id 语义另有
   拍板（如强制必填 + 改 M4 探针），本参考解的契约行与守卫测试需同步调整；现状以
   grade 18/18 为验收事实。
3. after() 的 R2 必要性、订阅表单实例语义等口径同 task2 solution.md §4。
