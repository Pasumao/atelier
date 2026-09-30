/**
 * Atelier prototype — 运行时入口（对应未来 packages/core）。
 */
export { $state, $derived, $effect, $effectStatic, store } from "./core.ts"; // $effectStatic: F-2 二期静态预订阅（调用方保证 追踪集⊆deps）
export type { Signal } from "./core.ts";
export { html, initTokens, tokenState, mountComponent } from "./template.ts";
export type { HtmlTemplate, ComponentDef, ComponentRegistry } from "./template.ts";
export { bindAttr } from "./template.ts"; // R1-B 支（P1 #5）：动态属性单点（bind 族五参同款形态；架构师指定进桶出口）
export { parseTemplate } from "./template.ts"; // compiler face (P0-2②): same parser, same truth
export type { TemplateNode, TemplateAttr } from "./template.ts";
export { streamValue, optimisticList } from "./primitives.ts";
export type { StreamValue, OptimisticItem, StreamError, RevertErrorEntry } from "./primitives.ts"; // StreamError/RevertErrorEntry: §8.3 错误面贯通（纯加法）
export { validateFlat, validateUnknown, collectFlatIssues } from "./contract.ts";
export type { FlatSchema, AtrError, FlatIssue } from "./contract.ts";
export { withStandard, isStandardSchema, STANDARD_VENDOR } from "./standard-schema.ts"; // 决策 22（FS-2）：Standard Schema V1 互操作口
export type { StandardSchemaFace, StandardSchemaProps, StandardValidateResult, StandardIssue } from "./standard-schema.ts";
export { component, registry } from "./component.ts";
export { registerExtractedSchemas } from "./component.ts"; // 决策 26：提取 schema sink 注册口（__resetExtractedSchemas test-only，不出桶）
export { installStateBridge } from "./bridge.ts";
export { hmrRemountAll, unmount } from "./template.ts"; // P0-5: 保值热交换（dev 插件注入的 accept 回调经 window 钩子调用）；R1-B 支（P1 #9③）: 公开实例卸载（SPA 路由切换销账）
export { registerCompiled, compiledTemplateCount } from "./template.ts"; // P0-2③: 编译产物注册（codegen 模块接入零 tokenize 快路径）
export type { CompiledTemplate } from "./template.ts";

/**
 * devFetch — 页面侧访问 Atelier dev 面的安全封装。
 * 决策 9/12：dev 面 /__atelier/* 校验一次性 token（页面经 transformIndexHtml 注入
 * window.__ATELIER_TOKEN__）；页面侧 fetch 必须显式带 x-atelier-token 头，否则被
 * ATR-402 拦截（旧代码漏了这步，导致 stream-intro / registry 静默失败）。
 */
export function devFetch(path: string, init?: RequestInit): Promise<Response> {
  const t = (globalThis as never as { __ATELIER_TOKEN__?: string }).__ATELIER_TOKEN__ ?? "";
  const headers = new Headers(init?.headers);
  if (t) headers.set("x-atelier-token", t);
  return fetch(path, { ...init, headers });
}
