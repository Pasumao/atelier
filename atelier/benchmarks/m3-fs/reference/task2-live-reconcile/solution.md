# task2-live-reconcile 参考解（正控 · solution.md）

> 参考解作者与任务书作者分离（协议 §4.3）。attempt 起点 = `setup-baseline-atelier.mjs`
> 标准基线（表结构零改动）。`overlay/` = 解题后文件全集（含 regen 产物）。

## 1. 命令序列（在 attempt 应用根目录执行）

```
# ① contract.ts：noteCreateInput 改为 { id: number(min 1), body: string(min 1) }
#    —— id 改由客户端生成（§4.5 对账前提），随请求上行
# ② notes.ts：notes.list 加 live: { invalidate: ["table:notes"] }；
#    notes.create 加 emits: ["table:notes"] + idempotent: true，handler 改幂等 upsert
# ③ NotesPage.atr.ts/.atr.md：live 订阅 + §4.5 五步对账（optimisticList）
node <repo>/atelier/cli.mjs gen endpoint --root .      # api.ts regen（notes.list 获 .live() 客户端）
node <repo>/atelier/cli.mjs struct check               # exit 0
node <repo>/atelier/cli.mjs api-diff snapshot --root . # 无漂移（面不变）——刷新为流程纪律
node <repo>/atelier/cli.mjs api-diff check --root .    # exit 0
pnpm test                                              # 全绿
# 运行时场景自证（评分 harness 同型驱动）：
node src/server/main-server.ts                          # ATELIER_SERVER_READY 握手
#   R1  GET /api/notes.list/live → 首连全量 data 帧（{notes:[…]}，含种子 ≥2 行）
#   R2  POST /api/notes.create {id:<客户端正整数>, body} → ≤1s 内同订阅收到含该 id 的 data 帧
#   R3  POST 违规 {id:"x", body:""} → 400 ATR-201 四段式；1s 内无新 data 帧；订阅保持
```

## 2. 关键决策

1. **id 从"服务端生成"改为"客户端生成"（契约面：number, min 1）**：§4.5 对账协议的前提——
   optimistic commit(id) 与 live 推送同 id 幂等合并。基线表 `id INTEGER PK`（rowid）决定了
   客户端 id 的 JSON 类型是 **number（正整数）**：字符串 id 无法落 INTEGER 主键。
   违规载荷 `{id:"x", body:""}` 因 id 类型违规照样 ATR-201（R3 不受影响）。
   **此为本参考解对 brief v1 的一处消歧输入（v2 评分驱动约定已钉死）**。
2. **幂等 upsert**：`INSERT … ON CONFLICT(id) DO UPDATE SET …`——同 id 重放 = 更新，
   与 `idempotent: true` 元数据一致（模板 app.addNote 同型）。
3. **失效键读写两侧显式**：`live: { invalidate: ["table:notes"] }` + `emits: ["table:notes"]`
   （§4.1：显式声明优先于写捕获自动表名启发式；键语法合法，注册期无 ATR-314）。
4. **前端用生成物客户端**：`notesList.live({})`（§4.4 live 直通）+ `notesCreate.call(...)`——
   不手写 EventSource（模板 LiveNotes 手写是"init 即跑零生成步骤"的特例；基线已 gen）。
5. **id 双域**：线上域 number（JSON 契约）↔ 视图域 string（`optimisticList<T extends
   {id: string}>` 约束）——帧行在 `$derived` 里 `String(id)` 归一后合并，两侧同域判等。
6. **对账规则**：视图 = 服务端帧 ∪ 未被帧覆盖的 optimistic 行；帧已含的 id 直接用服务端值
   （真相源胜出，FS-DESIGN §4.5）；pending 徽标只在 `status === "pending"` 时出现。
7. **ATR-301 纪律**：模板表达式不支持可选链/函数调用——对账视图、行集、计数全部 `$derived`
   预计算；模板只读 `.value` 与属性链（`data-pending={row.isPending ? "true" : null}` 三元
   合法，null → removeAttribute）。
8. **回滚名单钩子**：`optimisticList.revert(id)` 记入 `rollbacked: string[]`；渲染为带
   `data-rollbacked="true"` 的元素、文本含被回滚 id（C2 判据面）。

## 3. 逐条判据自查（M1-M3 / R1-R3 / C1-C2）

| # | 判据 | 自查证据 |
|---|---|---|
| M1 | notes.list live 且失效键 table:notes；notes.create 显式 emits | PASS——notes.ts 声明逐字如上；server 启动注册期无 ATR-314 |
| M2 | 产物不含非法失效键（ATR-314 面注册期拦截） | PASS——唯二键 `table:notes` 合法；注册成功即证明 |
| R1 | SSE 首连收到全量 data 帧 | PASS——GET /api/notes.list/live 200 event-stream，首帧 `{notes:[种子行…]}` |
| R2 | POST 成功创建后 ≤1s 同订阅收到含该 id 新行 | PASS——实测自 POST 起 ~40-55ms（coalesce ~50ms 量级）帧含该 id |
| R3 | POST 违规 → ATR-201 四段式；live 无新帧；订阅保持 | PASS——400 {code:"ATR-201", message, context, fix}；1s 内帧数不变；随后合法写同连接仍收到帧（订阅未断） |
| C1 | 挂载驱动提交：待定出现 → 推送窗口后该 id 恰一次、已确认 | PASS——dom-shim 冒烟（mock EventSource/fetch）：pending 行 data-pending="true" → commit 后徽标消失 → 帧到达同 id 合并仅一次、服务端值胜出 |
| C2 | 失败提交：待定消失、回滚名单含 id、错误态含 fix | PASS——400 ATR-201 → 行消失、其余行不受影响、`data-rollbacked` 元素含 id、错误卡 code/message/fix 可见 |
| M3 | struct/api-diff exit 0；pnpm test 全绿 | PASS——0 error · 0 warn；gate PASS；19/19 |

## 4. 诚实边界

- **runtime 单实例化是基线责任件**（RUNBOOK §1 红线）：gen endpoint 产物 import
  `src/vendor/atelier/runtime`，与组件面 `src/runtime` 是两份 vendored 拷贝——不单实例化则
  live 帧 push 与组件 $state 跨实例不追踪，C1 假阴性。基线脚本 S10b 已把 vendor runtime 入口
  改写为转发 shim（本参考解依赖该基线；评分 harness 的 dom-shim 挂载同样依赖）。
- R2/R3 的窗口实测值依赖本机时序（coalesce ~50ms + 流式传输）；评分断言窗口 ≤1s 对三臂同值
  （协议 §8.4），实测余量 >10 倍。
- overlay 的 api-surface.json 环境元数据口径同 task1 solution.md §4。
