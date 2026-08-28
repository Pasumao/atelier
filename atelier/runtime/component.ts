/**
 * Atelier prototype — 组件注册与全局注册表（决策 1/6/7 雏形）。
 * 组件名取函数名；schema 写入组件元数据（完整版由编译器提取）。
 */
import type { ComponentDef, ComponentRegistry } from "./template";

export const registry: ComponentRegistry = new Map();

let seq = 0;

export function component<P extends Record<string, unknown>>(
  render: (props: P) => ReturnType<typeof import("./template").html>,
  opts: { schema?: unknown; name?: string } = {}
): ComponentDef {
  const rawName = (render as unknown as { name?: string }).name ?? `Component${++seq}`;
  const name = opts.name ?? rawName;
  const def: ComponentDef = {
    name,
    render: render as (props: Record<string, unknown>) => ReturnType<typeof import("./template").html>,
    schema: opts.schema,
  };
  registry.set(name, def);
  return def;
}
