/**
 * P0-2 stage ② AST dump — compiler tests.
 * Acceptance shape (BACKLOG): the dump and the runtime interpreter must see the SAME tree
 * for the same template string (single parser, single truth), and the literal scanner must
 * survive interpolation nesting, nested backticks and escapes.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTemplate } from "../runtime/template.ts";

const NODE_OK = (() => {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
})();
const DUMP = path.resolve(__dirname, "..", "compiler", "dump.mjs");

const BT = String.fromCharCode(96); // backtick — avoids backtick-in-literal escaping ambiguity

describe("extractHtmlLiterals (scanner)", () => {
  it("finds html`` literals across interpolation, nested backticks and escapes", async () => {
    const { extractHtmlLiterals } = await import("../compiler/dump.mjs");
    const src = [
      "const a = html" + BT + "<p>{x}</p>" + BT + ";",
      // valid JS double nesting: the inner template literal lives INSIDE ${…}, not beside it
      'const b = html' + BT + "<div label=${" + BT + "${count.value} items" + BT + "}>esc:" + "\\" + BT + "ok</div>" + BT + ";",
      "const notThis = someHtml" + BT + "<span>not tagged html</span>" + BT + ";",
    ].join("\n");
    const lits = extractHtmlLiterals(src);
    expect(lits).toHaveLength(2);
    expect(lits[0].raw).toBe("<p>{x}</p>");
    // raw keeps the escape sequence verbatim: backslash + backtick are both part of the literal text
    expect(lits[1].raw).toBe("<div label=${" + BT + "${count.value} items" + BT + "}>esc:\\" + BT + "ok</div>");
  });

  it("throws a structured error on unterminated literals", async () => {
    const { extractHtmlLiterals } = await import("../compiler/dump.mjs");
    expect(() => extractHtmlLiterals("const a = html" + BT + "<p>oops")).toThrow(/unterminated/);
  });
});

/* ---- P1-5（第三遍架构复校 §1）：stage② 扫描器注释/字符串免疫（codeMask） ----
 * 背景：extractHtmlLiterals 裸 indexOf("html`")（dump.mjs:72）+ ownerOf 用 regex 命中 decls
 * 不查 codeMask——注释掉的 html`…` 产幻影模板（含未闭合块时整场 dump hard die）；注释里的
 * html` 未闭合块会把下一个真模板整体吞掉；注释掉的 export const X = component( 产幻影 owner。
 * 修法：extract-schema.mjs codeMaskOf 单遍状态机导入 dump 面——命中位/decl 位查 mask，
 * mask 误命中 → warn 跳过（extract-schema.mjs 同款先例）。 */
describe("P1-5：stage② 扫描器注释/字符串免疫（codeMask）", () => {
  it("红检①：注释掉的模板（含未闭合块）不产幻影、不 hard die", async () => {
    const { extractHtmlLiterals } = await import("../compiler/dump.mjs");
    const src = [
      "export const A = component(function A() {",
      "  return html" + BT + "<p>a</p>" + BT + ";",
      "});",
      "// const Dead = component(function Dead() {",
      "//   return html" + BT + "<p>unterminated-in-comment", // 注释内反引号永不闭合
      "// });",
    ].join("\n");
    const lits = extractHtmlLiterals(src);
    expect(lits, "只认真实代码区的 html`——注释内的未闭合块不得产幻影，更不得让整场 dump hard die").toHaveLength(1);
    expect(lits[0].raw).toBe("<p>a</p>");
  });

  it("红检②：注释里的未闭合 html` 不吞下一个真模板", async () => {
    const { extractHtmlLiterals } = await import("../compiler/dump.mjs");
    const src = [
      "export const A = component(function A() {",
      "  return html" + BT + "<p>a</p>" + BT + ";",
      "});",
      "// dead: html" + BT + " never closed in this comment", // 修复前：扫描器从此处吞到 B 的开引号
      "export const B = component(function B() {",
      "  return html" + BT + "<p>b</p>" + BT + ";",
      "});",
    ].join("\n");
    const lits = extractHtmlLiterals(src);
    expect(lits.map((l) => l.raw), "真模板 B 不得被注释垃圾吞掉").toEqual(["<p>a</p>", "<p>b</p>"]);
  });

  it("红检③：注释掉的 component( 声明不产幻影 owner（模板归属不漂移）", async () => {
    const { extractComponentDecls } = await import("../compiler/extract-schema.mjs");
    const { extractHtmlLiterals } = await import("../compiler/dump.mjs");
    const src = [
      "export const A = component(function A() {",
      "  return html" + BT + "<p>a</p>" + BT + ";",
      "});",
      "// export const Ghost = component(function Ghost() {",
      "//   return html" + BT + "<p>ghost</p>" + BT + ";", // 注释内自闭合——修复前产幻影模板归到 A 名下
      "// });",
      "export const B = component(function B() {",
      "  return html" + BT + "<p>b</p>" + BT + ";",
      "});",
    ].join("\n");
    const decls = extractComponentDecls(src).map((d) => d.name);
    expect(decls).toEqual(["A", "Ghost", "B"]); // regex 面照旧全量命中（extractPropsSchemas 消费）
    const lits = extractHtmlLiterals(src);
    expect(lits.map((l) => l.raw), "注释内的自闭合模板不进字面量面——A 名下不得挂上 ghost 模板").toEqual(["<p>a</p>", "<p>b</p>"]);
    // owner 映射（dump main 同款序）：每个字面量的最近真实（非注释）decl
    const realDecls = [
      { name: "A", offset: src.indexOf("export const A") },
      { name: "B", offset: src.indexOf("export const B") },
    ];
    const ownerOf = (offset: number) => {
      let owner: string | null = null;
      for (const d of realDecls) {
        if (d.offset < offset) owner = d.name;
        else break;
      }
      return owner;
    };
    expect(lits.map((l) => ownerOf(l.offset))).toEqual(["A", "B"]);
  });

  it("红检④（全链）：注释 decl + 注释模板经 dump CLI 不落幻影组件/幻影模板", (ctx) => {
    if (!NODE_OK) return ctx.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-dump-mask-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "src", "Masked.atr.ts"),
        [
          'import { component, html } from "atelier/runtime";',
          "export const Live = component(function Live() {",
          "  return html`<section>live</section>`;",
          "});",
          "// export const Ghost = component(function Ghost() {",
          "//   return html`<section>ghost</section>`;",
          "// });",
        ].join("\n"),
        "utf8",
      );
      const r = spawnSync(process.execPath, [DUMP, "--root", dir, "--stdout"], { encoding: "utf8" });
      expect(r.status, `dump 不得因注释内模板 hard die：${r.stderr}`).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.components.map((c: { name: string }) => c.name), "幻影组件不进 index").toEqual(["Live"]);
      expect(out.components[0].templates, "幻影模板不挂到真实组件名下").toHaveLength(1);
      expect(out.components[0].templates[0].raw).toBe("<section>live</section>");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stage ② dump ↔ runtime parser identity", () => {
  it("parseTemplate sees the same tree the dump serializes", () => {
    const raw = `
      <Panel title={props.title}>
        {#if count.value > 0}
          <span class="badge">{count.value}</span>
        {:else}
          <span class="muted">zero</span>
        {/if}
        {#each items.value as it, i by it.id}
          <li on:click={() => pick(i)}>{it.name}</li>
        {/each}
      </Panel>
    `;
    const ast = parseTemplate(raw);
    const round = JSON.parse(JSON.stringify(ast));
    expect(round).toEqual(ast);
    // structural spot checks (the interpreter subsets the compiler must preserve)
    const panel = ast[1];
    expect(panel).toMatchObject({ kind: "element", tag: "Panel", component: true });
    const ifNode = panel.children.find((n) => n.kind === "if");
    expect(ifNode.blocks).toHaveLength(2);
    expect(ifNode.blocks[0].test).toContain("count.value");
    const eachNode = panel.children.find((n) => n.kind === "each");
    expect(eachNode).toMatchObject({ item: "it", index: "i", keyExpr: "it.id" });
    const li = eachNode.children.find((n) => n.kind === "element");
    expect(li?.tag).toBe("li");
    expect(li?.attrs.find((a) => a.name === "on:click")?.dynamic).toBe(true);
  });

  it("end-to-end: dump.mjs --stdout produces trees identical to parseTemplate", (ctx) => {
    if (!NODE_OK) return ctx.skip(); // needs native TS type stripping (CI matrix: node 22/24)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-dump-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "Widget.atr.ts"),
      [
        'import { component, html } from "atelier/runtime";',
        "export const Widget = component(function Widget(props: { title: string }) {",
        "  return html`<section><h2>{props.title}</h2>{#if props.flag}<b>{props.n}</b>{/if}</section>`.locals({ props });",
        '}, { name: "Widget", schema: { type: "object", reqProps: { title: { type: "string" } }, optProps: {} } });',
      ].join("\n"),
    );
    const r = spawnSync(process.execPath, [DUMP, "--root", dir, "--stdout"], { encoding: "utf8" });
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.status !== 0) throw new Error(`dump failed: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    expect(out.components).toHaveLength(1);
    const c = out.components[0];
    expect(c.name).toBe("Widget");
    const ast = parseTemplate(c.templates[0].raw);
    expect(c.templates[0].ast).toEqual(JSON.parse(JSON.stringify(ast)));
  });
});

/* ---- R1-C：stage ② dump 产物 regen 字节幂等（generatedAt 时间戳 + 绝对 root 已入 git 实证曾被打破） ---- */
describe("stage ② dump regen 字节幂等（R1-C：去 generatedAt/绝对 root）", () => {
  it("同一输入两次 dump 落盘逐字节一致；index/组件/stdout 产物不含 generatedAt 与绝对 root", async (ctx) => {
    if (!NODE_OK) return ctx.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-dump-idem-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "src", "Widget.atr.ts"),
        [
          'import { component, html } from "atelier/runtime";',
          "export const Widget = component(function Widget(props: { title: string }) {",
          "  return html`<section><h2>{props.title}</h2></section>`;",
          '}, { name: "Widget", schema: { type: "object", reqProps: { title: { type: "string" } }, optProps: {} } });',
        ].join("\n"),
      );
      const run = () => {
        const r = spawnSync(process.execPath, [DUMP, "--root", dir], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`dump failed: ${r.stderr}`);
      };
      const readAll = () =>
        [".atr/ast/index.json", ".atr/ast/Widget.json"].map((rel) => fs.readFileSync(path.join(dir, rel), "utf8"));
      run();
      const first = readAll();
      await new Promise((r) => setTimeout(r, 25)); // generatedAt 为 ms 精度——跨 25ms 再跑，时间戳必不同
      run();
      const second = readAll();
      expect(second, "regen 必须字节幂等（修复前 generatedAt 时间戳使两次产物必然漂移）").toEqual(first);
      const index = JSON.parse(first[0]);
      expect(index.generatedAt, "index.json 不含时间戳（跨机器/跨时点 regen 零漂移）").toBeUndefined();
      expect(index.root, "index.json 不含绝对 root（跨机器漂移源；codegen --ast 仅以 index.json 为存在哨兵，实读不消费该字段）").toBeUndefined();
      expect(JSON.parse(first[1]).generatedAt).toBeUndefined();
      const stdout = spawnSync(process.execPath, [DUMP, "--root", dir, "--stdout"], { encoding: "utf8" });
      if (stdout.status !== 0) throw new Error(`dump --stdout failed: ${stdout.stderr}`);
      const agg = JSON.parse(stdout.stdout);
      expect(agg.generatedAt).toBeUndefined();
      expect(agg.root).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ---- F-2 二期：构建期静态依赖图（决策 3「不跑应用即可查询」） ---- */
describe("buildGraph + codegen --graph-only (F-2 phase 2)", () => {
  const RAW = `
    <section>
      <h2>{props.title}</h2>
      {#if count.value > 0}<b>{count.value}</b>{/if}
      <button on:click={inc}>+1</button>
    </section>
  `;

  it("buildGraph：组件级桶与 compileFunction 单模板清单一致（单源不二）", async () => {
    const { buildGraph, compileFunction } = await import("../compiler/codegen.mjs");
    const g = buildGraph("Widget", [RAW]);
    expect(g).toMatchObject({ component: "Widget", schema: "atelier-graph/0.1" });
    const single = compileFunction("Widget", RAW).deps;
    expect(g.deps).toEqual(single);
    expect(g.deps.reactive).toContain("props");
    expect(g.deps.reactive).toContain("count");
    expect(g.deps.events).toContain("inc");
  });

  it("buildGraph：多模板取并集；空桶保留", async () => {
    const { buildGraph } = await import("../compiler/codegen.mjs");
    const g = buildGraph("Pair", ["<i>{a.value}</i>", "<b on:click={go}>{props.x}</b>"]);
    expect(g.deps.reactive.sort()).toEqual(["a", "props"]);
    expect(g.deps.events).toEqual(["go"]);
  });

  it("end-to-end: dump → codegen --graph-only 零落盘出合并图", (ctx) => {
    if (!NODE_OK) return ctx.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atr-graph-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "Widget.atr.ts"),
      [
        'import { component, html } from "atelier/runtime";',
        "export const Widget = component(function Widget(props: { title: string }) {",
        "  return html`<section><h2>{props.title}</h2></section>`;",
        '}, { name: "Widget", schema: { type: "object", reqProps: { title: { type: "string" } }, optProps: {} } });',
      ].join("\n"),
    );
    try {
      const dump = spawnSync(process.execPath, [DUMP, "--root", dir], { encoding: "utf8" });
      if (dump.status !== 0) throw new Error(`dump failed: ${dump.stderr}`);
      const codegen = path.resolve(__dirname, "..", "compiler", "codegen.mjs");
      const r = spawnSync(process.execPath, [codegen, "--ast", path.join(dir, ".atr", "ast"), "--graph-only", "--quiet"], {
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`codegen failed: ${r.stderr}`);
      const out = JSON.parse(r.stdout);
      expect(out.schema).toBe("atelier-graph/0.1");
      expect(out.components).toHaveLength(1);
      expect(out.components[0].deps.reactive).toContain("props");
      // 零落盘承诺：不产生 compiled/ 或 graph/ 目录
      expect(fs.existsSync(path.join(dir, ".atr", "compiled"))).toBe(false);
      expect(fs.existsSync(path.join(dir, ".atr", "graph"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
