/**
 * Atelier prototype — 运行时入口（对应未来 packages/core）。
 */
export { $state, $derived, $effect, store } from "./core";
export type { Signal } from "./core";
export { html, initTokens, tokenState, mountComponent } from "./template";
export type { HtmlTemplate, ComponentDef, ComponentRegistry } from "./template";
export { streamValue, optimisticList } from "./primitives";
export type { StreamValue, OptimisticItem } from "./primitives";
export { validateFlat, validateUnknown } from "./contract";
export type { FlatSchema, AtrError } from "./contract";
export { component, registry } from "./component";
