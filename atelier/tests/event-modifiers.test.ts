/**
 * event-modifiers.test.ts — 决策 25 后置候选 v1（on: 的 .prevent / .stop 事件修饰）。
 * 纪律：先红后绿（红检证据记入提交信息），禁止先写实现。
 *
 * 红检口径（实现前实测，2026-09-26）：attr 名正则（template.ts `/^([A-Za-z_][\w:-]*)/`）
 * 不含 `.`——`on:click.prevent={fn}` 的现行解析产物是三段碎片 attr，而非单 attr 全名：
 *   · `{name:"on:click", value:"", dynamic:false}` → 监听 click，事件期 evalExpr("") 抛
 *     ATR-301「表达式意外结束」——dispatch 即抛穿，handler 永不可达；
 *   · `{name:"prevent", value:"fn", dynamic:true}` → dynamic 单向支路把 handler 源码
 *     String(fn) 写成垃圾 attr `prevent="(e) => …"` 落在元素上；
 *   · preventDefault / stopPropagation 无人调用——修饰符静默失效（比「监听事件名
 *     click.prevent」更糟的形态：连监听器自身都不健全）。
 * 另：__compiledRT.bindEvent 尚不存在（直调用例 TypeError）、ATR-326 未注册。
 *
 * 边界（诚实标注）：
 *   · dom-shim 未实现 removeEventListener——dispose 退订在真 DOM 生效（bind-directive
 *     同款口径）；本文件直调用例只断言监听挂载与行为，不断言 dispose 退订生效。
 *   · dom-shim dispatchEvent 透传任意事件对象——修饰符应用用带 preventDefault /
 *     stopPropagation spy 的假事件验证（真 DOM 派生语义归浏览器集成面）。
 *   · codegen 面（compiler/codegen.mjs emitAttrs 的 on: 支路）由并行分支收口发射
 *     rt.bindEvent——本文件只钉 runtime 单点契约（__compiledRT.bindEvent 直调），
 *     不钉生成代码文本。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $state } from "../runtime/core.ts";
import { __compiledRT, mountComponent, parseTemplate } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { findByTag, makeContainer, serialize } from "./dom-shim.ts";

type AnyNode = any;

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

const defOf = (name: string, raw: string, scope: Record<string, unknown>): ComponentDef => ({
  name,
  render: () => ({ raw, scope }) as never,
});

/** 挂载一次并返回容器（mountComponent 自带错误边界，从不抛穿） */
function mountOnce(name: string, raw: string, scope: Record<string, unknown>): AnyNode {
  const container = makeContainer();
  mountComponent(defOf(name, raw, scope), {}, container, new Map() as ComponentRegistry, okValidate);
  return container;
}

const setLast = (v: unknown): void => {
  (globalThis as unknown as Record<string, unknown>).__ATELIER_LAST_ERROR__ = v;
};
const getLast = (): { code?: string } | undefined =>
  (globalThis as unknown as { __ATELIER_LAST_ERROR__?: { code?: string } }).__ATELIER_LAST_ERROR__;
const setProd = (v: boolean): void => {
  (globalThis as unknown as Record<string, unknown>).__ATELIER_PROD__ = v;
};

/** 假事件：type + 修饰符 spy（dom-shim dispatchEvent 透传任意对象给监听器） */
function fakeEvent(type: string): { type: string; preventDefault: () => void; stopPropagation: () => void; calls: string[] } {
  const calls: string[] = [];
  return {
    type,
    calls,
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
  };
}

/** 捕获抛出物的四段式 code（ATR 错误按 code 断言，bind-directive 同款惯例） */
const catchCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("事件修饰 v1：解析产物形态钉（契约载体 = attr 全名，解析器单一文法）", () => {
  it("on:click.prevent.stop={fn} 解析为单个 attr 全名（红检：现行切成 on:click/prevent/stop 三段碎片）", () => {
    const ast = parseTemplate(`<button on:click.prevent.stop={fn}>Go</button>`);
    expect(ast.length).toBe(1);
    const node = ast[0] as { kind: string; attrs: { name: string; value: string; dynamic: boolean }[] };
    expect(node.kind).toBe("element");
    expect(node.attrs, "修饰符段属 attr 名字符——整体落进单个 attr").toEqual([
      { name: "on:click.prevent.stop", value: "fn", dynamic: true },
    ]);
  });

  it("无修饰符 on:click={fn} 形态不变（回归钉：既有产物零漂移）", () => {
    const ast = parseTemplate(`<button on:click={fn} disabled>Go</button>`);
    const node = ast[0] as { kind: string; attrs: { name: string; value: string; dynamic: boolean }[] };
    expect(node.attrs).toEqual([
      { name: "on:click", value: "fn", dynamic: true },
      { name: "disabled", value: "", dynamic: false },
    ]);
  });

  it("点号 attr 单一文法钉：bind:x.y={s} 解析产物同为整体单名（红检：现行切成 bind:x/y 两段碎片——碎片落 bind: 校验虽也会 ATR-324，但那是目标非法卡非未知指令卡，卡文随文法误指）", () => {
    // 差异取证（红检实测）：现行卡文 = 「bind: 目标非法（须为单个信号名）：bind:x={}」（碎片
    // bind:x 空目标误报）；单文法后 = 「bind: 未知属性指令：bind:x.y」（名字即契约，指认准确）。
    const ast = parseTemplate(`<input bind:x.y={s}>`);
    const node = ast[0] as { kind: string; attrs: { name: string; value: string; dynamic: boolean }[] };
    expect(node.attrs, "点号 attr 同属单一名字文法——整体单名").toEqual([
      { name: "bind:x.y", value: "s", dynamic: true },
    ]);
    const s = $state("v");
    const c = mountOnce("DotAttrBind", `<input bind:x.y={s}>`, { s });
    const html = serialize(c);
    expect(html).toContain("atr-error-card");
    expect(html).toContain("ATR-324");
    expect(html).toContain("未知属性指令");
  });
});

describe("事件修饰 v1：解释器路径行为（.prevent / .stop）", () => {
  it("prevent 单独：handler 前调用 e.preventDefault()，handler 照常收到事件（红检：现行 dispatch 抛 ATR-301）", () => {
    let got: unknown = null;
    const fn = (e: unknown): void => {
      got = e;
    };
    const c = mountOnce("EvPrevent", `<button on:click.prevent={fn}>Go</button>`, { fn });
    const btn = findByTag(c, "button")[0];
    expect(btn, "元素已渲染").toBeTruthy();
    const ev = fakeEvent("click");
    btn.dispatchEvent(ev);
    expect(ev.calls, "preventDefault 已调用").toContain("preventDefault");
    expect(got, "handler 收到同一事件对象").toBe(ev);
  });

  it("stop 单独：handler 前调用 e.stopPropagation()", () => {
    const fn = (): void => {};
    const c = mountOnce("EvStop", `<button on:click.stop={fn}>Go</button>`, { fn });
    const btn = findByTag(c, "button")[0];
    const ev = fakeEvent("click");
    btn.dispatchEvent(ev);
    expect(ev.calls, "stopPropagation 已调用").toContain("stopPropagation");
    expect(ev.calls, "prevent 未书写则不调用").not.toContain("preventDefault");
  });

  it("组合 .prevent.stop：按书写顺序依次应用修饰符，最后调用 handler（调用日志钉序）", () => {
    const order: string[] = [];
    const fn = (): void => {
      order.push("handler");
    };
    const c = mountOnce("EvCombo", `<button on:click.prevent.stop={fn}>Go</button>`, { fn });
    const btn = findByTag(c, "button")[0];
    const ev = fakeEvent("click");
    btn.dispatchEvent(ev);
    expect(order, "handler 最后").toEqual(["handler"]);
    expect(ev.calls, "修饰符按书写顺序先于 handler").toEqual(["preventDefault", "stopPropagation"]);
  });

  it("handler 守卫语义逐字不变：值非函数（typeof !== function）→ 修饰符照常应用、handler 不调、零抛错", () => {
    const c = mountOnce("EvNonFn", `<button on:click.prevent={fn}>Go</button>`, { fn: 42 });
    const btn = findByTag(c, "button")[0];
    const ev = fakeEvent("click");
    expect(() => btn.dispatchEvent(ev), "非函数 handler 不抛（既有 on: 行为）").not.toThrow();
    expect(ev.calls, "修饰符先于 handler 守卫").toEqual(["preventDefault"]);
  });

  it("事件期求值钉（既有 lazy 语义）：事件触发时才求值——信号值换成新 handler，dispatch 调新 handler", () => {
    // 钉法注记：mountComponentInner 会把 tpl.scope 摊平进组件内部 scope（{...tpl.scope}），
    // mount 后改原 scope 对象属性到不了组件内部；且 evalExpr 求值出口不解包裸信号
    //（探针实测 evalExpr("fn") 返回信号对象、"fn.value" 返回函数值）——lazy 语义的合法
    // 观测面 = on: 表达式写 {fn.value}：事件期 evalExpr 读信号当期值（与既有 on: 同一形状）。
    const fn = $state((): void => {});
    const c = mountOnce("EvLazy", `<button on:click.prevent={fn.value}>Go</button>`, { fn });
    const btn = findByTag(c, "button")[0];
    let called = 0;
    fn.value = (): void => {
      called++;
    };
    btn.dispatchEvent(fakeEvent("click"));
    expect(called, "事件期读信号当期值（非挂载期定死）").toBe(1);
  });

  it("无修饰符回归钉：on:click 行为与改动前逐字节一致（监听一份、无垃圾 attr、handler 收同一事件）", () => {
    let got: unknown = null;
    const fn = (e: unknown): void => {
      got = e;
    };
    const c = mountOnce("EvPlain", `<button on:click={fn}>Go</button>`, { fn });
    const btn = findByTag(c, "button")[0];
    expect(serialize(c), "DOM 形态零漂移（无修饰符产物不落任何 on:/修饰符 attr）").toBe(
      `<div><div class="atr-root atr-scope-EvPlain"><button>"Go"</button></div></div>`,
    );
    expect(btn.listeners.get("click")?.length ?? 0, "click 监听恰好一份").toBe(1);
    const ev = fakeEvent("click");
    btn.dispatchEvent(ev);
    expect(got).toBe(ev);
  });
});

describe("事件修饰 v1：未知修饰符 ATR-326（dev 错误卡整替换）", () => {
  it("on:click.bogus={fn} → 错误卡整元素替换：卡含 code/fix（可执行），button 零渲染", () => {
    const fn = (): void => {};
    const c = mountOnce("EvUnknown", `<div><button on:click.bogus={fn}>Go</button><span>keep</span></div>`, { fn });
    const html = serialize(c);
    expect(html).toContain("atr-error-card");
    expect(html).toContain("ATR-326");
    expect(html).toContain("prevent");
    expect(html).toContain("stop");
    expect(findByTag(c, "button").length, "错误卡替换整个元素").toBe(0);
    expect(findByTag(c, "span").length, "兄弟节点不受影响").toBe(1);
  });

  it("on:submit.self={save} 同样 ATR-326（self 不在 v1 白名单——白名单仅 prevent/stop）", () => {
    const save = (): void => {};
    const c = mountOnce("EvSelf", `<button on:submit.self={save}>Go</button>`, { save });
    expect(serialize(c)).toContain("ATR-326");
    expect(findByTag(c, "button").length).toBe(0);
  });
});

describe("事件修饰 v1：ATR-326 prod 分层（dynProd 动态旗，置旗/复位模式）", () => {
  it("prod：recordRuntimeError 记录 + 元素照常渲染 + 该 on: 监听不挂 + 无错误卡", () => {
    setLast(undefined);
    setProd(true);
    try {
      const fn = (): void => {};
      const c = mountOnce("EvProd", `<div><button on:click.bogus={fn}>Go</button></div>`, { fn });
      expect(findByTag(c, "button").length, "元素照常渲染").toBe(1);
      expect(serialize(c).includes("atr-error-card"), "prod 无错误卡").toBe(false);
      expect(getLast()?.code, "recordRuntimeError 有记录（不静默）").toBe("ATR-326");
      const btn = findByTag(c, "button")[0];
      expect(btn.listeners.get("click")?.length ?? 0, "失败项监听不挂").toBe(0);
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });
});

describe("事件修饰 v1：ATR-326 prod 分层（BUILD_PROD 构建期旗，query 换新模块实例）", () => {
  it("__ATELIER_PROD__ 恒 false，仅凭构建期旗即 prod 行为（define 通道运行时等价模拟）", async () => {
    const G = globalThis as { __ATELIER_BUILD_PROD__?: boolean };
    G.__ATELIER_BUILD_PROD__ = true;
    try {
      const freshSpec = "../runtime/template.ts?evmods=bfp";
      const fresh = (await import(freshSpec)) as typeof import("../runtime/template.ts");
      setLast(undefined);
      const fn = (): void => {};
      const container = makeContainer();
      fresh.mountComponent(defOf("EvBfp", `<button on:click.bogus={fn}>Go</button>`, { fn }), {}, container, new Map() as ComponentRegistry, okValidate);
      expect(findByTag(container, "button").length, "元素照常渲染").toBe(1);
      expect(serialize(container).includes("atr-error-card"), "无错误卡").toBe(false);
      expect(getLast()?.code, "recordRuntimeError 有记录").toBe("ATR-326");
      expect(findByTag(container, "button")[0].listeners.get("click")?.length ?? 0, "监听不挂").toBe(0);
    } finally {
      delete G.__ATELIER_BUILD_PROD__;
      setProd(false);
      setLast(undefined);
    }
  });
});

describe("事件修饰 v1：__compiledRT.bindEvent 直调契约（codegen 面）", () => {
  it("单点存在 + happy path：监听挂基础事件名、修饰符 spy 生效、handler 收同一事件（红检：bindEvent 不存在）", () => {
    let got: unknown = null;
    const fn = (e: unknown): void => {
      got = e;
    };
    const el = document.createElement("button");
    const dispose = __compiledRT.bindEvent(el, "on:click.prevent", "fn", { fn });
    expect(el.listeners.get("click")?.length ?? 0, "监听挂在基础事件名 click（非 click.prevent）").toBe(1);
    expect(dispose, "返回 dispose（bindTwoWay 同款单点形态）").toBeTypeOf("function");
    const ev = fakeEvent("click");
    el.dispatchEvent(ev);
    expect(ev.calls).toEqual(["preventDefault"]);
    expect(got).toBe(ev);
  });

  it("未知修饰符直调：dev 抛 ATR-326 且监听不挂；prod 不抛、noop dispose、监听不挂、记录在案", () => {
    const fn = (): void => {};
    const scope = { fn };
    const el = document.createElement("button");
    expect(catchCode(() => __compiledRT.bindEvent(el, "on:click.bogus", "fn", scope)), "dev 抛 ATR-326").toBe("ATR-326");
    expect(el.listeners.get("click")?.length ?? 0, "dev 失败不挂监听").toBe(0);

    setLast(undefined);
    setProd(true);
    try {
      const el2 = document.createElement("button");
      const dispose = __compiledRT.bindEvent(el2, "on:click.bogus", "fn", scope);
      expect(dispose, "prod 不抛，返回 noop dispose").toBeTypeOf("function");
      expect(el2.listeners.get("click")?.length ?? 0, "prod 失败项监听不挂").toBe(0);
      expect(getLast()?.code).toBe("ATR-326");
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });

  it("组合直调 on:click.prevent.stop：双修饰符按序应用（与解释器同源单点）", () => {
    const fn = (): void => {};
    const el = document.createElement("button");
    __compiledRT.bindEvent(el, "on:click.prevent.stop", "fn", { fn });
    const ev = fakeEvent("click");
    el.dispatchEvent(ev);
    expect(ev.calls).toEqual(["preventDefault", "stopPropagation"]);
  });
});
