/**
 * PanelTokens.atr.ts — 实验台：Token 试衣间。
 * 色板 / 间距 / 圆角全部读取 tokenState —— atelier.config.json 的运行时投影，
 * 页面上没有任何一处硬编码设计值（H3 的活体证明）。
 */
import { component, $state, $derived, html, tokenState } from "../runtime";

export const PanelTokens = component(function PanelTokens() {
  const flatEntries = Object.entries(tokenState.flat);
  const pick = (prefix: string) => flatEntries.filter(([k]) => k.startsWith(prefix));
  const colors = $derived(() =>
    pick("color.").map(([k, v]) => ({ k, v, swatch: `background:${v}` }))
  );
  const spaces = $derived(() => pick("space."));
  const radii = $derived(() => pick("radius."));

  return html`
    <div class="ppanel">
      <h3 class="ppanel__title">🎨 Token 试衣间</h3>
      <p class="ppanel__hint">下方色板并非硬编码——它们读取的是 atelier.config.json 注入运行时的语义 token。</p>

      <div class="swatches">
        {#each colors.value as c}
          <figure class="swatch">
            <i class="swatch__dot" style={c.swatch}></i>
            <figcaption class="swatch__name">{c.k}</figcaption>
          </figure>
        {/each}
      </div>

      <div class="tok-row">
        {#each spaces.value as s}
          <div class="tok-cell">
            <i class="tok-space" style={`height:${s.v};background:var(--color-primary)`}></i>
            <code>{s.k}</code>
          </div>
        {/each}
      </div>

      <div class="tok-row">
        {#each radii.value as rr}
          <div class="tok-cell">
            <i class="tok-radius" style={`border-radius:${rr.v};background:color-mix(in srgb,var(--color-primary) 30%,transparent);border:1px solid var(--color-primary)`}></i>
            <code>{rr.k}</code>
          </div>
        {/each}
      </div>

      <style scoped>
        .ppanel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md) var(--space-lg); animation: panel-in .25s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        .ppanel__title { font-size: 1rem; margin-bottom: .35rem; }
        .ppanel__hint { color: var(--color-muted); font-size: .82rem; margin-bottom: var(--space-sm); }
        .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: var(--space-sm); margin: var(--space-sm) 0; }
        .swatch { display: flex; align-items: center; gap: .5rem; background: var(--color-bg); border: 1px solid var(--color-surface-2); border-radius: var(--radius-md); padding: .45rem .6rem; }
        .swatch__dot { width: 22px; height: 22px; border-radius: 8px; flex-shrink: 0; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text) 18%, transparent); }
        .swatch__name { font-size: .66rem; color: var(--color-muted); word-break: break-all; font-family: ui-monospace, monospace; }
        .tok-row { display: flex; align-items: flex-end; gap: var(--space-md); flex-wrap: wrap; margin: var(--space-sm) 0; }
        .tok-cell { display: flex; flex-direction: column; align-items: center; gap: .3rem; }
        .tok-cell code { font-size: .66rem; color: var(--color-muted); }
        .tok-space { width: 26px; display: block; border-radius: 4px; }
        .tok-radius { width: 42px; height: 28px; display: block; }
      </style>
    </div>
  `.locals({ props: {}, colors, spaces, radii });
}, { name: "PanelTokens" });
