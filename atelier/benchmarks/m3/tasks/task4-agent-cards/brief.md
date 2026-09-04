# task4-agent-cards — 工具调用卡片（三臂同一任务书 · 加难层）

组合任务：流式输入 + 嵌套作用域 + keyed each。这是 agent 场景的核心视图：工具调用的
流式到达、按 id 稳定复用卡片、状态徽标区分。在 Atelier 应用中新建
`src/components/ToolCallPanel.atr.ts`，要求：

1. 模块导出 `runDemo(): StreamValue<string>`：返回一个 `streamValue<string>()`，
   依次 push 恰好这三行 JSON 后 `finish()`：
   - `{"id":"t1","name":"search","status":"done"}`
   - `{"id":"t2","name":"read","status":"running"}`
   - `{"id":"t3","name":"write","status":"error"}`
2. `export const ToolCallPanel = component(function ToolCallPanel(props) { ... }, opts)`，
   opts.schema 为扁平契约：reqProps `{ stream: { type: "object" } }`，optProps `{}`。
3. 组件内部把 `props.stream.values`（JSON 行数组）经 `$derived` 解析为
   `{ id, name, status }[]`（解析失败行丢弃），再用 `{#each calls as c by c.id}` 渲染卡片：
   - 每卡一个 `<div class="call">`，内含 `<b>{c.name}</b>`；
   - 状态徽标用 `{#if}/{:else if}` 链：`status === "done"` → 文本 `✓`，
     `status === "error"` → 文本 `✗`，其余（running）→ 文本 `⏳`。
4. 值必须经 `{...}` 插值渲染（禁止手写 DOM 操作）；允许 `import { streamValue } from "../runtime"`。

## 产出布局（attempt 目录）

```
src/components/ToolCallPanel.atr.ts
```

## react 臂 rubric（10 分制，≥8 计 pass）

- 流式数据正确解析为结构化卡片，逐条到达即可见（3）
- 按 id keyed 渲染：乱序流中卡片顺序与流一致（2）
- 三种状态徽标正确区分（2）
- 无控制台报错 / 无越权 DOM 操作（2）
- 代码可读（命名/结构）（1）
