#!/usr/bin/env node
/**
 * init-project.mjs — `atelier init`: scaffold a SELF-CONTAINED application from
 * framework pieces, then (unless --no-ai) install the agent layer.
 *
 * Assembly (source-as-library, decision 14 — the app starts as readable, runnable source):
 *   1. templates/app/  → target/             app skeleton（config/index/main/components/tests/vite.config）
 *   2. runtime/*.ts    → target/src/runtime/ vendored 零依赖内核（应用不依赖框架目录即可跑）
 *   3. dev/*.mjs       → target/scripts/     dev 面插件 + 无头截图 + tailwind 主题生成
 *   4. init-ai（除非 --no-ai）：skills 双落点 + AGENTS.md/llms.txt + specs/ + MCP 客户端配置
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const PKG = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."); // atelier/

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--target": a.target = argv[++i]; break;
      case "--name": a.name = argv[++i]; break;
      case "--no-ai": a.noAi = true; break;
      default: console.error(`unknown arg: ${argv[i]}`); process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.target || !args.name) {
  console.error("usage: init-project --target <dir> --name <Name> [--no-ai]");
  process.exit(2);
}
const target = path.resolve(args.target);

const TEMPLATE = path.join(PKG, "templates", "app");
const RUNTIME = path.join(PKG, "runtime");
const DEV = path.join(PKG, "dev");
if (!fs.existsSync(path.join(TEMPLATE, "package.json"))) {
  console.error(`error: app template missing at ${TEMPLATE}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(RUNTIME, "core.ts"))) {
  console.error(`error: framework runtime missing at ${RUNTIME}`);
  process.exit(1);
}

/* 1) app skeleton */
fs.cpSync(TEMPLATE, target, { recursive: true });

/* 2) vendored runtime — 框架真相在 atelier/runtime，脚手架拿到的是初始化时点拷贝 */
const targetRuntime = path.join(target, "src", "runtime");
fs.mkdirSync(targetRuntime, { recursive: true });
let runtimeFiles = 0;
for (const f of fs.readdirSync(RUNTIME)) {
  if (f.endsWith(".ts")) {
    fs.copyFileSync(path.join(RUNTIME, f), path.join(targetRuntime, f));
    runtimeFiles++;
  }
}

/* 3) vendored dev face — vite.config 从 ./scripts/ 引入 */
const targetScripts = path.join(target, "scripts");
fs.mkdirSync(targetScripts, { recursive: true });
for (const f of ["atelier-dev-plugin.mjs", "dev-screenshot.mjs", "gen-tailwind-theme.mjs"]) {
  fs.copyFileSync(path.join(DEV, f), path.join(targetScripts, f));
}

/* personalize: package.json name → kebab slug of the chosen name */
const pkgPath = path.join(target, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.name = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-atelier-app";
pkg.description = `${args.name} — built with Atelier`;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

/* trust guard (STRUCTURE-RULES): inviting agents in requires isolating machine noise BEFORE first commit */
const gitignore = path.join(target, ".gitignore");
if (!fs.existsSync(gitignore)) {
  fs.writeFileSync(gitignore, ["node_modules/", "dist/", ".atelier/dev-token", ".atelier/audit.jsonl", ".atr/snapshots/current.png", "*.log", ".debug*"].join("\n") + "\n");
}

/* report */
const writtenCount = (function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) n += count(p);
    else n++;
  }
  return n;
})(target);

console.log(`scaffolded ${writtenCount} files → ${target}  (app: ${pkg.name}, vendored runtime: ${runtimeFiles} modules)`);
console.log("next:");
console.log(`  cd ${path.relative(process.cwd(), target) || path.basename(target)} && pnpm install && pnpm dev   # http://127.0.0.1:5173`);

/* agent layer on top of the scaffold (delegated so flags stay aligned) */
if (!args.noAi) {
  const { spawnSync } = await import("node:child_process");
  const ai = path.join(PKG, "scripts", "init-ai.mjs");
  const r = spawnSync(process.execPath, [ai, "--target", target, "--name", args.name], { stdio: "inherit" });
  if (r.status !== 0) console.error("[atelier] warning: agent-layer install reported issues above");
}
console.log("\nagent essentials in place: AGENTS.md · llms.txt · specs/_spec-template.md · .dsh/.agents skills · .mcp.json set");
console.log('anchor this state once deps are installed: atelier checkpoint save "baseline"');
