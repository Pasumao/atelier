# FormBinding — bind: v1 双向绑定演示组件（.atr.md 共置约定）

> 与 `FormBinding.atr.ts` / `FormBinding.atr.spec.ts` 三元共置。
> 决策 25：把属性级指令 v1（`bind:value` / `bind:checked` 双向绑定）落成 starter 示例——
> 模板里一个 attr，信号 → DOM 与 DOM → 信号两个方向都由 runtime 单点 bindTwoWay 承担。

## 目标

表单双向绑定起点范本（见 main.ts `#form-demo` 段）：文本框输入即回写 `name` 信号、
checkbox 勾选即翻转 `enabled` 信号，插值行实时展示两信号——照这个样子写自己的表单绑定。

## 约束（决策 25 口径）

- **支持面**：`bind:value` × input（文本类）/ textarea（input 事件）+ select（change 事件）；
  `bind:checked` × input[type=checkbox|radio]（change 事件）。越面组合 → ATR-324。
- **写目标必须是可写 `$state`**：`$derived` → ATR-305（渲染期前置拦截出错误卡）、
  非信号 / 语法不合法 / 元素-attr 组合不在支持面 → ATR-324、同元素同 attr 重复 bind: → ATR-325。
- **v1 显式不做**：同名 radio group 多值绑定、事件修饰族（.prevent/.stop，候选后置）、非表单元素双向。
- 无回环：程序化 `el.value=` 赋值不触发 input/change 事件（DOM 规范）→ 信号写 DOM 不会倒灌回信号。
- 样式只用 token 工具类 + recipe 层（`.ppanel`/`.btn`），无裸颜色、无 scoped style。

## 验收清单

机检（`FormBinding.atr.spec.ts`，dom-shim 走真实 mountComponent 渲染路径）：
- [ ] 静态面：渲染产物含文本 input 与 `type="checkbox"` 两个 input 元素；解析产物 `bind:` 属性即契约载体（`{name:"bind:value", value:"name", dynamic:true}` 形态，解析器零改动）
- [ ] 初始同步：挂载后 input.value / checkbox.checked 等于信号初值
- [ ] 双向 roundtrip（value）：input 事件回写 name 信号；name.value 写入回传 input 值
- [ ] 双向 roundtrip（checked）：change 事件回写 enabled 信号；enabled.value 写入回传 checked

人工（DoD 第 4 条）：
- [ ] `pnpm dev` 打开 `#form-demo`：输入/勾选即时反映到插值行；reset 按钮恢复初值且控件跟着回位

## 状态（诚实标注）

- 【设计内已知红】行为面用例（初始同步 + 双向 roundtrip）随本批交付时点为红——runtime 单点
  bindTwoWay 在 bind 批 A 分支（`bind-m9-runtime`）落地，红因统一为 `bindTwoWay 支撑未落地`
  一类；静态面当场绿。
- 【实测】模板解析（dump 冒烟）通过：`bind:` 产物形态与决策 25 契约载体一致。
