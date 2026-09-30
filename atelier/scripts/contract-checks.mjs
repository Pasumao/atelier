#!/usr/bin/env node
/**
 * contract-checks.mjs — R2 批契约面单源化机检（2026-09-30 架构评审 §2.2 风险 3「同步纪律停留在
 * 注释层面」/ §4.3 文档技能面失真清单 / §6 批次 R2 的兑现件）。
 *
 * 把「三处/四面同步」从注释纪律变成机检（exit 1 = 红）：
 *
 *   CHECK 1  错误码反向对账：代码实抛/实引 ATR-\d{3} 全集（runtime|server|dev|mcp|gen|compiler|scripts）
 *            ⊆ 错误码总表。对账基准（SSOT）= skills/atelier-error-codes/SKILL.md（ERR_CATALOG，
 *            cause/example/fix 四段式唯一全表——check-skills D 检「skill 引用 ⊆ 表」已以此为准；
 *            FS-DESIGN §15 与 SPEC-Agentic-DX-v0.2 §3.2 是导航投影，三张表码集必须两两相等，
 *            由本检查钉死）。白名单：ATR-402 双语义（confirm 拒绝 + dev-token 校验失败同码）——
 *            拆分归 R3 批（confirm 侧归 R3；dev-token 侧文件在并行支线 D 手里），见 DUAL_SEMANTICS。
 *
 *   CHECK 2  ARCHITECTURE §8 CLI 表 ↔ cli.mjs dispatch 对账：§8 动词 = dispatch 动词（双向，
 *            help 自指豁免），§8 旗标 ⊆ HELP 旗标——「init --ai 实为 --no-ai」「--static/--electron
 *            幻影旗标」这类权威表漂移直接红。
 *
 *   CHECK 3  check-skills 白名单派生接线自证：CLI_VERBS/FLAGS/RUNTIME_API 必须从
 *            cli.mjs dispatch / HELP / runtime/index.ts 桶出口派生（R2 批起手抄白名单退役——
 *            报告坐实其含 runtime 根本不导出的 expect/verify 与已删命令的 --ai/--static/--electron）；
 *            桶出口健康哨兵（核心 API 在位 + 幻影 API 不回流）。
 *
 * 派生函数导出给 check-skills.mjs 复用；行为由 tests/contract-checks.test.ts 钉住。
 * 零依赖 node 脚本；风格对齐 check-skills.mjs / docs-numbers.mjs。
 *
 * Exit: 0 = all green; 1 = violations found.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { extractCliCommands } from "./api-diff.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, ".."); // atelier/
const SELF = url.fileURLToPath(import.meta.url);

/** CHECK 1 扫描面（评审 §6 R2 口径）：七个源码目录 */
const SCAN_DIRS = ["runtime", "server", "dev", "mcp", "gen", "compiler", "scripts"];
const SCAN_EXT = new Set([".ts", ".mjs", ".js"]);

/**
 * 双语义/例外白名单：码 → 理由。条目必须是总表已收录码（本检查顺带验证，防白名单引用幻影码）。
 * ATR-402：confirm 档拒绝（mcp 面）与 dev-token 校验失败（dev 面 / snapshot 直调）当前共用一码——
 * 拆分归 R3 批（confirm 侧归 R3；dev-token 侧的文件在并行支线 D 手里，本批不碰）。
 */
const DUAL_SEMANTICS = {
  "ATR-402": "双语义（confirm 拒绝 + dev-token 校验失败）同码——拆分归 R3 批，本批显式白名单不拦",
};

/* ---------------- 派生函数（check-skills.mjs 复用；vitest 钉住） ---------------- */

/** cli.mjs 顶层 dispatch 动词集（复用 api-diff 同一提取器——单一真相不二抄）。 */
export function extractDispatchVerbs(cliFile) {
  return new Set(extractCliCommands(cliFile).map((e) => e.id));
}

/** cli.mjs HELP 块声明的旗标集（--flag）。只读 HELP 模板字面量——dispatch 体里的旗标
 *  字符串（如 init 的 argvAll.includes("--target")）不算数：文档化面才是技能包的对账基准。 */
export function extractHelpFlags(cliFile) {
  const text = readText(cliFile) ?? "";
  const m = /const HELP = `([\s\S]*?)`;/.exec(text);
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/--[a-z][\w-]*/g)].map((x) => x[0]));
}

/** runtime/index.ts 桶出口 API 面：{ values, types }。只认桶出口（单文件）——runtime/*.ts
 *  内部模块的 export 不是公共面（api-diff 的 runtime-exports 面扫全目录，语义不同，勿混）。 */
export function extractBarrelApi(indexFile) {
  const text = readText(indexFile) ?? "";
  const values = new Set();
  const types = new Set();
  // export { A, type B } from "./x.ts" / export type { C } from "./x.ts"
  for (const m of text.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    const forceType = !!m[1];
    for (const raw of m[2].split(",")) {
      const seg = raw.trim();
      if (!seg) continue;
      const isType = forceType || /^type\s/.test(seg);
      // 别名取暴露名（A as B → B）
      const named = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/.exec(seg);
      if (!named) continue;
      (isType ? types : values).add(named[2] ?? named[1]);
    }
  }
  // export function devFetch / export const X / export type Y / export interface Z
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|var)\s+([A-Za-z_$][\w$]*)/g)) values.add(m[1]);
  for (const m of text.matchAll(/export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g)) types.add(m[1]);
  return { values, types };
}

/** 递归扫目录收集 ATR-\d{3} 出现点（实抛与实引同权——被引用进错误文案/注释的码同样在
 *  「错误即导航」面上，必须可查表）。返回 Map<code, [{file, line}]>，file 相对 atelier/。 */
export function scanAtrCodes(root, dirs, { self = null } = {}) {
  const found = new Map();
  const record = (code, file, line) => {
    if (!found.has(code)) found.set(code, []);
    found.get(code).push({ file, line });
  };
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const absP = path.join(abs, entry.name);
      const relP = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absP, relP);
      else if (SCAN_EXT.has(path.extname(entry.name))) {
        if (self && path.resolve(absP) === path.resolve(self)) continue; // 本脚本自身的示例码不入账
        const lines = (readText(absP) ?? "").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          for (const m of lines[i].matchAll(/ATR-(\d{3})/g)) record(`ATR-${m[1]}`, relP, i + 1);
        }
      }
    }
  };
  for (const dir of dirs) walk(path.join(root, dir), dir);
  return found;
}

/** 错误码总表（ERR_CATALOG SKILL.md）码集 */
export function parseCatalogCodes(catalogFile) {
  return new Set([...(readText(catalogFile) ?? "").matchAll(/ATR-(\d{3})/g)].map((m) => `ATR-${m[1]}`));
}

/** FS-DESIGN §15 码集：ATR-xxx 行 + ATR-340/341 斜杠对 + 「既有」摘要行的裸三位数字组 */
export function parseFsDesignSection(fsDesignFile, { from = /^## 15\./m, to = /^## 16\./m } = {}) {
  const section = sliceSection(readText(fsDesignFile) ?? "", from, to);
  const codes = new Set();
  for (const m of section.matchAll(/ATR-(\d{3})\/(\d{3})/g)) { codes.add(`ATR-${m[1]}`); codes.add(`ATR-${m[2]}`); }
  for (const m of section.matchAll(/ATR-(\d{3})/g)) codes.add(`ATR-${m[1]}`);
  for (const line of section.split(/\r?\n/)) {
    if (!/\|\s*既有\s*\|/.test(line)) continue;
    for (const m of line.matchAll(/(?<!\d)(\d{3})(?!\d)/g)) codes.add(`ATR-${m[1]}`);
  }
  return codes;
}

/** SPEC-Agentic-DX §3.2 错误导航表码集 */
export function parseSpecSection(specFile, { from = /^### 3\.2/m, to = /^### 3\.3/m } = {}) {
  const section = sliceSection(readText(specFile) ?? "", from, to);
  return new Set([...section.matchAll(/ATR-(\d{3})/g)].map((m) => `ATR-${m[1]}`));
}

/** ARCHITECTURE §8 CLI 表 → { verbs, flags }。只读表格行；行内转义竖线 `\|` 还原后再取
 *  `atelier ...` 反引号段。子命令级对账（gen db / migrate up …）不做——dispatch 的子命令
 *  无单一可解析真相源，动词级 + 旗标级是本机检的诚实边界。 */
export function parseArchSection8(archFile, { from = /^## 8\./m, to = /^## 9\./m } = {}) {
  const section = sliceSection(readText(archFile) ?? "", from, to);
  const verbs = new Set();
  const flags = new Set();
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cell0 = line.slice(1).split(/(?<!\\)\|/)[0].replace(/\\\|/g, "|");
    for (const span of cell0.matchAll(/`([^`]+)`/g)) {
      const cmd = span[1].trim();
      if (!cmd.startsWith("atelier")) continue;
      const verb = /^atelier\s+([a-z][\w-]*)/.exec(cmd);
      if (verb) verbs.add(verb[1]);
      for (const f of cmd.matchAll(/--[a-z][\w-]*/g)) flags.add(f[0]);
    }
  }
  return { verbs, flags };
}

function sliceSection(text, from, to) {
  const start = from.exec(text)?.index;
  if (start == null) return "";
  const rest = text.slice(start);
  const endM = to.exec(rest.slice(1));
  return endM ? rest.slice(0, 1 + endM.index) : rest;
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/* ---------------- 检查体 ---------------- */

export function runChecks(root = ROOT, { self = SELF } = {}) {
  const findings = [];
  const ok = (id, msg) => findings.push({ level: "ok", id, msg });
  const fail = (id, msg) => findings.push({ level: "fail", id, msg });

  const cliFile = path.join(root, "cli.mjs");
  const catalogFile = path.join(root, "skills", "atelier-error-codes", "SKILL.md");
  const fsDesignFile = path.join(root, "docs", "FS-DESIGN.md");
  const specFile = path.join(root, "docs", "SPEC-Agentic-DX-v0.2.md");
  const archFile = path.join(root, "docs", "ARCHITECTURE.md");
  const barrelFile = path.join(root, "runtime", "index.ts");
  const checkSkillsFile = path.join(root, "scripts", "check-skills.mjs");

  /* CHECK 1 — 错误码反向对账 */
  const catalog = parseCatalogCodes(catalogFile);
  const thrown = scanAtrCodes(root, SCAN_DIRS, { self });
  const missingFromCatalog = [...thrown.keys()].filter((c) => !catalog.has(c)).sort();
  for (const code of missingFromCatalog) {
    const sites = thrown.get(code).map((s) => `${s.file}:${s.line}`).slice(0, 4).join(", ");
    fail("atr.codes", `${code} 在代码中出现但不在错误码总表（${sites}${thrown.get(code).length > 4 ? " …" : ""}）——先登记 skills/atelier-error-codes/SKILL.md 再谈实现`);
  }
  for (const [code, why] of Object.entries(DUAL_SEMANTICS)) {
    if (!catalog.has(code)) fail("atr.whitelist", `白名单引用了总表不存在的码 ${code}`);
    else ok("atr.whitelist", `${code}: ${why}`);
  }
  ok("atr.codes", `代码实引 ${thrown.size} 码 ⊆ 总表 ${catalog.size} 码${missingFromCatalog.length ? `（缺 ${missingFromCatalog.length}）` : ""}`);
  const fs15 = parseFsDesignSection(fsDesignFile);
  const spec32 = parseSpecSection(specFile);
  const onlyCatalog = (a, b) => [...a].filter((c) => !b.has(c)).sort();
  for (const [name, set] of [["FS-DESIGN §15", fs15], ["SPEC §3.2", spec32]]) {
    const missing = onlyCatalog(catalog, set);
    const extra = onlyCatalog(set, catalog);
    for (const c of missing) fail("atr.sync", `${c} 在总表（ERR_CATALOG）但不在 ${name}——三处同步位失守`);
    for (const c of extra) fail("atr.sync", `${c} 在 ${name} 但不在总表（ERR_CATALOG）——三处同步位失守`);
    if (!missing.length && !extra.length) ok("atr.sync", `${name}: 码集与总表相等（${set.size}）`);
  }

  /* CHECK 2 — ARCHITECTURE §8 ↔ cli.mjs dispatch 对账 */
  const verbs = extractDispatchVerbs(cliFile);
  const helpFlags = extractHelpFlags(cliFile);
  const s8 = parseArchSection8(archFile);
  const HELP_SELF = new Set(["help"]); // help/-h/--help 自指入口，§8 不必单列一行
  const s8Missing = [...verbs].filter((v) => !s8.verbs.has(v) && !HELP_SELF.has(v)).sort();
  const s8Phantom = [...s8.verbs].filter((v) => !verbs.has(v)).sort();
  for (const v of s8Missing) fail("cli.table", `dispatch 命令 "atelier ${v}" 不在 ARCHITECTURE §8 表——权威表已漂移`);
  for (const v of s8Phantom) fail("cli.table", `§8 表的 "atelier ${v}" 在 cli.mjs dispatch 中不存在——幻影命令`);
  if (!s8Missing.length && !s8Phantom.length) ok("cli.table", `§8 动词集 = dispatch 动词集（${verbs.size - HELP_SELF.size} + help 豁免）`);
  const s8FlagPhantom = [...s8.flags].filter((f) => !helpFlags.has(f)).sort();
  for (const f of s8FlagPhantom) fail("cli.flag", `§8 表的旗标 ${f} 不在 cli.mjs HELP——幻影旗标（语义写反/已删除的旗标复活）`);
  if (!s8FlagPhantom.length) ok("cli.flag", `§8 旗标 ${s8.flags.size} 个 ⊆ HELP 旗标 ${helpFlags.size} 个`);

  /* CHECK 3 — check-skills 派生接线自证 + 桶出口哨兵 */
  const barrel = extractBarrelApi(barrelFile);
  const CORE_RUNTIME_API = ["component", "$state", "$derived", "$effect", "html", "streamValue", "optimisticList", "store", "validateFlat", "mountComponent", "registry", "devFetch"];
  const absentCore = CORE_RUNTIME_API.filter((a) => !barrel.values.has(a));
  for (const a of absentCore) fail("runtime.api", `runtime/index.ts 桶出口缺核心 API "${a}"——公共面残缺`);
  if (!absentCore.length) ok("runtime.api", `桶出口 value 面 ${barrel.values.size} 个，核心哨兵 ${CORE_RUNTIME_API.length} 个在位`);
  for (const phantom of ["expect", "verify"]) {
    if (barrel.values.has(phantom)) fail("runtime.api", `"${phantom}" 不应从桶出口导出（R2 红检：runtime 无此导出，技能包曾教幻影 API）`);
  }
  const checkSkillsSrc = readText(checkSkillsFile) ?? "";
  if (!/from\s+"\.\/*contract-checks\.mjs"/.test(checkSkillsSrc)) {
    fail("derive.wiring", "check-skills.mjs 未从 contract-checks.mjs 派生白名单——手抄白名单回流（R2 批退役项）");
  } else ok("derive.wiring", "check-skills.mjs 白名单 = 派生（CLI_VERBS/FLAGS/RUNTIME_API ← cli.mjs dispatch/HELP + runtime 桶出口）");

  return findings;
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
  const findings = runChecks();
  const fails = findings.filter((f) => f.level === "fail");
  console.log(`Atelier contract checks — ${findings.length - fails.length} passed, ${fails.length} failed`);
  for (const f of findings.filter((f) => f.level === "fail")) console.log(`  [FAIL] ${f.id}: ${f.msg}`);
  process.exit(fails.length ? 1 : 0);
}
