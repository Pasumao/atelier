/**
 * 种子执行器（FS-DESIGN §5.7 D-F17，FS-M2(m2d)）。
 *
 * **偏离声明（有意为之，v1 落地形态）**：设计书原文 = "seed.ts 明文（UPSERT 语义）"——但 runner
 * 无法执行应用的 TS 模块（生成器纪律禁 eval/TS 解析器；node 直 import 应用 .ts 需要编译管线与
 * 类型剥离前提），故 v1 落地为 **SQL 种子**：`<root>/src/server/db/seeds/*.seed.sql`，每条语句
 * 必须幂等（INSERT OR REPLACE / INSERT ... ON CONFLICT DO UPDATE 语义），tx 包裹逐文件执行。
 *
 * 状态表（schema 固定）：
 *   atelier_seeds(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)
 * checksum = sha256(文件内容 utf8，node:crypto)。重复执行：已应用且 checksum 相符 → 跳过；
 * checksum 不符 → ATR-335（已应用种子被改——恢复内容或另起新文件名，永不重写已应用种子）。
 *
 * 错误码语义（3xx 运行时/数据域，紧邻迁移 331-334）：
 *   ATR-335 种子完整性破坏（已应用 seed 文件被改，sha256 与 atelier_seeds 记录不符）
 *   ATR-336 种子语句不可重放（静态非幂等：裸 INSERT 无 ON CONFLICT / OR REPLACE；或执行失败——事务已回滚）
 * 幂等性检查是静态启发式（正则，注释剥离后）：INSERT OR IGNORE 也放行；无 INSERT 的文件（纯注释/DDL）
 * 不拦。种子是 dev 体验件，不做 SQL 解析器（诚实边界）。
 *
 * 诚实边界：无 seed status 独立命令（seedAll 的返回即诚实清单）；种子不回滚（down 不属于种子域，
 * 回滚数据走 checkpoint/迁移纪律）；状态表无 down_verified 位（种子不验证逆操作）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AtrEndpointError, endpointError } from "./endpoints.ts";
import type { SqliteDb } from "./sqlite.ts";

/** 状态表 DDL（schema 固定，struct 守卫侧若核对按同 schema——字段名勿改） */
export const SEEDS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS atelier_seeds (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)";

const STATUS_TABLE = "atelier_seeds";

export type SeedStep = { name: string; checksum: string; durMs: number };

export type SeedResult = {
  /** 本次实际应用的种子（tx 提交后入账） */
  applied: SeedStep[];
  /** 已应用且 checksum 相符而跳过的种子（幂等重跑的安全面） */
  skipped: string[];
};

function fail(code: string, message: string, fix: string, hints?: string[]): AtrEndpointError {
  return new AtrEndpointError(endpointError(code, message, fix, hints));
}

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** 状态表行读取（表不存在 = 空表——调用方 seedAll 先建表，此处防御性纯读） */
function readStatusRows(db: SqliteDb): Map<string, string> {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(STATUS_TABLE);
  if (!has) return new Map();
  const rows = db.prepare(`SELECT name, checksum FROM ${STATUS_TABLE}`).all() as { name: string; checksum: string }[];
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

/**
 * 幂等语句静态启发（ATR-336 前置拦截）：注释剥离后，存在裸 `INSERT INTO`（非 OR REPLACE/IGNORE）
 * 且全文无 `ON CONFLICT` → 硬错。逐文件级而非逐语句级（不做 SQL 解析器）：文件内只要声明了
 * UPSERT 语义即放行——精细度换可靠性的诚实取舍，seed 是 dev 体验件。
 */
function assertIdempotentSql(sql: string, name: string): void {
  const withoutComments = sql.replace(/--[^\n]*/g, " ");
  const hasUpsert = /\bON\s+CONFLICT\b/i.test(withoutComments);
  const bareInsert = /\bINSERT\s+(?!OR\s+(?:REPLACE|IGNORE)\b)INTO\b/i.test(withoutComments);
  if (bareInsert && !hasUpsert) {
    throw fail(
      "ATR-336",
      `种子 ${name} 含非幂等语句（裸 INSERT INTO，且全文无 ON CONFLICT）`,
      "每条语句必须幂等（D-F17，重复执行安全）：改写为 INSERT OR REPLACE INTO ... 或 INSERT ... ON CONFLICT(<键>) DO UPDATE ...；无数据的占位文件请整文件注释",
      [name]
    );
  }
}

/**
 * 应用全部种子（按文件名升序，tx 包裹逐文件执行）。目录缺失/为空 = 空清单（vacuous，不报错）。
 * 步骤：建状态表 → 逐文件：已应用（checksum 相符）跳过 / 被改 ATR-335 → 未应用：静态幂等检查
 * → BEGIN IMMEDIATE 执行 + 记账 → COMMIT；执行失败 ROLLBACK = ATR-336。
 * 返回 { applied, skipped } 诚实清单。
 */
export function seedAll(db: SqliteDb, seedsDir: string): SeedResult {
  db.exec(SEEDS_TABLE_DDL);
  const files = fs.existsSync(seedsDir)
    ? fs.readdirSync(seedsDir).filter((f) => f.endsWith(".seed.sql")).sort()
    : [];
  const status = readStatusRows(db);
  const applied: SeedStep[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(seedsDir, file), "utf8");
    const sum = checksumOf(sql);
    const known = status.get(file);
    if (known != null) {
      if (known !== sum) {
        throw fail(
          "ATR-335",
          `已应用种子 ${file} 被改（sha256 与应用时不符）`,
          "已应用的种子永不重写（同 §5.4 迁移追加式纪律）：恢复文件至应用时内容，或把变更另起新 *.seed.sql 文件名追加；dev 库可删 atelier_seeds 对应行后重放（开发态逃生口，生产库禁用）",
          [file]
        );
      }
      skipped.push(file);
      continue;
    }
    assertIdempotentSql(sql, file);
    const t0 = performance.now();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(sql);
      db.prepare(`INSERT INTO ${STATUS_TABLE} (name, checksum, applied_at) VALUES (?, ?, ?)`).run(file, sum, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ROLLBACK 本身失败（连接已坏）——不掩盖原始错误 */
      }
      throw fail(
        "ATR-336",
        `种子 ${file} 执行失败，事务已回滚：${(e as Error)?.message ?? String(e)}`,
        `修复 ${file} 中的 SQL 后重跑（失败即整文件回滚，库无残留）；种子文件不得自带 BEGIN/COMMIT——事务由种子执行器统一包裹`,
        [file]
      );
    }
    applied.push({ name: file, checksum: sum, durMs: Math.round(performance.now() - t0) });
  }
  return { applied, skipped };
}
