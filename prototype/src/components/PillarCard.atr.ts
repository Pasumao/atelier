/**
 * PillarCard.atr.ts — Atelier 框架支柱卡片。
 * 演示：数组 prop（flat schema items）+ {#each} 渲染标签 chips。
 */
import { component, html } from "../runtime";

export const pillarCardSchema = {
  type: "object",
  reqProps: {
    icon: { type: "string" },
    title: { type: "string" },
    desc: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  optProps: {},
};

export const PillarCard = component(
  function PillarCard(props: { icon: string; title: string; desc: string; tags: string[] }) {
    return html`
      <article class="pillar">
        <span class="pillar__icon">{props.icon}</span>
        <h3 class="pillar__title">{props.title}</h3>
        <p class="pillar__desc">{props.desc}</p>
        <div class="pillar__tags">
          {#each props.tags as t}
            <code class="pillar__tag">{t}</code>
          {/each}
        </div>

        <style scoped>
          .pillar { position: relative; background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); overflow: hidden; transition: transform .22s ease, border-color .22s ease; }
          .pillar:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--color-primary) 52%, transparent); }
          .pillar::after { content: ""; position: absolute; right: -34px; top: -34px; width: 110px; height: 110px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--color-primary) 22%, transparent), transparent 68%); pointer-events: none; }
          .pillar__icon { font-size: 1.6rem; }
          .pillar__title { font-size: 1rem; letter-spacing: .03em; }
          .pillar__desc { color: var(--color-muted); font-size: .83rem; flex: 1; line-height: 1.75; }
          .pillar__tags { display: flex; flex-wrap: wrap; gap: .4rem; }
          .pillar__tag { font-size: .7rem; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent); padding: .1rem .45rem; border-radius: var(--radius-sm); }
        </style>
      </article>
    `.locals({ props });
  },
  { name: "PillarCard", schema: pillarCardSchema }
);
