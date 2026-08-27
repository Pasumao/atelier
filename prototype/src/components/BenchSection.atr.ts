/**
 * BenchSection.atr.ts — 能力速览区。
 * 行数据在此声明，条形视觉交给 BenchBar 子组件（样式组件自带）。
 * score 为定性示意，非官方评测复刻。
 */
import { component, html } from "../runtime";
import "./BenchBar.atr.ts";

const BENCH = [
  { label: "长上下文利用率", score: 96, tone: "primary", caption: "1M 窗口，DSA 稀疏注意力路线继承自 V3.2" },
  { label: "推理 · 数学 / 竞赛", score: 92, tone: "ok", caption: "reasoner 模式：思考链可见再作答" },
  { label: "代码与智能体任务", score: 90, tone: "primary", caption: "OpenAI 兼容接口 + Function Calling" },
  { label: "性价比指数", score: 98, tone: "warn", caption: "V4-Flash 把输出价压到每百万 token 约 $0.28" },
];

export const BenchSection = component(function BenchSection() {
  // fillStyle 由数据拼好（模板动态属性只接受整值表达式）；stagger 延迟做装载动画
  const rows = BENCH.map((b, i) => ({ ...b, fillStyle: `width:${b.score}%;animation-delay:${i * 120}ms` }));
  return html`
    <section class="section" id="bench">
      <p class="section__eyebrow">CAPABILITY</p>
      <h2 class="section__title">能力速览<span class="section__note">定性示意条，非官方评测复刻</span></h2>
      <div class="bench-grid">
        {#each rows as b}
          <BenchBar label={b.label} score={b.score} tone={b.tone} caption={b.caption} fillStyle={b.fillStyle} />
        {/each}
      </div>

      <style scoped>
        .section { margin-top: calc(var(--space-xl) * 1.35); scroll-margin-top: 90px; }
        .section__eyebrow { color: var(--color-primary); font-size: .76rem; letter-spacing: .22em; margin-bottom: .35rem; }
        .section__title { font-size: 1.65rem; margin-bottom: var(--space-md); display: flex; align-items: baseline; gap: var(--space-sm); flex-wrap: wrap; }
        .section__note { font-size: .72rem; color: var(--color-warn); font-weight: 400; border: 1px solid color-mix(in srgb, var(--color-warn) 40%, transparent); padding: .1rem .5rem; border-radius: 999px; }
        .bench-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-md) var(--space-lg); }
      </style>
    </section>
  `.locals({ props: {}, rows });
}, { name: "BenchSection" });
