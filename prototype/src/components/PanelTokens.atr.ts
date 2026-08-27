/**
 * PanelTokens.atr.ts — 实验台：Token 试衣间。
 * 【决策 16】样式迁移至 .ppanel + 工具类；scoped 已清空。
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
  // 注意：模板表达式内不做字符串拼接，样式串在 TS 侧预拼好（动态属性整值表达式约束）
  const spaces = $derived(() => pick("space.").map(([k, v]) => ({ k, style: `height:${v};background:var(--color-primary)` })));
  const radii = $derived(() => pick("radius.").map(([k, v]) => ({ k, style: `border-radius:${v};background:color-mix(in srgb,var(--color-primary) 30%,transparent);border:1px solid var(--color-primary)` })));

  return html`
    <div class="ppanel">
      <h3 class="text-base mb-1">🎨 Token 试衣间</h3>
      <p class="text-sm text-muted mb-sm">下方色板并非硬编码——它们读取的是 atelier.config.json 注入运行时的语义 token。</p>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-sm my-sm">
        {#each colors.value as c}
          <figure class="flex items-center gap-2 bg-bg border border-surface-2 rounded-md px-[.6rem] py-[.45rem]">
            <i class="w-[22px] h-[22px] rounded-lg shrink-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-text)_18%,transparent)]" style={c.swatch}></i>
            <figcaption class="text-[.66rem] text-muted break-all font-mono">{c.k}</figcaption>
          </figure>
        {/each}
      </div>

      <div class="flex items-end gap-md flex-wrap my-sm">
        {#each spaces.value as s}
          <div class="flex flex-col items-center gap-[.3rem]">
            <i class="w-[26px] block rounded" style={s.style}></i>
            <code class="text-[.66rem] text-muted">{s.k}</code>
          </div>
        {/each}
      </div>

      <div class="flex items-end gap-md flex-wrap my-sm">
        {#each radii.value as rr}
          <div class="flex flex-col items-center gap-[.3rem]">
            <i class="w-[42px] h-7 block" style={rr.style}></i>
            <code class="text-[.66rem] text-muted">{rr.k}</code>
          </div>
        {/each}
      </div>
    </div>
  `.locals({ props: {}, colors, spaces, radii });
}, { name: "PanelTokens" });
