# Changelog

本项目的所有显著变更都记录在本文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)（major = 破坏性变更 / minor = 向后兼容的新增 / patch = 向后兼容的修复）。兼容性的执行器 = `atelier api-diff`（见 `atelier/docs/design-decisions.md` 决策 28）。

## [Unreleased]

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

[Unreleased]: https://github.com/Pasumao/atelier/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Pasumao/atelier/compare/v0.2.0...v1.0.0
