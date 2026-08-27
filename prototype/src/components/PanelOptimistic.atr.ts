/**
 * PanelOptimistic.atr.ts — 实验台：optimisticList 三态乐观列表。
 * 【决策 16 试点】样式改为 token 派生 Tailwind 工具类（bg-primary / gap-sm / bg-ok/17…）；
 * 仅 @keyframes 留在 <style scoped>（混合制：工具类管值，scoped 管动画等异形效果）。
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

  // 动态属性只接受整值表达式：完整类名串在 TS 侧拼好（模板内无调用/拼接）
  const dotCls = (pending: boolean) =>
    "inline-flex w-5 h-5 items-center justify-center rounded-full text-xs shrink-0 " +
    (pending
      ? "bg-warn/18 text-warn animate-[pulse-dot_1s_ease-in-out_infinite]"
      : "bg-ok/17 text-ok");

  return html`
    <div class="rounded-lg border border-surface-2 bg-surface px-lg py-md animate-[panel-in_.25s_ease]">
      <h3 class="text-base mb-1">🧪 optimisticList 三态</h3>
      <p class="text-sm text-muted mb-sm">pending 先上屏给即时反馈，确认后 commit、失败自动 revert——历史回滚次数：{revertCount.value}</p>
      <ul class="list-none flex flex-col gap-sm my-sm">
        {#each feats.values as f}
          <li class="flex items-center gap-sm animate-[panel-in_.3s_ease_both]">
            <span class={dotCls(f.status === "pending")}>{f.status === "pending" ? "…" : "✓"}</span>
            <span class="text-sm">{f.it.label}</span>
            {#if f.status === "pending"}<em class="text-warn not-italic text-xs">pending</em>{/if}
          </li>
        {/each}
      </ul>
      <div class="flex flex-wrap gap-sm mt-sm">
        <button class="inline-block rounded-sm px-4 py-2 text-sm font-semibold transition-all duration-150 bg-primary text-bg hover:-translate-y-px hover:shadow-[0_10px_22px_-12px_color-mix(in_srgb,var(--color-primary)_80%,transparent)]" on:click={onAsyncAdd}>模拟 AI 异步提交（900ms 确定）</button>
        <button class="inline-block rounded-sm px-4 py-2 text-sm font-semibold transition-all duration-150 bg-warn text-bg hover:-translate-y-px hover:shadow-[0_10px_22px_-12px_color-mix(in_srgb,var(--color-warn)_80%,transparent)]" on:click={onFailAdd}>模拟失败（700ms 自动回滚）</button>
      </div>

      <style scoped>
        /* 混合制逃生舱：keyframes 定义留在此处（动画名文档全局，选择器不涉及值） */
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
        @keyframes pulse-dot { 50% { opacity: .45; } }
      </style>
    </div>
  `.locals({ props: {}, feats, revertCount, onAsyncAdd, onFailAdd, dotCls });
}, { name: "PanelOptimistic" });
