# 全仓架构评审与下一步发展计划（2026-09-30）

> 性质：只读评审报告 + 发展计划建议（用户指令「高级架构师重新校对全部代码 + 给出下一步发展计划」）。
> 方法：五路只读评审代理并行精读约 5.3 万行源码（runtime 9 文件 / server 15 文件 5602 行 / gen+compiler 10 文件 / dev+mcp 12 文件约 4800 行 / cli+scripts 18 脚本 + templates/app 全量 + skills 8 包），逐条核对 BACKLOG 评审队列、design-decisions 0-34 与 git 锚点；统筹者对三处头号 P1 做二次抽查坐实（uploads 下载路由直透 / mount 前缀 startsWith / 端点扫描器无掩码）。
> 基线核验：`pnpm test` **877 绿 + 8 skip**（与 README 标记位一致）；check-skills 上一轮 56-0。
> 纪律声明：本报告是评审与建议，未改动任何代码；所有 file:line 以 2026-09-30 代码为准，引用前先复核。P1 清单如立项，按惯例抄送 `BACKLOG.md` 执行队列。

---

## 1. 总裁决

代码库的工程纪律和架构骨架是真实且优秀的——测试全绿、faces 装配模型同构、错误处理哲学自觉、vendor 闭包红线有机械核对。但本次校对坐实 **15 项 P1 级正确性/安全问题，全部藏在测试覆盖之外（绿 ≠ 对）**。最严重三族：

1. **uploads 下载面完全无鉴权 + 存储型 XSS**（`endpoints.ts:1311-1327` 直透 `uploads.ts:557-594`）；
2. **dev 反代 `<mount>/*` 写面无 Origin 闸**（`dev-server-host.mjs:227-243`）；
3. **生成器扫描器无注释掩码产出幻影端点**（`gen-endpoint.mjs:485` / `export-openapi.mjs:207,303`）。

核心建议：**阶段四 npm 发布（D-3）之前必须先跑三个收口批（R1 安全正确性 → R2 契约单源化机检 → R3 结构债）**。带着这些洞对外发布，会把「可验证性基建」的差异化主张变成反讽——尤其 #1/#2/#3 属于「发布了就是 CVE」级别。

## 2. 架构总评

### 2.1 真实的优点

- core/expr/template 分层干净且单向依赖有环自查（template→component 仅 type-import，注释自查成立）。
- `__compiledRT` 单源注入保证「编译 ≡ 解释器」是设计亮点（本次发现两处破口，见 P1-5/6——机制好，覆盖有漏）。
- server「被拒之门前不触碰 handler、不入 journal」语义在所有分支一致贯彻；faces 装配（jobs/email/uploads/health）高度同构，扩展心智成本低。
- 安全基本面大部分扎实（核验通过项见 §5.5）：fail-closed 鉴权、timingSafeEqual 恒时比较、journal 递归脱敏单源、全 SQL `?` 绑定、双 413 闸、static-host/uploads 写面穿越守卫、busy_timeout/foreign_keys 统一 PRAGMA。
- dev 面安全叙事（P1-12 三暴露面收口、CDP 随机端口+看门狗、win32 树杀）有测试与红检锚定，残余风险自认注释质量高。

### 2.2 三个结构性风险

1. **同一语义多份手抄实现，无跨实现对拍**——字面量转义解码 3 份（已实际产出错误产物）、端点扫描器 2 份（掩码只补了一边）、`sourceFingerprint` 整函数复制 2 份靠注释维系。每份各有测试钉住，但「钉住的是各自的错误行为」没有任何防线。
2. **巨型平铺函数没有可测试面**——createHandler 返回闭包恰 200 行十段 if-chain、callTool 431 行七段、dev 中间件 472 行 20+ 路由。mount 前缀边界 bug（P1-14）能活到今天，正说明路由匹配逻辑无法被单独测试。
3. **「同步纪律」大量停留在注释层面而非机检**——错误码总表缺 12 个实抛码、ARCHITECTURE §8 CLI 表与 dispatch 大面积漂移、check-skills 白名单含 runtime 根本不导出的 `expect`/`verify`、技能包教幻影 API。仓库自我标榜「单源纪律」，这是目前最大的兑现缺口。

## 3. P1 必修清单（全部经实读/实跑坐实）

| # | 位置 | 问题 | 建议修法 |
|---|---|---|---|
| 1 | `server/endpoints.ts:1311-1327` + `server/uploads.ts:557-594` | **资产下载面无鉴权**：上传面有 gateAuth 缺省 session fail-closed，下载路由直透 `handleDownload`——框架没有提供任何给下载面加鉴权的方式；id 是 AUTOINCREMENT 顺序整数，`/assets/1`、`/assets/2`… 可匿名枚举下载私有文件 | UploadDef 增加下载鉴权声明（复用 gateAuth 单源，缺省跟随上传面）；id 改 sha256 前缀（内容寻址天然不可枚举）或成文「资产公开」决策 |
| 2 | `server/uploads.ts:586-589` | **存储型 XSS**：响应 content-type 用攻击者自报的 multipart mime（SVG 即使在 `accept:["image/"]` 白名单内），无 `X-Content-Type-Options: nosniff`，资产与应用同源——浏览器直接导航即同源执行脚本 | 恒加 nosniff（一行）；危险 mime（text/html、svg 族）缺省 `Content-Disposition: attachment`；可选 CSP |
| 3 | `dev/dev-server-host.mjs:227-243` | **反代写面无 Origin 闸**：P1-12 闸只盖 `/__atelier/*`（`atelier-dev-plugin.mjs:374-379`），承载写副作用的 `<mount>/*` 反代零防护——恶意网页可用 no-cors fetch 跨站驱动 `POST /api/<写端点>` | middleware 复用已导出的 `originAllowed`/`originAllowlist`（同 self port），不匹配 403；可选 statusToken 双面同钥 |
| 4 | `gen/gen-endpoint.mjs:485-487`、`gen/export-openapi.mjs:207,303` | **扫描器无注释/字符串掩码**：注释掉的 `defineQuery("x", {...})` 产出幻影端点进 api.ts 与 openapi.json（运行时必 404）；多行注释形态使 matchDelim 匹配延续，`re.lastIndex = close + 1` **跳过区间内真实端点**。gen-db（maskLiterals）/extract-schema（codeMaskOf）都做了掩码，唯独两个端点扫描器没做 | 复用 codeMask 技法（Uint8Array 掩码 + 命中查位）；补「注释掉的端点/字符串里的 defineQuery」红绿测试 |
| 5 | `compiler/codegen.mjs:162-167` vs `runtime/template.ts:1355-1379` | **编译产物布尔属性语义反转**：解释器对 `disabled={false}` 走 removeAttribute（BOOLEAN_ATTRS 25 项 + ATR-328），codegen dynamic 支路只发射 setAttribute——编译应用落成 `disabled="false"`，存在即真，元素被禁用。bool-attrs 测试只测解释器路径 | 抽 runtime 单点 `rt.bindAttr(el,name,expr,scope)`（对齐 bindTwoWay/bindEvent 先例），codegen 改发射；补 `disabled={false}` 双路径 parity 用例 |
| 6 | `runtime/template.ts:1094` vs `compiler/codegen.mjs:61-66` | **多 `<style>` 块 dev/prod 分叉**：解释器非全局正则只注入首个，codegen `/g` 全注入、compiled 路径 `for...of compiled.styles` 全注入——同一组件两态渲染不一致（codegen 侧注释自称「同一正则」不成立） | 二选一统一（建议解释器改 `/g` 循环，一行）；补双块 parity 用例 |
| 7 | `scripts/init-project.mjs:59` + `cli.mjs:143-146` | **init 覆盖用户文件**：对已存在目录 `cpSync(recursive)` 合并覆盖，用户改过的 `main.ts`/`contract.ts`/`vite.config.ts` 被静默重置（未提交即不可恢复）；`--target` 缺值时 undefined 被 spawnSync 强转 `"undefined"` 落进 `./undefined` 目录（实跑复现） | target 存在且非空 → die 指路 `atelier sync`（或 `--force`）；cli 侧显式校验 target/name 缺值与 `--` 前缀 |
| 8 | `scripts/api-diff.mjs:416-418` + `checkpoint.mjs:272` | **坏基线静默放行**：baseline JSON 损坏也 die exit 2，checkpoint 把 exit 2 一律解释为「布局不可判 → vacuous pass」——「未检不锚」核心卖点的公信力洞（与 checkpoint.mjs:261 注释自相矛盾） | api-diff 区分退出码（布局不可判=2 / 基线损坏=3 或 distinct marker）；checkpoint 对「基线存在但不可评估」拒锚或显式 WARN |
| 9 | `runtime/template.ts:1044-1061, 1118` | **effect 泄漏两处**：mount 中途抛错时 collected/collectedEffects 是局部变量，半成品 effects 的 dispose 随栈帧丢失；实例析构（disposeInstance:1164-1174）只回收 `inst.effects`（初始渲染），运行期换支/加行的 effects 挂 `branchCleanup`/`rowCleanups` 不随实例销销——HMR swap 后当前分支 effects 仍向脱离节点写入。所有权分裂在 `__effectSink`/`teardownStack`/`store._signals` 三层是共同根因 | LiveInstance 增加 node 级 cleanup 收集 + 公开 `unmount()` + mount 失败路径回收（一次解决三症状） |
| 10 | `dev/atelier-dev-plugin.mjs:317,328,423,561,564,617-618` | **7 处硬用配置端口**（`config.server.port ?? 5173`）：Vite strictPort 缺省 false、5173 被占自动 +1 时配置不变——截图导航打到错误端口（可能拍到另一项目）、MCP devUrl 错、cookie `atelier_dev_token-5173` 两实例同名互踩（注释承诺的并行隔离恰在并行场景失效） | 监听后取 `server.httpServer?.address()?.port` 缓存单一 `actualPort`，7 处改引 |
| 11 | `dev/dev-server-host.mjs:139-141` | **握手超时不杀子进程**（:29-30 注释却承诺「超时杀子进程并如实报错」）：超时只 reject，child 永活（占端口持 SQLite 句柄）；再 start() 无 isReady 守卫会 spawn 新 child 覆盖引用，旧进程彻底孤儿 | 超时 settle 同步 `c.kill("SIGTERM")`（win32 taskkill /T）；start() 开头 `if (child) await stop()` |
| 12 | `dev/atelier-dev-plugin.mjs:503-506,529-531` | **async 中间件无错误围栏**：`/__atelier/registry`、`/__atelier/docs` 的 readFileSync 无 try/catch——connect/Vite 不 await 中间件 promise，文件缺失 → 请求永久悬挂 + unhandledRejection 击杀 dev server | 中间件体外层统一 try/catch → 500 ATR JSON（headersSent 时 destroy） |
| 13 | `gen/gen-db.mjs:299-302,537-544` | **toCamel 无保留字闸**：表名 `delete`/`void`/`class` 通过 IDENT_RE 与 toPascal 检查，产物 `export function deleteGetByPk(...)` 整份 crud.ts 编译不过（gen-endpoint 有完整 RESERVED_WORDS 闸，gen-db 的 ATR-343 兜底漏了这半边） | 照抄 gen-endpoint 的 RESERVED_WORDS 进 toCamel（或抽共享常量），die 四段式 |
| 14 | `server/endpoints.ts:1226` | **mount 前缀无 `/` 边界**：`rest.startsWith(mount)` 后直接 slice——mount="/api" 时 `/apifoo` → name="foo" 正常分发、`/apiupload/x` 命中上传路由。对照 `static-host.ts:66` 的正确口径（`=== mount || startsWith(mount + "/")`）。暴露条件：直连 server 端口（裸 createHandler 直挂形态）即触发；后果：绕过按路径前缀设防的反代 ACL | 改 `rest === mount \|\| rest.startsWith(mount + "/")`，补 `/apifoo` 负例（一行修复） |
| 15 | `runtime/template.ts:524-528` | `recordRuntimeError` 裸引用 `window`（同文件 :1250 有 `typeof window` 守卫，此处漏）：非浏览器环境错误记录器自身抛 ReferenceError **吞掉原始错误**；且与 core.ts:61 的 `globalThis.__ATELIER_LAST_ERROR__` 双写点宿主对象不一致 | 改 globalThis 并统一两处「最近错误」写入点 |

## 4. P2 系统性债务（按族归并）

### 4.1 MCP 契约面漂移（对 agent 消费方最危险——契约失真比功能缺失更危险）

- 广告参数静默丢弃：`tokens.list.group`、`state.snapshot.root`、`ui.screenshot.format` 无任何消费点（`server.mjs:652-654` 通用路径不构造 query）。
- `min`/`max` 不译 `minimum`/`maximum`（`server.mjs:67-77` flatToJsonSchema 原样 clone）——严格宿主校验失效。
- 受闸工具（checkpoint.rollback / state.time_travel / checkpoint.source_rollback）schema 未声明 `_approval` 且 `additionalProperties:false`——做入参校验的 MCP 客户端直接拒绝审批二轮，ask 档在严格宿主上不可用。
- ui.screenshot 4s（`server.mjs:654`）↔ 60s（`:564` snapshot.diff）↔ dev 面无总超时——冷启动必超时伪装成 "dev surface unreachable"；叠加内外层 ×2 重试理论最坏 ~8 分钟。
- snapshot.diff 基线路径写死平铺，dev 面已平台感知——per-platform 布局下 MCP 侧失明，三处口径分裂。

### 4.2 fail-open 残留

- `confirm.mjs:168`：未知 confirm 档位 `return { kind: "allow" }`——配置写 `"ask "`（尾空格）/`"Ask"` 一律静默放行破坏性工具；tests 把该行为断言为「不误伤」是有意决策但与安全基线冲突。
- `confirm.mjs:118-147`：requestState payload 含 nonce 但 verify 不消费——同一 approve 句柄 TTL 内可无限重放（「一次审批→N 次回滚」成立）；且 HMAC 密钥即 `.atelier/dev-token`，能读 token 的客户端可自行伪造 requestState 自批，ask 档对持 token 方是荣誉制。

### 4.3 文档/技能面失真

- 错误码总表缺 12 个实抛码（ATR-310/312/313/315/320/328/330/342/343/404/415/500）；check-skills D 检查只单向（skill 引用 ⊆ 表），不查代码 ⊆ 表。
- ATR-402 双语义（confirm 拒绝 vs dev token 校验失败，`atelier-dev-plugin.mjs:389`、`snapshot.mjs:136`）。
- ARCHITECTURE §8 CLI 表（:129-144）缺 `mcp/skills/compile/gen/migrate/db/impact/call/export` 等十余个已实现命令；`init --ai` 实为 `--no-ai` 语义相反；api-diff 写两面实为三面；而 check-skills 报错恰以 §8 为权威——权威本身已失真。
- 技能包幻影面：`atelier-testing/SKILL.md` 教 `import { expect } from "atelier/runtime"` + `expect(el).toBeVisible()`（runtime 无此导出）；`atelier lint`/`atelier e2e` 实为 STUB exit 4 却进了 DoD；`playtest.fixed_delta`、`atelier.env` 全仓不存在。
- `templates/app/src/llms.txt:1` 停在 "v0.1-prototype"（框架已 1.1.0）；:40 `<StyleBlock scoped>` 幻影语法；:44-48 「编译器待办」已过期。
- 幻影 config 键 `server.port`：ARCHITECTURE.md:122 文档化 + main-server.ts:91 / ATR-403 fix 三处指路，零代码实现（实际只读 `ATELIER_SERVER_PORT` env）。
- gen-auth 产物注释（`gen-auth.mjs:478-479`）声称「api.ts 不覆盖 auth 端点」——M8 批起已覆盖，每份产物携带过期陈述。

### 4.4 runtime 表现层债

- 无 key `{#each}` 全清重建（template.ts:1489-1511）；最小改法=升级 index-key 走既有 keyed 路径（:1470 重排已具备）。
- `streamValue.push` 每次全量复制数组（O(n²)，primitives.ts:51-53）+ journal 默认保留 500 条 `from/to` 全量数组**引用**（core.ts:299-303）——万级 token 流稳态滞留约 500×n 个引用；框架主打 agent 流式场景，这是旗舰用例的内存放大点。
- `store._checkpoints` 无上限（core.ts:291）；每次 commit O(S) 全量快照永久驻留。
- 无公开 `unmount/dispose` API——SPA 路由切换即泄漏实例与哨兵订阅。
- bridge 信号键用遍历序索引（bridge.ts:31-33）——disposeInstance 删信号后全体索引位移，跨快照 graph/journal 引用错位；derived 从不入 `_signals`（依赖边落 `"sig-?"`）——core.ts:354 的 WeakMap 稳定 id 是现成先例。
- 静默错误族（与「响亮拒绝」哲学直接冲突，AI 代理笔误高发面）：忘写 `.value` 静默渲染信号 JSON（template.ts:348-352）、字面量 `<` 静默吞（:131-135）、未引号 attr 值静默丢（:244-274）、keyed each 重复 key 静默折叠行（:1443-1471）、一元负号/科学计数法不支持且报错文案误导（expr.ts:49-59, 237-268）。

### 4.5 server 其余 P2

- prod 隐身单点依赖构建壳旗：不经壳直跑 `main-server.ts` 上线（文档明示合法）+ 未设 statusToken 时，`GET /__atelier/server-status` 对外吐全端点契约体 + journal 尾部 + db schema（introspect.ts:106-108）。
- 单连接并发事务交叉吸收纯注释约定：handler A 在 `ctx.db.tx()` 内 await 时，并发 handler B 的写被并入 A 事务——A 回滚则 B 的「已成功」写静默消失，连带 journal INSERT 一起回滚（连 warn 降级都不触发）。写捕获槽基础设施已看到每一次写，dev 态检测成本极低。
- createHandler 闭包 ~200 行十段 if-chain（gateAuth/dispatchEndpoint 已提取是真实进展，路由层本身仍平铺）——P1-14 能存活至今正是无路由表可单测的佐证。
- exports.ts:587-591 restful number 投影接受 Infinity（`?n=1e999` → JSON.stringify 静默变 null）。
- 无 Origin/Host 闸、POST 不校验 content-type（endpoints.ts:1399-1406）：跨站 text/plain form 可构造合法 JSON 体打 command 端点；当前缓解完全依赖 gen auth 产物 cookie 的 SameSite=Strict（应用可改属性）。
- 404/405 hints 全量端点名册对外可见（prod 亦然）——DX 取向可理解，prod 姿态建议收敛。
- live.ts:38-47 / introspect.ts:32 与 endpoints.ts:64,66 运行时双向 import 环 ×2（jobs/email/uploads 的「仅 type-import 零环」属实）——建议 checkEndpointOutput/endpointError 等下沉无依赖 errors 模块。
- 桶出口缺类型导出：`RateLimitOptions`、`CommandJournalPersistOptions`、`DEFAULT_MAX_BODY_BYTES` 等未从 index.ts 转出口。

### 4.6 dev/mcp 其余 P2

- `dev-screenshot.mjs:155-168` win32 树杀端口反查存在附带误杀窗口（pickFreePort 探测释放与浏览器 bind 之间竞态 + netstat 匹配依赖英文 LISTENING 格式无兜底）——建议反查 pid 先比对 child.pid 或校验进程名含 msedge/chrome 再杀。
- `dev-server-host.mjs:253-283` forwardRequest 无代理超时、客户端中断不销毁上游（SSE 场景滞留）。
- `atelier-dev-plugin.mjs:150,803` resolved Map 永不清理 + SSE 无心跳/背压处理。
- `http.mjs:23-25` TASK_ELIGIBLE 清单仅 2 项，checkpoint.source_*（601s）/graph.static（60s）/diff.report 同为长 spawn 型未入——HTTP 直连下内联阻塞 Vite 事件循环，与 P1-11 整改动机精神不符。
- `mcp-definitions.json:148` ui.screenshot summary "transient headless browser" 与实际 persistent 复用（P0-6）不符。

### 4.7 生成器/编译器其余 P2

- 字面量转义解码三实现分叉（gen-endpoint `\\(.)→$1` 把 `\n` 解成 `"n"`；gen-db/export-openapi 仅映射 `\n`/`\t`；`\u4e2d` 三处同错）——auth 面 pick 投影与 export-openapi 解析**同一文件**得出不同类型；api.ts 的 enum 联合会排除运行时合法值。
- 端点重名无检测而运行时 register() 硬错 ATR-313——生成器先产出语法破碎的 api.ts（同名重复 type/const）；export-openapi `paths[pathKey]` 静默后者覆盖。
- export-openapi 无端点名字符集闸（:318-323）——gen-endpoint ATR-342 拒绝的坏名字，export openapi 静默导出。
- 数值枚举跨消费面分叉：flatLeafToTs 渲染 `1|2|3` vs project-json ATR-107 硬错「enum 取值必须是字符串」vs contract.ts:13 `enum?: string[]`（db.ts:127 的 as 是撒谎窄化）——api.ts 正常而 export openapi 直接失败。
- dump 产物含 `generatedAt` 时间戳 + 绝对 `root` 且已入 git（`.atr/ast/index.json` 实证）——regen 非幂等、跨机器漂移。
- gen-endpoint `:933` specs 描述与 `:822` mount 未消毒直插 JSDoc——含 `*/` 即破碎产物。
- 四段式错误形态五套不一致（gen-db code 字段形同虚设、CLI 不打印 e.code；gen-auth 无 code 字段；dump/codegen 的 die 无 code）。
- 五份生成器间重复逻辑：matchAngle 逐字节复制 ×2、splitTopLevel ×3、parseStringLiteral ×2 + parseFlatValue ×1、迁移编号扫描追加逻辑 ×2、目录 walk ×4、CLI argOf/getOpt ×5。vendor 闭包红线（sync 名单只收 gen/{impact,gen-endpoint}）是真实约束——共享库需以零依赖单文件进 vendor 名单或构建期内联落地。

### 4.8 CLI/脚本/模板其余 P2

- `cli.mjs:188/:294` struct `--json`、snapshot `--full` flag 被当子命令 usage 退出 2（实跑复现；usage 文案自己还在宣传这两个 flag）。
- `cli.mjs:200/:313` case "review" 重复标签，stub 块的是死代码，且 STUB_NOTES 无 review 键（删真实现会 for...of undefined）。
- `sync-project.mjs:45` `--target` 缺值 → `path.resolve(undefined)` 崩栈非 usage 退出。
- `api-diff.mjs:324-329` judge() 从 `summary.ok===false && breaking===0` 反推 strict——非 strict 但 --budget 超限时 added 条目被误标 `added(strict)`。
- `struct.mjs:232` checkpoints.jsonl 坏行 → JSON.parse 未捕获 SyntaxError 整体崩栈。
- `check-skills.mjs:43-54` CLI_VERBS 缺 `gen/db/export/api-diff`、FLAGS 含已不存在的 `--ai/--static/--electron`；RUNTIME_API 含 runtime 不导出的 expect/verify。
- `checkpoint.mjs:186-205` sourceFingerprint 与 snapshot.mjs:93-112 逐行同构（checkpoint.mjs:41 已 import snapshot.mjs，顺手 import 即可消灭）。
- 模板 manifest.json 组件 schema 与组件文件双份手写无机检对账；main.ts:72-74 devFetch then 链无 catch。

## 5. 评审队列勘误（BACKLOG:105-116 记载项的现状态）

本次评审核实，以下队列记载已过时（抄送 BACKLOG 时应订正）：

- ~~server-status 路由级门禁未做~~ → **已不成立**：statusToken 可选门禁已落地（endpoints.ts:1053,1254 → introspect.ts:337-354，tokenEq 恒时，prod 隐身优先）。残留缺口见 §4.5（可选缺省 + 构建壳单点旗）。
- ~~live×鉴权=注册期拒绝沿 live!=null 口径~~ → **live!=null 口径已修**：isLiveDeclared 谓词收口四处判定点（endpoints.ts:148-150，注册拦截 :864）。「共享重算无 per-subscriber 鉴权」仍是成文设计边界。
- ~~journalPush 脱敏~~ → 已修且为唯一写入口（POST 与 live ATR-321 条目同源受保护）。
- 仍在队列且本次复核确认仍在：dom-shim 二期、scripts/lib 抽取（die 款）、生成器字面量解析统一、巨型函数拆分（callTool/createHandler/probeChecks/dev 中间件）、MCP 契约面四件、checkpoint --allow 断链、CLI flag-当-子命令、init 目录守卫、dev-server-host 握手超时、SSE 心跳+resolved Map、性能尾巴三项。

### 5.5 核验通过项（正面确认，免后续重复排查）

server 侧：鉴权 fail-closed 全分支、scrypt/恒时比较、journal 脱敏单源、全 SQL ？绑定、DDL 标识符白名单、双 413 闸、穿越守卫、busy_timeout/foreign_keys、UPDATE..RETURNING 探测+两步兜底、SSE 背压按帧计数、journal 落库失败 warn 降级、enqueue 经同连接 tx 原子、上传 rename 原子+INSERT 失败删孤儿（除 ensureTable 先于 writeFileAtomic 的低概率洞：uploads.ts:528-547）、live.ts 心跳空闲即停/keys Map/退订路径全覆盖——**server 侧无定时器/Map 泄漏**。runtime 侧：bindProp captureCleanup ✅、布尔属性 25 项 ✅、ATR-328 ✅。cli 侧：die 大一统 ✅（字节级钉死）、mcp-vendor 名单三处逐字节一致 ✅、docs-numbers 标记位吻合 ✅、api-surface.json 经 .gitignore 负规则正确入库 ✅。

## 6. 下一步发展计划

结合 ROADMAP 现状（阶段 1-3.5 已收口、1.1.0 release-ready、D-3 发布时点待外部窗口），建议在阶段四启动前插入三个收口批。全部沿用既有纪律：BACKLOG 唯一源、主/子智能体 worktree 分支协作、红检先红后绿、全套门禁收口（tests/check-skills/api-diff/docs-numbers）。

### 批次 R1 —— 安全与正确性收口（最高优先级，估 1-1.5 周，四分支并行）

| 支 | 范围 | 覆盖 P1 |
|---|---|---|
| A（server 安全） | 下载鉴权声明位（gateAuth 复用）+ nosniff + 危险 mime attachment + id 不可枚举化或成文决策；mount 前缀边界 + `/apifoo` 负例；restful Infinity 拒绝 | #1/2/14 + §4.5 |
| B（runtime/codegen 同源） | `rt.bindAttr` 单点化 + 双路径 parity；双 `<style>` 统一 + parity 用例；mount 失败回收 + 实例级 cleanup + 公开 unmount()；recordRuntimeError globalThis | #5/6/9/15 |
| C（生成器名字闸与掩码） | 端点扫描器 codeMask（两份）+ 红绿测试；gen-db RESERVED_WORDS；端点重名 die 镜像 ATR-313；转义解码统一 + JSON.parse 对拍 fixture；desc/mount 注入消毒 | #4/13 + §4.7 |
| D（dev 面与 CLI 写路径） | 反代 Origin 闸；actualPort 单源化 7 处；中间件错误围栏；握手超时杀子进程；init 目录守卫 + 参数缺值 die；api-diff 退出码区分 + checkpoint 拒锚 | #3/7/8/10/11/12 |

### 批次 R2 —— 契约面单源化机检（估 3-5 天）

一个新脚本族把「三处/四面同步」从注释变成机检，CI 挂门禁：

1. 错误码反向对账：正则扫 runtime/server/dev/mcp/gen 实抛 ATR-\d{3} ⊆ 错误码总表（补齐缺口 12+ 码，ATR-402 双语义拆分）。
2. CLI_VERBS/FLAGS 从 cli.mjs dispatch + HELP 派生（复用 api-diff 的 extractCliCommands）；ARCHITECTURE §8 表再生。
3. RUNTIME_API 从 runtime/index.ts export 声明生成，测试钉住。
4. 顺手：技能包幻影 API/幻影命令/幻影 config 键（server.port）清理，llms.txt 版本标签刷新。

这一批是「可验证性基建」主张的自我兑现——仓库最大的资产是纪律，最大的风险是纪律靠自觉。

### 批次 R3 —— 结构债（估 1 周，可与 R2 并行）

- createHandler 路由表化（`Array<{match,handle}>` 或函数管线，路由匹配与闸门执行分层，首次可单测）。
- callTool 分发 Map + per-tool 超时/参数白名单元数据（MCP 契约面四件顺带根治）；dev 中间件路由表化（review-data 先例已证明可行）。
- `gen/lib + scripts/lib` 共享库（matchAngle/parseStringLiteral/sourceFingerprint 单点化；注意 vendor 闭包红线：零依赖单文件进 sync 名单或构建期内联）。
- confirm 未知档位 fail-closed + requestState nonce 台账（auditApproval 现成单实例）+ 审批密钥与 dev-token 分离。
- 巨型函数拆分其余项（probeChecks 八层各一函数）。

### 主线衔接（R1-R3 之后）

- **阶段四发布**：npm 发布日动作按 D-3 口径等用户拍板（本计划不代拍）；R1 完成是 D-3 的硬前置。
- **生死判据 2（主流框架 agent 面复扫）**：建议时点 2026-12 前后，与 R 批无冲突可并行准备。
- F-2 全量 tree-shake 维持后置候选（决策 27 诚实边界）。
- 挂起区 P3-2/P3-3 实验维持按需触发不预投（2026-09-22 终局处置口径不变）。

### 决策点（需用户拍板，本报告不代决）

| # | 决策 | 建议 |
|---|---|---|
| R-D1 | R1 批是否立项、何时开工 | 建议立即立项（P1 #1-3 是 CVE 级） |
| R-D2 | 资产下载面鉴权缺省 | 建议 fail-closed 跟随上传面 + sha 前缀 id；若想保持「资产公开」需成文 design-decision |
| R-D3 | R2 机检门禁是否上 CI 默认门 | 建议上（一次性消灭漂移复发面） |
| R-D4 | P2 静默错误族（§4.4 末段）是否升 R1 | 可缓——但它是「响亮拒绝」哲学的兑现缺口，建议入 R1-C 支顺手做两件（忘 .value 检测 + 重复 key 警示） |

## 7. 诚实边界（本评审的方法限制）

- 五路评审为模型精读非形式化验证；P1 均经实读/实跑坐实（CLI 面实跑复现、转义分叉 node 实测、uploads/mount/扫描器统筹者二次抽查），P2/P3 个别项可能存在误报，立项时逐件红检即可过滤。
- 行号基于 2026-09-30 main（HEAD 911b5b7），后续批次合并后需复核。
- 基准链路性能、benchmarks/m3 评分器细节未深审（前者已有四指标门禁，后者冻结出数）。
- 本报告不构成对既有决策（0-34）的推翻；与 ROADMAP 冲突时以 design-decisions 为准。
