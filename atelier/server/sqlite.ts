/**
 * SQLite 薄宿主适配（决策 19，FS-3 基座）。
 * bun:sqlite（Bun）/ node:sqlite（Node ≥22.5 内建；免旗可 import 自 22.13/23.4 起——本适配不注旗，
 * 更低版本须以 --experimental-sqlite 启动）双宿主均零依赖内建；两套 API 形状差异
 * **锁死在本文件**（prepare/run/all/get 四原语量级），上层只见 SqliteDb 接口——与 dev 面
 * 多运行时 vendor 策略同构。决策 19 红线：不引 libSQL（维护态）、不用 Bun.SQL 多方言
 * 统一 API；**参数化是唯一路径**（无字符串拼接逃生门，Kysely CVE-2026-33442 教训）。
 * 诚实边界：bun 路径已回归（2026-09-27，m11 批 B：真实 Bun 1.4.2 win32-x64 下经
 * `bun atelier/scripts/bun-adapter-smoke.mjs` 全语义面验证——四原语/exec/tx 提交回滚/
 * 写捕获槽；红检抓出「无行 get 返回 null ≠ 契约 undefined」真差异并归一修复）。
 * 可重复验证口径 = 该冒烟脚本；node 路径由 vitest 套件常规覆盖。
 * FS-7 加法（live 写侧失效的自动表名启发式，FS-DESIGN §4.1"薄层即可"）：写捕获槽
 * （beginWriteCapture/endWriteCapture）——prepare 时轻量正则提取写目标表、run 真执行时记入
 * 活跃捕获槽；纯加法不改既有四原语语义（无捕获槽时零开销直通）。
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
    this.fix = "atelier-server 数据层需 Bun（bun:sqlite）或 Node ≥22.13（node:sqlite 免旗可 import 的 22.x 首版；22.5~22.12 虽内建但须 --experimental-sqlite 旗，本适配不注旗）——两者均零依赖内建，换运行时/升版即解";
  }
}

interface RawStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

/* ---------------- 写捕获槽（FS-7 live 失效广播的写侧自动表名启发式，FS-DESIGN §4.1"薄层即可"） ----------------
 * 原理：prepare(sql) 时轻量正则提取写目标表（INSERT INTO / REPLACE INTO / UPDATE / DELETE FROM），
 * run() 真执行时才记入当前活跃捕获槽（prepare 而未 run 不算写）；exec(sql) 同口径扫多语句。
 * endpoints.ts 分发器在 command 分发期间 beginWriteCapture() 开槽，收槽后取表名合成 table:<name>
 * 失效键交给 live 引擎广播（显式 emits 声明优先——有 emits 时捕获结果被忽略）；B5（决策 29）起
 * 收槽**先于** journal 入账——command journal 的持久化 INSERT 经同一句柄，槽若仍开着会把
 * atelier_command_journal 混进失效键（顺序注记见 endpoints.ts，红检 tests/journal-persist.test.ts）。
 * 诚实边界（宁多勿漏）：并发分发交叉时写记录并入**所有**活跃槽——多触发一次幂等重算无害，
 * 漏发失效才是 bug；正则不识别 [方括号]/schema 限定名等冷门拼写——这些场景请用显式 emits 声明。 */

export type WriteCapture = { tables: Set<string> };

const WRITE_TABLE_RE =
  /\b(?:INSERT\s+OR\s+[A-Za-z]+\s+INTO|INSERT\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Za-z]+)?|DELETE\s+FROM)\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;

const captureStack: WriteCapture[] = [];

/** 开一个捕获槽（command 分发期间；栈式——并发分发各持各的槽，写记录并入所有活跃槽） */
export function beginWriteCapture(): WriteCapture {
  const c: WriteCapture = { tables: new Set() };
  captureStack.push(c);
  return c;
}

/** 收槽并返回捕获到的表名（排序去重）；槽不存在（重复收/未开）静默幂等 */
export function endWriteCapture(c: WriteCapture): string[] {
  const i = captureStack.indexOf(c);
  if (i >= 0) captureStack.splice(i, 1);
  return [...c.tables].sort();
}

function extractWriteTables(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(WRITE_TABLE_RE)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function recordWrite(tables: string[]): void {
  if (captureStack.length === 0 || tables.length === 0) return;
  for (const c of captureStack) {
    for (const t of tables) c.tables.add(t);
  }
}

/** 打开后统一 PRAGMA（A2 安全收口批）：外键约束真生效 + 忙等让权。
 *  显式统一的原因：两宿主缺省不一致——node:sqlite DatabaseSync 缺省开 foreign_keys，
 *  bun:sqlite/SQLite 本体缺省关；不显式声明则 REFERENCES 在 bun 下只是装饰。
 *  busy_timeout=5000：写锁争用（dev 热重启窗口/多句柄）时等 5s 而非立刻 SQLITE_BUSY 炸错。 */
const OPEN_PRAGMAS = ["PRAGMA foreign_keys = ON", "PRAGMA busy_timeout = 5000"];

export async function openSqlite(path: string): Promise<SqliteDb> {
  const g = globalThis as { Bun?: unknown };
  if (g.Bun) {
    const spec = "bun:sqlite"; // 变量间接 + 动态 import：非 Bun 宿主加载本模块不炸（vite 静态分析跳过）
    const mod = (await import(/* @vite-ignore */ spec)) as { Database: new (path: string) => { prepare(sql: string): RawStatement; exec(sql: string): void; close(): void } };
    const db = new mod.Database(path);
    for (const pragma of OPEN_PRAGMAS) db.exec(pragma); // 运行时单点：migrate/seed/call 等所有经 openSqlite 的路径自动受益
    // exec 归一单点（handle.exec 与 tx 内 exec 同源——tx 直用裸 db.exec 会让归一漏进事务路径）
    const execNormalized = (sql: string): void => {
      recordWrite(extractWriteTables(sql));
      try {
        db.exec(sql);
      } catch (e) {
        // 宿主差异锁死（m11 批 B 真实 Bun 1.4.2 实测后归一）：node:sqlite 对纯注释/空白 SQL
        // 容忍（no-op），bun:sqlite 抛 "Query contained no valid SQL statement"——归一到 node
        // 语义：零可执行语句 = 零效果 no-op（gen db 种子骨架「整文件注释」场景真实撞上，
        // migrate seed 曾在 bun 下 ATR-336 误红）。仅吞该确定性退化输入错误，其余原样上抛
        // （fail-visible）；bun 若改报错文案，差异重新可见而非被静默。
        if (e instanceof Error && /no valid SQL statement/i.test(e.message)) return;
        throw e;
      }
    };
    const handle: SqliteDb = {
      host: "bun",
      prepare: (sql: string) => wrapStatement(db.prepare(sql), extractWriteTables(sql)),
      exec: execNormalized,
      close: () => db.close(),
      tx: <T,>(fn: (tx: SqliteDb) => T | Promise<T>) => runTx(handle, execNormalized, fn),
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
  for (const pragma of OPEN_PRAGMAS) nodeDb.exec(pragma); // 与 bun 路径同一清单（差异锁死本文件）
  const handle: SqliteDb = {
    host: "node",
    prepare: (sql: string) => wrapStatement(nodeDb.prepare(sql), extractWriteTables(sql)),
    exec: (sql: string) => {
      recordWrite(extractWriteTables(sql));
      nodeDb.exec(sql);
    },
    close: () => nodeDb.close(),
    tx: <T,>(fn: (tx: SqliteDb) => T | Promise<T>) => runTx(handle, (sql: string) => nodeDb.exec(sql), fn),
  };
  return handle;
}

function wrapStatement(raw: RawStatement, writeTables: string[]): SqliteStatement {
  return {
    run: (...params: unknown[]) => {
      recordWrite(writeTables); // prepare 而未 run 不算写；真执行时才记入活跃捕获槽
      const r = raw.run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: (r.lastInsertRowid ?? 0) as number | bigint };
    },
    all: (...params: unknown[]) => raw.all(...params) as Record<string, unknown>[],
    get: (...params: unknown[]) => {
      // 宿主差异锁死：node:sqlite 无行返回 undefined，bun:sqlite 返回 null——归一到契约的
      // undefined（m11 批 B 在真实 Bun 1.4.2 下由 bun-adapter-smoke 红检抓出后修复）。
      const row = raw.get(...params);
      return (row === null || row === undefined ? undefined : row) as Record<string, unknown> | undefined;
    },
  };
}
