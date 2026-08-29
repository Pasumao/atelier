# task3-rollback — 状态回滚（三臂同一任务书）

在 Atelier 应用中新建 `src/components/RollbackDemo.atr.ts`，要求：

1. `export const RollbackDemo = component(...)`，schema reqProps `{}` optProps `{}`。
2. 内部 `$state` 数组 `items`，初始 `["alpha"]`；渲染元素数量 `<b class="count">{items.value.length}</b>`
   与三个按钮：`commit` / `mutate` / `rollback`（文案精确匹配，小写）。
3. `commit` → `store.commit("demo")`；`mutate` → 追加 `"beta"`；`rollback` → `store.rollback()`。
4. 预期行为：commit 后 mutate（数量 +1），rollback 后数量与内容回到 commit 时点。

## 产出布局（attempt 目录）

```
src/components/RollbackDemo.atr.ts
```

## react 臂 rubric（10 分制，≥8 计 pass）

- 具备等价"快照-变更-还原"三段交互（4）
- 还原语义正确（深回到快照时点，而非仅计数）（3）
- 无控制台报错（1）
- 代码可读（2）
