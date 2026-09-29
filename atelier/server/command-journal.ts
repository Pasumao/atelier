/**
 * command-journal.ts — command 审计 journal 持久层（FS-DESIGN §3.5 落地注记，2026-09-28 差距批 B5；
 * 决策 29：command journal 持久化 = **追加事件表** `atelier_command_journal`——迁移 journal
 * `atelier_migration_journal`（决策 21）同款模式：追加式 / 惰性建表 / 框架自管**不进应用迁移
 * 序列**（应用 schema.ts 不感知）/ 一行 = 一次事件非当前态。
 *
 * 与内存环形（EndpointRegistry.journalBuf）的关系：**增益层不是替代**——journalPush 单源
 * 脱敏后内存与持久表各写一份；无 db / `persist:false` / 落库失败 / 读路径表不存在或读失败时
 * 回落内存环形（现状零变化）。introspect 读路径（introspect.ts）有持久表时改读库尾部 N 条
 * ——dev 面 review 三源时间轴 / MCP endpoint.* 族自动获得持久行（消费的仍是同形条目）。
 *
 * 表（schema 固定，列形状 = 内存条目 EndpointJournalEntry 的持久镜像；字段名勿改）：
 *   atelier_command_journal(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
 *     endpoint TEXT NOT NULL, principal TEXT, dur_ms INTEGER,
 *     status TEXT NOT NULL CHECK(status IN ('ok','failed')), payload TEXT, error TEXT, notes TEXT)
 * 列 ↔ 内存条目投影（introspect 读路径逐字段逆向，两处注释互指）：
 *   ts(ms epoch) ↔ ts(ISO 串) · endpoint ↔ name · （无列——表只收 command）↔ kind 恒 "command" ·
 *   payload(脱敏后 input JSON) ↔ input(JSON.parse) · status ↔ status · principal ↔ principal ·
 *   dur_ms ↔ durMs · error(失败摘要 JSON，超 2KB 降级 code+截断 message) ↔ error? ·
 *   notes(JSON 数组，非空才落) ↔ notes?。
 *
 * 诚实边界（§3.5 落地注记同文）：
 * - journal 是库内追加史——**库删即史灭**（同迁移 journal 口径）；行数基裁剪（写时惰性，保最新
 *   maxRows 缺省 1 万）意味着最老事件滚出窗口即不可查；时间基裁剪 v1 不做。
 * - 只收 command 条目：live 引擎的 query 重算失败条目（ATR-321）是诊断非命令审计，留在内存环形
 *   （endpoints.ts journalPush 的 kind 守卫——表名与 status CHECK 语义都是 command 域）。
 * - 落库失败 = console.warn 降级不抛（审计不挡业务，D-F12 失败入账语义延伸到持久层——failed
 *   条目照写；写不进时该条只存内存环形，不掩盖原始 command 结果）。
 * - 并发分发交叉时 journal 自身的 INSERT/DELETE 可能记入其他活跃写捕获槽（sqlite.ts 捕获槽
 *   "宁多勿漏"哲学）：后果至多一次幂等重算，无正确性影响；ok 路径已把收槽移到 journal 入账
 *   **之前**（endpoints.ts 顺序注记）——本 command 自身的失效键永不混入框架表（红检：
 *   tests/journal-persist.test.ts 收槽顺序用例，onCommandSuccess 键面断言）。
 * - prod 语义不变：journal 照写（审计是安全语义非 dev 语义，§3.7）；server-status 调试面 prod
 *   隐身不变——表在库里，可经备份/SQL 审计直达。
 */
import type { AtrError } from "../runtime/contract.ts";
import type { EndpointJournalEntry } from "./endpoints.ts";

export const COMMAND_JOURNAL_TABLE = "atelier_command_journal";

/** 追加事件表 DDL（惰性建表 IF NOT EXISTS——旧库首条 command 自动获得，向后兼容零迁移） */
export const COMMAND_JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS atelier_command_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  principal TEXT,
  dur_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('ok','failed')),
  payload TEXT,
  error TEXT,
  notes TEXT
)`;

/** 行数基保留窗口缺省值（决策 29：行数基不做时间基——v1 简化，诚实边界） */
export const DEFAULT_COMMAND_JOURNAL_MAX_ROWS = 10_000;

/** error 列截断上限（≈2KB）：完整 AtrError JSON 超限时降级为 code + 截断 message 摘要 */
export const COMMAND_JOURNAL_ERROR_MAX_CHARS = 2048;

/** 装配项（endpoints.ts createHandler({ journal })）：persist 缺省 = db 已装配即 true */
export type CommandJournalPersistOptions = {
  /** 缺省 = db 已装配即 true（开箱即得持久审计面）；false = 显式关闭回纯内存 */
  persist?: boolean;
  /** 行数基保留窗口（缺省 1 万；写时惰性裁最老） */
  maxRows?: number;
};

/** journal 持久写口（endpoints.ts journalPush 持有；append 抛错由调用方降级） */
export type CommandJournalSink = {
  append(entry: EndpointJournalEntry): void;
};

/** error 列值：完整 AtrError JSON；超 2KB 降级为 { code, message(截断) } 摘要——JSON 恒合法，不落半截串 */
function errorColumnValue(error: AtrError | undefined): string | null {
  if (error == null) return null;
  const full = JSON.stringify(error);
  if (full.length <= COMMAND_JOURNAL_ERROR_MAX_CHARS) return full;
  const suffix = "…（journal 落库截断）";
  const keep = { code: error.code, message: "" };
  const shellLen = JSON.stringify(keep).length + suffix.length;
  keep.message = error.message.slice(0, Math.max(0, COMMAND_JOURNAL_ERROR_MAX_CHARS - shellLen)) + suffix;
  return JSON.stringify(keep);
}

/** notes 列值：JSON 数组（非空才落——内存条目 notes 位"非空才携带"同款纪律） */
function notesColumnValue(notes: string[] | undefined): string | null {
  if (notes == null || notes.length === 0) return null;
  return JSON.stringify(notes);
}

/**
 * 持久写口工厂（createHandler 装配，db = 装配句柄）：惰性建表（首条 command 时）+ 追加写 +
 * 行数基惰性裁剪。裁剪法：AUTOINCREMENT 单调 → 「保最新 maxRows」≡「删 id ≤ lastId − maxRows」
 * （主键点删，廉价且确定性——每次写后不变式成立，无周期窗口期超限）。
 * 抛错语义：任何一步失败原样上抛，由 endpoints.ts journalPush 统一 console.warn 降级。
 */
export function createCommandJournalSink(db: { exec(sql: string): void; prepare(sql: string): { run(...params: unknown[]): { lastInsertRowid: number | bigint } } }, opts: { maxRows?: number } = {}): CommandJournalSink {
  const maxRows = Math.max(1, Math.trunc(opts.maxRows ?? DEFAULT_COMMAND_JOURNAL_MAX_ROWS));
  let tableReady = false;
  let lastId = 0;
  return {
    append(entry: EndpointJournalEntry): void {
      if (!tableReady) {
        db.exec(COMMAND_JOURNAL_DDL);
        tableReady = true;
      }
      const payload = entry.input === undefined ? null : JSON.stringify(entry.input);
      // ts 列取条目自身 ts 的毫秒投影（ISO → ms 往返无损：toISOString 恰毫秒精度）——
      // introspect 读回的 ts 与内存条目逐字同值（而非写库时刻的第二次取时，两源单值）。
      const parsedTs = Date.parse(entry.ts);
      const r = db
        .prepare(
          `INSERT INTO ${COMMAND_JOURNAL_TABLE} (ts, endpoint, principal, dur_ms, status, payload, error, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          Number.isFinite(parsedTs) ? parsedTs : Date.now(),
          entry.name,
          entry.principal ?? null,
          entry.durMs ?? null,
          entry.status,
          payload,
          errorColumnValue(entry.error),
          notesColumnValue(entry.notes)
        );
      lastId = Math.max(lastId, Number(r.lastInsertRowid ?? 0));
      if (lastId > maxRows) {
        db.prepare(`DELETE FROM ${COMMAND_JOURNAL_TABLE} WHERE id <= ?`).run(lastId - maxRows);
      }
    },
  };
}

/** db 句柄最小结构面（只读子集——introspect.ts ReadableDb 同形，读路径不要求全量 SqliteDb） */
type JournalReadableDb = {
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined; all(...params: unknown[]): Record<string, unknown>[] };
};

function safeJsonParse(text: unknown): unknown {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // 半截串（人工损坏等）——投影 input/error 如实 null，绝不抛（读路径零反噬）
  }
}

/** 行 → 内存条目形状投影（字段逐一逆向，见文件头对照表——introspect journal 段形状兼容红线） */
function rowToEntry(r: Record<string, unknown>): EndpointJournalEntry {
  const entry: EndpointJournalEntry = {
    ts: new Date(Number(r.ts)).toISOString(),
    name: String(r.endpoint),
    kind: "command", // 表只收 command（endpoints.ts journalPush kind 守卫）——投影恒命令
    input: safeJsonParse(r.payload),
    status: r.status === "failed" ? "failed" : "ok",
    principal: r.principal == null ? null : String(r.principal),
    durMs: r.dur_ms == null ? 0 : Number(r.dur_ms),
  };
  const notes = safeJsonParse(r.notes);
  if (Array.isArray(notes) && notes.length > 0) entry.notes = notes.map(String);
  const err = safeJsonParse(r.error);
  if (err != null && typeof err === "object" && !Array.isArray(err)) entry.error = err as AtrError;
  return entry;
}

/**
 * 库尾只读（introspect server-status journal 段的数据源）：id 降序取尾再反转为入账序（内存环形
 * 同口径）。表不存在（旧库/未发生 command）= null → 调用方回落内存环形；句柄异常原样上抛 →
 * 调用方 catch 回落（诚实降级，零假数据）。纯读不建表。
 */
export function readCommandJournalTail(db: JournalReadableDb, limit: number): EndpointJournalEntry[] | null {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(COMMAND_JOURNAL_TABLE);
  if (!has) return null;
  const rows = db
    .prepare(`SELECT id, ts, endpoint, principal, dur_ms, status, payload, error, notes FROM ${COMMAND_JOURNAL_TABLE} ORDER BY id DESC LIMIT ?`)
    .all(Math.max(1, Math.trunc(limit)))
    .reverse();
  return rows.map(rowToEntry);
}
