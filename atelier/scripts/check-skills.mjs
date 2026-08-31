#!/usr/bin/env node
/**
 * check-skills.mjs — Atelier Agent Skills 包一致性校验器（SKILLS-PLAN §3.4 / M2）
 *
 * Checks:
 *   A. frontmatter 规范（仅 name/description；name == 目录名 == kebab-case；description ≤500）
 *   B. 行数上限（来源：docs/SKILLS-PLAN.md §3.2 硬约束表）
 *   C. 命令零幻觉（atelier <verb> ⊆ CLI 白名单；--flags ⊆ 白名单）
 *   D. 错误码一致性（skill 引用的 ATR-xxx ⊆ errors 总表收录集）
 *   E. 工具名一致性（点分工具名 ⊆ mcp/mcp-definitions.json）
 *   F. runtime 导入面（import ... from "atelier/runtime" ⊆ API 白名单）
 *   G. 不可执行话术（正文禁词，代码块除外）
 *
 * Exit: 0 = all green; 1 = violations found.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, ".."); // atelier/
const SKILLS = path.join(ROOT, "skills");
const DEFS = JSON.parse(fs.readFileSync(path.join(ROOT, "mcp", "mcp-definitions.json"), "utf8"));

/** Line budget — must match docs/SKILLS-PLAN.md §3.2 */
const LINE_LIMITS = {
  "atelier/SKILL.md": 70,
  "atelier-component-model/SKILL.md": 180,
  "atelier-streaming/SKILL.md": 160,
  "atelier-state-transactions/SKILL.md": 160,
  "atelier-styling/SKILL.md": 140,
  "atelier-testing/SKILL.md": 150,
  "atelier-mcp-tools/SKILL.md": 130,
  "atelier-error-codes/SKILL.md": 200,
};
const TEMPLATE_LIMITS = { "templates/AGENTS.md.template": 60, "templates/llms.txt.template": 120 };

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Agent Skills 标准（agentskills.io）frontmatter 已知字段——未知字段拒绝（P2-2①） */
const AGENT_SKILLS_FIELDS = new Set(["name", "description", "license", "allowed-tools", "metadata"]);
const AGENT_SKILLS_NAME_MAX = 64; // 标准：name ≤64 字符 kebab-case
const AGENT_SKILLS_DESC_MAX = 1024; // 标准：description ≤1024 字符
const CLI_VERBS = new Set(["init", "dev", "review", "sync", "check", "lint", "test", "snapshot", "e2e", "build", "package", "struct", "checkpoint", "mcp", "skills", "compile", "bench", "tokens"]);
const FLAGS = new Set([
  "--ai", "--static", "--electron", "--update", "--no-gate", "--json",
  "--target", "--name", "--no-ai", "--open", "--root", "--out", "--stdout", "--quiet",
  "--keep", "--app", "--port", "--no-dsh", "--no-agents", "--no-mcp",
]);
const TOOL_PREFIXES = /^(?:registry|tokens|state|ui|docs|checkpoint|test|snapshot|diff|audit|feedback|structure)\./;
const RUNTIME_API = new Set([
  "component", "$state", "$derived", "$effect", "html", "streamValue", "optimisticList",
  "store", "validateFlat", "validateUnknown", "expect", "verify", "initTokens",
  "mountComponent", "registry",
]);
const BANNED_PHRASES = ["应该尽量", "尽量避免", "尽量不要", "应当尽量", "酌情", "视情况而定", "看情况", "when in doubt", "if possible", "as you see fit"];

const findings = [];
const ok = (id, msg) => findings.push({ level: "ok", id, msg });
const fail = (id, msg) => findings.push({ level: "fail", id, msg });

function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, "");
}
function readMd(p) {
  return fs.readFileSync(p, "utf8");
}
function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

/* ---- collect skill files ---- */
const skillDirs = fs.readdirSync(SKILLS).filter((d) => fs.statSync(path.join(SKILLS, d)).isDirectory());
const expectedDirs = new Set(Object.keys(LINE_LIMITS).map((k) => k.split("/")[0]));

/* A/B: frontmatter + line limits */
for (const dir of skillDirs.sort()) {
  const rel = `${dir}/SKILL.md`;
  const p = path.join(SKILLS, rel);
  if (!expectedDirs.has(dir)) fail("A.naming", `${rel}: directory not declared in SKILLS-PLAN §3.2 (rename or extend plan)`);
  if (!fs.existsSync(p)) { fail("A.exists", `${rel}: missing SKILL.md`); continue; }
  const md = readMd(p);
  const fm = parseFrontmatter(md);
  if (!fm) { fail("A.fm", `${rel}: no frontmatter block`); continue; }
  if (!fm.name || !KEBAB.test(fm.name)) fail("A.name", `${rel}: bad/missing name (${fm.name ?? "-"})`);
  else if (fm.name !== dir) fail("A.name", `${rel}: frontmatter name "${fm.name}" != directory "${dir}"`);
  else ok("A.name", `${dir}: ok`);
  if (!fm.description || fm.description.length < 20) fail("A.desc", `${rel}: description too short`);
  else if (fm.description.length > 500) fail("A.desc", `${rel}: description ${fm.description.length} chars (>500, dsh catalog limit)`);
  else ok("A.desc", `${dir}: ${fm.description.length} chars ok`);

  const lines = md.split(/\r?\n/).length;
  const limit = LINE_LIMITS[rel];
  if (limit && lines > limit) fail("B.lines", `${rel}: ${lines} lines > budget ${limit}`);
  else if (limit) ok("B.lines", `${rel}: ${lines}/${limit}`);
}

for (const [rel, limit] of Object.entries(TEMPLATE_LIMITS)) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { fail("B.lines", `${rel}: missing template`); continue; }
  const lines = readMd(p).split(/\r?\n/).length;
  if (lines > limit) fail("B.lines", `${rel}: ${lines} > budget ${limit}`);
  else ok("B.lines", `${rel}: ${lines}/${limit}`);
}

/* unexpected extra files directly under skills/ that would pollute discovery */
for (const entry of fs.readdirSync(SKILLS)) {
  const p = path.join(SKILLS, entry);
  if (fs.statSync(p).isFile()) fail("A.extra", `stray file under skills/: ${entry} (only <name>/SKILL.md packages allowed)`);
}

/* S: Agent Skills 标准符合性（agentskills.io，P2-2①）——过门禁 = 40+ 客户端分发通道 */
/*    标准：SKILL.md 必备 frontmatter（name ≤64 kebab-case + description ≤1024）；已知字段之外拒绝；
 *    包内只允许 SKILL.md + scripts/ + references/ + assets/（渐进披露三层资产）。 */
const AGENT_SKILLS_DIRS = new Set(["scripts", "references", "assets"]);
for (const dir of skillDirs.sort()) {
  const rel = `${dir}/SKILL.md`;
  const p = path.join(SKILLS, rel);
  if (!fs.existsSync(p)) continue; // A.exists 已报
  const fm = parseFrontmatter(readMd(p));
  if (!fm) continue; // A.fm 已报
  if (fm.name && fm.name.length > AGENT_SKILLS_NAME_MAX) fail("S.name", `${rel}: name ${fm.name.length} chars > ${AGENT_SKILLS_NAME_MAX} (agentskills.io)`);
  else if (fm.name) ok("S.name", `${dir}: ≤${AGENT_SKILLS_NAME_MAX} ok`);
  if (fm.description && fm.description.length > AGENT_SKILLS_DESC_MAX) fail("S.desc", `${rel}: description ${fm.description.length} chars > ${AGENT_SKILLS_DESC_MAX} (agentskills.io)`);
  else if (fm.description) ok("S.desc", `${dir}: ≤${AGENT_SKILLS_DESC_MAX} ok`);
  for (const key of Object.keys(fm)) {
    if (!AGENT_SKILLS_FIELDS.has(key)) fail("S.fields", `${rel}: unknown frontmatter field "${key}" (agentskills.io 已知字段：${[...AGENT_SKILLS_FIELDS].join(", ")})`);
  }
  const pkgFiles = fs.readdirSync(path.join(SKILLS, dir), { withFileTypes: true });
  for (const f of pkgFiles) {
    if (f.isFile() && f.name !== "SKILL.md") fail("S.files", `${dir}/${f.name}: 包内仅允许 SKILL.md + scripts/ + references/ + assets/（agentskills.io）`);
    if (f.isDirectory() && !AGENT_SKILLS_DIRS.has(f.name)) fail("S.files", `${dir}/${f.name}/: 非标准资产目录（agentskills.io 允许 scripts/references/assets）`);
  }
  if (!findings.some((f) => f.id === "S.files" && f.msg.startsWith(`${dir}/`))) ok("S.files", `${dir}: 包结构 ok`);
}
ok("S.standard", "agentskills.io conformance scan done");

/* C: commands & flags (prose only; exclude frontmatter) */
for (const dir of skillDirs) {
  const p = path.join(SKILLS, dir, "SKILL.md");
  if (!fs.existsSync(p)) continue;
  let md = readMd(p).replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const prose = stripCode(md);
  for (const m of prose.matchAll(/atelier\s+([a-z][a-z0-9-]*)/g)) {
    if (!CLI_VERBS.has(m[1])) fail("C.cli", `${dir}/SKILL.md: unknown command "atelier ${m[1]}" (not in ARCHITECTURE §8)`);
  }
  // scan flags only on lines that mention the atelier CLI (bare `--token` names elsewhere are design tokens, not flags)
  const cliLines = prose.split(/\r?\n/).filter((l) => /\batelier\b/.test(l) && !/atelier\.config\.json/.test(l.replace(/`atelier\.config\.json`/g, ""))).join("\n");
  const flagScope = cliLines.replace(/var\(--[^)]*\)/g, " ").replace(/\bgit\b[^\n;)]*/gi, " ");
  for (const m of flagScope.matchAll(/--[a-z][\w-]*/g)) {
    if (!FLAGS.has(m[0])) fail("C.flag", `${dir}/SKILL.md: unknown flag ${m[0]}`);
  }
}
ok("C.cli", "command scan done");

/* D: error codes against errors SSOT (atelier-error-codes/SKILL.md tables) */
const errPath = path.join(SKILLS, "atelier-error-codes", "SKILL.md");
if (!fs.existsSync(errPath)) {
  fail("D.codes", "atelier-error-codes package missing");
} else {
  const ssot = new Set();
  for (const m of readMd(errPath).matchAll(/ATR-(\d)xx(-dev)?|ATR-(\d{3})/g)) {
    ssot.add(m[0]);
  }
  for (const dir of skillDirs) {
    if (dir === "atelier-error-codes") continue;
    const p = path.join(SKILLS, dir, "SKILL.md");
    if (!fs.existsSync(p)) continue;
    for (const m of stripCode(readMd(p)).matchAll(/ATR-(\d)xx(-dev)?|ATR-(\d{3})/g)) {
      const code = m[0];
      if (!ssot.has(code)) fail("D.codes", `${dir}/SKILL.md references ${code} not covered by error catalog`);
    }
  }
  ok("D.codes", `catalog covers: ${[...ssot].join(", ")}`);
}

/* E: tool names vs mcp-definitions.json */
const definedTools = new Set(DEFS.tools.map((t) => t.name));
let scannedTools = 0;
for (const dir of skillDirs) {
  const p = path.join(SKILLS, dir, "SKILL.md");
  if (!fs.existsSync(p)) continue;
  const text = readMd(p).replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  for (const m of stripCode(text).matchAll(/[A-Za-z][\w]*\.[a-z][\w]*/g)) { // 后缀放宽到 \w：ui.a11y 等含数字工具名；误配由 TOOL_PREFIXES 与扩展名排除兜底
    const name = m[0];
    if (!TOOL_PREFIXES.test(name)) continue;
    if (/\.(json|md|ts|mjs)$/.test(name.slice(name.indexOf(".") + 1))) continue;
    scannedTools++;
    if (!definedTools.has(name)) fail("E.tools", `${dir}/SKILL.md references tool "${name}" not in mcp-definitions.json`);
  }
}
ok("E.tools", `scanned ${scannedTools} tool mentions against ${definedTools.size} definitions`);

/* F: runtime import surface inside code blocks */
for (const dir of skillDirs) {
  const p = path.join(SKILLS, dir, "SKILL.md");
  if (!fs.existsSync(p)) continue;
  for (const m of readMd(p).matchAll(/import\s*\{([^}]+)\}\s*from\s*["']atelier\/runtime["']/g)) {
    for (const raw of m[1].split(",")) {
      const api = raw.replace(/\/\/.*$/, "").trim().replace(/^\w+\s+as\s+/, "");
      if (!api) continue;
      if (!RUNTIME_API.has(api)) fail("F.api", `${dir}/SKILL.md imports unknown API "${api}" from atelier/runtime`);
    }
  }
}
ok("F.api", "import surface scan done");

/* G: banned vague phrasing (prose only) */
for (const dir of skillDirs) {
  const p = path.join(SKILLS, dir, "SKILL.md");
  if (!fs.existsSync(p)) continue;
  const prose = stripCode(readMd(p).replace(/^---\r?\n[\s\S]*?\r?\n---/, ""));
  for (const phrase of BANNED_PHRASES) {
    if (prose.toLowerCase().includes(phrase.toLowerCase())) fail("G.phrase", `${dir}/SKILL.md: vague phrase "${phrase}" — replace with executable instruction`);
  }
}
ok("G.phrase", "phrasing scan done");

/* ---- report ---- */
const fails = findings.filter((f) => f.level === "fail");
console.log(`Atelier skills check — ${findings.length - fails.length} passed, ${fails.length} failed`);
for (const f of findings.filter((f) => f.level === "fail")) console.log(`  [FAIL] ${f.id}: ${f.msg}`);
process.exit(fails.length ? 1 : 0);
