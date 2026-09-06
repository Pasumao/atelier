import { component, $state, html } from "../../../../../../runtime/index.ts";

export const TxnItem = component(function TxnItem(props: { name: string; count: number }) {
  const tapped = $state(0); // 变异：子组件私建状态
  return html`<li>{props.name} ×{props.count}{#if tapped.value}!{/if}</li>`;
}, { name: "TxnItem", schema: { type: "object", reqProps: { name: { type: "string" }, count: { type: "number" } }, optProps: {} } });
