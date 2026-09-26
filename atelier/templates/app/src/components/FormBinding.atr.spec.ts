/**
 * FormBinding.atr.spec.ts — 决策 25 bind: v1 双向绑定的机检。
 * 手法同 LiveNotes.atr.spec.ts：模板侧无 dom-shim vendor（框架 tests/ 资产不进应用模板）——
 * 本文件内联同款最小 DOM 语义（追加 value/checked/type 三个表单面属性），在 mountComponent
 * 真实渲染路径上驱动事件（不绕过解释器直测信号；信号读面 = 插值行与控件属性）。
 *
 * 红绿分面（设计内先红后绿，跨分支形态）：
 *   - 静态面（当场绿）：渲染产物含目标元素、解析产物 `bind:` 属性即契约载体（解析器零改动，
 *     决策 25）、schema 契约面。
 *   - 行为面（已知红）：初始同步 + 双向 roundtrip——runtime 单点 bindTwoWay 在 bind 批 A 分支
 *     （bind-m9-runtime）落地；当前解释器把 bind: 走 dynamic 单向 attr 支路，事件回写与
 *     信号写控件两条腿都不存在。红因统一为「bindTwoWay 支撑未落地」一类（每条断言带
 *     指认消息），不是本 spec 或组件自身的缺陷。
 * 三元共置：绑定面改动必须三处同步（.atr.ts / .atr.md / 本文件）。
 */
import { describe, it, expect } from "vitest";

/* ---- dom-shim：必须先于组件模块安装。vitest 的静态 import 会被提升到文件顶部，
 * 因此组件与 runtime 桶出口走顶层 await 动态 import（shim 已就位后再加载）。 ---- */
type AnyNode = any;

const KNOWN_RED = "已知红：bindTwoWay 支撑未落地（bind 批 A 分支，设计内先红后绿），非本用例缺陷";

class MText {
  type = "text" as const;
  childNodes: AnyNode[] = [];
  parentNode: AnyNode = null;
  data: string;
  constructor(d: string) {
    this.data = String(d);
  }
  get firstChild(): AnyNode {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = String(v);
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

class MElement {
  type: "element" | "fragment";
  tag: string;
  attrs: [string, string][] = [];
  childNodes: AnyNode[] = [];
  parentNode: AnyNode = null;
  listeners = new Map<string, ((e: unknown) => void)[]>();
  /* 表单面：bindTwoWay 的两个写点（el.value / el.checked）——真 DOM 上为反射属性，
   * shim 按 WHATWG 反射语义镜像（value=字符串化、checked=ToBoolean），
   * 使「checked 被写入字符串 'false'」这类实现缺陷在 shim 上与真 DOM 同样暴露。 */
  private _value = "";
  get value(): string {
    return this._value;
  }
  set value(v: unknown) {
    this._value = v == null ? "" : String(v);
  }
  private _checked = false;
  get checked(): boolean {
    return this._checked;
  }
  set checked(v: unknown) {
    this._checked = Boolean(v);
  }
  style = {
    setProperty: (k: string, v: string) => this.setAttribute(k, v),
  } as Record<string, string> & { setProperty: (k: string, v: string) => void };
  constructor(tag: string, type: "element" | "fragment" = "element") {
    this.tag = tag;
    this.type = type;
  }
  get firstChild(): AnyNode {
    return this.childNodes[0] ?? null;
  }
  get isConnected(): boolean {
    let n: AnyNode = this;
    while (n.parentNode) n = n.parentNode;
    return n === doc.documentElement || n === doc.head;
  }
  appendChild(node: AnyNode): AnyNode {
    if (node.type === "fragment") {
      for (const c of [...node.childNodes]) this.appendChild(c);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node: AnyNode): AnyNode {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  setAttribute(name: string, value: string): void {
    const hit = this.attrs.find(([k]) => k === name);
    if (hit) hit[1] = String(value);
    else this.attrs.push([name, String(value)]);
  }
  getAttribute(name: string): string | null {
    return this.attrs.find(([k]) => k === name)?.[1] ?? null;
  }
  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  set className(v: string) {
    this.setAttribute("class", v);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [new MText(v)];
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatchEvent(e: { type: string }): boolean {
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
    return true;
  }
}

const doc = {
  createElement: (tag: string) => new MElement(tag),
  createTextNode: (d: string) => new MText(d),
  createDocumentFragment: () => new MElement("#fragment", "fragment"),
  head: new MElement("head"),
  documentElement: new MElement("html"),
};
(globalThis as unknown as Record<string, unknown>).document = doc;
(globalThis as unknown as Record<string, unknown>).window = globalThis;

function findByTag(node: AnyNode, tag: string): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (n: AnyNode): void => {
    if (!n) return;
    if (n.type === "element" && n.tag === tag) out.push(n);
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(node);
  return out;
}
function makeContainer(): AnyNode {
  return new MElement("div");
}

/* ---- shim 就位，加载被测组件与 runtime 桶出口 ---- */
const rt = await import("../runtime");
const { FormBinding } = await import("./FormBinding.atr.ts");
const { formBindingSchema } = await import("./FormBinding.atr.ts");

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise<void>((r) => queueMicrotask(() => r()));
  }
};

/** 挂载一个全新 FormBinding 实例（模板默认态：name="Ada"、enabled=true） */
function mountForm(): { container: AnyNode; text: AnyNode; check: AnyNode; reset: AnyNode } {
  const container = makeContainer();
  doc.documentElement.appendChild(container);
  rt.mountComponent(FormBinding, { title: "Form Binding" }, container, rt.registry, (schema, data) =>
    rt.validateFlat(schema as never, data),
  );
  const inputs = findByTag(container, "input");
  return { container, text: inputs[0], check: inputs[1], reset: findByTag(container, "button")[0] };
}

describe("FormBinding — bind: v1 静态面（当场绿）", () => {
  it("渲染产物含文本 input 与 type=checkbox 两个目标元素", () => {
    const { container, check } = mountForm();
    const inputs = findByTag(container, "input");
    expect(inputs.length).toBe(2);
    expect(check.getAttribute("type")).toBe("checkbox");
  });

  it("解析器零改动：bind: 产物即契约载体（决策 25——{name:'bind:x', value:expr, dynamic:true}）", () => {
    const ast = rt.parseTemplate(`<input bind:value={name}>`);
    const el = ast[0] as { kind: string; tag: string; attrs: { name: string; value: string; dynamic: boolean }[] };
    expect(el.tag).toBe("input");
    expect(el.attrs).toEqual([{ name: "bind:value", value: "name", dynamic: true }]);

    const ast2 = rt.parseTemplate(`<input type="checkbox" bind:checked={enabled}>`);
    const el2 = ast2[0] as { attrs: { name: string; value: string; dynamic: boolean }[] };
    expect(el2.attrs).toContainEqual({ name: "bind:checked", value: "enabled", dynamic: true });
    expect(el2.attrs).toContainEqual({ name: "type", value: "checkbox", dynamic: false });
  });

  it("插值展示两信号初值（信号读面不受 bind: 支路影响）", () => {
    const { container } = mountForm();
    expect(container.textContent).toContain("name: Ada");
    expect(container.textContent).toContain("enabled: on");
  });

  it("契约面：缺 reqProps title → ATR-201（flat schema 单源纪律不变）", () => {
    const r = rt.validateFlat(formBindingSchema as never, {});
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.fix).toContain("title");
  });
});

describe("FormBinding — bind: v1 行为面（已知红：bind 批 A 分支 bindTwoWay 未落地）", () => {
  it("初始同步：挂载后控件值 = 信号初值（bind:value → value / bind:checked → checked）", async () => {
    const { text, check } = mountForm();
    await flush();
    expect(text.value, KNOWN_RED + "（el.value 写点缺失）").toBe("Ada");
    expect(check.checked, KNOWN_RED + "（el.checked 写点缺失）").toBe(true);
  });

  it("双向 roundtrip（value）：input 事件回写信号 → 插值行更新；信号写入回传控件（reset 驱动）", async () => {
    const { container, text, reset } = mountForm();
    await flush();
    // DOM → 信号：input 事件（bind:value × 文本 input 的回写事件口）
    text.value = "Grace";
    text.dispatchEvent({ type: "input", target: text });
    await flush();
    expect(container.textContent, KNOWN_RED + "（事件回写腿缺失）").toContain("name: Grace");
    // 信号 → DOM：reset 处理器写 name.value，控件值随之回位（attr effect 腿）
    reset.dispatchEvent({ type: "click" });
    await flush();
    expect(text.value, KNOWN_RED + "（attr effect 写控件腿缺失）").toBe("Ada");
    expect(container.textContent).toContain("name: Ada");
  });

  it("双向 roundtrip（checked）：change 事件回写信号 → 插值行更新；信号写入回传控件（reset 驱动）", async () => {
    const { container, check, reset } = mountForm();
    await flush();
    // DOM → 信号：change 事件（bind:checked × checkbox 的回写事件口）
    check.checked = false;
    check.dispatchEvent({ type: "change", target: check });
    await flush();
    expect(container.textContent, KNOWN_RED + "（事件回写腿缺失）").toContain("enabled: off");
    // 信号 → DOM：reset 处理器写 enabled.value，checked 随之回位
    reset.dispatchEvent({ type: "click" });
    await flush();
    expect(check.checked, KNOWN_RED + "（attr effect 写控件腿缺失）").toBe(true);
    expect(container.textContent).toContain("enabled: on");
  });
});
