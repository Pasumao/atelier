#!/usr/bin/env node
/**
 * tokens-dtcg.mjs — P2-2④：W3C DTCG（Design Tokens Community Group）格式互导。
 *
 * atelier.config.json 的扁平 token 组 ↔ DTCG .tokens.json（`$type`/`$value` 叶子）。
 * 类型推断（导出侧）：hex/rgb/hsl → "color"；px/rem/em/%/vh/vw 长度 → "dimension"；
 * 纯数字 → "number"；其余 → "other"。导入侧剥离 $type/$value 还原扁平字符串组——
 * 不直接写 atelier.config.json（由调用方审阅合并，避免覆盖手工 token）。
 *
 * Usage:
 *   node atelier/cli.mjs tokens export --in <atelier.config.json> --out <tokens.json>
 *   node atelier/cli.mjs tokens import --in <tokens.json> --out <config-fragment.json>
 * 也可在 vitest 里 import { exportDtcg, importDtcg } 做库调用。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const INVOKED_DIRECTLY =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

/** DTCG $type 推断（诚实边界：启发式——语义仅靠值形态，写配置时可手工覆写 $type） */
export function inferType(value) {
  const s = String(value);
  if (/^#([0-9a-fA-F]{3,8})$/.test(s) || /^(rgba?|hsla?)\(/.test(s)) return "color";
  if (/^\d*\.?\d+(px|rem|em|%|vh|vw|ch|ex)$/.test(s)) return "dimension";
  if (/^-?\d*\.?\d+$/.test(s)) return "number";
  return "other";
}

/** atelier.config.json 的 tokens → DTCG 对象（组 = group，叶子 = {$type,$value}） */
export function exportDtcg(config) {
  const tokens = config?.tokens ?? {};
  const out = {};
  for (const [group, map] of Object.entries(tokens)) {
    out[group] = {};
    for (const [name, value] of Object.entries(map)) {
      out[group][name] = { $type: inferType(value), $value: value };
    }
  }
  return out;
}

/** DTCG 对象 → 扁平 tokens 组（剥离 $type/$value；非 DTCG 叶子按原样收——宽容导入） */
export function importDtcg(dtcg) {
  const out = {};
  for (const [group, map] of Object.entries(dtcg ?? {})) {
    if (typeof map !== "object" || map === null) continue;
    out[group] = {};
    for (const [name, leaf] of Object.entries(map)) {
      if (leaf !== null && typeof leaf === "object" && "$value" in leaf) {
        out[group][name] = leaf.$value;
      } else if (typeof leaf !== "object") {
        out[group][name] = leaf; // 已是扁平值
      }
    }
    if (Object.keys(out[group]).length === 0) delete out[group];
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  if (sub !== "export" && sub !== "import") {
    die("usage: atelier tokens export|import --in <file> --out <file>", "export: atelier.config.json → DTCG；import: DTCG → 扁平 tokens 片段");
  }
  const inPath = path.resolve(argOf("--in") ?? die("--in is required", "传 atelier.config.json（export）或 .tokens.json（import）"));
  const outPath = path.resolve(argOf("--out") ?? die("--out is required", "产物落盘路径（不覆盖既有配置，审阅后手工合并）"));
  const data = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const result = sub === "export" ? exportDtcg(data) : importDtcg(data);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  const count = Object.values(result).reduce((n, g) => n + Object.keys(g).length, 0);
  console.log(`[atelier tokens] ${sub}: ${Object.keys(result).length} group(s), ${count} token(s) → ${path.basename(outPath)}`);
  if (sub === "import") console.log("  产物是扁平 tokens 片段——审阅后手工合并进 atelier.config.json（不自动覆写）");
}

if (INVOKED_DIRECTLY) main();
