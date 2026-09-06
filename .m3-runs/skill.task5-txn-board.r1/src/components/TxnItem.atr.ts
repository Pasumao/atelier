/**
 * TxnItem.atr.ts — 子组件（纯展示）：只接收父组件逐字段传入的 props，渲染一行交易项。
 * H4 纪律：不得自建 $state——状态只存在于父组件 TxnBoard，本组件无任何信号。
 */
import { component, html } from "../runtime";

export const txnItemSchema = {
  type: "object",
  reqProps: { name: { type: "string" }, count: { type: "number" } },
  optProps: {},
} as const;

export const TxnItem = component(function TxnItem(props: { name: string; count: number }) {
  return html`
    <li>{props.name} ×{props.count}</li>
  `.locals({ props });
}, { name: "TxnItem", schema: txnItemSchema });
