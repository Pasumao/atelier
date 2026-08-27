/**
 * PanelTimeTravel.atr.ts — 实验台：事务时间旅行。
 * 【决策 16】样式全部迁移至 .ppanel/.btn recipe + 工具类；scoped 已清空。
 * 状态存全局 store（跨面板持久）；回到某个 checkpoint 用 data-cp + 事件委托读目标——
 * 模板表达式不支持带参函数调用，这是引擎约束下的正确姿势。
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
      <h3 class="text-base mb-1">🔁 事务时间旅行</h3>
      <div class="flex flex-col gap-[.3rem] text-sm text-muted font-mono bg-bg border border-surface-2 rounded-md px-md py-sm">
        <div>A. {genA.value}</div>
        <div>B. {genB.value}</div>
        <div>C. {genC.value}</div>
      </div>
      <div class="flex flex-wrap gap-sm mt-sm">
        <button class="btn btn-primary" on:click={onSimAI}>模拟一轮 AI 编辑 → 命名 checkpoint</button>
        <button class="btn btn-danger" on:click={onRollback}>↩ 回滚一步</button>
      </div>
      <ul class="list-none flex flex-col gap-[.55rem] mt-md pl-md border-l-2 border-primary/45 max-h-64 overflow-y-auto">
        {#each timeline.value as cp}
          <li class="flex items-center gap-sm relative animate-[panel-in_.3s_ease_both]">
            <span class="absolute -left-[22px] w-[9px] h-[9px] rounded-full bg-primary shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary)_70%,transparent)]"></span>
            <code class="text-xs text-primary">{cp.id}</code>
            <span class="text-sm text-muted flex-1">{cp.name}</span>
            <button class="btn btn-mini" data-cp={cp.id} on:click={travelFromEvent}>回到此刻 ⇖</button>
          </li>
        {/each}
      </ul>
    </div>
  `.locals({ props: {}, refresh, genA, genB, genC, onSimAI, onRollback, timeline, travelFromEvent });
}, { name: "PanelTimeTravel" });
