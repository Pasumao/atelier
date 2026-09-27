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
  atelier dev [--prod-db <path>]                                   MINI  run the app's dev server
                                                                         (forwards to package.json dev script;
                                                                         --prod-db 以 ATELIER_DB_PATH 注入 server
                                                                         面 dev 库，缺省 .atelier/dev.db)
  atelier build --target=node|bun [--root <dir>] [--out <dir>]     MINI  自托管单容器产线（D-F14，§12）：
                                            [--no-smoke]                前端 vite build + 产物启动壳
                                                                         （装配/serve 单源）+ 冒烟自证；
                                                                         edge = 不做清单显式拒绝
  atelier package | e2e                                            STUB  spec'd, lands with compiler /
                                                                         @atelier/review packages (v0.2+)
  atelier sync [--target <dir>]                                    FULL  re-vendor runtime + dev face + mcp
                                                                         family into an existing app (拉齐到框架当前时点)
  atelier tokens export|import --in <f> --out <f>                  FULL  W3C DTCG 设计令牌互导
                                                                         (atelier.config.json ↔ .tokens.json)

AGENT SURFACE
  atelier mcp                                                      FULL  built-in MCP server (stdio)
  atelier skills install [--target <dir>] [--name <N>]             FULL  skills + client MCP configs
                                              [--no-dsh|--no-agents|--no-mcp]
  atelier skills check                                             FULL  consistency gate (CI exit code)
  atelier struct [map|check] [--json]                              FULL  eight-layer structural ground truth
                                                                         (map=human/json, check=gates)
  atelier review [--open]                                          MINI  open the dev-face review UI
                                                                         (timeline + 双图判定; needs pnpm dev)

QUALITY GATES
  atelier check                                                    MINI  hard gate: structural contradictions
                                                                         (+ contract/token gates as compiler lands)
  atelier lint                                                     STUB  soft-constraint ruleset (v0.2)
  atelier test                                                     MINI* forwards to the project's test runner
  atelier snapshot save | check [--update] [--full]                 MINI* visual regression via the dev face (--full = 整页变体, m11)
                                                                         (byte+pixel tiers; never auto-accepts)
  atelier api-diff snapshot | check [--root <dir>] [--json]        MINI  public API surface snapshot + drift gate
                                            [--strict] [--allow <f>] [--budget <0..1>]  (removed/changed = breaking, exit 1)
  atelier checkpoint save <name> [--no-gate] | list | rollback <id>     FULL  decision-15 source checkpoints; save enforces 未检不锚 (P2-2 snapshot + P3-4 api-diff)

COMPILER
  atelier compile [--root <dir>] [--out <dir>] [--stdout]          MINI* P0-2 stage ② AST dump: *.atr.ts →
                                                                          .atr/ast/*.json via the runtime parser
                                                                          (stage ③ codegen: node atelier/compiler/codegen.mjs
                                                                          --ast <dir> [--graph]; --graph-only = 依赖图查询 stdout)

GENERATE / DATA (FS-M2 全站化)
  atelier gen db [--root <dir>]                                    MINI* 数据契约 schema.ts → tables/crud + 迁移骨架
                                                                          （追加式永不重写已应用迁移；regen 幂等）
  atelier gen auth [--root <dir>]                                  MINI* 鉴权五件套（FS-5 §6）：sessions/users 契约 +
                                                                          scrypt 会话原语 + cookie + auth.* 端点骨架 +
                                                                          NNN_auth 迁移对（追加式；regen 幂等）
  atelier gen endpoint [--root <dir>] [--mount /api]               MINI* 端点定义 → src/generated/api.ts 类型化客户端
                                            [--from-specs]                （--from-specs 兼发 specs 意图段的可编译骨架）
  atelier migrate status|up|down|verify|seed [--root <dir>]        MINI* 可逆迁移器（FS-4）+ SQL 种子（D-F17）：
                                            [--db <f>] [--to <name>] [--force]（影子库干跑幂等校验；seed 逐文件 tx
                                                                          幂等重跑，库缺失不静默建库）
  atelier impact <contractKey> [--root <dir>]                      MINI* 契约 → 端点 → 前端调用点 两跳影响面导航
                                                                          （导航不是门禁——exit 恒 0）
  atelier call <endpoint> ['<json>'] [--root <dir>] [--mount /api]  MINI  端点直调 CLI 通道（D-F15，§14.4
                                       [--port N] [--timeout <ms>]        工作循环的验证环）：POST <mount>/
                                                                          <name>（§3.4 query/command 同一
                                                                          POST 纪律）；响应 JSON 上 stdout，
                                                                          ATR 结构化错误上 stderr + exit 1；
                                                                          server 不可达指路 pnpm dev（不静默
                                                                          spawn——验收环不是托管环）
  atelier export openapi [--root <dir>] [--out openapi.json]       MINI* 端点面 → openapi-3.0.3 文档（FS-9：§2.4
                                       [--mount /api] [--name <T>]        投影器单管线；restful GET 映射 §3.4）

BENCHMARK
  atelier bench --app <dir> [--port N] [--json] [--keep]           MINI* P0-4 SPEC §7 four-metric baseline
                                                                          (gzip/mount/HMR/screenshot vs targets)

Exit codes: 0 ok · 1 gate failed · 2 usage · 4 not-implemented (STUB)
Examples:
  node atelier/cli.mjs init --target ./my-app --name MyApp && cd my-app && pnpm install && pnpm dev
  node atelier/cli.mjs checkpoint save "AI round 1: scaffold"
`;

const STUB_NOTES = {
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
function runFile(file, args) {
  const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit" });
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
    // FS-7(dev-host)：--prod-db <path> → env ATELIER_DB_PATH 注入（dev 托管线缺省 .atelier/dev.db；
    // 既有行为零变化：不带 flag 时 env 原样透传）
    if (!hasDevScript(process.cwd())) {
      // 修复顺手账：die 第二参是 exit code，fix 文本须并入 msg（原两参误用会 process.exit(字符串) 抛栈）
      die(
        'error: no dev script here\nfix: run inside an Atelier app dir (create one: atelier init --target . --name <Name>)',
        2,
      );
    }
    const devArgs = process.argv.slice(3);
    const dbIdx = devArgs.indexOf("--prod-db");
    let childEnv = process.env;
    if (dbIdx >= 0) {
      const prodDb = devArgs[dbIdx + 1];
      if (!prodDb || prodDb.startsWith("--")) die("error: --prod-db requires a path argument", 2);
      childEnv = { ...process.env, ATELIER_DB_PATH: prodDb };
    }
    const c = spawn("pnpm", ["dev"], { stdio: "inherit", shell: true, env: childEnv });
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
  case "gen": {
    // FS-M2：契约/数据契约 → 生成物（产物显式 import 闭合；regen 幂等；FS-DESIGN §7.1）
    const genFile = sub === "db" ? path.join(PKG, "gen", "gen-db.mjs") : sub === "endpoint" ? path.join(PKG, "gen", "gen-endpoint.mjs") : sub === "auth" ? path.join(PKG, "gen", "gen-auth.mjs") : null;
    if (!genFile) die("usage: atelier gen db [--root <dir>] | endpoint [--root <dir>] [--mount /api] [--from-specs] | auth [--root <dir>]", 2);
    runFile(genFile, rest);
    break;
  }
  case "migrate":
    // FS-4 可逆迁移器 + D-F17 SQL 种子：库在 server/migrate.ts / server/seed.ts，runner 做装配与诚实呈现
    // （破坏性 down 走 --force 显式同意；seed 逐文件 tx 幂等，库缺失提示先 up——不静默建库）
    if (!["status", "up", "down", "verify", "seed"].includes(sub)) die("usage: atelier migrate status|up|down|verify|seed [--root <dir>] [--db <f>] [--to <name>] [--force]", 2);
    runFile(script("migrate.mjs"), [sub, ...rest]);
    break;
  case "impact":
    // §2.5 契约影响面两跳导航（导航不是门禁，exit 恒 0）
    if (!sub) die("usage: atelier impact <contractKey> [--root <dir>]", 2);
    runFile(path.join(PKG, "gen", "impact.mjs"), [sub, ...rest]);
    break;
  case "export":
    // FS-9：端点面 → openapi-3.0.3（schema 走 §2.4 扁平投影器单管线；范围克制 §13 只导出端点面）
    if (sub !== "openapi") die("usage: atelier export openapi [--root <dir>] [--out openapi.json] [--mount /api] [--name <Title>]", 2);
    runFile(path.join(PKG, "gen", "export-openapi.mjs"), rest);
    break;
  case "call":
    // D-F15：端点直调 CLI 通道（§14.4 工作循环的验证环）——POST <mount>/<name>（§3.4 同一 POST 纪律）；
    // 结构化错误贯通（§15）与用法守卫（exit 2）在脚本内
    runFile(path.join(PKG, "scripts", "call.mjs"), process.argv.slice(3));
    break;
  case "build":
    // D-F14：自托管单容器产线（§12 v1 两 target）——前端 vite build + 产物启动壳（装配/serve 单源）
    // + 冒烟自证；edge/serverless = 不做清单显式拒绝（拒绝位即文档）
    runFile(path.join(PKG, "scripts", "build.mjs"), process.argv.slice(3));
    break;
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
    if (!sub) die("usage: atelier api-diff snapshot | check [--root <dir>] [--json] [--strict] [--allow <file>] [--budget <0..1>]", 2);
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
