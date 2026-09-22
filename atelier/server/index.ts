/**
 * Atelier 全站服务层（S0，决策 18-20）— 桶出口。
 */
export {
  EndpointRegistry,
  defineQuery,
  defineCommand,
  endpointError,
  AtrEndpointError,
  type EndpointKind,
  type EndpointDef,
  type EndpointContext,
  type EndpointAuthMeta,
  type AuthInfo,
  type AuthReader,
  type EndpointJournalEntry,
  type EndpointSummary,
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
  type MigrationStep,
  type MigrateStatus,
  type MigrateVerifyResult,
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
