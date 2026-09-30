/**
 * dom-shim.ts — micro-DOM：跑通 mountComponent 所需的最小 DOM 语义（零依赖，vitest node 环境）。
 * 必须在导入 runtime/template.ts 之前 import（模板模块在 import 期探测 window）。
 * 覆盖的语义面（golden 对拍依赖这些行为为真）：
 *   · appendChild 的「移动」语义（keyed reconcile 重排 / 组件 root 从 wrapper 搬出）
 *   · DocumentFragment appendChild 后清空（fragment 子节点搬入父级）
 *   · className / classList / setAttribute / removeAttribute / hasAttribute / getAttribute（保序 + 存在性语义）
 *   · HTML 布尔属性的属性反射（P1-2 配套）：el.disabled / el.checked 等 ⇔ hasAttribute——
 *     真浏览器「属性存在即真」；纯 [name, value] 字符串表 + 纯 JS 属性字段罩不住这一族语义，
 *     disabled={false} 落 "false" 字符串的语义反转在旧 shim 下原理上不可见（建议书 4.1 P1-2）
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
  /** CSSStyleDeclaration 最小面：initTokens 走 setProperty 写 CSS 变量（P3-1 task6 评分依赖） */
  style: Record<string, string> & { setProperty: (k: string, v: string) => void } = {
    setProperty: (k: string, v: string) => this.setAttribute(k, v),
  };

  constructor(tag: string, type: "element" | "fragment" = "element") {
    this.tag = tag;
    this.type = type;
  }

  get firstChild(): AnyNode {
    return this.childNodes[0] ?? null;
  }

  /** 真实 DOM 语义：祖先链到达文档根（documentElement/head）才算连接——HMR 回收判据依赖它 */
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
  removeAttribute(name: string): void {
    const i = this.attrs.findIndex(([k]) => k === name);
    if (i >= 0) this.attrs.splice(i, 1);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.some(([k]) => k === name);
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

/** HTML 布尔属性清单（存在即真）——与 runtime/template.ts 的 BOOLEAN_ATTRS 保持同一集合。
 * 复刻而非 import：dom-shim 必须先于 runtime 模板模块求值（window 探测时序），反向 import
 * 会把 runtime 模块体提前到 window 置位之前。改清单时两处同步（测试面复刻，MUST stay in sync）。 */
const BOOLEAN_ATTRS = [
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop",
  "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly",
  "required", "reversed", "selected",
] as const;
for (const attr of BOOLEAN_ATTRS) {
  Object.defineProperty(MElement.prototype, attr, {
    /** 真 DOM 语义：IDL 属性反射内容属性的存在性——el.disabled ⇔ hasAttribute("disabled") */
    get() {
      return this.hasAttribute(attr);
    },
    set(v: unknown) {
      if (v) this.setAttribute(attr, "");
      else this.removeAttribute(attr);
    },
    enumerable: true,
    configurable: true,
  });
}

/** select/option 最小 value 语义（P-A P2-R1 测试基建）：真 DOM 中 select.value 是「选中项的
 * value」派生值而非存储属性——bind:value × select 的初始选中丢失（option 晚于下行 effect
 * 首跑 append）在纯 expando 形态下原理上不可见。语义面：
 *   · select getter：有选中 option 取其 value；否则回落最后写入值（裸 select 的接线面用例
 *     ——bind-directive.test.ts「select 接线钉面」——依赖此回落，诚实标注：真 DOM 此处为 ""）；
 *   · select setter：首个 value 匹配的 option 置 selected（经 BOOLEAN_ATTRS 反射存在即真），
 *     其余取消；无匹配时清空选中（真 DOM 同款）；
 *   · option getter：value attr ?? 文本内容（真 DOM 同款）；
 *   · 非 select/option 维持旧 expando 形态（自有字段，未写过 = undefined），既有用例全兼容。 */
Object.defineProperty(MElement.prototype, "value", {
  get(this: AnyNode) {
    if (this.tag === "select") {
      const sel = this.childNodes.find((c: AnyNode) => c.type === "element" && c.tag === "option" && c.selected);
      if (sel) return sel.value;
      return this.__selFallback ?? "";
    }
    if (this.tag === "option") return this.getAttribute("value") ?? this.textContent;
    return this.__expandoValue;
  },
  set(this: AnyNode, v: unknown) {
    if (this.tag === "select") {
      const want = String(v);
      let hit = false;
      for (const c of this.childNodes) {
        if (c.type !== "element" || c.tag !== "option") continue;
        const isHit = !hit && c.value === want;
        if (isHit) hit = true;
        c.selected = isHit; // BOOLEAN_ATTRS 反射：存在即真
      }
      this.__selFallback = hit ? undefined : want;
      return;
    }
    this.__expandoValue = v;
  },
  configurable: true,
});

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

/** 把容器挂进文档根——isConnected 语义需要祖先链可达 documentElement（HMR 回收判据） */
export function attachToDocument(node: AnyNode): AnyNode {
  doc.documentElement.appendChild(node);
  return node;
}

/** 文档 head 中的 <style> 元素（R1-B 支 P1 #6 双 style 块注入计数用：解释器 vs 编译路径
 * 的 scoped 样式都落在 head，序列化容器看不到） */
export function headStyles(): AnyNode[] {
  return doc.head.childNodes.filter((c: AnyNode) => c.type === "element" && c.tag === "style");
}
