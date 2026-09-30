/**
 * jobs.ts — SQLite 极薄队列 + jobs 运行时 + recurring 定时任务 + 幂等键 KV（FS-DESIGN §5.6，
 * 2026-09-28 差距批 A1/A4 候选转落地；依据 docs/research/2026-09-28-fullstack-feature-gap.md §2）。
 * 零新依赖：worker = 本模块内的自适应轮询循环，表 = 两张框架自管 SQLite 表（惰性建表，同
 * `atelier_migration_journal` 先例——**不进应用迁移序列**，框架升级自建自管，应用 schema.ts 不感知）。
 *
 * 表（schema 固定，introspect/struct 侧若核对按同 schema——字段名勿改）：
 *   atelier_jobs       id/queue/type/payload(JSON)/status(pending|running|done|failed)/priority/
 *                      attempts/max_attempts/run_at(ms epoch)/locked_by/locked_at/last_error/
 *                      created_at/updated_at/recurring_every_ms（NULL=一次性）
 *   atelier_idempotency key(PK)/value(JSON TEXT)/expires_at(NULL=永不过期)/created_at —— A4 幂等键
 *
 * 原子取出（River 设计清单教材，FS-DESIGN §5.6 sketch 兑现）：**单条 UPDATE ... RETURNING**
 * （SQLite ≥3.35，2021-03；实机验证 node 24.18 = SQLite 3.53.1 / Bun 1.4.2 = SQLite 3.53.2 均支持）。
 * **两宿主行为差异锁死本文件**：宿主 SQLite <3.35 时自动降级两步法——SELECT 候选 →
 * UPDATE ... WHERE id=? AND status='pending' 守卫（受影响行数=0 = 被其他 worker 抢走，换下一候选），
 * 守卫列语义与 RETURNING 单条完全一致；版本探测启动时做一次（SELECT sqlite_version()）。
 *
 * 装配 = startJobs({ db, handlers, cron?, poll?, lockTimeoutMs?, backoffMs? }) → { enqueue, stop,
 * prune, kv, stats }：db 参数即 **worker 连接**（独立于端点请求连接也正确——busy_timeout=5000 由
 * sqlite.ts openSqlite 统一 PRAGMA 保证跨连接写等待）；ctx.jobs.enqueue（endpoints.ts 装配）走
 * ctx.db 同连接 → `ctx.db.tx(() => { 业务写; ctx.jobs.enqueue(...) })` 投递与业务写**同一事务原子**。
 *
 * recurring（FS-DESIGN §5.6「定时任务/cron」位）：cron 行也是 jobs 行，type = `cron:<name>`（运行时
 * 保留前缀，用户 enqueue 用它 = ATR-350）；handler 完成后立即重排下一次（run_at = 完成时刻 + everyMs，
 * attempts 归零）；**错过的 misfire 追一次不补差**——run_at 过期行被照常取出执行一次，下一次从完成
 * 时刻起算（不按欠账轮数叠加）。5 字段 cron 表达式 v1 不做（everyMs recurring 覆盖定时场景，诚实边界）。
 *
 * 错误码（3xx 运行时域，紧邻 A2 批 344-346；四登记面：本文件头 + FS-DESIGN §15 总表 +
 * SPEC ERR_CATALOG + atelier-error-codes 技能包）：
 *   ATR-350 jobs 投递参数非法（enqueue/cron：type 非法、payload 不可 JSON 序列化、字段越界、cron: 前缀保留）
 *   ATR-351 幂等键 KV 参数非法（key 空/超长、value 不可 JSON 序列化）
 * 两者均为调用点开发者错误的同步抛错（AtrEndpointError，HTTP 侧走既有 AtrEndpointError 缺省 422 映射）。
 * 「type 未注册 handler」不是 ATR 码面——属运行态配置漂移：走失败退避路径落 last_error（含可用键表）
 * + console.warn 每 type 一次，终态 failed 可内省（诚实可见，不造无人消费的新码）。
 *
 * 诚实边界（§5.6 落地注记同文）：
 * - 单机单进程：worker 串行执行（一次一个 job），无多实例协作语义（跨进程仅靠原子取出不重复投递，
 *   无公平性/优先级跨进程保证）；SQLite 无 LISTEN/NOTIFY——enqueue 唤醒仅同进程即时，跨进程靠轮询。
 * - 轮询自适应：取到活 → busyMs（缺省 50ms）；空闲 → 指数退避（×2）至上限 idleMaxMs（缺省 5s）；
 *   取到活回落。诊断位 currentPollDelay() 供测试/运维观察，不承诺精度。
 * - stop()：停轮询 + 中止在跑 job 的 signal + 等收尾（兜底超时后放行——JS 无法强杀 handler，
 *   与端点 timeout 同款诚实边界）；stop 后 enqueue 仍入库（pending 留待下次启动），不再唤醒轮询。
 * - stale lock：status='running' 且 locked_at < now - lockTimeoutMs（缺省 5 分钟）→ 重置 pending
 *   （attempts 保留）。本进程在跑的 job 不会被自己回收（worker 串行——回收只发生在两 job 间隙）。
 * - prune：清 done/failed 老行（updated_at < now - olderThanMs）；recurring 行死亡（failed）后本进程
 *   不复活，进程重启时 startJobs 保证 cron 行在场（按需重建）——重启自愈、运行期诚实暴露。
 * - 幂等键 KV（A4）是**显式原语**：不自动改 command/idempotent 元数据语义（§3.6 元数据保持纯声明），
 *   handler 显式 setIfAbsent 去重；TTL 过期惰性清理（get/setIfAbsent 顺手删，零后台扫描）。
 * - bun 路径 2026-09-28 Bun 1.4.2 win32-x64 实机冒烟通过（enqueue/全链/recurring/取出原子性/kv 全语义面）；
 *   可重复验证口径 = vitest 套件（node 路径）+ bun 下直跑同套件。
 * - MCP/CLI 工具族（jobs.* 工具/call 面）与 review 时间轴接线归后续批（§5.6 落地注记挂账）。
 */
import { randomUUID } from "node:crypto";
import { AtrEndpointError, endpointError } from "./endpoints.ts";
import type { SqliteDb } from "./sqlite.ts";

/* ---------------- 常量与 DDL（框架自管表，惰性建表——不进应用迁移序列） ---------------- */

export const JOBS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS atelier_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  queue TEXT NOT NULL DEFAULT 'default',
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at INTEGER NOT NULL,
  locked_by TEXT,
  locked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  recurring_every_ms INTEGER
)`;

export const JOBS_INDEX_DDL = [
  "CREATE INDEX IF NOT EXISTS idx_atelier_jobs_status_run_at ON atelier_jobs (status, run_at)",
  "CREATE INDEX IF NOT EXISTS idx_atelier_jobs_queue ON atelier_jobs (queue)",
];

export const IDEMPOTENCY_TABLE_DDL = `CREATE TABLE IF NOT EXISTS atelier_idempotency (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
)`;

/** recurring 行 type 前缀（运行时保留；用户 enqueue 命中 = ATR-350） */
export const CRON_TYPE_PREFIX = "cron:";

/** last_error 截断存储上限（可读头部足够导航；全量错误归应用日志） */
export const JOBS_LAST_ERROR_MAX = 2048;

/** 轮询缺省旋钮：忙 50ms / 空闲退避上限 5s（FS-DESIGN §5.6「忙短闲长」缺省口径） */
export const JOBS_DEFAULT_POLL = { busyMs: 50, idleMaxMs: 5_000 } as const;
/** stale lock 缺省超时（5 分钟——比任何合理 handler 都长，只捞崩溃遗留） */
export const JOBS_DEFAULT_LOCK_TIMEOUT_MS = 5 * 60_000;
/** 缺省退避曲线：min(2^attempt × 1s, 60s)（attempt = 已尝试次数，1 起） */
export function defaultJobBackoffMs(attempt: number): number {
  return Math.min(2 ** Math.max(1, attempt) * 1000, 60_000);
}

/* ---------------- 类型面 ---------------- */

export type EnqueueInput = {
  /** 分发键 = handlers 记录键（可 grep、显式）；`cron:` 前缀运行时保留 */
  type: string;
  /** JSON 可序列化载荷（缺省 {}——round-trip 校验，不可序列化 = ATR-350） */
  payload?: unknown;
  /** 队列名（缺省 "default"；v1 worker 全队列消费，queue 是组织/内省维度） */
  queue?: string;
  /** earliest 执行时刻 ms epoch（缺省立即） */
  runAt?: number;
  /** 最大尝试次数（缺省 5；≥1） */
  maxAttempts?: number;
  /** 优先级（缺省 0；大者先出队） */
  priority?: number;
};

export type JobInvocation = {
  type: string;
  /** 存储载荷 JSON.parse 产物 */
  payload: unknown;
  /** 第几次尝试（1 起——含本次） */
  attempt: number;
  /** stop() 时中止（handler 应在安全点响应提前退出；不强杀语义同端点 timeout） */
  signal: AbortSignal;
};

export type JobHandler = (job: JobInvocation) => Promise<void> | void;

export type CronEntry = {
  /** recurring 任务名（type = cron:<name>）；跨重启幂等在场（活跃行已存在则不重建） */
  name: string;
  /** 周期 ms（>0；完成时刻起算） */
  everyMs: number;
  payload?: unknown;
  queue?: string;
};

/** 幂等键 KV 只读/写视图（ctx.kv = 绑定到 ctx.db 的视图；handle.kv = 绑定 worker 连接的视图） */
export type KvView = {
  /** 未命中/已过期 = undefined（过期顺手删行——惰性清理，零后台扫描） */
  get(key: string): unknown;
  /** UPSERT（覆盖 value/expires_at，created_at 保持首次）；ttlMs 缺省 = 永不过期 */
  set(key: string, value: unknown, opts?: { ttlMs?: number }): void;
  /** 原子占领：行在场且未过期 = false（不覆盖）；无行/已过期 = 占领并 true。去重/单飞用 */
  setIfAbsent(key: string, value: unknown, opts?: { ttlMs?: number }): boolean;
};

/** handle.kv 全量面 = worker 连接视图 + bound() 换连接（tx 原子性：与业务写同连接） */
export type KvStore = KvView & { bound(conn: SqliteDb): KvView };

export type JobsStats = {
  counts: { pending: number; running: number; done: number; failed: number };
  /** 尾部 ~20 条（id 升序呈现）；durMs = 执行时长（done/failed 行，updated_at - locked_at） */
  recent: Array<{ id: number; type: string; queue: string; status: string; attempts: number; durMs: number | null; ts: number }>;
};

/** ctx 绑定视图（endpoints.ts createHandler 组装——enqueue 固定经 ctx.db 同连接执行，tx 原子投递） */
export type BoundJobs = { enqueue(job: EnqueueInput): { id: number } };

export type JobsHandle = {
  /**
   * 投递一条 job。conn 缺省 = worker 连接；**显式传连接时经它执行 INSERT**——endpoints.ts 的
   * ctx.jobs 固定传 ctx.db，从而 `ctx.db.tx(() => { 业务写; enqueue(...) })` 内投递与业务写
   * 同一事务原子（tx 抛错 job 行一并回滚；SQLite 同连接语义天然成立）。
   * 参数非法同步抛 ATR-350（调用点开发者错误，fail loudly 不静默改写）。
   */
  enqueue(job: EnqueueInput, conn?: SqliteDb): { id: number };
  /** 优雅停机：停轮询 + 中止在跑 job signal + 等收尾（timeoutMs 兜底，缺省 5s）；幂等 */
  stop(opts?: { timeoutMs?: number }): Promise<void>;
  /** 清 done/failed 且 updated_at < now - olderThanMs 的行；返回清除行数 */
  prune(opts: { olderThanMs: number }): number;
  /** 幂等键 KV（A4 显式原语；绑定 worker 连接——端点侧经 ctx.kv 用 ctx.db 视图） */
  kv: KvStore;
  /** 内省数据源（introspect.ts server-status jobs 段；诊断用途） */
  stats(): JobsStats;
  /** 诊断位：当前下一次 tick 的计划间隔 ms（忙 = busyMs；空闲指数退避至 idleMaxMs） */
  currentPollDelay(): number;
};

export type StartJobsOptions = {
  /** worker 连接（轮询/取出/执行用；端点请求连接可不同——跨连接正确性由原子取出保证） */
  db: SqliteDb;
  /** 分发键表：type → handler；未注册 type 走失败退避路径（last_error 指认，绝不静默吞行） */
  handlers: Record<string, JobHandler>;
  /** recurring 定时任务声明（cron:<name> 行保证在场；活跃行已存在则幂等跳过） */
  cron?: CronEntry[];
  /** 轮询旋钮：busyMs 缺省 50 / idleMaxMs 缺省 5000 */
  poll?: { busyMs?: number; idleMaxMs?: number };
  /** stale lock 超时（缺省 5 分钟） */
  lockTimeoutMs?: number;
  /** 退避曲线（缺省 min(2^attempt × 1s, 60s)） */
  backoffMs?: (attempt: number) => number;
  /** 时钟注入（缺省 Date.now——测试/确定性场景可换） */
  now?: () => number;
};

/* ---------------- 参数校验（ATR-350/351，调用点同步抛错） ---------------- */

function fail350(message: string, fix: string): AtrEndpointError {
  return new AtrEndpointError(endpointError("ATR-350", message, fix));
}
function fail351(message: string, fix: string): AtrEndpointError {
  return new AtrEndpointError(endpointError("ATR-351", message, fix));
}

/** JSON 序列化校验单源：不可序列化（undefined 产物/循环引用/抛错）→ 携带域别名的 ATR 错误 */
function jsonStringifyChecked(value: unknown, code: 350 | 351, domain: string): string {
  let s: string | undefined;
  try {
    s = JSON.stringify(value === undefined ? {} : value);
  } catch (e) {
    throw (code === 350 ? fail350 : fail351)(
      `${domain}不可 JSON 序列化（${(e as Error)?.message ?? String(e)}）`,
      `${domain}改为可 JSON 序列化的纯数据（函数/Symbol/BigInt/循环引用均不行——存储面是 TEXT JSON）`
    );
  }
  if (s === undefined) {
    throw (code === 350 ? fail350 : fail351)(
      `${domain}不可 JSON 序列化（序列化产物为 undefined）`,
      `${domain}改为可 JSON 序列化的纯数据（函数/Symbol/BigInt 均不行——存储面是 TEXT JSON）`
    );
  }
  return s;
}

function assertJobType(type: unknown): string {
  if (typeof type !== "string" || type.length === 0 || type.length > 256 || /[\u0000-\u001f]/.test(type)) {
    throw fail350(
      `enqueue type 非法：${typeof type === "string" ? `长度 ${type.length}` : typeof type}（须为 1~256 字符且不含控制字符的非空字符串）`,
      "type 是 handlers 的分发键（可 grep、显式）：如 \"mail.welcome\"；自定义任务勿用 cron: 前缀（运行时保留）"
    );
  }
  return type;
}

function assertQueue(queue: unknown): string {
  if (typeof queue !== "string" || queue.length === 0 || queue.length > 64) {
    throw fail350(`enqueue queue 非法：${typeof queue}（须为 1~64 字符字符串）`, "queue 是组织/内省维度（缺省 \"default\"）");
  }
  return queue;
}

/** kv key 校验（ATR-351）：非空字符串 ≤512 */
function assertKvKey(key: unknown): string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw fail351(
      `幂等键 key 非法：${typeof key === "string" ? `长度 ${key.length}` : typeof key}（须为 1~512 字符的非空字符串）`,
      "key 用稳定业务标识（如 \"pay:<orderId>\"）；A4 去重纪律：setIfAbsent 占领 → 业务执行 → set 落结果"
    );
  }
  return key;
}

function truncateError(msg: string): string {
  return msg.length > JOBS_LAST_ERROR_MAX ? msg.slice(0, JOBS_LAST_ERROR_MAX) : msg;
}

/* ---------------- 取出 SQL（两宿主行为差异锁死本文件） ---------------- */

/** 取出序（契约钉死）：pending 且到期 → priority DESC（大者优先）→ run_at ASC（同级先到先执行）→ id ASC（确定性 tiebreak） */
const CANDIDATE_ORDER_BY = "ORDER BY priority DESC, run_at ASC, id ASC";
const CANDIDATE_WHERE = "status = 'pending' AND run_at <= ?";

/** 主路径：单条 UPDATE ... RETURNING（SQLite ≥3.35——原子取出与落锁一步完成） */
const CLAIM_RETURNING_SQL = `UPDATE atelier_jobs
  SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ?
  WHERE id = (SELECT id FROM atelier_jobs WHERE ${CANDIDATE_WHERE} ${CANDIDATE_ORDER_BY} LIMIT 1)
  RETURNING id, type, queue, payload, priority, attempts, max_attempts, recurring_every_ms`;

/** 兜底路径（宿主 SQLite <3.35）：两步法——SELECT 候选 → 带守卫 UPDATE（0 行 = 被抢，换下一候选） */
const CLAIM_CANDIDATE_SQL = `SELECT id FROM atelier_jobs WHERE ${CANDIDATE_WHERE} ${CANDIDATE_ORDER_BY} LIMIT 1`;
const CLAIM_GUARD_SQL = `UPDATE atelier_jobs
  SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ?
  WHERE id = ? AND status = 'pending'`;

type ClaimedRow = {
  id: number;
  type: string;
  queue: string;
  payload: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  recurring_every_ms: number | null;
};

function toClaimedRow(r: Record<string, unknown>): ClaimedRow {
  return {
    id: Number(r.id),
    type: String(r.type),
    queue: String(r.queue),
    payload: String(r.payload),
    priority: Number(r.priority),
    attempts: Number(r.attempts),
    max_attempts: Number(r.max_attempts),
    recurring_every_ms: r.recurring_every_ms == null ? null : Number(r.recurring_every_ms),
  };
}

/** 宿主 SQLite ≥3.35 探测（UPDATE...RETURNING 门槛版本，2021-03）；探测失败按不支持兜底 */
function sqliteSupportsReturning(db: SqliteDb): boolean {
  try {
    const row = db.prepare("SELECT sqlite_version() AS v").get() as { v?: unknown } | undefined;
    const v = String(row?.v ?? "0");
    const [maj = 0, min = 0, pat = 0] = v.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return maj > 3 || (maj === 3 && (min > 35 || (min === 35 && pat >= 0)));
  } catch {
    return false;
  }
}

/* ---------------- startJobs ---------------- */

/**
 * 装配 jobs 运行时（同步——db 句柄由调用方注入，本函数不负责开连接）：
 * 惰性建表（IF NOT EXISTS，零迁移）→ cron 行保证在场 → 启动轮询循环 → 返回句柄。
 * 错误：cron 声明非法 / enqueue 参数非法 = ATR-350；其余 SQLite 异常原样上抛（fail loudly）。
 */
export function startJobs(opts: StartJobsOptions): JobsHandle {
  const db = opts.db;
  const handlers = opts.handlers ?? {};
  const now = opts.now ?? (() => Date.now());
  const busyMs = Math.max(1, opts.poll?.busyMs ?? JOBS_DEFAULT_POLL.busyMs);
  const idleMaxMs = Math.max(busyMs, opts.poll?.idleMaxMs ?? JOBS_DEFAULT_POLL.idleMaxMs);
  const lockTimeoutMs = Math.max(1, opts.lockTimeoutMs ?? JOBS_DEFAULT_LOCK_TIMEOUT_MS);
  const backoffMs = opts.backoffMs ?? defaultJobBackoffMs;
  const workerId = `jobs-${process.pid}-${randomUUID().slice(0, 8)}`;

  // ---- 惰性建表（同 atelier_migration_journal 先例：框架自管，不进应用迁移序列）----
  db.exec(JOBS_TABLE_DDL);
  for (const ddl of JOBS_INDEX_DDL) db.exec(ddl);
  db.exec(IDEMPOTENCY_TABLE_DDL);

  // ---- cron 行保证在场（幂等：活跃行 [pending|running] 已存在则不动——重启自愈死亡行，运行期不复活）----
  for (const c of opts.cron ?? []) {
    if (typeof c.name !== "string" || c.name.length === 0 || c.name.length > 128 || /[\u0000-\u001f]/.test(c.name)) {
      throw fail350(`cron name 非法：${typeof c.name}（须为 1~128 字符且不含控制字符）`, "cron name 是 type cron:<name> 的显式组成部分（可 grep）");
    }
    if (!Number.isInteger(c.everyMs) || c.everyMs <= 0) {
      throw fail350(`cron ${c.name} everyMs 非法：${String(c.everyMs)}（须为正整数 ms）`, "everyMs 是周期时长（完成时刻起算）；5 字段 cron 表达式 v1 不做——everyMs recurring 覆盖定时场景");
    }
    const payloadSql = jsonStringifyChecked(c.payload ?? {}, 350, `cron ${c.name} payload`);
    const queue = c.queue != null ? assertQueue(c.queue) : "default";
    const type = `${CRON_TYPE_PREFIX}${c.name}`;
    const active = db.prepare("SELECT id FROM atelier_jobs WHERE type = ? AND recurring_every_ms IS NOT NULL AND status IN ('pending','running') LIMIT 1").get(type);
    if (!active) {
      const t = now();
      db.prepare(
        "INSERT INTO atelier_jobs (type, queue, payload, status, priority, attempts, max_attempts, run_at, created_at, updated_at, recurring_every_ms) VALUES (?, ?, ?, 'pending', 0, 0, 5, ?, ?, ?, ?)"
      ).run(type, queue, payloadSql, t + c.everyMs, t, t, c.everyMs);
    }
  }

  // ---- 轮询循环（自适应：忙短闲长；单 worker 串行执行——诚实边界见文件头）----
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = busyMs; // 下一次 tick 的计划间隔（currentPollDelay 诊断位同源）
  let inFlight: Promise<void> | null = null;
  let currentAbort: AbortController | null = null;
  let wakePending = false; // tick 在跑期间的 enqueue 唤醒请求（tick 收尾兑现为短间隔）
  const warnedTypes = new Set<string>(); // 未注册 type 的 console.warn 每 type 一次（防刷屏）

  function schedule(next: number): void {
    if (stopped) return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, next);
    (timer as unknown as { unref?: () => void }).unref?.(); // 不阻进程退出（CLI/测试场景友好——live.ts 心跳同款）
  }

  /** enqueue 唤醒：空闲退避中的轮询立即回到忙间隔（跨进程无此信号——SQLite 无 LISTEN/NOTIFY，靠轮询兜底） */
  function wake(): void {
    if (stopped) return;
    wakePending = true;
    if (timer != null && inFlight == null) schedule(busyMs);
  }

  /** stale lock 回收：超时 running 行重置 pending（attempts 保留）；只在两 job 间隙运行——不会回收本进程在跑的 job */
  function reclaimStaleLocks(): void {
    db.prepare("UPDATE atelier_jobs SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = ? WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?").run(
      now(),
      now() - lockTimeoutMs
    );
  }

  /** 原子取出一条到期 job（RETURNING 主路径 / 两步法兜底——差异锁死本文件，见 CLAIM_* 注释） */
  function claim(): ClaimedRow | null {
    const t = now();
    if (supportsReturning) {
      const rows = db.prepare(CLAIM_RETURNING_SQL).all(workerId, t, t, t) as Record<string, unknown>[];
      return rows.length > 0 ? toClaimedRow(rows[0]!) : null;
    }
    // 两步法：守卫列（id + status='pending'）保证竞态下零重复投递——0 行 = 被其他 worker 抢走
    for (let i = 0; i < 3; i++) {
      const cand = db.prepare(CLAIM_CANDIDATE_SQL).get(t) as { id: unknown } | undefined;
      if (cand == null) return null;
      const r = db.prepare(CLAIM_GUARD_SQL).run(workerId, t, t, Number(cand.id));
      if (r.changes === 1) {
        const row = db.prepare("SELECT id, type, queue, payload, priority, attempts, max_attempts, recurring_every_ms FROM atelier_jobs WHERE id = ?").get(Number(cand.id)) as Record<string, unknown>;
        return toClaimedRow(row);
      }
    }
    return null; // 连续被抢——本 tick 放弃，下 tick 再来（忙间隔内自然重试）
  }

  /** 执行一条 job：成功 → done / recurring 重排（完成时刻 + everyMs，attempts 归零）；失败 → 退避或 failed 终态 */
  async function runJob(row: ClaimedRow): Promise<void> {
    currentAbort = new AbortController();
    try {
      // P2-S2（2026-09-30 第三遍架构复校）：hasOwn 判未注册——handlers 是普通对象字面量，裸下标
      // 访问走原型链，type:"constructor"/"toString"/"valueOf" 会取到继承可调用对象（handler==null
      // 闸被穿透 → 调用成功假象 → 任务零执行落 done 假成功）。只认自有键：原型链键一律落下方
      // 未注册失败路径（last_error 指认 + 每 type 一次 warn——「绝不静默吞行」承诺对齐）。
      const handler = Object.hasOwn(handlers, row.type) ? handlers[row.type] : undefined;
      if (handler == null) {
        // 运行态配置漂移（非 ATR 码面）：走失败路径落 last_error + 每 type 一次 warn（诚实可见）
        const keys = Object.keys(handlers);
        if (!warnedTypes.has(row.type)) {
          warnedTypes.add(row.type);
          console.warn(`[atelier/jobs] type 未注册 handler：${row.type}（可用 handlers 键：${keys.join(", ") || "（无）"}）——投递前先在 startJobs({ handlers }) 登记；退避重试直至 max_attempts 终态 failed`);
        }
        throw new Error(`type 未注册 handler：${row.type}（可用 handlers 键：${keys.join(", ") || "（无）"}——在 startJobs({ handlers }) 登记后重启即恢复）`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        throw new Error(`payload 不是合法 JSON（存储损坏或非本运行时写入）：${row.payload.slice(0, 100)}`);
      }
      await handler({ type: row.type, payload, attempt: row.attempts, signal: currentAbort.signal });
      const t = now();
      if (row.recurring_every_ms != null) {
        // recurring：完成即重排下一次（从完成时刻起算 → misfire 天然「追一次不补差」）；attempts 归零换新预算。
        // locked_at 保留（历史取出时刻——内省 durMs = updated_at - locked_at 的数据源）；locked_by 清（锁已释放）。
        db.prepare("UPDATE atelier_jobs SET status = 'pending', run_at = ?, attempts = 0, last_error = NULL, locked_by = NULL, updated_at = ? WHERE id = ?").run(
          t + row.recurring_every_ms,
          t,
          row.id
        );
      } else {
        db.prepare("UPDATE atelier_jobs SET status = 'done', last_error = NULL, locked_by = NULL, updated_at = ? WHERE id = ?").run(t, row.id);
      }
    } catch (e) {
      const t = now();
      const msg = truncateError((e as Error)?.message ?? String(e));
      if (row.attempts >= row.max_attempts) {
        // 终态：failed（recurring 行同此——死亡诚实可见，进程重启时 cron 行按需重建自愈）
        db.prepare("UPDATE atelier_jobs SET status = 'failed', last_error = ?, locked_by = NULL, updated_at = ? WHERE id = ?").run(msg, t, row.id);
      } else {
        // 退避重试：run_at = now + backoff(attempt)（指数曲线，缺省 min(2^attempt × 1s, 60s)）
        db.prepare("UPDATE atelier_jobs SET status = 'pending', run_at = ?, last_error = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?").run(
          t + backoffMs(row.attempts),
          msg,
          t,
          row.id
        );
      }
    } finally {
      currentAbort = null;
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    let got = false;
    try {
      reclaimStaleLocks();
      const row = claim();
      if (row != null) {
        got = true;
        inFlight = runJob(row);
        await inFlight;
        inFlight = null;
      }
    } catch (e) {
      // 轮询体自身异常（库句柄坏/存储损坏等）：不炸 unhandled rejection——记 stderr 后退避再试（fail visible）
      console.error(`[atelier/jobs] 轮询 tick 异常（退避重试）：${(e as Error)?.message ?? String(e)}`);
      got = false;
    } finally {
      inFlight = null;
    }
    if (stopped) return;
    if (wakePending) {
      wakePending = false; // tick 期间有 enqueue → 下一 tick 回忙间隔（投递低延迟优先）
      delay = busyMs;
    } else {
      delay = got ? busyMs : Math.min(delay * 2, idleMaxMs); // 取到活回落忙间隔；空闲指数退避至上限
    }
    schedule(delay);
  }

  const supportsReturning = sqliteSupportsReturning(db);

  schedule(busyMs); // 启动轮询（首 tick 在 busyMs 后——装配同步返回，循环异步展开）

  // ---- 幂等键 KV（A4 显式原语）：conn 可换（bound）——与业务写同连接才有 tx 原子性 ----
  function kvGet(conn: SqliteDb, key: string): unknown {
    const k = assertKvKey(key);
    const row = conn.prepare("SELECT value, expires_at FROM atelier_idempotency WHERE key = ?").get(k);
    if (row == null) return undefined;
    if (row.expires_at != null && Number(row.expires_at) <= now()) {
      conn.prepare("DELETE FROM atelier_idempotency WHERE key = ?").run(k); // 过期惰性清理（零后台扫描）
      return undefined;
    }
    return JSON.parse(String(row.value));
  }
  function kvSet(conn: SqliteDb, key: string, value: unknown, ttlMs?: number): void {
    const k = assertKvKey(key);
    const v = jsonStringifyChecked(value, 351, "幂等键 value");
    const t = now();
    const exp = ttlMs != null ? t + ttlMs : null;
    // UPSERT：覆盖 value/expires_at；created_at 保持首次（Do UPDATE 不触碰该列）
    conn.prepare("INSERT INTO atelier_idempotency (key, value, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at").run(k, v, exp, t);
  }
  function kvSetIfAbsent(conn: SqliteDb, key: string, value: unknown, ttlMs?: number): boolean {
    const k = assertKvKey(key);
    const v = jsonStringifyChecked(value, 351, "幂等键 value");
    const t = now();
    conn.prepare("DELETE FROM atelier_idempotency WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?").run(k, t); // 过期行让位（惰性）
    const exp = ttlMs != null ? t + ttlMs : null;
    const r = conn.prepare("INSERT INTO atelier_idempotency (key, value, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING").run(k, v, exp, t);
    return r.changes === 1; // 0 = 已在场未过期（占领失败，不覆盖）
  }

  const workerKv: KvStore = {
    get: (key) => kvGet(db, key),
    set: (key, value, o) => kvSet(db, key, value, o?.ttlMs),
    setIfAbsent: (key, value, o) => kvSetIfAbsent(db, key, value, o?.ttlMs),
    bound: (conn: SqliteDb) => ({
      get: (key) => kvGet(conn, key),
      set: (key, value, o) => kvSet(conn, key, value, o?.ttlMs),
      setIfAbsent: (key, value, o) => kvSetIfAbsent(conn, key, value, o?.ttlMs),
    }),
  };

  return {
    enqueue(job: EnqueueInput, conn?: SqliteDb): { id: number } {
      const type = assertJobType(job?.type);
      if (type.startsWith(CRON_TYPE_PREFIX)) {
        throw fail350(
          `enqueue type 使用了运行时保留前缀：${type}`,
          "cron:<name> 行由 startJobs({ cron }) 装配管理——自定义任务换无 cron: 前缀的显式 type"
        );
      }
      const payloadSql = jsonStringifyChecked(job?.payload ?? {}, 350, "enqueue payload");
      const queue = job?.queue != null ? assertQueue(job.queue) : "default";
      if (job?.runAt != null && (!Number.isFinite(job.runAt) || job.runAt < 0)) {
        throw fail350(`enqueue runAt 非法：${String(job.runAt)}（须为非负 ms epoch）`, "runAt 是 earliest 执行时刻（ms epoch）；立即执行省略该字段");
      }
      if (job?.maxAttempts != null && (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1 || job.maxAttempts > 1000)) {
        throw fail350(`enqueue maxAttempts 非法：${String(job.maxAttempts)}（须为 1~1000 整数）`, "maxAttempts 是失败重试预算（缺省 5）；超限即 failed 终态");
      }
      if (job?.priority != null && (!Number.isInteger(job.priority) || Math.abs(job.priority) > 1e9)) {
        throw fail350(`enqueue priority 非法：${String(job.priority)}（须为整数）`, "priority 大者先出队（缺省 0）");
      }
      const t = now();
      const r = (conn ?? db).prepare(
        "INSERT INTO atelier_jobs (type, queue, payload, status, priority, attempts, max_attempts, run_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?)"
      ).run(type, queue, payloadSql, job?.priority ?? 0, job?.maxAttempts ?? 5, job?.runAt ?? t, t, t);
      wake(); // 空闲退避中的轮询立即回忙间隔（同进程投递低延迟；跨进程靠轮询兜底）
      return { id: Number(r.lastInsertRowid) };
    },
    async stop(run: { timeoutMs?: number } = {}): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      currentAbort?.abort(); // 在跑 job 的 signal 中止（handler 安全点自行退出——不强杀）
      if (inFlight != null) {
        const timeoutMs = Math.max(0, run.timeoutMs ?? 5000);
        await Promise.race([
          inFlight.catch(() => {}), // job 自身失败路径已落账——停机不为它抛
          new Promise<void>((r) => setTimeout(r, timeoutMs)),
        ]);
      }
    },
    prune(run: { olderThanMs: number }): number {
      if (!Number.isFinite(run?.olderThanMs) || run.olderThanMs < 0) {
        throw fail350(`prune olderThanMs 非法：${String(run?.olderThanMs)}（须为非负数 ms）`, "olderThanMs 是保留窗口：updated_at 早于 now - olderThanMs 的 done/failed 行被清除");
      }
      const r = db.prepare("DELETE FROM atelier_jobs WHERE status IN ('done','failed') AND updated_at < ?").run(now() - run.olderThanMs);
      return r.changes;
    },
    kv: workerKv,
    stats(): JobsStats {
      const counts = { pending: 0, running: 0, done: 0, failed: 0 };
      for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM atelier_jobs GROUP BY status").all() as Record<string, unknown>[]) {
        const s = String(r.status);
        if (s in counts) counts[s as keyof typeof counts] = Number(r.n);
      }
      const recent = (db.prepare("SELECT id, type, queue, status, attempts, locked_at, updated_at FROM atelier_jobs ORDER BY id DESC LIMIT 20").all() as Record<string, unknown>[])
        .reverse()
        .map((r) => {
          const status = String(r.status);
          const terminal = status === "done" || status === "failed";
          return {
            id: Number(r.id),
            type: String(r.type),
            queue: String(r.queue),
            status,
            attempts: Number(r.attempts),
            // durMs = 执行时长（仅终态行：updated_at - locked_at 取出时刻；locked_at 在完成时保留为历史取出时刻）
            durMs: terminal && r.locked_at != null ? Math.max(0, Number(r.updated_at) - Number(r.locked_at)) : null,
            ts: Number(r.updated_at),
          };
        });
      return { counts, recent };
    },
    currentPollDelay(): number {
      return delay;
    },
  };
}
