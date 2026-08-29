import { component, html, streamValue, type StreamValue } from "../../../../../../runtime/index.ts";

export function runDemo(): StreamValue<string> {
  const s = streamValue<string>();
  s.push("正在检索");
  s.push("已找到 3 条");
  s.push("完成");
  s.finish();
  return s;
}

export const StreamCard = component(function StreamCard(props: { stream: StreamValue<string> }) {
  const s = props.stream;
  return html`
    <div class="stream">{#each s.values as chunk}{chunk} · {/each}{s.done ? " ✓" : ""}</div>
  `.locals({ s });
}, { name: "StreamCard", schema: { type: "object", reqProps: { stream: { type: "object" } }, optProps: {} } });
