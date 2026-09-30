/**
 * fs11-async.test.ts — FS-11 异步表达式守卫（ATR-323，D-F9 定稿前置原型，方向=显式拒绝）。
 * 规格源：docs/FS-DESIGN.md §8.4。守卫位置 = expr.ts evalExpr 求值出口（论证见 runtime/expr.ts 实现
 * 注释：解释器与 codegen 生成代码的全部模板表达式求值——bindExpr/bindProp/{#if}/{#each}/on:/keyExpr——
 * 都汇聚到同一个 evalExpr，单点实现即双路径同源，codegen 零 import 红线不破、零内联重复）。
 *
 * 分层（红检实测确认）：调用语法 `{ someAsync() }` 在迷你求值器里**解析期即被 ATR-301 拒绝**
 * （函数调用不支持、遗留 token 显式报错）——调用式异步泄漏已被既有层关闭；FS-11 的真实缺口是
 * **值形态**：Promise 作为值经非调用表达式流入渲染图（最常见：`$state(fetchUser())` 把 Promise
 * 存进信号再渲染）。ATR-301 管语法层，ATR-323 管值层，两层互补。
 *
 * 【原型验证产出②——反例记录："若无此守卫会怎样"（守卫前红检实测，2026-09-19）】
 *  · 文本插值 `{ p.value }`（p = $state(Promise)）：Promise 被 stringify 对象分支 JSON.stringify
 *    → 渲染字面量 "{}"。无错误卡、无 journal 条目、__ATELIER_LAST_ERROR__ 不置位——纯静默；
 *    Promise 不订阅不解析，信号再变也只写出新的 "{}"，异步结果永远进不了渲染。
 *  · `{#if p.value}`（p 存 Promise.resolve(false)）：Promise 是对象恒真值 → 解析为 false 仍渲染
 *    首个分支（守卫前红检实测渲染出 <b>x</b>）——真值语义被静默颠倒。
 *  · `{#each p.value as it}`：(Promise ?? []).forEach → 裸 TypeError: arr.forEach is not a function，
 *    错误卡 "ATR-ERR TypeError …"，无四段式、无 fix 指路。
 *  · 组件动态 prop `name={ p.value }`：bindProp 把 Promise 写进 prop $state 信号——journal 出现
 *    to=Promise 条目（唯一一处 Promise 真正进入响应式图/journal 的形态）。
 *  · `on:click={ p.value }`：每次点击求值出 Promise → typeof "function" 检查丢弃 → 静默 no-op。
 *  · Solid 2 对照〔语料内知识，未联网核实〕：async 数据经 createAsync / <Suspense> 边界收敛，
 *    未解析读取由 Suspense 兜住，Promise 本体从不作为值流入响应式图被渲染——Atelier 的显式拒绝
 *    取同一"边界收敛"原则的更早爆点（dev 渲染期四段式报错 vs 运行期 Suspense 兜底）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $state, store } from "../runtime/core.ts";
import { evalExpr } from "../runtime/expr.ts";
import { streamValue, optimisticList } from "../runtime/primitives.ts";
import {
  mountComponent,
  registerCompiled,
  type ComponentDef,
  type ComponentRegistry,
} from "../runtime/template.ts";
import { compileFunction } from "../compiler/codegen.mjs";
import { findByTag, makeContainer, serialize } from "./dom-shim.ts";

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

const defOf = (name: string, raw: string, scope: Record<string, unknown>): ComponentDef => ({
  name,
  render: () => ({ raw, scope }) as never,
});

/** 挂载一次并返回容器（mountComponent 自带错误边界，从不抛穿） */
function mountOnce(
  name: string,
  raw: string,
  scope: Record<string, unknown>,
  opts: { compiled?: boolean; registry?: ComponentRegistry } = {},
): AnyNode {
  const container = makeContainer();
  if (opts.compiled) registerCompiled(compileFunction(name, raw));
  mountComponent(defOf(name, raw, scope), {}, container, opts.registry ?? new Map(), okValidate);
  return container;
}

/** 最小现实泄漏形态：把异步调用返回的 Promise 直接存进 $state（async-in-graph 的典型笔误） */
function promiseState(resolved: unknown): ReturnType<typeof $state> {
  return $state(Promise.resolve(resolved));
}

const setLast = (v: unknown): void => {
  (globalThis as unknown as Record<string, unknown>).__ATELIER_LAST_ERROR__ = v;
};
const getLast = (): { code?: string } | undefined =>
  (globalThis as unknown as { __ATELIER_LAST_ERROR__?: { code?: string } }).__ATELIER_LAST_ERROR__;

/** 捕获抛出物的四段式 code（ATR 错误按 code 断言，不按 message 正则） */
const catchCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("FS-11 ATR-323：evalExpr 求值出口单点守卫", () => {
  it("四段式拒绝：code/message/context/fix 齐备，fix 指路两条合法异步通道", () => {
    let caught: { code?: string; message?: string; context?: { expr?: string }; fix?: string } | null = null;
    try {
      evalExpr("currentUser", { currentUser: Promise.resolve({ id: 1 }) });
    } catch (e) {
      caught = e as typeof caught;
    }
    expect(caught?.code).toBe("ATR-323");
    expect(caught?.message).toContain("模板表达式返回 Promise");
    expect(caught?.message).toContain("异步泄漏进响应式图");
    expect(caught?.context?.expr).toBe("currentUser");
    expect(caught?.fix).toContain("streamValue");
    expect(caught?.fix).toContain("optimisticList");
    expect(caught?.fix).toContain("live");
  });

  it("thenable（跨 realm 形态：任意带 then 方法的对象）同样拒绝；普通值不受影响", () => {
    // 跨 realm 安全判定 = duck-typing then，非 instanceof Promise——异 realm Promise/thenable 一网打尽
    expect(catchCode(() => evalExpr("weird", { weird: { then: (_done: () => void) => {} } }))).toBe("ATR-323");
    expect(catchCode(() => evalExpr("p", { p: Promise.resolve(1) }))).toBe("ATR-323");
    // 非异步值零影响（含 falsy/null/函数/数组）
    expect(evalExpr("1 + 1", {})).toBe(2);
    expect(evalExpr("v", { v: null })).toBe(null);
    expect(evalExpr("fn", { fn: () => 1 })).toBeTypeOf("function");
    expect(evalExpr("xs[0]", { xs: ["a"] })).toBe("a");
  });

  it("分层：调用语法（{ someAsync() }）仍归 ATR-301 解析期拒绝，不被本守卫改道", () => {
    expect(() => evalExpr("fetchUser()", { fetchUser: () => Promise.resolve(1) })).toThrowError(/ATR-301/);
  });
});

describe("FS-11 ATR-323：解释器路径（值形态泄漏）", () => {
  it("文本插值 { p.value }（信号存 Promise）→ ATR-323 错误文本（守卫前渲染 \"{}\" 且零上报）", () => {
    setLast(undefined);
    const before = store.log(500).length;
    const p = promiseState("data");
    const c = mountOnce("InterpAsync", "<p>{ p.value }</p>", { p });
    const text = serialize(c);
    expect(text).toContain("ATR-323");
    expect(text).toContain("异步泄漏进响应式图");
    expect(text).not.toContain('"{}"'); // 守卫前症状：JSON.stringify(Promise) → "{}"
    // 四段式经 __ATELIER_LAST_ERROR__ 上报（dev 桥可见，不静默）
    expect(getLast()?.code).toBe("ATR-323");
    // 响应式图纯净：无 Promise 值被写进任何信号（journal 抽查）
    const fresh = store.log(500).slice(before);
    expect(fresh.some((j) => j.to != null && typeof (j.to as { then?: unknown }).then === "function")).toBe(false);
  });

  it("locals 绑定 Promise（{ user }）→ 同码拒绝", () => {
    const c = mountOnce("LocalsAsync", "<p>{ user }</p>", { user: Promise.resolve("u") });
    expect(serialize(c)).toContain("ATR-323");
  });

  it("动态属性 { p.value } → 错误态摘属性 + 最近错误记录（P-A P2-R3：错误哨兵不再流入属性——src 是存在即生效面，写入 ⚠ 错误文本同样点亮属性；不静默改由 __ATELIER_LAST_ERROR__ 承担）", () => {
    const p = promiseState("/x.png");
    setLast(undefined);
    const c = mountOnce("AttrAsync", "<img src={ p.value }>", { p });
    const img = findByTag(c, "img")[0];
    expect(img.hasAttribute("src"), "错误态属性被摘除（修复前把 ATR-323 错误文案写进 src）").toBe(false);
    expect(getLast()?.code, "不静默：最近错误仍记录 ATR-323").toBe("ATR-323");
  });

  it("{#if p.value}（存 Promise.resolve(false)）→ ATR-323 错误卡（守卫前恒真、静默取首支）", () => {
    const p = promiseState(false);
    const c = mountOnce("IfAsync", "{#if p.value}<b>x</b>{/if}", { p });
    const text = serialize(c);
    expect(text).toContain("atr-error-card");
    expect(text).toContain("ATR-323");
    expect(text).not.toContain("<b>"); // 守卫前症状：Promise 恒真 → 解析为 false 仍渲染该分支
  });

  it("{#each p.value as it} → ATR-323 四段式错误卡（守卫前裸 TypeError 无 fix）", () => {
    const p = promiseState(["a"]);
    const c = mountOnce("EachAsync", "<ul>{#each p.value as it}<li>{it}</li>{/each}</ul>", { p });
    const text = serialize(c);
    expect(text).toContain("atr-error-card");
    expect(text).toContain("ATR-323");
    expect(text).toContain("streamValue"); // fix 指路在错误卡上可见
    expect(text).not.toContain("TypeError"); // 守卫前症状："ATR-ERR TypeError: arr.forEach is not a function"
  });

  it("on:click 表达式求值为 Promise → 点击时 ATR-323 拒绝（守卫前静默丢弃）", () => {
    const p = promiseState(1);
    const c = mountOnce("OnClickAsync", "<button on:click={ p.value }>go</button>", { p });
    const btn = findByTag(c, "button")[0];
    expect(btn).toBeDefined();
    let caught: unknown = null;
    try {
      btn.dispatchEvent({ type: "click" });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string } | null)?.code).toBe("ATR-323");
  });

  it("组件动态 prop 返回 Promise → 挂载期 ATR-323 错误卡（守卫前 Promise 写进 prop 信号/journal）", () => {
    const before = store._journal.length;
    const child: ComponentDef = {
      name: "AsyncChild",
      render: (props) => ({ raw: "<p>{props.name}</p>", scope: { props } }) as never,
    };
    const registry: ComponentRegistry = new Map([["AsyncChild", child]]);
    const p = promiseState("n");
    const c = mountOnce("ParentAsync", "<AsyncChild name={ p.value } />", { p }, { registry });
    const text = serialize(c);
    expect(text).toContain("ATR-323");
    // 响应式图纯净：journal 无 Promise 写入（守卫前 bindProp 曾把 Promise 写进 prop 信号）
    const fresh = store._journal.slice(before);
    expect(fresh.some((j) => j.to != null && typeof (j.to as { then?: unknown }).then === "function")).toBe(false);
  });
});

describe("FS-11 ATR-323：codegen 路径（同一 evalExpr 出口，零内联重复）", () => {
  it("registerCompiled 后 { p.value } 同码拒绝，错误渲染与解释器 golden 一致", () => {
    const raw = "<p>{ p.value }</p>";
    const scope = { p: promiseState("data") };
    setLast(undefined);
    const a = serialize(mountOnce("CodeGenAsync", raw, scope, { compiled: false }));
    const lastA = getLast();
    setLast(undefined);
    const b = serialize(mountOnce("CodeGenAsync", raw, scope, { compiled: true }));
    const lastB = getLast();
    expect(b).toBe(a); // 双路径同源：错误渲染逐字节一致
    expect(a).toContain("ATR-323");
    expect(lastA?.code).toBe("ATR-323");
    expect(lastB?.code).toBe("ATR-323");
  });

  it("registerCompiled 后 {#if} 测试为 Promise → 同码拒绝（生成代码 rt.evalExpr 汇入同一出口）", () => {
    const raw = "{#if p.value}<b>x</b>{/if}";
    const scope = { p: promiseState(false) };
    const a = serialize(mountOnce("CodeGenIfAsync", raw, scope, { compiled: false }));
    const b = serialize(mountOnce("CodeGenIfAsync", raw, scope, { compiled: true }));
    expect(b).toBe(a);
    expect(a).toContain("ATR-323");
  });

  it("registerCompiled 后组件动态 prop 返回 Promise → 同码拒绝（生成代码 rt.bindProp 汇入同一出口）", () => {
    const child: ComponentDef = {
      name: "AsyncChild2",
      render: (props) => ({ raw: "<p>{props.name}</p>", scope: { props } }) as never,
    };
    const registry: ComponentRegistry = new Map([["AsyncChild2", child]]);
    const raw = "<AsyncChild2 name={ p.value } />";
    const scope = { p: promiseState("n") };
    const a = serialize(mountOnce("CodeGenPropAsync", raw, scope, { compiled: false, registry }));
    const b = serialize(mountOnce("CodeGenPropAsync", raw, scope, { compiled: true, registry }));
    expect(b).toBe(a);
    expect(a).toContain("ATR-323");
  });
});

describe("FS-11 不误伤面：合法异步通道（三态原语边界收敛）守卫不触发", () => {
  it("streamValue：异步在原语外收敛，推送解析值 → 正常渲染且无 ATR-323", async () => {
    const sv = streamValue<string>();
    const c = mountOnce("LegalStream", "<p>{ sv.value }</p>", { sv });
    expect(serialize(c)).not.toContain("ATR-323");
    const fetchish = async (): Promise<void> => {
      await Promise.resolve();
      sv.push("Deep");
      sv.push("Seek");
    };
    await fetchish();
    await flush();
    expect(serialize(c)).toContain("Seek");
    expect(serialize(c)).not.toContain("ATR-323");
  });

  it("optimisticList：乐观项经原语写入 → 渲染 status 流转，守卫不触发", async () => {
    const list = optimisticList<{ id: string; label: string }>();
    const c = mountOnce("LegalOptimistic", "<p>{ list.values[0].status }</p>", { list });
    expect(serialize(c)).not.toContain("ATR-323");
    list.optimisticAdd({ id: "t1", label: "web_search" });
    await flush();
    expect(serialize(c)).toContain("pending");
    list.commit("t1");
    await flush();
    expect(serialize(c)).toContain("committed");
  });

  it("事件处理器传函数引用（异步收敛在处理器内部）→ 正常渲染与派发，守卫不触发", async () => {
    let clicked = 0;
    const save = async (): Promise<void> => {
      await Promise.resolve();
      clicked += 1;
    };
    const n = $state(1);
    const c = mountOnce("LegalFnRef", "<button on:click={ save }>{ n.value }</button>", { save, n });
    const btn = findByTag(c, "button")[0];
    btn.dispatchEvent({ type: "click" });
    await flush();
    expect(clicked).toBe(1);
    expect(serialize(c)).not.toContain("ATR-323");
  });
});
