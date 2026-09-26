/**
 * HelloCard.atr.spec.ts — 契约机检（决策 6/9：AtrError 四段式）。
 * 与实现/意图文件三元共置；schema 改动必须三处同步。
 */
import { describe, it, expect } from "vitest";
import { validateFlat, type FlatSchema } from "../runtime/contract";
import { helloCardSchema } from "./HelloCard.atr.ts";

const schema = helloCardSchema as unknown as FlatSchema;

describe("HelloCard contract (flat schema, ATR-201 discipline)", () => {
  it("accepts a valid payload", () => {
    const r = validateFlat(schema, { title: "Hello", start: 3 });
    expect(r.ok).toBe(true);
  });

  it("accepts optProps omitted", () => {
    expect(validateFlat(schema, { title: "Hello" }).ok).toBe(true);
  });

  it("rejects missing required prop with ATR-201 and key hints in fix", () => {
    const r = validateFlat(schema, { start: 1 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.fix).toContain("title");
  });

  it("rejects wrong prop type", () => {
    const r = validateFlat(schema, { title: 42 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.message).toContain("title");
  });

  it("errors carry the four AtrError segments", () => {
    const r = validateFlat(schema, {});
    expect(r.error && r.error.code && r.error.message && r.error.context && r.error.fix).toBeTruthy();
  });
});
