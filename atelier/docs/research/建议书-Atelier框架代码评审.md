# Atelier 框架代码评审建议书

- **日期**：2026-09-27
- **评审对象**：`D:\Agentic` 工作区内的 Atelier 框架（`atelier/` 全部代码：runtime 内核 / server 面 / 生成器与编译器 / CLI 与脚本 / dev 面与 MCP / 测试·模板·基准）
- **评审方法**：**只看代码、不看文档**。未采信 `atelier/docs/`、README 及各处 *.md 的任何陈述作为评价依据，全部结论以源码行号为证。采取六路独立评审 + 本机实证：完整测试套件实跑一遍；关键结论逐行复核；可疑结论用只读 node 探针复现。
- **实证记录**：`pnpm test` 本机实跑 **618 通过 / 8 skip / exit 0 / 10.64s**（53 个测试文件）；测试输出中实际出现 Node DEP0190 弃用告警，与第 4.4 节发现互证。
- **证据分级**：〔主笔复核〕= 本报告逐行核对过源码；〔探针实证〕= 评审过程中以只读探针实际复现；〔静态〕= 静态阅读推断（不确定性已注明）。

---

## 一、总评

这是一套**工程纪律显著高于同类自制框架平均水准**的代码库：零运行时依赖的承诺属实（框架 `package.json` 的 devDependencies 仅 typescript / tsgo / vitest，runtime 与 server 的 import 全部是 `node:*` 与内部模块）；错误文化（ATR 码 + message + context + fix 四段式）从表达式解析器贯通到 CLI 退出码；"解释器与编译器同一解析器""SQL 全参数化""迁移追加式"等核心承诺在代码层面是结构保证而非口头纪律。

但本次评审也发现 **12 项 P0/P1 级问题**（全部附行号，其中 5 项经主笔逐行复核、多项经探针实证），暴露出四类共性根因（见第六节）：测试 DOM 罩不住真实浏览器语义、安全模型"主通道设防、旁路失守"、脚本层"复制 + 同步注释"的维护模式到达极限、若干巨型分发函数职责复合。**618 个测试全绿与 12 项 P1 并存**，本身即是本报告最重要的一个结论：绿 ≠ 对，且"为什么绿却错"的机制是可指认的。

| 维度 | 评分 | 一句话依据 |
|---|---|---|
| 架构与设计 | **9 / 10** | 零依赖属实；解析/编译/投影单源同构；端点读写二分模型干净 |
| AI 代理 DX | **9 / 10** | 四段式错误全线贯通、fix 文案真正可操作；STUB 诚实退出 4 |
| 测试与门禁 | **7.5 / 10** | 用例含修复史回归、init→gen→tsc→build 全链门禁真实通过；但 dom-shim 存在结构性盲区 |
| 性能 | **7 / 10** | 双缓存/微任务批处理/coalesce/背压是真实现；也有无 key each 全清重建等悬崖与多处无界增长点 |
| 跨平台 (win32) | **7.5 / 10** | CRLF 容忍、`taskkill /T /F`、DEP0190 规避意识好；但同款 spawn 两种写法并存，本机仍见告警 |
| 正确性 | **6 / 10** | runtime 内核 4 条 P1 + 生成器 2 条 P1（详见第四节） |
| 安全 | **5 / 10** | POST 主通道扎实（参数化/timing-safe/穿越守卫）；live SSE 绕鉴权、journal 明文密码、dev-token 三面暴露 |
| 可维护性 | **6 / 10** | 9 份 die 三种签名已产出 2 条真实 P1；412 行 callTool / 394 行 probeChecks / 200 行 createHandler |

---

## 二、值得肯定的真资产

以下各项均为代码可证、且明显高出常规水准的亮点，修复问题时应**保持而不是推翻**这些结构：

1. **表达式求值器结构性零 eval**：手写 tokenizer + 递归下降解析（`runtime/expr.ts:14-97, 103-345`），函数调用/赋值/箭头函数在语法面就没有产生式（`expr.ts:86-93, 121-127`），不是靠黑名单过滤出的安全。
2. **四段式错误文化全线贯通**：解析器、模板、端点运行时、CLI、MCP 全部输出 code/message/context/fix，且 fix 真可执行——如 ATR-340 对"读取器未装配"与"请求无会话"同码异因做 fix 分流（`server/endpoints.ts:409-425`）。
3. **解释器/编译器同源是结构保证**：`compiler/dump.mjs:36` 直接 import 解释器的 `parseTemplate`，运行时命中编译产物走同一汇合点（`runtime/template.ts:1028-1032`），不是两套实现对拍。
4. **SQL 注入面收口完整**：值路径全部 `?` 绑定，标识符收敛在白名单 `IDENT_RE` 且构造期硬错（`server/db.ts:47-57`），DEFAULT 经单引号转义（`db.ts:157-162`）；评审未发现任何把请求输入拼进 SQL 的路径。
5. **static-host 路径穿越守卫正确**：先规范化再 decode，resolve 后前缀判定（`server/static-host.ts:75-83`），能拦 `%2e%2e` 二次解码穿越。
6. **live 引擎的 coalesce / single-flight / 背压是真实现**：三态状态机（`server/live.ts:277-326`）、在飞期间新写置 pending 补轮（`live.ts:319-324`）、按 `desiredSize` 实测背压 32 帧断流退订（`live.ts:381-393`）。
7. **鉴权原语基本面扎实**：256-bit CSPRNG token、`timingSafeEqual` 比较、cookie HttpOnly + SameSite=Strict、统一 401 文案不泄露账号存在性、CRLF 头注入护栏（`gen/gen-auth.mjs` 渲染产物 129-133/203/298-303 行，`server/endpoints.ts:479-481`）。
8. **迁移器追加式判定双保险**：正则判存量 + `existsSync` 拒重写（`gen/gen-db.mjs:499, 508-511`），编号数值递增 999→1000 不乱序；失败条目与迁移同事务、失败后独立落账（`server/migrate.ts:345-356`）。
9. **$derived 缓存毒化处理正确**：计算抛错保持脏、重试重抛绝不静默返回旧值（`runtime/core.ts:157-162`），且带红检回归（`tests/core.test.ts:53-68`）——这是很多手写 signal 库会写错的细节。
10. **诚实降级文化**：CLI 未实现命令打印指路并退出 4（`cli.mjs:296-304`）；bun 缺失时 build 输出"未实测"而不假绿（`tests/build-gate.test.ts` 实跑覆盖）；MCP 对已移除工具明确拒绝（`mcp/server.mjs:670-674`）。
11. **基准方法论是认真的**：m3-fs 评分器做内省（S 类）+ 行为（R/C 类）双类判据、迁移检查在临时库副本上干跑绝不碰原库、regen 字节幂等"有差原样归还"（`benchmarks/m3-fs/grade.mjs:22-34, 111-150`），另有 175 行负控清单（negative-check.mjs）。
12. **TypeScript 纪律**：runtime 全目录零 `as any`、零 `: any`、零 `@ts-ignore`。

---

## 三、实证基线

- 测试套件本机实跑：**618 passed / 8 skipped / exit 0 / 10.64s**。
- `tests/gen-compile-gate.test.ts`（init→install→gen 三件→tsc 严格零诊断）、`tests/tsgo-parity.test.ts`、`tests/build-gate.test.ts`（init→build→产物 spawn→握手→双面冒烟）三个全链门禁均实跑通过——**模板自洽性有实证背书**，starter 开箱即跑的可信度高。
- 测试输出中实际出现 3 处 Node `DEP0190` 弃用告警（`shell:true` + args 数组），坐实第 4.4/5.4 节相关发现。

---

## 四、P0/P1 级问题清单（必修）

> 共 12 项。每项给模块、证据、影响、修法要点。

### 4.1 runtime 内核（4 项）

**P1-1 `$effect` 抛错一次即永久失活**〔主笔复核〕
`runtime/core.ts:209-221`：`sub.run` 里"删旧订阅 → 跑 fn → 重订阅"，其中重订阅循环（220 行）在 try/finally **之外**；`fn()` 抛错时旧订阅已在 211 行删光，异常传播后重订阅永不执行。结果：effect 的 `alive` 仍为 true，但从此收不到任何通知。探针实证：effect 内抛错一次后，上游再写不再触发。放大面：`{#if}` test 求值无包裹（`template.ts:1322`）、`{#each}` 源为字符串时 `arr.forEach` TypeError（`template.ts:1364/1412`）——"先 loading 字符串后数组"的常见数据形态会让整块 UI **永久冻结且无报错**（scheduleFlush 只 console.error，`core.ts:62`）。
**修法**：重订阅并入 finally；或抛错时恢复旧订阅集。配一条"effect 抛错后仍可恢复"的红检。

**P1-2 动态布尔属性语义反转：`disabled={false}` 实际禁用元素**〔主笔复核〕
`runtime/template.ts:1295-1299`：动态属性一律 `setAttribute(name, stringify(v))`，仅 `null/undefined` 走 removeAttribute。`false` → 字符串 `"false"` → 属性**存在**即真（HTML 布尔属性语义）。`disabled / checked / hidden / readonly / required / selected / open` 全部中招：`disabled={canSubmit}` 在 true 与 false 两种取值下元素都被禁用。测试网罩不住的原因：dom-shim 是纯 `[name, value]` 字符串表（`tests/dom-shim.ts:38, 85-89`），不实现存在性语义。
**修法**：维护布尔属性集合，`false` → removeAttribute；dev 态对已知布尔属性给 ATR 警示。

**P1-3 bind:group 初始选中依赖属性书写顺序**〔探针实证〕
`runtime/template.ts:804-815`：bind:group 的 `$effect` 首跑是**同步**的（`core.ts:224`），发生在 attrs 循环内（`template.ts:1280-1303`）。`<input type="radio" bind:group={sel} value="a">`（bind 在前）时首跑读 `value` 得 null → 记假 ATR-327 且 `checked=false`，此后不再重跑。实证：bind-first 与 value-first 两种书写产生不同结果。`template.ts:763-764` 的设计论证注释建立在"首跑入微任务队列"的错误前提上。
**修法**：身份键推迟到 attrs 全部落定后读取；修正该注释。

**P1-4 bindProp 的 prop 信号永久泄漏进全局 `store._signals`**〔探针实证〕
`runtime/template.ts:439 + 1113`：bindProp 每次 `$state(...)` 无条件入全局集合并永不删除；分支切换重建发生在 mount 结束后，`disposeInstance` 删不到它。实证：含 `<Child title={n.value} />` 的 {#if} 切换 6 次，`store._signals` 从 3 涨到 6。放大效应：dev 桥每次信号变更遍历全部 `_signals`（`bridge.ts:144-147`），泄漏直接抬高每次变更的固定成本。
**修法**：bindProp 内 `captureCleanup(() => store._signals.delete(sig))`。

### 4.2 server 面（2 项）

**P1-5 live SSE 通道完全绕过端点声明的鉴权**〔主笔复核〕
`server/endpoints.ts:363-380`：`GET <mount>/<name>/live` 路由在鉴权拦截（398-440 行，仅存在于 POST 路径）**之前**直接返回；`live.ts` 的 `handleLive` 全程不调用 `readAuth`，重算 ctx 也是 `auth: null`。任何声明了 `auth: { type: "session" }` 的 live query，未认证客户端可直接 `GET /api/<name>/live` 订阅全量数据流，端点声明被静默忽略，注册期亦无告警。
**修法**：live 路由分支复用同一 readAuth 门禁；短期至少在 `register()` 对 `live != null && auth 声明非 none` 的组合显式拒绝，把"不支持"变成看得见的失败。

**P1-6 审计 journal 明文记录 auth.login 的密码，并经无鉴权调试端点吐出**〔主笔复核 + 探针实证〕
`server/endpoints.ts:102-112` 的 `EndpointJournalEntry.input` 记录完整输入对象，成功与失败条目同记（`endpoints.ts:509/537`）；该 journal 经 `GET /__atelier/server-status` 全量吐出（`server/introspect.ts:192`），且此路由本身无鉴权。口令由此进入内存审计环 + 调试端点 + review 页/MCP 工具整条消费链。
**修法**：分发层对 input 做敏感键脱敏（建议端点声明 `redactInput` 位，框架层做比靠每个端点自觉可靠）；login 端点骨架显式剔除 password。

### 4.3 生成器与编译器（2 项）

**P1-7 extract-schema 对交叉/联合类型首成员静默截断，产出错误 schema**〔主笔复核〕
`compiler/extract-schema.mjs:306-315`：`findPropsSig` 只取 `props:` 后第一个 `{`，`matchBraceAt` 只配对该花括号。探针实证：`(props: { title: string } & { extra: number })` → schema 只含 `title`，无 ATR-102、无 warn，错误 schema 直接流入 AST/dev 面/编译产物。这与该文件头注"超出映射面 → 显式拒绝、绝不静默产出错 schema"的核心承诺相悖。
**修法**：`matchBraceAt` 闭合后检查剩余尾文本（trim 后非空且非 `)`）→ 抛 ATR-102。

**P1-8 派生标识符与字符串插值无校验：坏名字产出编译不过的生成物**〔探针实证〕
`gen/gen-endpoint.mjs:455-460`（端点名取自任意字符串字面量，全程无字符集校验）+ `:767/769`（`name: "${e.name}"`、`fetch("...")` 裸插值无 JSON.stringify）+ `:634-646`（`pascalOf/camelOf` 不校验产物合法性）。实证（gen-db 侧同类）：表名 `_1` 通过 `IDENT_RE`，`toPascal("_1")` = `"1"` → 产出 `export type 1Row = {` 非法 TS。端点名含 `"`/`\`/换行同理破碎整份 api.ts，报错位置在生成文件里，无生成器侧诊断。
**修法**：入口校验名字符集（`^[A-Za-z][\w.-]*$`）与派生标识符合法性，非法即 die；三处字符串插值改 `JSON.stringify`。

### 4.4 CLI 与脚本（2 项）

**P1-9 `atelier test` 的 die 误传字符串 → 未捕获 TypeError 崩溃**〔主笔复核〕
`cli.mjs:288`：`die('error: no package.json here', 'fix: run inside an Atelier app dir')`，而 `die(msg, code = 2)`（`cli.mjs:105-108`）第二参是退出码——传字符串导致 `process.exit(字符串)` 抛 ERR_INVALID_ARG_TYPE，fix 文案永不显示、退出码语义错。`cli.mjs:148` 的注释明说同款问题已在 `dev` 命令修过，`test` 漏网。
**修法**：合并为单串 msg + 显式 2；顺带统一全部 die 签名（见 5.4）。

**P1-10 bench / snapshot-smoke 失败路径泄漏子进程与临时目录**〔静态 + 行号确凿〕
`scripts/bench.mjs:28-31` 的 die 内 `process.exit(1)` 被 try 块内调用（`:233, :252`），`finally`（`:289-293`：关浏览器/killTree/清理）不执行；`snapshot-smoke.mjs` 同款（die 定义 31-35，8 个失败调用点全在 try 内，finally 104-107 被跳过）。后果：失败的 bench 留下孤儿 dev server 占住 strictPort 5199——下次 bench 的 `waitUp` 只探端口可达（`bench.mjs:140-147`），会**对着陈旧实例出数**；smoke 泄漏 5173 与临时目录。
**修法**：die 改 throw 由 catch 统一清理后退出。

### 4.5 dev 面与 MCP（2 项）

**P1-11 MCP 工具内的同步 spawnSync 可冻结整个 Vite dev server**〔静态 + 行号确凿〕
`mcp/server.mjs:170`（checkpoint 门禁内建跑全量测试套件）、`:265`（graph.static 60s）、`:370-373`（test.run 180s）、`:403-408`（git 无超时）全部 spawnSync，且经 `/__atelier/mcp`（`dev/atelier-dev-plugin.mjs:286-322`）直接跑在 **Vite 进程**内。`http.mjs` 为长操作搭的 Tasks 后台化形同虚设：`tasks.mjs:78-84` 的微任务里执行的 `run()` 内部仍是 spawnSync；`tasks/cancel` 的 abort 对 spawnSync 无效（`tasks.mjs:128` 注释自认）。现象：agent 触发 checkpoint/test.run 后，页面服务/HMR/SSE 全部冻结到子进程结束。
**修法**：callTool 内改异步 `spawn` + stdio 流式收集，使 cancel 真正可中断。

**P1-12 唯一信任锚 dev-token 同时暴露于三个面，插件层无 Host/Origin 校验**〔静态 + 行号确凿〕
① token 注入每个 HTML 页面（`atelier-dev-plugin.mjs:165-168`，`window.__ATELIER_TOKEN__`）；② 明文落盘 `.atelier/dev-token` 默认 0644（`:61-63`）；③ 常驻无头浏览器开 `--remote-debugging-port=9345`（`dev-screenshot.mjs:103, 329`）——CDP 端口**无任何鉴权**，共享 Windows 机器上其他本地用户可连上读出页面内 token。全部 13 个 dev/mcp 文件 grep 无任何 Origin/Host 校验、无 CSP；`readBody`（`atelier-dev-plugin.mjs:91-97`）不检查 content-type，拿到 token 的攻击者可用 `no-cors` + `text/plain` 伪装 JSON 体完成跨站写。现状缓解是**条件性的**：模板 `vite.config.ts` 绑 `127.0.0.1` 且 Vite 7 有 Host 校验，但用户把 host 改成 `0.0.0.0`（容器/局域网调试常见）即全线沦陷——token 门禁背后是可起 shell、写文件、回滚 git 的工具面。
**修法**：`/__atelier/*` 入口加 Host/Origin 白名单校验；token 改一次性 cookie 不进 HTML；CDP 改 `--remote-debugging-pipe` 或校验 Browser 身份。

---

## 五、P2 级问题精选

> 按模块归组，每条附行号；完整清单可按此索引回溯。

**runtime（10 项）**：文本中字面量 `<` 被静默吞掉（`template.ts:131-135`，与自述"显式拒绝不静默"哲学冲突）；`recordRuntimeError` 裸引用 `window`，非浏览器环境错误记录器自爆（`template.ts:488`）；忘写 `.value` 时静默渲染信号对象 JSON、零报错（`template.ts:1221-1226`，对 AI 代理是高频笔误）；`on*` 属性走 setAttribute 成为内联事件通道、`javascript:` URL 无过滤（`template.ts:1281, 1298`，硬化缺口）；mount 中途抛错半成品 effects 永久泄漏（`template.ts:984-1001`）；无公开 unmount/dispose API（`template.ts:1100+`）；一元负号与科学计数法不支持且报错误导（`expr.ts:237-268, 49-59`）；keyed each 重复 key 静默折叠行（`template.ts:1374-1390`）；`store._checkpoints` 无上限（`core.ts:300-308`）；无 key `{#each}` 每次全清重建（`template.ts:1409-1425`）。

**server（8 项）**：`live: false` 被当 `true` 处理，内省与实际行为矛盾（`endpoints.ts:272/367` vs `:292-294`，`live.ts:117/137`）；迁移状态表 name 无 UNIQUE 且无并发互斥 → 迁移可被双应用（`migrate.ts:50-51, 321`）；`openSqlite` 不设任何 PRAGMA——外键不启用（DDL 里的 `REFERENCES` 纯装饰）、无 busy_timeout（`sqlite.ts`，写竞争直接 SQLITE_BUSY）；请求体无界缓冲（`node-host.ts:101-113`）；scrypt 留在 Node 默认 N=16384 且哈希串无参数版本位、无升级路径（`gen-auth.mjs:185-194`）；登录存在账号枚举时序侧信道（`gen-auth.mjs` 渲染 298 行短路）；无限速/失败锁定钩子位；内部错误 message 原样外泄（含 prod，`endpoints.ts:543`、`live.ts:353`、`node-host.ts:77`），且 prod 隐身完全依赖构建壳单点旗（`introspect.ts:54-56` + `scripts/build.mjs:135`——直跑 `main-server.ts` 上线则 server-status 裸奔）。

**生成器与编译器（6 项）**：模板字符串里的文档示例会被扫成幽灵端点（实证：反引号字符串中的 `defineQuery("demo.ping", …)` 直接进入 api.ts/openapi/api-diff；`gen-endpoint.mjs:439`、`export-openapi.mjs:202/277` 在原始 src 上裸扫）；三个字面量解析器"同构"不实——转义语义分叉，同一 `enum: ["a\nb"]` 三处解析出三个值（`gen-endpoint.mjs:253` vs `export-openapi.mjs:110` vs `gen-db.mjs:147`）；~200 行扫描原语跨文件复刻（`matchAngle` 在 gen-endpoint 是导出函数、export-openapi 又抄了一份私有实现）；dump 产物带时间戳与机器绝对路径、非字节幂等（`dump.mjs:190-202`）；codegen 多 `<style>` 块与解释器行为分叉（`codegen.mjs:61-66` 全注入 vs `template.ts:1034-1035` 只注入首个）；dump 的 html`` 提取器对插值内注释盲视（`dump.mjs:75-95`）。

**CLI 与脚本（6 项）**：checkpoint 的 API 门无法使用它自己指路的 `--allow` 豁免（`checkpoint.mjs:266` 固定调用不带 allow，`:278` 的 fix 文案指路失效）；api-diff baseline 损坏被当 vacuous 静默放行（`api-diff.mjs:416-417` 一切异常 exit 2 + `checkpoint.mjs:267` 把 status 2 一律解释为 vacuous）；init 对已存在目录零守卫、重跑覆盖用户文件（`init-project.mjs:59-65`）；check-skills 的命令/flag 白名单已与 cli.mjs 实际 dispatch 漂移——缺 `gen`/`export`/`api-diff` 等动词，校验器自身失守（`check-skills.mjs:43-48` vs `cli.mjs:235/251/281`）；`sourceFingerprint` 整函数复制两份靠"MUST stay in sync"注释维系（`checkpoint.mjs:181-200` vs `snapshot.mjs:93-112`）；`struct --json`、`snapshot --full` 这类自然写法因 flag 被当子命令而 usage 退出 2（`cli.mjs:178-179, 278-279`）。

**dev 面与 MCP（10 项）**：握手超时不杀子进程，迟到 READY 使已 rejected 的监督器"意外复活"、日志与状态矛盾（`dev-server-host.mjs:139-151`）；`/__atelier/registry` 与 `/docs` 两处同步读无 try/catch，文件缺失即 unhandled rejection 击杀 dev server（`atelier-dev-plugin.mjs:383, 410`）；ui.screenshot 的 MCP 侧 4s 超时与插件侧冷启动最坏 40s+ 严重不匹配（`server.mjs:559-560`）；工具定义里声明的参数被静默丢弃——tokens.list 的 group、state.snapshot 的 root、ui.screenshot 的 format 不会透传（`mcp-definitions.json:61-72, 84-89, 149-162` vs `server.mjs:551-576`），对以 schema 为契约的 agent 是静默错误答案；confirm 闸门对未知档位 fail-open，拼错 `ask` 即静默 auto（`confirm.mjs:168`）；requestState 句柄 5 分钟窗内可无限重放同一破坏性操作（`confirm.mjs:119, 129-147`）；SSE 无心跳 + resolved Map 无界（`atelier-dev-plugin.mjs:639-651, 89, 676`）；固定 CDP 端口 9345 可被抢占后接错浏览器实例（`dev-screenshot.mjs:96, 125-133`）；gen-tailwind-theme 对 token 键值零校验直接拼 CSS（`gen-tailwind-theme.mjs:33-36`）；MCP 输入 schema 的 min/max 未翻译为 minimum/maximum，宿主校验静默忽略（`server.mjs:67-77`）。

**测试与基准（2 项）**：dom-shim 纯字符串属性表罩不住布尔属性存在性、select 选中、真事件默认行为等一整类"真 DOM 语义"问题（这是 P1-2/4.1 一族 bug 全绿的直接机制）；基准脚本 spawnSync + win32 shell:true 沿用（`m3/grade.mjs:38-48`），S 类判据部分查声明而非行为（R/C 类有行为测试兜底，总体尚可）。

---

## 六、共性根因分析

12 项 P1 不是 12 个孤立失误，背后是四个可指认的结构性根因。修根因比逐条打补丁更值：

1. **测试网的结构性盲区：字符串 DOM 罩不住真 DOM 语义**。dom-shim（`tests/dom-shim.ts`）把属性实现为 `[name, string]` 表，`setAttribute("disabled","false")` 与真实浏览器"属性存在即禁用"的语义差异、select 选中匹配、effect 首跑时序 × 属性发射顺序——这一整类问题在现有 618 用例下**原理上不可见**。P1-1/2/3 全部属于这一类。测试数量不缺，缺的是语义层。
2. **"复制 + 必须同步"注释的维护模式到达极限**。9 份 die 三种签名（其中 checkpoint.mjs 参数序相反）已直接产出 P1-9；`sourceFingerprint` 整函数复制、check-skills 白名单与被校验对象漂移、DEP0190 规避写法三处采用两种风格（本机测试输出仍见告警）——每个复制点都带着同步注释，这正是该抽共享库的信号。
3. **安全模型"主通道设防、旁路与观测面失守"**。POST 端点链路（参数化/鉴权拦截/timing-safe/穿越守卫）经得起逐行核对；但 live SSE 旁路（P1-5）、审计 journal 与 server-status 观测面（P1-6）、dev 面的 token/CDP 三个暴露面（P1-12）都在主通道设防之外。典型的"第一遍安全做的位置，就是第一遍想到的位置"。
4. **巨型分发函数职责复合**。`callTool` 约 412 行七段平铺（`server.mjs:183-595`）、`/__atelier` 中间件闭包约 435 行 20+ 路由（`atelier-dev-plugin.mjs:259-693`）、`probeChecks` 约 394 行内联八层规则（`struct.mjs:47-440`）、`createHandler` 约 200 行十职责（`endpoints.ts:352-554`）。共同后果：闭包包死测试面（只能整链黑盒）、单一分支的异常（如 P2 的 registry 未捕获读）牵连整个进程。

---

## 七、建议行动

### A. 近期必修（对应第四节 12 项 P1，工作量约一人一至两周）

| # | 行动 | 对应 |
|---|---|---|
| A1 | core.ts：重订阅并入 finally，配"抛错后可恢复"红检 | P1-1 |
| A2 | template.ts：布尔属性集合 false→removeAttribute；`<` 文本吞噬改显式报错；bind:group 身份键延迟读取；bindProp 注册 captureCleanup | P1-2/3/4 |
| A3 | endpoints.ts：live 路由接 readAuth；register() 对 live×auth 组合显式拒绝；journal 敏感键脱敏位 | P1-5/6 |
| A4 | extract-schema 尾文本检查抛 ATR-102；gen-endpoint 名字校验 + JSON.stringify 插值 | P1-7/8 |
| A5 | cli.mjs:288 修复 + 统一 9 份 die 签名；bench/smoke 的 die 改 throw 保证 finally 清理 | P1-9/10 |
| A6 | mcp/server.mjs 长操作改异步 spawn；`/__atelier/*` 加 Host/Origin 校验；token 出 HTML；CDP 改 pipe | P1-11/12 |

### B. 中期（结构性补课）

1. **补测试网语义层**：给 dom-shim 增加布尔属性存在性/select 选中匹配语义，或评估引入 linkedom/jsdom 作第二层对拍（devDependency，不破坏零运行时依赖承诺）；把 12 项 P1 全部固化为回归用例——这是防止同类问题复发收益最大的一件事。
2. **抽 `scripts/lib/` 共享库**：统一 die/argOf/路径工具/指纹函数，替换全部复制点；check-skills 白名单改为从 cli.mjs 派生（`api-diff.mjs:123-128` 的 `extractCliCommands` 现成可复用）。
3. **server 面安全收口包**：scrypt 显式参数 + 哈希串版本位；`openSqlite` 统一 `PRAGMA foreign_keys=ON` + `busy_timeout`；请求体上限；prod 旗下错误 message 收敛为通用文案 + 指纹；server-status 可选 token 门禁；迁移表 UNIQUE + 会话过期清理。
4. **生成器统一字面量解析模块**：三份解析器合一，消除转义分叉；dump 产物去时间戳/绝对路径恢复字节幂等；codegen 与解释器的多 style 块行为对齐。
5. **拆巨型函数**：callTool（按工具族分文件）、createHandler（拆 gateAuth/runWithTimeout/settleCommand）、probeChecks（八层各一函数）；registry/docs 两处读盘补守卫。
6. **MCP 契约面修复**：广告参数透传（group/root/format）；confirm 未知档位改 fail-closed；requestState 加一次性 nonce。

### C. 长期

1. 公开分发（npm）与真实公网部署前，按本报告第四/五节安全面逐条复验一轮——尤其 P1-5/6/12 在多用户机器与非 localhost 绑定下的暴露模型。
2. 性能尾巴：无 key each 增量化、checkpoints 上限、SSE 心跳与 resolved 修剪、公开 unmount API 补全 SPA 生命周期。
3. 基准链路换异步执行以消除 win32 shell:true 族问题；M8/F 线后续若扩展端点元数据（如幂等执行），建议与 timeout 一样做成真执行而非纯声明位。

---

## 八、量化附录

| 目录 | 文件数 | 行数（.ts/.mjs） | 备注 |
|---|---|---|---|
| runtime/ | 9 | 2,894 | 最大 template.ts 1,533 行（占 53%）；零 any/@ts-ignore |
| server/ | 10 | 2,528 | 最大 endpoints.ts 559 行；import 仅 node:* 与 runtime |
| gen/ | 5 | 2,829 | 最大 gen-endpoint.mjs 947 行 |
| compiler/ | 4 | 1,289 | dump/codegen/project-json/extract-schema |
| dev/ | 7 | 2,195 | 最大 atelier-dev-plugin.mjs 701 行 |
| mcp/ | 5 | 1,526 | 最大 server.mjs 738 行；36 工具与路由一一对应（枚举核对无孤儿） |
| scripts/ + cli.mjs | 17 | 3,616 + 317 | 最大 struct.mjs 752 行 |
| tests/ | 53 | 14,401 | vitest 618 用例（602 处直接声明 + each 展开），8 skip |
| templates/app/ | 19 | 1,735 | 自洽性经三个全链门禁测试实证 |
| benchmarks/ | 105 | 8,720 | m3 六任务 + m3-fs 三任务，双类判据 + 负控 |
| **框架本体合计**（不含 tests/benchmarks） | ~57 | **~19,200** | 零运行时 npm 依赖（devDeps 仅 tsc/tsgo/vitest） |

---

*本建议书全部结论以代码为唯一证据源；文档陈述一律未采信。12 项 P1 均附文件:行号，可直接按图索骥核实。*
