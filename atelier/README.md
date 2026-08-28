# Atelier — 框架本体（runtime + dev 面 + 模板 + AI 工具链）

> 本目录即 Atelier 框架：`runtime/` 零依赖运行时内核、`dev/` dev 面框架件（Vite 插件/无头截图/tailwind 主题生成）、`tests/` runtime 单测、`templates/app/` 应用 starter 模板、`mcp/` stdio MCP Server、`skills/` 多工具兼容技能包、`scripts/`+`cli.mjs` 工具链、`docs/` 规格文档。工具链与前端运行时**零代码耦合**：runtime 不 import 任何工具链模块，工具链仅经 HTTP dev 面 / git / 文件系统与应用交互。新应用 = `atelier init` 三步组装（模板 + runtime vendor + dev vendor），自包含可跑。
>
> 以下为 Skills 包说明（作者副本）；runtime 详见 `docs/ARCHITECTURE.md` §4，规格以 `docs/design-decisions.md` 为准。

## Agent Skills 包（多工具兼容版 v0.1）

> 为 **dsh（DeepSeek Harness）优先**、同时兼容 Anthropic Agent Skills 规范 / Claude Code / Codex / Cursor 等 SKILL.md 生态的框架技能包。
> 设计依据：`docs/SKILLS-PLAN.md`；格式约束见下。

## 形态（硬约束）

- 每个技能 = **kebab-case 目录包** `<name>/SKILL.md`（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）
- frontmatter 仅两字段：`name`（= 目录名）与 `description`（≤500 字符，含触发词）
- **无嵌套发现**：技能目录一律平铺在 `skills/` 根下，`<name>/SKILL.md` 内部不再有子技能
- 渐进披露：细节正文在各自 SKILL.md；资源文件放同目录（未来）
- 模板（AGENTS.md/llms.txt）在 `templates/`，**不属于技能**，不会进入任何工具发现目录

## 兼容矩阵

| 工具 | 识别目录 | 备注 |
|---|---|---|
| **dsh（DeepSeek Harness）** | `.dsh/skills`（P100）· `.agents/skills`（P200）· `Config.customSkillDirs`（P300）· `<dshHome>/skills`（P400）· `<agentsHome>/skills`（P500）· `DSH_BUNDLED_SKILL_DIR`（P600） | 目录包/平铺皆可；Chokidar 监视，放即用；目录 digest 变化自动刷新会话 `<available_skills>` |
| **Claude Code**（Anthropic 规范） | `~/.claude/skills/` · 项目 `.claude/skills/` · 插件 `.claude-plugin/skills/` | 目录包形态（Anthropic 官方形态一致） |
| **Codex / agents.md 生态** | `.agents/skills/` | SKILL.md 兼容（agentpack 等社区拼装） |
| **Cursor** | Agent Skills 目录（同 Anthropic 形态） | 目录包 |
| **任意 SKILL.md 工具** | 其技能/插件目录 | 目录包通用 |

## 安装（源码即库，决策 14 语义）

```bash
# 推荐单一落点：跨工具最通用的 .agents/skills/（dsh/Codex 都识别）
cp -r atelier/skills/* .agents/skills/

# dsh 专属最高优先级落点（项目级）
cp -r atelier/skills/* .dsh/skills/
```

一键安装（推荐，= `atelier init --ai` 最小实现）：双落点复制技能包 + 渲染 AGENTS.md/llms.txt + 生成 specs 骨架；**幂等**（重复运行全部 SKIP，绝不覆盖已有文件）：

```bash
node atelier/scripts/init-ai.mjs --target <项目目录> --name <项目名>
```

> 配套机器件：`mcp/mcp-definitions.json`（MCP 工具面单源，21 工具 flat schema）与 `scripts/check-skills.mjs`（一致性校验器：frontmatter/行数/命令/错误码/工具名/导入面/话术全查，exit code 可接 CI）。改动本包后必须 `node atelier/scripts/check-skills.mjs` 全绿。

> 未来框架自带 init 后保持与 `docs/` 规范零漂移（`docs/SPEC`/`ARCHITECTURE` 为命令与错误码唯一源）。

## CLI 统一入口（`cli.mjs`）

v0.1 为脚本形态：子命令命名空间与 ARCHITECTURE §8 规格对齐，各包就绪一个接管一个：

```
node atelier/cli.mjs skills install [--target <dir>] [--name <N>]     # 技能包 + MCP 配置安装（幂等）
node atelier/cli.mjs skills check                                     # 一致性校验（CI exit code）
node atelier/cli.mjs mcp                                              # stdio MCP Server
node atelier/cli.mjs checkpoint save <name> | list [--json] | rollback <id>
```

### 决策 15 源码 checkpoint（git 双轨，已交付）

- `save <name>`：**零变更拒绝**（一轮 = 一个 checkpoint，诚实优先）；自动 commit，id = 内容锚短 sha；`.atelier/checkpoints.jsonl` 时间线自身入库可审计
- `rollback <id>`：**脏树拒绝**（fix 引导先 save）；`reset --hard` 回内容锚，**backup tag 保住未来**（time-travel 回去：`git checkout <tag>`）
- **自举**：首次 save 自动 `git init`（无需预先手工建库）
- e2e 实测：baseline → junk → save → rollback 全链通过；过程中抓出并修复 **两个真实 dirty-lock 自锁 bug**（jsonl 时间线行污染工作树 → meta-commit 折叠方案）

## MCP 接入（决策 7：内嵌代理层落地）

Atelier 内置 **零依赖 stdio MCP Server**（`mcp/server.mjs`）——任何支持 MCP 的编码代理即插即用获得全部 **21 个框架工具**（工具描述由 `mcp-definitions.json` 单源自动生成）：

| 客户端 | 注册方式 |
|---|---|
| Claude Code | 项目级 `.mcp.json` → `{"mcpServers":{"atelier":{"command":"node","args":["…/atelier/mcp/server.mjs"]}}}` |
| Cursor | `.cursor/mcp.json` 同构 |
| VS Code Copilot | `.vscode/mcp.json` → `{"servers":{"atelier":{"type":"stdio",…}}}` |
| Codex CLI | `~/.codex/config.toml` → `[mcp_servers.atelier] command="node" args=[…]` |
| dsh | ⚠️ 暂无 MCP client（知识库快照证据）；替代路径：dsh-plugin `ctx.tools.register` 直连 `/__atelier/*` HTTP 面 |

- **一键**：`node atelier/scripts/init-ai.mjs --target <dir>` 默认写入前三份客户端配置（幂等 skip-if-exists；Codex 片段手工加）
- **运行前提**：dev surface 可达（默认 `http://127.0.0.1:5173`，env `ATELIER_DEV_URL` 覆盖；仅 localhost，符合安全基线）
- **行为语义**：`implemented` 工具转发 dev 面；`pending` 工具不隐藏，返回 `ATR-4xx-dev` 结构化错误 + fix 引导（代理可见完整设计面）
- **状态桥**（决策 7「状态可检视性」）：页面侧哨兵 `$effect` 读尽 `$state` 集 → flush 批次收敛后 POST `/__atelier/bridge/state` → MCP `state.snapshot` 直读缓存；`rollback()/timeTravel()` 经 notify 同通路自动跟推（回滚可观测）。v0.1 边界：仅覆盖安装时点已存在的信号集。
- **截图通道**（决策 12 视觉真相）：`/__atelier/screenshot` 由 dev 面自管瞬态无头浏览器拍当前应用页（CDP mini-client，等框架挂载断言 `#app > *` 通过才快门；并发互斥；用完即焚）。附带收益：新实例也走 bridge 上报 → 截图后 `state.snapshot` 同步刷新，检视面一致。
- **已实证**：initialize 握手 / tools:list(21, flat schema→JSON Schema 翻译) / 真实数据调用（ModelCard · tokens · **state.snapshot** 15 信号全图 · **ui.screenshot** 74KB PNG）/ ATR-401 未注册组件 / pending 错误路径

## 与工具无关的约定

- 名称即身份：`name` = 目录名 = `skill({ name })` 调用名（如 `atelier-state-transactions`）
- 默认可由 **模型与用户双面调用**；如需单面，加 frontmatter `disable-model-invocation: true`（dsh 读取）或 `user-invocable: false`
- 正文要求：示例可复制运行、命令零幻觉（以 ARCHITECTURE CLI 表为唯一源）、错误带 `fix` 行动指令、无说教段
- 更新纪律：改 `docs/SPEC`/`ARCHITECTURE` 后必须同步本包；加工具/命令/错误码 → 三处同步（CLI 表 / MCP 清单 / 对应 skill）
