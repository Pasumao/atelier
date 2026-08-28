#!/usr/bin/env node
/**
 * struct.mjs — Atelier structural ground truth engine (design axioms: docs/AI-OPTIMAL-STRUCTURE.md)
 *
 * Six-layer model, machine-checked:
 *   1 entry      routing tables (AGENTS.md, llms.txt)
 *   2 knowledge  progressive disclosure packs (skills/) + doc budgets
 *   3 facts      SSOT registries (manifest / atelier.config.json)
 *   4 intent     human-owned specs/ (goal-constraints-acceptance)
 *   5 errors     error catalog exists (failure = navigation)
 *   6 timeline   source checkpoints (.atelier/checkpoints.jsonl)
 *
 * Severity policy is itself a conclusion: a healthy but partial structure must NOT fail the gate.
 *   ERROR  = declared fact contradicts reality (trust broken)          → exit 1
 *   WARN   = layer expected but missing in this project kind           → reported
 *   INFO   = advisory (budget drift, missing optional niceties)        → reported
 *
 * Exports are consumed by the MCP server (structure.map / structure.check local dispatch)
 * and by the CLI (`atelier struct map|check`). cwd is the project root unless overridden.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SEV = { ERROR: 2, WARN: 1, INFO: 0 };
const OK = "ok";

function readLines(p) {
  try {
    return fs.readFileSync(p, "utf8").split(/\r?\n/).length;
  } catch {
    return null;
  }
}

function probeChecks(root) {
  /** Each finding: { id, layer, severity|null(null==ok), detail, fix? } */
  const f = [];
  const add = (o) => f.push(o);
  const has = (rel) => fs.existsSync(path.join(root, rel));

  /* ---- 1 entry ---- */
  const agents = path.join(root, "AGENTS.md");
  if (has("AGENTS.md")) {
    const n = readLines(agents);
    add({ id: "ENTRY_AGENTS_MD", layer: 1, severity: null, detail: `AGENTS.md present (${n} lines)` });
    if (n > 120)
      add({
        id: "ENTRY_AGENTS_MD_BUDGET",
        layer: 1,
        severity: "WARN",
        detail: `AGENTS.md is ${n} lines (>120)`,
        fix: "entry should be a routing table, not documentation — move detail into skills/docs layers",
      });
  } else {
    add({
      id: "ENTRY_AGENTS_MD",
      layer: 1,
      severity: "WARN",
      detail: "no AGENTS.md at project root",
      fix: "generate one: node atelier/cli.mjs skills install --target . (renders AGENTS.md.template)",
    });
  }
  if (!has("llms.txt"))
    add({
      id: "ENTRY_LLMS_TXT",
      layer: 1,
      severity: "INFO",
      detail: "llms.txt (machine API index) not present",
      fix: "render templates/llms.txt.template when the framework API surface stabilizes",
    });

  /* ---- 2 knowledge (progressive disclosure) ---- */
  const skillsRoots = ["atelier/skills", ".agents/skills", ".dsh/skills", "skills"].filter((p) => has(p));
  const packs = [];
  for (const r of skillsRoots) {
    for (const d of fs.readdirSync(path.join(root, r))) {
      if (fs.existsSync(path.join(root, r, d, "SKILL.md"))) packs.push(`${r}/${d}`);
    }
  }
  add(
    packs.length
      ? { id: "KNOW_SKILL_PACKS", layer: 2, severity: null, detail: `${packs.length} skill package(s): ${packs.slice(0, 4).join(", ")}${packs.length > 4 ? " …" : ""}` }
      : { id: "KNOW_SKILL_PACKS", layer: 2, severity: "WARN", detail: "no skill packages discovered", fix: "install: node atelier/cli.mjs skills install --target ." },
  );
  const bigDocs = [];
  const scanDocs = (dir, depth = 0) => {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const st = fs.statSync(p);
      if (st.isDirectory()) scanDocs(p, depth + 1);
      else if (/\.md$/i.test(e)) {
        const n = readLines(p);
        if (n > 600) bigDocs.push(`${path.relative(root, p)} (${n} lines)`);
      }
    }
  };
  scanDocs(path.join(root, "docs"));
  if (bigDocs.length)
    add({
      id: "KNOW_DOC_BUDGET",
      layer: 2,
      severity: "INFO",
      detail: `oversized docs (progressive-disclosure drift): ${bigDocs.join("; ")}`,
      fix: "split into topic files and leave a routing stub behind",
    });

  /* ---- 3 facts (SSOT) ---- */
  const cfgPath = path.join(root, "atelier.config.json");
  if (has("atelier.config.json")) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      add({ id: "FACT_CONFIG_PARSE", layer: 3, severity: null, detail: `atelier.config.json parses (tokens:${Object.keys(cfg.tokens ?? {}).length} groups, locked:${(cfg.locked ?? []).length})` });
    } catch (e) {
      add({ id: "FACT_CONFIG_PARSE", layer: 3, severity: "ERROR", detail: `atelier.config.json fails to parse: ${e.message}`, fix: "repair JSON syntax — agents treat this file as ground truth" });
    }
  } else {
    add({
      id: "FACT_CONFIG",
      layer: 3,
      severity: "WARN",
      detail: "no atelier.config.json (tokens/locked/confirm live there)",
      fix: "add one once this repo becomes an Atelier application (meta-repos may stay config-free)",
    });
  }
  // manifest probe (declared or heuristic)
  const manifestCandidates = ["app.registry.json", "src/manifest.json"];
  let manifestOk = false;
  for (const c of manifestCandidates) {
    const p = path.join(root, c);
    if (!fs.existsSync(p)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      const comps = Array.isArray(m.components) ? m.components : [];
      const baseDir = path.dirname(p);
      const ghost = comps.filter((x) => x.file && !fs.existsSync(path.join(baseDir, x.file)));
      manifestOk = true;
      add(
        ghost.length === 0
          ? { id: "FACT_MANIFEST", layer: 3, severity: null, detail: `${c}: ${comps.length} component(s), every file resolves` }
          : { id: "FACT_MANIFEST_GHOST", layer: 3, severity: "ERROR", detail: `${c}: ${ghost.length} ghost component(s) — registered but file missing: ${ghost.map((g) => g.name).join(", ")}`, fix: "re-export the file or remove the stale registry entry" },
      );
      break;
    } catch {
      add({ id: "FACT_MANIFEST_PARSE", layer: 3, severity: "ERROR", detail: `${c} is not valid JSON`, fix: "repair — the registry is queried by agents instead of reading sources" });
      break;
    }
  }
  if (!manifestOk && !has("atelier.config.json"))
    add({ id: "FACT_MANIFEST", layer: 3, severity: "INFO", detail: "no component registry found yet (fine before first component)", fix: "exporting a component creates one automatically in full Atelier" });

  /* ---- 4 intent ---- */
  const coSpecs = [...findSuffixDeep(root, ".atr.md", 6)];
  const coSpecTests = [...findSuffixDeep(root, ".atr.spec.ts", 6)];
  if (has("specs")) {
    const specs = fs.readdirSync(path.join(root, "specs")).filter((x) => x.endsWith(".md"));
    const tpl = specs.some((s) => /_?template/i.test(s));
    add(tpl ? { id: "INTENT_TEMPLATE", layer: 4, severity: null, detail: `specs/ with ${specs.length} md file(s), template present` } : { id: "INTENT_TEMPLATE", layer: 4, severity: "INFO", detail: `specs/ has ${specs.length} md file(s), no _spec-template`, fix: "copy the goal/constraints/acceptance template so new features start structured" });
    if (coSpecs.length > 0)
      add({ id: "INTENT_COLOCATED", layer: 4, severity: null, detail: `co-located component specs (*.atr.md): ${coSpecs.map((p) => path.relative(root, p)).join(", ")}` });
  } else if (coSpecs.length > 0) {
    add({ id: "INTENT_SPECS", layer: 4, severity: null, detail: `intent home = co-located component specs (${coSpecs.length}): ${coSpecs.map((p) => path.relative(root, p)).join(", ")}` });
  } else {
    add({
      id: "INTENT_SPECS",
      layer: 4,
      severity: "WARN",
      detail: "no specs/ directory and no co-located *.atr.md — human intent has no home",
      fix: "either mkdir specs && add _spec-template.md, or co-locate <Component>.atr.md (goal/constraints/acceptance) next to the component",
    });
  }
  if (coSpecs.length > 0 && coSpecTests.length === 0)
    add({ id: "INTENT_SPEC_NO_TEST", layer: 4, severity: "INFO", detail: `${coSpecs.length} *.atr.md but no co-located *.atr.spec.ts — acceptance list may be human-only`, fix: "mirror each machine-checkable acceptance item as <Component>.atr.spec.ts" });

  /* ---- 5 errors ---- */
  const errCatalog =
    has("atelier/skills/atelier-error-codes/SKILL.md") ||
    has(".dsh/skills/atelier-error-codes/SKILL.md") ||
    [...findFilesDeep(root, "codes.md", 3)].some((p) => p.includes("error"));
  add(
    errCatalog
      ? { id: "ERR_CATALOG", layer: 5, severity: null, detail: "error catalog reachable (failure = navigation)" }
      : { id: "ERR_CATALOG", layer: 5, severity: "INFO", detail: "no error-code catalog yet", fix: "ships with the skills package (atelier-error-codes)" },
  );

  /* ---- 6 timeline ---- */
  const tl = path.join(root, ".atelier", "checkpoints.jsonl");
  if (fs.existsSync(tl)) {
    const rows = fs.readFileSync(tl, "utf8").split("\n").filter(Boolean);
    const saves = rows.filter((r) => JSON.parse(r).type === "save").length;
    add({ id: "TIMELINE_STORE", layer: 6, severity: null, detail: `${rows.length} timeline event(s), ${saves} anchored checkpoint(s)` });
  } else {
    add({ id: "TIMELINE_STORE", layer: 6, severity: "INFO", detail: "no checkpoint timeline yet", fix: "anchor the current state: node atelier/cli.mjs checkpoint save \"baseline\"" });
  }

  /* ---- global trust rule ---- */
  if (has("AGENTS.md") && !has(".gitignore")) {
    add({ id: "TRUST_GITIGNORE", layer: 3, severity: "ERROR", detail: ".gitignore missing while AGENTS.md invites agents in", fix: "ignore node_modules/, build output, tool caches BEFORE first commit" });
  }
  return f;
}

function* findFilesDeep(dir, name, maxDepth, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) yield* findFilesDeep(p, name, maxDepth, depth + 1);
    else if (e === name) yield p;
  }
}

/** 复合扩展名扫描（如 *.atr.md / *.atr.spec.ts）：按后缀匹配，跳过 node_modules 与点目录 */
function* findSuffixDeep(dir, suffix, maxDepth, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      yield* findSuffixDeep(p, suffix, maxDepth, depth + 1);
    } else if (e.endsWith(suffix)) yield p;
  }
}

/** Structured result — consumed by MCP `structure.map` / `structure.check`. */
export function inspectStructure(root = process.cwd()) {
  const findings = probeChecks(root);
  const LAYERS = [
    [1, "entry — routing tables"],
    [2, "knowledge — progressive disclosure"],
    [3, "facts — SSOT registries"],
    [4, "intent — human-owned specs"],
    [5, "errors — failure as navigation"],
    [6, "timeline — reversible time"],
  ];
  const layers = LAYERS.map(([id, title]) => ({
    layer: id,
    title,
    findings: findings.filter((f) => f.layer === id),
  }));
  const count = (sev) => findings.filter((f) => f.severity === sev).length;
  return {
    root: path.resolve(root),
    modelVersion: "six-layer/v0.2",
    summary: { errors: count("ERROR"), warnings: count("WARN"), infos: count("INFO"), ok: findings.filter((f) => f.severity === null).length },
    layers,
  };
}

/* ---------- CLI ---------- */
function printMap(res) {
  console.log(`structure map — ${res.root}   [${res.modelVersion}]`);
  for (const l of res.layers) {
    console.log(`\n${l.layer}. ${l.title}`);
    if (!l.findings.length) console.log("   (nothing checked)");
    for (const f of l.findings) {
      const tag = f.severity ?? "ok ";
      console.log(`   [${tag.toUpperCase().padEnd(5)}] ${f.id}: ${f.detail}`);
      if (f.fix) console.log(`           fix: ${f.fix}`);
    }
  }
  console.log(`\nsummary: ${res.summary.errors} error · ${res.summary.warnings} warn · ${res.summary.infos} info · ${res.summary.ok} ok`);
}

/* ---------- CLI (runs only when invoked directly; library consumers import inspectStructure) ---------- */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [, , cmd, ...rest] = process.argv;
  const rootArg = rest.find((a) => !a.startsWith("--"));
  switch (cmd) {
    case undefined:
    case "map":
    case "check": {
      const res = inspectStructure(rootArg ?? process.cwd());
      if (rest.includes("--json")) console.log(JSON.stringify(res, null, 2));
      else printMap(res);
      // gating only on explicit `check` (and bare invocation): warnings never block — severity policy
      if (cmd === undefined || cmd === "check") {
        if (res.summary.errors > 0) {
          console.error(`\nstructure check FAILED (${res.summary.errors} contradiction${res.summary.errors > 1 ? "s" : ""})`);
          process.exit(1);
        }
        console.log("\nstructure check passed (warnings/info do not block — see severity policy).");
      }
      break;
    }
    default:
      console.error("usage: struct [map|check] [--json]");
      process.exit(2);
  }
}
