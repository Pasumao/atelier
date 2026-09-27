/**
 * schema 编译期提取 v1（决策 26）— compiler/extract-schema.mjs 扫描器测试。
 *
 * 映射面（决策 26）：string/number/boolean → {type}；Array<叶> → {type:"array",items}；
 * 字符串字面量联合（单双引号）→ {type:"string",enum}；`prop?: T` → optProps、`prop: T` → reqProps；
 * 属性分隔符逗号/分号都认。超面 = ATR-102 四段式显式拒绝（fix 指路手写 schema）；
 * 无注解/首参名非 props = 静默跳过 + warn（向后兼容，非错误）。
 * 扫描器纪律：纯文本扫描禁 TS 解析器、零 import 自包含；签名搜索引号/模板字面量/注释感知。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NODE_OK = (() => {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
})();
const DUMP = path.resolve(__dirname, "..", "compiler", "dump.mjs");

type ExtractMod = {
  extractComponentDecls: (src: string) => Array<{ name: string; offset: number }>;
  extractPropsSchemas: (src: string) => Array<{ name: string; schema: object | null; warn?: string }>;
};
async function mod(): Promise<ExtractMod> {
  return (await import("../compiler/extract-schema.mjs")) as unknown as ExtractMod;
}

/** 组装最小 .atr.ts 源文本：组件名 + 函数签名片段（sig 含首参注解或空参） */
const compSrc = (name: string, sig: string) =>
  [
    'import { component, html } from "atelier/runtime";',
    `export const ${name} = component(function ${name}${sig} {`,
    "  return html`<p>hi</p>`;",
    `}, { name: "${name}" });`,
  ].join("\n");

/** ATR-102 断言：code / message（含组件名+属性名+原文类型）/ fix 三段齐 */
async function expectATR102(src: string, compName: string, propName: string, typeText: string) {
  const { extractPropsSchemas } = await mod();
  let err: (Error & { code?: string; fix?: string }) | null = null;
  try {
    extractPropsSchemas(src);
  } catch (e) {
    err = e as Error & { code?: string; fix?: string };
  }
  expect(err, `期望 ATR-102 拒绝：${compName}.${propName}: ${typeText}`).toBeTruthy();
  expect(err!.code).toBe("ATR-102");
  expect(err!.message).toContain(compName);
  expect(err!.message).toContain(propName);
  expect(err!.message).toContain(typeText);
  expect(err!.fix).toContain("手写 schema");
}

describe("extractComponentDecls（自 dump.mjs 搬迁的单一真相）", () => {
  it("多组件：返回 [{name, offset}]，offset 指向 export 且单调递增", async () => {
    const { extractComponentDecls } = await mod();
    const src = [
      "export const A = component(function A() { return 1; });",
      "const mid = 42;",
      "export const B = component(function B() { return 2; });",
    ].join("\n");
    const decls = extractComponentDecls(src);
    expect(decls).toHaveLength(2);
    expect(decls[0].name).toBe("A");
    expect(decls[1].name).toBe("B");
    expect(decls[0].offset).toBeLessThan(decls[1].offset);
    expect(src.slice(decls[0].offset, decls[0].offset + 11)).toBe("export cons");
  });

  it("前缀混淆不命中：myComponent( / componentX( / 缺 export 都不命中", async () => {
    const { extractComponentDecls } = await mod();
    const src = [
      "export const x = myComponent(function x() {});",
      "export const y = componentX(function y() {});",
      "const z = component(function z() {});",
    ].join("\n");
    expect(extractComponentDecls(src)).toEqual([]);
  });
});

describe("extractPropsSchemas 映射矩阵（决策 26）", () => {
  it("三种叶子类型 → {type}（分号分隔 = ContractProbe 同款写法）", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("Leafy", "(props: { title: string; count: number; flag: boolean })"));
    expect(rs).toHaveLength(1);
    expect(rs[0].name).toBe("Leafy");
    expect(rs[0].schema).toEqual({
      type: "object",
      reqProps: { title: { type: "string" }, count: { type: "number" }, flag: { type: "boolean" } },
    });
    expect(rs[0].warn).toBeUndefined();
  });

  it("Array<叶> × 3 → {type:'array', items:{type}}", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("Arr", "(props: { a: Array<string>; b: Array<number>; c: Array<boolean> })"));
    expect(rs[0].schema).toEqual({
      type: "object",
      reqProps: {
        a: { type: "array", items: { type: "string" } },
        b: { type: "array", items: { type: "number" } },
        c: { type: "array", items: { type: "boolean" } },
      },
    });
  });

  it("字面量联合：单双引号混用 / 含逗号成员 / 退化单成员 → enum", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("U", `(props: { mode: "a" | 'b'; label?: "x,y" | "z"; kind: "only" })`));
    expect(rs[0].schema).toEqual({
      type: "object",
      reqProps: {
        mode: { type: "string", enum: ["a", "b"] },
        kind: { type: "string", enum: ["only"] },
      },
      optProps: { label: { type: "string", enum: ["x,y", "z"] } },
    });
  });

  it("可选/必传分桶；全可选时 reqProps 仍为空对象（对齐 FlatSchema 形状）", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("Opt", "(props: { title: string; note?: string; n?: number })"));
    expect(rs[0].schema).toEqual({
      type: "object",
      reqProps: { title: { type: "string" } },
      optProps: { note: { type: "string" }, n: { type: "number" } },
    });
    const allOpt = extractPropsSchemas(compSrc("AllOpt", "(props: { a?: string })"));
    expect(allOpt[0].schema).toEqual({ type: "object", reqProps: {}, optProps: { a: { type: "string" } } });
  });

  it("空注解 {} → {type:'object', reqProps:{}}（optProps 空时省略）", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("Empty", "(props: {})"));
    expect(rs[0].schema).toEqual({ type: "object", reqProps: {} });
  });

  it("多属性混合：逗号分隔 + 多行注解", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("Mix", "(props: {\n  title: string,\n  tags: Array<string>,\n  mode: 'x' | \"y\",\n  note?: string,\n})"));
    expect(rs[0].schema).toEqual({
      type: "object",
      reqProps: {
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        mode: { type: "string", enum: ["x", "y"] },
      },
      optProps: { note: { type: "string" } },
    });
  });

  it("多组件同文件各取各的注解；无注解组件不串味", async () => {
    const { extractPropsSchemas } = await mod();
    const src = [compSrc("A", "(props: { title: string })"), compSrc("B", "()")].join("\n");
    const rs = extractPropsSchemas(src);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ name: "A", schema: { type: "object", reqProps: { title: { type: "string" } } } });
    expect(rs[1].name).toBe("B");
    expect(rs[1].schema).toBeNull();
    expect(rs[1].warn).toContain("B");
  });
});

const REJECTS: Array<[string, string, string]> = [
  ["泛型", "Result<T>", "data"],
  ["嵌套数组", "Array<Array<string>>", "matrix"],
  ["含非字面量成员的联合", "string | number", "id"],
  ["交叉类型", "A & B", "both"],
  ["工具类型", "Partial<T>", "draft"],
  ["嵌套对象", "{ a: { b: string } }", "nested"],
  ["any", "any", "x"],
  ["unknown", "unknown", "y"],
  ["模板字面量类型", "`a-${string}`", "tag"],
];

describe("extractPropsSchemas 拒绝矩阵（ATR-102 四段式）", () => {
  it.each(REJECTS)("%s: %s → ATR-102（code/message/fix + 组件名与属性名）", async (_label, annot, prop) => {
    await expectATR102(compSrc("Bad", `(props: { ${prop}: ${annot} })`), "Bad", prop, annot);
  });
});

describe("extractPropsSchemas 跳过路径（向后兼容，非错误）", () => {
  it("无注解 component(function X() {...}) → schema null + warn", async () => {
    const { extractPropsSchemas } = await mod();
    const rs = extractPropsSchemas(compSrc("Plain", "()"));
    expect(rs[0].schema).toBeNull();
    expect(rs[0].warn).toContain("Plain");
    expect(rs[0].warn).toContain("props");
  });

  it("参数名非 props（state: {...}）→ schema null + warn，绝不取他人注解", async () => {
    const { extractPropsSchemas } = await mod();
    const src = [compSrc("Stateful", "(state: { count: number })"), compSrc("Next", "(props: { title: string })")].join("\n");
    const rs = extractPropsSchemas(src);
    expect(rs[0].name).toBe("Stateful");
    expect(rs[0].schema).toBeNull();
    expect(rs[0].warn).toBeTruthy();
    expect(rs[1].schema).toEqual({ type: "object", reqProps: { title: { type: "string" } } });
  });
});

describe("extractPropsSchemas 恶劣输入（扫描器守卫钉桩）", () => {
  it("字符串与模板文本里的假注解不命中（引号/模板感知签名搜索）", async () => {
    const { extractPropsSchemas } = await mod();
    const src = [
      'import { component, html } from "atelier/runtime";',
      "export const S = component(function S() {",
      '  const s = "(props: { fake: string })";',
      "  return html`<p>(props: { fake2: string }) ${s}</p>`;",
      '}, { name: "S" });',
    ].join("\n");
    const rs = extractPropsSchemas(src);
    expect(rs[0].name).toBe("S");
    expect(rs[0].schema).toBeNull();
    expect(rs[0].warn).toBeTruthy();
  });

  it("注释掉的 component：decl 照旧命中（遗留行为），签名搜索注释感知 → null + warn 不抛错", async () => {
    const { extractPropsSchemas } = await mod();
    const src = "// export const Ghost = component(function Ghost(props: { a: string }) {});";
    const rs = extractPropsSchemas(src);
    expect(rs).toHaveLength(1);
    expect(rs[0].name).toBe("Ghost");
    expect(rs[0].schema).toBeNull();
  });

  it("注解内块注释照切不剥离 → 无法精确映射 → ATR-102（不静默误映射）", async () => {
    await expectATR102(compSrc("C", "(props: { title: string /* the title */ })"), "C", "title", "string /* the title */");
  });

  it("注解内行注释照切不剥离 → ATR-102（不静默误映射）", async () => {
    const { extractPropsSchemas } = await mod();
    let err: (Error & { code?: string }) | null = null;
    try {
      extractPropsSchemas(compSrc("C", "(props: { // the props\n  title: string })"));
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err?.code).toBe("ATR-102");
    expect(err?.message).toContain("C");
  });
});

describe("extractPropsSchemas 注解体闭合后的尾检查（P1-7：交叉/联合绝不静默截断）", () => {
  it("顶层交叉类型：首对象之外的 & {…} 残留 → ATR-102，绝不静默产出缺字段 schema", async () => {
    const { extractPropsSchemas } = await mod();
    let err: (Error & { code?: string; fix?: string }) | null = null;
    try {
      extractPropsSchemas(compSrc("Crossed", "(props: { title: string } & { extra: number })"));
    } catch (e) {
      err = e as Error & { code?: string; fix?: string };
    }
    expect(err, "交叉类型首成员之外的残留必须显式拒绝（修复前静默截断为只含 title 的错 schema 流入 AST/dev 面/编译产物）").toBeTruthy();
    expect(err!.code).toBe("ATR-102");
    expect(err!.message).toContain("Crossed");
    expect(err!.message).toContain("& { extra: number }");
    expect(err!.fix).toContain("手写 schema");
  });

  it("顶层联合类型：| {…} 残留 → ATR-102（同缺口同口径）", async () => {
    const { extractPropsSchemas } = await mod();
    let err: (Error & { code?: string }) | null = null;
    try {
      extractPropsSchemas(compSrc("Unioned", "(props: { a: string } | { b: number })"));
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err, "联合类型首成员之外的残留必须显式拒绝").toBeTruthy();
    expect(err!.code).toBe("ATR-102");
    expect(err!.message).toContain("Unioned");
    expect(err!.message).toContain("| { b: number }");
  });

  it("回归：单对象注解（含多行、参数列表紧随闭合）不受尾检查影响", async () => {
    const { extractPropsSchemas } = await mod();
    const single = extractPropsSchemas(compSrc("Ok", "(props: { title: string })"));
    expect(single[0].schema).toEqual({ type: "object", reqProps: { title: { type: "string" } } });
    const multiline = extractPropsSchemas(compSrc("OkMulti", "(props: {\n  title: string;\n  count?: number;\n})"));
    expect(multiline[0].schema).toEqual({
      type: "object",
      reqProps: { title: { type: "string" } },
      optProps: { count: { type: "number" } },
    });
  });
});

describe("dump.mjs 接线（CLI 子进程冒烟，决策 26 产物字段）", () => {
  const buildApp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-schema-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "Mix.atr.ts"),
      [
        'import { component, html } from "atelier/runtime";',
        "export const Tagged = component(function Tagged(props: { title: string; count?: number }) {",
        "  return html`<p>{props.title}</p>`;",
        '}, { name: "Tagged" });',
        "export const Plain = component(function Plain() {",
        "  return html`<span>plain</span>`;",
        '}, { name: "Plain" });',
      ].join("\n"),
    );
    return dir;
  };

  it("--stdout：带注解组件带 schema 字段且值正确；无注解组件无该字段（纯加法）", (ctx) => {
    if (!NODE_OK) return ctx.skip();
    const dir = buildApp();
    try {
      const r = spawnSync(process.execPath, [DUMP, "--root", dir, "--stdout"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.components).toHaveLength(2);
      const tagged = out.components.find((c: { name: string }) => c.name === "Tagged");
      const plain = out.components.find((c: { name: string }) => c.name === "Plain");
      expect(tagged.schema).toEqual({
        type: "object",
        reqProps: { title: { type: "string" } },
        optProps: { count: { type: "number" } },
      });
      expect("schema" in plain).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("落盘产物：<Component>.json 携带 schema；index.json 形状不变", (ctx) => {
    if (!NODE_OK) return ctx.skip();
    const dir = buildApp();
    try {
      const r = spawnSync(process.execPath, [DUMP, "--root", dir], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const tagged = JSON.parse(fs.readFileSync(path.join(dir, ".atr", "ast", "Tagged.json"), "utf8"));
      const plain = JSON.parse(fs.readFileSync(path.join(dir, ".atr", "ast", "Plain.json"), "utf8"));
      expect(tagged.schema).toEqual({
        type: "object",
        reqProps: { title: { type: "string" } },
        optProps: { count: { type: "number" } },
      });
      expect("schema" in plain).toBe(false);
      const index = JSON.parse(fs.readFileSync(path.join(dir, ".atr", "ast", "index.json"), "utf8"));
      expect(index.components).toHaveLength(2);
      expect("schema" in index.components[0]).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ATR-102：exit 1 + stderr 四段式（code + fix 指路手写 schema）", (ctx) => {
    if (!NODE_OK) return ctx.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-schema-bad-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "Bad.atr.ts"),
      [
        'import { component, html } from "atelier/runtime";',
        "export const Bad = component(function Bad(props: { data: Result<T> }) {",
        "  return html`<p>hi</p>`;",
        '}, { name: "Bad" });',
      ].join("\n"),
    );
    try {
      const r = spawnSync(process.execPath, [DUMP, "--root", dir, "--stdout"], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("ATR-102");
      expect(r.stderr).toContain("Bad");
      expect(r.stderr).toContain("data");
      expect(r.stderr).toContain("手写 schema");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
