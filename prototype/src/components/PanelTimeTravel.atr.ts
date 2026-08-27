/**
 * PanelTimeTravel.atr.ts — 实验台：事务时间旅行。
 * 状态存全局 store（跨面板持久），本组件只做编辑模拟与渲染；
 * 回到某个 checkpoint 用 data-cp + 事件委托读 currentTarget——
 * 模板表达式不支持内联箭头函数传参，这是引擎约束下的正确姿势。
 */
import { component, $state, $derived, html, store } from "../runtime";

export const PanelTimeTravel = component(function PanelTimeTravel() {
  const refresh = $state(0);
  const genA = $state("等待 AI 第一轮编辑");
  const genB = $state("—");
  const genC = $state("—");

  let round = 0;
  const onSimAI = () => {
    round += 1;
    genA.value = `v${round}.1 组件骨架已生成`;
    genB.value = `v${round}.2 样式套用 token 体系完毕`;
    genC.value = `v${round}.3 契约校验 + 快照断言通过`;
    store.commit(`AI 第 ${round} 轮编辑`);
    refresh.value += 1;
  };
  const onRollback = () => {
    store.rollback();
    refresh.value += 1;
  };
  // 最新在前（切片反转，避免原地修改 store 内部数组）
  const timeline = $derived(() => {
    refresh.value;
    return store.list().slice().reverse();
  });

  const travelFromEvent = (e: Event) => {
    const id = (e.currentTarget as HTMLElement | null)?.closest("[data-cp]")?.getAttribute("data-cp") ?? "";
    if (id && store.timeTravel(id)) refresh.value += 1;
  };

  return html`
    <div class="ppanel">
      <h3 class="ppanel__title">🔁 事务时间旅行</h3>
      <div class="tx-log">
        <div class="tx-log__row">A. {genA.value}</div>
        <div class="tx-log__row">B. {genB.value}</div>
        <div class="tx-log__row">C. {genC.value}</div>
      </div>
      <div class="ppanel__actions">
        <button class="pbtn pbtn--primary" on:click={onSimAI}>模拟一轮 AI 编辑 → 命名 checkpoint</button>
        <button class="pbtn pbtn--danger" on:click={onRollback}>↩ 回滚一步</button>
      </div>
      <ul class="timeline">
        {#each timeline.value as cp}
          <li class="timeline__item">
            <code class="timeline__id">{cp.id}</code>
            <span class="timeline__name">{cp.name}</span>
            <button class="pbtn pbtn--mini" data-cp={cp.id} on:click={travelFromEvent}>回到此刻 ⇖</button>
          </li>
        {/each}
      </ul>

      <style scoped>
        .ppanel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md) var(--space-lg); animation: panel-in .25s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        .ppanel__title { font-size: 1rem; margin-bottom: .35rem; }
        .ppanel__actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-sm); }
        .pbtn { display: inline-block; border: 0; border-radius: var(--radius-sm); padding: .52rem 1rem; cursor: pointer; font-size: .85rem; font-weight: 600; transition: transform .15s, box-shadow .15s; }
        .pbtn--primary { background: var(--color-primary); color: var(--color-bg); }
        .pbtn--danger { background: var(--color-danger); color: var(--color-text); font-weight: 400; }
        .pbtn--mini { padding: .18rem .55rem; font-size: .72rem; font-weight: 400; background: transparent; border: 1px solid var(--color-surface-2); color: var(--color-muted); }
        .pbtn--mini:hover { color: var(--color-text); border-color: var(--color-primary); }
        .tx-log { display: flex; flex-direction: column; gap: .3rem; font-size: .84rem; color: var(--color-muted); font-family: ui-monospace, monospace; background: var(--color-bg); border: 1px solid var(--color-surface-2); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); }
        .timeline { list-style: none; margin-top: var(--space-md); display: flex; flex-direction: column; border-left: 2px solid color-mix(in srgb, var(--color-primary) 45%, transparent); padding-left: var(--space-md); gap: .55rem; max-height: 260px; overflow-y: auto; }
        .timeline__item { display: flex; align-items: center; gap: var(--space-sm); position: relative; animation: panel-in .3s ease both; }
        .timeline__item::before { content: ""; position: absolute; left: calc(var(--space-md) * -1 - 6px); width: 9px; height: 9px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 8px color-mix(in srgb, var(--color-primary) 70%, transparent); }
        .timeline__id { color: var(--color-primary); font-size: .74rem; }
        .timeline__name { color: var(--color-muted); font-size: .82rem; flex: 1; }
      </style>
    </div>
  `.locals({ props: {}, refresh, genA, genB, genC, onSimAI, onRollback, timeline, travelFromEvent });
}, { name: "PanelTimeTravel" });
