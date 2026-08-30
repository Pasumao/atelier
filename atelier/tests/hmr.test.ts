/**
 * hmr.test.ts — P0-5 热交换语义 + P1-4 泄漏边界关闭的验收。
 * 泄漏判据：store.graph()（v0.3 依赖图登记）的 effect 数在交换后不翻倍——
 * 旧实例 effects 已逐个 dispose（__effectSink 收集 → disposeInstance 注销）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $state, store, type Signal } from "../runtime/core.ts";
import { hmrRemountAll, mountComponent, type ComponentDef } from "../runtime/template.ts";
import { attachToDocument, makeContainer, serialize } from "./dom-shim.ts";

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

const okValidate = (): { ok: boolean } => ({ ok: true });

describe("P0-5/P1-4 HMR swap", () => {
  it("交换后旧 effects 全部 dispose（依赖图不翻倍）+ 保值重挂 + 新实例仍响应", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def: ComponentDef = {
      name: "HmrProbe",
      render: () => {
        const n = $state(1); // mount 期创建 → 归属本实例（creationSink 收集）
        return { raw: `<p>{n.value}</p>`, scope: { n } } as never;
      },
    };
    registry.set(def.name, def); // 真实流程：dev 插件重注册新模块后调 hmrSwap——同 key 查回
    mountComponent(def, {}, container, registry, okValidate as never);
    await flush();
    const effectsAfterMount = store.graph().effects.length;
    expect(effectsAfterMount).toBeGreaterThan(0); // bindExpr 的插值 effect 已登记

    const swapped = hmrRemountAll();
    expect(swapped).toBe(1);
    await flush();
    // 泄漏边界：旧 effect 已注销，依赖图里只剩新实例的同量 effects（修复前会 2 倍）
    expect(store.graph().effects.length).toBe(effectsAfterMount);
    // 保值重挂载：按创建序还原信号值
    expect(serialize(container)).toContain('"1"');

    // 新实例仍响应：交换后唯一存活信号即新实例的 n，写值 → DOM 跟随
    const [n] = [...store._signals] as Signal<number>[];
    n.set(42);
    await flush();
    expect(serialize(container)).toContain('"42"');
  });

  it("连续两轮交换不累积实例与 effects", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def: ComponentDef = {
      name: "HmrProbe2",
      render: () => {
        const n = $state(7);
        return { raw: `<b>{n.value}</b>`, scope: { n } } as never;
      },
    };
    registry.set(def.name, def);
    mountComponent(def, {}, container, registry, okValidate as never);
    await flush();
    const base = store.graph().effects.length;
    hmrRemountAll();
    await flush();
    hmrRemountAll();
    await flush();
    expect(store.graph().effects.length).toBe(base);
    expect(serialize(container)).toContain('"7"');
  });
});
