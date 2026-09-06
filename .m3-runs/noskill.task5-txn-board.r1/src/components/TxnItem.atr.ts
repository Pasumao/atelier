/**
 * TxnItem.atr.ts — 纯展示子组件（task5）：props 进、<li> 出，不自建 $state（H4：
 * 状态只存在于父组件 TxnBoard，子组件零私有状态）。契约：reqProps name/count，
 * optProps 为空。值一律经 {…} 插值渲染。
 */
import { component, html } from "../runtime";

export const txnItemSchema = {
  type: "object",
  reqProps: {
    name: { type: "string" },
    count: { type: "number" },
  },
  optProps: {},
} as const;

export const TxnItem = component(function TxnItem(props: { name: string; count: number }) {
  // 纯展示：不调用 $state，不持任何信号——props 只读（props 所有权在父）
  return html`
    <li>{name} ×{count}</li>
  `.locals({ props, name: props.name, count: props.count });
}, { name: "TxnItem", schema: txnItemSchema });
