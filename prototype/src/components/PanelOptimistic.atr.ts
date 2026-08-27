/**
 * PanelOptimistic.atr.ts — 实验台：optimisticList 三态乐观列表。
 * 挂载时播种已确认项；异步提交 900ms 落定、故障注入 700ms 自动 revert。
 */
import { component, $state, $derived, html, optimisticList } from "../runtime";

export const PanelOptimistic = component(function PanelOptimistic() {
  const feats = optimisticList<{ id: string; label: string }>();
  const seedFeats = [
    { id: "f-0", label: "OpenAI 兼容接口 /chat/completions" },
    { id: "f-1", label: "1M 上下文窗口" },
    { id: "f-2", label: "Function Calling 原生支持" },
  ];
  for (const s of seedFeats) {
    feats.optimisticAdd(s);
    feats.commit(s.id);
  }
  let fseq = seedFeats.length;
  const revertCount = $derived(() => feats.rollbacked.length);

  const onAsyncAdd = () => {
    const id = `f-${++fseq}`;
    feats.optimisticAdd({ id, label: `AI 正在提交新特性 #${fseq}` });
    setTimeout(() => feats.commit(id), 900);
  };
  const onFailAdd = () => {
    const id = `f-${++fseq}`;
    feats.optimisticAdd({ id, label: `故障注入 #${fseq}：服务端拒绝` });
    setTimeout(() => feats.revert(id), 700);
  };

  return html`
    <div class="ppanel">
      <h3 class="ppanel__title">🧪 optimisticList 三态</h3>
      <p class="ppanel__hint">pending 先上屏给即时反馈，确认后 commit、失败自动 revert——历史回滚次数：{revertCount.value}</p>
      <ul class="feature-list">
        {#each feats.values as f}
          <li class="feature">
            <span class={f.status === "pending" ? "feature__dot feature__dot--pending" : "feature__dot feature__dot--ok"}>{f.status === "pending" ? "…" : "✓"}</span>
            <span class="feature__label">{f.it.label}</span>
            {#if f.status === "pending"}<em class="feature__pending">pending</em>{/if}
          </li>
        {/each}
      </ul>
      <div class="ppanel__actions">
        <button class="pbtn pbtn--primary" on:click={onAsyncAdd}>模拟 AI 异步提交（900ms 确定）</button>
        <button class="pbtn pbtn--warn" on:click={onFailAdd}>模拟失败（700ms 自动回滚）</button>
      </div>

      <style scoped>
        .ppanel { background: var(--color-surface); border: 1px solid var(--color-surface-2); border-radius: var(--radius-lg); padding: var(--space-md) var(--space-lg); animation: panel-in .25s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        .ppanel__title { font-size: 1rem; margin-bottom: .35rem; }
        .ppanel__hint { color: var(--color-muted); font-size: .82rem; margin-bottom: var(--space-sm); }
        .ppanel__actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-sm); }
        .pbtn { display: inline-block; border: 0; border-radius: var(--radius-sm); padding: .52rem 1rem; cursor: pointer; font-size: .85rem; font-weight: 600; transition: transform .15s, box-shadow .15s; }
        .pbtn--primary { background: var(--color-primary); color: var(--color-bg); }
        .pbtn--primary:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--color-primary) 80%, transparent); }
        .pbtn--warn { background: var(--color-warn); color: var(--color-bg); }
        .pbtn--warn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--color-warn) 80%, transparent); }
        .feature-list { list-style: none; display: flex; flex-direction: column; gap: var(--space-sm); margin: var(--space-sm) 0; }
        .feature { display: flex; align-items: center; gap: var(--space-sm); animation: panel-in .3s ease both; }
        .feature__dot { width: 21px; height: 21px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: .72rem; flex-shrink: 0; }
        .feature__dot--ok { background: color-mix(in srgb, var(--color-ok) 17%, transparent); color: var(--color-ok); }
        .feature__dot--pending { background: color-mix(in srgb, var(--color-warn) 18%, transparent); color: var(--color-warn); animation: pulse-dot 1s ease-in-out infinite; }
        @keyframes pulse-dot { 50% { opacity: .45; } }
        .feature__pending { color: var(--color-warn); font-style: normal; font-size: .72rem; }
        .feature__label { font-size: .88rem; }
      </style>
    </div>
  `.locals({ props: {}, feats, revertCount, onAsyncAdd, onFailAdd });
}, { name: "PanelOptimistic" });
