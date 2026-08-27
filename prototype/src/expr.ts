/**
 * Atelier prototype — 模板表达式迷你求值器。
 * 替代 new Function/eval（决策 12：产物零 eval 精神）；
 * 支持子集：属性访问 / 索引 / 字符串数字布尔字面量 / === == != !== > < >= <= && || ! ?: + - * /
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
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") {
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      toks.push({ t: "str", v: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: "num", v: src.slice(i, j) });
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
    if ("+-*/<>!?:,()[].".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`ATR-3xx: 无法解析表达式字符 "${c}"`);
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
    if (!t || t.v !== v) throw new Error(`ATR-3xx: 期望 "${v}"，实际 "${t?.v ?? "EOF"}"`);
  }
  parse(): (scope: Record<string, unknown>) => unknown {
    return this.ternary();
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
      l = (s) => booly(lf(s)) || booly(r(s));
    }
    return l;
  }
  and(): (scope: Record<string, unknown>) => unknown {
    let l = this.cmp();
    while (this.peek()?.v === "&&" || this.peek()?.v === "and") {
      this.next();
      const r = this.cmp();
      const lf = l;
      l = (s) => booly(lf(s)) && booly(r(s));
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
    if (!t) throw new Error("ATR-3xx: 表达式意外结束");
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
      if (t.v === "null" || t.v === "undefined") return () => null;
      throw new Error(`ATR-3xx: 不支持关键字 ${t.v}`);
    }
    if (t.t === "op" && t.v === "(") {
      const inner = this.ternary();
      this.expectOp(")");
      return inner;
    }
    if (t.t === "op" && t.v === "!") {
      const inner = this.primary();
      return (s) => !booly(inner(s));
    }
    // identifier chain: a.b.c[0]
    let fn: (s: Record<string, unknown>) => unknown = (s) => s[t.v];
    for (;;) {
      const n = this.peek();
      if (!n) break;
      if (n.v === ".") {
        this.next();
        const prop = this.next();
        if (!prop || prop.t !== "id") throw new Error("ATR-3xx: 属性名期望标识符");
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
}

function booly(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

/** 求值表达式文本。scope 中的信号为普通 JS 对象（读 .value 即触发 track）。 */
export function evalExpr(src: string, scope: Record<string, unknown>): unknown {
  const ast = new Parser(src).parse();
  return ast(scope);
}
