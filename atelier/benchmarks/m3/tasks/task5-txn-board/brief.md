# task5-txn-board — 跨组件状态事务（三臂同一任务书 · 加难层）

组合任务：父子组件组合 + 对象字面量 props + store 事务。在 Atelier 应用中新建
`src/components/TxnBoard.atr.ts` 与 `src/components/TxnItem.atr.ts`，要求：

1. `TxnItem`（子组件，纯展示）：schema reqProps `{ name: { type: "string" }, count: { type: "number" } }`，
   optProps `{}`；渲染 `<li>{name} ×{count}</li>`；**不得自建 $state**。
2. `TxnBoard`（父组件）：schema reqProps `{}`，optProps `{}`；
   - 内部 `$state<{ name: string; count: number }[]>` 起始为 `[{ name: "alpha", count: 1 }]`；
   - 模板 `<ul>` 内用 `{#each items as it by it.name}` 渲染子组件：
     `<TxnItem name={it.name} count={it.count} />`（对象字面量逐字段传递）；
   - 三个 `<button>`：`commit`（`store.commit("board")`）、`add`
     （整体替换引用追加 `{ name: "beta", count: 2 }`）、`rollback`（`store.rollback()`）。
3. 状态只存在于父组件（H4：子组件不得私建状态）；值必须经 `{...}` 插值渲染。

## 产出布局（attempt 目录）

```
src/components/TxnBoard.atr.ts
src/components/TxnItem.atr.ts
```

（注册表接线由评分 harness 完成：harness 会把 attempt 导出的 `TxnItem` 注册给父组件挂载。）

## react 臂 rubric（10 分制，≥8 计 pass）

- 父子组件拆分合理：子组件纯展示、状态上提（3）
- 列表按键渲染，add 后新子组件出现（2）
- commit→add→rollback 序列后界面回到 add 前（3）
- 代码可读（命名/结构）（2）
