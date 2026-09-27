/**
 * bun-adapter-smoke.mjs — sqlite.ts bun 宿主适配面冒烟（m11 批 B：Bun 环境回归销账件）。
 *
 * 背景：FS-3 sqlite.ts 的 bun:sqlite 路径此前以 API 形状对照官方文档实现、从未真执行
 * （诚实边界「本环境无 Bun，待 Bun 环境回归」挂账多批）。本脚本是可重复的验证口径：
 * 在 Bun 下直跑四原语（prepare/run/all/get）+ exec + tx 提交/回滚 + 写捕获槽全语义面。
 *
 * 运行（仅 Bun 宿主；node 下 host 断言诚实失败退出 1）：
 *   bun atelier/scripts/bun-adapter-smoke.mjs
 * 退出码即门禁：0 = 全过；1 = 任一断言失败或宿主不符。
 * 临时库文件落 os.tmpdir()，跑完即删（不入 git）。
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isBun = typeof globalThis.Bun !== "undefined";
if (!isBun) {
  console.error("[bun-smoke] 当前宿主非 Bun（globalThis.Bun 不存在）——本冒烟只验证 bun:sqlite 适配面。");
  console.error("[bun-smoke] fix：bun atelier/scripts/bun-adapter-smoke.mjs");
  process.exit(1);
}
console.log(`[bun-smoke] Bun ${globalThis.Bun.version} @ ${process.platform}-${process.arch}`);

const { openSqlite } = await import("../server/sqlite.ts");

const dbPath = join(tmpdir(), `atelier-bun-smoke-${process.pid}-${Date.now()}.db`);
let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    console.log(`[bun-smoke] PASS ${name}`);
  } else {
    failures++;
    console.error(`[bun-smoke] FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const db = await openSqlite(dbPath);
try {
  check("host=bun", db.host === "bun", `实际 host=${db.host}`);

  // exec：建表
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score INTEGER)");

  // prepare/run：参数化写入 + 返回形状（changes/lastInsertRowid）
  const ins = db.prepare("INSERT INTO t (name, score) VALUES (?, ?)");
  const r1 = ins.run("a", 1);
  const r2 = ins.run("b", 2);
  check("run.changes", r1.changes === 1 && r2.changes === 1, JSON.stringify([r1, r2]));
  check("run.lastInsertRowid 递增", Number(r2.lastInsertRowid) === Number(r1.lastInsertRowid) + 1);
  const rn = db.prepare("INSERT INTO t (name, score) VALUES (?, ?)").run("n", null); // null 参数
  check("null 参数绑定", rn.changes === 1);

  // all/get：读回 + 参数化
  const all = db.prepare("SELECT id, name, score FROM t ORDER BY id").all();
  check("all 行数与形状", all.length === 3 && all[0].name === "a" && all[2].score === null, JSON.stringify(all));
  const one = db.prepare("SELECT name FROM t WHERE id = ?").get(2);
  check("get 参数化", one?.name === "b", JSON.stringify(one));
  const none = db.prepare("SELECT name FROM t WHERE id = ?").get(999);
  check("get 无行=undefined", none === undefined);

  // 写捕获槽：prepare 而未 run 不算写；run 真执行记表；exec 同口径
  const { beginWriteCapture, endWriteCapture } = await import("../server/sqlite.ts");
  const cap = beginWriteCapture();
  db.prepare("INSERT INTO t (name, score) VALUES (?, ?)"); // prepare 未 run → 不记
  check("prepare 未 run 不记写", endWriteCapture(cap).length === 0);
  const cap2 = beginWriteCapture();
  ins.run("c", 3);
  const cap2Tables = endWriteCapture(cap2);
  check("run 记入捕获槽", cap2Tables.length === 1 && cap2Tables[0] === "t", JSON.stringify(cap2Tables));
  const cap3 = beginWriteCapture();
  db.exec("UPDATE t SET score = 9 WHERE id = 1; DELETE FROM t WHERE id = 3");
  const cap3Tables = endWriteCapture(cap3);
  check("exec 多语句扫表", JSON.stringify(cap3Tables) === JSON.stringify(["t"]), JSON.stringify(cap3Tables));

  // tx：提交
  await db.tx(async (tx) => {
    tx.prepare("INSERT INTO t (name, score) VALUES (?, ?)").run("tx-ok", 7);
  });
  check("tx 提交落库", db.prepare("SELECT COUNT(*) AS c FROM t WHERE name = 'tx-ok'").get()?.c === 1);

  // tx：异常回滚 + 原样 rethrow
  let rolled = false;
  try {
    await db.tx((tx) => {
      tx.prepare("INSERT INTO t (name, score) VALUES (?, ?)").run("tx-rb", 8);
      throw new Error("boom");
    });
  } catch (e) {
    rolled = e?.message === "boom";
  }
  check("tx 异常回滚 + rethrow", rolled && db.prepare("SELECT COUNT(*) AS c FROM t WHERE name = 'tx-rb'").get()?.c === 0);

  // 大参数量与 unicode 往返
  const u = db.prepare("INSERT INTO t (name, score) VALUES (?, ?)").run("中文🎉", 42);
  check("unicode 往返", db.prepare("SELECT name FROM t WHERE id = ?").get(Number(u.lastInsertRowid))?.name === "中文🎉");

  // exec 纯注释/空 SQL = no-op（宿主差异归一：node:sqlite 原生容忍，bun:sqlite 曾抛
  // "Query contained no valid SQL statement"——m11 批 B 实测后归一，种子骨架场景真实撞上）
  let commentOnlyThrew = false;
  try {
    db.exec("-- 只注释占位（gen db 种子骨架形态）\n");
  } catch {
    commentOnlyThrew = true;
  }
  check("exec 纯注释=no-op（宿主差异归一）", !commentOnlyThrew);
  let emptyThrew = false;
  try {
    db.exec("   \n  ");
  } catch {
    emptyThrew = true;
  }
  check("exec 空白=no-op（宿主差异归一）", !emptyThrew);

  // PRAGMA 经 prepare/all（introspect.ts server-status 内省路径的真实形态）
  const cols = db.prepare("PRAGMA table_info(t)").all();
  check(
    "PRAGMA table_info 内省",
    cols.length === 3 && cols[0].name === "id" && cols[0].pk === 1,
    JSON.stringify(cols),
  );
} finally {
  db.close();
  try {
    rmSync(dbPath, { force: true });
  } catch {
    /* tmp 清理失败不掩盖结果 */
  }
}

if (failures > 0) {
  console.error(`[bun-smoke] ${failures} 项失败`);
  process.exit(1);
}
console.log("[bun-smoke] 全部通过——bun:sqlite 适配面（四原语/exec/tx/写捕获）在真实 Bun 宿主下语义成立");
