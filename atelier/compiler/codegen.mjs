#!/usr/bin/env node
/**
 * codegen.mjs — Atelier compiler stage ③ (P0-2): expanded template AST → 静态 effect 图代码。
 *
 * 输入：stage ② dump 的 AST（.atr/ast/<Component>.json），或 in-process 直传 raw（同一解析器
 * parseTemplate ⇒ 与 dump 同树，单一来源不破）。输出两种形态，同一发射器产出：
 *
 *   - compileFunction(name, raw) → CompiledTemplate 对象（program 经 new Function 构造，
 *     零文件落盘；vitest / in-process 消费）
 *   - compileModuleSource(name, raws) → 零 import 的 ES 模块源码（`export const compiledList`；
 *     CLI 落盘 .atr/compiled/<Component>.mjs 供应用 import 后 registerCompiled）
 *
 * 生成代码的形态（验收：BACKLOG P0-2③）：
 *   · 结构构建是直线 createElement/appendChild——运行时无字符串解析、无 AST 分派
 *   · 每处 {expr} / 动态 attr / {#if} / {#each} 的 effect 接线在编译期定点生成（静态 effect 图）
 *   · 运行时能力（$effect/evalExpr/bindExpr/mountComponent…）经 ctx.rt 注入（runtime/template.ts
 *     的 __compiledRT，解释器同函数）⇒ 产物与 runtime 路径/打包布局零耦合，语义同源。
 *
 * Usage:
 *   node atelier/compiler/codegen.mjs --ast <dir> [--out <dir>] [--quiet] [--graph]
 *     --ast   stage ② dump 目录（含 index.json；默认 <root>/.atr/ast）
 *     --out   产物目录（默认 <ast-dir>/../compiled）
 *     --graph 同时落盘构建期静态依赖图 <ast-dir>/../graph/<Component>.json（F-2 二期）
 *   node atelier/compiler/codegen.mjs --ast <dir> --graph-only [--quiet]
 *     查询模式：零落盘，把合并的组件依赖图 JSON 打到 stdout（MCP graph.static 单源）
 *
 * Zero npm dependencies. Requires Node ≥ 22.18（直载 runtime TS，与 dump.mjs 同约束）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { parseTemplate } from "../runtime/template.ts";
import { exprRootIdents } from "../runtime/expr.ts";

const INVOKED_DIRECTLY =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

const esc = (s) => JSON.stringify(String(s));

class CodegenError extends Error {
  constructor(message) {
    super(message);
    this.code = "ATR-1xx-codegen";
  }
}

/* ---------- 样式抽取：与解释器 mountComponentInner 同一正则（<style scoped> 预提取） ---------- */
const STYLE_RE = /<style(?:\s+scoped)?\s*>([\s\S]*?)<\/style>/gi;
function extractStyles(raw) {
  const out = [];
  for (let m; (m = STYLE_RE.exec(raw));) out.push(m[1]);
  return out;
}

/* ---------- 静态依赖提取（决策 3 / F-2 第一期） ----------
 * 每个响应式挂点（bindExpr / {#if} test / {#each} expr+key 及子树）在发射时同步收集其
 * 表达式引用的作用域根标识符；挂载期求值（组件 props）与事件期求值（on:）分桶另记。
 * 语义：**语法级引用集 = 运行时追踪集的超集**（含 {#if}/{:else}、&&/||/?: 的未执行分支，
 * 与 {#each} 子作用域变量已被滤除）——产物据此可做构建期依赖图与未来跳过追踪的可靠性依据。
 */
function newDepState() {
  return { locals: new Set(), reactive: new Set(), mount: new Set(), events: new Set() };
}
function collect(st, bucket, expr) {
  for (const id of exprRootIdents(expr)) {
    if (!st.locals.has(id)) st[bucket].add(id);
  }
}

/* ---------- 发射器：AST → program 源码（不美化、不优化，直译解释器 renderNode 语义） ---------- */

function emitNodes(nodes, scopeVar, target, out, uid, st) {
  for (const n of nodes) emitNode(n, scopeVar, target, out, uid, st);
}

function emitNode(n, SV, T, out, uid, st) {
  switch (n.kind) {
    case "text": {
      out.push(`${T}.appendChild(document.createTextNode(${esc(n.text)}));`);
      return;
    }
    case "expr": {
      collect(st, "reactive", n.expr);
      const tn = uid("tn");
      out.push(`const ${tn} = document.createTextNode("");`);
      out.push(`rt.bindExpr(${esc(n.expr)}, ${SV}, (v) => { ${tn}.textContent = rt.stringify(v); });`);
      out.push(`${T}.appendChild(${tn});`);
      return;
    }
    case "element": {
      if (String(n.tag).toLowerCase() === "style") return; // 解释器同款：scoped 样式上层注入，渲染为 null
      if (n.component) return emitComponent(n, SV, T, out, uid, st);
      const el = uid("el");
      out.push(`{`);
      out.push(`  const ${el} = document.createElement(${esc(n.tag)});`);
      emitAttrs(n.attrs, SV, el, out, uid, st);
      if (n.children?.length) {
        const c = uid("c");
        out.push(`  const ${c} = document.createDocumentFragment();`);
        emitNodes(n.children, SV, c, out, uid, st);
        out.push(`  ${el}.appendChild(${c});`);
      }
      out.push(`  ${T}.appendChild(${el});`);
      out.push(`}`);
      return;
    }
    case "if":
      return emitIf(n, SV, T, out, uid, st);
    case "each":
      return emitEach(n, SV, T, out, uid, st);
    default:
      throw new CodegenError(`unknown node kind: ${JSON.stringify(n?.kind)} — stage ③ 覆盖 text/expr/element/if/each；` +
        `收到未知节点请先确认 stage ② dump 与 runtime 解析器版本一致`);
  }
}

/** 属性：保持原序（on: 事件 / 动态 bindExpr / 静态 setAttribute 按模板出现顺序发射） */
function emitAttrs(attrs, SV, el, out, uid, st) {
  for (const a of attrs ?? []) {
    if (a.name.startsWith("on:")) {
      collect(st, "events", a.value);
      out.push(`  ${el}.addEventListener(${esc(a.name.slice(3))}, (e) => {`);
      out.push(`    const fn = rt.evalExpr(${esc(a.value)}, ${SV});`);
      out.push(`    if (typeof fn === "function") fn(e);`);
      out.push(`  });`);
    } else if (a.dynamic) {
      collect(st, "reactive", a.value);
      out.push(`  rt.bindExpr(${esc(a.value)}, ${SV}, (v) => {`);
      out.push(`    if (v == null) ${el}.removeAttribute(${esc(a.name)});`);
      out.push(`    else ${el}.setAttribute(${esc(a.name)}, rt.stringify(v));`);
      out.push(`  });`);
    } else {
      out.push(`  ${el}.setAttribute(${esc(a.name)}, ${esc(a.value)});`);
    }
  }
}

/** 子组件：与解释器同款——validate 失败渲染错误卡；挂载返回 root（wrapper 即弃，append 语义逐字节一致） */
function emitComponent(n, SV, T, out, uid, st) {
  const def = uid("def");
  out.push(`{`);
  out.push(`  const ${def} = registry.get(${esc(n.tag)});`);
  out.push(`  if (!${def}) {`);
  out.push(`    const fb = document.createElement("div");`);
  out.push(`    fb.className = "atr-error-card";`);
  out.push(`    fb.textContent = "ATR-4xx: 组件未注册：" + ${esc(n.tag)} + "（检查 import 是否只注册于组件文件）";`);
  out.push(`    ${T}.appendChild(fb);`);
  out.push(`  } else {`);
  out.push(`    const props = {};`);
  for (const a of n.attrs ?? []) {
    if (a.dynamic) collect(st, "mount", a.value); // F-5 响应式 props：表达式归 mount 桶（父侧 effect 求值回写）
    out.push(
      a.dynamic
        ? `    rt.bindProp(${esc(a.value)}, ${SV}, props, ${esc(a.name)});`
        : `    props[${esc(a.name)}] = ${esc(a.value)};`,
    );
  }
  out.push(`    const v = rt.validateProps(${def}.schema, props, validate);`);
  out.push(`    if (!v.ok) {`);
  out.push(`      const errBox = document.createElement("div");`);
  out.push(`      errBox.className = "atr-error-card";`);
  out.push("      errBox.textContent = `${v.error?.code} ${v.error?.message} — fix: ${v.error?.fix ?? \"\"}`;");
  out.push(`      ${T}.appendChild(errBox);`);
  out.push(`    } else {`);
  out.push(`      const wrapper = document.createElement("span");`);
  out.push(`      ${T}.appendChild(rt.mountComponent(${def}, props, wrapper, registry, validate));`);
  out.push(`    }`);
  out.push(`  }`);
  out.push(`}`);
}

/** {#if}/{:else}：test 链顺序求值、首个命中即停（未命中的分支不求值 ⇒ 依赖追踪行为与解释器一致） */
function emitIf(n, SV, T, out, uid, st) {
  const anchor = uid("anchor");
  const cur = uid("cur");
  const builders = (n.blocks ?? []).map((b) => {
    const fn = uid("b");
    const c = uid("c");
    if (b.test !== null) collect(st, "reactive", b.test);
    const lines = [
      `const ${fn} = () => {`,
      `  const ${c} = document.createDocumentFragment();`,
    ];
    emitNodes(b.children ?? [], SV, c, lines, uid, st);
    lines.push(`  return ${c};`);
    lines.push(`};`);
    return { fn, test: b.test, lines };
  });
  out.push(`{`);
  for (const b of builders) out.push(...b.lines);
  out.push(`  const ${anchor} = document.createElement("span");`);
  out.push(`  ${anchor}.style.display = "contents";`);
  out.push(`  let ${cur} = -1;`);
  out.push(`  rt.$effect(() => {`);
  out.push(`    let chosen = -1;`);
  (n.blocks ?? []).forEach((b, i) => {
    if (b.test === null) {
      out.push(`    if (chosen < 0) chosen = ${i}; // {:else}（顺序即命中规则）`);
    } else {
      out.push(`    if (chosen < 0) { if (rt.booly(rt.evalExpr(${esc(b.test)}, ${SV}))) chosen = ${i}; }`);
    }
  });
  out.push(`    if (chosen !== ${cur}) {`);
  out.push(`      while (${anchor}.firstChild) ${anchor}.removeChild(${anchor}.firstChild);`);
  out.push(`      if (chosen >= 0) ${anchor}.appendChild([${builders.map((b) => b.fn).join(", ")}][chosen]());`);
  out.push(`      ${cur} = chosen;`);
  out.push(`    }`);
  out.push(`  });`);
  out.push(`  ${T}.appendChild(${anchor});`);
  out.push(`}`);
}

/** {#each}：keyed 走同款 reconcile（Map 复用 + appendChild 重排）；无 by 全清重建。
 * 子作用域变量经 uid 唯一化——嵌套 each 的内层展开 { ...外层scope } 不会自引用。 */
function emitEach(n, SV, T, out, uid, st) {
  const host = uid("host");
  const scv = uid("scope"); // 本层 each 的子作用域变量名（每 item 一个，childScope 语义）
  collect(st, "reactive", n.expr); // 迭代源在外层作用域求值
  const st2 = { ...st, locals: new Set([...st.locals, n.item, n.index]) }; // 子树滤除本层 item/index
  out.push(`{`);
  out.push(`  const ${host} = document.createElement("span");`);
  out.push(`  ${host}.style.display = "contents";`);
  if (n.keyExpr) {
    const live = uid("live");
    out.push(`  const ${live} = new Map();`);
    out.push(`  rt.$effect(() => {`);
    out.push(`    const arr = (rt.evalExpr(${esc(n.expr)}, ${SV}) ?? []);`);
    out.push(`    const nextKeys = new Set();`);
    out.push(`    arr.forEach((item, i) => {`);
    out.push(`      const ${scv} = { ...${SV}, [${esc(n.item)}]: item, [${esc(n.index)}]: i };`);
    out.push(`      let k;`);
    out.push(`      try { k = rt.stringify(rt.evalExpr(${esc(n.keyExpr)}, ${scv})); } catch { k = \`\${i}\`; }`);
    out.push(`      nextKeys.add(k);`);
    out.push(`      let el = ${live}.get(k);`);
    out.push(`      if (!el) {`);
    out.push(`        const box = document.createElement("span");`);
    out.push(`        box.style.display = "contents";`);
    out.push(`        const c = document.createDocumentFragment();`);
    emitNodes(n.children ?? [], scv, "c", out, uid, st2);
    out.push(`        box.appendChild(c);`);
    out.push(`        el = box;`);
    out.push(`        ${live}.set(k, el);`);
    out.push(`      }`);
    out.push(`      ${host}.appendChild(el); // 同序 no-op；乱序即重排`);
    out.push(`    });`);
    out.push(`    for (const [k, el] of [...${live}]) {`);
    out.push(`      if (!nextKeys.has(k)) { el.remove(); ${live}.delete(k); }`);
    out.push(`    }`);
    out.push(`  });`);
  } else {
    out.push(`  rt.$effect(() => {`);
    out.push(`    const arr = (rt.evalExpr(${esc(n.expr)}, ${SV}) ?? []);`);
    out.push(`    while (${host}.firstChild) ${host}.removeChild(${host}.firstChild);`);
    out.push(`    arr.forEach((item, i) => {`);
    out.push(`      const ${scv} = { ...${SV}, [${esc(n.item)}]: item, [${esc(n.index)}]: i };`);
    out.push(`      const c = document.createDocumentFragment();`);
    emitNodes(n.children ?? [], scv, "c", out, uid, st2);
    out.push(`      ${host}.appendChild(c);`);
    out.push(`    });`);
    out.push(`  });`);
  }
  out.push(`  ${T}.appendChild(${host});`);
  out.push(`}`);
}

/* ---------- 对外 API ---------- */

/** raw → CompiledTemplate（in-process；program 由 new Function 构造，零落盘零 import） */
export function compileFunction(name, raw) {
  const ast = parseTemplate(raw);
  const { body, deps } = programWithDeps(ast);
  let program;
  try {
    program = new Function("ctx", body); // 生成源码受控于本发射器（不接触调用方输入字符串的执行语义）
  } catch (e) {
    throw new CodegenError(`generated program failed to parse (compiler bug): ${e.message}`);
  }
  return { name, raw, styles: extractStyles(raw), deps, program };
}

/** raw[] → 完整 ES 模块源码（零 import；应用侧 import 后 registerCompiled 即接入快路径） */
export function compileModuleSource(name, raws) {
  const entries = raws.map((raw) => programWithDeps(parseTemplate(raw)));
  return [
    `// generated by atelier/compiler/codegen.mjs (P0-2 stage ③) — do not edit by hand`,
    `// component: ${name} · schema: atelier-compiled/0.1 · 运行时能力经 ctx.rt 注入（__compiledRT）`,
    `// deps（F-2 静态依赖清单）＝ 语法级引用集 ⊇ 运行时追踪集（含未执行分支，已滤除 each 子作用域变量）`,
    `export const compiledList = [`,
    ...entries.map(({ body, deps }) =>
      [
        `  {`,
        `    name: ${esc(name)},`,
        `    deps: { reactive: ${JSON.stringify(deps.reactive)}, mount: ${JSON.stringify(deps.mount)}, events: ${JSON.stringify(deps.events)} },`,
        `    program(ctx) {`,
        indentLines(body, "    "),
        `    },`,
        `  },`,
      ].join("\n"),
    ),
    `];`,
    `export const compiled = compiledList[0];`,
    ``,
  ].join("\n");
}

/** AST → program(ctx) 函数体源码 + 静态依赖清单（发射器唯一出口；compileFunction / compileModuleSource 共用） */
export function programWithDeps(ast) {
  const serial = { n: 0 };
  const uid = (p) => `${p}${++serial.n}`;
  const st = newDepState();
  const out = [
    `const { scope, registry, validate, rt } = ctx;`,
    `const frag = document.createDocumentFragment();`,
  ];
  emitNodes(ast, "scope", "frag", out, uid, st);
  out.push(`return frag;`);
  const deps = {
    reactive: [...st.reactive].sort(),
    mount: [...st.mount].sort(),
    events: [...st.events].sort(),
  };
  return { body: out.join("\n"), deps };
}

/** 兼容出口：只要源码（compileFunction / compileModuleSource 内部走 programWithDeps） */
export function programSource(ast) {
  return programWithDeps(ast).body;
}

/** F-2 二期：raws → 构建期静态依赖图（决策 3「不跑应用即可查询」的查询工件）。
 * 单源 = programWithDeps 同一收集器；组件级 = 各模板清单的并集。
 * 语义边界沿用一期诚实标注：语法级引用集 ⊇ 运行时追踪集（含未执行分支）。 */
export function buildGraph(name, raws) {
  const acc = { reactive: new Set(), mount: new Set(), events: new Set() };
  for (const raw of raws) {
    const { deps } = programWithDeps(parseTemplate(raw));
    for (const k of Object.keys(acc)) for (const id of deps[k]) acc[k].add(id);
  }
  return {
    component: name,
    schema: "atelier-graph/0.1",
    deps: {
      reactive: [...acc.reactive].sort(),
      mount: [...acc.mount].sort(),
      events: [...acc.events].sort(),
    },
  };
}

function indentLines(text, pad) {
  return text.split("\n").map((l) => pad + l).join("\n");
}

/* ---------- CLI：消费 stage ② dump → .atr/compiled/<Component>.mjs ---------- */

function* findJson(dir, depth = 0) {
  if (depth > 2 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) yield* findJson(path.join(dir, e.name), depth + 1);
    else if (e.name.endsWith(".json") && e.name !== "index.json") yield path.join(dir, e.name);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const AST_DIR = path.resolve(argOf("--ast") ?? path.join(process.cwd(), ".atr", "ast"));
  const OUT_DIR = path.resolve(argOf("--out") ?? path.join(AST_DIR, "..", "compiled"));
  const QUIET = argv.includes("--quiet");
  const GRAPH = argv.includes("--graph"); // F-2 二期：同时落盘 .atr/graph/<Component>.json
  const GRAPH_ONLY = argv.includes("--graph-only"); // 查询模式：不落盘任何产物，合并图 JSON → stdout（MCP graph.static 单源）
  if (!fs.existsSync(path.join(AST_DIR, "index.json"))) {
    die(`no stage ② dump at ${AST_DIR}`, "run 'node atelier/compiler/dump.mjs --root <appDir>' first");
  }
  const GRAPH_DIR = path.resolve(argOf("--graph-dir") ?? path.join(AST_DIR, "..", "graph"));
  if (!GRAPH_ONLY) fs.mkdirSync(OUT_DIR, { recursive: true });
  let components = 0;
  let templates = 0;
  const graphs = [];
  for (const f of findJson(AST_DIR)) {
    const dump = JSON.parse(fs.readFileSync(f, "utf8"));
    const name = dump.component;
    if (!name || name === "(module)" || !Array.isArray(dump.templates)) continue;
    const raws = dump.templates.map((t) => t.raw);
    if (GRAPH || GRAPH_ONLY) graphs.push(buildGraph(name, raws));
    if (!GRAPH_ONLY) {
      const src = compileModuleSource(name, raws);
      fs.writeFileSync(path.join(OUT_DIR, `${name}.mjs`), src, "utf8");
      if (GRAPH) {
        fs.mkdirSync(GRAPH_DIR, { recursive: true });
        fs.writeFileSync(path.join(GRAPH_DIR, `${name}.json`), JSON.stringify(graphs[graphs.length - 1], null, 2) + "\n", "utf8");
      }
    }
    components += 1;
    templates += dump.templates.length;
  }
  if (GRAPH_ONLY) {
    process.stdout.write(JSON.stringify({ schema: "atelier-graph/0.1", components: graphs }) + "\n");
    return;
  }
  if (!QUIET) {
    console.log(`[atelier-compiler] stage ③ codegen: ${components} component(s), ${templates} template(s)`);
    console.log(`  → ${path.relative(process.cwd(), OUT_DIR)}${path.sep}<Component>.mjs（应用侧 import + registerCompiled 即接入零 tokenize 快路径）`);
    if (GRAPH) console.log(`  → ${path.relative(process.cwd(), GRAPH_DIR)}${path.sep}<Component>.json（F-2 构建期依赖图）`);
  }
}

if (INVOKED_DIRECTLY) main();
