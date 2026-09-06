/**
 * ToolCallPanel.atr.ts — 工具调用卡片（task4 加难层）：
 * 流式输入（streamValue）+ 嵌套作用域（$derived 解析 JSON 行）+ keyed each（by c.id）。
 * 值一律经 {...} 插值渲染，不做任何手写 DOM 操作。
 */
import { component, $derived, streamValue, html } from "../runtime";
import type { StreamValue } from "../runtime";

export type ToolCall = { id: string; name: string; status: string };

/** runDemo：构造流式值，依次 push 三行 JSON 后 finish()。 */
export function runDemo(): StreamValue<string> {
  const stream = streamValue<string>();
  stream.push('{"id":"t1","name":"search","status":"done"}');
  stream.push('{"id":"t2","name":"read","status":"running"}');
  stream.push('{"id":"t3","name":"write","status":"error"}');
  stream.finish();
  return stream;
}

export const toolCallPanelSchema = {
  type: "object",
  reqProps: { stream: { type: "object" } },
  optProps: {},
} as const;

export const ToolCallPanel = component(function ToolCallPanel(props: { stream: StreamValue<string> }) {
  // 嵌套作用域：把 JSON 行数组解析为 { id, name, status }[]，解析失败行丢弃。
  const calls = $derived(() => {
    const out: ToolCall[] = [];
    for (const line of props.stream.values) {
      try {
        const o = JSON.parse(line) as unknown;
        if (
          o !== null &&
          typeof o === "object" &&
          typeof (o as Record<string, unknown>).id === "string" &&
          typeof (o as Record<string, unknown>).name === "string" &&
          typeof (o as Record<string, unknown>).status === "string"
        ) {
          const r = o as Record<string, string>;
          out.push({ id: r.id, name: r.name, status: r.status });
        }
      } catch {
        // 解析失败行丢弃
      }
    }
    return out;
  });

  return html`
    <div class="calls">
      {#each calls.value as c by c.id}
        <div class="call">
          <b>{c.name}</b>
          {#if c.status === "done"}
            <span class="badge">✓</span>
          {:else if c.status === "error"}
            <span class="badge">✗</span>
          {:else}
            <span class="badge">⏳</span>
          {/if}
        </div>
      {/each}
    </div>
  `.locals({ props, calls });
}, { name: "ToolCallPanel", schema: toolCallPanelSchema });
