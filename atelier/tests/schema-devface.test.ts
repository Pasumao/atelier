/**
 * schema-devface.test.ts — 决策 26 schema 编译期提取 v1 · C 分支（dev 面接线）单测。
 *
 * 被测件 = dev 插件 .atr.ts transform 的注入行为（dev/atelier-dev-plugin.mjs）：
 *   注入形态（prepend registerExtractedSchemas + runtime 相对路径）· 映射为空注入零变化 ·
 *   schema:null 条目跳过 · ATR-102 原样上抛 · 相对路径形态（src 深度）· src 外 warn+跳过 ·
 *   非 .atr.ts / node_modules 零影响（既有早退分支）· HMR 尾巴逻辑不动。
 *
 * 桩策略（「用桩目录」）：插件经 ROOT（process.cwd()，与 dev-token/audit/manifest 同一约定）惰性
 * 动态 import <app>/scripts/compiler/extract-schema.mjs——每个用例 mkdtemp 独立 fixture，在其中落
 * 一份行为受控的零依赖桩提取器（独立路径 = 独立 ESM 模块实例，互不串台），chdir 建插件实例后调用
 * transform（插件 ROOT 在工厂期捕获，transform 期 cwd 无关）。真实提取器的解析语义归 schema 批 A
 * 的测试田，本文件只钉 C 分支接线本身。
 *
 * 先红后绿注记：本文件当场绿（桩自给，不依赖 A/B 合并）；vendored 应用闭环的端到端机检在
 * templates/app/src/components/SchemaProbe.atr.spec.ts（已知红清单见其文件头与本批提交信息）。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HMR_TAIL =
  "\n;if (import.meta.hot) import.meta.hot.accept(() => { try { window.__ATELIER_HMR_REMOUNT__?.(); } catch (e) { console.error('[atelier] HMR remount failed', e); } });\n";

const INJECT_STUB = `
export function extractComponentDecls() { return []; }
export function extractPropsSchemas(code) {
  if (code.includes("SCHEMA_NULL")) return [{ name: "Nullish", schema: null }];
  return [{ name: "SchemaProbe", schema: { type: "object", reqProps: { label: { type: "string" } }, optProps: { times: { type: "number" } } } }];
}
`;
const EMPTY_STUB = "export function extractPropsSchemas() { return []; }\n";
const ATR102_STUB = `
export function extractPropsSchemas() {
  const e = new Error("props 注解类型超出提取映射面（泛型/交叉/工具类型/非字面量联合/嵌套对象/any/unknown）");
  e.code = "ATR-102";
  e.context = { prop: "data" };
  e.fix = "该 prop 改手写 schema（component opts.schema）";
  throw e;
}
`;

const fixtures: string[] = [];
afterAll(() => {
  for (const d of fixtures) fs.rmSync(d, { recursive: true, force: true });
});

/** 独立 fixture 应用根（src/runtime + 行为受控桩提取器）→ chdir 建插件（ROOT 工厂期捕获）后还原 cwd */
async function makeFixture(stubSource: string): Promise<{ root: string; plugin: any }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-schema-devface-"));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, "src", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "runtime", "index.ts"), "export {};\n", "utf8");
  fs.mkdirSync(path.join(root, "scripts", "compiler"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "compiler", "extract-schema.mjs"), stubSource, "utf8");
  const prevCwd = process.cwd();
  process.chdir(root);
  try {
    const { atelierDevPlugin } = await import("../dev/atelier-dev-plugin.mjs");
    return { root, plugin: atelierDevPlugin() };
  } finally {
    process.chdir(prevCwd);
  }
}

const COMPONENT_CODE = `import { component, html } from "../runtime";
export const SchemaProbe = component(function SchemaProbe(props: { label: string }) {
  return html\`<p>{props.label}</p>\`.locals({ props });
}, { name: "SchemaProbe" });
`;

describe("决策 26 dev 面接线：.atr.ts transform 的 schema 提取注入", () => {
  it("非 null schema 条目 → prepend registerExtractedSchemas（相对 ../runtime + JSON 映射）+ HMR 尾巴原位", async () => {
    const { root, plugin } = await makeFixture(INJECT_STUB);
    const id = path.join(root, "src", "components", "SchemaProbe.atr.ts");
    const r = await plugin.transform(COMPONENT_CODE, id);
    expect(r).not.toBeNull();
    const out = (r as { code: string }).code;
    // prepend 形态：注册 import 在最前 + 映射 JSON 单行调用
    const m = /^import \{ registerExtractedSchemas as __atelierRs \} from "(.+?)";\n__atelierRs\((.+?)\);\n/.exec(out);
    expect(m, "注入段形态：import … as __atelierRs + __atelierRs(<json>)").not.toBeNull();
    expect(m![1]).toBe("../runtime"); // src/components → src/runtime/index.ts（去 index.ts，与既有组件 import 同型）
    expect(JSON.parse(m![2])).toEqual({
      SchemaProbe: { type: "object", reqProps: { label: { type: "string" } }, optProps: { times: { type: "number" } } },
    });
    // prepend 序：注入段 + 原始 code 原样 + HMR 尾巴（既有逻辑不动）
    expect(out.startsWith(m![0])).toBe(true);
    expect(out.slice(m![0].length, out.length - HMR_TAIL.length)).toBe(COMPONENT_CODE);
    expect(out.endsWith(HMR_TAIL)).toBe(true);
  });

  it("映射为空 → 注入零变化（负例钉住：无 registerExtractedSchemas 行，仅既有 HMR 尾巴）", async () => {
    const { root, plugin } = await makeFixture(EMPTY_STUB);
    const id = path.join(root, "src", "components", "Plain.atr.ts");
    const r = (await plugin.transform(COMPONENT_CODE, id)) as { code: string };
    expect(r).not.toBeNull();
    expect(r.code).toBe(COMPONENT_CODE + HMR_TAIL);
    expect(r.code).not.toContain("registerExtractedSchemas");
  });

  it("schema:null 条目（注解缺省）跳过 → 与空映射同样零变化；import.meta.hot 既有早退分支保持 null", async () => {
    const { root, plugin } = await makeFixture(INJECT_STUB);
    const id = path.join(root, "src", "components", "Nullish.atr.ts");
    const nullCode = COMPONENT_CODE + "// SCHEMA_NULL\n"; // 桩的受控信号：该文件条目 schema=null
    const r = (await plugin.transform(nullCode, id)) as { code: string };
    expect(r.code).toBe(nullCode + HMR_TAIL);
    expect(r.code).not.toContain("registerExtractedSchemas");
    // 既有早退：code 自带 import.meta.hot → 无注入时返回 null（不重复包尾巴）
    const hot = (await plugin.transform("export const x = 1; // import.meta.hot\n// SCHEMA_NULL", id)) as never;
    expect(hot).toBeNull();
  });

  it("ATR-102 → transform 原样上抛（Vite overlay 即红：code/message/context/fix 四段不吞不改）", async () => {
    const { root, plugin } = await makeFixture(ATR102_STUB);
    const id = path.join(root, "src", "components", "Bad.atr.ts");
    await expect(plugin.transform(COMPONENT_CODE, id)).rejects.toMatchObject({
      code: "ATR-102",
      message: expect.stringContaining("超出提取映射面"),
      context: { prop: "data" },
      fix: expect.stringContaining("手写 schema"),
    });
  });

  it("相对路径形态随 src 深度：src 根 → ./runtime，深层 → 多级 ../runtime", async () => {
    const { root, plugin } = await makeFixture(INJECT_STUB);
    for (const [relDir, expected] of [
      ["src", "./runtime"],
      ["src/a/b", "../../runtime"],
    ] as const) {
      const id = path.join(root, relDir, "Deep.atr.ts");
      const r = (await plugin.transform(COMPONENT_CODE, id)) as { code: string };
      expect(r.code, `${relDir}/X.atr.ts → ${expected}`).toContain(`from "${expected}"`);
    }
  });

  it("src 外文件 → 解析失败：跳过注入 + console.warn（诚实不静默）", async () => {
    const { root, plugin } = await makeFixture(INJECT_STUB);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const id = path.join(root, "other", "Outside.atr.ts");
      const r = (await plugin.transform(COMPONENT_CODE, id)) as { code: string };
      expect(r.code).toBe(COMPONENT_CODE + HMR_TAIL); // 既有 HMR 尾巴照常
      expect(r.code).not.toContain("registerExtractedSchemas");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("src/runtime");
    } finally {
      warn.mockRestore();
    }
  });

  it("非 .atr.ts / node_modules 内 .atr.ts → 零影响（既有早退分支保持）", async () => {
    const { root, plugin } = await makeFixture(INJECT_STUB);
    expect(await plugin.transform("const x = 1;", path.join(root, "src", "components", "Foo.ts"))).toBeNull();
    expect(
      await plugin.transform(COMPONENT_CODE, path.join(root, "node_modules", "pkg", "X.atr.ts")),
    ).toBeNull();
  });
});
