#!/usr/bin/env node
/**
 * report.mjs — M3 出数：汇总 results.json → 每臂首遍正确率 + SPEC §7 判定。
 *
 *   node atelier/benchmarks/m3/report.mjs --results <file>
 *
 * results.json schema（由跑批者按 run 追加；react 臂 rubric ≥8 分记 firstPass=true）：
 *   { "runs": [ { "arm": "noskill|skill|react", "task": "task1-counter|…",
 *                 "run": 1, "firstPass": true, "attempts": 1 } ] }
 */
import fs from "node:fs";

const argv = process.argv.slice(2);
const file = argv.includes("--results") ? argv[argv.indexOf("--results") + 1] : null;
if (!file || !fs.existsSync(file)) {
  console.error("error: --results <file> 必填（schema 见本文件头注）");
  process.exit(1);
}
// BOM 容忍（windows-enc）：PS5.1 的 Set-Content -Encoding UTF8 会带 BOM，JSON.parse 会炸
const { runs } = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const rate = (arm) => {
  const rs = runs.filter((r) => r.arm === arm);
  return { n: rs.length, firstPass: rs.length ? Math.round((rs.filter((r) => r.firstPass).length / rs.length) * 1000) / 10 : null };
};
const arms = ["noskill", "skill", "react"].map((a) => ({ arm: a, ...rate(a) }));
for (const a of arms) {
  console.log(`${a.arm.padEnd(8)} runs=${a.n}  firstPass=${a.firstPass === null ? "n/a" : a.firstPass + "%"}`);
}
const minRuns = Math.min(...arms.map((a) => a.n));
const skill = arms.find((a) => a.arm === "skill").firstPass;
const react = arms.find((a) => a.arm === "react").firstPass;
let verdict;
if (minRuns < 5 || skill === null || react === null) {
  verdict = "N/A — 数据不足（协议要求每臂 ≥5 runs；当前 min=" + minRuns + "）。诚实出数前不写结论。";
} else if (skill >= 60) {
  verdict = `PASS（绝对口径：skill 首遍 ${skill}% ≥ 60%）`;
} else if (skill - react >= 15) {
  verdict = `PASS（相对口径：skill − react = +${Math.round((skill - react) * 10) / 10}pt ≥ +15pt）`;
} else {
  verdict = `FAIL（skill ${skill}% < 60%，且相对 react 不足 +15pt）— 按约定改写路线图权重，不豁免`;
}
console.log("§7 判定:", verdict);
