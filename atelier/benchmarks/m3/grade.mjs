#!/usr/bin/env node
/**
 * grade.mjs — M3 评分器：对单个 attempt 跑 acceptance harness，落 m3-grade.json。
 *
 *   node atelier/benchmarks/m3/grade.mjs --task <taskId> --attempt <dir> [--out <file>]
 *
 * exit 0 = 首遍通过可用；exit 1 = 未通过（结构化结果在 m3-grade.json，tail 供诊断）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ATELIER = path.resolve(HERE, "..", "..");
const TASKS = {
  "task1-counter": "Counter.atr.ts",
  "task2-stream": "StreamCard.atr.ts",
  "task3-rollback": "RollbackDemo.atr.ts",
  "task4-agent-cards": "ToolCallPanel.atr.ts", // 加难层（P3-1）：流式 + keyed each + 嵌套作用域
  "task5-txn-board": "TxnBoard.atr.ts", // 加难层：父子组合 + store 事务（还需 TxnItem.atr.ts）
  "task6-token-discipline": "PricingCard.atr.ts", // 加难层：token 纪律 + 逃生舱（还需 config + 守卫测试）
};

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const task = argOf("--task");
const attempt = path.resolve(argOf("--attempt") ?? ".");
if (!TASKS[task]) die(`unknown task "${task}"`, `one of: ${Object.keys(TASKS).join(", ")}`);
const compFile = path.join(attempt, "src", "components", TASKS[task]);
if (!fs.existsSync(compFile)) die(`attempt 缺组件文件：${compFile}`, "按任务书产出布局放置组件后再评分");

const r = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "benchmarks/m3/harness/acceptance.spec.ts"],
  {
    cwd: ATELIER,
    env: { ...process.env, ATELIER_M3_TASK: task, ATELIER_M3_ATTEMPT: attempt },
    encoding: "utf8",
    timeout: 120000,
    shell: process.platform === "win32",
  },
);
const out = `${r.stdout ?? ""}`;
const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
const testsLine = lines.find((l) => /Tests\s+\S/.test(l)) ?? null;
const ok = r.status === 0;
const grade = {
  task,
  attempt: attempt.replaceAll("\\", "/"),
  at: new Date().toISOString(),
  ok,
  exitCode: r.status,
  summary: { tests: testsLine },
  tail: lines.slice(-12),
};
const outPath = argOf("--out") ?? path.join(attempt, "m3-grade.json");
fs.writeFileSync(outPath, JSON.stringify(grade, null, 2) + "\n", "utf8");
console.log(`[m3] ${task} ${path.basename(attempt)}: ${ok ? "PASS" : "FAIL"} → ${outPath}`);
process.exit(ok ? 0 : 1);
