#!/usr/bin/env node
/**
 * cli.mjs — `atelier` unified entry (v0.1 script form).
 *
 * The spec CLI surface lives in docs/ARCHITECTURE.md §8 (`atelier init/dev/check/...`).
 * This entry already speaks the spec's namespaces and delegates to the shipped tools;
 * as compiler/review packages land they take over the matching subcommands 1:1.
 *
 *   atelier skills install|check   Agent Skills package management (decision 7/14)
 *   atelier mcp                    built-in MCP server, stdio transport (decision 7)
 *   atelier checkpoint ...         decision-15 source checkpoints (save/list/rollback)
 */
import path from "node:path";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";

const PKG = path.resolve(path.dirname(url.fileURLToPath(import.meta.url))); // atelier/
const HELP = `atelier v0.1 (script form — spec CLI surface: docs/ARCHITECTURE.md §8)

  atelier skills install [--target <dir>] [--name <Name>] [--no-dsh|--no-agents|--no-mcp]
        Install the Agent Skills package (+ client MCP configs) into a project. Idempotent.
  atelier skills check
        Consistency check for the skills package (frontmatter/budgets/commands/errors/tools).
  atelier mcp
        Start the built-in MCP server (stdio transport, zero dependencies).
  atelier checkpoint save <name> | list [--json] | rollback <id>
        Decision-15 source checkpoints on git (auto bootstraps the repository on first use).

Examples:
  node atelier/cli.mjs skills install --target ./my-app --name MyApp
  node atelier/cli.mjs checkpoint save "AI round 1: scaffold"
`;

function runScript(file, args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(PKG, "scripts", file), ...args], { stdio: "inherit", ...opts });
  process.exit(r.status ?? 1);
}

const [, , cmd, sub, ...rest] = process.argv;

switch (cmd) {
  case "skills":
    if (sub === "install") runScript("init-ai.mjs", rest);
    if (sub === "check") runScript("check-skills.mjs", rest);
    console.error(`unknown skills subcommand: ${sub ?? "(none)"}`);
    process.exit(2);
    break;
  case "mcp": {
    // long-running child; inherit stdio so the host drives the protocol directly
    const child = spawn(process.execPath, [path.join(PKG, "mcp", "server.mjs"), ...rest], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
    break;
  }
  case "checkpoint":
    runScript("checkpoint.mjs", [sub, ...rest]);
    break;
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
