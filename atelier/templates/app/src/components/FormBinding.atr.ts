/**
 * FormBinding.atr.ts — 决策 25 bind: v1 双向绑定示例组件：`bind:value={sig}` / `bind:checked={sig}`。
 * 糖化形态（runtime 单点 bindTwoWay）= 动态 attr effect（信号 → DOM）+ 元素事件监听回写 sig.value
 * （DOM → 信号）——模板里只写一个 attr，两个方向都有。
 *
 * v1 支持面（决策 25 收窄口径，越面即 ATR-324）：
 *   - bind:value   × input（文本类）/ textarea（input 事件）+ select（change 事件）
 *   - bind:checked × input[type=checkbox|radio]（change 事件）
 * 写目标必须是**可写 $state**：$derived → ATR-305（派生只读）、非信号/语法不合法/组合不在支持面 →
 * ATR-324、同元素同 attr 重复 bind: → ATR-325。v1 显式不做：同名 radio group 多值绑定、
 * 事件修饰族（.prevent/.stop）、非表单元素双向。
 *
 * 三元共置：实现（本文件）/ 意图验收（FormBinding.atr.md）/ 机检（FormBinding.atr.spec.ts）。
 */
import { component, $state, html } from "../runtime";

export const formBindingSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
} as const;

export const FormBinding = component(function FormBinding(props: { title: string }) {
  const name = $state("Ada"); // 可写 $state —— bind: 的唯一合法目标形态
  const enabled = $state(true);
  const reset = () => {
    name.value = "Ada";
    enabled.value = true;
  };
  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <p class="text-muted text-sm">
        bind:value × input · bind:checked × checkbox——目标必须是可写 $state（$derived → ATR-305 ·
        目标非法/组合不在支持面 → ATR-324 · 重复绑定 → ATR-325）。
      </p>
      <label class="flex items-center gap-sm py-xs">
        <span class="text-md">名字</span>
        <input
          class="flex-1 bg-surface border border-surface-2 rounded-sm p-sm text-md"
          placeholder="输入即回写信号"
          bind:value={name}
        />
      </label>
      <label class="flex items-center gap-sm py-xs">
        <input type="checkbox" bind:checked={enabled} />
        <span class="text-md">通知开关（checkbox × bind:checked）</span>
      </label>
      <p class="text-md">name: {name.value} · enabled: {enabled.value ? "on" : "off"}</p>
      <button class="btn" on:click={reset}>reset</button>
    </div>
  `.locals({ props, name, enabled, reset });
}, { name: "FormBinding", schema: formBindingSchema });
