/**
 * Atelier prototype — 类 HTML 模板解释器（决策 1/8 雏形）。
 * 支持子集：{expr} 文本插值 / {#if}{:else}{/if} / {#each arr as item, idx} / 动态属性 attr={expr}
 *         / on:click={handler} 事件 / <style scoped>（token 校验）/ 子组件 <ModelCard ... />（大写标签）。
 * 完整版差异：模板由编译器解析为组件 IR 并闭包捕获作用域（本原型为运行时解析 + 显式 .locals 注入）。
 */

import { $effect, type Signal } from "./core";
import { evalExpr } from "./expr";

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

/** —— 模板解析 —— */
type Attr = { name: string; value: string; dynamic: boolean };
type Node =
  | { kind: "text"; text: string }
  | { kind: "expr"; expr: string }
  | { kind: "element"; tag: string; component: boolean; attrs: Attr[]; children: Node[] }
  | { kind: "if"; blocks: { test: string | null; children: Node[] }[] }
  | { kind: "each"; expr: string; item: string; index: string; children: Node[] };

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
        const mEach = /^\{#each\s+([^}]+?)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\}/.exec(rest);
        if (mEach) {
          this.pos += mEach[0].length;
          const children = this.parseContent();
          if (this.src.startsWith("{/each}", this.pos)) this.pos += 7;
          nodes.push({ kind: "each", expr: mEach[1].trim(), item: mEach[2], index: mEach[3] ?? "__i", children });
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

function parseTemplate(src: string): Node[] {
  return new Parser(src).parseContent();
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v, null, 0);
  return String(v);
}

/** 表达式 effect 绑定：求值（track 依赖）→ 变化时执行 write */
function bindExpr(expr: string, scope: Record<string, unknown>, write: (v: unknown) => void): void {
  $effect(() => {
    write(evalExpr(expr, scope));
  });
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
  const prefixed = css.replace(/([^{}]+)\{/g, (all, sel: string) => {
    const s = sel.trim();
    if (!s || s.startsWith("@")) return all;
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
  const tpl = def.render(props as never) ?? { raw: "", scope: {} };
  const scope = { ...(tpl.scope ?? {}), props };
  const file = `components/${def.name}.atr.ts`;
  const styleMatch = /<style(?:\s+scoped)?\s*>([\s\S]*?)<\/style>/i.exec(tpl.raw);
  if (styleMatch) injectScopedStyle(def.name, styleMatch[1], file);
  const frag = renderNodes(parseTemplate(tpl.raw), scope, registry, validate, file, def.name);
  const root = document.createElement("div");
  root.className = `atr-root atr-scope-${def.name}`;
  if (scopeClasses.has(def.name)) root.classList.add(scopeClasses.get(def.name)!);
  root.appendChild(frag);
  container.appendChild(root);
  return root;
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
      let current: DocumentFragment | null = null;
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
          if (current) current.remove();
          if (chosen >= 0) {
            current = renderNodes(node.blocks[chosen].children, scope, registry, validate, file, componentName);
            anchor.appendChild(current);
          } else {
            current = null;
          }
          currentBlock = chosen;
        }
      });
      return anchor;
    }
    case "each": {
      const host = document.createElement("span");
      host.style.display = "contents";
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
