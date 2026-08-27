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
  DeepSeekIntro.atr.ts     # 演示页（流式/乐观列表/事务/契约/派生信号）
vite.config.ts             # dev 插件：查询面 + 流式端点（完整 MCP 协议为下一步）
```

## 原型局限（完整版各自出处）

| 原型 | 完整版 |
|---|---|
| 组件作用域用显式 `.locals()` 注入 | 编译器从 AST 闭包捕获 |
| 扁平 schema 手写在组件元数据 | 编译器从 TS 类型 AST 提取 |
| 注册表为 HTTP 查询面 | 内嵌 MCP Server（查询/操作/审计三面）+ SKILL.md |
| 运行时表达式解释求值 | 编译为直接闭包调用 |
| 事件处理须引用命名函数（`on:click={handler}`，内联箭头/任意表达式不编译） | 编译器直接生成闭包，支持内联表达式 |
| checkpoint 全量快照 | 增量 patch 事件 + 命名合并 + 源码 checkpoint（决策 15） |
