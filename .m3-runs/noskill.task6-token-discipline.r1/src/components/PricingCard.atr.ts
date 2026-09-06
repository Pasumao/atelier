/**
 * PricingCard.atr.ts — task6 样式纪律：token 单源 + scoped 逃生舱。
 * 颜色/间距只引用 atelier.config.json 已定义的语义 token（--color-accent / --space-md），
 * 禁止裸颜色字面量（ATR-204 / 决策 16 R2b）。
 */
import { component, html } from "../runtime";

export const pricingCardSchema = {
  type: "object",
  reqProps: { plan: { type: "string" } },
  optProps: {},
} as const;

export const PricingCard = component(function PricingCard(props: { plan: string }) {
  return html`
    <style scoped>
      .pricing {
        padding: var(--space-md);
      }
      .accent-dot {
        color: var(--color-accent);
      }
    </style>
    <div class="pricing">
      <h3>{props.plan}</h3>
      <span class="accent-dot">●</span>
    </div>
  `.locals({ props });
}, { name: "PricingCard", schema: pricingCardSchema });
