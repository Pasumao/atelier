/**
 * dom-shim.ts — micro-DOM：跑通 mountComponent 所需的最小 DOM 语义（零依赖，vitest node 环境）。
 * 必须在导入 runtime/template.ts 之前 import（模板模块在 import 期探测 window）。
 * 覆盖的语义面（golden 对拍依赖这些行为为真）：
 *   · appendChild 的「移动」语义（keyed reconcile 重排 / 组件 root 从 wrapper 搬出）
 *   · DocumentFragment appendChild 后清空（fragment 子节点搬入父级）
 *   · className / classList / setAttribute / removeAttribute（保序）
 *   · addEventListener / dispatchEvent、firstChild / removeChild / remove
 *   · textContent 赋值（元素=替换子节点；文本=改 data）
 */
type AnyNode = any;

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
  style: Record<string, string> = {};

  constructor(tag: string, type: "element" | "fragment" = "element") {
    this.tag = tag;
    this.type = type;
  }

  get firstChild(): AnyNode {
    return this.childNodes[0] ?? null;
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
  removeAttribute(name: string): void {
    const i = this.attrs.findIndex(([k]) => k === name);
    if (i >= 0) this.attrs.splice(i, 1);
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
  get classList() {
    const self = this;
    return {
      add(...cs: string[]) {
        const cur = self.getAttribute("class") ?? "";
        const have = new Set(cur.split(/\s+/).filter(Boolean));
        const next = [...cur.split(/\s+/).filter(Boolean), ...cs.filter((c) => !have.has(c))];
        self.setAttribute("class", next.join(" "));
      },
    };
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

/** 确定性序列化：插入序属性 + 深度先序子树（golden DOM diff 的 diff 基准） */
export function serialize(node: AnyNode): string {
  if (!node) return "";
  if (node.type === "text") return JSON.stringify(node.data);
  if (node.type === "fragment") return node.childNodes.map(serialize).join("");
  const attrs = node.attrs.map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join("");
  return `<${node.tag}${attrs}>${node.childNodes.map(serialize).join("")}</${node.tag}>`;
}

/** 先序找全部指定标签（事件用例定位 button 等） */
export function findByTag(node: AnyNode, tag: string): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (n: AnyNode) => {
    if (!n) return;
    if (n.type === "element" && n.tag === tag) out.push(n);
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(node);
  return out;
}

export function makeContainer(): AnyNode {
  return new MElement("div");
}
