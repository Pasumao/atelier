import { component, $state, html } from "../../../../../../runtime/index.ts";

export const Counter = component(function Counter(props: { start: number }) {
  const count = $state(props.start);
  const inc = () => (count.value += 1);
  return html`
    <div><b>{count.value}</b><button on:click={inc}>+1</button></div>
  `.locals({ count, inc });
}, { name: "Counter", schema: { type: "object", reqProps: { start: { type: "number" } }, optProps: {} } });
