#!/usr/bin/env node
/**
 * negative-check.mjs — M3-FS 评分器负控前置门（FS-10 执行半；m3 negative-check.mjs 同门 upgraded）。
 *
 * 正控（参考解 grade 全 PASS）只证明"对的东西能给过"；负控（本脚本）证明"错的东西抓得住"。
 * harness/fixtures/negative/<NNN-taskN-变异名>/ 每枚 = 一个目录：
 *   manifest.json   { task, expectedFailIds, note }——task ∈ 三任务 id；expectedFailIds = 逐字
 *                   brief 判据编号（含**已记录的级联**——单一变异在完整评分面上的全部失败编号，
 *                   校准记录见各 note 与仓库提交信息）
 *   其余文件        按 app 根相对路径摆放的变异覆盖文件（套到基线副本上）
 *
 * 逐枚流程：取对应基线（task1/2 → --baseline；task3 → --baseline-task3 种子缺陷变体）→
 * 复制应用（node_modules 由 pnpm 离线装回，warm store 秒级）→ 套覆盖文件 → `migrate up`
 * （**容错跑**——负控 001/003 的 up 被拒/失败正是变异的真实现场，库停在 001 属预期）→
 * 跑 grade.mjs → 断言：
 *   ① grade.ok === false（错被抓）；
 *   ② **无 grade.error 位**（评分基础设施零故障——崩溃假红不计数，按漏判处理）；
 *   ③ 实际失败判据 id 集合（任一 check 行 fail 即该 id 未过——复合判据 S/T 拆行语义）
 *      与 expectedFailIds **恰好相等**（少抓 = 判别力缺口；多抓 = 评分器误伤，两者都算漏）。
 * 全抓到 exit 0；任何漏判/假红 exit 1。
 *
 * 用法（出数前置，RUNBOOK §5：正控全 PASS + 本脚本全抓，缺一不得出数）：
 *   node atelier/benchmarks/m3-fs/negative-check.mjs \
 *     --baseline <已装配基线应用目录> --baseline-task3 <task3 缺陷变体目录> [--work <临时工作根>]
 *
 * 说明：grade.mjs 本身不依赖 baseline 目录（判据只对 attempt 取证）；需要基线的是本脚本——
 * 负控是"对已知正确基线做单一变异"，基线目录必须与实验 setup 脚本产物同源（协议 §2 逐字节
 * 复现纪律）。--work 缺省用系统临时目录。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const NEG_DIR = path.join(HERE, "harness", "fixtures", "negative");
const GRADE = path.join(HERE, "grade.mjs");
const ATELIER = path.resolve(HERE, "..", ".."); // atelier/（migrate CLI 与离线 install 的上下文）

const TASK3 = "task3-fullstack-rescue";

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const baseline = path.resolve(argOf("--baseline") ?? "");
const baselineTask3 = path.resolve(argOf("--baseline-task3") ?? "");
const workRoot = path.resolve(argOf("--work") ?? fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-negative-")));
if (!fs.existsSync(baseline)) die("--baseline <已装配基线应用目录> 必填（task1/task2 负控的底座）");
if (!fs.existsSync(baselineTask3)) die("--baseline-task3 <task3 缺陷变体目录> 必填（006 的底座）", "task3 变体 = setup 注入缺陷后的基线（002 已应用、down 缺失）");

/** 复制基线应用并离线装回 node_modules（junction 会触发 pnpm verify-deps 拒跑——用真装） */
function copyApp(src, name) {
  const dst = path.join(workRoot, name);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      return rel === "" || rel.split(path.sep)[0] !== "node_modules";
    },
  });
  const r = spawnSync("pnpm", ["install", "--offline", "--prefer-offline"], {
    cwd: dst,
    encoding: "utf8",
    timeout: 180000,
    shell: process.platform === "win32",
  });
  if (r.status !== 0) die(`副本 ${name} 的 pnpm install 失败（warm store 缺失？先在基线跑一次 pnpm install）：${(r.stderr || r.stdout || "").slice(0, 300)}`);
  return dst;
}

/** 容错跑 migrate up——负控的 up 失败是变异现场，不是脚本错误 */
function migrateUpBestEffort(appDir) {
  return spawnSync(process.execPath, [path.join(ATELIER, "cli.mjs"), "migrate", "up", "--root", appDir], {
    encoding: "utf8",
    timeout: 120000,
    shell: process.platform === "win32",
  });
}

const fixtures = fs
  .readdirSync(NEG_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
if (fixtures.length === 0) die(`无负控 fixture：${NEG_DIR}`, "至少装配 5 枚（RUNBOOK §5）");

console.log(`[m3fs-negative] ${fixtures.length} 枚负控，评分器必须全数抓住（且失败判据集与 manifest 恰好一致）：`);
const missed = [];
for (const name of fixtures) {
  const dir = path.join(NEG_DIR, name);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    console.error(`  ✘ ${name} — manifest.json 不可读：${e.message}`);
    missed.push(name);
    continue;
  }
  const { task, expectedFailIds, note } = manifest;
  if (!task || !Array.isArray(expectedFailIds) || expectedFailIds.length === 0) {
    console.error(`  ✘ ${name} — manifest 缺 task / expectedFailIds`);
    missed.push(name);
    continue;
  }

  // ① 底座副本 + 覆盖文件 + 库态复现
  let app;
  try {
    app = copyApp(task === TASK3 ? baselineTask3 : baseline, name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "manifest.json") continue;
      const src = path.join(dir, entry.name);
      const dst = path.join(app, entry.name);
      if (entry.isDirectory()) fs.cpSync(src, dst, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
    migrateUpBestEffort(app);
  } catch (e) {
    console.error(`  ✘ ${name} — 装配失败（脚本错误，非判据）：${e.message}`);
    missed.push(name);
    continue;
  }

  // ② 评分
  const gradeFile = path.join(app, "m3fs-grade.json");
  const r = spawnSync(process.execPath, [GRADE, "--task", task, "--attempt", app], {
    encoding: "utf8",
    timeout: 600000,
    shell: process.platform === "win32",
  });
  let grade = null;
  try {
    grade = JSON.parse(fs.readFileSync(gradeFile, "utf8"));
  } catch {
    grade = null;
  }
  if (!grade) {
    console.error(`  ✘ ${name} — grade 未产出结果（基础设施故障，假红不计）：exit ${r.status}`);
    missed.push(name);
    continue;
  }
  if (grade.error) {
    console.error(`  ✘ ${name} — grade 携带基础设施错误位（崩溃假红不计）：${grade.error}`);
    missed.push(name);
    continue;
  }

  // ③ 判定：ok=false 且失败 id 集与期望恰好一致
  const failedIds = [...new Set((grade.checks ?? []).filter((c) => c.pass === false).map((c) => c.id))].sort();
  const expected = [...expectedFailIds].sort();
  const same = grade.ok === false && failedIds.length === expected.length && failedIds.every((id, i) => id === expected[i]);
  if (same) {
    console.log(`  ✔ ${name} — 抓住（失败集 = ${failedIds.join(", ")}）`);
  } else {
    console.error(`  ✘ ${name} — 漏判/误伤：期望 [${expected.join(", ")}] 实际 [${failedIds.join(", ")}] ok=${grade.ok} —— ${note ?? ""}`);
    missed.push(name);
  }
}

console.log(`[m3fs-negative] ${fixtures.length - missed.length}/${fixtures.length} 抓住；${missed.length} 漏`);
if (missed.length === 0) {
  console.log("[m3fs-negative] 负控前置门 PASS——正控证明对的能给过，本门证明错的抓得住。");
} else {
  console.error(`[m3fs-negative] 负控前置门 FAIL（${missed.join(", ")}）——未过不得出数（RUNBOOK §5）。`);
  process.exit(1);
}
