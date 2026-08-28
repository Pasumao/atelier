/**
 * styling-discipline.test.ts — 决策 16 的护栏：H3"token 单源"在 Tailwind 层的延伸。
 *
 * 规则（当前试点范围 = 颜色纪律 + scoped 白名单；间距/字号纪律随 recipe 层落地再收紧）：
 *   R1 禁原生 Tailwind 调色板类（bg-blue-500…）——语义 token 派生类才是唯一入口
 *   R2 禁裸颜色字面量（#hex / rgb( / rgba( / hsl(）——颜色只能来自
 *      token 工具类（bg-ok/17）或 var(--color-*)（scoped CSS / 任意值内 color-mix）
 *   R2b scoped CSS 只通过 var(--token) 取值
 *   R3 <style scoped> 仅白名单组件可用（伪元素/keyframes/异形渐变逃生舱）——
 *      其余组件一律工具类优先
 *
 * 扫描对象：src/components/*.atr.ts（模板类名 + scoped CSS 同文件同责）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../src/components");
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".atr.ts"));

/** 混合制逃生舱白名单：伪元素 / keyframes / 异形渐变（component-library 层）。新项目默认为空——需要时在此登记并写明理由 */
const SCOPED_ALLOWLIST = new Set<string>();

const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|from|to|via|divide|outline|decoration|accent|caret|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)(?:-\d{2,3})?\b/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function atrFiles(): { file: string; text: string }[] {
  return FILES.map((f) => ({ file: f, text: fs.readFileSync(path.join(DIR, f), "utf8") }));
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

  it("R2: no raw color literals (hex/rgb/hsl) in templates or scoped CSS", () => {
    for (const { file, text } of atrFiles()) {
      const m = text.match(RAW_COLOR);
      expect(m, `${file} 出现裸颜色字面量 "${m?.[0]}" —— 颜色只能来自 token 工具类或 var(--color-*)`).toBeNull();
    }
  });

  it("R2b: scoped CSS 只通过 var(--token) 取值（含 color-mix 内层）", () => {
    for (const { file, text } of atrFiles()) {
      const style = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(text)?.[1] ?? "";
      const varRefs = [...style.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
      for (const v of varRefs) {
        expect(v.startsWith("--color-") || v.startsWith("--space-") || v.startsWith("--radius-"),
          `${file} scoped CSS 引用了非 token 变量 ${v}`).toBe(true);
      }
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
});
