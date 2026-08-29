/**
 * Atelier prototype — 类 HTML 模板解释器（决策 1/8 雏形）。
 * 支持子集：{expr} 文本插值 / {#if}{:else}{/if} / {#each arr as item, idx} / 动态属性 attr={expr}
 *         / on:click={handler} 事件 / <style scoped>（token 校验）/ 子组件 <ModelCard ... />（大写标签）。
 * 完整版差异：模板由编译器解析为组件 IR 并闭包捕获作用域（本原型为运行时解析 + 显式 .locals 注入）。
 */

import { $effect, store, __creationSink, type Signal } from "./core.ts";
import { evalExpr } from "./expr.ts";

/** —— token 单源（决策 8）：由 main.ts 启动时加载 atelier.config.json 注入 —— */
export const tokenState = {
  flat: {} as Record<string, string>,
  vars: new Set<string>(),
  ready: false,
};
export function initTokens(config: { tokens?: Record<string, Record<string, string>> }): void {
  const flat: Record<string, string> = {};
  const vars = new Set<string>();
  for (const [group, map] of Object.entries(config.tokens ?? {})) {
    for (const [name, value] of Object.entries(map)) {
      const key = `${group}.${name}`;
      flat[key] = value;
      vars.add(`--${key.replaceAll(".", "-")}`);
    }
  }
  tokenState.flat = flat;
  tokenState.vars = vars;
  tokenState.ready = true;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(flat)) {
    root.style.setProperty(`--${key.replaceAll(".", "-")}`, value);
  }
}

/** —— html 标签模板 + 显式作用域注入（编译器待办：AST 闭包捕获） —— */
export type HtmlTemplate = { raw: string; scope?: Record<string, unknown> };
export interface HtmlTemplateWithScope extends HtmlTemplate {
  locals(scope: Record<string, unknown>): HtmlTemplateWithScope;
}
export function html(strings: TemplateStringsArray): HtmlTemplateWithScope {
  const t: HtmlTemplateWithScope = {
    raw: strings.raw.join(""),
    scope: {},
    locals(s) {
      this.scope = { ...this.scope, ...s };
      return this;
    },
  };
  return t;
}

/** —— 错误（决策 9 雏形：四段式） —— */
export type AtrError = {
  code: string;
  message: string;
  context: { file?: string; component?: string; hints?: string[] };
  fix: string;
};

/** —— 模板解析 ——
 * 类型与 parseTemplate 对编译器（P0-2②）开放：dump 直接消费同一解析器，保证
 * 「编译器看到的树 = 解释器跑的树」单一来源。 */
export type TemplateAttr = { name: string; value: string; dynamic: boolean };
export type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "expr"; expr: string }
  | { kind: "element"; tag: string; component: boolean; attrs: TemplateAttr[]; children: TemplateNode[] }
  | { kind: "if"; blocks: { test: string | null; children: TemplateNode[] }[] }
  | { kind: "each"; expr: string; item: string; index: string; keyExpr?: string; children: TemplateNode[] };
// internal short aliases (public names above are the compiler-facing surface)
type Attr = TemplateAttr;
type Node = TemplateNode;

class Parser {
  src: string;
  pos = 0;
  constructor(src: string) {
    this.src = src;
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  parseContent(): Node[] {
    const nodes: Node[] = [];
    while (!this.eof()) {
      const rest = this.src.slice(this.pos);
      const c = this.src[this.pos];
      if (c === "<") {
        if (this.src.startsWith("<!--", this.pos)) {
          const end = this.src.indexOf("-->", this.pos);
          this.pos = end < 0 ? this.src.length : end + 3;
          continue;
        }
        if (this.src.startsWith("</", this.pos)) break; // 交给父级处理
        const tagMatch = /^<([A-Za-z][\w-]*)/.exec(rest);
        if (!tagMatch) {
          this.pos++;
          continue;
        }
        nodes.push(this.parseElement(tagMatch[1]));
        continue;
      }
      if (c === "{") {
        if (
          this.src.startsWith("{:else}", this.pos) ||
          this.src.startsWith("{/if}", this.pos) ||
          this.src.startsWith("{/each}", this.pos)
        )
          break; // 块终止符，交给所属块处理
        const mIf = /^\{#if\s+([^}]+)\}/.exec(rest);
        if (mIf) {
          this.pos += mIf[0].length;
          const blocks: { test: string | null; children: Node[] }[] = [];
          blocks.push({ test: mIf[1], children: this.parseContent() });
          while (this.src.startsWith("{:else}", this.pos)) {
            this.pos += 6;
            blocks.push({ test: null, children: this.parseContent() });
          }
          if (this.src.startsWith("{/if}", this.pos)) this.pos += 5;
          nodes.push({ kind: "if", blocks });
          continue;
        }
        const mEach = /^\{#each\s+([^}]+?)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?(?:\s+by\s+(.+?))?\}/.exec(rest);
        if (mEach) {
          this.pos += mEach[0].length;
          const children = this.parseContent();
          if (this.src.startsWith("{/each}", this.pos)) this.pos += 7;
          nodes.push({ kind: "each", expr: mEach[1].trim(), item: mEach[2], index: mEach[3] ?? "__i", keyExpr: mEach[4]?.trim(), children });
          continue;
        }
        const mExpr = /^\{([^{}]+)\}/.exec(rest);
        if (mExpr) {
          this.pos += mExpr[0].length;
          const text = mExpr[1].trim();
          if (text.length > 0) nodes.push({ kind: "expr", expr: text });
          continue;
        }
        this.pos++;
        continue;
      }
      // 文本
      let j = this.pos;
      while (j < this.src.length && this.src[j] !== "<" && this.src[j] !== "{") j++;
      if (j > this.pos) nodes.push({ kind: "text", text: this.src.slice(this.pos, j) });
      this.pos = j;
    }
    return nodes;
  }
  /** 解析元素（开始标签 + 属性，必要时递归子内容直到闭合标签） */
  parseElement(tag: string): Node {
    let i = this.pos + 1 + tag.length;
    const attrs: Attr[] = [];
    for (;;) {
      while (i < this.src.length && /\s/.test(this.src[i])) i++;
      if (this.src.startsWith("/>", i)) {
        i += 2;
        this.pos = i;
        return { kind: "element", tag, component: /^[A-Z]/.test(tag), attrs, children: [] };
      }
      if (this.src.startsWith(">", i)) {
        i += 1;
        this.pos = i;
        break;
      }
      if (this.src.startsWith("</", i)) break;
      const am = /^([A-Za-z_][\w:-]*)/.exec(this.src.slice(i));
      if (!am) {
        i++;
        continue;
      }
      const name = am[1];
      i += name.length;
      while (i < this.src.length && /\s/.test(this.src[i])) i++;
      let value = "";
      let dynamic = false;
      if (this.src[i] === "=") {
        i++;
        while (i < this.src.length && /\s/.test(this.src[i])) i++;
        if (this.src[i] === '"' || this.src[i] === "'") {
          const q = this.src[i];
          i++;
          let v = "";
          while (i < this.src.length && this.src[i] !== q) {
            v += this.src[i];
            i++;
          }
          i++;
          const vm = /^\{([^{}]+)\}$/.exec(v.trim());
          if (vm) {
            dynamic = true;
            value = vm[1].trim();
          } else {
            value = v;
          }
        } else if (this.src[i] === "{") {
          const mm = /^\{([^{}]+)\}/.exec(this.src.slice(i));
          if (mm) {
            dynamic = true;
            value = mm[1].trim();
            i += mm[0].length;
          }
        }
      }
      attrs.push({ name, value, dynamic });
    }
    // 子内容：递归解析直到匹配的闭合标签
    const children = this.parseContent();
    const endRe = new RegExp(`</${tag}>`);
    const rest = this.src.slice(this.pos);
    const em = endRe.exec(rest);
    if (em) this.pos += em.index + em[0].length;
    return { kind: "element", tag, component: /^[A-Z]/.test(tag), attrs, children };
  }
}

/**
 * P1-2 解析缓存：html`` 同一处字面量的 raw 恒定 → 同组件重挂零解析成本；
 * 动态拼接的 raw 若频繁变化由容量上限兜底清空（AST 只读共享，渲染期不改树）。
 */
const parseCache = new Map<string, Node[]>();
/** exported for the compiler (P0-2② AST dump): one parser, one truth — the dump and the
 * runtime interpreter MUST see the same tree for the same template string. */
export function parseTemplate(src: string): Node[] {
  let ast = parseCache.get(src);
  if (!ast) {
    ast = new Parser(src).parseContent();
    if (parseCache.size >= 500) parseCache.clear();
    parseCache.set(src, ast);
  }
  return ast;
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v, null, 0);
  return String(v);
}

/** 表达式 effect 绑定：求值（track 依赖）→ 变化时执行 write；求值失败渲染 ATR 错误卡而非抛穿白屏 */
function bindExpr(expr: string, scope: Record<string, unknown>, write: (v: unknown) => void): void {
  $effect(() => {
    let v: unknown;
    try {
      v = evalExpr(expr, scope);
    } catch (e) {
      const err = e as { code?: string; message?: string; fix?: string };
      recordRuntimeError(err);
      write(`⚠ ${err.code ?? "ATR"} ${err.message ?? String(e)}${err.fix ? ` — fix: ${err.fix}` : ""}`);
      return;
    }
    write(v);
  });
}

/** P2-1 全局最近错误暴露（dev 面经由桥上报；工具侧可查） */
function recordRuntimeError(e: unknown): void {
  const w = window as never as { __ATELIER_LAST_ERROR__?: unknown };
  w.__ATELIER_LAST_ERROR__ = e;
  console.error("[atelier] render error:", e);
}

/** —— 渲染上下文 —— */
export type ComponentDef<P = Record<string, unknown>> = {
  name: string;
  render: (props: P) => HtmlTemplate;
  schema?: unknown;
};
export type ComponentRegistry = Map<string, ComponentDef>;

const scopedStyles = new Set<string>();
function injectScopedStyle(componentName: string, css: string, file: string): void {
  const key = `${file}:${css.length}`;
  if (scopedStyles.has(key)) return;
  scopedStyles.add(key);
  // H3/ATR-204：样式只能引用语义 token
  const re = /var\(\s*(--[\w-]+)\s*\)/g;
  let m: RegExpExecArray | null;
  const missing = new Set<string>();
  while ((m = re.exec(css))) {
    if (!tokenState.vars.has(m[1])) missing.add(m[1]);
  }
  if (missing.size > 0) {
    const hints = [...tokenState.vars].sort();
    throw {
      code: "ATR-204",
      message: `样式引用了不存在的 token：${[...missing].join("、")}`,
      context: { component: componentName, file, hints },
      fix: `将 ${[...missing].map((v) => `var(${v})`).join("、")} 改为 atelier.config.json 中已定义的语义 token（可用：${hints.slice(0, 8).join("、")}）`,
    } as AtrError;
  }
  const scopeClass = `atr-scope-${scopeSeq++}`;
  // 作用域前缀跳过 @规则头与 @keyframes 的内部选择器（0% / 50% / from / to），
  // 修复：此前 keyframes 百分比帧被误加前缀导致动画静默失效
  const kfSel = /^(?:[\d.,%\s]+|from(?:\s*,.*)?|to(?:\s*,.*)?)$/;
  const prefixed = css.replace(/([^{}]+)\{/g, (all, sel: string) => {
    const s = sel.trim();
    if (!s || s.startsWith("@") || kfSel.test(s)) return all;
    return `.${scopeClass} ${s} {`;
  });
  const el = document.createElement("style");
  el.textContent = prefixed;
  document.head.appendChild(el);
  scopeClasses.set(componentName, scopeClass);
}
const scopeClasses = new Map<string, string>();
let scopeSeq = 0;

export function mountComponent(
  def: ComponentDef,
  props: Record<string, unknown>,
  container: Element,
  registry: ComponentRegistry,
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError }
): HTMLElement {
  try {
    return mountComponentInner(def, props, container, registry, validate);
  } catch (e) {
    // P2-1 组件级错误边界：契约/style/渲染抛出的 ATR 错误渲染为可行动卡片，绝不白屏
    const err = e as { code?: string; message?: string; fix?: string };
    recordRuntimeError(e);
    const card = document.createElement("div");
    card.className = "atr-error-card";
    card.textContent = `${err.code ?? "ATR-ERR"} ${err.message ?? String(e)} — fix: ${err.fix ?? ""}`;
    container.appendChild(card);
    return card as unknown as HTMLElement;
  }
}

function mountComponentInner(
  def: ComponentDef,
  props: Record<string, unknown>,
  container: Element,
  registry: ComponentRegistry,
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError }
): HTMLElement {
  // P0-5 HMR：栈式创建收集——本次 render 新建的 $state 归属本实例（嵌套 mount 各自接管）
  const collected: Signal[] = [];
  const prevSink = __creationSink.fn;
  __creationSink.fn = (s) => collected.push(s);
  mountDepth++;
  let root!: HTMLElement;
  try {
    const tpl = def.render(props as never) ?? { raw: "", scope: {} };
    const scope = { ...(tpl.scope ?? {}), props };
    const file = `components/${def.name}.atr.ts`;
    const styleMatch = /<style(?:\s+scoped)?\s*>([\s\S]*?)<\/style>/i.exec(tpl.raw);
    if (styleMatch) injectScopedStyle(def.name, styleMatch[1], file);
    const frag = renderNodes(parseTemplate(tpl.raw), scope, registry, validate, file, def.name);
    root = document.createElement("div");
    root.className = `atr-root atr-scope-${def.name}`;
    if (scopeClasses.has(def.name)) root.classList.add(scopeClasses.get(def.name)!);
    root.appendChild(frag);
    container.appendChild(root);
  } finally {
    __creationSink.fn = prevSink;
    mountDepth--;
  }
  liveInstances.add({
    defName: def.name,
    container,
    root,
    props,
    validate,
    registry,
    signals: collected,
    nested: mountDepth >= 1, // 记录时外层尚未自减：≥2 即嵌套挂载
  });
  return root;
}

/* ---- P0-5 HMR 热交换：保值重挂载 --------------------------------------
 * dev 插件给 *.atr.ts 注入 import.meta.hot.accept → 新模块重注册组件后调
 * window.__ATELIER_HMR_REMOUNT__()：对所有顶层活实例「快照信号值 → 卸旧树 →
 * 用新 def 重挂载 → 按创建序还原信号值」。按序还原是启发式（模板结构大改可能
 * 错位——多出的新信号保持初值，文档已标注）。已知边界（诚实标注）：
 *   · 旧树 effects 未逐个 dispose， Detached 后仍在订阅（dev-only 有界泄漏）
 *   · store 旧 checkpoint 引用被换信号，跨交换的 timeTravel 不回落到新信号
 */
type LiveInstance = {
  defName: string;
  container: Element;
  root: HTMLElement;
  props: Record<string, unknown>;
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError };
  registry: ComponentRegistry;
  signals: Signal[];
  nested: boolean;
};
const liveInstances = new Set<LiveInstance>();
let mountDepth = 0;

function hmrSwap(): number {
  // 先清陈旧嵌套记录（父级重挂后其 root 已不在文档）
  for (const inst of [...liveInstances]) {
    if (!inst.root.isConnected) {
      liveInstances.delete(inst);
      for (const s of inst.signals) store._signals.delete(s);
    }
  }
  let swapped = 0;
  for (const inst of [...liveInstances]) {
    if (inst.nested) continue;
    const values = inst.signals.map((s) => s.get());
    inst.root.remove();
    liveInstances.delete(inst);
    for (const s of inst.signals) store._signals.delete(s);
    const def = inst.registry.get(inst.defName); // 新模块已重注册；未注册则放弃该实例
    if (!def) continue;
    const root = mountComponentInner(def, inst.props, inst.container, inst.registry, inst.validate);
    const fresh = [...liveInstances].find((i) => i.root === root);
    if (fresh) {
      fresh.signals.forEach((s, i) => {
        if (i < values.length) {
          try { s.set(values[i]); } catch { /* 只读信号跳过 */ }
        }
      });
      swapped++;
    }
  }
  return swapped;
}
export function hmrRemountAll(): number {
  return hmrSwap();
}
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__ATELIER_HMR_REMOUNT__ = () => hmrSwap();
}

function renderNodes(
  nodes: Node[],
  scope: Record<string, unknown>,
  registry: ComponentRegistry,
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError },
  file: string,
  componentName: string
): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    const out = renderNode(node, scope, registry, validate, file, componentName);
    if (out) frag.appendChild(out);
  }
  return frag;
}

function renderNode(
  node: Node,
  scope: Record<string, unknown>,
  registry: ComponentRegistry,
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError },
  file: string,
  componentName: string
): Node | DocumentFragment | null {
  switch (node.kind) {
    case "text":
      return document.createTextNode(node.text);
    case "expr": {
      const tn = document.createTextNode("");
      bindExpr(node.expr, scope, (v) => {
        tn.textContent = stringify(v);
      });
      return tn;
    }
    case "element": {
      if (node.tag.toLowerCase() === "style") return null; // scoped style 已在上层注入
      if (node.component) {
        const def = registry.get(node.tag);
        if (!def) {
          const fallback = document.createElement("div");
          fallback.className = "atr-error-card";
          fallback.textContent = `ATR-4xx: 组件未注册：${node.tag}（检查 import 是否只注册于组件文件）`;
          return fallback;
        }
        const props: Record<string, unknown> = {};
        for (const a of node.attrs) props[a.name] = a.dynamic ? evalExpr(a.value, scope) : a.value;
        const v = validate(def.schema, props);
        if (!v.ok) {
          const errBox = document.createElement("div");
          errBox.className = "atr-error-card";
          errBox.textContent = `${v.error?.code} ${v.error?.message} — fix: ${v.error?.fix ?? ""}`;
          return errBox;
        }
        const wrapper = document.createElement("span");
        return mountComponent(def, props, wrapper, registry, validate);
      }
      const el = document.createElement(node.tag);
      for (const a of node.attrs) {
        if (a.name.startsWith("on:")) {
          const ev = a.name.slice(3);
          el.addEventListener(ev, (e) => {
            const fn = evalExpr(a.value, scope) as ((ev: Event) => void) | undefined;
            if (typeof fn === "function") fn(e);
          });
          continue;
        }
        if (a.dynamic) {
          bindExpr(a.value, scope, (v) => {
            if (v == null) el.removeAttribute(a.name);
            else el.setAttribute(a.name, stringify(v));
          });
        } else {
          el.setAttribute(a.name, a.value);
        }
      }
      el.appendChild(renderNodes(node.children, scope, registry, validate, file, componentName));
      return el;
    }
    case "if": {
      const anchor = document.createElement("span");
      anchor.style.display = "contents";
      let currentBlock = -1;
      $effect(() => {
        let chosen = -1;
        for (let i = 0; i < node.blocks.length; i++) {
          const b = node.blocks[i];
          if (b.test === null) {
            chosen = i; // else：仅当无前置命中时
            break;
          }
          if (booly(evalExpr(b.test, scope))) {
            chosen = i;
            break;
          }
        }
        if (chosen !== currentBlock) {
          // 注意：不能对 appendChild 之后的 DocumentFragment 调 remove()——
          // appendChild 会把 fragment 的子节点搬进 DOM 并清空 fragment，remove 落空导致旧分支残留。
          // 与 each 分支一致：逐个清空 anchor 子节点再挂新分支。
          while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
          if (chosen >= 0) {
            const frag = renderNodes(node.blocks[chosen].children, scope, registry, validate, file, componentName);
            anchor.appendChild(frag);
          }
          currentBlock = chosen;
        }
      });
      return anchor;
    }
    case "each": {
      const host = document.createElement("span");
      host.style.display = "contents";
      if (node.keyExpr) {
        // P1-1 keyed reconcile：按 by-key 复用已渲染子树（移动 = appendChild 重排，活动 effect 不丢）；
        // 语义边界：key 稳定的项其内容更新必须走 $state 信号（H1）——纯非信号数据变化不会触发该项重渲。
        const live = new Map<string, HTMLElement>();
        $effect(() => {
          const arr = (evalExpr(node.expr, scope) ?? []) as unknown[];
          const nextKeys = new Set<string>();
          arr.forEach((item, i) => {
            const childScope: Record<string, unknown> = { ...scope, [node.item]: item, [node.index]: i };
            let k: string;
            try {
              k = stringify(evalExpr(node.keyExpr!, childScope));
            } catch {
              k = `${i}`; // key 求值失败退化为位置 key（诚实降级而非白屏）
            }
            nextKeys.add(k);
            let el = live.get(k);
            if (!el) {
              const box = document.createElement("span");
              box.style.display = "contents";
              box.appendChild(renderNodes(node.children, { ...scope, [node.item]: item, [node.index]: i }, registry, validate, file, componentName));
              el = box;
              live.set(k, el);
            }
            host.appendChild(el); // 相同顺序时为 no-op；乱序时即完成重排
          });
          for (const [k, el] of [...live]) {
            if (!nextKeys.has(k)) {
              el.remove();
              live.delete(k);
            }
          }
        });
        return host;
      }
      // 旧语义（无 by）：全清重建
      $effect(() => {
        const arr = (evalExpr(node.expr, scope) ?? []) as unknown[];
        while (host.firstChild) host.removeChild(host.firstChild);
        arr.forEach((item, i) => {
          const childScope = { ...scope, [node.item]: item, [node.index]: i };
          host.appendChild(renderNodes(node.children, childScope, registry, validate, file, componentName));
        });
      });
      return host;
    }
  }
}

function booly(v: unknown): boolean {
  return Boolean(v);
}
