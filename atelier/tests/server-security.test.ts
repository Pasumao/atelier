/**
 * server-security.test.ts — A2 server 安全收口批（2026-09-28；依据 docs/research/
 * 2026-09-28-fullstack-feature-gap.md §2-A2/§5 与 BACKLOG「评审队列 → server 安全收口包」条目，
 * 公网部署前提件）。覆盖：
 *   硬化2 openSqlite 统一 PRAGMA（foreign_keys=ON + busy_timeout，运行时单点全路径受益）
 *   硬化3 请求体上限（endpoints maxBodyBytes + node-host 中途截断）→ 413 ATR-346
 *   硬化4 prod 错误 message 收敛 + 指纹（endpoints ATR-320 / live ATR-321 / node-host 500 兜底）
 *   硬化5 server-status 可选 token 门禁（createHandler({ statusToken })，dev 面口径 x-atelier-token）
 *   硬化7 live:false 口径修正（显式声明「无 live」≠「配了 live 对象」，ATR-315 判定联动放宽）
 *   功能9 限流钩子位（createHandler({ rateLimit })）→ 429 ATR-344 + Retry-After
 * 批纪律：每项先红（红检 commit）后绿（修复 commit）；红检保留为回归钉。
 * 风格对齐 server.test.ts / server-v2.test.ts（node:sqlite 在场探测 + describeSqlite 门）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { createNodeServer } from "../server/node-host";
import {
  AtrEndpointError,
  defineCommand,
  defineQuery,
  EndpointRegistry,
  type EndpointDef,
} from "../server/endpoints";
import { openSqlite, type SqliteDb } from "../server/sqlite";

/* ---------------- node:sqlite 在场探测（Node ≥22.5 内建；与 server.test.ts 同口径） ---------------- */
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

function post(handler: (req: Request) => Promise<Response>, name: string, body: unknown, init?: RequestInit): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", body: JSON.stringify(body), ...init }));
}

/* ================= 硬化2：openSqlite 统一 PRAGMA（决策 19 单点，migrate/seed/call 全路径自动受益） ================= */

describeSqlite("硬化2：openSqlite 统一 PRAGMA（foreign_keys=ON + busy_timeout）", () => {
  it("红检：REFERENCES 孤儿行插入被拒（foreign_keys=ON 真生效，不再是装饰）+ busy_timeout 缺省 5000", async () => {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    db.exec("CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER NOT NULL REFERENCES parent(id))");
    // 红检主体：孤儿行（pid=99 无对应 parent）必须被 FK 约束拒绝——PRAGMA 未开时此插入静默成功
    expect(() => db.prepare("INSERT INTO child (id, pid) VALUES (1, 99)").run()).toThrow(/FOREIGN KEY/i);
    // 合法外键放行（约束只在孤儿方向设防）
    db.prepare("INSERT INTO parent (id) VALUES (1)").run();
    expect(db.prepare("INSERT INTO child (id, pid) VALUES (2, 1)").run().changes).toBe(1);
    // PRAGMA 现值可查（诊断面）：foreign_keys=1、busy_timeout=5000
    //（宿主差异：node:sqlite 把 busy_timeout 读回列报告为 `timeout`，bun 为 `busy_timeout`——双拼兼容）
    const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number | bigint } | undefined;
    expect(Number(fk?.foreign_keys)).toBe(1);
    const bt = db.prepare("PRAGMA busy_timeout").get() as { busy_timeout?: number | bigint; timeout?: number | bigint } | undefined;
    expect(Number(bt?.busy_timeout ?? bt?.timeout)).toBe(5000);
    db.close();
  });
});
