#!/usr/bin/env node
/**
 * docs-numbers.mjs — 对外数字单一生成源（2026-09-06 锐评整改③：数字漂移是最致命的自证反例）。
 *
 * README.md / AGENTS.md 中的用例数与工具数不再手写——改为生成标记位：
 *   <!--@num:tests-->117<!--@/-->   ← 框架 vitest passed 数（实跑测试套件取得）
 *   <!--@num:tools-->25<!--@/-->    ← mcp-definitions.json tools[].length
 *
 *   node atelier/scripts/docs-numbers.mjs check   # 标记位与真值不符 → exit 1（CI/门禁用）
 *   node atelier/scripts/docs-numbers.mjs sync    # 以真值重写标记位（改测试面/工具面后跑一次）
 *
 * 诚实边界：性能数字依赖浏览器实测（atelier bench），无法在此生成——仍以 README 性能表为
 * 唯一口径、ROADMAP §2 为历史基线（人工纪律，见 AGENTS.md 维护纪律）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", ".."); // 仓库根
const TARGETS = [path.join(ROOT, "README.md"), path.join(ROOT, "AGENTS.md")];
const MARK = /<!--@num:(tests|tools)-->(\d+)<!--@\/-->/g;

function computeNumbers() {
  // tools：mcp-definitions 单源
  const defs = JSON.parse(fs.readFileSync(path.join(ROOT, "atelier", "mcp", "mcp-definitions.json"), "utf8"));
  const tools = defs.tools.length;
  // tests：实跑框架测试套件，取 passed 数（"N passed | M skipped (T)"）
  const cwd = path.join(ROOT, "atelier");
  const run = (cmd) =>
    process.platform === "win32"
      ? spawnSync(`${cmd} test`, { cwd, encoding: "utf8", shell: true })
      : spawnSync(cmd, ["test"], { cwd, encoding: "utf8" });
  let r = run("pnpm");
  if (r.error && r.error.code === "ENOENT") r = run("npm");
  if (r.status !== 0) {
    console.error("error: 测试套件红——数字校验没有意义，先修测试");
    process.exit(1);
  }
  // "Test Files 13 passed" 在前——锚定 "Tests" 摘要行取用例数；vitest 输出带 ANSI 码，先剥离
  const plain = `${r.stdout}\n${r.stderr}`.replace(/\x1B\[[0-9;]*m/g, "");
  const m = /\bTests\s+(\d+)\s+passed/.exec(plain);
  if (!m) {
    console.error("error: 无法从测试输出解析 passed 数（vitest 摘要格式变更？）");
    process.exit(1);
  }
  return { tests: Number(m[1]), tools };
}

function apply(text, nums) {
  return text.replace(MARK, (_all, key) => `<!--@num:${key}-->${nums[key]}<!--@/-->`);
}

const mode = process.argv[2] ?? "check";
if (mode !== "check" && mode !== "sync") {
  console.error("usage: docs-numbers.mjs check|sync");
  process.exit(2);
}
const nums = computeNumbers();
let drift = 0;
for (const file of TARGETS) {
  const before = fs.readFileSync(file, "utf8");
  if (!MARK.test(before)) {
    console.error(`error: ${path.relative(ROOT, file)} 无数字标记位——请用 <!--@num:tests|tools-->N<!--/@--> 标注对外数字`);
    drift++;
    continue;
  }
  MARK.lastIndex = 0;
  const after = apply(before, nums);
  if (after !== before) {
    if (mode === "sync") {
      fs.writeFileSync(file, after);
      console.log(`[docs-numbers] sync ${path.relative(ROOT, file)}`);
    } else {
      console.error(`drift: ${path.relative(ROOT, file)} 数字与真值不符（真值 tests=${nums.tests} tools=${nums.tools}）——跑 sync 或修文档`);
      drift++;
    }
  }
}
if (mode === "check") console.log(`[docs-numbers] check ${drift === 0 ? "PASS" : "FAIL"} (tests=${nums.tests} tools=${nums.tools})`);
else console.log(`[docs-numbers] sync done (tests=${nums.tests} tools=${nums.tools})`);
process.exit(drift === 0 ? 0 : 1);
