/**
 * Atelier prototype — 类 HTML 模板解释器（决策 1/8 雏形）。
 * 支持子集：{expr} 文本插值（含对象/数组字面量 {{a: x.value}} 与 {a} 简写，F-4 第二期）
 *         / {#if}{:else if}{:else}{/if} / {#each arr as item, idx [by key]}
 *         / 动态属性 attr={expr} / on:click={handler} 事件 / HTML void 元素（<br>/<img>/<input>… 无闭合）
 *         / <style scoped>（token 校验）/ 子组件 <ModelCard ... />（大写标签）。
 * 解析期显式拒绝（ATR-101）：未闭合的 {#if}/{#each}/元素标签、错位与游离闭合标签——不静默吞掉
 * （编译路径构建期即抛，解释器路径渲染为可行动错误卡）。字面量花括号（非表达式候选）原样并入
 * 文本，不再静默丢弃。诚实边界：残缺 "</"（无标签名）拒绝；表达式不支持箭头函数/赋值（ATR-301）。
 * 完整版差异：模板由编译器解析为组件 IR 并闭包捕获作用域（本原型为运行时解析 + 显式 .locals 注入）。
 */

import { $effect, $state, store, __creationSink, __effectSink, __withTracking, type Signal } from "./core.ts";
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
  /** 块语法起始判定（{:else if / {:else} / {/if} / {/each}）——主循环与文本扫描共用 */
  private blockStartsAt(i: number): boolean {
    return (
      this.src.startsWith("{:else}", i) ||
      /^\{:else\s+if[\s(]/.test(this.src.slice(i)) ||
      this.src.startsWith("{/if}", i) ||
      this.src.startsWith("{/each}", i)
    );
  }

  /** expectedClose = 所属元素的标签名（元素子内容）；缺省 = 顶层或块子内容（任何 </ 均为游离闭合） */
  parseContent(expectedClose?: string): Node[] {
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
        if (this.src.startsWith("</", this.pos)) {
          // 闭合标签配对校验（F-4 第二期）：错位/游离闭合显式拒绝——此前会静默吞掉甚至截断余下模板
          const m = /^<\/([A-Za-z][\w-]*)>/.exec(rest);
          if (!m) parseFail("残缺的闭合标签（</ 后无合法标签名）", "补全闭合标签名，如 </div>");
          if (expectedClose && m[1] === expectedClose) break; // 配对命中，交由所属元素消费
          if (expectedClose) {
            parseFail(
              `<${expectedClose}> 未闭合 — 遇到 </${m[1]}>（闭合标签不匹配）`,
              `补上 </${expectedClose}> 或调整嵌套层级（void 元素如 <br>/<img> 无需闭合）`,
            );
          }
          parseFail(`多余的闭合标签 </${m[1]}>（无对应开标签）`, `删除 </${m[1]}> 或补上对应的开标签`);
        }
        const tagMatch = /^<([A-Za-z][\w-]*)/.exec(rest);
        if (!tagMatch) {
          this.pos++;
          continue;
        }
        nodes.push(this.parseElement(tagMatch[1]));
        continue;
      }
      if (c === "{") {
        if (this.blockStartsAt(this.pos)) break; // 块终止符，交给所属块处理
        const mIf = /^\{#if\s+([^}]+)\}/.exec(rest);
        if (mIf) {
          this.pos += mIf[0].length;
          const blocks: { test: string | null; children: Node[] }[] = [];
          blocks.push({ test: mIf[1], children: this.parseContent() });
          for (;;) {
            const mElseIf = /^\{:else\s+if\s+([^}]+)\}/.exec(this.src.slice(this.pos));
            if (mElseIf) {
              this.pos += mElseIf[0].length;
              blocks.push({ test: mElseIf[1], children: this.parseContent() });
              continue;
            }
            if (this.src.startsWith("{:else}", this.pos)) {
              this.pos += 7; // "{:else}".length——此前 6 会把 } 漏进 else 分支当文本节点
              blocks.push({ test: null, children: this.parseContent() });
              continue;
            }
            break;
          }
          if (!this.src.startsWith("{/if}", this.pos)) parseFail(`{#if} 未闭合 — 缺少 {/if}`, "补上与 {#if} 配对的 {/if}（{:else if} / {:else} 分支同样要在 {/if} 前结束）");
          this.pos += 5;
          nodes.push({ kind: "if", blocks });
          continue;
        }
        const mEach = /^\{#each\s+([^}]+?)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?(?:\s+by\s+(.+?))?\}/.exec(rest);
        if (mEach) {
          this.pos += mEach[0].length;
          const children = this.parseContent();
          if (!this.src.startsWith("{/each}", this.pos)) parseFail(`{#each} 未闭合 — 缺少 {/each}`, "补上与 {#each} 配对的 {/each}");
          this.pos += 7;
          nodes.push({ kind: "each", expr: mEach[1].trim(), item: mEach[2], index: mEach[3] ?? "__i", keyExpr: mEach[4]?.trim(), children });
          continue;
        }
        // 表达式：引号感知配对扫描（F-4 第二期）。配对成功即表达式节点——内容非法由 bindExpr
        // 求值期以 ATR-301 错误卡响亮报错（P0-8 前置报错语义不变）；仅配对失败的 { 才是字面量。
        const close = matchBrace(this.src, this.pos);
        if (close > this.pos + 1 && this.src.slice(this.pos + 1, close).trim().length > 0) {
          nodes.push({ kind: "expr", expr: this.src.slice(this.pos + 1, close).trim() });
          this.pos = close + 1;
          continue;
        }
        // 非表达式 {（{ } 空体 / 配对失败）：不推进、不丢弃——落入下方文本分支原样并入
      }
      // 文本：字面量 { 原样并入（此前被静默丢弃）；块语法与表达式候选交回主循环
      let j = this.pos;
      let buf = "";
      while (j < this.src.length) {
        const ch = this.src[j];
        if (ch === "<") break;
        if (ch === "{") {
          const restJ = this.src.slice(j);
          const close2 = matchBrace(this.src, j);
          const probeExpr =
            close2 > j + 1 && this.src.slice(j + 1, close2).trim().length > 0; // 与主分支发射条件一致——否则互相踢皮球死循环
          if (this.blockStartsAt(j) || /^\{#if\s/.test(restJ) || /^\{#each\s/.test(restJ) || probeExpr) break;
          buf += ch;
          j++;
          continue;
        }
        buf += ch;
        j++;
      }
      if (buf) nodes.push({ kind: "text", text: buf });
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
        if (VOID_TAGS.has(tag.toLowerCase())) {
          // void 元素无子内容也不需要闭合标签——否则后续兄弟节点会被吞成它的 children
          return { kind: "element", tag, component: false, attrs, children: [] };
        }
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
          // 引号内 {expr} 判别用配对扫描——对象字面量 attr="{{a: 1}}" 同样支持（F-4 第二期）
          const tv = v.trim();
          const qb = tv.startsWith("{") ? matchBrace(tv, 0) : -1;
          if (qb === tv.length - 1 && tv.slice(1, qb).trim().length > 0) {
            dynamic = true;
            value = tv.slice(1, qb).trim();
          } else {
            value = v;
          }
        } else if (this.src[i] === "{") {
          const close = matchBrace(this.src, i);
          if (close > i + 1 && this.src.slice(i + 1, close).trim().length > 0) {
            dynamic = true;
            value = this.src.slice(i + 1, close).trim();
            i = close + 1;
          }
        }
      }
      attrs.push({ name, value, dynamic });
    }
    // 子内容：递归解析（传入本元素标签 → 配对闭合由 parseContent 校验后停在这里）
    const children = this.parseContent(tag);
    if (!this.src.startsWith(`</${tag}>`, this.pos)) {
      parseFail(
        `<${tag}> 未闭合 — 缺少 </${tag}>`,
        `补上闭合标签 </${tag}>（HTML void 元素如 <br>/<img>/<input> 无需闭合）`,
      );
    }
    this.pos += tag.length + 3;
    return { kind: "element", tag, component: /^[A-Z]/.test(tag), attrs, children };
  }
}

/** HTML void 元素（无子内容、无闭合标签） */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

/** 模板解析错误（ATR-1xx 家族）：解析期显式拒绝而非静默吞掉——解释器路径被组件错误边界接住
 * 渲染为可行动错误卡，编译路径（compileFunction/dump）在构建期即抛出。 */
function parseFail(message: string, fix: string): never {
  throw { code: "ATR-101", message, context: {}, fix } as AtrError;
}

/** 引号感知的 {} 配对扫描：返回与 src[start] 的 { 配对的 } 索引（无配对 → -1）。
 * 字符串字面量内的花括号不计深度——{x === "}" ? 1 : 2} 一类表达式得以完整摘出。 */
function matchBrace(src: string, start: number): number {
  let depth = 0;
  let q: string | null = null;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
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

/** 表达式 effect 绑定：求值（track 依赖）→ 变化时执行 write；求值失败渲染 ATR 错误卡而非抛穿白屏。
 * F-5：返回 dispose 并登记进当前受控重建的 cleanup 集（分支切换/行移除时随之析构，
 * 不再对已脱离节点写入——泄漏修复红检见 tests/f5-kernel.test.ts 红检①）。 */
function bindExpr(expr: string, scope: Record<string, unknown>, write: (v: unknown) => void): () => void {
  const dispose = $effect(() => {
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
  captureCleanup(dispose);
  return dispose;
}

/* ---- F-5 effect 所有权：分支/行级析构 ----------------------------------------
 * 每次「受控重建」（{#if} 换支 / {#each} 无 key 全清 / keyed 行移除）期间创建的 effect
 * 与嵌套组件实例归属本次重建的 cleanup 集；下次重建或上级析构时逐个 dispose。
 * 与 HMR __effectSink 正交：HMR 管「实例级」交换回收，这里管「亚实例级」分支回收。
 * 双重 dispose 安全（$effect dispose 幂等：alive 翻转 + 订阅清理各执行一次）。
 */
const teardownStack: Array<Array<() => void>> = [];
function captureCleanup(dispose: () => void): void {
  const top = teardownStack[teardownStack.length - 1];
  if (top) top.push(dispose);
}
function runCleanup(set: Array<() => void>): void {
  for (const d of [...set].reverse()) {
    try {
      d();
    } catch {
      /* 单个 dispose 抛错不阻断整体回收 */
    }
  }
  set.length = 0;
}

/* ---- F-5 响应式 props（组件组合语义修订，锐评红检②的修复）----
 * 动态属性 = prop 信号 + getter：子组件 `props.title` 语法不变，
 * 读属性即读信号（getter 内 .value 触发 track ⇒ 子组件 effect 自动追踪）；
 * 父侧 effect 求值表达式回写信号（创建即归属实例/分支两级回收）。
 * 诚实边界：组件函数体内对 props 的直接读取仍是一次性（`$state(props.x)` 初始化语义不变，
 * 与主流框架 initial-only 一致）；prop 信号是真实信号——进入依赖图/journal/HMR 按序还原。
 */
function bindProp(expr: string, scope: Record<string, unknown>, target: Record<string, unknown>, name: string): void {
  const sig = $state(__withTracking(() => evalExpr(expr, scope)).result);
  Object.defineProperty(target, name, {
    enumerable: true,
    configurable: true,
    get: () => sig.value,
    set: () => {
      /* props 所有权在父：子组件侧写入静默忽略（props 纯数据红线） */
    },
  });
  captureCleanup(
    $effect(() => {
      sig.value = evalExpr(expr, scope);
    }),
  );
}

/** 契约校验的免追踪包裹：校验读取 props getter 不得把 prop 信号追进外层重建 effect
 *（否则任何 prop 变化都会无谓地触发分支重选） */
function validateProps(
  schema: unknown,
  props: Record<string, unknown>,
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: import("./contract.ts").AtrError },
): { ok: boolean; error?: import("./contract.ts").AtrError } {
  return __withTracking(() => validate(schema, props)).result;
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
  // P0-5 HMR：栈式创建收集——本次 render 新建的 $state 与 $effect 归属本实例（嵌套 mount 各自接管）
  const collected: Signal[] = [];
  const collectedEffects: Array<() => void> = [];
  const prevSink = __creationSink.fn;
  __creationSink.fn = (s) => collected.push(s);
  const prevEffectSink = __effectSink.fn;
  __effectSink.fn = (d) => collectedEffects.push(d);
  mountDepth++;
  let root!: HTMLElement;
  try {
    const tpl = def.render(props as never) ?? { raw: "", scope: {} };
    const scope = { ...(tpl.scope ?? {}), props };
    const file = `components/${def.name}.atr.ts`;
    // P0-2③：已编译模板按 raw 精确命中 → 完全跳过 parseTemplate（该组件运行时零 tokenize）。
    // 结构构建与 effect 接线由生成代码静态完成；运行时能力经 ctx.rt 注入（__compiledRT），
    // 与解释器同源同函数 ⇒ 「编译路径 ≡ 解释器路径」（golden DOM diff 见 tests/codegen.test.ts）。
    const compiled = compiledByRaw.get(tpl.raw);
    let frag: DocumentFragment;
    if (compiled) {
      for (const css of compiled.styles ?? []) injectScopedStyle(def.name, css, file);
      frag = compiled.program({ scope, registry, validate, file, componentName: def.name, rt: __compiledRT });
    } else {
      const styleMatch = /<style(?:\s+scoped)?\s*>([\s\S]*?)<\/style>/i.exec(tpl.raw);
      if (styleMatch) injectScopedStyle(def.name, styleMatch[1], file);
      frag = renderNodes(parseTemplate(tpl.raw), scope, registry, validate, file, def.name);
    }
    root = document.createElement("div");
    root.className = `atr-root atr-scope-${def.name}`;
    if (scopeClasses.has(def.name)) root.classList.add(scopeClasses.get(def.name)!);
    root.appendChild(frag);
    container.appendChild(root);
  } finally {
    __creationSink.fn = prevSink;
    __effectSink.fn = prevEffectSink;
    mountDepth--;
  }
  const inst: LiveInstance = {
    defName: def.name,
    container,
    root,
    props,
    validate,
    registry,
    signals: collected,
    effects: collectedEffects,
    nested: mountDepth >= 1, // 记录时外层尚未自减：≥2 即嵌套挂载
  };
  liveInstances.add(inst);
  // F-5：嵌套实例并入当前受控重建的 cleanup 集——分支切换/行移除时整实例随之析构
  //（实例级 effects dispose + 摘树 + 信号注销），不再等 HMR 的 reap 兜底。
  captureCleanup(() => {
    disposeInstance(inst);
    liveInstances.delete(inst);
  });
  return root;
}

/* ---- P0-5 HMR 热交换：保值重挂载 --------------------------------------
 * dev 插件给 *.atr.ts 注入 import.meta.hot.accept → 新模块重注册组件后调
 * window.__ATELIER_HMR_REMOUNT__()：对所有顶层活实例「快照信号值 → 卸旧树 →
 * 用新 def 重挂载 → 按创建序还原信号值」。按序还原是启发式（模板结构大改可能
 * 错位——多出的新信号保持初值，文档已标注）。已知边界（诚实标注）：
 *   · 模板结构大改时按序还原可能错位（多出的新信号保持初值）——P1-4 处置：保留为已文档化启发式
 *   · store 旧 checkpoint 引用被换信号，跨交换的 timeTravel 不回落到新信号——保留为已文档化边界
 *   （第三边界"旧 effects 不 dispose"已由 __effectSink + disposeInstance 关闭，P1-4）
 */
type LiveInstance = {
  defName: string;
  container: Element;
  root: HTMLElement;
  props: Record<string, unknown>;
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError };
  registry: ComponentRegistry;
  signals: Signal[];
  effects: Array<() => void>;
  nested: boolean;
};
const liveInstances = new Set<LiveInstance>();
let mountDepth = 0;

/** 实例级回收：dispose 本实例全部 effects（关闭订阅泄漏）→ 摘树 → 注销信号登记 */
function disposeInstance(inst: LiveInstance): void {
  for (const d of inst.effects) {
    try {
      d();
    } catch {
      /* dispose 自身抛错不阻断回收 */
    }
  }
  inst.root.remove();
  for (const s of inst.signals) store._signals.delete(s);
}

/** 回收断连实例（父树已移除的嵌套实例 / 上轮遗留）：immediate 而非等下一轮交换 */
function reapDisconnected(): void {
  for (const inst of [...liveInstances]) {
    if (inst.root.isConnected) continue;
    disposeInstance(inst);
    liveInstances.delete(inst);
  }
}

function hmrSwap(): number {
  reapDisconnected(); // 先清陈旧（含上轮遗留），并处置其 effects
  let swapped = 0;
  for (const inst of [...liveInstances]) {
    if (inst.nested) continue;
    const values = inst.signals.map((s) => s.get());
    disposeInstance(inst); // 旧 effects 逐个 dispose + 摘除旧树 + 注销信号
    liveInstances.delete(inst);
    reapDisconnected(); // 顶层树移除后其嵌套实例随即断连——立即回收
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
        for (const a of node.attrs) {
          if (a.dynamic) bindProp(a.value, scope, props, a.name); // F-5：动态属性=响应式 prop（getter+父侧回写 effect）
          else props[a.name] = a.value;
        }
        const v = validateProps(def.schema, props, validate);
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
      let branchCleanup: Array<() => void> | null = null;
      captureCleanup(
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
            // F-5：旧分支先整体析构（effects/嵌套实例），再清 DOM——顺序保证析构期间写入无目标
            if (branchCleanup) runCleanup(branchCleanup);
            const set: Array<() => void> = [];
            branchCleanup = set;
            teardownStack.push(set);
            try {
              // 注意：不能对 appendChild 之后的 DocumentFragment 调 remove()——
              // appendChild 会把 fragment 的子节点搬进 DOM 并清空 fragment，remove 落空导致旧分支残留。
              // 与 each 分支一致：逐个清空 anchor 子节点再挂新分支。
              while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
              if (chosen >= 0) {
                const frag = renderNodes(node.blocks[chosen].children, scope, registry, validate, file, componentName);
                anchor.appendChild(frag);
              }
            } finally {
              teardownStack.pop();
            }
            currentBlock = chosen;
          }
        }),
      );
      return anchor;
    }
    case "each": {
      const host = document.createElement("span");
      host.style.display = "contents";
      if (node.keyExpr) {
        // P1-1 keyed reconcile：按 by-key 复用已渲染子树（移动 = appendChild 重排，活动 effect 不丢）；
        // 语义边界：key 稳定的项其内容更新必须走 $state 信号（H1）——纯非信号数据变化不会触发该项重渲。
        // F-5：每行自带 cleanup 集——行移除时该行 effect/嵌套实例随之析构。
        const live = new Map<string, HTMLElement>();
        const rowCleanups = new Map<string, Array<() => void>>();
        captureCleanup(
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
                const set: Array<() => void> = [];
                teardownStack.push(set);
                try {
                  box.appendChild(renderNodes(node.children, { ...scope, [node.item]: item, [node.index]: i }, registry, validate, file, componentName));
                } finally {
                  teardownStack.pop();
                }
                rowCleanups.set(k, set);
                el = box;
                live.set(k, el);
              }
              host.appendChild(el); // 相同顺序时为 no-op；乱序时即完成重排
            });
            for (const [k, el] of [...live]) {
              if (!nextKeys.has(k)) {
                el.remove();
                const set = rowCleanups.get(k);
                if (set) runCleanup(set);
                rowCleanups.delete(k);
              }
            }
          }),
        );
        return host;
      }
      // 旧语义（无 by）：全清重建。F-5：重建前先析构上一轮全部行的 cleanup。
      let rowsCleanup: Array<() => void> = [];
      captureCleanup(
        $effect(() => {
          const arr = (evalExpr(node.expr, scope) ?? []) as unknown[];
          runCleanup(rowsCleanup);
          rowsCleanup = [];
          teardownStack.push(rowsCleanup);
          try {
            while (host.firstChild) host.removeChild(host.firstChild);
            arr.forEach((item, i) => {
              const childScope = { ...scope, [node.item]: item, [node.index]: i };
              host.appendChild(renderNodes(node.children, childScope, registry, validate, file, componentName));
            });
          } finally {
            teardownStack.pop();
          }
        }),
      );
      return host;
    }
  }
}

function booly(v: unknown): boolean {
  return Boolean(v);
}

/* ---- P0-2③ 编译产物（compiler/codegen.mjs stage ③ 输出）注册与运行时依赖面 ---- */

export type CompiledTemplate = {
  name: string;
  raw: string;
  styles?: string[];
  program: (ctx: {
    scope: Record<string, unknown>;
    registry: ComponentRegistry;
    validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError };
    file: string;
    componentName: string;
    rt: typeof __compiledRT;
  }) => DocumentFragment;
};

const compiledByRaw = new Map<string, CompiledTemplate>();

/** 注册编译产物。接受 codegen 模块形态：`{compiled}` / `{compiledList}` / 数组 / 单条。
 * 按 raw 精确匹配——P0-2② 单一来源（dump 的树 = 解释器的树）⇒ raw 相同即模板相同，无歧义。 */
export function registerCompiled(
  mod:
    | { compiled?: CompiledTemplate; compiledList?: CompiledTemplate[] }
    | CompiledTemplate
    | CompiledTemplate[]
): void {
  const list: CompiledTemplate[] = Array.isArray(mod)
    ? mod
    : ((mod as { compiledList?: CompiledTemplate[] }).compiledList ??
      [(mod as { compiled?: CompiledTemplate }).compiled ?? (mod as CompiledTemplate)]);
  for (const c of list) {
    if (c && typeof c.raw === "string" && typeof c.program === "function") {
      compiledByRaw.set(c.raw, c);
    }
  }
}

/** 测试/审计用：当前注册的编译模板条数 */
export function compiledTemplateCount(): number {
  return compiledByRaw.size;
}

/** P0-2③：编译产物的运行时依赖面——生成的 program 不 import 任何运行时模块（产物与
 * runtime 路径/打包布局零耦合），全部能力经 ctx.rt 注入；实现即本文件解释器同源函数，
 * 保证「编译路径 ≡ 解释器路径」。 */
export const __compiledRT = {
  $effect,
  evalExpr,
  stringify,
  booly,
  bindExpr,
  recordRuntimeError,
  mountComponent,
  bindProp, // F-5：动态属性 = 响应式 prop（编译路径与解释器同源同函数）
  validateProps, // F-5：契约校验免追踪包裹（同上）
};
