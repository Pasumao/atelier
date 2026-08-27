/**
 * BenchBar.atr.ts — 基准/能力对比条组件。
 * 演示：flat 契约（字面量判别式 tone）+ 动态属性绑定（style 全串由父级 TS 侧拼好）。
 */
import { component, $derived, html } from "../runtime";

export const benchBarSchema = {
  type: "object",
  reqProps: {
    label: { type: "string" },
    score: { type: "number" },   // 0~100 显示值
    tone: { type: "string", enum: ["primary", "ok", "warn"] },
    caption: { type: "string" },
    fillStyle: { type: "string" }, // 父组件拼好的 inline style（width + animation-delay）
  },
  optProps: {},
};

export const BenchBar = component(
  function BenchBar(props: { label: string; score: number; tone: string; caption: string; fillStyle: string }) {
    // 注意：模板动态属性只支持整值表达式，拼串在 TS 侧完成（H1：显式无魔法）
    const scoreCls = $derived(() => "bbar__score bbar__score--" + props.tone);
    const fillCls = $derived(() => "bbar__fill bbar__fill--" + props.tone);
    return html`
      <div class="bbar">
        <div class="bbar__head">
          <span class="bbar__label">{props.label}</span>
          <span class={scoreCls.value}>{props.score}</span>
        </div>
        <div class="bbar__track">
          <div class={fillCls.value} style={props.fillStyle}></div>
        </div>
        <p class="bbar__caption">{props.caption}</p>

        <style scoped>
          .bbar { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md); display: flex; flex-direction: column; gap: .45rem; transition: border-color .2s; }
          .bbar:hover { border-color: color-mix(in srgb, var(--color-primary) 45%, transparent); }
          .bbar__head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-sm); }
          .bbar__label { font-size: .9rem; }
          .bbar__score { font-family: ui-monospace, monospace; font-size: 1.2rem; font-weight: 700; }
          .bbar__score--primary { color: var(--color-primary); }
          .bbar__score--ok { color: var(--color-ok); }
          .bbar__score--warn { color: var(--color-warn); }
          .bbar__track { height: 10px; border-radius: 999px; background: color-mix(in srgb, var(--color-surface-2) 72%, transparent); overflow: hidden; }
          .bbar__fill { height: 100%; border-radius: inherit; transform-origin: left center; animation: grow-bar 1s cubic-bezier(.22,.9,.28,1) both; }
          @keyframes grow-bar { from { transform: scaleX(0); } }
          .bbar__fill--primary { background: linear-gradient(90deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 40%, var(--color-primary-soft))); }
          .bbar__fill--ok { background: linear-gradient(90deg, var(--color-ok), color-mix(in srgb, var(--color-ok) 45%, transparent)); }
          .bbar__fill--warn { background: linear-gradient(90deg, var(--color-warn), color-mix(in srgb, var(--color-warn) 45%, transparent)); }
          .bbar__caption { color: var(--color-muted); font-size: .76rem; }
        </style>
      </div>
    `.locals({ props, scoreCls, fillCls });
  },
  { name: "BenchBar", schema: benchBarSchema }
);
