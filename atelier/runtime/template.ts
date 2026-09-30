/**
 * Atelier prototype — 类 HTML 模板解释器（决策 1/8 雏形）。
 * 支持子集：{expr} 文本插值（含对象/数组字面量 {{a: x.value}} 与 {a} 简写，F-4 第二期）
 *         / {#if}{:else if}{:else}{/if} / {#each arr as item, idx [by key]}
 *         / 动态属性 attr={expr} / on:click={handler} 事件（.prevent/.stop 修饰 v1，决策 25 后置候选 ATR-326） / bind:value·bind:checked 双向绑定 + bind:group radio group（决策 25 v1.2，ATR-324/325/327 渲染期校验）
 *         / HTML void 元素（<br>/<img>/<input>… 无闭合）
 *         / <style scoped>（token 校验）/ 子组件 <ModelCard ... />（大写标签）。
 * 解析期显式拒绝（ATR-101）：未闭合的 {#if}/{#each}/元素标签、错位与游离闭合标签——不静默吞掉
 * （编译路径构建期即抛，解释器路径渲染为可行动错误卡）。字面量花括号（非表达式候选）与字面量
 * <（< 后非标签名，HTML 同款语义）原样并入文本，不再静默丢弃。诚实边界：残缺 "</"（无标签名）
 * 拒绝；表达式不支持箭头函数/赋值（ATR-301）。
 * 完整版差异：模板由编译器解析为组件 IR 并闭包捕获作用域（本原型为运行时解析 + 显式 .locals 注入）。
 */

import { $effect, $effectStatic, $state, store, __creationSink, __effectSink, __recordLastError, __withTracking, type Signal } from "./core.ts";
import { booly, evalExpr, exprRootIdents } from "./expr.ts";
// 决策 26 v1 留位兑现：registerCompiled 需把编译产物携带的 schema 喂进提取 sink（兜底求值）
// 并回填既有 registry 条目（后于 component() 注入的时序）。分层核查（无真实循环）：
// component.ts 对本文件只有 import type（component.ts:7，编译期擦除，无运行时边），
// 且 component.ts 不被 core.ts/expr.ts 引用 ⇒ 本文件 → component.ts 是单向运行时依赖，
// 模块求值无环（registry 绑定仅用于函数体内，非模块求值期）。
import { registerExtractedSchemas, registry as globalRegistry } from "./component.ts";

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
export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlTemplateWithScope {
  // P-A P2-R4：html`` 只支持标签模板形态，两种误用一律四段式响亮拒绝（不静默哲学，字面量
  // { / 字面量 < 同款）：
  //   ① values 非空 = 借 apply/call 展开的标签形态参数——rest 值从未进入模板（修复前被旧
  //      签名静默丢弃 ⇒ ${} 插值无声消失）；
  //   ② strings 无 Array 形态的 .raw = 模板字面量先求值成普通字符串才传进来（修复前在
  //      .raw.join 上抛裸 TypeError，无 code 无 fix 不可诊断）——插值已发生在 html 之外。
  // 动态值正路：模板内 {expr} 插值，或 .locals({...}) 注入作用域。
  if (values.length > 0 || !Array.isArray((strings as { raw?: unknown } | undefined)?.raw)) {
    throw {
      code: "ATR-101",
      message: "html`` 收到非标签模板形态的调用——${} 插值不会进入模板（作为普通函数调用，或参数经 apply/call 转发）",
      context: {},
      fix: "用标签模板形态：html`<p>{n.value}</p>`；动态值经模板 {expr} 插值或 .locals({ name: value }) 注入作用域，不要用 ${} 拼进模板字符串",
    } as AtrError;
  }
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
  context: { file?: string; component?: string; hints?: string[]; attr?: string; expr?: string };
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
type AstNode = TemplateNode;

class Parser {
  src: string;
  pos = 0;
  constructor(src: string) {
    this.src = src;
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  /** < 是否开启标记构造（注释 <!-- / 闭合 </ / 开标签 <[A-Za-z]）——真标记交回主循环，
   * 其余 < 为字面量文本（P-A P1-3）。闭合头一律交回：残缺闭合由主循环显式拒绝（ATR-101 保持）。 */
  private tagOpensAt(i: number): boolean {
    if (this.src.startsWith("<!--", i) || this.src.startsWith("</", i)) return true;
    return /^<[A-Za-z][\w-]*/.test(this.src.slice(i));
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
  parseContent(expectedClose?: string): AstNode[] {
    const nodes: AstNode[] = [];
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
        if (tagMatch) {
          nodes.push(this.parseElement(tagMatch[1]));
          continue;
        }
        // P-A P1-3：字面量 <（< 后非标签名，如 "a < b" / "x <= y"）——不再静默丢弃，对齐
        // HTML「< 后非标签名即文本」语义，落入下方文本扫描按字面量并入（扫描器对非标记头的
        // < 同样消费，两分支不会互相踢皮球死循环）。字面量 { 同款问题此前已修（见文本分支注释），
        // < 是漏网面；真标记头（注释/闭合/开标签）仍由上方分支处理。
      }
      if (c === "{") {
        if (this.blockStartsAt(this.pos)) break; // 块终止符，交给所属块处理
        const mIf = /^\{#if\s+([^}]+)\}/.exec(rest);
        if (mIf) {
          this.pos += mIf[0].length;
          const blocks: { test: string | null; children: AstNode[] }[] = [];
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
      // 文本：字面量 { 原样并入（此前被静默丢弃）；字面量 < 同款（P-A P1-3）；块语法与表达式候选交回主循环
      let j = this.pos;
      let buf = "";
      while (j < this.src.length) {
        const ch = this.src[j];
        if (ch === "<") {
          // 标记头（注释/闭合/开标签）交回主循环；其余 < 按字面量并入（P-A P1-3）
          if (this.tagOpensAt(j)) break;
          buf += ch;
          j++;
          continue;
        }
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
  parseElement(tag: string): AstNode {
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
      // 属性名含点号（决策 25 后置候选 M9 事件修饰 v1）：on: 的修饰符段是 attr 全名的
      // 组成部分——on:click.prevent.stop 整体落单个 attr（契约载体 = attr 全名）。旧正则
      // 不含 `.` 会把修饰符段切成碎片 attr（on:click / prevent / stop 各自成段、handler
      // 落在末段）：监听器对空表达式求值、修饰符静默失效 + 垃圾 attr（红检取证见
      // tests/event-modifiers.test.ts 头注释）。点号 attr 统一单一名字文法：bind:x.y /
      // x.y={z} 一类旧产物本是两段碎片（无合法语义），单名化后由各指令自身校验响亮报错
      // （bind: 未知指令 → ATR-324，卡文随真实名字指认，不再随文法碎片误指）。
      const am = /^([A-Za-z_][\w.:-]*)/.exec(this.src.slice(i));
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
const parseCache = new Map<string, AstNode[]>();
/** exported for the compiler (P0-2② AST dump): one parser, one truth — the dump and the
 * runtime interpreter MUST see the same tree for the same template string. */
export function parseTemplate(src: string): TemplateNode[] {
  let ast = parseCache.get(src);
  if (!ast) {
    ast = new Parser(src).parseContent();
    if (parseCache.size >= 500) parseCache.clear();
    parseCache.set(src, ast);
  }
  return ast;
}

/** R-D4a（ATR-352）：插值/属性值直接收到信号对象（忘写 .value 的典型笔误）——修复前静默渲染
 * 信号内部字段 JSON（_subs/_kind/value），不抛错也不警示。dev 一次性警示（每信号对象一次，
 * WeakSet 去重防重渲刷屏）；prod 剥离（双旗守卫，ATR-328 同款形态）。渲染语义逐字不变
 * （仍 JSON.stringify——「不静默」不等于「改语义」，既有产物/快照不受扰）。信号形状判定与
 * exactStaticDeps/checkBindCore 同款（_kind 字符串 + _subs Set），不复用 boolean 属性清单。 */
const stringifyComplained = new WeakSet<object>();
function atrSignalLeak(): AtrError {
  return {
    code: "ATR-352",
    message: "插值/属性值收到一个信号对象（常见于忘写 .value）——信号被渲染成内部字段 JSON",
    context: {},
    fix: "在模板表达式里补 .value（如 {sig.value}）；确要渲染对象就取其字段（如 {sig.value.name}）。若本意就是调试查看内部结构，请改用 console.log",
  };
}
function warnSignalStringify(v: object): void {
  if (BUILD_PROD || dynProd()) return; // prod 剥离（双旗守卫，ATR-328 同款形态）
  const probe = v as { _kind?: unknown; _subs?: unknown };
  if (typeof probe._kind !== "string" || !(probe._subs instanceof Set)) return;
  if (stringifyComplained.has(v)) return;
  stringifyComplained.add(v);
  recordRuntimeError(atrSignalLeak());
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    warnSignalStringify(v);
    return JSON.stringify(v, null, 0);
  }
  return String(v);
}

/* ---- P1-2：HTML 布尔属性存在性语义 ----------------------------------------
 * 真浏览器中布尔属性（disabled/checked/hidden/…）存在即真、与值无关——setAttribute(name,
 * "false") 同样生效。修复前动态属性一律 setAttribute(name, stringify(v))，false → "false"
 * → 属性落在 ⇒ disabled={canSubmit} 在真假两态下元素都被禁用（语义反转；红检见
 * tests/bool-attrs.test.ts）。修法：已知布尔属性取值 false → removeAttribute（null/undefined
 * 既有语义不变）；dev 态收到字符串化 "false"/"0" 等可疑值给 ATR-328 警示（存在即真照常
 * 生效，不静默）。诚实边界：非布尔属性字符串行为逐字不变（data-x={false} 仍落 "false"）；
 * 布尔属性 true 仍落 "true"（存在即真，与空串形态等价）；空串不警示（disabled={c ? "" : null}
 * 是合法的存在性写法）。测试配套：dom-shim 升级 hasAttribute + 布尔属性反射（同清单复刻）。
 */
const BOOLEAN_ATTRS = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop",
  "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly",
  "required", "reversed", "selected",
]);

/** ATR-328 四段式：已知布尔属性收到字符串化假值——存在即真 ⇒ 十有八九语义反转。 */
function atrBoolAttrSuspicious(name: string, v: unknown): AtrError {
  return {
    code: "ATR-328",
    message: `布尔属性 ${name} 收到字符串化假值 "${stringify(v)}"（HTML 布尔属性存在即真，属性落在即生效）`,
    context: { attr: name },
    fix: `改传布尔值：${name}={false} 渲染为属性不存在；字符串 "false"/"0" 不会取消属性——请改为布尔表达式（如 ${name}={!!cond}）`,
  };
}

/** 表达式 effect 绑定：求值（track 依赖）→ 变化时执行 write；求值失败渲染 ATR 错误卡而非抛穿白屏。
 * onError（P-A P2-R3）：属性挂点的错误态出口——缺省时错误哨兵写入 write（prod 空串 / dev ⚠ 文案，
 * 文本插值语义）；传入时改为执行 onError（bindAttr 传 removeAttribute——错误哨兵不得流入属性：
 * prod setAttribute(name,"") 对 disabled/checked 等 25 项布尔属性存在即真 = 把错误变成永久真值，
 * dev 更把错误文案写成属性值）。
 * F-5：返回 dispose 并登记进当前受控重建的 cleanup 集（分支切换/行移除时随之析构，
 * 不再对已脱离节点写入——泄漏修复红检见 tests/f5-kernel.test.ts 红检①）。
 * F-2 二期：exactness 达标（无函数调用 + 全部根标识符解析为信号）→ $effectStatic 静态预订阅，
 * 免除每次重跑的追踪簿记；否则回退动态追踪（宁慢勿错——判据见 exactStaticDeps）。 */
function bindExpr(expr: string, scope: Record<string, unknown>, write: (v: unknown) => void, onError?: () => void): () => void {
  const run = () => {
    let v: unknown;
    try {
      v = evalExpr(expr, scope);
    } catch (e) {
      const err = e as { code?: string; message?: string; fix?: string };
      recordRuntimeError(err);
      // P-A P2-R3：属性挂点错误走独立出口（错误态摘属性，console/最近错误已记——不静默）
      if (onError) {
        onError();
        return;
      }
      // prod 剥离：无错误卡——空文本占位（console 已记，不静默）
      write((BUILD_PROD || dynProd()) ? "" : `⚠ ${err.code ?? "ATR"} ${err.message ?? String(e)}${err.fix ? ` — fix: ${err.fix}` : ""}`);
      return;
    }
    write(v);
  };
  const staticDeps = exactStaticDeps(expr, scope);
  const dispose = staticDeps ? $effectStatic(run, staticDeps) : $effect(run);
  captureCleanup(dispose);
  return dispose;
}

/** F-2 二期 exactness 判定（保守：不确定 = 回退动态追踪，宁慢勿错）：
 *  ① 无函数调用——函数体内可能隐藏信号读，静态集抓不住（正确性风险，硬拒）；
 *  ② 全部根标识符在 scope 中解析为信号——根非信号（如 props 对象/普通值）时其属性链深处
 *     可能藏着信号读（F-5 的 props getter 即此形态），静态订阅会漏（硬拒）；
 *  ③ 至少一个依赖——零依赖表达式无快路径收益。
 *  短路（&&/||/?:）不拒：静态集 ⊇ 实读集只会良性超订阅（多触发一次重算，输出不变）。 */
function exactStaticDeps(expr: string, scope: Record<string, unknown>): Signal[] | null {
  if (/[\w$]\s*\(/.test(expr)) return null;
  const deps: Signal[] = [];
  for (const id of exprRootIdents(expr)) {
    const v = (scope as Record<string, unknown>)[id];
    const isSignal =
      v !== null && typeof v === "object" && typeof (v as { _kind?: unknown })._kind === "string" && (v as { _subs?: unknown })._subs instanceof Set;
    if (!isSignal) return null;
    deps.push(v as Signal);
  }
  return deps.length > 0 ? deps : null;
}

/* ---- F-5 effect 所有权：分支/行级析构 ----------------------------------------
 * 每次「受控重建」（{#if} 换支 / {#each} 无 key 全清 / keyed 行移除）期间创建的 effect
 * 与嵌套组件实例归属本次重建的 cleanup 集；下次重建或上级析构时逐个 dispose。
 * 与 HMR __effectSink 正交：HMR 管「实例级」交换回收，这里管「亚实例级」分支回收。
 * 双重 dispose 安全（$effect dispose 幂等：alive 翻转 + 订阅清理各执行一次）。
 */
const teardownStack: Array<Array<() => void>> = [];
/** R1-B 支（P1 #9）：mount 窗口期节点级 cleanup 收集槽。F-5 teardownStack 只覆盖受控重建
 * （{#if} 换支/{#each} 行重建）；mount 窗口内 if/each 的节点级收尾（branchCleanup/rowCleanups
 * 处置）此前 captureCleanup 落空（栈空 no-op）⇒ 实例析构只回收 inst.effects（初始渲染 effects），
 * 运行期换支/加行 effects 滞留（HMR swap 后僵尸 effect 仍向脱离节点写入）。
 * mountComponentInner 挂载期置入实例级收集数组（嵌套 mount 栈式恢复），disposeInstance 统一回收。 */
let mountCleanupSink: Array<() => void> | null = null;
function captureCleanup(dispose: () => void): void {
  const top = teardownStack[teardownStack.length - 1];
  if (top) top.push(dispose);
  else if (mountCleanupSink) mountCleanupSink.push(dispose);
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
/** 受控重建期包住一段构建：期间 bindExpr/bindProp/嵌套实例的 captureCleanup 落入 set。
 * codegen（__compiledRT.withTeardown）与解释器（if/each 分支重建）共用同一 teardownStack。 */
function withTeardown<T>(set: Array<() => void>, build: () => T): T {
  teardownStack.push(set);
  try {
    return build();
  } finally {
    teardownStack.pop();
  }
}

/* ---- F-5 响应式 props（组件组合语义修订，锐评红检②的修复）----
 * 动态属性 = prop 信号 + getter：子组件 `props.title` 语法不变，
 * 读属性即读信号（getter 内 .value 触发 track ⇒ 子组件 effect 自动追踪）；
 * 父侧 effect 求值表达式回写信号（创建即归属实例/分支两级回收）。
 * 诚实边界：组件函数体内对 props 的直接读取仍是一次性（`$state(props.x)` 初始化语义不变，
 * 与主流框架 initial-only 一致）；prop 信号是真实信号——进入依赖图/journal，HMR 按
 * 未命名创建序兜底还原（m11 边界②正修复后的既有语义，见 hmrSwap 注释）。
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
  // P1-4：prop 信号随受控重建注销——$state 无条件入 store._signals 且自身无注销途径。
  // 挂载窗口内创建的信号由 __creationSink 收进实例、disposeInstance 统一注销；但 {#if}/{#each}
  // 分支重建发生在 mount 窗口之外（flush 微任务里的 effect 重跑），__creationSink 收不到 ⇒
  // 每次分支切换重建的 prop 信号永久滞留全局集合（红检见 tests/f5-kernel.test.ts P1-4 组：
  // 反复切换 _signals 只涨不降，dev 桥遍历成本随之抬高）。挂进当前受控重建的 cleanup 集，
  // 换支/行移除时随之注销。顶层挂载期 teardownStack 为空 → no-op（该情形由实例注销路径
  // 负责，两路不重复不遗漏——Set.delete 幂等）。
  captureCleanup(() => {
    store._signals.delete(sig);
  });
}

/* ---- F-2 二期 prod 剥离（决策 6「dev 强制 / prod 剥离」）× 决策 27 构建期 DCE ----------
 * 双旗语义（决策 27，任一为真即 prod）：
 *  · BUILD_PROD = 构建期常量：仅 vite build 经 define 注入 `__ATELIER_BUILD_PROD__`="true"；
 *    dev serve/vitest/node 直跑不注 → typeof 守卫得 false（零 ReferenceError）。bare 标识符是
 *    define 可替换的前提——旧读法 globalThis 属性访问 define 匹配不上，勿改回；
 *    `declare const` 纯类型声明，strip-types/esbuild 产物零残留。
 *  · dynProd() = 运行时旗动态读，调用点现读（既有语义逐字保留，prod-strip 等置旗测试与
 *    测试文件 afterAll 复位约定全部兼容）——模块级 init 捕获不得发生，否则测试全数失效。
 * prod 下（任一旗真）：跳过契约校验（ATR-201）与 token 校验（ATR-204），渲染期错误不再生成
 * 可视化错误卡（改记 console，不静默）。dev 专属分支的剥离 = vite build define 折叠 + 分支
 * DCE（决策 27①，浏览器面）；动态旗分支的校验代码仍在包内（服务面语义不变，决策 27②）。
 * 契约语义：prod 放行 = 信任「dev 已强制过」的单源契约（H1），错误卡本就是 dev 专属可视化。
 */
declare const __ATELIER_BUILD_PROD__: boolean | undefined;
const BUILD_PROD = typeof __ATELIER_BUILD_PROD__ !== "undefined" && __ATELIER_BUILD_PROD__ === true;
/** 运行时旗动态读（调用点现读，非 init 捕获）：与旧动态旗语义逐字同源。 */
function dynProd(): boolean {
  return (globalThis as { __ATELIER_PROD__?: boolean }).__ATELIER_PROD__ === true;
}

/** 契约校验的免追踪包裹：校验读取 props getter 不得把 prop 信号追进外层重建 effect
 *（否则任何 prop 变化都会无谓地触发分支重选）；prod 下直接放行（剥离点） */
function validateProps(
  schema: unknown,
  props: Record<string, unknown>,
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: import("./contract.ts").AtrError },
): { ok: boolean; error?: import("./contract.ts").AtrError } {
  if (BUILD_PROD || dynProd()) return { ok: true };
  return __withTracking(() => validate(schema, props)).result;
}

/** P2-1 全局最近错误暴露（dev 面经由桥上报；工具侧可查）。R1-B 支 P1 #15：写入点统一走
 * core.ts __recordLastError 单源 helper/单宿主对象（globalThis）——修复前裸引用 `window`，
 * 非浏览器环境（node 直跑/ssr 预热）错误记录器自身抛 ReferenceError 吞掉原始错误；同文件
 * :1250 的 `typeof window` 守卫先例此处漏配。 */
function recordRuntimeError(e: unknown): void {
  __recordLastError(e);
  console.error("[atelier] render error:", e);
}

/* ---- 决策 25：属性级指令 v1——bind:value / bind:checked 双向绑定 ----------------
 * 糖化形态 = 动态 attr effect（与 bindExpr 同源的下行订阅）+ 元素事件监听回写 sig.value。
 * 解析器零改动：bind:x={expr} 的既有产物 {name:"bind:x", value:expr, dynamic:true} 即契约载体。
 * 目标必须 scope[name] 直解析：evalExpr 读路径会把信号解包成值（expr.ts 求值出口），
 * 表达式路径拿不到信号对象——bind:value={sig.value} 之类的目标在语法层即拒（ATR-324）。
 * 分层：解释器 renderNode 在 createElement 之前先跑 precheckBinds（全量 attrs 可判定 type
 * 细化面），dev 任一失败即错误卡替换整个元素 / prod 记录后跳过失败项照常渲染（ATR-401 同款
 * 分层）；bindTwoWay 自身只校验参数可判定面（语法/信号性/derived/tag 矩阵）——codegen 直调
 * 路径的唯一校验层，同时避免 attrs 循环中 type attr 源序在后时元素上尚未落 type 造成误拒。
 * 无回环论证（决策 25）：程序化 el.value=/el.checked= 不触发 input/change 事件（DOM 规范）→
 * effect 下行与用户上行天然单向（tests/bind-directive.test.ts 钉死）。
 */
/** 已订守卫（ATR-325，v1.2 升级为槽位语义）：键=元素、值=绑定槽→attr 名映射；同槽第二次 bind
 * 不建立第二份订阅。槽 = checked 槽（bind:checked / bind:group 共占——都驱动 checked，双写互斥
 * 属性即序依赖错误）与 value 槽（bind:value）。WeakMap 不阻止元素回收；同元素 bind:value 与
 * bind:checked 属不同槽，合法共存（既有语义保持）。 */
const bindSlots = new WeakMap<object, Map<string, string>>();

function slotOfBind(name: string): string {
  return name === "bind:value" ? "value" : "checked";
}

function atrBindDuplicate(name: string): AtrError {
  return {
    code: "ATR-325",
    message: `bind: 重复绑定：同元素的 ${name} 已订阅`,
    context: { attr: name },
    fix: `移除重复的 ${name}——同元素 bind:value 与 bind:checked 属不同槽可共存；同槽只订阅一次`,
  };
}

/** 跨名同槽（v1.2）：bind:group 与 bind:checked 同元素同抢 checked 槽——点名的两个 attr。 */
function atrBindSlotConflict(prev: string, name: string): AtrError {
  return {
    code: "ATR-325",
    message: `bind: 重复绑定：同元素的 ${prev} 与 ${name} 同占 checked 槽（双写 checked）`,
    context: { attr: name },
    fix: `移除其一——${prev} 与 ${name} 都驱动 checked：组选择（radio）用 bind:group，单开关（checkbox）用 bind:checked`,
  };
}

/** 槽位认领（precheckBinds 与 bindTwoWay/bindGroup 双路径同源，判定一致）：同槽第二次认领返回
 * ATR-325（同名重复维持既有文案；跨名同槽点名两个 attr）。 */
function claimBindSlot(el: object, name: string): AtrError | null {
  let slots = bindSlots.get(el);
  if (!slots) {
    slots = new Map();
    bindSlots.set(el, slots);
  }
  const slot = slotOfBind(name);
  const prev = slots.get(slot);
  if (prev !== undefined) return prev === name ? atrBindDuplicate(name) : atrBindSlotConflict(prev, name);
  slots.set(slot, name);
  return null;
}

/** bind: 核心校验（参数可判定面，预检与 bindTwoWay 共用 = 双路径同源）：
 * ① 目标语法 = 单个根标识符；② 目标可写（信号形状判定照抄 exactStaticDeps，derived → ATR-305）；
 * ③ tag 级支持面矩阵。失败返回四段式 AtrError；通过返回 null。 */
function checkBindCore(
  name: string,
  expr: string,
  scope: Record<string, unknown>,
  tagLc: string,
): AtrError | null {
  const target = expr.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(target)) {
    return {
      code: "ATR-324",
      message: `bind: 目标非法（须为单个信号名）：${name}={${expr}}`,
      context: { attr: name, expr },
      fix: "bind: 目标只能是单个信号名（不带 .value、不做属性链）——写 bind:value={text}，而非 bind:value={text.value} 或对象属性链",
    };
  }
  const v = scope[target];
  const isSignal =
    v !== null && typeof v === "object" && typeof (v as { _kind?: unknown })._kind === "string" && (v as { _subs?: unknown })._subs instanceof Set;
  if (!isSignal) {
    return {
      code: "ATR-324",
      message: `bind: 目标不是可写信号：${name}={${target}}`,
      context: { attr: name, expr: target },
      fix: `bind: 回写目标必须是非 derived 信号——用 $state 声明：const ${target} = $state(...)；纯展示值走普通插值 {${target}}`,
    };
  }
  if ((v as { _kind?: string })._kind === "derived") {
    return {
      code: "ATR-305",
      message: "派生信号只读（$derived 由依赖计算）",
      context: { attr: name, expr: target },
      fix: "bind: 目标须为可写 $state 信号——$derived 只读不能作双向回写目标；改绑上游 $state，或经事件处理器写上游信号",
    };
  }
  const matrixFix = "v1 支持面：bind:value × input（文本类）/textarea/select；bind:checked × input[type=checkbox|radio]；bind:group × input[type=radio]（组身份 = value 属性）";
  if (name === "bind:value") {
    if (tagLc !== "input" && tagLc !== "textarea" && tagLc !== "select") {
      return {
        code: "ATR-324",
        message: `bind: 组合不在 v1 支持面：${name} 于 <${tagLc}>`,
        context: { attr: name, expr: target },
        fix: matrixFix,
      };
    }
  } else if (name === "bind:checked") {
    if (tagLc !== "input") {
      return {
        code: "ATR-324",
        message: `bind: 组合不在 v1 支持面：${name} 于 <${tagLc}>`,
        context: { attr: name, expr: target },
        fix: matrixFix,
      };
    }
  } else if (name === "bind:group") {
    // 决策 25 v1.2：radio group。tag 级矩阵只关 input；radio 细化归 checkBindTypeRefinement
    //（与 bind:checked 同款边界——bindTwoWay/bindGroup 无 attrs 视野，避免 attr 源序误拒）。
    if (tagLc !== "input") {
      return {
        code: "ATR-324",
        message: `bind: 组合不在 v1 支持面：${name} 于 <${tagLc}>`,
        context: { attr: name, expr: target },
        fix: matrixFix,
      };
    }
  } else {
    return {
      code: "ATR-324",
      message: `bind: 未知属性指令：${name}`,
      context: { attr: name },
      fix: "v1 支持 bind:value、bind:checked 与 bind:group；元素事件用 on: 前缀（如 on:click）",
    };
  }
  return null;
}

/** bind: type 细化面（attrs 可判定，仅解释器预检跑——bindTwoWay 无 attrs 视野）：
 * input 须看 type attr——value 拒已知 checkbox/radio（checkbox/radio 用 checked）；
 * checked 要求静态 type=checkbox|radio：type 缺省（缺省即 text）或动态 type={}（v1 不追）
 * 均按未知保守拒绝——checked 绑上去必错，宁拒不漏。 */
function checkBindTypeRefinement(name: string, tagLc: string, inputType: string | null): AtrError | null {
  if (tagLc !== "input") return null; // 细化面只关 input；tag 级矩阵由 checkBindCore 把关
  const matrixFix = "v1 支持面：bind:value × input（文本类）/textarea/select；bind:checked × input[type=checkbox|radio]；bind:group × input[type=radio]（组身份 = value 属性）";
  const isCheckboxLike = inputType === "checkbox" || inputType === "radio";
  if (name === "bind:value" && isCheckboxLike) {
    return {
      code: "ATR-324",
      message: `bind: 组合不在 v1 支持面：bind:value 于 <input[type=${inputType}]>（checkbox/radio 用 checked）`,
      context: { attr: name },
      fix: matrixFix,
    };
  }
  if (name === "bind:checked" && !isCheckboxLike) {
    return {
      code: "ATR-324",
      message: `bind: 组合不在 v1 支持面：bind:checked 于 <input>${inputType === null ? "（缺静态 type）" : `[type=${inputType}]`}`,
      context: { attr: name },
      fix: matrixFix,
    };
  }
  if (name === "bind:group" && inputType !== "radio") {
    // v1.2：radio group——type 缺省（缺省即 text）/动态 type={}/其他 type 均按未知保守拒绝（bind:checked 同款宁拒不漏）
    return {
      code: "ATR-324",
      message: `bind: 组合不在 v1 支持面：bind:group 于 <input>${inputType === null ? "（缺静态 type）" : `[type=${inputType}]`}（radio group 用 type=radio）`,
      context: { attr: name },
      fix: matrixFix,
    };
  }
  return null;
}

/** bind: attrs 预检（决策 25 步骤 1-4，解释器 createElement 之前跑）：逐条 bind: 校验
 * （checkBindCore + type 细化面）+ 同元素同槽去重（ATR-325 记后到者——v1.2 槽位语义：
 * checked 槽 bind:checked/bind:group 共占，跨名同槽即冲突）。bind:group 另查 value 身份键
 * 静态面（ATR-327，仅预检有全量 attrs 视野：缺/动态/空串均拒）。返回失败清单
 * （保 attr 引用供 prod 跳过失败项）；dev 下调用方任取首条渲染错误卡。 */
function precheckBinds(
  node: { tag: string; attrs: Attr[] },
  scope: Record<string, unknown>,
): Array<{ attr: Attr; error: AtrError }> {
  const fails: Array<{ attr: Attr; error: AtrError }> = [];
  const claimed = new Map<string, string>();
  const tagLc = node.tag.toLowerCase();
  // type 解析：仅认静态 type attr；动态 type={} v1 不追（按未知保守处理，见细化面注释）
  const typeAttr = node.attrs.find((x) => x.name.toLowerCase() === "type" && !x.dynamic);
  const inputType = typeAttr ? typeAttr.value.toLowerCase() : null;
  for (const a of node.attrs) {
    if (!a.name.startsWith("bind:")) continue;
    let error: AtrError | null;
    const slot = slotOfBind(a.name);
    const prev = claimed.get(slot);
    if (prev !== undefined) {
      error = prev === a.name ? atrBindDuplicate(a.name) : atrBindSlotConflict(prev, a.name);
    } else {
      claimed.set(slot, a.name);
      error = checkBindCore(a.name, a.value, scope, tagLc) ?? checkBindTypeRefinement(a.name, tagLc, inputType);
    }
    if (!error && a.name === "bind:group") {
      // ATR-327 静态面：身份键 = 静态非空 value 属性（动态 value={} 与空串同拒——组身份不可判定）
      const valueAttr = node.attrs.find((x) => x.name.toLowerCase() === "value" && !x.dynamic);
      if (!valueAttr || valueAttr.value.trim() === "") error = atrBindGroupMissingKey(a.name, a.value);
    }
    if (error) fails.push({ attr: a, error });
  }
  return fails;
}

/** 决策 25 单点：bind:value / bind:checked 双向绑定。返回 dispose（$effect dispose +
 * removeEventListener），并 captureCleanup 纳入当前受控重建的 cleanup 集（F-5 teardown：
 * 换支/行移除随之析构，与 bindExpr 同款）。codegen 面经 __compiledRT 注入（产物零 import）。
 * 错误契约：校验失败（核心面 + WeakMap 重复守卫）→ recordRuntimeError 后 dev 抛出（调用方 /
 * 组件错误边界渲染错误卡）、prod 返回 noop dispose（不建订阅、不静默）——解释器路径被
 * precheckBinds 前置拦截永不触达（校验函数同源，判定一致）。 */
function bindTwoWay(
  el: HTMLElement,
  name: string,
  expr: string,
  scope: Record<string, unknown>,
  tag: string,
): () => void {
  const fail = (err: AtrError): (() => void) => {
    recordRuntimeError(err);
    if (!(BUILD_PROD || dynProd())) throw err;
    return () => {}; // prod：元素照常语义，跳过该 bind: 绑定
  };
  const err = checkBindCore(name, expr, scope, tag.toLowerCase());
  if (err) return fail(err);
  const slotErr = claimBindSlot(el, name);
  if (slotErr) return fail(slotErr);
  const sig = scope[expr.trim()] as Signal;
  const isChecked = name === "bind:checked";
  const io = el as unknown as { value: string; checked: boolean };
  // 正向下行：信号 → 元素。首跑即完成初始同步；value 不变不写（防光标跳动），
  // checked 恒写（布尔无光标语义）。程序化赋值不触发事件（DOM 规范）= 无回环。
  const writeValue = (): void => {
    const s = stringify(sig.value);
    if (io.value !== s) io.value = s;
  };
  // P-A P2-R1：bind:value × <select> 初始选中——$effect 首跑同步执行而 bindTwoWay 在 attrs
  // 循环内被调，option 子节点要等 attrs 全部落定后才 append：首跑写 select.value 时无可匹配
  // option ⇒ 初始选中静默丢失（bindGroup 的同类时序问题 P1-3 已修，本处漏套；dom-shim 无
  // option 派生语义时原理上不可见）。仿 bindGroup 先例：下行 effect 延至微任务定版（mount
  // 全同步完成 ⇒ 首个微任务时点全部 option 已落）；input/textarea 无子节点时序问题，保持
  // 同步首跑。间隙无丢失：微任务前的信号写入会被首跑整读（首跑读当前值）。
  // __effectSink 归属保持（bindGroup 同款瞬时回挂）；disposed 守卫防 dispose 早于微任务。
  const isSelect = name === "bind:value" && tag.toLowerCase() === "select";
  const effectSinkAtCall = __effectSink.fn;
  let disposed = false;
  let disposeEffect: (() => void) | null = null;
  if (isSelect) {
    queueMicrotask(() => {
      if (disposed) return;
      const prevSink = __effectSink.fn;
      __effectSink.fn = effectSinkAtCall;
      try {
        disposeEffect = $effect(writeValue);
      } finally {
        __effectSink.fn = prevSink;
      }
    });
  } else {
    disposeEffect = isChecked
      ? $effect(() => {
          io.checked = booly(sig.value);
        })
      : $effect(writeValue);
  }
  // 反向回写事件（有效组合内由 (attr, tag) 完全决定）：input/textarea → input；
  // select 与 checkbox/radio（bind:checked 仅落 input）→ change。
  const event = name === "bind:value" && tag.toLowerCase() !== "select" ? "input" : "change";
  const handler = () => {
    try {
      sig.value = isChecked ? io.checked : io.value; // 字符串/布尔原样回写，类型转换是用户的事
    } catch (e) {
      recordRuntimeError(e); // belt-and-braces：渲染期校验正常时不会触发（决策 25）
    }
  };
  el.addEventListener(event, handler);
  const dispose = () => {
    disposed = true;
    disposeEffect?.();
    // dom-shim（tests/dom-shim.ts）未实现 removeEventListener——可选调用兼容微 shim 宿主，
    // 真 DOM 全量退订；effect 已先行 dispose，脱离节点不再被下行写（响应正确性不受影响）。
    (el as { removeEventListener?: (type: string, fn: () => void) => void }).removeEventListener?.(event, handler);
  };
  captureCleanup(dispose);
  return dispose;
}

/* ---- 决策 25 v1.2：bind:group——radio group 双向绑定（v1 显式不做清单销账，m10 批） ----
 * attr 语法：bind:group={sig} 挂在 <input type="radio">；解析器零改动（bind:group 落既有产物
 * {name:"bind:group", value:expr, dynamic:true} 即契约载体）。组语义：group = 绑定同一目标信号的
 * 全体 bind:group 元素——上行 change 回写选中项身份键，信号回写经响应式图驱动每个成员的下行
 * effect 重判 checked ⇒ 组内互斥（写 X ⇒ 键≠X 的成员全部取消）；不依赖原生 name 分组（同 name
 * 的原生互斥是 DOM 加成，不依赖也不禁止；不同 name 绑同一信号仍互斥）。
 * 身份键 = 静态 value 属性：缺失/动态 value={}/空串 → ATR-327（预检级——precheckBinds 全量
 * attrs 视野；运行时 belt 面一次性 record，不抛——effect 上下文不可抛，编译路径无预检的兜底
 * 面，诚实边界）。P1-3 时序修正：$effect 首跑是同步的（batched 只作用于重跑），bindGroup 又在
 * attrs 循环内被调用——bind:group 写在 value 之前时首跑读 getAttribute("value") 得 null，记假
 * ATR-327 且 checked 恒 false，初始选中随书写顺序漂移（旧注释"首跑入微任务队列"前提证伪）。
 * 现身份键推迟到微任务时点定版读取（mount 全同步完成 ⇒ 首个微任务时点全部静态 attr 已落），
 * 下行 effect 亦延至该时点创建：首跑即读到定版键，与 attr 发射顺序解耦（详见 bindGroup 内注）。
 * v1 显式不做：checkbox group（数组集合语义）、动态 type/value、组内重复身份键校验
 * （跨元素面；语义确定性保留：checked = (sig.value === 自身键)，重复键会同查）。
 */
/** ATR-327 四段式：bind:group 的 radio 组内身份键缺失。 */
function atrBindGroupMissingKey(name: string, expr: string): AtrError {
  return {
    code: "ATR-327",
    message: `bind:group：radio 缺 value 属性（组内身份键缺失）：${name}={${expr}}`,
    context: { attr: name, expr },
    fix: "为组内每个 radio 补静态 value 属性——bind:group 的组身份 = value 属性值（动态 value={} v1 不支持）",
  };
}

/** 决策 25 v1.2 单点：bind:group radio group。签名/生命周期/错误契约与 bindTwoWay 同款
 * （dispose = $effect dispose + removeEventListener + captureCleanup 随 F-5 析构链；codegen 面
 * 经 __compiledRT 注入，产物零 import）。错误契约：checkBindCore / 槽位守卫失败 →
 * recordRuntimeError 后 dev 抛出 / prod 返回 noop dispose（bindTwoWay fail() 同款）——解释器
 * 路径被 precheckBinds 前置拦截永不触达（校验函数同源，判定一致）。 */
function bindGroup(
  el: HTMLElement,
  name: string,
  expr: string,
  scope: Record<string, unknown>,
  tag: string,
): () => void {
  const fail = (err: AtrError): (() => void) => {
    recordRuntimeError(err);
    if (!(BUILD_PROD || dynProd())) throw err;
    return () => {}; // prod：元素照常语义，跳过该 bind: 绑定
  };
  const err = checkBindCore(name, expr, scope, tag.toLowerCase());
  if (err) return fail(err);
  const slotErr = claimBindSlot(el, name);
  if (slotErr) return fail(slotErr);
  const sig = scope[expr.trim()] as Signal;
  const io = el as unknown as { checked: boolean };
  let keyComplained = false; // 一次性旗标：空身份键的 belt 记录不随信号变化刷屏
  // P1-3：$effect 首跑是同步的（batched 只作用于重跑）而 bindGroup 在 attrs 循环内被调用——
  // bind:group 写在 value 之前时首跑读 getAttribute("value") 得 null ⇒ 假 ATR-327 + checked
  // 恒 false，初始选中随 attr 书写顺序漂移（红检见 tests/bind-group.test.ts P1-3 组）。
  // 修法：身份键推迟到「attrs 全部落定后」读取——mount 全同步完成 ⇒ 首个微任务时点全部静态
  // attr 已落；下行 effect 延至该时点创建，首跑即读到定版身份键，与发射顺序解耦。间隙无丢失：
  // 微任务前的信号写入会被首跑整读（首跑读当前值）。
  // __effectSink 归属保持：sink 按调用时点捕获（同步调用期 = mount 窗口内），微任务里建
  // effect 时瞬时回挂——effect dispose 仍归入 mount 实例（disposeInstance/HMR 语义不变）；
  // 嵌套在受控重建（{#if}/{#each} 重渲）内时 sink 为外层现场值，captureCleanup 主管析构。
  const effectSinkAtCall = __effectSink.fn;
  let disposed = false;
  let disposeEffect: (() => void) | null = null;
  queueMicrotask(() => {
    if (disposed) return;
    const key = el.getAttribute("value") ?? ""; // 身份键定版读取（此时全部静态 attr 已落）
    const prevSink = __effectSink.fn;
    __effectSink.fn = effectSinkAtCall;
    try {
      disposeEffect = $effect(() => {
        if (!key) {
          if (!keyComplained) {
            keyComplained = true;
            recordRuntimeError(atrBindGroupMissingKey(name, expr));
          }
          io.checked = false; // 空身份键永不匹配——绑定仍成立但不选中（belt 已记录，不静默）
          return;
        }
        io.checked = sig.value === key;
      });
    } finally {
      __effectSink.fn = prevSink;
    }
  });
  // 反向回写：radio → change（radio 组选择事件面，bind:checked 同款）。
  const handler = () => {
    try {
      sig.value = el.getAttribute("value") ?? ""; // 身份键原样回写，类型转换是用户的事
    } catch (e) {
      recordRuntimeError(e); // belt-and-braces：渲染期校验正常时不会触发（决策 25 v1.2）
    }
  };
  el.addEventListener("change", handler);
  const dispose = () => {
    disposed = true;
    disposeEffect?.();
    // dom-shim 未实现 removeEventListener——可选调用兼容微 shim 宿主，真 DOM 全量退订（bindTwoWay 同款口径）。
    (el as { removeEventListener?: (type: string, fn: () => void) => void }).removeEventListener?.("change", handler);
  };
  captureCleanup(dispose);
  return dispose;
}

/* ---- R1-B 支（2026-09-30 架构评审 P1 #5）：动态属性单点 bindAttr ----------------
 * 修复前解释器 dynamic attr 支路内联布尔属性语义（BOOLEAN_ATTRS false → removeAttribute +
 * ATR-328 dev 一次性可疑值警示），而 codegen 同一支路只发射 setAttribute——编译应用对
 * disabled={false} 落 disabled="false"（HTML 布尔属性存在即真 ⇒ 语义反转，元素恒禁用）。
 * 修法对齐 bindTwoWay/bindGroup/bindEvent 先例：语义收进 runtime 单点，进 __compiledRT 注入
 * （产物零 import），解释器与 codegen 同位同构发射 ⇒ 「编译路径 ≡ 解释器路径」在布尔属性面闭合。
 * 签名取 bind 族五参同款形态（tag 末位对齐 bindTwoWay/bindGroup；v1 不消费 tag——布尔属性判定
 * 只看 attr 名，参数位为 bind 族发射形态统一与未来 type 细化面预留）。
 * 语义 = 既有 P1-2 全集逐字迁移：null/undefined → removeAttribute；已知布尔属性 false →
 * removeAttribute；true → setAttribute(name,"true")；dev 态字符串化 "false"/"0" 可疑值一次性
 * 警示（存在即真照常生效）；非布尔属性字符串行为逐字不变。dispose 归属 bindExpr 内部的
 * captureCleanup（F-5 teardown 链），本函数不重复登记。 */
export function bindAttr(
  el: HTMLElement,
  name: string,
  expr: string,
  scope: Record<string, unknown>,
  tag: string,
): () => void {
  void tag; // bind 族五参同款形态位（见上注：v1 不消费）
  const attrName = name;
  const isBoolAttr = BOOLEAN_ATTRS.has(attrName.toLowerCase());
  let suspiciousComplained = false; // 一次性旗标：可疑值警示不随重跑刷屏（bind:group keyComplained 同款）
  return bindExpr(
    expr,
    scope,
    (v) => {
      if (v == null) {
        el.removeAttribute(attrName);
        return;
      }
      if (isBoolAttr) {
        if (v === false) {
          el.removeAttribute(attrName); // 存在即真——false 必须摘除，不能落 "false"
          return;
        }
        if (!(BUILD_PROD || dynProd()) && !suspiciousComplained) {
          const s = stringify(v);
          if (v !== true && (s === "false" || s === "0")) {
            suspiciousComplained = true;
            recordRuntimeError(atrBoolAttrSuspicious(attrName, v));
          }
        }
      }
      el.setAttribute(attrName, stringify(v));
    },
    // P-A P2-R3：错误态摘属性——错误哨兵（prod 空串/dev ⚠ 文案）流入 setAttribute 时，
    // 布尔属性存在即真 ⇒ disabled/checked 等 25 项被错误点亮，dev 更把文案写成属性值。
    () => el.removeAttribute(attrName),
  );
}

/* ---- 决策 25 后置候选（M9）：事件修饰 v1——on: 的 .prevent / .stop ----------------
 * 载体 = attr 全名：on: 后第一段 = 基础事件名，其余按 `.` 切分 = 修饰符序列
 * （on:click.prevent.stop = click + [prevent, stop]，解析产物单 attr {name: 全名,
 * value: handler, dynamic: true}——名字文法含点号是此前提的落实，红检证据见
 * tests/event-modifiers.test.ts 头注释）。语义：事件触发时按书写顺序依次应用修饰符
 * （prevent = e.preventDefault()；stop = e.stopPropagation()），最后调用 handler；
 * handler 语义逐字不变（事件期 evalExpr、typeof function 才调用——与无修饰符 on: 同一形状）。
 * 白名单外修饰符 → ATR-326（四段式，不静默）：解释器路径在 createElement 之前预检
 * （precheckEvents，纯名字语法检查、无需 scope——可与 precheckBinds 同阶段并跑），
 * dev 错误卡整替换 / prod 记录后跳过该 on: attr 照常渲染（ATR-401 同款分层）；
 * bindEvent 共用同一校验单点 parseEventMods（codegen 直调路径的唯一校验层，
 * checkBindCore 先例——双路径同源、判定一致）。
 * 诚实边界：on: 后事件名缺省（on:.prevent）v1 不扩语法校验面——事件名 "" 永不派发，
 * 与既有空 on: 行为一致；.prevent/.stop 对 defaultPrevented/传播序的真 DOM 语义归
 * 浏览器集成面（dom-shim 透传假事件，本实现只钉接线与调用序）。
 */
/** v1 修饰符白名单：prevent = handler 前阻止默认行为；stop = handler 前阻止冒泡。 */
const EVENT_MODIFIERS = new Set(["prevent", "stop"]);

/** on: attr 全名解析 + 修饰符校验（纯名字语法、无需 scope——precheckEvents 与 bindEvent
 * 双路径同源）：通过返回 {event, mods}；白名单外修饰符返回 ATR-326。 */
function parseEventMods(name: string): { event: string; mods: string[] } | AtrError {
  const segs = name.slice(3).split(".");
  const event = segs[0] ?? "";
  for (let i = 1; i < segs.length; i++) {
    if (!EVENT_MODIFIERS.has(segs[i]!)) {
      return {
        code: "ATR-326",
        message: `on: 未知事件修饰符：${name} 中的 .${segs[i]}`,
        context: { attr: name },
        fix: `v1 修饰符白名单仅 prevent（阻止默认行为）与 stop（阻止冒泡）：移除 .${segs[i]}，或在 handler 内显式调用 e.preventDefault() / e.stopPropagation()`,
      };
    }
  }
  return { event, mods: segs.slice(1) };
}

/** on: attrs 预检（解释器 createElement 之前跑，与 precheckBinds 同阶段）：纯名字语法
 * 检查，白名单外修饰符 → ATR-326。返回失败清单（保 attr 引用供 prod 跳过失败项）。 */
function precheckEvents(node: { attrs: Attr[] }): Array<{ attr: Attr; error: AtrError }> {
  const fails: Array<{ attr: Attr; error: AtrError }> = [];
  for (const a of node.attrs) {
    if (!a.name.startsWith("on:")) continue;
    const parsed = parseEventMods(a.name);
    if ("code" in parsed) fails.push({ attr: a, error: parsed });
  }
  return fails;
}

/** 决策 25 后置候选（M9 事件修饰 v1）单点：on:event[.mod…]={handler}。与 bindTwoWay
 * 同款单点形态：返回 dispose（removeEventListener）并 captureCleanup 纳入当前受控重建
 * 的 cleanup 集（F-5 teardown：换支/行移除随之析构）。修饰符应用先于 handler（书写
 * 顺序）；handler 语义逐字不变。错误契约：白名单外修饰符（ATR-326）→ recordRuntimeError
 * 后 dev 抛出 / prod 返回 noop dispose（不挂监听、不静默）——解释器路径被 precheckEvents
 * 前置拦截永不触达（校验单点同源，判定一致）。codegen 面经 __compiledRT 注入（并行分支
 * 发射 rt.bindEvent，产物零 import 不破）。 */
export function bindEvent(
  el: HTMLElement,
  name: string,
  expr: string,
  scope: Record<string, unknown>,
): () => void {
  const parsed = parseEventMods(name);
  if ("code" in parsed) {
    recordRuntimeError(parsed);
    if (!(BUILD_PROD || dynProd())) throw parsed;
    return () => {}; // prod：元素照常语义，跳过该 on: 监听
  }
  const { event, mods } = parsed;
  const handler = (e: Event): void => {
    for (const mod of mods) {
      if (mod === "prevent") e.preventDefault();
      else if (mod === "stop") e.stopPropagation();
    }
    const fn = evalExpr(expr, scope) as ((ev: Event) => void) | undefined;
    if (typeof fn === "function") fn(e);
  };
  el.addEventListener(event, handler);
  const dispose = () => {
    // dom-shim（tests/dom-shim.ts）未实现 removeEventListener——可选调用兼容微 shim 宿主，
    // 真 DOM 全量退订（bindTwoWay dispose 同款口径）。
    (el as { removeEventListener?: (type: string, fn: (e: Event) => void) => void }).removeEventListener?.(event, handler);
  };
  captureCleanup(dispose);
  return dispose;
}

/** —— 渲染上下文 —— */
export type ComponentDef<P = Record<string, unknown>> = {
  name: string;
  render: (props: P) => HtmlTemplate;
  schema?: unknown;
};
export type ComponentRegistry = Map<string, ComponentDef>;

const scopedStyles = new Set<string>();
/** djb2（dev-only 去重键）：修复前 key 只含 css.length，同文件两个等长不同内容样式会碰撞丢失 */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function injectScopedStyle(componentName: string, css: string, file: string): void {
  const key = `${file}:${css.length}:${hashStr(css)}`;
  if (scopedStyles.has(key)) return;
  scopedStyles.add(key);
  // P-A P1-2：作用域以组件为单位——同组件多个 <style scoped> 块复用首个 scope class。
  // 修复前每块新铸 atr-scope-N 且 scopeClasses.set(componentName, …) 同名覆盖（last-wins）：
  // 每块 CSS 都注入 head，但 root 只挂 map 末值 ⇒ 前序块的选择器前缀永不命中 root
  // （R 批修了注入面「全注入」，应用面 last-wins 仍在；红检见 tests/codegen.test.ts P1-2 组）。
  // 复用首类 = 单根单类、改动面最小的修法；作用域类常驻（组件级），无回收面。
  let scopeClass = scopeClasses.get(componentName);
  if (scopeClass === undefined) {
    scopeClass = `atr-scope-${scopeSeq++}`;
    scopeClasses.set(componentName, scopeClass);
  }
  // 作用域前缀跳过 @规则头与 @keyframes 的内部选择器（0% / 50% / from / to），
  // 修复：此前 keyframes 百分比帧被误加前缀导致动画静默失效
  const kfSel = /^(?:[\d.,%\s]+|from(?:\s*,.*)?|to(?:\s*,.*)?)$/;
  const prefixed = css.replace(/([^{}]+)\{/g, (all, sel: string) => {
    const s = sel.trim();
    if (!s || s.startsWith("@") || kfSel.test(s)) return all;
    return `.${scopeClass} ${s} {`;
  });
  // F-2 二期 prod 剥离（MINI）：prod 下跳过 ATR-204 校验——未定义 token 交由 var() 回退，
  // 不再抛错误卡（dev 已强制过；校验代码仍在包内，tree-shake 全量剥离归打包面）。
  if (!(BUILD_PROD || dynProd())) {
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
  }
  const el = document.createElement("style");
  el.textContent = prefixed;
  document.head.appendChild(el);
}
const scopeClasses = new Map<string, string>();
let scopeSeq = 0;

/** R1-B 支（2026-09-30 架构评审 P1 #6）：<style> 块提取单点——解释器 mountComponentInner 与
 * compiler/codegen extractStyles 共用同一正则与同一语义。修复前解释器非全局正则只注入首个块、
 * codegen /g 全注入：同一组件 dev（解释器）/prod（编译产物）渲染样式不一致（codegen 注释自称
 * 「同一正则」不成立）。统一口径 = 全注入（多块各自作用域类，去重键含内容哈希互不吞）。
 * 局部新建正则（无 /g lastIndex 状态残留），调用方安全复用。 */
export function extractStyleBlocks(raw: string): string[] {
  const out: string[] = [];
  const re = /<style(?:\s+scoped)?\s*>([\s\S]*?)<\/style>/gi;
  for (let m; (m = re.exec(raw));) out.push(m[1]);
  return out;
}

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
    // P2-1 组件级错误边界：契约/style/渲染抛出的 ATR 错误渲染为可行动卡片，绝不白屏；
    // prod 剥离：无卡片，空 root + console（不静默，也不白屏）
    const err = e as { code?: string; message?: string; fix?: string };
    recordRuntimeError(e);
    const fallback: HTMLElement = document.createElement("div");
    if (BUILD_PROD || dynProd()) {
      container.appendChild(fallback);
      return fallback;
    }
    fallback.className = "atr-error-card";
    fallback.textContent = `${err.code ?? "ATR-ERR"} ${err.message ?? String(e)} — fix: ${err.fix ?? ""}`;
    container.appendChild(fallback);
    return fallback as unknown as HTMLElement;
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
  // R1-B 支（P1 #9）：实例级节点 cleanup 收集（if/each 节点收尾、挂载期 bind 族 dispose、
  // 嵌套实例析构闭包）+ mount 失败回收旗标
  const nodeCleanups: Array<() => void> = [];
  let mounted = false;
  let tplScope: Record<string, unknown> = {}; // m11 边界②：.locals() scope（信号命名的单一来源）
  const prevSink = __creationSink.fn;
  __creationSink.fn = (s) => collected.push(s);
  const prevEffectSink = __effectSink.fn;
  __effectSink.fn = (d) => collectedEffects.push(d);
  const prevCleanupSink = mountCleanupSink;
  mountCleanupSink = nodeCleanups;
  mountDepth++;
  let root!: HTMLElement;
  try {
    const tpl = def.render(props as never) ?? { raw: "", scope: {} };
    tplScope = tpl.scope ?? {};
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
      // R1-B 支（P1 #6）：<style> 块提取单点（extractStyleBlocks，与 codegen 同源）——全注入
      for (const css of extractStyleBlocks(tpl.raw)) injectScopedStyle(def.name, css, file);
      frag = renderNodes(parseTemplate(tpl.raw), scope, registry, validate, file, def.name);
    }
    root = document.createElement("div");
    root.className = `atr-root atr-scope-${def.name}`;
    if (scopeClasses.has(def.name)) root.classList.add(scopeClasses.get(def.name)!);
    root.appendChild(frag);
    container.appendChild(root);
    mounted = true;
  } finally {
    mountCleanupSink = prevCleanupSink;
    __creationSink.fn = prevSink;
    __effectSink.fn = prevEffectSink;
    mountDepth--;
    if (!mounted) {
      // R1-B 支（P1 #9①）：mount 中途抛错——collected/collectedEffects/nodeCleanups 原是局部
      // 变量，半成品 effects 的 dispose 随栈帧丢失（订阅泄漏 + 僵尸写入）。就地回收：节点收尾
      // （含嵌套实例析构）→ 半成品 effects 逆序 dispose → 挂载期创建信号注销。错误随后由
      // mountComponent 边界照常呈现（ATR 错误卡/prod 空占位），回收对呈现零影响。
      runCleanup(nodeCleanups);
      for (const d of [...collectedEffects].reverse()) {
        try {
          d();
        } catch {
          /* 单个 dispose 抛错不阻断回收（runCleanup 同款口径） */
        }
      }
      for (const s of collected) store._signals.delete(s);
    }
  }
  const inst: LiveInstance = {
    defName: def.name,
    container,
    root,
    props,
    validate,
    registry,
    signals: collected,
    names: buildSignalNames(collected, tplScope),
    effects: collectedEffects,
    nodeCleanups,
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
 * 用新 def 重挂载 → 按名锚定还原信号值」（m11 边界②③正修复）。
 *
 * 信号身份 = .locals() scope 里的变量名：scope 条目与创建沉降收集到的信号是同一
 * 对象身份，运行时免费可得（尾巴原文「正修复需编译器闭包捕获」的前提经实读证伪
 * ——无需编译器参与）。还原规则：
 *   · 同名同实例对 → 按名还原（声明序重排/新增插队均不错位）；
 *   · 改名/删除 → 保守不还原（绝不把旧值写进语义不同的新信号）；
 *   · 未命名信号（prop 信号/未入 locals 的内部信号）→ 维持创建序启发式，
 *     相对序在未命名子集内对齐（P0-5 既有语义，逐字保留）。
 * 边界③同批关闭：checkpoint 快照按名重锚到新信号（快照值原样迁移，跨交换的
 * timeTravel/rollback 回落到新信号、DOM 跟随）；改名/删除的旧条目保留原样
 * （写死信号无害，与未挂载信号的既有口径一致）。
 * （第三边界"旧 effects 不 dispose"已由 __effectSink + disposeInstance 关闭，P1-4）
 */
type LiveInstance = {
  defName: string;
  container: Element;
  root: HTMLElement;
  props: Record<string, unknown>;
  validate: (schema: unknown, data: Record<string, unknown>) => { ok: boolean; error?: AtrError };
  registry: ComponentRegistry;
  signals: Signal[];
  /** m11 边界②：信号 → .locals() scope 变量名（同名取首个；未入 scope 的信号不在表内） */
  names: Map<Signal, string>;
  effects: Array<() => void>;
  /** R1-B 支（P1 #9）：节点级 cleanup 收集（if/each 节点收尾 = 运行期 branchCleanup/rowCleanups
   * 处置、挂载期 bind 族 dispose、嵌套实例析构闭包）——disposeInstance 随实例统一回收 */
  nodeCleanups: Array<() => void>;
  nested: boolean;
};
const liveInstances = new Set<LiveInstance>();
let mountDepth = 0;

/** 实例级回收：节点级收尾（运行期分支/行 cleanup 一并析构，P1 #9②）→ dispose 本实例全部
 * effects（关闭订阅泄漏）→ 摘树 → 注销信号登记。dispose 幂等（$effect dispose alive 翻转 +
 * runCleanup 清空集合，节点收尾内部 disposeIf/disposeEach 与 inst.effects 双重登记安全）。 */
function disposeInstance(inst: LiveInstance): void {
  runCleanup(inst.nodeCleanups);
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

/** R1-B 支（P1 #9③）：公开实例卸载——SPA 路由切换/手动摘除的单实例 HMR reap 等价物
 * （§4.4「无公开 unmount/dispose API——SPA 路由切换即泄漏实例与哨兵订阅」销账）。入参 =
 * mountComponent 时的 container 或其返回的 root；命中执行完整实例回收（disposeInstance：
 * 节点收尾 + effects dispose + 摘树 + 信号注销）并从活实例集合移除，返回 true；未命中返回
 * false（幂等安全，重复调用无副作用）。嵌套实例由节点级收尾级联析构（P1 #9② 同一机制）。 */
export function unmount(el: Element): boolean {
  for (const inst of [...liveInstances]) {
    if (inst.container === el || inst.root === el) {
      disposeInstance(inst);
      liveInstances.delete(inst);
      return true;
    }
  }
  return false;
}

/** 回收断连实例（父树已移除的嵌套实例 / 上轮遗留）：immediate 而非等下一轮交换 */
function reapDisconnected(): void {
  for (const inst of [...liveInstances]) {
    if (inst.root.isConnected) continue;
    disposeInstance(inst);
    liveInstances.delete(inst);
  }
}

/** m11 边界②：信号命名表——scope 条目与收集信号同一对象身份，同名取首个（别名取先见者）。
 * 只认本次 mount 收集到的信号（模块级共享信号不属实例，不在还原面——既有口径不变）。 */
function buildSignalNames(collected: Signal[], scope: Record<string, unknown>): Map<Signal, string> {
  const names = new Map<Signal, string>();
  if (collected.length === 0 || !scope) return names;
  const set = new Set(collected);
  for (const [k, v] of Object.entries(scope)) {
    if (set.has(v as Signal) && !names.has(v as Signal)) names.set(v as Signal, k);
  }
  return names;
}

function hmrSwap(): number {
  reapDisconnected(); // 先清陈旧（含上轮遗留），并处置其 effects
  let swapped = 0;
  for (const inst of [...liveInstances]) {
    if (inst.nested) continue;
    const values = inst.signals.map((s) => s.get()); // 未命名兜底用：创建序快照
    const namedValues = new Map<string, unknown>(); // m11 边界②：按名快照（名称与创建序解耦）
    for (const [s, name] of inst.names) namedValues.set(name, s.get());
    disposeInstance(inst); // 旧 effects 逐个 dispose + 摘除旧树 + 注销信号
    liveInstances.delete(inst);
    reapDisconnected(); // 顶层树移除后其嵌套实例随即断连——立即回收
    const def = inst.registry.get(inst.defName); // 新模块已重注册；未注册则放弃该实例
    if (!def) continue;
    const root = mountComponentInner(def, inst.props, inst.container, inst.registry, inst.validate);
    const fresh = [...liveInstances].find((i) => i.root === root);
    if (fresh) {
      const freshByName = new Map<string, Signal>();
      for (const [s, name] of fresh.names) if (!freshByName.has(name)) freshByName.set(name, s);
      // 按名还原：同名同实例对才写（改名/删除=保守不还原，绝不把旧值写进语义不同的新信号）
      for (const [s, name] of fresh.names) {
        if (namedValues.has(name)) {
          try { s.set(namedValues.get(name) as never); } catch { /* 只读信号跳过 */ }
        }
      }
      // 未命名信号维持创建序启发式：相对序在未命名子集内对齐（prop 信号/内部信号，P0-5 既有语义）
      const oldUnnamed = inst.signals.filter((s) => !inst.names.has(s));
      const newUnnamed = fresh.signals.filter((s) => !fresh.names.has(s));
      newUnnamed.forEach((s, i) => {
        if (i < oldUnnamed.length) {
          try { s.set(oldUnnamed[i].get() as never); } catch { /* 只读信号跳过 */ }
        }
      });
      // m11 边界③：checkpoint 快照按名重锚——跨交换 timeTravel/rollback 回落到新信号。
      // 快照值原样迁移（非当前值）；改名/删除的旧条目保留原样（写死信号无害）。
      for (const cp of store._checkpoints) {
        for (const [oldSig, name] of inst.names) {
          if (!cp.snap.has(oldSig)) continue;
          const target = freshByName.get(name);
          if (target && !cp.snap.has(target)) {
            const v = cp.snap.get(oldSig);
            cp.snap.delete(oldSig);
            cp.snap.set(target, v);
          }
        }
      }
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

/* ---- R-D4b（R1-B 支，ATR-353）：keyed each 重复身份键静默折叠行 ----------------
 * keyed reconcile 的 appendChild 移动语义使重复 key 自第二项起折叠进已有行（渲染行数静默
 * 少于数据项数）——与「响亮拒绝」哲学冲突的静默错误族（AI 代理笔误高发面）。语义确定性保留
 * （不改变渲染，m10 诚实边界「组内重复身份键不校验」同款决策位），dev 一次性响亮警示
 * （每 each 块一次，token = live Map——块级生命周期对齐 keyComplained 先例）；prod 剥离
 * （双旗守卫，ATR-328 同款形态）。解释器与 codegen（rt.warnEachDupKey 发射）双路径同源。 */
const dupKeyComplained = new WeakSet<object>();
function atrEachDuplicateKey(k: string): AtrError {
  return {
    code: "ATR-353",
    message: `keyed each 收到重复身份键 "${k}"——自第二项起折叠进已有行（appendChild 移动语义），渲染行数少于数据项数`,
    context: {},
    fix: '让 by 表达式对每项取唯一值（如 by item.id）；数据本身含重复键时先去重，或改用无 by 形态（全清重建语义）',
  };
}
function warnEachDupKey(token: object, k: string, nextKeys: Set<string>): void {
  if (BUILD_PROD || dynProd()) return; // prod 剥离（双旗守卫，ATR-328 同款形态）
  if (!nextKeys.has(k) || dupKeyComplained.has(token)) return;
  dupKeyComplained.add(token);
  recordRuntimeError(atrEachDuplicateKey(k));
}

/** P-A P2-R5a：模板子树的动态面是否引用 each 行内 index 变量（表达式根标识符语法扫描，
 * 挂载/编译期一次性判定 needIdx——无引用的 each 块零隐藏信号开销）。over-approximation：
 * 嵌套 each 的同名 index 遮蔽不计较（多建一个无害信号）。 */
export function templateUsesIndex(nodes: TemplateNode[], index: string): boolean {
  const walk = (n: TemplateNode): boolean => {
    switch (n.kind) {
      case "expr":
        return exprRootIdents(n.expr).includes(index);
      case "element":
        return n.attrs.some((a) => a.dynamic && exprRootIdents(a.value).includes(index)) || n.children.some(walk);
      case "if":
        return n.blocks.some((b) => (b.test !== null && exprRootIdents(b.test).includes(index)) || b.children.some(walk));
      case "each":
        return (
          exprRootIdents(n.expr).includes(index) ||
          (n.keyExpr !== undefined && exprRootIdents(n.keyExpr).includes(index)) ||
          n.children.some(walk)
        );
      default:
        return false; // text
    }
  };
  return nodes.some(walk);
}

/** P-A P2-R5a：keyed each 行作用域构造单点（解释器 keyed 支路与 codegen emitEach 同源，
 * codegen 面经 __compiledRT 注入，产物零 import）。needIdx（templateUsesIndex 判定子树引用
 * 行内 index）时 index 经隐藏 $state 信号 + getter 注入——行内 {idx} 绑定追踪该信号，key
 * 命中复用 DOM 时由 keyed reconcile 把信号对齐新遍历序 ⇒ 幸存行不再停在建行时旧序号；
 * 无引用时退化为普通值（零额外信号开销）。index 信号随行 cleanup 注销（bindProp P1-4 同款：
 * 行重建发生在微任务期 __creationSink 收不到；mount 窗口首建时与实例收集双登记，Set.delete
 * 幂等无害）。 */
export function eachRowScope(
  scope: Record<string, unknown>,
  item: unknown,
  itemName: string,
  indexName: string,
  i: number,
  needIdx: boolean,
): { scope: Record<string, unknown>; index: Signal<number> | null } {
  const child: Record<string, unknown> = { ...scope, [itemName]: item };
  if (!needIdx) {
    child[indexName] = i;
    return { scope: child, index: null };
  }
  const idxSig: Signal<number> = $state(i);
  // getter 透传信号值：行内 effect 求值读 childScope[index] 即读 idxSig.value（进入追踪）
  Object.defineProperty(child, indexName, {
    get: () => idxSig.value,
    enumerable: true,
    configurable: true,
  });
  captureCleanup(() => {
    store._signals.delete(idxSig as Signal); // Set<Signal>（unknown 缺省）的协变收口——$state 创建点同款惯例
  });
  return { scope: child, index: idxSig };
}

function renderNodes(
  nodes: AstNode[],
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
  node: AstNode,
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
          // prod 剥离：无错误卡，空占位 + console（不静默）
          if (BUILD_PROD || dynProd()) {
            recordRuntimeError({ code: "ATR-401", message: `组件未注册：${node.tag}` });
            return document.createElement("span");
          }
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
        // 决策 27 集成收口：此卡源代码非旗控（validateProps 在 prod 早退 ok 使其动态不可达，
        // 但条件非常量 → DCE 不掉 → 产物 bundle 残留唯一 atr-error-card 字符串）——
        // 包上双旗短路守卫后 define 折叠为 false && … 整分支剔除（形态机检按调用点计数）。
        // 语义逐点核验：dev 无旗 = !v.ok 原语义；动态旗开 = validateProps 已早退 ok，本分支本就不可达。
        if (!(BUILD_PROD || dynProd()) && !v.ok) {
          const errBox = document.createElement("div");
          errBox.className = "atr-error-card";
          errBox.textContent = `${v.error?.code} ${v.error?.message} — fix: ${v.error?.fix ?? ""}`;
          return errBox;
        }
        const wrapper = document.createElement("span");
        return mountComponent(def, props, wrapper, registry, validate);
      }
      // 决策 25：bind: 预检先于 createElement——dev 任一失败即错误卡替换整个元素；
      // prod 记录后跳过失败项、元素照常渲染（ATR-401 同款分层，不静默）。
      // 决策 25 后置候选（M9 事件修饰 v1）：on: 预检同阶段并入（precheckEvents，纯名字
      // 语法检查——白名单外修饰符 ATR-326），dev 卡任取首条、prod 逐条记录。
      const fails = [...precheckBinds(node, scope), ...precheckEvents(node)];
      if (fails.length > 0) {
        if (BUILD_PROD || dynProd()) {
          for (const f of fails) recordRuntimeError(f.error);
        } else {
          const e = fails[0].error;
          const precheckCard = document.createElement("div");
          precheckCard.className = "atr-error-card";
          precheckCard.textContent = `${e.code} ${e.message} — fix: ${e.fix}`;
          return precheckCard;
        }
      }
      const el = document.createElement(node.tag);
      const skippedFails = new Set(fails.map((f) => f.attr)); // 仅 prod 非空（dev 已整元素替换）
      for (const a of node.attrs) {
        if (a.name.startsWith("on:")) {
          // 决策 25 后置候选（M9 事件修饰 v1）：单点 bindEvent（含无修饰符情形——行为逐字不变）
          if (!skippedFails.has(a)) bindEvent(el, a.name, a.value, scope);
          continue;
        }
        if (a.name.startsWith("bind:")) {
          // 决策 25：双向绑定单点（预检已过 → 校验正常；dispose 内部 captureCleanup 随分支析构）
          // 决策 25 v1.2：bind:group（radio group）走 bindGroup 单点，其余（bind:value/bind:checked）走 bindTwoWay
          if (!skippedFails.has(a)) {
            if (a.name === "bind:group") bindGroup(el, a.name, a.value, scope, node.tag);
            else bindTwoWay(el, a.name, a.value, scope, node.tag);
          }
          continue;
        }
        if (a.dynamic) {
          // R1-B 支（P1 #5）：动态属性单点 bindAttr——布尔属性存在性语义（25 项 + ATR-328 警示）
          // 与 codegen 同源（修复前解释器内联实现、codegen 只发射 setAttribute 语义反转）
          bindAttr(el, a.name, a.value, scope, node.tag);
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
      // 节点级收尾（F-5 补口）：if 节点整体被上级析构（行移除/上级分支丢弃）时，
      // 当前分支 cleanup 集无人会再跑（branch switch 才会跑）——先析构分支，再 dispose 外层 effect。
      const disposeIf = $effect(() => {
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
        });
      captureCleanup(() => {
        if (branchCleanup) runCleanup(branchCleanup);
        disposeIf();
      });
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
        // P-A P2-R5a：行内 index 引用面（一次性判定）+ 幸存行 index 信号表（key → 信号）
        const usesIdx = templateUsesIndex(node.children, node.index);
        const rowIdxSigs = new Map<string, Signal<number>>();
        const disposeEach = $effect(() => {
            const arr = (evalExpr(node.expr, scope) ?? []) as unknown[];
            const nextKeys = new Set<string>();
            arr.forEach((item, i) => {
              // key 求值用每轮现值构造（与行作用域解耦——key 表达式若引用 index，
              // 读 plain i 而非行信号，避免 reconcile effect 反向追踪行 index 信号）
              const keyScope: Record<string, unknown> = { ...scope, [node.item]: item, [node.index]: i };
              let k: string;
              try {
                k = stringify(evalExpr(node.keyExpr!, keyScope));
              } catch {
                k = `${i}`; // key 求值失败退化为位置 key（诚实降级而非白屏）
              }
              warnEachDupKey(live, k, nextKeys); // R-D4b（ATR-353）：重复 key dev 一次性警示（折叠语义不变）
              nextKeys.add(k);
              let el = live.get(k);
              if (!el) {
                const box = document.createElement("span");
                box.style.display = "contents";
                const set: Array<() => void> = [];
                teardownStack.push(set);
                try {
                  // P-A P2-R5a：行作用域单点（needIdx 时注入隐藏 index 信号，随行 cleanup 注销）
                  const row = eachRowScope(scope, item, node.item, node.index, i, usesIdx);
                  if (row.index) rowIdxSigs.set(k, row.index);
                  box.appendChild(renderNodes(node.children, row.scope, registry, validate, file, componentName));
                } finally {
                  teardownStack.pop();
                }
                rowCleanups.set(k, set);
                el = box;
                live.set(k, el);
              } else {
                // P-A P2-R5a：key 命中复用 DOM——幸存行 index 信号对齐新遍历序（修复前
                // {idx} 永远停在建行时旧序号；未变化不写，防无谓失效）
                const idxSig = rowIdxSigs.get(k);
                if (idxSig && idxSig.value !== i) idxSig.value = i;
              }
              host.appendChild(el); // 相同顺序时为 no-op；乱序时即完成重排
            });
            for (const [k, el] of [...live]) {
              if (!nextKeys.has(k)) {
                el.remove();
                const set = rowCleanups.get(k);
                if (set) runCleanup(set);
                rowCleanups.delete(k);
                rowIdxSigs.delete(k);
              }
            }
        });
        // 节点级收尾（F-5 补口）：each 节点整体被上级析构时，全部行的 cleanup 集随之外析构
        captureCleanup(() => {
          for (const set of rowCleanups.values()) runCleanup(set);
          rowCleanups.clear();
          disposeEach();
        });
        return host;
      }
      // 旧语义（无 by）：全清重建。F-5：重建前先析构上一轮全部行的 cleanup。
      let rowsCleanup: Array<() => void> = [];
      const disposeRows = $effect(() => {
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
      });
      // 节点级收尾（F-5 补口）：整体析构时上一轮（及当前轮）行的 cleanup 一并析构
      captureCleanup(() => {
        runCleanup(rowsCleanup);
        disposeRows();
      });
      return host;
    }
  }
}

/* booly 已统一从 expr.ts 导入（真值判定单一源，两处曾并存已废除） */

/* ---- P0-2③ 编译产物（compiler/codegen.mjs stage ③ 输出）注册与运行时依赖面 ---- */

export type CompiledTemplate = {
  name: string;
  raw: string;
  styles?: string[];
  // 决策 26 v1：编译产物流携带的 FlatSchema——codegen 产物模块级 compiledSchema 经
  // registerCompiled 应用时反射回条目（按 entries 携带的通道；schema 缺省 = undefined）
  schema?: unknown;
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

/** 决策 26 产物流：把产物携带的 schema 落到运行时两面（registerCompiled 条目级应用单点）。
 * ① 喂决策 26 sink（registerExtractedSchemas 冻结接口，逐键 set = HMR 刷新语义）——
 *    registerCompiled 先于 component() 求值时经此兜底生效；
 * ② 回填既有 registry 条目：仅当其 schema === undefined 时置入——显式 opts.schema 恒胜
 *    （决策 26 承诺逐字保持：永不覆盖已定义 schema，无论显式还是先前回填所得）。
 * 与 component() 的先后两时序由此都生效（时序无关钉，tests/schema-codegen.test.ts）。 */
function applyCompiledSchema(name: string, schema: unknown): void {
  registerExtractedSchemas({ [name]: schema });
  const def = globalRegistry.get(name);
  if (def && def.schema === undefined) def.schema = schema;
}

/** 注册编译产物。接受 codegen 模块形态：`{compiled}` / `{compiledList}` / 数组 / 单条；
 * 决策 26 v1：另接受产物模块上的 `compiledSchema`（codegen 仅在 dump 携带 schema 时发射，
 * per-component 单 schema 作用于本模块全部条目），条目级 `schema` 字段同样生效（entries
 * 携带通道）。schema 应用只按组件名流动、不要求条目携带 raw——模块产物条目形态为
 * {name, deps, program}（产物零 import 不冗余携带 raw；快路径命中所需的 raw 由应用侧
 * 组件模板同源提供）。compiledByRaw 存储仍按 raw 精确匹配守卫——P0-2② 单一来源
 * （dump 的树 = 解释器的树）⇒ raw 相同即模板相同，无歧义。 */
export function registerCompiled(
  mod:
    | { compiled?: CompiledTemplate; compiledList?: CompiledTemplate[]; compiledSchema?: unknown }
    | CompiledTemplate
    | CompiledTemplate[]
): void {
  const modSchema = (mod as { compiledSchema?: unknown }).compiledSchema;
  const list: CompiledTemplate[] = Array.isArray(mod)
    ? mod
    : ((mod as { compiledList?: CompiledTemplate[] }).compiledList ??
      [(mod as { compiled?: CompiledTemplate }).compiled ?? (mod as CompiledTemplate)]);
  for (const c of list) {
    if (!c) continue;
    // 决策 26：schema 面（sink 兜底 + registry 回填）独立于 raw 守卫——有组件名即流动
    const schema = c.schema ?? modSchema;
    if (schema !== undefined && typeof c.name === "string" && c.name) {
      applyCompiledSchema(c.name, schema);
      c.schema = schema; // 条目反射：CompiledTemplate.schema 兑现（同引用，重注册幂等）
    }
    if (typeof c.raw === "string" && typeof c.program === "function") {
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
  bindTwoWay, // 决策 25：bind:value/bind:checked 双向绑定单点（codegen emitAttrs 同位支路发射 rt.bindTwoWay，产物零 import 不破）
  bindGroup, // 决策 25 v1.2：bind:group radio group 单点（codegen emitAttrs 同位支路发射 rt.bindGroup，产物零 import 不破）
  bindEvent, // 决策 25 后置候选（M9 事件修饰 v1）：on:event[.mod…] 单点（codegen emitAttrs on: 支路同位发射 rt.bindEvent，分支 B 收口；产物零 import 不破）
  bindAttr, // R1-B 支（P1 #5）：动态属性单点——布尔属性存在性语义/ATR-328 与解释器同源（codegen emitAttrs dynamic 支路同位发射 rt.bindAttr，产物零 import 不破）
  eachRowScope, // P-A P2-R5a：keyed each 行作用域单点——隐藏行 index 信号（幸存行 {idx} 随遍历序更新；codegen emitEach keyed 支路同位发射，双路径同源）
  warnEachDupKey, // R-D4b（ATR-353）：keyed each 重复身份键 dev 一次性警示单点（codegen emitEach keyed 支路同位发射，双路径同源）
  recordRuntimeError,
  mountComponent,
  bindProp, // F-5：动态属性 = 响应式 prop（编译路径与解释器同源同函数）
  validateProps, // F-5：契约校验免追踪包裹（同上）
  // 决策 27（M9 codegen strip）：双旗给 codegen emitComponent——两处错误卡分支发射 !(rt.BUILD_PROD ||
  // rt.dynProd()) 守卫（解释器同款短路语义），产物零 import 拿到构建期常量与运行时动态读两员。
  BUILD_PROD,
  dynProd,
  // F-5 teardown 面给 codegen：编译路径的分支/行级析构与解释器共用同一 teardownStack。
  // 修复前 codegen 的 {#if} 换支 / {#each} 行移除只清 DOM 不析构 effect（僵尸 effect 红检见 tests/codegen.test.ts）。
  captureCleanup,
  runCleanup,
  withTeardown,
};
