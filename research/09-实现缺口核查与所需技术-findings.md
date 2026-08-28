# 09 — 实现缺口核查与所需技术（第三轮调研）

> 方法：以 `design-decisions.md`（决策 0-16）与 `docs/ARCHITECTURE.md` v0.1 为规格基线，逐文件核查实际源码（`atelier/` 工具链 + `prototype/` 内核），对照 `docs/BACKLOG.md`（2026-08-27 快照）既有条目，产出「已核实现状 → BACKLOG 外新缺口 → 所需技术」三层结论。
> 口径：本仓有"虚标 implemented"前科（见 BACKLOG P0-1 诚实性修正），故所有结论均以本次源码直读为准，标注文件:行号证据。
> 日期：接 BACKLOG 2026-08-27 快照之后的核查轮（未写绝对日期，避免口径混乱）。

---

## 1. 实现现状基线（已核实，源码直读）

### 1.1 真实可用的部分（与 BACKLOG 进度面板一致）

| 能力 | 状态 | 证据 |
|---|---|---|
| 信号内核（v0.2 订阅模型，derived 同步失效） | ✅ | `prototype/src/core.ts:6-14,99-145` |
| 微任务批处理 + 单订阅失败隔离（P2-1） | ✅ | `core.ts:36-54` |
| 事务层全量快照 commit/rollback/timeTravel | ✅（雏形） | `core.ts:179-208` |
| 模板解释器（if/each/动态属性/事件/子组件/ scoped style） | ✅ | `prototype/src/template.ts` 全文 |
| keyed each reconcile（P1-1） | ✅ key-map + appendChild 重排 | `template.ts:456-489` |
| Template 解析缓存（P1-2，容量 500 兜底） | ✅ | `template.ts:216-225` |
| 组件级错误边界（P2-1：bindExpr catch + mount 兜底 + `__ATELIER_LAST_ERROR__`） | ✅ | `template.ts:234-254,302-321` |
| 扁平 schema 契约校验 ATR-201/205 | ✅（schema 手写非编译器提取） | `prototype/src/contract.ts:21-65` |
| 表达式求值器 + fuzz 差分对拍（P1-3） | ✅ | `prototype/src/expr.ts`；`tests/expr.test.ts:60` |
| 三态原语 streamValue / optimisticList | ✅（雏形） | `prototype/src/primitives.ts` |
| dev 面：token 门禁（P1-7）/ audit JSONL（P1-6）/ SSE 命令下行（P0-1）/ 截图 / 快照 | ✅ | `prototype/vite.config.ts:33-41,139-226`；`prototype/src/bridge.ts:69-117` |
| MCP server（手写 stdio JSON-RPC，单源生成 tools/list） | ✅ | `atelier/mcp/server.mjs` 全文 |
| MCP live 工具 | **13/21**（定义层 13 implemented / 8 pending） | `atelier/mcp/mcp-definitions.json` 逐条清点；`server.mjs:120-205` dispatch 路径 |
| struct 六层引擎 | ✅ | `atelier/scripts/struct.mjs`（server.mjs:30 实际 import 使用） |
| CLI：init/dev/test/snapshot/checkpoint/struct/skills/mcp | ✅（check 为 MINI=struct check） | `atelier/cli.mjs:21-48,125-139` |
| CLI：build/package/review/e2e/lint | **STUB**（exit 4，不假成功） | `cli.mjs:141-152` |
| 测试 | 31 用例 / 5 套件全绿（BACKLOG 写 26，现为 31） | `prototype/tests/` grep `it(` 计数 |
| Tailwind v4 AOT 链（决策 16） | ✅ | `prototype/vite.config.ts:5-8`；`prototype/src/main.ts:6` |
| 快照基线实际运转 | ✅ | `prototype/.atr/snapshots/{baseline,current}.png` 存在 |
| 技能包 8 个 + check-skills 一致性门 | ✅ | `atelier/skills/`、`atelier/scripts/check-skills.mjs` |

**口径小差异（未确认）**：BACKLOG 面板称 P0-1 后 live 12/21；本次清点 definitions 与 server 实达均为 **13**（checkpoint×3 + audit.log + structure×2 + snapshot×2 + ENDPOINT_MAP×5）。疑为统计口径差，建议下次改 BACKLOG 时统一。

### 1.2 架构终态对照：整体还差什么

ARCHITECTURE §2 规划的 monorepo（`packages/{core,compiler,cli,mcp-server,eslint-plugin,review-ui,create-atelier}` + `tauri-shell`）**全部未启动**：根目录无 `pnpm-workspace.yaml`、无 `packages/`、无 `.github/workflows/`（glob 零命中）。当前一切处于"脚本态"（atelier/ 目录 + prototype 单包），这与 BACKLOG"分期"叙事一致，但意味着：**除内核与代理面外，架构文档五层中 L5 全缺、L1-L4 均为雏形或脚本态**。

---

## 2. BACKLOG 既有未清项（确认仍在，不重复展开）

- **P0-2 编译器 MVP**：仅期①地基（解析缓存）落地；期②AST dump、期③代码生成未动。决策 3「仅编译器改写调用图」仍是 0%。
- **P0-3 M3 首遍正确率实验**：0 数据，立项最大假设悬空。
- **P0-4 性能基线台**：§7 四指标 0 数据。
- P1-5 HMR 保态 / P1-8 像素对比 / P1-9 契约 demo；P2-2 提交守卫 / P2-3 触发器 / P2-4 CI / P2-5 review UI / P2-6 卫生化。

---

## 3. 新发现缺口（BACKLOG 未列，本轮核查抓出）

按建议分级排序；每条含「问题 → 证据 → 技术路线 → 建议分级/估量」。

### N1. 父→子组件 props 非响应式 ★语义级缺口，编译器前置
- **问题**：子组件 props 在父渲染时**一次性 `evalExpr` 求值快照**，父状态后续变化不会传导给子组件；组件函数只跑一次且无重渲机制。主流框架的最基本语义（parent 更新 → child props 更新）在解释器里没有通路，当前 demo 只能用静态 props 或子组件内部信号绕开。
- **证据**：`template.ts:388-389`（`for (const a of node.attrs) props[a.name] = a.dynamic ? evalExpr(a.value, scope) : a.value` — 不在 effect 内）。
- **技术**：编译器路线（首选）= 把 props 引用改写为细粒度 getter/effect 注入子作用域（Solid 模式）；解释器兜底 = props 传 Signal 引用 + 子作用域解包。**此项应作为 P0-2 期③的语义设计前置，或先在解释器补语义以免编译器产物复刻错误语义。**
- **建议**：P0 级语义项（M，设计半天+实现 1-3 天）。

### N2. effect 所有权/生命周期缺失（泄漏）
- **问题**：无 onMount/onDestroy；`{#if}` 切换与无 key `{#each}` 全清重建时，被移除子树上的 `$effect` 不销毁、仍订阅信号——detach 节点继续被写入 = 内存泄漏 + 无效计算。组件卸载路径完全不存在。
- **证据**：`template.ts:422-451`（if 块重建仅清 DOM）；`core.ts:147-173`（$effect 仅手动 cleanup 函数，无自动处置）。
- **技术**：Solid 式 ownership tree（owner 栈 + dispose 级联）或轻量方案：mount 时建 per-mount `Set<() => void>`，块切换/组件卸载批量 stop。
- **建议**：P0/P1 边界（内存正确性），M。

### N3. 命名 checkpoint 合并 + 增量 patch 日志未实现
- **问题**：决策 5 承诺"N 变更折叠为 1 个命名 checkpoint"，现 `commit(name)` 每次 push 一条（`core.ts:184-190`）；全量快照 O(signals) 内存线性增长（TECH-COMPARISON §8 已 flag），AI 长会话下时间线噪声大、内存失控。
- **技术**：JSON Patch 式增量 op 日志 + inverse op 回滚；命名合并窗口（同一代理回合的 commit 合并）；历史条目 LRU 裁剪上限。
- **建议**：P1，M-L。

### N4. 验收断言原语 0 实现（决策 10 承诺）
- **问题**：`atelier.expect/toBeVisible/toHaveText`、`verify()` 流式完成判据全仓无命中（grep 证实）；DoD 的 "atelier test" = 透传 vitest（`cli.mjs:132-139`），无框架语义断言。verify() 是"流式 UI 何时算完成"这一 agent 验收的关键原语。
- **技术**：断言原语与契约层同源（对 registry 组件 + DOM 查询封装）；verify() 基于 streamValue.done + effect 静默窗口（quiescence）判定。
- **建议**：P1，M（verify 的 quiescence 判定是难点）。

### N5. D 子集白名单渲染器未实现（决策 1/12 承诺）
- **问题**：架构 L1 组成表列有 whitelist renderer（远程 schema → 注册表组件 + 合法 token，无任意代码执行），代码中不存在。安全模型闭环缺一块。
- **技术**：schema → 组件名查 registry 白名单 + token 白名单校验（复用 contract.ts + tokenState）。
- **建议**：P1，M。

### N6. MCP 源码 checkpoint 三工具未接线（快赢）
- **问题**：CLI `checkpoint save/list/rollback` 是 FULL（checkpoint.mjs，决策 15 双轨已交付），但 MCP `checkpoint.source_list/source_commit/source_rollback` 全部 pending（`mcp-definitions.json`）——决策 15 明说"v0.1 实现 init/checkpoint.source_rollback 最小路径"，MCP 面是缺口。同一能力两套入口只通了一套。
- **技术**：server.mjs dispatch 增加 source_* 三分支，复用 checkpoint.mjs 逻辑（spawn git）；confirm 档字段定义里已有（source_rollback=ask）。
- **建议**：P1 快赢，S。

### N7. 其余 5 个 pending MCP 工具可快速接线
- `test.run`（P0）= spawn `pnpm test` 收结构化输出；`docs.search`（P1）= llms.txt + SKILL.md 全文 grep；`feedback.read`（P1）= 读 specs/ 反馈节；`diff.report`（P0）= 汇总 checkpoint/source diff 语义摘要；`state.get`（P0）= 经下行通道读单路径。
- **建议**：P1 快赢（前三个 S，各半天内；diff.report M；state.get S）。

### N8. 信号依赖图不可查询（核心卖点未落地）
- **问题**：架构 L1 承诺"依赖追踪检查器（给 MCP）"与"状态影响面可查询"；bridge.ts 序列化只有 `sig-N` 匿名值列表（`bridge.ts:29-42`，其头注自认"信号 debugName 与依赖图导出"是完整版差异）。"状态影响面是机器事实"是决策 2 的核心论据，当前 MCP 无法回答"谁依赖这个信号"。
- **技术**：Signal 增加 debugName（$state 第二参数）；_subs 遍历导出依赖边（含 derived 链）；state.snapshot 增 `graph` 字段。
- **建议**：P1，S-M。

### N9. @atelier/eslint 规则集未建（决策 9 软约束层缺位）
- **问题**：`atelier lint` STUB；决策 9 首版规则（禁硬编码样式/禁手写打字机/400 行警告/契约纪律/命名/禁隐式全局）现仅部分由 styling-discipline.test.ts 与技能文档承担，无真正 lint 器。
- **技术**：eslint flat config 插件包；规则多可由 AST visitor 直写；`no-restricted-syntax` 可覆盖大半。
- **建议**：P1，M。

### N10. 产物链全空（build/package/SSG/CSP）
- **问题**：`atelier build`（prod 优化产物、契约 tree-shake 剥离、零 eval 校验、CSP 基线）、`atelier package`（Tauri 2 壳 + updater）、`--static` SSG（决策 4）全部 STUB/未动。决策 0"桌面 exe 一级分发"未启动——这是产品最终形态。
- **技术**：build 依赖编译器（P0-2 后）；Tauri 2 CLI 成熟可直接接；SSG = Vite build + 预渲染爬取（部分水合留后）。
- **建议**：P1（编译器落地后升 P0），L。

### N11. monorepo 化与发布链未启动
- **问题**：无 pnpm-workspace/packages；npm 发布、版本管理、`atelier` 裸名占用实测（决策 14 留的伏笔：发布前须 `npm view atelier`）都没做。当前 init 靠拷贝 prototype starter，工具链无法作为依赖安装。
- **技术**：pnpm workspace + changesets + 多包构建编排；包命名 `@atelier/*`。
- **建议**：P1，M。

### N12. 调度器无优先级/排序（已知但 BACKLOG 未列）
- **问题**：微任务批队列无 uid 排序、无优先级（TECH-COMPARISON §2 自评），大数据流下无法让高优先更新先渲染。
- **建议**：P2——先等 P0-4 基线数据再决定是否升级（避免过早优化）。

### N13. vite.config.ts 残留清理（XS）
- **问题**：`@tailwindcss/vite` 被 import 但未挂进 plugins（`vite.config.ts:3,245`）——决策 16 事故（full-reload 死循环）后的残留，devDependencies 仍保留该包，有误用风险。
- **建议**：立即清理（删 import + devDep）。

### N14. keyed reconcile 非最小移动（功能对，性能留口）
- **问题**：现实现为 key-map + 顺序 appendChild 重排（`template.ts:456-489`），非 Vue/inferno 最长递增子序列（LIS）最小移动算法；正确性无虞，超大列表移动次数非最优。
- **建议**：P2——P0-4 基线出数后再决定。

### N15. 错误 context 结构化程度浅（TECH-COMPARISON §7 自评）
- **问题**：errBox 是文本卡；AtrError.context 结构化（机读字段）不足，agent 消费 fix 建议仍靠解析文本。
- **建议**：P2，S。

---

## 4. 所需技术清单（缺口 → 技术 → 现状核实）

| 缺口 | 技术 | 现状（2025 联网核实） |
|---|---|---|
| P0-2 编译器 | **@swc/core JS 侧 Visitor API** 做 .atr.ts AST pass（不必上 Rust/WASM plugin）；sourcemap 用 magic-string；Vite plugin transform 钩子拦 `.atr.ts` | SWC core 的 JS API 文档在（[swc docs](https://swc.rs/docs/usage/core)）；swc_plugin 是 Rust/WASM 高门槛路线，**JS Visitor 起步即可**。Oxc 定制 pass 需 Rust、JS 绑定仅限现成转换器 → 维持决策 3"SWC 起步" |
| 决策 3 类型剥离直跑 | **Node 原生类型剥离（Amaro）**，esbuild（已在依赖树）兜底 | Amaro 1.0 已发布、Node 迈向稳定 TS 支持（[InfoQ](https://www.infoq.cn/article/osovrv9jqvu2ojkvrffl)） |
| 决策 13 Rolldown 可选 flag | rolldown-vite / Vite 8 | [Rolldown 1.0 已宣布](https://voidzero.dev/posts/announcing-rolldown-1-0)、[Vite 8 Beta 即 Rolldown-powered Vite](https://v7.vite.dev/blog/announcing-vite8-beta)——窗口已开，原型不必急，monorepo 化时一并评估 |
| P1-5 HMR 保态 | Vite `import.meta.hot.data` + acceptHMR 式信号保留（Svelte/Solid 已验证模式） | 无需新依赖，纯 Vite API |
| P1-8 像素对比 | 既定：截图实例内 canvas evaluate mismatchRatio（零依赖）；备选 pixelmatch+pngjs（+2 devDeps） | 维持既定方案 |
| P0-4 性能基线 | tinybench（vitest 生态同源）+ Performance API + CDP 时间戳 + gzip -9 尺寸表；跨框架对照选做 js-web-framework-benchmark | 无争议 |
| N3 事务层升级 | JSON Patch op 日志 + inverse op；命名合并窗口 | 标准技术，无依赖 |
| N7/N6 MCP 演进 | ≥v0.3 评估切换官方 TS SDK（stdio + Streamable HTTP 已稳定、capabilities 协商） | 官方 [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) 活跃；TECH-COMPARISON §10 已立决策点 |
| atelier check 类型门槛 | `tsc --noEmit` 并入；实验通道 **tsgo（typescript-go，~10x）** | [typescript-go](https://github.com/microsoft/typescript-go/discussions/514) 公开预览，性能叙事成立但未 GA——只作实验通道 |
| N10 打包链 | Tauri 2 CLI + WebView2 + updater；Electron 模板后补 | 成熟 |
| N11 发布链 | pnpm workspace + changesets + `npm view atelier` 裸名实测 | 成熟；决策 14 已留伏笔 |
| P2-5 review UI | 可用 prototype 组件体系自举（吃自己狗粮）：iframe 预览 + checkpoint 时间轴 + 双图并排 | 复用现有资产 |
| 编辑器支持（远期） | Volar 式语言工具链思路（.atr.ts 模板诊断） | 远期项，登记不排期 |

---

## 5. 优先级建议（路线图修正提案）

1. **快赢批（本周级，S）**：N13 清理 → N6 MCP source_* 接线 → N7 test.run/docs.search/feedback.read → P1-9 契约 demo。全部不动架构，纯接线。
2. **语义前置批（编译器开工前必做）**：N1 props 响应式语义定案 + N2 effect 所有权设计——否则 P0-2 期③会把解释器的语义缺口固化进编译产物。建议作为 P0-2 的 0a/0b 子期立项。
3. **战略主轴不变**：P0-2 编译器（期②AST dump → 期③代码生成）+ P0-3 M3 实验（不等编译器，技能包+解释器即可跑）+ P0-4 性能基线（数据决定 N12/N14 升不升级）。
4. **结构提升批**：N3 事务层增量+合并、N4 断言原语+verify()、N8 依赖图导出、N9 eslint、N5 白名单渲染器。
5. **增长批**：N11 monorepo+发布链 → N10 build/package（编译器后）→ P2-5 review UI。

## 6. 未确认项与口径声明

- live 工具数 13 与 BACKLOG 面板 12 的差异：本次以 definitions + server dispatch 双源清点为 13，未复跑 wire 实测（建议下次 blitz 顺手统一口径）。
- P0-3/P0-4 数据为 0 的结论来自 BACKLOG 自述 + 全仓无 bench/实验脚本的 glob 证实，未独立复测。
- `atelier/scripts/init-ai.mjs / init-project.mjs / check-skills.mjs` 未逐行核查（AGENTS.md 与 BACKLOG 双源标注已交付、README 兼容矩阵在案），本轮按可信处理。
- 外部技术现状（Rolldown 1.0、Vite 8 Beta、Amaro 1.0、tsgo 预览、MCP SDK）为 2025 年公开信息快照，采纳前建议按当时版本复核。
