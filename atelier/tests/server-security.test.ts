/**
 * server-security.test.ts — A2 server 安全收口批（2026-09-28；依据 docs/research/
 * 2026-09-28-fullstack-feature-gap.md §2-A2/§5 与 BACKLOG「评审队列 → server 安全收口包」条目，
 * 公网部署前提件）。覆盖：
 *   硬化1 scrypt 显式参数 + 哈希串版本位（gen auth 产物 auth.ts：scrypt$N=..,r=..,p=..$salt$hash）
 *   硬化2 openSqlite 统一 PRAGMA（foreign_keys=ON + busy_timeout，运行时单点全路径受益）
 *   硬化3 请求体上限（endpoints maxBodyBytes + node-host 中途截断）→ 413 ATR-346
 *   硬化4 prod 错误 message 收敛 + 指纹（endpoints ATR-320 / live ATR-321 / node-host 500 兜底）
 *   硬化5 server-status 可选 token 门禁（createHandler({ statusToken })，dev 面口径 x-atelier-token）
 *   硬化6 迁移状态表 name UNIQUE + 过期会话惰性清理
 *   硬化7 live:false 口径修正（显式声明「无 live」≠「配了 live 对象」，ATR-315 判定联动放宽）
 *   硬化8 登录账号枚举时序侧信道（用户不存在路径 dummy scrypt verify）
 *   功能7 限流钩子位（createHandler({ rateLimit })）→ 429 ATR-344 + Retry-After
 *   功能8 登录失败锁定钩子位（gen auth 产物 in-memory v1）→ 423 ATR-345
 * 批纪律：每项先红（红检 commit）后绿（修复 commit）；红检保留为回归钉。
 * 风格对齐 server.test.ts / server-v2.test.ts（node:sqlite 在场探测 + describeSqlite 门）。
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
import { genAuth } from "../gen/gen-auth.mjs";

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

/* ================= gen auth 产物夹具（本文件多处复用；vendor shim 布局，与 gen-auth.test.ts 同法） ================= */

const genTmpDirs: string[] = [];
afterEach(() => {
  while (genTmpDirs.length > 0) fs.rmSync(genTmpDirs.pop()!, { recursive: true, force: true });
});

/** 生成 auth 五件套到临时目录并动态 import auth.ts（vitest vendor shim 使 import 闭合真实成立） */
async function genAuthModule(): Promise<{ root: string; authMod: Record<string, any>; endpointsUrl: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-a2-genauth-"));
  genTmpDirs.push(root);
  genAuth(root);
  const authUrl = pathToFileURL(path.join(root, "src", "server", "auth", "auth.ts")).href;
  const endpointsUrl = pathToFileURL(path.join(root, "src", "server", "auth", "endpoints.ts")).href;
  return { root, authMod: await import(authUrl), endpointsUrl };
}

/* ================= 硬化1：scrypt 显式参数 + 哈希串版本位（gen auth 产物 auth.ts） =================
 * 现状：scrypt 靠 node:crypto 缺省 cost（缺省值随宿主版本漂移——可验证性依赖构建时点）；
 * 哈希串 = 无参数 3 段式「scrypt$<salt>$<hash>」，未来提 cost 会让新旧哈希无法区分（verify
 * 只能全按一套参数跑，提级即存量失配）。修法 = 显式参数常量 + 哈希串第二段参数版本位
 * 「scrypt$N=..,r=..,p=..$<salt>$<hash>」，verify 按前缀解析参数分派；无存量语义（本生成器
 * 此前格式无参数位）→ 不设旧格式兼容层，旧格式恒 false（regen 升级需应用侧重置凭据，注释写明）。
 */

describeSqlite("硬化1：scrypt 显式参数 + 哈希串版本位（gen auth 产物）", () => {
  it("红检：hashPassword 产出带参数版本位（scrypt$N=..,r=..,p=..$salt$hash）；verify 按前缀分派 + 超界参数拒绝 + 旧 3 段式恒 false", async () => {
    const { root, authMod } = await genAuthModule();
    // 模板面：scrypt cost 显式常量（不靠库缺省——缺省值随 Node 版本漂移）
    const auth = fs.readFileSync(path.join(root, "src", "server", "auth", "auth.ts"), "utf8");
    expect(auth).toMatch(/SCRYPT_N\s*=\s*\d+/);
    expect(auth).toMatch(/SCRYPT_R\s*=\s*\d+/);
    expect(auth).toMatch(/SCRYPT_P\s*=\s*\d+/);

    // 行为面：哈希串 = 4 段式，第二段即参数版本位（N/r/p 明文可读）
    const pw = "correct horse battery staple";
    const hash: string = await authMod.hashPassword(pw);
    const m = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(hash);
    expect(m, `哈希串缺参数版本位（现状 3 段式：${hash.slice(0, 36)}…）`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16384); // N 下限 = RFC 7914 §11 建议最小值 2^14
    expect(Number(m![2])).toBe(8);
    expect(Number(m![3])).toBe(1);

    // verify 按前缀分派：对参通过 / 错密码拒绝 / 畸形串恒 false 不抛
    expect(await authMod.verifyPassword(pw, hash)).toBe(true);
    expect(await authMod.verifyPassword("wrong", hash)).toBe(false);
    expect(await authMod.verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await authMod.verifyPassword("x", "scrypt$garbage$ab$cd")).toBe(false);

    // 无存量语义 → 不设兼容层：剥掉参数位的旧 3 段式恒 false（regen 升级需重置凭据，不做静默迁移）
    const seg = hash.split("$");
    const legacy = `scrypt$${seg[3]}$${seg[4]}`;
    expect(await authMod.verifyPassword(pw, legacy)).toBe(false);

    // DoS 护栏：哈希串可能来自不可信侧（库泄露/手填）——超界 N 拒绝执行（防 CPU/内存打爆）
    const evil = `scrypt$N=1073741824,r=8,p=1$${seg[3]}$${seg[4]}`;
    expect(await authMod.verifyPassword("x", evil)).toBe(false);
  });
});

/* ================= 硬化3：请求体上限（endpoints maxBodyBytes → 413 ATR-346；node-host 读体中途截断） =================
 * 现状：请求体无任何上限——公网部署下单请求即可打爆内存（node-host 桥全量缓冲读体）。修法 =
 * 两道闸：node-host 桥读体时按上限**中途截断**（不等读完整再拒，超限残余不再进 JS，桥直答 413）；
 * endpoints 分发器在 JSON 解析处兜底（直挂 handler 的宿主/进程内调用路径），装配项
 * createHandler({ maxBodyBytes }) 可配、缺省 1MiB。超限 = 413 + ATR-346（四段式），不进 handler、不入 journal。
 */

describe("硬化3：请求体上限（413 ATR-346）", () => {
  it("红检：缺省上限 1MiB——超限 413 ATR-346 且不进 handler；小体不受扰", async () => {
    let handlerHits = 0;
    const reg = new EndpointRegistry();
    reg.register(defineQuery("big.echo", { handler: (i) => { handlerHits++; return i; } }));
    const handler = reg.createHandler({});
    const small = await post(handler, "big.echo", { ok: 1 }); // 对照组：小体照常
    expect(small.status).toBe(200);
    const big = await handler(
      new Request("http://local.test/big.echo", { method: "POST", body: JSON.stringify({ pad: "x".repeat(Math.round(1.5 * 1024 * 1024)) }) })
    );
    expect(big.status).toBe(413); // 红态：无上限 → 200 全单照收
    expect(((await big.json()) as { code: string }).code).toBe("ATR-346");
    expect(handlerHits).toBe(1); // 红态：2——超限体也进了 handler
  });

  it("红检：createHandler({ maxBodyBytes }) 自定义上限生效（超限 413 / 界内不受扰）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("big.echo", { handler: (i) => i }));
    const handler = reg.createHandler({ maxBodyBytes: 200 });
    const ok = await post(handler, "big.echo", { pad: "y".repeat(10) });
    expect(ok.status).toBe(200); // 界内不受扰
    const over = await handler(new Request("http://local.test/big.echo", { method: "POST", body: JSON.stringify({ pad: "y".repeat(300) }) }));
    expect(over.status).toBe(413); // 红态：装配项不存在 → 200
    expect(((await over.json()) as { code: string }).code).toBe("ATR-346");
  });

  it("红检：node-host 桥读体中途截断——超限残余不再喂 handler，桥直答 413 ATR-346（真实 socket 往返）", async () => {
    let handlerHits = 0;
    const server = createNodeServer(
      async () => {
        handlerHits++;
        return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
      },
      { maxBodyBytes: 1000 }
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/whatever`, { method: "POST", body: "z".repeat(64 * 1024) });
      expect(res.status).toBe(413); // 红态：桥无上限 → 全量读入喂 handler → 200
      expect(((await res.json()) as { code: string }).code).toBe("ATR-346");
      expect(handlerHits).toBe(0); // 红态：1——64KB 体已整体进 handler（未截断）
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
