# Agentic DX 规范 v0.2（框架与 AI 编程代理的行为契约）

> 版本：v0.2（2026-09-25）｜ 状态：随实现迭代
> 依据：`design-decisions.md` 决策 0-24。**v0.1 → v0.2 变更**：决策 17-23 全站化扩展（端点契约/数据
> 契约/服务边界/生成器纪律）随 FS 线收口并入本版（§8），决策 24（异步表达式显式拒绝，ATR-323）一并
> 收录；错误导航表按 `atelier/skills/atelier-error-codes/` ERR_CATALOG 与实现实文重对（§3.2）。
> v0.1 原文已随 2026-09-27 仓库整理移出工作区（git 历史可溯，不再维护，留版本演进痕）。
> 本文是**框架对人类不可见、对代理全可见**的约定层：每条约定标注决策号，机检位标注实现载体。

## 0. 总原则

1. **框架不内嵌 LLM**：一切"生成/理解"由外部代理完成；框架只提供原语、协议、执行器。
2. **显式约定 > 魔法**：禁隐式注入、隐式上下文、静默类型擦除、自动全局、编译器路由魔法（决策 18：
   端点显式注册表；决策 20：文件位置边界，否决 RSC 式内联指令）。
3. **类型即契约即测试**：TS 类型是唯一真相，编译期提取，一切校验从它来（决策 6）。
4. **错误即指令**：任何错误都必须让代理"能直接行动"，报错即带可执行修复建议（决策 9）。
5. **可逆是自治前提**：代理运行的每一步都可被记录、回放、回滚——源码 checkpoint（决策 15）、
   迁移 up/down（决策 19）、应用状态 checkpoint（决策 5）三轨独立且联动（决策 21）。
6. **产物零依赖**：`dist/` 是全静态资源，运行时无任何第三方依赖。
7. **别人给 agent 上下文，Atelier 给 agent 证据**（决策 17）：注册表可查、契约可读、调用可审计、
   漂移可 diff、错误可导航、回滚可执行——代理遇事**先查证据再猜**。

## 1. 硬性约定（违反 = 构建/校验失败，不可绕过）

| # | 约定 | 实现 |
|---|---|---|
| H1 | 契约类型 = 纯数据 + 可判别结构；**禁止泛型/映射类型进契约** | 编译器 AST 提取；违反报 `ATR-1xx`（决策 6） |
| H2 | 判别式联合必须用 `literal` 判别（`status: "running" \| "done"`），**禁宽字符串联合** | 编译器校验 + lint |
| H3 | 样式值**只能引用 semantic token**（`bg-primary` 类或 `var(--color-primary)`）；**禁硬编码颜色/间距/字号值** | 契约校验（引用不存在 token = `ATR-204`，2xx 契约域，见 §3）+ 守卫测试（决策 8/16，R1-R5） |
| H4 | 组件内显式 `$state/$derived/$effect`；**禁隐式响应式、禁裸全局状态** | 编译器 + lint |
| H5 | 所有框架错误必须产出 `AtrError` 四段式对象（见 §3.1）；不得抛出裸字符串/裸对象 | 运行时包装 |
| H6 | 动态网络获取的 UI 数据（D 子集 schema）只能实例化注册表内白名单组件 | 白名单渲染器 |
| H7 | **契约扁平红线全栈一致**：组件/端点/数据三域共用同一 FlatSchema 规范；禁 `$ref`/`oneOf`、禁方法链 DSL、禁第二套 schema 语言；超出扁平投影能力 = `ATR-107` 显式 throw，绝不静默降级 | `runtime/contract.ts` 单源 + `compiler/project-json.mjs` 投影器（决策 6/17/22） |
| H8 | **server 边界 = 文件位置**：`src/server/**` 与 `src/vendor/atelier/server/**` 不得进入前端入口（`src/main.ts`）可达图；前端取服务端数据只走端点 HTTP（生成客户端） | struct 第 7 层 `SERVER_IMPORT_LEAK` = `ATR-105` ERROR（决策 20） |
| H9 | **参数化是 SQL 唯一路径**：`ctx.db.prepare()` 参数化 + 生成物零字符串拼接；SQLite 单方言，不做方言抽象 | `server/sqlite.ts` 四原语薄适配；种子静态启发拦截裸 `INSERT` = `ATR-336`（决策 19） |
| H10 | **迁移必须可逆**：up/down 成对缺一不可（`ATR-331`）；已应用迁移文件**永不改写**（checksum 体检 `ATR-332`）；不可逆 down 须文件内 `-- 不可逆：` 注释 + `--force` 显式同意 | struct 第 8 层 + `migrate` 命令门禁（决策 19/21） |
| H11 | **生成器产物纪律**：显式 import 闭合（单文件可静态理解，无隐式全局/自动导入/装饰器）+ 生成后零修改可编译 + regen 幂等（连续两次 regen，第二次 diff 必须为空；迁移除外——追加式永不重写） | 生成器门禁测试（决策 23） |
| H12 | **模板表达式纯同步**：求值结果为 Promise/thenable = `ATR-323` 显式拒绝；异步收敛在三态原语（`streamValue`/`optimisticList`）与 live 端点订阅两条合法边界 | `evalExpr` 求值出口单点守卫（决策 24） |

## 2. 软约束（警告级，写入 CI checklist）

规则集规划于决策 9（`@atelier/eslint` 源码即库）；**截至 v0.2 未单独立包**——下列规则的机检载体
如标注所示，规则清单本身是规范位（落 eslint 包时逐条迁移，语义不变）：

1. `no-hardcoded-style-value` — 禁硬编码样式值 → 现载体：守卫测试 R1/R2/R2b（决策 16）+ `ATR-204`
2. `no-manual-typewriter` — 禁手写 `setInterval/轮询` 拼流式文本，强制 `streamValue` → 技能包 + 审查
3. `component-file-max-lines` — 组件文件 > 400 行警告 → struct 预算面
4. `contract-no-generics` — 契约类型禁泛型（配合 H1）→ 编译器（硬门槛）
5. `component-naming` — 组件 TitleCase、文件名与组件同名 → manifest 注册对账
6. `no-implicit-global` — `window/document` 必须经 `atelier.env` 显式访问 → 技能包 + 审查
7. `no-sql-string-interpolation` — `prepare()` 参数含模板字符串插值即 WARN（决策 19 红线的 lint 化候选）
8. struct WARN 级提示（非阻断，"健康的部分建成不得炸门禁"——不假红）：
   `SERVER_AUTH_MISSING`（写表 command 无 auth 声明；`auth: {type:"none"}` 显式声明消警——
   "沉默缺省"才是代理高错区）、`SERVER_JOURNAL_SILENT`（审计被整体关闭）、
   `DB_SCHEMA_DRIFT`（schema.ts 与已应用迁移漂移 = 该出一次迁移了）

## 3. 错误规范（AtrError 四段式）

### 3.1 对象形态与输出通道

```ts
type AtrError = {
  code: string;      // "ATR-1xx 编译 / 2xx 契约校验 / 3xx 运行时 / 4xx MCP 与 dev 面"
  message: string;   // 一句话：什么坏了
  context: {         // 定位：file/line/component/property + 资源上下文
    file?: string; line?: number; component?: string; property?: string;
    hints?: string[];  // 相关可用值/候选清单
  };
  fix: string;       // 必须给出的可执行修复建议（含示例代码/可用值清单）
};
```

- 双通道输出：控制台人类可读行 + `ATR_DEBUG=json` / MCP 直连时的 JSON 结构化负载（MCP 面为
  `isError=true` + `structuredContent{code,message,fix}`，文本形态 `\nfix: ...` 并存，两种消费任选）。
- `fix` 缺失视为违反 H5（自测把关）。
- **错误即导航**：每个 code 的详细含义/示例/修法单源在技能包 `atelier/skills/atelier-error-codes/`
  （ERR_CATALOG，struct 第 5 层 `ERR_CATALOG` 检查可达性）；代理见任意 `ATR-xxx` → 读 `fix` 并执行，
  需要细节时加载该技能包，**不凭记忆猜修法**。

### 3.2 错误导航表（ATR 全码段）

> 码与含义以 ERR_CATALOG 实文 + 实现内注释为准对表（`server/endpoints.ts` / `server/sqlite.ts` /
> `mcp/server.mjs` / `scripts/struct.mjs`）；新码先注册 ERR_CATALOG 再写实现，无码条目的错误视为
> 开发者 bug。下表"下一步"给可执行动作；详细修法见 ERR_CATALOG 对应词条。

**1xx 编译域（模板/边界/投影）**

| 码 | 含义 | 下一步 |
|---|---|---|
| ATR-101 | 模板语法错误（标签/块未闭合） | 补闭合；检查表达式花括号配平 |
| ATR-103 | 契约违反 H1（泛型/映射类型进契约） | 改纯数据 + literal 判别 |
| ATR-105 | server 边界 import 越界（前端图可达 server 模块） | 改走端点 HTTP（生成客户端）；import 移入 `src/server/**` 或 server 入口 |
| ATR-106 | bare import 包名不在 `package.json` deps（幻觉包/包名幻觉） | `struct check` 定位文件；装真包或改对 specifier |
| ATR-107 | 超出扁平投影能力（投影器遇 `$ref/oneOf` 等非扁平结构） | 按 `context.at` 指的 schema 路径改写为扁平形态，或为该消费面手写 schema |

**2xx 契约域（props/端点契约/token）**

| 码 | 含义 | 下一步 |
|---|---|---|
| ATR-201 | 输入不符扁平 schema（props/端点输入缺字段或类型错） | 按 `fix` 列出的键清单补齐 |
| ATR-204 | 样式引用未定义 token | 用 `fix` 列出的合法 token，或往 `atelier.config.json` 加 token |
| ATR-205 | 输入不是 JSON 对象 | 返回字符串键的对象 |
| ATR-215 | 端点输出违反 `output` 契约（**服务端开发者错误**，非客户端；prod 剥离） | 修 handler 返回值对齐 output 扁平 schema |
| ATR-216 | 端点返回非 JSON-safe 值（函数/Symbol/BigInt/Promise/循环引用；dev 与 prod 都强制） | 返回前把富对象显式映射为纯数据；message 定位路径 |

**3xx 运行时域（模板求值/端点/live/迁移/鉴权）**

| 码 | 含义 | 下一步 |
|---|---|---|
| ATR-301 | 模板表达式解析失败（箭头函数/赋值/函数调用遗留） | 命名 handler（`.locals()` + `on:click={fn}`）；`$derived` 预计算 |
| ATR-305 | 对 `$derived` 信号赋值 | 改上游 `$state` |
| ATR-310 | 未知端点（404） | 用 `endpoint.list` / 错误 `hints` 列出的已注册端点名 |
| ATR-311 | 方法不允许（405；端点只接受 POST，live 为 GET SSE） | 改 POST `<mount>/<name>`，JSON 体 = 契约输入 |
| ATR-312 | 请求体不是合法 JSON（或无契约端点收到非对象） | 发 `application/json` 体 |
| ATR-313 | 端点重复注册或命名非法 | 换名/移除重复注册；命名限字母开头的 `[A-Za-z0-9_.-]` |
| ATR-314 | `live.invalidate` / `emits` 键语法非法 | 键必须是 `table:<name>` 或 `key:<业务键>`；改注册处声明 |
| ATR-320 | handler 未捕获抛错（500 兜底；journal 记失败） | 按消息定位 handler 内部错误；审计已入账 |
| ATR-321 | live 重算失败（SSE `error` 事件；**不断流**，下次失效写自动重试） | 无需重连；同输入 POST 复现根因，修 handler |
| ATR-322 | 端点超出 `timeoutMs` 预算（503） | 调大 `timeoutMs` 或修 handler：监听 `ctx.signal` 提前退出（abort 只停等待，不能杀 handler） |
| ATR-323 | 模板表达式求值出 Promise（异步泄漏进响应式图，显式拒绝） | 收敛到合法边界：`streamValue`/`optimisticList` 或 live 端点订阅 |
| ATR-330 | SQLite 宿主面错误 | 按 message 定位 SQL/参数；宿主差异已锁 `sqlite.ts` 单文件 |
| ATR-331 | 迁移缺 `.down.sql` 成对文件（可逆性硬门槛） | 补 down 文件（`gen db` 骨架成对生成） |
| ATR-332 | 已应用迁移文件被改（sha256 checksum 不符） | 还原文件（git/checkpoint）；要改 schema 就追加新编号迁移 |
| ATR-333 | down 缺失/失败，或带不可逆标记未给 `--force` | 读 down 文件内 `-- 不可逆：` 说明确认安全后再 `--force` |
| ATR-334 | 迁移 up 在事务内失败（已整体回滚，库未动） | 修 up SQL 重跑；迁移文件内禁写 BEGIN/COMMIT |
| ATR-335 | 已应用种子文件被改（`atelier_seeds` checksum 不符） | 还原内容，或以**新文件名**追加变更；dev 逃生口 = 删状态表行重跑（prod 禁） |
| ATR-336 | 种子语句不可重放（裸 `INSERT` 无 ON CONFLICT）或执行失败（整体回滚） | 每条语句改幂等 UPSERT（`INSERT OR REPLACE` / `ON CONFLICT DO UPDATE`） |
| ATR-340 | 端点声明了 `auth` 但请求无有效会话（或装配点未接会话读取器）（401） | 先登录（`auth.login` 置 cookie）；未装配则 `createHandler({ auth: createSessionReader(db) })`；真正公开的端点显式 `auth: {type:"none"}` |
| ATR-341 | 会话有效但角色不符端点 `auth: {type, role}` 声明（403） | 授予所需角色或修声明；行级判断在 handler 读 `ctx.auth` 显式做（禁隐式 RLS） |
| ATR-344 | 限流窗口超配额（429，`Retry-After` 头随行） | 等 `Retry-After` 秒数后重试；配额由装配点 `createHandler({ rateLimit: { windowMs, max } })` 显式声明（缺省不限流）；单进程内存态重启清零 |
| ATR-345 | 登录失败锁定触发（423，gen auth 产物） | 等锁期过后重试（连续失败 5 次锁 15 分钟，产物明文常量可调；成功登录清零）；in-memory 重启清零 |
| ATR-346 | 请求体超上限（413） | 缩小请求体或调装配上限 `createHandler({ maxBodyBytes })`（缺省 1MiB）；超限请求不进 handler、不入 journal |
| ATR-350 | jobs 投递参数非法（`ctx.jobs.enqueue` / cron 声明：type 非法、payload 不可 JSON 序列化、字段越界、`cron:` 前缀为运行时保留） | 修正 enqueue/cron 参数：type 为 1~256 字符显式分发键、payload 须过 JSON round-trip、maxAttempts ≥ 1；自定义任务勿用 `cron:` 前缀（recurring 行由 `startJobs({ cron })` 管理） |
| ATR-351 | 幂等键 KV 参数非法（key 空/超 512 字符、value 不可 JSON 序列化） | key 用稳定业务标识（如 `pay:<orderId>`）；value 改可 JSON 序列化纯数据（函数/循环引用不行）；去重纪律 = `ctx.kv.setIfAbsent(键, 结果)` 占领后再执行 |

**4xx MCP 与 dev 面**

| 码 | 含义 | 下一步 |
|---|---|---|
| ATR-401 | 组件未注册 / MCP 工具或句柄未知（含审批句柄过期） | 补 import 注册（显式传 `name`）；句柄过期 = 重跑该工具 |
| ATR-402 | confirm 档拒绝（deny 或人工否决） | 询问用户；**不要重试同一调用** |
| ATR-403 | dev 托管 server 面不可用（未托管/握手中/热重启中/子进程拒连——HTTP 503 透出） | 读 `[server] ` 前缀控制台行找子进程自身错误；CLI 直调场景指路应用目录 `pnpm dev` |
| ATR-404 | 未知 MCP 工具名 | 用 `tools/list` 输出里的名字 |
| ATR-4xx-dev | dev 面不可达/端口占用 | 应用目录 `pnpm dev`（MCP 工具随 dev 生命周期存活） |
| ATR-500 | MCP 工具内部错误兜底（如图构建失败） | 按 fix 重跑；持续复现查 `.atr/` 工件完整性 |

**struct 规则 id（八层机检，非 ATR 码，同一导航面）**：`SERVER_IMPORT_LEAK`（7 层 ERROR，对应
ATR-105）、`IMPORT_ALLOWLIST`（7 层 ERROR，对应 ATR-106）、`SERVER_AUTH_MISSING`（7 层 WARN）、
`SERVER_JOURNAL_SILENT`（7 层 WARN）、`DB_MIGRATION_PAIR`（8 层 ERROR，对应 ATR-331）、
`DB_MIGRATION_CHECKSUM`（8 层 ERROR，对应 ATR-332）、`DB_SCHEMA_DRIFT`（8 层 WARN）。
分级哲学：ERROR = 声明事实与现实矛盾（信任破，exit 1）；WARN = 该项目形态下缺失的层（报告不阻断）。

### 3.3 fix 可执行纪律

- `fix` 必须是代理能直接照做的动作：含命令、示例代码或合法值清单；禁止"请检查配置"式空话。
- 指路类 fix 必须给到**可执行命令或确切文件**（如：不可达 → "应用目录 `pnpm dev`"；
  校验失败 → "读 `fix` 列出的键清单补齐"），不给悬空引用。

## 4. 命名规范（默认约定，lint 提示）

| 主体 | 规范 |
|---|---|
| 组件文件 | `PascalCase`，文件名 = 组件名：`ChatMessage.atr.ts` |
| 目录 | `kebab-case` 短路径（`src/ui/`、`src/features/`），组件与测试/样式/规格同名同目录 co-located |
| 状态 | `$state` 变量 `camelCase`；store 名 `camelCase` |
| token | `语义段`（`color.primary`、`space.md`、`radius.sm`、`font.md`） |
| 端点 | 点分命名空间：`<域>.<动作>`（模板示例 `app.notes`/`app.addNote`）；query 读 / command 写 |
| 契约键 | 与消费面同名可检索（`endpoint.impact`/`atelier impact` 按键导航） |
| 迁移 | `src/server/db/migrations/NNN_<名>.up.sql` / 同名 `.down.sql` 成对 |
| 种子 | `src/server/db/seeds/<NNN>_<名>.seed.sql`（每条语句幂等 UPSERT） |
| 失效键 | `table:<表名>` / `key:<业务键>`（live invalidate 与 command emits 共用语法） |
| lint 类名 | `bem-ish`：`block`、`block--modifier`、`block__element`（不强制但建议） |

## 5. 完成定义（DoD，代理自证的裁判标准）

一个组件/端点/任务的"done" = 全部满足：

1. `atelier check` 通过（类型严格检查 + 契约提取 + token 校验，零错误；契约变更自动附 impact
   影响面报告——导航不是门禁，但必须读过）
2. `atelier lint` 零错误零警告（未立包期间 = 守卫测试全绿）
3. `atelier test` 全绿（含新增断言：行为/交互/端点契约）
4. `atelier snapshot` 截图 diff 已审阅（diff 非自动 accept；有变更则给出变更说明）
5. 影响面自查：未触碰 `atelier.config.json` 中 `locked` 组件（若有）；未引入新依赖（新依赖必过
   import 白名单 H7/ATR-106——包名必须在 `package.json` deps 内）；契约变更已 `gen --regen` 且
   产物 diff 已过目（H11）
6. 数据面变更（改了 schema.ts/端点写路径）：迁移成对可逆（`atelier migrate verify` 干跑绿）
7. 提交时附 diff 报告，供人类 `atelier review` 批准/点踩；锚定用 `atelier checkpoint save`——
   门禁自带三闸（测试套件绿 + 快照 MATCH + API 面无未豁免破坏漂移），`--no-gate` 是 wip 锚
   逃生口而非常规路径（决策 15/21/23）

## 6. 代理推荐工作循环（写进 SKILL.md 顶层）

### 6.1 组件循环（前端面，v0.1 承继）

```
读 specs/ → MCP 查询（组件注册表/token/状态快照）→ 改 .atr.ts
→ atelier dev 观察编译错误与 HMR → atelier test + atelier snapshot 自证
→ 生成 diff 报告 → 等待人类批准/点踩（反馈写回 specs/ 下次必读）
```

### 6.2 端点开发循环（全栈面，v0.2 并入——FS-DESIGN §14.4）

```
读 specs/ 端点意图段（验收 = 命令序列，不是形容词）
→ 查现状：endpoint.list / endpoint.contract / db.schema / server.introspect
  （stdio MCP 或应用 dev 面 /__atelier/mcp HTTP 直连双通道；先查表不猜路径）
→ 改契约单源 contract.ts（组件 ∪ 端点 ∪ 数据同一扁平 schema）
→ gen --regen（gen endpoint / gen db / gen auth——产物 diff 过目，迁移只追加）
→ 实现 handler（显式 import 闭合；写路径考虑 emits 失效键与 idempotent/timeoutMs 元数据）
→ atelier check（含 impact 影响面导航）→ atelier call '<endpoint>' '<json>' 或
  dev 面 /__atelier/endpoints try-it 验证（agent 位用 call，人位用 try-it）
→ atelier test → atelier checkpoint save 锚定（三闸门禁 + migrationHead 入台账）
```

**停下等人类**的阈值（两循环共用）：视觉 diff 异常、测试失败连续 3 次无进展、触碰 locked/配置/
依赖变更、预算或漂移监测命中、checkpoint rollback 检出未逆迁移（须先 `migrate down`，confirm=ask）。

## 7. 性能与正确性基线

> 数字口径：性能数字以仓库根 README 性能表为唯一人工口径（docs-numbers 纪律）；本表为目标位，
> 未达标项作为发布闸门，不得默认豁免。

| 指标 | 目标 |
|---|---|
| 核心运行时体积 | gzip ≤ 30 KB（不含编译器） |
| 渲染性能 | 10³ 节点组件挂载+首次渲染 ≤ 50 ms（桌面基线） |
| 开发反馈 | HMR ≤ 100 ms；编译错误报告 ≤ 1 s（含四段式 fix）；`src/server/**` 热重启不牵连前端 HMR（子进程隔离） |
| 截图回环 | dev 单组件截图 diff ≤ 500 ms |
| live 反馈 | 写事务提交后失效重算推送 ≤ 100 ms 量级（同进程单机） |
| agent 正确性 | 首遍正确率为北极星指标（决策 17/21）：框架级对照实验协议（`atelier/benchmarks/m3*`）开放对外可比；不出自营数字，交付可复现评测台 |

## 8. 全站化行为契约（决策 17-23 并入）

> 本章是 v0.2 新增段：把决策 17-23 落地后的行为约定从 FS-DESIGN 实现规格中提炼为代理契约。
> 实现级细节（论证/调研对照/批次规划）不在本文，见 `FS-DESIGN.md` 与 `design-decisions.md`。

### 8.1 契约三域统一 FlatSchema（决策 6/17/22）

- **同一扁平 schema 规范服务三域**，不新增第二套 schema 语言：组件契约（props/events）、
  端点契约（input/output）、数据契约（`table()` 列定义 → `rowSchema`）。
- 契约对象是**普通 TS 值**（对象字面量，`{type:"object", reqProps, optProps}`，叶子约束
  enum/min/max/pattern）：禁方法链 DSL、禁 `$ref`/`oneOf`（H7）。单文件 `src/contract.ts` 为
  契约单源，生成客户端与校验器都从它显式 import。
- **Standard Schema 互操作**（决策 22）：契约对象实现 `~standard` 接口；JSON Schema/OpenAPI
  投影走编译期单管线（`compiler/project-json.mjs`），三消费同源（OpenAPI 导出 / MCP inputSchema /
  `~standard.jsonSchema`）——三处绝不各写一套。超出扁平语义 = ATR-107 显式 throw（H7）。
- 代理纪律：改契约 = 改单源 + regen + 读 impact 报告；**禁止在消费面手写重复类型**（生成物内
  内联类型 = 双源 ERROR）。

### 8.2 端点面：读写二分 + 显式注册表 + ctx 显式注入（决策 18/20）

- **读写二分**：`defineQuery`（读，可声明 live）与 `defineCommand`（写，提交成功自动入审计
  journal）。command = 业务原子操作边界（事务建议位）。
- **显式注册表**：端点逐个 `registry.register(...)`，无编译器路由魔法；重复名/非法名 = ATR-313。
  注册装配点在 `src/server/main-server.ts` 明文可见。
- **依赖显式注入，无 DI 容器**：`createHandler({ db, auth })` 装配点一次性注入；handler 经
  `ctx` 拿 `db / auth / signal / audit / name / kind`。禁装饰器、禁反射魔法、禁隐式服务定位。
- **传输**：端点面统一 POST（输入必过契约校验的单一路径）；live 端点另开
  `GET <mount>/<name>/live`（SSE）。batch 多路复用不做——批量需求 = 显式定义收数组的端点。
- **元数据显式声明**：`output`（输出契约）、`auth`（鉴权声明位，未声明 = struct WARN，显式
  `none` 消警）、`emits`（写侧失效键）、`idempotent`（幂等语义，进 OpenAPI 与客户端重试位）、
  `timeoutMs`（超时预算，超时 ATR-322）。
- **审计**：command 全量入账（成功与失败同源，含 principal/耗时）；`ctx.audit(note)` 加业务备注。
  审计是安全语义，prod 保留（journal limit 可调大）；整体关闭 = struct WARN。
- **live 端点**（决策 20）：写事务提交 → 失效键求交（`emits` × `invalidate`）→ 重算 → SSE 推送；
  重连 = 全量重算（简单且正确）；推数据不推 UI 指令（服务器驱动 UI 不做）。诚实边界：单进程内存
  订阅、无读集追踪（以显式失效键换数据库自由）。
- **prod 行为口径**（FS-DESIGN §3.7 落地）：输入契约校验、JSON-safe 检查、审计 journal **prod
  保留**（对外设防 + 留证）；输出契约校验（ATR-215）prod 剥离（对内证伪可剥离）。

### 8.3 数据面：table() / 可逆迁移 / SQL 种子 / jobs 位（决策 19）

- **表定义扁平单源**：`src/server/db/schema.ts` 用 `table("名", {列...})` 定义；列类型全集 =
  `integer | text | real | blob`（SQLite 四原始类型；时间 = integer ms，复合结构 = 显式 JSON 列 +
  应用层映射——无魔法类型）。关系 `references` 显式声明；cascade 必须在迁移 SQL 里显式写，
  无隐式关系魔术。
- **生成器出访问层**（H11）：`atelier gen db` → 行类型 + 极薄参数化 CRUD + 迁移对骨架。不做
  query builder、不做关系 API、不做懒加载——贴 SQL 纪律：join/聚合 = 手写 SQL 经 `ctx.db.prepare()`。
- **迁移**：`migrate status|up|down|verify|seed`；verify = 影子库干跑（up→down→up 幂等）；状态表
  `atelier_migrations` + 追加式执行账 `atelier_migration_journal`（成败入账）；`gen db --regen`
  对已应用迁移只增不改。**checkpoint 联动**：save 记 migration head 入台账；rollback 目标 head
  低于当前库 → 拒绝并指路先 `migrate down`（绝不自动执行）。
- **种子**：`src/server/db/seeds/*.seed.sql`，每条语句幂等 UPSERT（H9/ATR-336）；`atelier migrate
  seed` 重复执行跳过已应用（`atelier_seeds` 状态表）。
- **事务**：`ctx.db.tx(async (tx) => {...})` 包裹多写；journal 在事务提交后入账（审计与数据一致）。
- **jobs 位（FS-DESIGN §5.6；2026-09-28 差距批 A1/A4 起队列已落地）**：`startJobs({ db,
  handlers, cron? })`（vendor 面导出）装配单机队列 worker——`ctx.jobs.enqueue` 投递（tx 内投递
  与业务写同事务原子）、recurring 定时 = `cron: [{ name, everyMs }]`（`cron:<name>` jobs 行，
  完成即重排/misfire 追一次不补差）、`ctx.kv.setIfAbsent` 幂等去重显式原语（ATR-350/351 参数
  面）；诚实边界 = 单机单进程、5 字段 cron 表达式未做、MCP/CLI 工具族后续批。无 jobs 装配的
  应用沿用内联口径：command 内联执行长任务必须声明 `timeoutMs`（超时 ATR-322，handler 监听
  `ctx.signal` 提前退出）；应用内用法文档 = `src/server/jobs/README.md`（init 模板自带）。
  `emits`/审计元数据兼容纪律不变——command 契约不因同步/异步执行改变，执行位置是部署细节
  不是契约细节。

### 8.4 边界守卫与 struct 八层（决策 20/21）

- **八层机检**（`struct check` / `struct map`，单引擎三通道：CLI / MCP `structure.check` /
  技能包文本）：1 entry（AGENTS.md/llms.txt 路由表）→ 2 knowledge（技能包 + 文档预算）→
  3 facts（SSOT 注册表）→ 4 intent（specs 人有意图）→ 5 errors（错误目录可达）→ 6 timeline
  （源码 checkpoint）→ 7 boundary（server import 越界/import 白名单/auth·journal 显式性）→
  8 data（迁移成对/checksum/漂移）。规则 id 见 §3.2。
- **import 白名单**（slopsquatting 对策）：全仓 bare import 包名必须 ∈ `package.json` deps——
  幻觉包 = ATR-106 ERROR。代理**禁止引用未经安装确认的包名**；不确定先查 `package.json`。
- **文件位置边界**（H8）：前端图永不 import `src/server/**` 与 `src/vendor/atelier/server/**`；
  runtime 保持前端零依赖内核纯度，server 面代码不经 runtime 出口分发。
- 新守卫规则红检/绿检双实证后才转正（不假红纪律）。

### 8.5 MCP 工具族与 dev 面（决策 7/21）

- 工具分四面（权限不混）：**Query（只读）**（结构/注册表/token/状态/静态图/docs 检索）、
  **Query（server 面）**（`endpoint.list/contract/impact`、`db.schema/migrations`、
  `server.introspect`）、**Operation**（checkpoint/回滚/测试/快照/`endpoint.call`——审计必录，
  confirm 档生效）、**Audit**（`audit.log`/`feedback.read`/`endpoint.journal`）。
  **工具清单与数量以 `atelier/mcp/mcp-definitions.json` 单源为准**（CLI 表/错误码/技能包三处
  同步纪律，改后必跑 `check-skills`）——本文不写死数字。
- **接入**：stdio（`node atelier/mcp/server.mjs`，env `ATELIER_PROJECT_ROOT`/`ATELIER_DEV_URL`）
  或应用 dev 面 `POST /__atelier/mcp` 无状态 HTTP 直连（`Mcp-Method`/`Mcp-Name` 头路由，无会话
  粘性；2026-07-28 规范对齐）。工具随 dev 生命周期存活；未 vendor 的旧应用 HTTP 直连 503 诚实
  指路 stdio。
- **confirm 三档**：`atelier.config.json → agent.confirm: auto|ask|deny`（决策 12）。破坏性操作
  与 `endpoint.call` 走档位 + 审计；`ask` = 真实多轮审批（`InputRequiredResult` + `requestState`
  句柄，首轮不执行）；`deny` = ATR-402 结构化拒绝。代理收到拒绝**不得重试同一调用**。
- **长任务**：`structure.check`/`test.run` 等 HTTP 通道长操作走 Tasks 扩展（taskId 句柄轮询，
  句柄仅创建实例可解析，过期 ATR-401 = 重跑）。
- 代理纪律：**先查后改**——`endpoint.list` 枚举路由、`endpoint.contract` 读 schema、
  `server.introspect`/`endpoint.journal` 查运行时事实与审计；拿不准就查，不猜不试错。

### 8.6 dev 托管 / build / CLI 通道（决策 18/23）

- **dev 托管**：`pnpm dev`（或 `atelier dev`）同时起前端与 server 面：server 面子进程监听
  127.0.0.1（缺省 5174，`atelier.config.json server.port` 可配，0=自动），`/api/*` 经 Vite 反代，
  `src/server/**` 变更热重启（不牵连前端 HMR）；就绪握手 `ATELIER_SERVER_READY`。dev 库路径
  `.atelier/dev.db`（gitignore；`--prod-db` 覆盖位）。dev 面另托管 `/__atelier/endpoints`
  （人位端点调试页：端点表 + try-it + schema）与 `/__atelier/server-status`（内省 JSON，prod 隐身）。
- **build**：`atelier build --target=node|bun` → vite 静态面 + `dist/server.mjs` 启动壳 + spawn
  冒烟自证；运行 = `ATELIER_DB_PATH=<卷> node dist/server.mjs`，**整目录部署**语义；edge 等
  不支持 target 显式拒绝（不做清单）。
- **CLI 通道**：`atelier call <endpoint> ['<json>']` 直调运行中 server 面（全 POST；响应 JSON 上
  stdout，ATR 结构化错误 stderr + exit 1；不可达 ATR-403 指路 `pnpm dev`）——specs 验收命令
  直接可执行（验收 = 命令序列）。
- **OpenAPI 导出**：`atelier export openapi` → openapi-3.0.3（schema 走 §8.1 单管线投影；
  `restful:true` 端点映射 GET，默认关；auth 元数据映射 securitySchemes）；只导出端点面。
- **API 面漂移门禁**：`atelier api-diff snapshot|check`——公共 API 面（含 openapi face）快照
  diff：removed/changed = breaking exit 1，`--allow` 显式豁免，`--strict` 连新增也红。

### 8.7 生成器纪律（决策 23）

- **生成器族**：`gen db`（schema → 行类型/CRUD/迁移骨架 + 种子示例）/ `gen endpoint`（端点定义
  → `src/generated/api.ts` 类型化客户端 + specs 可编译骨架）/ `gen auth`（users+sessions 契约、
  迁移对、scrypt 会话原语、auth 端点三件套、cookie——明文可读可改，升级随版本 regen 下发）。
- **产物形态 = 显式 import 闭合**（H11，生成器形态学最高级）：单文件可静态理解——无隐式全局、
  无自动导入、无装饰器；类型全部 import 自契约单源（生成物内联重复类型 = 双源 ERROR）。
- **门禁**（写进框架测试，改生成器必跑）：零修改可编译（init → 全生成器 → tsc/check 全绿，
  中间零手改）；regen 幂等（第二次 diff 空，迁移追加除外）；import 全可解析 + 无相对路径逃逸；
  契约改坏 → 生成物必须带类型错误出现（传导链红检）。
- **升级走 regen+diff** 而非依赖升级：产物带 `@atelier-generated` 标记；手改过的产物 regen 前
  diff 冲突提示——产物是可改的明文，纪律是"改了要能过编译与测试"。
- **前端语法冻结**：模板 DSL（决策 1）在全站化期间冻结，扩展只走 codegen 覆盖扩张；服务端 =
  普通 TS 零新语法，唯一新概念 = 端点/契约声明。代理**禁止发明新模板语法**。

## 9. 版本演进

| 版本 | 时间 | 变更 |
|---|---|---|
| v0.1 | 2025-2026 决策 1-15 时点 | 首版：总原则/H1-H6/软约束/错误规范/命名/DoD/组件循环/性能基线 |
| v0.2 | 2026-09-25 | 决策 17-23 全站化段并入（§8：契约三域/端点面/数据面/边界守卫/MCP 工具族/dev·build·CLI/生成器纪律）+ H7-H12 硬约定 + §3.2 错误导航表按 ERR_CATALOG 与实现实文重对 + §6.2 端点开发循环（FS-DESIGN §14.4）+ 决策 24（ATR-323）收录；v0.1 留档不再维护 |
