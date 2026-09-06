/**
 * ContractProbe.atr.ts — P1-9 契约路径演示组件：让 ATR-201 校验路径在 starter 里被真实锻炼。
 * 双实例演示（见 main.ts）：合法 props 渲染正常；缺 reqProps 的实例渲染 ATR-201 错误卡
 * （P2-1 错误边界兜住，绝不白屏）。三元共置：实现 / 意图验收（.atr.md）/ 机检（.atr.spec.ts）。
 */
import { component, $state, html } from "../runtime";

export const contractProbeSchema = {
  type: "object",
  reqProps: { title: { type: "string" }, level: { type: "number" } },
  optProps: { note: { type: "string" } },
} as const;

export const ContractProbe = component(function ContractProbe(props: { title: string; level: number; note?: string }) {
  const bumped = $state(0);
  const bump = () => {
    bumped.value += 1;
  };
  return html`
    <div class="ppanel">
      <h2 class="text-md font-semibold">{props.title}</h2>
      <p class="text-muted">level: {props.level} · bump: {bumped.value}</p>
      <button class="btn" on:click={bump}>bump</button>
    </div>
  `.locals({ props, bumped, bump });
}, { name: "ContractProbe", schema: contractProbeSchema });
