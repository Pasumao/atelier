#!/usr/bin/env node
/**
 * m3-ledger.mjs — 正式波记分账本（只追加，不改写已有条目；schema 同 report.mjs 头注）。
 *
 *   node atelier/benchmarks/m3/m3-ledger.mjs --file <results.json> \
 *     --arm noskill|skill|react --task <taskId> --run <N> --firstPass true|false \
 *     --attempts <N> [--note "..."] [--score <react rubric 分>]
 */
import fs from "node:fs";

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const file = argOf("--file");
const rec = {
  arm: argOf("--arm"),
  task: argOf("--task"),
  run: Number(argOf("--run")),
  firstPass: argOf("--firstPass") === "true",
  attempts: Number(argOf("--attempts") ?? "1"),
};
if (argOf("--note")) rec.note = argOf("--note");
if (argOf("--score")) rec.rubricScore = Number(argOf("--score"));
if (!file || !rec.arm || !rec.task || !rec.run) {
  console.error("error: --file/--arm/--task/--run 必填");
  process.exit(1);
}
let doc = { wave: "7-formal", note: "正式波：每臂×每任务×5 runs（task4-6 加难层）；独立子代理会话逐 run 串行执行；react 臂独立评审代理盲评 rubric（评分者≠编排者）。runs 只追加不改写。", runs: [] };
if (fs.existsSync(file)) doc = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const dup = doc.runs.find((r) => r.arm === rec.arm && r.task === rec.task && r.run === rec.run);
if (dup) {
  console.error(`error: 已存在同格记录 ${rec.arm}/${rec.task}/r${rec.run}（账本只追加不改写）`);
  process.exit(1);
}
doc.runs.push(rec);
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(`ledger +1: ${rec.arm} ${rec.task} r${rec.run} firstPass=${rec.firstPass} attempts=${rec.attempts}${rec.rubricScore != null ? ` rubric=${rec.rubricScore}` : ""}`);
