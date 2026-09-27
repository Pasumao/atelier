# Atelier 工作区说明

> 本文档由 dsh-plugin-agents-gen 生成，可手动编辑。

## 项目概述

本工作区即 **Atelier 框架仓库**：为 AI 编程代理设计的前端框架。`atelier/` 是自足的框架本体——零依赖 runtime 内核、dev 面插件、应用模板、测试与 AI 工具链（MCP/Skills/CLI）全部集成于框架目录内部，与前端运行时零代码耦合。2026-08 整理：原 `prototype/` 已吸收进框架（dev 面 → `atelier/dev/`，runtime 测试 → `atelier/tests/`，应用骨架 → `atelier/templates/app/`）后删除；更早的调研素材可回溯 git 锚点 `4c1d450`。

## 目录结构

| 目录 / 文件 | 说明 |
|---|---|
| `atelier/runtime/` | 零依赖运行时内核（真相源）：core.ts 信号引擎 / template.ts 模板解释器 / expr.ts 表达式求值 / contract.ts 契约校验（collectFlatIssues 供互操作口复用）/ standard-schema.ts Standard Schema `~standard` 互操作口（决策 22）/ component.ts 注册表 / primitives.ts 三态原语 / bridge.ts dev 状态桥 / index.ts 桶出口。 |
| `atelier/server/` | 全站服务层（S0，决策 18-20，FS 线 M2）：endpoints.ts 端点运行时 v2（defineQuery/defineCommand 读写二分 + 显式注册表 + Web 标准分发 + 输入/输出契约校验 + ctx 显式注入 db/auth/signal/audit/setCookie + auth 装配拦截 ATR-340/341 + 幂等/超时元数据 + 审计 journal 含失败条目）、live.ts live 端点引擎（FS-7：SSE 线协议 + 失效-重算-推送 + coalesce/single-flight/背压，ATR-321）、db.ts 数据契约（table() 扁平定义 → rowSchema/DDL 单源）、migrate.ts 可逆迁移器（up/down/verify，sha256 体检，ATR-331~334）、seed.ts SQL 种子（幂等 UPSERT + atelier_seeds 状态表，ATR-335/336）、sqlite.ts 薄宿主适配（bun:sqlite/node:sqlite 四原语 + tx + 写捕获槽，差异锁死本文件）、static-host.ts 静态托管单源（build 产物启动壳用：mount 前缀分派/路径穿越守卫/无 SPA fallback）、introspect.ts 运行时内省快照（`/__atelier/server-status` 数据源单源：端点全表含契约体/journal 尾部/live 订阅/迁移行；prod 旗标下隐身）。dev 托管/MCP 工具族归 FS 线后续。 |
| `atelier/gen/` | FS-M2 生成器族（产物显式 import 闭合 + regen 字节幂等 + 纯文本扫描禁 TS 解析器）：`gen-db.mjs`（schema.ts → tables/crud + 迁移骨架 + seeds 示例，追加式永不重写已应用迁移）、`gen-endpoint.mjs`（端点定义 + gen auth 产物 → src/generated/api.ts 类型化客户端〔auth 端点投影类型 = 对 gen auth 产物单一真相的渲染投影，2026-09-25 M8 批起覆盖〕+ specs 意图段可编译骨架）、`gen-auth.mjs`（M2-d：users+sessions 表契约/迁移对/auth.ts 会话原语（scrypt 差异锁死单文件）/auth 端点三件套/cookie.ts）、`export-openapi.mjs`（FS-9：端点面 → openapi-3.0.3 文档，契约经 §2.4 投影器）、`impact.mjs`（契约→端点→调用点两跳影响面导航）。经 `atelier gen db\|endpoint\|auth` / `atelier export openapi` / `atelier impact` 接线。 |
| `atelier/compiler/` | 编译器（P0-2）：`dump.mjs`（②：.atr.ts → 模板 AST JSON，与解释器同一解析器）+ `codegen.mjs`（③：AST → 零 import 静态 effect 图模块）+ `project-json.mjs`（FS-9 §2.4：FlatSchema → JSON Schema draft-2020-12 / openapi-3.0 单管线投影器，超扁平能力 = ATR-107 显式 throw）。产物经 `registerCompiled` 注册后该组件走零 tokenize 快路径（语义与解释器同源，golden DOM diff 在 tests/codegen.test.ts）。 |
| `atelier/benchmarks/m3/` | M3 三臂对照实验台（P0-3）：protocol.md（noskill/skill/react × 首遍正确率）+ 6 任务书（task1-3 冒烟正控层 + task4-6 加难层：流式 keyed each / 跨组件事务 / token 纪律）+ grade.mjs 评分器（acceptance harness，正控参考解在 reference/）+ report.mjs §7 出数 + RUNBOOK.md 逐臂出数操作卡。改评分器后必跑六正控回归。`m3-fs/` = M3-FS 全栈三臂实验台（FS-10，2026-09-20 武装）：protocol（对照臂 Next.js 已拍板）+ 任务书×3 v2 + 场景规格单一文档 + grade 评分器×2（S/T 直跑 + R=真实 server SSE 黑盒 × C=dom-shim/jsdom 对账）+ 基线装配脚本×2（含 task3 缺陷变体）+ atelier 臂正控参考解×3 + 负控×7 与 negative-check 前置门（改判据后必跑）+ report.mjs §6 出数 + RUNBOOK 武装版；出数前过 RUNBOOK §5 前置门。 |
| `atelier/dev/` | dev 面框架件：`atelier-dev-plugin.mjs`（Vite 插件，/__atelier/* 查询/桥接/审计/token 门禁/SSE 下行/MCP HTTP 直连与调试页接线）、`dev-server-host.mjs`（FS-7 server 面托管监督器：spawn `src/server/main-server.ts` + 握手 + `/api/*` 反代 + watch 热重启）、`dev-review-data.mjs` + `dev-review-pages.mjs`（M6：review 扩展与 `/__atelier/endpoints` 调试页的数据归一/页面模块——迁移时间轴×checkpoint 对齐/端点行为 diff/三源统一时间轴）、`dev-screenshot.mjs`（CDP 无头截图）、`gen-tailwind-theme.mjs`（决策 16 token→@theme AOT）、`probe-mount.mjs`（挂载诊断探针，PROBE_URL 可换目标）。init 时 vendor 进应用 `scripts/`。 |
| `atelier/tests/` | runtime 单测（vitest，<!--@num:tests-->615<!--@/--> 用例：内核/契约/表达式 fuzz/codegen golden DOM 对拍/F-2 静态依赖差分对拍/桥接/HMR/token DTCG/mcp-confirm 闸/server v2 端点面/live SSE 引擎/db 数据契约/迁移器/种子/checkpoint 联动/gen-db/gen-endpoint/gen-auth/openapi 投影与导出/struct 八层守卫；M3 评分 harness 无 env 时整体 skip）。 |
| `atelier/templates/app/` | 应用 starter 模板：vite.config / index.html / atelier.config.json（token SSOT）/ src/main.ts + HelloCard、ContractProbe、LiveNotes 三元共置示例（.atr.ts + .atr.md + .atr.spec.ts；LiveNotes = live SSE 直通 × §4.5 乐观对账 server 版示例）/ src/contract.ts 契约单源（gen endpoint 的 api.ts import 面）/ manifest.json / llms.txt / atelier-ui.css recipe / styling-discipline + state-discipline 守卫测试。`atelier init` 以此组装自包含应用（specs/ 骨架含 guardrails.md 常驻负例）。 |
| `atelier/mcp/` | MCP Server：stdio（`server.mjs`）+ dev 面无状态 HTTP 直连桥（`http.mjs`，2026-07-28 规范：Mcp-Method/Mcp-Name 头路由无会话粘性；经 dev 插件 `/__atelier/mcp` 暴露，FS-M7 起 init/sync vendor mcp 族十件后应用内直连可用，未 sync 旧应用 503 诚实指路 stdio）+ Tasks 任务存储（`tasks.mjs`）+ ask 档多轮审批（`confirm.mjs` requestState HMAC 句柄）；<!--@num:tools-->36<!--@/--> 工具单源生成，live 工具需一个运行中的应用 dev 面。 |
| `atelier/skills/` | 多工具兼容技能包（8 个 kebab-case 目录包）。 |
| `atelier/scripts/` + `cli.mjs` | init（组装：模板 + runtime vendor + vendor/atelier 规范布局 + dev vendor）/ dev / struct / checkpoint / snapshot / skills / mcp / gen / migrate / impact / export / build（D-F14：vite 静态面 + server.mjs 启动壳 + 产物冒烟自证）/ call（D-F15：CLI 验证环直调 server 面），三级诚实标注。 |
| `atelier/docs/` | 框架规格文档：ARCHITECTURE / SPEC-Agentic-DX / design-decisions 0-24 / AI-OPTIMAL-STRUCTURE / ROADMAP（2026H2→2027H1 路线计划书，阶段 3.5=全站化）/ BACKLOG（执行队列唯一源，含 FS 全站化线）/ SKILLS-PLAN / research/（2026-09 三路调研报告）；导航索引 = `atelier/docs/README.md`。 |
| `.dsh/skills/` | 本会话已安装的技能副本（harness 发现目录；源在 `atelier/skills/`）。 |

## 常用命令

| 场景 | 命令 |
|---|---|
| 脚手架新应用 | `node atelier/cli.mjs init --target <dir> --name <Name>`（cd && pnpm install && pnpm dev 即跑） |
| 启动应用 dev server | 应用目录下 `pnpm dev`（或 `atelier dev [--prod-db <path>]`；http://127.0.0.1:5173，strictPort）。dev 面同时托管 server 面：http://127.0.0.1:5174（缺省，atelier.config.json `server.port` 可配，0=自动），`/api/*` 经 Vite 代理，`src/server/**` 变更热重启 |
| 框架 runtime 测试 | `atelier/` 目录下 `pnpm test`（vitest；用例数见根 README 标记位） |
| 编译应用组件（②→③） | `node atelier/compiler/dump.mjs --root <appDir>` 然后 `node atelier/compiler/codegen.mjs --ast <appDir>/.atr/ast`（产物 .atr/compiled/<Component>.mjs，应用侧 registerCompiled 接入） |
| 应用测试（契约/样式守卫） | 应用目录下 `pnpm test` |
| 技能包一致性校验 | `node atelier/scripts/check-skills.mjs`（exit code 可接 CI；改动 skills/mcp-definitions 后必跑） |
| 一键安装技能到项目 | `node atelier/cli.mjs skills install --target <dir> --name <Name>`（双落点 + 模板渲染 + specs 骨架，幂等） |
| 结构地图/结构检查 | `node atelier/cli.mjs struct map` / `check`（八层 OK-WARN-ERROR 分级：1-6 既有 + 7 server 边界层（import 越界/auth 缺声明/审计静默）+ 8 数据契约层（迁移配对/checksum/漂移）+ import 白名单横切；在应用目录跑） |
| 生成数据面产物 | `node atelier/cli.mjs gen db --root <appDir>`（schema.ts → tables/crud/迁移骨架 + seeds 示例；追加式 regen 幂等） |
| 生成 API 客户端 | `node atelier/cli.mjs gen endpoint --root <appDir> [--mount /api] [--from-specs]`（→ src/generated/api.ts 类型化客户端；--from-specs 兼发可编译骨架） |
| 生成鉴权全套 | `node atelier/cli.mjs gen auth --root <appDir>`（M2-d：users/sessions 表契约 + 迁移对 + auth.ts 会话原语（scrypt）+ auth 端点三件套 + cookie.ts；装配 = createHandler({ auth: createSessionReader(db) }) + registerAuthEndpoints(reg)） |
| 迁移管理 | `node atelier/cli.mjs migrate status\|up\|down\|verify\|seed --root <appDir> [--db <f>] [--to <name>] [--force]`（verify=影子库干跑幂等；不可逆 down 须 --force；seed=幂等 SQL 种子 `src/server/db/seeds/*.seed.sql`，M2-d D-F17） |
| 契约影响面 | `node atelier/cli.mjs impact <contractKey> --root <appDir>`（契约→端点→调用点两跳导航；导航不是门禁 exit 恒 0） |
| OpenAPI 导出 | `node atelier/cli.mjs export openapi --root <appDir> [--out openapi.json] [--mount /api] [--name <t>]`（FS-9：端点面 → openapi-3.0.3；schema 走 §2.4 投影器单管线；restful:true 端点映射 GET；api-diff 应用面含 openapi face） |
| 产物构建（单容器） | `node atelier/cli.mjs build --root <appDir> --target=node\|bun [--out dist] [--no-smoke]`（D-F14：vite 静态面 + `dist/server.mjs` 启动壳 + spawn 冒烟自证；运行 = `ATELIER_DB_PATH=<卷> node dist/server.mjs`，整目录部署语义；edge 等不做清单值显式拒绝） |
| 端点 CLI 调用 | `node atelier/cli.mjs call <endpoint> ['<json>'] --root <appDir> [--mount /api] [--port N] [--timeout <ms>]`（D-F15：直调运行中 server 面，全 POST；响应 JSON 上 stdout，ATR 结构化错误 stderr + exit 1；不可达 ATR-403 指路 pnpm dev） |
| 已有应用拉齐 vendor | `node atelier/cli.mjs sync [--target <dir>]`（runtime + dev 面全量覆盖到框架当前时点；specs 模板补种；应用源码/config 不碰） |
| 打开 review UI | 应用目录下 `node atelier/cli.mjs review [--open]`（dev 面 /__atelier/review：timeline + 双图判定写回；需 pnpm dev 在跑） |
| 视觉回归快照 | 应用目录下 `node <repo>/atelier/cli.mjs snapshot save` / `check [--update]`（绝不自动晋升） |
| API 面漂移门禁 | 仓库根/应用目录下 `node atelier/cli.mjs api-diff snapshot` / `check`（P3-4：公共 API 面 snapshot→diff；removed/changed=breaking exit 1，`--allow` 豁免，`--strict` 连新增也红） |
| MCP server | `node atelier/mcp/server.mjs`（env：`ATELIER_PROJECT_ROOT`=应用目录，`ATELIER_DEV_URL`=应用 dev 面）；应用 dev 面另有 `/__atelier/mcp` 无状态 HTTP 直连（Mcp-Method/Mcp-Name 头路由；FS-M7 起 init/sync 后 vendored 应用直连可用，未 sync 旧应用 503 指路 stdio） |
| 读中文 UTF-8 文件 | PowerShell 一律 `Get-Content -Encoding UTF8`（默认 ANSI 会把 em dash 显示成乱码，文件未必真坏） |
| 源码 checkpoint（决策 15） | **仓库根目录下** `node atelier/cli.mjs checkpoint save "<名称>"` / `list` / `rollback <id>`（改代码前先看时间线；save 内建门禁=测试套件绿+快照 MATCH+API 面无未豁免破坏漂移（P3-4，`.atelier/api-surface.json` 存在时）才许锚定，`--no-gate` 为 wip 锚逃生口；M2-d 联动：save 记迁移 head 入台账、rollback 目标 head 低于当前库 → 拒绝并指路先 `migrate down`，绝不自动执行。**务必在仓库根运行**——在子目录跑会因找不到 `.git` 误引导嵌套 git 仓，2026-08-30 实证） |

## 维护纪律

- 框架 runtime 只改 `atelier/runtime/`；应用是 init 时点的 vendor 拷贝，不回写框架。改了 dev 面（`atelier/dev/`）同理——已存在的应用要重新同步 scripts/。
- MCP 工具/命令/错误码三处同步：CLI 表（cli.mjs HELP）/ `atelier/mcp/mcp-definitions.json` / 对应 skill；改后必跑 `node atelier/scripts/check-skills.mjs`。
- 框架规格文档唯一源在 `atelier/docs/`；缺口与改进队列 = `atelier/docs/BACKLOG.md`。
- 所有"未确认"结论必须明确标注，不得写成事实；删除文件前先 `checkpoint save`（git 可恢复）。
- 对外数字单一**生成**源：README/AGENTS 的用例数与工具数是标记位（`<!--@num:tests|tools-->N<!--@/-->`），由 `node atelier/scripts/docs-numbers.mjs` sync 重写 / check 校验（CI 已接）——禁止手写这两个数字（2026-09-06 锐评整改：曾出现 README 93 用例/24 工具与实际失守）；性能数字仍以 README 性能表为唯一人工口径。
