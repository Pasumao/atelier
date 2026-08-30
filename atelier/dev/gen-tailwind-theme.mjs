/**
 * gen-tailwind-theme.mjs — 决策 16：token 单源 → Tailwind AOT 编译管线。
 *
 * atelier.config.json 是唯一样式值真值（H3）。流程：
 *   1. 生成 src/tailwind.input.css（@theme 块 + @source 扫描声明，生成产物勿手改）
 *        color.*  → --color-*   → bg-/text-/border-/透明度修饰 等语义工具类
 *        space.*  → --spacing-* → p/m/gap 系列（命名键 p-sm/gap-md…）
 *        radius.* → --radius-*  → rounded 系列
 *        font.*   → --text-*    → text-* 字号刻度（定义即覆盖原生刻度 = token 单源，F-3 第二期）
 *   2. @tailwindcss/cli AOT 编译 → src/atelier-tailwind.css（应用唯一引入的样式产物）
 *
 * 为什么走 CLI 而不是 @tailwindcss/vite 插件：插件 dev 管线在本环境触发
 * full-reload 死循环（候选重扫 × HMR 竞态，2026-08-27 实测事故）。CLI 一次性
 * AOT 编译零 HMR 介入，dev 稳定优先；新增类后重跑本脚本（或重启 dev）即可。
 *
 * 粒度引入：theme + utilities，不含 preflight——基线 reset 归 index.html。
 * 触发：vite.config 顶层调用（dev/build 前）；也可手动 node scripts/gen-tailwind-theme.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const require = createRequire(import.meta.url);

export function generateThemeFile() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "atelier.config.json"), "utf8"));
  const t = cfg.tokens ?? {};
  const lines = [];
  for (const [k, v] of Object.entries(t.color ?? {})) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.space ?? {})) lines.push(`  --spacing-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.radius ?? {})) lines.push(`  --radius-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.font ?? {})) lines.push(`  --text-${k}: ${v};`);

  const inputCss =
    `/* GENERATED from atelier.config.json — token 单源派生，勿手改（决策 16）。\n` +
    ` * 粒度引入：theme + utilities，不含 preflight（基线 reset 归 index.html）。\n` +
    ` * @source 显式声明扫描范围：类名都在组件模板串里。\n */\n` +
    `@import "tailwindcss/theme.css" layer(theme);\n` +
    `@import "tailwindcss/utilities.css" layer(utilities);\n` +
    `@source "./components";\n\n` +
    `@theme {\n${lines.join("\n")}\n}\n`;

  const inPath = path.join(ROOT, "src", "tailwind.input.css");
  fs.writeFileSync(inPath, inputCss, "utf8");

  // AOT 编译（一次性，非 watch 模式）
  const cliPkgPath = require.resolve("@tailwindcss/cli/package.json");
  const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf8"));
  const cliBin = path.join(path.dirname(cliPkgPath), cliPkg.bin.tailwindcss);
  const outPath = path.join(ROOT, "src", "atelier-tailwind.css");
  const r = spawnSync(process.execPath, [cliBin, "-i", inPath, "-o", outPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tailwind cli failed: ${r.stderr || r.stdout}`);
  return outPath;
}

if (process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`tailwind compiled → ${generateThemeFile()}`);
}
