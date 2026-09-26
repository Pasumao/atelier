/**
 * SchemaProbe.atr.ts — 决策 26 schema 编译期提取 v1 的核对物组件：**注解即唯一 schema 源**。
 * props 类型注解 { label: string; times?: number } 经编译期提取（compiler/extract-schema.mjs，
 * 与 dev 插件 transform 注入同源同函数）自动注册进 runtime sink，component() 求值时兜底取用——
 * 本文件【不写手写 schema 元数据】，映射面之外的注解会在 dev 提取期 ATR-102 显式拒绝（fix 指路手写）。
 *
 * 模板面：{props.label} 直出 + times 条件渲染（times > 1 出重复行）——样式走既有 token/recipe 纪律。
 * 端到端机检（注解→提取→sink→component() 兜底→真实校验链）见 SchemaProbe.atr.spec.ts。
 * 三元共置：实现（本文件）/ 意图验收（SchemaProbe.atr.md）/ 机检（SchemaProbe.atr.spec.ts）。
 */
import { component, html } from "../runtime";

export const SchemaProbe = component(function SchemaProbe(props: { label: string; times?: number }) {
  return html`
    <div class="ppanel">
      <h2 class="text-lg font-semibold">{props.label}</h2>
      <p class="text-muted text-sm">
        注解即 schema（决策 26）：props 类型注解经编译期提取进 runtime sink，本组件无手写 schema 元数据；
        dev 插件 transform 同源注入，显式手写仍优先。
      </p>
      {#if props.times > 1}<p class="text-md">repeat: {props.label} ×{props.times}</p>{/if}
    </div>
  `.locals({ props });
}, { name: "SchemaProbe" });
