# task2-stream — 流式卡片（三臂同一任务书）

在 Atelier 应用中新建 `src/components/StreamCard.atr.ts`，要求：

1. `export function runDemo(): StreamValue<string>` —— 用框架的 `streamValue()` 创建流，
   依次 `push("正在检索")`、`push("已找到 3 条")`、`push("完成")`，然后 `finish()`。
2. `export const StreamCard = component(...)`，schema reqProps `{ stream: { type: "object" } }`：
   渲染 `props.stream` 的已收到的分段（`values`），`done` 为真时追加"✓"标记。
3. **硬禁**：不得出现 `setInterval`/`setTimeout` 手写打字机（框架规则：流式渲染只走 streamValue）。

## 产出布局（attempt 目录）

```
src/components/StreamCard.atr.ts
```

## react 臂 rubric（10 分制，≥8 计 pass）

- 流数据结构与渲染分离，无轮询 hack（3）
- 逐段追加渲染 + 完成态标记（3）
- 无 setInterval 打字机（2）
- 代码可读（2）
