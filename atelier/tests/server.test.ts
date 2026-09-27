import { describe, it, expect } from "vitest";
import { defineQuery, defineCommand, EndpointRegistry, type EndpointDef } from "../server/endpoints";
import { openSqlite, SqliteUnavailableError, type SqliteDb } from "../server/sqlite";
import type { FlatSchema } from "../runtime/contract";

const echoContract: FlatSchema = {
  type: "object",
  reqProps: { id: { type: "number", min: 0 } },
  optProps: { note: { type: "string" } },
};

function makeRegistry(): EndpointRegistry {
  const reg = new EndpointRegistry({ journalLimit: 3 });
  reg.register(
    defineQuery<{ id: number }, { id: number; echo: string }>("chat.query", {
      contract: echoContract,
      handler: (input) => ({ id: input.id, echo: `q:${input.id}` }),
    })
  );
  reg.register(
    defineCommand<{ id: number }, { done: boolean }>("chat.send", {
      contract: echoContract,
      handler: async (input) => ({ done: input.id > 0 }),
    })
  );
  reg.register(
    defineQuery("live.feed", {
      live: true,
      // P1-5 后 live×auth(type≠none) 组合注册期拒绝（ATR-315）——显式免鉴权声明是与 live 合法的唯一 auth 形态
      auth: { type: "none" },
      handler: () => ({ items: [] }),
    })
  );
  return reg;
}

function post(handler: (req: Request) => Promise<Response>, name: string, body: unknown, mount = ""): Promise<Response> {
  return handler(new Request(`http://local.test${mount}/${name}`, { method: "POST", body: JSON.stringify(body) }));
}

describe("atelier-server 端点运行时（决策 18/20，FS-1）", () => {
  it("defineQuery/defineCommand 元数据：kind/live/auth/contract 显式声明", () => {
    const reg = makeRegistry();
    const feed = reg.get("live.feed")! as EndpointDef;
    expect(feed.kind).toBe("query");
    expect(feed.live).toBe(true);
    expect(feed.auth?.type).toBe("none");
    expect(reg.get("chat.send")!.kind).toBe("command");
  });

  it("显式注册表：重复注册 → ATR-313；非法名（注入面）→ ATR-313", () => {
    const reg = makeRegistry();
    expect(() => reg.register(defineQuery("chat.query", { handler: () => 1 }))).toThrow(/ATR-313/);
    expect(() => reg.register(defineQuery("../escape", { handler: () => 1 }))).toThrow(/ATR-313/);
    expect(() => reg.register(defineQuery("1abc", { handler: () => 1 }))).toThrow(/ATR-313/);
  });

  it("list() 契约摘要：name/kind/live/hasContract/authType（MCP endpoint.list 数据源）", () => {
    const summaries = makeRegistry().list();
    expect(summaries.map((s) => s.name)).toEqual(["chat.query", "chat.send", "live.feed"]);
    const feed = summaries.find((s) => s.name === "live.feed")!;
    expect(feed.live).toBe(true);
    expect(feed.hasContract).toBe(false);
    expect(feed.authType).toBe("none");
  });

  it("query POST 合法输入 → 200 JSON + kind/名 头", async () => {
    const handler = makeRegistry().createHandler();
    const res = await post(handler, "chat.query", { id: 7 });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-atelier-endpoint-kind")).toBe("query");
    expect(res.headers.get("x-atelier-endpoint")).toBe("chat.query");
    expect(await res.json()).toEqual({ id: 7, echo: "q:7" });
  });

  it("契约校验失败 → 400 ATR-201 四段式（component=端点名，fix 带字段提示）", async () => {
    const handler = makeRegistry().createHandler();
    const res = await post(handler, "chat.query", { note: "missing id" });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.code).toBe("ATR-201");
    expect(err.context.component).toBe("chat.query");
    expect(err.fix).toContain("id");
  });

  it("坏 JSON 体 → 400 ATR-312；未知端点 → 404 ATR-310（fix 列出可用端点）", async () => {
    const handler = makeRegistry().createHandler();
    const bad = await handler(new Request("http://local.test/chat.query", { method: "POST", body: "{oops" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("ATR-312");

    const unknown = await post(handler, "nope.nope", {});
    expect(unknown.status).toBe(404);
    const err = await unknown.json();
    expect(err.code).toBe("ATR-310");
    expect(err.fix).toContain("chat.query");
  });

  it("GET → 405 ATR-311（GET 语义留给 live SSE）；mount 前缀分发", async () => {
    const handler = makeRegistry().createHandler({ mount: "/api" });
    const get = await handler(new Request("http://local.test/api/chat.query"));
    expect(get.status).toBe(405);
    expect((await get.json()).code).toBe("ATR-311");
    const ok = await post(handler, "chat.query", { id: 1 }, "/api");
    expect(ok.status).toBe(200);
  });

  it("handler 抛错 → 500 ATR-320（四段式，message 带根因）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("boom", { handler: () => { throw new Error("内部炸了"); } }));
    const res = await post(reg.createHandler(), "boom", {});
    expect(res.status).toBe(500);
    const err = await res.json();
    expect(err.code).toBe("ATR-320");
    expect(err.message).toContain("内部炸了");
  });

  it("command 成功入审计 journal（status=ok，D-F12）；query 不入；环形有界（journalLimit=3）", async () => {
    const reg = makeRegistry();
    const handler = reg.createHandler();
    await post(handler, "chat.query", { id: 1 });
    expect(reg.journal().length).toBe(0);
    await post(handler, "chat.send", { id: 5 });
    await post(handler, "chat.send", { id: 6 });
    expect(reg.journal().length).toBe(2);
    expect(reg.journal()[0]).toMatchObject({ name: "chat.send", kind: "command", input: { id: 5 }, status: "ok" });
    await post(handler, "chat.send", { id: 7 });
    await post(handler, "chat.send", { id: 8 });
    await post(handler, "chat.send", { id: -1 }); // handler 正常返回（done:false）仍算成功调用 → 入账
    expect(reg.journal().length).toBe(3); // 环形截断
    expect(reg.journal().map((e) => e.input)).toEqual([{ id: 6 }, { id: 7 }, { id: 8 }]);
    // 失败 command 亦入账（status=failed + 根因 error）——D-F12 新语义，专项用例在 server-v2.test.ts
  });

  it("无契约端点：对象输入放行、数组输入 → ATR-312（契约纪律不因缺省而敞开）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("free", { handler: (input) => input }));
    const handler = reg.createHandler();
    expect((await post(handler, "free", { any: true })).status).toBe(200);
    const arr = await post(handler, "free", [1, 2]);
    expect(arr.status).toBe(400);
    expect((await arr.json()).code).toBe("ATR-312");
  });
});

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用。Bun 不在场——bun:sqlite 路径
// 无法集成测试（诚实边界见 sqlite.ts 头注），此处只真测 node 路径。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

describeSqlite("sqlite 薄宿主适配（决策 19，FS-3 基座；node 路径实测）", () => {
  let db: SqliteDb;
  it("openSqlite(:memory:) → host=node（本环境无 Bun）", async () => {
    db = await openSqlite(":memory:");
    expect(db.host).toBe("node");
  });

  it("exec 建表 + prepare.run 参数化插入（changes 归一为 number）", async () => {
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    const ins = db.prepare("INSERT INTO items (name) VALUES (?)");
    expect(ins.run("alpha").changes).toBe(1);
    expect(ins.run("beta").lastInsertRowid).toBe(2);
  });

  it("all/get 查询 + 参数绑定（叶子形状 = Record）", () => {
    const byName = db.prepare("SELECT id, name FROM items WHERE name = ?");
    expect(byName.all("alpha")).toEqual([{ id: 1, name: "alpha" }]);
    expect(byName.get("beta")).toEqual({ id: 2, name: "beta" });
    expect(byName.get("gamma")).toBeUndefined();
  });

  it("语句复用 + 唯一约束参数化路径（无字符串拼接逃生门）", () => {
    db.exec("CREATE TABLE tags (tag TEXT PRIMARY KEY)");
    const add = db.prepare("INSERT INTO tags (tag) VALUES (?)");
    add.run("a");
    expect(() => add.run("a")).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM tags").get()!.n).toBe(1);
  });

  it("close 后句柄不可用", async () => {
    const tmp = await openSqlite(":memory:");
    tmp.close();
    expect(() => tmp.exec("SELECT 1")).toThrow();
  });

  it("SqliteUnavailableError 四段式形状（code/fix）", () => {
    const e = new SqliteUnavailableError("测试注入");
    expect(e.code).toBe("ATR-330");
    expect(e.fix).toContain("Node ≥22.5");
    expect(e.fix).toContain("bun:sqlite");
  });
});
