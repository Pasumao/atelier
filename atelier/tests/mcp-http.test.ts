/**
 * mcp-http.test.ts — FS-M6 交付批验收（FS-DESIGN §10.2「MCP 2026-07-28 无状态规范对齐」）：
 *   交付一  mcp/http.mjs handleMcpHttp：HTTP 直连 + Mcp-Method/Mcp-Name 头路由（SEP-2243）、
 *           握手移除（SEP-2575）、_meta 版本携带、与 stdio 同工具同果、两请求间无会话粘性；
 *   交付二  confirm=ask 多轮审批（SEP-2322 InputRequiredResult + requestState）：无审批不执行（红证锚）、
 *           approve 放行 / deny 拒绝 / 坏句柄与过期句柄确定性拒绝、审批动作入审计、双通道可续
 *          （requestState 为唯一连续性载体——跨 handler 实例消费，无服务端会话态）；
 *   交付三  Tasks 扩展（SEP-2133）：tasks/get|update|cancel 协议方法 + 同名点工具、服务端主导创建
 *           （HTTP 通道 + 长操作清单）、tasks/list 已移除的诚实应答；
 *   接线    dev 面 /__atelier/mcp 最小接线（token 门之后桥接，框架仓布局解析 mcp/http.mjs）。
 *
 * 纪律（§14.2）：先红后绿——本文件先于 mcp/http.mjs、mcp/tasks.mjs、server.mjs 抽核落盘跑红
 * （模块不存在 → import 失败）；实现后跑绿（证据见提交说明）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-mcp-http-"));
const AUTO_ROOT = path.join(TMP, "app-auto");
const ASK_ROOT = path.join(TMP, "app-ask");

function writeApp(root: string, confirm: string): void {
  fs.mkdirSync(path.join(root, ".atelier"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "atelier.config.json"),
    JSON.stringify({ agent: { confirm }, tokens: {} }, null, 2),
  );
  // dev-token：审批句柄 HMAC 密钥与 dev 面 token 同源（ 无粘性断言依赖它跨实例稳定 ）
  fs.writeFileSync(path.join(root, ".atelier", "dev-token"), `tok-${path.basename(root)}-secret`, "utf8");
}
writeApp(AUTO_ROOT, "auto");
writeApp(ASK_ROOT, "ask");

/* ---------- 假 dev face：endpoint.call 的真打桩（审批放行/拒绝以「桩是否被命中」为铁证） ---------- */
const hits: { urlPath: string; body: unknown }[] = [];
let fake: http.Server;
let baseUrl = "";

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const urlPath = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && urlPath === "/__atelier/server-status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        server: { mount: "/api" },
        endpoints: [{ name: "chat.ask", kind: "query", contract: { type: "object", reqProps: { msg: { type: "string" } }, optProps: {} } }],
        journal: [],
      }));
      return;
    }
    if (req.method === "POST" && urlPath === "/api/chat.ask") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        hits.push({ urlPath, body: raw ? JSON.parse(raw) : null });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ echo: JSON.parse(raw).msg }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  process.env.ATELIER_DEV_URL = baseUrl;
});

afterAll(async () => {
  await new Promise<void>((r) => fake.close(() => r()));
  delete process.env.ATELIER_DEV_URL;
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* ---------- 被测件（动态 import：红检阶段模块不存在 → 本文件整体跑红） ---------- */
const { handleMcpHttp } = await import("../mcp/http.mjs");
const { createTaskStore } = await import("../mcp/tasks.mjs");
const serverMjs = await import("../mcp/server.mjs");
const confirmMjs = await import("../mcp/confirm.mjs");
const { callTool, handleMessage } = serverMjs as any;
const { approvalVerdict, verifyRequestState, createRequestState } = confirmMjs as any;

/* ---------- 基建：Request 构造 + 依赖装配 ---------- */
function mcpRequest(method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/__atelier/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-method": method, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function deps(projectRoot = AUTO_ROOT, extra: Record<string, unknown> = {}) {
  return { projectRoot, devUrl: baseUrl, devToken: "irrelevant-for-local-tools", ...extra };
}
const call = async (name: string, args: unknown, root = AUTO_ROOT) =>
  (await handleMcpHttp(mcpRequest("tools/call", { arguments: args }, { "mcp-name": name }), deps(root))) as any;

type Reply = { jsonrpc: string; id?: unknown; result?: any; error?: { code: number; message: string } };

/* ================================================================== 交付一：头路由 */

describe("FS-M6① HTTP 直连：Mcp-Method/Mcp-Name 头路由（SEP-2243，无握手）", () => {
  it("tools/list：头路由应答 200，_meta 携带协议版本 2026-07-28", async () => {
    const out = (await handleMcpHttp(mcpRequest("tools/list", { _meta: { protocolVersion: "2026-07-28" } }), deps())) as any;
    expect(out.status).toBe(200);
    const parsed = JSON.parse(out.body);
    expect(parsed.ok).toBe(true);
    expect(parsed._meta.protocolVersion).toBe("2026-07-28");
    const names = parsed.result.tools.map((t: any) => t.name);
    expect(names.length).toBe(40); // 33 + tasks.get/update/cancel + jobs.status/email.log/uploads.status/server.health
    expect(names).toContain("tasks.get");
  });

  it("ping / server/discover：无状态预取面（SEP-2575 discover 能力）", async () => {
    const ping = (await handleMcpHttp(mcpRequest("ping", {}), deps())) as any;
    expect(ping.status).toBe(200);
    expect(JSON.parse(ping.body).result).toEqual({});
    const disc = (await handleMcpHttp(mcpRequest("server/discover", {}), deps())) as any;
    const parsed = JSON.parse(disc.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.result.serverInfo.name).toBe("atelier");
    expect(parsed.result.protocolVersion).toBe("2026-07-28");
    expect(parsed.result.tools.length).toBe(40);
  });

  it("tools/call：Mcp-Name 头路由真执行（本地工具 docs.search）", async () => {
    hits.length = 0;
    const out = await call("docs.search", { q: "checkpoint" });
    expect(out.status).toBe(200);
    const parsed = JSON.parse(out.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.result.isError).toBe(false);
    const payload = JSON.parse(parsed.result.content[0].text);
    expect(payload.query).toBe("checkpoint");
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it("误例：缺 Mcp-Method / tools/call 缺 Mcp-Name / 头与体 name 冲突 / 未知方法 / 坏 JSON → 结构化 4xx", async () => {
    const noMethod = (await handleMcpHttp(new Request("http://x/mcp", { method: "POST", body: "{}" }), deps())) as any;
    expect(noMethod.status).toBe(400);
    expect(JSON.parse(noMethod.body).error.code).toBe("ATR-401");

    const noName = (await handleMcpHttp(mcpRequest("tools/call", { arguments: {} }), deps())) as any;
    expect(noName.status).toBe(400);
    expect(JSON.parse(noName.body).error.fix).toContain("Mcp-Name");

    const conflict = (await handleMcpHttp(
      mcpRequest("tools/call", { name: "docs.search", arguments: {} }, { "mcp-name": "structure.map" }),
      deps(),
    )) as any;
    expect(conflict.status).toBe(400);

    const unknown = (await handleMcpHttp(mcpRequest("resources/read", {}), deps())) as any;
    expect(unknown.status).toBe(404);

    const badJson = (await handleMcpHttp(mcpRequest("tools/list", "{not json"), deps())) as any;
    expect(badJson.status).toBe(400);
  });

  it("握手已移除（SEP-2575）：initialize / notifications/initialized → 诚实 4xx 指路 _meta", async () => {
    const init = (await handleMcpHttp(mcpRequest("initialize", { protocolVersion: "2025-06-18" }), deps())) as any;
    expect(init.status).toBe(400);
    const body = JSON.parse(init.body);
    expect(body.error.message).toContain("2026-07-28");
    expect(body.error.fix).toContain("_meta");
    const note = (await handleMcpHttp(mcpRequest("notifications/initialized", {}), deps())) as any;
    expect(note.status).toBe(400);
  });

  it("tasks/list 已移除（SEP-2133：无会话无法安全定界）→ 诚实 4xx", async () => {
    const out = (await handleMcpHttp(mcpRequest("tasks/list", {}), deps())) as any;
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error.message).toContain("tasks/list");
  });
});

describe("FS-M6① 无会话粘性 + 与 stdio 同工具同果", () => {
  it("两请求独立可续：requestState 之外的连续性为零——不同 deps 实例（含独立 task store）逐请求应答一致", async () => {
    // 两个完全独立的 handler 调用（deps 对象互不相干、store 各自新建）：无任何服务端会话态可依赖
    const a = (await handleMcpHttp(mcpRequest("tools/call", { arguments: { q: "confirm" } }, { "mcp-name": "docs.search" }), deps())) as any;
    const b = (await handleMcpHttp(
      mcpRequest("tools/call", { arguments: { q: "confirm" } }, { "mcp-name": "docs.search" }),
      { projectRoot: AUTO_ROOT, devUrl: baseUrl, devToken: "x", tasks: createTaskStore() },
    )) as any;
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(JSON.parse(a.body).result.content).toEqual(JSON.parse(b.body).result.content);
  });

  it("同工具同果：HTTP tools/call 与 stdio handleMessage 的 tools/call 结果包络全等", async () => {
    const httpOut = await call("docs.search", { q: "hmr" });
    const httpPayload = JSON.parse(JSON.parse(httpOut.body).result.content[0].text);
    const reply = (await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "docs.search", arguments: { q: "hmr" } } },
      { projectRoot: AUTO_ROOT, devUrl: baseUrl, devToken: "x" },
    )) as Reply;
    const stdioPayload = JSON.parse(reply!.result.content[0].text);
    expect(stdioPayload).toEqual(httpPayload);
  });

  it("_meta 版本携带：客户端缺 _meta / 携未知版本 → 服务端以 2026-07-28 应答（宽容不拒）", async () => {
    const bare = JSON.parse((await call("docs.search", { q: "tokens" })).body);
    expect(bare._meta.protocolVersion).toBe("2026-07-28");
    const legacy = (await handleMcpHttp(
      mcpRequest("tools/list", { _meta: { protocolVersion: "2025-06-18" } }),
      deps(),
    )) as any;
    expect(legacy.status).toBe(200);
    expect(JSON.parse(legacy.body)._meta.protocolVersion).toBe("2026-07-28");
  });
});

/* ================================================================== 交付二：ask 档多轮审批 */

describe("FS-M6② confirm=ask 多轮审批（SEP-2322 InputRequiredResult + requestState）", () => {
  it("红证锚：ask 档无审批直接调用 → 不执行，返回 inputRequired + requestState", async () => {
    hits.length = 0;
    const out = await call("endpoint.call", { name: "chat.ask", input: { msg: "ask-1" } }, ASK_ROOT);
    const parsed = JSON.parse(out.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.result.isError).toBe(false);
    expect(parsed.result.inputRequired).toBeTruthy();
    expect(parsed.result.inputRequired.tool).toBe("endpoint.call");
    expect(typeof parsed.result.requestState).toBe("string");
    expect(parsed.result.requestState.length).toBeGreaterThan(20);
    expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(0); // 无审批绝不执行
  });

  it("approve 二次提交 → 放行执行（桩被命中）+ 审计 requested/granted 留痕", async () => {
    hits.length = 0;
    const first = JSON.parse((await call("endpoint.call", { name: "chat.ask", input: { msg: "ask-2" } }, ASK_ROOT)).body);
    const requestState = first.result.requestState;
    const second = await call(
      "endpoint.call",
      { name: "chat.ask", input: { msg: "ask-2" }, _approval: { requestState, decision: "approve" } },
      ASK_ROOT,
    );
    const parsed = JSON.parse(second.body);
    expect(parsed.result.isError).toBe(false);
    expect(JSON.parse(parsed.result.content[0].text).body.echo).toBe("ask-2"); // 真执行了
    expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(1);
    const auditText = fs.readFileSync(path.join(ASK_ROOT, ".atelier", "audit.jsonl"), "utf8");
    const events = auditText.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === "mcp.approval");
    expect(events.map((e: any) => e.detail.event)).toContain("requested");
    expect(events.map((e: any) => e.detail.event)).toContain("granted");
  });

  it("deny 二次提交 → ATR-402 拒绝、桩零命中、审计 denied 留痕", async () => {
    hits.length = 0;
    const first = JSON.parse((await call("endpoint.call", { name: "chat.ask", input: { msg: "ask-3" } }, ASK_ROOT)).body);
    const second = await call(
      "endpoint.call",
      { name: "chat.ask", input: { msg: "ask-3" }, _approval: { requestState: first.result.requestState, decision: "deny" } },
      ASK_ROOT,
    );
    const parsed = JSON.parse(second.body);
    expect(parsed.ok).toBe(true); // 工具级拒绝 = isError 结果（MCP 语义），非传输错误
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result.structuredContent.code).toBe("ATR-402");
    expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(0);
    const auditText = fs.readFileSync(path.join(ASK_ROOT, ".atelier", "audit.jsonl"), "utf8");
    expect(auditText).toContain('"event":"denied"');
  });

  it("坏句柄 / 篡改 / 参数漂移 / 非法 decision → ATR-401 确定性拒绝，绝不执行", async () => {
    hits.length = 0;
    const args = { name: "chat.ask", input: { msg: "ask-4" } };
    const first = JSON.parse((await call("endpoint.call", args, ASK_ROOT)).body);
    const requestState = first.result.requestState;
    for (const [label, approval] of [
      ["坏句柄", { requestState: "v1.garbage.deadbeef", decision: "approve" }],
      ["句柄与参数漂移", { requestState, decision: "approve" }],
      ["非法 decision", { requestState, decision: "yolo" }],
    ] as const) {
      const drift = label === "句柄与参数漂移" ? { name: "chat.ask", input: { msg: "CHANGED" } } : args;
      const out = await call("endpoint.call", { ...drift, _approval: approval }, ASK_ROOT);
      const parsed = JSON.parse(out.body);
      expect(parsed.result.isError, label).toBe(true);
      expect(parsed.result.structuredContent.code, label).toBe("ATR-401");
    }
    expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(0);
  });

  it("跨实例可续（无粘性的审批形态）：requestState 只经客户端回传，在全新 handler 实例消费成功", async () => {
    const first = JSON.parse((await call("endpoint.call", { name: "chat.ask", input: { msg: "ask-5" } }, ASK_ROOT)).body);
    // 全新 deps（独立 store）——句柄签名密钥来自项目 dev-token 文件，与实例无关
    const second = await handleMcpHttp(
      mcpRequest(
        "tools/call",
        { arguments: { name: "chat.ask", input: { msg: "ask-5" }, _approval: { requestState: first.result.requestState, decision: "approve" } } },
        { "mcp-name": "endpoint.call" },
      ),
      { projectRoot: ASK_ROOT, devUrl: baseUrl, devToken: "other-instance", tasks: createTaskStore() },
    ) as any;
    expect(JSON.parse(second.body).result.isError).toBe(false);
  });

  it("auto 档零变化：不产生 inputRequired，直接执行（回归守卫）", async () => {
    hits.length = 0;
    const out = await call("endpoint.call", { name: "chat.ask", input: { msg: "auto-1" } }, AUTO_ROOT);
    const parsed = JSON.parse(out.body);
    expect(parsed.result.isError).toBe(false);
    expect(parsed.result.inputRequired).toBeUndefined();
    expect(hits.filter((h) => h.urlPath === "/api/chat.ask").length).toBe(1);
  });
});

describe("FS-M6② 审批原语单元（confirm.mjs 纯函数面）", () => {
  const SECRET = "unit-secret";
  it("createRequestState/verifyRequestState 往返；过期 → expired；篡改 → bad-signature", () => {
    const now = 1_000_000;
    const token = createRequestState({ tool: "state.time_travel", args: { to: "sig-3" }, secret: SECRET, now, ttlMs: 60_000 });
    const ok = verifyRequestState({ requestState: token, tool: "state.time_travel", args: { to: "sig-3" }, secret: SECRET, now: now + 59_999 });
    expect(ok.ok).toBe(true);
    const expired = verifyRequestState({ requestState: token, tool: "state.time_travel", args: { to: "sig-3" }, secret: SECRET, now: now + 60_001 });
    expect(expired.ok).toBe(false);
    expect(expired.reason).toBe("expired");
    const tampered = verifyRequestState({ requestState: `${token}x`, tool: "state.time_travel", args: { to: "sig-3" }, secret: SECRET, now });
    expect(tampered.ok).toBe(false);
    expect(["bad-signature", "malformed"]).toContain(tampered.reason);
    const wrongTool = verifyRequestState({ requestState: token, tool: "checkpoint.rollback", args: { to: "sig-3" }, secret: SECRET, now });
    expect(wrongTool.ok).toBe(false);
    expect(wrongTool.reason).toBe("tool-mismatch");
  });

  it("approvalVerdict 分档：deny 档沿用 confirmGate 同文；非受闸工具在 ask 档直接放行", () => {
    const deny = approvalVerdict({ confirm: "deny" }, "checkpoint.rollback", {}, { secret: SECRET });
    expect(deny.kind).toBe("deny");
    expect(deny.code).toBe("ATR-402");
    const ungated = approvalVerdict({ confirm: "ask" }, "docs.search", { q: "x" }, { secret: SECRET });
    expect(ungated.kind).toBe("allow");
  });

  it("approvalVerdict：ask + 毁坏性工具 + approve 句柄 → execute；句柄过期 → refused(ATR-401)", () => {
    const now = 5_000_000;
    const token = createRequestState({ tool: "checkpoint.source_rollback", args: { id: "cp-1" }, secret: SECRET, now, ttlMs: 1_000 });
    const execute = approvalVerdict(
      { confirm: "ask" },
      "checkpoint.source_rollback",
      { id: "cp-1", _approval: { requestState: token, decision: "approve" } },
      { secret: SECRET, now: now + 500 },
    );
    expect(execute.kind).toBe("execute");
    const late = approvalVerdict(
      { confirm: "ask" },
      "checkpoint.source_rollback",
      { id: "cp-1", _approval: { requestState: token, decision: "approve" } },
      { secret: SECRET, now: now + 5_000 },
    );
    expect(late.kind).toBe("refused");
    expect(late.code).toBe("ATR-401");
    expect(late.message).toContain("过期");
  });
});

/* ================================================================== 交付三：Tasks 扩展 */

describe("FS-M6③ Tasks 扩展（SEP-2133：服务端主导创建 + tasks/get|update|cancel）", () => {
  it("服务端主导：HTTP 通道调用长操作清单工具（structure.check）→ 返回 task 句柄而非内联结果", async () => {
    const out = await call("structure.check", { root: AUTO_ROOT });
    const parsed = JSON.parse(out.body);
    expect(parsed.ok).toBe(true);
    const task = parsed.result.task;
    expect(task.taskId).toMatch(/^task-\d+$/);
    expect(["queued", "running", "completed"]).toContain(task.status);
  });

  it("tasks/get 轮询至 completed，结果与 stdio 直调同工具同果；completed 后可 update 收紧保留窗", async () => {
    const created = JSON.parse((await call("structure.check", { root: AUTO_ROOT })).body).result.task;
    const inline = await callTool("structure.check", { root: AUTO_ROOT }, { projectRoot: AUTO_ROOT, devUrl: baseUrl, devToken: "x" });
    // 轮询（task 在本 handler 的 store 里创建——同一 deps 连续性由显式句柄承载）
    let view: any = null;
    for (let i = 0; i < 100 && view?.status !== "completed"; i++) {
      const out = (await handleMcpHttp(mcpRequest("tasks/get", { taskId: created.taskId }), deps())) as any;
      view = JSON.parse(out.body).result;
      if (view.status !== "completed") await new Promise((r) => setTimeout(r, 10));
    }
    expect(view.status).toBe("completed");
    expect(view.result.verdict).toBe((inline as any).verdict);
    const upd = (await handleMcpHttp(mcpRequest("tasks/update", { taskId: created.taskId, ttlMs: 1000 }), deps())) as any;
    expect(JSON.parse(upd.body).result.ttlMs).toBe(1000);
  });

  it("tasks/cancel：运行中任务取消 → cancelled 终态，result 不再产出；未知 taskId → ATR-401", async () => {
    const store = createTaskStore();
    let started = false;
    const view = store.create({ tool: "test.run", run: () => new Promise((r) => setTimeout(() => { started = true; r({ ok: true }); }, 50)) });
    expect(view.status).toBe("queued");
    const cancelled = store.cancel(view.taskId);
    expect(cancelled.status).toBe("cancelled");
    await store.settle(view.taskId);
    expect(started).toBe(false); // 取消发生在任务起步前 → run 从未产出结果
    expect(store.get(view.taskId)!.status).toBe("cancelled");

    const missing = (await handleMcpHttp(mcpRequest("tasks/get", { taskId: "task-404" }), deps())) as any;
    expect(missing.status).toBe(200); // 工具级未命中 = isError 结果
    const parsed = JSON.parse(missing.body);
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result.structuredContent.code).toBe("ATR-401");
  });

  it("同名点工具（stdio 语义）：tasks.get/update/cancel 走 tools/call 同一存储", async () => {
    const store = createTaskStore();
    const ctx = { projectRoot: AUTO_ROOT, devUrl: baseUrl, devToken: "x", tasks: store };
    const created: any = await callTool("tasks.get", { taskId: "nope" }, ctx).catch((e: any) => e);
    expect(created.atr.code).toBe("ATR-401");
    const task = store.create({ tool: "structure.check", run: async () => ({ verdict: "PASSED" }) });
    await store.settle(task.taskId);
    const got: any = await callTool("tasks.get", { taskId: task.taskId }, ctx);
    expect(got.status).toBe("completed");
    const upd: any = await callTool("tasks.update", { taskId: task.taskId, ttlMs: 500 }, ctx);
    expect(upd.ttlMs).toBe(500);
  });

  it("task store 单元：失败任务捕获 ATR 错误；ttl 到期被 sweep 驱逐（显式句柄可失效）", async () => {
    const now = { t: 100_000 };
    const store = createTaskStore({ now: () => now.t, ttlMs: 1_000 });
    const bad = store.create({ tool: "graph.static", run: async () => { throw Object.assign(new Error("no dump"), { atr: { code: "ATR-401", fix: "compile first" } }); } });
    await store.settle(bad.taskId);
    const failed = store.get(bad.taskId)!;
    expect(failed.status).toBe("failed");
    expect(failed.error.code).toBe("ATR-401");
    const done = store.create({ tool: "docs.search", run: async () => ({ ok: true }) });
    await store.settle(done.taskId);
    now.t = 102_001; // 越过 ttl
    expect(store.get(done.taskId)).toBeNull(); // sweep 驱逐
  });
});

/* ================================================================== 接线：dev 面 /__atelier/mcp */

describe("FS-M6 接线：dev 面 /__atelier/mcp（token 门后最小桥接）", () => {
  it("经真实插件中间件：token 门内头路由应答；无 token → 401（既有门先行）", async () => {
    const prevCwd = process.cwd();
    process.chdir(ASK_ROOT);
    try {
      const { atelierDevPlugin } = await import("../dev/atelier-dev-plugin.mjs");
      const plugin = atelierDevPlugin();
      const handlers: any[] = [];
      plugin.configureServer({
        middlewares: { use: (fn: any) => handlers.push(fn) },
        config: { server: {} },
        watcher: { add() { /* noop */ }, on() { /* noop */ } },
        httpServer: null,
      });
      const mcpMiddleware = handlers[handlers.length - 1];
      const token = fs.readFileSync(path.join(ASK_ROOT, ".atelier", "dev-token"), "utf8").trim();

      const via = (reqHeaders: Record<string, string>, url: string, body: string) =>
        new Promise<{ statusCode: number; body: string }>((resolve) => {
          const res = {
            statusCode: 200,
            setHeader() { /* noop */ },
            end(b: string) { resolve({ statusCode: res.statusCode, body: b ?? "" }); },
          };
          const req = {
            url,
            method: "POST",
            headers: reqHeaders,
            on(ev: string, cb: (c?: string) => void) {
              if (ev === "data") setImmediate(() => cb(body));
              if (ev === "end") setImmediate(() => cb());
            },
          };
          mcpMiddleware(req, res, () => resolve({ statusCode: -1, body: "next() called" }));
        });

      const denied = await via({}, "/__atelier/mcp", "{}");
      expect(denied.statusCode).toBe(401);

      const okOut = await via(
        { "x-atelier-token": token, "mcp-method": "tools/call", "mcp-name": "docs.search" },
        "/__atelier/mcp",
        JSON.stringify({ arguments: { q: "confirm" } }),
      );
      expect(okOut.statusCode).toBe(200);
      expect(JSON.parse(okOut.body).ok).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
