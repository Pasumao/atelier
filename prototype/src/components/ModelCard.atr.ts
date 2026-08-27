/**
 * ModelCard.atr.ts — Atelier 组件示例（决策 1/6/8 演示）。
 * 完整版差异：scheme 由编译器从类型 AST 提取；作用域由编译器闭包捕获（本原型用 .locals 显式注入）。
 */
import { component, $state, html } from "../runtime";

export const modelCardSchema = {
  type: "object",
  reqProps: {
    name: { type: "string" },
    badge: { type: "string" },
    tagline: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
  },
  optProps: {},
};

export const ModelCard = component(
  function ModelCard(props: { name: string; badge: string; tagline: string; highlights: string[] }) {    const open = $state(false);
    const toggle = () => (open.value = !open.value);
    return html`
      <article class="model-card">
        <header class="model-card__head">
          <h3 class="model-card__name">{props.name}</h3>
          <span class="model-card__badge">{props.badge}</span>
        </header>
        <p class="model-card__tagline">{props.tagline}</p>
        <ul class="model-card__list">
          {#each props.highlights as h}
            <li class="model-card__li">{h}</li>
          {/each}
        </ul>
        <button class="model-card__cta" on:click={toggle}>{open.value ? "收起端点" : "展开 API 端点"}</button>
        {#if open.value}
          <code class="model-card__endpoint">https://api.deepseek.com/{props.name}</code>
        {/if}
      </article>
    `.locals({ props, open, toggle });
  },
  {
    // 组件名显式声明（=文件名）。完整版：编译器从 `export const X = component(...)` 提取，无需手写。
    schema: modelCardSchema,
    name: "ModelCard",
  }
);
