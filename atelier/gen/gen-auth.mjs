#!/usr/bin/env node
/**
 * gen-auth.mjs — `atelier gen auth`（FS-DESIGN §6 全规格，FS-5 组成，FS-M2(m2d)）。
 *
 * 产出（全部显式 import 闭合 + 头部 @atelier-generated 标记；§6.1 产物清单）：
 *   <root>/src/server/auth/sessions.table.ts   鉴权域数据契约：users（凭据）+ sessions（会话），
 *                                              table() 扁平字面量——与 schema 单源同规范
 *   <root>/src/server/auth/cookie.ts           显式会话 cookie 读写（HttpOnly/SameSite=Strict 注释说明；
 *                                              Secure 缺省不落——本地 http dev 浏览器拒收，显式开）
 *   <root>/src/server/auth/auth.ts             createSession/validateSession/destroySession（全参数化 SQL）
 *                                              + scrypt 密码哈希（node:crypto——宿主差异锁死本文件）
 *                                              + createSessionReader(db)（createHandler({ auth }) 装配形态，
 *                                              装配示例写在文件头注释）
 *   <root>/src/server/auth/endpoints.ts        auth.login（command，验证密码→建会话→Set-Cookie）/
 *                                              auth.logout（command）/ auth.me（query）+ 契约
 *   <root>/src/server/db/migrations/NNN_auth.{up,down}.sql  成对迁移骨架（**追加式**：编号 =
 *                                              现有最大 NNN+1；已存在迁移文件永不重写，§5.4）
 *
 * 默认形态 = 邮箱+密码；magic link 登录变体不做（regen 模板选择归后续——auth.ts JSDoc 注明契约位）。
 *
 * 流程扩展（B2 差距批 2026-09-28，FS-DESIGN §6.1 落地注记）：`--flows reset,verify` 选装鉴权流程——
 *   reset = 密码重置流（auth.requestReset / auth.resetPassword）；verify = 邮箱验证流
 *   （auth.requestVerification / auth.verifyEmail）；可单选可双选。缺省不带 = 三件套产物**字节不变**
 *   （负例钉死 tests/auth-flows.test.ts）。流程产物（在五件套之上追加）：
 *   sessions.table.ts 加 auth_tokens 表契约（只存 sha256 不存明文 token——DB 泄漏 ≠ token 泄漏；
 *   verify 流另加 users.verified 列）+ tokens.ts 令牌原语 + NNN_auth_tokens 迁移对
 *   （createTableSql 渲染）+ NNN_users_verified 加列迁移对（仅 verify；加列无表契约 DDL 位 →
 *   ALTER TABLE 骨架）。流程端点投递经 ctx.email（B3 可选位）——缺位降级 console.warn 可发现
 *   通道，绝不炸；邮件正文 = 产物内明文常量/纯函数（不引模板引擎，决策 31 边界）。
 *
 * 生成器纪律（§7，与 gen-db.mjs 同源）：产物为纯函数渲染（同输入 → 字节全同，regen 幂等）；
 * DDL 经 server/db.ts 的 createTableSql/dropTableSql 渲染（契约校验与迁移 DDL 不出现第二套实现）；
 * regen 重写 TS 产物为字节全同内容（手改被覆盖——§6.3：regen 前先 git diff 审阅），迁移只追加。
 *
 * 用法：node atelier/gen/gen-auth.mjs --root <appDir> [--flows reset,verify]
 * 纯 API：import { genAuth, GenAuthError, parseFlows } from "<repo>/atelier/gen/gen-auth.mjs"
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createTableSql, dropTableSql, table as defineTable } from "../server/db.ts";

export class GenAuthError extends Error {
  constructor(message, fix) {
    super(message);
    this.name = "GenAuthError";
    this.fix = fix;
  }
}

function die(message, fix) {
  throw new GenAuthError(message, fix);
}

/* ---------- 鉴权域数据契约（v1 固定模板；改契约 = 改生成器 = regen 升级，§6.3） ---------- */

/** users：登录凭据（email 唯一；role 自由文本 + 缺省 "user"——角色全集归应用，生成器不假设枚举） */
const USERS_DEF = defineTable("users", {
  id: { type: "integer", primaryKey: true },
  email: { type: "text", notNull: true, unique: true },
  passwordHash: { type: "text", notNull: true },
  role: { type: "text", notNull: true, default: "user" },
  createdAt: { type: "integer", notNull: true },
});

/** sessions：服务端会话（token 唯一；userId 引用 users.id；expiresAt = 建会话时定格的 epoch ms） */
const SESSIONS_DEF = defineTable("sessions", {
  id: { type: "integer", primaryKey: true },
  token: { type: "text", notNull: true, unique: true },
  userId: { type: "integer", notNull: true, references: "users.id" },
  createdAt: { type: "integer", notNull: true },
  expiresAt: { type: "integer", notNull: true },
}, {
  indexes: [{ name: "idx_sessions_user", columns: ["userId"] }],
});

/**
 * auth_tokens：鉴权流一次性令牌（B2 差距批，仅 --flows 生成）：只存 sha256 哈希不存明文
 * （随机 32B hex 明文只经投递通道出站——DB 泄漏 ≠ token 泄漏）；kind 区流（reset/verify——枚举
 * 校验在契约层，DDL 不重复 CHECK 的框架纪律，db.ts table() 语义）；expiresAt = 建令牌时定格的
 * epoch ms；usedAt = 单次使用位（consume 原子认领）。
 */
const AUTH_TOKENS_DEF = defineTable("auth_tokens", {
  id: { type: "integer", primaryKey: true },
  userId: { type: "integer", notNull: true, references: "users.id" },
  kind: { type: "text", notNull: true, enum: ["reset", "verify"] },
  tokenHash: { type: "text", notNull: true, unique: true },
  expiresAt: { type: "integer", notNull: true },
  usedAt: { type: "integer" },
}, {
  indexes: [{ name: "idx_auth_tokens_user", columns: ["userId"] }],
});

/**
 * users 契约按流程裁剪：缺省 = USERS_DEF 原样（三件套字节不变红线）；verify 流追加 verified 列
 * （0=未验证/1=已验证）。加列的 DDL 位在 NNN_users_verified 迁移对（ALTER TABLE——加列无
 * createTableSql 渲染位），契约与列形状随本契约单源一致。
 */
function usersDefFor(flows) {
  if (!flows.includes("verify")) return USERS_DEF;
  return defineTable("users", {
    ...USERS_DEF.columns,
    verified: { type: "integer", notNull: true, default: 0 },
  });
}

/* ---------- --flows 流程开关（B2） ---------- */

/** 支持的流程清单（顺序即产物渲染规范序） */
export const AUTH_FLOWS = ["reset", "verify"];

/**
 * 解析 --flows 值（"reset,verify" / "reset" / "verify" / undefined / 等价数组）：规范化到
 * AUTH_FLOWS 顺序 + 去重 + 空白容忍；未知旗标 = GenAuthError（fail-closed——拼错旗标绝不静默
 * 降级为缺省三件套）。
 */
export function parseFlows(value) {
  if (value == null) return [];
  const parts = (Array.isArray(value) ? value.join(",") : String(value))
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const unknown = parts.filter((p) => !AUTH_FLOWS.includes(p));
  if (unknown.length > 0) {
    die(
      `未知 --flows 旗标：${unknown.join(", ")}`,
      `支持：${AUTH_FLOWS.join("/")}（reset=密码重置流 / verify=邮箱验证流；可组合 --flows reset,verify；缺省不带 = 三件套现状字节不变）`
    );
  }
  return AUTH_FLOWS.filter((f) => parts.includes(f));
}

/* ---------- 产物渲染（纯函数：同输入 → 字节全同） ---------- */

const VENDOR_INDEX = "../../vendor/atelier/server/index.ts";
const VENDOR_DB = "../../vendor/atelier/server/db.ts";
const VENDOR_SQLITE = "../../vendor/atelier/server/sqlite.ts";

function renderTableLiteral(def, constName, indent) {
  const L = [];
  L.push(`${indent}export const ${constName} = table("${def.name}", {`);
  for (const [k, col] of Object.entries(def.columns)) {
    const parts = [`type: "${col.type}"`];
    if (col.primaryKey) parts.push("primaryKey: true");
    if (col.notNull) parts.push("notNull: true");
    if (col.unique) parts.push("unique: true");
    if (col.default !== undefined) {
      parts.push(`default: ${typeof col.default === "string" ? JSON.stringify(col.default) : String(col.default)}`);
    }
    if (col.enum !== undefined) parts.push(`enum: [${col.enum.map((v) => JSON.stringify(v)).join(", ")}]`);
    if (col.references) parts.push(`references: "${col.references}"`);
    L.push(`${indent}  ${k}: { ${parts.join(", ")} },`);
  }
  if (def.indexes.length > 0) {
    L.push(`${indent}}, {`);
    L.push(`${indent}  indexes: [`);
    for (const idx of def.indexes) {
      L.push(`${indent}    { name: "${idx.name}", columns: [${idx.columns.map((c) => JSON.stringify(c)).join(", ")}]${idx.unique ? ", unique: true" : ""} },`);
    }
    L.push(`${indent}  ],`);
    L.push(`${indent}});`);
  } else {
    L.push(`${indent}});`);
  }
  return L.join("\n");
}

function renderSessionsTable(flows) {
  const hasFlows = flows.length > 0;
  return [
    `// @atelier-generated (gen auth) — 鉴权域数据契约（§6.1）：users（凭据）+ sessions（会话）${hasFlows ? " + auth_tokens（流程一次性令牌）" : ""}。`,
    "// 与 schema 单源同规范（server/db.ts 的 table() 扁平字面量）；应用已有 src/server/db/schema.ts 时",
    hasFlows
      ? "// 可把这些定义并入单源后删除本文件（import 相对路径随之调整——gen db 只扫描单源文件）。"
      : "// 可把两个定义并入单源后删除本文件（import 相对路径随之调整——gen db 只扫描单源文件）。",
    "// regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3：regen 前先 git diff 审阅）。",
    `import { table } from "${VENDOR_DB}";`,
    "",
    renderTableLiteral(usersDefFor(flows), "users", ""),
    "",
    renderTableLiteral(SESSIONS_DEF, "sessions", ""),
    ...(hasFlows ? ["", renderTableLiteral(AUTH_TOKENS_DEF, "authTokens", "")] : []),
    "",
  ].join("\n");
}

function renderCookie() {
  return [
    "// @atelier-generated (gen auth) — 显式会话 cookie 读写（§6.1；零依赖，Web 标准 Cookie 头手写解析）。",
    "// 属性说明（写明不隐式）：HttpOnly = JS 不可读（收窄 XSS 窃取面）；SameSite=Strict = 跨站请求不携带",
    "// （CSRF 面收窄）；Secure v1 缺省不落——本地 http://127.0.0.1 dev 下浏览器拒收 Secure cookie，",
    "// 生产 HTTPS 反代时以 { secure: true } 显式开启（显式优于魔法）。",
    "// regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3）。",
    "",
    "/** 会话 cookie 名与生命周期（秒）——改 TTL 只影响新建会话（expiresAt 建会话时已定格） */",
    'export const SESSION_COOKIE = "atelier_session";',
    "export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;",
    "",
    "/** 序列化一枚会话 cookie（Set-Cookie 值）——经 handler 的 ctx.setCookie 透传进成功响应 */",
    "export function serializeSessionCookie(token: string, opts: { maxAgeSeconds?: number; secure?: boolean } = {}): string {",
    '  const parts = [SESSION_COOKIE + "=" + token, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=" + String(Math.floor(opts.maxAgeSeconds ?? SESSION_TTL_SECONDS))];',
    '  if (opts.secure === true) parts.push("Secure");',
    '  return parts.join("; ");',
    "}",
    "",
    "/** 清除会话 cookie（logout 用）：同名 + Max-Age=0 立即过期（Path/属性与设置时一致才可靠覆盖） */",
    'export function clearSessionCookie(opts: { secure?: boolean } = {}): string {',
    '  const parts = [SESSION_COOKIE + "=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];',
    '  if (opts.secure === true) parts.push("Secure");',
    '  return parts.join("; ");',
    "}",
    "",
    "/** 从请求 Cookie 头读指定 cookie 值；头缺失/无该名 = null（手写 header 解析，零依赖） */",
    'export function readCookie(req: Request, name: string): string | null {',
    '  const header = req.headers.get("cookie");',
    "  if (header == null || header.length === 0) return null;",
    '  for (const pair of header.split(";")) {',
    '    const eq = pair.indexOf("=");',
    "    if (eq < 0) continue;",
    '    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();',
    "  }",
    "  return null;",
    "}",
    "",
  ].join("\n");
}

/**
 * tokens.ts 产物（B2，仅 --flows 生成）：鉴权流一次性令牌原语。内容与选中流程无关（原语两流共用，
 * 令牌表也共用一张）——reset-only / verify-only / 双选渲染字节全同，产物面裁剪只发生在端点与
 * users 契约/迁移层。
 */
function renderTokens() {
  return [
    "/**",
    " * @atelier-generated (gen auth --flows) — 鉴权流一次性令牌原语（FS-DESIGN §6.1 落地注记 2026-09-28，",
    " * 差距批 B2：密码重置 + 邮箱验证流）。",
    " *",
    " * 形态（本文件随 --flows 生成；缺省三件套不产本文件）：",
    " *   - createAuthToken(db, userId, kind, ttlMs)：随机 32B hex 明文 token 只经返回值出站（邮件/",
    " *     console 降级通道），库内只落 sha256 哈希——DB 泄漏 ≠ token 泄漏；",
    " *   - consumeAuthToken(db, rawToken, kind)：哈希后按 (tokenHash, kind) 查找 + 过期检查 + 单次",
    " *     使用（UPDATE ... WHERE usedAt IS NULL 原子认领）——不存在/已用/过期/kind 错配**同一失败",
    " *     路径**（恒返 null，调用方给统一文案——不向请求侧泄漏 token 状态细节）；",
    " *   - 建令牌时顺手惰性清理过期行（validateSession 同款纪律，无后台任务）。",
    " *",
    " * 装配：流程端点见同目录 endpoints.ts（--flows 选装 auth.requestReset/auth.resetPassword/",
    " * auth.requestVerification/auth.verifyEmail）；邮件投递经 ctx.email（B3 可选位），缺位降级",
    " * console.warn 可发现通道（见 endpoints.ts deliverFlowEmail）。",
    " * SQL 红线（决策 19）：全部参数化（值一律 ? 绑定），无字符串拼接逃生门。",
    " * regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3：regen 前先 git diff 审阅）。",
    " */",
    'import { createHash, randomBytes } from "node:crypto";',
    `import type { SqliteDb } from "${VENDOR_SQLITE}";`,
    "",
    "/** 令牌用途（auth_tokens.kind 契约枚举）：reset = 密码重置 / verify = 邮箱验证 */",
    'export type AuthTokenKind = "reset" | "verify";',
    "",
    "/** 密码重置令牌有效期（明文常量 knob——regen 会覆盖手改，§6.3；改 TTL 只影响新建令牌，不溯及） */",
    "export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;",
    "/** 邮箱验证令牌有效期（同上） */",
    "export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;",
    "",
    "/** 明文 token 只存哈希：sha256 hex（DB 泄漏 ≠ token 泄漏——B2 形态红线，tests/auth-flows.test.ts 钉） */",
    "function hashToken(rawToken: string): string {",
    '  return createHash("sha256").update(rawToken).digest("hex");',
    "}",
    "",
    "/**",
    " * 建一次性令牌：返回明文 token（调用方负责经投递通道送出——ctx.email 或 console 降级，绝不入库）。",
    " * 顺手惰性清理全部过期行（validateSession 惰性 DELETE 同款：建时即清，无后台任务纪律的延续）。",
    " */",
    "export function createAuthToken(db: SqliteDb, userId: number, kind: AuthTokenKind, ttlMs: number): { id: number; token: string; expiresAt: number } {",
    '  const token = randomBytes(32).toString("hex");',
    "  const now = Date.now();",
    '  db.prepare("DELETE FROM auth_tokens WHERE expiresAt <= ?").run(now);',
    '  const r = db.prepare("INSERT INTO auth_tokens (userId, kind, tokenHash, expiresAt) VALUES (?, ?, ?, ?)").run(userId, kind, hashToken(token), now + ttlMs);',
    "  return { id: Number(r.lastInsertRowid), token, expiresAt: now + ttlMs };",
    "}",
    "",
    "/**",
    " * 消费一次性令牌（单次使用）：哈希后按 (tokenHash, kind) 查找 → 已用/过期检查 → 原子认领",
    " * （UPDATE ... WHERE id = ? AND usedAt IS NULL 抢占式置位，changes=0 = 并发窗口的二次消费）。",
    " * 不存在/已用/过期/kind 错配**同一失败路径**：恒返 null——流程端点给统一 400 文案，不区分细节。",
    " */",
    "export function consumeAuthToken(db: SqliteDb, rawToken: string, kind: AuthTokenKind): { userId: number } | null {",
    "  const row = db",
    '    .prepare("SELECT id, userId, expiresAt, usedAt FROM auth_tokens WHERE tokenHash = ? AND kind = ?")',
    "    .get(hashToken(rawToken), kind) as { id: number; userId: number; expiresAt: number; usedAt: number | null } | undefined;",
    "  if (row == null) return null;",
    "  if (row.usedAt != null) return null; // 已用（单次使用）",
    "  if (Number(row.expiresAt) <= Date.now()) return null; // 过期（建时定格的 expiresAt，改 TTL 不溯及）",
    '  const r = db.prepare("UPDATE auth_tokens SET usedAt = ? WHERE id = ? AND usedAt IS NULL").run(Date.now(), Number(row.id));',
    "  if (Number(r.changes) === 0) return null; // 并发二次消费护栏",
    "  return { userId: Number(row.userId) };",
    "}",
    "",
  ].join("\n");
}

function renderAuth() {
  return [
    "/**",
    " * @atelier-generated (gen auth) — 会话原语与密码哈希（§6.1）。默认形态 = 邮箱+密码；",
    " * magic link 变体 = regen 模板选择位（生成器携带最佳实践演进），v1 未做——本注记即契约位。",
    " *",
    " * 装配示例（src/main-server.ts——显式接线，无 DI 容器，装配代码明文可见，§3.2/§6.1）：",
    ` *   import { openSqlite } from "${VENDOR_SQLITE}";`,
    ` *   import { EndpointRegistry } from "${VENDOR_INDEX}";`,
    ' *   import { createSessionReader } from "./server/auth/auth.ts";',
    ' *   import { registerAuthEndpoints } from "./server/auth/endpoints.ts";',
    " *",
    ' *   const db = await openSqlite(".atelier/dev.db");',
    " *   const reg = new EndpointRegistry();",
    " *   registerAuthEndpoints(reg);                    // auth.login / auth.logout / auth.me",
    " *   const handler = reg.createHandler({ db, auth: createSessionReader(db) }); // ← 显式装配",
    " *",
    " * 宿主差异锁死本文件（同 sqlite.ts 纪律）：scrypt 来自 node:crypto——Bun 实现了 node:crypto",
    " * 兼容层（同代码双宿主）；诚实边界：Bun 路径未在本环境实测（无 Bun），API 形状按官方文档对表。",
    " * SQL 红线（决策 19）：全部参数化（值一律 ? 绑定），无字符串拼接逃生门。",
    " * regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3：regen 前先 git diff 审阅）。",
    " */",
    'import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";',
    'import { promisify } from "node:util";',
    `import type { AuthInfo } from "${VENDOR_INDEX}";`,
    `import type { SqliteDb } from "${VENDOR_SQLITE}";`,
    'import { readCookie, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./cookie.ts";',
    "",
    "const scryptAsync = promisify(scrypt) as (",
    "  password: string,",
    "  salt: string,",
    "  keylen: number,",
    "  options?: { N: number; r: number; p: number },",
    ") => Promise<Buffer>;",
    "const KEY_LEN = 64;",
    "/**",
    " * scrypt 显式 cost 参数（A2 安全收口批硬化1）：不靠 node:crypto 缺省——缺省值随宿主版本漂移，",
    " * 显式写出 = 哈希可验证性不依赖构建时点。参数随哈希串版本位落盘（第二段 N=..,r=..,p=..），",
    " * verify 按前缀解析参数分派：未来提 cost 只影响新哈希，存量哈希按自身版本位参数校验，永不静默失配。",
    " * 取值 = RFC 7914 §11 建议最小档（N=2^14 约 16MB/次）；提级时改这三个常量即可（升级路径即版本位）。",
    " * 无存量语义（本生成器此前为 3 段式无参数位）→ 不设旧格式兼容层：旧格式 verify 恒 false，",
    " * regen 升级后存量用户需应用侧重置密码（显式操作，不做静默迁移）。",
    " */",
    "export const SCRYPT_N = 16384;",
    "export const SCRYPT_R = 8;",
    "export const SCRYPT_P = 1;",
    "const SCRYPT_PARAMS = `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`;",
    "",
    "/** 密码哈希（scrypt + 16 字节随机盐）→ \"scrypt$N=..,r=..,p=..$<saltHex>$<hashHex>\" 明文可读格式（users.passwordHash 列） */",
    "export async function hashPassword(password: string): Promise<string> {",
    '  const salt = randomBytes(16).toString("hex");',
    "  const derived = (await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })) as Buffer;",
    '  return "scrypt$" + SCRYPT_PARAMS + "$" + salt + "$" + derived.toString("hex");',
    "}",
    "",
    "/**",
    " * 哈希串参数段解析：\"N=16384,r=8,p=1\" → 参数；形态不符 = null（不抛——verify 对畸形串恒 false）。",
    " * 上限护栏（A2 硬化1）：哈希串可能来自不可信侧（库泄露/手填）——超界参数直接拒绝执行，",
    " * 防 N 巨大把 CPU/内存打爆（DoS）。下限是绝对地板（RFC 7914 建议最小值）而非当前 SCRYPT_N——",
    " * 未来 cost 提级后，旧哈希（较低 N）仍按自身参数照常校验，这正是版本位分派的意义。",
    " */",
    "function parseScryptParams(spec: string): { N: number; r: number; p: number } | null {",
    '  const m = /^N=(\\d+),r=(\\d+),p=(\\d+)$/.exec(spec);',
    "  if (m == null) return null;",
    "  const N = Number(m[1]);",
    "  const r = Number(m[2]);",
    "  const p = Number(m[3]);",
    "  if (N < 16384 || N > 2 ** 21 || r < 1 || r > 64 || p < 1 || p > 8) return null;",
    "  return { N, r, p };",
    "}",
    "",
    "/** 校验密码（timingSafeEqual 恒时比较——时序侧信道收窄）；格式不符 = false（不抛，调用方给统一 401 文案） */",
    "export async function verifyPassword(password: string, stored: string): Promise<boolean> {",
    '  const parts = stored.split("$");',
    '  if (parts.length !== 4 || parts[0] !== "scrypt") return false;',
    "  const params = parseScryptParams(parts[1] ?? \"\");",
    "  if (params == null) return false;",
    '  const derived = (await scryptAsync(password, parts[2] ?? "", KEY_LEN, params)) as Buffer;',
    '  const expected = Buffer.from(parts[3] ?? "", "hex");',
    "  return derived.length === expected.length && timingSafeEqual(derived, expected);",
    "}",
    "",
    "/**",
    " * dummy 哈希（A2 硬化8 的代价均衡锚点）：固定占位串（同 SCRYPT 参数版本位），内容无意义——",
    " * 任何密码对它都验证失败，也不对应任何真实账号。明文常量而非运行时生成：产物 regen 字节幂等。",
    " */",
    'const DUMMY_HASH = "scrypt$N=16384,r=8,p=1$2bae9667bd829dee27a306afaaadf35d$8489b888e7c3e64983d663bdd5e3acc671c455bf59f8b033227629bdfbe912d3539e9719e838754145037cab9058c57b2d1067d8a2e4cda5a3afb5e266d4c85d";',
    "",
    "/**",
    " * 时序均衡校验（A2 硬化8，login 用）：用户不存在时对 DUMMY_HASH 跑一次等价 scrypt（同 KEY_LEN、",
    " * 同版本位参数——代价与真实校验一致），两条失败路径恒时近似，login 响应时间不再区分",
    " * 「邮箱不存在」与「密码错误」（账号存在性枚举信道收口）。",
    " */",
    "export async function verifyPasswordEqualized(password: string, storedHash: string | null): Promise<boolean> {",
    "  return verifyPassword(password, storedHash ?? DUMMY_HASH);",
    "}",
    "",
    "export type AuthUser = { id: number; email: string; role: string };",
    "",
    "/** 建会话：32 字节随机 token（base64url），expiresAt = now + ttl*1000（建会话时定格，改 TTL 不溯及） */",
    "export function createSession(db: SqliteDb, userId: number, ttlSeconds: number = SESSION_TTL_SECONDS): { id: number; token: string; expiresAt: number } {",
    '  const token = randomBytes(32).toString("base64url");',
    "  const now = Date.now();",
    "  const expiresAt = now + ttlSeconds * 1000;",
    '  const r = db.prepare("INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)").run(token, userId, now, expiresAt);',
    "  return { id: Number(r.lastInsertRowid), token, expiresAt };",
    "}",
    "",
    "/**",
    " * 查会话（JOIN users 带出主体）：token 不存在或已过期 = null。",
    " * 过期会话惰性清理（A2 硬化6）：validate 命中点顺手 DELETE 全部过期行——查到才判→顺手清，",
    " * 无后台任务纪律的延续；僵尸过期行不再无限累积。诚实边界：DELETE 无 expiresAt 索引（会话表",
    " * 行数量级小；量大时应用自建索引迁移，gen 不重写已应用迁移）。",
    " */",
    "export function validateSession(db: SqliteDb, token: string): { session: { id: number; token: string; userId: number; expiresAt: number }; user: AuthUser } | null {",
    '  db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(Date.now());',
    "  const row = db",
    '    .prepare("SELECT s.id AS sid, s.token AS stoken, s.userId, s.expiresAt, u.id AS uid, u.email, u.role FROM sessions s JOIN users u ON u.id = s.userId WHERE s.token = ?")',
    "    .get(token) as Record<string, unknown> | undefined;",
    "  if (row == null) return null;",
    "  if (Number(row.expiresAt) <= Date.now()) return null; // 双保险：恰在 DELETE 后过界的行也拦下",
    "  return {",
    "    session: { id: Number(row.sid), token: String(row.stoken), userId: Number(row.userId), expiresAt: Number(row.expiresAt) },",
    "    user: { id: Number(row.uid), email: String(row.email), role: String(row.role) },",
    "  };",
    "}",
    "",
    "/** 销毁会话（logout）：按 token 删行；token 不存在 = 幂等 no-op */",
    "export function destroySession(db: SqliteDb, token: string): void {",
    '  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);',
    "}",
    "",
    "/** 按邮箱查用户（login 用，passwordHash 随行）；v1 = 精确匹配（邮箱归一化策略归应用） */",
    "export function findUserByEmail(db: SqliteDb, email: string): (AuthUser & { passwordHash: string }) | undefined {",
    '  return db.prepare("SELECT id, email, role, passwordHash FROM users WHERE email = ?").get(email) as (AuthUser & { passwordHash: string }) | undefined;',
    "}",
    "",
    "/** 建用户（首个用户由应用侧脚本/种子调用——生成器不含注册端点，注册策略归应用显式决定） */",
    'export async function createUser(db: SqliteDb, email: string, password: string, role: string = "user"): Promise<AuthUser> {',
    "  const passwordHash = await hashPassword(password);",
    '  const r = db.prepare("INSERT INTO users (email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?)").run(email, passwordHash, role, Date.now());',
    "  return { id: Number(r.lastInsertRowid), email, role };",
    "}",
    "",
    "/**",
    " * 会话读取器工厂——createHandler({ auth }) 的 AuthReader 形参形态：从 cookie 读 token →",
    " * validateSession → AuthInfo | null。工厂而非裸导出的原因：会话校验需要 db 句柄，显式传参",
    " * 优于模块级可变状态（§3.2 显式注入纪律）。AuthInfo 携带 token（供 logout 等端点显式销毁",
    " * 会话；journal 只记 principal，token 不入账）。",
    " */",
    "export function createSessionReader(db: SqliteDb): (req: Request) => AuthInfo | null {",
    "  return (req: Request): AuthInfo | null => {",
    "    const token = readCookie(req, SESSION_COOKIE);",
    "    if (token == null) return null;",
    "    const hit = validateSession(db, token);",
    "    if (hit == null) return null;",
    '    return { type: "session", principal: hit.user.email, userId: hit.user.id, role: hit.user.role, token: hit.session.token };',
    "  };",
    "}",
    "",
  ].join("\n");
}

function renderEndpoints(flows) {
  const hasReset = flows.includes("reset");
  const hasVerify = flows.includes("verify");
  const flowLabel = [
    hasReset ? "auth.requestReset / auth.resetPassword（reset）" : null,
    hasVerify ? "auth.requestVerification / auth.verifyEmail（verify）" : null,
  ]
    .filter(Boolean)
    .join(" + ");
  return [
    `// @atelier-generated (gen auth) — auth.login / auth.logout / auth.me 端点骨架（§6.1${flows.length > 0 ? `；--flows ${flows.join(",")} 加流程端点：${flowLabel}——B2 落地注记` : ""}）。`,
    "// 契约：input = 就地 FlatSchema 字面量；auth.me 的 output = users rowSchema 的 pick 投影（数据契约同规范单源，§5.1）。",
    "// 角色声明示例：需要角色的端点写 auth: { type: \"session\", role: \"admin\" }——分发层拦截（403 ATR-341），",
    "// handler 内无需重复检查；行级判断读 ctx.auth 显式做（RLS 式隐式策略不做，§6.2）。",
    "// 诚实边界：本文件在 src/server/auth/（§6.1 布局）——gen endpoint 的 api.ts 客户端只扫",
    "// src/server/endpoints/，auth 端点的前端调用走 fetch 或手工并入客户端（v1 边界）。",
    "// regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3：regen 前先 git diff 审阅）。",
    `import { AtrEndpointError, defineCommand, defineQuery, endpointError, type EndpointRegistry${flows.length > 0 ? ", type EndpointContext" : ""} } from "${VENDOR_INDEX}";`,
    `import type { SqliteDb } from "${VENDOR_SQLITE}";`,
    `import { pick } from "${VENDOR_DB}";`,
    `import { createSession, destroySession, findUserByEmail,${hasReset ? " hashPassword," : ""} verifyPasswordEqualized } from "./auth.ts";`,
    'import { clearSessionCookie, serializeSessionCookie } from "./cookie.ts";',
    'import { users } from "./sessions.table.ts";',
    ...(flows.length > 0
      ? [
          `import { consumeAuthToken, createAuthToken${hasReset ? ", RESET_TOKEN_TTL_MS" : ""}${hasVerify ? ", VERIFY_TOKEN_TTL_MS" : ""} } from "./tokens.ts";`,
        ]
      : []),
    "",
    "/** auth.me 输出契约：users rowSchema 的列子集投影（pick——契约与数据同规范单源，§5.1） */",
    'const meOutput = pick(users.rowSchema, ["email", "role"]);',
    ...(hasReset
      ? [
          "",
          "export const RESET_EMAIL_SUBJECT = \"重置你的密码\";",
        ]
      : []),
    ...(hasVerify
      ? [
          "",
          "export const VERIFY_EMAIL_SUBJECT = \"验证你的邮箱\";",
        ]
      : []),
    ...(hasReset
      ? [
          "",
          "// —— B2 流程邮件模板（明文常量/纯函数，agent 可 grep 可改——不引模板引擎，决策 31 边界；",
          "// regen 会覆盖手改：改 knob 请改生成器模板或 regen 后审阅 diff 重改，§6.3）——",
          "/** 重置邮件正文（纯文本）：令牌单次使用 + 有效期 + 全端登出语义随行说明 */",
          "export function resetEmailText(token: string, expiresAt: number): string {",
          "  return [",
          '    "有人（应当是你本人）请求重置该邮箱对应账号的登录密码。",',
          '    "",',
          "    `重置令牌（单次使用）：${token}`,",
          "    `有效期至：${new Date(expiresAt).toISOString()}（过期/已用即失效；重置成功后该账号全部会话退出）`,",
          '    "",',
          '    "如非本人操作请忽略本邮件——该请求本身不改变你的密码。",',
          '  ].join("\\n");',
          "}",
        ]
      : []),
    ...(hasVerify
      ? [
          "",
          "/** 验证邮件正文（纯文本）：令牌单次使用 + 有效期 */",
          "export function verifyEmailText(token: string, expiresAt: number): string {",
          "  return [",
          '    "请验证该邮箱对应的账号所有权。",',
          '    "",',
          "    `验证令牌（单次使用）：${token}`,",
          "    `有效期至：${new Date(expiresAt).toISOString()}（过期/已用即失效）`,",
          '    "",',
          '    "如非本人操作请忽略本邮件。",',
          '  ].join("\\n");',
          "}",
        ]
      : []),
    ...(flows.length > 0
      ? [
          "",
          "/**",
          " * 流程邮件投递（B2）：ctx.email 已装配 → 记账投递（B3 atelier_email_log 可审计；投递失败是",
          " * 记账事实不是异常——send 不抛，status=failed 时 console.warn 指认账面并降级打出令牌，流程",
          " * 响应不泄漏投递状态）；ctx.email 缺位（可选位未装配）→ **console.warn 可发现通道降级**：",
          " * 令牌随 warn 打出——dev/测试态据此完成流程，绝不因缺装配炸端点。装配 createHandler({ email })",
          " * 后自动改走记账投递（两分支二选一）。诚实边界：令牌明文且时效敏感——生产环境务必装配真实",
          " * transport（warn 通道随装配自动失效）；投递正文（含令牌）按 B3「账即所发」落",
          " * atelier_email_log.payload——账面读取面 = 邮件读者面，这是可审计性的代价，非疏漏。",
          " */",
          "async function deliverFlowEmail(ctx: EndpointContext, to: string, subject: string, text: string, token: string): Promise<void> {",
          "  if (ctx.email != null) {",
          "    const r = await ctx.email.send({ to, subject, text });",
          '    if (r.status === "failed") {',
          "      console.warn(",
          "        `[gen auth] 邮件投递失败（status=failed，详见 atelier_email_log）：to=${to} error=${r.error ?? \"\"}\\n令牌（单次使用）：${token}`",
          "      );",
          "    }",
          "    return;",
          "  }",
          "  console.warn(`[gen auth] ctx.email 未装配（装配位 createHandler({ email })）——流程邮件降级 console 通道：to=${to} subject=${subject}\\n令牌（单次使用）：${token}`);",
          "}",
        ]
      : []),
    "",
    "/**",
    " * 登录失败锁定（A2 功能批功能8，in-memory v1）：同一登录标识连续失败 LOGIN_LOCKOUT_MAX_FAILURES 次",
    " * → 锁 LOGIN_LOCKOUT_MINUTES 分钟；锁定期内直接 423 ATR-345（不做 scrypt——锁定就是要省掉它），",
    " * 成功登录清零计数，锁定过期后新一轮计数（公平重试），锁定按标识隔离。诚实边界：单进程内存态，",
    " * 重启清零——多实例部署需外置锁定存储（v1 不做）。阈值/锁期为可改明文常量（regen 会覆盖手改——",
    " * §6.3：改 knob 请改生成器模板或 regen 后审阅 diff 重改）。",
    " */",
    "const LOGIN_LOCKOUT_MAX_FAILURES = 5;",
    "const LOGIN_LOCKOUT_MINUTES = 15;",
    "const loginFailures = new Map<string, { count: number; lockedUntil: number }>();",
    "",
    "/**",
    flows.length > 0
      ? ` * 注册 auth 端点族：三件套 + 流程端点（--flows ${flows.join(",")}：${flowLabel}）；装配点显式调用 registerAuthEndpoints(reg)——无 import 副作用魔法。`
      : " * 注册 auth 端点三件套（装配点显式调用 registerAuthEndpoints(reg)——无 import 副作用魔法）。",
    " * login 失败统一 401 文案（不泄露账号存在性）；本骨架不含注册端点——建户走 createUser（auth.ts）。",
    " */",
    "export function registerAuthEndpoints(reg: EndpointRegistry): void {",
    "  // auth.login：验证密码 → 建会话 → Set-Cookie（ctx.setCookie 于成功响应透传，失败路径不种 cookie）。",
    '  // 本端点自身免鉴权 = auth: { type: "none" } 显式声明（§6.2 显式消警位——沉默缺省才是高错区）。',
    "  reg.register(",
    '    defineCommand("auth.login", {',
    '      contract: { type: "object", reqProps: { email: { type: "string" }, password: { type: "string" } } },',
    '      output: { type: "object", reqProps: { ok: { type: "boolean" } } },',
    '      auth: { type: "none" },',
    "      handler: async (input: { email: string; password: string }, ctx) => {",
    "        const db = ctx.db as SqliteDb;",
    "        // A2 功能8：锁定检查在任何校验之前（锁定期的意义就是不做 scrypt）",
    "        const lock = loginFailures.get(input.email);",
    "        const now = Date.now();",
    "        if (lock != null && lock.lockedUntil > now) {",
    "          throw new AtrEndpointError(",
    "            endpointError(",
    '              "ATR-345",',
    '              `登录失败次数过多，该登录标识已被临时锁定（约剩 ${Math.ceil((lock.lockedUntil - now) / 60000)} 分钟）`,',
    '              `等待锁定过期后重试（连续失败 ${LOGIN_LOCKOUT_MAX_FAILURES} 次锁 ${LOGIN_LOCKOUT_MINUTES} 分钟，成功登录即清零）；锁定为单进程内存态、重启清零；若非本人操作请排查凭据泄露面`,',
    '              ["auth.login"]',
    "            ),",
    "            423",
    "          );",
    "        }",
    "        if (lock != null && lock.lockedUntil > 0 && lock.lockedUntil <= now) loginFailures.delete(input.email); // 锁定过期 → 新一轮计数",
    "        const user = findUserByEmail(db, input.email);",
    "        // A2 硬化8：账号枚举时序侧信道收口——用户不存在也对 dummy 哈希跑等价 scrypt（见",
    "        // auth.ts verifyPasswordEqualized），两条失败路径代价一致、文案统一，响应时间不再",
    "        // 区分「邮箱不存在」与「密码错误」。",
    "        const passwordOk = await verifyPasswordEqualized(input.password, user == null ? null : user.passwordHash);",
    "        if (user == null || !passwordOk) {",
    "          // A2 功能8：失败记账（含邮箱不存在路径——锁定判定不泄露账号存在性）；记账表有界：",
    "          // 超软上限先清过期条目、仍超则清最旧一半（宁可放开陈旧计数，不无界吃内存）。",
    "          const entry = loginFailures.get(input.email) ?? { count: 0, lockedUntil: 0 };",
    "          entry.count += 1;",
    "          if (entry.count >= LOGIN_LOCKOUT_MAX_FAILURES) entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000;",
    "          loginFailures.set(input.email, entry);",
    "          if (loginFailures.size > 10_000) {",
    "            const cutoff = Date.now();",
    "            for (const [k, v] of [...loginFailures]) {",
    "              if (v.lockedUntil > 0 && v.lockedUntil <= cutoff) loginFailures.delete(k);",
    "            }",
    "            for (const k of [...loginFailures.keys()].slice(0, loginFailures.size - 5_000)) loginFailures.delete(k);",
    "          }",
    "          throw new AtrEndpointError(",
    '            endpointError("ATR-340", "登录失败：邮箱或密码不正确", "核对凭据后重试；无账号时由应用侧以 createUser 建户（注册策略归应用，§6.1）"),',
    "            401",
    "          );",
    "        }",
    "        loginFailures.delete(input.email); // A2 功能8：成功登录清零失败计数",
    "        const session = createSession(db, user.id);",
    "        ctx.setCookie?.(serializeSessionCookie(session.token));",
    "        return { ok: true };",
    "      },",
    "    })",
    "  );",
    "",
    "  // auth.logout：销毁当前会话 + 清 cookie。auth: { type: \"session\" }——未登录调用被分发层拦截（401 ATR-340）。",
    "  reg.register(",
    '    defineCommand("auth.logout", {',
    '      output: { type: "object", reqProps: { ok: { type: "boolean" } } },',
    '      auth: { type: "session" },',
    "      handler: (_input: Record<string, unknown>, ctx) => {",
    "        const db = ctx.db as SqliteDb;",
    "        const auth = ctx.auth!; // 分发层拦截保证非空（§6.2）",
    "        destroySession(db, auth.token as string);",
    "        ctx.setCookie?.(clearSessionCookie());",
    "        return { ok: true };",
    "      },",
    "    })",
    "  );",
    "",
    "  // auth.me：当前会话主体（query）；output = pick(users.rowSchema, [\"email\", \"role\"])。",
    "  reg.register(",
    '    defineQuery("auth.me", {',
    "      output: meOutput,",
    '      auth: { type: "session" },',
    "      handler: (_input: Record<string, unknown>, ctx) => {",
    "        const db = ctx.db as SqliteDb;",
    "        const auth = ctx.auth!; // 分发层拦截保证非空（§6.2）",
    '        const user = db.prepare("SELECT email, role FROM users WHERE id = ?").get(auth.userId) as { email: string; role: string } | undefined;',
    "        if (user == null) {",
    "          throw new AtrEndpointError(",
    '            endpointError("ATR-340", "会话主体不存在（用户已删除而会话残留）", "重新登录建立会话；会话读取器按 JOIN users 校验，此路径出现即数据异常——排查 users/sessions 数据"),',
    "            401",
    "          );",
    "        }",
    "        return { email: user.email, role: user.role };",
    "      },",
    "    })",
    "  );",
    ...(hasReset
      ? [
          "",
          "  // auth.requestReset（B2 reset 流）：恒时诚实响应——无论邮箱存在与否响应同形 { ok: true }",
          "  //（账号枚举防护，A2 恒时纪律延续；本端点两条路径都无 login 式高代价凭据运算，无显著时序",
          "  // 信道——真实邮箱才建令牌 + 投递，ghost 邮箱零写入零投递）。投递经 ctx.email（B3 可选位），",
          "  // 缺位走 console.warn 降级（见 deliverFlowEmail）。",
          "  reg.register(",
          '    defineCommand("auth.requestReset", {',
          '      contract: { type: "object", reqProps: { email: { type: "string" } } },',
          '      output: { type: "object", reqProps: { ok: { type: "boolean" } } },',
          '      auth: { type: "none" },',
          "      handler: async (input: { email: string }, ctx) => {",
          "        const db = ctx.db as SqliteDb;",
          "        const user = findUserByEmail(db, input.email);",
          "        if (user != null) {",
          '          const t = createAuthToken(db, user.id, "reset", RESET_TOKEN_TTL_MS);',
          "          await deliverFlowEmail(ctx, user.email, RESET_EMAIL_SUBJECT, resetEmailText(t.token, t.expiresAt), t.token);",
          "        }",
          "        return { ok: true }; // 恒时诚实：存在与否同形 success（细节只进投递通道，不进响应）",
          "      },",
          "    })",
          "  );",
          "",
          "  // auth.resetPassword（B2 reset 流）：消费令牌 → 改密（A2 版本位哈希，hashPassword 同源）→",
          "  // 全端会话吊销（重置即登出所有设备，安全语义）+ 同用户全部未消费令牌作废（含 verify 令牌——",
          "  // 安全复位后一律重新申请）。scrypt 在事务外跑（异步代价不占事务窗口）；tx 内 = 认领 + 改密 +",
          "  // 吊销，任一步失败齐回滚（令牌认领与密码生效要么都发生要么都不发生）。",
          "  reg.register(",
          '    defineCommand("auth.resetPassword", {',
          '      contract: { type: "object", reqProps: { token: { type: "string" }, newPassword: { type: "string", min: 8 } } },',
          '      output: { type: "object", reqProps: { ok: { type: "boolean" } } },',
          '      auth: { type: "none" },',
          "      handler: async (input: { token: string; newPassword: string }, ctx) => {",
          "        const db = ctx.db as SqliteDb;",
          "        const passwordHash = await hashPassword(input.newPassword);",
          "        const claimed = await db.tx(() => {",
          '          const hit = consumeAuthToken(db, input.token, "reset"); // 不存在/已用/过期/kind 错配统一 null',
          "          if (hit == null) return null;",
          '          db.prepare("UPDATE users SET passwordHash = ? WHERE id = ?").run(passwordHash, hit.userId);',
          '          db.prepare("DELETE FROM sessions WHERE userId = ?").run(hit.userId); // 重置即全端登出',
          '          db.prepare("DELETE FROM auth_tokens WHERE userId = ?").run(hit.userId); // 未消费令牌一并作废',
          "          return hit;",
          "        });",
          "        if (claimed == null) {",
          "          throw new AtrEndpointError(",
          "            endpointError(",
          '              "ATR-340",',
          '              "重置链接无效或已过期",',
          '              "重新发起密码重置（auth.requestReset 换新令牌）；令牌单次有效且有时效——无效/过期/已用统一此文案，不区分细节",',
          '              ["auth.requestReset"]',
          "            ),",
          "            400",
          "          );",
          "        }",
          "        return { ok: true };",
          "      },",
          "    })",
          "  );",
        ]
      : []),
    ...(hasVerify
      ? [
          "",
          "  // auth.requestVerification（B2 verify 流）：需会话（最小安全形态——按 email 无身份的变体",
          "  // 天然是账号枚举信道，不做）；已验证用户幂等 ok 且不再发信（无邮件噪音）。投递同",
          "  // auth.requestReset（ctx.email 记账投递 / console.warn 降级）。",
          "  reg.register(",
          '    defineCommand("auth.requestVerification", {',
          '      output: { type: "object", reqProps: { ok: { type: "boolean" } } },',
          '      auth: { type: "session" },',
          "      handler: async (_input: Record<string, unknown>, ctx) => {",
          "        const db = ctx.db as SqliteDb;",
          "        const auth = ctx.auth!; // 分发层拦截保证非空（§6.2）",
          '        const user = db.prepare("SELECT id, email, verified FROM users WHERE id = ?").get(auth.userId) as { id: number; email: string; verified: number } | undefined;',
          "        if (user == null) {",
          "          throw new AtrEndpointError(",
          '            endpointError("ATR-340", "会话主体不存在（用户已删除而会话残留）", "重新登录建立会话；此路径出现即数据异常——排查 users/sessions 数据"),',
          "            401",
          "          );",
          "        }",
          "        if (Number(user.verified) === 1) return { ok: true }; // 已验证：幂等 ok，不再发信",
          '        const t = createAuthToken(db, user.id, "verify", VERIFY_TOKEN_TTL_MS);',
          "        await deliverFlowEmail(ctx, user.email, VERIFY_EMAIL_SUBJECT, verifyEmailText(t.token, t.expiresAt), t.token);",
          "        return { ok: true };",
          "      },",
          "    })",
          "  );",
          "",
          "  // auth.verifyEmail（B2 verify 流）：消费令牌 → 标记 user verified（users.verified 列随",
          "  // --flows verify 的 NNN_users_verified 迁移对落库，存量用户 DEFAULT 0）。诚实边界：verified",
          "  // 无框架级门禁拦截——拦截策略属应用层（端点自行读 ctx.auth 后查列做行级判断）。",
          "  reg.register(",
          '    defineCommand("auth.verifyEmail", {',
          '      contract: { type: "object", reqProps: { token: { type: "string" } } },',
          '      output: { type: "object", reqProps: { ok: { type: "boolean" } } },',
          '      auth: { type: "none" },',
          "      handler: async (input: { token: string }, ctx) => {",
          "        const db = ctx.db as SqliteDb;",
          '        const hit = consumeAuthToken(db, input.token, "verify"); // 不存在/已用/过期/kind 错配统一 null',
          "        if (hit == null) {",
          "          throw new AtrEndpointError(",
          "            endpointError(",
          '              "ATR-340",',
          '              "验证链接无效或已过期",',
          '              "重新发起邮箱验证（登录后调 auth.requestVerification 换新令牌）；无效/过期/已用统一此文案，不区分细节",',
          '              ["auth.requestVerification"]',
          "            ),",
          "            400",
          "          );",
          "        }",
          '        db.prepare("UPDATE users SET verified = 1 WHERE id = ?").run(hit.userId);',
          "        return { ok: true };",
          "      },",
          "    })",
          "  );",
        ]
      : []),
    "}",
    "",
  ].join("\n");
}

function renderMigrationUp() {
  return [
    "-- migration gen auth 骨架（up）：可手改；改后 checksum 即固定（改已应用文件 = ATR-332，§5.4）。",
    "-- 事务由迁移器逐条包裹：本文件不得自带 BEGIN/COMMIT。",
    "-- DDL 由 server/db.ts createTableSql 渲染（与数据契约同一真相源）。",
    createTableSql(USERS_DEF),
    createTableSql(SESSIONS_DEF),
    "",
  ].join("\n");
}

function renderMigrationDown() {
  return [
    "-- migration gen auth 骨架（down）：可手改。",
    "-- 级联不隐式（§5.1）：sessions.userId 引用 users(id)——按依赖逆序先删 sessions 再删 users。",
    "-- 不可逆：DROP TABLE 会丢弃 users/sessions 全部数据；确认安全后以 migrate down --force 执行（§18 R7；删本行标记 = 显式声明非破坏）。",
    dropTableSql(SESSIONS_DEF),
    dropTableSql(USERS_DEF),
    "",
  ].join("\n");
}

/* ---------- B2 流程迁移对（追加式；NNN_auth 迁移对不因 --flows 变化——跨态字节稳定） ---------- */

function renderAuthTokenMigrationUp() {
  return [
    "-- migration gen auth --flows 骨架（up）：可手改；改后 checksum 即固定（改已应用文件 = ATR-332，§5.4）。",
    "-- 事务由迁移器逐条包裹：本文件不得自带 BEGIN/COMMIT。",
    "-- DDL 由 server/db.ts createTableSql 渲染（与数据契约同一真相源）；kind 枚举校验在契约层（DDL 不重复 CHECK）。",
    createTableSql(AUTH_TOKENS_DEF),
    "",
  ].join("\n");
}

function renderAuthTokenMigrationDown() {
  return [
    "-- migration gen auth --flows 骨架（down）：可手改。",
    "-- 不可逆：DROP TABLE 会丢弃 auth_tokens 全部数据（未消费令牌作废，可重新申请——数据可弃）；确认安全后以 migrate down --force 执行（§18 R7；删本行标记 = 显式声明非破坏）。",
    dropTableSql(AUTH_TOKENS_DEF),
    "",
  ].join("\n");
}

function renderUsersVerifiedMigrationUp() {
  return [
    "-- migration gen auth --flows verify 骨架（up）：可手改；改后 checksum 即固定（改已应用文件 = ATR-332，§5.4）。",
    "-- 事务由迁移器逐条包裹：本文件不得自带 BEGIN/COMMIT。",
    "-- users.verified（B2 verify 流）：0=未验证 / 1=已验证；存量用户经 DEFAULT 0 落列（verified 无框架级门禁拦截——策略属应用层）。",
    "-- 加列无 createTableSql 渲染位（它管建表）——ALTER TABLE 骨架，列形状与 sessions.table.ts 契约一致。",
    "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;",
    "",
  ].join("\n");
}

function renderUsersVerifiedMigrationDown() {
  return [
    "-- migration gen auth --flows verify 骨架（down）：可手改。",
    "-- 不可逆：DROP COLUMN 会丢弃 users.verified 全部数据；确认安全后以 migrate down --force 执行（§18 R7；删本行标记 = 显式声明非破坏）。",
    "ALTER TABLE users DROP COLUMN verified;",
    "",
  ].join("\n");
}

/* ---------- 主入口 ---------- */

function relDisplay(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * 纯 API：给定应用根目录，产出鉴权件 + 成对迁移骨架（追加式）。opts.flows：undefined/"reset"/
 * "verify"/"reset,verify"（或等价数组，经 parseFlows 规范化；未知旗标 GenAuthError）。
 *
 * regen 幂等：TS 产物全量重写（固定模板 → 字节全同）；迁移对按名覆盖位只追加——
 *   NNN_auth（users+sessions）内容不因 --flows 变化（跨态字节稳定）；流程迁移对独立追加：
 *   NNN_auth_tokens（reset|verify）→ NNN_users_verified（仅 verify），编号 = 现有最大 NNN 顺延；
 *   已存在迁移文件永不重写（§5.4）。返回诚实清单 { written, migrationsAppended, flows }
 *   （相对 root 的 posix 路径，仅本次实际写入的文件）。
 */
export function genAuth(root, opts = {}) {
  const flows = Array.isArray(opts.flows) ? parseFlows(opts.flows.join(",")) : parseFlows(opts.flows);
  if (!fs.existsSync(root)) {
    die(`应用根目录不存在：${root}`, "gen auth 以 --root 指向的应用目录为落点——先 init 或传入既有应用目录");
  }
  const authDir = path.join(root, "src", "server", "auth");
  const migDir = path.join(root, "src", "server", "db", "migrations");
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(migDir, { recursive: true });

  const written = [];
  const put = (file, content) => {
    fs.writeFileSync(file, content);
    written.push(relDisplay(root, file));
  };

  put(path.join(authDir, "sessions.table.ts"), renderSessionsTable(flows));
  put(path.join(authDir, "cookie.ts"), renderCookie());
  put(path.join(authDir, "auth.ts"), renderAuth());
  if (flows.length > 0) put(path.join(authDir, "tokens.ts"), renderTokens());
  put(path.join(authDir, "endpoints.ts"), renderEndpoints(flows));

  // 迁移对（追加式）：编号 = 现有最大 NNN 顺延（与 gen db 同款扫描）；同名覆盖位已存在 → 永不重写
  const existing = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
  const nums = existing
    .map((f) => /^(\d+)_/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const maxN = nums.length > 0 ? Math.max(...nums) : 0;
  const width = Math.max(3, String(maxN).length);
  let next = maxN + 1;
  const migrationsAppended = [];

  // ① auth 对（users+sessions）：内容不因 --flows 变化（流程表/列走独立迁移对——跨态字节稳定）
  if (!existing.some((f) => /^\d+_auth\.up\.sql$/.test(f))) {
    const num = String(next++).padStart(width, "0");
    const up = path.join(migDir, `${num}_auth.up.sql`);
    const down = path.join(migDir, `${num}_auth.down.sql`);
    // 双保险：迁移文件永不重写（§5.4 追加式）——编号推进已保证，仍以防外部并发/手误
    if (fs.existsSync(up) || fs.existsSync(down)) {
      die(`迁移 ${num}_auth 已存在，拒绝重写`, "已生成/已应用的迁移永不重写（§5.4）；如需变更请手写新编号迁移");
    }
    put(up, renderMigrationUp());
    put(down, renderMigrationDown());
    migrationsAppended.push(`${num}_auth`);
  }

  // ② auth_tokens 对（reset|verify 共用一张令牌表）
  if (flows.length > 0 && !existing.some((f) => /^\d+_auth_tokens\.up\.sql$/.test(f))) {
    const num = String(next++).padStart(width, "0");
    const up = path.join(migDir, `${num}_auth_tokens.up.sql`);
    const down = path.join(migDir, `${num}_auth_tokens.down.sql`);
    if (fs.existsSync(up) || fs.existsSync(down)) {
      die(`迁移 ${num}_auth_tokens 已存在，拒绝重写`, "已生成/已应用的迁移永不重写（§5.4）；如需变更请手写新编号迁移");
    }
    put(up, renderAuthTokenMigrationUp());
    put(down, renderAuthTokenMigrationDown());
    migrationsAppended.push(`${num}_auth_tokens`);
  }

  // ③ users_verified 对（仅 verify；ALTER TABLE 加列——users 表契约同步带 verified 列）
  if (flows.includes("verify") && !existing.some((f) => /^\d+_users_verified\.up\.sql$/.test(f))) {
    const num = String(next++).padStart(width, "0");
    const up = path.join(migDir, `${num}_users_verified.up.sql`);
    const down = path.join(migDir, `${num}_users_verified.down.sql`);
    if (fs.existsSync(up) || fs.existsSync(down)) {
      die(`迁移 ${num}_users_verified 已存在，拒绝重写`, "已生成/已应用的迁移永不重写（§5.4）；如需变更请手写新编号迁移");
    }
    put(up, renderUsersVerifiedMigrationUp());
    put(down, renderUsersVerifiedMigrationDown());
    migrationsAppended.push(`${num}_users_verified`);
  }

  return { written, migrationsAppended, flows };
}

/* ---------- CLI（独立运行时；纯 API 消费方不走此段） ---------- */

const INVOKED_DIRECTLY = process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (INVOKED_DIRECTLY) {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = path.resolve(argOf("--root") ?? process.cwd());
  const flowsArg = argOf("--flows");
  try {
    const { written, migrationsAppended, flows } = genAuth(root, { flows: flowsArg });
    console.log(`gen auth：${root}${flows.length > 0 ? `（--flows ${flows.join(",")}）` : ""}`);
    for (const f of written) console.log(`- 写入 ${f}`);
    console.log(
      migrationsAppended.length > 0
        ? `迁移对（追加式，已存在文件永不重写）：${migrationsAppended.join(", ")}`
        : "迁移对：已存在（同名覆盖位永不重写）"
    );
    if (flows.length > 0) {
      const flowEps = [
        flows.includes("reset") ? "auth.requestReset / auth.resetPassword" : null,
        flows.includes("verify") ? "auth.requestVerification / auth.verifyEmail" : null,
      ].filter(Boolean);
      console.log(`流程端点（B2）：${flowEps.join(" + ")}；令牌只存 sha256（tokens.ts 原语）；投递经 ctx.email（B3 可选位——缺位 console.warn 降级，装配 createHandler({ email }) 改走记账投递）。`);
      console.log("装配：registerAuthEndpoints(reg) 一并注册流程端点；先 migrate up（users_verified 对仅 verify 流）。");
    }
    console.log("装配：main-server.ts 里 createHandler({ db, auth: createSessionReader(db) }) + registerAuthEndpoints(reg)——示例见 src/server/auth/auth.ts 头注释。");
    console.log(`done：${written.length} 个文件。regen 幂等：再跑一次应字节全同。`);
  } catch (e) {
    console.error(`error: ${e.message}${e.fix ? `\nfix: ${e.fix}` : ""}`);
    process.exit(1);
  }
}
