/**
 * PanelStream.atr.ts — 实验台：流式打字面板。
 * 自持 streamValue 实例（挂载即播）；每次切回本页签会重新挂载并重播——
 * 这正是「组件即边界」的语义，而不是缺陷。
 */
import { component, $state, $derived, html, streamValue, devFetch } from "../runtime";
import type { StreamValue } from "../runtime";

const FALLBACK = "（dev 面不可达）streamValue 原语依旧工作：这段是离线兜底文本。";

export const PanelStream = component(function PanelStream() {
  const player = $state<{ sv?: StreamValue<string> }>({});
  const text = $derived(() => (player.value.sv ? player.value.sv.values.join("") : ""));
  const done = $derived(() => (player.value.sv ? player.value.sv.done : false));

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
        const { done: d, value } = await reader.read();
        if (d) break;
        for (const ch of dec.decode(value, { stream: true })) sv.push(ch);
      }
      sv.finish();
    } catch {
      for (const ch of FALLBACK) sv.push(ch);
      sv.finish();
    }
  }
  function replay(): void {
    player.value = { sv: streamValue<string>() };
    void pump(player.value.sv!);
  }

  replay(); // 挂载即播

  return html`
    <div class="ppanel">
      <h3 class="ppanel__title">🌊 streamValue 流式原语</h3>
      <p class="ppanel__hint">文本经 dev 面逐字符流出，push 进信号数组即可自动渲染——规则层面禁止 setInterval 手写打字机。</p>
      <div class="stream-box">
        <span>{text.value}</span>
        <span class="stream-box__cursor">{done.value ? "" : "▋"}</span>
      </div>
      <div class="ppanel__actions">
        <button class="pbtn pbtn--primary" on:click={replay}>↻ 重播流</button>
      </div>

      <style scoped>
        .ppanel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md) var(--space-lg); animation: panel-in .25s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        .ppanel__title { font-size: 1rem; margin-bottom: .35rem; }
        .ppanel__hint { color: var(--color-muted); font-size: .82rem; margin-bottom: var(--space-sm); }
        .ppanel__actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-sm); }
        .pbtn { display: inline-block; background: var(--color-primary); color: var(--color-bg); border: 0; border-radius: var(--radius-sm); padding: .52rem 1rem; cursor: pointer; font-size: .85rem; font-weight: 600; transition: transform .15s, box-shadow .15s; }
        .pbtn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--color-primary) 80%, transparent); }
        .stream-box { min-height: 96px; background: var(--color-bg); border: 1px solid var(--color-surface-2); border-radius: var(--radius-md); padding: var(--space-md); font-size: .9rem; line-height: 1.9; color: var(--color-muted); }
        .stream-box__cursor { color: var(--color-primary); animation: blink 1s steps(1) infinite; }
        @keyframes blink { 50% { opacity: 0; } }
      </style>
    </div>
  `.locals({ props: {}, text, done, replay });
}, { name: "PanelStream" });
