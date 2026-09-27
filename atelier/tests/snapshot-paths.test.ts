/**
 * snapshot-paths.test.ts — m10 批 C：真实浏览器测试转正（候选池销账）——per-platform 基线
 * 路径解析纯函数 + snapshot.mjs/checkpoint.mjs 双文件同源机检 + main-module 守卫。
 * 纪律：先红后绿（红检证据记入提交信息），禁止先写实现。
 *
 * 红检口径（实现前实测，2026-09-27）：scripts/snapshot.mjs 是纯 CLI 脚本（顶层直接跑
 * process.argv 分派，import 即执行 CLI 体且会 process.exit）——无任何可导出纯函数，
 * import 即炸（或杀掉 vitest 进程）→ 本文件全部用例红。checkpoint.mjs 快照门自建
 * ".atr/snapshots/baseline.png" 路径构造（与 snapshot.mjs 双文件重复）→ 同源机检红。
 *
 * 语义保命线（实现须保持）：check --update 人工显式晋升；绝不自动晋升；gate 阶梯
 * （无基线→vacuous / dev 不可达→vacuous / MISMATCH→die 1）不变；receipt schema 不变。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baselineFullPathFor,
  baselinePathFor,
  currentFullPathFor,
  currentPathFor,
  legacyBaselinePath,
  platformKey,
  resolveBaseline,
  snapshotsDir,
  sourceFingerprint,
} from "../scripts/snapshot.mjs";

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-snap-paths-"));

describe("m10 批 C：per-platform 基线路径解析（纯函数，显式 platform 跨平台确定性）", () => {
  it("路径形状：.atr/snapshots/<platform>/baseline.png（current 同目录）", () => {
    const root = tmpRoot();
    try {
      expect(platformKey("win32")).toBe("win32");
      expect(platformKey("linux")).toBe("linux");
      expect(baselinePathFor(root, "linux")).toBe(path.join(root, ".atr", "snapshots", "linux", "baseline.png"));
      expect(baselinePathFor(root, "win32")).toBe(path.join(root, ".atr", "snapshots", "win32", "baseline.png"));
      expect(currentPathFor(root, "linux")).toBe(path.join(root, ".atr", "snapshots", "linux", "current.png"));
      expect(snapshotsDir(root, "darwin")).toBe(path.join(root, ".atr", "snapshots", "darwin"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolveBaseline：平台基线存在 → 胜出（legacy: false）；仅旧布局存在 → 回退读（legacy: true）；都缺 → missing", () => {
    const root = tmpRoot();
    try {
      // 都缺
      const none = resolveBaseline(root, "linux");
      expect(none.missing, "无任何基线 → missing 标记（gate 阶梯的 vacuous 输入）").toBe(true);
      // 仅旧布局
      fs.mkdirSync(path.join(root, ".atr", "snapshots"), { recursive: true });
      fs.writeFileSync(legacyBaselinePath(root), "legacy-png");
      const legacy = resolveBaseline(root, "linux");
      expect(legacy.legacy, "旧布局回退读（绝不自动迁移）").toBe(true);
      expect(legacy.path).toBe(legacyBaselinePath(root));
      // 平台基线落位后胜出
      fs.mkdirSync(path.join(root, ".atr", "snapshots", "linux"), { recursive: true });
      fs.writeFileSync(baselinePathFor(root, "linux"), "platform-png");
      const platform = resolveBaseline(root, "linux");
      expect(platform.legacy, "平台基线存在即胜出").toBe(false);
      expect(platform.path).toBe(baselinePathFor(root, "linux"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("main-module 守卫：import snapshot.mjs 不触发 CLI 体（本文件 import 成功且进程未退出即证）+ 形态机检钉", () => {
    const src = fs.readFileSync(new URL("../scripts/snapshot.mjs", import.meta.url), "utf8");
    expect(src).toContain("import.meta.url === pathToFileURL(process.argv[1]");
    expect(src).toContain("export function baselinePathFor");
    expect(src).toContain("export function resolveBaseline");
  });

  it("双文件同源机检：checkpoint.mjs 消费 snapshot.mjs 导出（路径构造不再双写）", () => {
    const ck = fs.readFileSync(new URL("../scripts/checkpoint.mjs", import.meta.url), "utf8");
    expect(ck).toContain('from "./snapshot.mjs"');
    expect(ck, "checkpoint.mjs 不再自建基线路径（回退语义收口在 resolveBaseline）").not.toContain('"baseline.png"');
  });
});

/* ---- m11 批 C：快照门全页捕获变体（候选池「快照门首屏盲区」销账）----
 * 红检口径（实现前实测）：snapshot.mjs 无 full 变体路径导出（import 即红）；
 * dev-screenshot.mjs 捕获无 captureBeyondViewport（视口外不可见=首屏盲区事实）；
 * dev 插件 compare 基线写死平铺 .atr/snapshots/baseline.png（m10 per-platform 遗留不一致）。
 * 语义保命线：默认变体路径/行为逐字不破（m10 win32 基线兼容）；full 变体 = 独立文件名
 * baseline-full.png/current-full.png，绝不迁移/覆盖既有基线；receipt variant 字段纯加法。
 */
describe("m11 批 C：全页捕获变体（--full 独立基线文件名）", () => {
  it("路径形状：.atr/snapshots/<platform>/baseline-full.png（current-full 同目录；与默认变体互不相扰）", () => {
    const root = tmpRoot();
    try {
      expect(baselineFullPathFor(root, "win32")).toBe(path.join(root, ".atr", "snapshots", "win32", "baseline-full.png"));
      expect(baselineFullPathFor(root, "linux")).toBe(path.join(root, ".atr", "snapshots", "linux", "baseline-full.png"));
      expect(currentFullPathFor(root, "linux")).toBe(path.join(root, ".atr", "snapshots", "linux", "current-full.png"));
      // 与默认变体路径互异（绝不破坏 m10 基线兼容）
      expect(baselineFullPathFor(root, "win32")).not.toBe(baselinePathFor(root, "win32"));
      expect(currentFullPathFor(root, "win32")).not.toBe(currentPathFor(root, "win32"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("形态机检：捕获链补 captureBeyondViewport（视口外可见）+ 插件端 full=1 透传 + 平台感知 compare 基线", () => {
    const shot = fs.readFileSync(new URL("../dev/dev-screenshot.mjs", import.meta.url), "utf8");
    expect(shot, "全页捕获机制位（captureBeyondViewport+clip）").toContain("captureBeyondViewport");
    expect(shot, "fullPage 选项贯穿 captureOnSession").toContain("fullPage");
    const plugin = fs.readFileSync(new URL("../dev/atelier-dev-plugin.mjs", import.meta.url), "utf8");
    expect(plugin, "dev 面 screenshot 端点透传 full 变体").toContain("full=1");
    expect(plugin, "compare 基线平台感知（m10 per-platform 遗留不一致顺路修复）").toContain('".atr", "snapshots", platform');
    const snap = fs.readFileSync(new URL("../scripts/snapshot.mjs", import.meta.url), "utf8");
    expect(snap, "--full 分派进 save/check").toContain('"--full"');
    expect(snap, "full 变体走 full=1 查询（像素档对 full 基线比对）").toContain("full=1");
  });
});

/* ---- m11 批验收 minor 收口：快照门快路径 full 变体 receipt 显式排除（独立评审 minor ②）----
 * 红检口径（实现前实测，2026-09-27）：checkpoint.mjs 快路径只比对 result/baselineSha/sourceFp/age，
 * 未排除 variant:"full" 的 receipt——baseline.png 与 baseline-full.png 字节相同时（不可滚动页的
 * 真实形态），full 变体 MATCH receipt 满足全部条件被误食，违背 m11 归档行口径「checkpoint 未检
 * 不锚只认默认变体（full 检查不替代）」。同批发现 snapshot.mjs check 路径 receipt 漏标 variant
 * （check 是唯一能产出 MATCH/PIXMATCH 的写入者，save/--update 都是 SAVED 永不触发快路径）——
 * 漏标则显式排除对真实写入形状失效，一并补齐。
 * 语义保命线：默认变体 receipt 快路径照常生效（同一用例前半段钉住）；gate 阶梯不变。
 */
describe("m11 minor 收口：快照门快路径 full 变体 receipt 显式排除（共存场景：字节相同基线）", () => {
  const CHECKPOINT_SCRIPT = fileURLToPath(new URL("../scripts/checkpoint.mjs", import.meta.url));
  const sha256File = (p: string): string => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

  function makeRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-snap-fastpath-"));
    const r = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
    expect(r.status).toBe(0);
    fs.writeFileSync(path.join(repo, ".gitignore"), ".atelier/\n");
    return repo;
  }

  function runCheckpoint(repo: string, args: string[]): { status: number; stdout: string } {
    const r = spawnSync(process.execPath, [CHECKPOINT_SCRIPT, ...args], {
      cwd: repo,
      encoding: "utf8",
      // dev 面钉死不可达（:9 连接秒拒）→ 快路径被排除时确定落「vacuous」阶梯而非真捕获
      env: { ...process.env, ATELIER_DEV_URL: "http://127.0.0.1:9", ATELIER_TEST_GATE: "", ATELIER_SNAPSHOT_GATE: "", ATELIER_API_GATE: "" },
    });
    return { status: r.status ?? 1, stdout: r.stdout ?? "" };
  }

  it("共存场景：默认变体 receipt 快路径照常生效；full 变体 receipt（字节相同基线）绝不误食——落常规比对阶梯", () => {
    const repo = makeRepo();
    try {
      // 字节相同基线（不可滚动页的真实形态：baseline.png 与 baseline-full.png 同字节）
      fs.mkdirSync(snapshotsDir(repo), { recursive: true });
      fs.writeFileSync(baselinePathFor(repo), "same-bytes-both-variants");
      fs.writeFileSync(baselineFullPathFor(repo), "same-bytes-both-variants");
      const receiptPath = path.join(repo, ".atelier", "snapshot-lastcheck.json");
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      const now = new Date().toISOString();
      const fp = sourceFingerprint(repo); // tmp 仓库无 src/config → 空输入指纹；checkpoint.mjs 内联副本同源（同步不变式既档）
      const baseSha = sha256File(baselinePathFor(repo));

      // 前半（保命线）：默认变体 receipt（无 variant 字段）→ 快路径照常生效
      fs.writeFileSync(path.join(repo, "app.txt"), "round 1");
      fs.writeFileSync(receiptPath, JSON.stringify({ result: "MATCH", baselineSha: baseSha, sourceFp: fp, at: now }));
      const r1 = runCheckpoint(repo, ["save", "default-receipt", "--json"]);
      expect(r1.status).toBe(0);
      expect(r1.stdout, "默认变体 receipt 快路径不受扰").toContain("fresh MATCH receipt");

      // 后半（本批修复点）：full 变体 receipt（同 sha——字节相同基线、同新鲜度）→ 绝不误食
      fs.writeFileSync(path.join(repo, "app.txt"), "round 2");
      fs.writeFileSync(receiptPath, JSON.stringify({ result: "MATCH", baselineSha: baseSha, sourceFp: fp, at: now, variant: "full" }));
      const r2 = runCheckpoint(repo, ["save", "full-receipt", "--json"]);
      expect(r2.status).toBe(0);
      expect(r2.stdout, "full 变体 receipt 不走快路径（归档行口径：full 检查不替代默认门）").not.toContain("fresh MATCH receipt");
      expect(r2.stdout, "落到常规比对阶梯（dev 不可达 → vacuous 诚实打印，锚定照常）").toContain("snapshot gate vacuous");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("形态机检：snapshot.mjs check 路径 receipt 补 variant 标记（MATCH/PIXMATCH 的唯一写入者，漏标则排除对真实形状失效）", () => {
    const snap = fs.readFileSync(new URL("../scripts/snapshot.mjs", import.meta.url), "utf8");
    const checkReceiptLine = snap.split("\n").find((l) => l.includes("writeReceipt({ result: verdict"));
    expect(checkReceiptLine, "check receipt --full 时携 variant:\"full\"（与 save/--update 同款纯加法）").toContain(
      '...(FULL ? { variant: "full" } : {})',
    );
  });
});
