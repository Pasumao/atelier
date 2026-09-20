# M3-FS R/C 场景规格（三臂语义同文锚 · FS-10 执行半）

> 本文档是 M3-FS 全栈任务臂**运行时与客户端判据的单一规格源**（对外开源件，协议 §4.1 开放
> 口径）：`grade.mjs` 的 S/T 类与 `harness/acceptance.spec.ts` 的 R/C 类、以及对照臂 harness
> 的等价实现，断言语义全部以本文为准。**三臂拿到的场景语义是同一份本文**——对照臂实现按
> 判据语义逐条转译（协议 §4.2"判据语义全同、实现分臂"）。
>
> **断言窗口对三臂同值，规格不公 = 数据作废**（protocol §8.4 原条款）。本文钉死的每一个
> 窗口值、载荷形状、钩子名，任何一臂的 harness 实现不得放大或收窄；修订本文 = 修订实验，
> 必须留痕并作废此前全部数据。
>
> 判据编号以 `tasks/task{1,2,3}.brief.md` 为准；本文负责"编号 ↔ 类别 ↔ 断言步骤"的映射表。

---

## 1. 基线形态（R/C 场景的公共前提，setup 脚本必须逐字满足）

| 项 | 值 | 说明 |
|---|---|---|
| 端点挂载 | `/api` | `createHandler({ mount: "/api" })` |
| 列表端点 | `notes.list`（query） | 响应恒为 `{ "notes": [行…] }`（§2.3 扁平 schema 顶层对象红线） |
| 创建端点 | `notes.create`（command） | 幂等 upsert（客户端 id 同 id 重放 = 更新）；成功载荷 = 存后行 |
| notes 表 | `id INTEGER PRIMARY KEY, body TEXT NOT NULL, createdAt INTEGER NOT NULL` | **id = 客户端生成的 JSON number**（正整数，如 `Date.now()`；brief v2 钉死——§4.5「同 id 幂等合并」的前提）；001 迁移已应用 |
| 基线种子 | 3 行：`1`/"first note"、`2`/"second note"、`3`/"third note" | `migrate seed` 已入；R1 首连全量帧必须含全部三个 id |
| server 启动壳 | `src/server/main-server.ts` | `node` 直跑（node ≥22.18 类型剥离）；env 契约见下 |
| 握手行 | stdout 恰好一行 `ATELIER_SERVER_READY {"port":<port>}` | harness 探活唯一依据（openapi-golden 同源） |
| runtime 单实例化 | `src/vendor/atelier/runtime/index.ts` = 对 `src/runtime` 的纯转发 shim（基线装配件 S10b） | 两份 vendored runtime 不单实例化 → live 帧 push 与组件 $state 跨实例不追踪 → C 类假阴性（RUNBOOK §1 红线） |

**server env 契约**（R 类场景 harness 注入；基线装配必须遵守，模板既有约定）：

- `ATELIER_SERVER_PORT=0`（自动分配端口——测试纪律：listen 一律 0，绝不固定口）；
- `ATELIER_DB_PATH=<副本路径>`（**R 场景打的是 `.atelier/dev.db` 的临时副本**——场景写库
  绝不弄脏 attempt 原库；`M4` 落库检查也读同一副本）；
- `ATELIER_SERVER_MOUNT=/api`。

**通用传输约定**（FS-DESIGN §3.3/§4.3）：

- 端点调用 = `POST /api/<name>`，JSON 体 = 契约输入（query 与 command 同走 POST）；
  **创建载荷的 `id` 是 JSON number**（客户端生成的正整数）；违规载荷如
  `{ "id": "x", "body": "" }`（id 类型违规）→ HTTP 400 + ATR-201 四段式；
- live 通道 = `GET /api/notes.list/live?input=<encodeURIComponent(JSON.stringify(input))>`
  （SSE；input 可为 `{}`）。线协议：首帧 `retry: 3000` 起始；`event: data` 帧 = 输出契约
  校验过的 JSON（首连全量 + 每次失效重算后的全量列表）；`event: error` = ATR 四段式 JSON
  （订阅保持）；`: ping` 心跳注释行（harness 解析器必须跳过）；
- 违规载荷 → HTTP 400 + ATR-201 **四段式** `{"code","message","context","fix"}`
  （fix 为非空可执行提示）。

**task1/task3 追加**（priority 列贯通后）：`notes.create` 成功载荷含 `priority`（回显）；
`notes.list` 行含 `priority`。输入可选：省略按 0，取值 0-9 整数。

---

## 2. DOM 钩子契约（C 类解题组件的驱动约定 · 原文）

> 本节为 harness 与**解题组件**的约定（三臂转译件按语义等价收录）。解题组件必须让以下
> 钩子在挂载后的 DOM 上成立，harness 只依赖这些钩子，不依赖组件内部实现。

1. 列表行携带 `data-note-id="<id>"`（每行恰好一个 id）；
2. 待定（optimistic 先行渲染）行另带 `data-pending="true"`；
3. 提交入口 = 一个文本 `<input>`（body 输入）+ 一个提交按钮 `<button>`（各自恰好一个）；
4. 回滚名单 = 带 `data-rollbacked` 的元素，其内容（textContent）含被回滚的 id；
5. 错误信息（含 fix 提示）在 DOM 可见（textContent 含 ATR 码与 fix 文案）；
6. priority 在行内可见文本中出现（task1/task3）。

**挂载方式**：`mountComponent(NotesPage, {}, container, <attempt runtime registry>, validateFlat)`
——不传 props；组件自行取数（task1 形态：fetch `notes.list`；task2/task3 形态：live 首帧
或 fetch 皆可，harness 两者都喂）。C 类驱动使用 mock EventSource/fetch（模板
`LiveNotes.atr.spec.ts` 同款手法），馈送行形状见 §3。

---

## 3. C 类馈送行（harness 注入的确定形状）

harness 在挂载后经 mock 通道馈送的列表载荷恒为 `{ "notes": [行…] }`，行形状：

| 任务 | 行 |
|---|---|
| task2 | `{"id":101,"body":"alpha","createdAt":11}`、`{"id":202,"body":"beta","createdAt":22}` |
| task1/task3 | 同上 + `"priority"`：101→3、202→7 |

> 取值纪律：body 无数字字符、createdAt 不含 3/7 之外会与 priority 断言串扰的数字位——
> priority 断言是"行 textContent 含 `3` / `7`"，馈送形状必须保证该断言只对 priority 成立。

---

## 4. 断言窗口（三臂同值 · 逐值钉死）

| 窗口 | 值 | 用途 | 起算点 |
|---|---|---|---|
| `PUSH_WINDOW_MS` | **1000ms** | R2：同一订阅须在 ≤1s 墙钟内收到含该 id 的 data 帧（覆盖 coalesce ~50ms + 传输时延） | **自 POST 收到 2xx 响应起计** |
| `QUIET_WINDOW_MS` | **1000ms** | R3：静默窗口内同一订阅不得出现任何新帧 | 自违规 POST 应答到达起计 |
| `FIRST_FRAME_TIMEOUT_MS` | 5000ms | R1：首连全量帧宽限（基础设施余量，**不计入考点窗口**） | 自发起 SSE 订阅起计 |
| `SERVER_START_TIMEOUT_MS` | 15000ms | 握手行探活宽限（基础设施余量） | 自 spawn 起计 |

实现形态：窗口 = **轮询超时**（`reader.next(1000)` 语义：1s 内无帧 → null）。调大窗口
= 对慢实现放水，调小 = 对慢机器误杀，两臂不一致 = 数据作废。R1 首连全量是即时首算
（§4.6 live 诚实边界），不受 PUSH_WINDOW 约束。

---

## 5. 逐任务 R 场景步骤（服务端黑盒；R 类判据）

### 5.0 公共前置

1. 拷贝 `.atelier/dev.db` → 系统临时副本；
2. spawn `node <attempt>/src/server/main-server.ts`（env 契约见 §1）→ 读握手行拿端口；
3. task2/task3 场景续：R1→R2→R3 共用**同一个 SSE 订阅**。

### 5.1 task1（M4、M5）

- **M4**：
  1. 内省 `src/server/endpoints/notes.ts`：`notes.create` 的 contract 含
     `optProps.priority = {type:"number", min:0, max:9}` 且 `reqProps` 无 priority；
  2. `POST /api/notes.create {"id":20250920101,"body":"m4 note","priority":7}` → 200，
     载荷 `priority===7`；
  3. `POST /api/notes.create {"id":20250920102,"body":"m4b note"}` → 200；
  4. 库副本检查：`20250920101` 行 `priority=7`；`20250920102` 行 `priority=0`（省略按 0）。
- **M5**：`POST /api/notes.list {}` → 200（200 即 dev 态输出校验不红——ATR-215 会以 500
  显形），`notes` 数组中 `id===20250920101` 行携带 `priority===7`。

### 5.2 task2 / task3（R1-R3，场景续）

- **R1**：`GET /api/notes.list/live?input=%7B%7D` 订阅 → 5s 内收到首个 `event: data` 帧：
  ①流以 `retry: 3000` 起始；②帧 JSON `notes` 数组含全部三个种子 id（1/2/3——首连=全量）。
- **R2**：`POST /api/notes.create {"id":20250920001,"body":"push me"}` → 200 且载荷含
  `id===20250920001`（客户端 id 回显）；**同一订阅**自 2xx 应答起 ≤1s 收到 data 帧，其
  `notes` 含 `id===20250920001` 的行。
- **R3**：`POST /api/notes.create {"id":"x","body":""}`（id 类型违规）→ 400 + ATR-201
  四段式（code/message/context/fix 四键俱全，fix 非空）；**同一订阅** 1s 静默窗口内无新帧，
  且订阅未关闭（`closed === false`——失败路径订阅保持；断流重连语义归框架，组件/服务端
  不得亲手断）。

### 5.3 task3（D1，库副本干跑——绝不动原库）

1. `migrate verify`（影子库干跑，exit 0——up 侧与库内 sha256 状态表一致 = 未被改）；
2. 库副本先 dump notes 全行 → `migrate down --to 001 --db <副本>` → `migrate up --db <副本>`；
3. 再 dump 对比：(id, body, createdAt) 三元组逐行等价、priority 列复原且既有行 =0
   ——**"数据面与修复前等价"的机检口径**。down 侧绕过式修复（如 `DELETE FROM notes;`
   或漏撤列）在此显形。

---

## 6. 逐任务 C 场景步骤（dom-shim 挂载驱动；C 类判据）

### 6.1 task1 / task3（M7）

1. 装 mock（EventSource/fetch）→ 挂载 `NotesPage`（无 props）→ flush；
2. 组件若建立了 live 订阅则喂首帧 `{notes: §3 馈送行}`（两种取数形态都兼容）；
3. 断言：`[data-note-id]` 行数 ≥ 2；`data-note-id="202"` 行 textContent 含 `7`，
   `data-note-id="101"` 行 textContent 含 `3`（行内可见 priority 值）。

### 6.2 task2 / task3（C1，成功路径）

1. 装 mock → 挂载 → 喂首帧（§3 馈送行）→ flush → 断言种子行已渲染；
2. `createResponder` 改为**受控 deferred**（pending 断言必须发生在响应落地前）；
3. 驱动提交：`<input>` dispatch input（value="hello m3fs"）→ `<button>` dispatch click → flush；
4. 断言：捕获到 `notes.create` 调用，body 含非空 `id`（客户端 id）且 `body.body==="hello m3fs"`；
   DOM 出现 `data-note-id="<id>"` 且 `data-pending="true"` 的行（待定先行渲染）；
5. 释放 200 应答 → flush → 喂 live 帧 `{notes: [馈送行…, {id, body:"hello m3fs", createdAt:44}]}`
   → flush；
6. 断言：`data-note-id="<id>"` 行**恰好 1 个**（无重复行）、无 `data-pending`（已确认）、
   行文本含 body；既有行 101/202 各仍恰好 1 个（成功路径不弄脏列表）。

### 6.3 task2 / task3（C2，失败路径）

1. 装 mock → 挂载 → 喂首帧 → flush；
2. `createResponder` 注入 400 + ATR-201 四段式（§7 样例）；
3. 驱动提交（"doomed note"）→ flush；
4. 断言：①`data-note-id="<id>"` 行数 = 0（revert 生效）；②存在 `data-rollbacked` 元素且其
   textContent 含 `<id>`；③container textContent 含 `ATR-201` 且含注入的 fix 文案（fix 可见）；
   ④既有行 101/202 各仍恰好 1 个（失败路径不弄脏列表）。

---

## 7. ATR 断言面（判据引用到的错误码 · 出处见 FS-DESIGN §15）

| 码 | 断言位 | 判据 |
|---|---|---|
| ATR-201 | 违规 `notes.create`（空 body）→ 400 四段式；C2 失败注入样例：`{"code":"ATR-201","message":"body: 长度 0 小于最小 1","context":{…},"fix":"按契约修正输入：body 非空（scenario-spec C2 注入样例）"}` | R3 / C2 / M4 |
| ATR-215 | dev 态输出契约违规（output 声明了 handler 没给的字段 → 500）——M5 以"list 200"间接断言 | M5 |
| ATR-314 | 失效键语法非法注册期被拒——M1/M2 内省断言最终产物键全部匹配 `^(table:[A-Za-z0-9_]+\|key:.+)$` | M2（task2） |
| ATR-321 | live 重算失败推 error 帧、订阅保持——R3 的"订阅保持"断言同语义位 | R3 |
| ATR-331/333 | 迁移缺 down / down 执行失败——M2（成对）、M3/D1（down 步骤）显形 | M2 / M3 / D1 |
| ATR-332 | 已应用迁移 up 侧被改（sha256 对不上状态表）——D1 verify 步骤显形 | D1 |
| ATR-334 | up 失败事务回滚（NOT NULL 无缺省加列路径）——M3 up 步骤显形 | M3 |

---

## 8. 判据编号 ↔ 类别映射表（grade.mjs checks[] 的组装依据）

类别语义（protocol §4.2）：**S**=结构/静态守卫 · **R**=服务端黑盒场景 · **C**=客户端对账 ·
**T**=应用测试门。复合判据（brief 把多道门写进一条编号时）按类拆行、同 id 两行，pass = 两行
全绿；"该 id 任一行 fail 即判据未过"。

### task1-column-change

| id | 类 | 断言内容 | 实现位 |
|---|---|---|---|
| M1 | S | schema.ts notes 表含 priority（integer/notNull/default 0）——内省 `table()` def | grade.mjs |
| M2 | S | migrations 出现 `002_*.up.sql`+同名 `.down.sql` 成对（001 系零改动由 M3 checksum 兜底） | grade.mjs |
| M3 | S | 库副本：up 得列且既有行=0 → down --to 001 列消失 → verify exit 0 | grade.mjs |
| M4 | R | §5.1 全步骤（契约内省 + 行为 + 落库） | acceptance.spec |
| M5 | R | §5.1 M5 步骤 | acceptance.spec |
| M6 | S | `src/generated/api.ts` regen 字节幂等（快照→gen endpoint→比对→有差原样归还） | grade.mjs |
| M7 | C | §6.1 | acceptance.spec |
| M8 | S+T | struct check exit 0 且 api-diff check exit 0（S 行）；`pnpm test` 全绿（T 行） | grade.mjs |

### task2-live-reconcile

| id | 类 | 断言内容 | 实现位 |
|---|---|---|---|
| M1 | S | notes.list 声明 live 且失效键含 `table:notes`；notes.create 显式 emits 含 `table:notes`（内省 def） | grade.mjs |
| M2 | S | 全部 live/emits 键合法（§7 ATR-314 面） | grade.mjs |
| R1/R2/R3 | R | §5.2 场景续 | acceptance.spec |
| C1/C2 | C | §6.2 / §6.3 | acceptance.spec |
| M3 | S+T | struct + api-diff（S 行）；`pnpm test`（T 行） | grade.mjs |

### task3-fullstack-rescue（brief：判据 = task1 M1-M8 ∪ task2 M1-M3、R1-R3、C1-C2 ∪ D1/D2）

编号冲突合并规则（同类别双源 → 一行双语义；id 仍逐字取自 brief 编号空间）：

| id | 类 | 断言内容（合并注记） |
|---|---|---|
| M1 | S | task1-M1（schema priority 列）∧ task2-M1（live/emits table:notes） |
| M2 | S | task1-M2（002 成对）∧ task2-M2（无非法失效键） |
| M3 | S | task1-M3 之 task3 修正语义：已应用状态保持一致（副本 up 零待应用）+ down --to 001 列消失 + verify |
| M4/M5/M7 | R/R/C | 同 task1 |
| M6 | S | 同 task1 |
| M8 | S+T | struct + api-diff（S 行）；pnpm test（T 行）——M8 的 S 半已覆盖 task2-M3 的 S 半 |
| R1-R3 / C1-C2 | R/C | 同 task2 |
| D1 | S | §5.3（verify + down→up 往返数据面等价 + priority 列复原） |
| D2 | S | 完成态 struct exit 0（含第 7/8 层）+ `pnpm test` 全绿——命令与 M8 同源取证，语义独立成行 |

---

## 9. 诚实边界（规格自身的边界，逐条成文）

1. **M5 的"output 契约已声明该字段"落为行为断言**：§2.3 扁平 schema v1 不表 array 元素的
   元素级结构，行字段无法在 output 契约里声明——故 M5 机检口径 = 200（dev 态输出校验不红）
   + 行携带一致 priority。这与 task1 brief M5 括号内的可执行语义一致。
2. **id 类型无关比较**：判据一律 `String(实际) === String(期望)` 对 id 比较；§1 钉死基线
   为 integer 主键、载荷 id = JSON number（brief v2），harness 侧不依赖 JS 类型形态。
3. **C 类经 mock 网络面**：mock EventSource/fetch 只替代浏览器网络层，渲染走
   `mountComponent` 真实解释器路径（不绕过）——与真实 browser 行为的差异（CSS/真实 SSE
   事件时序）不在 C 类断言面内。
4. **R 类窗口是轮询语义**：`next(1000)` 超时返回 null = 判据输入，不是对实现性能的度量；
   窗口值见 §4，三臂同值。
5. **种子行 id 是规格的一部分**：R1 依赖 §1 三行种子；setup 脚本换种子 = 违反本文 = 该批
   数据作废。
6. task3 的 D2 与 M8 同源取证（同一组命令跑一遍，两行各自记账）——不是重复跑，也不是
   豁免：语义上是"过程门"与"完成态门"两问，取证同源。
