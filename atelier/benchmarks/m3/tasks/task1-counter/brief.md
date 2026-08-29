# task1-counter — 新组件（三臂同一任务书）

在 Atelier 应用中新建 `src/components/Counter.atr.ts`，要求：

1. `export const Counter = component(function Counter(props) { ... }, opts)`，
   opts.schema 为扁平契约：reqProps `{ start: { type: "number" } }`，optProps `{}`。
2. 内部 `$state` 从 `props.start` 起始；模板渲染当前值与一个 `<button>`（文案任意），
   点击按钮当前值 +1。
3. 值必须经 `{...}` 插值渲染（禁止手写 DOM 操作）。

## 产出布局（attempt 目录）

```
src/components/Counter.atr.ts
```

## react 臂 rubric（10 分制，≥8 计 pass）

- 组件接收 `start` 数值 prop 并作为初始值（3）
- 点击按钮数值 +1 且界面更新（3）
- 无控制台报错 / 无越权 DOM 操作（2）
- 代码可读（命名/结构）（2）
