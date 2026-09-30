# 发布工程批任务书（REL 批）——第四遍全仓架构复校 + 1.1.0 发布工程

> 立项时点：2026-09-30（P 批收口 `e4920e1` 之后，工作树净）。执行队列位 = `BACKLOG.md` 活跃队列「REL 批」节。
> 评审方法：五路并行只读深扫（runtime+compiler / server+gen / dev+cli+scripts / mcp+skills+templates / tests+docs+CI）+ 统筹者亲核关键疑点。取证分级：〔亲核〕= 统筹者实读/实跑坐实；〔深扫取证〕= 评审员实读代码给出 file:line（红检落地时须先复现再修，先红后绿纪律不变）；〔实跑取证〕= 评审员 node 实跑验证。
> 本批定位：P 批已是「发布前最后制作批」，本批是**发布工程批**——正确性小收口 + 文档计数对真 + push 远端 CI 首跑 + 1.1.0 切版发布。REL-D（npm publish 及生态动作）= 发布日外部动作，归 RELEASE-CHECKLIST ②段既有单源，本文件不重复、不代拍时点（ROADMAP D-3）。

## §0 门禁实测（立项时点，非沿用既有声明）

- 全量 `pnpm test`（2026-09-30 17:55 本机）：**1103 绿 + 1 failed + 8 skip**（1112 总）——P 批收口声明为 1104 绿，本次实测差一。
- 唯一 failed = `tests/jobs.test.ts:282`「misfire 追一次不补差」（expected 2, received 3）。**单文件复跑 23/23 全绿**（18:08 实测）→ 判定：**时序抖动非回归**（并行负载下 150ms 观察窗被调度延迟拉长，recurring 合法再触发一轮，被断言误判为「补差」）。
- 含义：这不是 jobs.ts 的行为缺陷，是**测试对负载敏感**——远端 CI 首跑在陌生负载下可能随机红，属发布工程批必须处理项（见 REL-A5）。〔亲核〕

## §1 总评

1. **R/P 两轮硬化是真实的**：五路共抽查近期修复约 20 项，全部在位且带红绿测试（明细见 §4）；四项带「新问题」注记（均为收口不彻底的同族残端，非推翻）。
2. **无新 P1**。新发现 = 8 项 P2（其中 7 项建议发布前置收口）+ 约 40 项 P3。P2 集中在三类：同一缺陷面只修了一条通道（live SSE vs POST）、框架修了生成器/dev 面没同步（gen-db hasOwn / dev-token 铸造时点）、文档计数与实现漂移（性能表/310 计数/BACKLOG 队列）。
3. 架构债主线不变：`template.ts` 1909 行五职合一、`endpoints.ts` 1612 行、cli 参数小件六处重复——均已在前三遍报告留档，维持 1.2+ 候选池口径，本批不动。
4. 发布的三层残余风险：**正确性小洞**（未鉴权远程 500 ×1、错 schema 静默生效 ×1、门禁静默解除 ×1、Node 地板承诺裂缝 ×1）；**文档计数失真**（性能表 09-29 口径、310→343、BACKLOG 队列双向失同步）；**远端零验证**（343 commits 未 push〔亲核，rev-list 实测〕，当前门禁从未在远端跑过）。

## §2 新发现问题清单

### 2.1 发布前置应修（= REL-A 支范围；P2 ×7 + 时序加固 ×1）

| # | 问题 | 证据 | 修法建议 |
|---|---|---|---|
| REL-A1 | **live SSE 带契约分支标量 input → 未鉴权远程 500**。P2-S1 只归一了 POST 面：`handleLive` 的形状闸（`parsed` 非对象拒 400）位于 `else if`（无契约分支），带契约的 live 端点收 `?input=5` 时 `(5 ?? {})` 直接进 `validateFlat`，`collectFlatIssues` 的 `k in data` 对原始值抛 TypeError → 桥兜底 500（dev 泄 TypeError 原文）。live×auth 恒被 ATR-315 拒 ⇒ 该面恒为免鉴权可触发 | `server/live.ts:161-164`〔亲核〕+ `runtime/contract.ts:47,50`；`tests/live.test.ts:175-199` 无「契约+标量」红检〔深扫取证〕 | 形状闸提到契约分支之前，与 POST 面完全同形归一；live.test.ts 补「契约+标量/数组」红检。默认模板不受击（`app.notes` 无输入契约），但「live query + 输入契约」应用即刻暴露 |
| REL-A2 | **extract-schema 签名扫描误提取**：`findPropsSig` 从 decl 起扫到下一 decl 取「首个 `(props: {`」，组件体内层箭头函数参数 `(props: {x:number})` 会被误当签名——错 schema 静默生效（无 warn 无 ATR-102），经 dump→`compiledSchema`→组件校验一路穿透，违反本文件头注「绝不静默产出错 schema」红线 | `compiler/extract-schema.mjs:151-167`〔实跑取证：内层参数覆盖真实签名复现〕 | 命中位限定为 decl 已匹配的 `component(` 之后首个实参头 `(`；超界降 warn。**会进发布物**（错契约静默生效面），发布前收口 |
| REL-A3 | **dev-token 铸造在 vite config 期**：插件工厂每次实例化 `writeFileSync(dev-token, randomUUID())` ⇒ `atelier build`/`pnpm build` 也重铸并覆写 token；与运行中 `pnpm dev` 互踩后，读盘的 snapshot/bench/checkpoint 全部 401，而 checkpoint 把 `!r.ok` 一律判 vacuous 放行——**「未检不锚」快照门被静默解除** | `dev/atelier-dev-plugin.mjs:146-151`；消费面 `scripts/snapshot.mjs:129`/`bench.mjs:219`/`checkpoint.mjs:226,237`〔深扫取证〕 | token 铸造/落盘移 `configureServer`（serve 路径）内，或 config 期发现磁盘已有即复用不覆写 |
| REL-A4 | **compiler Node 版本闸是死代码**：`dump.mjs` 顶层静态 `import ../runtime/template.ts` 先于 `main()` 内版本闸求值——22.12~22.17（type-strip 须旗）区间进程在闸前死于 `ERR_UNKNOWN_FILE_EXTENSION`；`codegen.mjs` 连闸都没有。与 `engines >=22.12` + README 承诺矛盾，发布后属用户第一触点级故障（报 Node 内部错误而非四段式） | `compiler/dump.mjs:40` vs `:139-143`；`codegen.mjs` 头注；`atelier/package.json:7`〔深扫取证〕 | 版本预检放进纯 .mjs 薄壳（通过后再 `await import()` runtime .ts）。**与既有「22.12 vs sqlite 22.13 残差」一并定夺**：engines 统一抬 22.13 或 22.18（一处决策，三面齐改：package.json/README/sqlite.ts 口径） |
| REL-A5 | **jobs misfire 用例对负载敏感**（§0 实证红）：150ms 观察窗在并行负载下不成立 | `tests/jobs.test.ts:276-284`〔亲核复跑〕 | 观察窗放宽至 >2×everyMs 并以 run_at 现值断言替代 sleep-计数；或事件化断言。防远端 CI 随机红 |
| REL-A6 | **cli dispatch 死分支 + STUB_NOTES 缺键**：`case "review"` 在 :208 已命中并 break，:328 stub 块内重复（不可达）；`STUB_NOTES` 无 `review` 键——一旦重排/删 :208 触达该分支，迭代 undefined 即 TypeError 崩栈。两路评审员独立发现 | `cli.mjs:327-335` + `:109-113`〔深扫取证×2〕 | 删除 stub 块中的 `case "review"`（review 已是 MINI 实装） |
| REL-A7 | **ATR-405 清扫漏一处**：`snapshotDiffHandler` 直连 `/__atelier/screenshot?compare=1` 的 fetch 无 401 分支，token 错误被折叠进 `ATR-4xx-dev: capture failed`——与其余三条 401 路径口径不一致（P2-M1「认证失败恒 ATR-405」的残端） | `mcp/server.mjs:352-359`；对照 `:160`/`:448`/`:83`〔深扫取证〕 | 补同款 401→ATR-405 映射 |
| REL-A8 | **README 性能表口径落后**：表标「2026-09-29 / 1.1.0 复测」，但 09-30 R 批（bindAttr 单点/effect 回收/unmount/ATR-352/353）与 P 批（eachRowScope 行信号/derived 重挂/`<` 解析）连续改动 runtime 核心后**四指标从未复测**——若以此表切版发布，数字与发布物不符 | `README.md:98-108`〔深扫取证〕 | 发布批内强制重跑 bench 并刷新（RELEASE-CHECKLIST ①#11 程序上本就要求；R/P 批属「有漂移则全量重跑」触发条件） |

### 2.2 P2 非阻断（批后队列；1.1.x / 1.2 候选）

1. **keyed each 行内容在「框架自教的不可变更新」下静默陈旧**：行作用域只在首建时捕获 `item` 对象，key 命中复用仅更新 idxSig；而模板 `state-discipline` 测试**强制** `rows.value = rows.value.map(...)` 整体替换——替换后幸存行 `{r.name}` 停留旧值。该边界只有一行代码注释（H1），无测试钉无用户文档。〔深扫取证：`runtime/template.ts:1739-1761` + `templates/app/tests/state-discipline.test.ts:6-8,51`〕**语义决策项**（三选一：item 经隐藏信号随 reconcile 对齐 / 文档+钉测试明示红线 / dev 一次性警示），须用户拍板后入队。
2. **bindProp 无错误哨兵通道**：prop 表达式首跑抛错穿透为整组件错误卡、flush 期重跑抛错被吞仅保旧值——与 bindExpr/bindAttr（P2-R3 独立 onError）错误契约分裂，双路径一致地继承。〔深扫取证：`template.ts:548-552`〕
3. **BACKLOG 评审队列双向失同步**：已销账未划除（MCP 契约面五件/巨型函数拆分/CLI 尾巴两件/checkpoint-api-diff 半件/dev 尾巴两件均随 R 批落地）；第三遍 §3/§4 多个「仍开」项（server Origin 闸后续/404-405 名册 prod 门/prod 隐身单点旗/uploads 多实例删文件/GET 带体 500 等）未入任何队列——「执行队列唯一源」公信力受损。〔深扫取证：`BACKLOG.md:136-161`〕**归 REL-B 支修复**（§5-B4）。
4. **docs-numbers gate 与环境条件 skip 硬耦合**：`tsgo-parity`（平台二进制装失败整组 skip）与 `NODE_OK≥22.18` 组的 skip 集随平台漂移 → 远端 matrix 四格 passed 数不同 → gate 可能红。〔深扫取证：`tests/tsgo-parity.test.ts:141` 等〕REL-C 可选项（§5-C4）。

### 2.3 P3 收获清单（~40 项，进 BACKLOG 评审队列，按域列要）

**runtime/compiler**（〔深扫取证〕除注明）：derived 成功路径不重置 failedDirty（core.ts:196-201，方向安全）；hmrSwap `values` 死代码且空读信号（template.ts:1421）；ATR-401 记录缺 context/fix（template.ts:1594 + codegen.mjs:195）；contract.ts `k in data` 认继承键（:47,50——project-json 已改 hasOwn 此处漏同款）；scopedStyles.add 先于 ATR-204 校验致修好后永不重注（template.ts:1150-1152）；`on:click={typoHandler}` 静默 no-op 缺 dev 警示（:1121）；`<style media=...>` CSS 静默消失（:1203,1588）；函数值插值渲染字面 "undefined"（:402-409）；桶出口漂移三处（bind 族只出 bindAttr/HtmlTemplateWithScope 不出桶/同名 AtrError 两形）（index.ts:8 等）；dump/codegen `argOf` 缺值裸 TypeError（dump.mjs:128-133/codegen.mjs:476-478）；store.commit 在 effect 上下文内调用会污染依赖（core.ts:345-346，文档级）；expr 一元 ±/not 缺编译路径 parity 用例（对照 keyed idx 先例）。

**server/gen**：node 宿主 tx 内 exec 绕过写捕获槽（与 bun 分叉、漏 live 失效——sqlite.ts:173，违背「差异锁死本文件」自述）；GET/HEAD 携带请求体 → 500 非 400（node-host.ts:159-170）；%00 路径逃出穿越守卫变 500（static-host.ts:86-91）；uploads INSERT 失败分支 unlinkSync 可删跨进程胜者的共享文件（uploads.ts:569-584，多副本共享卷形态）；server-status faces 投影装配期冻结、后注册面从内省消失（endpoints.ts:1199-1208）；gen-db 生成物 Update 允许清单真值查找（原型链穿透，`__proto__` 列名 → 运行时显式错无注入面——gen-db.mjs:465，与 P2-S2 同族生成器面未同步）；「错误路径不发 Cache-Control=不被缓存」注释与 RFC 9111 相反（403/404 可被启发式缓存钉住瞬态半态——endpoints.ts:1294-1297,1610，建议错误 Response 显式 no-store）；限流键 ~160MB 内存放大面 + 非 node-host 宿主可伪造 remote-addr 头（endpoints.ts:260-286，文档级缓解）；isProd/DEFAULT_MAX_BODY_BYTES 等常量四处单点复制无机械对拍（建议补值对拍测试，发布后 vendor 会固化双写）；uploads ensureTable 晚于写盘的孤儿文件路径（uploads.ts:569-571）。

**dev/cli/scripts**：`?lines=abc`→NaN→返回全量审计行（dev-plugin:590〔实跑取证〕）；`/__atelier/mcp` 不校验 method，GET 通道携 token 无审计执行写副作用（:484-521）；readBody 无 error reject 无体积帽（:179-185）；截图并发 inflight 参数吞（:637-649）；握手窗口被 stop 打断时 stale promise 迟到 10s 误导性「握手超时」（dev-server-host.mjs:245-254）；bench 固定 debugPort 9346 与 pickFreePort 动机相悖（bench.mjs:281）；build --out guarded 面缺 `.atelier`/`.atr`（`--out .atelier` 清掉 dev.db/基线——build.mjs:92）；snapshot flag-first 仍 usage exit 2（cli.mjs:307-309）；usage die exit 码 1/2 不一（checkpoint.mjs:299,340 等）；checkpoint `--db` flag-当值静默 vacuous（checkpoint.mjs:128-133）；api-diff `snapshot --out` 无覆盖守卫（api-diff.mjs:363-366）；struct skillsRoot 非目录裸抛击穿 struct（struct.mjs:91-96）；esc() 不转义引号、属性上下文可逃逸（dev-review-pages.mjs:108,219-221，token 门内自伤面）；probe-mount 自述一次性仍在 dev/ 未入 vendor（probe-mount.mjs:100-103）；snapshot-smoke 就绪探测不带身份（snapshot-smoke.mjs:78-85）；`atelier dev --host` 等参数静默丢弃（cli.mjs:171-180）；docs-numbers 报错文案闭合标记写错永不命中（docs-numbers.mjs:65）。

**mcp/skills/templates**：技能包六处陈旧（TASK_ELIGIBLE 两件→实为六件/snapshot.diff summary 旧平铺路径/ATR-330 fix 仍 22.5/ATR-403 fix「改 server.port」同 P-D#8 型漏改/提取器 vendored 路径写错/auto 档审计措辞过宽）；approvalSecret 每次 callTool 求值——纯读工具首用即静默建 `.atelier/` 目录（server.mjs:781）；endpoint.call/server.health 的 mount 剥斜杠不拒 `..` 段（endpoint-tools.mjs:267,297）；initialize 原样回显客户端 protocolVersion 不协商（server.mjs:887，Registry 合规探测风险）；mcp-definitions errors/约束元数据碎裂（ATR-401 三处缺列/audit.log lines 无界广告 vs 实现 1..500）；模板 AGENTS.md 命令表 lint/package 无 STUB 标、check 描述过时（AGENTS.md.template:19-26）；init 兜底 .gitignore 名单与模板漂移（init-project.mjs:161-163，实践死路径属温床）；SERVER_INFO 版本双源（mcp-definitions $meta vs package.json）无机检（建议入 contract-checks）。

**docs/仓库面**：docs/README research 导航缺 3 行（feature-gap + 两份 0930 评审报告）；根 README:146 + AGENTS:24 决策上限仍 0-28/research 份数旧；「310 commits」四处漂移为 343〔亲核实测〕；ROADMAP:104「12 道」/RELEASE-CHECKLIST:11 期待值未泛化「当前版」；CHANGELOG R3/R2 节缺 merge 锚点；根目录《建议书-Atelier框架代码评审.md》未归位 research/；docs-numbers CI 内每组合双跑全套测试（时间×2、抖动暴露面×2）。

## §3 与既有留队项的关系（不重复立项）

本批发现与既有留队正交：SSE 心跳/背压（dev 代理）、runtime 性能债四项、dom-shim 二期、生成器共享库抽取（1.2+ 候选池）、gate 豁免洗白洞（留观）、`key` 词表亮线、ARCHITECTURE 0-28 未并入——全部维持原位不动。§2.3 P3 清单与第三遍 §3 留队表合并后统一抄送 BACKLOG 评审队列（REL-B 支动作，防再次失同步）。

## §4 近期修复抽查结论（五路合计 ~20 项）

- **runtime 8 项全真**（derived 脱订/双 scoped style/keyed index 双路 parity/html`` 双卫/bindAttr onError/effect sink 登记/select 微任务/一元 ±not）：红检在档；注记 1 条——derived 成功路径不重置 failedDirty（P3，方向安全）。
- **server 6 项全真**（P2-S1/S2/S3、下载 sha 寻址三件、restful Infinity、路由表化）：注记 1 条——P2-S1「两分支归一」实际只归一了 POST 两分支，live 通道同洞仍在（→ REL-A1）。
- **dev/cli/scripts 7 组全真**（build --out 三面守卫/崩栈三件/jsonl 坏行/反代韧性三件/resolved 上限/actualPort/Origin 闸/握手杀子/sourceFingerprint/路由表化）：注记 2 条——守卫是逐点修非共享原语（同族边界仍漏，见 P3）；stale 代际 promise 迟到 reject（P3）。
- **mcp 4 项全真**（TOOLSETS 执行闸/impact root+FS6 双向机检/http 剥 _meta/ui.screenshot 60s）：注记 1 条——ATR-405 清扫漏 snapshotDiffHandler 一处（→ REL-A7）。
- **CI/CHANGELOG/基线核对健全**：continue-on-error 实指 1 处（ci.yml:81）、五高危面测试覆盖真实（非纯 canned）、api-diff 基线与快照基线均被 git 跟踪（干净 checkout 不缺件）、[Unreleased] 与 R/P merge 锚点逐条对上。

## §5 批次计划（四支，串并行关系：A ∥ B → C → D）

### REL-A 发布前正确性收口（worktree 分支 `rel/a-fixes`，S-M 量级）

范围 = §2.1 的 A1~A7（A8 性能复测归 B 支）。纪律：红检先红后绿（A1 补 live「契约+标量」例/A2 误提取三态例/A3 build 期 token 不覆写例/A5 负载窗口例等），全套门禁收口。验收：全量两轮绿且 A5 用例在并行负载下稳定。

### REL-B 文档与计数对真（worktree 分支 `rel/b-docs`，S 量级）

1. 性能四指标复测 + README 表刷新（A8）。
2. 「310 commits」→ push 时 rev-list 实测数（当前 343），四处：README:123 / RELEASE-CHECKLIST:35-36 / ci.yml:72 / BACKLOG:63。
3. 切版三钉联动：`[Unreleased]` 并入 `[1.1.0]`（改日期与 compare 链接）+ README v1.1.0 摘要行补 P 批内容 + `tests/release-form.test.ts` 日期断言同批更新（先红后绿）。
4. BACKLOG 队列可信化：划除已销账子项 + §2.3 P3 清单与第三遍 §3/§4 留队整体抄送评审队列。
5. docs/README research 导航补行（feature-gap + 两份 0930 报告 + 本文件）；根 README/AGENTS 决策上限 0-35 与 research 份数；ROADMAP「12 道」/RELEASE-CHECKLIST 期待值泛化；建议书归位 research/。
6. 门禁：docs-numbers sync/check + contract-checks + check-skills。

### REL-C push + 远端 CI 首跑（含外向动作，须用户确认后执行）

1. `git push origin main`（343+ 实测数入档）。
2. 首跑盯两风险点：win32 组合 `dev-screenshot-close` 时序抖动（docs-numbers 双跑放大暴露面）+ ubuntu 组合 chrome 缺失按环境 skip 语义核实；两轮绿后摘 `ci.yml:81` snapshot-smoke `continue-on-error`（BACKLOG 尾巴既有条目销账）。
3. api-diff 发布终检（决策 28 / RELEASE-CHECKLIST ①#13）：`--strict` 红出 additive 清单 → 与 CHANGELOG `[1.1.0]` 对账 → `snapshot` 刷基线 → 常规 check 回绿。
4. 可选加固（首跑红才做）：docs-numbers gate 收敛单组合跑；node 矩阵加 22.13 显式格（engines 22.12 与 sqlite 免旗 22.13 之间真实阈值从未被矩阵测过）；ci.yml 补 concurrency 组。
5. ①段 13 道全量重跑留痕（R/P 两批后属「有漂移则全量重跑」）+ `checkpoint save "1.1.0-release"` 锚定。

### REL-D 发布日外部动作（RELEASE-CHECKLIST ②段既有单源；需 npm 账号，用户拍板）

本文件只补三点评审新增：① 包面字段齐套（private 摘除连带 release-form 断言、`files`/`exports`/`bin`/`prepublishOnly`（把 ①段 13 道接成硬前置）/`repository`/`license`/`keywords`；注意 `pnpm publish` + workspace 场景；RELEASE-CHECKLIST 建议新增一道 `npm pack --dry-run` tarball 人工核验——当前 13 道无一项验证发布物内容，且 atelier/ 下 node_modules 与 48KB 模板 lockfile 直发会进包）；② `files` 白名单必须显式决策 scripts/ 与 compiler/ 是否入包（不入则 checkpoint.*/graph.static/diff.report 对 Registry 用户恒失败——spawn 型依赖不在 vendor 闭包既有边界）；③ MCP Registry 提交前用官方 inspector 过一遍（initialize 版本回显与 tasks 自定义 method 两个合规疑点，§2.3）。

### 验收判据（全批）

RELEASE-CHECKLIST ①13 道全绿留痕；远端 CI 连续两轮绿且 continue-on-error 已摘；`[1.1.0]` 切版完成（CHANGELOG/README/release-form 三钉一致）；BACKLOG 队列与两份评审报告留队清单双向对齐；未竟余量显式留队（§2.2 决策项待拍板：keyed each 语义三选一 / bindProp 错误契约 / engines 22.13 vs 22.18）。

## §6 诚实边界

- 本报告五路深扫结论中，除标注〔亲核〕/〔实跑取证〕者，其余为评审员实读取证——**未经统筹者逐条复跑**；按仓库纪律，REL-A 红检落地时逐条先复现再修，复现失败即回本文件勘误（先例：第三遍报告勘误三处）。
- P3 清单条目只做定位与定性，未逐一深挖影响面；入队后按需展开。
- 本批不处理：SSE 心跳/背压、runtime 性能债、dom-shim 二期、生成器共享库抽取等既有留队（维持原位）；REL-D 全部外部动作不在本环境可验范围（无 npm 账号/远端 push 须用户确认）。
- 全量测试本机单次红（jobs 时序）已定性为 flake；若后续复跑再次出现不同用例红，须重新定性，不得沿用本结论。
