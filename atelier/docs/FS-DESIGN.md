# Atelier 全站框架细化设计（FS 线实现规格 v0.1）

> 版本：v0.1（2026-09-19）。性质：**决策 17-23 之下的实现级细化**——方向不重开、不做清单不翻案；
> 把 BACKLOG FS 线（FS-1~FS-11）与远期位逐项展开为可执行规格，并对 2026-09 调研中的前沿概念
> 做**穷尽式评估**（§16：每项有取/舍/定位，不留未评估项）。
> 依据：决策 0-23 × FS-M1 已落地代码（`atelier/server/{endpoints,sqlite}.ts`）× 三路调研
> （`research/2026-09-report{1,2,3}-*.md`）× 归档设计书（git 锚点 `6d25ef7`，结论已进决策记录）。
> 标注约定：〔定〕= 决策 17-23 已支撑；〔议〕= 本文新提案，待用户拍板（汇总见 §19 拍板清单 D-F11+）；
> 〔险〕= 风险项（§18）。估量沿用 S/M/L。
> 分工纪律：**执行队列唯一源仍是 `BACKLOG.md`**——本文只给规格与排序建议，立项/销账照旧走 BACKLOG；
> 与 `design-decisions.md` 冲突时以决策记录为准。总原则不变：**框架不内嵌 LLM**。

---

## 0. 读法与裁决标准

"最先进、最现代、最适合 AI 编程"在本文的操作性定义（三句）：

1. **最先进** = 2026 前沿概念全部评估过、有意识地取舍（§16 穷尽表），无人区四件做深（决策 17：
   全站结构机检 / 全站双轨回滚 / API 面漂移门禁 / 首遍正确率对照实验）。
2. **最现代** = 站在行业收敛线上而非逆行：Web 标准 API、读写二分端点、Standard Schema 互操作、
   MCP 2026-07-28 无状态、编译期化（生成器 + AOT 投影）、SQLite 单库承载一切。
3. **最适合 AI 编程** = 每个设计细节过**裁决五问**（本文一切小节的验收口径）：

| # | 裁决问 | 对应机制 |
|---|---|---|
| Q1 | 单文件可静态理解吗（显式 import 闭合、无隐式图）？ | 决策 23 生成器形态学第四级 |
| Q2 | 出错是四段式 `{code,message,context,fix}` 且可导航吗？ | 决策 9 / §15 错误码表 |
| Q3 | 违规会被机检抓住吗（不假红）？ | struct 八层 / api-diff / 守卫测试 |
| Q4 | 砸了能退吗（双轨回滚：源码 + 迁移 + 状态）？ | 决策 15/21 / §5.4 |
| Q5 | 反馈回路亚秒级吗（TS7 后类型即验收）？ | 契约影响面（§2.5）/ 生成物可编译门禁 |

别人给 agent 上下文，Atelier 给 agent 证据——本文每个子系统都按"证据产出"设计：注册表可查、
契约可读、调用可审计、漂移可 diff、错误可导航、回滚可执行。

---

## 1. 旗舰场景：契约五用贯通（一切细节的目标函数）

全站化的技术心脏（归档设计书 §3"关键贯通点"的实现化）。**M2 出口判据即此场景跑通**：

```
specs/chat.md（意图：会话消息发送与列表）
  ↓ ① gen endpoint（骨架生成，产物显式 import 闭合）
contract.ts（契约单源：组件 ∪ 端点 ∪ 数据，同一 FlatSchema 规范〔定〕）
  ├→ ② 端点注册表：defineQuery/defineCommand 挂 input/output 契约（运行时校验，ATR-2xx）
  ├→ ③ src/generated/api.ts：类型化客户端（手写 fetch/手写类型 = 零）
  ├→ ④ MCP 工具定义：endpoint.contract/endpoint.call 的 inputSchema 同源投影
  ├→ ⑤ atelier export openapi：openapi-3.0 投影（FS-9）
  └→ ⑥ live：query 声明 live + invalidate 键 → 写后重算 → SSE → streamValue 直通信号图
```

**影响面闭环演示（M2 验收脚本，逐命令可录屏）**：

1. 改 `contract.ts` 中 `chatInput`（如加必填字段）；
2. `atelier check` 输出影响面报告：`chat.ask` 端点契约违规 + `api.ts` 调用点 + 引用该契约的
   模板/组件清单（§2.5 impact 分析）；
3. `atelier gen endpoint --regen` 产物 diff（升级走 regen+diff，决策 23）；
4. `atelier test` 绿 → `atelier checkpoint save` 锚定（三道门禁含 API 面 diff）。

这一条对应 ROADMAP 阶段 3.5 出口判据"改一条契约，`atelier check` 报出全部受影响前端调用点"，
也是"类型即验收 harness"（TanStack 教训的正面向）在 Atelier 的落地形态。

---

## 2. L2 契约层全栈细化

### 2.1 三域契约统一形态〔定，细化〕

同一 `FlatSchema` 规范（`runtime/contract.ts`：`{type:"object", reqProps, optProps}`，叶子约束
enum/min/max/pattern，禁 $ref/oneOf）服务三域，**不新增第二套 schema 语言**：

| 域 | 形态 | 消费面 |
|---|---|---|
| 组件契约 | `Contract = {name, props, events, usage}`（既有） | 校验/注册表/MCP |
| 端点契约 | `EndpointDef.contract`（输入，已有）+ `.output`（输出，§2.3 新增） | 校验/客户端类型/MCP/OpenAPI |
| 数据契约 | `table()` 扁平定义（§5.1 新增） | 迁移生成/行类型/机检 |

**纪律**：契约对象是普通 TS 值（对象字面量），不是方法链 DSL——扁平字面量对 LLM 分布最友好
（Elysia `t.*` 与 Zod 链式皆前车之鉴），且能被 dump/codegen 的纯文本扫描器处理（无需类型求值）。

### 2.2 端点契约元数据位全集（v2 目标形态）

在 FS-M1 已有 `contract?/live?/auth?` 基础上**只做加法**（api-diff 盯住兼容性）：

```ts
export const chatAsk = defineCommand("chat.ask", {
  contract: chatInputSchema,        // 输入契约（已有；FlatSchema 单写 = 输入，形态不变）
  output: chatMessageSchema,        // 〔议〕输出契约（§2.3）：客户端类型 + 运行时输出校验 + OpenAPI 响应 schema 三用
  auth: { type: "session" },        // 已有：鉴权声明位（FS-5 gen auth 与机检消费）
  idempotent: true,                 // 〔议〕幂等元数据（§3.6）：客户端重试语义 + OpenAPI 文档位
  timeoutMs: 10_000,                // 〔议〕超时元数据（§3.6）：AbortSignal 注入依据
  cache: "none",                    // 〔议〕缓存语义显式声明（默认 none；"private" 等档位 B 队，位先固化——
                                     //   Next 缓存语义三年三变的教训：引入缓存时必须一步到位显式契约化）
  handler: async (input, ctx) => { /* ctx 扩展见 §3.2 */ },
});
```

`live` 从 `boolean` 扩展为 `true | { invalidate: string[] }`（boolean 向后兼容 = 无显式键、
按端点名自键失效）——见 §4.1。

### 2.3 输出契约与序列化边界〔议，M2 必做件〕

- **为什么**：五用贯通要求客户端拿到 output 类型；OpenAPI 响应 schema 也要求它。没有 output 契约，
  契约链在"出参"处断裂，agent 又回到手写类型猜谜。
- **运行时**：dev 态输出经 `validateFlat(output)`（违规 = ATR-215，服务端开发者错误而非客户端错误，
  不与输入违规的 ATR-201 混淆）；prod 剥离（同决策 6 prod 剥离口径）。
- **JSON-safe 检查**：返回值序列化前检测函数/循环引用/Symbol/BigInt（JSON.stringify 会静默出错或抛
  含糊异常）→ 命中即 ATR-216 四段式（fix 指明哪个端点返回了不可序列化值）。这是"显式序列化边界"
  的机检面——RSC Flight 把序列化藏在运行时协议里（React2Shell 攻击面模型），Atelier 把它变成
  端点边界的显式契约违约。
- **诚实边界**：输出契约只支持 FlatSchema 能表达的形状（纯数据）；handler 内部富对象 → 返回前
  显式映射为纯数据（这本身是好的服务端纪律，写进技能包示例）。

### 2.4 `~standard` 编译期投影（FS-9 前半，归 compiler 侧）〔定，细化〕

决策 22 已定方向；此处定规格：

- 新增 `compiler/project-json.mjs`（或挂 codegen 管线旁）：`FlatSchema → JSON Schema`
  target ∈ {`draft-2020-12`, `openapi-3.0`}（Standard Schema JSON Schema V1 的两个官方 target）。
- **投影规则**：只输出扁平关键字（type/properties/required/enum/minimum/maximum/minLength/
  maxLength/pattern/items）；遇到扁平语义之外的结构**显式 throw ATR-1xx**（"超出扁平投影能力"），
  绝不静默降级（决策 22 红线）。
- **单一管线三消费**：同一投影器喂 ① OpenAPI 导出（§13）、② MCP 工具 inputSchema（2026-07-28
  规范已采纳 JSON Schema 2020-12，扁平投影天然合规）、③ `~standard.jsonSchema` 运行时口——
  三处绝不各写一套（Fastify schema 三用同构，多出的教训是 tRPC OpenAPI 插件补丁化，Atelier 内建）。
- **golden 测试**：固定一组契约 fixtures → 快照投影结果；tRPC/Hono 式 Standard Schema 消费端
  直接 validate 成功 = 互操作判据（归档设计书 §8 既有判据）。

### 2.5 契约影响面分析（impact）〔议，M2 出口件〕

`graph.static`（F-2 构建期静态依赖图）在 API 面的镜像：

- **数据源**：① 端点注册表（运行时事实）+ ② 生成物 `api.ts` 中每端点导出携带
  `name as const` 字面量（静态可 grep）+ ③ dump.mjs 已提取的模板表达式根标识符（exprRootIdents）。
- **查询**：`atelier impact <contractKey>`（CLI）与 MCP `endpoint.impact`（§10）双通道同源：
  给出"契约 → 引用该契约的端点 → 调用该端点的前端文件/模板表达式"链路。
- **实现克制**：v1 只做"契约键 → 端点 → 调用点"两跳精确链（全部静态可判），不做跨端点数据流
  推导（那需要类型级分析，tsgo 观察位，§16.6）。
- **进 check**：契约文件变更后 `atelier check` 自动跑 impact 并输出报告（不阻断——阻断权在
  类型错误与契约校验本身；impact 是导航不是门禁，遵循"失败即导航"）。

### 2.6 类型贯通路线：生成式 vs 泛型推导（明确选择及理由）〔定，论证补全〕

tRPC/Hono 走"链式泛型累积、零 codegen"；Atelier 走"编译期生成产物"。理由留档：

1. 生成物是**普通 TS 文件** → agent 单文件可读（Q1），泛型链断裂时 tsc 报错离根因远（Hono
   已知痛点），生成式错误发生在调用点。
2. 生成物可被 **MCP/机检/OpenAPI** 等非 TS 消费面复用（一份事实多个投影），泛型类型只活在
   tsc 进程里。
3. 与既有 dump→codegen 管线同构（零新范式）。
4. 代价诚实：契约变更需 regen（一步命令），换来产物零漂移可 diff——Prisma 的教训是"忘了
   generate"，Atelier 的对策是 regen 进 check 工作循环 + "生成后零修改可编译"门禁（§7.3）
   双保险，而非假装没有生成步骤。

---

## 3. S0 端点运行时 v2（M2 核心）

### 3.1 FS-M1 现状与缺口表

| 能力 | FS-M1 | v2 缺口（本节逐项） |
|---|---|---|
| 注册表/读写二分/分发/输入校验/审计 | ✅ | — |
| ctx | `{name, kind}` | 扩展 db/auth/signal/audit（§3.2） |
| 输出契约 | ✗ | §2.3 |
| 错误映射 | 500 兜底 ATR-320 | 结构化映射表（§3.3） |
| 传输 | POST-only | live GET+SSE（§4）、〔议〕GET for query（§3.4） |
| 审计 | 只记成功 | 失败入账 + principal + 时长（§3.5〔议〕） |
| 幂等/超时 | ✗ | 元数据位（§3.6） |
| prod 行为 | 未区分 | 剥离面定义（§3.7） |

### 3.2 EndpointContext 扩展：显式注入，无 DI〔定方向，细化〕

```ts
export type EndpointContext<TDb = SqliteDb> = {
  name: string;
  kind: EndpointKind;
  db: TDb;                 // 数据库句柄（openSqlite 注入；无库应用可注入 noop——init 时声明）
  auth: AuthInfo | null;   // gen auth 产物提供的会话读取器产出；无 auth 端点 = null
  signal: AbortSignal;     // 请求取消/超时（Web 标准；timeoutMs 元数据驱动）
  audit: (note: string) => void;  // handler 内业务级审计备注（并入 command journal 条目）
};
```

- **无 DI 容器**（决策 18）：依赖由 `createHandler({ db, auth })` 装配点一次性显式注入，
  装配代码在应用入口明文可见（`main-server.ts`），非装饰器/反射魔法（NestJS 反面参照）。
- ctx 形状是**加法扩展**（`name/kind` 不动），api-diff 盯住。

### 3.3 错误映射与 HTTP 语义（结构化优先）

| 来源 | HTTP | AtrError code | 说明 |
|---|---|---|---|
| 输入契约失败 | 400 | ATR-201（既有） | `context.component` = 端点名 |
| 请求体非法 JSON | 400 | ATR-312（既有） | |
| handler 抛 `AtrEndpointError` | 自带 | 自带 code | **新增约定**：`AtrEndpointError` 可携带 `status`（401/403/404/409…），映射表缺省 422 |
| 鉴权未通过（gen auth 拦截） | 401/403 | ATR-340/341 | §6 |
| 输出契约违规 | 500 | ATR-215（新） | 开发者错误 |
| 输出非 JSON-safe | 500 | ATR-216（新） | |
| handler 未捕获抛错 | 500 | ATR-320（既有） | message 含原错误；journal 记失败（§3.5） |
| live 重算失败 | SSE error 事件 | ATR-321（新） | 不断流，推错误后保持订阅（§4.3） |

响应体一律 AtrError 四段式 JSON（`fix` 永远可执行）——HTTP status 只是传输层映射，**结构化
错误才是 agent 的导航面**（Next 16.3 "actionable errors" 同向，Atelier 多一层 code 体系）。

### 3.4 传输协议〔议：D-F11〕

- **POST `/<mount>/<name>`**（既有）：query 与 command 同走 POST——"输入必过契约校验"单一路径，
  不因动词分叉。
- **GET `/<mount>/<name>/live`**（FS-7）：live 端点 SSE 专用（FS-M1 注释已预留）。
- **GET for query〔议〕**：默认**不做**（POST-only 心智最简、缓存语义交给 `cache` 元数据而非
  HTTP 动词）；仅在 `atelier export openapi` 时提供 `restful: true` 端点级开关把 query 映射为
  GET+query-params（外部 REST 消费者互操作位）。默认关。
- **batch（tRPC 式 N 合 1）〔议：不做 v1〕**：单机/本地形态往返延迟低，live 订阅已消纳大部分
  多请求场景；真有批量需求 = 显式定义接收数组的 batch 端点（契约可见、可审计），而非传输层
  魔法多路复用（隐式性违背 Q1）。
- **HTTP/2**：Bun 宿主自动获得（Bun.serve 1.4.1+），零代码依赖。

### 3.5 审计 journal 强化〔议：D-F12〕

M1 现状"只记成功写入"（310-320 注释口径）升级为**完整审计语义**：

- 条目扩为 `{ ts, name, kind, input, status: "ok"|"failed", principal?, durMs?, notes? }`；
  失败 command 入账（status=failed + 错误码）——"代理改了什么、砸了什么"都必须可查（可验证性
  基建的审计半边）；成功/失败在时间轴上同源呈现（§11.4）。
- `principal`：gen auth 装配后自动填充（会话主体）；无 auth 应用为 null。
- 持久化：v1 维持内存环形（journalLimit 默认 500）；**落盘候选**（`.atelier/command-journal.jsonl`
  追加写）列 B 队〔议〕——审计跨进程存续是"证据"叙事的补强件，但桌面单进程形态内存态已够 v1。
- 机检联动：`SERVER_JOURNAL_SILENT`（WARN）——command 端点存在但 journal 被整体关闭时提示。

### 3.6 幂等与超时（元数据位，v1 轻实现）〔议〕

- `idempotent: true`：进 OpenAPI 文档 + 客户端生成物携带重试语义（失败自动退避重试一次）+
  机检 WARN（`idempotent` 的 command 被客户端非幂等调用模式引用时提示）。**服务端去重存储
  v1 不做**（需要键持久化，SQLite 键值表候选归队列 P2+ 批次）。
- `timeoutMs`：装配层 `AbortSignal.timeout()` 组合进 ctx.signal；超时 = ATR-322（新，
  503 映射）。AI SDK 7 四级超时（total/step/chunk/tool）的同向简化。

### 3.7 prod 行为：剥离面定义〔定，明确化〕

| 面 | dev | prod |
|---|---|---|
| 输入契约校验 | 强制 | **保留**（端点输入是不可信边界——与组件 props 校验不同，这是安全语义，决策 12 延伸）|
| 输出契约校验 | 强制 | 剥离（ATR-215，开发者错误，`__ATELIER_PROD__` 旗同款机制）|
| JSON-safe 检查 | 强制 | **保留**（防 prod 静默序列化失败）|
| command 审计 journal | 有界环形 | **保留**（审计是安全语义非 dev 语义；limit 可调大）|
| 影响面/impact | check 内 | 编译期工件（不进运行时）|

原则一句话：**"对内证伪"的校验可剥离，"对外设防 + 留证"的校验保留**。

---

## 4. live 端点：写后失效-重算-推送（FS-7 半 + 决策 20 细化）

### 4.1 声明形态

```ts
export const chatList = defineQuery("chat.list", {
  contract: chatListInputSchema,
  output: chatMessageListSchema,
  auth: { type: "session" },
  live: { invalidate: ["table:messages"] },   // 显式失效键（决策 20：无读集追踪，以写后重放换数据库自由）
  handler: (input, ctx) => ctx.db.prepare("SELECT ...").all(...),
});
```

- `invalidate` 键语法：`table:<name>`（表级）｜`key:<任意字符串>`（业务键，如 `key:chat:<id>`）。
  command 端点可声明 `emits: ["table:messages"]`（写侧声明）；默认推断：command handler 内
  ctx.db 的写操作自动标记所触发表（薄层即可——SqliteDb 包装 run() 时记录表名启发式），
  显式 `emits` 优先。**读写两侧都显式可查**（MCP/机检消费），这是与 Convex 黑盒读集追踪的
  本质差异：粒度粗一档，但完全可推导（Q1/Q3）。
- `live: true`（布尔）向后兼容 = 以端点全名自键失效（只受自身 command 重算）。

### 4.2 服务端机制

```
command 提交成功（journal 入账后）
  → 失效键求交（emits × 各 live 订阅的 invalidate）
  → 命中的 live 查询标记 dirty，进微任务批（coalesce 窗口 ~50ms，同键多次写合并为一次重算）
  → 重算（带各自订阅者当时的 input）→ 逐订阅者推送
  → 重算抛错：推 ATR-321 error 事件，订阅保持（下轮写后重试），错误入 journal
```

- **订阅注册表**：单进程内存态 `{ endpoint, input, subscriber }[]`（诚实边界：多实例需外部
  pub/sub——**不做清单**维持；单机桌面/单体工坊形态内正确性完备）。
- **重算并发**：同端点同 input 多订阅者共享一次重算（single-flight）；重算期间新写到达 →
  再标 dirty（不丢写）。
- **背压**：SSE 每订阅者发送队列有界（>N 条未确认则断开重连——重连即全量重算，语义自愈）。

### 4.3 SSE 线协议（GET `/<name>/live`）

```
retry: 3000
: ping（15s 心跳注释行，防代理断连）

event: data      ← 首连全量 + 每次失效重算后（data = 输出契约校验过的 JSON）
data: {...}

event: error     ← ATR-321 四段式 JSON；订阅保持
data: {"code":"ATR-321",...}

event: done      ← 仅非 live 的流式 query（一次性流完）使用；live 无 done
```

- `Last-Event-ID`：v1 忽略（重连 = 全量重算，简单且正确）；增量推送（cursor/patch 流）列
  B 队〔险：复杂度易蔓——ElectricSQL/Zero 全量同步引擎皆不做（决策 20），增量只到"重算粒度"
  为止，patch 流是未来可选增强非承诺〕。

### 4.4 前端直通与两级依赖图

分层红线：**runtime 零依赖不增负**（`primitives.ts` 的 `streamValue` 不动）——端点绑定逻辑放
生成物/应用层：

```ts
// src/generated/api.ts（gen endpoint 产物片段——显式 import 闭合，零框架运行时依赖）
import { streamValue } from "../vendor/atelier/runtime/index.ts";
import type { ChatMessage } from "../contract.ts";

export const chatList = {
  name: "chat.list" as const,
  async call(input: ChatListInput): Promise<ChatMessage[]> { /* fetch POST */ },
  live(input: ChatListInput) {
    const sv = streamValue<ChatMessage[]>();          // 三态原语（决策 5）——同一消费模型
    const es = new EventSource(`/api/chat.list/live?input=${encodeURIComponent(JSON.stringify(input))}`);
    es.addEventListener("data", (e) => sv.push(JSON.parse(e.data)));
    es.addEventListener("error", (e) => { /* ATR-321 → sv.error 语义（见 §8.3） */ });
    return { ...sv, dispose: () => es.close() };
  },
};
```

组件侧 `chatList.live({chatId})` 即得三态值——"服务端粗粒度信号（写后重算）→ 客户端细粒度
信号（依赖图）"两级结构落地；模板表达式照常读 `sv.value`（异步收敛在原语边界，expr 纯同步，
FS-11 方向一致）。

### 4.5 乐观更新对账协议（optimisticList × command × live）

既有两原语的**联动模式**固化为框架文档化协议（不改内核，模板示例 + 技能包）：

```
1. optimisticAdd(item)                     → pending 态渲染
2. chatAsk.call(input)                     → command POST
3a. 成功 → commit(id)；live 推送到达 → 以服务端数据覆盖对账（同 id 幂等合并）
3b. 失败 → revert(id) + rollbacked 记录；ATR 错误对象进入 UI error 态（fix 可展示）
```

对账规则：live 推送是**真相源**，optimistic 状态只是其先行渲染；id 冲突时服务端值胜出。
此协议写入 starter 模板示例（三元共置规格的 server 版示例），M3-FS 任务臂直接考它（§14.3）。

### 4.6 诚实边界汇总

单进程内存订阅（无多实例）；重连全量重算（无增量）；失效粒度 = 显式键（无读集追踪）；
写侧表名自动标记为启发式（显式 `emits` 可覆盖）。四条都写进端点 JSDoc 与技能包。

---

## 5. 数据层（FS-3 剩余 + FS-4 全规格）

### 5.1 数据契约形态（`src/server/db/schema.ts`）

扁平字面量（与方法链 DSL 相反——同 §2.1 纪律）：

```ts
import { table } from "../vendor/atelier/server/db.ts";

export const messages = table("messages", {
  id:        { type: "integer", primaryKey: true },
  chatId:    { type: "integer", notNull: true, references: "chats.id" },
  role:      { type: "text", notNull: true, enum: ["user", "assistant"] },
  content:   { type: "text", notNull: true },
  createdAt: { type: "integer", notNull: true },   // epoch ms：契约类型 number 的 SQL 投影
}, {
  indexes: [{ name: "idx_messages_chat", columns: ["chatId"] }],
});
```

- 列类型全集（v1）：`integer | text | real | blob`——正好 SQLite 四原始类型 + 参数化友好
  （无 Date/JSON 魔法类型；时间 = integer ms、复合结构 = 手动 JSON 列 + 应用层映射，显式）。
- `references` 显式声明关系（生成迁移时产出 FK + 供机检做孤儿写检查的元数据）；**不做**
  关系魔术（无 lazy-load/无 cascade 隐式默认——cascade 必须在迁移 SQL 里显式写）。
- 表定义与 FlatSchema 的映射：`table()` 产物携带 `rowSchema`（FlatSchema 投影）→ 端点 output
  契约可直接引用表列子集（`pick(messages.rowSchema, ["id","role"])` 类帮助函数〔议〕）——
  数据契约与端点契约同规范单源。

### 5.2 `atelier gen db` 生成物（FS-5 组成）

| 产物 | 内容 | 门禁 |
|---|---|---|
| `src/generated/db/tables.ts` | 每表行类型 + 表元数据常量（显式 import schema.ts） | 零修改可编译 |
| `src/server/db/migrations/NNN_*.up/.down.sql` | 建表/索引迁移骨架（`--regen` 时**只增不改**——已应用迁移永不重写，见 §5.4） | 成对存在 + checksum |
| `src/generated/db/crud.ts` | 每表极薄参数化 CRUD：`messagesGetByPk / messagesInsert / messagesUpdate / messagesDelete`（四原语量级，SQL 字符串内联可读） | 参数化唯一路径（红线） |

**克制声明**：不做查询构造器（query builder）、不做关系 API、不做懒加载——"贴 SQL"纪律
（决策 19）；join/聚合/窗口 = 手写 SQL 经 `ctx.db.prepare()` 直用（§5.3）。CRUD 生成只为
消掉最高频样板；sqlc 式 `.sql → 类型化函数` AOT 通道确认为空位但列 **B 队**（M2 不抢，
先让基础面稳）。

### 5.3 手写 SQL 通道与参数化红线

- 手写 SQL 一等公民：`ctx.db.prepare(sql).all/get/run(params)`（SqliteDb 四原语直用，
  sqlite.ts 已锁宿主差异）。
- **参数化是唯一路径**（决策 19 红线，Kysely CVE 教训）：生成物与示例零字符串拼接；
  lint 规则候选（`@atelier/eslint`）：`prepare()` 参数含模板字符串插值即 WARN（B 队）。
- 只支持 SQLite 方言（不做方言抽象层——Bun.SQL 否决理由维持）。

### 5.4 可逆迁移器（FS-4 全规格）

**文件形态**：

```
src/server/db/migrations/
  001_create_chats.up.sql      /  001_create_chats.down.sql
  002_add_messages.up.sql      /  002_add_messages.down.sql      ← 成对缺一 = ATR-331 ERROR（可逆性是硬门槛）
```

**状态表**（迁移器自建）：

```sql
CREATE TABLE atelier_migrations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL, down_verified INTEGER DEFAULT 0
);
```

**命令**：

| 命令 | 行为 | 错误 |
|---|---|---|
| `atelier migrate status` | 已应用/待应用/不可逆清单 | — |
| `atelier migrate up [--to N]` | 顺序应用，事务包裹逐条，记 checksum | ATR-332 checksum 不匹配（文件被改）；ATR-334 up 失败（事务回滚） |
| `atelier migrate down [--to N]` | 逆序执行 down，事务包裹 | ATR-333 down 缺失/失败 |
| `atelier migrate verify` | 重放校验：up→down→up 幂等（干跑影子库） | 守卫测试同源（§14） |

**checkpoint 联动（决策 21-③，全站双轨回滚的地基）**：

- `checkpoint save` 时把当前 migration head（最新已应用 id）记入台账条目；
- `checkpoint rollback` 检出目标锚点的 head 低于当前 → **强制先 `migrate down --to <目标 head>`**
  （confirm=ask 起步——破坏性操作走决策 12 三档）；
- 迁移执行本身入 command journal 同款审计（name/checksum/duration）→ review 时间轴统一呈现
  （§11.4）。
- `gen db --regen` 对已应用迁移**永不重写**（只追加新编号）；schema.ts 与已应用迁移的漂移 =
  WARN `DB_SCHEMA_DRIFT`（struct 数据契约层，§9.3）——提示"该出一次迁移了"。

**边界**：无自动 diff 生成 down（v1 gen db 只为新表生成成对骨架；改列的迁移手写——改表 SQL
对 agent 是分布内技能且必须过 verify，比代码生成更可靠）；无多环境分支迁移（单库单线）。

### 5.5 事务原语与 command 边界

```ts
await ctx.db.tx(async (tx) => {
  tx.prepare("INSERT ...").run(...);
  tx.prepare("UPDATE ...").run(...);
});   // BEGIN/COMMIT/ROLLBACK 包裹；SqliteDb 同步语义下天然串行
```

- command handler 是**事务边界建议位**：一个 command = 一个业务原子操作（读写二分的心智延伸）；
  journal 在事务提交后才入账（审计与数据一致）。
- 队列投递原子化（P2+）：`tx` 内写 jobs 表 = 业务写入与任务投递同事务（§5.6）。

### 5.6 SQLite 极薄队列（P2+ 候选，接口位先行）〔定候选，维持〕

- jobs 表 sketch（归档设计书已留）：`id/queue/payload/status/priority/attempts/run_at/locked_by/
  locked_at` + `UPDATE ... WHERE status='pending' AND run_at<=? RETURNING` 原子取出 + 指数退避
  （River 设计清单为教材）；轮询自适应（忙短闲长），无 LISTEN/NOTIFY（SQLite 无此机制）。
- v1 只做两件事：① 目录与文档位（`src/server/jobs/` 约定 + 技能包说明"v1 无内建队列，
  command 内联执行长任务请声明 timeoutMs"）；② `emits`/审计元数据为将来 job 化预留兼容
  （command 契约不因同步/异步执行改变——执行位置是部署细节不是契约细节）。

### 5.7 种子与备份〔议：D-F17 / 观察位〕

- `atelier migrate seed`：幂等种子命令——dev 体验件，S 级〔议〕。**已落地（M2-d，2026-09-19）**，
  实现与本文有一处有意偏离：原文"seed.ts 明文"不可执行（生成器纪律禁 eval/TS 解析器，runner 无法
  执行应用的 TS 模块），v1 落地为 **SQL 种子**——`src/server/db/seeds/*.seed.sql`（每条语句须幂等
  UPSERT 语义，静态启发拦截裸 INSERT）+ `atelier_seeds` 状态表（checksum 体检 ATR-335，执行失败
  回滚 ATR-336），重复执行跳过已应用。
- 容灾：文档位（Litestream VFS 为参照的备份指南：SQLite 单文件 = `atelier checkpoint` 之外
  定期 `.backup` API/文件拷贝说明）；**不做**内建云复制（决策 19）。

---

## 6. 鉴权：`atelier gen auth`（FS-5 组成，决策 18 已定路线）

### 6.1 产物清单（全部显式 import 闭合 + 零修改可编译门禁）

```
src/server/auth/
  sessions.table.ts        # sessions 表契约（table() 定义，进 schema 单源）
  00X_auth.up/.down.sql    # 迁移对
  auth.ts                  # 会话原语：createSession/validateSession/destroySession（参数化 SQL，明文可读）
  endpoints.ts             # auth.login / auth.logout（command）+ auth.me（query）骨架 + 契约
  cookie.ts               # 显式会话 cookie 读写（HttpOnly/SameSite=Strict/Secure 注释说明）
装配：main-server.ts 的 createHandler({ auth: sessionReader }) 显式接线
```

- 默认形态 = 邮箱+密码（scrypt/bun:crypto，无外部依赖）+ 会话表；magic link 变体 = regen 时
  选模板（Phoenix 1.8 默认 magic link 的启示：**生成器携带最佳实践演进**，regen 即升级）。
- 密码哈希宿主差异（Bun crypto vs Node crypto）锁死在 auth.ts 单文件（同 sqlite.ts 纪律）。

### 6.2 auth 元数据 × 机检 × MCP

- 端点 `auth: {type, role?}` 声明 → 装配层自动拦截（未通过 = ATR-340/341，§3.3）；
  handler 内无需重复检查（但可读 `ctx.auth` 做行级判断——RLS 式隐式策略**明确不做**，
  Supabase 教训：权限必须显式可 grep）。
- 机检：`SERVER_AUTH_MISSING`（WARN）——写表 command 无 auth 声明时提示（不阻断：本地单机
  应用可无鉴权，但必须是**显式选择**——`auth: {type:"none"}` 显式声明可消警，"沉默缺省"
  才是 agent 高错区）。
- MCP：`endpoint.list` 摘要含 authType（已有字段），agent 可查"哪些端点需要什么身份"。

### 6.3 regen+diff 升级流程

```
atelier gen auth --regen → 产物 diff（git diff 呈现）→ 用户/agent 审阅 → 覆盖
```

手改过的产物：regen 前提示 diff 冲突（产物头部 `@atelier-generated` 标记 + struct 检查
"生成物被手改" = INFO 提示，不阻断——生成物是可改的明文，纪律是"改了要能过编译与测试"）。

### 6.4 远期口（只预留契约位，不实现）

"应用作为 OAuth 资源服务器暴露给 agent"（Better Auth MCP 插件实证的需求位，决策 18 已留）：
auth 元数据 `type` 命名空间预留 `oauth`；端点契约的 OpenAPI 投影预留 securitySchemes 段。
P2+ 远期，规范先行。

---

## 7. 生成器族工程纪律（FS-5 总纲，决策 23 已定）

### 7.1 三生成器输入输出

| 生成器 | 输入 | 输出 | regen 语义 |
|---|---|---|---|
| `gen endpoint` | specs 意图段 + 契约单源（或从 specs 起草契约） | `src/server/endpoints/<域>.ts` 骨架 + `src/generated/api.ts` 客户端 | 契约变 → 骨架与客户端同步 diff |
| `gen db` | `db/schema.ts` | 行类型 + CRUD + 迁移对（追加式） | schema 变 → 新迁移编号追加 |
| `gen auth` | 模板选择 | §6.1 全套 | 最佳实践升级随版本下发 |

### 7.2 产物形态样例（形态学第四级：显式 import 闭合）

```ts
// src/server/endpoints/chat.ts —— gen endpoint 产物（@atelier-generated 标记；明文可改可审计）
import { defineCommand } from "../vendor/atelier/server/index.ts";
import { chatInput, chatMessage } from "../../contract.ts";     // 契约单源，显式 import
import { messagesInsert } from "../../generated/db/crud.js";     // gen db 产物，显式 import
//  ↑ 无隐式全局、无自动导入、无装饰器——单文件静态可理解（Q1）
export const chatAsk = defineCommand("chat.ask", { /* §2.2 形态 */ });
```

### 7.3 门禁测试（写进框架 tests/，每次改生成器必跑）

1. **零修改可编译**：`atelier init` → 三生成器全跑 → `tsc --noEmit` + `atelier check` 全绿，
   中间零手改（Loco 实证形态）；
2. **regen 幂等**：regen 连续两次，第二次 diff 必须为空（迁移除外——追加式）；
3. **产物纪律**：产物 import 全部可解析 + 无相对路径逃逸（`../` 越出 src = ERROR）；
4. **红检**：故意改坏契约 → regen → 生成物必须带着类型错误出现（证明传导链通）——先红后绿纪律
   （F-5 同款方法论）。

### 7.4 specs 端点意图段模板（init 补种）

```markdown
## 端点意图（specs 扩展段）
- chat.ask（command）：发送一条消息 → 持久化 → 失效 table:messages
  验收：atelier call chat.ask '{"content":"hi"}' → 200；chat.list live 订阅者收到推送
- chat.list（query·live）：按 chatId 列出消息，失效键 table:messages
  验收：curl SSE 首连返回全量；写后 ≤100ms 收到重算推送
```

验收 = 命令序列而非形容词（specs 三段式纪律的全站延伸）；`atelier call` 见 D-F15。

---

## 8. 客户端面（前端侧全栈化）

### 8.1 生成物 `src/generated/api.ts`

§4.4 样例已示。要点：每端点一个冻结命名空间对象（`name` 字面量 + `call` + live 端点的
`live()`）；类型全部 import 自契约单源（双源 = ERROR 机检：生成物内不得出现内联重复类型）。

### 8.2 分层红线（runtime 不增负）

`streamValue/optimisticList`（runtime/primitives.ts）**零改动**；端点绑定（fetch/EventSource/
错误映射）全部在生成物与应用层。runtime 保持"前端零依赖内核"纯度（决策 0/2），server 面
代码永不经 runtime 出口分发（§9.1 边界守卫反向也成立：`vendor/atelier/server` 不得被前端
入口 import）。

### 8.3 错误面贯通

三态原语补 `error` 语义位〔议，小改〕：`streamValue` 增加 `error: AtrError | null` 状态
（失败不断流；fix 字段可直接渲染为可操作提示——"错误即导航"贯通到 UI 最后一厘米）。
`optimisticList` 的 revert 携带触发它的 AtrError（供 toast 展示 fix）。

### 8.4 异步表达式守卫（FS-11，方向=显式拒绝〔已定稿：决策 24，2026-09-19〕）

- expr 求值器遇 Promise/thenable 值 → **ATR-323 四段式拒绝**（fix 文案指路三态原语/live 端点两条合法异步通道）；
- 守卫位置（原型定稿）：**evalExpr 求值出口单点**（解释器与 codegen 生成代码的全部模板表达式求值汇聚该函数——bindExpr/bindProp/{#if}/{#each}/on: 全挂点覆盖，双路径同源，产物零 import 红线不破）；分层事实：调用语法 `{ fn() }` 由 ATR-301 解析期拒绝，ATR-323 收口值形态；
- 红检：值形态 Promise 进图的最小用例先红后绿（`tests/fs11-async.test.ts` 16 用例 + 反例证据固化于文件头）；
- 原型验证产出（FS-11 已交付）：① 拒绝路径测试；② "若无此守卫会怎样"反例记录（`"{}"` 静默渲染/真值颠倒/Promise 入 journal——Solid 2 async-in-graph 语义对照）；③ 结论已回写 design-decisions 定稿决策 24。

---

## 9. 边界守卫与 struct 八层（FS-8 + FS-6 半，决策 20/21 已定）

### 9.1 import 越界守卫（ATR-1xx）

- 规则：`src/server/**` 内模块**不得**被前端入口（`src/main.ts` 可达图）import；反向：
  `vendor/atelier/server/**` 不得进前端图。违规 = ATR-105（1xx 编译域；码号对表占用）。
- 实现：import 图扫描（复用 dump.mjs 扫描器的 matchBrace/import 提取既有件）+ `atelier check`
  接线；文件位置边界 = 决策 20（无内联指令，RSC 反例维持否决）。

### 9.2 import 白名单（slopsquatting 对策，决策 21-②）

- 规则：全仓 import 的包名必须 ∈ `package.json.dependencies ∪ 内部别名白名单`——幻觉包
  （外观合法、跨查询复现——Endor Labs 2026 实证）= ATR-106 ERROR。
- 载体：struct check（编译期静态，无需运行）；与 `atelier sync` 的 vendor 对账互通。

### 9.3 struct 八层规则表（六层 + S0 已扩七层概念，机检八层落地）

| 新规则 id | 层 | 级别 | 含义 |
|---|---|---|---|
| SERVER_IMPORT_LEAK | server 边界层 | ERROR | §9.1 越界 |
| SERVER_AUTH_MISSING | server 边界层 | WARN | 写表 command 无 auth 声明（§6.2；显式 `none` 消警） |
| SERVER_JOURNAL_SILENT | server 边界层 | WARN | 审计被整体关闭 |
| DB_MIGRATION_PAIR | 数据契约层 | ERROR | 迁移不成对（缺 down） |
| DB_MIGRATION_CHECKSUM | 数据契约层 | ERROR | 已应用迁移文件被改 |
| DB_SCHEMA_DRIFT | 数据契约层 | WARN | schema.ts 与已应用迁移漂移（提示出迁移） |
| IMPORT_ALLOWLIST | （横切） | ERROR | §9.2 幻觉包 |

分级哲学不变：**健康的部分建成不得炸门禁**（不假红）；全部规则红检/绿检双实证后才转正
（FACT_TOKEN_REFS 先例）。

### 9.4 三通道同源

CLI `struct check` / MCP `structure.check` / 技能包文本——单份引擎 `scripts/struct.mjs`，
改规则三处同步 + check-skills 门禁（既有纪律照旧）。

---

## 10. L3 MCP 全栈工具族（FS-6）

### 10.1 工具清单（对 Next `/_next/mcp` 8 工具做超集对表）

| 工具 | 面 | 对标/差异 | confirm 档 |
|---|---|---|---|
| `endpoint.list` | 查询 | 超集 Next `get_routes`：契约摘要+auth+live+invalidate 键（注册表即路由枚举） | — |
| `endpoint.contract` | 查询 | Next 无对标：扁平 schema 直读（+`~standard.jsonSchema` 投影可选 target） | — |
| `endpoint.impact` | 查询 | §2.5 影响面链路 | — |
| `db.schema` | 查询 | 表/列/关系/索引 + `rowSchema` 投影 | — |
| `db.migrations` | 查询 | 状态/可逆性/checksum（Supabase Management MCP 同位能力，本地无云） | — |
| `server.introspect` | 查询 | 运行时内省：端点调用统计/live 订阅者/journal 尾部（对标 Agent Browser 的服务端面；`state.graph` 已覆盖前端面） | — |
| `endpoint.call` | 操作 | 调用端点（写端点走 confirm + 审计） | auto/ask/deny |
| `endpoint.journal` | 审计 | command 审计查询（含失败条目） | — |

净增 ≤8 个工具；`ATELIER_TOOLSETS` 按 face 分组照旧（query/operation/audit），描述行数预算
进 check-skills（工具数与描述是 token 面——工具描述由 mcp-definitions.json 单源生成纪律不变）。

### 10.2 MCP 2026-07-28 无状态规范对齐（决策 21 配套）

- 桥形态：HTTP 直连 + `Mcp-Method`/`Mcp-Name` 头路由，无会话粘性（dev 面本来就是单实例，
  对齐成本主要在握手移除与 `_meta` 版本携带）；
- 长任务（`atelier compile` 流水 / struct 全量检查 / migrate verify）按 **Tasks 扩展**建模
  （`tasks/get|update|cancel`；服务端主导创建——checkpoint 族工具后续同型迁移评估）；
- 多轮审批：`InputRequiredResult` + `requestState` 承载 confirm=ask 档的审批流（把 M1 时代
  "ask 暂同 auto"的诚实边界真正接上——stdio 无审批通道的历史限制被新规范的多轮原语解除〔议，
  归 FS-6 批次〕）；
- Roots/Sampling/Logging 废弃面：现有 25 工具未依赖，迁移成本 ≈ 0（调研已核）。

### 10.3 dev 面 HTTP 端点补齐（/`__atelier/*` 服务端面）

`/__atelier/endpoints`（人可读调试页：端点表 + try-it 调用 + schema 展示）〔议：D-F16〕——
review UI 的 server 位；`/__atelier/server-status`（JSON：journal 尾部/live 订阅/迁移状态）。

---

## 11. L4/L5：dev 托管与 review 全站化（FS-7）

### 11.1 `atelier dev` 托管 server 面

- 形态：同 dev 进程内挂载（Web 标准 handler 直接接 `Bun.serve`/Node http 的 fetch 桥），
  `atelier.config.json.server.port`（0 = 自动，默认 5174 邻位；固定端口便于 agent 配置——
  既有 config 位已有）；
- watch：`src/server/**` + 契约文件变更 → server 面热重启（子进程隔离 SQLite 句柄，避免
  脏状态）；前端 HMR 不受牵连（Vite 与 server 面进程解耦——full-reload 死循环前科
  （决策 16 事故记录）不允许重演）；
- SQLite dev 库路径约定：`.atelier/dev.db`（gitignore；`--prod-db <path>` 覆盖位）。

### 11.2 review 扩展（L5）

- 迁移时间轴：migration 历史 + checkpoint head 对齐状态（"这个锚点在 schema 哪个版本"可答）；
- 端点行为 diff：checkpoint 前后 command journal 对比（代理这轮调了哪些端点、成败、耗时）；
- 全站 checkpoint 视图：源码锚 + 迁移 head + 应用态快照三位一体（决策 15 双轨 + 决策 21-③）。

### 11.3 审计统一时间轴

command journal、MCP 操作审计、迁移审计——三源同构（ts/name/principal/duration）归
review 时间轴单视图呈现。"agent 这轮做了什么"一处可答（可验证性基建的呈现层）。

---

## 12. 部署形态（决策 0/13/18 已定，此处收口细节）

三条产线共享"Web 标准 handler + 扁平契约"内核，差异全部收在**编译期**（Nitro preset 思想
的极简收）：

| 产线 | 产物 | 实现 | 状态 |
|---|---|---|---|
| 桌面（一级） | sidecar 单文件 exe + 静态 dist | `bun build --compile` → Tauri 2 sidecar + 显式 capabilities | M3-FS 后接 `atelier package` 既有位 |
| 自托管单容器 | node/bun 单入口 + SQLite 卷 | `atelier build --target=node\|bun`（v1 两 target；差异=启动壳 30 行） | M2 尾〔议：D-F14〕 |
| edge/serverless | — | **编译期 target 观察位**（不做清单维持：SQLite 数据层与 serverless 天然错配；Turso/D1 适配出现真实需求再议） | 不做 |

`atelier deploy`（Kamal 式一条命令）：后置不预投（不做清单维持）。

---

## 13. OpenAPI 导出（FS-9）

- `atelier export openapi [--out openapi.json]`：端点注册表 → openapi-3.0.3 文档；schema 走
  §2.4 投影器（与 MCP inputSchema 同管线）；`restful: true` 端点映射 GET（§3.4）；auth 元数据
  映射 securitySchemes（§6.4 位）；`idempotent/timeoutMs` 进扩展字段（`x-atelier-*`）。
- **范围克制**：只导出**端点面**（组件/数据契约不进 OpenAPI——它们有自己的消费面：注册表/
  MCP/机检；贪多必失真）。
- **golden 判据**：用导出文档生成的请求打真实 dev server 全端点通（文档即真相的机检）。
- **api-diff 纳管**：openapi 面进 `.atelier/api-surface.json` 快照（决策 23-④ 服务端公共面的
  落地载体）——端点增删改 = 漂移可见，`--strict` 下新增也红（对外契约面从严）。

---

## 14. 测试与验证矩阵

### 14.1 子系统 × 测试类型

| 子系统 | 单测 | 红检（先红后绿） | golden/e2e |
|---|---|---|---|
| 端点 v2（ctx/输出契约/错误映射） | 每 §3 小节 ≥3 用例 | 输出违规 ATR-215 / JSON-safe ATR-216 | 传输协议快照 |
| live | 订阅/失效/coalesce/背压 | 重算抛错 ATR-321 不断流 | 写→推 ≤100ms 时序断言（verify() 判终态） |
| 迁移器 | up/down/verify/checksum | 缺 down ATR-331 / 改文件 ATR-332 | up→down→up 幂等干跑 |
| 生成器 | §7.3 四门禁 | 契约坏→生成物带错 | regen 幂等 diff 空 |
| 守卫 | 越界/白名单正反例 | 幽灵 import ATR-106 | struct 全规则红绿双证 |
| MCP 工具族 | 定义同步（check-skills） | confirm=ask 审批流 | stdio/HTTP 双径 e2e（既有先例） |
| OpenAPI | 投影 fixtures 快照 | 超扁平能力 throw | 文档→打真实 server 全通 |

### 14.2 纪律

红检先红后绿（F-5/P3-6 方法论延续）；不假红（struct 口径）；双宿主测试钉住 bun/node
（sqlite.ts 诚实边界：bun 路径待 Bun 环境回归——维持挂账）；tsgo/tsc 双跑〔议：D-F18〕。

### 14.3 M3-FS 全栈任务臂（FS-10，后置）

- 任务设计原则：跨端三处改动（契约 → 端点 → 前端调用/模板）+ 至少一次迁移 + 一次 live 对账
  （§4.5 协议即考点）；三臂协议照抄（noskill/skill/react→**对照臂换主流全栈栈**〔议，臂选择
  待设计：Next 或 SvelteKit remote functions——语料量与公平性权衡后定〕）；
- 评分器开放协议对外可比（决策 21-④；Supabase Evals 先例）——评分器/任务书/RUNBOOK 三件
  开源化，口径注记纪律照旧（n、Wilson 区间限定语强制）。

### 14.4 SPEC v0.2 全站段增补要点（FS 线后并入，此处立规格位）

端点开发工作循环（代理视角）：读 specs 端点段 → `endpoint.list`/`db.schema` 查现状 → 改契约
单源 → `gen --regen` → 实现 handler → `atelier check`（含 impact）→ `atelier call`/try-it 验证
→ test → checkpoint。错误导航表补 ATR-1xx/2xx/3xx 新码段（§15）。

---

## 15. 错误码分配总表（新增段规划；码号以实现时对表现用占用为准）

| 码 | 域 | 含义 | 出处 |
|---|---|---|---|
| ATR-105 | 1xx 编译 | server 边界 import 越界 | §9.1（FS-8） |
| ATR-106 | 1xx 编译 | import 白名单外包名（幻觉包） | §9.2（FS-6） |
| ATR-107 | 1xx 编译 | 超出扁平投影能力（投影器遇 $ref/oneOf 等非扁平结构显式 throw，绝不静默降级） | §2.4（FS-9，已落地） |
| ATR-215 | 2xx 契约 | 端点输出契约违规（开发者错误） | §2.3 |
| ATR-216 | 2xx 契约 | 端点输出非 JSON-safe | §2.3 |
| ATR-314 | 3xx 运行 | live/invalidate 声明非法（键语法错） | §4.1 |
| ATR-321 | 3xx 运行 | live 重算失败（SSE error 事件，不断流） | §4.2 |
| ATR-322 | 3xx 运行 | 端点超时（503） | §3.6 |
| ATR-323 | 3xx 运行 | 模板表达式返回 Promise（异步泄漏进响应式图，显式拒绝） | §8.4（FS-11，已落地） |
| ATR-331 | 3xx 运行 | 迁移缺 down（不成对） | §5.4 |
| ATR-332 | 3xx 运行 | 迁移 checksum 不匹配 | §5.4 |
| ATR-333 | 3xx 运行 | down 缺失/执行失败 | §5.4 |
| ATR-334 | 3xx 运行 | up 失败（事务已回滚） | §5.4 |
| ATR-340/341 | 3xx 运行 | 鉴权未通过 / 权限不足（401/403） | §6.2 |
| ATR-35x | 3xx 运行 | 队列域（预留，P2+） | §5.6 |
| 既有 | — | 310/311/312/313/320 端点、330 SQLite、301/305 模板、201/204 契约/token、401/402 MCP | 不动 |

每码进 `skills/atelier-error-codes` 与 ERR_CATALOG 机检（既有纪律）；fix 文案必须可执行。

---

## 16. 前沿概念穷尽评估表（2026-09 口径）

> 目标：调研三报告中出现的一切机制在此有处置结论，不留"未评估"。定位分四档：
> **核心**（已定/在做）/ **B 队**（显式排队观察，有引入条件）/ **留门**（只留接口位不实现）/
> **不做**（不做清单或有据否决）。表是本规划的"防漏网"，也是 §19 拍板项的证据索引。

### 16.1 响应式与渲染（报告一）

| 概念 | 行业代表 | 处置 | 定位/依据 |
|---|---|---|---|
| async 进响应式图 | Solid 2 / Svelte 5.36+ | 异步收敛在三态原语与 live 端点边界，expr 显式拒绝 + 守卫 | 核心·FS-11（D-F9 方向拍板） |
| 编译期响应式/零 VDOM | Vue Vapor / Svelte 5 / Solid | codegen 静态 effect 图 + $effectStatic 快路径 | 核心·已落地（F-2） |
| split effects（compute/apply 分段） | Solid 2 | 观察其可静态分析性收益，暂不重构 | B 队·观察 |
| resumability（序列化恢复） | Qwik 2 | CSR 无 hydration 不适用；checkpoint 序列化思想已内建 | 不做·决策 4 |
| islands / Server Islands | Astro 6/7 | SSG+部分水合已有；服务端片段注入 B 队（引入条件：真实内容站需求） | 留门/B 队 |
| 缓存指令 | Next 16 "use cache"/cacheLife/cacheTag | `cache` 元数据位先固化；引入时显式契约、无隐式默认 | 留门·§2.2 |
| View Transitions / Activity 原语 | React 19.2/19.3 | 前端候选池（非全栈线，按 F 线节奏） | B 队 |
| morph swaps | htmx 4 | 超媒体降级输出路径（内容面远期） | B 队 |
| 超媒体 SSE 下行 | Datastar 1.0 | live 端点已同构采纳（SSE 下行+状态收敛） | 核心·§4 |
| TC39 Signals | Stage 1 | 自研内核 + 适配口预留 | 留门·决策 2 |
| 文档随包/Agent Browser 内省 | Next 16.3 | vendor llms.txt 已有；`server.introspect`+`state.graph` 补齐内省 | 核心·§10 |

### 16.2 全栈原语（报告一/三）

| 概念 | 行业代表 | 处置 | 定位/依据 |
|---|---|---|---|
| 单文件 RPC / typed functions | SvelteKit remote functions / TanStack server functions | 读写二分 + **显式注册表** + 契约单源 | 核心·FS-1 已落地 |
| query.live() 订阅 | SvelteKit 2026-06 / Convex | live 端点：写后失效-重算-推送（无读集追踪） | 核心·§4 |
| form 原语 + preflight | SvelteKit form | D 子集 schema 表单 + command 已覆盖主径；no-JS 渐进增强 B 队（桌面一级分发下低优先） | B 队·D-F19 |
| prerender query（构建期取数） | SvelteKit prerender | 随 SSG 线评估 | B 队 |
| RSC / Flight 序列化 | React 19 / Next | 否决内联边界（React2Shell 安全前科） | 不做·决策 20 |
| 服务器驱动 UI | LiveView 系 | 推数据不推 UI 指令 | 不做·决策 4/20 |
| GraphQL 层 | Redwood（已崩塌） | 概念负债实证 | 不做·决策 18 |
| 共享 action 层多通道 | Builder.io agent-native（HTTP/MCP/A2A/CLI） | endpoint = action 层：HTTP+MCP 已有，CLI `atelier call`〔议〕；A2A 不做 | 核心+议·D-F15 |

### 16.3 数据与同步（报告二/三）

| 概念 | 行业代表 | 处置 | 定位/依据 |
|---|---|---|---|
| SQLite 单库承载一切 | Rails 8 Solid 三件套 | bun:sqlite/node:sqlite 薄宿主适配（已落地）+ 队列/缓存同库路线 | 核心·决策 19 |
| SQL→TS 类型 AOT | sqlc（Go）/ sqlc-gen-typescript（preview） | 基础 CRUD 生成 M2；`.sql`→类型化函数通道 B 队（空位确认但不抢） | 核心+B 队·§5.2 |
| 响应式数据库（读集追踪） | Convex | 不造 DB；端点订阅原语替代 | 不做·决策 20 |
| 读路径同步 shapes | ElectricSQL | — | 不做 |
| 全栈同步引擎 | Zero 1.0 | — | 不做 |
| 离线工程化 | PowerSync | — | 不做 |
| 前端数据库 | InstantDB | — | 不做 |
| embedded replicas | Turso | 桌面云同步远期互补 | 留门·观察 |
| sqlite-wasm / OPFS | sqlite.org / wa-sqlite | 浏览器同方言留门 | 留门·决策 19 |
| SQLite 容灾复制 | Litestream VFS | 备份文档位（指南），不内建 | 留门·§5.7 |
| 多方言统一 SQL API | Bun.SQL | 与单方言贴 SQL 纪律冲突 | 不做·决策 19 |
| Redis/PG 队列 | BullMQ/pg-boss/River | 极薄 SQLite 队列 P2+（接口位先行） | 留门·§5.6 |
| ORM vendor | Drizzle | fallback 维持（1.0 stable 后重评） | 留门·决策 19 |
| 可逆迁移 + 联动回滚 | Rails/Phoenix 反推 | up/down 成对 + checkpoint 强制先 down | 核心·FS-4 |

### 16.4 API 与传输（报告二/三）

| 概念 | 行业代表 | 处置 | 定位/依据 |
|---|---|---|---|
| Web 标准 Request/Response | Hono / H3 v2 | 分发器已走；宿主差异锁薄层 | 核心·已落地 |
| Standard Schema V1 | tRPC/Hono/TanStack/NestJS 12 | `~standard` 口已落地；jsonSchema 投影 FS-9 | 核心·决策 22 |
| OpenAPI 内建一等 | oRPC / Encore | `atelier export openapi` + api-diff 纳管 | 核心·FS-9·§13 |
| 端到端类型（生成式） | sqlc/Encore 形态 | 生成 api.ts（vs 泛型链，论证 §2.6） | 核心 |
| batch 多路复用 | tRPC batch link | 不做 v1；显式 batch 端点替代 | 不做（可复议）·D-F11 |
| HTTP/2 | Bun.serve 1.4.1 | Bun 优化态自动获得 | 核心·零依赖 |
| WebSocket 双向 | — | SSE 下行 + POST 上行够用；双向需求出现再议 | 不做·§3.4 |
| API 版本化路由 | — | api-diff/openapi 管漂移，无路由魔法 | 不做 |
| GET for query（REST 互操作） | REST 生态 | OpenAPI `restful` 映射位，默认关 | 留门·D-F11 |

### 16.5 Agent 与可验证性（报告三）

| 概念 | 行业代表 | 处置 | 定位/依据 |
|---|---|---|---|
| MCP 2026-07-28 无状态化 | 规范 | HTTP 直连+头路由；Tasks 扩展承载长任务 | 核心·FS-6·§10.2 |
| MCP Apps（沙箱 iframe UI） | SEP-1865 | 白名单渲染器是最小切口（P3-5 定论） | 留门·已定论 |
| A2UI 流式声明 UI | v1.0 待定 | 单向导出观察（P3-5 定论） | 留门·已定论 |
| dev 面可观测 MCP | Next 8 工具 | 超集对表（endpoint.*/db.*/introspect） | 核心·FS-6 |
| 运行时内省 | Next Agent Browser | server.introspect + state.graph（前端面已有） | 核心·§10.1 |
| AGENTS.md 脚手架 | Next 16.2 / Angular | init 产物（已有）+ 端点段扩写 | 核心 |
| 文档随包分发 | Next 16.2 | vendor llms.txt/docs（已有，补框架速查） | 核心 |
| agent 评测开放 | Supabase Evals | M3-FS 协议+评分器开放（FS-10） | 核心·后置 |
| slopsquatting 对策 | CSA/Endor 实证 | import 白名单机检 | 核心·FS-6·§9.2 |
| 错文档比没文档糟 | ACM 2025 | specs 共置 + 文档机器生成（docs-numbers 同哲学） | 核心·既有纪律 |
| 技能包一致性校验 | "Skills Can Be Harmful" | check-skills 门禁（已有） | 核心·既有 |
| agent 应用七原语 | AI SDK 7 | P2+ 规范先行（第二种用法，全挂契约单源） | 留门·决策 21 |
| agent 身份/OAuth 资源服务器 | Better Auth MCP | 契约位预留（§6.4） | 留门 |
| HITL 审批流 | AI SDK HMAC 审批 / MCP 多轮 | confirm 三档（已有）+ MCP InputRequiredResult 接线〔议〕 | 核心·§10.2 |
| 平台锁定规避 | Vercel/Anthropic 收编态势 | 框架产物可迁移（SQLite/标准 MCP/标准 schema） | 核心·战略纪律 |

### 16.6 部署与工具链（报告一/二/三）

| 概念 | 行业代表 | 处置 | 定位/依据 |
|---|---|---|---|
| 单文件编译 | bun build --compile | 桌面 sidecar 核心 | 核心·决策 0/13 |
| Tauri 2 sidecar + capabilities | evil martians 实战 | `atelier package` 既有位 | 核心 |
| self-extracting 二进制 | Deno 2.7+ | 按需嵌入思路参照（体积优化） | 观察 |
| 编译期部署 preset | Nitro v3 | `build --target=node\|bun` 极简两 target | 核心·§12 |
| edge/serverless target | Cloudflare/Netlify | 观察位（SQLite 错配） | 不做·决策 19 |
| 自托管一条命令 | Kamal 2 | `atelier deploy` 后置不预投 | B 队 |
| TS 7（tsgo）10× 类型回路 | Microsoft | 类型守卫双跑钉住；codegen 引类型语义变廉价（观察） | 核心·采纳·D-F18 |
| Vite 8 / Rolldown | VoidZero | dev 插件钩子面回归测试位 | 核心·采纳 |
| Oxc/Rust 工具链心脏 | Solid/Astro | codegen 保持纯 JS（零依赖纪律）；性能瓶颈出现再评估 | 观察 |
| Codemod 化升级 | React/Next | API 面变更配 codemod（api-diff 发现→codemod 修复的闭环候选） | B 队 |

---

## 17. 里程碑细排与依赖图（建议排序；执行队列唯一源=BACKLOG）

### M2：生成器与门禁（建议批次）

```
M2-a（守卫先行，纯静态最便宜）:
  FS-8 边界守卫（ATR-105）→ import 白名单（ATR-106）→ struct 八层三规则（红绿双证）
M2-b（数据面）:
  数据契约 table() → gen db（类型+CRUD+迁移骨架）→ FS-4 迁移器全量（status/up/down/verify
  + checkpoint 联动强制先 down）
M2-c（端点面收口 + 出口判据）:
  端点 v2（ctx/db 注入 + output 契约 ATR-215/216 + 错误映射表 + journal 强化 D-F12）
  → gen endpoint（骨架+api.ts 客户端）→ impact 分析（atelier impact / endpoint.impact）
  → 【出口判据】§1 旗舰场景全链路 demo（改契约→check 报全影响面→regen diff→测试绿→锚定）
M2-d（并行小件）: gen auth（依赖 M2-b 迁移器 + M2-c ctx.auth）· seed 命令（D-F17）
```

### M3-FS：agent 全栈面

```
FS-6 MCP 工具族（依赖 M2 注册表稳定）+ 2026-07-28 无状态对齐 + Tasks 建模 + ask 档审批接线
→ FS-7 dev 托管（watch 重启/端口/dev.db）+ live 端点全量（SSE 协议/失效重算/对账协议）
→ FS-9 OpenAPI 导出（投影器可与 FS-6 并行——同管线 §2.4）
→ review 扩展（迁移时间轴/端点 diff/统一审计）收尾
```

### 并行/后置

- FS-11 异步原型：独立，尽早（避免破坏性补课——调研最响警钟）；结论回写决策。
- FS-10 M3-FS 全栈任务臂：M3-FS 面稳后启动；评分器开放与臂选择设计（§14.3）先行。
- 桌面 sidecar 链路验证（bun compile + Tauri）：M3-FS 后接阶段四 `atelier package`。

估量：M2-a S · M2-b M-L（迁移器为主）· M2-c M（端点 v2）+ M（生成器）· M3-FS 各 M。
单人带宽风险见 §18。

---

## 18. 风险登记

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | M2 工程量挤压 F 线收尾（F-2 prod 剥离在阶段四前无档期） | 高 | 批次化（§17 每批独立出口可停）；BACKLOG 排序权在用户 |
| R2 | live 语义复杂度蔓延（背压/增量/多实例诱惑） | 中 | §4.6 诚实边界成文 + 增量推送列 B 队不承诺；写后重放是地板不是起点 |
| R3 | 生成器产物漂移（改生成器忘 regen / 手改冲突） | 中 | §7.3 四门禁（零修改可编译 + regen 幂等 + 传导红检）；regen 进工作循环 |
| R4 | MCP 工具数与描述 token 膨胀 | 中 | toolsets 分组强制；净增 ≤8 上限自设；描述单源生成 |
| R5 | Bun 治理（Anthropic 资产化） | 中 | Web 标准 API + 双宿主测试钉住（既有纪律维持）；bun:sqlite 路径待 Bun 环境回归（FS-3 挂账） |
| R6 | TS6/7 双实现过渡期类型工具混乱 | 低 | 守卫测试 tsc/tsgo 双跑（D-F18）；不依赖实验 TS 特性 |
| R7 | 迁移器边界误判（down 不可写场景：DROP 后数据不可回） | 中 | verify 干跑影子库；不可逆操作 down 显式 `-- 不可逆：说明为何安全`注释约定 + confirm=ask |
| R8 | 名实差距重演（锐评教训：小机制大命名） | 中 | 本文全部能力按"先做深再命名"推进；README 措辞随实现深度校准 |

---

## 19. 拍板清单（本文全部〔议〕项汇总；拍板后抄送 BACKLOG / 回写决策）

| # | 提案 | 一句话 | 建议 | 估量 |
|---|---|---|---|---|
| D-F11 | 传输面收敛 | POST-only + live GET/SSE；batch 不做 v1（显式 batch 端点替代）；OpenAPI `restful` GET 映射默认关 | ✅ 建议照此 | — |
| D-F12 | 审计强化 | command journal 记失败条目（status/principal/durMs）；落盘列 B 队 | ✅ 建议采纳（内存态 v1） | S |
| D-F13 | 输出契约 | `output` 元数据 + ATR-215/216 + prod 剥离口径（§3.7 表） | ✅ 建议采纳（五用贯通必需件） | S-M |
| D-F14 | build target | `atelier build --target=node\|bun` 两 target（edge 观察位维持不做） | ✅ 建议采纳（M2 尾） | S |
| D-F15 | CLI 通道 | `atelier call <endpoint> '<json>'`（Builder.io 四通道对表的 CLI 位；specs 验收命令直接可执行） | ✅ 建议采纳 | S |
| D-F16 | 端点调试页 | dev 面 `/__atelier/endpoints`（表+try-it+schema） | ✅ 建议采纳（M3-FS） | S |
| D-F17 | seed 命令 | `atelier migrate seed`（幂等种子明文） | ✅ 建议采纳（随 M2-d） | S |
| D-F18 | tsgo 双跑 | 类型守卫测试 tsc/tsgo 双跑钉住行为差 | ✅ 建议采纳（CI 条件作业） | S |
| D-F19 | 表单渐进增强 | no-JS form 原语列 B 队不进 M2/M3（桌面一级分发下低优先） | ✅ 建议维持 B 队 | — |
| D-F20 | ask 档审批接线 | MCP InputRequiredResult 多轮审批接 confirm=ask（历史诚实边界关闭） | ✅ 建议采纳（归 FS-6） | M |

---

## 20. 与既有文档的关系

- 冲突处理：本文与 `design-decisions.md` 冲突时以决策记录为准；实现与本文冲突时改本文（git 留痕）。
- 本文〔议〕项（§19）拍板后：构成新决策的回写 design-decisions（编号顺延 24+），执行项抄送
  BACKLOG FS 线；本文随之修订标注。
- 阶段与里程碑口径以 `ROADMAP.md` 阶段 3.5 为准（本文 §17 只做批次细化建议）。
- 归档设计书（`6d25ef7`）的 D-F1~D-F10 已全部定稿为决策 17-23；本文续用 D-F11+ 编号保持连续性。
