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
