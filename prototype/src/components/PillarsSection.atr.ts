/**
 * PillarsSection.atr.ts — Atelier 八大支柱区（框架特色与功能介绍主体）。
 * 支柱卡片视觉由 PillarCard 自带；本组件只负责数据与布局。
 */
import { component, html } from "../runtime";
import "./PillarCard.atr.ts";

const PILLARS = [
  { icon: "⚛️", title: "信号内核", desc: "$state / $derived / $effect 显式声明，细粒度依赖追踪，更新无魔法。", tags: ["$state", "$derived", "$effect"] },
  { icon: "🔁", title: "事务状态层", desc: "命名 checkpoint · rollback · timeTravel——AI 每轮编辑都可一键回滚。", tags: ["store.commit", "rollback", "timeTravel"] },
  { icon: "🌊", title: "流式原语", desc: "streamValue 取代手写打字机；optimisticList 三态乐观更新自带回滚。", tags: ["streamValue", "optimisticList"] },
  { icon: "📐", title: "契约即文档", desc: "flat schema 单源校验 props，违规即渲染 ATR 四段式行动卡片而非白屏。", tags: ["schema", "ATR-201"] },
  { icon: "🎨", title: "Token 单源", desc: "atelier.config.json 一处定义全局生效；硬编码颜色间距直接被门禁拦截。", tags: ["var(--token)", "H3"] },
  { icon: "🪞", title: "自描述注册表", desc: "组件 / 原语清单经 dev 面开放查询，$state 信号图实时上报给工具侧。", tags: ["registry", "state bridge"] },
  { icon: "🧰", title: "MCP 工具面", desc: "query / operation / audit 三面工具，与 CLI 同源映射，代理可直接操盘。", tags: ["tools/list", "stdio"] },
  { icon: "✅", title: "DoD 验收回路", desc: "check / lint / test / snapshot / e2e 门禁化完成定义，视觉差异必须人工复查。", tags: ["check", "snapshot"] },
];

export const PillarsSection = component(function PillarsSection() {
  return html`
    <section class="section" id="pillars">
      <p class="section__eyebrow">WHY ATELIER</p>
      <h2 class="section__title">这一页背后的框架特色</h2>
      <p class="section__sub">Atelier —— 为 AI 编程代理设计的新前端框架。以下八根支柱全部在本页实时运行：</p>
      <div class="pillar-grid">
        {#each PILLARS as p}
          <PillarCard icon={p.icon} title={p.title} desc={p.desc} tags={p.tags} />
        {/each}
      </div>

      <style scoped>
        .section { margin-top: calc(var(--space-xl) * 1.35); scroll-margin-top: 90px; }
        .section__eyebrow { color: var(--color-primary); font-size: .76rem; letter-spacing: .22em; margin-bottom: .35rem; }
        .section__title { font-size: 1.65rem; margin-bottom: var(--space-sm); }
        .section__sub { color: var(--color-muted); margin-bottom: var(--space-md); max-width: 60em; font-size: .9rem; }
        .pillar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-md); }
      </style>
    </section>
  `.locals({ props: {}, PILLARS });
}, { name: "PillarsSection" });
