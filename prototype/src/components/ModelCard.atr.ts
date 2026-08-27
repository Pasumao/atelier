/**
 * ModelCard.atr.ts — Atelier 组件示例（决策 1/6/8 演示）。
 * 完整版差异：schema 由编译器从类型 AST 提取；作用域由编译器闭包捕获（本原型用 .locals 显式注入）。
 */
import { component, $state, $derived, html } from "../runtime";

export const modelCardSchema = {
  type: "object",
  reqProps: {
    name: { type: "string" },
    badge: { type: "string" },
    tagline: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
  },
  optProps: {
    endpoint: { type: "string" }, // 缺省按名称推断为 api.deepseek.com/<name>
    accent: { type: "string", enum: ["primary", "ok", "warn"] }, // 卡片强调色（字面量判别式）
  },
};

export const ModelCard = component(
  function ModelCard(props: {
    name: string;
    badge: string;
    tagline: string;
    highlights: string[];
    endpoint?: string;
    accent?: string;
  }) {
    const open = $state(false);
    // 动态属性必须整值表达式：拼串一律在 TS 侧完成
    const cardCls = $derived(() => "model-card" + (props.accent ? " model-card--" + props.accent : ""));
    const badgeCls = $derived(() => "model-card__badge model-card__badge--" + (props.accent ?? "primary"));
    const endpointText = $derived(() => props.endpoint ?? ("https://api.deepseek.com/" + props.name));
    const toggle = () => (open.value = !open.value);
    return html`
      <article class={cardCls.value}>
        <header class="model-card__head">
          <h3 class="model-card__name">{props.name}</h3>
          <span class={badgeCls.value}>{props.badge}</span>
        </header>
        <p class="model-card__tagline">{props.tagline}</p>
        <ul class="model-card__list">
          {#each props.highlights as h}
            <li class="model-card__li"><i class="model-card__tick">▸</i>{h}</li>
          {/each}
        </ul>
        <button class="model-card__cta" on:click={toggle}>{open.value ? "收起端点 ▴" : "展开 API 端点 ▾"}</button>
        {#if open.value}
          <code class="model-card__endpoint">{endpointText.value}</code>
        {/if}

        <style scoped>
          .model-card { position: relative; background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); overflow: hidden; transition: transform .25s ease, border-color .25s ease; }
          .model-card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: linear-gradient(90deg, var(--color-primary), transparent); opacity: .7; }
          .model-card:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-surface-2)); }
          .model-card--ok::before { background: linear-gradient(90deg, var(--color-ok), transparent); }
          .model-card--warn::before { background: linear-gradient(90deg, var(--color-warn), transparent); }
          .model-card__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
          .model-card__name { font-size: 1rem; font-family: ui-monospace, monospace; letter-spacing: .02em; }
          .model-card__badge { font-size: .72rem; padding: .15rem .55rem; border-radius: var(--radius-sm); white-space: nowrap; background: color-mix(in srgb, var(--color-primary) 16%, transparent); color: var(--color-primary); border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent); }
          .model-card__badge--ok { background: color-mix(in srgb, var(--color-ok) 16%, transparent); color: var(--color-ok); border-color: color-mix(in srgb, var(--color-ok) 35%, transparent); }
          .model-card__badge--warn { background: color-mix(in srgb, var(--color-warn) 18%, transparent); color: var(--color-warn); border-color: color-mix(in srgb, var(--color-warn) 40%, transparent); }
          .model-card__tagline { color: var(--color-muted); font-size: .85rem; min-height: 3em; }
          .model-card__list { list-style: none; display: flex; flex-direction: column; gap: .35rem; font-size: .84rem; flex: 1; }
          .model-card__li { display: flex; gap: .45rem; align-items: baseline; }
          .model-card__tick { color: var(--color-primary); font-style: normal; font-size: .8rem; }
          .model-card--ok .model-card__tick { color: var(--color-ok); }
          .model-card--warn .model-card__tick { color: var(--color-warn); }
          .model-card__cta { align-self: flex-start; background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); border-radius: var(--radius-sm); padding: .4rem .8rem; cursor: pointer; font-size: .78rem; transition: color .15s, border-color .15s; margin-top: auto; }
          .model-card__cta:hover { color: var(--color-text); border-color: var(--color-primary); }
          .model-card__endpoint { display: block; background: var(--color-bg); border: 1px solid var(--color-surface-2); border-left: 3px solid var(--color-primary); border-radius: var(--radius-sm); padding: .5rem .7rem; font-size: .74rem; color: var(--color-primary); word-break: break-all; animation: mc-in .25s ease; }
          @keyframes mc-in { from { opacity: 0; transform: translateY(4px); } }
        </style>
      </article>
    `.locals({ props, open, toggle, cardCls, badgeCls, endpointText });
  },
  {
    // 组件名显式声明（=文件名）。完整版：编译器从 `export const X = component(...)` 提取，无需手写。
    schema: modelCardSchema,
    name: "ModelCard",
  }
);
