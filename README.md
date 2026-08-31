# Atelier — 为 AI 编程代理设计的前端框架

> **定位一句话**：不参与"更快渲染"的主流竞赛；下注"当编码代理成为前端第一类使用者，框架应内建契约、检视、恢复与结构公理"。
> 备选 slogan（待定稿）：意图进，界面出 / *Intent in, interface out.*
>
> 本工作区即框架仓库（script-form v0.2）。框架规格见 `atelier/docs/`；缺口与改进队列 = `atelier/docs/BACKLOG.md`；路线计划 = `atelier/docs/ROADMAP.md`；常用命令 = `AGENTS.md`。

## Why：AX（Agentic Experience）是新的第一公民

主流框架在 2026 年把 agent 基建当**外挂**补上（AGENTS.md 生成器、MCP 检视插件、agent 检测 dev server）——已成为及格线。Atelier 的路径不同：把 agent 当**第一类使用者**，从框架第一行开始内建它需要的东西——机器可读契约、可检视状态、双轨可逆、机检门禁。对应的新词汇：**AX**（Agentic Experience，相对 UX）、**agentic engineering**（相对 frontend engineering）。框架本体就是 agent 最佳实践的框架化实现，而不是另一份文档。

## 四无人区（对比 2026-08 全量扫描后仍独占；每条按四段式自检：主张/机制/实测/复现）

**① 扁平 schema 一份三用** —— 同一个 `{reqProps, optProps}` 扁平形态同时充当组件契约（`validateFlat`，错误 ATR-201/204/205 四段式）、MCP 工具参数（`mcp-definitions.json` 单源生成 tools/list）、注册表白名单渲染校验。无 $ref/oneOf，代理不猜。
实测：框架 93 用例 vitest 全绿（契约/守卫/对拍在内）；24 工具单源接线，check-skills 56/0。
复现：`node atelier/scripts/check-skills.mjs` · `atelier/pnpm test`。

**② 事务状态层 + 双轨回滚** —— 应用状态：命名合并 checkpoint（同名栈顶幂等=轮级回滚）+ 增量事件日志（journal）+ 依赖图查询（`store.graph()`/journal 已接进 MCP）；源码：决策 15 git 源码锚，「未检不锚」双门禁（测试绿 + 快照 MATCH 才许锚定）。破坏性操作过 `agent.confirm` 三档（deny = ATR-402 结构化拒绝）。
实测：事务层与 confirm 闸有专项用例；stdio 快乐径 e2e 实证活页面返回依赖图。
复现：`node atelier/cli.mjs checkpoint save "..."`（看门禁输出）· `atelier/pnpm test`。

**③ 六层结构公理机检开箱即用** —— `atelier struct check` 六层 OK-WARN-ERROR 分级；「不假红」纪律：ERROR 对应真实缺陷。
复现：`node atelier/scripts/struct.mjs check atelier/templates/app`。

**④ 可执行意图规格（spec = executable test）** —— 规格用 EARS 记法（WHEN/IF/WHILE/WHERE … THE SYSTEM SHALL …），每条验收语句落点为 `.atr.spec.ts` 命名用例；`specs/constitution.md`（H1-H6 宪法）+ `guardrails.md`（deny 档等常驻负例）随脚手架分发。对位 Spec Kit 的英文不可执行规格——规格在这里是测试。
复现：`node atelier/cli.mjs init --target /tmp/app --name App` 后查看 `/tmp/app/specs/`。

## 与标准对齐（地板，不是卖点）

AGENTS.md（6 万+ 项目）· Agent Skills（agentskills.io 格式门禁，S 检查 100% 过）· MCP（24 工具；structured error = `structuredContent{code,message,fix}`；`ATELIER_TOOLSETS` 按 face 分组）· W3C DTCG 令牌互导（`atelier tokens export|import`）· 无障碍树快照（`ui.a11y`，语义优先于像素）· agent 体检（`/__atelier/agent-health`，UA 分类台账）。

## 性能基线（SPEC §7，`atelier bench` 实测 2026-08-30 / Windows / Node 24）

| 指标 | 目标 | 实测 | 判定 |
|---|---|---|---|
| 核心运行时体积 | gzip ≤ 30 KB | **8.54 KB** | PASS |
| 10³ 节点挂载+首渲染 | ≤ 50 ms | **4.5 ms** | PASS |
| HMR（保存→可见） | ≤ 100 ms | **62 ms**（保值热交换，$state 不清零） | PASS |
| 截图回环 | ≤ 500 ms | **421 ms**（常驻无头实例） | PASS |

复现：`node atelier/cli.mjs init --target /tmp/app --name App && cd /tmp/app && pnpm install && node <repo>/atelier/cli.mjs bench --app /tmp/app`。
诚实性：FAIL 不粉饰、不豁免，按 SPEC §7 自动转 P0 工单；数字会随修复移动（HMR 曾 108ms FAIL→保值热交换后 PASS；截图曾 1933ms FAIL→常驻实例后 PASS）。

## Quick start

```bash
node atelier/cli.mjs init --target my-app --name MyApp   # 三步组装：模板 + runtime vendor + dev vendor
cd my-app && pnpm install && pnpm dev                     # http://127.0.0.1:5173
node <repo>/atelier/cli.mjs skills install --target . --name MyApp   # 技能包双落点 + specs 骨架
node <repo>/atelier/mcp/server.mjs                        # 24 工具 MCP（ATELIER_PROJECT_ROOT=应用目录）
```

## 诚实纪律（引用本仓库任何数字前先读这段）

- **正确率主张**：M3 三臂对照实验在简单任务层全平（天花板效应）。在加难任务层落地前，我们不引用任何"首遍正确率"数字——请引用者同样克制。
- CLI 命令三级诚实标注 FULL / MINI / STUB，STUB 永不伪造成功（exit 4 + spec 指路）。
- 所有"未确认"结论明确标注，不写成事实；checkpoint 锚定前强制过测试+快照双门禁。
