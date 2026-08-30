/**
 * styling-discipline.test.ts — 决策 16 的护栏：H3"token 单源"在 Tailwind 层的延伸。
 *
 * 规则（第一期 = 颜色纪律；第二期 = 间距/字号纪律，recipe 层同责）：
 *   R1  禁原生 Tailwind 调色板类（bg-blue-500…）——语义 token 派生类才是唯一入口
 *   R2  禁裸颜色字面量（#hex / rgb( / rgba( / hsl(）——颜色只能来自
 *       token 工具类（bg-ok/17）或 var(--color-*)（scoped CSS / 任意值内 color-mix）
 *   R2b scoped CSS / recipe 层取值只准 var(--color-* / --space-* / --radius-* / --font-*) 形态的 token 变量
 *   R3  <style scoped> 仅白名单组件可用（伪元素/keyframes/异形渐变逃生舱）——
 *       其余组件一律工具类优先
 *   R4  间距声明（padding/margin/gap/scroll-margin 族）只准 var(--space-*) 组合 /
 *       calc(var(--space-*)·无单位系数) / 0 / auto——recipe 层与组件 scoped 同责
 *   R5  字号：CSS font-size 只准 var(--font-*)；模板 text-* 字号类只准 config
 *       font 组键名（text-md/text-lg…=token 派生；原生刻度 base/2xl… 未定义即禁）
 *
 * 扫描对象：src/components/*.atr.ts（模板类名 + scoped CSS 同文件同责）
 *          + src/atelier-ui.css（recipe 层——间距/字号/颜色取值同责）。
 * 诚实边界：index.html 基线 reset 豁免（决策 16：不引入 preflight）；border 宽度 /
 *   line-height / letter-spacing / 阴影与 transform 内的长度不属间距纪律管辖；radius 纪律留第三期。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../src/components");
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".atr.ts"));
const RECIPE = path.resolve(__dirname, "../src/atelier-ui.css");
const CONFIG = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../atelier.config.json"), "utf8"));
const FONT_KEYS: Set<string> = new Set(Object.keys(CONFIG.tokens?.font ?? {}));

/** 混合制逃生舱白名单：伪元素 / keyframes / 异形渐变（component-library 层）。新项目默认为空——需要时在此登记并写明理由 */
const SCOPED_ALLOWLIST = new Set<string>();

const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|from|to|via|divide|outline|decoration|accent|caret|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)(?:-\d{2,3})?\b/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

/** 原生字号刻度名（Tailwind v4 text-* 命名空间；命中即要求 ∈ config font 组键） */
const NATIVE_TEXT_SCALE = /^(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/;

/** 间距纪律管辖的属性族（R4） */
const SPACING_PROPS = new Set([
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "padding-inline", "padding-block",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-inline", "margin-block",
  "gap", "row-gap", "column-gap",
  "scroll-margin", "scroll-margin-top", "scroll-margin-right", "scroll-margin-bottom", "scroll-margin-left",
]);
const SPACE_VAR = /var\(\s*--space-[\w-]+\s*\)/g;
const RAW_LENGTH = /\d*\.?\d+(?:px|rem|em|vh|vw|ch|ex)\b/;

function atrFiles(): { file: string; text: string }[] {
  return FILES.map((f) => ({ file: f, text: fs.readFileSync(path.join(DIR, f), "utf8") }));
}
function scopedCss(text: string): string {
  return /<style[^>]*>([\s\S]*?)<\/style>/i.exec(text)?.[1] ?? "";
}
/** CSS 检查前剥块注释——注释里的示例值（如 var(--token)）不是声明 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** R4 主体：剥掉 var(--space-*) 后不许残留裸长度（calc 系数须无单位） */
function checkSpacing(css: string, where: string): void {
  for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
    if (!SPACING_PROPS.has(m[1])) continue;
    const rest = m[2].replace(SPACE_VAR, " ");
    const bad = rest.match(RAW_LENGTH);
    expect(bad, `${where} 间距声明 "${m[1]}: ${m[2].trim()}" 含裸长度 "${bad?.[0]}" —— 只准 var(--space-*) 组合 / calc(var(--space-*)·无单位系数) / 0 / auto`).toBeNull();
  }
}

/** R5 CSS 主体：font-size 只准 var(--font-*) */
function checkFontSize(css: string, where: string): void {
  for (const m of css.matchAll(/font-size\s*:\s*([^;{}]+)/g)) {
    expect(m[1].trim(), `${where} font-size: ${m[1].trim()} —— 只准 var(--font-<key>)（键见 atelier.config.json tokens.font）`).toMatch(/^var\(--font-[\w-]+\)$/);
  }
}

describe("styling discipline (decision 16 — token-derived utilities only)", () => {
  it("components exist to scan", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it("R1: no native Tailwind palette classes", () => {
    for (const { file, text } of atrFiles()) {
      const m = text.match(PALETTE_CLASS);
      expect(m, `${file} 使用了原生调色板类 "${m?.[0]}" —— 改用 token 派生类（bg-primary / bg-ok/17…）`).toBeNull();
    }
  });

  it("R2: no raw color literals (hex/rgb/hsl) in templates, scoped CSS, or recipe", () => {
    for (const { file, text } of atrFiles()) {
      const m = text.match(RAW_COLOR);
      expect(m, `${file} 出现裸颜色字面量 "${m?.[0]}" —— 颜色只能来自 token 工具类或 var(--color-*)`).toBeNull();
    }
    const recipe = fs.readFileSync(RECIPE, "utf8");
    const m = recipe.match(RAW_COLOR);
    expect(m, `atelier-ui.css 出现裸颜色字面量 "${m?.[0]}" —— recipe 层颜色只准 var(--color-*)`).toBeNull();
  });

  it("R2b: scoped CSS / recipe 只通过 var(--token) 取值（含 color-mix 内层）", () => {
    for (const { file, text } of atrFiles()) {
      const style = stripCssComments(scopedCss(text));
      for (const v of [...style.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])) {
        expect(v.startsWith("--color-") || v.startsWith("--space-") || v.startsWith("--radius-") || v.startsWith("--font-"),
          `${file} scoped CSS 引用了非 token 变量 ${v}`).toBe(true);
      }
    }
    const recipe = stripCssComments(fs.readFileSync(RECIPE, "utf8"));
    for (const v of [...recipe.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])) {
      expect(v.startsWith("--color-") || v.startsWith("--space-") || v.startsWith("--radius-") || v.startsWith("--font-"),
        `atelier-ui.css (recipe) 引用了非 token 变量 ${v}`).toBe(true);
    }
  });

  it("R3: scoped <style> 仅逃生舱白名单组件可用", () => {
    for (const { file, text } of atrFiles()) {
      const hasStyle = /<style[^>]*>/i.test(text);
      if (!SCOPED_ALLOWLIST.has(file)) {
        expect(hasStyle, `${file} 不在逃生舱白名单内——样式请用 token 工具类 / atelier-ui.css recipe`).toBe(false);
      } else {
        expect(hasStyle, `${file} 在白名单内却删除了 scoped 样式？若是永久迁移请同步更新 SCOPED_ALLOWLIST`).toBe(true);
      }
    }
  });

  it("R4: 间距声明只准 var(--space-*) 组合 / calc·无单位系数 / 0 / auto（scoped + recipe）", () => {
    for (const { file, text } of atrFiles()) checkSpacing(stripCssComments(scopedCss(text)), file);
    checkSpacing(stripCssComments(fs.readFileSync(RECIPE, "utf8")), "atelier-ui.css");
  });

  it("R5: 字号纪律——CSS font-size 只准 var(--font-*)；text-* 刻度类只准 config font 键", () => {
    for (const { file, text } of atrFiles()) checkFontSize(stripCssComments(scopedCss(text)), file);
    checkFontSize(stripCssComments(fs.readFileSync(RECIPE, "utf8")), "atelier-ui.css");
    for (const { file, text } of atrFiles()) {
      for (const m of text.matchAll(/\btext-([a-z0-9]+)\b/g)) {
        if (!NATIVE_TEXT_SCALE.test(m[1])) continue; // text-muted / text-center 等非刻度类不辖
        expect(FONT_KEYS.has(m[1]), `${file} 使用字号类 text-${m[1]} —— 不在 config tokens.font 键内（${[...FONT_KEYS].join("/")}）；原生刻度已由 token 覆盖，请改用 font 组键`).toBe(true);
      }
    }
    expect(FONT_KEYS.size, "config tokens.font 未定义——字号纪律（R5）以 font 组为前提").toBeGreaterThan(0);
  });
});
