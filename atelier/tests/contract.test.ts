import { describe, it, expect } from "vitest";
import { validateFlat, validateUnknown, type FlatSchema } from "../runtime/contract";

const schema: FlatSchema = {
  type: "object",
  reqProps: {
    name: { type: "string" },
    status: { type: "string", enum: ["thinking", "streaming", "done"] },
  },
  optProps: {
    tools: { type: "array", items: { type: "string" } },
  },
};

describe("validateFlat (H1 flat schema / decision 6)", () => {
  it("accepts a fully valid payload", () => {
    const v = validateFlat(schema, { name: "card", status: "done" });
    expect(v.ok).toBe(true);
    expect(v.error).toBeUndefined();
  });

  it("accepts optProps when present and well-typed", () => {
    const v = validateFlat(schema, { name: "c", status: "thinking", tools: ["a"] });
    expect(v.ok).toBe(true);
  });

  it("rejects missing required prop with ATR-201 and key hints in fix", () => {
    const v = validateFlat(schema, { status: "done" });
    expect(v.ok).toBe(false);
    expect(v.error?.code).toBe("ATR-201");
    expect(v.error?.fix).toContain("name");
  });

  it("rejects enum violation (literal discriminant discipline)", () => {
    const v = validateFlat(schema, { name: "c", status: "banana" });
    expect(v.ok).toBe(false);
    expect(v.error?.code).toBe("ATR-201");
    expect(v.error?.fix).toContain("thinking");
  });

  it("validates array item types", () => {
    const v = validateFlat(schema, { name: "c", status: "done", tools: [1, 2] });
    expect(v.ok).toBe(false);
    expect(v.error?.fix).toContain("string");
  });

  it("validateUnknown: non-object input → ATR-205 with actionable fix", () => {
    const v = validateUnknown(schema, "just a string");
    expect(v.ok).toBe(false);
    expect(v.error?.code).toBe("ATR-205");
    expect(v.error?.fix).toContain("{");
  });

  it("no schema → permissive ok", () => {
    expect(validateFlat(undefined, { anything: true }).ok).toBe(true);
  });
});

describe("validateFlat leaf constraints (min/max/pattern — 扁平红线不动)", () => {
  const s: FlatSchema = {
    type: "object",
    reqProps: {
      level: { type: "number", min: 1, max: 6 },
      title: { type: "string", min: 2, max: 10, pattern: "^[A-Za-z][\\w -]*$" },
      tags: { type: "array", items: { type: "string" }, min: 1, max: 3 },
    },
  };

  it("边界内全过（含上下限等号）", () => {
    expect(validateFlat(s, { level: 1, title: "Ab", tags: ["x"] }).ok).toBe(true);
    expect(validateFlat(s, { level: 6, title: "A".repeat(10), tags: ["x", "y", "z"] }).ok).toBe(true);
  });

  it("number 越界 → ATR-201 带上下限", () => {
    const v = validateFlat(s, { level: 7, title: "Ab", tags: ["x"] });
    expect(v.ok).toBe(false);
    expect(v.error?.fix).toContain("超过上限 6");
  });

  it("string 长度与 pattern 各自独立报错", () => {
    const v = validateFlat(s, { level: 3, title: "a", tags: ["x"] });
    expect(v.error?.fix).toContain("长度 1 小于最小 2");
    const v2 = validateFlat(s, { level: 3, title: "9bad", tags: ["x"] });
    expect(v2.error?.fix).toContain("不匹配 pattern");
  });

  it("array 长度约束", () => {
    const v = validateFlat(s, { level: 3, title: "Ab", tags: [] });
    expect(v.error?.fix).toContain("0 项少于最小 1");
    const v2 = validateFlat(s, { level: 3, title: "Ab", tags: ["1", "2", "3", "4"] });
    expect(v2.error?.fix).toContain("4 项超过最大 3");
  });

  it("无效 pattern → schema 缺陷显式报错而非静默放行", () => {
    const bad: FlatSchema = { type: "object", reqProps: { title: { type: "string", pattern: "(" } } };
    const v = validateFlat(bad, { title: "ok" });
    expect(v.ok).toBe(false);
    expect(v.error?.fix).toContain("pattern 无效");
  });
});
