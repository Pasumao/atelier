/**
 * Atelier prototype — 模板表达式迷你求值器。
 * 替代 new Function/eval（决策 12：产物零 eval 精神）；
 * 支持子集：属性访问 / 索引 / 字符串数字布尔字面量 / 数组与对象字面量（F-4 第二期，含 {a} 简写
 * 与 ({...}).x 成员链）/ === == != !== > < >= <= && || ! ?: + - * / / 一元 +/-/! 与 not 关键字
 * （P-A P2-R5b）
 * FS-11（§8.4，方向=显式拒绝）：求值结果为 Promise → ATR-323 四段式拒绝（异步不进响应式图）。
 * 完整版：编译器将表达式转换为直接闭包调用（本原型为解释求值）。
 */

type Tok = { t: "num" | "str" | "id" | "op" | "punc" | "kwd"; v: string };

const KEYWORDS = new Set(["true", "false", "null", "undefined", "and", "or", "not"]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < src.length) {
        if (src[j] === q) {
          closed = true;
          break;
        }
        if (src[j] === "\\") {
          if (j + 1 >= src.length) throw new Error("ATR-301: 字符串转义符 \\ 后缺少字符（字符串未闭合？）");
          const e = src[j + 1];
          // 常见转义还原为真实字符；未知转义保留原字符（\n → 换行，\q → q）
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (!closed) throw new Error(`ATR-301: 字符串字面量未闭合（缺少收尾 ${q}）`);
      toks.push({ t: "str", v: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`ATR-301: 非法数字字面量 "${raw}"（多中小数点？）`);
      }
      toks.push({ t: "num", v: raw });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push({ t: KEYWORDS.has(w) ? "kwd" : "id", v: w });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (["===", "!=="].includes(three)) {
      toks.push({ t: "op", v: three });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||", "??"].includes(two)) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/<>!?:,()[].{}".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "=" && src[i + 1] === ">")
      throw new Error(
        "ATR-301: 模板表达式不支持箭头函数（=>）——在组件函数体内定义普通函数（具名/函数声明），经 locals 绑定后在模板里引用函数名（如 on:click={inc}）",
      );
    if (c === "=")
      throw new Error(
        "ATR-301: 模板表达式不支持赋值（=）——表达式只读求值；请通过事件处理器（on:click={handler} 等）调用函数修改 $state",
      );
    throw new Error(`ATR-301: 无法解析表达式字符 "${c}"`);
  }
  return toks;
}

function escapeForRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class Parser {
  toks: Tok[];
  pos = 0;
  constructor(src: string) {
    this.toks = tokenize(src);
  }
  peek() {
    return this.toks[this.pos];
  }
  next() {
    return this.toks[this.pos++];
  }
  expectOp(v: string) {
    const t = this.next();
    if (!t || t.v !== v) throw new Error(`ATR-301: 期望 "${v}"，实际 "${t?.v ?? "EOF"}"`);
  }
  parse(): (scope: Record<string, unknown>) => unknown {
    const ast = this.ternary();
    if (this.pos < this.toks.length) {
      const rest = this.toks.slice(this.pos).map((t) => t.v).join(" ");
      throw new Error(
        `ATR-301: 表达式含不支持的语法（遗留 "${rest}"）——常见于函数调用（如 .map(...)）或内联箭头函数；请改用 $derived 预计算、或经 locals 绑定具名函数后在模板引用`,
      );
    }
    return ast;
  }
  ternary(): (scope: Record<string, unknown>) => unknown {
    const cond = this.nullish();
    if (this.peek()?.v === "?") {
      this.next();
      const a = this.ternary();
      this.expectOp(":");
      const b = this.ternary();
      return (s) => (booly(cond(s)) ? a(s) : b(s));
    }
    return cond;
  }
  nullish(): (scope: Record<string, unknown>) => unknown {
    let l = this.or();
    while (this.peek()?.v === "??") {
      this.next();
      const r = this.or();
      const lf = l;
      l = (s) => {
        const lv = lf(s);
        return lv == null ? r(s) : lv;
      };
    }
    return l;
  }
  or(): (scope: Record<string, unknown>) => unknown {
    let l = this.and();
    while (this.peek()?.v === "||" || this.peek()?.v === "or") {
      this.next();
      const r = this.and();
      const lf = l;
      // JS value semantics: return the operand itself, not a boolean (bug found by vitest —
      // template idiom {{ a || "fallback" }} requires the value, coerced-true breaks it)
      l = (s) => {
        const lv = lf(s);
        return booly(lv) ? lv : r(s);
      };
    }
    return l;
  }
  and(): (scope: Record<string, unknown>) => unknown {
    let l = this.cmp();
    while (this.peek()?.v === "&&" || this.peek()?.v === "and") {
      this.next();
      const r = this.cmp();
      const lf = l;
      l = (s) => {
        const lv = lf(s);
        return booly(lv) ? r(s) : lv;
      };
    }
    return l;
  }
  cmp(): (scope: Record<string, unknown>) => unknown {
    let l = this.add();
    for (;;) {
      const t = this.peek();
      if (t && ["==", "===", "!=", "!==", ">", "<", ">=", "<="].includes(t.v)) {
        this.next();
        const r = this.add();
        const op = t.v;
        const lf = l;
        l = (s) => {
          const a = lf(s) as never;
          const b = r(s) as never;
          switch (op) {
            case "==": return a == b;
            case "===": return a === b;
            case "!=": return a != b;
            case "!==": return a !== b;
            case ">": return (a as number) > (b as number);
            case "<": return (a as number) < (b as number);
            case ">=": return (a as number) >= (b as number);
            case "<=": return (a as number) <= (b as number);
          }
          return false;
        };
      } else break;
    }
    return l;
  }
  add(): (scope: Record<string, unknown>) => unknown {
    let l = this.mul();
    for (;;) {
      const t = this.peek();
      if (t && (t.v === "+" || t.v === "-")) {
        this.next();
        const r = this.mul();
        const op = t.v;
        const lf = l;
        l = (s) => (op === "+" ? ((lf(s) as number) + (r(s) as number)) : ((lf(s) as number) - (r(s) as number)));
      } else break;
    }
    return l;
  }
  mul(): (scope: Record<string, unknown>) => unknown {
    let l = this.primary();
    for (;;) {
      const t = this.peek();
      if (t && (t.v === "*" || t.v === "/")) {
        this.next();
        const r = this.primary();
        const op = t.v;
        const lf = l;
        l = (s) => (op === "*" ? (lf(s) as number) * (r(s) as number) : (lf(s) as number) / (r(s) as number));
      } else break;
    }
    return l;
  }
  primary(): (scope: Record<string, unknown>) => unknown {
    const t = this.next();
    if (!t) throw new Error("ATR-301: 表达式意外结束");
    if (t.t === "num") {
      const n = Number(t.v);
      return () => n;
    }
    if (t.t === "str") {
      return () => t.v;
    }
    if (t.t === "kwd") {
      if (t.v === "true") return () => true;
      if (t.v === "false") return () => false;
      if (t.v === "null") return () => null;
      if (t.v === "undefined") return () => undefined;
      // P-A P2-R5b：not 关键字兑现——KEYWORDS 一直广告它（and/or 早已在 and()/or() 落地），
      // 此前却抛「不支持关键字 not」。映射为 ! 同款语义/语法位（primary 前缀一元）。
      if (t.v === "not") {
        const inner = this.primary();
        return (s) => !booly(inner(s));
      }
      throw new Error(`ATR-301: 不支持关键字 ${t.v}`);
    }
    if (t.t === "op" && t.v === "(") {
      const inner = this.ternary();
      this.expectOp(")");
      return this.chain(inner); // F-4 第二期：({...}).x / (arr)[0] 后缀链
    }
    if (t.t === "op" && t.v === "!") {
      const inner = this.primary();
      return (s) => !booly(inner(s));
    }
    // P-A P2-R5b：一元 +/-（与 ! 同一语法位）——修复前 {-n} 报 ATR-301「意外的符号 -」且 fix
    // 不指路。-x ⇒ -(x)、+x ⇒ +(x)；链式 --x 合法（递归 primary，双重否定）。
    if (t.t === "op" && (t.v === "-" || t.v === "+")) {
      const inner = this.primary();
      if (t.v === "-") return (s) => -(inner(s) as number);
      return (s) => +(inner(s) as number);
    }
    if (t.t === "op" && t.v === "{") return this.objectLiteral();
    if (t.t === "op" && t.v === "[") return this.arrayLiteral();
    if (t.t !== "id") throw new Error(`ATR-301: 意外的符号 "${t.v}"`);
    // identifier chain: a.b.c[0]
    return this.chain((s) => s[t.v]);
  }

  /** 属性/索引后缀链：base.x.y[0]（也服务 (expr).x 与字面量后缀，F-4 第二期） */
  chain(base: (s: Record<string, unknown>) => unknown): (s: Record<string, unknown>) => unknown {
    let fn = base;
    for (;;) {
      const n = this.peek();
      if (!n) break;
      if (n.v === ".") {
        this.next();
        const prop = this.next();
        if (!prop || prop.t !== "id") throw new Error("ATR-301: 属性名期望标识符");
        const prev = fn;
        fn = (s) => (prev(s) as Record<string, unknown>)?.[prop.v];
        continue;
      }
      if (n.v === "[") {
        this.next();
        const idx = this.ternary();
        this.expectOp("]");
        const prev = fn;
        fn = (s) => (prev(s) as (unknown[] | Record<string, unknown>))?.[idx(s) as never];
        continue;
      }
      break;
    }
    return fn;
  }

  /** 对象字面量 {key: expr, ...}；{a} 简写 = 取作用域 a（F-4 第二期）。键为标识符或字符串。 */
  objectLiteral(): (s: Record<string, unknown>) => unknown {
    const props: { k: string; v: (s: Record<string, unknown>) => unknown }[] = [];
    if (this.peek()?.v !== "}") {
      for (;;) {
        const kt = this.next();
        if (!kt || (kt.t !== "id" && kt.t !== "str")) {
          throw new Error("ATR-301: 对象字面量键期望标识符或字符串");
        }
        if (this.peek()?.v === ":") {
          this.next();
          props.push({ k: kt.v, v: this.ternary() });
        } else {
          if (kt.t !== "id") throw new Error("ATR-301: 对象字面量简写仅支持标识符键");
          const key = kt.v;
          props.push({ k: key, v: (s) => s[key] });
        }
        if (this.peek()?.v === ",") {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expectOp("}");
    return this.chain((s) => {
      const o: Record<string, unknown> = {};
      for (const p of props) o[p.k] = p.v(s);
      return o;
    });
  }

  /** 数组字面量 [expr, ...]（F-4 第二期） */
  arrayLiteral(): (s: Record<string, unknown>) => unknown {
    const items: ((s: Record<string, unknown>) => unknown)[] = [];
    if (this.peek()?.v !== "]") {
      for (;;) {
        items.push(this.ternary());
        if (this.peek()?.v === ",") {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expectOp("]");
    return this.chain((s) => items.map((f) => f(s)));
  }
}

/** 真值判定（单一源）：JS 语义 Boolean(v)，与 {#if}（template.ts）同一套——
 * 修复前这里曾用 Python 式 truthiness（空数组 falsy），同一空数组在 `{{ arr ? a : b }}`
 * 与 `{#if arr}` 里结论相反（两套真值语义并存已废除）。导出供 template.ts 复用。 */
export function booly(v: unknown): boolean {
  return Boolean(v);
}

/** FS-11：跨 realm 安全的 Promise 判定——duck-typing then（不 instanceof，异 realm Promise
 * 与自造 thenable 一网打尽；null/undefined 短路）。 */
function isPromiseLike(v: unknown): boolean {
  return v != null && typeof (v as { then?: unknown }).then === "function";
}

/** FS-11 / ATR-323 四段式：模板表达式求值出 Promise = 异步泄漏进响应式图，显式拒绝。
 * fix 指路两条合法异步通道（§8.4 原文口径）：三态原语 streamValue/optimisticList 边界消费 +
 * live 端点订阅。 */
function atrAsyncLeak(src: string): never {
  throw {
    code: "ATR-323",
    message: `模板表达式返回 Promise（异步泄漏进响应式图）：${src}`,
    context: { expr: src },
    fix: "模板表达式必须同步求值：异步结果经三态原语 streamValue/optimisticList 消费（原语边界解析后写 $state），或订阅 live 端点让推送写入信号；事件处理器传函数引用（on:click={handler}），在处理器内部收敛异步",
  };
}

/** 求值表达式文本。scope 中的信号为普通 JS 对象（读 .value 即触发 track）。
 * 解析结果按源文本 memoize（上限 500 条，与 template.ts 的模板缓存同策略）——
 * bindExpr 每次重跑、on:click 每次点击都不再重新 tokenize+parse。 */
const parseCache = new Map<string, (scope: Record<string, unknown>) => unknown>();

export function evalExpr(src: string, scope: Record<string, unknown>): unknown {
  let ast = parseCache.get(src);
  if (!ast) {
    ast = new Parser(src).parse();
    if (parseCache.size >= 500) {
      const oldest = parseCache.keys().next().value;
      if (oldest !== undefined) parseCache.delete(oldest);
    }
    parseCache.set(src, ast);
  }
  const v = ast(scope);
  /* FS-11 守卫位置论证（§8.4 "rt.bindExpr 求值出口统一检测"的落地形态）：
   * bindExpr 只覆盖文本插值/动态 attr 两个挂点，而 {#if} test、{#each} 源与 key、组件动态 prop
   * （bindProp）、on: 表达式都直接调 evalExpr；codegen 生成代码亦然——rt.bindExpr/rt.bindProp
   * 内部汇入本函数，rt.evalExpr 直调（见 compiler/codegen.mjs 发射器）。evalExpr 是解释器与
   * codegen 两条路径全部模板表达式求值的唯一汇聚点：在此单点检测 = 双路径天然同源（同码/同
   * message/同 fix，错误渲染 golden 一致，tests/fs11-async.test.ts），无生成代码内联复制、
   * 无两套语义，产物零 import 红线不破（能力本就经 ctx.rt 注入）。
   * 分层：调用语法 { fn() } 已被 ATR-301 解析期拒绝（迷你求值器不支持调用，遗留 token 显式报错），
   * 本守卫收口值形态——信号/作用域里存了 Promise（如 $state(fetchUser()) 笔误）经非调用表达式
   * 流入渲染图。守卫前反例（红检留痕，tests/fs11-async.test.ts 头注释）：文本插值渲染 "{}" 且
   * 零上报、{#if} 恒真静默取首支、{#each} 裸 TypeError 无 fix、bindProp 把 Promise 写进信号
   * journal、on: 静默丢弃。 */
  if (isPromiseLike(v)) atrAsyncLeak(src);
  return v;
}

/**
 * 表达式的根标识符（作用域引用）集合——编译期静态依赖提取（决策 3 / F-2）用。
 * 规则：id token 且前一个 token 不是 "."（属性链 x.y.z 只取根 x）；关键字与字面量天然排除；
 * 对象字面量的键（前一 token 是 "{" 或 "," 且后随 ":"）不是作用域引用，不计入。
 * 语义边界（诚实标注）：这是**语法级引用集**——包含 ternary/&&/|| 未被求值的分支，
 * 因此是运行时追踪集的**超集**（等号仅在无短路、且全部经 .value 读信号的表达式上成立）。
 */
export function exprRootIdents(src: string): string[] {
  const toks = tokenize(src);
  const out: string[] = [];
  let prev = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id") {
      prev = t.v;
      continue;
    }
    const next = toks[i + 1];
    if (prev === ".") {
      prev = t.v;
      continue; // 属性链 x.y.z 的成员不是根引用
    }
    const isObjKey = next?.v === ":" && (prev === "{" || prev === ",");
    if (!isObjKey && !out.includes(t.v)) out.push(t.v);
    prev = t.v;
  }
  return out;
}
