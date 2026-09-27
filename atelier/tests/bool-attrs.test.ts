/**
 * bool-attrs.test.ts — P1-2 动态布尔属性存在性语义（建议书 4.1：disabled={false} 实际禁用元素）。
 * 纪律：先红后绿（红检证据记入提交信息），禁止先写实现。
 *
 * 红检口径（实现前实测，dom-shim 已升级 hasAttribute + 布尔属性反射后仍红）：renderNode 动态
 * 属性支路一律 setAttribute(name, stringify(v))——false → "false" → HTML 布尔属性存在即真 ⇒
 * disabled={false} 渲染后属性落在（元素被禁用），disabled={true} 与 {false} 结果相同（语义反转）。
 * 修复契约：已知布尔属性（BOOLEAN_ATTRS）取值 false → removeAttribute；true → 属性存在；
 * dev 态收到字符串化 "false"/"0" 等可疑值 → ATR-328 警示（存在即真照常生效，不静默）；
 * 非布尔属性字符串行为逐字不变（data-x={false} 仍落 "false"）。
 */
import "./dom-shim.ts";
import { describe, expect, it } from "vitest";
import { $state } from "../runtime/core.ts";
import { mountComponent } from "../runtime/template.ts";
import type { ComponentDef, ComponentRegistry } from "../runtime/template.ts";
import { findByTag, makeContainer } from "./dom-shim.ts";

type AnyNode = any;

type Validate = (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: unknown };
const okValidate = (() => ({ ok: true })) as unknown as Validate;

/** 批式 effect 冲刷（bind-directive 同款双微任务惯例） */
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

describe("P1-2 动态布尔属性存在性语义（false → 属性不存在）", () => {
  it("disabled={false} → 无 disabled 属性（修复前 setAttribute(\"disabled\",\"false\") 存在即禁用）", async () => {
    const off = $state(false);
    const c = mountOnce("BoolDisabledFalse", `<button disabled={off.value}>Go</button>`, { off });
    await flush();
    const btn = findByTag(c, "button")[0];
    expect(btn.hasAttribute("disabled"), "false → removeAttribute（存在性语义）").toBe(false);
    expect(btn.disabled, "属性反射（真 DOM：属性存在即真）").toBe(false);
  });

  it("disabled={true} → 有 disabled 属性", async () => {
    const on = $state(true);
    const c = mountOnce("BoolDisabledTrue", `<button disabled={on.value}>Go</button>`, { on });
    await flush();
    const btn = findByTag(c, "button")[0];
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.disabled).toBe(true);
  });

  it("false→true→false 响应切换：属性随信号摘/落（修复前恒存在）", async () => {
    const off = $state(false);
    const c = mountOnce("BoolReactive", `<button disabled={off.value}>Go</button>`, { off });
    await flush();
    const btn = findByTag(c, "button")[0];
    expect(btn.hasAttribute("disabled"), "初始 false → 摘").toBe(false);
    off.value = true;
    await flush();
    expect(btn.hasAttribute("disabled"), "true → 落").toBe(true);
    off.value = false;
    await flush();
    expect(btn.hasAttribute("disabled"), "false → 摘").toBe(false);
  });

  it("布尔属性族 hidden/readonly/required/selected/open 同语义（false → 属性不存在）", async () => {
    const f = $state(false);
    const c = mountOnce(
      "BoolFamily",
      `<div><p hidden={f.value}>h</p><input readonly={f.value} required={f.value}><option selected={f.value}>o</option><details open={f.value}>d</details></div>`,
      { f },
    );
    await flush();
    expect(findByTag(c, "p")[0].hasAttribute("hidden")).toBe(false);
    expect(findByTag(c, "input")[0].hasAttribute("readonly")).toBe(false);
    expect(findByTag(c, "input")[0].hasAttribute("required")).toBe(false);
    expect(findByTag(c, "option")[0].hasAttribute("selected")).toBe(false);
    expect(findByTag(c, "details")[0].hasAttribute("open")).toBe(false);
  });

  it("非布尔属性字符串行为不变：data-x={false} 仍落 \"false\" 字符串", async () => {
    const f = $state(false);
    const c = mountOnce("BoolNonBool", `<span data-x={f.value}>s</span>`, { f });
    await flush();
    const span = findByTag(c, "span")[0];
    expect(span.hasAttribute("data-x")).toBe(true);
    expect(span.getAttribute("data-x")).toBe("false");
  });

  it("dev 态已知布尔属性收到字符串化 \"false\" → ATR-328 警示（不静默）；prod 不警示", async () => {
    setLast(undefined);
    const s = $state("false");
    const c = mountOnce("BoolSuspicious", `<button disabled={s.value}>Go</button>`, { s });
    await flush();
    expect(findByTag(c, "button")[0].hasAttribute("disabled"), "字符串 \"false\" 存在即真（照常生效）").toBe(true);
    expect(getLast()?.code, "ATR-328 警示：可疑值不改语义但不静默").toBe("ATR-328");

    setLast(undefined);
    setProd(true);
    try {
      const s2 = $state("false");
      const c2 = mountOnce("BoolSuspiciousProd", `<button disabled={s2.value}>Go</button>`, { s2 });
      await flush();
      expect(findByTag(c2, "button")[0].hasAttribute("disabled")).toBe(true);
      expect(getLast()?.code, "prod 剥离：不警示").toBeUndefined();
    } finally {
      setProd(false);
      setLast(undefined);
    }
  });
});
