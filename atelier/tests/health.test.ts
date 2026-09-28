/**
 * health.test.ts — B4 prod 健康检查端点（2026-09-28 差距批第二批；依据 docs/research/
 * 2026-09-28-fullstack-feature-gap.md §3-B4）。现状：server-status 在 prod 旗下 405 ATR-311
 * 隐身（内省面不进生产 API 面——这是对的），但部署面（docker/orchestrator/守护进程）因此
 * 无任何探活口。落地 = `GET <mount>/__atelier/health` 健康面，与 server-status 同族命名空间、
 * 语义分离：内省面可隐身，健康面永不离线。
 *
 * 覆盖：
 *   1. GET 200 + 三事实极简体 { ok, uptimeMs, db, version }——db:"ok" 真探活（SELECT 1）、version 透传；
 *   2. db 探活抛错 → 503 + ok:false + db:"error"（探活的语义就是非 200 可报警，orchestrator 靠状态码）；
 *   3. 未装配 db → db:"none" + 仍 200（纯静态应用合法）；
 *   4. prod 旗下：health 200 × server-status 405 ATR-311 对照双钉（语义分离的正面钉）；
 *   5. statusToken 装配下：server-status 无头 401 × health 无头 200 对照（健康面不走 token 门）；
 *   6. 非 GET → 405 ATR-311（复用既有 405 口径，不新配 ATR 码）；
 *   7. node-host serve() 真实端口冒烟（D-F14 自托管壳形态：GET 200 + POST 405 走真 socket）。
 * 批纪律：先红（红检 commit：路由不存在——GET 落通用非 POST 405 ATR-311 误伤、POST 落 404 ATR-310）后绿（实现 commit）；红检保留为回归钉。
 * 风格对齐 server-security.test.ts（node:sqlite 在场探测 + describeSqlite 门 + withProd 护栏）。
 */
import { describe, expect, it } from "vitest";
import { EndpointRegistry } from "../server/endpoints";
import { serve } from "../server/node-host";
import { openSqlite } from "../server/sqlite";
import { INTROSPECT_NAME } from "../server/introspect";

/* ---------------- node:sqlite 在场探测（与 server-security.test.ts 同口径） ---------------- */
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

const HEALTH_PATH = "/__atelier/health";
const getHealth = (handler: (req: Request) => Promise<Response>): Promise<Response> =>
  handler(new Request(`http://local.test${HEALTH_PATH}`, { method: "GET" }));

/** prod 旗置位/复位护栏（防污染同进程后续测试——server-security.test.ts 同款） */
async function withProd(prod: boolean, fn: () => Promise<void>): Promise<void> {
  const g = globalThis as { __ATELIER_PROD__?: boolean };
  const prev = g.__ATELIER_PROD__;
  g.__ATELIER_PROD__ = prod;
  try {
    await fn();
  } finally {
    g.__ATELIER_PROD__ = prev;
  }
}

type HealthBody = { ok: boolean; uptimeMs: number; db: "ok" | "none" | "error"; version: string | null };

/* ================= 1+2+3：三事实极简体（真探活 / 探活失败 503 / 无 db none） ================= */

describeSqlite("GET /__atelier/health：三事实极简体（db 装配 = 真探活 SELECT 1）", () => {
  it("红检：db 装配 + version 透传 → 200 { ok:true, db:'ok', uptimeMs:number, version }，体恰四键无内省内容", async () => {
    const db = await openSqlite(":memory:");
    const reg = new EndpointRegistry();
    const handler = reg.createHandler({ db, version: "9.9.9" });
    const res = await getHealth(handler);
    expect(res.status).toBe(200); // 红态：路由不存在 → 405 ATR-311（GET 未知名落通用非 POST 405，误伤即本批要修的事）
    const body = (await res.json()) as HealthBody;
    expect(body).toEqual({ ok: true, uptimeMs: expect.any(Number), db: "ok", version: "9.9.9" }); // 红态：拿到的是 ATR-311 错误体而非三事实
    expect(Number.isFinite(body.uptimeMs)).toBe(true);
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    // 极简纪律的反面钉：响应体不含任何内省内容（端点表/journal/db 快照都只在 server-status）
    expect(Object.keys(body).sort()).toEqual(["db", "ok", "uptimeMs", "version"]);
    expect(JSON.stringify(body)).not.toContain("endpoints");
    db.close();
  });
});

describe("GET /__atelier/health：探活失败 503 与无 db none（宿主无关夹具）", () => {
  it("红检：db 探活抛错 → 503 + ok:false + db:'error'（状态码即报警面）", async () => {
    const badDb = { prepare: () => { throw new Error("disk I/O error"); } };
    const handler = new EndpointRegistry().createHandler({ db: badDb, version: "1.0.0" });
    const res = await getHealth(handler);
    expect(res.status).toBe(503); // 红态：405（同上——通用 405 误伤）
    expect(await res.json()).toEqual({ ok: false, uptimeMs: expect.any(Number), db: "error", version: "1.0.0" });
  });

  it("红检：未装配 db → db:'none' + 仍 200（纯静态应用合法）+ version 缺省 null", async () => {
    const handler = new EndpointRegistry().createHandler({});
    const res = await getHealth(handler);
    expect(res.status).toBe(200); // 红态：405（同上——通用 405 误伤）
    expect(await res.json()).toEqual({ ok: true, uptimeMs: expect.any(Number), db: "none", version: null });
  });
});

/* ================= 4：prod 旗下 health 200 × server-status 405 对照双钉（语义分离） ================= */

describe("prod 旗下：health 恒在 × server-status 隐身（同族命名空间，语义分离）", () => {
  it("红检：prod 旗 GET health → 200 正常应答；同 handler GET server-status → 405 ATR-311", async () => {
    await withProd(true, async () => {
      const reg = new EndpointRegistry();
      const handler = reg.createHandler({});
      const health = await getHealth(handler);
      expect(health.status).toBe(200); // 红态：405（通用非 POST 405 误伤——健康面在 prod 不可达 = 部署失明）
      expect(((await health.json()) as HealthBody).ok).toBe(true);
      const status = await handler(new Request(`http://local.test/${INTROSPECT_NAME}`, { method: "GET" }));
      expect(status.status).toBe(405); // 对照钉（既有行为，不变）：内省面 prod 隐身
      expect(((await status.json()) as { code: string }).code).toBe("ATR-311");
    });
  });
});

/* ================= 5：statusToken 装配下 health 豁免 × server-status 401 对照 ================= */

describe("statusToken 装配：health 不走 token 门 × server-status 门禁照旧", () => {
  it("红检：无头 GET health → 200；无头 GET server-status → 401 ATR-340（健康面无秘密，门禁只会制造假死报警）", async () => {
    const reg = new EndpointRegistry();
    const handler = reg.createHandler({ statusToken: "s3cret-token" });
    const health = await getHealth(handler);
    expect(health.status).toBe(200); // 红态：405（同上——通用 405 误伤）
    expect(((await health.json()) as HealthBody).ok).toBe(true);
    const status = await handler(new Request(`http://local.test/${INTROSPECT_NAME}`, { method: "GET" }));
    expect(status.status).toBe(401); // 对照钉（既有行为，不变）
    expect(((await status.json()) as { code: string }).code).toBe("ATR-340");
  });
});

/* ================= 6：非 GET → 405 ATR-311（复用既有口径，不新配码） ================= */

describe("健康面方法约束：非 GET → 405 ATR-311", () => {
  it("红检：POST health → 405，错误体 ATR-311（与既有 405 口径同码）", async () => {
    const handler = new EndpointRegistry().createHandler({});
    const res = await handler(new Request(`http://local.test${HEALTH_PATH}`, { method: "POST", body: "{}" }));
    expect(res.status).toBe(405); // 红态：404 ATR-310（POST 未知名落未知端点路径——本批钉「GET 才 405」的专属口径）
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe("ATR-311");
  });
});

/* ================= 7：node-host serve() 真实端口冒烟（D-F14 自托管壳形态） ================= */

describe("serve() 真实端口冒烟：健康面过真 socket（生产壳形态 = 公网可达的探活口）", () => {
  it("红检：GET /api/__atelier/health → 200 三事实；POST → 405（真实 listen 127.0.0.1:0 + fetch）", async () => {
    const reg = new EndpointRegistry();
    reg.register({
      kind: "query",
      name: "smoke.ping",
      handler: () => ({ ok: true }),
    });
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let server: import("node:http").Server;
    try {
      server = await serve(reg.createHandler({ mount: "/api" }), { port: 0 });
    } finally {
      process.stdout.write = orig;
    }
    try {
      const port = (server.address() as { port: number }).port;
      expect(writes.join("")).toMatch(/^ATELIER_SERVER_READY \{"port":\d+\}\r?\n$/); // 握手行先于探活（就绪语义）
      const res = await fetch(`http://127.0.0.1:${port}/api/__atelier/health`);
      expect(res.status).toBe(200); // 红态：405 ATR-311（GET 未知名落通用非 POST 405）
      expect(await res.json()).toEqual({ ok: true, uptimeMs: expect.any(Number), db: "none", version: null });
      const bad = await fetch(`http://127.0.0.1:${port}/api/__atelier/health`, { method: "POST", body: "{}" });
      expect(bad.status).toBe(405); // 红态：404（同上）
      expect(((await bad.json()) as { code: string }).code).toBe("ATR-311");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
