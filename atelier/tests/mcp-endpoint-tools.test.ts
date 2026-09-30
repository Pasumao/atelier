/**
 * mcp-endpoint-tools.test.ts — FS-6 L3 全栈工具族验收（FS-DESIGN §10.1，净增 8 工具）。
 *
 * 套路：本地 node:http 假 dev face（canned server-status JSON + POST /api/<name> 端点桩）
 * → 环境变量指向它 → 动态 import mcp/server.mjs 直调 callTool 逐工具断言；
 * 另一条 stdio e2e（spawn server.mjs 走 JSON-RPC）守卫入口形态与 tools/list 计数。
 *
 * 先红后绿锚点：endpoint.call 的 deny → ATR-402 路径（实现前工具未注册，必失败）。
 * 静态链 fixture（src/contract.ts + endpoints + generated/api.ts + 调用点）按 gen-endpoint.mjs
 * 扫描器文本形态构造——impactReport 消费的是 grep 级事实。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = path.resolve(HERE, "..", "mcp", "server.mjs");

/* ---------- canned server-status（数据源契约：另一分支实现的 dev 面 host，按契约消费） ---------- */

const CHAT_CONTRACT = { type: "object", reqProps: { msg: { type: "string", min: 1 } }, optProps: {} };
const CHAT_OUTPUT = { type: "object", reqProps: { echo: { type: "string" } }, optProps: {} };
const ITEM_CONTRACT = { type: "object", reqProps: { title: { type: "string", min: 1 } }, optProps: {} };

const SERVER_STATUS = {
  ok: true,
  server: { startedAt: "2026-09-19T08:00:00.000Z", restarts: 2, dbPath: "app.db", host: "127.0.0.1:5173" },
  endpoints: [
    {
      name: "chat.ask", kind: "query", live: true, hasContract: true, hasOutput: true,
      invalidateKeys: ["key:chat.ask"], timeoutMs: 5000,
      contract: CHAT_CONTRACT, output: CHAT_OUTPUT,
    },
    {
      name: "items.create", kind: "command", live: false, hasContract: true, hasOutput: false,
      emits: ["table:items"], idempotent: true, authType: "session", authRole: "editor",
      contract: ITEM_CONTRACT, output: null,
    },
    { name: "health.check", kind: "query", live: false, hasContract: false, hasOutput: false, contract: null, output: null },
  ],
  db: {
    tables: [
      {
        name: "items",
        columns: [
          { name: "id", type: "INTEGER", notNull: true, pk: true },
          { name: "title", type: "TEXT", notNull: true, pk: false },
        ],
        indexes: [{ name: "items_title_idx", columns: ["title"], unique: false }],
      },
    ],
    migrations: { head: { id: "m2", name: "add-items" }, applied: ["m1_init", "m2_add-items"], pending: ["m3_add-items-idx"] },
  },
  journal: [
    { ts: "2026-09-19T08:01:00.000Z", name: "items.create", kind: "command", input: { title: "a" }, status: "ok", principal: "user-1", durMs: 3 },
    {
      ts: "2026-09-19T08:02:00.000Z", name: "items.create", kind: "command", input: { title: "" }, status: "failed", principal: "user-1", durMs: 1,
      error: { code: "ATR-201", message: "契约校验失败：title", context: { component: "atelier-server" }, fix: "修正输入以匹配契约" },
    },
  ],
  live: { subscriberCount: 3, endpoints: ["chat.ask"] },
  // jobs 段（形状 = server/jobs.ts JobsStats：counts 四态计数 + recent 尾部行，ts = epoch ms 数字，
  // durMs 仅终态行非 null——stats() 映射同源）
  jobs: {
    counts: { pending: 2, running: 1, done: 7, failed: 1 },
    recent: [
      { id: 12, type: "email.send", queue: "default", status: "pending", attempts: 0, durMs: null, ts: 1759150000000 },
      { id: 13, type: "report.build", queue: "default", status: "done", attempts: 1, durMs: 42, ts: 1759150001000 },
      { id: 14, type: "report.build", queue: "default", status: "failed", attempts: 3, durMs: 120, ts: 1759150002000 },
    ],
  },
  // email 段（形状 = server/email.ts EmailLogEntry 的调试面投影 EmailStatusEntry：恰六字段
  // id/ts(ISO 串)/transport/to/subject/status，不含 payload/error——introspect.ts 同源）
  email: [
    { id: 1, ts: "2026-09-29T08:00:00.000Z", transport: "mock", to: "u1@example.com", subject: "第 1 封", status: "ok" },
    { id: 2, ts: "2026-09-29T08:01:00.000Z", transport: "mock", to: "u2@example.com", subject: "重置密码", status: "failed" },
  ],
  // uploads 段（形状 = 分支 A 钉死契约：faces 资产注册 / assets 台账聚合 / tail ≤20 条 id 降序恰六字段无 path；
  // 仅 createHandler({ uploads }) 装配后出现）
  uploads: {
    faces: [{ name: "avatar", accept: ["image/png"], maxBytes: 1048576, auth: "session" }],
    assets: { count: 42, bytes: 1048576 },
    tail: [{ id: 7, name: "upload", mime: "image/png", size: 1234, sha256: "deadbeef", createdAt: "2026-09-29T12:00:00.000Z" }],
  },
};

/* ---------- 静态链 fixture（impact.mjs 消费的 grep 级事实） ---------- */

function writeApp(root: string, confirm: string) {
  fs.mkdirSync(path.join(root, "src", "server", "endpoints"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "generated"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "atelier.config.json"),
    JSON.stringify({ agent: { confirm }, tokens: {} }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, "src", "contract.ts"),
    `export const chatInputSchema = ${JSON.stringify(CHAT_CONTRACT, null, 2)};\n` +
    `export const chatOutput = ${JSON.stringify(CHAT_OUTPUT, null, 2)};\n` +
    `export const itemSchema = ${JSON.stringify(ITEM_CONTRACT, null, 2)};\n`,
  );
  fs.writeFileSync(
    path.join(root, "src", "server", "endpoints", "chat.ts"),
    `import { defineQuery, defineCommand } from "../../../vendor/atelier/server";
import { chatInputSchema, chatOutput, itemSchema } from "../../contract";

export const chatAsk = defineQuery("chat.ask", {
  contract: chatInputSchema,
  output: chatOutput,
  live: true,
  handler: async (input: { msg: string }) => ({ echo: input.msg }),
});

export const itemsCreate = defineCommand("items.create", {
  contract: itemSchema,
  emits: ["table:items"],
  idempotent: true,
  handler: async () => ({ ok: true }),
});
`,
  );
  fs.writeFileSync(
    path.join(root, "src", "generated", "api.ts"),
    `export const chatAskClient = Object.freeze({
  name: "chat.ask" as const,
  call: async (input: { msg: string }) => input,
});
export const itemsCreateClient = Object.freeze({
  name: "items.create" as const,
  call: async (input: { title: string }) => input,
});
`,
  );
  fs.writeFileSync(
    path.join(root, "src", "pages", "chat.atr.ts"),
    `import { chatAskClient, itemsCreateClient } from "../generated/api";

export async function send(msg: string) {
  return chatAskClient.call({ msg });
}
export async function add(title: string) {
  return itemsCreateClient.call({ title });
}
`,
  );
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-fs6-"));
const APP_ROOT = path.join(TMP, "app-auto");
const DENY_ROOT = path.join(TMP, "app-deny");
const ASK_ROOT = path.join(TMP, "app-ask");
writeApp(APP_ROOT, "auto");
writeApp(DENY_ROOT, "deny");
writeApp(ASK_ROOT, "ask");

/* ---------- 假 dev face：server-status + 端点桩 ---------- */

const hits: { method: string; urlPath: string; body: unknown }[] = [];
let fake: http.Server;
let baseUrl = "";

function fakeHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = (req.url ?? "").split("?")[0];
  if (req.method === "GET" && urlPath === "/__atelier/server-status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(SERVER_STATUS));
    return;
  }
  // server.health 探活桩（health.ts 三事实形状：ok/uptimeMs/db/version 恒恰四键）：
  // 缺省 mount=/api → 200 健康；/degraded mount → 503 db:error（非 200 是数据，orchestrator 报警语义）
  if (req.method === "GET" && urlPath === "/api/__atelier/health") {
    hits.push({ method: "GET", urlPath, body: null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptimeMs: 12345, db: "ok", version: null }));
    return;
  }
  if (req.method === "GET" && urlPath === "/degraded/__atelier/health") {
    hits.push({ method: "GET", urlPath, body: null });
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, uptimeMs: 1, db: "error", version: null }));
    return;
  }
  if (req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: unknown = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      hits.push({ method: "POST", urlPath, body });
      if (urlPath === "/api/chat.ask") {
        const input = (body ?? {}) as { msg?: string };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ echo: input.msg ?? "" }));
      } else if (urlPath === "/api/boom") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "ATR-500", message: "boom", fix: "看服务端日志" }));
      } else {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "ATR-404", message: `unknown endpoint ${urlPath}`, fix: "endpoint.list 查注册表" }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
}

let callTool: (name: string, args?: unknown) => Promise<unknown>;

beforeAll(async () => {
  fake = http.createServer(fakeHandler);
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const addr = fake.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
  process.env.ATELIER_DEV_URL = baseUrl;
  process.env.ATELIER_PROJECT_ROOT = APP_ROOT;
  ({ callTool } = await import("../mcp/server.mjs"));
});

afterAll(async () => {
  await new Promise<void>((r) => fake.close(() => r()));
  fs.rmSync(TMP, { recursive: true, force: true });
});

const atrOf = (e: unknown) => (e as { atr?: { code: string; message: string; fix: string } })?.atr;

/* ---------- 逐工具验收 ---------- */

describe("FS-6 endpoint.list", () => {
  it("注册表摘要：name/kind/live/失效键/auth/timeout/idempotent；不带 schema 体（token 纪律）", async () => {
    const res = (await callTool("endpoint.list")) as any;
    expect(res.count).toBe(3);
    const chat = res.endpoints.find((e: any) => e.name === "chat.ask");
    expect(chat).toMatchObject({ kind: "query", live: true, invalidateKeys: ["key:chat.ask"], timeoutMs: 5000 });
    const create = res.endpoints.find((e: any) => e.name === "items.create");
    expect(create).toMatchObject({ kind: "command", idempotent: true, authType: "session", authRole: "editor", emits: ["table:items"] });
    expect(chat.contract).toBeUndefined(); // schema 体归 endpoint.contract
  });
});

describe("FS-6 endpoint.contract", () => {
  it("缺省：FlatSchema 原样直读（contract + output）", async () => {
    const res = (await callTool("endpoint.contract", { name: "chat.ask" })) as any;
    expect(res.contract).toEqual(CHAT_CONTRACT);
    expect(res.output).toEqual(CHAT_OUTPUT);
  });

  it("target=draft-2020-12：单管线投影（$schema/minLength/required）", async () => {
    const res = (await callTool("endpoint.contract", { name: "chat.ask", target: "draft-2020-12" })) as any;
    expect(res.target).toBe("draft-2020-12");
    expect(res.contract.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(res.contract.properties.msg).toEqual({ type: "string", minLength: 1 });
    expect(res.contract.required).toEqual(["msg"]);
  });

  it("target=openapi-3.0：OAS Schema Object（无 $schema）", async () => {
    const res = (await callTool("endpoint.contract", { name: "chat.ask", target: "openapi-3.0" })) as any;
    expect(res.contract).toEqual({ type: "object", properties: { msg: { type: "string", minLength: 1 } }, required: ["msg"] });
    expect(res.contract.$schema).toBeUndefined();
  });

  it("无契约端点：null + 导航 note，不静默", async () => {
    const res = (await callTool("endpoint.contract", { name: "health.check" })) as any;
    expect(res.contract).toBeNull();
    expect(res.output).toBeNull();
    expect(String(res.note)).toContain("contract");
  });

  it("未知端点 → ATR-401（fix 列出已注册名）", async () => {
    await expect(callTool("endpoint.contract", { name: "nope.dot" })).rejects.toMatchObject({
      atr: { code: "ATR-401", fix: expect.stringContaining("chat.ask") },
    });
  });

  it("未知 target → 结构化报错（可用值导航在 fix）", async () => {
    await expect(callTool("endpoint.contract", { name: "chat.ask", target: "json-ld" })).rejects.toMatchObject({
      atr: { code: "ATR-401", fix: expect.stringContaining("draft-2020-12") },
    });
  });
});

describe("FS-6 endpoint.impact（静态，不依赖 dev face）", () => {
  it("两跳链路：契约 → 端点（roles）→ 前端调用点（file:line）", async () => {
    const res = (await callTool("endpoint.impact", { contractKey: "chatInputSchema" })) as any;
    expect(res.knownContract).toBe(true);
    const ep = res.endpoints.find((e: any) => e.name === "chat.ask");
    expect(ep).toBeTruthy();
    expect(ep.roles).toContain("contract");
    const site = res.callSites.find((c: any) => c.ident === "chatAskClient" && c.usage === "call");
    expect(site.file).toBe("src/pages/chat.atr.ts");
    expect(site.line).toBeGreaterThan(0);
  });

  it("未命中契约：导航报告照常返回（impact 是导航不是门禁）", async () => {
    const res = (await callTool("endpoint.impact", { contractKey: "notAContract" })) as any;
    expect(res.knownContract).toBe(false);
    expect(res.endpoints).toEqual([]);
    expect(res.notes.length).toBeGreaterThan(0);
  });

  // ---- P2-M3（2026-09-30 第三遍架构复校 §2.2）：mcp-definitions.json 广告 optProps.root
  //（:491-495）但 endpointImpact(args) 静默丢弃——恒扫 ctx.projectRoot。红态：root 指向的另一
  // app 根被无视（projectRoot 不回传、该根独有契约键查不到）。目标：endpointImpact(args?.root
  // ?? projectRoot, …) 消费广告参数。----
  it("红（P2-M3）：endpoint.impact 广告参数 root 消费生效——按指定根扫描（红态：静默丢弃恒扫装配根）", async () => {
    const otherRoot = path.join(TMP, "app-impact-root");
    writeApp(otherRoot, "auto");
    // 该根独有契约键（装配根无此键——命中与否是「root 是否真被消费」的铁证）
    fs.appendFileSync(path.join(otherRoot, "src", "contract.ts"), `\nexport const p2RootOnlySchema = ${JSON.stringify({ type: "object", reqProps: { q: { type: "string" } }, optProps: {} }, null, 2)};\n`);
    const res = (await callTool("endpoint.impact", { contractKey: "p2RootOnlySchema", root: otherRoot })) as any;
    expect(res.projectRoot).toBe(otherRoot); // 红态：APP_ROOT（root 被丢）
    expect(res.knownContract).toBe(true); // 红态：false（扫的是没有该键的装配根）
  });
});

describe("FS-6 db.schema / db.migrations / server.introspect / endpoint.journal", () => {
  it("db.schema：表/列/索引全量 + table 过滤 + 未知表 ATR-401", async () => {
    const all = (await callTool("db.schema")) as any;
    expect(all.count).toBe(1);
    expect(all.tables[0]).toMatchObject({ name: "items" });
    expect(all.tables[0].columns[0]).toEqual({ name: "id", type: "INTEGER", notNull: true, pk: true });
    expect(all.tables[0].indexes[0]).toMatchObject({ name: "items_title_idx", unique: false });
    const one = (await callTool("db.schema", { table: "items" })) as any;
    expect(one.table.name).toBe("items");
    await expect(callTool("db.schema", { table: "nope" })).rejects.toMatchObject({
      atr: { code: "ATR-401", fix: expect.stringContaining("items") },
    });
  });

  it("db.migrations：head/applied/pending 原样", async () => {
    const res = (await callTool("db.migrations")) as any;
    expect(res.migrations.head).toEqual({ id: "m2", name: "add-items" });
    expect(res.migrations.applied).toEqual(["m1_init", "m2_add-items"]);
    expect(res.migrations.pending).toEqual(["m3_add-items-idx"]);
  });

  it("server.introspect：server/live/端点计数/journal 尾部", async () => {
    const res = (await callTool("server.introspect")) as any;
    expect(res.server).toMatchObject({ restarts: 2, dbPath: "app.db", host: "127.0.0.1:5173" });
    expect(res.live).toEqual({ subscriberCount: 3, endpoints: ["chat.ask"] });
    expect(res.endpointCount).toBe(3);
    expect(res.journal.size).toBe(2);
    expect(res.journal.tail.length).toBeLessThanOrEqual(10);
  });

  it("endpoint.journal：含失败条目 + failed 计数 + lines 尾部截取", async () => {
    const res = (await callTool("endpoint.journal")) as any;
    expect(res.count).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.entries[1].status).toBe("failed");
    expect(res.entries[1].error.code).toBe("ATR-201");
    const tail = (await callTool("endpoint.journal", { lines: 1 })) as any;
    expect(tail.count).toBe(1);
    expect(tail.entries[0].status).toBe("failed");
  });
});

describe("FS-6 endpoint.call（confirm 三档 + 真打假 face）", () => {
  it("auto：POST <mount>/<name> JSON 体，响应体/状态/耗时原样返回", async () => {
    hits.length = 0;
    const res = (await callTool("endpoint.call", { name: "chat.ask", input: { msg: "hi" } })) as any;
    expect(res).toMatchObject({ ok: true, status: 200, body: { echo: "hi" } });
    expect(typeof res.durMs).toBe("number");
    expect(hits[0]).toMatchObject({ method: "POST", urlPath: "/api/chat.ask" });
    expect(hits[0].body).toEqual({ msg: "hi" });
  });

  it("deny：ATR-402 结构化拒绝（先红后绿锚点），fix 可行动", async () => {
    process.env.ATELIER_PROJECT_ROOT = DENY_ROOT;
    try {
      await expect(callTool("endpoint.call", { name: "items.create", input: { title: "x" } })).rejects.toMatchObject({
        atr: { code: "ATR-402", message: expect.stringContaining("endpoint.call"), fix: expect.stringContaining("atelier.config.json") },
      });
    } finally {
      process.env.ATELIER_PROJECT_ROOT = APP_ROOT;
    }
    expect(hits.filter((h) => h.urlPath === "/api/items.create").length).toBe(0); // 拒绝必须发生在请求之前
  });

  it("ask：多轮审批（FS-M6 §10.2）——首轮不执行，返回 inputRequired + requestState（红证锚：无审批绝不入桩）", async () => {
    process.env.ATELIER_PROJECT_ROOT = ASK_ROOT;
    try {
      hits.length = 0;
      const res = (await callTool("endpoint.call", { name: "chat.ask", input: { msg: "ask" } })) as any;
      expect(res.__atelierInputRequired).toBe(true);
      expect(res.context.tool).toBe("endpoint.call");
      expect(typeof res.requestState).toBe("string");
      // 二次提交 approve → 放行执行（同一 callTool 面，stdio/HTTP 双通道共用）
      const done = (await callTool("endpoint.call", {
        name: "chat.ask", input: { msg: "ask" },
        _approval: { requestState: res.requestState, decision: "approve" },
      })) as any;
      expect(done.status).toBe(200);
      expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(1);
    } finally {
      process.env.ATELIER_PROJECT_ROOT = APP_ROOT;
    }
  });

  it("端点级错误原样透传为数据（ok=false + body.code），不吞响应体", async () => {
    const res = (await callTool("endpoint.call", { name: "boom" })) as any;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("ATR-500");
  });

  it("非法端点名（路径注入）→ ATR-401", async () => {
    await expect(callTool("endpoint.call", { name: "../etc" })).rejects.toMatchObject({ atr: { code: "ATR-401" } });
  });
});

describe("FS-6 dev face 不在：四段式结构化错误（绝不静默空结果）", () => {
  it("fetch 失败 → ATR-4xx-dev + fix 指路 pnpm dev", async () => {
    const dead = http.createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const deadPort = (dead.address() as { port: number }).port;
    await new Promise<void>((r) => dead.close(() => r())); // 拿一个确定无监听的端口
    const { callEndpointTool } = await import("../mcp/endpoint-tools.mjs");
    await expect(
      callEndpointTool("endpoint.list", {}, { devUrl: `http://127.0.0.1:${deadPort}`, devToken: "", projectRoot: APP_ROOT }),
    ).rejects.toSatisfy((e: any) => {
      expect(e.atr.code).toBe("ATR-4xx-dev");
      expect(e.message).toContain("dev surface unreachable");
      expect(e.atr.fix).toContain("pnpm dev");
      return true;
    });
  });
});

/* ---------- MCP 扩张批 B：jobs/email/uploads/health 四面四工具（36→40） ---------- */

describe("MCP 批B 四工具·段在场（canned server-status 三段 + health 探活桩）", () => {
  it("jobs.status：jobs 段投影（counts 四态 + recent 尾部原样）", async () => {
    const res = (await callTool("jobs.status")) as any;
    expect(res.jobs).toEqual(SERVER_STATUS.jobs);
    expect(res.jobs.counts).toEqual({ pending: 2, running: 1, done: 7, failed: 1 });
    expect(res.jobs.recent[2]).toMatchObject({ id: 14, status: "failed", durMs: 120 });
    expect(res.source).toBe("/__atelier/server-status");
    expect(res.note).toBeUndefined(); // 在场 = 无缺省 note
  });

  it("email.log：count/failed/entries 投影（failed 过滤 = status:'failed'，取值源 EmailLogEntry 'ok'|'failed'）", async () => {
    const res = (await callTool("email.log")) as any;
    expect(res.count).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.entries).toEqual(SERVER_STATUS.email);
    expect(Object.keys(res.entries[0]).sort()).toEqual(["id", "status", "subject", "to", "transport", "ts"]); // 恰六字段
    expect(String(res.note)).toContain("atelier_email_log"); // 全量台账指路 SQL 直读
  });

  it("uploads.status：段透传（faces/assets/tail 原样，零字段级再投影）", async () => {
    const res = (await callTool("uploads.status")) as any;
    expect(res.faces).toEqual(SERVER_STATUS.uploads.faces);
    expect(res.assets).toEqual({ count: 42, bytes: 1048576 });
    expect(res.tail).toEqual(SERVER_STATUS.uploads.tail);
    expect("path" in res.tail[0]).toBe(false); // 契约钉：恰六字段无 path
    expect(res.source).toBe("/__atelier/server-status");
  });

  it("server.health：GET <mount|/api>/__atelier/health——200 返回 ok/status/durMs/body；非 200 是数据不抛（health.ts 口径）", async () => {
    hits.length = 0;
    const res = (await callTool("server.health")) as any;
    expect(res).toMatchObject({ ok: true, status: 200, body: { ok: true, uptimeMs: 12345, db: "ok", version: null } });
    expect(typeof res.durMs).toBe("number");
    expect(hits[0]).toMatchObject({ method: "GET", urlPath: "/api/__atelier/health" }); // mount 缺省 /api
    const degraded = (await callTool("server.health", { mount: "/degraded/" })) as any; // 尾斜杠经 mount 清洗
    expect(degraded.ok).toBe(false);
    expect(degraded.status).toBe(503); // 非 200 原样作数据返回——绝不抛
    expect(degraded.body).toMatchObject({ ok: false, db: "error" });
    expect(hits[1]).toMatchObject({ method: "GET", urlPath: "/degraded/__atelier/health" });
  });
});

describe("MCP 批B 四工具·段缺省（三段全缺裸 face——缺省诚实返回，db.migrations 同款）", () => {
  it("jobs/email/uploads 段缺省 → null + 装配指路 note，绝不编造空结果", async () => {
    const bare = http.createServer((req, res) => {
      const urlPath = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && urlPath === "/__atelier/server-status") {
        const { jobs: _j, email: _e, uploads: _u, ...rest } = SERVER_STATUS; // 三段全缺 = 键不出现（契约：未装配 = 段缺省）
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(rest));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
    const port = (bare.address() as { port: number }).port;
    const { callEndpointTool } = await import("../mcp/endpoint-tools.mjs");
    const ctx = { devUrl: `http://127.0.0.1:${port}`, devToken: "", projectRoot: APP_ROOT };
    try {
      const j = (await callEndpointTool("jobs.status", {}, ctx)) as any;
      expect(j.jobs).toBeNull();
      expect(String(j.note)).toContain("createHandler({ jobs })");
      const e = (await callEndpointTool("email.log", {}, ctx)) as any;
      expect(e.email).toBeNull();
      expect(String(e.note)).toContain("createHandler({ email })");
      const u = (await callEndpointTool("uploads.status", {}, ctx)) as any;
      expect(u.uploads).toBeNull();
      expect(String(u.note)).toContain("createHandler({ uploads })");
    } finally {
      await new Promise<void>((r) => bare.close(() => r()));
    }
  });

  it("server.health 传输层不通 → ATR-4xx-dev（fix 指路 pnpm dev）——健康面自己不可达才报错", async () => {
    const dead = http.createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const deadPort = (dead.address() as { port: number }).port;
    await new Promise<void>((r) => dead.close(() => r())); // 拿一个确定无监听的端口
    const { callEndpointTool } = await import("../mcp/endpoint-tools.mjs");
    await expect(
      callEndpointTool("server.health", {}, { devUrl: `http://127.0.0.1:${deadPort}`, devToken: "", projectRoot: APP_ROOT }),
    ).rejects.toMatchObject({ atr: { code: "ATR-4xx-dev", fix: expect.stringContaining("pnpm dev") } });
  });
});

/* ---------- stdio e2e：入口形态 + tools/list 计数 ---------- */

describe("stdio e2e（spawn server.mjs）", () => {
  it("initialize → tools/list 含 8 个 FS-6 工具 + tasks 3 + 四面 4（33+3+4=40）→ tools/call endpoint.list", async () => {
    const child = spawn(process.execPath, [SERVER_MJS], {
      env: { ...process.env, ATELIER_DEV_URL: baseUrl, ATELIER_PROJECT_ROOT: APP_ROOT, ATELIER_TOOLSETS: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = readline.createInterface({ input: child.stdout!, terminal: false });
    const pending = new Map<number, (v: any) => void>();
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        const resolve = pending.get(msg.id);
        if (resolve) { pending.delete(msg.id); resolve(msg); }
      } catch { /* ignore */ }
    });
    const rpc = (id: number, method: string, params?: unknown) =>
      new Promise<any>((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        setTimeout(() => (pending.has(id) ? reject(new Error(`rpc timeout: ${method}`)) : undefined), 10000);
      });
    try {
      await rpc(1, "initialize", { protocolVersion: "2025-06-18" });
      const list = await rpc(2, "tools/list");
      const names: string[] = list.result.tools.map((t: any) => t.name);
      expect(names.length).toBe(40);
      for (const t of ["endpoint.list", "endpoint.contract", "endpoint.impact", "db.schema", "db.migrations", "server.introspect", "endpoint.call", "endpoint.journal", "tasks.get", "tasks.update", "tasks.cancel", "jobs.status", "email.log", "uploads.status", "server.health"]) {
        expect(names).toContain(t);
      }
      const call = await rpc(3, "tools/call", { name: "endpoint.list", arguments: {} });
      expect(call.result.isError).toBe(false);
      const payload = JSON.parse(call.result.content[0].text);
      expect(payload.count).toBe(3);
    } finally {
      child.kill();
    }
  }, 20000);

  it("ask 档 stdio 全链（FS-M6②）：首轮 InputRequiredResult + requestState → 携 _approval 二次提交放行；tasks/list 方法诚实移除", async () => {
    hits.length = 0;
    const child = spawn(process.execPath, [SERVER_MJS], {
      env: { ...process.env, ATELIER_DEV_URL: baseUrl, ATELIER_PROJECT_ROOT: ASK_ROOT, ATELIER_TOOLSETS: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = readline.createInterface({ input: child.stdout!, terminal: false });
    const pending = new Map<number, (v: any) => void>();
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        const resolve = pending.get(msg.id);
        if (resolve) { pending.delete(msg.id); resolve(msg); }
      } catch { /* ignore */ }
    });
    const rpc = (id: number, method: string, params?: unknown) =>
      new Promise<any>((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        setTimeout(() => (pending.has(id) ? reject(new Error(`rpc timeout: ${method}`)) : undefined), 10000);
      });
    try {
      await rpc(1, "initialize", { protocolVersion: "2025-06-18" });
      // tasks/list：2026-07-28 已移除（SEP-2133，无会话无法安全定界）——协议级诚实错误
      const removed = await rpc(2, "tasks/list");
      expect(removed.error).toBeTruthy();

      const first = await rpc(3, "tools/call", { name: "endpoint.call", arguments: { name: "chat.ask", input: { msg: "stdio-ask" } } });
      expect(first.result.isError).toBe(false);
      expect(first.result.inputRequired.tool).toBe("endpoint.call");
      const requestState = first.result.requestState;
      expect(typeof requestState).toBe("string");
      expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(0); // 无审批不执行

      const second = await rpc(4, "tools/call", {
        name: "endpoint.call",
        arguments: { name: "chat.ask", input: { msg: "stdio-ask" }, _approval: { requestState, decision: "approve" } },
      });
      expect(second.result.isError).toBe(false);
      expect(JSON.parse(second.result.content[0].text).body.echo).toBe("stdio-ask");
      expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(1); // 审批后才入桩
    } finally {
      child.kill();
    }
  }, 20000);
});
