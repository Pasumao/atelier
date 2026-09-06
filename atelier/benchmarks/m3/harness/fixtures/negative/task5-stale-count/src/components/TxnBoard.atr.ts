import { component, $state, html, store } from "../../../../../../runtime/index.ts";

type Item = { name: string; count: number };

export const TxnBoard = component(function TxnBoard() {
  const items = $state<Item[]>([{ name: "alpha", count: 1 }]);
  const commit = () => store.commit("board");
  const add = () => (items.value = [...items.value, { name: "beta", count: items.value.length }]);
  const rollback = () => store.rollback();
  return html`
    <div><ul>{#each items.value as it by it.name}<TxnItem name={it.name} count={it.count} />{/each}</ul>
    <button on:click={commit}>commit</button><button on:click={add}>add</button><button on:click={rollback}>rollback</button></div>
  `.locals({ items, commit, add, rollback });
}, { name: "TxnBoard", schema: { type: "object", reqProps: {}, optProps: {} } });
