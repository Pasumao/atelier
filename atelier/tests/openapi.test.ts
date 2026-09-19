/**
 * openapi.test.ts — FS-9 OpenAPI 导出 + §2.4 扁平投影器验收。
 *   · 投影器：FlatSchema → JSON Schema（draft-2020-12 / openapi-3.0 两 target，golden 快照）
 *   · ATR-107 红检：超出扁平语义的结构（$ref/oneOf/allOf/未知键/嵌套数组…）显式 throw，绝不静默降级
 *   · 与 validateFlat 同源一致性：投影结果 round-trip（合法/非法数据两侧判定一致）
 *   · export openapi 端到端：paths/method/required/x-atelier 扩展/restful GET 映射/无 output 注记/
 *     契约引用缺失显式报错
 */
import { describe, expect, it } from "vitest";
import { projectJsonSchema } from "../compiler/project-json.mjs";

function atrOf(fn: () => unknown): { code: string; message: string; context: Record<string, unknown>; fix: string } {
  try {
    fn();
  } catch (e) {
    return e as never;
  }
  throw new Error("期望投影器 throw，实际未抛");
}

describe("投影器 ATR-107 红检（§2.4：超出扁平语义显式 throw，先红后绿）", () => {
  it("$ref / oneOf / allOf / not → ATR-107 四段式，fix 指路扁平形态", () => {
    for (const key of ["$ref", "oneOf", "allOf", "not"]) {
      const err = atrOf(() => projectJsonSchema({ type: "object", reqProps: { a: { type: "string" } }, [key]: {} } as never, "draft-2020-12"));
      expect(err.code, key).toBe("ATR-107");
      expect(err.fix, key).toContain("扁平");
    }
  });

  it("叶子上的 $ref/oneOf、未知键 → ATR-107；对象叶子 type → ATR-107", () => {
    const leafCases: Array<Record<string, unknown>> = [
      { type: "string", $ref: "#/x" },
      { type: "string", oneOf: [{ type: "string" }] },
      { type: "string", unknownKey: 1 },
      { type: "object" },
      { type: "integer" },
    ];
    for (const leaf of leafCases) {
      const err = atrOf(() => projectJsonSchema({ type: "object", reqProps: { a: leaf } } as never, "draft-2020-12"));
      expect(err.code, JSON.stringify(leaf)).toBe("ATR-107");
    }
  });

  it("嵌套数组（items 为 array）与 items 携带约束 → ATR-107（validateFlat 只对元素做类型检查）", () => {
    const nested = atrOf(() =>
      projectJsonSchema({ type: "object", reqProps: { a: { type: "array", items: { type: "array" } } } } as never, "draft-2020-12")
    );
    expect(nested.code).toBe("ATR-107");
    const constrained = atrOf(() =>
      projectJsonSchema({ type: "object", reqProps: { a: { type: "array", items: { type: "string", min: 1 } } } } as never, "draft-2020-12")
    );
    expect(constrained.code).toBe("ATR-107");
  });

  it("boolean 挂 min/max、非 string 挂 pattern、空 enum、非法正则、req/opt 冲突 → ATR-107", () => {
    const cases: Array<{ type: "object"; reqProps: Record<string, unknown> }> = [
      { type: "object", reqProps: { a: { type: "boolean", min: 1 } } },
      { type: "object", reqProps: { a: { type: "number", pattern: "^x" } } },
      { type: "object", reqProps: { a: { type: "string", enum: [] } } },
      { type: "object", reqProps: { a: { type: "string", pattern: "[" } } },
      { type: "object", reqProps: { a: { type: "string" } }, optProps: { a: { type: "string" } } },
    ];
    for (const flat of cases) {
      const err = atrOf(() => projectJsonSchema(flat as never, "draft-2020-12"));
      expect(err.code, JSON.stringify(flat)).toBe("ATR-107");
    }
  });
});
