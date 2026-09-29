/**
 * introspect.ts — server 面运行时内省快照（FS-DESIGN §10.3 D-F16 / §10.1 server.introspect 的数据源）。
 *
 * dev 面（Vite 插件父进程）代理消费：`GET <mount>/__atelier/server-status` 由 endpoints.ts
 * 的分发器在保留路径上调用本模块——端点注册表/journal/live 订阅都活在 server 子进程内，
 * 这是它们唯一的出口（运行时事实，绝不静态猜测）。消费方三处同源：
 *   ① dev 面 /__atelier/server-status（父进程代理 + 补充 restarts/dbPath/host 等父进程侧事实）；
 *   ② MCP endpoint.* 工具族（既有契约见 tests/mcp-endpoint-tools.test.ts 的 canned server-status）；
 *   ③ D-F16 人可读调试页 /__atelier/endpoints（同一数据的人渲染）。
 *
 * 诚实边界：
 * - prod 隐身：调试面不进生产 API 面——`__ATELIER_PROD__` 旗（与 runtime/template.ts、
 *   endpoints.ts 的 prod 剥离同机制）置真时本路由返回 null，分发器落回既有 ATR 路径；
 * - db 段是尽力而为的读侧快照（表清单来自 sqlite_master + PRAGMA，迁移行来自
 *   atelier_migrations 状态表 + 迁移目录扫描）——库句柄未装配/读失败时 db=null + note，
 *   绝不编造空表假象；
 * - journal 段数据源（B5 差距批，决策 29）：db 已装配且 `atelier_command_journal` 表存在 → 读库
 *   尾部 N 条（N = registry.journalLimit，与内存环形同界；条目投影与内存条目字段逐一兼容，
 *   command-journal.ts rowToEntry 单源）——**重启不灭**的 command 审计面；表不存在（旧库/尚无
 *   command）/未装配 db/读失败 → 回落内存环形（零假数据纪律）。内存独有条目 = live 引擎 query
 *   重算失败诊断（ATR-321，决策 29 明确不入持久表）——有持久表时它们不出现在本段，实时面仍是
 *   SSE error 事件。prod 语义不变：journal 照写（审计是安全语义），本调试面 prod 隐身（下方
 *   introspectResponse）——表在库内，可经备份/SQL 审计直达；
 * - 迁移审计（§11.3）：状态表即审计对象（决策 19"迁移即 checkpoint 审计对象"），只有
 *   applied 时刻（applied_at）与名字；down 历史/ principal /durMs 持久于
 *   atelier_migration_journal（决策 21 台账预留位关闭，M6 挂账候选池第二枚——追加式审计史，
 *   migrate.ts 单源写入）；快照只携 journal 尾部（MIGRATION_JOURNAL_TAIL_LIMIT，有界），
 *   全量走库直读（readMigrationJournal / dev-review-data node:sqlite 兜底）。journal 表
 *   不存在（旧库）= ok:false 诚实降级，绝不假数据。
 */
import type { EndpointDef, EndpointRegistry, EndpointSummary } from "./endpoints.ts";
import { endpointError, isLiveDeclared } from "./endpoints.ts";
import { readCommandJournalTail } from "./command-journal.ts";
import { MIGRATION_JOURNAL_TAIL_LIMIT, migrateStatus } from "./migrate.ts";
import type { JobsStats } from "./jobs.ts"; // 仅类型——jobs 段数据经 handle.stats() 窄口取，SQL 单源在 jobs.ts
import type { EmailLogEntry } from "./email.ts"; // 仅类型——email 段数据经 recorder.tail() 窄口取，SQL 单源在 email.ts
import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 保留内省路径（mount 剥离后的 name 精确匹配；与 /live 后缀同款的分发器保留字） */
export const INTROSPECT_NAME = "__atelier/server-status";

/** server-status 单端点行：registry.list() 摘要 + 契约体（endpoint.contract 与调试页 schema 展示的数据源）。
 *  A5 差距批（决策 33）：cache 档位随 EndpointSummary 加法透传——未声明无键（零变化）、
 *  声明 = 值原样（"none" 字符串或 { visibility, maxAge } 对象，诚实呈现）。 */
export type ServerStatusEndpoint = EndpointSummary & { contract: unknown; output: unknown };

/** dev 面 server-status 快照形状（MCP 消费契约的宿主侧单源） */
export type ServerStatusSnapshot = {
  ok: true;
  /** 子进程侧事实：startedAt = 本模块加载时刻（≈ server 进程启动）；restarts/dbPath/host 由 dev 父进程补充 */
  server: { startedAt: string; mount: string; node: string };
  /** 端点全表 */
  endpoints: ServerStatusEndpoint[];
  /** command 审计 journal（成功与失败同源；B5 起有持久表读库尾部——重启不灭，回落内存环形见头注） */
  journal: readonly unknown[];
  /** live 引擎内省：SSE 订阅者总数 + live 端点名 */
  live: { subscriberCount: number; endpoints: string[] };
  /** db 读侧快照（未装配/读失败 = null，note 说明） */
  db: { tables: unknown[]; migrations: unknown } | null;
  dbNote: string | null;
  /**
   * jobs 段（A1/A4 差距批，§5.6；可选位）：各 status 计数 + 尾部 ~20 条。
   * 仅 createHandler({ jobs }) 装配后出现；读失败（表损坏等）= 段缺省——零假数据纪律。
   */
  jobs?: JobsStats;
  /**
   * email 段（B3 差距批，§5.8；可选位）：投递记账尾部 ~20 条六字段投影（id/ts(ISO)/transport/
   * to/subject/status——不含 payload/error，调试面最小呈现；全量与错误详情走库直读）。
   * 仅 createHandler({ email }) 装配后出现（未装配 = 段整体缺省，零假数据）；读失败 = 段缺省；
   * prod 隐身语义沿用调试面整体（prod 旗下 introspectResponse 返回 null）。
   */
  email?: EmailStatusEntry[];
};

/** server-status email 段单行（EmailLogEntry 的调试面最小投影——恰六字段，不含 payload/error） */
export type EmailStatusEntry = Pick<EmailLogEntry, "id" | "ts" | "transport" | "to" | "subject" | "status">;

/** prod 旗（endpoints.ts 同机制同读法——单点复制而非跨模块开私有口，两处注释互指） */
function isProd(): boolean {
  return (globalThis as { __ATELIER_PROD__?: boolean }).__ATELIER_PROD__ === true;
}

/** token 比较（A2 硬化5）：先哈希到定长再做 timing-safe 对比（不泄长度；dev 插件 tokenEq 同款）。 */
function tokenEq(a: string | null | undefined, b: string | null | undefined): boolean {
  const h = (s: string | null | undefined) => createHash("sha256").update(String(s ?? ""), "utf8").digest();
  return timingSafeEqual(h(a), h(b));
}

/** db 句柄最小结构面（SqliteDb 四原语的只读子集——本模块只做纯读） */
type ReadableDb = {
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined; all(...params: unknown[]): Record<string, unknown>[] };
};

/** DDL 标识符双引号转义（PRAGMA 不吃绑定参数——表名来自 sqlite_master 白名单位，仍按规矩转义） */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 表清单 + 列/索引 PRAGMA 内省（sqlite_% 内部表排除；atelier_migrations 等状态表如实列出） */
function introspectTables(db: ReadableDb): unknown[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return rows.map((r) => {
    const name = String(r.name);
    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all().map((c) => ({
      name: String(c.name),
      type: String(c.type ?? ""),
      notNull: Number(c.notnull ?? 0) === 1, // PRAGMA 列名 = notnull（bun/node 两宿主同此拼写）
      pk: Number(c.pk ?? 0) > 0,
    }));
    const indexes = db.prepare(`PRAGMA index_list(${quoteIdent(name)})`).all().map((idx) => ({
      name: String(idx.name),
      columns: db.prepare(`PRAGMA index_info(${quoteIdent(String(idx.name))})`).all()
        .sort((a, b) => Number(a.seqno ?? 0) - Number(b.seqno ?? 0))
        .map((c) => String(c.name)),
      unique: Number(idx.unique ?? 0) === 1,
    }));
    return { name, columns, indexes };
  });
}

/**
 * 迁移 journal 尾部（决策 21 台账预留位关闭——down 历史出口）：id 降序取尾再反转为时间升序
 * （快照有界，全量走库直读）。表不存在（journal 时代之前的旧库）= ok:false 诚实降级。
 * 行形状与 migrate.ts readMigrationJournal 同源（camelCase 投影，两处注释互指）。
 */
function introspectJournalTail(db: ReadableDb): { ok: boolean; rows: unknown[]; note: string | null } {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atelier_migration_journal'").get();
  if (!has) {
    return { ok: false, rows: [], note: "no atelier_migration_journal table (pre-journal db; created on next migrate up/down)" };
  }
  const rows = db
    .prepare("SELECT id, ts, name, action, status, principal, dur_ms, checksum FROM atelier_migration_journal ORDER BY id DESC LIMIT ?")
    .all(MIGRATION_JOURNAL_TAIL_LIMIT)
    .reverse()
    .map((r) => ({
      id: Number(r.id),
      ts: Number(r.ts),
      name: String(r.name),
      action: r.action === "down" ? "down" : "up",
      status: r.status === "failed" ? "failed" : "ok",
      principal: r.principal == null ? null : String(r.principal),
      durMs: r.dur_ms == null ? null : Number(r.dur_ms),
      checksum: r.checksum == null ? null : String(r.checksum),
    }));
  return { ok: true, rows, note: null };
}

/**
 * 迁移状态行（§11.3 迁移审计的现成数据源）：状态表行全量（id 序）+ head + applied/pending 名单
 * + journal 尾部（down 历史出口）。rows = 审计呈现面（appliedAt/downVerified 原样）；
 * applied/pending/head = MCP db.migrations 契约位。目录扫描复用 migrateStatus（完整性体检位
 * fileMissing/checksumOk 顺带可用）；目录缺省 = pending 空。
 */
function introspectMigrations(db: ReadableDb, migrationsDir: string | null) {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atelier_migrations'").get();
  if (!has) {
    return { head: null, applied: [], pending: [], rows: [], journal: { ok: false, rows: [], note: "no atelier_migrations table (migrate up first)" }, note: "no atelier_migrations table (migrate up first)" };
  }
  const rows = db.prepare("SELECT id, name, checksum, applied_at, down_verified FROM atelier_migrations ORDER BY id").all().map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    checksum: String(r.checksum),
    appliedAt: Number(r.applied_at),
    downVerified: Number(r.down_verified ?? 0) === 1,
  }));
  const applied = rows.map((r) => r.name);
  const last = rows[rows.length - 1] ?? null;
  const head = last ? { id: last.id, name: last.name } : null;
  let pending: string[] = [];
  if (migrationsDir && fs.existsSync(migrationsDir)) {
    try {
      // migrateStatus 需要 SqliteDb 全量接口，这里只有只读结构面——用类型收窄（同句柄，运行时同源）
      pending = migrateStatus(db as Parameters<typeof migrateStatus>[0], migrationsDir).pending.map((p) => p.name);
    } catch {
      pending = []; // 目录畸形 = CLI migrate 会显式报错；内省面不重复炸，pending 如实为空
    }
  }
  return { head, applied, pending, rows, journal: introspectJournalTail(db), note: null };
}

/**
 * 组装 server-status 快照。opts.db = createHandler 装配的库句柄（未装配 = db 段诚实缺省）；
 * opts.migrationsDir = 迁移目录（缺省 <cwd>/src/server/db/migrations——dev 托管 spawn cwd=应用根，
 * 直跑 main-server.ts 亦同；§5.4 目录约定单源在 scripts/migrate.mjs）；
 * opts.jobs = createHandler 装配的 jobs 句柄（A1/A4 差距批；未装配 = jobs 段不出现）；
 * opts.email = createHandler 装配的 email recorder（B3 差距批，决策 31；未装配 = email 段不出现）。
 */
export function serverStatusSnapshot(
  registry: EndpointRegistry,
  opts: { db?: unknown; mount?: string; migrationsDir?: string | null; jobs?: { stats(): JobsStats }; email?: { tail(n: number): EmailLogEntry[] } } = {},
): ServerStatusSnapshot {
  // 端点全表 = registry.list() 摘要 + 契约体（get() 公开位逐个补全——不为内省开新的注册表写入口）
  const summaries = new Map(registry.list().map((s) => [s.name, s]));
  const endpoints: ServerStatusEndpoint[] = registry.names().map((name) => {
    const def = registry.get(name) as EndpointDef;
    return { ...summaries.get(name)!, contract: def.contract ?? null, output: def.output ?? null };
  });
  const liveNames = registry.names().filter((name) => {
    const d = registry.get(name) as EndpointDef;
    return d.kind === "query" && isLiveDeclared(d); // live:false = 显式无 live（硬化7，与注册/引擎同口径）
  });

  let db: ServerStatusSnapshot["db"] = null;
  let dbNote: string | null = null;
  if (opts.db != null) {
    try {
      const readable = opts.db as ReadableDb;
      const migrationsDir =
        opts.migrationsDir !== undefined
          ? opts.migrationsDir
          : path.join(process.cwd(), "src", "server", "db", "migrations");
      db = { tables: introspectTables(readable), migrations: introspectMigrations(readable, migrationsDir) };
    } catch (e) {
      db = null;
      dbNote = `db 快照读取失败（${(e as Error)?.message ?? String(e)}）——句柄状态异常或宿主不支持；CLI \`atelier db.schema\` 位与 migrate status 可直查`;
    }
  } else {
    dbNote = "server 面未装配 db（createHandler 未传 db）——数据面内省缺省";
  }

  // jobs 段（A1/A4 差距批）：句柄在场才出现；读失败 = 段缺省（零假数据——不编造空队列假象）
  let jobs: ServerStatusSnapshot["jobs"];
  if (opts.jobs != null) {
    try {
      jobs = opts.jobs.stats();
    } catch {
      jobs = undefined; // 表损坏/句柄异常——诚实缺省，CLI/日志侧另有错误面
    }
  }

  // email 段（B3 差距批，决策 31）：recorder 在场才出现——经 tail() 窄口读库尾部（EMAIL_STATUS_TAIL_LIMIT
  // 条）投影为六字段最小呈现（payload/error 不进调试面，全量走库直读）。读失败 = 段缺省（零假数据，
  // jobs 段同款纪律）；装配但零投递 = 空数组（真实事实非假数据——tail 对未建表返回 []）。
  let email: ServerStatusSnapshot["email"];
  if (opts.email != null) {
    try {
      email = opts.email.tail(EMAIL_STATUS_TAIL_LIMIT).map((e) => ({
        id: e.id,
        ts: e.ts,
        transport: e.transport,
        to: e.to,
        subject: e.subject,
        status: e.status,
      }));
    } catch {
      email = undefined; // 表损坏/句柄异常——诚实缺省，记账表可经 SQL 直查
    }
  }

  // journal 段（B5 差距批，决策 29）：db 已装配且持久表存在 → 读库尾部 N 条（N = journalLimit，
  // 与内存环形同界——快照有界，全量走库直读；条目投影与内存条目字段逐一兼容）。表不存在（null）/
  // 未装配 db/读失败 → 回落内存环形（诚实降级，零假数据——回落语义与迁移 journal 段同款纪律）。
  let journal: ServerStatusSnapshot["journal"] = registry.journal();
  if (opts.db != null) {
    try {
      const persisted = readCommandJournalTail(opts.db as ReadableDb, registry.journalLimit);
      if (persisted != null) journal = persisted;
    } catch {
      /* 读失败回落内存环形——句柄状态异常不反噬调试面 */
    }
  }

  return {
    ok: true,
    server: { startedAt: STARTED_AT, mount: opts.mount ?? "/", node: process.version },
    endpoints,
    journal,
    live: { subscriberCount: registry.liveEngine.subscriberCount(), endpoints: liveNames },
    db,
    dbNote,
    ...(jobs != null ? { jobs } : {}),
    ...(email != null ? { email } : {}),
  };
}

/** email 段尾部条数（调试面有界呈现——全量走库直读，记账表 atelier_email_log） */
export const EMAIL_STATUS_TAIL_LIMIT = 20;

/** 进程启动时刻（模块加载 ≈ server 子进程启动；热重启 = 新进程，语义自洽） */
const STARTED_AT = new Date().toISOString();

/**
 * 分发器保留路由入口（endpoints.ts createHandler 调用）：命中保留路径返回 Response；
 * prod 旗返回 null（调用方落回既有 ATR 路径——调试面不进生产 API 面）。
 * A2 硬化5：opts.statusToken（createHandler({ statusToken }) 装配项透传）设置后，本路由要求
 * x-atelier-token 头（与 dev 面 token 机制同口径；哈希后 timing-safe 比对），不匹配 401 ATR-340
 * （鉴权域既有码——同是"凭据未过门"的 401，不另开号）。未设置 = 行为零变化。token 判定在
 * prod 隐身**之后**：prod 旗下照旧落 null → 405，门禁检查不泄露该路由在生产的存在性。
 */
export function introspectResponse(
  registry: EndpointRegistry,
  opts: { db?: unknown; mount?: string; migrationsDir?: string | null; statusToken?: string; req?: Request; jobs?: { stats(): JobsStats }; email?: { tail(n: number): EmailLogEntry[] } } = {},
): Response | null {
  if (isProd()) return null;
  if (opts.statusToken != null) {
    const provided = opts.req?.headers.get("x-atelier-token");
    if (!tokenEq(provided, opts.statusToken)) {
      return new Response(
        JSON.stringify(
          endpointError(
            "ATR-340",
            `server-status 调试面 token 门禁未通过（${provided == null ? "请求未携带 x-atelier-token 头" : "x-atelier-token 不匹配"}）`,
            "以 x-atelier-token 头携带装配点声明的 token 重试（dev 托管形态 = 应用 .atelier/dev-token 同值——dev 代理自动携带）；确属可裸奔的内网调试面则移除 createHandler({ statusToken }) 装配项",
            ["server-status"]
          ),
          null,
          2
        ),
        { status: 401, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }
  const snap = serverStatusSnapshot(registry, opts);
  return new Response(JSON.stringify(snap, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
