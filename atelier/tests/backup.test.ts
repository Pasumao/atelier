/**
 * backup.test.ts — 差距批 A3 `atelier db backup` 验收（FS-DESIGN §5.7 落地注记 2026-09-28）。
 *
 * 红检纪律（§14.2 同款，A1 批 jobs.test.ts 先例）：本文件先于实现提交——实现前 cli.mjs 无 `db`
 * 命令组（default → "unknown command: db" exit 2），全部行为用例红；实现后转绿并把失败形态逐条
 * 锁死。被测面 = scripts/backup.mjs（装配与诚实呈现层，migrate.mjs 分层先例同构）+ cli.mjs
 * `db` 命令组分发（spawn 真实 CLI 一次——call-gate.test.ts 先例：dispatch 面也是被验语义）。
 *
 * 语义（§5.7 落地注记）：实现 = SQLite `VACUUM INTO`（单语句零依赖、两宿主通用、产物压缩整理）
 * ·在线备份（读快照不锁写，不要求停机）·目标已存在须 --force 显式覆盖（绝不静默覆盖，§18 R7
 * 同纪律）·产物 quick_check + sha256(前12位) 自证行（stdout 单行 JSON，agent 可直接消费；
 * checkpoint「可验证性叙事」同构）·--no-verify = 逃生口（证据行无 quickCheck 字段）。
 *
 * 诚实边界：node:sqlite 仅 Node ≥22.5 内建——skip-guard 沿 migrate.test.ts；bun 路径不在场
 * （sqlite.ts 头注同口径）。活库一致性 = 顺序模拟（备份完成后源库再写，产物停在备份时点）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite } from "../server/sqlite";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");
const SCRIPT = path.join(PKG, "scripts", "backup.mjs");

// node:sqlite 仅 Node ≥22.5 内建（本环境 Node 24 可用；skip-guard 沿 migrate.test.ts/server.test.ts）
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const d = nodeSqlite ? describe : describe.skip;

/* ---------------- fixture：最小夹具库（migrate.test.ts 造库先例——不经 init，直开库写数行） ---------------- */

const tmpDirs: string[] = [];
afterAll(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

async function makeFixtureDb(rows = 2): Promise<{ root: string; dbFile: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-backup-"));
  tmpDirs.push(root);
  const dbFile = path.join(root, ".atelier", "dev.db");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = await openSqlite(dbFile);
  db.exec("CREATE TABLE chats (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  for (let i = 1; i <= rows; i++) db.prepare("INSERT INTO chats (name) VALUES (?)").run(`chat-${i}`);
  db.close();
  return { root, dbFile };
}

/** 跑 runner 子进程（die 全在装配面——进程级 exit code/输出即被验契约；cli-die.test.ts 同款） */
function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", windowsHide: true });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 跑真实 CLI 子进程：`node atelier/cli.mjs db <args…>`（不经 runFile 直调——dispatch 面也算被测） */
function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, "db", ...args], { encoding: "utf8", windowsHide: true });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

type Evidence = { out: string; bytes: number; sha256: string; quickCheck?: string; durMs: number; source: string };
const parseEvidence = (stdout: string): Evidence => JSON.parse(stdout) as Evidence;
const norm = (p: string) => p.replace(/\\/g, "/");

d("差距批 A3：atelier db backup（VACUUM INTO 在线快照 + 自证行，FS-DESIGN §5.7）", () => {
  it("全链：exit 0 + 自证行六事实 + 产物可开真读（quick_check ok + 行级一致）+ 同库两备字节级一致", async () => {
    const { root, dbFile } = await makeFixtureDb(2);
    const out = path.join(root, "backups", "b1.db");
    const r = run(["--root", root, "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(""); // 成功路径零 stderr 噪声（证据只上 stdout 的输出面纪律）
    const ev = parseEvidence(r.stdout);
    expect(norm(ev.out)).toBe(norm(out));
    expect(ev.bytes).toBe(fs.statSync(out).size);
    expect(ev.bytes).toBeGreaterThan(0);
    expect(ev.sha256).toMatch(/^[0-9a-f]{12}$/); // sha256 前 12 位
    expect(ev.quickCheck).toBe("ok");
    expect(typeof ev.durMs).toBe("number");
    expect(norm(ev.source)).toBe(norm(dbFile));
    // 产物真开真读：quick_check ok + 数据行级一致（不是空壳文件）
    const copy = await openSqlite(out);
    expect(copy.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(copy.prepare("SELECT COUNT(*) AS n FROM chats").get()!.n).toBe(2);
    expect((copy.prepare("SELECT name FROM chats WHERE id = 1").get() as { name: string }).name).toBe("chat-1");
    copy.close();
    // VACUUM 整理语义：同库两次备份字节级一致（sha256 稳定，断言一次）
    const out2 = path.join(root, "backups", "b2.db");
    expect(run(["--root", root, "--out", out2]).status).toBe(0);
    expect(fs.readFileSync(out).equals(fs.readFileSync(out2))).toBe(true);
  });

  it("Windows 形态：目标路径含单引号 → 备份成功（SQL 字面量转义钉死，win32 实测口径）", async () => {
    const { root } = await makeFixtureDb(1);
    const out = path.join(root, "o'brien '25.db");
    const r = run(["--root", root, "--out", out]);
    expect(r.status).toBe(0);
    const copy = await openSqlite(out);
    expect(copy.prepare("SELECT COUNT(*) AS n FROM chats").get()!.n).toBe(1);
    copy.close();
  });

  it("目标已存在：无 --force 拒绝（exit 1 + 指引）且旧产物原样；--force 显式覆盖成功", async () => {
    const { root } = await makeFixtureDb(2);
    const out = path.join(root, "b.db");
    expect(run(["--root", root, "--out", out]).status).toBe(0);
    // 给旧产物做标记（末尾追加字节）——覆盖后必须消失，原样保留时必须还在
    fs.appendFileSync(out, "\x00stale-marker");
    const stale = fs.readFileSync(out);
    const r2 = run(["--root", root, "--out", out]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("已存在");
    expect(r2.stderr).toContain("--force"); // 指引给到显式破坏旗标
    expect(fs.readFileSync(out).equals(stale)).toBe(true); // 无 --force 旧产物一字节不动
    const r3 = run(["--root", root, "--out", out, "--force"]);
    expect(r3.status).toBe(0);
    expect(fs.readFileSync(out).includes(Buffer.from("stale-marker"))).toBe(false); // 旧产物确实被换新
    const copy = await openSqlite(out);
    expect(copy.prepare("SELECT COUNT(*) AS n FROM chats").get()!.n).toBe(2);
    copy.close();
  });

  it("活库一致性（顺序模拟）：备份后源库再写 → 产物停在备份时点行数（读快照语义）", async () => {
    const { root, dbFile } = await makeFixtureDb(2);
    const out = path.join(root, "snap.db");
    expect(run(["--root", root, "--out", out]).status).toBe(0);
    // 备份完成后再写源库——产物不得追认这笔写
    const db = await openSqlite(dbFile);
    db.prepare("INSERT INTO chats (name) VALUES (?)").run("after-backup");
    const srcN = Number((db.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n);
    db.close();
    expect(srcN).toBe(3); // 源库确有第三行
    const copy = await openSqlite(out);
    expect(Number((copy.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n)).toBe(2); // 产物停在备份时点
    copy.close();
  });

  it("--no-verify：跳过校验——证据行无 quickCheck 字段（机检）且其余事实照常", async () => {
    const { root } = await makeFixtureDb(2);
    const out = path.join(root, "noverify.db");
    const r = run(["--root", root, "--out", out, "--no-verify"]);
    expect(r.status).toBe(0);
    const ev = parseEvidence(r.stdout);
    expect("quickCheck" in ev).toBe(false); // 逃生口诚实缺省：没验证就不冒充验证过
    expect(ev.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(ev.bytes).toBe(fs.statSync(out).size);
  });

  it("红证：源库不存在 → exit 1 + 指路 migrate up（不静默建库、不产空备份）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-backup-bare-"));
    tmpDirs.push(root);
    const out = path.join(root, "b.db");
    const r = run(["--root", root, "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("库不存在");
    expect(r.stderr).toContain("migrate up");
    expect(fs.existsSync(out)).toBe(false); // 备份未静默产出
  });

  it("红证：--out 与源库相同 → exit 1 拒绝（--force 也不放行——同路径覆盖 = 删源库，破坏面不可显式同意）", async () => {
    const { root, dbFile } = await makeFixtureDb(2);
    const r = run(["--root", root, "--out", dbFile, "--force"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("相同");
    const copy = await openSqlite(dbFile); // 源库毫发无损
    expect(Number((copy.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n)).toBe(2);
    copy.close();
  });

  it("红证：缺 --out / 未知子命令 → usage 级 exit 2（坏输入客户端即拦）", async () => {
    const { root } = await makeFixtureDb(1);
    expect(run(["--root", root]).status).toBe(2); // 缺 --out
    expect(run(["--root", root]).stderr).toContain("usage: atelier db backup");
    const cli = runCli(["bogus", "--root", root]); // cli.mjs db 命令组子命令守卫
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain("usage: atelier db backup");
  });

  it("spawn 真实 CLI 一次：node atelier/cli.mjs db backup 全链（含 dispatch 面）→ exit 0 + 自证行", async () => {
    const { root } = await makeFixtureDb(3);
    const out = path.join(root, "via-cli.db");
    const r = runCli(["backup", "--root", root, "--out", out]);
    expect(r.status).toBe(0);
    const ev = parseEvidence(r.stdout);
    expect(ev.quickCheck).toBe("ok");
    expect(norm(ev.out)).toBe(norm(out));
    const copy = await openSqlite(out);
    expect(Number((copy.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n)).toBe(3);
    copy.close();
  });
});
