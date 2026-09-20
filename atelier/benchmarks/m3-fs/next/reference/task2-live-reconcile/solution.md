# task2-live-reconcile 参考解（正控 · solution.md）

> 参考解作者与任务书作者分离（协议 §4.3）。attempt 起点 = `setup-baseline-next.mjs`
> 标准基线（表结构零改动；Next.js 无内建 live 原语——SSE Route Handler + 订阅表 +
> 客户端对账全部由本参考解装配）。`overlay/` = 解题后文件全集（无新增依赖）。

## 1. 命令序列（在 attempt 应用根目录执行）

```
# ① src/lib/contract.ts：createNoteInput 钉死 { id: number 正整数, body: 非空字符串 }
#    —— id 客户端生成随请求上行（§4.5 对账前提；字符串 id 属契约违规 → 400）
# ② src/lib/notes-bus.ts：进程内订阅表（模块级单例）+ broadcastNotes + notesFrame
# ③ src/app/api/notes/stream/route.ts：SSE Route Handler（首连全量帧 + 订阅 + 注释行心跳）
# ④ src/app/api/notes/route.ts：POST 改幂等 upsert；after() 响应落定后广播全量帧（见 §2-3）
# ⑤ src/components/NotesList.tsx：EventSource 订阅 + §4.5 五步乐观对账 + 提交入口
# ⑥ src/lib/contract.test.ts：守卫测试与 id 契约同步
pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm test
# 评分
node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task2-live-reconcile --attempt <attempt>
```

## 2. 关键决策

1. **id 客户端生成，契约钉死 JSON number 正整数**（`z.number().int().min(1)`）：§4.5 对账
   协议的前提——optimistic commit(id) 与 live 推送同 id 幂等合并。表主键 INTEGER 决定了
   字符串 id 落不了库，`{id:"x"}` 属契约违规 → 400（R3 的类型违规探针正考这个）。
2. **幂等 upsert**：`insert … .onConflictDoUpdate({ target: notes.id, set: { body } })`——
   同 id 重放 = 更新而非重复插入（不产生重复行）。
3. **写侧失效触发用 `after()`（next/server）在响应落定后执行——这是 R2 窗口口径的必要
   条件，不是可选的优雅**：评分窗口"自 POST 收到 2xx 响应起计 ≤1s"以 `from: t2resp` 过滤
   帧；若在 handler 内同步广播，帧可能先于 POST 响应到达评分器的 SSE 客户端（两个本地
   socket 的到达序是竞态），被窗口过滤掉 → R2 假红。`after()` 保证帧严格晚于 2xx 发出。
   实测两轮正控 R2 均绿（帧到达 ~10ms 量级，窗口余量 ~100 倍）。
4. **订阅表 = `src/lib/notes-bus.ts` 模块级单例**：Route Handler 文件只能导出 HTTP 方法与
   路由配置段——Next 生成的路由类型体检（`.next/types/**`，tsc 的 include 里有）会把其余
   导出判非法 → tsc 红。订阅表/广播函数必须放独立模块，stream route（订阅侧）与 notes
   route（写侧触发）import 同一份（请求作用域 = 永远只有创建者自己收到推送）。
5. **心跳 = SSE 注释行 `: ping`（15s 间隔）**：评分器只把 `data:` 行记为帧——R3 的 1.2s
   无帧观察窗不会被心跳污染；用 data 帧做保活 = R3 必红。
6. **stream route 显式 `export const dynamic = "force-dynamic"`**：静态化是真实存在的
   缓存边界（stream 被静态化 = 订阅静默失效）。
7. **客户端对账 = "帧即真相源"的整表覆盖**：`es.onmessage` 收帧后 `setNotes(frame.notes)`
   ——同 id 幂等合并、服务端值胜出、pending 行被确认行取代，天然不产生重复行；
   optimistic 插入（§4.5-1）用 `id = Date.now()`（正整数）先行渲染 `data-pending="true"`；
   成功路径（§4.5-3a）不改列表，等帧对账；失败路径（§4.5-3b，`res.ok` 为假时把错误体
   `{code,message,fix}` 抛给 catch）revert 该 id + 记入回滚名单 + 错误态渲染 fix 文本。
8. **提交真实走 `fetch("/api/notes")`**：Server Action 在 jsdom 网络面不可见（转译件钉死
   的 C 类可见性约束），UI 提交路径选 fetch。
9. **守卫测试同步**：id 契约变了——补"缺 id / 字符串 id / 非正整数 id 拒绝"三断言，
   原有用例的载荷补上 id。

## 3. 逐条判据自查（M1-M3 / R1-R3 / C1-C2；2026-09-20 实测 grade JSON，正控跑两轮均绿）

| # | 判据 | 自查证据 |
|---|---|---|
| M1 | live 通道 SSE 语义可达 | PASS——stream 路由 HTTP 200，content-type = text/event-stream |
| M2 | 无占位/非法残留 | PASS——ReadableStream + TextEncoder 真实装配，无 stub 字样 |
| R1 | 首连全量帧（帧行 ⊇ GET 行且非空） | PASS——start() 里先推 `{notes:[…]}` 全量快照再挂订阅 |
| R2 | POST(id=number) 成功后 ≤1s（自 2xx 起计）同订阅收到含该 id 帧 | PASS——"POST(id=1789916252873 number) → 201；2xx 后 1s 墙钟内收到含该 id 新行的帧 ✓"（两轮正控复现） |
| R3 | 违规 400 结构化 + 1.2s 无帧 + 订阅保持 | PASS——`{body:""}→400` 结构化体；`{id:"x"}→400`；失败后 1.2s 窗口新 data 帧 0 条；后续合法写 1s 内到帧（订阅未断） |
| C1 | 成功提交：待定先行 → 窗口后该 id 仅一行、已确认 | PASS——C harness "c1: PASS"（mock EventSource 帧对账后单行、无 data-pending） |
| C2 | 失败提交：待定消失 + 回滚名单含 id + fix 可见 | PASS——C harness "c2: PASS"（`data-rollbacked` 元素含 id；错误态渲染 mock 400 的 fix 文本） |
| M3 | 静态门禁全绿 + pnpm test | PASS——tsc ✓ / eslint ✓ / 迁移成对且 verify 幂等 ✓ / vitest 4 用例 ✓ |

## 4. 诚实边界

1. **`after()` 的 R2 必要性是本参考解的实测发现**（§2-3）：同步广播在两本地 socket 上是
   到达序竞态——解题者按"直觉"在 handler 里直接广播，可能出现"偶发假红"。是否把该坑
   回填转译件陷阱节（或评分器改用"最近一帧"口径），提请集成方裁决；参考解不绕判据，
   采用框架内建的正规解法（after 即 Next 官方"响应后执行"原语）。
2. R2/R3 的窗口实测值依赖本机时序；评分窗口对三臂同值（协议 §8.4），实测余量 >100 倍。
3. 进程内订阅表 = 单实例语义（`next dev` 单进程下成立）；重启即清，EventSource 自动重连
   + 首连全量帧自愈——未写任何重连逻辑（浏览器已处理），与转译件陷阱节口径一致。
