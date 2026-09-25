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
 * - journal 为内存环形（journalLimit 上限、server 重启清零）——跨重启的历史归 dev 面
 *   audit.jsonl 时间轴（§11.3 统一时间轴的另一来源）；
 * - 迁移审计（§11.3）：状态表即审计对象（决策 19"迁移即 checkpoint 审计对象"），只有
 *   applied 时刻（applied_at）与名字；down 历史/ principal /durMs 持久于
 *   atelier_migration_journal（决策 21 台账预留位关闭，M6 挂账候选池第二枚——追加式审计史，
 *   migrate.ts 单源写入）；快照只携 journal 尾部（MIGRATION_JOURNAL_TAIL_LIMIT，有界），
 *   全量走库直读（readMigrationJournal / dev-review-data node:sqlite 兜底）。journal 表
 *   不存在（旧库）= ok:false 诚实降级，绝不假数据。
 */
import type { EndpointDef, EndpointRegistry, EndpointSummary } from "./endpoints.ts";
import { MIGRATION_JOURNAL_TAIL_LIMIT, migrateStatus } from "./migrate.ts";
import fs from "node:fs";
import path from "node:path";

/** 保留内省路径（mount 剥离后的 name 精确匹配；与 /live 后缀同款的分发器保留字） */
export const INTROSPECT_NAME = "__atelier/server-status";

/** server-status 单端点行：registry.list() 摘要 + 契约体（endpoint.contract 与调试页 schema 展示的数据源） */
export type ServerStatusEndpoint = EndpointSummary & { contract: unknown; output: unknown };

/** dev 面 server-status 快照形状（MCP 消费契约的宿主侧单源） */
export type ServerStatusSnapshot = {
  ok: true;
  /** 子进程侧事实：startedAt = 本模块加载时刻（≈ server 进程启动）；restarts/dbPath/host 由 dev 父进程补充 */
  server: { startedAt: string; mount: string; node: string };
  /** 端点全表 */
  endpoints: ServerStatusEndpoint[];
  /** command 审计 journal（成功与失败同源，环形有界） */
  journal: readonly unknown[];
  /** live 引擎内省：SSE 订阅者总数 + live 端点名 */
  live: { subscriberCount: number; endpoints: string[] };
  /** db 读侧快照（未装配/读失败 = null，note 说明） */
  db: { tables: unknown[]; migrations: unknown } | null;
  dbNote: string | null;
};

/** prod 旗（endpoints.ts 同机制同读法——单点复制而非跨模块开私有口，两处注释互指） */
function isProd(): boolean {
  return (globalThis as { __ATELIER_PROD__?: boolean }).__ATELIER_PROD__ === true;
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
 * 直跑 main-server.ts 亦同；§5.4 目录约定单源在 scripts/migrate.mjs）。
 */
export function serverStatusSnapshot(
  registry: EndpointRegistry,
  opts: { db?: unknown; mount?: string; migrationsDir?: string | null } = {},
): ServerStatusSnapshot {
  // 端点全表 = registry.list() 摘要 + 契约体（get() 公开位逐个补全——不为内省开新的注册表写入口）
  const summaries = new Map(registry.list().map((s) => [s.name, s]));
  const endpoints: ServerStatusEndpoint[] = registry.names().map((name) => {
    const def = registry.get(name) as EndpointDef;
    return { ...summaries.get(name)!, contract: def.contract ?? null, output: def.output ?? null };
  });
  const liveNames = registry.names().filter((name) => {
    const d = registry.get(name) as EndpointDef;
    return d.kind === "query" && d.live != null;
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

  return {
    ok: true,
    server: { startedAt: STARTED_AT, mount: opts.mount ?? "/", node: process.version },
    endpoints,
    journal: registry.journal(),
    live: { subscriberCount: registry.liveEngine.subscriberCount(), endpoints: liveNames },
    db,
    dbNote,
  };
}

/** 进程启动时刻（模块加载 ≈ server 子进程启动；热重启 = 新进程，语义自洽） */
const STARTED_AT = new Date().toISOString();

/**
 * 分发器保留路由入口（endpoints.ts createHandler 调用）：命中保留路径返回 Response；
 * prod 旗返回 null（调用方落回既有 ATR 路径——调试面不进生产 API 面）。
 */
export function introspectResponse(
  registry: EndpointRegistry,
  opts: { db?: unknown; mount?: string; migrationsDir?: string | null } = {},
): Response | null {
  if (isProd()) return null;
  const snap = serverStatusSnapshot(registry, opts);
  return new Response(JSON.stringify(snap, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
