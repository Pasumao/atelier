/**
 * PanelDerive.atr.ts — 实验台：$derived 派生信号 + conic-gradient 径向仪表。
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
      <h3 class="ppanel__title">📊 $derived 派生信号</h3>
      <div class="gauge-wrap">
        <div class="gauge" style={gaugeStyle.value}><b class="gauge__val">{count.value}</b></div>
        <div class="gauge-readout">
          <p>计数 <b class="accent">{count.value}</b></p>
          <p>派生 ×2 <b class="accent">{double.value}</b></p>
          <p>仪表角度 = 派生值线性映射（只读，手写缓存视为违例）</p>
        </div>
      </div>
      <div class="ppanel__actions">
        <button class="pbtn pbtn--primary" on:click={bump}>+1</button>
        <button class="pbtn pbtn--ghost" on:click={resetCount}>归零</button>
      </div>

      <style scoped>
        .ppanel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md) var(--space-lg); animation: panel-in .25s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        .ppanel__title { font-size: 1rem; margin-bottom: var(--space-md); }
        .ppanel__actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-md); }
        .pbtn { display: inline-block; border: 0; border-radius: var(--radius-sm); padding: .52rem 1rem; cursor: pointer; font-size: .85rem; font-weight: 600; transition: transform .15s, box-shadow .15s; }
        .pbtn--primary { background: var(--color-primary); color: var(--color-bg); }
        .pbtn--primary:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--color-primary) 80%, transparent); }
        .pbtn--ghost { background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); font-weight: 400; }
        .gauge-wrap { display: flex; align-items: center; gap: var(--space-lg); flex-wrap: wrap; }
        .gauge { width: 130px; height: 130px; border-radius: 50%; display: grid; place-items: center; transition: background .45s cubic-bezier(.22,.9,.28,1); position: relative; }
        .gauge::after { content: ""; position: absolute; inset: 12px; border-radius: 50%; background: var(--color-surface); border: 1px solid var(--color-surface-2); }
        .gauge__val { position: relative; z-index: 1; font-size: 1.9rem; font-family: ui-monospace, monospace; }
        .gauge-readout { color: var(--color-muted); font-size: .86rem; display: flex; flex-direction: column; gap: .2rem; }
        .accent { color: var(--color-primary); }
      </style>
    </div>
  `.locals({ props: {}, count, double, bump, resetCount, gaugeStyle });
}, { name: "PanelDerive" });
