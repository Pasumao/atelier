#!/usr/bin/env node
/**
 * migrate.mjs — `atelier migrate` runner（FS-4，FS-DESIGN §5.4；seed = D-F17，FS-M2(m2d)）。
 * 库在 server/migrate.ts / server/seed.ts（宿主差异锁 sqlite.ts）；本文件只做装配与诚实呈现：
 *   atelier migrate status|up|down|verify|seed [--root <dir>] [--db <file>] [--to <name>] [--force]
 * 约定：迁移目录 = <root>/src/server/db/migrations；种子目录 = <root>/src/server/db/seeds；
 * dev 库缺省 <root>/.atelier/dev.db（§11.1，gitignore 位）。TS 库经 Node 类型剥离直 import
 * （cli compile/dump.mjs 同先例，Node ≥22.18）。
 * seed 语义（D-F17，SQL 种子——server/seed.ts 头注有偏离声明）：逐文件 tx + atelier_seeds 记账，
 * 幂等重跑跳过已应用；库不存在时提示先 up（不静默建库）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [sub, ...rest] = process.argv.slice(2);
const argOf = (k) => {
  const i = rest.indexOf(k);
  return i >= 0 ? rest[i + 1] : undefined;
};

const root = path.resolve(argOf("--root") ?? process.cwd());
const dbFile = path.resolve(root, argOf("--db") ?? path.join(".atelier", "dev.db"));
const migDir = path.join(root, "src", "server", "db", "migrations");
const seedsDir = path.join(root, "src", "server", "db", "seeds");
const to = argOf("--to");
const force = rest.includes("--force");

// die 签名全仓大一统（建议书 A5）：die(msg, code = 2)——msg 单串自含 error/usage/fix 全部文案
function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

if (!["status", "up", "down", "verify", "seed"].includes(sub)) {
  die(`usage: atelier migrate status|up|down|verify|seed [--root <dir>] [--db <file>] [--to <name>] [--force]`);
}

const { openSqlite } = await import("../server/sqlite.ts");
const { migrateStatus, migrateUp, migrateDown, migrateVerify } = await import("../server/migrate.ts");
const { seedAll } = await import("../server/seed.ts");

function printSteps(label, steps) {
  for (const s of steps) console.log(`  ${label} ${s.name}（checksum ${s.checksum.slice(0, 12)}…，${s.durMs}ms）`);
}

try {
  if (sub === "verify") {
    // 干跑影子库（:memory:）up→down→up 幂等校验——不触碰真实库（§5.4 verify 语义）
    const r = await migrateVerify(migDir);
    for (const s of r.steps) console.log(`  verify ${s.name}（checksum ${s.checksum.slice(0, 12)}…，${s.durMs}ms）`);
    if (r.ok) {
      console.log(`[atelier migrate] verify OK——up→down→up 幂等通过（影子库干跑，真实库未动）`);
    } else {
      console.error(`[atelier migrate] verify FAILED${r.error ? `——${r.error.code}: ${r.error.message}` : r.mismatch ? `——影子库重放不一致：${r.mismatch}` : ""}`);
      console.error(`fix: 检查失败迁移的 up/down SQL 是否互逆（down 必须精确撤销 up 的 schema 变更）`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (!fs.existsSync(dbFile)) {
    if (sub === "up") {
      // node:sqlite 不建父目录——装配层负责（dev 库约定 .atelier/dev.db，§11.1）
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    } else if (sub === "status") {
      // 纯读命令不为 status 建空库：内存库呈现（readStatusRows 对无状态表 = 空 → 全 pending）
      console.log(`[atelier migrate] 库不存在：${dbFile}（status 以内存库呈现——全部 pending）`);
      const mem = await openSqlite(":memory:");
      const st = migrateStatus(mem, migDir);
      if (st.pending.length === 0) console.log("  （无迁移目录或目录为空——gen db 或手写 NNN_*.up/.down.sql 生成）");
      for (const p of st.pending) console.log(`  ○ ${p.name} pending${p.hasDown ? "" : "  ⚠ 缺 down（ATR-331，up 会拒绝）"}${p.irreversible ? "（含不可逆标记）" : ""}`);
      mem.close();
      process.exit(0);
    } else if (sub === "seed") {
      // D-F17：seed 不静默建库——库是迁移的产物，种子在无迁移的空库上跑没有意义
      console.error(`[atelier migrate] 库不存在：${dbFile}——seed 不静默建库`);
      console.error("fix: 先 migrate up（建库并应用迁移）后重跑 migrate seed");
      process.exit(1);
    } else {
      console.log(`[atelier migrate] 库不存在：${dbFile}——down 无可回滚迁移`);
      process.exit(0);
    }
  }
  const db = await openSqlite(dbFile);
  try {
    if (sub === "status") {
      const st = migrateStatus(db, migDir);
      console.log(`[atelier migrate] status（库 ${path.relative(root, dbFile) || dbFile}）`);
      if (st.applied.length === 0 && st.pending.length === 0) console.log("  （无迁移目录或目录为空——gen db 或手写 NNN_*.up/.down.sql 生成）");
      for (const a of st.applied) {
        const flags = [a.checksumOk ? null : "CHECKSUM-MISMATCH(ATR-332)", a.fileMissing ? "FILE-MISSING(ATR-332)" : null, a.irreversible ? "irreversible" : null].filter(Boolean).join("，");
        console.log(`  ● ${a.name} applied${a.downVerified ? "（down 已验证）" : ""}${flags ? "  ⚠ " + flags : ""}`);
      }
      for (const p of st.pending) console.log(`  ○ ${p.name} pending${p.hasDown ? "" : "  ⚠ 缺 down（ATR-331，up 会拒绝）"}${p.irreversible ? "（含不可逆标记）" : ""}`);
    } else if (sub === "up") {
      const steps = migrateUp(db, migDir, { to });
      if (steps.length === 0) console.log("[atelier migrate] up：无待应用迁移（已是最新）");
      printSteps("↑ applied", steps);
      console.log(`[atelier migrate] up 完成：${steps.length} 条（逐条事务包裹；迁移执行建议过一遍 atelier migrate verify）`);
    } else if (sub === "down") {
      const steps = migrateDown(db, migDir, { to, force });
      if (steps.length === 0) console.log("[atelier migrate] down：无可回滚迁移");
      printSteps("↓ rolled back", steps);
      console.log("[atelier migrate] down 完成（数据不可回——down 只保证 schema 可逆；破坏性操作走 confirm 纪律）");
    } else if (sub === "seed") {
      // D-F17 SQL 种子：逐文件 tx + atelier_seeds 记账（name/checksum/applied_at）——幂等重跑安全
      const r = seedAll(db, seedsDir);
      for (const s of r.applied) console.log(`  ⚑ seeded ${s.name}（checksum ${s.checksum.slice(0, 12)}…，${s.durMs}ms）`);
      for (const s of r.skipped) console.log(`  · skipped ${s}（已应用，checksum 相符）`);
      console.log(
        r.applied.length === 0 && r.skipped.length === 0
          ? "[atelier migrate] seed：无种子文件（<root>/src/server/db/seeds/*.seed.sql——gen db 生成示例骨架）"
          : `[atelier migrate] seed 完成：应用 ${r.applied.length} 条，跳过 ${r.skipped.length} 条（每条语句须幂等/UPSERT——重复执行安全；状态记于 atelier_seeds）`
      );
    }
  } finally {
    db.close();
  }
} catch (e) {
  // AtrEndpointError 携带四段式 atr（code/message/fix）——结构化优先于堆栈（决策 9）
  const atr = e?.atr;
  if (atr) {
    console.error(`[atelier migrate] ${atr.code}: ${atr.message}`);
    console.error(`fix: ${atr.fix}`);
    process.exit(1);
  }
  console.error(`[atelier migrate] ${e?.message ?? String(e)}`);
  process.exit(1);
}
