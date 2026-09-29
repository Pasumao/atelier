# Atelier 1.1.0 版本批设计书

> **定位**：1.0.0 → 1.1.0 的版本工程批。主体 = 把 1.0.0（2026-09-27，618 用例时点）之后并入 main 的 101 个提交（评审批 / 差距批 W1-W9 / 第三批 W10-W13 / MCP 工具族扩张批）从 git 历史提馏成版本工件；唯一新制作面 = 差距批 W4 诚实边界点名「归发布批」的 health version 注入。
> **生命周期**：批次收口后本设计书随仓库整理归档删除（git 可溯），结论去向 = CHANGELOG `[1.1.0]` 条目 + BACKLOG 归档行——FULLSTACK-DESIGN 先例。
> **设计时点**：2026-09-29 · 事实基线见 §2（全部经主智能体本机核实，非转述）。

## 1. 版本定位与语义版本判定

- **定位叙事**：1.0 = 框架形态完整（内核 / 编译器 / 全站化骨架 / 工具链）；**1.1 = 全站化 server 面从骨架到生产可用**——队列/幂等/备份/健康/持久审计/双通道鉴权/email/上传/分页/FTS5/cache/REST 读端点，外加 12 项 P1 安全加固，MCP 工具族 36→40。
- **minor 判定**：1.0 后 101 提交经 api-diff 历次门禁全为 additive（+4 mcp-tools、+`db` cli-command、+`StreamError`/`RevertErrorEntry` 导出等纯加法，零 removed/changed）→ 按决策 28（api-diff = 兼容性执行器）minor 正确，无需 major。
- **无新决策号**：版本化纪律 = 决策 28 既有；health 注入 = 差距批 W4 既有归口；design-decisions 头部「已决 0-34」不动。

## 2. 事实基线（2026-09-29 核实）

| 事实 | 现状 | 出处 |
|---|---|---|
| 版本引用面 | 四处硬编码：`atelier/package.json:4`、`mcp/mcp-definitions.json:4`（$meta.version，SERVER_INFO 真实消费方）、`cli.mjs:18` 横幅 `v1.0`、`dev/atelier-dev-plugin.mjs:505` registry meta `"v1.0"` | m12 引用面普查清单复用 |
| CHANGELOG | `[Unreleased]` 空节自 09-27 挂四批未维护；`[1.0.0]` 条目完好 | 仓库根 CHANGELOG.md |
| api-diff baseline | 仓库根 `.atelier/api-surface.json` 存在但落后 HEAD——常规 check 显示 +4 mcp-tools +`db` 全在 added 侧（additive 默认放行故 PASS） | 1.1 收口时 strict 终检红出全集 |
| health version | `health.ts` `createHandler({ version })` 装配点自报；JSDoc 自记诚实边界「不是框架版本自动探测」；模板装配现状执行时先读核实 | 差距批 W4 归口件 |
| README Known Limitations | **无过时项需出清**——journal 条目已被差距批 W5 同步为持久化口径（初判「内存环形已过时」系误判，2026-09-29 核实修正）；实际工作 = 时点刷新 + **新增** 5 条新能力 v1 边界 | README.md:115 起 |
| build 壳注入先例 | `build.mjs` 产物壳已有 `globalThis.__ATELIER_PROD__ = true` 先于 `await import` 装配（静态 import ESM 提升陷阱注释在案）——version 注入同款纪律复刻 | scripts/build.mjs:133 段 |
| 测试基线 | 875 绿 + 8 skip / check-skills 56-0 / docs-numbers PASS（tests=875 tools=40） | 2026-09-29 验收实跑 |

## 3. 任务书（五件，W-A 为唯一制作面）

### W-A health version 注入（先红后绿）

- `build.mjs` 生成产物壳时**动态读** `atelier/package.json` 的 `version`（不硬编码版本串——与 W-B 改版本号零耦合），注入 `globalThis.__ATELIER_VERSION__ = "<读出值>"`，时序在 `await import` 装配之前，与 `__ATELIER_PROD__` 同段同款。
- 模板 `templates/app/src/server/main-server.ts` 装配点改 `createHandler({ version: globalThis.__ATELIER_VERSION__ ?? null })`（执行时先读模板现状再改——现状大概率未传 version）。dev 托管路径（dev-server-host spawn 直跑）不经壳 → `null`（诚实：dev 无版本语义）。
- `server/health.ts` JSDoc 诚实边界改写：「装配点自报，不是框架版本自动探测」→「产物壳注入框架版本（build 时点动态读 package.json）；dev 托管 = null 无版本语义」。
- 红检：`tests/build-gate.test.ts` 现有产物 spawn 探活链（app.ping + 静态 index + server-status 405）追加断言——`GET <mount>/__atelier/health` 的 `version` 字段 === 框架 `package.json` 的 `version`。现状红（模板未传 → null），落地后绿。
- 边界：旧应用（未重 init/sync 模板）`globalThis.__ATELIER_VERSION__` undefined → `?? null` 照旧，零影响；vendored 按 init 时点冻结既有口径。

### W-B 版本正式化 + CHANGELOG + 形态钉（先红后绿）

- 四处版本引用翻 1.1.0 / v1.1（见 §4 清单 6-9）；文档自身版本号不随动（m12 纪律：SPEC v0.2 / ARCHITECTURE v0.2 等不改写）。
- CHANGELOG：`[Unreleased]` → `[1.1.0] - 2026-09-XX`（执行日为准），条目按面分组（安全与加固 / 数据与运维面 / Web 面能力 / AI 工具链 / 修复），每条带 git 锚点并**逐枚 `git cat-file` 核验存在**（m12 纪律；101 提交挑代表性锚点，非全列）；重建空 `[Unreleased]` 节。
- `tests/release-form.test.ts` 前两例翻 `1.1.0`（①框架版本防意外降级 `toBe("1.1.0")`；②CHANGELOG 含 `## [1.1.0]`）——先红后绿：改版本号前跑必红；第三例 `private:true` 不变。

### W-C README / 检查单 / ROADMAP 文档面

- README：①标题区版本徽章 v1.0.0→v1.1.0；②v1.0.0 自述行下补 v1.1.0 自述行（一句定位叙事）；③Known Limitations 标题时点 → 1.1.0，**新增 5 条**新能力 v1 边界（每条一句+影响+出路）：限流/登录失败锁定=单进程内存态重启清零 · jobs=单机单进程 worker 串行（5 字段 cron 未做）· email=唯一内建 transport 是 mock 记账 · 上传=单文件磁盘直写（multipart 桥缓冲不流式）· FTS=unicode61 中文整串单 token；④性能四指标复测刷新（见下）。
- 性能四指标复测：评审批 W1 动过 runtime 面（布尔属性 25 项集合 / $effect 重订阅 / bind:group 微任务时序 / bindProp 泄漏修复），m11 复测数字（gzip 12.28KB / 挂载 3.7ms / HMR 51ms / 截图 318ms）可能已移——README 性能表是唯一人工口径，发版时点必须复测，按 RELEASE-CHECKLIST ①段命令执行；**移则刷新+时点注记 1.1.0；FAIL 不粉饰不豁免**（README 原则；FAIL 则批内修或如实挂账交用户拍板）。
- RELEASE-CHECKLIST：①段 12 道复跑留痕（1.1.0 执行记录）+ **新增一道**「发版时点 `api-diff check --strict` 终检 → 人工核对新增清单与 CHANGELOG 一致 → `snapshot` 刷新基线 → 常规 check 回绿」（W-D 规矩固化，此后每次发版执行）。
- ROADMAP：§4 阶段四注记（1.1.0 完成）+ §5 D-3 状态列（版本 1.1.0 就绪）。

### W-D api-diff `--strict` 发布前终检（决策 28 首次实战，主智能体收口执行）

- 流程：`node atelier/cli.mjs api-diff check --strict` → 预期红出 1.0→1.1 全部 additive 面（+4 工具 +`db` +`StreamError` +`RevertErrorEntry` + 分页/FTS 生成器导出等）→ **人工核对红出清单与 CHANGELOG `[1.1.0]` 声称面一致**（这一步是 strict 终检的价值所在：版本工件与 API 面对账）→ `api-diff snapshot` 刷新基线 → 常规 check 回绿留痕。
- strict 红出全部 additive 是预期行为不是事故（additive 默认放行故历次常规 check 绿）。

### W-E 版本债根因关闭（流程件，并入 W-B 分支）

- 根因：`[Unreleased]` 空挂四批 = 批合并不维护 CHANGELOG。修复：`AGENTS.md` 维护纪律节加一行——**批合并时同步向 CHANGELOG `[Unreleased]` 添条目（Keep a Changelog 惯例），发版时 Unreleased 改名为版本号**；CHANGELOG 头注释同步一句。

## 4. 修改文件清单总表（18 项）

| # | 文件 | 改动 | 件 | 分支 | 耦合/风险 |
|---|---|---|---|---|---|
| 1 | `atelier/scripts/build.mjs` | 壳生成注入 `__ATELIER_VERSION__`（动态读 package.json，`__ATELIER_PROD__` 同段） | W-A | health-version | 与 W-B 改版本号零耦合（动态读） |
| 2 | `atelier/templates/app/src/server/main-server.ts` | 装配 `version: globalThis.__ATELIER_VERSION__ ?? null`（执行时先读现状） | W-A | health-version | 旧应用 undefined→null 零影响 |
| 3 | `atelier/server/health.ts` | JSDoc 诚实边界改写（产物壳注入 / dev 托管 null） | W-A | health-version | 纯注释零行为 |
| 4 | `atelier/tests/build-gate.test.ts` | 产物探活链追加 health version === pkg.version 断言（先红后绿） | W-A | health-version | — |
| 5 | `atelier/tests/release-form.test.ts` | 前两例翻 1.1.0，第三例不变 | W-B | changelog | 改版本号前必红（设计内） |
| 6 | `atelier/package.json` | `version`: 1.0.0 → 1.1.0 | W-B | changelog | 触发 §5 门禁全链 |
| 7 | `atelier/mcp/mcp-definitions.json` | `$meta.version`: 1.0.0 → 1.1.0 | W-B | changelog | SERVER_INFO 消费方；check-skills 必跑（$meta 不在工具名面，m12 历史佐证零扰动） |
| 8 | `atelier/cli.mjs` | HELP 横幅 `v1.0` → `v1.1` | W-B | changelog | — |
| 9 | `atelier/dev/atelier-dev-plugin.mjs` | registry meta `atelier: "v1.0"` → `"v1.1"`（505 行） | W-B | changelog | — |
| 10 | `CHANGELOG.md` | `[Unreleased]` → `[1.1.0]` 条目（按面分组+锚点 cat-file 核验）+ 重建空 Unreleased + 头注释（W-E） | W-B | changelog | 锚点引用 main 已并提交，分支切点后稳定 |
| 11 | `AGENTS.md` | 维护纪律加一行：批合并时维护 `[Unreleased]`（W-E） | W-B | changelog | — |
| 12 | `README.md` | 版本徽章 / v1.1.0 自述行 / Known Limitations 时点+新增 5 条 / 性能表复测刷新 | W-C | docs | 性能 FAIL 不粉饰（§3 W-C） |
| 13 | `atelier/docs/RELEASE-CHECKLIST.md` | ①段 1.1.0 复跑留痕 + 新增 strict 终检一道 | W-C | docs | — |
| 14 | `atelier/docs/ROADMAP.md` | §4 阶段四 / §5 D-3 注记 | W-C | docs | — |
| 15 | `atelier/docs/BACKLOG.md` | 批次归档行（收口时写） | 收口 | — | — |
| 16 | `atelier/docs/README.md` | 导航登记本设计书 + 状态列时点刷新 | W-C | docs | 本设计书自身登记 |
| 17 | `.atelier/api-surface.json` | `api-diff snapshot` 刷新（生成物，strict 终检后） | W-D | 收口 | — |
| 18 | README/docs-numbers 标记位 | `docs-numbers sync` 重写（tests 数随 W-A 新增用例变化） | 收口 | — | 禁手写（维护纪律） |

## 5. 执行策略（多智能体 worktree 协议）

三分支并行 + 主智能体收口：

| 分支 | 件 | 文件集（§4 清单映射） |
|---|---|---|
| `fs/v110-health-version` | W-A | #1-4 |
| `fs/v110-changelog` | W-B + W-E | #5-11 |
| `fs/v110-docs` | W-C | #12-14, 16 |

- 三分支文件集**零交集**（已核对 §4 表）；分支纪律照旧：红检先红后绿 / 分支隔离提交 / regen 幂等。
- 收口序（主智能体）：三分支合并 → W-D strict 终检+基线刷新 → RELEASE-CHECKLIST ①段复跑留痕 → #15/#18 → 全套门禁。
- 子智能体任务书直接引用本设计书 §3 对应件 + §4 对应行；跨分支契约唯一一处 = W-A 动态读 package.json（不硬编码版本串）。

## 6. 验收标准（门禁）

1. 全量测试绿（875 基线 + W-A 新增用例；release-form 翻新后 3/3）；
2. check-skills 56-0（改 mcp-definitions 后必跑——维护纪律）；
3. docs-numbers sync + check PASS；
4. api-diff strict 终检留痕（红出清单与 CHANGELOG 对账记录）+ 基线刷新后常规 check PASS；
5. CHANGELOG `[1.1.0]` 锚点逐枚 `git cat-file` 核验存在；
6. 性能四指标复测 ALL PASS（移则 README 表刷新+注记；FAIL 如实处置不豁免）；
7. `[1.1.0]` 条目与 BACKLOG 四批归档行可逐条对账（版本工件 ≠ 二次创作）。

## 7. Out of Scope（明说不进 1.1）

- npm publish 等 RELEASE-CHECKLIST ②段 9 项外部动作（发布日决策，维持 D-3 口径）；
- 评审队列 P2 精选、挂起区两实验（干扰面 P3-2 / 混合 P3-3）——1.2+ 候选；
- 任何新功能制作——W-A 是差距批明确归口件，非新开口子。

## 8. 设计修正记录

- 2026-09-29：初判「README Known Limitations 有过时项（command journal 内存环形）」经核实**不成立**——该条已被差距批 W5 同步为持久化口径；实际工作改为新增 5 条新能力边界（§3 W-C）。记录在案防止下游任务书沿误判执行。
