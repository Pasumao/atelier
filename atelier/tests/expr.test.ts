import { describe, it, expect } from "vitest";
import { evalExpr, exprRootIdents } from "../runtime/expr";

describe("evalExpr — supported subset matrix", () => {
  const scope = { a: 10, b: -3, name: "deepseek", list: ["x", "y"], cfg: { enabled: true }, flag: false, empty: "" };

  it("arithmetic precedence", () => {
    expect(evalExpr("2 + 3 * 4", scope)).toBe(14);
    expect(evalExpr("(2 + 3) * 4", scope)).toBe(20);
    expect(evalExpr("a * b", scope)).toBe(-30);
  });

  it("strict equality family", () => {
    expect(evalExpr("name === 'deepseek'", scope)).toBe(true);
    expect(evalExpr("name !== 'x'", scope)).toBe(true);
    expect(evalExpr("a == '10'", scope)).toBe(true); // loose == coerces '10' — documented JS behavior
  });

  it("ternary / nullish / logical with JS short-circuit value semantics", () => {
    expect(evalExpr("a > 5 ? 'big' : 'small'", scope)).toBe("big");
    expect(evalExpr("undefinedVarHere ?? 'fallback'", scope)).toBeUndefined ?? undefined;
    expect(evalExpr("empty || 'or-value'", scope)).toBe("or-value"); // '' is falsy
    expect(evalExpr("a && 'has-a'", scope)).toBe("has-a");
    expect(evalExpr("!flag", scope)).toBe(true);
    expect(evalExpr("flag && a", scope)).toBe(false);
  });

  it("property & index access", () => {
    expect(evalExpr("cfg.enabled", scope)).toBe(true);
    expect(evalExpr("list[0]", scope)).toBe("x");
    expect(evalExpr("list[1] === 'y'", scope)).toBe(true);
  });

  it("ATR-301 on malformed input", () => {
    expect(() => evalExpr("((", scope)).toThrowError(/ATR-301/);
  });

  it("ATR-301 精确报错：箭头函数 / 赋值 / 函数调用均前置拦截并给出修法", () => {
    // 内联箭头函数 → 指向 locals 具名函数
    expect(() => evalExpr("list.map(x => x)", scope)).toThrowError(/ATR-301.*箭头函数/);
    // 赋值 → 指向事件处理器
    expect(() => evalExpr("a = 3", scope)).toThrowError(/ATR-301.*赋值/);
    // 函数调用曾被静默丢尾（求出函数本身）——现在遗留 token 显式报错
    expect(() => evalExpr("list.map(f)", scope)).toThrowError(/ATR-301.*遗留/);
    expect(() => evalExpr("a + b) (", scope)).toThrowError(/ATR-301.*遗留/);
  });

  it("exprRootIdents：根标识符提取（属性链只取根；F-2 静态依赖用）", () => {
    expect(exprRootIdents("count.value + label")).toEqual(["count", "label"]);
    expect(exprRootIdents("props.stream.values")).toEqual(["props"]); // 属性链不算根
    expect(exprRootIdents("list[0] === 'x'")).toEqual(["list"]); // 字符串字面量/数字不入
    expect(exprRootIdents("a.b[c] ?? flag ? d.value : 'f'")).toEqual(["a", "c", "flag", "d"]);
    expect(exprRootIdents("true && null")).toEqual([]); // 关键字/字面量排除
    expect(exprRootIdents("flag ?? flag")).toEqual(["flag"]); // 重复根去重
  });
});

describe("evalExpr — property fuzz-lite (arith depth<=3)", () => {
  // deterministic PRNG so failures are reproducible
  let seed = 20260827;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  function genLeaf(): string {
    if (rnd() < 0.55) return String(Math.floor(rnd() * 100));
    return pick(["a", "b", "c"]);
  }
  function genExpr(depth: number): string {
    if (depth <= 0) return genLeaf();
    const op = pick(["+", "-", "*"]);
    return `(${genExpr(depth - 1)} ${op} ${genExpr(depth - 1)})`;
  }

  const vars = { a: 13, b: -7, c: 42 };

  it("200 generated arithmetic expressions agree with reference Function() evaluation", () => {
    for (let i = 0; i < 200; i++) {
      const src = genExpr(3);
      const expected = new Function("a", "b", "c", `return (${src});`)(vars.a, vars.b, vars.c);
      expect(evalExpr(src, vars)).toBe(expected);
    }
  });
});
