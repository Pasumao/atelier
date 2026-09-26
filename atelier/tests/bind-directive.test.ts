/**
 * bind-directive.test.ts — 决策 25 属性级指令 v1（bind:value / bind:checked 双向绑定）。
 * 纪律：先红后绿（红检证据记入提交信息），禁止先写实现。
 *
 * 红检口径（实现前实测，2026-09-26）：现行解释器把 bind:x={expr} 落进 dynamic 单向支路
 * （bindExpr → setAttribute("bind:x", 值)）——
 *   · roundtrip 用例：el.value / el.checked 恒 undefined（无下行同步）、无事件监听（无上行回写）→ 红；
 *   · 错误卡用例：无任何 ATR-324/325/305 校验，非法目标（$derived / 非信号 / 属性链）被静默
 *     stringify 成 attr 值 → 红；
 *   · 直调用例：__compiledRT.bindTwoWay 尚不存在 → TypeError → 红。
 *
 * 边界（诚实标注）：
 *   · select：dom-shim 无 option/选中项派生语义（MElement 无 value 语义，纯 JS 属性赋值）——
 *     select 真语义归浏览器集成测试；本文件只钉「select 走 change 事件 + 值直写」的接线面，
 *     roundtrip 主路径按规格诚实降级为 textarea（input 事件）。
 *   · removeEventListener：dom-shim 未实现——监听退订在真 DOM 生效，shim 下监听表随元素对象
 *     回收；effect dispose 已保证脱离节点不被下行写（F-5 口径），换支用例只断言下行侧。
 *   · bindTwoWay 自身校验 = 参数可判定面（语法/信号性/derived/tag 矩阵）；type 细化面
 *   （checkbox/radio）归解释器预检（全量 attrs 可判定）与 codegen 构建期（分支 B 面 duties）——
 *   元素 attr 源序在 bind: 之前时 el 上 type 未必已落，避免 attr 顺序导致误拒。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $derived, $state } from "../runtime/core.ts";
import { __compiledRT, mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { findByTag, makeContainer, serialize } from "./dom-shim.ts";

type AnyNode = any;

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

/** 批式 effect 冲刷（与 f5-kernel/fs11 同款双微任务惯例） */
const flush = async (): Promise<void> => {
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
  await new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
};

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

/** 捕获抛出物的四段式 code（ATR 错误按 code 断言，不按 message 正则——fs11 同款惯例；
 * 抛出物是 AtrError 对象，code 不重复嵌进 message 以免错误卡 `${code} ${message}` 双写） */
const catchCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe("决策 25 bind: 解释器路径（roundtrip）", () => {
  it("文本输入 roundtrip：input 事件回写信号 + 信号外部更新下行 el.value（初始同步即成）", async () => {
    const text = $state("hello");
    const c = mountOnce("BindText", `<input bind:value={text}>`, { text });
    await flush();
    const input = findByTag(c, "input")[0];
    expect(input, "元素已渲染").toBeTruthy();
    expect(input.getAttribute("bind:value"), "bind: 是指令不是 attr——不落 setAttribute").toBe(null);
    expect(input.value, "初始同步：信号 → el.value").toBe("hello");

    input.value = "typed"; // 模拟用户键入（真 DOM：键入触发 input 事件）
    input.dispatchEvent({ type: "input" });
    await flush();
    expect(text.value, "上行：input 事件回写信号").toBe("typed");

    text.value = "external"; // 程序化更新
    await flush();
    expect(input.value, "下行：信号外部更新 → el.value").toBe("external");
  });

  it("checkbox roundtrip：change 事件双向（bind:checked × input[type=checkbox]）", async () => {
    const on = $state(false);
    const c = mountOnce("BindCheckbox", `<input type="checkbox" bind:checked={on}>`, { on });
    await flush();
    const input = findByTag(c, "input")[0];
    expect(input.checked, "初始同步：checked 下行").toBe(false);

    input.checked = true;
    input.dispatchEvent({ type: "change" });
    await flush();
    expect(on.value, "上行：change 事件回写信号").toBe(true);

    on.value = false;
    await flush();
    expect(input.checked, "下行：信号 → el.checked").toBe(false);
  });

  it("textarea roundtrip（input 事件）；select 按 spec 诚实降级注记（见文件头边界）", async () => {
    const memo = $state("m1");
    const c = mountOnce("BindTextarea", `<textarea bind:value={memo}></textarea>`, { memo });
    await flush();
    const ta = findByTag(c, "textarea")[0];
    expect(ta.value).toBe("m1");

    ta.value = "m2";
    ta.dispatchEvent({ type: "input" });
    await flush();
    expect(memo.value).toBe("m2");

    memo.value = "m3";
    await flush();
    expect(ta.value).toBe("m3");
  });

  it("{#if} 换支后旧分支 bind dispose 生效（改信号不再写脱离节点，F-5 口径）", async () => {
    const show = $state(true);
    const text = $state("v1");
    const c = mountOnce("BindIfDispose", `{#if show.value}<input bind:value={text}>{/if}`, { show, text });
    await flush();
    const input = findByTag(c, "input")[0];
    expect(input.value).toBe("v1");

    show.value = false; // 换支：旧分支子树清出 DOM
    await flush();
    expect(findByTag(c, "input").length, "分支已换").toBe(0);

    text.value = "v2"; // 只被旧分支 bind 读取的信号继续变化
    await flush();
    expect(input.value, "dispose 生效：脱离节点不再被下行写").toBe("v1");
  });

  it("无回环钉死：程序化信号更新 → el.value 下行更新，bind 监听零触发", async () => {
    const text = $state("v1");
    const c = mountOnce("BindNoLoop", `<input bind:value={text}>`, { text });
    await flush();
    const input = findByTag(c, "input")[0];
    // 包装 bind 自身监听器计数（dom-shim listeners 表可注入；真 DOM 下程序化赋值本就不派发事件，
    // 此钉防的是实现反向去「派发合成事件修复回环」——决策 25 无回环论证的行为面）
    const bindListener = input.listeners.get("input")[0];
    let fired = 0;
    input.listeners.set("input", [
      (e: unknown) => {
        fired++;
        bindListener(e);
      },
    ]);

    text.value = "v2";
    await flush();
    expect(input.value, "下行照常").toBe("v2");
    expect(fired, "程序化下行不触发 input 监听（无回环）").toBe(0);
  });
});

describe("决策 25 bind: 解释器路径（校验错误卡，dev）", () => {
  it("$derived 目标 → ATR-305 错误卡整元素替换（渲染期前置拦截，非事件期静默失败）", () => {
    const d = $derived(() => "readonly");
    const c = mountOnce("BindDerived", `<input bind:value={d}>`, { d });
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-305");
    expect(s).toContain("派生信号只读");
    expect(findByTag(c, "input").length, "错误卡替换整个元素").toBe(0);
  });

  it("非信号目标 → ATR-324 错误卡（fix 指路 $state）", () => {
    const c = mountOnce("BindNonSignal", `<input bind:value={label}>`, { label: "plain" });
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-324");
    expect(s).toContain("$state");
    expect(findByTag(c, "input").length).toBe(0);
  });

  it("bind:value={sig.value}（解包值/属性链目标）→ ATR-324 错误卡", () => {
    const sig = $state("x");
    const c = mountOnce("BindDotValue", `<input bind:value={sig.value}>`, { sig });
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-324");
    expect(findByTag(c, "input").length).toBe(0);
  });

  it("支持面外组合 → ATR-324：div 上 bind:value；bind:checked 缺静态 type", () => {
    const sig = $state("x");
    const on = $state(false);
    const c1 = mountOnce("BindDiv", `<div bind:value={sig}></div>`, { sig });
    const s1 = serialize(c1);
    expect(s1).toContain("atr-error-card");
    expect(s1).toContain("ATR-324");
    expect(
      findByTag(c1, "div").filter((d: AnyNode) => d.getAttribute("bind:value") !== null).length,
      "支持面外整元素替换：无任何元素携带 bind: attr（容器/根/错误卡 div 不计）",
    ).toBe(0);

    const c2 = mountOnce("BindCheckedNoType", `<input bind:checked={on}>`, { on });
    expect(serialize(c2)).toContain("ATR-324");
  });

  it("同元素重复 bind:value → ATR-325 错误卡且不双订（同键只订阅一次）", () => {
    const sig = $state("x");
    const c = mountOnce("BindDup", `<input bind:value={sig} bind:value={sig}>`, { sig });
    const s = serialize(c);
    expect(s).toContain("atr-error-card");
    expect(s).toContain("ATR-325");
    expect(findByTag(c, "input").length).toBe(0);
  });
});

describe("决策 25 bind: prod 剥离分层", () => {
  it("prod 下 ATR-324：recordRuntimeError 有记录、元素照常渲染、无错误卡", () => {
    setLast(undefined);
    setProd(true);
    try {
      const c = mountOnce("BindProd", `<div><input bind:value={label}><span>keep</span></div>`, {
        label: "plain",
      });
      expect(findByTag(c, "input").length, "元素照常渲染").toBe(1);
      expect(findByTag(c, "span").length, "兄弟节点不受影响").toBe(1);
      expect(serialize(c).includes("atr-error-card"), "prod 无错误卡").toBe(false);
      expect(getLast()?.code, "recordRuntimeError 有记录（不静默）").toBe("ATR-324");
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });
});

describe("决策 25 bind: __compiledRT.bindTwoWay 直调契约（codegen 面）", () => {
  it("同键重复 → dev 抛 ATR-325 且监听只挂一份；prod 不抛跳过且记录", () => {
    const text = $state("a");
    const scope = { text };
    const el = document.createElement("input");
    __compiledRT.bindTwoWay(el, "bind:value", "text", scope, "input");
    expect(el.listeners.get("input")?.length ?? 0).toBe(1);
    expect(catchCode(() => __compiledRT.bindTwoWay(el, "bind:value", "text", scope, "input"))).toBe("ATR-325");
    expect(el.listeners.get("input")?.length ?? 0, "不建立第二份订阅").toBe(1);

    setLast(undefined);
    setProd(true);
    try {
      const el2 = document.createElement("input");
      __compiledRT.bindTwoWay(el2, "bind:value", "text", scope, "input");
      expect(__compiledRT.bindTwoWay(el2, "bind:value", "text", scope, "input"), "prod 不抛，返回 noop dispose").toBeTypeOf("function");
      expect(el2.listeners.get("input")?.length ?? 0).toBe(1);
      expect(getLast()?.code).toBe("ATR-325");
      // prod 下非法目标同样不抛（元素照常语义，直调面 = 不建订阅 + 记录）
      __compiledRT.bindTwoWay(el2, "bind:value", "nope", scope, "input");
      expect(el2.listeners.get("input")?.length ?? 0).toBe(1);
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });

  it("同元素 bind:value + bind:checked 属不同键，合法共存（WeakMap 键=attr 名）", () => {
    // 注：bindTwoWay 校验 = 参数可判定面（tag 级矩阵），type 细化归预检/构建期——
    // 此用例钉的是重复守卫的键语义，非元素语义（typeless input 的真语义归真 DOM）。
    const text = $state("a");
    const on = $state(false);
    const scope = { text, on };
    const el = document.createElement("input");
    __compiledRT.bindTwoWay(el, "bind:value", "text", scope, "input");
    __compiledRT.bindTwoWay(el, "bind:checked", "on", scope, "input");
    expect(el.listeners.get("input")?.length ?? 0).toBe(1);
    expect(el.listeners.get("change")?.length ?? 0).toBe(1);
  });

  it("select 接线钉面：change 事件注册、input 不注册、change 直写信号（文件头边界注记）", () => {
    const picked = $state("a");
    const scope = { picked };
    const el = document.createElement("select");
    __compiledRT.bindTwoWay(el, "bind:value", "picked", scope, "select");
    expect(el.listeners.get("change")?.length ?? 0, "select → change 事件").toBe(1);
    expect(el.listeners.get("input")?.length ?? 0, "select 不走 input 事件").toBe(0);
    const sel = el as unknown as { value: string };
    sel.value = "b";
    el.dispatchEvent({ type: "change" });
    expect(picked.value, "change 上行回写（dom-shim 无 option 派生语义，纯接线面）").toBe("b");
  });
});
