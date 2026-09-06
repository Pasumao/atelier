#!/usr/bin/env node
/**
 * negative-check.mjs — M3 评分器负控门（2026-09-06 锐评整改：把"诚实"从措辞纪律升级为实验设计）。
 *
 * 正控（reference/ 六解全 PASS）只证明"对的东西能给过"；负控（本脚本）证明"错的东西抓得住"。
 * 每个 harness/fixtures/negative/<task>-<mutation>/ 是对参考解做单一变异的"差一点错"样本，
 * 评分器必须判 FAIL（exit 1）——任何一个被漏判 = 评分器判别力缺口，本脚本 exit 1。
 *
 *   node atelier/benchmarks/m3/negative-check.mjs
 *
 * 出数前置（RUNBOOK §5）：三臂出数前本脚本必须绿。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const NEG_DIR = path.join(HERE, "harness", "fixtures", "negative");
const GRADE = path.join(HERE, "grade.mjs");

const fixtures = fs
  .readdirSync(NEG_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
if (!fixtures.length) {
  console.error(`error: no negative fixtures at ${NEG_DIR}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m3-negative-"));
let missed = 0;
let passed = 0;
console.log(`[m3-negative] ${fixtures.length} 变异样本，评分器必须全数抓住：`);
for (const name of fixtures) {
  // 目录名约定：<taskN>-<mutation>（如 task4-sorted-render）——按序号映射回完整任务 id
  const m = /^task(\d+)-/.exec(name);
  const taskId = m
    ? ["task1-counter", "task2-stream", "task3-rollback", "task4-agent-cards", "task5-txn-board", "task6-token-discipline"].find(
        (t) => t.startsWith(`task${m[1]}-`),
      )
    : null;
  if (!taskId) {
    console.error(`  · ${name}: 目录名必须以任务 id 开头（如 task4-xxx）`);
    missed++;
    continue;
  }
  const out = path.join(tmp, `${name}.json`);
  const r = spawnSync(
    process.execPath,
    [GRADE, "--task", taskId, "--attempt", path.join(NEG_DIR, name), "--out", out],
    { encoding: "utf8", timeout: 120000, shell: process.platform === "win32" },
  );
  // grade.mjs 约定：exit 0 = PASS（漏判！）；exit 1 = FAIL（负控合格）
  if (r.status === 1) {
    console.log(`  ✔ ${name} — 被抓住`);
    passed++;
  } else {
    console.error(`  ✘ ${name} — 评分器漏判（exit ${r.status}，必须 FAIL）`);
    missed++;
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`[m3-negative] ${passed}/${fixtures.length} 抓住；${missed} 漏判`);
process.exit(missed === 0 ? 0 : 1);
