/**
 * hmr.test.ts — P0-5 热交换语义 + P1-4 泄漏边界关闭的验收。
 * 泄漏判据：store.graph()（v0.3 依赖图登记）的 effect 数在交换后不翻倍——
 * 旧实例 effects 已逐个 dispose（__effectSink 收集 → disposeInstance 注销）。
 */
import "./dom-shim.ts";
import { beforeEach, describe, expect, it } from "vitest";
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

/* ---- m11 边界②③正修复（按名锚定还原）------------------------------------
 * 尾巴原文「模板结构大改按序还原可能错位——正修复需编译器闭包捕获」的前提经实读证伪：
 * .locals() scope 与收集信号是同一对象身份，运行时即有稳定命名，无需编译器。
 * 红检四枚：①声明序重排错位 ②新增信号插队错位 ③跨交换 checkpoint 不回落 ④改名误还原。
 * 未命名信号（prop 信号/未入 locals 的内部信号）维持创建序兜底——语义钉住不改。
 */
describe("m11 HMR 按名锚定还原（边界②③正修复）", () => {
  beforeEach(() => {
    // 清场：前序用例容器摘出文档 → 其断连实例经 hmrSwap 的 reapDisconnected 即席回收
    //（liveInstances 模块级共享，不清场会跨用例连坐交换——交换计数断言会抓到）
    const docEl = (globalThis as unknown as { document?: { documentElement: { childNodes: { remove(): void }[] } } })
      .document?.documentElement;
    for (const c of [...(docEl?.childNodes ?? [])]) c.remove();
    hmrRemountAll();
    store._checkpoints.splice(0); // 用例隔离：本文件 store 为模块级共享
    store._journal.splice(0);
  });

  it("红检①：信号声明序重排（结构大改典型副产品）——按名还原不错位", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def1: ComponentDef = {
      name: "OrderProbe",
      render: () => {
        const a = $state(11);
        const b = $state(22);
        return { raw: `<p>{a.value},{b.value}</p>`, scope: { a, b } } as never;
      },
    };
    registry.set(def1.name, def1);
    mountComponent(def1, {}, container, registry, okValidate as never);
    await flush();

    let a2!: Signal<number>;
    let b2!: Signal<number>;
    const def2: ComponentDef = {
      name: "OrderProbe",
      render: () => {
        const b = $state(888); // 重构后声明序互换
        const a = $state(999);
        a2 = a;
        b2 = b;
        return { raw: `<p>{a.value},{b.value}</p>`, scope: { a, b } } as never;
      },
    };
    registry.set(def2.name, def2);
    expect(hmrRemountAll()).toBe(1);
    await flush();
    // 修复前（按创建序下标还原）：fresh[0]=b2 吃到旧 a 值 11、a2 吃到 22——错位
    expect(a2.get()).toBe(11);
    expect(b2.get()).toBe(22);
    await flush();
    expect(serialize(container)).toContain('"11"');
  });

  it("红检②：新增信号插队——新信号保持初值，既有信号按名保值", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def1: ComponentDef = {
      name: "InsertProbe",
      render: () => {
        const a = $state(11);
        const b = $state(22);
        return { raw: `<p>{a.value},{b.value}</p>`, scope: { a, b } } as never;
      },
    };
    registry.set(def1.name, def1);
    mountComponent(def1, {}, container, registry, okValidate as never);
    await flush();

    let a2!: Signal<number>;
    let b2!: Signal<number>;
    let z2!: Signal<string>;
    const def2: ComponentDef = {
      name: "InsertProbe",
      render: () => {
        const z = $state("brand-new"); // 新增声明排在最前
        const a = $state(999);
        const b = $state(888);
        z2 = z;
        a2 = a;
        b2 = b;
        return { raw: `<p>{a.value},{b.value}</p>`, scope: { z, a, b } } as never;
      },
    };
    registry.set(def2.name, def2);
    expect(hmrRemountAll()).toBe(1);
    await flush();
    // 修复前：z2 吃到旧 a 的 11、a2 吃到 22、b2 保持 888——三处全错
    expect(z2.get()).toBe("brand-new"); // 新信号保持初值（尾巴原文的预期行为）
    expect(a2.get()).toBe(11);
    expect(b2.get()).toBe(22);
    await flush();
    expect(serialize(container)).toContain('"11"');
  });

  it("红检③：跨交换 checkpoint 回落到新信号（timeTravel 不再写死信号）", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    let a1!: Signal<number>;
    const def1: ComponentDef = {
      name: "CpProbe",
      render: () => {
        const a = $state(11);
        a1 = a;
        return { raw: `<p>{a.value}</p>`, scope: { a } } as never;
      },
    };
    registry.set(def1.name, def1);
    mountComponent(def1, {}, container, registry, okValidate as never);
    await flush();
    const cp = store.commit("before-refactor"); // 快照：a=11
    a1.set(50); // 后续编辑推进状态
    await flush();

    let a2!: Signal<number>;
    const def2: ComponentDef = {
      name: "CpProbe",
      render: () => {
        const a = $state(999);
        a2 = a;
        return { raw: `<p>{a.value}</p>`, scope: { a } } as never;
      },
    };
    registry.set(def2.name, def2);
    expect(hmrRemountAll()).toBe(1);
    await flush();
    expect(a2.get()).toBe(50); // 交换保值先行（还原当前值 50，非初值）

    expect(store.timeTravel(cp)).toBe(true);
    await flush();
    // 修复前：_restore 写的是旧实例死信号（snap 仍持旧引用），a2 停在 50
    expect(a2.get()).toBe(11);
    expect(serialize(container)).toContain('"11"'); // DOM 跟随回落
  });

  it("红检④：改名=保守不还原（绝不把旧值写进语义不同的新信号）", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def1: ComponentDef = {
      name: "RenameProbe",
      render: () => {
        const a = $state(11);
        return { raw: `<p>{a.value}</p>`, scope: { a } } as never;
      },
    };
    registry.set(def1.name, def1);
    mountComponent(def1, {}, container, registry, okValidate as never);
    await flush();

    let b2!: Signal<number>;
    const def2: ComponentDef = {
      name: "RenameProbe",
      render: () => {
        const b = $state(999); // 重命名 a → b：语义变更，旧值身份已灭
        b2 = b;
        return { raw: `<p>{b.value}</p>`, scope: { b } } as never;
      },
    };
    registry.set(def2.name, def2);
    expect(hmrRemountAll()).toBe(1);
    await flush();
    // 修复前：下标 0 对 0，b2 被写入 11——恰是边界②要消灭的错位
    expect(b2.get()).toBe(999); // 保守保持初值
  });

  it("语义钉：未入 locals 的内部信号维持创建序兜底还原（prop 信号同款）", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def1: ComponentDef = {
      name: "UnnamedProbe",
      render: () => {
        const a = $state(11);
        const x = $state(77); // 未入 locals：模板不可见，仅程序体内部使用
        void x;
        return { raw: `<p>{a.value}</p>`, scope: { a } } as never;
      },
    };
    registry.set(def1.name, def1);
    mountComponent(def1, {}, container, registry, okValidate as never);
    await flush();

    let a2!: Signal<number>;
    let x2!: Signal<number>;
    const def2: ComponentDef = {
      name: "UnnamedProbe",
      render: () => {
        const a = $state(999);
        const x = $state(888);
        a2 = a;
        x2 = x;
        void x;
        return { raw: `<p>{a.value}</p>`, scope: { a } } as never;
      },
    };
    registry.set(def2.name, def2);
    expect(hmrRemountAll()).toBe(1);
    await flush();
    expect(a2.get()).toBe(11); // 按名
    expect(x2.get()).toBe(77); // 未命名子集内按相对序兜底（修复前后行为一致）
  });

  it("语义钉：同序不变时按名还原与既有按序还原结果一致", async () => {
    const container = attachToDocument(makeContainer());
    const registry = new Map<string, ComponentDef>();
    const def1: ComponentDef = {
      name: "StableProbe",
      render: () => {
        const n = $state(1);
        return { raw: `<p>{n.value}</p>`, scope: { n } } as never;
      },
    };
    registry.set(def1.name, def1);
    mountComponent(def1, {}, container, registry, okValidate as never);
    await flush();
    registry.set(def1.name, { ...def1 }); // 同 def 重注册（重求值模拟）
    expect(hmrRemountAll()).toBe(1);
    await flush();
    expect(serialize(container)).toContain('"1"'); // 既有 P0-5 保值语义逐字不破
  });
});
