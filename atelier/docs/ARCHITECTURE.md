# Atelier 框架架构文档 v0.1

> 依据 `design-decisions.md` 决策 0-15；与 `SPEC-Agentic-DX-v0.1.md` 配套（本文件讲"系统是什么"，规范讲"代理怎么用"）。

## 1. 总体架构（五层）

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
├─ L2 契约层（单一真相）────────────────────────────────────────────┤
│ TS 契约类型 → 扁平 JSON Schema → 校验器 / MCP 工具定义 / 注册表     │
│ atelier.config.json：tokens · locked · agent(confirm 档) · 构建配置  │
├─ L1 内核（零依赖运行时）──────────────────────────────────────────┤
│ 信号引擎（静态依赖图·微任务批处理）· 事务状态层（checkpoint/回滚）   │
│ 三态原语（streamValue/optimisticList）· 白名单 schema 渲染器        │
│ 组件渲染（模板编译产物→细粒度 DOM）· 微型契约校验器                 │
└───────────────────────────────────────────────────────────────────┘
```

## 2. 命名（正式名 Atelier，决策 14）与 Monorepo 结构

```
atelier/                      # pnpm workspace 单仓
├─ packages/
│  ├─ core/                   # L1 运行时（零依赖，产物核心）
│  ├─ compiler/               # 模板解析器（自研）+ SWC 转换 pass
│  ├─ cli/                    # atelier 命令（dev/build/test/snapshot/review/package/init/check/lint）
│  ├─ mcp-server/             # L3 MCP 工具集（查询/操作/审计三面）
│  ├─ eslint-plugin/          # 决策 9 规则集 @atelier/eslint（源码即库分发）
│  ├─ review-ui/              # L5 atelier review 界面（dev-only）
│  └─ create-atelier/         # 脚手架（atelier init --ai 生成 AGENTS.md/SKILL.md/specs/）
├─ tauri-shell/               # atelier package 默认壳（Tauri 2）
└─ docs/                      # 本规格集 + skills/（SKILL.md 分包）
```

## 3. 编译流水线（决策 3）

```
ChatMessage.atr.ts
  → ① 自研模板解析器：类 HTML + {expr} + {#if}/{#each} → 组件 IR
       （模板树 + 表达式位置 + 样式块作用域）
  → ② SWC AST pass：
       - $state/$derived/$effect 调用图改写 → 信号绑定 + effect 精确订阅
       - {expr} 改写为细粒度更新函数
       - 契约类型提取 → 扁平 JSON Schema（列表见 §5）
       - style scoped hash + utility 类收集
  → ③ 产物：可读 JS（dev 双编译：读源码+sourcemap）/ 优化 JS（prod）
其余 .ts → 不编译，erasableSyntaxOnly 类型剥离直跑
```

## 4. 运行时组成（L1，零依赖）

| 模块 | 职责 | 决策 |
|---|---|---|
| signal engine | 静态依赖图、微任务批处理、派生惰性缓存、依赖追踪检查器（给 MCP） | 2 |
| transaction store | `commit/rollback/timeTravel`、每变更 checkpoint、命名合并、增量 patch 事件 | 5 |
| streaming primitives | `streamValue()` / `optimisticList()`（三态模型） | 5 |
| renderer | 编译产物 → 细粒度 DOM 更新；模板内建 `{#if}/{#each}` 运行时 | 4 |
| contract validator | 扁平 schema 校验（dev 强制/prod 剥离 tree-shake） | 6 |
| whitelist renderer | D 子集：远程 schema → 注册表组件 + 合法 token（安全渲染） | 12 |
| env | `atelier.env` 显式访问 window/document，禁隐式全局 | 9 |

## 5. 契约层产物（决策 6 同一份 schema 三用）

对每个组件：`Contract = { name, props, events, usage }` → 扁平 JSON Schema（无 `$ref`/`oneOf`）：
1. **运行时校验**：props 校验（dev 报 `ATR-2xx` + fix）
2. **MCP 工具定义**：`registry.get_component` / `docs.search` 等工具参数即其 schema
3. **注册表元数据**：`src/app.registry.json`（自动生成，SSOT）

## 6. MCP 工具清单（L3，内嵌 dev 进程，token 鉴权）

| 面 | 工具 | 说明 | 优先级 |
|---|---|---|---|
| 查询 | `registry.list_components` / `registry.get_component` | 组件清单/签名/示例（含 flat schema 参数） | P0 |
| 查询 | `tokens.list` | 语义 token（颜色/间距/字号可用值） | P0 |
| 查询 | `state.snapshot` / `state.get` | 当前 UI 状态序列化（信号依赖图可查询） | P0 |
| 查询 | `ui.screenshot` | 当前渲染截图（与 review 同源） | P0 |
| 查询 | `docs.search` / `llms.txt` | 框架文档、SKILL.md、AGENTS.md | P1 |
| 查询 | `structure.map` / `structure.check` | 六层结构事实与矛盾门禁（MCP server 本地计算，无需 dev 进程；公理见 `docs/AI-OPTIMAL-STRUCTURE.md`） | P0 |
| 操作 | `checkpoint.list` / `checkpoint.rollback` / `state.time_travel` | 事务层操作（写审计；confirm 档见 §9） | P0 |
| 操作 | `checkpoint.source_list` / `checkpoint.source_rollback` | 源码 checkpoint（git 提交锚点/回滚文件树，决策 15；走 confirm 档） | P0 |
| 操作 | `test.run` / `snapshot.diff` / `snapshot.review_diff` | 验收；diff 返回图片与基线，**须审阅**（晋升是 CLI/人的行为，不对 MCP 暴露） | P0 |
| 操作 | `diff.report` | 生成人类可读 diff 报告 | P0 |
| 审计 | `audit.log` | 全部写操作副作用日志 | P0 |
| 审计 | `feedback.read` | 读取 specs/ 内人类点踩/批准反馈 | P1 |

> **实现状态（v0.2 脚本态，wire 实达口径）**：**24/24 全部接线**（2026-08-29 P0 批次转绿；2026-08-30 P2-1/P2-2 转绿 state.graph / state.journal / ui.a11y——明细见 BACKLOG 进度面板）。工具描述由 `atelier/mcp/mcp-definitions.json` 单源生成；错误响应 = isError + structuredContent{code,message,fix} 四段结构化映射；`ATELIER_TOOLSETS=query,operation` 可按 face 按需暴露工具子集。

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
  "server": { "port": 0 }                // 0 = 自动；固定端口便于 agent 配置
}
```

## 8. CLI 命令总表

| 命令 | 用途 |
|---|---|
| `atelier init` / `atelier init --ai` | 脚手架（prototype starter 全拷 = 可运行示例即模板）；`--ai` 叠加 agent 层：AGENTS.md + SKILL.md + llms.txt + specs/ + `.mcp.json` 等客户端配置 + 技能包双落点安装 |
| `atelier dev` | 开发服务（当前 Bun/Vite 脚本态：127.0.0.1）+ **内嵌 MCP Server 与 `/__atelier/*` 检视面** |
| `atelier review` | 打开 L5 本地验收界面（dev server 的 HTTP 面） |
| `atelier check` | 硬门槛聚合器：v0.2 = 六层结构矛盾检查（`structure.check` 同源）；类型严格检查 + 契约提取 + token 校验随编译器包并入 |
| `atelier lint` | @atelier/eslint 规则集（软约束） |
| `atelier test` | Vitest 单元/组件断言 |
| `atelier struct [map|check]` | 六层结构地图/门禁（`docs/AI-OPTIMAL-STRUCTURE.md` 公理的机检执行件；OK/WARN/INFO 分级不假红） |
| `atelier snapshot save \| check [--update]` | 截图基准库管理（`.atr/snapshots/`）：dev-face 无头通道拍摄，字节+像素双档判定（字节差但像素比 ≤ 阈值 = PIXMATCH，字体抗锯齿不算回归），双图人审后 `--update` 才晋升 |
| `atelier e2e` | 浏览器回环（结构断言 + 截图 diff） |
| `atelier build [--static]` | 产物 `dist/`（静态、相对路径、零依赖）；`--static` 启用 SSG |
| `atelier package [--electron]` | 默认 Tauri 2 打包 exe；`--electron` 备选模板 |

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
