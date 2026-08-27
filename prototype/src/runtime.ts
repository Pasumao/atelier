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
