/**
 * f2-fastpath.test.ts — F-2 二期·跳过追踪快路径（$effectStatic）验收：
 *   ① 静态预订阅语义：deps 精确订阅 + fn 无追踪求值（fn 内读取不进 deps）
 *   ② exactness 判据边界：函数调用回退（隐藏读仍被动态追踪抓住）· 嵌套信号读回退
 *      （props getter / 普通对象属性链）· 短路良性超订阅（输出语义不变）
 * 判据红线：不确定 = 回退（宁慢勿错）；静态集 ⊆ 保证 = 语义等价（决策 3 二期）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $effectStatic, $state } from "../runtime/core.ts";
import { mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { validateFlat } from "../runtime/contract.ts";

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};
function findByTag(node: any, tag: string): any {
  if (node?.tag === tag) return node;
  for (const c of node?.childNodes ?? []) {
    const r = findByTag(c, tag);
    if (r) return r;
  }
  return null;
}

describe("$effectStatic（静态预订阅内核）", () => {
  it("deps 精确订阅：deps 内信号触发重跑；fn 内读取（deps 外）不触发", async () => {
    const s1 = $state(1);
    const s2 = $state(10);
    let runs = 0;
    let last = 0;
    const dispose = $effectStatic(() => {
      runs++;
      last = s1.value + s2.value; // s2 被读但不在 deps——无追踪 ⇒ 不得触发
    }, [s1]);
    expect(runs).toBe(1);
    expect(last).toBe(11);
    s2.value = 20;
    await flush();
    expect(runs).toBe(1); // 未订阅 → 不重跑（⊆ 契约的反向证明：fn 确实无追踪）
    s1.value = 2;
    await flush();
    expect(runs).toBe(2);
    expect(last).toBe(22);
    dispose();
    s1.value = 3;
    await flush();
    expect(runs).toBe(2); // dispose 后不再响应
  });
});

describe("bindExpr exactness 判据（模板集成）", () => {
  it("exact 表达式走快路径后行为不变（更新照常流动）", async () => {
    const n = $state(2);
    const m = $state(3);
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "FastExact",
      render: () => ({ raw: `<b>{n.value * 10 + m.value}</b>`, scope: { n, m } }) as never,
    };
    reg.set("FastExact", def);
    const container = document.createElement("div");
    mountComponent(def, {}, container, reg, validateFlat);
    await flush();
    const b = findByTag(container, "b");
    expect(b.textContent).toBe("23");
    n.value = 4;
    await flush();
    expect(b.textContent).toBe("43");
    m.value = 5;
    await flush();
    expect(b.textContent).toBe("45");
  });

  it("模板语法层本就拒绝函数调用（ATR-301）——bindExpr 的 paren 守卫是未来语法扩展的纵深防御", async () => {
    const hidden = $state("h1");
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "CallRejected",
      render: () =>
        ({ raw: `<i>{probe()}</i>`, scope: { probe: () => `v:${hidden.value}` } }) as never,
    };
    reg.set("CallRejected", def);
    const container = document.createElement("div");
    mountComponent(def, {}, container, reg, validateFlat);
    await flush();
    // ATR-301 前置报错语义：含 "( )" 的表达式渲染为可行动错误卡而非静默求值
    expect(findByTag(container, "i")?.textContent ?? container.textContent).toContain("ATR-301");
  });

  it("根非信号回退：普通对象属性链深处的信号读仍被追踪（props getter 同形态）", async () => {
    const inner = $state("i1");
    const holder = { hidden: inner }; // 根 = holder（非信号），信号藏在属性链深处
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "NestedFallback",
      render: () => ({ raw: `<u>{holder.hidden.value}</u>`, scope: { holder } }) as never,
    };
    reg.set("NestedFallback", def);
    const container = document.createElement("div");
    mountComponent(def, {}, container, reg, validateFlat);
    await flush();
    const u = findByTag(container, "u");
    expect(u.textContent).toBe("i1");
    inner.value = "i2";
    await flush();
    expect(u.textContent).toBe("i2");
  });

  it("短路/三元良性超订阅：输出语义与动态追踪一致", async () => {
    const flag = $state(false);
    const a = $state("A");
    const b = $state("B");
    const reg: ComponentRegistry = new Map();
    const def: ComponentDef = {
      name: "ShortCircuit",
      render: () => ({ raw: `<s>{flag.value ? a.value : b.value}</s>`, scope: { flag, a, b } }) as never,
    };
    reg.set("ShortCircuit", def);
    const container = document.createElement("div");
    mountComponent(def, {}, container, reg, validateFlat);
    await flush();
    const s = findByTag(container, "s");
    expect(s.textContent).toBe("B");
    b.value = "B2"; // flag=false 分支未实读 b——静态超订阅会重算，输出随 b 流动（动态路径此处不重跑，最终语义一致）
    await flush();
    expect(s.textContent).toBe("B2");
    flag.value = true;
    await flush();
    expect(s.textContent).toBe("A");
    a.value = "A2";
    await flush();
    expect(s.textContent).toBe("A2");
  });
});
