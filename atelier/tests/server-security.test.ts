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
import { serverStatusSnapshot } from "../server/introspect";

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

/* ================= 硬化7：live:false 口径修正（显式声明「无 live」≠「配了 live 对象」） =================
 * 现状（BACKLOG 评审队列原文 + 评审批 W2 留档）：ATR-315 判定与 addDefinition/handleLive 均用
 * `live != null`——`live: false`（显式声明无 live）被误当作「配了 live」：注册期误触 ATR-315、
 * GET /live 通道对 live:false 端点开着（产生无失效键的僵尸订阅）。修法 = 统一 liveDeclared 口径
 * （true 或 {invalidate} 对象才算声明 live），与 W2 的 live×auth≠none fail-closed 共存不回退。
 */

describe("硬化7：live:false 口径修正（ATR-315 判定放宽 + live 通道/内省面口径统一）", () => {
  it("红检：live: false × auth: {type:'session'} 注册不再误触 ATR-315；live:true / live 对象 × auth 仍 fail-closed（W2 口径不变）", () => {
    const reg = new EndpointRegistry();
    let registered: EndpointDef | undefined;
    expect(
      () => {
        reg.register(defineQuery("off.explicit", { live: false, auth: { type: "session" }, handler: () => ({ ok: true }) }));
        registered = reg.get("off.explicit");
      }
    ).not.toThrow();
    expect(registered).toBeDefined(); // 显式无 live 的带鉴权端点应能注册
    // fail-closed 回归：真 live 声明 × auth≠none 仍注册期拒绝
    expect(() => reg.register(defineQuery("on.true", { live: true, auth: { type: "session" }, handler: () => 1 }))).toThrow(/ATR-315/);
    expect(() => reg.register(defineQuery("on.obj", { live: { invalidate: ["table:t"] }, auth: { type: "session" }, handler: () => 1 }))).toThrow(/ATR-315/);
    // 显式消警位不回退：live:true / live 对象 × auth:none 仍放行
    expect(() => reg.register(defineQuery("on.none", { live: true, auth: { type: "none" }, handler: () => 1 }))).not.toThrow();
    expect(() => reg.register(defineQuery("obj.none", { live: { invalidate: ["key:k"] }, auth: { type: "none" }, handler: () => 1 }))).not.toThrow();
  });

  it("红检：live: false 端点的 GET /live 通道关闭（405 ATR-311），不进 live 引擎与内省 live 名单", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("off.explicit", { live: false, handler: () => ({ ok: true }) }));
    const res = await reg.createHandler()(new Request("http://local.test/off.explicit/live", { method: "GET" }));
    expect(res.status).toBe(405); // 红态：live:false 被当 live 对象 → SSE 200 僵尸订阅（无失效键永不推送）
    expect(((await res.json()) as { code: string }).code).toBe("ATR-311");
    await res.body?.cancel().catch(() => {}); // 红态拿到 SSE 流时防悬挂
    const snap = serverStatusSnapshot(reg);
    expect(snap.live.endpoints).not.toContain("off.explicit"); // 内省面同口径（红态：in 名单）
  });

  it("回归：live:false 端点 POST 直调照常 200；registry.list() live 位 false（既有摘要口径不变）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("off.explicit", { live: false, handler: () => ({ ok: true }) }));
    expect((await post(reg.createHandler(), "off.explicit", {})).status).toBe(200);
    expect(reg.list().find((s) => s.name === "off.explicit")!.live).toBe(false);
    // 真 live 端点不受波及：live:true 仍进内省名单与摘要
    const reg2 = new EndpointRegistry();
    reg2.register(defineQuery("on.feed", { live: true, handler: () => ({ ok: true }) }));
    expect(reg2.list().find((s) => s.name === "on.feed")!.live).toBe(true);
    expect(serverStatusSnapshot(reg2).live.endpoints).toContain("on.feed");
  });
});
