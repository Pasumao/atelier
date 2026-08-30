#!/usr/bin/env node
/**
 * sync-project.mjs — P1-4：已有应用重新同步框架 vendor（`atelier sync`）。
 *
 * 应用是 init 时点的 vendor 拷贝（框架真相在 atelier/，应用持有时点快照）。框架演进后
 * 用本命令把 vendor 拉到当前时点：
 *   1. runtime/*.ts  → <target>/src/runtime/   全量覆盖（零依赖内核，应用零改动）
 *   2. dev 面三件    → <target>/scripts/       全量覆盖（atelier-dev-plugin / dev-screenshot /
 *                                               gen-tailwind-theme；vite.config 从 ./scripts/ 引入）
 *   3. specs/ 模板补种（_spec-template.md / guardrails.md，skip-if-exists——不碰用户文件）
 *
 * 不触碰：应用 src 组件 / tests / atelier.config.json / index.html / package.json——
 * devDependencies 与框架模板的差异只打印提示（是否升级由应用自行决定 + pnpm install）。
 *
 * Usage:
 *   node atelier/cli.mjs sync [--target <appDir>]     （缺省 cwd；须是含 src/runtime 的 Atelier 应用）
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const PKG = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."); // atelier/
const RUNTIME = path.join(PKG, "runtime");
const DEV = path.join(PKG, "dev");
const TEMPLATE = path.join(PKG, "templates", "app");

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const target = path.resolve(argv.includes("--target") ? argv[argv.indexOf("--target") + 1] : process.cwd());
if (!fs.existsSync(path.join(target, "src", "runtime", "core.ts"))) {
  die(
    `not an Atelier app (missing src/runtime at ${target})`,
    "run inside the app dir, or pass --target <appDir> (vendor sync only applies to scaffolded apps)",
  );
}

/* 1) runtime 全量覆盖 */
let runtimeFiles = 0;
for (const f of fs.readdirSync(RUNTIME)) {
  if (f.endsWith(".ts")) {
    fs.copyFileSync(path.join(RUNTIME, f), path.join(target, "src", "runtime", f));
    runtimeFiles++;
  }
}

/* 2) dev 面三件全量覆盖（与 init-project 同一清单） */
const DEV_FILES = ["atelier-dev-plugin.mjs", "dev-screenshot.mjs", "gen-tailwind-theme.mjs"];
for (const f of DEV_FILES) fs.copyFileSync(path.join(DEV, f), path.join(target, "scripts", f));

/* 3) specs 模板补种（skip-if-exists） */
let planted = [];
for (const f of ["_spec-template.md", "guardrails.md"]) {
  const src = path.join(TEMPLATE, "specs", f);
  const dst = path.join(target, "specs", f);
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    planted.push(`specs/${f}`);
  }
}

/* 4) 依赖差异提示（不强制——应用可锁版本） */
const hints = [];
try {
  const appPkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  const tplPkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "package.json"), "utf8"));
  for (const section of ["devDependencies", "dependencies"]) {
    const a = appPkg[section] ?? {};
    const t = tplPkg[section] ?? {};
    const diff = Object.keys(t).filter((k) => a[k] !== t[k]);
    for (const k of diff) hints.push(`${k}: app ${a[k] ?? "(missing)"} → 模板 ${t[k]}`);
  }
} catch { /* package.json 读取失败不算同步失败 */ }

console.log(`[atelier sync] ${path.basename(target)}: runtime ${runtimeFiles} modules + dev face ${DEV_FILES.length} scripts → 当前时点`);
for (const p of planted) console.log(`  planted ${p} (skip-if-exists)`);
if (hints.length) {
  console.log("dependency drift (hint only — review then `pnpm install`):");
  for (const h of hints) console.log(`  · ${h}`);
}
console.log("not touched: src components / tests / atelier.config.json / index.html / package.json");
