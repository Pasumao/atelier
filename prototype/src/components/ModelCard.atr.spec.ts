/**
 * ModelCard.atr.spec.ts — 组件可执行验收（.atr.spec.ts 共置约定）。
 * 对应 ModelCard.atr.md 的「机检」条款；`atelier test` 门禁自动收集（vitest 默认 include *.spec.ts）。
 * 直接 import 组件文件导出的 schema——测的是真实契约，不是副本。
 */
import { describe, it, expect } from "vitest";
import { validateUnknown } from "../runtime";
import { modelCardSchema } from "./ModelCard.atr.ts";

const GOOD = {
  name: "deepseek-chat",
  badge: "V4 · 旗舰对话",
  tagline: "示例一句话简介",
  highlights: ["要点 A", "要点 B"],
};

function v(data: unknown) {
  return validateUnknown(modelCardSchema, data, "ModelCard");
}

describe("ModelCard.atr — 契约验收（decision 6 flat schema）", () => {
  it("合法载荷通过", () => {
    expect(v(GOOD).ok).toBe(true);
  });

  it("可选属性全部省略仍然合法", () => {
    expect(v({ ...GOOD }).ok).toBe(true);
  });

  it("可选属性 endpoint/accent 合法时通过", () => {
    expect(v({ ...GOOD, endpoint: "https://example.com", accent: "ok" }).ok).toBe(true);
  });

  it("缺必填属性 → ATR-201，fix 同时含缺失键与可用属性清单", () => {
    const r = v({ badge: "x", tagline: "y", highlights: [] });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.fix).toContain("name");
    expect(r.error?.context.hints).toContain("highlights");
  });

  it("必填属性类型错误 → ATR-201", () => {
    const r = v({ ...GOOD, name: 123 });
    expect(r.ok).toBe(false);
    expect(r.error?.fix).toContain("string");
  });

  it("highlights 非数组 → ATR-201", () => {
    const r = v({ ...GOOD, highlights: "应该是数组" });
    expect(r.ok).toBe(false);
    expect(r.error?.fix).toContain("array");
  });

  it("highlights 元素类型错误 → ATR-201", () => {
    const r = v({ ...GOOD, highlights: [1, 2] });
    expect(r.ok).toBe(false);
    expect(r.error?.fix).toContain("string");
  });

  it("accent 违反字面量枚举 → ATR-201，fix 列出合法判别值", () => {
    const r = v({ ...GOOD, accent: "purple" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-201");
    expect(r.error?.fix).toContain("primary");
    expect(r.error?.fix).toContain("warn");
  });

  it("非对象输入 → ATR-205（与 ATR-201 区分）", () => {
    const r = v("不是对象");
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ATR-205");
  });

  it("ATR 错误四段式齐备：code/message/context/fix（决策 9）", () => {
    const e = v({ badge: "x" }).error;
    expect(e).toBeDefined();
    expect(e!.code).toBeTypeOf("string");
    expect(e!.message.length).toBeGreaterThan(0);
    expect(e!.context.component).toBe("ModelCard");
    expect(e!.fix.length).toBeGreaterThan(0);
  });
});
