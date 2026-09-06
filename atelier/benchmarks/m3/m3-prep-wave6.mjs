#!/usr/bin/env node
/**
 * m3-prep-wave6.mjs — 先导波（PILOT）臂环境搭建：task4-6 × {noskill, skill} 各 1 attempt
 * + react 臂脚手架 ×3。attempt 目录 = RUNBOOK 约定 <scratch>/m3/<arm>.<task>.r<run>。
 * atelier 两臂 src/runtime 用 junction 指向框架 runtime（协议实现注记：vendored 拷贝会被
 * vite 视为独立模块 → 信号跨实例不追踪 → 评分假阴性）。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const SCRATCH = path.join(ROOT, ".m3-runs");
const TASKS = ["task4-agent-cards", "task5-txn-board", "task6-token-discipline"];
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

function junction(attempt) {
  const vendored = path.join(attempt, "src", "runtime");
  fs.rmSync(vendored, { recursive: true, force: true });
  execSync(`cmd /c mklink /J "${vendored}" "${path.join(ROOT, "atelier", "runtime")}"`, { stdio: "ignore" });
}

for (const arm of ["noskill", "skill"]) {
  for (const task of TASKS) {
    const dir = path.join(SCRATCH, `${arm}.${task}.r1`);
    execSync(
      `node atelier/cli.mjs init --target "${dir}" --name M3${arm === "skill" ? "S" : "N"}${task.match(/task(\d)/)[1]}${arm === "noskill" ? " --no-ai" : ""}`,
      { stdio: "ignore", cwd: ROOT },
    );
    junction(dir);
    console.log(`ready: ${path.relative(ROOT, dir)} (${arm})`);
  }
}

// react 臂：一个干净 vite react-ts 脚手架 ×3 副本
const reactTpl = path.join(SCRATCH, "_react-tpl");
execSync(`pnpm dlx create-vite@latest "${reactTpl}" --template react-ts`, { stdio: "ignore", cwd: ROOT });
for (const task of TASKS) {
  const dir = path.join(SCRATCH, `react.${task}.r1`);
  fs.cpSync(reactTpl, dir, { recursive: true });
  fs.rmSync(path.join(dir, "src"), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  console.log(`ready: ${path.relative(ROOT, dir)} (react)`);
}
fs.rmSync(reactTpl, { recursive: true, force: true });
