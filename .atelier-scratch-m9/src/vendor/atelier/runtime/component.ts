/**
 * Atelier prototype — 组件注册与全局注册表（决策 1/6/7 雏形）。
 * 组件名取函数名；schema 写入组件元数据（完整版由编译器提取）。
 * 决策 26：编译期提取 schema sink——dev 插件/编译产物流把提取出的 FlatSchema 按组件名
 * 注册进 sink，component() 建元数据时兜底取用；显式 opts.schema 恒胜（向后兼容承诺）。
 */
import type { ComponentDef, ComponentRegistry } from "./template.ts";

export const registry: ComponentRegistry = new Map();

/* ---- 决策 26：提取 schema sink ------------------------------------------
 * 键 = 组件名，值 = 提取产物 FlatSchema（纯 JSON 形态 {type:"object",reqProps,...}）。
 * registerExtractedSchemas 逐键 set()——覆盖语义 = HMR 模块重求值后新产物刷新旧条目
 * （dev 插件 transform prepend 注册调用先于 component() 求值，重求值天然重注）。
 * 不提供 clear：生产面最小；测试隔离走 __resetExtractedSchemas 内部出口（不进 index.ts）。
 */
const extractedSchemas = new Map<string, unknown>();

/** 注册提取产物 schema（决策 26 冻结接口：dev 插件/编译产物流的单一接入点） */
export function registerExtractedSchemas(map: Record<string, unknown>): void {
  for (const [name, schema] of Object.entries(map)) {
    extractedSchemas.set(name, schema);
  }
}

/** test-only：清空 sink（用例互不污染；生产面零暴露——刻意不进 runtime/index.ts 桶出口） */
export function __resetExtractedSchemas(): void {
  extractedSchemas.clear();
}

let seq = 0;

export function component<P extends Record<string, unknown>>(
  render: (props: P) => ReturnType<typeof import("./template").html>,
  opts: { schema?: unknown; name?: string } = {}
): ComponentDef {
  const rawName = (render as unknown as { name?: string }).name ?? `Component${++seq}`;
  const name = opts.name ?? rawName; // 名字解析现序不变（决策 26 sink 按此 defName 兜底取用）
  const def: ComponentDef = {
    name,
    render: render as (props: Record<string, unknown>) => ReturnType<typeof import("./template").html>,
    // 决策 26 兜底：显式 opts.schema 恒胜（sink 有同名条目也不覆盖）；sink 未注 = undefined
    //（validateProps 对 undefined schema 走 no-op——「无 schema 不校验」诚实语义，用例钉死）
    schema: opts.schema ?? extractedSchemas.get(name),
  };
  registry.set(name, def);
  return def;
}
