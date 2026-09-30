#!/usr/bin/env node
/**
 * init-project.mjs — `atelier init`: scaffold a SELF-CONTAINED application from
 * framework pieces, then (unless --no-ai) install the agent layer.
 *
 * Assembly (source-as-library, decision 14 — the app starts as readable, runnable source):
 *   1. templates/app/  → target/             app skeleton（config/index/main/components/tests/vite.config）
 *   2. runtime/*.ts    → target/src/runtime/ vendored 零依赖内核（应用不依赖框架目录即可跑）
 *   2b. runtime+server → target/src/vendor/atelier/  FS 线规范布局（生成器产物 import 面，§4.4/§7.2）
 *   3. dev/*.mjs       → target/scripts/     dev 面六件：插件 + 无头截图 + tailwind 主题生成 + server 监督器 + review 扩展两件（FS-M6）
 *   3b. mcp 族 11 件   → target/{mcp,scripts,gen,compiler}/  MCP HTTP 直连的 import 闭包（FS-M7：
 *                        mcp/{server,http,tasks,confirm,endpoint-tools}.mjs + mcp-definitions.json +
 *                        scripts/struct.mjs + gen/{impact,gen-endpoint}.mjs + compiler/project-json.mjs +
 *                        compiler/extract-schema.mjs（决策 26 schema 提取器，dev 插件注入源）；
 *                        目标布局与框架仓相对布局同构——server.mjs 经 HERE 解析 mcp-definitions.json、
 *                        经 ../scripts/struct.mjs 等相对 import 在 vendored 拷贝上原样成立。名单与
 *                        sync-project.mjs / tests/mcp-vendor.test.ts 三处同源）
 *   4. init-ai（除非 --no-ai）：skills 双落点 + AGENTS.md/llms.txt + specs/ + MCP 客户端配置
 *
 * P1 #7 目录守卫：target 已存在且非空（或为文件）→ die exit 2 指路 `atelier sync`——cpSync
 * 合并覆盖会静默重置用户改过的 main.ts/contract.ts/vite.config.ts（未提交即不可恢复）；
 * `--force` 为显式覆盖逃生口（模板件覆盖同名，名单外用户文件保留）。空目录照常脚手架。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const PKG = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."); // atelier/

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--target": a.target = argv[++i]; break;
      case "--name": a.name = argv[++i]; break;
      case "--no-ai": a.noAi = true; break;
      case "--force": a.force = true; break;
      default: console.error(`unknown arg: ${argv[i]}`); process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.target || !args.name) {
  die("usage: init-project --target <dir> --name <Name> [--no-ai] [--force]");
}
const target = path.resolve(args.target);

/* P1 #7：目录守卫（先于任何写入）。文件 target 连 --force 也不放行——目录与文件的形态冲突
 * 不是「覆盖用户文件」能形容的，诚实拒绝换路径。 */
if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
  die(
    `error: target 已存在且不是目录（${target}）——init 需要一个目录作脚手架落点\n` +
    `fix: 换一个 --target 路径；既有 Atelier 应用拉齐框架件用 \`node <repo>/atelier/cli.mjs sync --target <dir>\``,
  );
}
if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !args.force) {
  die(
    `error: target 已存在且非空（${target}）——init 绝不静默覆盖：cpSync 合并覆盖会重置你改过的 ` +
    `main.ts / contract.ts / vite.config.ts（未提交即不可恢复）\n` +
    `fix: 既有 Atelier 应用拉齐框架件用 \`node <repo>/atelier/cli.mjs sync --target <dir>\`；` +
    `确要在此目录重建脚手架请显式加 \`--force\`（模板件覆盖同名，名单外用户文件保留）`,
  );
}

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

/* 1) app skeleton（node_modules/.atelier 等运行时产物绝不入脚手架——模板本地产了 lock 也不拷） */
fs.cpSync(TEMPLATE, target, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(TEMPLATE, src);
    return rel === "" || !["node_modules", ".atelier", "dist"].includes(rel.split(path.sep)[0]);
  },
});

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

/* 3) vendored FS 线规范布局（FS-DESIGN §4.4/§7.2）：src/vendor/atelier/{runtime,server} —
 *    gen endpoint/db/auth 产物与 api.ts 按此布局显式 import；既有 src/runtime 拷贝保留
 *    （starter 组件的既有 import 不动），两布局并存直至 FS-7 dev 托管批次统一。 */
const targetVendor = path.join(target, "src", "vendor", "atelier");
let vendorFiles = 0;
for (const [srcDir, dstName] of [[RUNTIME, "runtime"], [path.join(PKG, "server"), "server"]]) {
  const dst = path.join(targetVendor, dstName);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith(".ts")) {
      fs.copyFileSync(path.join(srcDir, f), path.join(dst, f));
      vendorFiles++;
    }
  }
}

/* 4) vendored dev face 六件 — vite.config 从 ./scripts/ 引入（FS-M6 起含 review 扩展两件） */
const targetScripts = path.join(target, "scripts");
fs.mkdirSync(targetScripts, { recursive: true });
for (const f of ["atelier-dev-plugin.mjs", "dev-server-host.mjs", "dev-screenshot.mjs", "gen-tailwind-theme.mjs", "dev-review-data.mjs", "dev-review-pages.mjs"]) {
  fs.copyFileSync(path.join(DEV, f), path.join(targetScripts, f));
}

/* 4b) vendored MCP 族 11 件（FS-M7，M6 尾件批候选池挂账销账；决策 26 起含 schema 提取器）：应用
 *     dev 面 /__atelier/mcp 直连的 import 闭包——mcp/http.mjs → server/tasks/confirm/endpoint-tools
 *     → ../scripts/struct.mjs + ../gen/impact.mjs（→ ./gen-endpoint.mjs 传递）+
 *     ../compiler/project-json.mjs，传递 import 全为零依赖或 node 内建。决策 26 追加
 *     compiler/extract-schema.mjs（零依赖自包含 schema 提取器，dev 插件 .atr.ts transform
 *     的注入源；不属 /__atelier/mcp import 闭包，mcp-vendor.test.ts 以闭包种子根显式入队核对）。
 *     目标布局与框架仓相对布局同构（dev/ 与 mcp/ 同级 → scripts/ 与 mcp/ 同级），vendored 拷贝按
 *     同样的相对路径自成一体。运行时 spawn 的 scripts/checkpoint.mjs（checkpoint.* 与 diff.report）
 *     与 compiler/codegen.mjs（graph.static）不在 import 闭包，vendored 应用缺失时走工具级 ATR
 *     结构化报错（诚实降级），不入名单。
 *     名单与 sync-project.mjs / tests/mcp-vendor.test.ts 三处同源，改动必须同步（两处名单逐字节一致）。
 *     源缺失 → 通知 + 跳过（诚实降级，不炸 init/sync）：并行分支实现件未落地的合并窗口与名单漂移
 *     都在此显式可见，闭包测试（mcp-vendor）事后兜底。 */
const MCP_VENDOR_DIRS = [
  ["mcp", ["server.mjs", "http.mjs", "tasks.mjs", "confirm.mjs", "endpoint-tools.mjs", "mcp-definitions.json"]],
  ["scripts", ["struct.mjs"]],
  ["gen", ["impact.mjs", "gen-endpoint.mjs"]],
  ["compiler", ["project-json.mjs", "extract-schema.mjs"]],
];
let mcpFiles = 0;
for (const [dir, files] of MCP_VENDOR_DIRS) {
  const dst = path.join(target, dir);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of files) {
    const src = path.join(PKG, dir, f);
    if (!fs.existsSync(src)) {
      console.log(`[atelier] vendor 源缺失，跳过：${dir}/${f}（框架侧未落地或名单漂移——重新 init/sync 补齐）`);
      continue;
    }
    fs.copyFileSync(src, path.join(dst, f));
    mcpFiles++;
  }
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
  fs.writeFileSync(gitignore, ["node_modules/", "dist/", ".atelier/dev-token", ".atelier/approval-secret", ".atelier/audit.jsonl", ".atelier/dev.db", ".atr/snapshots/current.png", "*.log", ".debug*"].join("\n") + "\n");
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

console.log(`scaffolded ${writtenCount} files → ${target}  (app: ${pkg.name}, vendored runtime: ${runtimeFiles} modules, vendor/atelier: ${vendorFiles} modules, mcp family: ${mcpFiles} files)`);
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
