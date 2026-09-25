/**
 * gen-auth.test.ts — `atelier gen auth` 生成器（FS-DESIGN §6 全规格，FS-M2(m2d)）验收：
 *   产物形态（§6.1 五件套 + 迁移对，@atelier-generated 标记 + 显式 import 闭合）
 *   · regen 字节幂等 · 迁移编号追加式（既有文件永不重写）
 *   · 红绿证据：迁移对在真实 node:sqlite 上可应用；故意删 down → migrateUp ATR-331 拒绝
 *   · 真实 registry dispatch 全链：createUser → login（Set-Cookie）→ me → logout → me 401
 *   · ATR-340/341 拦截路径（读取器缺失/会话缺失/角色不符）+ 未声明 auth 端点零影响回归
 * 产物经 vitest.config 的 vendor shim 以真实 vendored 布局被加载（import 闭合真实检验）。
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { genAuth } from "../gen/gen-auth.mjs";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { migrateUp } from "../server/migrate";
import { AtrEndpointError, defineCommand, defineQuery, EndpointRegistry } from "../server/endpoints";

/* ---------- fixture ---------- */
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-genauth-"));
  tmpDirs.push(root);
  return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用（诚实边界：Bun 不在场，bun 路径不实测）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

describe("gen auth 生成器（FS-DESIGN §6.1，FS-M2(m2d)；产物形态 + regen 幂等 + 追加式迁移）", () => {
  it("产物清单：五件套 + NNN_auth 迁移对，头部 @atelier-generated 标记，显式 import 闭合（vendor 相对路径）", () => {
    const root = makeFixtureRoot();
    const { written, migrationsAppended } = genAuth(root);
    expect(written).toContain("src/server/auth/sessions.table.ts");
    expect(written).toContain("src/server/auth/cookie.ts");
    expect(written).toContain("src/server/auth/auth.ts");
    expect(written).toContain("src/server/auth/endpoints.ts");
    expect(written).toContain("src/server/db/migrations/001_auth.up.sql");
    expect(written).toContain("src/server/db/migrations/001_auth.down.sql");
    expect(migrationsAppended).toEqual(["001_auth"]);
    for (const f of ["sessions.table.ts", "cookie.ts", "auth.ts", "endpoints.ts"]) {
      expect(read(root, `src/server/auth/${f}`)).toContain("@atelier-generated");
    }
    // sessions.table.ts：users + sessions 双表契约，与 schema 单源同规范（table() 扁平字面量）
    const tables = read(root, "src/server/auth/sessions.table.ts");
    expect(tables).toContain('import { table } from "../../vendor/atelier/server/db.ts";');
    for (const col of ["token", "userId", "createdAt", "expiresAt"]) {
      expect(tables).toContain(col);
    }
    expect(tables).toContain('table("users"');
    expect(tables).toContain('table("sessions"');
    // auth.ts：scrypt 宿主差异锁死 + 会话原语 + 读取器工厂 + 装配示例在文件头
    const auth = read(root, "src/server/auth/auth.ts");
    expect(auth).toContain('from "node:crypto"');
    expect(auth).toContain("scrypt");
    expect(auth).toContain("timingSafeEqual");
    for (const fn of ["createSession", "validateSession", "destroySession", "createSessionReader", "createUser"]) {
      expect(auth).toContain(`function ${fn}`);
    }
    expect(auth).toContain("createHandler({ db, auth: createSessionReader(db) })"); // 装配示例
    expect(auth).toContain('from "../../vendor/atelier/server/index.ts"');
    // cookie.ts：属性说明随行（HttpOnly/SameSite=Strict 写明不隐式）
    const cookie = read(root, "src/server/auth/cookie.ts");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    // endpoints.ts：三端点 + 契约（login 免鉴权显式 none；me 用 pick 投影）
    const ep = read(root, "src/server/auth/endpoints.ts");
    expect(ep).toContain('defineCommand("auth.login"');
    expect(ep).toContain('defineCommand("auth.logout"');
    expect(ep).toContain('defineQuery("auth.me"');
    expect(ep).toContain('auth: { type: "none" }');
    expect(ep).toContain('auth: { type: "session" }');
    expect(ep).toContain('pick(users.rowSchema, ["email", "role"])');
    expect(ep).toContain('from "../../vendor/atelier/server/index.ts"');
  });

  it("regen 字节幂等：四 TS 产物重写字节全同；迁移对不重复追加", () => {
    const root = makeFixtureRoot();
    genAuth(root);
    const files = [
      "src/server/auth/sessions.table.ts",
      "src/server/auth/cookie.ts",
      "src/server/auth/auth.ts",
      "src/server/auth/endpoints.ts",
      "src/server/db/migrations/001_auth.up.sql",
      "src/server/db/migrations/001_auth.down.sql",
    ];
    const before = files.map((f) => read(root, f));
    const second = genAuth(root);
    expect(second.migrationsAppended).toEqual([]);
    expect(second.written).not.toContain("src/server/db/migrations/001_auth.up.sql");
    const after = files.map((f) => read(root, f));
    expect(after).toEqual(before);
  });

  it("迁移编号追加：既有 001_chats 对 → auth 取 002_auth；旧文件字节未动（追加式永不重写，§5.4）", () => {
    const root = makeFixtureRoot();
    const migDir = path.join(root, "src", "server", "db", "migrations");
    fs.mkdirSync(migDir, { recursive: true });
    fs.writeFileSync(path.join(migDir, "001_chats.up.sql"), "CREATE TABLE chats (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");
    fs.writeFileSync(path.join(migDir, "001_chats.down.sql"), "DROP TABLE chats;");
    const oldUp = fs.readFileSync(path.join(migDir, "001_chats.up.sql"));
    const { migrationsAppended } = genAuth(root);
    expect(migrationsAppended).toEqual(["002_auth"]);
    expect(fs.existsSync(path.join(migDir, "002_auth.up.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migDir, "002_auth.down.sql"))).toBe(true);
    expect(fs.readFileSync(path.join(migDir, "001_chats.up.sql"))).toEqual(oldUp);
    // 002_auth.down 内容：依赖逆序（先 sessions 后 users）+ 不可逆标记（§18 R7 风险约定随骨架落盘）
    const down = read(root, "src/server/db/migrations/002_auth.down.sql");
    expect(down.indexOf("DROP TABLE IF EXISTS sessions;")).toBeLessThan(down.indexOf("DROP TABLE IF EXISTS users;"));
    expect(down).toContain("不可逆：");
  });

  it("红绿证据：迁移对真实可应用（users/sessions 建表）；故意删 down → migrateUp 以 ATR-331 拒绝", async () => {
    const root = makeFixtureRoot();
    genAuth(root);
    const migDir = path.join(root, "src", "server", "db", "migrations");
    const db1 = await openSqlite(":memory:");
    expect(migrateUp(db1, migDir).map((s) => s.name)).toEqual(["001_auth"]);
    const names = (
      db1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(["atelier_migration_journal", "atelier_migrations", "sessions", "users"]); // 绿：成对迁移真实可逆应用（journal 惰性建表随首条 up 落地）
    db1.close();
    fs.rmSync(path.join(migDir, "001_auth.down.sql")); // 先红：故意拆掉配对
    const db2 = await openSqlite(":memory:");
    try {
      migrateUp(db2, migDir);
      throw new Error("应当抛出");
    } catch (e) {
      expect((e as AtrEndpointError).atr.code).toBe("ATR-331");
      expect((e as AtrEndpointError).message).toContain("001_auth");
    }
    db2.close();
  });
});

describeSqlite("gen auth 全链（真实 registry dispatch + 真实 node:sqlite；产物动态 import）", () => {
  interface AuthMod {
    createUser: (db: SqliteDb, email: string, password: string, role?: string) => Promise<{ id: number; email: string; role: string }>;
    createSessionReader: (db: SqliteDb) => (req: Request) => { type: string; principal?: string } | null;
    hashPassword: (password: string) => Promise<string>;
  }
  async function setup(): Promise<{
    root: string;
    db: SqliteDb;
    reg: EndpointRegistry;
    authMod: AuthMod;
    handler: (req: Request) => Promise<Response>;
  }> {
    const root = makeFixtureRoot();
    genAuth(root);
    const db = await openSqlite(":memory:");
    migrateUp(db, path.join(root, "src", "server", "db", "migrations"));
    const epUrl = pathToFileURL(path.join(root, "src", "server", "auth", "endpoints.ts")).href;
    const authUrl = pathToFileURL(path.join(root, "src", "server", "auth", "auth.ts")).href;
    const epMod = (await import(epUrl)) as { registerAuthEndpoints: (reg: EndpointRegistry) => void };
    const authMod = (await import(authUrl)) as unknown as AuthMod;
    const reg = new EndpointRegistry();
    epMod.registerAuthEndpoints(reg);
    // 测试位：角色守卫端点 + 未声明 auth 的普通端点（零影响回归载体）
    reg.register(defineCommand("admin.only", { auth: { type: "session", role: "admin" }, handler: (_i, ctx) => ({ role: ctx.auth?.role ?? null }) }));
    reg.register(defineQuery("open.q", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ db, auth: authMod.createSessionReader(db) });
    return { root, db, reg, authMod, handler };
  }

  const post = (h: (req: Request) => Promise<Response>, name: string, body: unknown, cookie?: string) =>
    h(
      new Request(`http://local.test/${name}`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
        body: JSON.stringify(body),
      })
    );

  it("login → Set-Cookie → me → logout 全链；cookie 属性（HttpOnly/SameSite=Strict/Path）随响应落位", async () => {
    const { db, authMod, handler } = await setup();
    await authMod.createUser(db, "agent@test.dev", "pw123456", "user");
    const login = await post(handler, "auth.login", { email: "agent@test.dev", password: "pw123456" });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ok: true });
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("atelier_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    const token = /atelier_session=([^;]+)/.exec(setCookie)![1];
    expect(token.length).toBeGreaterThan(20); // 32 字节随机 token（base64url）

    const cookieHeader = `atelier_session=${token}`;
    const me = await post(handler, "auth.me", {}, cookieHeader);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: "agent@test.dev", role: "user" }); // output = pick(users.rowSchema, ["email","role"])

    const logout = await post(handler, "auth.logout", {}, cookieHeader);
    expect(logout.status).toBe(200);
    const clearCookie = logout.headers.get("set-cookie");
    const clearText = Array.isArray(clearCookie) ? clearCookie.join("\n") : (clearCookie ?? "");
    expect(clearText).toContain("Max-Age=0"); // 清 cookie
    // 会话已销毁：同一 token 再访问 me → 401 ATR-340（拦截在分发层）
    const meAfter = await post(handler, "auth.me", {}, cookieHeader);
    expect(meAfter.status).toBe(401);
    expect((await meAfter.json()).code).toBe("ATR-340");
    db.close();
  });

  it("红检 ATR-340/341：错密码 401 / 无会话 401 / 角色不符 403（fix 各自可执行）", async () => {
    const { db, authMod, handler } = await setup();
    await authMod.createUser(db, "agent@test.dev", "pw123456", "user");
    // 错密码：login 失败统一 401 文案（不泄露账号存在性）且不种 cookie
    const badLogin = await post(handler, "auth.login", { email: "agent@test.dev", password: "wrong!" });
    expect(badLogin.status).toBe(401);
    expect((await badLogin.json()).code).toBe("ATR-340");
    expect(badLogin.headers.get("set-cookie")).toBeNull(); // 失败路径不种 cookie（§6.1）

    // 无会话访问 auth.me：分发层拦截（非 handler 内检查）
    const noSession = await post(handler, "auth.me", {});
    expect(noSession.status).toBe(401);
    const noSessionErr = await noSession.json();
    expect(noSessionErr.code).toBe("ATR-340");
    expect(noSessionErr.fix).toContain("auth.login");

    // 登录拿 user 会话 → admin.only 角色不符 → 403 ATR-341
    const login = await post(handler, "auth.login", { email: "agent@test.dev", password: "pw123456" });
    const token = /atelier_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")![1];
    const cookie = `atelier_session=${token}`;
    const forbidden = await post(handler, "admin.only", {}, cookie);
    expect(forbidden.status).toBe(403);
    const forbiddenErr = await forbidden.json();
    expect(forbiddenErr.code).toBe("ATR-341");
    expect(forbiddenErr.message).toContain("admin");
    expect(forbiddenErr.message).toContain("user"); // 会话主体的实际角色随行
    db.close();
  });

  it("角色匹配放行 + 未声明 auth 端点零影响（读取器在/不在行为一致）+ 读取器缺失 → ATR-340 指路装配", async () => {
    const { db, authMod, handler, reg } = await setup();
    await authMod.createUser(db, "root@test.dev", "pw123456", "admin");
    const login = await post(handler, "auth.login", { email: "root@test.dev", password: "pw123456" });
    const token = /atelier_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")![1];
    const cookie = `atelier_session=${token}`;
    const adminHit = await post(handler, "admin.only", {}, cookie);
    expect(adminHit.status).toBe(200);
    expect(await adminHit.json()).toEqual({ role: "admin" });

    // 未声明 auth 的端点：带 cookie / 不带 cookie 都 200（拦截只对声明了 auth 的端点生效）
    expect((await post(handler, "open.q", {})).status).toBe(200);
    expect((await post(handler, "open.q", {}, cookie)).status).toBe(200);

    // 全新 registry（同产物端点）但 createHandler 不装配 auth 读取器 → 401，fix 指向装配点
    const root = makeFixtureRoot();
    genAuth(root);
    const epUrl = pathToFileURL(path.join(root, "src", "server", "auth", "endpoints.ts")).href;
    const epMod = (await import(epUrl)) as { registerAuthEndpoints: (reg: EndpointRegistry) => void };
    const reg2 = new EndpointRegistry();
    epMod.registerAuthEndpoints(reg2);
    const bareHandler = reg2.createHandler({ db });
    const hit = await post(bareHandler, "auth.me", {});
    expect(hit.status).toBe(401);
    const err = await hit.json();
    expect(err.code).toBe("ATR-340");
    expect(err.message).toContain("未装配 auth 会话读取器");
    expect(err.fix).toContain("createSessionReader");
    db.close();
  });
});
