import { component, $derived, html, streamValue, type StreamValue } from "../../../../../../runtime/index.ts";

export function runDemo(): StreamValue<string> {
  const s = streamValue<string>();
  s.push('{"id":"t1","name":"search","status":"done"}');
  s.push('{"id":"t2","name":"read","status":"running"}');
  s.push('{"id":"t3","name":"write","status":"error"}');
  s.finish();
  return s;
}

type Call = { id: string; name: string; status: string };

export const ToolCallPanel = component(function ToolCallPanel(props: { stream: StreamValue<string> }) {
  const s = props.stream;
  const calls = $derived(() =>
    s.values
      .map((line) => {
        try {
          return JSON.parse(line) as Call;
        } catch {
          return null;
        }
      })
      .filter((c): c is Call => !!c)
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
  return html`
    <div class="panel">{#each calls.value as c by c.id}<div class="call"><b>{c.name}</b><span>{#if c.status === "done"}✓{:else if c.status === "error"}✗{:else}⏳{/if}</span></div>{/each}</div>
  `.locals({ calls });
}, { name: "ToolCallPanel", schema: { type: "object", reqProps: { stream: { type: "object" } }, optProps: {} } });
