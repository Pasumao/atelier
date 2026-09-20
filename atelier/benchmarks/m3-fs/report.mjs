#!/usr/bin/env node
/**
 * report.mjs — M3-FS 出数：汇总 results/runs.json → 三臂首遍正确率 + §6 判定（协议口径）。
 *
 *   node atelier/benchmarks/m3-fs/report.mjs --results atelier/benchmarks/m3-fs/results/runs.json [--tier pilot|formal]
 *
 * runs.json schema（由跑批者按 run **只追加不改写**；对照臂臂名固定 `next`，D-F21）：
 *   { "runs": [ { "arm": "noskill|skill|next", "task": "task1-column-change|task2-live-reconcile|task3-fullstack-rescue",
 *                 "run": 1, "firstPass": true, "attempts": 1 } ] }
 *
 * §6 判据（protocol，D-F22 已采纳：相对主 + 绝对副，两判据都报）：
 *   主判据（相对口径）：skill − next 首遍正确率 ≥ +15pt，以加难层（task3）为准；
 *   副判据（绝对口径）：skill 首遍正确率（全任务合计）≥ 60%；
 *   每格 n<5 → 判定 N/A——数据不足，诚实出数前不写结论（§4.4：pilot 数据禁止进结论段）；
 *   三臂全平的唯一合法解读 = "任务层无区分力"（禁止反推框架/技能无用）。
 *
 * 强制口径（§4.4）：一切正确率引用必带 "FORMAL n=5/cell、Wilson 区间宽于判据间距，
 * 方向性参考而非定论" 限定语——本脚本输出固定携带；--tier pilot|formal 档位标注
 * （缺省 pilot——禁止拿 pilot 当卖点，档位必须显式可见）。
 */
import fs from "node:fs";

const ARMS = ["noskill", "skill", "next"];
const TASKS = ["task1-column-change", "task2-live-reconcile", "task3-fullstack-rescue"];
const ATTEMPTS_CAP = 3; // 达到 ok 所需 attempt 数上限封顶（RUNBOOK §0）

const argv = process.argv.slice(2);
const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const file = argOf("--results");
const tier = argOf("--tier") ?? "pilot";
if (!file || !fs.existsSync(file)) {
  console.error("error: --results <file> 必填（schema 见本文件头注）");
  process.exit(2);
}
if (!["pilot", "formal"].includes(tier)) {
  console.error("error: --tier 只接受 pilot | formal");
  process.exit(2);
}

// BOM 容忍（windows-enc）：PS5.1 Set-Content -Encoding UTF8 会带 BOM，JSON.parse 会炸
const { runs } = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

/* ---- 逐条校验（只追加的台账也必须是合法记录——静默吞坏行 = 台账腐烂） ---- */
const bad = [];
runs.forEach((r, i) => {
  if (!ARMS.includes(r.arm)) bad.push(`runs[${i}].arm 非法：${JSON.stringify(r.arm)}（∈ ${ARMS.join("|")}）`);
  if (!TASKS.includes(r.task)) bad.push(`runs[${i}].task 非法：${JSON.stringify(r.task)}`);
  if (!Number.isInteger(r.run) || r.run < 1) bad.push(`runs[${i}].run 非法：${JSON.stringify(r.run)}`);
  if (typeof r.firstPass !== "boolean") bad.push(`runs[${i}].firstPass 必须是 boolean`);
  if (!Number.isInteger(r.attempts) || r.attempts < 1 || r.attempts > ATTEMPTS_CAP) {
    bad.push(`runs[${i}].attempts 非法：${JSON.stringify(r.attempts)}（1..${ATTEMPTS_CAP} 封顶）`);
  }
});
if (bad.length > 0) {
  console.error("error: runs.json 存在非法记录（只追加 ≠ 不校验）：");
  for (const b of bad) console.error(`  · ${b}`);
  process.exit(1);
}

/* ---- 出数：每臂全任务合计 + 逐任务 ---- */
const rate = (rs) => (rs.length ? Math.round((rs.filter((r) => r.firstPass).length / rs.length) * 1000) / 10 : null);
const armStats = Object.fromEntries(
  ARMS.map((a) => {
    const rs = runs.filter((r) => r.arm === a);
    return [a, {
      n: rs.length,
      firstPass: rate(rs),
      perTask: Object.fromEntries(TASKS.map((t) => [t, { n: rs.filter((r) => r.task === t).length, firstPass: rate(rs.filter((r) => r.task === t)) }])),
    }];
  }),
);

const fmt = (v) => (v === null ? "n/a" : `${v}%`);
console.log(`M3-FS 出数报告（tier=${tier}）—— runs=${runs.length}`);
console.log("");
console.log("臂        runs  firstPass(合计)   " + TASKS.map((t) => `${t.replace("-column-change", "").replace("-live-reconcile", "").replace("-fullstack-rescue", "")} n/%`).join("   "));
for (const a of ARMS) {
  const s = armStats[a];
  const per = TASKS.map((t) => `${s.perTask[t].n}/${fmt(s.perTask[t].firstPass)}`).join("   ");
  console.log(`${a.padEnd(8)}  ${String(s.n).padStart(4)}  ${fmt(s.firstPass).padStart(12)}   ${per}`);
}
console.log("");
for (const t of TASKS) {
  const line = TASKS.map((tt) => ARMS.map((a) => `${a}:${armStats[a].perTask[tt].n}/${fmt(armStats[a].perTask[tt].firstPass)}`).join("  ")).join(" | ");
  console.log(`  ${t}: ${line}`);
}
console.log("");

/* ---- §6 判定 ---- */
const minN = Math.min(...ARMS.map((a) => armStats[a].n));
const skillAll = armStats.skill.firstPass;
const skillT3 = armStats.skill.perTask["task3-fullstack-rescue"].firstPass;
const nextT3 = armStats.next.perTask["task3-fullstack-rescue"].firstPass;
const gapT3 = skillT3 !== null && nextT3 !== null ? Math.round((skillT3 - nextT3) * 10) / 10 : null;

const allFlat = ARMS.every((a) => armStats[a].firstPass === 100);
let verdict;
if (minN < 5 || skillAll === null || skillT3 === null || nextT3 === null) {
  verdict = `N/A — 数据不足（协议要求每格 ≥5 runs；当前 min n=${minN}）。诚实出数前不写结论。`;
} else {
  const parts = [];
  parts.push(gapT3 >= 15 ? `主判据 PASS（相对口径：skill − next 于 task3 = +${gapT3}pt ≥ +15pt）` : `主判据 FAIL（相对口径：skill − next 于 task3 = ${gapT3 >= 0 ? "+" : ""}${gapT3}pt < +15pt）`);
  parts.push(skillAll >= 60 ? `副判据 PASS（绝对口径：skill 首遍合计 ${fmt(skillAll)} ≥ 60%）` : `副判据 FAIL（绝对口径：skill 首遍合计 ${fmt(skillAll)} < 60%）`);
  if (allFlat) parts.push("三臂全平——唯一合法解读：任务层无区分力（先加难任务层再出正式数，禁止反推框架/技能无用）");
  const bothPass = gapT3 >= 15 && skillAll >= 60;
  verdict = `§6 判定（相对为主、两判据都报）：${bothPass ? "PASS — " : "双不达或部分不达 — "}${parts.join("；")}。${bothPass ? "" : "双不达 → 假设降级，路线图向工具链/编译倾斜（protocol §6）；"}`;
}

console.log(verdict);
console.log("");
console.log(
  "限定语（强制引用口径）：FORMAL n=5/cell、Wilson 区间宽于判据间距，方向性参考而非定论。" +
    (tier === "pilot" ? "当前档位=pilot：n<5 的数据禁止进结论段（protocol §3.3/§4.4）。" : "当前档位=formal：引用仍须携带本限定语。"),
);
