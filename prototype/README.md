# Atelier prototype（Phase 0 最小可运行单元）

> 依据 `design-decisions.md` 决策 1/2/5/6/7/8/9 的最小实现，用于验证核心机制可跑通：
> **信号内核（微任务批处理）→ 模板解释器（类 HTML DSL + scoped style + token 校验）→ 事务状态层（checkpoint/rollback/timeTravel）→ 契约校验（AtrError 四段式）→ 注册表自描述（查询面雏形）**。
> 演示页：DeepSeek 介绍（`components/`，`.atr.ts` 组件语法）。

## 运行

```bash
pnpm install     # 首次
pnpm dev         # http://127.0.0.1:5173/
```

- 注册表查询面：`GET /__atelier/registry`（组件清单/扁平 schema/源码路径）
- 文档自描述：`GET /__atelier/docs`（llms.txt 雏形）
- 流式模拟：`GET /__atelier/stream-intro`（接 `streamValue` 原语）

## 目录

```
atelier.config.json        # 语义 token 单源（决策 8）
src/
  core.ts                  # $state/$derived/$effect + store（决策 2/5）
  expr.ts                  # 模板表达式迷你求值器（零 eval，决策 12 精神）
  template.ts              # html 标签模板 + 类 HTML 解析器 + scoped style/token 校验（决策 1/8）
  primitives.ts            # streamValue / optimisticList（决策 5 三态原语）
  contract.ts              # 扁平 schema 校验 → AtrError（决策 6/9）
  component.ts             # component() 注册 + registry（决策 1/7）
  main.ts                  # 入口：token 注入 → 组件注册 → 挂载
components/
  ModelCard.atr.ts         # 示例组件（props 契约 + #if/#each + 事件）
  ModelCard.atr.md         # 组件级意图与验收（共置 spec：goal/constraints/acceptance）
  ModelCard.atr.spec.ts    # 组件可执行验收（vitest 自动收集 *.spec.ts）
  DeepSeekIntro.atr.ts     # 演示页编排层（薄壳：导航/页签/页脚）
  HeroSection / StatsStrip / ModelsSection / BenchSection / PillarsSection .atr.ts
  Panel*.atr.ts            # 实验台六个自持状态面板
vite.config.ts             # dev 插件：查询面 + 流式端点（完整 MCP 协议为下一步）
```

## 复合扩展名约定（`.atr.*` 文件族）

复合扩展名 = 文件自带的机器可读类型标签。原则：**有消费者才立扩展名**（struct 门禁 /
vitest / dev 面 / MCP 至少其一），没有消费者的类型一律不立（与 CLI 的 FULL/MINI/STUB
诚实分级同哲学）。

| 扩展名 | 层（六层模型） | 内容 | 消费者 | 状态 |
|---|---|---|---|---|
| `.atr.ts` | facts | 组件实现 + flat schema | registry / dev 面 | 落地 |
| `.atr.md` | intent | 组件级意图 + 验收清单（改组件前必读） | struct 门禁（INTENT_SPECS 识别；缺失时 WARN 给出两种落点建议） | 落地 |
| `.atr.spec.ts` | intent→机检 | 把 `.atr.md` 的机检条款写成断言，直测组件导出的真实 schema | vitest（默认 include `*.spec.ts`，零配置） | 落地 |
| `.atr.story.ts` | knowledge | 多状态定妆（每个 prop 组合一张快照基线） | 待 review/story 面落地 | 提案（暂不立，无消费者） |
| `.atr.schema.json` | facts | 组件契约外置（供无 TS 场景/跨语言消费） | 可聚合进 registry | 提案（schema 已单源于 `.atr.ts`，暂不重复） |

刻意**不立**的：`.atr.css`（违反 H3 token 单源——样式值只能来自 atelier.config.json）、
`.atr.route.ts`（框架尚无路由）。

## Tailwind 工具类层（决策 16）

样式值唯一来源仍是 `atelier.config.json`：`scripts/gen-tailwind-theme.mjs` 在 dev/build 前
把 token 派生成 `src/atelier-theme.css` 的 `@theme` 块（产物勿手改），产出**语义工具类**
（`bg-primary` / `text-muted` / `p-md` / `rounded-lg` / `bg-ok/17`…）。

- 粒度引入 `theme + utilities`，**无 preflight**——基线 reset 归 `index.html`，像素快照不受接入影响
- 护栏机检：`tests/styling-discipline.test.ts`——禁原生调色板类、禁裸颜色字面量、scoped 取色只准 token 变量
- 混合制：工具类管值；`<style scoped>` 留给 `@keyframes` / 异形渐变等逃生舱场景
- 已知边界：改 `atelier.config.json` 后需重启 dev（或 `node scripts/gen-tailwind-theme.mjs`）同步工具类
- 试点：`PanelOptimistic.atr.ts`；其余组件按混合制渐进迁移

## 原型局限（完整版各自出处）

| 原型 | 完整版 |
|---|---|
| 组件作用域用显式 `.locals()` 注入 | 编译器从 AST 闭包捕获 |
| 扁平 schema 手写在组件元数据 | 编译器从 TS 类型 AST 提取 |
| 注册表为 HTTP 查询面 | 内嵌 MCP Server（查询/操作/审计三面）+ SKILL.md |
| 运行时表达式解释求值 | 编译为直接闭包调用 |
| 事件处理须引用命名函数（`on:click={handler}`，内联箭头/任意表达式不编译） | 编译器直接生成闭包，支持内联表达式 |
| checkpoint 全量快照 | 增量 patch 事件 + 命名合并 + 源码 checkpoint（决策 15） |
