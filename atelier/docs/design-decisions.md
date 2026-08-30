# 框架设计决策记录

> 逐决策留档：每条含选项、取舍、定论、理由。新决策追加在末尾。

## 已决全景（速查表）

| # | 决策点 | 定论 |
|---|---|---|
| 0 | 部署目标 | 桌面 exe 一级分发；零依赖、纯静态输出优先 |
| 1 | 组件表达形态 | A 类 HTML 模板 DSL 为主 + D schema 渲染子集 |
| 2 | 响应式内核 | 编译期追踪 + 显式信号（$state/$derived/$effect）+ 静态依赖图 + 微任务批处理 |
| 3 | 编译策略 | 分层编译器：模板解析自研 + SWC/Oxc pass；仅 .atr.ts 编译；dev/prod 双编译 |
| 4 | 渲染/SSR | 纯客户端细粒度渲染主轨 + 可选 SSG；SSR 服务器 = 后期可选插件 |
| 5 | 状态模型 | 内置事务状态层（commit/rollback/timeTravel + 三态原语 streamValue/optimisticList + 命名 checkpoint 合并） |
| 6 | 契约层 | TS 类型单源 → 扁平 JSON Schema（无 $ref/oneOf）→ 自建微型校验器（dev 强制/prod 剥离） |
| 7 | 代理层 | atelier dev 内嵌 MCP（查询/操作/审计三面）+ atelier init --ai 生成 AGENTS.md/SKILL.md/llms.txt |
| 8 | 样式/token | atelier.config.json 语义 token 单源 + 编译期生成 utility + scoped 块；引用不存在 token 即报错 |
| 9 | 错误/约束 | AtrError 四段式 {code,message,context,fix} + ESLint @atelier/eslint 规则集（源码即库）；三层约束 |
| 10 | 验收回路 | 类型安全断言原语 + Vitest + Playwright 截图 diff（强制审阅）+ verify() 流式完成判据 |
| 11 | 人对界面 | atelier review 本地验收界面（预览/时间轴/diff/批准点踩/意图规格 specs/）；锁定区配置声明（P2） |
| 12 | 安全模型 | 源码变更模型 + MCP 权限分层（查询/操作/审计）+ dev 127.0.0.1+token + 远程数据白名单渲染 |
| 13 | 工程配套 | Bun 官方运行时 + Vite 7（Rolldown 可选）；pnpm workspace；Tauri 2 默认壳 + Electron 备选 |
| 14 | 框架命名 | **Atelier**（工坊）；旧前缀 fnh/Fnh 全体系映射为 atelier/ATR/atr（见决策 14 映射表） |
| 15 | 源码回滚与版本基线 | git 为源码版本基线；状态 checkpoint（决策 5）与源码 checkpoint 双轨；无 git 时降级文件树快照 |
| 16 | 工具类样式层 | Tailwind v4 作为 H3「生成 utility」的实现：config 单源派生 @theme；只准 token 派生类（机检护栏）；scoped 降级为动画逃生舱 |

> 总原则：「框架不内嵌 LLM」（一切生成/理解由外部代理完成，框架只提供原语、协议、执行器）。

## 决策 0（基线）：部署目标
- **定论**：框架生成的应用**以桌面 exe 为一级分发形态**（Tauri/Electron 壳，具体壳后在工程决策定）。
- 含义：核心运行时**零依赖、纯静态输出优先**；资产相对路径（兼容 `file://`）；SSR/服务器为可选模式；提供官方打包模板。
- 时间：第二轮调研后确立。

## 决策 1：组件表达形态
- **定论**：**A 为主 + D 子集**。
  - A：类 HTML 模板 DSL 为主要表达（声明式，贴近模型预训练分布，编译器可做作用域/依赖分析）。
  - D：数据驱动 schema（表单/数据展示类组件直接渲染 schema），不另设独立 JSON 语言。
- **取舍**：放弃 B（JSX）的生态熟练度与 C（纯 TS builder）的零解析器红利；换取模型开箱即会 + 编译期细粒度响应式 + 声明式意图对齐；代价是自研解析器/编译器维护成本（决策 3 细化）。
- **部署影响**：语法层对 EXE 打包无实质影响；模板编译产物 = 纯 JS + 微内核。

## 决策 2：响应式内核
- **定论**：**编译期追踪 + 显式信号声明**（runes 风格 `$state`/`$derived`/`$effect`）。
- 含义：状态显式声明；编译器生成静态依赖图 → effect 精确订阅 + 派生值惰性缓存；调度 = 微任务批处理。
- **取舍弃 B/C/D**：B 的 `.value` 样板是模型高频错误源；C 内核不受控、深度定制受限；D 记忆化黑盒与 AI 可推导目标相悖。换得：性能天花板 + 零运行时依赖 + "状态影响面"成为可查询机器事实。
- 代价：编译器调用图改写是重工程件（决策 3 细化）。

## 决策 3：编译策略
- **定论**：**分层编译器 + 选择性编译**。
  - 模板解析层自研（类 HTML → 组件 IR，含精确诊断）；
  - TS 转换/信号调用图改写复用 **SWC**（或后续迁 Oxc）AST pass；
  - 仅 `.atr.ts` 组件文件编译，其余 `.ts` 走 `erasableSyntaxOnly` 类型剥离直跑；
  - dev 输出未优化可读 JS + sourcemap，prod 输出优化产物（双编译）。
- **定论**：组件文件后缀 = `.atr.ts`（TS 内嵌模板；纯模板短文件可用 `.atr`）。
- 取舍弃 Babel（慢、与新工具链相径）/全自研（重造 TS 编译器）；运行时编译否决（性能+无静态图）。

## 决策 4：渲染输出与 SSR
- **定论**：**纯客户端细粒度渲染为主轨（决策 0 与 2 的直接延伸）+ 可选静态预渲染（SSG + 部分水合，`--static` 开关默认关）；SSR 流式服务器降为后期可选插件（`atelier-server`）；服务器驱动 UI 不进路线图。**
- 含义：构建产物 = 静态 `dist/`（相对路径资产，Tauri/Electron 埋入即跑）；无 hydration mismatch 陷阱；状态所有权 100% 客户端 → MCP 状态快照无跨进程桥接（简化决策 7）；D 子集的 schema 组件远程更新留作未来扩展口。
- 取舍：放弃 Web 首屏流式/SEO 一等地位（桌面基线优先；SSG 模式部分弥补）。

## 决策 5：状态模型
- **定论**：**内核内置事务状态层**（A）。
  - 信号之上：`store.commit/rollback/timeTravel` + 每变更自动 checkpoint + 增量 patch 事件日志；
  - 三态原语内置：`streamValue()`（流式 value）、`optimisticList()`（乐观更新+自动回滚），取代 useEffect 拼串模式；
  - **checkpoint 粒度 = 原子变更，但支持命名合并**（AI 一轮对话的 N 个变更折叠为 1 个可命名 checkpoint，回滚粒度对人类是"一次操作"）。
- 本步不做自动持久化（留待上层）；CRDT/离线协同作为未来可选插件，不进内核。
- 取舍弃 B（瘦内核 → AI 无运行时后悔药，与"可逆是自治前提"相悖）、C（CRDT 与逐 token 流式语义内在冲突）。
- **快照语义注记（2026-08-30，M3 实验教训）**：commit 按**引用**记录信号值，rollback 经 Object.is
  判等跳过未变信号——原地修改数组/对象（`items.value.push(x)`）的内容 rollback 恢复不了，必须整体
  替换引用（`items.value = [...items.value, x]`）。该约束写进 runtime JSDoc、state-transactions 技能包，
  并由应用模板守卫测试 `tests/state-discipline.test.ts` 静态拦截；结构性深拷贝快照因任意值类型
  （函数/类实例/DOM 引用）拷贝语义不可靠而暂不采用。
- **v0.3 事务层落地（2026-08-30，F-1 第一期）**：承诺三项全部兑现——①**命名合并**：同名 commit 且
  位于栈顶 → 幂等锚定，保留**最早**快照作整轮回滚点（"AI 一轮 N 变更 = 1 个回滚点"语义成立，
  rollback 直接回到本轮开始前；跨其他 checkpoint 的同名 commit 不合并，只认栈顶）；②**增量 patch
  事件日志**：每个 $state 写入自动入账（from/to/sig），有界环形（journalLimit 默认 500，可整体关闭），
  rollback/timeTravel 的恢复写入同样入账（审计语义）；③**依赖图可查询**：`store.graph()` 即席查询
  全部 $state（kind 标记）+ 存活 effect 的依赖边，effect dispose 即注销、信号 id 走 WeakMap——查询
  不驻留对象。诚实边界：rollback/timeTravel 的**恢复仍是全量快照**（正确性锚点，事件日志用于审计
  与展示，不做回放恢复）；依赖图为运行时追踪（编译期静态化归 F-2）。

## 决策 6：契约层
- **定论**：**TS 类型为单源（A）**。
  - 编译器从 AST 提取契约类型 → 扁平 JSON Schema（无 `$ref`/`oneOf`，判别用 literal + const 枚举）；
  - 自建微型校验器（零依赖、~几百行），dev 强制校验 + 四段式错误，prod 剥离（tree-shake）；
  - 同一份 schema 三用：运行时校验 / MCP 工具定义 / 注册表元数据；
  - 契约类型规范：纯数据 + 可判别结构，泛型/映射类型不进契约；
  - D 子集的 schema 渲染组件与契约层共用同一份"扁平 schema 规范"。
- 取舍弃 zod（双源+不扁平+API 变动致 LLM 知识过时）、TypeBox（运行时构造+带 ref+运行时依赖）、valibot（版本迭代极快）。

## 决策 7：代理层
- **定论**：**A —— 官方 MCP Server 随 `atelier dev` 内嵌启动 + `atelier init --ai` 自动生成 AGENTS.md/SKILL.md/llms.txt**。
  - 工具三面：查询（组件注册表/设计 token/状态快照+截图）+ 操作（checkpoint 列表/回滚/time-travel/测试运行/diff 报告）+ 审计（副作用日志）；
  - 工具定义全部由决策 6 扁平 schema 自动生成（单一真相）；
  - MCP 生命周期 = dev server 生命周期（无暴露面当 dev 关闭）；SKILL.md 渐进披露分包；
  - 不做独立 atelier-mcp 进程（需求重叠）；内嵌 agent 运行时（Claude Agent SDK 式）定为 P2 可选。
- **附带定论**：`atelier.config.json` 为单一扁平 JSON 配置文件（构建/设计 token/代理层配置）。

## 决策 8：样式与设计 token
- **定论**：**A —— token 强制 + 编译器生成 utility**。
  - `atelier.config.json` 语义 token（color/space/radius/font）为单源；构建/开发时按需生成 utility CSS（tree-shake 出单一 CSS）；
  - 组件 `<style scoped>` 块（编译期 hash 作用域）；全局样式仅允许 token 引用；
  - **机制性防漂移**：引用不存在 token = 编译/校验错误（四段式报错并列出可用值）；token schema 扁平化，MCP 查询工具直接可问"可用颜色有哪些"；
  - 类名规范默认 `bem-ish`（lint 提示不强制）。
- 取舍弃 B（无约束）、C（Tailwind = 第二大供应商 + 双配置源）、D（漂移最严重形态）。

## 决策 9：错误与约束
- **定论**：**A —— ESLint 平面配置 + `@atelier/eslint` 规则集（源码即库分发）+ 统一 AtrError 四段式**。
  - `AtrError = {code, message, context, fix}`；域：`ATR-1xx` 编译 / `2xx` 契约校验 / `3xx` 运行时 / `4xx` MCP；
  - 所有错误源必须走该对象；双通道输出（人类可读行 + JSON 结构化）；`fix` 必须给可执行建议；
  - 三层约束分层：编译器/类型/token 校验 = 硬门槛；lint = 软约束（警告级）；SKILL.md = 文档层；
  - 首版规则集：禁硬编码样式值、禁手写打字机（强制 streamValue）、组件 >400 行警告、契约纪律（无泛型/必须 discriminated union）、命名规范、禁隐式全局。
- 取舍弃 Oxlint（自定义规则生态未成熟）、无 lint 层（软规范无处安放）、自研 Rust linter（重造轮子）。

## 决策 10：验收回路
- **定论**：**A —— 内建断言原语 + Vitest（dev 依赖）+ Playwright 截图 diff 回环**。
  - 断言原语与契约层同源（类型安全）；`atelier.expect/toBeVisible/toHaveText` 等；`verify()` 流式感知完成判据（断言最终态而非中间态）；
  - 视觉回归 diff **强制审阅**（MCP `review-diff` 返回 diff 图给代理；禁止自动 accept 掩盖回归）；
  - 快照基准库 `.atr/snapshots/`（git 管理）；`--update` 仅显式；
  - dev 默认轻量截图回环（组件挂载自动截图，零配置开启）。
- **总原则（后续所有决策遵守）**：**框架不内嵌 LLM**；一切"生成/理解"由外部代理完成，框架只提供原语、协议、执行器。
- 取舍弃 B（断言语义不统一/无类型安全错过"单一真相"）、C（无逻辑断言）、D（本地无反馈闭环）。

## 决策 11：人对界面
- **定论**：**A —— `atelier review` 本地验收界面**（dev server 的 HTTP 面，浏览器打开；该界面为 dev-only，构建产物不含——`--ship` 子命令取消，避免与 `--static` 语义重叠，见决策 4）。
  - 内容：预览 iframe（同一 dev 实例）+ checkpoint 时间轴 + diff 报告（每条语义摘要/前后对比/影响文件）+ 批准/驳回/点踩 + 意图规格编辑；
  - 人只四件事：写意图、勾验收、批准、点踩。
- **附带定论**：
  - 意图规格单源：`specs/` 目录（模板 = 目标/约束/验收清单三段式），人是唯一编辑者，代理可读可更新；
  - stable-ID 锁定区：`atelier.config.json` 声明 `locked` 组件清单（配置声明比组件内标记更显式、易静态校验）；P2 落地但规范先行；
  - 点踩反馈：写回 `specs/` 反馈日志小节，代理下轮必读；同一点踩 3 次自动提 lint 规则提案（P2）。
- 取舍弃 B（依赖壳、Web 场景无统一入口）、C（无实时交互）、D（违反信任实证）。

## 决策 12：安全模型
- **定论**：**A —— 源码变更模型 + MCP 权限分层 + 远程数据白名单渲染**。
  - MCP 三分层：查询只读 / 操作面作用域限定项目目录（破坏性工具 `rollback` 等写入审计日志必录）/ 审计面全部写操作入副作用日志；
  - `require-confirm` 三档（auto / ask / deny）写入 `atelier.config.json.agent`；默认 auto（AI 可自动回滚），人可一键收紧；
  - dev server 仅监听 127.0.0.1 + 一次性 token 鉴权（MCP 连接需 token）；
  - D 子集远程 schema 只能实例化注册表内白名单组件 + 合法 token（无 eval/无任意组件）。
- 附带：产物零 `eval`、CSP 基线写入规范；运行时沙箱（WebContainer 级）为 P2 能力位。
- 取舍弃 C（无分层无审计）、D（不管暴露面）；B 现阶段无场景。

## 决策 13a：构建链与开发运行时
- **定论**：**Bun 官方运行时 + Vite 7（Rollup）基线**；Rolldown 1.0 作为可选 flag（实验通道，前置兼容测试）。
- 附带定论：包管理 = pnpm workspace（单仓多包：core/compiler/mcp-server/eslint-plugin/review-ui/create-atelier）；TS 严格度 = strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes；产物运行时零依赖、静态标准（Node 托管无摩擦）。

## 决策 13b：exe 壳
- **定论**：**Tauri 2 为官方默认（`atelier package`）+ Electron 备选模板（`atelier package --electron`，后续补）**。

## 决策 14：框架命名
- **定论**：框架正式名 = **Atelier**（工坊）。旧占位名 `fnh` 的全体系前缀映射如下（后续文档全部按此替换）：
- **【2026-08-30 卫生化归档】迁移已完成，本表降级为历史记录，不再作为活映射维护**。全仓清点（含隐藏目录 .dsh/.atr/.atelier，排除 node_modules/dist/.git）：活体 `fnh/Fnh/FNH` 引用为 0，仅本节历史记载保留。CLI 与包入口的 `fnh` 别名兼容期（原定"P1 内过渡"）确认关闭：现版本 cli.mjs 无 fnh 别名。后续如 grep 出新 fnh 引用按 bug 处理。

| 旧 | 新 | 说明 |
|---|---|---|
| `fnh`（CLI） | `atelier dev/build/init/review/package` | 词长但顺口无歧义；可留 `atr` 作别名 |
| 组件后缀 `.fnh.ts` / `.fnh` | `.atr.ts` / `.atr` | 纯模板短文件 `.atr` |
| 快照目录 `.fnh/snapshots/` | `.atr/snapshots/` | git 管理不变 |
| `fnh.config.json` | `atelier.config.json` | 单一扁平 JSON 配置 |
| `FnhError` | `AtrError` | 四段式 {code,message,context,fix} 不变 |
| 错误码域 `FNH-1xx/2xx/3xx/4xx` | `ATR-1xx/2xx/3xx/4xx` | 编译/契约/运行时/MCP 四域不变 |
| npm 包 | `atelier`（裸名入口）+ `@atelier/compiler`、`@atelier/eslint`、`@atelier/config`、`@atelier/review`、`create-atelier` | 统一 scoped |
| 生态命名 | `@atelier/*`，ESLint 规则集 `@atelier/eslint`（原 `@fnh/eslint`） | |
| 叙词/文案 | "工坊"意象：dev=开工、review=验工、checkpoint=工序留样、specs=图纸、锁定区=师傅圈定构件 | 叙事统一，便于文档与 SKILL.md 讲透 |

- **含义**：Atelier 的定义 = 一间工坊——人写下意图（业主），代理从无到有砌出界面（学徒/工匠），人验收并圈定"不许动的构件"（锁定区）。与七支柱高度互映：意图→规格（specs/）、可逆回放（工序留样）、人机控制权（锁定区）。
- **取舍弃**：① 保留 fnh 重新释义 "Frontend for Non-Humans"（零迁移成本、反差梗）——弃因：向人解释成本高、易被误读为噱头；② Chronicle/Trail（可逆+审计卖点直接）——弃因：名即一维，难以承载"人+代理+契约"全景；③ Graft/Mason/Scribe 等——弃因：撞名风险或概念偏窄。
- **理由**：撞名核查（2026 元月联网实搜）：npm/GitHub 无知名框架占用 atelier（仅 @martinffx/atelier、@hb-kit/atelier、opral/atelier 等小众 scoped 包）；"ATELIER" 商标为常见词多类注册，开源使用无实质冲突。发布前仍建议 `npm view atelier` 实测裸名可用性，不可用则退 `atelierjs`/`atelier-js`。
- **迁移策略（已完结）**：别名兼容期——CLI 与包入口保留 `fnh` 别名指向 atelier（P1 内过渡）；文档在下一轮全面替换时统一为 atelier 体系，替换后不再保留 fnh。→ 2026-08-30 复核：别名从未实际发布，兼容期直接关闭，无需废弃通告。

## 决策 15：源码回滚与版本基线
- **定论**：**源码变更依托 git 作为版本基线；状态 checkpoint（决策 5）与源码 checkpoint 双轨并行**。
  - `atelier init` 检测项目无 git 时自动初始化并生成初始 commit，同时写入 `.gitignore`（`.atr/snapshots/`、`dist/`、`node_modules/` 等）；
  - 每次 MCP 操作面/CLI 触发的"可签核变更"前自动 `git commit`（提交信息带操作编号与摘要）——源码 checkpoint；命名合并规则同决策 5（AI 一轮对话的 N 次编辑 = 一个可命名源码 checkpoint）；
  - MCP 操作面新增：`checkpoint.source_list`（列出源码 checkpoint）/ `checkpoint.source_rollback`（回滚文件树，等价 `git reset --soft` + 工作树恢复），走 confirm 档 auto/ask/deny 与审计；
  - `store.rollback`（应用状态）与源码回滚独立：状态回滚即时生效；一致性由提交闸门（`atelier check` + `atelier test` 通过才允许锚定 checkpoint）保证；
  - 用户禁用 git 时：源码回滚降级为 `.atr/backups/` 文件树快照（每次变更前拷贝），CLI 明示"无版本基线，回滚能力降级"。
- 取舍弃：自研文件版本库（重造 git，且 agent 生态已理解 git diff/commit 语义）；仅状态回滚（决策 5 的 checkpoint 只覆盖应用状态——agent 每轮真正改的是文件系统，缺源码回滚则"可逆是自治前提"落空）。
- 时间：原型验证（prototype）暴露该缺口后确立；为 v0.2 强制项，v0.1 实现 `init/checkpoint.source_rollback` 最小路径。

## 决策 16：工具类样式层（Tailwind v4）
- **定论**：引入 **Tailwind v4（CLI AOT 模式）** 作为决策 8 中「编译期生成 utility」层的实现。`atelier.config.json` 保持唯一样式值真值：dev/build 前 `scripts/gen-tailwind-theme.mjs` 将 token 派生为 `@theme` 指令文件 `src/tailwind.input.css`（`color.*`→`--color-*`、`space.*`→`--spacing-*`、`radius.*`→`--radius-*`），经 `@tailwindcss/cli` 一次性 AOT 编译出 `src/atelier-tailwind.css`（应用唯一引入，产物勿手改）。
- **实现选型修正（事故记录）**：最初用 `@tailwindcss/vite` 插件 dev 模式，实测触发 **full-reload 死循环**（候选重扫 × HMR 竞态，页面每 1-4s 整页刷新）——遂改 CLI AOT：vite 管线零介入，dev 稳定优先。代价：新增类后需重跑生成脚本（或重启 dev）同步工具类。
- **粒度引入**：只取 `theme + utilities` 两层、**不含 preflight**——基线 reset 仍归应用 `index.html`，避免接入即改变全站默认渲染（保快照像素稳定）。
- **护栏（机检）**：`tests/styling-discipline.test.ts`（`atelier test` 门禁）——R1 禁原生调色板类；R2 禁裸颜色字面量（hex/rgb/hsl）；R2b scoped CSS 取色只准 `var(--color-*/space-*/radius-*)`；**R3 scoped 仅白名单组件可用**（HeroSection/ModelCard/BenchBar/PillarCard 逃生舱层）。ATR-204 运行时校验继续生效。
- **混合制**：工具类管值；`atelier-ui.css` recipe 层（`.btn/.ppanel/.tab` + 全局 keyframes）为基线组件库前身；`<style scoped>` 降级为白名单逃生舱，不追求 100% Tailwind 化。
- **取舍**：+2 构建依赖（`tailwindcss`/`@tailwindcss/cli`）；接受类名即样式——换取 AI 首遍正确率（分布内词汇，收窄"DSL 分布外"风险敞口）、样式错误可 grep、组件内样式代码量约减半。模板表达式限制（整值属性、无带参调用）不受影响，条件类名仍在 TS 侧拼装。
- **状态**：11 组件全量迁移（五面板/三区块/StatsStrip/壳层）+ 4 组件白名单保留；机检 41/41、快照 MATCH、视觉复查通过。
- 时间：2026-08-27。

## 未决项
- 需要用户确认的可选 slogan 未定稿：「意图进，界面出」（中文） / *Intent in, interface out.*（英文），待命名正式对外时再定稿。——当前仅存档备选。
