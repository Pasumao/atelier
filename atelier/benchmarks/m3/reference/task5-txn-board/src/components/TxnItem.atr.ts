import { component, html } from "../../../../../../runtime/index.ts";

export const TxnItem = component(function TxnItem(props: { name: string; count: number }) {
  return html`<li>{props.name} ×{props.count}</li>`;
}, { name: "TxnItem", schema: { type: "object", reqProps: { name: { type: "string" }, count: { type: "number" } }, optProps: {} } });
