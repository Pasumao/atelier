# Changelog

本项目的所有显著变更都记录在本文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)（major = 破坏性变更 / minor = 向后兼容的新增 / patch = 向后兼容的修复）。兼容性的执行器 = `atelier api-diff`（见 `atelier/docs/design-decisions.md` 决策 28）。批合并时同步向 `[Unreleased]` 节添条目（Keep a Changelog 惯例），发版时将 `[Unreleased]` 改名为版本号。

## [1.1.0] - 2026-09-30

**P 批（发布前硬化）收口——1.1.0 可进入发布工程批**（2026-09-30 第三遍全仓架构复校立项：任务书 = `atelier/docs/research/2026-09-30-third-architecture-review.md`，5 项新 P1 + ~15 项 P2 逐项实读坐实；主/子智能体 git worktree 协作四支并行 + 两路 fresh-context 独立评审。R 批条目见下方既有节；阶段四 npm 发布（D-3）前置 = push 310 commits + 远端 CI 首跑摘 snapshot continue-on-error）。

**REL 批 REL-A（发布工程批·发布前正确性收口）七项全落**（2026-09-30 第四遍全仓复校立项：任务书 = `atelier/docs/research/2026-09-30-release-engineering-batch.md`，无新 P1、7 项发布前置应修逐项红检先红后绿；主/子智能体 git worktree 协作 A∥B 两支并行 + 两路 fresh-context 独立评审；merge `5a8e688`。同批 REL-B 文档计数对真+1.1.0 切版三钉 merge `4066a0e`；REL-C push+远端 CI 首跑与 REL-D npm 发布 = 外向动作待用户拍板）。

### 安全与加固

- **资产下载面收口（决策 35，评审 P1#1/#2）**：`defineUpload` 新增 `downloadAuth` 声明位（复用 gateAuth 单源，缺省跟随上传面 auth、全链 fail-closed，多面合取）；下载句柄改 sha256 内容寻址（`GET <mount>/assets/<sha256hex>`，顺序整数 id 退役为内部主键——匿名枚举私有文件面关闭）；下载响应恒 `X-Content-Type-Options: nosniff` + 危险 mime（html/xhtml/svg 族）缺省 `Content-Disposition: attachment`；上传入口拒控制字符 mime、下载发射侧对存量毒化行 fail-safe 回落（独立评审对抗探针补充洞一并收口）（`5b22efe`/`dfc76c4`）
- **dev 反代 `<mount>/*` Origin 闸（评审 P1#3）**：复用 P1-12 闸单源（无 Origin 放行/Origin:null 拒/selfPort 函数口径）——恶意网页 no-cors fetch 跨站驱动写端点的面关闭（`ebd8a6a`）
- **confirm 安全三件（评审 §4.2）**：未知档位 fail-closed（`"ask "` 尾空格/拼错不再静默放行破坏性工具，ATR-402）；审批句柄 nonce 一次性台账（TTL 内重放拒绝，「一次审批→N 次回滚」关闭）；审批 HMAC 密钥与 dev-token 分离（`.atelier/approval-secret` 首用生成 0600——持 dev-token 方不可再伪造自批）
- **mount 前缀 `/` 边界（评审 P1#14）**：`/apifoo` 不再分发、`/apiupload/x` 不再命中上传面（绕过按前缀设防的反代 ACL 面关闭）；restful GET 非有限数（`?n=1e999`）400 ATR-312（`5b22efe`）

### 修复

- **runtime/codegen 同源四件（评审 P1#5/6/9/15）**：`rt.bindAttr` 单点化（编译产物 `disabled={false}` 布尔语义反转修复+双路径 golden parity）；`extractStyleBlocks` 单点统一多 `<style>` 块全注入；effect 泄漏三症状一次修（mount 中途抛错回收/运行期分支 effects 随实例析构/公开 `unmount()`）；`__recordLastError` globalThis 单源（非浏览器环境错误记录器不再抛 ReferenceError 吞错）（`3699bb2`）
- **生成器六件（评审 P1#4/13 + §4.7）**：端点扫描器 codeMask 掩码（注释掉的 defineQuery 不再产幻影端点、多行注释不再吞真实端点；export-openapi 改复用单一真相 walk）+ 顺带修出 codeMask `${` off-by-one 潜伏 bug；gen-db 保留字闸（表名 `delete` 不再产出 SQLite 语法错误的迁移）；端点重名 die；转义解码统一 JSON.parse 语义（`\n`/`\u4e2d` 三处三值分叉关闭）；desc/mount JSDoc 注入消毒；数值枚举 `(string|number)[]` 跨消费面收口；dump 产物去时间戳/绝对路径恢复 regen 字节幂等（`aacc219`）
- **dev/CLI 六件（评审 P1#7/8/10/11/12）**：init 对已存在非空目录 die 指路 `atelier sync`（`--force` 显式逃生）+ 参数缺值不再落 `./undefined`；api-diff 坏基线 exit 3 + checkpoint 对「基线存在但不可评估」拒锚（坏基线不再 vacuous 静默放行）；dev 插件 7 处改实际监听端口（strictPort 让位后截图/cookie/MCP 不再打错端口）；握手超时杀子进程+start() re-entry 清场（不再孤儿进程占端口持 SQLite 句柄）；`/__atelier/registry|docs` 错误围栏（文件缺失 500 ATR JSON 而非请求悬挂+unhandledRejection）（`ebd8a6a`）
- **MCP 契约面（评审 §4.1/§4.3）**：幻影广告参数删除（tokens.list.group/state.snapshot.root/ui.screenshot.format——dev 面零消费）；`min/max` 翻译 `minimum/maximum`（严格宿主校验生效）；受闸三工具 inputSchema 声明 `_approval`（additionalProperties:false 严格宿主审批二轮可达）；ATR-402 双语义拆分（confirm 档拒绝保留 402，dev-token 校验失败独立 **ATR-405**）

### 新增

- **runtime 响亮拒绝两件（评审 R-D4）**：忘写 `.value` 渲染信号 JSON → dev 一次性警示（**ATR-352**）；keyed each 重复 key 折叠行 → dev 一次性警示（**ATR-353**）——均 prod 剥离、渲染语义逐字不变（`3699bb2`）
- **契约面单源化机检（R2 批）**：新 `atelier/scripts/contract-checks.mjs` 三查（错误码全集反向对账——51 码 ⊆ 总表、12 缺码补齐；ARCHITECTURE §8 CLI 表 ↔ dispatch 双向对账——22 行表再生、`init --ai` 语义反转等漂移修正；runtime 桶出口派生哨兵）+ check-skills CLI_VERBS/FLAGS/RUNTIME_API 手抄白名单退役改派生 + CI 默认门接入；幻影面清账（技能包 expect/verify、`atelier lint/e2e` STUB 如实标注、llms.txt 1.1.0 刷新、gen-auth 过期产物注释等）（R2 支合并）
- **MCP 长操作 Tasks 化扩充**：HTTP 直连 TASK_ELIGIBLE +4（checkpoint.source_list/source_commit、graph.static、diff.report）——长 spawn 型不再内联阻塞 dev 面事件循环

### 内部质量（R3 结构债，行为等价重构 + 测试面补课）

- `createHandler` 路由表化：237 行十段 if-chain → 6 条目路由表 + 路由匹配层七件纯函数（30 例匹配器矩阵直测——P1#14 类边界 bug「无法被单测」的根因关闭）
- `callTool` 分发 Map：431 行七段 → 40 件 TOOL_HANDLERS Map + per-tool 元数据表（timeoutMs 单源 + 参数白名单；Map 键集 = 广告面机检钉死）
- dev 中间件路由表化（23 条，匹配原语可直测）；struct probeChecks 八层各一函数（表驱动分派，表序直调 ≡ 全量输出全等钉）
- `sourceFingerprint` 重复实现单点化（checkpoint.mjs 并入 snapshot.mjs）；export-openapi 第三份字面量解码副本消灭（gen-endpoint 单源导出）
- 反代韧性：上游响应头 15s 超时（504，SSE 头后流式豁免有测试）+ 客户端真断开销毁上游（SSE 生成器及时收尾）+ MCP resolved Map 200 上限 FIFO 修剪
- snapshot.diff（MCP）基线路径 per-platform 平台感知（与 CLI 同阶梯；旧平铺只读回落）

### 修复（P 批：发布前硬化，第三遍架构复校）

- **runtime 正确性九件（P1×3 + P2×6）**：derived 计算抛错后与上游永久脱订（上游退订移至成功路径+失败保留旧订阅叠挂部分依赖+`failedDirty` 过同 tick 去重——UI 错误卡不再永久停留）（`f75395a`）；双 `<style scoped>` 块 last-wins（同组件名复用首铸 scope class，前序块选择器命中 root）；字面量 `<` 静默丢弃（按文本并入对齐 HTML「< 后非标签名即文本」，`</` 残缺闭合仍 ATR-101 显式拒）；bind:value×`<select>` 初始选中丢失（下行定版延至微任务，对齐 bindGroup 先例）；`$effect` 首跑抛错逃逸 dispose 登记（sink 登记移到首跑前，错误路径僵尸 effect 关闭）；bindAttr 错误哨兵流入属性（onError 独立通道，25 项布尔属性「存在即真」面摘除）；`html`` ` 误用静默吞插值（rest 参数双卫卫 ATR-101 四段式拒）；keyed `{#each}` 行内 index 永久陈旧（行内 index 信号随 i 写入 + codegen emitEach keyed 支路委托 `rt.eachRowScope` 同源——解释器≡编译路径 golden parity 钉死）；表达式一元 `±` 与 `not` 假支持（primary 补 unary、`not` 映射 `!`）
- **server 三件**：契约端点收 JSON 标量/null 体 `k in data` TypeError 500→400 族（ATR-312 形状闸提升 + `payload = input ?? {}` 归一提前，未鉴权远程 500 面关闭、两分支口径归一）；jobs `handlers[row.type]` 原型链查找假成功（`Object.hasOwn` 判未注册——`type:"constructor"` 不再零执行落 done，兑现「绝不静默吞行」）；uploads 鉴权资产下载发 `public, max-age=31536000, immutable`（按下载面鉴权合取派生 private/public 档，共享缓存旁路授权关闭）（`618924f`）
- **MCP 五件**：ATR-402→405 拆分漏改两处（认证失败恒 ATR-405，与 confirm 拒绝双语义拆清）；`ATELIER_TOOLSETS` 只滤 tools/list 广告不滤执行（callTool 入口执行闸——隐藏工具凭名直呼 ATR-404，「权限面收敛」注释成真）；`endpoint.impact` 广告参数 `root` 静默丢弃（真实消费 + FS6 消费面元数据 `FS6_CONSUMED_ARGS` 单源 + 机检扩双向 consumes∪gate=广告）；HTTP 通道 tasks/update 携标准体形 `_meta` 被拒（params 构造时剥离，对齐 tools/call 先例）；`ui.screenshot` TOOL_META timeoutMs 4s 与同端点 snapshot.diff 60s 自相矛盾（提至 60s + fetch 超时/不可达文案分列）
- **CLI/生成器十三件（P1×2 + P2×11）**：`build --out` 无根目录关系守卫（越 root/==root/覆盖 package.json+src die 2——`--emptyOutDir` 清空应用源码面关闭；「..」判据整段化免误伤 `..foo`）（`4c6d1d0`）；dump stage② 扫描器无视注释/字符串（接入 extract-schema codeMaskOf——注释幻影模板/注释单反引号吞真模板/幻影组件三例关闭，无注释代码 dump 字节不变）；`review --target`/`sync --target` 缺值与 `struct --json` 旗标当子命令崩栈三件（套 init 同款 die 2 守卫）；checkpoint+struct 台账 jsonl 坏行裸 TypeError（逐行 try/catch die 1 指行号）；tokens-dtcg `--out` 同径覆写 token SSOT（samePath 拒 + atelier.config.json 告警）；api-diff `--allow` 坏档静默空表（die 2 诚实档）+ judge strict 双向反推（--budget 超限误标/--strict+removed 漏标修正，显式第三参）；gen-db SQLite 关键字只挡 JS 词表（db.ts assertIdent 加官方 147 词全集闸——构造期单一真相源，gen-db 回灌复验同闸）；gen-endpoint 派生标识符跨端点撞名无闸（camelOf/pascalOf seen-set，ATR-313 die 列双源名）；export-openapi 表名解码残留修复前旧语义（decodeEscapesCore 归一 + parity 测试）；字面量解析器 `__proto__` 原型键族（gen-db/extract-schema 显式 die、openapi/project-json `in`→`Object.hasOwn`）
- **文档诚实面八件**：三处「未 push 远端」口径改真实（origin/main 滞后 310 commits、末次 2026-09-06、CI 2026-09-06 实跑在案——「R 批与 1.1.0 门禁未在远端验证，push 后首跑再摘 continue-on-error」，旗标本批不动）（`fb4c1fc`）；`.atelier/approval-secret` HMAC 密钥入模板 .gitignore + init 兜底名单；快照瞬态捕获模式三处统一 `.atr/snapshots/**/current*.png`（per-platform 形态不再进 git 锚点）；`/__atelier/stream-intro` 营销演示路由下线（文案与实现脱节且从未入队追踪）；Node 地板 ≥22.12 统一（README ×2 + package.json engines；sqlite ATR-330 fix 改 ≥22.13 免旗真实阈值诚实口径）；docs/README.md 导航刷新（1.1.0 / design-decisions 0-35，ARCHITECTURE 行如实标注 0-28 未并入）；init 收尾提示改真实 CLI 形态（框架无全局 bin）；模板 main-server.ts fix 措辞「改 server.port」→「新增 server.port 键」

### 修复（REL 批 REL-A：发布前正确性收口，第四遍复校）

- **live SSE 带契约分支形状闸归一（REL-A1，P2-S1 同洞收尾）**：形状闸从无契约分支提升至契约分支之前——带输入契约的 live 端点收 `?input=5` 标量/数组不再 `(5 ?? {})` 直进 `validateFlat` 抛 TypeError 兜底 500（dev 泄原文），改 400 ATR-312 族与 POST 面完全同形；live×auth 恒 ATR-315 ⇒ 该面原为免鉴权可触发（`250f6df`）
- **extract-schema 签名命中位限定（REL-A2）**：`findPropsSig` 只认 `component(` 开括号后首个实参头——组件体内层箭头函数 `(props: {...})` 不再被误当签名静默产出错 schema，超界降 warn 绝不静默（评审动态重放实证旧版误提零告警）（`754ce56`）
- **dev-token 铸造时机（REL-A3）**：vite config 期铸造/覆写 → `configureServer` serve 期「磁盘非空即复用、无则铸造」——`atelier build` 不再覆写运行中 dev 的 token，读盘 token 的 snapshot/bench/checkpoint 不再 401，「未检不锚」快照门不再被静默解除（checkpoint 对 401 一律 vacuous 的防御残端仍开留队）（`af121e6`）
- **compiler Node 版本闸复活（REL-A4）**：`node-guard.mjs` 纯函数单源 + dump.mjs 顶层静态 import 改闸后动态 import + codegen.mjs 补闸 + `ERR_UNKNOWN_FILE_EXTENSION` 双保险转四段式——Node 22.12~22.17 不再在闸前死于 Node 内部错误；engines/README/sqlite 三面地板值零触碰（22.13 vs 22.18 统一待拍板入 BACKLOG 待拍板节）（`d0385e8`）
- **cli stub 死分支摘除（REL-A6）**：不可达 `case "review"` 摘除（STUB_NOTES 缺键 TypeError 崩栈面关闭）+ STUB 分支集 ⊆ STUB_NOTES 键集结构自检（评审 N1 收口：锚前缀化 + 解析面 toEqual 兜底防空转绿）（`5b1d7b3`+`5233fb0`）
- **ATR-405 清扫残端（REL-A7）**：snapshotDiffHandler 401 补同款映射——认证失败恒 ATR-405 口径全量对齐（mcp/ 全域甄别仅此一处漏网）（`9150f20`）
- **jobs misfire 用例去负载敏感（REL-A5）**：sleep(150) 观察窗 → 事件化断言（补跑已触发 + 行重排未来锚谓词）+ 容负载计数上界——远端 CI 陌生负载下不随机红（jobs.ts 行为零变化）（`df5dbe9`）

**全站化 server 面从骨架到生产可用。** 1.0.0（合并锚 `6bb411c`，2026-09-27）之后四批（评审批 / 差距批 W1-W9 / 第三批 W10-W13 / MCP 工具族扩张批）的版本化提炼，条目由 `atelier/docs/BACKLOG.md` 四批归档行逐条对账提炼（代表性 git 锚点，经逐枚核验）；minor 判定依据 = 决策 28（api-diff 历次门禁全为 additive 零 breaking：+4 MCP 工具 / `db` CLI 命令 / `StreamError`·`RevertErrorEntry` 导出等纯加法）。本版新增决策 29-34（journal 持久化 / API key / email / 上传 / cache / GET for query）；新能力的使用者视角边界见根 README「Known Limitations」节。

### 安全与加固

- server 安全收口包：scrypt 显式参数+哈希版本位 / SQLite 统一 PRAGMA foreign_keys+busy_timeout / 请求体上限两道闸（413 ATR-346）/ prod 错误收敛+sha256 指纹 / server-status 可选 token 门禁 / 会话过期惰性清理 / 登录枚举恒时校验；新增限流 429（ATR-344）与登录失败锁定 423（ATR-345）——均显式装配缺省不启用（`bc67605`）
- live 端点×auth≠none 组合注册期 fail-closed 拒绝（ATR-315）+ command journal 敏感键递归脱敏（password/token/secret 等词根值整体替换，server-status/review/MCP 消费链同源受保护）（`81cd008`）
- dev 面加固：`/__atelier/*` Origin/Host 白名单闸 + 五条 JSON 路由 content-type 415 + token 一次性 HttpOnly cookie 通道 + CDP 随机端口与空闲看门狗（`2ab6545`）
- 生成器与扫描器输入面收紧：extract-schema 交叉/联合类型尾检查（ATR-102）+ gen-endpoint 端点名字符集闸/48 词保留字表/插值 JSON.stringify（`18ad846`）

### 数据与运维面

- jobs 队列与幂等键：`atelier_jobs`/`atelier_idempotency` 惰性建表 + UPDATE..RETURNING 原子取出 + 指数退避/stale lock 回收 + everyMs recurring + ctx.jobs/ctx.kv 注入（ATR-350/351）（`4747368`）
- `atelier db backup`：VACUUM INTO 在线快照（读快照不锁写不停机）+ bytes/sha256/quickCheck 自证行（`95d59d5`）
- command journal 持久化（决策 29）：追加表 `atelier_command_journal` + journalPush 单源双写（脱敏产物直接落库）+ 落库失败 warn 降级（`f226614`）
- 分页二原语：每张有主键表生成 `<t>ListPaged`/`<t>Count`（LIMIT/OFFSET 全 ? 绑定，负 limit 硬错；keyset 留门）（`87f507a`）
- FTS5 全文搜索：`table()` opts.fts → external-content 虚表 + 同步触发器三元组（DDL 单源）+ `<t>FtsSearch`（bm25 排序）/`<t>FtsCount`；unicode61 中文整串单 token 边界如实注记（`7805e75`）

### Web 面能力

- 健康端点 `GET <mount>/__atelier/health`：db 探活失败 503 + prod 200×server-status 405 对照 + `createHandler({ version })` 装配自报（`5a952c3`）
- API key 鉴权（决策 30）：`auth.type: "apikey"` timingSafeEqual 恒时校验 + 会话优先人机双通道 + openapi securitySchemes 投影（`d112eb0`）
- email 适配边界（决策 31）：显式 EmailTransport + 内建 mockTransport 零发送 + `atelier_email_log` 投递记账 + ctx.email 可选注入（`a7ad785`）
- 密码重置与邮箱验证流：`gen auth --flows reset,verify`（`auth_tokens` 表只存 sha256 + 四端点对 + 重置全端会话吊销）（`04c09f8`）
- 上传/资产管道（决策 32）：defineUpload 兄弟注册表 + 零依赖 multipart 单文件解析 + sha256 内容寻址磁盘去重 + `atelier_assets` 记账（`d10f0d2`）
- cache 档位（决策 33）：query 端点 cache 声明 → `Cache-Control` 注入 + 写端点缓存/live×public 等注册期硬错（ATR-313）（`a732442`）
- GET for query（决策 34）：`restful: true` query 端点接受 GET?query，鉴权/限流/契约校验与 POST 全同链（`17a528d`）

### AI 工具链（MCP · CLI）

- MCP 工具族 36→40：jobs.status / email.log / uploads.status / server.health 四工具销账差距批遗留 + server-status uploads 内省段（faces/assets/tail 台账）（`4dbe618`、`8bce296`，收口 `b31098d`）
- MCP callTool 长操作 spawnSync→异步流式收集（checkpoint 601s / git 30s 兜底超时）+ 取消信号直达 tasks.cancel 真树杀终止（`de6afaa`）

### 修复

- runtime：布尔属性 25 项集合 `false`→removeAttribute（disabled/checked 等语义反转修复，dev 态字符串化 ATR-328 警示）+ `$effect` 抛错重订阅恢复 + bindProp 信号泄漏修复 + bind:group 身份键微任务时点定版（`e541db7`，分支头 `2f10c3d`）
- cli/scripts：die 大一统归一（exit 语义逐点保留）+ bench/snapshot-smoke 失败收口（零孤儿 dev server/零临时目录/零无头浏览器残留）（`a4bec1f`）

## [1.0.0] - 2026-09-27

**首个正式版本。** 0.x 期间无对外发布点（仓库私有演进），本条由 `atelier/docs/BACKLOG.md` 归档行（git 锚点可溯）提炼；设计依据见 `atelier/docs/design-decisions.md`（决策 0-28），路线与缺口见 `ROADMAP.md` / `BACKLOG.md`。使用者视角的已知限制见根 README「Known Limitations」节——npm publish 等发布日外部动作清单见 `atelier/docs/RELEASE-CHECKLIST.md`。

### 框架内核（runtime）

- 信号内核：显式 `$state`/`$derived`/`$effect` + 微任务批处理调度 + keyed each + 模板 AST 缓存（`0c3636a`）
- 事务状态层 v1（决策 5）：命名合并 checkpoint（"AI 一轮 N 变更 = 1 个回滚点"）+ 增量 patch journal + `store.graph()` 依赖图即席查询（`464efe7`）
- 三态原语：`streamValue()`（流式 value）/ `optimisticList()`（乐观更新 + 自动回滚）（`464efe7`）
- 组件模型补强（F-5）：响应式 props（prop 信号 + getter）+ effect 所有权树（分支/行级析构，嵌套实例级联 dispose）（`a2e18a8`）
- 异步表达式显式拒绝（决策 24，ATR-323）：求值出口单点，解释器/codegen 双路径同源（`e57717a`）
- 属性级指令族（决策 25）：`bind:value` / `bind:checked` 双向绑定 v1（`9093d8b`）→ 事件修饰 `on:<event>.prevent/.stop` v1.1（ATR-326，`16e3f44`）→ `bind:group` radio group v1.2（ATR-327，`8f2374b`）
- HMR 按名锚定还原：模板结构大改后同名信号按名还原、改名/删除保守不还原，checkpoint 快照跨交换重锚到新信号（`97cf2b9`）

### 编译器

- 模板编译流水线 ②③：`.atr.ts` → 模板 AST（dump）→ 零 import 静态 effect 图模块（codegen），golden DOM 对拍守门（`0c3636a`）
- 静态依赖图（F-2，决策 3）：静态清单 + 运行时差分对拍一期；构建期图查询（`buildGraph` / `--graph` / MCP `graph.static`）+ `$effectStatic` 跳过追踪快路径二期（`c0bc95d`）
- prod 剥离 v1（决策 27）：`BUILD_PROD` 短路旗 + vite define 折叠 + 分支 DCE（浏览器面），服务面壳预置旗 + 产物冒烟自证（`cbca797`）
- schema 编译期提取 v1（决策 26）：`(props: {...})` 类型注解即组件 schema 单源，超映射面 ATR-102 四段式显式拒绝（`d1301eb`）；schema 随编译产物流携带（`e332bec`）

### 全站化 server 面（atelier/server）

- 端点运行时 v2：defineQuery/defineCommand 读写二分 + 显式注册表 + Web 标准分发 + 输入/输出契约校验 + ctx 显式注入（db/auth/signal/audit/setCookie）+ 鉴权装配拦截 + command 审计 journal（`b592847`→`0c0ec46`）
- 生成器族：`atelier gen db`（tables/crud/迁移骨架）/ `gen endpoint`（类型化客户端 api.ts）/ `gen auth`（scrypt 会话原语 + 端点三件套），产物显式 import 闭合 + 生成后零修改可编译门禁（`0c0ec46`→`d7523e0`）
- 可逆迁移器（up/down/verify 影子库干跑 + sha256 体检）+ 幂等 SQL 种子 + 迁移持久 journal（成败条目同事务入账）（`0c0ec46`、`d7523e0`、`ce86c85`）
- live 端点引擎（FS-7）：SSE 线协议 + 失效-重算-推送 + coalesce/single-flight/背压断流自愈（`d7523e0`）
- `atelier build`（vite 静态面 + server 启动壳单容器产物 + 冒烟自证）与 `atelier call`（端点 CLI 直调验证环）（`714c829`）
- SQLite 薄宿主适配：bun:sqlite / node:sqlite 四原语差异锁死单文件；Bun 1.4.2 宿主实测，两枚真差异（无行 get / 纯注释 exec）归一（`731fe74`）

### AI 工具链（MCP · Skills · CLI）

- MCP 工具面单源（`mcp-definitions.json` 单源生成 tools/list），36 工具；stdio + 无状态 HTTP 直连双通道（`c0bc95d`→`5355bca`）
- struct 结构机检八层：六层结构矛盾 + server 边界层（import 越界/auth 缺声明/审计静默）+ 数据契约层（迁移配对/checksum/漂移）+ import 白名单（`0c0ec46`）
- MCP 2026-07-28 无状态规范对齐：`/__atelier/mcp` 头路由直连 + ask 档多轮审批（HMAC 句柄）+ Tasks 扩展 33→36 工具（`5355bca`）；vendored 应用内直连（MCP 族 vendor 闭包机检）（`06d9ba3`）
- `atelier api-diff` 公共 API 面漂移门禁（breaking/additive/valueDrift + --allow/--strict/--budget）+ checkpoint 三道门（测试绿 + 快照无漂移 + API 面无破坏漂移，未检不锚）（`c0bc95d`）
- 技能包 8 个（多工具兼容 kebab-case 包）+ `check-skills` 一致性门禁（`464efe7`）
- 源码 checkpoint（决策 15）：git 基线 + 三道门禁 + 迁移联动回滚（低 head 拒绝，绝不自动 down）（`d7523e0`）

### dev 面

- 亚秒 HMR + 截图回环 + token 门禁 + 审计日志 + SSE 下行 + agent 体检（`464efe7`）
- server 面托管监督器：子进程 spawn + `ATELIER_SERVER_READY` 握手 + `/api/*` 反代 + watch 热重启（`6cfc2e5`）
- review UI（timeline + 双图判定写回）+ `/__atelier/endpoints` 调试页 + `/__atelier/server-status` 内省快照（prod 隐身）+ 三源统一时间轴（`9446dc6`）
- 视觉回归快照门：per-platform 基线单源 + 框架仓 win32 基线入库（checkpoint 快照门实武装）+ `--full` 全页变体 + snapshot-smoke 本地门禁（`a1c2f01`、`1e0b3fc`）
- 性能四指标 1.0.0 口径复测 ALL PASS：gzip 12.28KB / 10³ 节点挂载 3.7ms / HMR 51ms / 截图回环 318ms（`d3b2970`）

### 实验台

- M3 三臂对照实验台（noskill/skill/react × 首遍正确率）+ 加难任务层 task4-6 + 评分器/负控前置门（`d27a34f`）
- Wave-7 正式波 45 run 出数：三臂全平——绝对口径 100% PASS、相对区分力为零（判读克制：不引用"正确率优势"主张，见 ROADMAP §7）（`985c2a1`，工件 `atelier/benchmarks/m3/results/WAVE7-FORMAL-REPORT.md`；出数事实 2026-09-06，见 BACKLOG M3 波次记录）
- M3-FS 全栈实验台武装完成：协议/任务书/双臂评分器/正负控认证全过；出数经裁定跳过，评测台按 RUNBOOK 可复现交付（`378aa55`）

### 诚实边界

1.0.0 = release-ready 口径，不是功能完备声明：npm publish / MCP Registry 提交 / 真实 CI 首跑 / linux·darwin 快照基线 / create-atelier 脚手架均为**发布日外部动作**（本仓未验证，逐项见 `atelier/docs/RELEASE-CHECKLIST.md`）。1.0 已知限制（使用者视角清单）详见根 README「Known Limitations」节；内部缺口、候选池与语义边界台账见 `atelier/docs/BACKLOG.md`。

[1.1.0]: https://github.com/Pasumao/atelier/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Pasumao/atelier/compare/v0.2.0...v1.0.0
