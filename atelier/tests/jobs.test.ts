/**
 * jobs.test.ts — A1 SQLite 极薄队列 + jobs 运行时 + recurring + A4 幂等键（2026-09-28 差距批，
 * 依据 docs/research/2026-09-28-fullstack-feature-gap.md §2-A1/A4 与 FS-DESIGN §5.6 落地）。
 * 覆盖：
 *   全链 enqueue→取出→执行→done（payload round-trip）· 原子取出并发性（双 worker 连接同池不重复投递）
 *   · 优先级/run_at 取出序 · 失败指数退避（attempts/run_at/last_error）· 重试至成功 · 超限 failed + 2KB 截断
 *   · 未注册 type 走失败路径（诚实落账）· recurring 完成即重排 + misfire 追一次不补差
 *   · tx 原子投递（tx 抛错 job 行一并回滚）· stale lock 回收（attempts 保留）· prune
 *   · enqueue/cron 参数非法 ATR-350 · stop 优雅停机 · 轮询自适应（空闲退避至 idleMaxMs + 唤醒）
 *   · A4 kv 三原语 + TTL 惰性过期 + setIfAbsent 竞争 + ATR-351
 *   · ctx.jobs/ctx.kv 端到端（端点内 tx 投递/幂等去重）· 内省 jobs 段两态（有装配/无装配）
 * 风格对齐 server-security.test.ts / migrate.test.ts（node:sqlite 在场探测 + describeSqlite 门 + 真实 SQLite）。
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJobs, JOBS_TABLE_DDL, type JobsHandle, type SqliteDb } from "../server/jobs";
import { openSqlite } from "../server/sqlite";
import { AtrEndpointError, defineCommand, defineQuery, EndpointRegistry } from "../server/endpoints";
import { serverStatusSnapshot } from "../server/introspect";

/* ---------------- node:sqlite 在场探测（Node ≥22.5 内建；与 server-security.test.ts 同口径） ---------------- */
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

/* ---------------- 夹具：真实 SQLite（:memory: 单连接 / 临时文件库跨连接）+ 快轮询旋钮 ---------------- */
const tmpDirs: string[] = [];
const openHandles: JobsHandle[] = [];
const openDbs: SqliteDb[] = [];
afterAll(() => {
  for (const d of openDbs) {
    try {
      d.close();
    } catch {
      /* 重复 close 幂等跳过 */
    }
  }
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});
afterEach(async () => {
  while (openHandles.length > 0) await openHandles.pop()!.stop({ timeoutMs: 2000 });
});

/** 轮询等待 + 截止时间（时序断言纪律：不固定 sleep 等结果——live.test.ts 同款） */
async function waitFor(pred: () => boolean, deadlineMs = 2000, stepMs = 5): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > deadlineMs) throw new Error(`waitFor 截止（${deadlineMs}ms）——条件未满足`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 快轮询旋钮（测试用小值；缺省 50ms/5s 只会让测试变慢，语义同款） */
const POLL = { busyMs: 5, idleMaxMs: 40 };

async function memoryDb(): Promise<SqliteDb> {
  const db = await openSqlite(":memory:");
  openDbs.push(db);
  return db;
}
async function fileDb(): Promise<{ db: SqliteDb; file: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-jobs-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "jobs.db");
  const db = await openSqlite(file);
  openDbs.push(db);
  return { db, file };
}

function jobRow(db: SqliteDb, type: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM atelier_jobs WHERE type = ? ORDER BY id DESC LIMIT 1").get(type);
}
function countByType(db: SqliteDb, type: string): number {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM atelier_jobs WHERE type = ?").get(type)!.n);
}
function atrCode(e: unknown): string {
  return e instanceof AtrEndpointError ? e.atr.code : `（非 AtrEndpointError：${String(e)}）`;
}

/* ================= A1：队列全链 ================= */

describeSqlite("A1 jobs：全链 / 原子取出 / 取出序", () => {
  it("enqueue→取出→执行→done 全链：payload round-trip、attempt=1、done 行落账", async () => {
    const db = await memoryDb();
    const seen: Array<{ type: string; payload: unknown; attempt: number }> = [];
    const h = startJobs({ db, handlers: { "mail.welcome": (job) => { seen.push({ type: job.type, payload: job.payload, attempt: job.attempt }); } }, poll: POLL });
    openHandles.push(h);
    const { id } = h.enqueue({ type: "mail.welcome", payload: { to: "agent@example.com", tags: ["新", 2, { deep: true }] } });
    expect(id).toBeGreaterThan(0);
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual({ type: "mail.welcome", payload: { to: "agent@example.com", tags: ["新", 2, { deep: true }] }, attempt: 1 });
    const row = jobRow(db, "mail.welcome")!;
    expect(row.status).toBe("done");
    expect(Number(row.attempts)).toBe(1);
    expect(row.last_error).toBeNull();
    expect(h.stats().counts).toMatchObject({ done: 1, pending: 0, running: 0, failed: 0 });
  });

  it("原子取出并发性：两 worker 连接并发取同一池——20 个 job 各执行恰好一次，零重复零丢失", async () => {
    const { db, file } = await fileDb();
    const exec = new Map<number, number>();
    const mk = (): Record<string, (job: { payload: unknown }) => void> => ({
      batch: (job) => {
        const n = (job.payload as { n: number }).n;
        exec.set(n, (exec.get(n) ?? 0) + 1);
      },
    });
    const a = startJobs({ db, handlers: mk(), poll: POLL });
    const db2 = await openSqlite(file); // 第二连接（独立句柄同库文件）
    openDbs.push(db2);
    const b = startJobs({ db: db2, handlers: mk(), poll: POLL });
    openHandles.push(a, b);
    for (let i = 0; i < 20; i++) a.enqueue({ type: "batch", payload: { n: i } });
    await waitFor(() => exec.size === 20, 5000);
    await waitFor(() => a.stats().counts.pending === 0 && b.stats().counts.pending === 0, 2000);
    expect([...exec.values()].every((c) => c === 1)).toBe(true); // 零重复（原子取出语义）
    expect(exec.size).toBe(20); // 零丢失
  });

  it("取出序：priority DESC 优先，同级 run_at ASC 先到先执行", async () => {
    const db = await memoryDb();
    const order: string[] = [];
    const h = startJobs({
      db,
      handlers: { hi: () => void order.push("hi"), mid: () => void order.push("mid"), lo: () => void order.push("lo"), late: () => void order.push("late") },
      poll: POLL,
    });
    openHandles.push(h);
    const now = Date.now();
    h.enqueue({ type: "lo", priority: 1 });
    h.enqueue({ type: "hi", priority: 10 });
    h.enqueue({ type: "mid", priority: 5 });
    h.enqueue({ type: "late", runAt: now + 60 }); // 同池更晚到期——即便后投也不插队到同刻任务前
    await waitFor(() => order.length === 4, 3000);
    expect(order).toEqual(["hi", "mid", "lo", "late"]);
  });
});

/* ================= A1：失败退避 / 未注册 type ================= */

describeSqlite("A1 jobs：失败退避 / 重试 / 终态", () => {
  it("失败退避：抛错 → attempts+1、run_at 按退避推进、last_error 落行、状态回 pending", async () => {
    const db = await memoryDb();
    const h = startJobs({
      db,
      handlers: { flaky: () => { throw new Error("boom-1"); } },
      backoffMs: () => 60_000, // 大退避：钉死「run_at 真实被推退」的断言（期间绝不重试）
      poll: POLL,
    });
    openHandles.push(h);
    const t0 = Date.now();
    h.enqueue({ type: "flaky", payload: {} });
    await waitFor(() => {
      const r = jobRow(db, "flaky")!;
      return r != null && Number(r.attempts) === 1 && r.status === "pending";
    });
    const r = jobRow(db, "flaky")!;
    expect(Number(r.run_at)).toBeGreaterThanOrEqual(t0 + 59_000); // 退避推进（60s 级，轮询不会再取）
    expect(String(r.last_error)).toContain("boom-1");
    expect(h.stats().counts.pending).toBe(1);
  });

  it("重试至成功：前两次抛错第三次成功 → done 且 last_error 清除、attempt 递增可见", async () => {
    const db = await memoryDb();
    const attempts: number[] = [];
    const h = startJobs({
      db,
      handlers: {
        flaky: (job) => {
          attempts.push(job.attempt);
          if (job.attempt < 3) throw new Error(`nope-${job.attempt}`);
        },
      },
      backoffMs: () => 5,
      poll: POLL,
    });
    openHandles.push(h);
    h.enqueue({ type: "flaky", payload: {} });
    await waitFor(() => attempts.length === 3);
    expect(attempts).toEqual([1, 2, 3]); // attempt 从 1 起计数
    await waitFor(() => jobRow(db, "flaky")!.status === "done");
    expect(jobRow(db, "flaky")!.last_error).toBeNull(); // 成功清除失败痕迹
  });

  it("超 max_attempts → failed 终态：attempts 封顶、last_error 截断 2KB、不再执行", async () => {
    const db = await memoryDb();
    let execCount = 0;
    const h = startJobs({
      db,
      handlers: { doomed: () => { execCount++; throw new Error("x".repeat(5000)); } },
      backoffMs: () => 5,
      poll: POLL,
    });
    openHandles.push(h);
    h.enqueue({ type: "doomed", payload: {}, maxAttempts: 2 });
    await waitFor(() => jobRow(db, "doomed")!.status === "failed", 3000);
    const r = jobRow(db, "doomed")!;
    expect(Number(r.attempts)).toBe(2); // 封顶即终态
    expect(execCount).toBe(2);
    expect(String(r.last_error)).toHaveLength(2048); // 截断存储（诚实保留可读头部）
    await sleep(60); // 终态行不再被取出（无新增执行）
    expect(execCount).toBe(2);
  });

  it("未注册 type：走失败路径落 last_error（指认未注册 + 可用键表），绝不静默吞行", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, backoffMs: () => 5, poll: POLL });
    openHandles.push(h);
    h.enqueue({ type: "ghost.task", payload: {}, maxAttempts: 1 });
    await waitFor(() => jobRow(db, "ghost.task")!.status === "failed", 3000);
    const err = String(jobRow(db, "ghost.task")!.last_error);
    expect(err).toContain("ghost.task");
    expect(err).toContain("未注册");
  });

  // ---- P2-S2（2026-09-30 第三遍架构复校 §2.1）：handlers 是普通对象字面量，`handlers[row.type]`
  // 走原型链——type:"constructor"/"toString"/"valueOf" 等取到继承可调用对象，`handler == null` 闸
  // 被穿透，调用成功假象 → 任务零执行落 done（假成功），违背同文件「绝不静默吞行」承诺。
  // type 闸（assertJobType）只查长度/控制字符，拦不住这些键。目标：Object.hasOwn 判未注册，
  // 原型链键走既有未注册失败路径。红态：status 落 done（假成功）。----
  it("红（P2-S2）：原型链键 type:\"constructor\" 不得取到继承可调用对象——按未注册失败路径（红态：调用成功假象 → 任务假成功落 done、零执行零报错）", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, backoffMs: () => 5, poll: POLL });
    openHandles.push(h);
    h.enqueue({ type: "constructor", payload: {}, maxAttempts: 1 });
    await waitFor(() => jobRow(db, "constructor")!.status === "failed", 3000);
    const r = jobRow(db, "constructor")!;
    expect(r.status).toBe("failed"); // 红态：done（假成功——Object 构造器被当 handler 调用）
    const err = String(r.last_error);
    expect(err).toContain("constructor");
    expect(err).toContain("未注册");
  });
});

/* ================= A1：recurring 定时任务 ================= */

describeSqlite("A1 jobs：recurring（cron:<name> 行，完成即重排 / misfire 追一次不补差）", () => {
  it("cron 声明 → jobs 行（type=cron:<name>）周期执行：完成即重排、attempts 归零、payload 透传", async () => {
    const db = await memoryDb();
    const payloads: unknown[] = [];
    const h = startJobs({
      db,
      handlers: { "cron:gc": (job) => void payloads.push(job.payload) },
      cron: [{ name: "gc", everyMs: 40, payload: { keep: 5 } }],
      poll: POLL,
    });
    openHandles.push(h);
    await waitFor(() => payloads.length >= 3, 3000); // 周期性多轮
    const r = jobRow(db, "cron:gc")!;
    expect(String(r.type)).toBe("cron:gc");
    expect(Number(r.recurring_every_ms)).toBe(40);
    expect(Number(r.attempts)).toBe(0); // 每轮成功后重置预算
    // 行在两轮之间应为 pending（等待下一次 run_at）——轮询采样直到观察到 pending 形态
    await waitFor(() => jobRow(db, "cron:gc")!.status === "pending");
    expect(payloads[0]).toEqual({ keep: 5 });
  });

  it("misfire 追一次不补差：run_at 被拨到过去（欠 5 个周期）→ 立即补跑一轮，下一次从完成时刻起算", async () => {
    const db = await memoryDb();
    let runs = 0;
    const h = startJobs({
      db,
      handlers: { "cron:gc": () => { runs++; } },
      cron: [{ name: "gc", everyMs: 200, payload: {} }],
      poll: POLL,
    });
    openHandles.push(h);
    await waitFor(() => runs >= 1);
    const t = Date.now();
    db.prepare("UPDATE atelier_jobs SET run_at = ? WHERE type = 'cron:gc'").run(t - 1000); // 欠 ~5 个周期
    const before = runs;
    await waitFor(() => runs === before + 1); // 恰好追一次
    await sleep(150); // < everyMs 窗口：若补差应有 4+ 轮；从 now 续期则静默
    expect(runs).toBe(before + 1);
    const r = jobRow(db, "cron:gc")!;
    expect(r.status).toBe("pending");
    expect(Number(r.run_at)).toBeGreaterThanOrEqual(t); // 从完成时刻起算
    expect(Number(r.run_at)).toBeLessThan(t + 600); // 不是债务叠加（1000ms 欠账不滚入）
  });
});

/* ================= A1：tx 原子投递 / stale lock / prune ================= */

describeSqlite("A1 jobs：tx 原子投递 / stale lock 回收 / prune", () => {
  it("tx 原子投递：ctx.db.tx 内 enqueue 与业务写同事务——tx 抛错则 job 行一并回滚", async () => {
    const db = await memoryDb();
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    const seen: unknown[] = [];
    const h = startJobs({ db, handlers: { "note.notify": (job) => void seen.push(job.payload) }, poll: POLL });
    openHandles.push(h);
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand<{ body: string; boom: boolean }, { id: number }, SqliteDb>("note.add", {
        handler: async (input, ctx) => {
          let id = 0;
          await ctx.db.tx(() => {
            id = Number(ctx.db.prepare("INSERT INTO notes (body) VALUES (?)").run(input.body).lastInsertRowid);
            ctx.jobs!.enqueue({ type: "note.notify", payload: { id } });
            if (input.boom) throw new Error("业务炸点——整体回滚");
          });
          return { id };
        },
      })
    );
    const call = (body: Record<string, unknown>): Promise<Response> =>
      reg.createHandler({ db, jobs: h })(new Request("http://local.test/note.add", { method: "POST", body: JSON.stringify(body) }));
    const ok = await call({ body: "hi", boom: false });
    expect(ok.status).toBe(200);
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual({ id: 1 }); // 提交路径：投递生效且被执行
    const boom = await call({ body: "x", boom: true });
    expect(boom.status).toBe(500); // 业务异常（ATR-320 域）
    expect(countByType(db, "note.notify")).toBe(1); // 失败路径：job 行随 tx 回滚，绝无孤儿投递
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM notes").get()!.n)).toBe(1); // notes 仅剩提交路径那一行（boom 行同证回滚）
  });

  it("stale lock 回收：locked_at 超时的 running 行重置 pending（attempts 保留），续跑至 done", async () => {
    const db = await memoryDb();
    // 前置：模拟「上一进程已建表 + 崩溃遗留 running 行」——表 DDL 先手落（startJobs 的惰性建表幂等）
    db.exec(JOBS_TABLE_DDL);
    const now = Date.now();
    db.prepare(
      "INSERT INTO atelier_jobs (type, queue, payload, status, priority, attempts, max_attempts, run_at, locked_by, locked_at, created_at, updated_at) VALUES (?, 'default', '{}', 'running', 0, 2, 5, ?, 'dead-worker', ?, ?, ?)"
    ).run("stale.report", now, now - 60_000, now, now);
    const seen: number[] = [];
    const h = startJobs({ db, handlers: { "stale.report": (job) => void seen.push(job.attempt) }, lockTimeoutMs: 30_000, poll: POLL });
    openHandles.push(h);
    await waitFor(() => seen.length === 1, 3000);
    expect(seen[0]).toBe(3); // attempts 保留（2）+ claim 自增 → 第 3 次尝试
    expect(jobRow(db, "stale.report")!.status).toBe("done");
  });

  it("prune({ olderThanMs })：清 done/failed 老行、pending 不动、返回清除行数", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: { t: () => {} }, poll: POLL });
    openHandles.push(h);
    h.enqueue({ type: "t", payload: {} });
    await waitFor(() => h.stats().counts.done === 1);
    const now = Date.now();
    // 手工落一行「陈年 failed」与一行「新鲜 pending」
    for (const [type, status, updated] of [["old.failed", "failed", now - 10_000], ["fresh.task", "pending", now]] as const) {
      db.prepare(
        "INSERT INTO atelier_jobs (type, queue, payload, status, priority, attempts, max_attempts, run_at, created_at, updated_at) VALUES (?, 'default', '{}', ?, 0, 0, 5, ?, ?, ?)"
      ).run(type, status, now, now, updated);
    }
    const removed = h.prune({ olderThanMs: 5_000 });
    expect(removed).toBe(1); // 只有陈年 failed 行被清（done 行太新鲜，留待下次）
    expect(countByType(db, "old.failed")).toBe(0);
    expect(countByType(db, "fresh.task")).toBe(1);
    expect(h.stats().counts.done).toBe(1);
  });
});

/* ================= A1：参数校验 ATR-350 / 停机 / 轮询自适应 ================= */

describeSqlite("A1 jobs：ATR-350 参数校验 / stop 优雅停机 / 轮询自适应", () => {
  it("enqueue 参数非法 → ATR-350（type 非法 / payload 不可序列化 / maxAttempts 越界 / cron: 前缀保留 / cron everyMs 非法）", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, poll: POLL });
    openHandles.push(h);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(atrCode(catchOf(() => h.enqueue({ type: "" })))).toBe("ATR-350");
    expect(atrCode(catchOf(() => h.enqueue({ type: "t", payload: circular })))).toBe("ATR-350");
    expect(atrCode(catchOf(() => h.enqueue({ type: "t", payload: () => 1 })))).toBe("ATR-350");
    expect(atrCode(catchOf(() => h.enqueue({ type: "t", maxAttempts: 0 })))).toBe("ATR-350");
    expect(atrCode(catchOf(() => h.enqueue({ type: "cron:fake", payload: {} })))).toBe("ATR-350"); // cron: 前缀为运行时保留
    expect(atrCode(catchOf(() => startJobs({ db, handlers: {}, cron: [{ name: "bad", everyMs: 0 }], poll: POLL })))).toBe("ATR-350");
  });

  it("stop 优雅停机：等在跑 job 收尾（带兜底超时）；幂等；停后投递不再被执行（留 pending 待下次启动）", async () => {
    const db = await memoryDb();
    let started = 0;
    let finished = 0;
    const h = startJobs({
      db,
      handlers: { slow: async () => { started++; await sleep(120); finished++; } },
      poll: POLL,
    });
    openHandles.push(h);
    h.enqueue({ type: "slow", payload: {} });
    await waitFor(() => started === 1);
    const t = Date.now();
    await h.stop({ timeoutMs: 5000 });
    expect(finished).toBe(1); // 在跑 job 收尾才返回
    expect(Date.now() - t).toBeGreaterThanOrEqual(80);
    await expect(h.stop({ timeoutMs: 100 })).resolves.toBeUndefined(); // 幂等
    h.enqueue({ type: "slow", payload: {} }); // 停后投递：行入库、不被执行
    await sleep(80);
    expect(started).toBe(1);
    expect(h.stats().counts.pending).toBe(1);
  });

  it("轮询自适应：空闲指数退避至上限（诊断位可见），enqueue 唤醒后未来 runAt 的 job 照常按时取到", async () => {
    const db = await memoryDb();
    let done = 0;
    const h = startJobs({ db, handlers: { n: () => { done++; } }, poll: { busyMs: 10, idleMaxMs: 80 } });
    openHandles.push(h);
    h.enqueue({ type: "n", payload: {} });
    await waitFor(() => done === 1);
    await waitFor(() => h.currentPollDelay() === 80, 2000); // 空闲退避翻倍至 idleMaxMs 封顶
    h.enqueue({ type: "n", payload: {}, runAt: Date.now() + 120 }); // 到期前投递
    const t = Date.now();
    await waitFor(() => done === 2, 2000);
    expect(Date.now() - t).toBeLessThan(1800); // 唤醒 + 到期即取（不被 5s 空闲上限拖死）
  });
});

/* ================= A4：幂等键 KV（atelier_idempotency 显式原语） ================= */

describeSqlite("A4 幂等键 KV：三原语 / TTL 惰性过期 / setIfAbsent 竞争 / ATR-351", () => {
  it("set/get round-trip（嵌套 JSON）；get 未命中 undefined；set 覆盖 value 且 created_at 保持首次", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, poll: POLL });
    openHandles.push(h);
    expect(h.kv.get("nope")).toBeUndefined();
    h.kv.set("order:1", { status: "paid", items: ["a", "b"], n: 2 });
    expect(h.kv.get("order:1")).toEqual({ status: "paid", items: ["a", "b"], n: 2 });
    const firstCreated = Number(db.prepare("SELECT created_at FROM atelier_idempotency WHERE key = 'order:1'").get()!.created_at);
    h.kv.set("order:1", { status: "refunded" });
    expect(h.kv.get("order:1")).toEqual({ status: "refunded" });
    expect(Number(db.prepare("SELECT created_at FROM atelier_idempotency WHERE key = 'order:1'").get()!.created_at)).toBe(firstCreated);
  });

  it("TTL 过期：get 惰性删行（零后台扫描）；setIfAbsent 对过期键可再占", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, poll: POLL });
    openHandles.push(h);
    h.kv.set("k1", "v1", { ttlMs: 15 });
    expect(h.kv.get("k1")).toBe("v1");
    await sleep(40);
    expect(h.kv.get("k1")).toBeUndefined(); // 过期 = 未命中
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM atelier_idempotency WHERE key = 'k1'").get()!.n)).toBe(0); // 行已惰性清除（零后台扫描）
    h.kv.set("k2", "old", { ttlMs: 15 });
    await sleep(40);
    expect(h.kv.setIfAbsent("k2", "new")).toBe(true); // 过期行让位，可再占
    expect(h.kv.get("k2")).toBe("new");
  });

  it("setIfAbsent 竞争语义：首占 true、再占 false；TTL 不随失败占领刷新", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, poll: POLL });
    openHandles.push(h);
    expect(h.kv.setIfAbsent("lock", "a", { ttlMs: 50 })).toBe(true);
    expect(h.kv.setIfAbsent("lock", "b")).toBe(false); // 已被占
    expect(h.kv.get("lock")).toBe("a"); // 失败占领不覆盖值
    await sleep(70);
    expect(h.kv.setIfAbsent("lock", "c")).toBe(true); // 过期后可占
  });

  it("ATR-351：key 空/非字符串、value 不可 JSON 序列化（函数/循环引用）→ 显式拒绝", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, poll: POLL });
    openHandles.push(h);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(atrCode(catchOf(() => h.kv.set("", "v")))).toBe("ATR-351");
    expect(atrCode(catchOf(() => h.kv.set("k", () => 1)))).toBe("ATR-351");
    expect(atrCode(catchOf(() => h.kv.set("k", circular)))).toBe("ATR-351");
    expect(atrCode(catchOf(() => h.kv.setIfAbsent(42 as unknown as string, "v")))).toBe("ATR-351");
  });
});

/* ================= ctx 集成 + 内省面 ================= */

describeSqlite("ctx 集成（ctx.jobs / ctx.kv）与内省 jobs 段", () => {
  it("ctx.jobs：端点内投递端到端；未装配 = ctx.jobs/ctx.kv undefined（诚实呈现）", async () => {
    const db = await memoryDb();
    const seen: unknown[] = [];
    const h = startJobs({ db, handlers: { "audit.push": (job) => void seen.push(job.payload) }, poll: POLL });
    openHandles.push(h);
    const reg = new EndpointRegistry();
    reg.register(defineQuery("ctx.free", { handler: (_i, ctx) => ({ jobs: ctx.jobs, kv: ctx.kv }) }));
    const bare = await reg.createHandler({ db })(new Request("http://local.test/ctx.free", { method: "POST", body: "{}" }));
    expect(await bare.json()).toEqual({ jobs: undefined, kv: undefined }); // 未装配 = 不存在
    reg.register(
      defineCommand<{ n: number }, { id: number }, SqliteDb>("audit.send", {
        handler: async (input, ctx) => {
          expect(ctx.jobs).toBeDefined();
          let id = 0;
          await ctx.db.tx(() => {
            id = Number(ctx.db.prepare("INSERT INTO atelier_idempotency (key, value, created_at) VALUES (?, ?, ?)").run(`marker:${input.n}`, "{}", Date.now()).lastInsertRowid);
            ctx.jobs!.enqueue({ type: "audit.push", payload: { n: input.n } });
          });
          return { id };
        },
      })
    );
    const res = await reg.createHandler({ db, jobs: h })(new Request("http://local.test/audit.send", { method: "POST", body: JSON.stringify({ n: 7 }) }));
    expect(res.status).toBe(200);
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual({ n: 7 }); // ctx.jobs.enqueue 经 ctx.db 同连接 → 提交后 worker 可见
  });

  it("ctx.kv：端点内 setIfAbsent 幂等去重端到端——同键重放被识别（显式 handler 原语用法）", async () => {
    const db = await memoryDb();
    const h = startJobs({ db, handlers: {}, poll: POLL });
    openHandles.push(h);
    const reg = new EndpointRegistry();
    reg.register(
      defineCommand<{ id: string }, { dup: boolean; ok: boolean }, SqliteDb>("pay.charge", {
        handler: (input, ctx) => {
          if (!ctx.kv!.setIfAbsent(`pay:${input.id}`, { at: Date.now() })) return { dup: true, ok: false };
          return { dup: false, ok: true };
        },
      })
    );
    const call = (id: string): Promise<Response> =>
      reg.createHandler({ db, jobs: h })(new Request("http://local.test/pay.charge", { method: "POST", body: JSON.stringify({ id }) }));
    const first = await call("o-1");
    expect(await first.json()).toEqual({ dup: false, ok: true });
    const replay = await call("o-1");
    expect(await replay.json()).toEqual({ dup: true, ok: false }); // 重放被去重
    const other = await call("o-2");
    expect(await other.json()).toEqual({ dup: false, ok: true }); // 异键不受影响
  });

  it("内省 jobs 段：有装配 = counts + recent（id/type/queue/status/attempts/durMs/ts）；无装配 = 段不出现（零假数据）", async () => {
    const db = await memoryDb();
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.plain", { handler: () => ({ ok: true }) }));
    const h = startJobs({ db, handlers: { "t.done": () => {} }, poll: POLL });
    openHandles.push(h);
    h.enqueue({ type: "t.done", payload: {} });
    await waitFor(() => h.stats().counts.done === 1);
    h.enqueue({ type: "t.pend", payload: {} }); // 无 handler——留 pending 呈现多样性
    const withJobs = serverStatusSnapshot(reg, { db, jobs: h });
    expect(withJobs.jobs).toBeDefined();
    expect(withJobs.jobs!.counts).toMatchObject({ done: 1, pending: 1 });
    const recent = withJobs.jobs!.recent;
    expect(recent.length).toBeGreaterThanOrEqual(2);
    const doneRow = recent.find((r) => r.type === "t.done")!;
    expect(doneRow).toMatchObject({ queue: "default", status: "done", attempts: 1 });
    expect(typeof doneRow.durMs).toBe("number"); // 执行时长（updated_at - locked_at）
    expect(typeof doneRow.ts).toBe("number");
    const withoutJobs = serverStatusSnapshot(reg, { db }); // 未装配：段整体缺省
    expect("jobs" in withoutJobs).toBe(false);
  });
});

/** 同步捕获并返回异常（测试小助手——expect 断言错误码用） */
function catchOf(fn: () => unknown): unknown {
  try {
    fn();
    return new Error("未抛错");
  } catch (e) {
    return e;
  }
}
