#!/usr/bin/env node
/**
 * struct.mjs — Atelier structural ground truth engine (design axioms: docs/AI-OPTIMAL-STRUCTURE.md)
 *
 * Eight-layer model, machine-checked (FS-DESIGN.md §9: layers 7/8 = 全站化边界守卫, FS-M2-a):
 *   1 entry      routing tables (AGENTS.md, llms.txt)
 *   2 knowledge  progressive disclosure packs (skills/) + doc budgets
 *   3 facts      SSOT registries (manifest / atelier.config.json)
 *   4 intent     human-owned specs/ (goal-constraints-acceptance)
 *   5 errors     error catalog exists (failure = navigation)
 *   6 timeline   source checkpoints (.atelier/checkpoints.jsonl)
 *   7 boundary   import frontier — server modules stay out of the frontend graph (ATR-105),
 *                bare import allowlist vs package.json (ATR-106), auth/journal explicitness
 *   8 data       data contracts — migration pairs / applied-checksum / schema drift
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
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

// node:sqlite 顶层惰性加载：加载失败（Node <22.5 / 受限环境）→ layer 8 的两条库内规则整体
// 静默跳过（不假红）；守卫只读库（readOnly），绝不写。
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch { /* 静默 */ }

const SEV = { ERROR: 2, WARN: 1, INFO: 0 };
const OK = "ok";

function readLines(p) {
  try {
    return fs.readFileSync(p, "utf8").split(/\r?\n/).length;
  } catch {
    return null;
  }
}

/* ---------- R3 结构债（评审 §6 R3「probeChecks 八层各一函数」/ §2.2 风险 2）：八层探针 ----------
 * 原 probeChecks 约 394 行平铺 if-chain → 每层一个探针函数（签名统一 (root, add)，add 追加
 * finding 的顺序即报告顺序）+ LAYER_PROBES 表驱动分派。行为逐字节等价的门 = struct 既有测试
 * （struct-guards / mcp-vendor structure.map / checkpoint 联动）断言零修改全绿 +
 * tests/struct-layers.test.ts（表形状 / 层隔离 / 表序直调 ≡ inspectStructure 全量输出三钉）。
 * 导出面：LAYER_PROBES 与各探针供直测（每层可单独调）——巨型平铺函数从此有可测试面。 */

/* ---- 1 entry ---- */
export function probeEntryLayer(root, add) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
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
}

/* ---- 2 knowledge (progressive disclosure) ---- */
export function probeKnowledgeLayer(root, add) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
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
}

/* ---- 3 facts (SSOT) ---- */
export function probeFactsLayer(root, add) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
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

  // ---- token 引用静态对账（2026-09-06 锐评整改：struct 检出力补强，构建期镜像运行时 ATR-204）----
  // 扫描 *.atr.ts 的 <style> 块 var(--x) 引用，对账 atelier.config.json token 单源；
  // 判 ERROR 的口径与运行时 injectScopedStyle 完全一致（引用未定义 token = 渲染 ATR-204 错误卡
  // = 真实缺陷，"不假红"纪律不破）。config 缺失时不判（无单源可对账，别处可能定义）。
  try {
    const cfgRaw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const known = new Set();
    for (const [group, map] of Object.entries(cfgRaw.tokens ?? {}))
      for (const name of Object.keys(map ?? {})) known.add(`--${group}.${name}`.replaceAll(".", "-"));
    if (known.size > 0) {
      const comps = [...findSuffixDeep(root, ".atr.ts", 6)];
      const missing = [];
      for (const f of comps) {
        const src = fs.readFileSync(f, "utf8");
        for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
          for (const v of m[1].matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
            if (!known.has(v[1])) missing.push(`${path.relative(root, f)} → ${v[1]}`);
          }
        }
      }
      add(
        missing.length === 0
          ? { id: "FACT_TOKEN_REFS", layer: 3, severity: null, detail: `${comps.length} component file(s): every var(--token) resolves against config single source` }
          : { id: "FACT_TOKEN_REFS", layer: 3, severity: "ERROR", detail: `${missing.length} unresolved token reference(s) — runtime renders ATR-204 error card: ${missing.slice(0, 4).join(" · ")}${missing.length > 4 ? " …" : ""}`, fix: "add the token to atelier.config.json, or reference an existing one (token single source, decision 8/16)" },
      );
    }
  } catch {
    /* config 不可解析已由 FACT_CONFIG_PARSE 报告，此处不重复 */
  }
}

/* ---- 4 intent ---- */
export function probeIntentLayer(root, add) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
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
}

/* ---- 5 errors ---- */
export function probeErrorsLayer(root, add) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
  const errCatalog =
    has("atelier/skills/atelier-error-codes/SKILL.md") ||
    has(".dsh/skills/atelier-error-codes/SKILL.md") ||
    [...findFilesDeep(root, "codes.md", 3)].some((p) => p.includes("error"));
  add(
    errCatalog
      ? { id: "ERR_CATALOG", layer: 5, severity: null, detail: "error catalog reachable (failure = navigation)" }
      : { id: "ERR_CATALOG", layer: 5, severity: "INFO", detail: "no error-code catalog yet", fix: "ships with the skills package (atelier-error-codes)" },
  );
}

/* ---- 6 timeline ---- */
export function probeTimelineLayer(root, add) {
  const tl = path.join(root, ".atelier", "checkpoints.jsonl");
  if (fs.existsSync(tl)) {
    const rows = fs.readFileSync(tl, "utf8").split("\n").filter(Boolean);
    const saves = rows.filter((r) => JSON.parse(r).type === "save").length;
    add({ id: "TIMELINE_STORE", layer: 6, severity: null, detail: `${rows.length} timeline event(s), ${saves} anchored checkpoint(s)` });
  } else {
    add({ id: "TIMELINE_STORE", layer: 6, severity: "INFO", detail: "no checkpoint timeline yet", fix: "anchor the current state: node atelier/cli.mjs checkpoint save \"baseline\"" });
  }
}

/* ---- 7 boundary（server 边界层，FS-DESIGN §9.1/§9.2/§6.2/§3.5，FS-M2-a）----
 * 分级哲学照旧：健康的部分建成不得炸门禁——每条规则只在其对象文件存在时激活
 * （无 src/main.ts / 无 src/server/** / 无 package.json → 整条静默，零 finding）。 */
export function probeBoundaryLayer(root, add) {
  const rel = (p) => path.relative(root, p).replaceAll("\\", "/");
  const mainEntry = path.join(root, "src", "main.ts");
  const serverRoot = path.join(root, "src", "server");
  const serverFiles = fs.existsSync(serverRoot) ? [...findSuffixDeep(serverRoot, ".ts", 6)] : [];
  const serverSegs = new Map(); // abs path → token 段（auth/journal 共用，一次读盘）
  for (const f of serverFiles) {
    try {
      serverSegs.set(f, tokenizeSource(fs.readFileSync(f, "utf8")));
    } catch { /* 读不了的文件不带信号 */ }
  }
  const isServerDomain = (r) => r.startsWith("src/server/") || r.startsWith("src/vendor/atelier/server/");

  // SERVER_IMPORT_LEAK（ATR-105）：前端入口可达图中不得出现 server 模块。server 模块之间互相
  // import 合法——BFS 遇 server 域文件只记违规不再展开（它们同属违规域，重复展开只会重复计数）。
  if (fs.existsSync(mainEntry)) {
    const leaks = [];
    const seen = new Set([rel(mainEntry)]);
    const queue = [[mainEntry, null]];
    while (queue.length) {
      const [file, importer] = queue.shift();
      let segs;
      try {
        segs = tokenizeSource(fs.readFileSync(file, "utf8"));
      } catch { continue; }
      for (const { spec, typeOnly } of extractImports(segs)) {
        if (typeOnly || !spec.startsWith(".")) continue; // 类型导入编译后消失；非相对说明符不进图
        const target = resolveTsPath(path.dirname(file), spec);
        if (!target) continue; // 解析失败不判（缺文件是别家检查的事，守卫不越权）
        const r = rel(target);
        if (seen.has(r)) continue;
        seen.add(r);
        if (isServerDomain(r)) {
          leaks.push(`${r} ← ${importer ? rel(importer) : "src/main.ts"}`);
          continue;
        }
        queue.push([target, file]);
      }
    }
    add(
      leaks.length
        ? { id: "SERVER_IMPORT_LEAK", layer: 7, severity: "ERROR", detail: `${leaks.length} server module(s) reachable from src/main.ts: ${leaks.slice(0, 4).join(" · ")}${leaks.length > 4 ? " …" : ""}`, fix: "frontend reaches server state only through endpoint HTTP calls (generated client, FS-DESIGN §8.1); move the import into src/server/** or the server entry — vendor/atelier/server must never enter the frontend graph" }
        : { id: "SERVER_IMPORT_LEAK", layer: 7, severity: null, detail: `src/main.ts import graph (${seen.size} module(s)) reaches no src/server/** or vendor server module` },
    );
  }

  // SERVER_AUTH_MISSING（WARN）：command 端点的 auth 必须显式声明（auth:{type:"none"} 消警）。
  const commandCalls = [];
  for (const [f, segs] of serverSegs) for (const c of scanDefineCommandKeys(segs, "auth")) commandCalls.push({ file: f, hasAuth: c.hasKey });
  if (serverFiles.length)
    add(
      commandCalls.some((c) => !c.hasAuth)
        ? {
            id: "SERVER_AUTH_MISSING",
            layer: 7,
            severity: "WARN",
            detail: `${commandCalls.filter((c) => !c.hasAuth).length}/${commandCalls.length} defineCommand call site(s) lack an explicit auth key (e.g. ${commandCalls.filter((c) => !c.hasAuth).slice(0, 3).map((c) => rel(c.file)).join(", ")})`,
            fix: 'declare auth per command — auth: { type: "none" } when intentionally unauthenticated, or a real type (session/…); silent default is the agent error zone (FS-DESIGN §6.2)',
          }
        : { id: "SERVER_AUTH_MISSING", layer: 7, severity: null, detail: `${commandCalls.length} defineCommand call site(s): every auth declaration is explicit` },
    );

  // SERVER_JOURNAL_SILENT（WARN）：command 端点存在但审计被整体关闭（config 位或构造处文本特征）。
  if (commandCalls.length) {
    const where = [];
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, "atelier.config.json"), "utf8"));
      if (cfg?.server?.journal === false) where.push("atelier.config.json (server.journal=false)");
    } catch { /* config 坏由 FACT_CONFIG_PARSE 报告 */ }
    const journalOff = /journalLimit\s*:\s*0\b|journal\s*:\s*false/;
    for (const [f, segs] of serverSegs) if (journalOff.test(segs.filter((s) => s.kind === "code").map((s) => s.text).join(""))) where.push(rel(f));
    const mainServer = path.join(root, "src", "main-server.ts");
    if (fs.existsSync(mainServer)) {
      try {
        if (journalOff.test(tokenizeSource(fs.readFileSync(mainServer, "utf8")).filter((s) => s.kind === "code").map((s) => s.text).join(""))) where.push("src/main-server.ts");
      } catch { /* 读不了不带信号 */ }
    }
    add(
      where.length
        ? { id: "SERVER_JOURNAL_SILENT", layer: 7, severity: "WARN", detail: `${commandCalls.length} command endpoint(s) exist but the audit journal is disabled (${where.slice(0, 3).join(", ")})`, fix: "re-enable the command journal (drop server.journal=false / journalLimit:0) — audit is a security semantic kept in prod, not a dev-only one (FS-DESIGN §3.7)" }
        : { id: "SERVER_JOURNAL_SILENT", layer: 7, severity: null, detail: `${commandCalls.length} command endpoint(s), audit journal active` },
    );
  }

  // IMPORT_ALLOWLIST（ATR-106，横切——归边界层展示）：全仓静态 bare import 必须 ∈ package.json
  // dependencies ∪ devDependencies（slopsquatting 对策，FS-DESIGN §9.2）。templates/ 是脚手架
  // 母版不是活代码（init 后由应用自身 package.json 对账），dist 是产物，都不在对象域内。
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
      const scanPool = [...findSuffixDeep(root, ".ts", 8), ...findSuffixDeep(root, ".mjs", 8)].filter((f) => {
        const r = rel(f);
        return !/(^|\/)(dist|templates)(\/|$)/.test(r);
      });
      const violations = new Set();
      for (const f of scanPool) {
        try {
          if (fs.statSync(f).size > 200_000) continue; // 大文件帽：守卫不做全量索引
          for (const { spec, typeOnly, dynamic } of extractImports(tokenizeSource(fs.readFileSync(f, "utf8")))) {
            if (typeOnly || dynamic) continue;
            const name = barePackageName(spec);
            if (name && !deps.has(name)) violations.add(`${rel(f)} → ${name}`);
          }
        } catch { /* 读不了的文件不带信号 */ }
      }
      const v = [...violations];
      add(
        v.length
          ? { id: "IMPORT_ALLOWLIST", layer: 7, severity: "ERROR", detail: `${v.length} bare import(s) outside package.json deps: ${v.slice(0, 4).join(" · ")}${v.length > 4 ? " …" : ""}`, fix: "hallucinated package? install the real one (add to package.json) or correct the specifier — bare names must resolve to dependencies ∪ devDependencies (slopsquatting guard)" }
          : { id: "IMPORT_ALLOWLIST", layer: 7, severity: null, detail: `${scanPool.length} source file(s): every static bare import resolves to package.json deps` },
      );
    } catch { /* package.json 坏 → 由包管理器/tsc 报告，此处不重复 */ }
  }
}

/* ---- 8 data（数据契约层，FS-DESIGN §5.4，FS-M2-a）---- */
export function probeDataLayer(root, add) {
  const migrationsDir = path.join(root, "src", "server", "db", "migrations");
  const migrationFiles = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => /^\d+_.*\.up\.sql$/.test(f) || /^\d+_.*\.down\.sql$/.test(f))
    : [];
  const devDb = path.join(root, ".atelier", "dev.db");

  // DB_MIGRATION_PAIR（ATR-331 对应的结构面）：up/down 成对，缺一 = 可逆性破口。
  if (fs.existsSync(migrationsDir)) {
    const stem = (f) => f.replace(/\.up\.sql$|\.down\.sql$/, "");
    const ups = new Set(migrationFiles.filter((f) => f.endsWith(".up.sql")).map(stem));
    const downs = new Set(migrationFiles.filter((f) => f.endsWith(".down.sql")).map(stem));
    const missing = [
      ...[...ups].filter((s) => !downs.has(s)).map((s) => `${s}: down missing`),
      ...[...downs].filter((s) => !ups.has(s)).map((s) => `${s}: up missing`),
    ];
    add(
      missing.length
        ? { id: "DB_MIGRATION_PAIR", layer: 8, severity: "ERROR", detail: `${missing.length} unpaired migration(s) in src/server/db/migrations/: ${missing.slice(0, 4).join(" · ")}${missing.length > 4 ? " …" : ""}`, fix: "add the missing .down.sql (or .up.sql) with the same stem — reversibility is a hard gate (ATR-331)" }
        : { id: "DB_MIGRATION_PAIR", layer: 8, severity: null, detail: `${ups.size} migration pair(s), every up has its down` },
    );
  }

  // DB_MIGRATION_CHECKSUM（ATR-332 对应的结构面）：已应用迁移文件字节被改 = ERROR。
  if (migrationFiles.length && fs.existsSync(devDb) && DatabaseSync) {
    try {
      const db = new DatabaseSync(devDb, { readOnly: true });
      try {
        const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='atelier_migrations'").get();
        if (hasTable) {
          const rows = db.prepare("SELECT name, checksum FROM atelier_migrations ORDER BY id").all();
          const mismatch = [];
          for (const row of rows) {
            // name 列存迁移 stem（如 001_create_chats）；宽容兼容全文件名形态
            const file = path.join(migrationsDir, `${row.name}.up.sql`);
            if (!fs.existsSync(file)) {
              mismatch.push(`${row.name}: file missing`);
              continue;
            }
            const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
            if (String(row.checksum ?? "").toLowerCase() !== actual) {
              mismatch.push(`${row.name}: db=${String(row.checksum).slice(0, 12)}… file=${actual.slice(0, 12)}…`);
            }
          }
          add(
            mismatch.length
              ? { id: "DB_MIGRATION_CHECKSUM", layer: 8, severity: "ERROR", detail: `${mismatch.length} applied migration(s) drifted from dev.db checksum: ${mismatch.slice(0, 4).join(" · ")}${mismatch.length > 4 ? " …" : ""}`, fix: "restore the original file bytes (git checkout) — never edit an applied migration; intentional rewrite needs a fresh db + migrate up (ATR-332)" }
              : { id: "DB_MIGRATION_CHECKSUM", layer: 8, severity: null, detail: `${rows.length} applied migration(s), checksums match file bytes` },
          );
        }
      } finally {
        db.close();
      }
    } catch { /* 打开失败（锁/权限/版本）→ 静默跳过 */ }
  }

  // DB_SCHEMA_DRIFT（WARN）：schema.ts 已声明而 dev.db 未建表 = 该出一次迁移了。
  const schemaFile = path.join(root, "src", "server", "db", "schema.ts");
  if (fs.existsSync(schemaFile) && fs.existsSync(devDb) && DatabaseSync) {
    try {
      const db = new DatabaseSync(devDb, { readOnly: true });
      try {
        const existing = new Set(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name),
        );
        existing.delete("atelier_migrations");
        const declared = extractTableNames(tokenizeSource(fs.readFileSync(schemaFile, "utf8")));
        const missing = [...declared].filter((t) => !existing.has(t));
        add(
          missing.length
            ? { id: "DB_SCHEMA_DRIFT", layer: 8, severity: "WARN", detail: `schema.ts declares ${missing.length} table(s) absent from dev.db: ${missing.join(", ")}`, fix: "publish and apply a migration for these tables (gen db → migrate up) — schema.ts drifted ahead of dev.db" }
            : { id: "DB_SCHEMA_DRIFT", layer: 8, severity: null, detail: `schema.ts: ${declared.size} declared table(s) all present in dev.db` },
        );
      } finally {
        db.close();
      }
    } catch { /* 打开失败 → 静默跳过 */ }
  }
}

/** 八层探针表（R3 结构债：probeChecks 的分派单源——表序 = 层序 = 报告顺序；直测面见
 * tests/struct-layers.test.ts：表形状 / 层隔离 / 表序直调 ≡ inspectStructure 全量输出）。 */
export const LAYER_PROBES = [
  { layer: 1, name: "entry", probe: probeEntryLayer },
  { layer: 2, name: "knowledge", probe: probeKnowledgeLayer },
  { layer: 3, name: "facts", probe: probeFactsLayer },
  { layer: 4, name: "intent", probe: probeIntentLayer },
  { layer: 5, name: "errors", probe: probeErrorsLayer },
  { layer: 6, name: "timeline", probe: probeTimelineLayer },
  { layer: 7, name: "boundary", probe: probeBoundaryLayer },
  { layer: 8, name: "data", probe: probeDataLayer },
];

function probeChecks(root) {
  /** Each finding: { id, layer, severity|null(null==ok), detail, fix? } */
  const f = [];
  const add = (o) => f.push(o);
  const has = (rel) => fs.existsSync(path.join(root, rel));

  // R3 结构债：表驱动分派（原 394 行平铺 → 八层各一函数）；表序 = 层序 = 报告顺序
  for (const { probe } of LAYER_PROBES) probe(root, add);

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

/* ---------- 源码扫描件（FS-M2-a 边界守卫，layer 7/8）--------------------------------
 * tokenizer：把源码切成 code / str / comment 三种段（mode-stack，与 compiler/dump.mjs 的
 * html`` 扫描器同构——那里防模板嵌套，这里防"注释/字符串里长得像 import 的文本"误报）。
 * import 图、defineCommand 调用位、table( 表名全部建立在"真 code 段 + 紧邻 str 段"的配对上。
 * 诚实边界：①正则字面量（/.../）不识别——其中出现 import 语句形态的概率可忽略，不为此引入
 * 歧义判定；②模板串的 ${...} 插值整体归 str 段，两层以上嵌套插值不保证分帧正确（守卫用途
 * 下最坏是漏报一次）；③禁用 TS 解析器/eval——静态文本扫描，零依赖纪律（决策 0/2 同源）。 */
function tokenizeSource(src) {
  const segs = [];
  let buf = "";
  let i = 0;
  const n = src.length;
  const flush = () => { if (buf) { segs.push({ kind: "code", text: buf }); buf = ""; } };
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      // 行注释（换行留给下段 code，保行结构）
      flush();
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      segs.push({ kind: "comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      // 块注释
      flush();
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      segs.push({ kind: "comment", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      // 字符串/模板串（escape 感知；模板 ${...} 插值整体留段内——见诚实边界②）
      flush();
      let j = i + 1;
      let interp = 0;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (interp === 0 && src[j] === c) { j++; break; }
        if (c === "`") {
          if (interp === 0 && src[j] === "$" && src[j + 1] === "{") { interp = 1; j += 2; continue; }
          if (interp === 1 && src[j] === "}") interp = 0;
        }
        j++;
      }
      segs.push({ kind: "str", text: src.slice(i, j), q: c });
      i = j;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return segs;
}

/** 静态 import 说明符提取：code 段尾关键词（from / import）+ 紧邻 str 段配对。
 * typeOnly（import type / export type）单独标记——类型导入编译后消失，不进运行时可达图，
 * 也不进依赖白名单对账（类型包未安装也合法）。dynamic import() 单独标记——可达性守卫追它
 * （运行时会加载），依赖白名单 v1 不查（运行时分支，sqlite 宿主探测同型；记 B 队）。 */
function extractImports(segs) {
  const stream = segs.filter((s) => s.kind !== "comment");
  const out = [];
  for (let k = 0; k < stream.length - 1; k++) {
    if (stream[k].kind !== "code") continue;
    const next = stream[k + 1];
    if (next.kind !== "str" || (next.q !== '"' && next.q !== "'")) continue;
    const tail = stream[k].text.replace(/\s+$/, "");
    if (/\bimport\s*\($/.test(tail)) {
      out.push({ spec: next.text.slice(1, -1), typeOnly: false, dynamic: true });
      continue;
    }
    if (/from\s*$/.test(tail)) {
      // type 判定 = 段内最后一个 import/export 关键字是否带 type（段内可能残留前一条语句的收尾）
      let last = null;
      for (const m of tail.matchAll(/(?:^|[;}\s])(import|export)\s+(type\b)?/g)) last = m;
      out.push({ spec: next.text.slice(1, -1), typeOnly: Boolean(last && last[2]), dynamic: false });
      continue;
    }
    if (/\bimport\s*$/.test(tail)) out.push({ spec: next.text.slice(1, -1), typeOnly: false, dynamic: false });
  }
  return out;
}

/** bare import 包名提取：相对（./ ../）、绝对（/ 与盘符）、内部别名（#subpath imports）、
 * 协议形态（node:/file:/data:/http:…）都不算 bare。@scope 包取两段。 */
function barePackageName(spec) {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) return null;
  if (/^[a-zA-Z][\w+.-]*:/.test(spec)) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? parts.slice(0, 2).join("/") : spec;
  }
  return spec.split("/")[0];
}

/** 相对说明符 → 磁盘文件（Atelier 显式 .ts 后缀为主，兼容 index/atr 变体与 js→ts 映射）。 */
function resolveTsPath(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  const cands = [base, `${base}.ts`, `${base}.atr.ts`, base.replace(/\.js$/, ".ts"), path.join(base, "index.ts"), `${path.join(base, "index")}.atr.ts`];
  for (const c of cands) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch { /* miss → try next */ }
  }
  return null;
}

/** token 流上扫 defineCommand( 调用位，判定选项对象顶层是否带 key（auth）。
 * 骨架重建：str 段 → ""，对象内 depth>1 的 code 字符 → 空格——骨架上 key: 只可能是顶层键
 * （handler 体内的同名标识符/嵌套对象既不会消警也不会误报），"沉默缺省才是 agent 高错区"。 */
function scanDefineCommandKeys(segs, key) {
  const stream = segs.filter((s) => s.kind !== "comment");
  const calls = [];
  for (let k = 0; k < stream.length; k++) {
    if (stream[k].kind !== "code") continue;
    for (const m of stream[k].text.matchAll(/\bdefineCommand\s*\(/g)) {
      calls.push({ hasKey: optionObjectHasKey(stream, k, m.index + m[0].length, key) });
    }
  }
  return calls;
}

function optionObjectHasKey(stream, segIdx, charOffset, key) {
  // 阶段一：在圆括号深度 1 处找选项对象的 `{`（第一参数是名字字符串，str 段原子跳过）
  let paren = 1;
  let objStart = null; // [tokenIdx, charIdx]
  outer: for (let k = segIdx; k < stream.length; k++) {
    const seg = stream[k];
    if (seg.kind === "str") continue;
    const from = k === segIdx ? charOffset : 0;
    for (let i = from; i < seg.text.length; i++) {
      const c = seg.text[i];
      if (c === "(") paren++;
      else if (c === ")") { paren--; if (paren === 0) return false; } // 调用括号先闭合 = 无选项对象
      else if (paren === 1 && c === "{") { objStart = [k, i]; break outer; }
    }
  }
  if (!objStart) return false;
  // 阶段二：对象内统一括号深度计数（handler 的 () => {} 混合嵌套也正确），重建顶层骨架
  let depth = 1;
  let skel = "{";
  for (let k = objStart[0]; k < stream.length; k++) {
    const seg = stream[k];
    if (seg.kind === "str") { skel += '""'; continue; }
    const from = k === objStart[0] ? objStart[1] : 0;
    for (let i = from; i < seg.text.length; i++) {
      const c = seg.text[i];
      if (k === objStart[0] && i === from) { skel = "{"; continue; } // 起始 { 不重复入骨架
      if ("{([".includes(c)) depth++;
      else if ("})]".includes(c)) { depth--; if (depth === 0) return optionSkelHasKey(skel, key); }
      skel += depth === 1 ? c : " ";
    }
  }
  return optionSkelHasKey(skel, key); // 未闭合（截断文件）按骨架判——守卫不替编译器报语法
}

function optionSkelHasKey(skel, key) {
  return new RegExp(`(?:^|[{,])\\s*${key}\\s*:`).test(skel);
}

/** schema.ts 的 table("<name>" 表名提取：code 段尾 table( + 紧邻 str 段配对（成员访问 .table( 排除）。 */
function extractTableNames(segs) {
  const stream = segs.filter((s) => s.kind !== "comment");
  const names = new Set();
  for (let k = 0; k < stream.length - 1; k++) {
    if (stream[k].kind !== "code" || stream[k + 1].kind !== "str") continue;
    if (/(?<!\.)\btable\s*\($/.test(stream[k].text.replace(/\s+$/, ""))) {
      const name = stream[k + 1].text.slice(1, -1);
      if (name) names.add(name);
    }
  }
  return names;
}

/* ---------- P2-3 skill trigger automation ------------------------------------
 * structure.map carries a `suggestSkills` field so agent-side routing can load
 * packs by structured signal instead of prose trigger words. Signals are cheap
 * and bounded: suffix globs + a capped keyword scan (≤30 files × 120KB).
 */
function scanKeyword(root, files, re) {
  for (const f of files.slice(0, 30)) {
    try {
      if (fs.statSync(f).size > 120_000) continue;
      if (re.test(fs.readFileSync(f, "utf8"))) return true;
    } catch { /* unreadable file just carries no signal */ }
  }
  return false;
}

function suggestSkills(root) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
  const atrComponents = [...findSuffixDeep(root, ".atr.ts", 6)];
  const atrSpecTests = [...findSuffixDeep(root, ".atr.spec.ts", 6)];
  const srcTs = [...findSuffixDeep(path.join(root, "src"), ".ts", 4)];
  const scanPool = [...atrComponents, ...srcTs];
  const packs = [{ pack: "atelier", because: "entry — read first for any Atelier task" }];
  if (atrComponents.length)
    packs.push({ pack: "atelier-component-model", because: `${atrComponents.length} *.atr.ts component(s) on disk` });
  if (atrComponents.length || has("atelier.config.json"))
    packs.push({ pack: "atelier-styling", because: atrComponents.length ? "components carry style blocks bound to tokens" : "token SSOT (atelier.config.json) present" });
  if (scanKeyword(root, scanPool, /\$state\b|\bstore\b|store\.commit/))
    packs.push({ pack: "atelier-state-transactions", because: "$state/store usage detected in sources" });
  if (scanKeyword(root, scanPool, /\bstreamValue\b|\boptimisticList\b/))
    packs.push({ pack: "atelier-streaming", because: "streamValue/optimisticList usage detected" });
  if (atrSpecTests.length || has(".atr/snapshots") || has("tests"))
    packs.push({ pack: "atelier-testing", because: atrSpecTests.length ? `${atrSpecTests.length} co-located *.atr.spec.ts` : "snapshot/test surfaces present" });
  if (has(".atelier/dev-token") || has("scripts/atelier-dev-plugin.mjs") || has("atelier/dev"))
    packs.push({ pack: "atelier-mcp-tools", because: "dev face present — query state via MCP instead of reading files" });
  packs.push({ pack: "atelier-error-codes", because: "load reactively on any ATR-xxx error", reactive: true });
  return packs;
}

export function inspectStructure(root = process.cwd()) {
  const findings = probeChecks(root);
  const LAYERS = [
    [1, "entry — routing tables"],
    [2, "knowledge — progressive disclosure"],
    [3, "facts — SSOT registries"],
    [4, "intent — human-owned specs"],
    [5, "errors — failure as navigation"],
    [6, "timeline — reversible time"],
    [7, "boundary — import frontier & server edges"],
    [8, "data — contracts and migrations"],
  ];
  const layers = LAYERS.map(([id, title]) => ({
    layer: id,
    title,
    findings: findings.filter((f) => f.layer === id),
  }));
  const count = (sev) => findings.filter((f) => f.severity === sev).length;
  return {
    root: path.resolve(root),
    modelVersion: "eight-layer/v0.3",
    summary: { errors: count("ERROR"), warnings: count("WARN"), infos: count("INFO"), ok: findings.filter((f) => f.severity === null).length },
    layers,
    suggestSkills: suggestSkills(root), // P2-3: structured trigger field for agent-side routing
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
  console.log("\nsuggested skill packs (load on demand):");
  for (const s of res.suggestSkills) console.log(`  · ${s.pack} — ${s.because}`);
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
