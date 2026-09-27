/**
 * dev-review.test.ts — FS-M6 尾件批（D-F16 + §11.2 review 扩展 + §11.3 审计统一时间轴）验收。
 *
 * 四个切面：
 *   A. server/introspect.ts —— server 面保留内省路由的数据层（server-status 快照：端点全表含
 *      契约体/journal/live 订阅/db 段含迁移行）。这是 D-F16 调试页与 dev 面 server-status 的
 *      运行时事实源（MCP endpoint.* 族的既有消费契约见 tests/mcp-endpoint-tools.test.ts）。
 *   B. 保留路由接线 —— registry.createHandler 的 GET <mount>/__atelier/server-status；
 *      prod 旗（__ATELIER_PROD__）下诚实隐身（调试面不进生产 API 面）。
 *   C. dev/dev-review-data.mjs —— 数据归一层：checkpoint 台账（缺台账诚实降级）、audit 尾读、
 *      迁移行归一、三源统一时间轴（command journal + MCP/dev 操作审计 + 迁移审计，ts/name/
 *      principal/duration 字段对齐）、checkpoint 前后 command journal 窗口 diff、锚点×迁移 head 对齐。
 *   D. dev/dev-review-pages.mjs + dev 插件接线 —— /__atelier/endpoints 调试页关键标记、
 *      /__atelier/server-status 代理（未托管时 ok:false 诚实降级）、/__atelier/review-data、
 *      /__atelier/review-ext.js（review 扩展脚本），token 门与 review 页扩展挂点。
 *
 * 纪律（§14.2）：先红后绿——A/B/C/D 的被测模块先于实现落盘跑红（import 失败/断言红），
 * 实现后跑绿（证据见提交说明）。临时产物一律 mkdtemp + afterAll 清理；插件测试 chdir 进
 * tmp 根（工厂把 dev-token 写进 ROOT/.atelier），绝不污染仓库工作树。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- fixtures ---------------- */

const CHAT_CONTRACT = { type: "object", reqProps: { msg: { type: "string", min: 1 } }, optProps: {} };
const CHAT_OUTPUT = { type: "object", reqProps: { echo: { type: "string" } }, optProps: {} };
const ITEM_CONTRACT = { type: "object", reqProps: { title: { type: "string", min: 1 } }, optProps: {} };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-m6-review-"));

/** 迁移目录 fixture：001/002 已应用（与库内状态表一致）+ 003 待应用 */
const MIG_DIR = path.join(TMP, "migrations");
fs.mkdirSync(MIG_DIR, { recursive: true });
fs.writeFileSync(path.join(MIG_DIR, "001_init.up.sql"), "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n");
fs.writeFileSync(path.join(MIG_DIR, "001_init.down.sql"), "DROP TABLE IF EXISTS items;\n");
fs.writeFileSync(path.join(MIG_DIR, "002_add_idx.up.sql"), "CREATE INDEX IF NOT EXISTS items_title_idx ON items (title);\n");
fs.writeFileSync(path.join(MIG_DIR, "002_add_idx.down.sql"), "DROP INDEX IF EXISTS items_title_idx;\n");
fs.writeFileSync(path.join(MIG_DIR, "003_pending.up.sql"), "CREATE TABLE logs (id INTEGER PRIMARY KEY);\n");
fs.writeFileSync(path.join(MIG_DIR, "003_pending.down.sql"), "DROP TABLE IF EXISTS logs;\n");

/* ---------------- A. server/introspect.ts ---------------- */

describe("server/introspect · serverStatusSnapshot（§10.3 数据源）", () => {
  it("端点全表带契约体 + journal + live 订阅位", async () => {
    const { EndpointRegistry, defineQuery, defineCommand, AtrEndpointError, endpointError } = await import("../server/endpoints.ts");
    const { serverStatusSnapshot } = await import("../server/introspect.ts");

    const registry = new EndpointRegistry();
    registry.register(
      defineQuery("chat.ask", {
        contract: CHAT_CONTRACT,
        output: CHAT_OUTPUT,
        live: true,
        timeoutMs: 5000,
        handler: async (input: { msg: string }) => ({ echo: input.msg }),
      }),
    );
    registry.register(
      defineCommand("items.create", {
        contract: ITEM_CONTRACT,
        emits: ["table:items"],
        idempotent: true,
        auth: { type: "session", role: "editor" },
        handler: async () => ({ ok: true }),
      }),
    );
    registry.register(
      defineCommand("boom", {
        handler: () => {
          throw new AtrEndpointError(endpointError("ATR-999", "炸了", "修 handler"));
        },
      }),
    );
    // auth 读取器装配（items.create 声明了 auth——不装配会在 handler 前被 ATR-340 拦下，journal
    // 依语义不记账（"分发穿过 handler 之后"），failed 样例就只剩 boom 一条）
    const handler = registry.createHandler({ mount: "/api", auth: () => ({ type: "session", principal: "u1", role: "editor" }) });
    await handler(new Request("http://x/api/items.create", { method: "POST", body: JSON.stringify({ title: "a" }) }));
    await handler(new Request("http://x/api/boom", { method: "POST", body: JSON.stringify({}) }));

    const snap = serverStatusSnapshot(registry, { mount: "/api", migrationsDir: MIG_DIR });
    expect(snap.ok).toBe(true);
    const chat = snap.endpoints.find((e: any) => e.name === "chat.ask");
    expect(chat).toMatchObject({
      kind: "query", live: true, timeoutMs: 5000, invalidateKeys: ["key:chat.ask"],
      contract: CHAT_CONTRACT, output: CHAT_OUTPUT, // 契约体在快照里（调试页/endpoint.contract 的数据源）
    });
    const create = snap.endpoints.find((e: any) => e.name === "items.create");
    expect(create).toMatchObject({ kind: "command", idempotent: true, authType: "session", authRole: "editor", emits: ["table:items"] });
    expect(snap.journal.length).toBe(2);
    expect(snap.journal.map((j: any) => j.status).sort()).toEqual(["failed", "ok"]);
    expect(snap.live).toEqual({ subscriberCount: 0, endpoints: ["chat.ask"] });
    expect(snap.server).toMatchObject({ mount: "/api" });
    expect(typeof snap.server.startedAt).toBe("string");
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it("db 段：表内省（PRAGMA）+ 迁移行（head/applied/pending/rows）", async () => {
    const { EndpointRegistry } = await import("../server/endpoints.ts");
    const { serverStatusSnapshot } = await import("../server/introspect.ts");
    const { openSqlite } = await import("../server/sqlite.ts");
    const { MIGRATIONS_TABLE_DDL } = await import("../server/migrate.ts");

    const db = await openSqlite(":memory:");
    db.exec(MIGRATIONS_TABLE_DDL);
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL)");
    db.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at, down_verified) VALUES (?, ?, ?, 0)").run("001_init", "c1", 1727000000000);
    db.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at, down_verified) VALUES (?, ?, ?, 0)").run("002_add_idx", "c2", 1727000100000);

    const registry = new EndpointRegistry();
    const snap = serverStatusSnapshot(registry, { db, migrationsDir: MIG_DIR });
    const tables = snap.db.tables.map((t: any) => t.name);
    expect(tables).toContain("items");
    const items = snap.db.tables.find((t: any) => t.name === "items");
    expect(items.columns).toEqual([
      { name: "id", type: "INTEGER", notNull: false, pk: true },
      { name: "title", type: "TEXT", notNull: true, pk: false },
    ]);
    const mig = snap.db.migrations;
    expect(mig.head).toEqual({ id: 2, name: "002_add_idx" });
    expect(mig.applied).toEqual(["001_init", "002_add_idx"]);
    expect(mig.pending).toEqual(["003_pending"]);
    expect(mig.rows).toHaveLength(2);
    expect(mig.rows[0]).toMatchObject({ id: 1, name: "001_init", appliedAt: 1727000000000, downVerified: false });
    db.close();
  });

  it("db.migrations.journal：server-status 携迁移 journal 尾（决策 21 台账预留位关闭——down 历史出口）", async () => {
    const { EndpointRegistry } = await import("../server/endpoints.ts");
    const { serverStatusSnapshot } = await import("../server/introspect.ts");
    const { openSqlite } = await import("../server/sqlite.ts");
    const { MIGRATIONS_TABLE_DDL, MIGRATION_JOURNAL_DDL } = await import("../server/migrate.ts");

    const db = await openSqlite(":memory:");
    db.exec(MIGRATIONS_TABLE_DDL);
    db.exec(MIGRATION_JOURNAL_DDL);
    db.prepare("INSERT INTO atelier_migration_journal (ts, name, action, status, principal, dur_ms, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)").run(1727000000000, "001_init", "up", "ok", "cli", 3, "c1");
    db.prepare("INSERT INTO atelier_migration_journal (ts, name, action, status, principal, dur_ms, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)").run(1727000050000, "001_init", "down", "ok", "cli", 2, "c1");

    const registry = new EndpointRegistry();
    const mig: any = serverStatusSnapshot(registry, { db, migrationsDir: MIG_DIR }).db.migrations;
    expect(mig.journal.ok).toBe(true);
    expect(mig.journal.rows).toHaveLength(2);
    expect(mig.journal.rows[1]).toMatchObject({ id: 2, ts: 1727000050000, name: "001_init", action: "down", status: "ok", principal: "cli", durMs: 2, checksum: "c1" });
    // 旧库（journal 表不存在）→ ok:false 诚实降级，不假数据
    db.exec("DROP TABLE atelier_migration_journal");
    const mig2: any = serverStatusSnapshot(registry, { db, migrationsDir: MIG_DIR }).db.migrations;
    expect(mig2.journal.ok).toBe(false);
    expect(mig2.journal.rows).toEqual([]);
    expect(String(mig2.journal.note)).toContain("journal");
    db.close();
  });

  it("无 db：db=null + 诚实 note（不假数据）", async () => {
    const { EndpointRegistry } = await import("../server/endpoints.ts");
    const { serverStatusSnapshot } = await import("../server/introspect.ts");
    const snap = serverStatusSnapshot(new EndpointRegistry(), {});
    expect(snap.db).toBeNull();
    expect(String(snap.dbNote)).toContain("db");
  });
});

/* ---------------- B. 保留路由接线 ---------------- */

describe("server 保留路由 GET <mount>/__atelier/server-status", () => {
  it("mount 内外都能命中；prod 旗下隐身（落回既有 ATR 路径）", async () => {
    const { EndpointRegistry, defineQuery } = await import("../server/endpoints.ts");
    const registry = new EndpointRegistry();
    registry.register(defineQuery("ping", { handler: () => ({ pong: true }) }));
    const handler = registry.createHandler({ mount: "/api" });

    const r1 = await handler(new Request("http://x/api/__atelier/server-status"));
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.ok).toBe(true);
    expect(j1.endpoints.map((e: any) => e.name)).toContain("ping");

    const bare = registry.createHandler({});
    const r2 = await bare(new Request("http://x/__atelier/server-status"));
    expect(r2.status).toBe(200);

    const g = globalThis as { __ATELIER_PROD__?: boolean };
    g.__ATELIER_PROD__ = true;
    try {
      const r3 = await handler(new Request("http://x/api/__atelier/server-status"));
      expect(r3.status).toBe(405); // prod：调试面隐身，落回"端点只接受 POST"既有路径
      const j3 = await r3.json();
      expect(j3.code).toBe("ATR-311");
    } finally {
      g.__ATELIER_PROD__ = false;
    }
  });
});

/* ---------------- C. dev/dev-review-data.mjs（数据归一层） ---------------- */

describe("dev-review-data · 台账/审计/迁移读取与降级", () => {
  it("台账缺失 → ok:false + 诚实 note，不假数据", async () => {
    const { readCheckpointLedger } = await import("../dev/dev-review-data.mjs");
    const empty = path.join(TMP, "no-ledger-root");
    fs.mkdirSync(empty, { recursive: true });
    const r = readCheckpointLedger(empty);
    expect(r.ok).toBe(false);
    expect(String(r.note)).toContain("checkpoint");
    expect(r.rows).toEqual([]);
  });

  it("台账读取：save（含/缺 migrationHead）与 rollback 行原样解析", async () => {
    const { readCheckpointLedger } = await import("../dev/dev-review-data.mjs");
    const root = path.join(TMP, "ledger-root");
    fs.mkdirSync(path.join(root, ".atelier"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".atelier", "checkpoints.jsonl"),
      [
        JSON.stringify({ type: "save", id: "a123456", sha: "a1234567890", name: "第一轮", at: "2026-09-22T01:00:00.000Z", migrationHead: { id: 1, name: "001_init" } }),
        JSON.stringify({ type: "save", id: "b234567", sha: "b2345678901", name: "第二轮（无库锚定）", at: "2026-09-22T02:00:00.000Z" }),
        JSON.stringify({ type: "rollback", id: "rb-a1234", target: "a123456", backup: "atelier-backup-x", at: "2026-09-22T03:00:00.000Z" }),
        "not-json-line", // 坏行跳过不炸
      ].join("\n"),
    );
    const r = readCheckpointLedger(root);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].migrationHead).toEqual({ id: 1, name: "001_init" });
    expect(r.rows[2].type).toBe("rollback");
  });

  it("audit 尾读：复用既有 audit.jsonl 数据面（不重建库）", async () => {
    const { readAuditTail } = await import("../dev/dev-review-data.mjs");
    const root = path.join(TMP, "ledger-root");
    fs.writeFileSync(
      path.join(root, ".atelier", "audit.jsonl"),
      [
        JSON.stringify({ kind: "access", at: "2026-09-22T01:05:00.000Z", detail: { method: "POST", url: "/__atelier/bridge/enqueue", agent: "tooling" } }),
        JSON.stringify({ kind: "command.ack", at: "2026-09-22T01:05:01.000Z", detail: { id: "cmd-1", ok: false } }),
      ].join("\n"),
    );
    const r = readAuditTail(root, 10);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    const missing = readAuditTail(path.join(TMP, "no-ledger-root"), 10);
    expect(missing.ok).toBe(true);
    expect(missing.rows).toEqual([]);
  });
});

describe("dev-review-data · 三源归一（§11.3 ts/name/principal/duration 字段对齐）", () => {
  it("command journal 归一：source=command，status/principal/durMs 直传", async () => {
    const { normalizeJournal } = await import("../dev/dev-review-data.mjs");
    const rows = normalizeJournal([
      { ts: "2026-09-22T01:00:00.000Z", name: "items.create", kind: "command", input: { title: "a" }, status: "ok", principal: "u1", durMs: 3 },
      { ts: "2026-09-22T01:00:01.000Z", name: "boom", kind: "command", input: {}, status: "failed", principal: null, durMs: 1, error: { code: "ATR-320", message: "炸了" } },
    ]);
    expect(rows[0]).toMatchObject({ ts: "2026-09-22T01:00:00.000Z", source: "command", name: "items.create", status: "ok", principal: "u1", durMs: 3 });
    expect(rows[1].source).toBe("command");
    expect(String(rows[1].detail)).toContain("ATR-320");
  });

  it("迁移审计归一：applied_at(ms) → ISO ts；principal/durMs 诚实为 null", async () => {
    const { normalizeMigrations } = await import("../dev/dev-review-data.mjs");
    const rows = normalizeMigrations([{ id: 1, name: "001_init", checksum: "c1", appliedAt: 1727000000000, downVerified: false }]);
    expect(rows[0]).toMatchObject({ ts: "2024-09-22T10:13:20.000Z", source: "migration", name: "001_init", status: "applied", principal: null, durMs: null });
  });

  it("dev 审计归一：kind → name，agent → principal，ack 失败 → failed", async () => {
    const { normalizeAudit } = await import("../dev/dev-review-data.mjs");
    const rows = normalizeAudit([
      { kind: "access", at: "2026-09-22T01:05:00.000Z", detail: { agent: "tooling" } },
      { kind: "command.ack", at: "2026-09-22T01:05:01.000Z", detail: { id: "cmd-1", ok: false } },
    ]);
    expect(rows[0]).toMatchObject({ source: "audit", name: "access", principal: "tooling", status: "info", durMs: null });
    expect(rows[1].status).toBe("failed");
  });

  it("mergeTimeline：三源归并降序 + 来源标签保留", async () => {
    const { mergeTimeline } = await import("../dev/dev-review-data.mjs");
    const merged = mergeTimeline([
      [{ ts: "2026-09-22T01:00:00.000Z", source: "command", name: "a", status: "ok", principal: null, durMs: 1, detail: "" }],
      [{ ts: "2026-09-22T03:00:00.000Z", source: "audit", name: "access", status: "info", principal: null, durMs: null, detail: "" }],
      [{ ts: "2026-09-22T02:00:00.000Z", source: "migration", name: "001_init", status: "applied", principal: null, durMs: null, detail: "" }],
    ]);
    expect(merged.map((r: any) => r.source)).toEqual(["audit", "migration", "command"]);
  });

  it("endpointWindows：checkpoint 前后 command journal 窗口对比（§11.2）", async () => {
    const { endpointWindows } = await import("../dev/dev-review-data.mjs");
    const journal = [
      { ts: "2026-09-22T01:00:00.000Z", name: "items.create", kind: "command", status: "ok", principal: null, durMs: 2 },
      { ts: "2026-09-22T02:00:00.000Z", name: "items.create", kind: "command", status: "failed", principal: null, durMs: 4 },
      { ts: "2026-09-22T03:00:00.000Z", name: "boom", kind: "command", status: "ok", principal: null, durMs: 1 },
    ];
    const w = endpointWindows(journal, "2026-09-22T02:30:00.000Z", "2026-09-22T01:30:00.000Z");
    expect(w.before.map((r: any) => r.name)).toEqual(["items.create"]);
    expect(w.before[0].status).toBe("failed");
    expect(w.since.map((r: any) => r.name)).toEqual(["boom"]);
    expect(w.summary.before).toMatchObject({ calls: 1, ok: 0, failed: 1, durMs: 4 });
    expect(w.summary.since).toMatchObject({ calls: 1, ok: 1, failed: 0, durMs: 1 });
    // 无前锚：before = 全部 <= anchor
    const w2 = endpointWindows(journal, "2026-09-22T02:30:00.000Z", null);
    expect(w2.before).toHaveLength(2);
  });

  it("锚点×迁移 head 对齐：behind/equal/unknown 三态（决策 21-③ 口径）", async () => {
    const { alignCheckpointsMigrations } = await import("../dev/dev-review-data.mjs");
    const rows = [
      { type: "save", id: "a123456", name: "r1", at: "2026-09-22T01:00:00.000Z", migrationHead: { id: 1, name: "001_init" } },
      { type: "save", id: "b234567", name: "r2", at: "2026-09-22T02:00:00.000Z", migrationHead: { id: 2, name: "002_add_idx" } },
      { type: "save", id: "c345678", name: "r3", at: "2026-09-22T03:00:00.000Z" },
    ];
    const aligned = alignCheckpointsMigrations(rows, { id: 2, name: "002_add_idx" });
    expect(aligned[0].relation).toBe("behind"); // rollback 会被 21-③ 拒绝的锚
    expect(aligned[1].relation).toBe("equal");
    expect(aligned[2].relation).toBe("unknown");
  });

  it("buildReviewData：三源聚合 + anchor 窗口 diff + 优雅降级", async () => {
    const { buildReviewData } = await import("../dev/dev-review-data.mjs");
    const root = path.join(TMP, "ledger-root");
    const serverStatus = {
      ok: true,
      journal: [{ ts: "2026-09-22T02:10:00.000Z", name: "items.create", kind: "command", status: "ok", principal: "u1", durMs: 5 }],
      db: { migrations: { head: { id: 1, name: "001_init" }, rows: [{ id: 1, name: "001_init", appliedAt: 1727000000000, downVerified: false }] } },
    };
    const full = buildReviewData({ root, serverStatus, anchorId: "b234567" });
    expect(full.ok).toBe(true);
    expect(full.checkpoints.ok).toBe(true);
    expect(full.migrations.ok).toBe(true);
    expect(full.migrations.source).toBe("server-status");
    expect(full.journal.ok).toBe(true);
    expect(full.audit.ok).toBe(true);
    expect(full.timeline.length).toBeGreaterThan(0);
    // 降序
    for (let i = 1; i < full.timeline.length; i++) expect(full.timeline[i - 1].ts >= full.timeline[i].ts).toBe(true);
    expect(full.diff).toBeTruthy();
    expect(full.diff.anchor).toBe("b234567");
    expect(full.diff.since.some((r: any) => r.name === "items.create")).toBe(true);

    // server 面不在：journal/migrations 降级 + note（台账仍在——本地态）
    const degraded = buildReviewData({ root, serverStatus: null, anchorId: null });
    expect(degraded.ok).toBe(true);
    expect(degraded.journal.ok).toBe(false);
    expect(String(degraded.journal.note)).toContain("server");
    // 无台账根：checkpoints 降级
    const bare = buildReviewData({ root: path.join(TMP, "no-ledger-root"), serverStatus: null, anchorId: null });
    expect(bare.checkpoints.ok).toBe(false);
    expect(bare.timeline).toEqual([]);
  });
});

describe("dev-review-data · 迁移 journal（down 历史）消费与降级（决策 21 台账预留位关闭）", () => {
  it("readMigrationsSqlite 顺携 journal：有表 → 行读出；旧库无表 → journal 段 ok:false + note 不假数据", async () => {
    const { openSqlite } = await import("../server/sqlite.ts");
    const { MIGRATIONS_TABLE_DDL, MIGRATION_JOURNAL_DDL } = await import("../server/migrate.ts");
    const { readMigrationsSqlite } = await import("../dev/dev-review-data.mjs");
    const root = path.join(TMP, "journal-root");
    fs.mkdirSync(path.join(root, ".atelier"), { recursive: true });
    const db = await openSqlite(path.join(root, ".atelier", "dev.db"));
    db.exec(MIGRATIONS_TABLE_DDL);
    db.exec(MIGRATION_JOURNAL_DDL);
    db.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at, down_verified) VALUES (?, ?, ?, 0)").run("001_init", "c1", 1727000000000);
    db.prepare("INSERT INTO atelier_migration_journal (ts, name, action, status, principal, dur_ms, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)").run(1727000000000, "001_init", "up", "ok", "cli", 3, "c1");
    db.prepare("INSERT INTO atelier_migration_journal (ts, name, action, status, principal, dur_ms, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)").run(1727000050000, "001_init", "down", "ok", "cli", 2, "c1");
    db.close();
    const r: any = await readMigrationsSqlite(root, path.join(".atelier", "dev.db"));
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.journal.ok).toBe(true);
    expect(r.journal.rows.map((x: any) => [x.action, x.status])).toEqual([["up", "ok"], ["down", "ok"]]);
    expect(r.journal.rows[1]).toMatchObject({ name: "001_init", action: "down", principal: "cli", durMs: 2 });

    // 旧库：只有状态表（journal 时代之前）→ 迁移段 ok:true 照旧，journal 段诚实降级
    const oldRoot = path.join(TMP, "old-journal-root");
    fs.mkdirSync(path.join(oldRoot, ".atelier"), { recursive: true });
    const odb = await openSqlite(path.join(oldRoot, ".atelier", "dev.db"));
    odb.exec(MIGRATIONS_TABLE_DDL);
    odb.prepare("INSERT INTO atelier_migrations (name, checksum, applied_at, down_verified) VALUES (?, ?, ?, 0)").run("001_init", "c1", 1727000000000);
    odb.close();
    const r2: any = await readMigrationsSqlite(oldRoot, path.join(".atelier", "dev.db"));
    expect(r2.ok).toBe(true); // 状态表面不因 journal 缺席退化
    expect(r2.journal.ok).toBe(false);
    expect(r2.journal.rows).toEqual([]);
    expect(String(r2.journal.note)).toContain("journal");
  });

  it("normalizeMigrationJournal：source=migration + action 标注；down ok → rolled-back；failed 原样", async () => {
    const { normalizeMigrationJournal } = await import("../dev/dev-review-data.mjs");
    const rows = normalizeMigrationJournal([
      { id: 1, ts: 1727000000000, name: "001_init", action: "up", status: "ok", principal: "cli", durMs: 3, checksum: "c1" },
      { id: 2, ts: 1727000050000, name: "001_init", action: "down", status: "ok", principal: "cli", durMs: 2, checksum: "c1" },
      { id: 3, ts: 1727000100000, name: "002_broken", action: "up", status: "failed", principal: "cli", durMs: 1, checksum: "c2" },
    ]);
    expect(rows[0]).toMatchObject({ ts: "2024-09-22T10:13:20.000Z", source: "migration", action: "up", name: "001_init", status: "applied", principal: "cli", durMs: 3 });
    expect(rows[1]).toMatchObject({ source: "migration", action: "down", name: "001_init", status: "rolled-back" });
    expect(rows[2]).toMatchObject({ source: "migration", action: "up", name: "002_broken", status: "failed" });
  });

  it("buildReviewData：时间轴补 down/failed 行（up ok 不与状态表重复）；journal 段全量随载荷", async () => {
    const { buildReviewData } = await import("../dev/dev-review-data.mjs");
    const root = path.join(TMP, "ledger-root");
    const serverStatus = {
      ok: true,
      journal: [],
      db: {
        migrations: {
          head: { id: 1, name: "001_init" },
          rows: [{ id: 1, name: "001_init", appliedAt: 1727000000000, downVerified: false }],
          journal: {
            ok: true,
            rows: [
              { id: 1, ts: 1726999999000, name: "001_init", action: "up", status: "ok", principal: "cli", durMs: 3, checksum: "c1" },
              { id: 2, ts: 1727000050000, name: "001_init", action: "down", status: "ok", principal: "cli", durMs: 2, checksum: "c1" },
              { id: 3, ts: 1727000100000, name: "002_broken", action: "up", status: "failed", principal: "cli", durMs: 1, checksum: "c2" },
            ],
            note: null,
          },
        },
      },
    };
    const full: any = buildReviewData({ root, serverStatus, anchorId: null });
    expect(full.migrations.journal.ok).toBe(true);
    expect(full.migrations.journal.rows).toHaveLength(3); // journal 段全量在案（up ok 也可查）
    const migTimeline = full.timeline.filter((r: any) => r.source === "migration");
    expect(migTimeline.filter((r: any) => r.action === "down" && r.status === "rolled-back")).toHaveLength(1); // down 行补入
    expect(migTimeline.filter((r: any) => r.action === "up" && r.status === "failed")).toHaveLength(1); // 失败行补入（§3.5 同纪律）
    expect(migTimeline.filter((r: any) => r.action === "up" && r.status === "applied")).toHaveLength(1); // up ok 只来自状态表，不重复计一条事件
    for (let i = 1; i < full.timeline.length; i++) expect(full.timeline[i - 1].ts >= full.timeline[i].ts).toBe(true); // 仍整体降序
  });

  it("降级：server-status 未携带 journal（旧 server 面）→ journal 段 ok:false + note，时间轴零假数据", async () => {
    const { buildReviewData } = await import("../dev/dev-review-data.mjs");
    const root = path.join(TMP, "no-ledger-root");
    const serverStatus = { ok: true, journal: [], db: { migrations: { head: null, rows: [], pending: [] } } };
    const d: any = buildReviewData({ root, serverStatus, anchorId: null });
    expect(d.migrations.journal.ok).toBe(false);
    expect(d.migrations.journal.rows).toEqual([]);
    expect(String(d.migrations.journal.note)).toContain("journal");
    expect(d.timeline.filter((r: any) => r.source === "migration")).toEqual([]);
  });
});

/* ---------------- D. 页面与插件接线 ---------------- */

describe("dev-review-pages · 页面关键标记（可断言的 HTML/JS）", () => {
  it("endpointsPageHtml：端点表 + try-it + schema 展示标记齐全（token 不内嵌——P1-12）", async () => {
    const { endpointsPageHtml } = await import("../dev/dev-review-pages.mjs");
    const html = endpointsPageHtml();
    expect(html).toContain("/__atelier/server-status");
    expect(html).toContain("endpoint-table");
    expect(html).toContain("try-input");
    expect(html).toContain("schema-detail"); // 契约/schema 展示挂点
    expect(html).not.toContain("tok-123"); // P1-12 ②：页面不再内嵌 token（fetch 靠同源 cookie）
    expect(html).toContain("POST"); // try-it 走 POST（query/command 同走 POST——契约校验要求 JSON 体）
  });

  it("reviewExtScript：迁移时间轴 / checkpoint 对齐 / 统一时间轴 / review-data 消费（token 不内嵌）", async () => {
    const { reviewExtScript } = await import("../dev/dev-review-pages.mjs");
    const js = reviewExtScript();
    expect(js).toContain("/__atelier/review-data");
    expect(js).toContain("migration-timeline");
    expect(js).toContain("unified-timeline");
    expect(js).toContain("checkpoint");
    expect(js).not.toContain("tok-123"); // P1-12 ②：脚本不再内嵌 token
  });
});

describe("dev 插件接线（token 门 + 路由注册 + 降级）", () => {
  let handlers: ((req: any, res: any, next: () => void) => Promise<void> | void)[] = [];
  let token = "";
  const prevCwd = process.cwd();

  function mockRes() {
    const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: null as unknown, ended: false };
    res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
    res.end = (b?: unknown) => { res.body = b; res.ended = true; };
    res.write = () => {};
    res.writeHead = (code: number) => { res.statusCode = code; };
    return res;
  }
  async function call(url: string, init?: { method?: string; headers?: Record<string, string> }) {
    const req: any = { url, method: init?.method ?? "GET", headers: init?.headers ?? {}, on() {}, pipe() {} };
    const res = mockRes();
    let nexted = false;
    for (const h of handlers) {
      nexted = false;
      await h(req, res, () => { nexted = true; });
      if (!nexted) return res;
    }
    return res;
  }

  beforeAll(async () => {
    process.chdir(TMP); // 插件工厂以 process.cwd() 为 ROOT——chdir 进 tmp，dev-token 落 tmp
    const { atelierDevPlugin } = await import("../dev/atelier-dev-plugin.mjs");
    const captured: unknown[] = [];
    const fakeServer: any = {
      middlewares: { use: (fn: unknown) => captured.push(fn) },
      config: { server: { port: 5173 } },
    };
    atelierDevPlugin().configureServer?.(fakeServer);
    handlers = captured as typeof handlers;
    token = fs.readFileSync(path.join(TMP, ".atelier", "dev-token"), "utf8").trim();
  });

  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("token 门：无 token → 401 ATR-402", async () => {
    const res = await call("/__atelier/server-status");
    expect(res.statusCode).toBe(401);
    expect(String(res.body)).toContain("ATR-402");
  });

  it("server-status：server 面未托管 → ok:false 诚实降级（不假数据）", async () => {
    const res = await call("/__atelier/server-status", { headers: { "x-atelier-token": token } });
    expect(res.statusCode).toBe(200);
    const j = JSON.parse(String(res.body));
    expect(j.ok).toBe(false);
    expect(String(j.note)).toContain("server");
  });

  it("/__atelier/endpoints：text/html 调试页", async () => {
    const res = await call("/__atelier/endpoints", { headers: { "x-atelier-token": token } });
    expect(res.headers["content-type"]).toContain("text/html");
    expect(String(res.body)).toContain("endpoint-table");
  });

  it("/__atelier/review-data：空根降级齐全（checkpoints/journal note，timeline 空）", async () => {
    const res = await call("/__atelier/review-data", { headers: { "x-atelier-token": token } });
    const j = JSON.parse(String(res.body));
    expect(j.ok).toBe(true);
    expect(j.checkpoints.ok).toBe(false);
    expect(j.timeline).toEqual([]);
  });

  it("/__atelier/review-ext.js：JS 内容 + review 页挂点", async () => {
    const res = await call(`/__atelier/review-ext.js?token=${token}`);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(String(res.body)).toContain("review-data");
    const page = await call("/__atelier/review", { headers: { "x-atelier-token": token } });
    expect(String(page.body)).toContain("review-ext.js");
  });
});
