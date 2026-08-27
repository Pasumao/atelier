/**
 * HeroSection.atr.ts — 首屏。
 * Aurora 光晕背景 + 轨道球视觉 + 自持的 streamValue 流式开场白（挂载即播，可重播）。
 * 注：子组件 props 在父级渲染时一次性求值，故流式播放状态由本组件内部持有，
 *     与实验台 PanelStream 是两个独立实例（各自 fetch dev 面）。
 */
import { component, $state, $derived, html, streamValue, devFetch } from "../runtime";
import type { StreamValue } from "../runtime";

const FALLBACK_INTRO = "（dev 面 stream-intro 暂不可达）这里是离线兜底文案：DeepSeek-V4 已经上线。";
const HERO_BADGES = ["V4 正式版", "1M 上下文", "开源权重", "昇腾适配", "API 兼容 OpenAI"];

export const HeroSection = component(function HeroSection() {
  const player = $state<{ sv?: StreamValue<string> }>({});
  const heroText = $derived(() => (player.value.sv ? player.value.sv.values.join("") : ""));
  const heroDone = $derived(() => (player.value.sv ? player.value.sv.done : false));

  const SNAP = typeof location !== "undefined" && new URLSearchParams(location.search).has("snapshot");

  async function pump(sv: StreamValue<string>): Promise<void> {
    try {
      const r = await devFetch("/__atelier/stream-intro");
      if (SNAP) {
        // 快照模式：整段一次性落定，保证视觉回归逐字节稳定
        for (const ch of await r.text()) sv.push(ch);
        sv.finish();
        return;
      }
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const ch of dec.decode(value, { stream: true })) sv.push(ch);
      }
      sv.finish();
    } catch {
      for (const ch of FALLBACK_INTRO) sv.push(ch);
      sv.finish();
    }
  }
  function playIntro(reset: boolean): void {
    if (reset || !player.value.sv) player.value = { sv: streamValue<string>() };
    void pump(player.value.sv!);
  }

  playIntro(false); // 挂载即开播一次

  return html`
    <section class="hero">
      <div class="hero__aurora hero__aurora--a"></div>
      <div class="hero__aurora hero__aurora--b"></div>
      <div class="hero__aurora hero__aurora--c"></div>
      <div class="hero__grid"></div>
      <div class="hero__inner">
        <div class="hero__copy">
          <p class="hero__eyebrow">ATELIER 信号内核现场渲染 · 2026 年 8 月最新版</p>
          <h1 class="hero__title">认识<br /><span class="hero__logo">DeepSeek-V4</span></h1>
          <div class="hero__badges">
            {#each HERO_BADGES as b}
              <span class="chip">{b}</span>
            {/each}
          </div>
          <p class="hero__sub">AI 原生前端框架演示页 —— 页面上的每个数字都由运行中的 Atelier 内核供血。</p>
          <div class="hero__actions">
            <a class="btn btn--primary" href="#pillars">看框架特色 ↓</a>
            <a class="btn btn--ghost" href="#lab">进实验台 ⚗</a>
          </div>
          <div class="hero__intro">
            <span class="hero__text">{heroText.value}</span>
            <span class="hero__cursor">{heroDone.value ? "" : "▋"}</span>
          </div>
        </div>
        <div class="hero__art" aria-hidden="true">
          <div class="orb">
            <i class="orb__ring orb__ring--a"></i>
            <i class="orb__ring orb__ring--b"></i>
            <i class="orb__ring orb__ring--c"></i>
            <div class="orb__core"><span class="orb__whale">🐳</span></div>
          </div>
        </div>
      </div>

      <style scoped>
        .hero { position: relative; padding: calc(var(--space-xl) * 1.6) var(--space-lg) var(--space-xl); overflow: hidden; border-bottom: 1px solid var(--color-surface-2); }
        .hero__aurora { position: absolute; width: 46rem; height: 46rem; border-radius: 50%; filter: blur(70px); opacity: .34; pointer-events: none; animation: drift 16s ease-in-out infinite alternate; }
        .hero__aurora--a { left: -18rem; top: -22rem; background: radial-gradient(circle, color-mix(in srgb, var(--color-primary) 65%, transparent), transparent 62%); }
        .hero__aurora--b { right: -22rem; top: -14rem; background: radial-gradient(circle, color-mix(in srgb, var(--color-primary-soft) 85%, transparent), transparent 60%); animation-delay: -6s; }
        .hero__aurora--c { right: 24%; bottom: -34rem; background: radial-gradient(circle, color-mix(in srgb, var(--color-ok) 26%, transparent), transparent 55%); animation-duration: 22s; }
        @keyframes drift { from { transform: translate3d(-4%, -2%, 0) scale(1); } to { transform: translate3d(4%, 5%, 0) scale(1.12); } }
        .hero__grid { position: absolute; inset: 0; pointer-events: none; opacity: .5; background-image: repeating-linear-gradient(0deg, color-mix(in srgb, var(--color-surface-2) 42%, transparent) 0 1px, transparent 1px 56px), repeating-linear-gradient(90deg, color-mix(in srgb, var(--color-surface-2) 42%, transparent) 0 1px, transparent 1px 56px); mask-image: radial-gradient(ellipse 90% 80% at 50% 30%, black 30%, transparent 75%); }
        .hero__inner { position: relative; max-width: 1120px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 7fr) minmax(260px, 4fr); align-items: center; gap: var(--space-xl); }
        .hero__copy { display: flex; flex-direction: column; align-items: flex-start; }
        .hero__eyebrow { color: var(--color-primary); font-size: .8rem; letter-spacing: .18em; margin-bottom: var(--space-sm); animation: rise .6s ease both; }
        .hero__title { font-size: 3.9rem; line-height: 1.04; letter-spacing: -0.02em; margin-bottom: var(--space-md); animation: rise .6s ease both; }
        .hero__logo { background: linear-gradient(120deg, var(--color-primary) 8%, color-mix(in srgb, var(--color-primary) 45%, var(--color-text)) 55%, var(--color-text)); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 26px color-mix(in srgb, var(--color-primary) 40%, transparent)); }
        .hero__badges { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); animation: rise .6s ease both; }
        .chip { font-size: .74rem; letter-spacing: .05em; padding: .22rem .66rem; border-radius: 999px; color: var(--color-primary); border: 1px solid color-mix(in srgb, var(--color-primary) 38%, transparent); background: color-mix(in srgb, var(--color-primary) 11%, transparent); }
        .hero__sub { color: var(--color-muted); max-width: 38em; margin-bottom: var(--space-md); animation: rise .6s ease both; }
        .hero__actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); animation: rise .6s ease both; }
        @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
        .btn { display: inline-block; background: var(--color-primary); color: var(--color-bg); border: 0; border-radius: var(--radius-sm); padding: .52rem 1rem; cursor: pointer; font-size: .85rem; text-decoration: none; font-weight: 600; transition: transform .15s, box-shadow .15s; }
        .btn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--color-primary) 80%, transparent); }
        .btn--ghost { background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); font-weight: 400; }
        .hero__intro { max-width: 44em; min-height: 72px; color: var(--color-text); border-left: 3px solid var(--color-primary); padding: var(--space-sm) var(--space-md); background: color-mix(in srgb, var(--color-surface) 88%, transparent); border-radius: 0 var(--radius-md) var(--radius-md) 0; box-shadow: 0 10px 40px -18px color-mix(in srgb, var(--color-primary) 55%, transparent); }
        .hero__text { color: var(--color-muted); line-height: 1.8; }
        .hero__cursor { color: var(--color-primary); animation: blink 1s steps(1) infinite; }
        /* blink keyframe 全局定义于 atelier-ui.css（决策 16 收口），此处不再重复 */
        .hero__art { position: relative; }
        .orb { position: relative; width: 230px; height: 230px; margin-inline: auto; }
        .orb__core { position: absolute; inset: 30%; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--color-primary) 34%, transparent), color-mix(in srgb, var(--color-bg) 82%, transparent) 68%); border: 1px solid color-mix(in srgb, var(--color-primary) 46%, transparent); box-shadow: 0 0 44px -6px color-mix(in srgb, var(--color-primary) 52%, transparent), inset 0 0 22px color-mix(in srgb, var(--color-primary) 26%, transparent); animation: breathe 3.6s ease-in-out infinite; }
        @keyframes breathe { 50% { box-shadow: 0 0 64px 2px color-mix(in srgb, var(--color-primary) 68%, transparent), inset 0 0 26px color-mix(in srgb, var(--color-primary) 34%, transparent); } }
        .orb__whale { font-size: 3.1rem; filter: drop-shadow(0 0 14px color-mix(in srgb, var(--color-primary) 70%, transparent)); }
        .orb__ring { position: absolute; inset: 0; border-radius: 50%; border: 1px dashed color-mix(in srgb, var(--color-primary) 42%, transparent); }
        .orb__ring::after { content: ""; position: absolute; top: -4px; left: 50%; width: 9px; height: 9px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 12px 2px color-mix(in srgb, var(--color-primary) 75%, transparent); }
        .orb__ring--a { animation: spin 9s linear infinite; }
        .orb__ring--b { inset: 13%; border-color: color-mix(in srgb, var(--color-ok) 42%, transparent); animation: spin 6.5s linear infinite reverse; }
        .orb__ring--b::after { background: var(--color-ok); box-shadow: 0 0 12px 2px color-mix(in srgb, var(--color-ok) 75%, transparent); }
        .orb__ring--c { inset: 26%; border-color: color-mix(in srgb, var(--color-warn) 46%, transparent); animation: spin 12s linear infinite; }
        .orb__ring--c::after { background: var(--color-warn); box-shadow: 0 0 12px 2px color-mix(in srgb, var(--color-warn) 75%, transparent); }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 860px) {
          .hero__inner { grid-template-columns: 1fr; }
          .hero__art { display: none; }
          .hero__title { font-size: 2.6rem; }
        }
      </style>
    </section>
  `.locals({ props: {}, heroText, heroDone, playIntro, HERO_BADGES });
}, { name: "HeroSection" });
