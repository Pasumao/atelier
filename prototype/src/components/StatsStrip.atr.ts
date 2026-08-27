/**
 * StatsStrip.atr.ts — 实时状态条。
 * 数字全部来自活体框架：store._signals 计数、checkpoint 时间线、
 * 自描述注册表（/__atelier/registry）。refresh 作为手动 tick 触发重读全局 store。
 */
import { component, $state, $derived, html, store } from "../runtime";

export const StatsStrip = component(function StatsStrip() {
  const meta = $state<{ components?: number; primitives?: number }>({});
  fetch("/__atelier/registry")
    .then((r) => r.json())
    .then((j) => {
      meta.value = { components: j.components.length, primitives: j.primitives.length };
    })
    .catch(() => {});

  const refresh = $state(0);
  const signalCount = $derived(() => {
    refresh.value;
    return store._signals.size;
  });
  const timelineCount = $derived(() => {
    refresh.value;
    return store.list().length;
  });

  return html`
    <section class="statsbar">
      <div class="stat">
        <b class="stat__num">{signalCount.value}</b>
        <span class="stat__cap">活跃 $state 信号</span>
      </div>
      <div class="stat">
        <b class="stat__num">{meta.value.components ?? "…"}</b>
        <span class="stat__cap">注册组件</span>
      </div>
      <div class="stat">
        <b class="stat__num">{timelineCount.value}</b>
        <span class="stat__cap">checkpoint 时间线</span>
      </div>
      <div class="stat">
        <b class="stat__num stat__num--live">● LIVE</b>
        <span class="stat__cap">dev 状态桥实时上报</span>
      </div>

      <style scoped>
        .statsbar { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-md); margin-top: calc(var(--space-xl) * -0.5); position: relative; z-index: 5; }
        .stat { background: linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 94%, transparent), var(--color-surface)); border: 1px solid var(--color-surface-2); border-top-color: color-mix(in srgb, var(--color-primary) 48%, transparent); border-radius: var(--radius-lg); padding: var(--space-md); display: flex; flex-direction: column; gap: .25rem; box-shadow: 0 14px 34px -22px color-mix(in srgb, var(--color-primary) 60%, transparent); }
        .stat__num { font-size: 1.7rem; font-family: ui-monospace, monospace; color: var(--color-text); }
        .stat__num--live { color: var(--color-ok); font-size: 1.15rem; animation: pulse-dot 1.6s ease-in-out infinite; }
        @keyframes pulse-dot { 50% { opacity: .45; } }
        .stat__cap { color: var(--color-muted); font-size: .78rem; letter-spacing: .04em; }
      </style>
    </section>
  `.locals({ props: {}, meta, signalCount, timelineCount });
}, { name: "StatsStrip" });
