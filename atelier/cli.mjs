#!/usr/bin/env node
/**
 * cli.mjs — `atelier` unified entry. Spec surface: atelier/docs/ARCHITECTURE.md §8.
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

const HELP = `atelier v0.2 (script form — spec surface: atelier/docs/ARCHITECTURE.md §8)

PROJECT
  atelier init --target <dir> --name <Name> [--no-ai]              FULL  scaffold a self-contained
                                                                         app from framework pieces
                                                                         (+ agent layer)
  atelier dev                                                      MINI  run the app's dev server
                                                                         (forwards to package.json dev script)
  atelier build | package | e2e                                    STUB  spec'd, lands with compiler /
                                                                         @atelier/review packages (v0.2+)
  atelier sync [--target <dir>]                                    FULL  re-vendor runtime + dev face into
                                                                         an existing app (拉齐到框架当前时点)
  atelier tokens export|import --in <f> --out <f>                  FULL  W3C DTCG 设计令牌互导
                                                                         (atelier.config.json ↔ .tokens.json)

AGENT SURFACE
  atelier mcp                                                      FULL  built-in MCP server (stdio)
  atelier skills install [--target <dir>] [--name <N>]             FULL  skills + client MCP configs
                                              [--no-dsh|--no-agents|--no-mcp]
  atelier skills check                                             FULL  consistency gate (CI exit code)
  atelier struct [map|check] [--json]                              FULL  six-layer structural ground truth
                                                                         (map=human/json, check=gates)
  atelier review [--open]                                          MINI  open the dev-face review UI
                                                                         (timeline + 双图判定; needs pnpm dev)

QUALITY GATES
  atelier check                                                    MINI  hard gate: structural contradictions
                                                                         (+ contract/token gates as compiler lands)
  atelier lint                                                     STUB  soft-constraint ruleset (v0.2)
  atelier test                                                     MINI* forwards to the project's test runner
  atelier snapshot save | check [--update]                         MINI* visual regression via the dev face
                                                                         (byte+pixel tiers; never auto-accepts)
  atelier api-diff snapshot | check [--root <dir>] [--json]        MINI  public API surface snapshot + drift gate
                                            [--strict] [--allow <f>] [--budget <0..1>]  (removed/changed = breaking, exit 1)
  atelier checkpoint save <name> [--no-gate] | list | rollback <id>     FULL  decision-15 source checkpoints; save enforces 未检不锚 (P2-2 snapshot + P3-4 api-diff)

COMPILER
  atelier compile [--root <dir>] [--out <dir>] [--stdout]          MINI* P0-2 stage ② AST dump: *.atr.ts →
                                                                          .atr/ast/*.json via the runtime parser
                                                                          (stage ③ codegen: node atelier/compiler/codegen.mjs
                                                                          --ast <dir> [--graph]; --graph-only = 依赖图查询 stdout)

BENCHMARK
  atelier bench --app <dir> [--port N] [--json] [--keep]           MINI* P0-4 SPEC §7 four-metric baseline
                                                                          (gzip/mount/HMR/screenshot vs targets)

Exit codes: 0 ok · 1 gate failed · 2 usage · 4 not-implemented (STUB)
Examples:
  node atelier/cli.mjs init --target ./my-app --name MyApp && cd my-app && pnpm install && pnpm dev
  node atelier/cli.mjs checkpoint save "AI round 1: scaffold"
`;

const STUB_NOTES = {
  build: ["compiles .atr.ts contracts/templates", "see ARCHITECTURE §4 compile pipeline"],
  package: ["Tauri 2 desktop packaging", "see ARCHITECTURE §10"],
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
    const r = spawnSync(process.execPath, [script("init-project.mjs"), "--target", target, "--name", name, ...(noAi ? ["--no-ai"] : [])], {
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
        'fix: run inside an Atelier app dir (create one: atelier init --target . --name <Name>)',
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
  case "sync":
    runScript("sync-project.mjs", [sub, ...rest]);
    break;
  case "tokens":
    // P2-2④：W3C DTCG 设计令牌互导（export: config→DTCG；import: DTCG→扁平片段）
    runScript("tokens-dtcg.mjs", [sub, ...rest]);
    break;
  case "review": {
    // MINI（P1-4 落地）：review UI 最小版实跑在 dev 面（/__atelier/review，P2-5 L5）。
    // 本命令负责指路 + 可选开页；不做反向代理（页面已在应用自己的 dev server 上）。
    const argv = process.argv.slice(3);
    const base = (process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
    const cwd = argv.includes("--target") ? path.resolve(argv[argv.indexOf("--target") + 1]) : process.cwd();
    let token = "";
    try { token = fs.readFileSync(path.join(cwd, ".atelier", "dev-token"), "utf8").trim(); } catch { /* empty */ }
    if (!token) {
      console.error("error: no dev token here (.atelier/dev-token missing)");
      console.error("fix: run inside an Atelier app dir — start 'pnpm dev' once to mint the token, then retry");
      process.exit(1);
    }
    const url = `${base}/__atelier/review?token=${token}`;
    const probe = spawnSync(
      process.execPath,
      ["-e", `fetch(${JSON.stringify(`${base}/__atelier/review`)},{headers:{"x-atelier-token":${JSON.stringify(token)}}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(2))`],
      { timeout: 8000 },
    );
    if (probe.status !== 0) {
      console.error(`[atelier] review UI unreachable at ${base}/__atelier/review (dev face down or token mismatch)`);
      console.error("fix: start the app dev server ('pnpm dev' in the app dir), then retry");
      process.exit(4);
    }
    console.log(`[atelier] review UI: ${url}`);
    console.log("  timeline + 双图并排 + 判定写回（token 已附在 URL，仅本机回环有效）");
    if (argv.includes("--open")) {
      const opener =
        process.platform === "win32"
          ? spawnSync("cmd", ["/c", "start", "", url], { shell: true, stdio: "ignore" })
          : spawnSync("xdg-open", [url], { stdio: "ignore" });
      if (opener.status === 0) console.log("  → 已在默认浏览器打开");
    }
    break;
  }
  case "compile": {
    // P0-2 stage ②: AST dump — spawns a bare node process so the TS runtime import type-strips natively
    const args = process.argv.slice(3);
    const child = spawnSync(process.execPath, [path.join(PKG, "compiler", "dump.mjs"), ...args], { stdio: "inherit" });
    process.exit(child.status ?? 1);
    break;
  }
  case "bench": {
    // P0-4: SPEC §7 four-metric baseline bench (needs an init'd app with deps installed)
    const child = spawnSync(process.execPath, [path.join(PKG, "scripts", "bench.mjs"), ...process.argv.slice(3)], { stdio: "inherit" });
    process.exit(child.status ?? 1);
    break;
  }

  /* ---------- quality gates ---------- */
  case "check":
    // MINI hard gate: structural contradictions today; contract/token checks land with the compiler
    runScript("struct.mjs", ["check", ...rest]);
    break;
  case "snapshot":
    runScript("snapshot.mjs", [sub ?? "check", ...rest]);
    break;
  case "api-diff":
    // P3-4: 公共 API 面 snapshot + 漂移门禁（breaking 未豁免 = exit 1）
    if (!sub) die("usage: atelier api-diff snapshot | check [--root <dir>] [--json] [--strict] [--allow <file>]", 2);
    runScript("api-diff.mjs", [sub, ...rest]);
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
