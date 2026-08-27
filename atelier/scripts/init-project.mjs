#!/usr/bin/env node
/**
 * init-project.mjs — `atelier init`: scaffold an application from the prototype starter,
 * then (unless --no-ai) install the agent layer (skills + MCP client configs).
 *
 * This is the "source-as-library" bootstrap (decision 14): the app starts as readable,
 * runnable source — components/tests/config co-located, no black boxes.
 */
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--target": a.target = argv[++i]; break;
      case "--name": a.name = argv[++i]; break;
      case "--starter": a.starter = argv[++i]; break;
      case "--no-ai": a.noAi = true; break;
      default: console.error(`unknown arg: ${argv[i]}`); process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.target || !args.name) {
  console.error("usage: init-project --target <dir> --name <Name> --starter <prototypeDir> [--no-ai]");
  process.exit(2);
}
const target = path.resolve(args.target);
const starter = path.resolve(args.starter);
if (!fs.existsSync(path.join(starter, "src", "core.ts"))) {
  console.error(`error: starter at ${starter} does not look like the Atelier prototype`);
  process.exit(1);
}

const EXCLUDE_FILES = new Set(["shot-overview.png", "shot-mcp.png"]);
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".debug", ".edge-debug"]);

/** recursive copy honouring exclusions; does NOT descend into junk */
fs.cpSync(starter, target, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(starter, src);
    if (!rel) return true;
    const segs = rel.split(path.sep);
    if (segs.some((s) => EXCLUDE_DIRS.has(s))) return false;
    if (EXCLUDE_FILES.has(segs.at(-1))) return false;
    return true;
  },
});

// personalize: package.json name → kebab slug of the chosen name
const pkgPath = path.join(target, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.name = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-atelier-app";
pkg.description = `${args.name} — built with Atelier`;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// trust guard (STRUCTURE-RULES): inviting agents in requires isolating machine noise BEFORE first commit
const gitignore = path.join(target, ".gitignore");
if (!fs.existsSync(gitignore)) {
  fs.writeFileSync(gitignore, ["node_modules/", "dist/", ".atr/snapshots/current.png", "*.log", ".debug*"].join("\n") + "\n");
}

// application-level atelier.config.json stays as copied (tokens SSOT); report it
const writtenCount = (function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) n += count(p);
    else n++;
  }
  return n;
})(target);

console.log(`scaffolded ${writtenCount} files → ${target}  (app: ${pkg.name})`);
console.log("next:");
console.log(`  cd ${path.basename(target)} && pnpm install && pnpm dev   # http://127.0.0.1:5173`);

// agent layer on top of the scaffold (delegated so flags stay aligned)
if (!args.noAi) {
  const { spawnSync } = await import("node:child_process");
  const ai = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "init-ai.mjs");
  const r = spawnSync(process.execPath, [ai, "--target", target, "--name", args.name], { stdio: "inherit" });
  if (r.status !== 0) console.error("[atelier] warning: agent-layer install reported issues above");
}
console.log("\nagent essentials in place: AGENTS.md · llms.txt · specs/_spec-template.md · .dsh/.agents skills · .mcp.json set");
console.log('anchor this state once deps are installed: atelier checkpoint save "baseline"');
