import { component, html, streamValue, type StreamValue } from "../../../../../../../runtime/index.ts";

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

// 自测 fixture：代码里真用定时器（不被测试执行，但源码检查必须拦）——评分必须 FAIL
export function legacyTypewriter(el: unknown, text: string): void {
  let i = 0;
  const t = setInterval(() => {
    i += 1;
    if (i >= text.length) clearTimeout(t);
  }, 50);
  setTimeout(() => {}, 0);
}
