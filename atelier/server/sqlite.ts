/**
 * SQLite 薄宿主适配（决策 19，FS-3 基座）。
 * bun:sqlite（Bun）/ node:sqlite（Node ≥22.5）双宿主均零依赖内建；两套 API 形状差异
 * **锁死在本文件**（prepare/run/all/get 四原语量级），上层只见 SqliteDb 接口——与 dev 面
 * 多运行时 vendor 策略同构。决策 19 红线：不引 libSQL（维护态）、不用 Bun.SQL 多方言
 * 统一 API；**参数化是唯一路径**（无字符串拼接逃生门，Kysely CVE-2026-33442 教训）。
 * 诚实边界：本环境（Node 24，无 Bun）只能集成测试 node 路径；bun 路径以 API 形状
 * 对照 bun:sqlite 官方文档实现（Database/Statement.run/all/get 同名同义），待 Bun 环境
 * 回归（FS-3 剩余项挂 BACKLOG）。
 */

export type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

export interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  /**
   * 事务包裹（FS-DESIGN §5.5，FS-M2(m2b) 加法扩展——既有四原语不动）：
   * BEGIN IMMEDIATE / COMMIT / ROLLBACK；fn 同步或 async 均支持（异常回滚后原样 rethrow），
   * fn 收到的 tx 视图即同一 SqliteDb（四原语直用）。诚实边界：不支持嵌套（SQLite 无嵌套
   * 事务——fn 内再 tx 直接 SQLITE 报错，显式失败优于隐式合并）；async fn 挂起期间同句柄
   * 被并发使用会破坏原子性（单进程串行使用约定——command handler 是事务边界建议位）。
   */
  tx<T>(fn: (tx: SqliteDb) => T | Promise<T>): Promise<T>;
  close(): void;
  /** 宿主标识（bun/node），诊断与测试用 */
  readonly host: "bun" | "node";
}

/** tx 共享实现（bun/node 同形状——宿主差异只在 prepare/exec 的底层来源，此处锁零差异） */
async function runTx<T>(view: SqliteDb, exec: (sql: string) => void, fn: (tx: SqliteDb) => T | Promise<T>): Promise<T> {
  exec("BEGIN IMMEDIATE");
  try {
    const out = await fn(view);
    exec("COMMIT");
    return out;
  } catch (e) {
    try {
      exec("ROLLBACK");
    } catch {
      /* ROLLBACK 本身失败（连接已坏）——不掩盖原始错误 */
    }
    throw e;
  }
}

/** 无可用 SQLite 宿主（决策 9 四段式；HTTP 面映射 500 由分发层负责） */
export class SqliteUnavailableError extends Error {
  readonly code = "ATR-330";
  readonly fix: string;
  constructor(detail: string) {
    super(`无可用 SQLite 宿主（${detail}）`);
    this.fix = "atelier-server 数据层需 Bun（bun:sqlite）或 Node ≥22.5（node:sqlite）——两者均零依赖内建，换运行时即解";
  }
}

interface RawStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export async function openSqlite(path: string): Promise<SqliteDb> {
  const g = globalThis as { Bun?: unknown };
  if (g.Bun) {
    const spec = "bun:sqlite"; // 变量间接 + 动态 import：非 Bun 宿主加载本模块不炸（vite 静态分析跳过）
    const mod = (await import(/* @vite-ignore */ spec)) as { Database: new (path: string) => { prepare(sql: string): RawStatement; exec(sql: string): void; close(): void } };
    const db = new mod.Database(path);
    const handle: SqliteDb = {
      host: "bun",
      prepare: (sql: string) => wrapStatement(db.prepare(sql)),
      exec: (sql: string) => db.exec(sql),
      close: () => db.close(),
      tx: <T,>(fn: (tx: SqliteDb) => T | Promise<T>) => runTx(handle, (sql: string) => db.exec(sql), fn),
    };
    return handle;
  }
  let nodeDb: { prepare(sql: string): RawStatement; exec(sql: string): void; close(): void };
  try {
    const { DatabaseSync } = await import("node:sqlite");
    nodeDb = new (DatabaseSync as new (path: string) => { prepare(sql: string): RawStatement; exec(sql: string): void; close(): void })(path);
  } catch (e) {
    throw new SqliteUnavailableError(`node:sqlite 加载失败：${(e as Error)?.message ?? String(e)}`);
  }
  const handle: SqliteDb = {
    host: "node",
    prepare: (sql: string) => wrapStatement(nodeDb.prepare(sql)),
    exec: (sql: string) => nodeDb.exec(sql),
    close: () => nodeDb.close(),
    tx: <T,>(fn: (tx: SqliteDb) => T | Promise<T>) => runTx(handle, (sql: string) => nodeDb.exec(sql), fn),
  };
  return handle;
}

function wrapStatement(raw: RawStatement): SqliteStatement {
  return {
    run: (...params: unknown[]) => {
      const r = raw.run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: (r.lastInsertRowid ?? 0) as number | bigint };
    },
    all: (...params: unknown[]) => raw.all(...params) as Record<string, unknown>[],
    get: (...params: unknown[]) => raw.get(...params) as Record<string, unknown> | undefined,
  };
}
