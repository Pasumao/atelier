# task1-column-change 参考解（正控 · solution.md）

> 参考解作者与任务书作者分离（协议 §4.3）。attempt 起点 = `setup-baseline-next.mjs`
> 标准基线（next 15.5.25 App Router + Drizzle/SQLite + zod 契约单源；001 已应用，库含
> 种子 2 行）。`overlay/` = 按 next 应用根相对路径摆放的解题后文件全集（本任务无新增
> 依赖，全部落在基线钉版内）。

## 1. 命令序列（在 attempt 应用根目录执行）

```
# ① 手写成对迁移（drizzle-kit 生成的是单向迁移、无 down 侧，且不识别本基线
#    drizzle/migrations/ 的 NNN_<name>.up/.down 口径——手写更快且是唯一合规形态）
#    drizzle/migrations/002_add_priority.up.sql    # 与基线冻结种子同文（见 §2 决策 1）
#    drizzle/migrations/002_add_priority.down.sql
# ② src/db/schema.ts：notes 表声明 priority（integer notNull default 0）
#    ——注意列声明上方的注释不要出现 "priority" 一词（见 §4 诚实边界第 1 条）
# ③ src/lib/contract.ts：createNoteInput 加 priority（0-9 整数可选）；
#    noteRow 输出契约补 priority（M5：输出契约不声明该字段会被输出校验剥掉）
# ④ src/app/api/notes/route.ts：POST 落库带 priority（parsed.data.priority ?? 0）；
#    解析器继续从 @/lib/contract import（M6 契约单源，禁止内联复本）
# ⑤ src/components/NotesList.tsx：行内渲染优先级（行内可见文本含 priority 值）
# ⑥ src/lib/contract.test.ts：守卫测试与契约同步（M8 的 test 门）
node scripts/db.mjs up          # 002 应用到本地库（既有行回填 0）
node scripts/db.mjs verify      # 影子库干跑：成对 + up→down→up 幂等 + checksum 体检
pnpm exec tsc --noEmit          # S 门
pnpm exec eslint .              # S 门
pnpm test                       # T 门
# 评分（worktree 内执行；attempt 须在无空格路径）
node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task1-column-change --attempt <attempt>
```

## 2. 关键决策

1. **002 up 侧与基线冻结种子逐字节同文**：评分器 M2 的 `migration002Check` 以冻结
   manifest 的 sha256 对表 002 up 侧（"已应用迁移永不重写"口径的 task1 投影），内容实际
   被钉死为 `ALTER TABLE notes ADD priority INTEGER NOT NULL DEFAULT 0;`。这与最优写法
   自然重合——SQLite 对已有数据的表加 NOT NULL 列必须带 DEFAULT，既有两行种子回填 0。
2. **down = `ALTER TABLE notes DROP COLUMN priority`**：SQLite 3.35+（better-sqlite3
   12.x 内置版本满足）；`db.mjs verify` 的影子库 up→down→up 幂等干跑通过。
3. **契约 0-9 挂输入、省略归一挂 handler**：`z.number().int().min(0).max(9).optional()`
   一次拦下越界（10）/小数（2.5）/非整数（"7"）/负数；handler 里 `?? 0` 落实"省略按 0"。
   noteRow（输出面）用无约束 number——落库值已受输入约束。
4. **route 保持从契约模块 import 解析器**：M6 以"route 文件出现 `from …/contract` import"
   + 契约源码含 optional/int/max(9) 声明判单源完好；内联一套 zod 复本 = M6 红。
5. **前端渲染口径**：行内 `{note.body} <span>优先级 {note.priority ?? 0}</span>`——探针
   （id=777，priority=9）的行内可见文本含 "9"；`Note.priority` 声明为可选以兼容契约演进。
6. **守卫测试同步**：契约改了测试跟上（M8 的 `pnpm test` 门）——补 priority 拒绝/接受
   与 noteList 行含 priority 三组断言。

## 3. 逐条判据自查（M1-M8；2026-09-20 实测 grade JSON）

| # | 判据 | 自查证据 |
|---|---|---|
| M1 | schema.ts priority 列（integer/notNull/default 0） | PASS——列声明行字面量三要素齐备（探针窗口注意点见 §4-1） |
| M2 | 002 成对出现；001 系零改动 | PASS——up 侧 sha256 与冻结 manifest 一致；001 两文件字节未动；down 侧在位 |
| M3 | 影子库 up 得列且既有行=0；down --to 001 列消失；verify exit 0 | PASS——grade 实录："up+seed 后列: id,body,created_at,priority; 既有行(2) priority 全 0: ✓; down --to 001_create_notes 后列消失: ✓; verify(干跑): OK" |
| M4 | POST 输入契约可选 priority(0-9)；落库一致；越界/小数/非整数 400；省略按 0 | PASS——`{priority:7}`→201 落库 7；`{10→400, 2.5→400, "7"→400}`；省略→201 落库 0 |
| M5 | GET 行含 priority 且输出契约已声明（非 500） | PASS——行均含 number 型 priority，输出校验不红 |
| M6 | 契约单源完好 | PASS——route `import … from "@/lib/contract"`；契约含 `.int().min(0).max(9).optional()` |
| M7 | 挂载 NotesList：探针行 priority 值可见 + data-note-id | PASS——C harness "m7: PASS"（探针 id=777 行内含 9） |
| M8 | 全绿门 | PASS——tsc ✓ / eslint ✓ / 成对 ✓ / pnpm test ✓（4 用例） |

## 4. 诚实边界

1. **M1 探针窗口是本参考解真实踩过的坑（首版假红，修正后复评绿）**：M1 从 schema 文本里
   **第一个 "priority" 出现处**切 220 字符窗口做三要素正则。首版参考解在表定义**上方注释**
   里写了"task1：新增 priority 列…"，窗口被注释消耗，列声明落在窗外 → M1 假红。修正 =
   注释不含该词，列声明行成为首个出现处。判读：这是判据实现的脆弱窗口而非语义错误
   （正则语义是"声明处附近找三要素"），但不看过 grade-next.mjs 源码的解题者可能踩坑
   ——是否回填 task1 转译件陷阱节，提请集成方裁决（参考解不改判据、不绕判据）。
2. **M2 对 task1 的实现口径严于 brief 文面**：brief M2 只写"新成对迁移 + 001 零改动
   （sha256 对表）"，实现另要求 002 up 侧 sha256 与冻结种子一致——即 002 up 内容被钉死。
   语义等价但字节不同的 up 侧（如换注释、换列序）会被判红。参考解按种子同文处理、
   不构成障碍，但属"判据/转译件偏差"观察项，提请集成方裁决。
3. 本任务不装 live/对账（那是 task2）——组件仍是"打开页面拉一次"，与 brief 目标状态一致。
