/**
 * ContractProbe.atr.spec.ts — P1-9 契约机检：starter 里的 ATR-201 路径必须真实可走。
 * 与实现/意图文件三元共置；schema 改动必须三处同步。
 */
import { describe, it, expect } from "vitest";
import { validateFlat, type FlatSchema } from "../runtime/contract";
import { contractProbeSchema } from "./ContractProbe.atr.ts";

const schema = contractProbeSchema as unknown as FlatSchema;

describe("ContractProbe contract (P1-9 demo, ATR-201 discipline)", () => {
  it("accepts a valid payload (reqProps complete)", () => {
    const r = validateFlat(schema, { title: "OK", level: 2, note: "reqProps 齐全" });
    expect(r.ok).toBe(true);
  });

  it("rejects missing required prop with ATR-201 and key hints in fix", () => {
    const r = validateFlat(schema, { title: "违规实例（缺 reqProps: level）" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.fix).toContain("level");
  });

  it("rejects wrong prop type (level as string)", () => {
    const r = validateFlat(schema, { title: "t", level: "2" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.message).toContain("level");
  });

  it("errors carry the four AtrError segments", () => {
    const r = validateFlat(schema, { title: "t" });
    expect(r.error && r.error.code && r.error.message && r.error.context && r.error.fix).toBeTruthy();
  });
});
