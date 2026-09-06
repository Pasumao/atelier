# ContractProbe — 契约路径演示组件（.atr.md 共置约定）

> 与 `ContractProbe.atr.ts` / `ContractProbe.atr.spec.ts` 三元共置。
> P1-9：让 ATR-201 校验路径在 starter 里被真实锻炼——不仅测 schema 函数，还在页面
> 上真实挂一个违规实例，让错误卡成为可见的教学与验收素材。

## 目标

双实例契约演示（见 main.ts `#contract-demo` 段）：
合法实例（reqProps 齐全）正常渲染；违规实例（缺 reqProps `level`）
渲染 ATR-201 四段式错误卡——由 P2-1 组件级错误边界兜住，绝不白屏。

## 约束

- 契约 flat schema 单源：`title`、`level` 必填，`note` 可选；无泛型/宽联合。
- 样式只用 token 工具类 + recipe 层（`.ppanel`/`.btn`/`.text-muted`），无裸颜色、无 scoped style。
- 违规实例的 props 传参必须 `as never` 显式标注——违规是演示意图，不是疏忽。

## 验收清单

机检（`ContractProbe.atr.spec.ts`，`atelier test` 门禁）：
- [ ] 合法载荷通过；缺 `level` → `ATR-201` 且 fix 提及 `level`
- [ ] `level` 类型错（"2"）→ `ATR-201`
- [ ] 错误对象四段式齐备

人工（DoD 第 4 条）：
- [ ] dev 面打开 `#contract-demo`：OK 实例可 bump；违规实例位置渲染 ATR-201 错误卡而非白屏

## 状态（诚实标注）

- 【实测】spec 全绿（随模板交付时点）；页面双实例渲染以 dev 面 snapshot 人眼复核为准
