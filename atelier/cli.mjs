#!/usr/bin/env node
/**
 * cli.mjs — `atelier` unified entry. Spec surface: docs/ARCHITECTURE.md §8.
 *
 * Implementation tiers (be honest about each):
 *   FULL   real behaviour, wired end-to-end today
 *   MINI   working minimal path (subset of the spec semantics)
 *   STUB   prints guidance + spec pointer, exits 4 — never fakes success
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

const PKG = path.resolve(path.dirname(url.fileURLToPath(import.meta.url))); // atelier/
const script = (f) => path.join(PKG, "scripts", f);

const HELP = `atelier v0.2 (script form — spec surface: docs/ARCHITECTURE.md §8)

PROJECT
  atelier init --target <dir> --name <Name> [--no-ai]              FULL  scaffold an app from the
                                                                         prototype starter (+ agent layer)
  atelier dev                                                      MINI  run the app's dev server
                                                                         (forwards to package.json dev script)
  atelier build | package | review | e2e                           STUB  spec'd, lands with compiler /
                                                                         @atelier/review packages (v0.2+)

AGENT SURFACE
  atelier mcp                                                      FULL  built-in MCP server (stdio)
  atelier skills install [--target <dir>] [--name <N>]             FULL  skills + client MCP configs
                                              [--no-dsh|--no-agents|--no-mcp]
  atelier skills check                                             FULL  consistency gate (CI exit code)
  atelier struct [map|check] [--json]                              FULL  six-layer structural ground truth
                                                                         (map=human/json, check=gates)

QUALITY GATES
  atelier check                                                    MINI  hard gate: structural contradictions
                                                                         (+ contract/token gates as compiler lands)
  atelier lint                                                     STUB  soft-constraint ruleset (v0.2)
  atelier test                                                     MINI* forwards to the project's test runner
  atelier snapshot save | check [--update]                         MINI* visual regression via the dev face
                                                                         (sha256 compare; never auto-accepts)
  atelier checkpoint save <name> | list | rollback <id>            FULL  decision-15 source checkpoints

Exit codes: 0 ok · 1 gate failed · 2 usage · 4 not-implemented (STUB)
Examples:
  node atelier/cli.mjs init --target ./my-app --name MyApp && cd my-app && pnpm install && pnpm dev
  node atelier/cli.mjs checkpoint save "AI round 1: scaffold"
`;

const STUB_NOTES = {
  build: ["compiles .atr.ts contracts/templates", "see ARCHITECTURE §4 compile pipeline"],
  package: ["Tauri 2 desktop packaging", "see ARCHITECTURE §10"],
  review: ["local acceptance UI (timeline/diff/approve)", "meanwhile: MCP diff.report path is specced; use checkpoint timeline"],
  e2e: ["browser loop: structure assertions + visual diff", "meanwhile: snapshot check covers the regression half"],
  lint: ["soft-constraint ruleset (@atelier/eslint)", "meanwhile: skills docs carry the rules; check carries the hard gate"],
};

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}
function runScript(file, args) {
  const r = spawnSync(process.execPath, [script(file), ...args], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
function hasDevScript(dir) {
  try {
    return !!JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts?.dev;
  } catch {
    return false;
  }
}

const [, , cmd, sub, ...rest] = process.argv;

switch (cmd) {
  /* ---------- project lifecycle ---------- */
  case "init": {
    const argvAll = process.argv.slice(3); // everything after the literal word "init"
    if (!argvAll.includes("--target")) die("usage: atelier init --target <dir> --name <Name> [--no-ai]", 2);
    const tIdx = argvAll.indexOf("--target");
    const nIdx = argvAll.indexOf("--name");
    const target = argvAll[tIdx + 1];
    const name = nIdx >= 0 ? argvAll[nIdx + 1] : path.basename(target ?? "");
    const noAi = argvAll.includes("--no-ai");
    const r = spawnSync(process.execPath, [script("init-project.mjs"), "--target", target, "--name", name, "--starter", path.join(PKG, "..", "prototype"), ...(noAi ? ["--no-ai"] : [])], {
      stdio: "inherit",
    });
    process.exit(r.status ?? 1);
    break;
  }
  case "dev": {
    // MINI: forward to the nearest package.json dev script (run inside your app dir)
    if (!hasDevScript(process.cwd())) {
      die(
        'error: no dev script here',
        'fix: run inside an Atelier app dir (create one: atelier init --target . --name <Name>), or start the reference app: cd prototype && pnpm dev',
      );
    }
    const c = spawn("pnpm", ["dev"], { stdio: "inherit", shell: true });
    c.on("exit", (code) => process.exit(code ?? 0));
    break;
  }

  /* ---------- agent surface ---------- */
  case "mcp": {
    const child = spawn(process.execPath, [path.join(PKG, "mcp", "server.mjs"), ...rest], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
    break;
  }
  case "skills":
    if (sub === "install") runScript("init-ai.mjs", rest);
    else if (sub === "check") runScript("check-skills.mjs", rest);
    else die(`unknown skills subcommand: ${sub ?? "(none)"}`, 2);
    break;
  case "struct":
    runScript("struct.mjs", sub ? [sub, ...rest] : []);
    break;
  case "checkpoint":
    runScript("checkpoint.mjs", [sub, ...rest]);
    break;

  /* ---------- quality gates ---------- */
  case "check":
    // MINI hard gate: structural contradictions today; contract/token checks land with the compiler
    runScript("struct.mjs", ["check", ...rest]);
    break;
  case "snapshot":
    runScript("snapshot.mjs", [sub ?? "check", ...rest]);
    break;
  case "test": {
    if (!fs.existsSync(path.join(process.cwd(), "package.json"))) {
      die('error: no package.json here', 'fix: run inside an Atelier app dir');
    }
    const r = spawnSync("pnpm", ["test"], { stdio: "inherit", shell: true });
    process.exit(r.status ?? 1);
    break;
  }

  /* ---------- stubs (honest) ---------- */
  case "build":
  case "package":
  case "review":
  case "e2e":
  case "lint": {
    console.error(`[atelier] "${cmd}" is not implemented yet.`);
    for (const line of STUB_NOTES[cmd]) console.error(`  · ${line}`);
    console.error(`\nThis command is part of the spec (ARCHITECTURE §8); it ships with the matching package.\nMeanwhile: atelier struct check · snapshot · checkpoint · mcp cover the loop's core.`);
    process.exit(4);
    break;
  }

  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(2);
}
