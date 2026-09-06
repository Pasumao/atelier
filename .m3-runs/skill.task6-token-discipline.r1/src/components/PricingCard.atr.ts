/**
 * PricingCard.atr.ts — 语义 token + scoped 样式示例组件。
 * 颜色/间距一律 var(--token) 取自 atelier.config.json 单源（accent token 已登记）；
 * scoped 块属于守卫测试 SCOPED_ALLOWLIST 逃生舱（见 tests/styling-discipline.test.ts）。
 */
import { component, html } from "../runtime";

export const pricingCardSchema = {
  type: "object",
  reqProps: { plan: { type: "string" } },
  optProps: {},
} as const;

export const PricingCard = component(function PricingCard(props: { plan: string }) {
  return html`
    <div class="pricing">
      <h3>{props.plan}</h3>
      <span class="accent-dot">●</span>
    </div>
    <style scoped>
      .pricing { padding: var(--space-md); }
      .accent-dot { color: var(--color-accent); }
    </style>
  `.locals({ props });
}, { name: "PricingCard", schema: pricingCardSchema });
