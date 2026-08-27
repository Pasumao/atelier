/**
 * PanelStream.atr.ts — 实验台：流式打字面板。
 * 【决策 16】样式：.ppanel/.btn recipe + 工具类；keyframes 已收口至 atelier-ui.css。
 * 自持 streamValue 实例（挂载即播）；切走再切回会重挂载重播——组件即边界。
 */
import { component, $state, $derived, html, streamValue, devFetch } from "../runtime";
import type { StreamValue } from "../runtime";

const FALLBACK = "（dev 面不可达）streamValue 原语依旧工作：这段是离线兜底文本。";

export const PanelStream = component(function PanelStream() {
  const player = $state<{ sv?: StreamValue<string> }>({});
  const text = $derived(() => (player.value.sv ? player.value.sv.values.join("") : ""));
  const done = $derived(() => (player.value.sv ? player.value.sv.done : false));

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

  const SNAP = typeof location !== "undefined" && new URLSearchParams(location.search).has("snapshot");
  replay(); // 挂载即播

  return html`
    <div class="ppanel">
      <h3 class="text-base mb-1">🌊 streamValue 流式原语</h3>
      <p class="text-sm text-muted mb-sm">文本经 dev 面逐字符流出，push 进信号数组即可自动渲染——规则层面禁止 setInterval 手写打字机。</p>
      <div class="min-h-24 rounded-md border border-surface-2 bg-bg px-md py-md text-sm leading-[1.9] text-muted">
        <span>{text.value}</span>
        <span class="text-primary animate-[blink_1s_steps(1)_infinite]">{done.value ? "" : "▋"}</span>
      </div>
      <div class="flex flex-wrap gap-sm mt-sm">
        <button class="btn btn-primary" on:click={replay}>↻ 重播流</button>
      </div>
    </div>
  `.locals({ props: {}, text, done, replay });
}, { name: "PanelStream" });
