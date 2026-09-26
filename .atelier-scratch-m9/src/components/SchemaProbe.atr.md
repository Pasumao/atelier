# SchemaProbe — 注解即 schema 核对物组件（.atr.md 共置约定）

> 与 `SchemaProbe.atr.ts` / `SchemaProbe.atr.spec.ts` 三元共置。
> 决策 26：把「schema 编译期提取 v1」落成 starter 核对物——props 类型注解就是唯一 schema 源，
> 组件文件里【不写手写 schema 元数据】；提取→注册链路与 dev 插件注入同源同函数。

## 目标

给「注解即 schema」一个可照抄的最小范本（见 main.ts `#schema-demo` 段）：写 `(props: {...})`
类型注解即获得渲染期契约校验，无需再维护一份手写 schema——两种来源并存时手写仍优先（决策 26 ③），
因此本组件刻意不写手写件，注解链路才可见。

## 约束（决策 26 口径）

- **映射面 v1**：`string` / `number` / `boolean` / `Array<叶>` → `{type:"array",items}` /
  字符串字面量联合 → `{type:"string",enum}`；`prop?: T` → optProps、`prop: T` → reqProps。
- **越面显式拒绝 ATR-102**：泛型 / 交叉 / 工具类型 / 含非字面量成员的联合 / 嵌套对象 /
  `any` / `unknown`——fix 指路该 prop 改手写 schema（复杂类型手写不变）。
- **注解缺省**（无 `(props: {...})` 注解或参数名非 `props`）→ 静默跳过，无 schema 不校验
  （validateProps no-op）——既有组件零破坏。
- **提取器缺失**（旧应用未 sync）→ dev 注入诚实降级（warn + 跳过），组件照常渲染；
  `atelier sync` 补齐 vendor 后重启 dev 生效。
- 样式只用 token 工具类 + recipe 层（`.ppanel`），无裸颜色、无 scoped style。

## 验收清单

机检（`SchemaProbe.atr.spec.ts`，与 dev 插件注入同源同函数的端到端环）：
- [ ] 静态面：本文件含 `(props: { label: string; times?: number })` 注解且无手写 schema 元数据；
      main.ts / manifest.json / llms.txt 登记三处齐全
- [ ] 提取环：对本文件源码现算 → `extractPropsSchemas` 产出 `{SchemaProbe: FlatSchema}`
      （`label` 入 reqProps、`times` 入 optProps）
- [ ] sink 环：`registerExtractedSchemas` 注册后，registry 中 `SchemaProbe` 的 def.schema 等于
      提取产物（component() 兜底取用，opts.schema 未传）
- [ ] 校验环：嵌套元素 `<SchemaProbe label times=2>` 合法实例正常渲染（含 times>1 重复行）；
      缺 `label` 实例出 ATR-201 错误卡（P2-1 边界兜住，绝不白屏）

人工（DoD 第 4 条）：
- [ ] `pnpm dev` 打开 `#schema-demo`：标题直出 label、重复行随 times 渲染

## 状态（诚实标注）

- 【设计内已知红】提取环 / sink 环 / 校验环用例随本批交付时点为红——提取器 `extract-schema.mjs`
  在 schema 批 A 分支（`schema-scanner`）、runtime sink `registerExtractedSchemas` 在 schema 批 B
  分支（`schema-sink`）落地；红因统一为「A/B 实现件未合并」（模块解析失败 /
  `registerExtractedSchemas is not a function`）一类，非本 spec 或组件自身的缺陷。静态面当场绿。
- 【实测】模板解析（dump 冒烟）通过：`{props.label}` / `{#if props.times > 1}` 产物形态与既有
  DSL 一致（dump 尚未接提取——工件 `schema` 字段为产物流备位，决策 26 边界 v1①）。
