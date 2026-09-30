/**
 * cli-die.test.ts — 建议书 A5（§4.4 P1-9 / P1-10 + die 签名大一统）验收。
 *
 * 背景（建议书 §6 根因 2）：全仓 cli.mjs + scripts/ 共 10 份 die、三种签名——
 *   ① cli.mjs / api-diff.mjs：die(msg, code = 2)                 ← 统一基准
 *   ② build / call / migrate：die(msg, code = 2, fix)
 *   ③ checkpoint.mjs：die(code, message, fix)（参数序相反）
 *   ④ bench / snapshot-smoke / tokens-dtcg / sync-project：die(message, fix)（固定 exit 1）
 * 已直接产出 P1-9：cli.mjs:288 把 fix 文案传进 exit code 位 → process.exit(字符串)
 * 抛 ERR_INVALID_ARG_TYPE，fix 永不显示、退出码语义错（红检：exit 1 + 崩栈）。
 *
 * 统一后契约（本文件逐条钉死）：
 *   签名 = die(msg, code = 2)——msg 单串自含 error:/usage/fix 全部文案（fix 以 "\nfix: " 并入），
 *   code 显式传（usage=2 / 门禁失败=1），全仓十份 die 签名一致、checkpoint 参数序不再相反；
 *   bench / snapshot-smoke 的 die 改 throw（DieExit）——失败路径先过 finally 清理再 exit 非零
 *   （P1-10：原 process.exit 直接跳 finally，失败 bench 留孤儿 dev server 占 strictPort 5199、
 *   smoke 泄漏 5173 与 mkdtemp 临时目录）。
 *
 * 验收面（全部 spawn 真实脚本子进程——die 都在脚本装配面，进程级行为才是被验语义）：
 *   P1-9 红检：`atelier test` 于无 package.json 目录 → exit 2 + error/fix 两行齐 + 无 ERR_INVALID_ARG_TYPE；
 *   P1-9 孪生表征：`atelier dev` 同场景（cli.mjs:148 已修款）→ exit 2 + fix 指路，行为锁定不回退；
 *   P1-10 红检：snapshot-smoke 第一步 init 被注钩强制失败 → exit 1 + stderr 报因 + os.tmpdir()
 *     零 atelier-snapshot-smoke-* 残留（修复前 finally 被跳过 → 目录泄漏，红证见提交前探针）；
 *   die 统一表征 ×8：bench / checkpoint(save|rollback) / tokens-dtcg / migrate / call / build /
 *     sync-project / api-diff 的 die 路径——exit 码与 error/usage/fix 文案逐条锁定
 *     （尤其 checkpoint：参数序翻转重构后输出必须字节级同形，防二次引入 P1-9 同款）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");
const SCRIPT = (f: string) => path.join(PKG, "scripts", f);

const tmpDirs: string[] = [];
afterAll(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** 无 package.json 的空目录（P1-9 场景：在应用目录之外跑 atelier test/dev） */
function emptyDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** 跑真实脚本子进程（die 全部在脚本装配面——进程级 exit code/输出即被验契约） */
function run(file: string, args: string[], opts: { env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("建议书 A5：die 契约（P1-9 修复 + 全仓签名大一统 + P1-10 finally 清理）", () => {
  it(
    "P1-9（红检）：atelier test 在无 package.json 目录 → exit 2 + error/fix 两行齐 + 无 ERR_INVALID_ARG_TYPE 崩栈",
    () => {
      const dir = emptyDir("atelier-die-test-");
      const p = spawnSync(process.execPath, [CLI, "test"], { encoding: "utf8", windowsHide: true, cwd: dir });
      expect(p.status).toBe(2); // usage 级（修复前：ERR_INVALID_ARG_TYPE 未捕获 → exit 1）
      expect(p.stderr ?? "").toContain("error: no package.json here");
      expect(p.stderr ?? "").toContain("fix: run inside an Atelier app dir"); // 修复前：永不显示
      expect(p.stderr ?? "").not.toContain("ERR_INVALID_ARG_TYPE"); // 修复前：崩栈即红
    },
  );

  it("P1-9 孪生表征：atelier dev 同场景 → exit 2 + fix 指路（cli.mjs 已修款行为锁定不回退）", () => {
    const dir = emptyDir("atelier-die-dev-");
    const p = spawnSync(process.execPath, [CLI, "dev"], { encoding: "utf8", windowsHide: true, cwd: dir });
    expect(p.status).toBe(2);
    expect(p.stderr ?? "").toContain("error: no dev script here");
    expect(p.stderr ?? "").toContain("fix: run inside an Atelier app dir");
  });

  it(
    "P1-10（红检）：snapshot-smoke 第一步 init 强制失败 → exit 1 + stderr 报因 + tmpdir 零快照烟测目录残留",
    () => {
      // 预载钩：把本子进程的第一次 spawnSync（= 第 [1/5] 步 init）强制为失败——脚本即刻走 die，
      // 不触 pnpm/dev 面（<1s）。 die 若直接 process.exit（修复前），finally 的 rmSync 被跳过 → 泄漏。
      const hook = path.join(os.tmpdir(), `atelier-die-hook-${Date.now()}-${process.pid}.cjs`);
      fs.writeFileSync(
        hook,
        [
          "const cp = require('node:child_process');",
          "const orig = cp.spawnSync;",
          "let forced = false;",
          "cp.spawnSync = function (...args) {",
          "  if (!forced) { forced = true; return { status: 1, stdout: '', stderr: 'forced-failure-for-die-probe' }; }",
          "  return orig.apply(this, args);",
          "};",
        ].join("\n"),
        "utf8",
      );
      try {
        const smokeDir = (d: string) => fs.readdirSync(d).filter((n) => n.startsWith("atelier-snapshot-smoke-"));
        const before = smokeDir(os.tmpdir());
        // NODE_OPTIONS 的引号解析会把反斜杠当转义——Windows 路径统一换正斜杠（node --require 两相兼容）
        const r = run(SCRIPT("snapshot-smoke.mjs"), [], { env: { NODE_OPTIONS: `--require "${hook.replace(/\\/g, "/")}"` } });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("error: init failed");
        expect(r.stderr).toContain("forced-failure-for-die-probe");
        const after = smokeDir(os.tmpdir());
        expect(after.length).toBe(before.length); // 修复前：+1（finally 被跳过，mkdtemp 目录泄漏）
        expect(after).toEqual(before);
      } finally {
        fs.rmSync(hook, { force: true });
        // 红跑遗留的自证清理（修复后此 glob 无新增，勿伤并行测试的活目录——只清本钩跑点之前已存在判断），
        // 保守起见：不删任何 atelier-snapshot-smoke-*（红跑泄漏目录由探针阶段人工清理，测试自身零副作用）
      }
    },
  );

  it("die 统一表征 × bench：--app 坏目录 → exit 1 + error/fix 两行 + 无崩栈（try 外 die 行为不变）", () => {
    const dir = emptyDir("atelier-die-bench-");
    const r = run(SCRIPT("bench.mjs"), ["--app", dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`error: no app at ${dir}`);
    expect(r.stderr).toContain("fix: pass an init'd Atelier app (--app <dir>)");
    expect(r.stderr).not.toContain("ERR_INVALID_ARG_TYPE");
    expect(r.stderr).not.toContain("at die ("); // die 统一后不吐内部栈
  });

  it("die 统一表征 × checkpoint：save/rollback 缺参 → exit 1 + usage + fix 行（参数序翻转后输出同形）", () => {
    const save = run(SCRIPT("checkpoint.mjs"), ["save"]);
    expect(save.status).toBe(1);
    expect(save.stderr).toContain("usage: checkpoint save <name> [--no-gate] [--db <file>] [--json]");
    expect(save.stderr).toContain('fix: e.g. atelier checkpoint save "AI round 4: added ModelCard"');

    const rb = run(SCRIPT("checkpoint.mjs"), ["rollback"]);
    expect(rb.status).toBe(1);
    expect(rb.stderr).toContain("usage: checkpoint rollback <id> [--db <file>]");
    expect(rb.stderr).toContain("fix: pick an id from: atelier checkpoint list");
  });

  it("die 统一表征 × tokens-dtcg：缺子命令/缺必填 → exit 1 + usage(或 error)/fix 行", () => {
    const usage = run(SCRIPT("tokens-dtcg.mjs"), []);
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain("usage: atelier tokens export|import --in <file> --out <file>");
    expect(usage.stderr).toContain("fix: export: atelier.config.json → DTCG");

    const noIn = run(SCRIPT("tokens-dtcg.mjs"), ["export"]);
    expect(noIn.status).toBe(1);
    expect(noIn.stderr).toContain("error: --in is required");
    expect(noIn.stderr).toContain("fix: 传 atelier.config.json（export）或 .tokens.json（import）");
  });

  it("die 统一表征 × migrate/call/build：usage 级 → exit 2（统一默认码）", () => {
    const m = run(SCRIPT("migrate.mjs"), ["bogus"]);
    expect(m.status).toBe(2);
    expect(m.stderr).toContain("usage: atelier migrate status|up|down|verify|seed");

    const c = run(SCRIPT("call.mjs"), []);
    expect(c.status).toBe(2);
    expect(c.stderr).toContain("usage: atelier call <endpoint>");

    const b = run(SCRIPT("build.mjs"), []);
    expect(b.status).toBe(2);
    expect(b.stderr).toContain("usage: atelier build --root <dir> --target=node|bun");
  });

  it("die 统一表征 × sync-project：非应用目录 → exit 1 + error/fix 两行", () => {
    const dir = emptyDir("atelier-die-sync-");
    const r = run(SCRIPT("sync-project.mjs"), ["--target", dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`error: not an Atelier app (missing src/runtime at ${dir})`);
    expect(r.stderr).toContain("fix: run inside the app dir, or pass --target <appDir>");
  });

  it("die 统一表征 × api-diff：check 缺 baseline → exit 2（原生 (msg, code) 款不变）", () => {
    const dir = emptyDir("atelier-die-apidiff-");
    const r = run(SCRIPT("api-diff.mjs"), ["check", "--root", dir]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("缺 baseline");
    expect(r.stderr).toContain("api-diff snapshot");
  });
});

/* ---------------- P-C 支（第三遍架构复校 §2.3/§3 拉入）：缺值守卫与旗标透传 ----------------
 * P2-C1：`atelier review --target` 缺值 → path.resolve(undefined) 裸 TypeError 崩栈
 *   （cli.mjs:213 实测复现；init 分支 :148-153 有完整守卫先例）；flag 当值（--target --open）
 *   同守卫。P-C#13：`sync --target` 缺值同款（sync-project.mjs:45 实测复现）。
 * P2-C2：`atelier struct --json`（map 可省略，HELP:45 明示）——argv[2] 以 -- 开头被 struct.mjs
 *   当子命令 → usage 误红 exit 2。 */
describe("P-C 支：CLI 缺值守卫与旗标透传（review / struct / sync 三件）", () => {
  it("P2-C1 红检：review --target 缺值 → die 2 usage，不崩栈", () => {
    const dir = emptyDir("atelier-review-notarget-");
    const r = spawnSync(process.execPath, [CLI, "review", "--target"], { encoding: "utf8", windowsHide: true, cwd: dir });
    expect(r.status).toBe(2); // 修复前：path.resolve(undefined) TypeError → exit 1 + 崩栈
    expect(r.stderr).toContain("usage: atelier review");
    expect(r.stderr).not.toContain("TypeError"); // 崩栈即红
  });

  it("P2-C1 红检：review --target --open（flag 当值）→ 同守卫 die 2", () => {
    const dir = emptyDir("atelier-review-flagval-");
    const r = spawnSync(process.execPath, [CLI, "review", "--target", "--open"], { encoding: "utf8", windowsHide: true, cwd: dir });
    expect(r.status).toBe(2); // 修复前：把 "--open" 当目录名解析 → no dev token exit 1（指错方向）
    expect(r.stderr).toContain("usage: atelier review");
    expect(r.stderr).not.toContain("TypeError");
  });

  it("P-C#13 红检：sync-project --target 缺值 → die 2 usage，不崩栈；flag 当值同守卫", () => {
    const dir = emptyDir("atelier-sync-notarget-");
    const missing = run(SCRIPT("sync-project.mjs"), ["--target"], { env: {} });
    expect(missing.status).toBe(2); // 修复前：path.resolve(undefined) TypeError → exit 1 + 崩栈
    expect(missing.stderr).toContain("usage: atelier sync");
    expect(missing.stderr).not.toContain("TypeError");
    // 同步检查 cwd 无关性：脚本无 --root 概念，tmp cwd 下同样应 die 2（守卫先于 existsSync 探测）
    const flagAsValue = spawnSync(process.execPath, [SCRIPT("sync-project.mjs"), "--target", "--json"], {
      encoding: "utf8", windowsHide: true, cwd: dir,
    });
    expect(flagAsValue.status).toBe(2); // 修复前："--json" 被当目录名 → not an Atelier app exit 1
    expect(flagAsValue.stderr).toContain("usage: atelier sync");
  });

  it("P2-C2 红检：struct --json（无子命令，map 可省略）→ 正常执行不 usage 红", () => {
    const dir = emptyDir("atelier-struct-json-");
    const r = spawnSync(process.execPath, [CLI, "struct", "--json"], { encoding: "utf8", windowsHide: true, cwd: dir });
    expect(r.status).toBe(0); // 修复前：argv[2]="--json" 落 default → usage exit 2
    expect(r.stderr).not.toContain("usage: struct");
    // --json 旗标必须真生效（修复后不得静默退化成人类可读 map）。裸调用（子命令缺省）在 JSON 后
    // 还会追加既有的人读 gate 行（struct 既有输出形状，本支不碰）——取最后一个 } 前的 JSON 体解析。
    const out = JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf("}") + 1));
    expect(out.modelVersion).toBeDefined();
  });
});

/* ================= REL-A A6：cli 结构自检（STUB 面一致性） ================= */

describe("REL-A A6 cli 结构自检：STUB 分支集 ⊆ STUB_NOTES 键集 + stub 块无死分支", () => {
  const src = fs.readFileSync(CLI, "utf8");
  const notesBody = src.match(/const STUB_NOTES = \{([\s\S]*?)\};/)?.[1] ?? "";
  const keys = [...notesBody.matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
  // 锚定到 stub 组头段（stub 注释 → 组体首个 `{` 之间），只取落入 stub 处理块的 fallthrough 标签。
  // 评审 N1 教训：旧版精确匹配单行注释全文 + 切片到文件尾——注释一改多行即 indexOf=-1 空转绿；
  // 故锚用前缀、域用头段，并在用例内对解析面做 toEqual 健全性断言，解析失配时显式红而非静默空转。
  const stubStart = src.indexOf("/* ---------- stubs");
  const stubHeader = src.slice(stubStart, src.indexOf("{", stubStart));
  const stubCases = [...stubHeader.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);

  it("STUB 分支集 ⊆ STUB_NOTES 键集（缺键 = 一旦重排触达该分支即迭代 undefined TypeError 崩栈）", () => {
    expect(keys, "STUB_NOTES 键集解析面 sanity").toEqual(expect.arrayContaining(["package", "e2e", "lint"]));
    expect(stubCases, "stub 组头段解析面 sanity（失配 = 结构自检空转，先红于此）").toEqual(["package", "e2e", "lint"]);
    for (const c of stubCases) {
      expect(keys, `stub case "${c}" 缺 STUB_NOTES 键（红态：A6——case "review" 在 stub 块内而 STUB_NOTES 无 review 键）`).toContain(c);
    }
  });

  it("stub 块无死分支：review 已是 MINI 实装（前置 case 命中并 break），stub 块不得再收留 review", () => {
    expect(stubCases, "红态：A6——stub 块内 case \"review\" 不可达死分支").not.toContain("review");
  });
});
