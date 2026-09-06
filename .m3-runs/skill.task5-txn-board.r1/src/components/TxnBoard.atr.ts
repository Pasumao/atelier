/**
 * TxnBoard.atr.ts — 父组件：唯一状态持有者（H4），以对象字面量逐字段向子组件 TxnItem 传 props。
 * store 事务演示：commit 锚定命名检查点 / add 整体替换引用追加 / rollback 回到上一检查点。
 * 注意：追加必须整体替换引用（items.value = [...]），原地 push 无法被回滚（state 纪律）。
 */
import { component, $state, html, store } from "../runtime";
import { TxnItem } from "./TxnItem.atr.ts";

export const txnBoardSchema = {
  type: "object",
  reqProps: {},
  optProps: {},
} as const;

interface Txn {
  name: string;
  count: number;
}

export const TxnBoard = component(function TxnBoard() {
  const items = $state<Txn[]>([{ name: "alpha", count: 1 }]);

  const commit = () => {
    store.commit("board");
  };
  const add = () => {
    items.value = [...items.value, { name: "beta", count: 2 }];
  };
  const rollback = () => {
    store.rollback();
  };

  return html`
    <div class="ppanel">
      <h2 class="text-md font-semibold">TxnBoard</h2>
      <ul>
        {#each items.value as it by it.name}
          <TxnItem name={it.name} count={it.count} />
        {/each}
      </ul>
      <div class="row">
        <button class="btn" on:click={commit}>commit</button>
        <button class="btn" on:click={add}>add</button>
        <button class="btn" on:click={rollback}>rollback</button>
      </div>
    </div>
  `.locals({ items, commit, add, rollback });
}, { name: "TxnBoard", schema: txnBoardSchema });
