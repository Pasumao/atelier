/**
 * TxnBoard.atr.ts — 跨组件状态事务父组件（task5）：状态只存在于本组件（H4），
 * 子组件 TxnItem 纯展示。三条纪律：
 *  1. 对象字面量逐字段传 props：<TxnItem name={it.name} count={it.count} />;
 *  2. 数组更新整体替换引用（决策 5：快照按引用记录，原地修改 rollback 恢不回来）;
 *  3. store.commit("board") 锚定 / store.rollback() 回滚本轮。
 */
import { component, $state, store, html } from "../runtime";
// 副作用导入：执行 TxnItem 模块即注册进全局 registry，模板 <TxnItem> 才可解析
//（勿改为具名导入后弃用——会被 transform 静默摇掉，<TxnItem> 落 ATR-4xx 未注册错误卡）
import "./TxnItem.atr.ts";

export const txnBoardSchema = {
  type: "object",
  reqProps: {},
  optProps: {},
} as const;

export const TxnBoard = component(function TxnBoard() {
  const items = $state<{ name: string; count: number }[]>([{ name: "alpha", count: 1 }]);

  const commit = () => {
    store.commit("board");
  };
  const add = () => {
    // 整体替换引用追加（勿 items.value.push —— 决策 5 快照语义）
    items.value = [...items.value, { name: "beta", count: 2 }];
  };
  const rollback = () => {
    store.rollback();
  };

  return html`
    <div class="ppanel">
      <ul>
        {#each items.value as it by it.name}
          <TxnItem name={it.name} count={it.count} />
        {/each}
      </ul>
      <button class="btn btn-primary" on:click={commit}>commit</button>
      <button class="btn" on:click={add}>add</button>
      <button class="btn" on:click={rollback}>rollback</button>
    </div>
  `.locals({ items, commit, add, rollback });
}, { name: "TxnBoard", schema: txnBoardSchema });
