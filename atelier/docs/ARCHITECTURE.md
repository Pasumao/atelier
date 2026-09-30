# Atelier 框架架构文档 v0.2

> 版本：v0.2（2026-09-19 整理：吸收全站化决策 17-23 与 FS-M1 落地现状，蓝图段改写为现实口径；v0.1 为 2026-08 蓝图版）。依据 `design-decisions.md` 决策 0-28；与 `SPEC-Agentic-DX-v0.2.md` 配套（本文件讲"系统是什么"，规范讲"代理怎么用"）。

## 1. 总体架构（五层 + 服务层 S0）

```
┌─ L5 人对界面 ────────────────────────────────────────────────────┐
│ atelier review（dev-only 本地页面）：预览 iframe · checkpoint 时间轴  │
│ · diff 报告 · 批准/驳回/点踩 · specs/ 意图规格编辑                  │
├─ L4 反馈通道 ────────────────────────────────────────────────────┤
│ atelier dev（Bun，亚秒 HMR）· 截图 diff 回环 · 审计日志 · ATR_DEBUG=json│
├─ L3 代理层（MCP Server，内嵌于 dev 进程；token 鉴权）──────────────┤
│ 查询：registry/token/state-snapshot/screenshot/docs              │
│ 操作：checkpoint-list/rollback/time-travel/test-run/diff-report   │
│ 审计：audit-log/read-feedback                                      │
├─ L2 契约层（全栈的合同，单一真相）─────────────────────────────────┤
│ TS 契约类型 → 扁平 JSON Schema → 校验器 / MCP 工具定义 / 注册表     │
│ 组件 ∪ 端点 ∪ 数据同一扁平 schema 单源；`~standard` 互操作口（决策 22）│
│ atelier.config.json：tokens · locked · agent(confirm 档) · 构建配置  │
├─ L1 内核（零依赖运行时）──────────────────────────────────────────┤
│ 信号引擎（静态依赖图·微任务批处理）· 事务状态层（checkpoint/回滚）   │
│ 三态原语（streamValue/optimisticList）· 白名单 schema 渲染器        │
│ 组件渲染（模板编译产物→细粒度 DOM）· 微型契约校验器                 │
├─ S0 服务层（全站化，决策 17-23；`atelier/server/`）───────────────┤
│ defineQuery/defineCommand 读写二分（显式注册表，无编译器魔法）       │
│ Web 标准 Request/Response 分发 · ATR-2xx 契约校验 · command 审计 journal │
│ SQLite 薄宿主适配（bun:sqlite/node:sqlite，差异锁死四原语）         │
│ 【FS-M1 已落地 2026-09-19；生成器/迁移/MCP 全栈工具族/dev 托管/OpenAPI 归 FS 线 M2+】│
└───────────────────────────────────────────────────────────────────┘
```

## 2. 仓库布局（现实）与发布期包结构（规划）

当前单仓布局（框架本体自足于 `atelier/` 目录；应用经 `atelier init` 三步组装为自包含目录，runtime/dev 面为 init 时点 vendor 拷贝，不回写框架）：

```
atelier/                      # 框架本体（零依赖 runtime 内核 + 工具链集成）
├─ runtime/                   # L1 零依赖内核（真相源：core/template/expr/contract/standard-schema/component/primitives/bridge）
├─ server/                    # S0 服务层（FS-M1 起：endpoints.ts 端点运行时 + sqlite.ts 薄宿主适配）
├─ compiler/                  # ② dump.mjs（.atr.ts → 模板 AST JSON）+ ③ codegen.mjs（AST → 零 import 静态 effect 图）
├─ dev/                       # dev 面框架件（Vite 插件 / 无头截图 / token→@theme 生成 / 挂载探针）
├─ mcp/                       # stdio MCP Server（mcp-definitions.json 单源生成工具面）
├─ skills/                    # 技能包 8 个（agentskills.io 格式，check-skills 硬门禁）
├─ templates/app/             # 应用 starter 模板（init 组装料：config/三元共置示例/specs/守卫测试）
├─ benchmarks/m3/             # M3 三臂对照实验台（protocol/任务书/评分器/RUNBOOK）
├─ tests/ · scripts/ · cli.mjs · docs/
```

npm 发布期目标包结构（`packages/core|compiler|cli|mcp-server|eslint-plugin|review-ui|create-atelier` + `tauri-shell`，决策 13a/14）为**规划态未实施**；发布重组随阶段四 npm 首发落地。

## 3. 编译流水线（决策 3；②③ 已落地 P0-2）

```
Component.atr.ts
  → ② dump.mjs：自研模板解析器（与运行时解释器同一解析器）
       类 HTML + {expr} + {#if}/{#each} → 模板 AST JSON（.atr/ast/，含表达式位置与样式块）
  → ③ codegen.mjs：AST → 零 import 静态 effect 图模块（.atr/compiled/<Component>.mjs）
       产物经 registerCompiled 注册后该组件走零 tokenize 快路径（语义与解释器同源，
       golden DOM 对拍守门）；产物携带静态依赖清单 deps{reactive,mount,events}
       （F-2 一期）→ buildGraph / `--graph` / MCP `graph.static` 构建期图查询
```

- **快路径判据与回退**（F-2 二期）：`bindExpr` 满足 exactness（无函数调用 + 全根标识符解析为信号 + 非零依赖）走 `$effectStatic` 零追踪簿记，否则回退动态追踪——宁慢勿错；静态集 ⊇ 实读集只会良性超订阅。
- **prod 剥离 MINI**：`__ATELIER_PROD__` 旗剥离 ATR-201/204 校验与渲染错误卡（console 留守不静默）；构建面 tree-shake 全量剥离归阶段四。
- 决策 3 原始蓝图中的 SWC/Oxc TS 调用图改写 pass 为**规划态未实施**：当前 `.atr.ts` 的 `$state/$derived/$effect` 为运行时显式声明直接执行，`$effectStatic` 是编译期依赖信息的唯一消费口。

## 4. 运行时组成（L1，零依赖）

| 模块 | 职责 | 决策 |
|---|---|---|
| signal engine | 静态依赖图、微任务批处理、派生惰性缓存、依赖追踪检查器（给 MCP） | 2 |
| transaction store | `commit/rollback/timeTravel`、每变更 checkpoint、命名合并、增量 patch 事件 | 5 |
| streaming primitives | `streamValue()` / `optimisticList()`（三态模型） | 5 |
| renderer | 编译产物 → 细粒度 DOM 更新；模板内建 `{#if}/{#each}` 运行时 | 4 |
| contract validator | 扁平 schema 校验（dev 强制/prod 剥离 tree-shake） | 6 |
| standard schema | `~standard` 互操作口（决策 22）：validate 委托 validateFlat，issues 映射标准列表——tRPC/Hono/TanStack 等生态可直接消费 | 22 |
| whitelist renderer | D 子集：远程 schema → 注册表组件 + 合法 token（安全渲染） | 12 |
| env | 决策 9 规范位：`atelier.env` 显式 window/document 访问——**原语未落地**（runtime 无此模块；当前口径 = 组件渲染路径不触 DOM 全局，宿主访问收口在应用边缘） | 9 |

## 5. 契约层产物（决策 6「一份 schema 三用」→ 全站化扩为五用，决策 17/22）

对每个组件：`Contract = { name, props, events, usage }` → 扁平 JSON Schema（无 `$ref`/`oneOf`）：
1. **运行时校验**：props 校验（dev 报 `ATR-2xx` + fix）
2. **MCP 工具定义**：`registry.get_component` / `docs.search` 等工具参数即其 schema
3. **注册表元数据**：`src/app.registry.json`（自动生成，SSOT）
4. **端点契约校验**（S0，决策 18）：query/command 输入输出经同一扁平 schema（`ATR-2xx` 四段式；FS-M1 已落地）
5. **跨生态投影**（决策 22）：`~standard` 互操作口已落地；编译期 JSON Schema/openapi-3.0 投影归 FS-9（未落地）

## 6. MCP 工具清单（L3，内嵌 dev 进程，token 鉴权）

| 面 | 工具 | 说明 | 优先级 |
|---|---|---|---|
| 查询 | `registry.list_components` / `registry.get_component` | 组件清单/签名/示例（含 flat schema 参数） | P0 |
| 查询 | `tokens.list` | 语义 token（颜色/间距/字号可用值） | P0 |
| 查询 | `state.snapshot` / `state.get` | 当前 UI 状态序列化（信号依赖图可查询） | P0 |
| 查询 | `ui.screenshot` | 当前渲染截图（与 review 同源） | P0 |
| 查询 | `docs.search` / `llms.txt` | 框架文档、SKILL.md、AGENTS.md | P1 |
| 查询 | `structure.map` / `structure.check` | 六层结构事实与矛盾门禁（MCP server 本地计算，无需 dev 进程；公理见 `docs/AI-OPTIMAL-STRUCTURE.md`） | P0 |
| 查询 | `graph.static` | 编译期静态依赖图查询（无需运行应用；无 stage ② dump 时 ATR-401 指路 `atelier compile`） | P0 |
| 操作 | `checkpoint.list` / `checkpoint.rollback` / `state.time_travel` | 事务层操作（写审计；confirm 档见 §9） | P0 |
| 操作 | `checkpoint.source_list` / `checkpoint.source_rollback` | 源码 checkpoint（git 提交锚点/回滚文件树，决策 15；走 confirm 档） | P0 |
| 操作 | `test.run` / `snapshot.diff` / `snapshot.review_diff` | 验收；diff 返回图片与基线，**须审阅**（晋升是 CLI/人的行为，不对 MCP 暴露） | P0 |
| 操作 | `diff.report` | 生成人类可读 diff 报告 | P0 |
| 审计 | `audit.log` | 全部写操作副作用日志 | P0 |
| 审计 | `feedback.read` | 读取 specs/ 内人类点踩/批准反馈 | P1 |

> **实现状态**：全部工具已接线（2026-08-29 P0 批次转绿；08-30 P2-1/P2-2 增 state.graph / state.journal / ui.a11y；09-06 增 graph.static）。**工具数以 `atelier/mcp/mcp-definitions.json` 为唯一事实源**（根 README/AGENTS 标记位 `<!--@num:tools-->` 由 `docs-numbers.mjs` 机检同步——文档禁止手写该数字）。工具描述由 mcp-definitions.json 单源生成；错误响应 = isError + structuredContent{code,message,fix} 四段结构化映射；`ATELIER_TOOLSETS=query,operation` 可按 face 按需暴露工具子集。

## 7. atelier.config.json（单一扁平配置）

```jsonc
{
  "tokens": { "color": {"primary": "#4f6ef2", "danger": "#e5484d"},
              "space": {"sm": "4px", "md": "8px", "lg": "16px"},
              "radius": {"sm": "6px"} },
  "locked": ["ChatMessageCard"],        // stable-ID 锁定区（P2 生效，规范先行）
  "agent": { "confirm": "auto",          // auto | ask | deny（破坏性操作）
             "requireToken": true },
  "build": { "ssr": "none" },            // none | static（SSG 可选）
  "server": { "port": 0, "mount": "/api", "dbPath": ".atelier/dev.db" }
                                         // server 段由 dev 托管监督链读取（resolveServerConfig →
                                         // 注入 ATELIER_SERVER_PORT/ATELIER_SERVER_MOUNT 等 env 给
                                         // 子进程）；port 0 = 自动。直跑 src/server/main-server.ts
                                         // 不读本文件，只认同名 env 变量
}
```

## 8. CLI 命令总表

> 本表与 `cli.mjs` dispatch/HELP 的对账由 `scripts/contract-checks.mjs` 机检钉死（动词双向覆盖 +
> 旗标 ⊆ HELP）——编辑本表请与 cli.mjs 同步改；实现档位（FULL/MINI/STUB）以 cli.mjs HELP 内标注为准。

| 命令 | 用途 |
|---|---|
| `atelier init --target <dir> --name <Name> [--no-ai]` | 脚手架：模板组装自包含应用；agent 层缺省叠加（AGENTS.md + llms.txt + specs/ + 技能双落点 + 客户端 MCP 配置），`--no-ai` 退出 |
| `atelier dev [--prod-db <path>]` | 开发服务（127.0.0.1:5173）+ 内嵌 MCP（stdio + `/__atelier/mcp` HTTP 直连）+ server 面托管监督器（缺省 5174：`/api/*` 反代、`src/server/**` 热重启）+ `/__atelier/*` 检视面 |
| `atelier review [--open]` | 打开 L5 本地验收界面（dev 面 `/__atelier/review`：timeline + 双图判定写回；需 dev server 在跑） |
| `atelier check` | 硬门槛 = 八层结构矛盾检查（struct check 同源转发）；类型严格检查 + 契约提取 + token 校验随编译器包并入 |
| `atelier struct [map\|check] [--json]` | 八层结构地图/门禁（`docs/AI-OPTIMAL-STRUCTURE.md` 公理的机检执行件；OK/WARN/ERROR 分级不假红） |
| `atelier test` | 转发到应用测试 runner（pnpm test） |
| `atelier snapshot save \| check [--update] [--full]` | 视觉回归基准库（`.atr/snapshots/`）：dev-face 无头通道拍摄，字节+像素双档判定（字节差但像素比 ≤ 阈值 = PIXMATCH），人审后 `--update` 才晋升；`--full` = 整页变体 |
| `atelier api-diff snapshot \| check [--root <dir>] [--json] [--strict] [--allow <f>] [--budget <0..1>]` | 公共 API 面漂移门禁（P3-4）：框架四面（runtime 导出/CLI 命令/MCP 工具/token 键）+ 应用三面（组件契约/token 键/openapi 面）；removed/changed = breaking（exit 1），churn 漂移率出数 |
| `atelier checkpoint save <name> [--no-gate] \| list \| rollback <id>` | 源码 checkpoint（决策 15）：save 内建三道门禁（测试套件绿 + 截图快照 MATCH + API 面无未豁免破坏漂移）+ migrationHead 台账联动；`--no-gate` 是 wip 锚逃生口 |
| `atelier sync [--target <dir>]` | 已有应用拉齐 vendor：runtime + dev 面 + mcp 族全量覆盖到框架当前时点，specs 模板补种；应用源码/config 不碰 |
| `atelier bench --app <dir> [--port N] [--json] [--keep]` | 性能四指标实测（gzip 体积 / 10³ 节点挂载 / HMR / 截图回环）；数字唯一人工口径 = 仓库根 README 性能表 |
| `atelier tokens export \| import --in <f> --out <f>` | 设计 token DTCG（W3C Design Tokens 稳定版）互导（atelier.config.json ↔ .tokens.json） |
| `atelier build --target=node\|bun [--root <dir>] [--out <dir>] [--no-smoke]` | 自托管单容器产物（D-F14）：vite 静态面 + `dist/server.mjs` 启动壳 + spawn 冒烟自证；edge/serverless 不做清单显式拒绝 |
| `atelier compile [--root <dir>] [--out <dir>] [--stdout]` | 编译器 ②（P0-2）：`*.atr.ts` → 模板 AST JSON（`.atr/ast/`，与解释器同一解析器）；③ codegen：`node atelier/compiler/codegen.mjs --ast <dir> [--graph]`（`--graph-only` = 依赖图查询 stdout） |
| `atelier gen db \| endpoint \| auth [--root <dir>]` | FS-M2 生成器族：数据契约 → tables/crud + 迁移骨架 + seeds 示例；端点 → `src/generated/api.ts` 类型化客户端（`--mount /api`、`--from-specs` 兼发骨架；auth 产物投影类型含入）；`gen auth [--flows reset,verify]` 鉴权套件 + 流程端点对；产物显式 import 闭合 + regen 字节幂等 |
| `atelier migrate status \| up \| down \| verify \| seed [--root <dir>] [--db <f>] [--to <name>] [--force]` | 可逆迁移器（FS-4）+ SQL 种子（D-F17）：verify = 影子库干跑幂等；不可逆 down 须 `--force`；seed 逐文件 tx 幂等重跑 |
| `atelier db backup --out <file> [--root <dir>] [--db <f>] [--force] [--no-verify]` | 在线备份（A3）：VACUUM INTO 单文件快照（读快照不锁写不停机）+ quick_check/sha256 自证行 |
| `atelier impact <contractKey> [--root <dir>]` | 契约 → 端点 → 调用点 两跳影响面导航（导航不是门禁——exit 恒 0） |
| `atelier call <endpoint> ['<json>'] [--root <dir>] [--mount /api] [--port N] [--timeout <ms>]` | 端点直调 CLI 通道（D-F15）：POST `<mount>/<name>`，响应 JSON 上 stdout，ATR 结构化错误 stderr + exit 1 |
| `atelier export openapi [--root <dir>] [--out openapi.json] [--mount /api] [--name <T>]` | 端点面 → openapi-3.0.3 文档（FS-9：schema 走 §2.4 投影器单管线；restful:true 端点映射 GET） |
| `atelier mcp` | 内建 MCP server（stdio；env `ATELIER_PROJECT_ROOT`/`ATELIER_DEV_URL`；应用 dev 面另有 `/__atelier/mcp` 无状态 HTTP 直连） |
| `atelier skills install [--target <dir>] [--name <N>] [--no-dsh\|--no-agents\|--no-mcp]` · `atelier skills check` | 技能包双落点安装（模板渲染 + specs 骨架，幂等）+ 一致性校验门禁（CI exit code） |
| `atelier e2e` · `atelier lint` · `atelier package` | STUB（exit 4，诚实未实现）：spec 位随 review-ui / @atelier/eslint / 打包包落地；Meanwhile 软约束由技能包承载、`check`/`snapshot`/`checkpoint` 覆盖回环核心 |

## 9. 安全基线（决策 12）

- dev/MCP：仅 127.0.0.1 + 一次性 token；`atelier.config.json.agent.requireToken`
- MCP 三分层（查询只读 / 操作作用域=项目目录 / 审计必录）；破坏性操作 `confirm: auto|ask|deny`
- 产物：零 `eval`、零内联外联脚本（config 显式允许除外）、壳侧标准 CSP
- 远程 schema：白名单组件渲染（无任意代码执行）

## 10. 打包链路（决策 13）

```
dist/（静态资产,相对路径）
  → tauri-shell: 指向 dist/ + WebView2 + updater → .exe (~3-10MB)
  → 备选: electron-shell 模板 → .exe (≈90MB)
```
