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
