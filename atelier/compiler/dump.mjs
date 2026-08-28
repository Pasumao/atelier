#!/usr/bin/env node
/**
 * dump.mjs — Atelier compiler stage ② (P0-2): .atr.ts → expanded template AST JSON.
 *
 * Stage ① (Template parse cache) lives in runtime/template.ts. This stage reuses THE SAME
 * parser (single source of truth: what the compiler dumps is what the interpreter runs)
 * and walks every *.atr.ts in an app, dumping each exported component's html``
 * templates as JSON:
 *
 *   <root>/.atr/ast/<Component>.json   per-component: raw strings + parsed ASTs
 *   <root>/.atr/ast/index.json         aggregate index for stage ③ (codegen)
 *
 * Stage ③ (static effect-graph codegen) will consume index.json; acceptance for ② is
 * structural: dump(whole file) === parseTemplate(raw) for every extracted literal
 * (asserted in tests/compiler.test.ts).
 *
 * Usage:
 *   node atelier/compiler/dump.mjs --root <appDir> [--out <dir>] [--stdout] [--quiet]
 *     --root    app dir containing *.atr.ts (default: cwd)
 *     --out     output dir (default: <root>/.atr/ast)
 *     --stdout  print the aggregate dump as JSON instead of writing files (machine pipe)
 *
 * Zero npm dependencies. Requires Node ≥ 22.18 (unflagged TS type stripping) because the
 * runtime kernel is TypeScript and this script imports it directly.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { parseTemplate } from "../runtime/template.ts";

const SCHEMA = "atelier-ast-dump/0.1";

/* ---------- CLI runs only when invoked directly (library consumers import extractHtmlLiterals) ---------- */
const INVOKED_DIRECTLY =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

/* ---------- *.atr.ts discovery (skip node_modules / dot dirs / build output) ---------- */
function* findAtrFiles(dir, depth = 0) {
  if (depth > 8 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "dist") continue;
      yield* findAtrFiles(path.join(dir, e.name), depth + 1);
    } else if (e.name.endsWith(".atr.ts")) yield path.join(dir, e.name);
  }
}

/* ---------- html`` literal extraction (bounded scanner, no eval) ----------
 * Mode-stack scanner: frames are template-text / interpolation / quoted-string, so
 * arbitrary nesting (html` … ${`… ${x} …`} … `) survives. Returns the RAW template
 * text (joined strings, exactly what the interpreter sees). */
export function extractHtmlLiterals(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf("html`", i)) >= 0) {
    const prev = i > 0 ? src[i - 1] : "";
    if (/[\w$]/.test(prev)) { i += 5; continue; } // e.g. `someHtml\`` identifier — not the tag
    const start = i + 5;
    let j = start;
    const stack = [{ kind: "tpl" }]; // outer template text frame
    let closed = false;
    while (j < src.length && stack.length > 0) {
      const c = src[j];
      if (c === "\\") { j += 2; continue; } // escape wins in every frame
      const top = stack[stack.length - 1];
      if (top.kind === "q") {
        if (c === top.q) stack.pop();
        j++;
        continue;
      }
      if (top.kind === "tpl") {
        if (c === "`") { stack.pop(); closed = stack.length === 0; j++; continue; }
        if (c === "$" && src[j + 1] === "{") { stack.push({ kind: "interp" }); j += 2; continue; }
        j++;
        continue;
      }
      // interp frame
      if (c === "`") { stack.push({ kind: "tpl" }); j++; continue; }
      if (c === '"' || c === "'") { stack.push({ kind: "q", q: c }); j++; continue; }
      if (c === "}") { stack.pop(); j++; continue; }
      j++;
    }
    if (!closed) {
      throw Object.assign(new Error(`unterminated html\` literal at offset ${i}`), { code: "ATR-1xx-dump", offset: i });
    }
    out.push({ offset: i, raw: src.slice(start, j - 1) });
    i = j;
  }
  return out;
}

/* ---------- component association ---------- */
function extractComponents(src) {
  const decls = [];
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*component\s*\(/g;
  for (let m; (m = re.exec(src));) decls.push({ name: m[1], offset: m.index });
  return decls;
}

function ownerOf(decls, offset) {
  let owner = null;
  for (const d of decls) {
    if (d.offset < offset) owner = d.name;
    else break;
  }
  return owner;
}

function main() {
  /* ---------- arg parsing (flat, decision 6) ---------- */
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ROOT = path.resolve(argOf("--root") ?? process.cwd());
  const OUT = path.resolve(argOf("--out") ?? path.join(ROOT, ".atr", "ast"));
  const STDOUT = argv.includes("--stdout");
  const QUIET = argv.includes("--quiet");
  if (!fs.existsSync(ROOT)) die(`root does not exist: ${ROOT}`, "pass the app dir that holds your *.atr.ts files (--root <dir>)");

  /* ---------- Node capability guard ---------- */
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 18)) {
    die(`Node ${process.versions.node} cannot import the TypeScript runtime directly`,
      "use Node ≥ 22.18 (native type stripping), or run the dump under vitest");
  }

  const files = [...findAtrFiles(ROOT)];
  if (!files.length) {
    console.log(`no *.atr.ts files under ${ROOT} — nothing to dump (stage ② is a no-op before the first component)`);
    process.exit(0);
  }

  const components = new Map(); // name → { file, templates: [{index, raw, ast}] }
  const warnings = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const decls = extractComponents(src);
    let lits;
    try {
      lits = extractHtmlLiterals(src);
    } catch (e) {
      die(`${path.relative(ROOT, file)}: ${e.message}`, "close the html` template literal — stage ② only dumps complete literals");
    }
    for (const { offset, raw } of lits) {
      let owner = ownerOf(decls, offset);
      if (!owner) {
        warnings.push(`${path.relative(ROOT, file)}: html\` at offset ${offset} precedes any component declaration — dumped as "(module)"`);
        owner = "(module)";
      }
      const ast = parseTemplate(raw);
      const rel = path.relative(ROOT, file).replaceAll("\\", "/");
      if (!components.has(owner)) components.set(owner, { file: rel, templates: [] });
      components.get(owner).templates.push({ index: components.get(owner).templates.length, raw, ast });
    }
  }

  const generatedAt = new Date().toISOString();
  if (STDOUT) {
    console.log(JSON.stringify({ $schema: SCHEMA, generatedAt, root: ROOT, components: [...components.entries()].map(([name, v]) => ({ name, file: v.file, templates: v.templates })) }, null, 2));
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, v] of components) {
      const payload = { $schema: SCHEMA, generatedAt, component: name, file: v.file, templates: v.templates };
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(payload, null, 2) + "\n");
    }
    const index = {
      $schema: SCHEMA,
      generatedAt,
      root: ROOT.replaceAll("\\", "/"),
      components: [...components.entries()].map(([name, { file, templates }]) => ({ name, file, templateCount: templates.length, out: `${name}.json` })),
    };
    fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
  }

  if (!QUIET) {
    for (const w of warnings) console.error(`warn: ${w}`);
    const tplTotal = [...components.values()].reduce((n, c) => n + c.templates.length, 0);
    if (STDOUT) {
      console.error(`[atelier-compiler] stage ② dump: ${components.size} component(s), ${tplTotal} template(s) from ${files.length} file(s) → stdout`);
    } else {
      console.log(`[atelier-compiler] stage ② dump: ${components.size} component(s), ${tplTotal} template(s) from ${files.length} file(s)`);
      console.log(`  → ${path.relative(process.cwd(), OUT)}${path.sep}(<Component>.json + index.json)`);
      console.log("  stage ③ (static effect-graph codegen) consumes index.json — see docs/BACKLOG.md P0-2.");
    }
  }
}

if (INVOKED_DIRECTLY) main();
