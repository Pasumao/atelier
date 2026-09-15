#!/usr/bin/env node
/**
 * m3-prep-run.mjs — 正式波单 run 预备：按 RUNBOOK §1 组 attempt 骨架（不wipe、幂等新建）。
 *
 *   node atelier/benchmarks/m3/m3-prep-run.mjs --arm noskill|skill|react --task <taskId> --run <N>
 *
 * attempt 目录 = .m3-runs/wave7/<arm>.<task>.r<run>（正式波独立子目录，避开先导波遗留）。
 * atelier 两臂：init（skill 含 agent 层 / noskill --no-ai）+ src/runtime junction 指框架 runtime。
 * react 臂：干净 vite react-ts 模板副本（模板缓存在 wave7/_react-tpl），src 清空。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const SCRATCH = path.join(ROOT, ".m3-runs", "wave7");
const TASKS = ["task4-agent-cards", "task5-txn-board", "task6-token-discipline"];

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const arm = argOf("--arm");
const task = argOf("--task");
const run = argOf("--run");
if (!["noskill", "skill", "react"].includes(arm)) die("arm 必须是 noskill|skill|react");
if (!TASKS.includes(task)) die(`task 必须是 ${TASKS.join("|")}`);
if (!/^\d+$/.test(run ?? "")) die("--run 必须是数字");

const dir = path.join(SCRATCH, `${arm}.${task}.r${run}`);
if (fs.existsSync(dir)) die(`attempt 已存在：${dir}`, "正式波每 run 全新目录，不得复用");
fs.mkdirSync(SCRATCH, { recursive: true });

if (arm === "react") {
  const tpl = path.join(SCRATCH, "_react-tpl");
  if (!fs.existsSync(tpl)) {
    execSync(`pnpm dlx create-vite@latest "${tpl}" --template react-ts`, { stdio: "ignore", cwd: ROOT, shell: true });
  }
  fs.cpSync(tpl, dir, { recursive: true });
  fs.rmSync(path.join(dir, "src"), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
} else {
  const name = `M3${arm === "skill" ? "S" : "N"}${task.match(/task(\d)/)[1]}`;
  execSync(
    `node atelier/cli.mjs init --target "${dir}" --name ${name}${arm === "noskill" ? " --no-ai" : ""}`,
    { stdio: "ignore", cwd: ROOT, shell: true },
  );
  const vendored = path.join(dir, "src", "runtime");
  fs.rmSync(vendored, { recursive: true, force: true });
  execSync(`cmd /c mklink /J "${vendored}" "${path.join(ROOT, "atelier", "runtime")}"`, { stdio: "ignore" });
}
console.log(dir);

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}
