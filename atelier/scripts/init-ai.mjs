#!/usr/bin/env node
/**
 * init-ai.mjs — `atelier init --ai` minimal implementation demo (decision 7)
 *
 * Installs the Atelier Agent Skills package into a target project:
 *   1. skills/*  → <target>/.dsh/skills/   (dsh project-level discovery, P100)
 *                 → <target>/.agents/skills/ (AGENTS.md ecosystem / cross-tool, P200)
 *   2. templates → <target>/AGENTS.md + llms.txt (rendered with project name)
 *   3. specs/    → human-owned intent & acceptance skeleton (decision 11: goal/constraints/acceptance)
 *
 * Safety: never overwrites an existing file — prints SKIP instead.
 *
 * Usage:
 *   node init-ai.mjs [--target <dir>] [--name <ProjectName>] [--no-dsh] [--no-agents]
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, ".."); // atelier/
const SKILLS_SRC = path.join(PKG, "skills");
const TPL = path.join(PKG, "templates");

function parseArgs(argv) {
  const args = { dsh: true, agents: true, mcp: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") args.target = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--no-dsh") args.dsh = false;
    else if (a === "--no-agents") args.agents = false;
    else if (a === "--no-mcp") args.mcp = false;
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = path.resolve(args.target ?? process.cwd());
const projectName = args.name ?? path.basename(target);
const written = [];
const skipped = [];

/** copy one file unless it already exists */
function putFile(dest, content) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) { skipped.push(path.relative(target, dest)); return; }
  fs.writeFileSync(dest, content, "utf8");
  written.push(path.relative(target, dest));
}

if (!fs.statSync(SKILLS_SRC).isDirectory()) { console.error("skills/ missing next to this script"); process.exit(1); }

// 1) skill packages → discovery roots
for (const dir of fs.readdirSync(SKILLS_SRC)) {
  const src = path.join(SKILLS_SRC, dir);
  if (!fs.statSync(src).isDirectory()) continue;
  const body = fs.readFileSync(path.join(src, "SKILL.md"), "utf8");
  if (args.dsh) putFile(path.join(target, ".dsh", "skills", dir, "SKILL.md"), body);
  if (args.agents) putFile(path.join(target, ".agents", "skills", dir, "SKILL.md"), body);
}

// 2) rendered entry files
putFile(path.join(target, "AGENTS.md"),
  fs.readFileSync(path.join(TPL, "AGENTS.md.template"), "utf8").replaceAll("<ProjectName>", projectName));
putFile(path.join(target, "llms.txt"),
  fs.readFileSync(path.join(TPL, "llms.txt.template"), "utf8").replaceAll("<ProjectName>", projectName));

// 3) specs 骨架（_spec-template.md + guardrails.md 常驻负例）已实体化进 templates/app/specs/，
//    随 init-project 的 cpSync 落盘——此处不再重复生成（P1-4 整理：单一来源，sync-project 同源补种）。

// 4) MCP client registrations (stdio server; --no-mcp to skip). skip-if-exists keeps user edits safe.
if (args.mcp) {
  const serverAbs = path.join(PKG, "mcp", "server.mjs").split(path.sep).join("/");
  const mcpServer = { command: "node", args: [serverAbs], env: { ATELIER_DEV_URL: "http://127.0.0.1:5173" } };
  putFile(path.join(target, ".mcp.json"), JSON.stringify({ mcpServers: { atelier: mcpServer } }, null, 2) + "\n");              // Claude Code
  putFile(path.join(target, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { atelier: mcpServer } }, null, 2) + "\n");    // Cursor
  putFile(path.join(target, ".vscode", "mcp.json"),
    JSON.stringify({ servers: { atelier: { type: "stdio", ...mcpServer } } }, null, 2) + "\n");                                  // VS Code Copilot
}

console.log(`Atelier init --ai → ${target}  (project: ${projectName})`);
for (const f of written) console.log(`  wrote   ${f}`);
for (const f of skipped) console.log(`  SKIP    ${f} (already exists — never overwritten)`);
console.log(`\n${written.length} written, ${skipped.length} skipped.`);
console.log("Next: edit specs/_spec-template.md per feature; start dev server; skills load automatically in dsh/Claude Code/Codex.");
