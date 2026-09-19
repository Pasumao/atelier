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
