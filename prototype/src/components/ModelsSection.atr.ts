/**
 * ModelsSection.atr.ts — 开放模型矩阵区。
 * 数据与文案在本组件内常驻；ModelCard 通过 import 副作用注册进 registry。
 * 定价/参数为 2026-08 公开报道快照，以官方文档为准。
 */
import { component, html } from "../runtime";
import "./ModelCard.atr.ts";

const MODELS = [
  {
    name: "deepseek-chat",
    badge: "V4 · 旗舰对话",
    tagline: "V4 正式版主力模型：智能体、代码、写作的通用首选端点。",
    highlights: ["约 1.6T 参数 MoE 架构", "1M 超长上下文", "输出 ≈ $1.98/M token（公开快照）"],
    accent: "primary",
    endpoint: "",
  },
  {
    name: "deepseek-reasoner",
    badge: "V4 · 深度思考",
    tagline: "推理模式：链式思考全程可见，数学 / 逻辑 / 疑难编程信赖之选。",
    highlights: ["思考过程可视化", "竞赛级数学与代码推理", "按需思考自动路由"],
    accent: "primary",
    endpoint: "",
  },
  {
    name: "deepseek-v4-flash",
    badge: "2026-07-31 · 高性价比",
    tagline: "轻量旗舰 V4-Flash：284B MoE，超低延迟与极致成本兼得。",
    highlights: ["284B MoE 架构", "1M 上下文全量保留", "输出 ≈ $0.28/M token（公开快照）"],
    accent: "warn",
    endpoint: "https://api-docs.deepseek.com",
  },
  {
    name: "open-weights",
    badge: "开放生态",
    tagline: "权重持续开放：从 V3.2 的 DSA 稀疏注意力到 V4 全家桶。",
    highlights: ["权重开放下载可自部署", "昇腾硬件生态适配", "社区蒸馏与 MCP 工具生态活跃"],
    accent: "ok",
    endpoint: "https://huggingface.co/deepseek-ai",
  },
];

export const ModelsSection = component(function ModelsSection() {
  return html`
    <section class="section" id="models">
      <p class="section__eyebrow">MODELS</p>
      <h2 class="section__title">开放模型矩阵</h2>
      <p class="section__sub">两个官方端点覆盖对话与深度思考；Flash 主打性价比；权重全线开放。定价为公开报道快照，以官方文档为准。</p>
      <div class="grid">
        {#each MODELS as m}
          <ModelCard name={m.name} badge={m.badge} tagline={m.tagline} highlights={m.highlights} accent={m.accent} endpoint={m.endpoint ? m.endpoint : undefined} />
        {/each}
      </div>

      <style scoped>
        .section { margin-top: calc(var(--space-xl) * 1.35); scroll-margin-top: 90px; }
        .section__eyebrow { color: var(--color-primary); font-size: .76rem; letter-spacing: .22em; margin-bottom: .35rem; }
        .section__title { font-size: 1.65rem; margin-bottom: var(--space-sm); }
        .section__sub { color: var(--color-muted); margin-bottom: var(--space-md); max-width: 60em; font-size: .9rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--space-md); }
      </style>
    </section>
  `.locals({ props: {}, MODELS });
}, { name: "ModelsSection" });
