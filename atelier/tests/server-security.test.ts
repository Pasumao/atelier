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
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
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
import { migrateDown, migrateUp } from "../server/migrate";
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

/* ---- 硬化8 机检基座：node:crypto scrypt 计数包装（本文件模块图内生效——gen auth 产物的
 * 动态 import 也走此 mock）。注意不透传 scrypt[promisify.custom]：那样 promisify(scrypt) 会
 * 拿到原生定制版绕过计数。通用 promisify 全参转发路径下包装器计数可靠。 ---- */
const scryptCounter = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const native = actual.scrypt as (...args: unknown[]) => unknown;
  const wrapped = (...args: unknown[]): unknown => {
    scryptCounter.calls++;
    return native(...args);
  };
  return { ...actual, scrypt: wrapped };
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

/* ================= 硬化4：prod 错误 message 收敛 + 指纹（三处兜底同口径） =================
 * 现状：未捕获抛错的原始 message 逐字对外——endpoints ATR-320 兜底 / live ATR-321 SSE error 事件 /
 * node-host 500 兜底。message 可能携带 SQL 片段/路径/栈帧/凭据残片（公网部署信息泄露面）。
 * 修法 = prod 态（__ATELIER_PROD__，与 isProd 同读法）对外 message 收敛为通用文案 + 短指纹
 * （sha256 前 8 位，同错恒同指纹、可对日志检索）；dev 态逐字保留；日志侧（journal/console）dev/prod
 * 都保留原始错误——收敛只是对外姿态，不真丢根因。
 */

/** prod 旗置位/复位护栏（防污染同进程后续测试——codegen-prodflags.test.ts 同款纪律） */
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

const A2_SECRET = "敏感根因：select * from users where passwd='hunter2' at /home/agent/.secrets";

describe("硬化4：prod 错误 message 收敛 + 指纹（endpoints ATR-320 / live ATR-321 / node-host 500）", () => {
  it("红检：prod 旗下 endpoints ATR-320 兜底不外泄原始 message，收敛文案带 8 位稳定指纹；journal 日志侧保留原始", async () => {
    await withProd(true, async () => {
      const reg = new EndpointRegistry();
      reg.register(defineCommand("boom.cmd", { handler: () => { throw new Error(A2_SECRET); } }));
      const handler = reg.createHandler({});
      const res = await post(handler, "boom.cmd", {});
      expect(res.status).toBe(500);
      const err = (await res.json()) as { code: string; message: string };
      expect(err.code).toBe("ATR-320");
      expect(JSON.stringify(err)).not.toContain(A2_SECRET); // 红态：原始 message 逐字外泄
      expect(err.message).toMatch(/指纹\s[0-9a-f]{8}/);
      // 日志侧不真丢：journal 失败条目保留完整根因
      const entry = reg.journal()[0] as { status: string; error?: { message: string } };
      expect(entry?.status).toBe("failed");
      expect(entry?.error?.message).toContain(A2_SECRET);
    });
  });

  it("红检：指纹稳定（同错误恒同指纹、异错误异指纹）+ dev 旗下逐字保留不收敛", async () => {
    const fps = new Set<string>();
    await withProd(true, async () => {
      for (const name of ["boom.one", "boom.two"]) {
        const reg = new EndpointRegistry();
        reg.register(defineCommand(name, { handler: () => { throw new Error(A2_SECRET); } }));
        const res = await post(reg.createHandler({}), name, {});
        fps.add(/指纹\s([0-9a-f]{8})/.exec(((await res.json()) as { message: string }).message)![1]);
      }
    });
    expect(fps.size).toBe(1); // 同错误不同注册表实例 → 指纹稳定
    await withProd(false, async () => {
      const reg = new EndpointRegistry();
      reg.register(defineCommand("boom.dev", { handler: () => { throw new Error(A2_SECRET); } }));
      const res = await post(reg.createHandler({}), "boom.dev", {});
      const err = (await res.json()) as { message: string };
      expect(err.message).toContain(A2_SECRET); // dev：逐字保留
      expect(err.message).not.toMatch(/指纹/);
    });
  });

  it("红检：prod 旗下 live ATR-321 SSE error 事件收敛（journal 保留原始）；dev 旗下逐字", async () => {
    async function firstErrorFrame(prod: boolean): Promise<{ frame: string; journalMsg: string | undefined }> {
      let journalMsg: string | undefined;
      await withProd(prod, async () => {
        const reg = new EndpointRegistry();
        reg.register(defineQuery("boom.live", { live: true, handler: () => { throw new Error(A2_SECRET); } }));
        const handler = reg.createHandler({});
        const res = await handler(new Request("http://local.test/boom.live/live", { method: "GET" }));
        expect(res.status).toBe(200);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let text = "";
        for (let i = 0; i < 20 && !text.includes("event: error"); i++) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
        await reader.cancel().catch(() => {});
        const frame = text.split("\n\n").find((f) => f.startsWith("event: error")) ?? "";
        journalMsg = (reg.journal()[0] as { error?: { message: string } } | undefined)?.error?.message;
        expect(frame).toContain("ATR-321");
        if (prod) {
          expect(frame).not.toContain(A2_SECRET); // 红态：SSE error 事件逐字外泄
          expect(frame).toMatch(/指纹\s[0-9a-f]{8}/);
        } else {
          expect(frame).toContain(A2_SECRET); // dev：逐字
        }
      });
      return { frame: "", journalMsg };
    }
    const prodRun = await firstErrorFrame(true);
    expect(prodRun.journalMsg).toContain(A2_SECRET); // 日志侧保留原始（prod 也不丢）
    await firstErrorFrame(false);
  });

  it("红检：prod 旗下 node-host 500 兜底收敛 + console 侧 dev/prod 都保留原始（不真丢）", async () => {
    const server = createNodeServer(async () => {
      throw new Error(A2_SECRET);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      await withProd(true, async () => {
        const res = await fetch(`http://127.0.0.1:${port}/x`, { method: "POST", body: "{}" });
        expect(res.status).toBe(500);
        const err = (await res.json()) as { code: string; error?: { message: string } };
        expect(JSON.stringify(err)).not.toContain(A2_SECRET); // 红态：500 兜底逐字外泄
        expect(JSON.stringify(err)).toMatch(/指纹\s[0-9a-f]{8}/);
      });
      // console 侧保留原始（红态：node-host 兜底当前完全不落 console——原始错误真丢）
      expect(errSpy.mock.calls.some((args) => args.join(" ").includes(A2_SECRET))).toBe(true);
    } finally {
      errSpy.mockRestore();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

/* ================= 硬化5：server-status 可选 token 门禁（createHandler({ statusToken })） =================
 * 现状：GET <mount>/__atelier/server-status 在非 prod 态对任何调用方全量吐出端点契约体/journal/
 * live 订阅/db 快照——公网直挂形态是信息泄露面（prod 隐身已有，但 dev/内网直挂裸奔）。
 * 修法 = 装配项 statusToken（缺省不设 = 行为零变化）：设置后该路由要求 x-atelier-token 头
 * （与 dev 面 token 机制同口径），不匹配 401 ATR-340（鉴权域既有码，不另开号）；prod 隐身
 * 语义优先于 token 判定（门禁检查不泄露 prod 下该路由的存在性）。
 */

const statusGet = (handler: (req: Request) => Promise<Response>, token?: string): Promise<Response> =>
  handler(new Request("http://local.test/__atelier/server-status", { method: "GET", headers: token ? { "x-atelier-token": token } : {} }));

describe("硬化5：server-status 可选 token 门禁（statusToken → 401 ATR-340）", () => {
  it("红检：设 statusToken 后无头 401 / 错头 401 / 对头 200 快照照常", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.ok", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ statusToken: "s3cret-token" });

    const noHeader = await statusGet(handler);
    expect(noHeader.status).toBe(401); // 红态：门禁选项不存在 → 200 全量快照外泄
    expect(((await noHeader.json()) as { code: string }).code).toBe("ATR-340");

    const badHeader = await statusGet(handler, "wrong-token");
    expect(badHeader.status).toBe(401);
    expect(((await badHeader.json()) as { code: string }).code).toBe("ATR-340");

    const good = await statusGet(handler, "s3cret-token");
    expect(good.status).toBe(200);
    const snap = (await good.json()) as { endpoints: { name: string }[] };
    expect(snap.endpoints.some((e) => e.name === "q.ok")).toBe(true);
  });

  it("红检：未设 statusToken = 行为零变化（无头照常 200）", async () => {
    const reg = new EndpointRegistry();
    const handler = reg.createHandler({});
    expect((await statusGet(handler)).status).toBe(200); // 回归钉：缺省不设门禁
  });

  it("红检：prod 隐身优先于 token 判定（prod 旗下该路由照旧 405 ATR-311，不泄露存在性）", async () => {
    await withProd(true, async () => {
      const reg = new EndpointRegistry();
      const handler = reg.createHandler({ statusToken: "t" });
      const res = await statusGet(handler, "t");
      expect(res.status).toBe(405);
      expect(((await res.json()) as { code: string }).code).toBe("ATR-311");
    });
  });
});

/* ================= 硬化6：迁移状态表 name UNIQUE + 过期会话惰性清理 =================
 * 现状①：atelier_migrations 无 name 唯一约束——迁移器自身不产生重名行，但任何手工/脚本误插
 * 重名行会破坏 head 判定（max id）与完整性体检的 1:1 假设。修法 = 命名唯一索引（不在 CREATE TABLE
 * 加 UNIQUE——既有库惰性升级零 DDL 重建，新旧库索引对象一致；migrateUp 幂等执行）。
 * 现状②：gen auth validateSession 对过期会话只判 null 不删行——过期僵尸行无限累积。
 * 修法 = validate 命中点惰性 DELETE 全部过期行（查到才判→顺手清，无后台任务纪律的延续）。
 */

async function makeMigrationFixture(): Promise<{ root: string; migDir: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-a2-mig-"));
  genTmpDirs.push(root);
  const migDir = path.join(root, "src", "server", "db", "migrations");
  fs.mkdirSync(migDir, { recursive: true });
  fs.writeFileSync(path.join(migDir, "001_boxes.up.sql"), "CREATE TABLE boxes (id INTEGER PRIMARY KEY, label TEXT NOT NULL);");
  fs.writeFileSync(path.join(migDir, "001_boxes.down.sql"), "DROP TABLE IF EXISTS boxes;");
  return { root, migDir };
}

describeSqlite("硬化6：atelier_migrations.name UNIQUE + 会话过期惰性清理", () => {
  it("红检：migrateUp 后状态表重名 INSERT 被拒（UNIQUE 索引在，防重复记账破坏 head 判定）", async () => {
    const { migDir } = await makeMigrationFixture();
    const db = await openSqlite(":memory:");
    expect(migrateUp(db, migDir).map((s) => s.name)).toEqual(["001_boxes"]);
    expect(() =>
      db.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at, down_verified) VALUES ('001_boxes', 'x', 0, 0)").run()
    ).toThrow(/UNIQUE/i); // 红态：无约束 → 静默插入成功
    // down→up 循环不受索引干扰（删行后重插照常）
    expect(migrateDown(db, migDir).map((s) => s.name)).toEqual(["001_boxes"]);
    expect(migrateUp(db, migDir).map((s) => s.name)).toEqual(["001_boxes"]);
    db.close();
  });

  it("红检：gen auth validateSession 惰性删除过期会话行；有效会话不受扰", async () => {
    const { root, authMod } = await genAuthModule();
    const db = await openSqlite(":memory:");
    await migrateUp(db, path.join(root, "src", "server", "db", "migrations"));
    const u = db.prepare("INSERT INTO users (email, passwordHash, role, createdAt) VALUES ('a@test.dev', 'x', 'user', 0)").run();
    const uid = Number(u.lastInsertRowid);
    db.prepare("INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES ('tok-expired', ?, 0, 1)").run(uid); // 1970 过期
    db.prepare("INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES ('tok-live', ?, 0, ?)").run(uid, Date.now() + 60_000);

    expect(authMod.validateSession(db, "tok-expired")).toBeNull(); // 过期判定照旧
    expect(db.prepare("SELECT token FROM sessions WHERE token = 'tok-expired'").get()).toBeUndefined(); // 红态：僵尸行仍在

    const hit = authMod.validateSession(db, "tok-live");
    expect(hit).not.toBeNull(); // 有效会话照常（对照组）
    expect(db.prepare("SELECT token FROM sessions WHERE token = 'tok-live'").get()).toBeDefined();
    db.close();
  });
});

/* ================= 硬化8：登录账号枚举时序侧信道（dummy scrypt verify） =================
 * 现状：login handler `if (user == null || !(await verifyPassword(...)))` 短路——邮箱不存在时
 * 0 次 scrypt、密码错误时 1 次 scrypt（N=2^14 约 50-100ms），响应时间区分两种失败 =
 * 账号存在性枚举信道。修法 = 用户不存在也对固定占位哈希（同参数同代价）跑一次 verify 再统一失败路径。
 * 机检方式：vi.mock 包 scrypt 计数（注入计数比计时断言可靠——计时受环境噪声）。
 */

describe("硬化8：登录账号枚举时序侧信道（gen auth 产物）", () => {
  it("红检：用户不存在路径也执行等价 scrypt 运算（scrypt 计数 > 0），失败路径统一 401 文案", async () => {
    const { root, endpointsUrl } = await genAuthModule();
    const db = await openSqlite(":memory:");
    await migrateUp(db, path.join(root, "src", "server", "db", "migrations"));
    const epMod = (await import(endpointsUrl)) as { registerAuthEndpoints: (reg: EndpointRegistry) => void };
    const reg = new EndpointRegistry();
    epMod.registerAuthEndpoints(reg);
    const handler = reg.createHandler({ db });

    scryptCounter.calls = 0;
    const res = await post(handler, "auth.login", { email: "ghost@test.dev", password: "whatever1" });
    expect(res.status).toBe(401);
    const err = (await res.json()) as { code: string; message: string };
    expect(err.code).toBe("ATR-340");
    expect(err.message).toBe("登录失败：邮箱或密码不正确"); // 统一文案（不区分两种失败）
    expect(scryptCounter.calls).toBeGreaterThan(0); // 红态：0——短路使「邮箱不存在」时序可辨
    db.close();
  });
});

/* ================= 功能7：限流钩子位（createHandler({ rateLimit })，in-memory v1 纯新增） =================
 * 现状：分发器无任何限流位——公网部署下无限速。修法 = 显式装配项 rateLimit: { windowMs, max,
 * keyBy? }，缺省不启用（显式声明纪律）；滑动窗口按 key 计数，超限 429 + ATR-344 + Retry-After 头；
 * keyBy 缺省读 x-atelier-remote-addr 头（node-host 桥从 socket 对端注入、覆盖入站同名头防伪造），
 * 无该头落 "unknown" 共享桶。诚实边界：单进程内存态，重启清零；键表软上限防海量伪 IP 撑爆内存。
 */

describe("功能7：限流钩子位（rateLimit → 429 ATR-344 + Retry-After）", () => {
  it("红检：窗口内超配额 429 ATR-344 + Retry-After 整数秒；配额内不受扰；缺省不启用零行为变化", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("rl.ping", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ rateLimit: { windowMs: 60_000, max: 3 } });
    for (let i = 0; i < 3; i++) {
      expect((await post(handler, "rl.ping", {})).status).toBe(200); // 配额内不受扰
    }
    const over = await post(handler, "rl.ping", {});
    expect(over.status).toBe(429); // 红态：装配项不存在 → 200
    expect(over.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(((await over.json()) as { code: string }).code).toBe("ATR-344");
    // 缺省不启用（显式声明纪律）：同一 registry 不带 rateLimit 的装配零行为变化
    const free = reg.createHandler({});
    for (let i = 0; i < 6; i++) expect((await post(free, "rl.ping", {})).status).toBe(200);
  });

  it("红检：滑动窗口过期后放行 + keyBy 自定义键独立计数", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("rl.ping", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({
      rateLimit: { windowMs: 200, max: 1, keyBy: (req) => req.headers.get("x-tenant") ?? "anon" },
    });
    expect((await post(handler, "rl.ping", {}, { headers: { "x-tenant": "a" } })).status).toBe(200);
    expect((await post(handler, "rl.ping", {}, { headers: { "x-tenant": "b" } })).status).toBe(200); // b 独立桶
    expect((await post(handler, "rl.ping", {}, { headers: { "x-tenant": "a" } })).status).toBe(429); // a 桶满
    await new Promise((r) => setTimeout(r, 260)); // 窗口滑过
    expect((await post(handler, "rl.ping", {}, { headers: { "x-tenant": "a" } })).status).toBe(200); // 放行
  });

  it("红检：node-host 桥注入 x-atelier-remote-addr（socket 对端，覆盖入站防伪造）——缺省键源真按客户端计数", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("rl.ping", { handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ rateLimit: { windowMs: 60_000, max: 1 } });
    const server = createNodeServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      expect((await fetch(`http://127.0.0.1:${port}/rl.ping`, { method: "POST", body: "{}" })).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/rl.ping`, { method: "POST", body: "{}" })).status).toBe(429); // 红态：200
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
