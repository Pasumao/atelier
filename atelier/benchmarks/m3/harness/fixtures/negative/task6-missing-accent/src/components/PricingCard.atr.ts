import { component, html } from "../../../../../../runtime/index.ts";

export const PricingCard = component(function PricingCard(props: { plan: string }) {
  return html`
    <div class="pricing"><h3>{props.plan}</h3><span class="accent-dot">●</span></div>
    <style scoped>
      .accent-dot { color: var(--color-accent); }
      .pricing { padding: var(--space-md); }
    </style>
  `;
}, { name: "PricingCard", schema: { type: "object", reqProps: { plan: { type: "string" } }, optProps: {} } });
