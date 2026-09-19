/**
 * checkpoint-migrate.test.ts — checkpoint 迁移联动（决策 21-③，FS-M2(m2d)）验收：
 *   save：库存在且有 atelier_migrations 表 → 台账条目记 migrationHead（最大 id + name）；
 *         无库 / 无表 → 条目不带该字段（vacuous 诚实边界，行为零变化）。
 *   rollback：目标锚点 migrationHead 低于当前库 head → 拒绝执行（exit 1，四段式指路
 *         "先 migrate down --to 再 rollback"，绝不自动 down）；目标 head >= 当前 → 行为零变化。
 * 套路照 migrate.test.ts：临时目录 + 真实 node:sqlite 造库；checkpoint 本体按 CLI 子进程实跑
 * （save/rollback 是脚本装配面——门禁 vacuous（无 package.json/快照/api 基线），git 真实提交）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite } from "../server/sqlite";
import { MIGRATIONS_TABLE_DDL } from "../server/migrate";

let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

const CHECKPOINT_SCRIPT = fileURLToPath(new URL("../scripts/checkpoint.mjs", import.meta.url));

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** 造一个真 git 仓库 tmp 目录（checkpoint.mjs 自注入 user identity，无需全局配置）；
 * .atelier/ gitignore 对齐真实应用布局（15d9059：台账/库 = 本地态不入库） */
function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-ckpt-"));
  tmpDirs.push(repo);
  const r = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  expect(r.status).toBe(0);
  fs.writeFileSync(path.join(repo, ".gitignore"), ".atelier/\n");
  return repo;
}

/** 造库并写 atelier_migrations 状态（head = maxId）；返回台账读取用的相对路径 */
async function makeMigDb(repo: string, rel: string, heads: { id: number; name: string }[]): Promise<void> {
  const dbFile = path.join(repo, rel);
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = await openSqlite(dbFile);
  db.exec(MIGRATIONS_TABLE_DDL);
  for (const h of heads) {
    db.prepare("INSERT INTO atelier_migrations (id, name, checksum, applied_at, down_verified) VALUES (?, ?, ?, ?, 0)").run(h.id, h.name, "0".repeat(64), Date.now());
  }
  db.close();
}

function runCheckpoint(repo: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CHECKPOINT_SCRIPT, ...args], { cwd: repo, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** save --json 的 JSON 行在门禁 vacuous 打印之后（最后一行 { 开头）——按行提取再解析 */
function parseSaveJson(r: { status: number; stdout: string }): Record<string, unknown> {
  expect(r.status).toBe(0);
  const lines = r.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  return JSON.parse(lines[lines.length - 1]!);
}

function readLedger(repo: string): Record<string, unknown>[] {
  const p = path.join(repo, ".atelier", "checkpoints.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function dirty(repo: string, content: string): void {
  fs.writeFileSync(path.join(repo, "app.txt"), content);
}

describeSqlite("checkpoint 迁移联动（决策 21-③：save 记 head / rollback 低 head 拒绝）", () => {
  it("save：库在 → 条目记 migrationHead（最大 id + name）；--db 换库生效；再次 save 记新 head", async () => {
    const repo = makeRepo();
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [
      { id: 1, name: "001_chats" },
      { id: 2, name: "002_messages" },
    ]);
    dirty(repo, "round 1");
    const r1 = runCheckpoint(repo, ["save", "first", "--json"]);
    expect(r1.status).toBe(0);
    const entry1 = parseSaveJson(r1);
    expect(entry1.ok).toBe(true);
    expect(entry1.migrationHead).toEqual({ id: 2, name: "002_messages" });
    expect(readLedger(repo).filter((e) => e.type === "save")).toHaveLength(1);

    // head 推进到 003 → 第二次 save 记新 head；--db 指向自定义库亦生效
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [{ id: 3, name: "003_auth" }]); // 追加一行（同库再开）
    dirty(repo, "round 2");
    const r2 = runCheckpoint(repo, ["save", "second", "--json"]);
    expect(r2.status).toBe(0);
    expect(parseSaveJson(r2).migrationHead).toEqual({ id: 3, name: "003_auth" });

    dirty(repo, "round 3");
    await makeMigDb(repo, path.join("data", "custom.db"), [{ id: 9, name: "009_custom" }]);
    const r3 = runCheckpoint(repo, ["save", "third", "--db", "data/custom.db", "--json"]);
    expect(r3.status).toBe(0);
    expect(parseSaveJson(r3).migrationHead).toEqual({ id: 9, name: "009_custom" });
  });

  it("vacuous 诚实边界：无库 / 有库无 atelier_migrations 表 → save 正常锚定，条目不带 migrationHead", async () => {
    const repo = makeRepo();
    dirty(repo, "no db here");
    const r1 = runCheckpoint(repo, ["save", "bare", "--json"]);
    expect(r1.status).toBe(0);
    expect(parseSaveJson(r1).migrationHead).toBeUndefined();
    // 有库无迁移表
    const repo2 = makeRepo();
    await makeMigDb(repo2, path.join(".atelier", "dev.db"), []);
    dirty(repo2, "db without migrations");
    const r2 = runCheckpoint(repo2, ["save", "nomig", "--json"]);
    expect(r2.status).toBe(0);
    expect(parseSaveJson(r2).migrationHead).toBeUndefined();
  });

  it("rollback：锚点 head 低于当前库 head → 拒绝（exit 1，指路先 migrate down --to 再 rollback）；git HEAD 不动", async () => {
    const repo = makeRepo();
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [{ id: 1, name: "001_chats" }]);
    dirty(repo, "round 1");
    const first = parseSaveJson(runCheckpoint(repo, ["save", "first", "--json"]));
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [{ id: 2, name: "002_messages" }]);
    dirty(repo, "round 2");
    const second = parseSaveJson(runCheckpoint(repo, ["save", "second", "--json"]));
    const headBefore = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const refused = runCheckpoint(repo, ["rollback", first.id]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("refusing rollback");
    expect(refused.stderr).toContain("001_chats"); // 锚点 head
    expect(refused.stderr).toContain("002_messages"); // 当前 head
    expect(refused.stderr).toContain("migrate down --to 1"); // 四段式指路——绝不自动 down
    const headAfter = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(headAfter).toBe(headBefore); // 拒绝 = git 状态零变化（headBefore 是台账 meta commit——save 后 HEAD 在锚点之后一格）
  });

  it("rollback：目标 head >= 当前库 head → 行为零变化照常回滚；把库 head 降回后同一锚点放行", async () => {
    const repo = makeRepo();
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [{ id: 1, name: "001_chats" }]);
    dirty(repo, "round 1");
    const first = parseSaveJson(runCheckpoint(repo, ["save", "first", "--json"]));
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [{ id: 2, name: "002_messages" }]);
    dirty(repo, "round 2");
    const second = parseSaveJson(runCheckpoint(repo, ["save", "second", "--json"]));
    void second;

    // 回滚到 second：目标 head（2）== 当前库 head（2）→ 放行（不拒绝）——台账 gitignored 时 HEAD
    // 即锚点 → noop 短路；否则真实 reset 回锚点（两条放行路径都对，核心断言 = 不因迁移 head 拒绝）
    const toSecond = runCheckpoint(repo, ["rollback", second.id]);
    expect(toSecond.status).toBe(0);
    expect(/already at checkpoint|rolled back →/.test(toSecond.stdout)).toBe(true);
    expect(fs.readFileSync(path.join(repo, "app.txt"), "utf8")).toBe("round 2"); // 工作树 = 锚点状态（target head >= current → 照常执行）

    // 模拟 migrate down：库 head 降回 1（只删状态行——测试造库语义）
    const db = await openSqlite(path.join(repo, ".atelier", "dev.db"));
    db.prepare("DELETE FROM atelier_migrations WHERE id = 2").run();
    db.close();
    const ok = runCheckpoint(repo, ["rollback", first.id]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(`rolled back → ${first.id}`);
    expect(fs.readFileSync(path.join(repo, "app.txt"), "utf8")).toBe("round 1"); // 真实回滚发生（工作树回到锚点状态）
    // 台账记 rollback 条目
    expect(readLedger(repo).some((e) => e.type === "rollback" && e.target === first.id)).toBe(true);
  });

  it("list：带 migrationHead 的条目呈现 head 位；无该字段的条目不受影响", async () => {
    const repo = makeRepo();
    dirty(repo, "bare");
    runCheckpoint(repo, ["save", "bare"]);
    await makeMigDb(repo, path.join(".atelier", "dev.db"), [{ id: 4, name: "004_x" }]);
    dirty(repo, "with db");
    runCheckpoint(repo, ["save", "withdb"]);
    const out = runCheckpoint(repo, ["list"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("head=#4 004_x");
    const lines = out.stdout.split("\n").filter((l) => l.includes("save"));
    expect(lines.some((l) => l.includes("bare") && !l.includes("head="))).toBe(true); // 无 head 字段条目照常呈现
  });
});
