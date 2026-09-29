/**
 * Atelier 全站服务层（S0，决策 18-20）— 桶出口。
 */
export {
  EndpointRegistry,
  defineQuery,
  defineCommand,
  endpointError,
  AtrEndpointError,
  apiKeyMatches,
  type EndpointKind,
  type EndpointDef,
  type EndpointContext,
  type EndpointAuthMeta,
  type AuthInfo,
  type AuthReader,
  type EndpointJournalEntry,
  type EndpointSummary,
  type ApiKeysOptions,
} from "./endpoints.ts";
export { openSqlite, SqliteUnavailableError, type SqliteDb, type SqliteStatement, type SqliteRunResult } from "./sqlite.ts";
/* FS-M2(m2b) 数据面追加（只加不改——既有行不动，api-diff 盯兼容性） */
export {
  table,
  pick,
  createTableSql,
  dropTableSql,
  type SqlColumnType,
  type ColumnDef,
  type IndexDef,
  type TableDef,
} from "./db.ts";
/* 契约形状类型转出口（应用契约单源 `satisfies FlatSchema` 与生成物 FlatOf 的 import 面——tsc 门禁 §7.3） */
export type { FlatSchema, FlatOf } from "../runtime/contract.ts";
export {
  migrateStatus,
  migrateUp,
  migrateDown,
  migrateVerify,
  MIGRATIONS_TABLE_DDL,
  MIGRATIONS_NAME_UK_DDL,
  readMigrationJournal,
  MIGRATION_JOURNAL_DDL,
  MIGRATION_JOURNAL_TAIL_LIMIT,
  type MigrationStep,
  type MigrateStatus,
  type MigrateVerifyResult,
  type MigrationJournalEntry,
  type MigrationJournalRead,
} from "./migrate.ts";
/* FS-7 live 引擎追加（只加不改——既有行不动，api-diff 盯兼容性） */
export { LiveEngine, type LiveEngineHost, type LiveEngineOptions } from "./live.ts";
/* FS-M2(m2d) 种子面追加（只加不改——既有行不动，api-diff 盯兼容性） */
export { seedAll, SEEDS_TABLE_DDL, type SeedResult, type SeedStep } from "./seed.ts";
/* FS-7 dev 托管追加（只加不改——既有行不动，api-diff 盯兼容性） */
export { createNodeServer, serve, type NodeHostOptions, type WebHandler } from "./node-host.ts";
/* FS-M6 尾件批追加（D-F16/§11.2/§11.3，只加不改——既有行不动）：server 面运行时内省快照 */
export {
  INTROSPECT_NAME,
  introspectResponse,
  serverStatusSnapshot,
  type ServerStatusEndpoint,
  type ServerStatusSnapshot,
} from "./introspect.ts";
/* A1/A4 差距批追加（§5.6 落地，2026-09-28，只加不改——既有行不动）：极薄队列 + jobs 运行时 + 幂等键 KV */
export {
  startJobs,
  defaultJobBackoffMs,
  JOBS_TABLE_DDL,
  JOBS_INDEX_DDL,
  IDEMPOTENCY_TABLE_DDL,
  CRON_TYPE_PREFIX,
  JOBS_LAST_ERROR_MAX,
  JOBS_DEFAULT_POLL,
  JOBS_DEFAULT_LOCK_TIMEOUT_MS,
  type EnqueueInput,
  type JobInvocation,
  type JobHandler,
  type CronEntry,
  type KvView,
  type KvStore,
  type JobsStats,
  type JobsHandle,
  type BoundJobs,
  type StartJobsOptions,
} from "./jobs.ts";
/* B4 差距批追加（健康面，2026-09-28，只加不改——既有行不动）：GET <mount>/__atelier/health 三事实探活口 */
export { HEALTH_NAME, healthResponse, type HealthSnapshot } from "./health.ts";
