#!/usr/bin/env node
/**
 * api-diff.mjs — P3-4 公共 API diff 门禁与漂移度量原型（AI slop 对策的框架化，TECH-SCAN §4.7）。
 *
 * 实现档位（诚实标注）：MINI —— 语法级提取器（正则/括号配对），非完整 TS 语义分析；
 *   不解析跨文件类型别名、不做重导出解析（export * 记为 star 面）。
 *
 * 面（surfaces，按 root 布局自动判定）：
 *   框架仓 root（含 atelier/runtime/）：
 *     runtime-exports   runtime/*.ts 导出符号（id=符号名，kind=value|type|star:模块）
 *     cli-commands      cli.mjs 顶层 dispatch 的 case 命令词
 *     mcp-tools         mcp/mcp-definitions.json tools[].name
 *     token-keys        templates/app/atelier.config.json tokens 扁平路径（value 仅入漂移指标）
 *   应用 root（含 src/components + atelier.config.json）：
 *     component-contracts  src/components/*.atr.ts 契约 reqProps/optProps（id=Comp.path，kind=req|opt，type）
 *     token-keys           应用 atelier.config.json tokens 扁平路径
 *
 * diff 分类（门禁语义）：
 *   removed / changed            = breaking（exit 1；--allow 清单可豁免）
 *   added                        = additive（exit 0；--strict 时也 fail）
 *   contract kind req→opt        = relaxed（非破坏，放行）；opt→req = breaking
 *   token value 变化             = valueDrift（信息性，不破坏；键消失 = breaking）
 *
 * 漂移指标：每面 added/removed/changed 计数 + churn（变更条目 / baseline 总条目）。
 *
 * 用法：
 *   node atelier/scripts/api-diff.mjs snapshot [--root <dir>] [--out <file>] [--json]
 *   node atelier/scripts/api-diff.mjs check    [--root <dir>] [--baseline <file>] [--allow <file>] [--strict] [--json]
 * 退出码：0 ok · 1 gate failed · 2 usage/缺 baseline
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export const SCHEMA_VERSION = 1;

/* ---------------- 通用小件 ---------------- */

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}
function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
function readJson(p) {
  const t = readText(p);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`JSON 解析失败 ${p}: ${e.message}`);
  }
}
/** 引号感知的配对花括号扫描：返回 openIdx 对应闭括号下标，找不到返回 -1。 */
export function matchBrace(text, openIdx) {
  let depth = 0, quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return text.length - 1; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function flattenTokens(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flattenTokens(v, p, out);
    else out[p] = String(v);
  }
  return out;
}

/* ---------------- 提取器（每面返回 entry 数组） ----------------
 * entry 统一形态：{ id, kind?, type?, value? }；id 在面内唯一。
 */

/** runtime/*.ts 导出面 */
export function extractRuntimeExports(runtimeDir) {
  const entries = new Map();
  for (const f of fs.readdirSync(runtimeDir).filter((n) => n.endsWith(".ts")).sort()) {
    const text = readText(path.join(runtimeDir, f)) ?? "";
    // export * from "x" → star 面（重导出解析不做，诚实记名）
    for (const m of text.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
      entries.set(`star:${m[1]}`, { id: `star:${m[1]}` });
    }
    // export type { A, B } ... / export { A, type B } ...
    for (const m of text.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
      const forceType = !!m[1];
      for (const raw of m[2].split(",")) {
        const seg = raw.trim();
        if (!seg) continue;
        const t = /^(?:type\s+)?([A-Za-z_$][\w$]*)/.exec(seg);
        if (!t) continue;
        const isType = forceType || /^type\s/.test(seg);
        entries.set(t[1], { id: t[1], kind: isType ? "type" : "value" });
      }
    }
    // export const|let|function|class Name / export type Name = / export interface Name
    for (const m of text.matchAll(/export\s+(const|let|function\*?|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
      const isType = m[1] === "type" || m[1] === "interface";
      entries.set(m[2], { id: m[2], kind: isType ? "type" : "value" });
    }
  }
  return [...entries.values()].sort(byId);
}

/** cli.mjs 顶层 dispatch 命令面 */
export function extractCliCommands(cliFile) {
  const text = readText(cliFile) ?? "";
  const names = new Set();
  for (const m of text.matchAll(/^\s*case\s+"([a-z][\w-]*)":/gm)) names.add(m[1]);
  return [...names].sort().map((id) => ({ id }));
}

/** mcp-definitions.json 工具名面 */
export function extractMcpTools(defsFile) {
  const defs = readJson(defsFile);
  if (!defs?.tools) return [];
  return defs.tools.map((t) => ({ id: t.name })).sort(byId);
}

/** atelier.config.json token 键面（value 进漂移指标，不进门禁身份） */
export function extractTokenKeys(configFile) {
  const cfg = readJson(configFile);
  if (!cfg) return [];
  const flat = flattenTokens(cfg.tokens ?? {});
  return Object.keys(flat).sort().map((id) => ({ id, value: flat[id] }));
}

/** *.atr.ts 契约面：reqProps/optProps 键与类型（语法级：{ type: "..." } 形态） */
export function extractComponentContracts(componentsDir) {
  const entries = [];
  if (!fs.existsSync(componentsDir)) return entries;
  for (const f of fs.readdirSync(componentsDir).filter((n) => n.endsWith(".atr.ts")).sort()) {
    const text = readText(path.join(componentsDir, f)) ?? "";
    const fnName = /component\(\s*function\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1] ?? f.replace(/\.atr\.ts$/, "");
    for (const blockKind of ["reqProps", "optProps"]) {
      const open = text.indexOf(`${blockKind}:`);
      if (open < 0) continue;
      const braceOpen = text.indexOf("{", open);
      if (braceOpen < 0) continue;
      const braceClose = matchBrace(text, braceOpen);
      if (braceClose < 0) continue;
      const body = text.slice(braceOpen + 1, braceClose);
      for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{\s*type:\s*"([^"]+)"/g)) {
        entries.push({ id: `${fnName}.${m[1]}`, kind: blockKind === "reqProps" ? "req" : "opt", type: m[2] });
      }
    }
  }
  return entries.sort(byId);
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ---------------- 布局判定与面集合 ---------------- */

export function detectLayout(root) {
  const isFramework = fs.existsSync(path.join(root, "atelier", "runtime"));
  const isApp = fs.existsSync(path.join(root, "src", "components")) && fs.existsSync(path.join(root, "atelier.config.json"));
  if (isFramework) return "framework";
  if (isApp) return "app";
  return null;
}

/** 提取 root 的全部面；--surfaces 可选子集。未知面显式报错（不静默跳过）。 */
export function extractSurfaces(root, only = null) {
  const layout = detectLayout(root);
  if (!layout) {
    throw new Error(`无法判定 root 布局（既非框架仓也非 Atelier 应用）：${root}`);
  }
  const extractors =
    layout === "framework"
      ? {
          "runtime-exports": () => extractRuntimeExports(path.join(root, "atelier", "runtime")),
          "cli-commands": () => extractCliCommands(path.join(root, "atelier", "cli.mjs")),
          "mcp-tools": () => extractMcpTools(path.join(root, "atelier", "mcp", "mcp-definitions.json")),
          "token-keys": () => extractTokenKeys(path.join(root, "atelier", "templates", "app", "atelier.config.json")),
        }
      : {
          "component-contracts": () => extractComponentContracts(path.join(root, "src", "components")),
          "token-keys": () => extractTokenKeys(path.join(root, "atelier.config.json")),
        };
  const names = Object.keys(extractors);
  const surfaces = {};
  if (only) {
    const want = only.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = want.filter((w) => !extractors[w]);
    if (unknown.length) throw new Error(`未知面（本布局可用：${names.join(", ")}）：${unknown.join(", ")}`);
    for (const w of want) surfaces[w] = extractors[w]();
  } else {
    for (const [n, fn] of Object.entries(extractors)) surfaces[n] = fn();
  }
  return { layout, surfaces };
}

/* ---------------- snapshot / diff / gate ---------------- */

export function makeSnapshot(root, only = null) {
  const { layout, surfaces } = extractSurfaces(root, only);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    // 只留目录名：快照入库作 CI 门禁基线，绝对本地路径不进公共库
    root: path.basename(root),
    layout,
    surfaces,
  };
}

/** diff：removed/changed = breaking；added = additive；contract req→opt = relaxed。
 * budget（0..1）：token 值漂移条目占 baseline token 条目的比例上限，超限 = 门禁红（冻结令牌场景）。 */
export function diffSurfaces(baseline, current, { strict = false, budget = null } = {}) {
  const surfaces = {};
  const totals = { added: 0, removed: 0, changed: 0, relaxed: 0, valueDrift: 0, breaking: 0, baselineEntries: 0 };
  const allNames = [...new Set([...Object.keys(baseline.surfaces ?? {}), ...Object.keys(current.surfaces ?? {})])].sort();
  for (const name of allNames) {
    const before = baseline.surfaces?.[name] ?? [];
    const after = current.surfaces?.[name] ?? [];
    const beforeMap = new Map(before.map((e) => [e.id, e]));
    const afterMap = new Map(after.map((e) => [e.id, e]));
    const added = [], removed = [], changed = [], relaxed = [], valueDrift = [];
    for (const [id, e] of afterMap) {
      if (!beforeMap.has(id)) {
        added.push(e);
        continue;
      }
      const b = beforeMap.get(id);
      if (name === "token-keys") {
        if (b.value !== e.value) valueDrift.push({ id, from: b.value, to: e.value });
      } else if (name === "component-contracts") {
        if (b.kind !== e.kind) {
          if (b.kind === "req" && e.kind === "opt") relaxed.push({ id, from: b.kind, to: e.kind });
          else changed.push({ id, from: `${b.kind}:${b.type ?? ""}`, to: `${e.kind}:${e.type ?? ""}` });
        } else if (b.type !== e.type) {
          changed.push({ id, from: b.type, to: e.type });
        }
      } else if (b.kind !== e.kind) {
        changed.push({ id, from: b.kind, to: e.kind });
      }
    }
    for (const [id, e] of beforeMap) if (!afterMap.has(id)) removed.push(e);
    const breaking = removed.length + changed.length;
    surfaces[name] = {
      added: added.map((e) => e.id),
      removed: removed.map((e) => e.id),
      changed,
      relaxed,
      valueDrift,
      breaking,
    };
    totals.added += added.length;
    totals.removed += removed.length;
    totals.changed += changed.length;
    totals.relaxed += relaxed.length;
    totals.valueDrift += valueDrift.length;
    totals.breaking += breaking;
    totals.baselineEntries += before.length;
  }
  const drift = totals.baselineEntries
    ? (totals.added + totals.removed + totals.changed + totals.relaxed + totals.valueDrift) / totals.baselineEntries
    : 0;
  const summary = {
    ...totals,
    churn: Number(drift.toFixed(4)),
    ok: strict ? totals.breaking === 0 && totals.added === 0 : totals.breaking === 0,
  };
  if (budget !== null) {
    const tokenBefore = baseline.surfaces?.["token-keys"]?.length ?? 0;
    const ratio = tokenBefore ? totals.valueDrift / tokenBefore : 0;
    summary.valueBudget = budget;
    summary.valueDriftRatio = Number(ratio.toFixed(4));
    if (ratio > budget) {
      summary.ok = false;
      summary.valueBudgetExceeded = { count: totals.valueDrift, total: tokenBefore, budget };
    }
  }
  return { schemaVersion: SCHEMA_VERSION, comparedAt: new Date().toISOString(), summary, surfaces };
}

/** 门禁判定：allowlist 豁免（entry 形如 `面:id`）。 */
export function judge(diffResult, allowIds = []) {
  const allow = new Set(allowIds);
  const violations = [];
  for (const [name, s] of Object.entries(diffResult.surfaces)) {
    for (const id of s.removed) if (!allow.has(`${name}:${id}`)) violations.push({ surface: name, kind: "removed", id });
    for (const c of s.changed) if (!allow.has(`${name}:${c.id}`)) violations.push({ surface: name, kind: "changed", id: `${c.id} (${c.from} → ${c.to})` });
  }
  if (diffResult.summary.ok === false && diffResult.summary.breaking === 0) {
    // strict 模式（--strict）：added 也算违规
    for (const [name, s] of Object.entries(diffResult.surfaces)) {
      for (const id of s.added) violations.push({ surface: name, kind: "added(strict)", id });
    }
  }
  const b = diffResult.summary.valueBudgetExceeded;
  if (b) violations.push({ surface: "token-keys", kind: "value-budget", id: `valueDrift ${b.count}/${b.total} > budget ${b.budget}` });
  return { ...diffResult, violations };
}

/* ---------------- CLI ---------------- */

function isMain() {
  try {
    return url.pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const has = (name) => argv.includes(name);
  const jsonOut = has("--json");
  const root = path.resolve(flag("--root") ?? process.cwd());

  try {
    if (sub === "snapshot") {
      const out = path.resolve(flag("--out") ?? path.join(root, ".atelier", "api-surface.json"));
      const snap = makeSnapshot(root, flag("--surfaces"));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
      const counts = Object.fromEntries(Object.entries(snap.surfaces).map(([k, v]) => [k, v.length]));
      if (jsonOut) console.log(JSON.stringify({ ok: true, out, layout: snap.layout, counts }, null, 2));
      else {
        console.log(`[atelier api-diff] snapshot written → ${out}`);
        console.log(`  layout: ${snap.layout}`);
        for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(22)} ${v} entries`);
      }
      process.exit(0);
    }

    if (sub === "check") {
      const baselinePath = path.resolve(flag("--baseline") ?? path.join(root, ".atelier", "api-surface.json"));
      const baseline = readJson(baselinePath);
      if (!baseline) {
        die(`缺 baseline（${baselinePath}）——先跑: node atelier/cli.mjs api-diff snapshot --root ${root}`, 2);
      }
      const current = makeSnapshot(root, flag("--surfaces"));
      const allowFile = flag("--allow");
      const allowIds = allowFile ? readJson(path.resolve(allowFile))?.accepted ?? [] : [];
      let budget = null;
      if (has("--budget")) {
        budget = Number(flag("--budget"));
        if (!Number.isFinite(budget) || budget < 0 || budget > 1) die("--budget 需为 0..1 的比例（如 0.02 = 值漂移 ≤2%）", 2);
      }
      const result = judge(diffSurfaces(baseline, current, { strict: has("--strict"), budget }), allowIds);
      if (jsonOut) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const s = result.summary;
        console.log(`[atelier api-diff] check vs ${path.basename(baselinePath)}`);
        console.log(`  entries(baseline): ${s.baselineEntries} · churn ${(s.churn * 100).toFixed(2)}%`);
        if (s.valueBudget !== undefined) console.log(`  value budget: ${(s.valueDriftRatio * 100).toFixed(2)}% / ${(s.valueBudget * 100).toFixed(2)}%`);
        for (const [name, surf] of Object.entries(result.surfaces)) {
          const n = surf.added.length + surf.removed.length + surf.changed.length + surf.relaxed.length + surf.valueDrift.length;
          if (!n) continue;
          console.log(`  ${name}: +${surf.added.length} -${surf.removed.length} ~${surf.changed.length} relaxed=${surf.relaxed.length} valueDrift=${surf.valueDrift.length}`);
          for (const id of surf.removed) console.log(`    - removed  ${id}`);
          for (const id of surf.added) console.log(`    + added    ${id}`);
          for (const c of surf.changed) console.log(`    ~ changed  ${c.id} (${c.from} → ${c.to})`);
          for (const r of surf.relaxed) console.log(`    = relaxed  ${r.id} (req→opt)`);
          for (const v of surf.valueDrift) console.log(`    ≈ value    ${v.id} (${v.from} → ${v.to})`);
        }
        if (result.violations.length) {
          console.error(`\n[gate] BREAKING (${result.violations.length}) —— 未在 allowlist 中豁免:`);
          for (const v of result.violations) console.error(`  · ${v.surface}:${v.id} [${v.kind}]`);
        }
      }
      // 放行判定只看 violations（allowlist 豁免后 summary.breaking 仍>0 是记账事实，不再卡门）
      const passed = result.violations.length === 0;
      if (!jsonOut) console.log(`\n[gate] ${passed ? "PASS — 无未豁免破坏性变更" : "FAIL"}`);
      process.exit(passed ? 0 : 1);
    }

    die("usage: api-diff.mjs snapshot|check [--root <dir>] [--json] [--strict] [--allow <file>] [--budget <0..1>]", 2);
  } catch (e) {
    die(`error: ${e.message}`, 2);
  }
}
