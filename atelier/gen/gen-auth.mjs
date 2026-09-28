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
 * 默认形态 = 邮箱+密码；magic link 变体不做（regen 模板选择归后续——auth.ts JSDoc 注明契约位）。
 *
 * 生成器纪律（§7，与 gen-db.mjs 同源）：产物为纯函数渲染（同输入 → 字节全同，regen 幂等）；
 * DDL 经 server/db.ts 的 createTableSql/dropTableSql 渲染（契约校验与迁移 DDL 不出现第二套实现）；
 * regen 重写 TS 产物为字节全同内容（手改被覆盖——§6.3：regen 前先 git diff 审阅），迁移只追加。
 *
 * 用法：node atelier/gen/gen-auth.mjs --root <appDir>
 * 纯 API：import { genAuth, GenAuthError } from "<repo>/atelier/gen/gen-auth.mjs"
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

function renderSessionsTable() {
  return [
    "// @atelier-generated (gen auth) — 鉴权域数据契约（§6.1）：users（凭据）+ sessions（会话）。",
    "// 与 schema 单源同规范（server/db.ts 的 table() 扁平字面量）；应用已有 src/server/db/schema.ts 时",
    "// 可把两个定义并入单源后删除本文件（import 相对路径随之调整——gen db 只扫描单源文件）。",
    "// regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3：regen 前先 git diff 审阅）。",
    `import { table } from "${VENDOR_DB}";`,
    "",
    renderTableLiteral(USERS_DEF, "users", ""),
    "",
    renderTableLiteral(SESSIONS_DEF, "sessions", ""),
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

function renderEndpoints() {
  return [
    "// @atelier-generated (gen auth) — auth.login / auth.logout / auth.me 端点骨架（§6.1）。",
    "// 契约：input = 就地 FlatSchema 字面量；auth.me 的 output = users rowSchema 的 pick 投影（数据契约同规范单源，§5.1）。",
    "// 角色声明示例：需要角色的端点写 auth: { type: \"session\", role: \"admin\" }——分发层拦截（403 ATR-341），",
    "// handler 内无需重复检查；行级判断读 ctx.auth 显式做（RLS 式隐式策略不做，§6.2）。",
    "// 诚实边界：本文件在 src/server/auth/（§6.1 布局）——gen endpoint 的 api.ts 客户端只扫",
    "// src/server/endpoints/，auth 端点的前端调用走 fetch 或手工并入客户端（v1 边界）。",
    "// regen 语义：每次重写为字节全同内容；手改会被 regen 覆盖（§6.3：regen 前先 git diff 审阅）。",
    `import { AtrEndpointError, defineCommand, defineQuery, endpointError, type EndpointRegistry } from "${VENDOR_INDEX}";`,
    `import type { SqliteDb } from "${VENDOR_SQLITE}";`,
    `import { pick } from "${VENDOR_DB}";`,
    'import { createSession, destroySession, findUserByEmail, verifyPassword } from "./auth.ts";',
    'import { clearSessionCookie, serializeSessionCookie } from "./cookie.ts";',
    'import { users } from "./sessions.table.ts";',
    "",
    '/** auth.me 输出契约：users rowSchema 的列子集投影（pick——契约与数据同规范单源，§5.1） */',
    'const meOutput = pick(users.rowSchema, ["email", "role"]);',
    "",
    "/**",
    " * 注册 auth 端点三件套（装配点显式调用 registerAuthEndpoints(reg)——无 import 副作用魔法）。",
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
    "        const user = findUserByEmail(db, input.email);",
    '        if (user == null || !(await verifyPassword(input.password, user.passwordHash))) {',
    "          throw new AtrEndpointError(",
    '            endpointError("ATR-340", "登录失败：邮箱或密码不正确", "核对凭据后重试；无账号时由应用侧以 createUser 建户（注册策略归应用，§6.1）"),',
    "            401",
    "          );",
    "        }",
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

/* ---------- 主入口 ---------- */

function relDisplay(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * 纯 API：给定应用根目录，产出鉴权五件套 + 成对迁移骨架（追加式）。
 * regen 幂等：五个 TS 产物全量重写（固定模板 → 字节全同）；迁移对只在 <NNN>_auth 尚不存在时追加，
 * 已存在迁移文件永不重写（§5.4）。返回诚实清单 { written, migrationsAppended }（相对 root 的 posix 路径，
 * 仅本次实际写入的文件）。
 */
export function genAuth(root) {
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

  put(path.join(authDir, "sessions.table.ts"), renderSessionsTable());
  put(path.join(authDir, "cookie.ts"), renderCookie());
  put(path.join(authDir, "auth.ts"), renderAuth());
  put(path.join(authDir, "endpoints.ts"), renderEndpoints());

  // 迁移对（追加式）：编号 = 现有最大 NNN+1（与 gen db 同款扫描）；NNN_auth 已存在 → 永不重写
  const existing = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
  const nums = existing
    .map((f) => /^(\d+)_/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const maxN = nums.length > 0 ? Math.max(...nums) : 0;
  const width = Math.max(3, String(maxN).length);
  const migrationsAppended = [];
  const covered = existing.some((f) => /^\d+_auth\.up\.sql$/.test(f));
  if (!covered) {
    const num = String(maxN + 1).padStart(width, "0");
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
  return { written, migrationsAppended };
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
  try {
    const { written, migrationsAppended } = genAuth(root);
    console.log(`gen auth：${root}`);
    for (const f of written) console.log(`- 写入 ${f}`);
    console.log(
      migrationsAppended.length > 0
        ? `迁移对（追加式，已存在文件永不重写）：${migrationsAppended.join(", ")}`
        : "迁移对：已存在（NNN_auth 永不重写）"
    );
    console.log("装配：main-server.ts 里 createHandler({ db, auth: createSessionReader(db) }) + registerAuthEndpoints(reg)——示例见 src/server/auth/auth.ts 头注释。");
    console.log(`done：${written.length} 个文件。regen 幂等：再跑一次应字节全同。`);
  } catch (e) {
    console.error(`error: ${e.message}${e.fix ? `\nfix: ${e.fix}` : ""}`);
    process.exit(1);
  }
}
