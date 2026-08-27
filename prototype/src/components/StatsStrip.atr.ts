/**
 * StatsStrip.atr.ts — 实时状态条。
 * 【决策 16】样式迁移至工具类；pulse-dot keyframe 收口至 atelier-ui.css。
 * 数字全部来自活体框架：store._signals 计数、checkpoint 时间线、
 * 自描述注册表（/__atelier/registry）。refresh 作为手动 tick 触发重读全局 store。
 */
import { component, $state, $derived, html, store, devFetch } from "../runtime";

export const StatsStrip = component(function StatsStrip() {
  const meta = $state<{ components?: number; primitives?: number }>({});
  devFetch("/__atelier/registry")
    .then((r) => r.json())
    .then((j) => {
      meta.value = { components: j.components.length, primitives: j.primitives.length };
    })
    .catch(() => {});

  const refresh = $state(0);
  // _checkpoints 是普通数组（不可响应），派生只依赖 refresh tick；
  // 挂载后补一拍，让 main.ts 的 session-start 进时间线计数。
  setTimeout(() => {
    refresh.value += 1;
  }, 350);
  const signalCount = $derived(() => {
    refresh.value;
    return store._signals.size;
  });
  const timelineCount = $derived(() => {
    refresh.value;
    return store.list().length;
  });

  return html`
    <section class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-md -mt-5 relative z-[5]">
      <div class="stat flex flex-col gap-1 rounded-lg border border-surface-2 border-t-primary/48 bg-surface p-md shadow-[0_14px_34px_-22px_color-mix(in_srgb,var(--color-primary)_60%,transparent)]">
        <b class="text-[1.7rem] font-mono">{signalCount.value}</b>
        <span class="text-muted text-xs tracking-tight">活跃 $state 信号</span>
      </div>
      <div class="stat flex flex-col gap-1 rounded-lg border border-surface-2 border-t-primary/48 bg-surface p-md shadow-[0_14px_34px_-22px_color-mix(in_srgb,var(--color-primary)_60%,transparent)]">
        <b class="text-[1.7rem] font-mono">{meta.value.components ?? "…"}</b>
        <span class="text-muted text-xs tracking-tight">注册组件</span>
      </div>
      <div class="stat flex flex-col gap-1 rounded-lg border border-surface-2 border-t-primary/48 bg-surface p-md shadow-[0_14px_34px_-22px_color-mix(in_srgb,var(--color-primary)_60%,transparent)]">
        <b class="text-[1.7rem] font-mono">{timelineCount.value}</b>
        <span class="text-muted text-xs tracking-tight">checkpoint 时间线</span>
      </div>
      <div class="stat flex flex-col gap-1 rounded-lg border border-surface-2 border-t-primary/48 bg-surface p-md shadow-[0_14px_34px_-22px_color-mix(in_srgb,var(--color-primary)_60%,transparent)]">
        <b class="text-[1.15rem] font-mono text-ok animate-[pulse-dot_1.6s_ease-in-out_infinite]">● LIVE</b>
        <span class="text-muted text-xs tracking-tight">dev 状态桥实时上报</span>
      </div>
    </section>
  `.locals({ props: {}, meta, signalCount, timelineCount });
}, { name: "StatsStrip" });
