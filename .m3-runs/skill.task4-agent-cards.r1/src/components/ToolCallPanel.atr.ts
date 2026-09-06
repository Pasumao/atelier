/**
 * ToolCallPanel.atr.ts — task4-agent-cards：流式工具调用卡片（加难层）。
 * 组合：streamValue 流式输入 + $derived 嵌套解析 + keyed each（by c.id）渲染卡片。
 * 值一律经 {…} 插值渲染，禁止手写 DOM 操作。
 */
import { component, $derived, html } from "../runtime";
import { streamValue } from "../runtime";
import type { StreamValue } from "../runtime";

type Call = { id: string; name: string; status: string };

/** 演示流：依次 push 三行工具调用 JSON（流式、间隔推送）后 finish()。 */
export function runDemo(): StreamValue<string> {
  const stream = streamValue<string>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  void (async () => {
    await sleep(20);
    stream.push('{"id":"t1","name":"search","status":"done"}');
    await sleep(20);
    stream.push('{"id":"t2","name":"read","status":"running"}');
    await sleep(20);
    stream.push('{"id":"t3","name":"write","status":"error"}');
    stream.finish();
  })();
  return stream;
}

export const toolCallPanelSchema = {
  type: "object",
  reqProps: { stream: { type: "object" } },
  optProps: {},
} as const;

export const ToolCallPanel = component(function ToolCallPanel(props: { stream: StreamValue<string> }) {
  // 流式 JSON 行 → 结构化调用列表（解析失败行丢弃）；push 整体替换数组引用，自动触发重渲染
  const calls = $derived<Call[]>(() => {
    const out: Call[] = [];
    for (const line of props.stream.values) {
      try {
        const o = JSON.parse(line) as Partial<Call> | null;
        if (o && typeof o.id === "string" && typeof o.name === "string" && typeof o.status === "string") {
          out.push({ id: o.id, name: o.name, status: o.status });
        }
      } catch {
        // 解析失败行丢弃（流式半行是常态）
      }
    }
    return out;
  });

  return html`
    <div class="ppanel">
      <h2 class="text-md font-semibold">Tool Calls</h2>
      {#each calls.value as c by c.id}
        <div class="call">
          <b>{c.name}</b>
          {#if c.status === "done"}✓{:else if c.status === "error"}✗{:else}⏳{/if}
        </div>
      {/each}
    </div>
  `.locals({ props, calls });
}, { name: "ToolCallPanel", schema: toolCallPanelSchema });
