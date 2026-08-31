/**
 * tokens-dtcg.test.ts — P2-2④ W3C DTCG 设计令牌互导验收：roundtrip 值不丢 + 类型推断。
 */
import { describe, expect, it } from "vitest";
import { exportDtcg, importDtcg, inferType } from "../scripts/tokens-dtcg.mjs";

const config = {
  tokens: {
    color: { primary: "#4D6BFE", danger: "#E5484D" },
    space: { xs: "4px", md: "16px" },
    font: { sm: "0.85rem" },
  },
};

describe("DTCG interop (P2-2④ — W3C design tokens)", () => {
  it("export：组嵌套 + $type 推断（color/dimension）+ $value 原样", () => {
    const d = exportDtcg(config);
    expect(d.color.primary).toEqual({ $type: "color", $value: "#4D6BFE" });
    expect(d.space.xs).toEqual({ $type: "dimension", $value: "4px" });
    expect(d.font.sm).toEqual({ $type: "dimension", $value: "0.85rem" });
  });

  it("import：剥离 $type/$value 还原扁平组（roundtrip 值全等）", () => {
    const flat = importDtcg(exportDtcg(config));
    expect(flat).toEqual(config.tokens);
  });

  it("宽容导入：扁平叶子与未知形态不炸", () => {
    const flat = importDtcg({ color: { bg: "#111", odd: { foo: 1 } } });
    expect(flat.color.bg).toBe("#111");
    expect(flat.color.odd).toBeUndefined();
  });

  it("inferType：数字/其他", () => {
    expect(inferType("12")).toBe("number");
    expect(inferType("1.5rem")).toBe("dimension");
    expect(inferType("rgb(1,2,3)")).toBe("color");
    expect(inferType("600")).toBe("number");
    expect(inferType("sans-serif")).toBe("other");
  });
});
