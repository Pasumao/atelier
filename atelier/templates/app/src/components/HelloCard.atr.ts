/**
 * HelloCard.atr.ts — starter 示例组件：显式 $state + 扁平契约 + 语义 token 工具类。
 * 三元共置：实现（本文件）/ 意图验收（HelloCard.atr.md）/ 机检（HelloCard.atr.spec.ts）。
 * 改组件前先读 .atr.md；改契约必须三处同步。
 */
import { component, $state, html } from "../runtime";

export const helloCardSchema = {
  type: "object",
  reqProps: { title: { type: "string" } },
  optProps: { start: { type: "number" } },
} as const;

export const HelloCard = component(function HelloCard(props: { title: string; start?: number }) {
  const count = $state(props.start ?? 0);
  const inc = () => {
    count.value += 1;
  };
  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.title}</h2>
      <p class="text-muted">最小 Atelier 组件：显式 $state + 扁平契约 + 语义 token 工具类。</p>
      <button class="btn btn-primary" on:click={inc}>count: {count.value}</button>
    </div>
  `.locals({ props, count, inc });
}, { name: "HelloCard", schema: helloCardSchema });
