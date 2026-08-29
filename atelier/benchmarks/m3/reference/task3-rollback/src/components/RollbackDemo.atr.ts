import { component, $state, html, store } from "../../../../../../runtime/index.ts";

export const RollbackDemo = component(function RollbackDemo() {
  const items = $state<string[]>(["alpha"]);
  const commit = () => store.commit("demo");
  const mutate = () => (items.value = [...items.value, "beta"]);
  const rollback = () => store.rollback();
  return html`
    <div><b class="count">{items.value.length}</b>
    <button on:click={commit}>commit</button>
    <button on:click={mutate}>mutate</button>
    <button on:click={rollback}>rollback</button></div>
  `.locals({ items, commit, mutate, rollback });
}, { name: "RollbackDemo", schema: { type: "object", reqProps: {}, optProps: {} } });
