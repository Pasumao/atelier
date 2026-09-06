# HelloCard — 组件意图与验收（.atr.md 共置约定）

> 本文件是组件级 intent：人类意图 + 验收清单，与组件实现（`HelloCard.atr.ts`）
> 和可执行验收（`HelloCard.atr.spec.ts`）三元共置。改组件前先读这里；
> 改了契约必须同步三处（实现 / 本文件 / spec）。

## 目标

starter 示例卡片：展示标题、一行说明和一个点击计数按钮。
是新项目组件模型（决策 1/6/8）的起点范本——照这个样子写自己的组件。

## 约束

- 契约为 flat schema 单源：`title` 必填，`start` 可选；无泛型/宽联合。
- 样式只用 token 派生工具类 + atelier-ui.css recipe（`.ppanel`/`.btn`），无裸颜色。
- 状态显式 `$state`，事件处理具名函数，无隐式全局。

## 验收清单

机检（`HelloCard.atr.spec.ts`，`atelier test` 门禁）：
- [ ] 合法载荷通过；缺 `title` → `ATR-201` 且 fix 列出可用属性
- [ ] `start` 类型错 → `ATR-201`
- [ ] 错误对象四段式齐备（code/message/context/fix）

人工（DoD 第 4 条，snapshot 必须人眼复查）：
- [ ] 点击按钮计数递增，按钮 hover 浮起
- [ ] 面板圆角/边框/内边距符合 token（改 atelier.config.json 即全局变）

## 状态（诚实标注）

- 【实测】spec 全绿（随模板交付时点）
