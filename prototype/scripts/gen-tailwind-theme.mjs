/**
 * gen-tailwind-theme.mjs — 决策 16：token 单源 → Tailwind v4 @theme 派生管线。
 *
 * atelier.config.json 是唯一样式值真值（H3）。本脚本把 token 翻译成 Tailwind 主题块，
 * 生成 src/atelier-theme.css（生成产物，勿手改）：
 *   color.{name}  → --color-{name}   → bg / text / border / 透明度修饰 等语义工具类
 *   space.{name}  → --spacing-{name} → p / m / gap / w 系列
 *   radius.{name} → --radius-{name}  → rounded 系列
 *
 * 刻意采用粒度引入（theme + utilities，不含 preflight）：
 * 基线 reset 仍归 index.html，避免引入即改动全站默认渲染（快照稳定性）。
 *
 * 触发时机：vite.config 顶层调用（dev/build 前都重生成）；也可手动 node scripts/gen-tailwind-theme.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export function generateThemeFile() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "atelier.config.json"), "utf8"));
  const t = cfg.tokens ?? {};
  const lines = [];
  for (const [k, v] of Object.entries(t.color ?? {})) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.space ?? {})) lines.push(`  --spacing-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.radius ?? {})) lines.push(`  --radius-${k}: ${v};`);

  const css =
    `/* GENERATED from atelier.config.json — token 单源派生，勿手改（决策 16）。\n` +
    ` * 粒度引入：theme + utilities，不含 preflight（基线 reset 归 index.html）。\n` +
    ` * @source 显式声明扫描范围：类名都在组件模板串里，自动检测在粒度引入下不可靠。\n */\n` +
    `@import "tailwindcss/theme.css" layer(theme);\n` +
    `@import "tailwindcss/utilities.css" layer(utilities);\n` +
    `@source "./components";\n\n` +
    `@theme {\n${lines.join("\n")}\n}\n`;

  const out = path.join(ROOT, "src", "atelier-theme.css");
  fs.writeFileSync(out, css, "utf8");
  return out;
}

if (process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`theme generated → ${generateThemeFile()}`);
}
