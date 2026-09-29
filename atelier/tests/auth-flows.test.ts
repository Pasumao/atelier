/**
 * auth-flows.test.ts — `atelier gen auth --flows reset,verify`（FS-DESIGN §6.1 落地注记 2026-09-28，
 * 差距批 B2：密码重置 + 邮箱验证流）验收：
 *   · 两态字节面：缺省无 --flows = 现状三件套字节不变（负例钉死：流程标记零出现 + 共享产物跨态字节全同）；
 *     --flows 态 = token 表契约 + tokens.ts 原语 + 流程端点 + 流程迁移对（auth_tokens / users_verified）
 *   · regen 字节幂等（flows 态二次运行字节全同、迁移只追加）；单选/双选产物面裁剪；未知旗标 GenAuthError
 *   · 迁移编号追加（既有迁移永不重写）+ 迁移对真实可应用（verified 列/auth_tokens 表落库）
 *   · 端到端（真实 registry dispatch + node:sqlite + B3 email 记账）：
 *     requestReset（恒时诚实响应）→ 记账见投递 → resetPassword → 旧密码拒/新密码过 → 全端会话吊销
 *     → token 单次使用 / 过期 / kind 错配同一失败路径 → ctx.email 缺位 console.warn 降级不炸
 *     → verify 流（requestVerification 会话拦截 → verifyEmail → verified 落库）
 *   · 投影面：gen endpoint / export openapi 既有 auth 扫描面自动纳入四流程端点（内联契约字面量形态）
 * 产物经 vitest.config 的 vendor shim 以真实 vendored 布局被加载（import 闭合真实检验）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { genAuth, GenAuthError, parseFlows } from "../gen/gen-auth.mjs";
import { scanEndpoints } from "../gen/gen-endpoint.mjs";
import { buildOpenApi, scanOpenApiEndpointFiles } from "../gen/export-openapi.mjs";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { migrateUp } from "../server/migrate";
import { AtrEndpointError, EndpointRegistry } from "../server/endpoints";
import { createEmailRecorder, type EmailRecorder } from "../server/email";

/* ---------- fixture ---------- */
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-authflows-"));
  tmpDirs.push(root);
  return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用（诚实边界：Bun 不在场，bun 路径不实测）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

/* ---------- describe A：生成器两态（产物形态 + regen 幂等 + 追加式迁移） ---------- */

describe("gen auth --flows 两态（B2；缺省字节不变负例 + flows 产物面 + regen 幂等）", () => {
  it("缺省无 --flows：现状三件套字节不变（流程标记零出现的负例钉死）", () => {
    const root = makeFixtureRoot();
    const { written, migrationsAppended } = genAuth(root);
    // 产物清单 = 既有五件套 + 001_auth 对（现状口径，一字不差）
    expect(written).toEqual([
      "src/server/auth/sessions.table.ts",
      "src/server/auth/cookie.ts",
      "src/server/auth/auth.ts",
      "src/server/auth/endpoints.ts",
      "src/server/db/migrations/001_auth.up.sql",
      "src/server/db/migrations/001_auth.down.sql",
    ]);
    expect(migrationsAppended).toEqual(["001_auth"]);
    expect(exists(root, "src/server/auth/tokens.ts")).toBe(false); // 流程原语文件不出现
    // 流程标记零出现（任一流程符号泄漏进缺省产物 = 两态失守）
    const endpoints = read(root, "src/server/auth/endpoints.ts");
    const tables = read(root, "src/server/auth/sessions.table.ts");
    for (const marker of [
      "auth.requestReset",
      "auth.resetPassword",
      "auth.requestVerification",
      "auth.verifyEmail",
      "auth_tokens",
      "deliverFlowEmail",
      "tokens.ts",
      "RESET_EMAIL_SUBJECT",
      "flows",
    ]) {
      expect(endpoints).not.toContain(marker);
      expect(tables).not.toContain(marker);
    }
    expect(tables).not.toContain("verified"); // users 契约不加列
    for (const mig of ["auth_tokens", "users_verified", "ALTER TABLE"]) {
      expect(read(root, "src/server/db/migrations/001_auth.up.sql")).not.toContain(mig);
      expect(read(root, "src/server/db/migrations/001_auth.down.sql")).not.toContain(mig);
    }
  });

  it("跨态字节对照：cookie.ts / auth.ts / 001_auth 迁移对与 flows 态逐字节全同（flows 只加不改）", () => {
    const rootD = makeFixtureRoot();
    const rootF = makeFixtureRoot();
    genAuth(rootD);
    genAuth(rootF, { flows: ["reset", "verify"] });
    for (const rel of [
      "src/server/auth/cookie.ts",
      "src/server/auth/auth.ts",
      "src/server/db/migrations/001_auth.up.sql",
      "src/server/db/migrations/001_auth.down.sql",
    ]) {
      expect(read(rootF, rel)).toBe(read(rootD, rel)); // 共享产物跨态零字节漂移
    }
  });

  it("--flows reset,verify：产物清单 + token 表契约 + tokens.ts 原语 + 四流程端点 + 流程迁移对", () => {
    const root = makeFixtureRoot();
    const { written, migrationsAppended } = genAuth(root, { flows: ["reset", "verify"] });
    // 新增面：tokens.ts + 002_auth_tokens 对 + 003_users_verified 对（追加式编号）
    expect(written).toContain("src/server/auth/tokens.ts");
    expect(written).toContain("src/server/db/migrations/002_auth_tokens.up.sql");
    expect(written).toContain("src/server/db/migrations/002_auth_tokens.down.sql");
    expect(written).toContain("src/server/db/migrations/003_users_verified.up.sql");
    expect(written).toContain("src/server/db/migrations/003_users_verified.down.sql");
    expect(migrationsAppended).toEqual(["001_auth", "002_auth_tokens", "003_users_verified"]);

    // sessions.table.ts：auth_tokens 表契约（只存哈希 + kind 枚举 + 过期/已用列）+ users.verified 加列
    const tables = read(root, "src/server/auth/sessions.table.ts");
    expect(tables).toContain('table("auth_tokens"');
    expect(tables).toContain("tokenHash");
    expect(tables).toContain('enum: ["reset", "verify"]');
    expect(tables).toContain("usedAt");
    expect(tables).toContain("verified");
    expect(tables).toContain('references: "users.id"');

    // tokens.ts：哈希入库原语（sha256 + 单次消费），头部 @atelier-generated 标记 + 显式 import 闭合
    const tokens = read(root, "src/server/auth/tokens.ts");
    expect(tokens).toContain("@atelier-generated");
    expect(tokens).toContain('from "node:crypto"');
    expect(tokens).toContain("createHash");
    expect(tokens).toContain("sha256");
    expect(tokens).toContain("export function createAuthToken");
    expect(tokens).toContain("export function consumeAuthToken");
    expect(tokens).toContain("RESET_TOKEN_TTL_MS");
    expect(tokens).toContain("VERIFY_TOKEN_TTL_MS");
    expect(tokens).toContain('from "../../vendor/atelier/server/sqlite.ts"');

    // endpoints.ts：四流程端点 + 邮件模板明文常量 + ctx.email 缺位降级通道（console.warn 可发现）
    const ep = read(root, "src/server/auth/endpoints.ts");
    for (const name of ["auth.requestReset", "auth.resetPassword", "auth.requestVerification", "auth.verifyEmail"]) {
      expect(ep).toContain(`defineCommand("${name}"`);
    }
    expect(ep).toContain('auth: { type: "none" }'); // requestReset/resetPassword/verifyEmail 免鉴权显式声明
    expect(ep).toContain("RESET_EMAIL_SUBJECT");
    expect(ep).toContain("VERIFY_EMAIL_SUBJECT");
    expect(ep).toContain("ctx.email"); // 降级注释/分支可 grep
    expect(ep).toContain("console.warn");
    expect(ep).toContain('from "./tokens.ts"'); // 流程原语显式 import 闭合
    expect(ep).toContain("DELETE FROM sessions WHERE userId"); // 重置即全端登出

    // 流程迁移对内容：token 表 DDL 由 createTableSql 渲染（契约单源）；users 加列 = ALTER TABLE
    const tokensUp = read(root, "src/server/db/migrations/002_auth_tokens.up.sql");
    expect(tokensUp).toContain("CREATE TABLE IF NOT EXISTS auth_tokens (");
    expect(tokensUp).toContain("REFERENCES users(id)");
    expect(tokensUp).toContain("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user");
    const verifiedUp = read(root, "src/server/db/migrations/003_users_verified.up.sql");
    expect(verifiedUp).toContain("ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;");
    const verifiedDown = read(root, "src/server/db/migrations/003_users_verified.down.sql");
    expect(verifiedDown).toContain("ALTER TABLE users DROP COLUMN verified;");
    expect(verifiedDown).toContain("不可逆："); // 丢列 = 数据丢弃，--force 显式同意（§18 R7）
  });

  it("regen 字节幂等（flows 态）：TS 产物重写字节全同；迁移对不重复追加", () => {
    const root = makeFixtureRoot();
    genAuth(root, { flows: ["reset", "verify"] });
    const files = [
      "src/server/auth/sessions.table.ts",
      "src/server/auth/cookie.ts",
      "src/server/auth/auth.ts",
      "src/server/auth/tokens.ts",
      "src/server/auth/endpoints.ts",
      "src/server/db/migrations/001_auth.up.sql",
      "src/server/db/migrations/001_auth.down.sql",
      "src/server/db/migrations/002_auth_tokens.up.sql",
      "src/server/db/migrations/002_auth_tokens.down.sql",
      "src/server/db/migrations/003_users_verified.up.sql",
      "src/server/db/migrations/003_users_verified.down.sql",
    ];
    const before = files.map((f) => read(root, f));
    const second = genAuth(root, { flows: ["reset", "verify"] });
    expect(second.migrationsAppended).toEqual([]); // 已存在迁移对永不重写（§5.4）
    expect(second.written).not.toContain("src/server/db/migrations/002_auth_tokens.up.sql");
    expect(second.written).not.toContain("src/server/db/migrations/003_users_verified.up.sql");
    expect(files.map((f) => read(root, f))).toEqual(before);
  });

  it("regen 幂等（flows 追加态）：缺省产物已生成过 → 带 flows regen 只追加流程迁移，既有字节不动", () => {
    const root = makeFixtureRoot();
    genAuth(root); // 第一天：缺省三件套 + 001_auth
    const authEpBefore = read(root, "src/server/auth/endpoints.ts");
    const second = genAuth(root, { flows: ["verify"] }); // 第二天：追加 verify 流
    expect(second.migrationsAppended).toEqual(["002_auth_tokens", "003_users_verified"]);
    expect(read(root, "src/server/auth/endpoints.ts")).not.toBe(authEpBefore); // TS 产物重写（regen 语义）
    // 流程迁移覆盖位生效：再来一次（同态）→ 不再追加
    const third = genAuth(root, { flows: ["verify"] });
    expect(third.migrationsAppended).toEqual([]);
  });

  it("单选裁剪：--flows reset 不产 verified/users_verified/verify 端点；--flows verify 不产 reset 端点", () => {
    const rootR = makeFixtureRoot();
    genAuth(rootR, { flows: ["reset"] });
    const tablesR = read(rootR, "src/server/auth/sessions.table.ts");
    const epR = read(rootR, "src/server/auth/endpoints.ts");
    expect(tablesR).toContain('table("auth_tokens"');
    expect(tablesR).not.toContain("verified"); // reset 流不动 users 契约
    expect(epR).toContain('defineCommand("auth.requestReset"');
    expect(epR).toContain('defineCommand("auth.resetPassword"');
    expect(epR).not.toContain("auth.requestVerification");
    expect(epR).not.toContain("auth.verifyEmail");
    expect(epR).not.toContain("VERIFY_EMAIL_SUBJECT");
    expect(exists(rootR, "src/server/db/migrations/002_auth_tokens.up.sql")).toBe(true);
    expect(exists(rootR, "src/server/db/migrations/003_users_verified.up.sql")).toBe(false);

    const rootV = makeFixtureRoot();
    genAuth(rootV, { flows: ["verify"] });
    const epV = read(rootV, "src/server/auth/endpoints.ts");
    expect(epV).toContain('defineCommand("auth.requestVerification"');
    expect(epV).toContain('defineCommand("auth.verifyEmail"');
    expect(epV).not.toContain("auth.requestReset");
    expect(epV).not.toContain("auth.resetPassword");
    expect(exists(rootV, "src/server/db/migrations/002_auth_tokens.up.sql")).toBe(true); // verify 也走 token 表
    expect(exists(rootV, "src/server/db/migrations/003_users_verified.up.sql")).toBe(true);
  });

  it("未知 --flows 旗标 → GenAuthError（fix 指路合法清单）；parseFlows 规范化（去重/定序/空白容忍）", () => {
    const root = makeFixtureRoot();
    expect(() => genAuth(root, { flows: ["bogus"] as never })).toThrow(GenAuthError);
    expect(() => parseFlows("reset,bogus")).toThrow(GenAuthError);
    expect(() => parseFlows("verify, verify ,reset")).not.toThrow();
    expect(parseFlows(undefined)).toEqual([]);
    expect(parseFlows("reset,verify")).toEqual(["reset", "verify"]);
    expect(parseFlows("verify, verify ,reset")).toEqual(["reset", "verify"]); // 规范序 + 去重
  });

  it("迁移编号追加：既有 001_chats 对 → auth 取 002/003/004；旧文件字节未动（追加式永不重写，§5.4）", () => {
    const root = makeFixtureRoot();
    const migDir = path.join(root, "src", "server", "db", "migrations");
    fs.mkdirSync(migDir, { recursive: true });
    fs.writeFileSync(path.join(migDir, "001_chats.up.sql"), "CREATE TABLE chats (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");
    fs.writeFileSync(path.join(migDir, "001_chats.down.sql"), "DROP TABLE chats;");
    const oldUp = fs.readFileSync(path.join(migDir, "001_chats.up.sql"));
    const { migrationsAppended } = genAuth(root, { flows: ["reset", "verify"] });
    expect(migrationsAppended).toEqual(["002_auth", "003_auth_tokens", "004_users_verified"]);
    expect(fs.readFileSync(path.join(migDir, "001_chats.up.sql"))).toEqual(oldUp);
  });
});

describeSqlite("gen auth --flows 迁移对（真实 node:sqlite 应用）", () => {
  it("迁移对真实可应用：users 带 verified 列 + auth_tokens 表落库；故意删 down → migrateUp ATR-331 拒绝", async () => {
    const root = makeFixtureRoot();
    genAuth(root, { flows: ["reset", "verify"] });
    const migDir = path.join(root, "src", "server", "db", "migrations");
    const db = await openSqlite(":memory:");
    expect(migrateUp(db, migDir).map((s) => s.name)).toEqual(["001_auth", "002_auth_tokens", "003_users_verified"]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("auth_tokens");
    const userCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((r) => r.name);
    expect(userCols).toContain("verified");
    const tokenCols = (db.prepare("PRAGMA table_info(auth_tokens)").all() as { name: string }[]).map((r) => r.name);
    for (const col of ["userId", "kind", "tokenHash", "expiresAt", "usedAt"]) expect(tokenCols).toContain(col);
    db.close();
    fs.rmSync(path.join(migDir, "003_users_verified.down.sql")); // 先红：故意拆掉配对
    const db2 = await openSqlite(":memory:");
    try {
      migrateUp(db2, migDir);
      throw new Error("应当抛出");
    } catch (e) {
      expect((e as AtrEndpointError).atr.code).toBe("ATR-331");
      expect((e as AtrEndpointError).message).toContain("003_users_verified");
    }
    db2.close();
  });
});

/* ---------- describe B：端到端（真实 registry dispatch + B3 email 记账） ---------- */

describeSqlite("auth 流程端到端（--flows reset,verify；真实 registry dispatch + email 记账）", () => {
  interface FlowMods {
    createUser: (db: SqliteDb, email: string, password: string, role?: string) => Promise<{ id: number; email: string; role: string }>;
    createSessionReader: (db: SqliteDb) => (req: Request) => { type: string } | null;
    tokens: {
      createAuthToken: (db: SqliteDb, userId: number, kind: "reset" | "verify", ttlMs: number) => { id: number; token: string; expiresAt: number };
      consumeAuthToken: (db: SqliteDb, rawToken: string, kind: "reset" | "verify") => { userId: number } | null;
    };
  }

  async function setup(opts: { withEmail?: boolean } = {}): Promise<{
    root: string;
    db: SqliteDb;
    authMod: { createUser: FlowMods["createUser"]; createSessionReader: FlowMods["createSessionReader"] };
    tokens: FlowMods["tokens"];
    handler: (req: Request) => Promise<Response>;
    email: EmailRecorder;
  }> {
    const root = makeFixtureRoot();
    genAuth(root, { flows: ["reset", "verify"] });
    const db = await openSqlite(":memory:");
    migrateUp(db, path.join(root, "src", "server", "db", "migrations"));
    const load = async (rel: string) => (await import(pathToFileURL(path.join(root, rel)).href)) as Record<string, unknown>;
    const epMod = (await load("src/server/auth/endpoints.ts")) as { registerAuthEndpoints: (reg: EndpointRegistry) => void };
    const authMod = (await load("src/server/auth/auth.ts")) as unknown as {
      createUser: FlowMods["createUser"];
      createSessionReader: FlowMods["createSessionReader"];
    };
    const tokens = (await load("src/server/auth/tokens.ts")) as unknown as FlowMods["tokens"];
    const reg = new EndpointRegistry();
    epMod.registerAuthEndpoints(reg);
    const email = createEmailRecorder({ db });
    const handler = reg.createHandler({
      db,
      auth: authMod.createSessionReader(db),
      ...(opts.withEmail === false ? {} : { email }),
    });
    return { root, db, authMod, tokens, handler, email };
  }

  const post = (h: (req: Request) => Promise<Response>, name: string, body: unknown, cookie?: string) =>
    h(
      new Request(`http://local.test/${name}`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    );

  const cookieOf = (res: Response) => `atelier_session=${/atelier_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]}`;
  const tokenFromLog = (email: EmailRecorder, subject: string): string => {
    const row = [...email.tail(10)].reverse().find((e) => e.subject === subject);
    if (row == null) throw new Error(`记账表未见 subject=${subject} 的投递行`);
    const text = (row.payload as { text?: string }).text ?? "";
    const m = /令牌（单次使用）：([0-9a-f]{64})/.exec(text);
    if (m == null) throw new Error(`投递正文无 64 hex 令牌：${text.slice(0, 120)}`);
    return m[1];
  };

  it("reset 全链：requestReset 记账见投递 → resetPassword 改密 → 旧密码拒/新密码过 → 全端会话吊销 + 未消费令牌作废", async () => {
    const { db, authMod, tokens, handler, email } = await setup();
    const user = await authMod.createUser(db, "agent@test.dev", "old-pass-123", "user");
    // 双端登录：A（本机）+ B（第二设备）
    const loginA = await post(handler, "auth.login", { email: "agent@test.dev", password: "old-pass-123" });
    const loginB = await post(handler, "auth.login", { email: "agent@test.dev", password: "old-pass-123" });
    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);
    const cookieA = cookieOf(loginA);
    const cookieB = cookieOf(loginB);
    // 额外一枚未消费的重置令牌（模拟攻击者/用户此前请求过）——重置成功后必须一并作废
    const stray = tokens.createAuthToken(db, user.id, "reset", 60 * 60 * 1000);

    // ① requestReset：恒时诚实响应 { ok: true } + 记账表见投递（B3 mock transport 真信源）
    const req1 = await post(handler, "auth.requestReset", { email: "agent@test.dev" });
    expect(req1.status).toBe(200);
    expect(await req1.json()).toEqual({ ok: true });
    const token = tokenFromLog(email, "重置你的密码");
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32B 随机 hex，明文只经邮件通道出站

    // ② resetPassword：消费 token 改密（事务 = 认领 + 改密 + 全端登出）
    const reset = await post(handler, "auth.resetPassword", { token, newPassword: "new-pass-456" });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ ok: true });

    // ③ 旧密码拒 / 新密码过（A2 版本位哈希经同一 hashPassword 落库）
    const oldLogin = await post(handler, "auth.login", { email: "agent@test.dev", password: "old-pass-123" });
    expect(oldLogin.status).toBe(401);
    expect((await oldLogin.json()).code).toBe("ATR-340");
    const newLogin = await post(handler, "auth.login", { email: "agent@test.dev", password: "new-pass-456" });
    expect(newLogin.status).toBe(200);

    // ④ 全端会话吊销：A/B 两枚 cookie 全部失效（重置即登出所有设备）
    for (const cookie of [cookieA, cookieB]) {
      const me = await post(handler, "auth.me", {}, cookie);
      expect(me.status).toBe(401);
      expect((await me.json()).code).toBe("ATR-340");
    }
    // ⑤ 未消费的重置令牌一并作废（同用户全 token 吊销）
    const strayUse = await post(handler, "auth.resetPassword", { token: stray.token, newPassword: "hijack-pass" });
    expect(strayUse.status).toBe(400);
    expect((await strayUse.json()).code).toBe("ATR-340");
    db.close();
  });

  it("恒时诚实响应：不存在邮箱与存在邮箱同形 { ok: true }，且不存在路径零投递零 token 行", async () => {
    const { db, authMod, handler, email } = await setup();
    await authMod.createUser(db, "real@test.dev", "pw123456", "user");
    const hit = await post(handler, "auth.requestReset", { email: "real@test.dev" });
    const miss = await post(handler, "auth.requestReset", { email: "ghost@test.dev" });
    expect(hit.status).toBe(200);
    expect(miss.status).toBe(200);
    expect(await miss.json()).toEqual(await hit.json()); // 同形 success（账号枚举防护）
    const rows = email.tail(10);
    expect(rows).toHaveLength(1); // 只有真实邮箱产生投递
    expect(rows[0]!.to).toBe("real@test.dev");
    expect(rows[0]!.status).toBe("ok");
    // 库内 token 行 = 1（ghost 路径零写入）
    const n = db.prepare("SELECT COUNT(*) AS n FROM auth_tokens").get() as { n: number };
    expect(Number(n.n)).toBe(1);
    db.close();
  });

  it("token 单次使用/过期/kind 错配：全部同一失败路径（400 ATR-340 统一文案）+ 原语层同判", async () => {
    const { db, authMod, tokens, handler, email } = await setup();
    const user = await authMod.createUser(db, "agent@test.dev", "pw123456", "user");

    // 单次使用：同一 token 二次 resetPassword 拒
    await post(handler, "auth.requestReset", { email: "agent@test.dev" });
    const token = tokenFromLog(email, "重置你的密码");
    const first = await post(handler, "auth.resetPassword", { token, newPassword: "next-pass-1" });
    expect(first.status).toBe(200);
    const second = await post(handler, "auth.resetPassword", { token, newPassword: "next-pass-2" });
    expect(second.status).toBe(400);
    expect((await second.json()).code).toBe("ATR-340");

    // 过期：ttlMs < 0 → 已过期，consume 原语与端点同一失败路径
    const expired = tokens.createAuthToken(db, user.id, "reset", -1000);
    expect(tokens.consumeAuthToken(db, expired.token, "reset")).toBeNull();
    const expiredHit = await post(handler, "auth.resetPassword", { token: expired.token, newPassword: "next-pass-3" });
    expect(expiredHit.status).toBe(400);
    expect((await expiredHit.json()).code).toBe("ATR-340");

    // kind 错配：reset 令牌用于 verifyEmail 拒；verify 令牌用于 resetPassword 拒
    const asVerify = tokens.createAuthToken(db, user.id, "verify", 60 * 60 * 1000);
    const wrongKind = await post(handler, "auth.verifyEmail", { token: asVerify.token });
    expect(wrongKind.status).toBe(400);
    expect((await wrongKind.json()).code).toBe("ATR-340");
    const asReset = tokens.createAuthToken(db, user.id, "reset", 60 * 60 * 1000);
    const wrongKind2 = await post(handler, "auth.resetPassword", { token: asReset.token, newPassword: "next-pass-4" });
    expect(wrongKind2.status).toBe(400);
    // verify 令牌打 verifyEmail 正通（正控对照：拒的是 kind，不是端点）
    const goodVerify = tokens.createAuthToken(db, user.id, "verify", 60 * 60 * 1000);
    const ok = await post(handler, "auth.verifyEmail", { token: goodVerify.token });
    expect(ok.status).toBe(200);
    // 原语层：不存在的 token / 已用 token 同判 null
    expect(tokens.consumeAuthToken(db, "deadbeef".repeat(8), "reset")).toBeNull();
    expect(tokens.consumeAuthToken(db, goodVerify.token, "verify")).toBeNull(); // 已用
    db.close();
  });

  it("ctx.email 缺位降级不炸：console.warn 可发现通道打出 token，且该 token 真实可用", async () => {
    const { db, authMod, handler } = await setup({ withEmail: false });
    await authMod.createUser(db, "agent@test.dev", "pw123456", "user");
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    });
    const req = await post(handler, "auth.requestReset", { email: "agent@test.dev" });
    expect(req.status).toBe(200); // 不炸
    expect(await req.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    const joined = warns.join("\n");
    expect(joined).toContain("ctx.email"); // 注释/文案指认装配位
    const m = /令牌[：:]?\s*([0-9a-f]{64})|([0-9a-f]{64})/.exec(joined.replace(/\s+/g, " "));
    const token = (m?.[1] ?? m?.[2]) as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/); // warn 通道含明文 token（可发现）
    // 降级通道打出的 token 真实可完成重置
    const reset = await post(handler, "auth.resetPassword", { token, newPassword: "warn-pass-9" });
    expect(reset.status).toBe(200);
    expect((await post(handler, "auth.login", { email: "agent@test.dev", password: "warn-pass-9" })).status).toBe(200);
    db.close();
  });

  it("verify 流：requestVerification 无会话 401 拦截 → 会话请求 → 记账投递 → verifyEmail → verified 落库；已验证再请求不再发信", async () => {
    const { db, authMod, handler, email } = await setup();
    const user = await authMod.createUser(db, "agent@test.dev", "pw123456", "user");
    // 无会话：分发层拦截（auth: { type: "session" }——最小安全形态，非按 email 无身份变体）
    const anon = await post(handler, "auth.requestVerification", {});
    expect(anon.status).toBe(401);
    expect((await anon.json()).code).toBe("ATR-340");

    const login = await post(handler, "auth.login", { email: "agent@test.dev", password: "pw123456" });
    const cookie = cookieOf(login);
    const req = await post(handler, "auth.requestVerification", {}, cookie);
    expect(req.status).toBe(200);
    expect(await req.json()).toEqual({ ok: true });
    const token = tokenFromLog(email, "验证你的邮箱");

    const verify = await post(handler, "auth.verifyEmail", { token });
    expect(verify.status).toBe(200);
    const row = db.prepare("SELECT verified FROM users WHERE id = ?").get(user.id) as { verified: number };
    expect(Number(row.verified)).toBe(1); // verified 状态落库

    // 已验证再请求：幂等 ok 且不再发信（不制造邮件噪音）
    const again = await post(handler, "auth.requestVerification", {}, cookie);
    expect(again.status).toBe(200);
    expect(email.tail(10)).toHaveLength(1); // 投递行数不变

    // 同一 verify token 二次使用拒（单次使用对 verify 流同样成立）
    const reuse = await post(handler, "auth.verifyEmail", { token });
    expect(reuse.status).toBe(400);
    db.close();
  });

  it("resetPassword 新密码契约：min 8 契约校验拦截（ATR-201）；scrypt 版本位哈希真实可验", async () => {
    const { db, authMod, handler, email } = await setup();
    await authMod.createUser(db, "agent@test.dev", "pw123456", "user");
    await post(handler, "auth.requestReset", { email: "agent@test.dev" });
    const token = tokenFromLog(email, "重置你的密码");
    const short = await post(handler, "auth.resetPassword", { token, newPassword: "short7" });
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe("ATR-201"); // 契约校验在分发层（min 8）
    // token 未被消费（契约校验先于 handler）——补齐长度后仍可用
    const ok = await post(handler, "auth.resetPassword", { token, newPassword: "long-pass-8" });
    expect(ok.status).toBe(200);
    const stored = (db.prepare("SELECT passwordHash FROM users WHERE email = ?").get("agent@test.dev") as { passwordHash: string }).passwordHash;
    expect(stored).toMatch(/^scrypt\$N=\d+,r=\d+,p=\d+\$/); // A2 版本位格式
    db.close();
  });
});

/* ---------- describe C：投影面（gen endpoint / export openapi 既有扫描自动纳入） ---------- */

describe("auth 流程端点投影面（gen endpoint api.ts + export openapi 扫描自动纳入）", () => {
  it("scanEndpoints / scanOpenApiEndpointFiles 纳入四流程端点（内联契约字面量解析成功）", () => {
    const root = makeFixtureRoot();
    genAuth(root, { flows: ["reset", "verify"] });
    const names = scanEndpoints(root).map((e) => e.name);
    for (const n of ["auth.requestReset", "auth.resetPassword", "auth.requestVerification", "auth.verifyEmail"]) {
      expect(names).toContain(n);
    }
    const ep = scanEndpoints(root).find((e) => e.name === "auth.resetPassword")!;
    expect(ep.unresolved).toEqual([]); // 内联契约字面量解析成功（投影零降级）
    expect(ep.contractFlat).toEqual({ type: "object", reqProps: { token: { type: "string" }, newPassword: { type: "string", min: 8 } } });

    const oapi = scanOpenApiEndpointFiles(root).map((e) => e.name);
    for (const n of ["auth.requestReset", "auth.resetPassword", "auth.requestVerification", "auth.verifyEmail"]) {
      expect(oapi).toContain(n);
    }
    const doc = buildOpenApi(root, { mount: "/api", name: "FlowProbe" });
    const paths = Object.keys((doc as { paths: Record<string, unknown> }).paths);
    for (const n of ["auth.requestReset", "auth.resetPassword", "auth.requestVerification", "auth.verifyEmail"]) {
      expect(paths).toContain(`/api/${n}`);
    }
  });

  it("gen endpoint 全跑：api.ts 类型化客户端含四流程端点（合成名 + 内联类型投影）", () => {
    const root = makeFixtureRoot();
    fs.mkdirSync(path.join(root, "src", "server", "endpoints"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "contract.ts"),
      'import type { FlatSchema } from "./src/vendor/atelier/runtime/contract.ts";\nexport const probeContract = { type: "object", reqProps: {} } satisfies FlatSchema;\n',
      "utf8"
    );
    genAuth(root, { flows: ["reset", "verify"] });
    const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [cli, "gen", "endpoint", "--root", root], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(0);
    const api = read(root, "src/generated/api.ts");
    for (const client of ["authRequestReset", "authResetPassword", "authRequestVerification", "authVerifyEmail"]) {
      expect(api).toContain(`export const ${client} = Object.freeze({`);
    }
    expect(api).toContain("type AuthRequestResetInput = { email: string };");
    expect(api).toContain("type AuthResetPasswordInput = { token: string; newPassword: string };");
    expect(api).toContain("type AuthVerifyEmailInput = { token: string };");
  });
});
