# ModelCard — 组件意图与验收（.atr.md 共置约定）

> 本文件是组件级 intent：人类意图 + 验收清单，与组件实现（`ModelCard.atr.ts`）
> 和可执行验收（`ModelCard.atr.spec.ts`）三元共置。改组件前先读这里；
> 改了契约必须同步三处（实现 / 本文件 / spec），struct 门禁会检查本文件存在。

## 目标

模型卡片：展示一个 DeepSeek 端点/系列的名称、定位标签、一句话简介、要点列表，
并可展开查看 API endpoint。是本仓组件模型（决策 1/6/8）的示范实现。

## 约束

- 契约为 flat schema 单源：`name/badge/tagline/highlights` 必填，
  `endpoint/accent` 可选；`accent` 是字面量判别式（`primary|ok|warn`），禁宽联合。
- 样式只准 `var(--token)`（H3）；组件自带 `<style scoped>`。
- 动态属性只接受整值表达式：拼串在 TS 侧用 `$derived` 完成。

## 验收清单

机检（`ModelCard.atr.spec.ts`，`atelier test` 门禁）：
- [x] 合法载荷通过；缺必填/类型错/数组元素错 → `ATR-201`
- [x] `accent` 违反枚举 → `ATR-201` 且 fix 列出合法值
- [x] 非对象输入 → `ATR-205`
- [x] 错误对象四段式齐备（code/message/context/fix）

人工（DoD 第 4 条，snapshot 必须人眼复查）：
- [ ] 四种 accent 顶部光带颜色区分可见（primary 蓝 / ok 绿 / warn 金）
- [ ] 悬停浮起 + 边框变色；endpoint 展开有进场动画

## 状态（诚实标注）

- 【实测】spec 全绿（2026-08-27，vitest 36/36 时期）
- 【假设】endpoint 缺省推断 `api.deepseek.com/<name>` 对所有模型成立——新卡片接入前需人工确认
