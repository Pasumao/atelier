# Atelier 第三遍全仓架构复校（2026-09-30 · R 批合并后 · npm 1.1.0 发布前终校）

> 时点：main = `73054e6`（R 收口批终态），工作树净。
> 方法：统筹者实证门禁 + 6 路只读评审代理分区深扫（runtime / server / gen+compiler / dev+mcp / scripts+cli / 模板+文档）。
> 证据纪律：P1 前 4 项与门禁结果由统筹者亲核代码坐实；其余为评审代理实读证据（file:line 已附，**制作时以实读为准**——本仓先例：首遍评审报告曾有三处勘误）。
> 定位：本报告 = **P 批（发布前硬化批）任务书唯一源**（对位首遍评审之于 R 批）。

---

## 0. 门禁实证（本次实跑，非引用）

| 门禁 | 结果 |
|---|---|
| check-skills | 56-0 ✅ |
| contract-checks | 7-0 ✅ |
| api-diff check | PASS，churn 0.00% ✅ |
| docs-numbers check | PASS（tests=1037 tools=40）✅ |
| **全量 vitest** | **1036 绿 + 1 红 + 8 skip** ⚠️ |

红的唯一一例：`tests/dev-screenshot-close.test.ts:159` 报 4 个残留无头浏览器进程——**单独复跑 2/2 通过**，判定为时序型抖动（残留进程计数竞态），非确定性回归。列观察项：P 批收口时全量跑两轮确认；若复现则加宽收尾等待或复跑策略。

**净结论：R 批收口真实落地（路由表/Map 化/机检/confirm 三件等逐点复核均在），但坐实 5 项新 P1 + ~15 项 P2，其中三件直接动摇 R 批自己的修复声明（见 §1 P1-2、§2 MCP 域、§3 留队复核）。当前不可按发布按钮。**

---

## 1. 新发现 P1（发布前必修；前四项统筹者亲核）

### P1-1 derived 计算抛错后与上游永久脱订——响应式死锁

- 证据：`atelier/runtime/core.ts:156-178`（compute 求值前清空 upSubs :158-159）× `core.ts:96-105`（withTrack 在 fn 抛错时 deps 随异常丢弃，catch 只 `dirty=true; throw`）。
- 影响：失败一次后 derived 不再订阅任何上游；下游 effect 只订阅 derived 本身 → 上游恢复后无人通知 → **UI 永久停在错误卡上**，直到无关路径碰巧重读该 derived。这是已修「缓存毒化」更深一层的同族洞（缓存修复管了「重读得到新值」，没管「通知链复活」——`tests/core.test.ts:53-68` 恰只钉前者）。
- 修法：withTrack 失败时也交出部分 deps（可变 holder 或内部 catch），compute 的 catch 按成功路径同款把**部分依赖**挂回 upSubs（超订阅无害），dirty 保持 true。
- 红检：上游信号翻转后断言下游 effect 被通知（当前必红）。

### P1-2 双 `<style scoped>` 块只有最后一块生效——R 批 P1 #6 修复声明与实效不符

- 证据：`atelier/runtime/template.ts:1076-1113`（每块新铸 `atr-scope-${scopeSeq++}` 且 `scopeClasses.set(componentName, scopeClass)` :1112 同名覆盖）× root 挂载处只取 map 最后值（~:1196-1198）。
- 影响：前序块的 CSS 全部注入 head 但选择器永远不命中 root——「块块注入、除最后一块全是死选择器」。R 批修的是**注入面**（extractStyleBlocks 全注入 ✅），**应用面** last-wins 仍在；`tests/codegen.test.ts:853-886` 只数 `<style>` 元素个数，从未断言选择器可命中。
- 修法：同组件名复用首个 scope class（作用域以组件为单位），或 scopeClasses 改存 `string[]` 全量挂 root。
- 红检：双块各含一个可命中 root 的选择器（如 `.root-marker`），断言两条规则都生效（当前必红）。

### P1-3 字面量 `<` 被解析器静默丢弃——内容损坏

- 证据：`atelier/runtime/template.ts:131-135`（tagMatch 不命中 → `this.pos++; continue;`，`<` 既不成节点也不进文本）。
- 影响：`a < b` 渲染成 `a  b`、`x <= y` 渲染成 `x = y`；解释器/编译器共用此解析器双路径同坏。字面量 `{` 恰因「不再静默丢弃」被专门修过并有测试钉住（template.ts:184 注释、codegen.test.ts:401），`<` 是同一哲学的漏网面。
- 修法：tagMatch 失败时把 `<` 按字面文本并入（对齐 HTML「< 后非标签名即文本」语义）；如判拒绝更稳则 ATR-101 四段式显式拒绝，**不许静默**。
- 红检：`a < b` / `x <= y` 文本保真双路（解释器+codegen golden parity）。

### P1-4 `build --out` 无根目录关系守卫——`--emptyOutDir` 可清空应用源码

- 证据：`atelier/scripts/build.mjs:69`（outDir 解析无任何关系校验）+ `:105`（viteArgs 显式 `--emptyOutDir`）。
- 影响：`--out .` → outDir==root → vite 清空应用目录（emptyDir 只保留 .git）；`--out ..` / `--out src` 同类。未提交的应用源码直接被删。`db backup`（backup.mjs:71-73 同径「连 --force 也拒」）有完整守卫先例。
- 修法：spawn vite 前校验 outDir 严格位于 root 内、≠root、且不含 package.json/src——违者 die 2。
- 红检：`--out .` / `--out src` 双负例 die；正常 `--out dist` 不受扰。

### P1-5 dump.mjs stage② 扫描器完全无视注释/字符串——幻影模板 + 吞真模板 + 幻影组件

- 证据：`atelier/compiler/dump.mjs:69-107`（extractHtmlLiterals 裸 `indexOf("html\`")`，仅查前导 `\w$`）、`:112-119`（ownerOf 用 regex 命中不查 codeMask）、`:152`。
- 影响：注释掉的 `html\`…\`` 产幻影模板（含未闭合块时整场 dump hard die）；注释里单个反引号会把**下一个真模板**整体吞掉（`.atr/ast` 落幻影、丢真）；注释掉的 `export const X = component(` 产幻影组件 JSON 进 codegen。运行时靠 compiledByRaw raw 精确命中兜底回解释器，所以是「产物错+快路径静默丢失+可 hard-fail」而非渲染错——**这正是 R 批在 gen-endpoint 修掉的 codeMask 类缺陷在 compiler 侧的存活，教训没有回流**。
- 修法：把 `extract-schema.mjs:44 codeMaskOf`（同款单遍状态机）导入 dump 面——extractHtmlLiterals 命中位查 mask、ownerOf 对 decls 逐位查 mask（mask 误命中 → warn 跳过，同 extract-schema.mjs:306-312 先例）。
- 红检：注释模板不产幻影 / 注释单反引号不吞真模板 / 注释组件不产幻影 owner 三例。

---

## 2. 新发现 P2（发布前应修；按域分组）

### 2.1 server 三件

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P2-S1 | 契约端点接受 JSON 标量/null 体 → validateFlat 内 `k in data` 抛 TypeError → **未鉴权即可远程触发 500**（应为 400 族；同文件无契约分支反而有 ATR-312 形状闸，两分支口径分叉） | `endpoints.ts:1557-1559` × `runtime/contract.ts:47` | `input != null && (typeof !== "object" \|\| Array.isArray)` 的 ATR-312 拒绝提升到 contract 分支之前；补红检 |
| P2-S2 | jobs `handlers[row.type]` 原型链查找：`type:"constructor"`/`"toString"` 等取到可调用对象 → 任务**假成功**落 done、零执行零报错——违背同文件「绝不静默吞行」承诺（jobs.ts:35） | `jobs.ts:326`（普通对象）`:417`（查找）`:231-239`（type 闸只查长度/控制字符） | `Object.hasOwn(handlers, row.type)` 判未注册；补 "constructor" 红检 |
| P2-S3 | 鉴权资产下载发 `Cache-Control: public, max-age=31536000, immutable`——与自家「public×auth fail-closed」原则矛盾（endpoints.ts:475-478/550-557 对端点面同组合 ATR-313 硬拒）；共享缓存旁路授权 | `uploads.ts:626` | 按下载面合取鉴权结果派生：全 none 才 public immutable，否则 `private, max-age=…, immutable`（内容寻址语义保留） |

### 2.2 MCP 五件（「单源声明≠单源事实」重灾区）

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P2-M1 | ATR-402→405 拆分**漏改两处**：认证失败在 MCP 面仍报 402，与 confirm 拒绝同码双语义（R3 统筹件宣称收口） | `mcp/server.mjs:156`、`:427` | 两处改 ATR-405，文案对齐 endpoint-tools.mjs:63；测试钉「dev-token 失败恒 405」 |
| P2-M2 | `ATELIER_TOOLSETS` 只过滤 tools/list 广告不过滤执行——注释自称「权限面收敛」意图失效，客户端凭名直呼被隐藏工具照常执行 | `server.mjs:96-103`（过滤）× `:744-806`/`:456-734`（无检查） | callTool 入口校验 name ∈ TOOLS 否则 ATR-404；或降级 env 语义并去掉「权限面」字样 |
| P2-M3 | `endpoint.impact` 广告参数 `root` 被静默丢弃——正是 R 批宣称清零的幻影参数类；server.mjs:285 注释称「FS6 消费面元数据在 endpoint-tools.mjs 单源」——**该元数据不存在**；机检只单向（TOOL_META.args ⊆ 广告），FS6 全族不入 TOOL_META | `mcp-definitions.json:491-495` × `endpoint-tools.mjs:298` | `endpointImpact(args?.root ?? projectRoot, …)` 或删广告参数；补 FS6 消费面元数据并扩机检为双向 |
| P2-M4 | HTTP 通道 `tasks/update` 携 `_meta` 即被拒（ATR-401）——http.mjs 头注释与测试明示 `_meta` 是标准体形；tasks/get、cancel 容忍多余键唯独 update 拒 | `http.mjs:137` × `tasks.mjs:114-117`（对照 `http.mjs:17`） | http.mjs tasks/* 分支构造 params 时剥 `_meta`（对齐 tools/call 只取 `{name, arguments}`） |
| P2-M5 | `ui.screenshot` TOOL_META timeoutMs=4s 与同端点 snapshot.diff 60s 预算自相矛盾：冷路径（看门狗杀常驻浏览器后首拍）必超时，且 catch 把 TimeoutError 文案化成「dev surface unreachable」指错方向 | `server.mjs:316`（对照 `:306,:342`）× `dev-screenshot.mjs:186-256` × `server.mjs:420-425` | timeoutMs 提至 30-60s；fetch 超时单列文案区分「超时」与「不可达」 |

### 2.3 scripts/CLI 六件

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P2-C1 | `atelier review --target` 缺值 → 崩栈（实测复现）；init 分支有完整守卫先例（cli.mjs:148-153） | `cli.mjs:213` | 套 init 同款「缺值/flag 当值」守卫 die 2 |
| P2-C2 | `atelier struct --json` 被当子命令 → usage 误红 exit 2（实测复现）；HELP:45 明示 map 可省略 | `cli.mjs:196` × `struct.mjs:792-794` | `sub && !sub.startsWith("--")` 才前置，否则透传原始 argv |
| P2-C3 | 模板 .gitignore（+init 兜底同文）只忽略平铺 `current.png`，仓根只忽略 `**/current.png`——**双处都不匹配 per-platform/current-full.png**：瞬态捕获进 git 锚点提交，污染树净纪律 | `templates/app/.gitignore:6` × `init-project.mjs:171` × 根 `.gitignore:27` | 两处改 `.atr/snapshots/**/current*.png`，模板与仓根同步 |
| P2-C4 | checkpoint.mjs readStore 坏行崩栈（与已知 struct.mjs:249 同族新实例）——台账是 gitignore 本地态 append 型 jsonl，中途 kill 可留半行；损坏后 save/list/rollback 全裸 TypeError | `checkpoint.mjs:85` | 逐行 try/catch，坏行 die 1 指明行号（与 struct 已知②一并收口） |
| P2-C5 | tokens-dtcg `--out` 无同径守卫 → `--in atelier.config.json --out atelier.config.json` 一次性覆灭手工 token SSOT（「审阅后合并」提示打印在覆盖之后） | `tokens-dtcg.mjs:75-79` | samePath(in,out) 拒绝；out==atelier.config.json 额外告警（backup.mjs 先例） |
| P2-C6 | api-diff `--allow` 文件缺失/坏档静默按空表（typo 路径零提示，文案还说「未在 allowlist 中豁免」） | `api-diff.mjs:405`（`readJson(...)?.accepted ?? []`） | `--allow` 给定但读失败/非对象/无 accepted → die 2（与基线损坏 exit 3 同一诚实纪律） |

### 2.4 模板/文档两件

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P2-D1 | `.atelier/approval-secret`（R 批新增的审批 HMAC 密钥）不在模板 .gitignore——新用户会把密钥提交进库 | `templates/app/.gitignore:3-5` × `mcp/confirm.mjs:94-100` × `init-project.mjs:141` | 模板与 init 兜底名单补该文件（或整体 `.atelier/*` + 白名单，与根仓同构） |
| P2-D2 | **「未 push 远端/真实 CI 未首跑」已成事实性错误（三处连坐）**：origin = github.com/Pasumao/atelier 存在，远端 main = 88c167b（2026-09-06），本地领先 **309 commits**；`gh run list` 显示 ci 工作流 2026-09-06 真实跑过多轮。**R 批与 1.1.0 门禁从未在远端跑过** | `README.md:123` × `docs/RELEASE-CHECKLIST.md:35-36` × `.github/workflows/ci.yml:71` | 三处改真实口径：「远端滞后 309 commits（末次 2026-09-06）；R 批门禁未在远端验证，push 后首跑再摘 continue-on-error」 |

### 2.5 runtime 其余五件

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P2-R1 | bind:value × `<select>` 初始选中丢失（真浏览器）：bindTwoWay 在 attrs 循环内被调，$effect 首跑同步执行时 option 子节点尚未 append——bindGroup 对同类问题已修（微任务定版），bindTwoWay 漏套；dom-shim 无 option 语义掩盖 | `template.ts:1500-1523`（对照 :877-909） | 下行 effect 仿 bindGroup 延至微任务（或 children append 后补一次同步） |
| P2-R2 | `$effect` 首跑抛错逃逸于 dispose 登记之前——错误路径僵尸 effect（mount 失败回收看不到它、store.graph 出幻影节点） | `core.ts:236→242`、`:270-271→277` × `template.ts:1213-1220` | sink 登记移到 `sub.run()` 之前 |
| P2-R3 | bindExpr 错误哨兵流入属性：prod 错误时 `setAttribute(name,"")` → 25 项布尔属性**存在即真**（disabled/checked…）；dev 把错误文案写成属性值 | `template.ts:421` × `:952-971` | bindExpr 支持独立 onError（bindAttr 传 `() => el.removeAttribute(name)`） |
| P2-R4 | `html\`\`` 静默吞 `${}` 插值（签名只收 TemplateStringsArray，raw join 后插值无声消失）——与全仓「不静默」红线冲突 | `template.ts:53-63` | 加 rest 参数，`values.length > 0` 即抛四段式指路 `{expr}`/`.locals()` |
| P2-R5 | keyed `{#each}` 框架侧 index 永久陈旧（key 命中复用 DOM，幸存行 `{idx}` 显示建行时旧序号）；表达式无一元负号（`{-n}` 报 ATR-301 且 fix 不指路）且 `not` 关键字假支持（and/or 落地、not 报错） | `template.ts:1586,1602`；`expr.ts:237-268`、KEYWORDS `:12` | 行内注入隐藏 index 信号随 i 写入（或 dev 期检测 keyed+index 引用警示）；primary 补 unary `-`/`+`，`not` 映射 `!` 或摘除并给专用 fix |

### 2.6 gen/compiler 四件

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P2-G1 | gen-db 保留字闸只挡 JS 词表，**SQLite 关键字大面积放行**（表名 `order`/`group`/`values`/`limit`… 产物 SQL 语法错误，migrate 时才炸）；列名连词表闸都没有 | `gen-db.mjs:341-356` × `server/db.ts:56-66`（assertIdent 只查字符集） | db.ts assertIdent（构造期单一真相源）加 SQLite 关键字表闸（表/列/索引名）；补 `order` 表名列名红绿 |
| P2-G2 | 派生标识符跨端点撞名无闸：`chat.ask`/`chat-ask`/`chat_ask` 派生同 `ChatAsk` → api.ts 声明两次编译不过（恰是重名闸 die 文案要防的终态；gen-db 有同型闸先例 :590-597） | `gen-endpoint.mjs:922-934`、`:876-897` | generateApi 产产物前对 camelOf/pascalOf 建 seen-set，撞名 ATR-313 四段式 die 列两个源名 |
| P2-G3 | export-openapi resolveLocalPickSchemas 表名解码仍是修复前 `\\(.)→$1` 旧语义——与「转义解码统一 decodeEscapesCore」宣告直接矛盾（parity 测试不含这条路径） | `export-openapi.mjs:386`（对照 gen-endpoint.mjs:488-489；文件已 import decodeEscapesCore `:55`） | 改 decodeEscapesCore + ok 检查；该链加进 parity 测试 |
| P2-G4 | 字面量解析器 plain-object 原型键族：`__proto__` 列名静默吞列（schema 与产物分叉零报错）、props 注解 `__proto__` 静默从 schema 消失、`in` 检查被继承键误伤（`toString` 等误报 ATR-107 / 误判重复声明） | `gen-db.mjs:249,294` × `extract-schema.mjs:344-345` × `project-json.mjs:232` × `export-openapi.mjs:196` | 解析产物统一 `Object.create(null)` 或 `__proto__` 显式 die；两处 `in` 改 `Object.hasOwn` |

---

## 3. 已知留队项复核（关键修正 + 状态表）

**两处关键修正**（留队原文与实况不符）：

1. **「SSE 心跳/背压」server 侧其实已修**：`server/live.ts:66`（ping 帧）、`:111-118`（heartbeatMs 15s / backpressureLimit 32 缺省）、`:397-427`（背压断流 + 心跳 idle 停 + unref）。留队原文实际指向 **dev 面代理 SSE**（`atelier-dev-plugin.mjs:823-835` 无心跳、`:851-853` 写入不看返回值）——仍未做，但归属面要改。
2. **gen-db 内联 decodeEscapesCore 的「vendor 闭包红线」理由已失效**：gen-db 不在 vendor 名单（sync-project.mjs:93-98 仅 gen/{impact,gen-endpoint} + compiler/{project-json,extract-schema}），且 gen-db 已 `import { RESERVED_WORDS } from "./gen-endpoint.mjs"`（gen-db.mjs:42）——共享库抽取（字面量解析族三份：gen-db:181 / export-openapi:111 / gen-endpoint:362）可以直接做。

| 留队项 | 状态 | 当前证据 |
|---|---|---|
| 无 key {#each} 全清重建未增量化 | 仍开 | template.ts:1629-1651 |
| streamValue push O(n²) | 仍开 | primitives.ts:51-53 |
| store._checkpoints 无上限 | 仍开 | core.ts:298,312-321（被 HMR 快照重锚放大 template.ts:1369） |
| bridge sig-N 索引键不稳定 | 仍开 | bridge.ts:31-33,49-64（dispose 后下标漂移→`sig-?`） |
| 桶出口类型面不全 | 仍开 | index.ts:4-22（缺 Subscription/FlatField/FlatOf/FlatLeaf 等；bindAttr 进桶而 bindEvent/extractStyleBlocks 不进） |
| import 环 ×2 | **实测只剩 1 对** | template.ts:21 ↔ component.ts:7（import type 编译期擦除，已有分层注释） |
| `__ATELIER_TOKEN__` 注释陈旧 | 仍开（比登记更陈旧：dev 侧已移除注入，四读点成死代码） | index.ts:24-29,31 / bridge.ts:88,135,148,149 / dev 插件 :255-258 |
| dev-screenshot 树杀误杀窗 | 仍开 | dev-screenshot.mjs:155-168（端口复用时误杀新占用者） |
| registry/docs 读盘缺 try/catch | **已修**（P1-12 错误围栏间接兜底 :879-896） | dev-plugin :575-578,597-600 |
| prod 隐身单点旗 | 仍开（部分改善：路由级隐身已单点化为「handle 回 null 唯一来源」） | endpoints.ts:356 / introspect.ts:106 / node-host.ts:152（foldProdMessage 两份） |
| server 侧 Origin/content-type 闸 | 仍开 | endpoints.ts:1546-1562（POST 分支全程无 content-type 判定） |
| 404/405 名册无 prod 门 | 仍开（另发现 uploads 面未装配 404 先于 405，可探测装配态 :1406-1414） | endpoints.ts:1515,1512,1365,1421 |
| gen 四文件 `(msg,fix)` 款 die | 仍开 | gen-auth:51 / gen-db:59 / codegen:46-49 / dump:49-52 |
| cli review 重复 case + STUB_NOTES 缺键 | 仍开（:322 死代码；若真实现被删则 stub 分支 TypeError） | cli.mjs:208,322,109-113 |
| struct.mjs jsonl 坏行崩 | 仍开 | struct.mjs:249 |
| sync-project 缺值崩栈 | 仍开（实测复现） | sync-project.mjs:45 |
| api-diff judge strict 反推 | 仍开（双向实证：仅 --budget 超限时 added 误标违规；--strict+removed 时 added 漏标且不走豁免环） | api-diff.mjs:325 |
| checkpoint `--allow` 断链 | 仍开且**加重**：门内 spawn 不带 --allow（:256），save 侧 `--allow` 被 :382 过滤式**静默吞掉**——用户以为豁免了、门照红 | checkpoint.mjs:256,277,382 × api-diff.mjs:405（无默认 allowlist 路径） |
| dump/codegen 字节幂等 | 部分开：内容幂等已修，但 readdirSync 未排序破**跨机**幂等 | dump.mjs:57 / codegen.mjs:454 |
| 模板 main.ts devFetch 无 catch | 仍开 | templates/app/src/main.ts:72-74 |
| stream-intro 营销文案腐烂 | 仍开（且未入 BACKLOG 队列——比留队更弱：无追踪） | dev-plugin :601-621 |

---

## 4. P3 清单（随批可带，不阻塞发布）

**runtime**：tokenState.ready 死旗标（template.ts:41）· 缓存上限策略分裂 500 全清 vs FIFO（template.ts:342 vs expr.ts:381-385）· {#each} 源非数组裸 TypeError（template.ts:1583,1632）· 事件 handler 非函数静默 no-op（:1048-1049）· graph 的 derived 节点不可见（core.ts:347-364 × bridge.ts:36-46）· HMR 旧 `<style>` 永不摘除 + atr-scope 名直拼组件名（:1076-1113,1197）· validateUnknown 与 standard-schema 数组口径不一（contract.ts:164-176 vs standard-schema.ts:50-52）· unmount 多实例只回收首个（:1303-1312）· initTokens 无环境守卫（:42-45）· expr.ts:55 文案笔误「多中小数点」。
**server**：GET/HEAD 带体 → Request 构造 TypeError 500（node-host.ts:159-170,183-231）· static-host NUL 路径 500 非 404（static-host.ts:82-91，与 R1 mime NUL 同族）· uploads「纯读不建表」注释 vs handleDownload ensureTable（uploads.ts:416-418 vs 589-596）· 多实例 UNIQUE 冲突 unlink 删胜者文件（:562-577）· jobs tick 异常死循环刷屏（jobs.ts:466-493）。
**gen/compiler**：codegen CLI 对 CodegenError 无壳崩栈（codegen.mjs:121-122,460-503）· gen-db 数值形态窄于兄弟（:210 vs gen-endpoint:374）· splitTopLevel 不剥注释（gen-db:121-145 / export-openapi:82-106）· apikey securitySchemes 单名假设（export-openapi:583-587）。
**dev/mcp**：readBody 无 error 监听（dev-plugin:179-185）· 路由表 method 盲判（GET 打 POST 路由；GET bridge/state 覆写 state.snapshot 缓存 :813-822）· lines NaN 旁路返回全文件（:590；server.mjs:462,464）· screenshotInflight 无视捕获参数（:656-670）· MiniCdp.events 常驻会话无界累积（dev-screenshot:79-90,214-220）· probe-mount win32 孤儿浏览器（probe-mount.mjs:100-103）· stdio initialize 无条件回显客户端版本（server.mjs:856-861）· snapshot.diff 广告摘要仍写平铺路径（mcp-definitions.json:370）· test.run win32 `%`/`^` 未入黑名单（server.mjs:605,612）。
**scripts/cli**：退出码语义漂移（同类错误三种码：sync:47-50 exit1 / build:82 exit2 / tokens exit1）· HELP↔dispatch 实装旗标无反向对账（checkpoint --db/--json 实装 HELP:59 未列）· review 探活失败复用 STUB 码 4（cli.mjs:230）· bench --port NaN 60s 误导等待 + POSIX killTree 只杀 shell 包装（bench.mjs:47,148-151）· build win32 命令串只引含空格路径（:107-109）· snapshot cwd vs checkpoint 向上发现的根口径分裂（snapshot.mjs:118-121 vs checkpoint.mjs:366-375）· checkpoint 吞未知旗标（:382）。
**模板/文档**：Node 地板口径 22 vs 实际 22.12（README.md:8,58 × vite engines × sqlite.ts:63 × dev-server-host.mjs:98-102；建议加 engines）· atelier-ui.css:2 引用不存在的 atelier-theme.css 旧名 · docs/README.md 导航滞后两档（:8,10,12 仍 1.0/0-28，实际 1.1.0/0-35）· CHANGELOG:9 [Unreleased] 状态行仍写「R 收口批进行中」· init 收尾提示教不存在的 `atelier` bin 形态（init-project.mjs:197）· main-server.ts:91 fix 措辞「改 server.port」→ 应为「新增」。

---

## 5. 架构师总评

**强项（不变）**：语义单点纪律（`__compiledRT` 使「编译路径 ≡ 解释器路径」可机检）、错误四段式、闸门链复用（限流→鉴权→体限→契约→handler→输出→journal）、机检文化（键集=广告面/契约三查/派生白名单）。R 批的路由表化与 Map 化确实把「改一漏九」压进了测试可拦的形态。

**三大结构性弱点**：

1. **template.ts 1755 行神模块 + 身份系统靠插入序**。解析器+绑定器+HMR+生命周期+编译注册表同宿，每个新特性往里加单点；bridge 的 sig-N、HMR 未命名信号创建序、scopeClasses 同名覆盖全是同一病根的发作（P1-2 与留队④）。下一次拆分成本只升不降。
2. **错误路径是处置纪律的唯一系统性缺口**。P1-1（compute 抛错）、P2-R2（effect 首跑抛错）、P2-R3（bindExpr 写入错误）全落在「失败发生时」这一族——主路径「宁拒不漏」的哲学没有等比例延伸到错误路径自身。
3. **「单源声明 ≠ 单源事实」**。TOOL_META 注释指向不存在的 endpoint-tools 元数据、ATR-405 拆分漏两处、ui.screenshot 4s 与同端点 60s 自相矛盾、stream-intro 文案腐烂——注释先于事实。配套病：**闸修一半形态而非不变式**（保留字闸挡 JS 不挡 SQLite、重名闸挡精确相等不挡派生）——「产物必可编译/SQL 必合法」应成为生成后自检断言而非散点前置闸。

---

## 6. 下一步发展计划

### 第 1 步 · P 批（发布前硬化，估 1.5-2 天，四支可并行 worktree）

| 支 | 范围 | 内容 |
|---|---|---|
| P-A runtime 正确性 | §1 P1-1/2/3 + §2.5 P2-R1~R5 | derived 脱订 / scoped style last-wins / 字面量 `<` / select 初选 / effect 登记序 / bindExpr 哨兵 / html`` 插值 / each index / 一元负号+not。全部先红后绿，golden parity 双路 |
| P-B server/MCP 收口 | §2.1 + §2.2 | validateFlat 400 闸 / jobs hasOwn / uploads 缓存档位 / ATR-405 两处 / TOOLSETS 执行闸 / endpoint.impact root / tasks _meta / ui.screenshot 超时。MCP 契约机检扩双向 |
| P-C CLI/工具链卫生 | §1 P1-4/P1-5 + §2.3 + §2.6 | build --out 守卫 / dump codeMask / review·struct·sync 崩栈三件 / checkpoint+struct jsonl / api-diff strict+allow / tokens-dtcg 同径 / .gitignore 两处 / SQLite 词表闸 / 派生撞名 / 解码旧语义 / __proto__ 族 |
| P-D 文档诚实面 | §2.4 + §4 文档项 | 三处「未 push」改口径 / approval-secret 入 ignore / stream-intro 下线 / Node ≥22.12 / CHANGELOG 状态行 / docs 导航刷新 |

门禁：全套（测试/check-skills/contract-checks/api-diff/docs-numbers）+ 全量跑两轮盯 dev-screenshot-close 抖动。red-test 先红后绿纪律照旧。

### 第 2 步 · 发布工程批（D-3；需用户拍板的只有时点与包名）

1. push 309 commits 到 origin → **远端首跑当前门禁**（R 批代码从未在 CI 跑过）→ 摘 snapshot continue-on-error；
2. linux/darwin 快照基线武装（CI 矩阵补齐）；
3. 拍板 `private:true` 摘除 + npm 裸名实测（决策 14 注意项）；
4. P 批条目并入 `[Unreleased]` 一起切 **1.1.0** 发布（该版本从未对外发布，无需另起版本号；release-form 三钉联动）；
5. RELEASE-CHECKLIST ② 段 9 项逐项执行留痕。

### 第 3 步 · 发布后 90 天观测期

- 生死判据 3（npm 后 90 天第三方真实应用数 > 0）计时；
- 生死判据 2 复扫（2026-12 前后：主流框架是否内建「契约+回滚+机检」等价物且带生态）；
- create-atelier / MCP Registry 提交按 CHECKLIST ② 走。

### 第 4 步 · 1.2+ 候选池（按需，不预投）

性能债四件（unkeyed each 增量化 / streamValue O(n²) / _checkpoints 上限 / bridge 稳定身份——后两件与「身份系统去插入序化」同根，建议合并设计）；结构债三件（template.ts 拆分、scripts 共享 parseArgs——可一次性销掉 P2-C1/C2 与 P3 四件、生成器字面量解析共享库落地——gen-db 内联理由已失效）；dom-shim 二期（select/option 语义——P2-R1 的测试地基）；dev 面代理 SSE 心跳/背压；「生成后自检断言」不变式（api.ts tsc 零诊断、产物 SQL parse 校验——根治闸修一半病）。

---

## 7. 诚实边界

- 本报告由统筹者 + 6 路评审代理产出：P1 前 4 项、门禁结果、dev-screenshot-close 单跑复验为统筹者亲核；其余 file:line 为代理实读证据，制作时以实读为准（首遍评审曾有三处勘误先例）。
- 6 路中模板/文档一路首次派发因账户限流失败后重派成功，结论完整。
- `import 环 ×2` 实测仅剩 1 对（template↔component，import type 擦除）——留队原文口径与实况不符，如「×2」指该环两条边则成立。
- 全量测试 1 红为时序抖动（单跑复绿），非确定性回归；P 批收口时以两轮全量绿为口径。
