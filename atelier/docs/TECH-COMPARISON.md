# Atelier × 主流框架 — 实现技术逐项对照（v0.2）

> 对象：本仓实际源码（行号可查）vs 各框架公开实现的公认机制描述。
> 标注约定：`【同】`技术路线一致 · `【异】`不同路线（附后果）· `⚠️未测`。定性数字为社区常见量级，非精确基准。

## 0. 一图总览

| 站位 | Atelier 选型 | 最近亲 |
|---|---|---|
| 信号内核 | 手写 getter/setter Signal + 运行时依赖追踪 | **Preact Signals**（对象 .value 同型）；Solid/Svelte5=编译期版 |
| 模板 | tagged template `html``` ` `` 运行时解析 | **lit-html** 同路线；Vue/Svelte/Angular=预编译 |
| 调度 | 微任务批队列（无优先级） | Vue scheduler 同思路；React Scheduler 时间切片 |
| 契约 | 扁平 schema 三用单源 | （无人做三用）JSON Schema 子集 |
| 回滚 | 快照 checkpoint + git 双轨 | Redux devtools（态层外挂） |
| Agent 面 | MCP 单源生成 + skills 目录包 + struct 引擎 | llms.txt / Storybook MCP（只读子集） |

## 1. 响应式内核

| | 机制 | 后果 |
|---|---|---|
| **Atelier** 【实测】 | `Signal` 对象 get/set 访问器 + `_subs:Set` + `withTrack` 运行时追踪（core.ts:52）；显式 `.value` 读取即订阅 | ✓ 读法直观、零 Proxy 开销、跨闭包不断链；✗ 调用图是**运行时发现**，编译期静态化（决策3承诺）尚未兑现 |
| Vue3 | `Proxy` 深层拦截 + targetMap 依赖桶 | 深层对象可直接改；代价 Proxy 兼容/开销与"谁触发"调试难度 |
| SolidJS | 编译期把属性访问改写为 getter 调用，细粒度直更 DOM，组件函数只跑一次 | 同样靠显式访问（与我们同哲学），但把追踪成本移到了构建期 |
| Svelte5 runes | `$state` 编译到内部 signal 原语 | 语法最简；心智与 DSL 绑死，编辑器/类型需工具链深度配合 |
| Preact Signals | Value 对象 `.value` + 自动批量 | 与我们实现最像的成熟参照 |

## 2. 调度器

| | 机制 | 后果 |
|---|---|---|
| Atelier | `queueMicrotask` 批清空 pending（core.ts:20），重复排空兜底 | ✓ 小而正确；✗ 无优先级/去重排序，大数据流下无法让高优先渲染 |
| Vue3 | 微任务队列 + job 按 uid 排序（父先于子） | 更新次序确定性更强 |
| React19 | Lane 优先级 + Scheduler 宏任务时间切片 | 可中断渲染，交互优先 |
| Angular21 | signals 渐进 zoneless | 方向我们已在的位置（本来就是 zone-free） |

## 3. 模板形态与解析

| | 机制 | 后果 |
|---|---|---|
| Atelier 【实测】 | tagged template 运行时 tokenize/parse（expr.ts 自研词法：3 字符运算符优先/nullish）→ AST → `renderNodes` 递归建 DOM；**无解析缓存**（template.ts 无 Template Cache） | ✓ 无构建链也能跑（原型友好）、类 HTML 分布亲和；✗ 每次挂载重解析（lit-html 以 strings 数组缓存 Template+Parts，这块是我们的明确欠账） |
| lit-html | 同 tagged template 路线 + Template 缓存 + Part 精准绑定 | **最近亲**；其缓存策略 = 我们 v0.2 待抄作业第一项 |
| Vue/Svelte/Angular | 模板预编译成渲染函数/命令式更新码 | 运行时零解析成本；代价必须有构建链（我们是脚本态+未来编译器双模） |

## 4. DOM 更新策略 【实测】

| 层 | Atelier 行为 | 主流对照 |
|---|---|---|
| 文本插值 | `$effect(() => tn.textContent = …)` 叶级精准（template.ts:323） | ≈ Solid/Svelte 叶粒度 |
| 属性 | `$effect + setAttribute`（:362） | 同上 |
| `{#if}` | 块切换 remove+重建，锚点占位（:389-398） | Vue/Svelte 有 transition 与块复用优化 |
| `{#each}` | 全清空重建，**无 key reconcile**（:407） | ✗ 最大差距点：Vue/Solid/Svelte 均 keyed diff；大列表痛点 |

## 5. 组件模型

Atelier：`component(fn,{name,schema})` 显式命名 + 注册表 + render 时 props 校验 + `.locals(scope)` 手动作用域注入（ESbuild 改名防护是我们的踩坑产出）。主流均为隐式命名/装饰或编译期识别；显式 name 是"代理可推导"特化决策。无 runtime props 校验的主流（除 PropTypes 时代），我们把契约提为一等公民。

## 6. 契约/Schema

| | 机制 |
|---|---|
| Atelier | 扁平 schema（reqProps/optProps/enum/items）：**props 校验 ∪ MCP inputSchema ∪ token 校验**一份三用（contract.ts；defs 单源生成 tools/list） |
| 业界 | zod/TypeBox/JSON Schema 全量表达力强（$ref/oneOf/递归）；MCP 官方 SDK 用 zod 推导 schema |
| 取舍 | 我们禁用 $ref/oneOf = 牺牲表达力换 LLM 安全子集（厂商支持碎片化实证）与"一眼读完"；复杂校验应外置到 specs 验收命令而非塞进契约 |

## 7. 错误系统

Atelier：`{code,message,context,fix}` 四段式（contract.ts 实抛 ATR-201/204/305…）+ 码页（skills/atelier-error-codes）+ dev 面 fallback 卡片直显 fix（template.ts:343）。对照：Elm/rustc 的诊断文化在**编译期**且以人读为主；运行时带机读 fix 并回写 agent 建议动作的组合未见别家。✗ 当前 errBox 仅文本，context 结构化程度还浅。

## 8. 状态事务 / 回滚

Atelier：`store.commit(name)` 全量 Map 快照（O(signals)，$derived 豁免）+ rollback/timeTravel/list；源码轨 checkpoint.mjs（spawnSync git + backup tag + jsonl）。对照：Zundo/undoable 基于 action/draft 日志且是状态层外挂 devtools；无人内建 git 双轨。✗ 全量快照 O(n) 内存随信号数线性增长——增量 patch 日志在 SPEC 里已立flag。

## 9. Dev 检视协议

Atelier：HTTP `/__atelier/*`（Vite plugin 中间件）+ 页面哨兵 effect POST 桥 + CDP 截图 mini-client（Node24 原生 WebSocket，spawn 即焚）。对照：Vue/React DevTools = window hook + 浏览器扩展面向人的图形面板；Playwright MCP = 外部万能工具但不知晓框架语义。我们的差异化：**面板 API 化**（curl 可查），且与事务边界互知。

## 10. MCP / Agent 工具面

| | 实现 |
|---|---|
| Atelier | 手写 newline-delimited JSON-RPC stdio server（server.mjs ~230 行零依赖）；tools/list 由 `mcp-definitions.json` 单源生成（扁平 schema→标准 JSON Schema 转译）；本地计算(structure*)/dev 转发(state/screenshot)混合 dispatch |
| 官方 SDK | `@modelcontextprotocol/sdk` 提供传输抽象/capabilities 协商/zod→schema/资源订阅 |
| 取舍 | 零依赖换审计面与打包轻；代价是协议演进（新增 capability）要手工跟——SDK 切换留作 ≥v0.3 决策点 |

## 11. CLI 工具链

Atelier：`cli.mjs` 薄路由 + FULL/MINI/STUB 三级诚实标注 + spawn 隔离子脚本。对照：Angular CLI 是"CLI 即宪法"先例（ng generate/migrate 一体化），我们沿此方向但目前仅有骨架；Vite/create-* 脚手架多为交互问答式，我们的 init 是非交互参数式（更适合 agent 直调）。

## 12. 项目结构守卫

Atelier：六层公理默认内建（struct.mjs OK/WARN/INFO 分级不假红）。对照：eslint-plugin-boundaries / dependency-cruiser / nx boundaries 是**通用可配置守卫**——能力等价甚至更强，但需要人工配置规则且规则本身不含 agent 友好判定（幽灵注册表/入口预算/timeline 存在性）。我们卖的是**默认开箱的公理集**。

## 13. Bundle 规模（⚠️ 未实测，源码量级推断）

runtime 核心（core+expr+template+contract 合计 ~35KB 源码，零依赖）gzip 估 <10KB —— 远低于 30KB 目标上限，也低于 react-dom 数十 KB 量级；与 Solid/lit-html 同一轻量梯队。正式数字待基线测量落地。

## 14. 三个根源性路线选择（其余差异皆由此派生）

1. **运行时解释 →（未来）编译期改写**：原型用解释器换迭代速度；H1 的最终形态要求编译器承接调用图——这是与 Svelte/Solid 的正面差距，也是既定路线图而不是方向分歧。
2. **自有 DSL（分布外）vs 复用 JSX（分布内）**：赌"语法面小+技能包纠偏 > 语料规模优势"；该赌注由 M3 A/B 实验裁决，不通则局部回退 JSX 方言选项。
3. **Agent 内建 vs 外挂生态**：主流把 agent 需求留给工具层拼装；我们把契约/检视/恢复做成内核器官。反向兼容也保留（Playwright MCP 等照常可用）。

## 15. 借力清单（下一步抄作业目标）

1. lit-html 式 Template 缓存 + Part 化绑定（消重复解析）
2. `{#each}` keyed reconcile（最长递增子序列算法来自 Vue/inferno 公开研究）
3. 官方 MCP SDK 的 capabilities 协商（当协议面超出 3 方法时切换）
4. struct check 接入 eslint-boundaries 式自定义规则声明（公理可扩展）
