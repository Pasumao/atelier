/**
 * PanelDerive.atr.ts — 实验台：$derived 派生信号 + conic-gradient 径向仪表。
 * 【决策 16】样式迁移至 .ppanel/.btn recipe + 工具类；scoped 已清空。
 * 仪表角度由派生值线性映射，样式串在 TS 侧拼好（模板动态属性整值表达式约束）。
 */
import { component, $state, $derived, html } from "../runtime";

export const PanelDerive = component(function PanelDerive() {
  const count = $state(0);
  const double = $derived(() => count.value * 2);
  // double ∈ [-30, 30] 映射到 [0°, 360°]，钳制防溢出
  const gaugeDeg = $derived(() => (Math.max(-15, Math.min(15, double.value)) + 15) * 12);
  const gaugeStyle = $derived(
    () => `background:conic-gradient(var(--color-primary) ${gaugeDeg.value}deg, var(--color-surface-2) ${gaugeDeg.value}deg)`
  );
  const bump = () => (count.value += 1);
  const resetCount = () => (count.value = 0);

  return html`
    <div class="ppanel">
      <h3 class="text-base mb-md">📊 $derived 派生信号</h3>
      <div class="flex items-center gap-lg flex-wrap">
        <div class="gauge w-[130px] h-[130px] rounded-full grid place-items-center relative transition-[background] duration-[450ms]" style={gaugeStyle.value}>
          <span class="absolute inset-3 rounded-full bg-surface border border-surface-2"></span>
          <b class="relative z-[1] text-4xl font-mono">{count.value}</b>
        </div>
        <div class="text-muted text-sm flex flex-col gap-[.2rem]">
          <p>计数 <b class="text-primary">{count.value}</b></p>
          <p>派生 ×2 <b class="text-primary">{double.value}</b></p>
          <p>仪表角度 = 派生值线性映射（只读，手写缓存视为违例）</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-sm mt-md">
        <button class="btn btn-primary" on:click={bump}>+1</button>
        <button class="btn btn-ghost" on:click={resetCount}>归零</button>
      </div>
    </div>
  `.locals({ props: {}, count, double, bump, resetCount, gaugeStyle });
}, { name: "PanelDerive" });
