/**
 * BenchSection.atr.ts — 能力速览区。
 * 【决策 16】区块节奏 recipe 化；scoped 已清空。
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
    <section class="section-shell" id="bench">
      <p class="eyebrow">CAPABILITY</p>
      <h2 class="h-section-fluid">能力速览<span class="text-xs text-warn font-normal border border-warn/40 px-2 py-[.1rem] rounded-full">定性示意条，非官方评测复刻</span></h2>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-md gap-x-lg">
        {#each rows as b}
          <BenchBar label={b.label} score={b.score} tone={b.tone} caption={b.caption} fillStyle={b.fillStyle} />
        {/each}
      </div>
    </section>
  `.locals({ props: {}, rows });
}, { name: "BenchSection" });
