# Atelier 技术缺口与改进 Backlog（2026-08-30 精简版）

> 本文件是缺口与改进队列唯一源。原始逐项规格与验收明细（P0-1~P0-8 / P1-1~9 / P2-1~6）已按
> 「完成即合并」原则归档，需要回溯时看 git 历史（精简前版本锚点：checkpoint `ff35100` 之前的提交）。

## 已完成（合并归档 · 2026-08-27 ~ 08-30 backlog-blitz 全清）

- **内核与编译器**：信号内核（deliver 双策略调度，修同步失效缺陷）· keyed each · Template AST 缓存 ·
  编译器三分期（dump→codegen，golden DOM 对拍，未知节点显式拒绝）· expr fuzz 差分对拍（抓出 ‖/&& 值语义
  bug）· 43 项 vitest。
- **dev 面**：SSE 命令下行 + ack · HMR 保态（51ms，$state 不清零）· 截图常驻实例（~300ms）·
  像素对比三档（MATCH / PIXMATCH / MISMATCH）· token 门禁 · audit JSONL。
- **M3 实验台**：三臂对照 45/45 收官（noskill 100% / skill 93.3% / react 100%；skill 的 −6.7pt 是注释正则
  误伤，修订评分器后三臂 15/15 全平）→ `results/WAVES-1-5-REPORT.md`。定论：天花板效应，核心假设待
  加难任务层；基础设施事件与 prompt 污染处置均如实入档。
- **工具链**：MCP 21/21 接线（stdio E2E）· review UI 最小版（timeline + 双图并排 + 判定写回）· CI 矩阵
  workflow · 结构六层检查 · checkpoint「未检不锚」门禁 · 决策 14 卫生化。
- **P0-8 评分器与 footgun 修复**：硬禁检查剥注释（双向 fixture，注释提及 PASS / 真用 FAIL）·
  expr 三路 ATR-301 前置报错（顺带修掉函数调用静默丢尾）· store 快照按引用语义三层护栏
  （runtime JSDoc + 应用模板守卫测试 + 技能包同步）。
- **性能四指标**：gzip 6.25KB / 10³ 节点挂载 2–3ms / HMR 51ms / 截图回环 ~300ms——全达标。
- **路线决策（2026-08-30，用户定论）**：技能包是核心竞争力、保留；先壮大框架功能（F 线），与 React 的
  对照对决后置。

### 已完成（2026-08-30 · ROADMAP 阶段一推进，会话归档）

- **P1-2 / F-4 覆盖扩张第一批**：`{:else if}` 链（解析期多分支，发射器泛型零改自动双路径覆盖）·
  HTML void 元素 13 种（修复 `<img>` 吞后续兄弟节点缺陷）· 未闭合结构解析期显式拒绝（**ATR-101** 四段式：
  编译路径构建期抛 / 解释器路径错误卡 / dump CLI 可行动报错）· `{:else}` 消费长度缺陷修复（`}` 漏进分支文本，
  parity 同源抓不到、快照回归补位）。dump/codegen CLI 端到端 smoke 通过。
- **P1-3 / F-3 样式纪律第二期（决策 16）**：token 新增 `font` 组（runtime `--font-*`，Tailwind `--text-*`
  定义即覆盖原生刻度=字号单源）+ `space.xs`；守卫 R4（间距只准 `var(--space-*)`/calc·无单位系数/0/auto）+
  R5（font-size 只准 `var(--font-*)`；text-* 刻度类只准 font 键）；扫描面扩到 recipe 层并全量迁移；
  starter 脚手架端到端 18/18 + R4 负例红检实证。
- **P1-5 设计备忘三项**：schema 扩 min/max/pattern（扁平红线不动，+6 用例）· confirm `deny` 闸
  （`mcp/confirm.mjs` 单点执行，破坏性回滚族 deny=ATR-402 结构化拒绝，stdio e2e 实证；ask 档暂同 auto 诚实标注；
  负例规格 `specs/guardrails.md` init 常驻生成）· `checkpoint save` 测试门禁（未检不锚测试半边闭环，
  首次保存即自验证生效）。
- **P1-4 尾巴清理（同日第二批）**：`atelier review` STUB→MINI（dev 面 review UI 指路 + token 探活 + `--open`，
  三路径实测）· `atelier sync` 新命令（vendor 同步，覆盖/补种/依赖漂移提示三效应实证）· HMR 第三边界关闭
  （`__effectSink` + `disposeInstance`，依赖图不翻倍实证；shim 补 isConnected）· CI snapshot-smoke 本地等价
  全流程通过（真实浏览器 baseline → MATCH → test+snapshot 双门禁锚定 `0ba332e`；真实 CI 首跑待 push 远端）。
- **P1-2 / F-4 第二批（同日第三批工作）**：表达式**对象/数组字面量**纵向打通（`{{a: x.value}}` / `[a, b]` /
  `{a}` 简写 / `({...}).x` 后缀链）· 配对花括号解析（引号感知，属性值 `attr={{a:1}}` 同步支持）·
  **错位/游离闭合标签显式拒绝**（此前静默吞掉甚至截断余下模板）· 字面量花括号并入文本（此前静默丢弃）·
  对象键不进静态依赖清单。P0-8 前置报错语义保持。10 新用例，84/84 绿；CLI + 脚手架 sync 后回归通过。
- **度量**：框架 vitest 53 → 84 · check-skills 31/0 · checkpoint 锚点 `0c3636a`(F-2一期) → `80a6005`(F-4一批)
  → `bcca740`(F-3) → `16b8858`/`94db6cb`(P1-5) → `6538ee1`(文档整理) → `69a1a5d`(P1-4)。
- **附带发现**：checkpoint.mjs 仓库发现只认 cwd 下 `.git`，子目录运行会误建嵌套仓（已记入尾巴区；
  AGENTS.md 命令行已加"仓库根运行"提示）。

## 活跃队列

### F 线 — 功能债（决策书承诺未兑现，壮大框架的主菜）

> ROADMAP 阶段一抄送（2026-08-30 计划书批准）：R-1=P1-1（F-2 一期 ✅）· R-2=P1-2（F-4）· R-3=P1-3（F-3）；
> 设计备忘区=P1-5（R-5）；尾巴区=P1-4（R-4）。执行状态以本文件为准。

| # | 项 | 内容 | 估量 |
|---|---|---|---|
| F-1 | **事务层完整版（决策 5）** | ✅ **第一期落地（2026-08-30）**：命名合并（同名栈顶幂等锚定，rollback 回到本轮前）+ 增量 patch 事件日志（journal，有界环形可关）+ 依赖图可查询（`store.graph()`，dispose 即注销）。6 用例实证（含 limit 调小裁剪、跨名不合并、derived 出现在依赖边）。诚实边界：恢复仍走全量快照（正确性锚点）；MCP 暴露 graph/log 待接线。**剩余**：无（本期范围全清）；后续增强=回放恢复/编译期静态化归 F-2 | ✅ |
| F-2 | **编译器静态依赖图（决策 3）** | 🔄 **第一期落地（2026-08-30）**：`exprRootIdents`（与求值器同 tokenizer）+ codegen 收集器发射 `deps: {reactive, mount, events}` 清单（compileFunction/compileModuleSource/CLI 产物三处生效）；差分对拍实证两条不变式（追踪集⊆静态集 200 样本；无短路等号 100 样本，钩子 `__withTracking`）。**语义边界**：清单=语法级超集（含未执行分支，{:else if} 链各分支 test 同样入集）。**剩余**：二期=利用清单做跳过追踪快路径 / prod 剥离 / MCP 构建期图查询 | 二期 L |
| F-3 | **样式纪律收紧（决策 16）** | ✅ **落地（2026-08-30）**：一期颜色纪律 R1/R2/R2b/R3（既有）；**二期间距/字号**——token 新增 `font` 组（runtime `--font-*`，Tailwind `--text-*` 覆盖原生刻度=字号单源）+ `space.xs`；护栏 **R4**（间距只准 var(--space-*) 组合 / calc·无单位系数 / 0 / auto）+ **R5**（font-size 只准 var(--font-*)；text-* 刻度类只准 font 键），扫描面扩到 recipe 层并全量迁移 token。诚实边界：index.html reset 豁免、border/line-height/letter-spacing/阴影变换内长度不辖、radius 纪律留候选。starter 脚手架端到端 18/18 + R4 负例红检实证 + check-skills 31/0 | ✅ |
| F-4 | **codegen 覆盖扩张** | ✅ **两批落地（2026-08-30）**：**第一批**——`{:else if}` 链（解析期多分支，发射器泛型零改双路径覆盖）；HTML void 元素 13 种（修复 `<img>` 吞后续兄弟缺陷）；未闭合结构解析期显式拒绝（**ATR-101**：编译构建期抛/解释器错误卡/dump CLI 可行动报错）；`{:else}` 消费长度缺陷修复。**第二批**——表达式**对象/数组字面量**（`{{a: x.value}}`/`[a, b]`/`{a}` 简写/`({...}).x` 后缀链，expr.ts 求值器同步扩充）；配对花括号解析（引号感知 matchBrace，属性值同步支持 `attr={{a:1}}`）；**错位/游离闭合标签显式拒绝**（此前静默吞掉甚至截断余下模板）；字面量花括号原样并入文本（此前静默丢弃）；对象键不进静态依赖清单（exprRootIdents 上下文判别）。P0-8 前置报错语义保持（配对即表达式，非法内容 bind 期响亮 ATR-301）。golden parity 18 新用例，84/84 绿。**剩余**：属性级指令（on:/bind: 族）= 新方向候选，需先出设计 | ✅ |

### 设计备忘（半天级，按需触发）

- ✅ **三项全清（2026-08-30，P1-5）**：
  - schema 扩 min/max/pattern（`runtime/contract.ts`：number 数值界 / string 长度界+pattern（JSON Schema 非锚定语义）/ array 长度界；无效 pattern 显式报错；**扁平红线不动**）+ 6 用例；
  - confirm 三档 `deny` 执行点落地：`mcp/confirm.mjs`（单一执行点，破坏性=回滚族三工具）→ MCP stdio e2e 实证 deny=ATR-402 结构化拒绝、auto/缺省放行；**诚实边界：ask 档暂同 auto**（stdio 无人工审批通道）；负例规格进 `specs/guardrails.md`（init 常驻生成）+ 框架测试 mcp-confirm.test.ts；
  - 决策 15 gate 接线：`checkpoint save` 新增**测试门禁**（定位 package.json test 脚本：应用根/框架仓两布局，pnpm 退 npm；红=拒绝锚定；`--no-gate`/`ATELIER_TEST_GATE=off` 逃生）——MCP source_commit 同路径生效，「未检不锚」测试半边闭环（快照半边仍待 baseline 武装）。

### 尾巴（诚实标注的已知项）

- ~~已存在应用需重新 vendor 同步~~ ✅ **已处置（2026-08-30，P1-4）**：新增 `atelier sync [--target <dir>]`
  （scripts/sync-project.mjs）——runtime 全量覆盖 + dev 面三件覆盖 + specs 模板补种（skip-if-exists）+ 依赖漂移提示；
  实证：覆盖污染的 vendored core.ts 恢复框架真相、补种 guardrails.md。
- HMR 三边界（P1-4 处置）：①~~旧 effects 不逐个 dispose~~ ✅ **已关闭**（`__effectSink` 收集 + `disposeInstance`
  逐个注销，依赖图不翻倍 2 用例实证；dom-shim 补 isConnected 语义）；②模板结构大改时按序还原可能错位——
  **保留为已文档化启发式**（无信号身份可比对，正确修复需编译器闭包捕获，归 F-2 二期后再评估）；
  ③跨交换 checkpoint 不回落新信号——**保留为已文档化边界**（信号引用随换实例失效）。
- CI snapshot-smoke：**本地等价验证通过（2026-08-30）**——scaffold→install→dev→snapshot save→check(MATCH)→
  dirty 文件→gated checkpoint save 锚定成功（test gate + snapshot gate 双门禁首跑）；真实 CI 首跑仍待 push
  远端（本仓尚无 git remote）。`atelier review` CLI ✅ **已从 STUB 转 MINI**（指路 dev 面 review UI + token
  探活 + `--open` 开页，三路径实测）。
- P1-9 baseline.png 视觉复核留待用户（`.dsh-trash/smoke-app/.atr/snapshots/`）；
- checkpoint.mjs 仓库发现只认 cwd 下的 `.git`（不做向上查找）：在 `atelier/` 子目录跑会误引导嵌套 git 仓
  （2026-08-30 实证，已手动清理；AGENTS.md 已加"仓库根运行"提示），候选修法=cwd 无 `.git` 时向上 `rev-parse` 找根；

### 挂起区（等 F 线里程碑后启动）

- M3 加难任务层 task4-6（候选见 `benchmarks/m3/results/WAVES-1-5-REPORT.md` §4）；
- 干扰面实验（不给源码只给 CLI/错误输出）——技能包价值（核心竞争力）的决定性检验。
