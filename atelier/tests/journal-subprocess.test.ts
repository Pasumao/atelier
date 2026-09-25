/**
 * journal-subprocess.test.ts — FS-M4/M7 golden 挂账第二枚关闭：「journal 子进程内省」（2026-09-25）。
 *
 * 挂账原文（FS-DESIGN §13/§14.2）：golden 不覆盖 auth 端点联测 / journal 子进程内省 / bun 宿主桥。
 * auth 联测已在 M7 关闭（openapi-golden.test.ts auth 段），本文件关闭第二枚——用**真实 spawn 的
 * server 子进程**端到端验证「command journal + 迁移 journal 经内省路由可查」。为什么进程内测试
 * 钉不住这件事：server-v2.test.ts 断言的是同进程 registry.journal()，dev 面 server-status 是父进程
 * 代理——journal/端点注册表都活在 server 子进程内（introspect.ts 头注：内省路由是它们唯一的出口），
 * 「子进程内入的账经 GET <mount>/__atelier/server-status 真拿得到」只有这条端到端链能证明。这是
 * 可验证性基建（审计半边）的证据链闭环。
 *
 * 全链（openapi-golden 纯文件组装先例，无 pnpm install——server 子进程只吃 .ts 直跑与 vendor
 * 相对导入）：init --no-ai（vendor 布局）→ 夹具契约/端点/schema 落盘 → gen db（tables/crud +
 * NNN_<table> 迁移对）→ migrate up --db <共享库路径>（宿主 CLI 跑——最稳：库路径宿主/子进程共享，
 * CLI 收尾连接关闭后子进程才 openSqlite 同一文件，无跨进程写竞争）→ spawn 夹具启动壳（vendor
 * index 的 serve() 即 D-F14 启动壳单源，port 0 + ATELIER_SERVER_READY 握手行；cwd = 夹具根——
 * createHandler 不透传 migrationsDir，introspect 缺省从 process.cwd() 解析 <root>/src/server/db/
 * migrations，与 dev 托管 spawn cwd=应用根同约定）。
 *
 * 断言面（全部以代码实读为准）：
 *   ① command 成功入账（D-F12）：POST journal.put 200 → 快照 journal 尾部含 status=ok 条目，
 *      字段形状按 introspect 实际输出钉（ts/name/kind/input/status/principal/durMs + notes 非空才携带）；
 *      无 auth 装配 → principal 如实 null（auth 联测归 openapi-golden M7 段；非 null principal
 *      由迁移 journal 的 "cli" 半边钉住——见③）；
 *   ② 失败入账语义（endpoints.ts 实读，非挂账原文猜测）：handler 抛错 → 500 ATR-320 + journal
 *      failed 条目（error.code=ATR-320，error/message 随行）；两条**不入账**负例同钉——契约违规
 *      ATR-201（分发未穿 handler，先于 journalPush 返回）与 query 端点（journal 语义 = command
 *      入账），快照里断言条目缺席；
 *   ③ 迁移 journal 段（M7-B）：快照 db.migrations.journal 携 atelier_migration_journal 尾部——
 *      up ok 行 + principal=cli（migrate CLI 缺省主体；spawn env 显式清掉 ATELIER_PRINCIPAL 防
 *      宿主环境翻账）+ head/applied/pending/tables 读侧快照段；
 *   ④ prod 旗标隐身负例：`__ATELIER_PROD__` 是 globalThis 旗、无 env 契约（endpoints.ts isProd
 *      同款读法，prod-strip.test.ts 同机制）——夹具启动壳侧置位重启子进程后，GET server-status
 *      **不是 404/空数据，而是落回非 POST 分支 405 ATR-311**（endpoints.ts 分发器顺序：prod 旗下
 *      introspectResponse 返 null 后穿到 405 守卫——以代码为准如实断言，不按挂账原文猜 404），
 *      同进程 POST 端点仍 200（证隐身是路由隐身，不是进程死）。
 *
 * 诚实边界：bun 宿主桥不在本文件（sqlite.ts 同款挂账，本机无 bun）；journal 为单进程内存环形
 * （server 重启清零——跨重启历史归 dev 面 audit.jsonl 时间轴，introspect.ts 头注），本测试只证
 * 单进程生命周期内的路由可查性；auth 会话主体链（login → ctx.auth.principal → journal principal）
 * 不在本夹具（M7 已闭）。skip 策略：宿主 node < 23.6（无默认 type stripping，子进程跑不了 .ts
 * fixture）→ 整组诚实 skip（build-gate/openapi-golden 同款）。纪律（§14.2）：全部 127.0.0.1 +
 * listen port 0；用例收尾 stop() 杀子进程，afterAll 兜底收尸后才删临时目录（Windows 孤儿进程零
 * 容忍，openapi-golden 同款）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRAMEWORK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(FRAMEWORK, "cli.mjs");
const MOUNT = "/api"; // server-status 路由形态：GET <mount>/__atelier/server-status（INTROSPECT_NAME 前带挂载前缀）
const DB_REL = path.join(".atelier", "journal.db"); // migrate up --db 与子进程 openSqlite 共用同一库文件（openapi-golden AUTH_DB_REL 同款）

/** node ≥23.6 才默认 type stripping（子进程要直跑 .ts fixture 与 vendor server 面） */
const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split(".").map(Number);
const TYPE_STRIPPING_OK = NODE_MAJOR! > 23 || (NODE_MAJOR === 23 && NODE_MINOR! >= 6);
const d: typeof describe = TYPE_STRIPPING_OK ? describe : describe.skip;

/* ---------------- fixture：临时应用（契约单源 + 端点 + schema + 子进程启动壳） ---------------- */

const tmpRoots: string[] = [];
const procs: ChildProcess[] = [];

afterAll(async () => {
  for (const p of procs.splice(0)) if (p.exitCode === null && !p.killed) p.kill();
  await Promise.allSettled(procs.map((p) => new Promise((r) => (p.exitCode !== null ? r(null) : p.once("exit", r)))));
  await new Promise((r) => setTimeout(r, 100)); // Windows 句柄释放宽限
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function w(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

/** 契约单源（真实应用同形态：import type + satisfies——type stripping 下 type import 被擦除） */
function contractSource(): string {
  return `import type { FlatSchema } from "./vendor/atelier/server/index.ts";

/** journal.put 输入契约（违规 → ATR-201 400，且按 D-F12 语义不入 journal） */
export const journalPutInput = {
  type: "object",
  reqProps: { message: { type: "string", min: 1 } },
} satisfies FlatSchema;

export const journalPutOutput = {
  type: "object",
  reqProps: { echoed: { type: "string" } },
} satisfies FlatSchema;

/** journal.guarded 输入契约——负例专用：缺 text 调用 = ATR-201，断言不入账 */
export const journalGuardedInput = {
  type: "object",
  reqProps: { text: { type: "string", min: 1 } },
} satisfies FlatSchema;
`;
}

/** 夹具端点四件：成功 command（携 ctx.audit）/ 抛错 command / 无契约 query / 契约 command（只喂负例） */
function journalEndpointsSource(): string {
  return `import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { journalPutInput, journalPutOutput, journalGuardedInput } from "../../contract.ts";

/** 成功 command：ctx.audit 备注 → journal 条目 notes（非空才携带——字段形状诚实最小化） */
export const journalPut = defineCommand<{ message: string }, { echoed: string }>("journal.put", {
  contract: journalPutInput,
  output: journalPutOutput,
  handler: (input, ctx) => {
    ctx.audit("journal.put 入账（journal-subprocess 夹具）");
    return { echoed: input.message };
  },
});

/** 抛错 command：未捕获异常 → 500 ATR-320 + journal failed 条目（endpoints.ts D-F12 实读语义） */
export const journalExplode = defineCommand<{ reason: string }, { ok: boolean }>("journal.explode", {
  handler: (input) => {
    throw new Error(\`flaky 故意炸：\${input.reason}\`);
  },
});

/** query：journal 语义 = command 入账——query 永不入账（负例③） */
export const journalPeek = defineQuery("journal.peek", {
  handler: () => ({ ok: true }),
});

/** 契约 command：契约违规 ATR-201 在 handler 之前返回——不入账（负例②）；合规调用本测试不发起 */
export const journalGuarded = defineCommand<{ text: string }, { got: string }>("journal.guarded", {
  contract: journalGuardedInput,
  handler: (input) => ({ got: input.text }),
});
`;
}

function schemaSource(): string {
  return `import { table } from "../../vendor/atelier/server/db.ts";

export const journalNotes = table("journal_notes", {
  id: { type: "integer", primaryKey: true },
  note: { type: "text", notNull: true },
});
`;
}

/**
 * 子进程启动壳：db 装配走模板 main-server.ts 头注记载的 opt-in 四步（openSqlite → createHandler
 * 传 db）——introspect 的 db 段（表清单 + 迁移 journal）只有装配了句柄才非 null。opts.prod = 夹具侧
 * 置 __ATELIER_PROD__ 旗（该旗无 env 契约，endpoints.ts isProd 是 globalThis 读法——prod-strip
 * 测试同机制；置位时机无关紧要：isProd 按请求现读）。
 */
function bootstrapSource(dbAbsPath: string, prod: boolean): string {
  return `${prod ? `(globalThis as { __ATELIER_PROD__?: boolean }).__ATELIER_PROD__ = true; // prod 语义：内省路由隐身（§3.7 调试面不进生产 API 面）\n` : ""}import { EndpointRegistry, openSqlite, serve } from "./src/vendor/atelier/server/index.ts";
import * as journalEndpoints from "./src/server/endpoints/journal.ts";

const db = await openSqlite(${JSON.stringify(dbAbsPath)});
const registry = new EndpointRegistry();
for (const value of Object.values(journalEndpoints)) {
  const def = value as { kind?: unknown; name?: unknown; handler?: unknown };
  if ((def.kind === "query" || def.kind === "command") && typeof def.name === "string" && typeof def.handler === "function") {
    registry.register(def as never);
  }
}
const handler = registry.createHandler({ mount: ${JSON.stringify(MOUNT)}, db }); // ← db 显式装配（§3.2，ctx/introspect 共用）
await serve(handler, { port: 0 });
`;
}

let fixtureRoot: string | null = null;

/** init + gen db + migrate up 一次（模块级共享，it 按序执行；openapi-golden makeGoldenApp 同款） */
function ensureFixture(): string {
  if (fixtureRoot) return fixtureRoot;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-journal-sub-"));
  tmpRoots.push(root);
  const run = (args: string[], env?: NodeJS.ProcessEnv) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd: FRAMEWORK,
      encoding: "utf8",
      windowsHide: true,
      env: env ?? process.env, // 整体替换不合并——envWithoutPrincipal 靠"缺键"表达删除语义
    });
    if (r.status !== 0) throw new Error(`atelier ${args.join(" ")} 失败（exit ${r.status}）：\n${r.stdout?.slice(-800)}\n${r.stderr?.slice(-800)}`);
    return r;
  };
  run(["init", "--target", root, "--name", "JournalSub", "--no-ai"]);
  expect(fs.existsSync(path.join(root, "src", "vendor", "atelier", "server", "index.ts"))).toBe(true);
  // 模板示例端点清场（example.ts/notes.ts）——journal 条目集必须由夹具自身决定，不耦合模板演进
  // （openapi-golden 同款；模板 contract.ts 随后整文件重写为夹具契约）
  for (const f of fs.readdirSync(path.join(root, "src", "server", "endpoints"))) {
    fs.rmSync(path.join(root, "src", "server", "endpoints", f), { force: true });
  }
  w(root, "src/contract.ts", contractSource());
  w(root, "src/server/endpoints/journal.ts", journalEndpointsSource());
  w(root, "src/server/db/schema.ts", schemaSource());
  run(["gen", "db", "--root", root]); // → tables/crud + 001_journal_notes.{up,down}.sql 迁移对 + seeds 示例骨架
  const migName = migrationName(root); // journal 行断言用目录实扫，不硬编码编号
  expect(migName).toMatch(/^\d+_journal_notes$/); // 迁移 journal 行断言的前置核账
  // migrate up 在宿主 CLI 跑（principal 解析：显式 > ATELIER_PRINCIPAL env > 'cli' 缺省——
  // 显式清掉 env 防宿主环境翻账，钉住缺省 "cli"）；库文件与子进程共享（.atelier/journal.db）
  run(["migrate", "up", "--db", DB_REL, "--root", root], envWithoutPrincipal());
  // dev 托管同款双启动壳（db 装配 opt-in 四步，模板 main-server.ts 头注记载）：常规面 + prod 旗面
  const dbAbs = path.join(root, DB_REL);
  w(root, "journal-server.ts", bootstrapSource(dbAbs, false));
  w(root, "journal-server-prod.ts", bootstrapSource(dbAbs, true));
  fixtureRoot = root;
  return root;
}

function envWithoutPrincipal(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ATELIER_PRINCIPAL; // journalPrincipal：explicit ?? env ?? "cli"——清 env 才是"缺省 cli"语义
  return env;
}

/** 迁移目录实扫（断言不硬编码 NNN 编号——gen db 追加式编号推进是它自己的纪律） */
function migrationName(root: string): string {
  const dir = path.join(root, "src", "server", "db", "migrations");
  const ups = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".up.sql")) : [];
  expect(ups).toHaveLength(1);
  return ups[0]!.replace(/\.up\.sql$/, "");
}

/* ---------------- 真实 server：spawn 子进程 + 握手行取实际端口 + 可靠收尸（openapi-golden 同款） ---------------- */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function startJournalServer(root: string, bootstrapFile: string): Promise<{ port: number; stop: () => Promise<void> }> {
  const proc = spawn(process.execPath, [path.join(root, bootstrapFile)], {
    cwd: root, // introspect 缺省 migrationsDir = process.cwd()/src/server/db/migrations（dev 托管同约定）
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  procs.push(proc);
  let out = "";
  let err = "";
  proc.stdout!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  proc.stderr!.on("data", (c: Buffer) => (err += c.toString("utf8")));
  const deadline = Date.now() + 15_000;
  for (;;) {
    const m = out.match(/^ATELIER_SERVER_READY \{"port":(\d+)\}\r?\n/m);
    if (m) {
      const port = Number(m[1]);
      expect(port).toBeGreaterThan(0);
      return {
        port,
        stop: async () => {
          if (proc.exitCode !== null) return;
          const exited = new Promise<void>((r) => proc.once("exit", () => r()));
          proc.kill();
          await Promise.race([exited, sleep(5_000)]);
          if (proc.exitCode === null) proc.kill("SIGKILL"); // 兜底强杀，不留孤儿
          await exited.catch(() => {});
        },
      };
    }
    if (proc.exitCode !== null) throw new Error(`journal server 提前退出（exit ${proc.exitCode}）：\n${out}\n${err}`);
    if (Date.now() > deadline) throw new Error(`journal server 15s 未就绪：\n${out}\n${err}`);
    await sleep(25);
  }
}

async function getJson(url: string): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(url);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 诚实保留 null——由断言方记失败 */
  }
  return { status: res.status, json, text };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; headers: Headers; json: any }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 同上 */
  }
  return { status: res.status, headers: res.headers, json };
}

const statusUrl = (port: number) => `http://127.0.0.1:${port}${MOUNT}/__atelier/server-status`;
const postUrl = (port: number, name: string) => `http://127.0.0.1:${port}${MOUNT}/${name}`;

d("FS-M4 挂账关闭：journal 子进程内省（真实 server 子进程 → GET server-status 路由可查）", () => {
  it(
    "command journal 四语义经内省路由可查：成功入账 + 抛错 ATR-320 failed + query 不入账 + 契约 ATR-201 不入账",
    { timeout: 240_000, retry: 0 },
    async () => {
      const root = ensureFixture();
      const srv = await startJournalServer(root, "journal-server.ts");
      try {
        // ---- 基线：快照形状 + journal 初始为空（后文长度 2 断言的前提） ----
        const base = await getJson(statusUrl(srv.port));
        expect(base.status).toBe(200);
        const snap = base.json;
        expect(snap.ok).toBe(true);
        expect(snap.server.mount).toBe(MOUNT);
        expect(snap.server.node).toBe(process.version);
        expect(Number.isNaN(Date.parse(snap.server.startedAt))).toBe(false);
        const names = snap.endpoints.map((e: { name: string }) => e.name).sort();
        expect(names).toEqual(["journal.explode", "journal.guarded", "journal.peek", "journal.put"]);
        const putRow = snap.endpoints.find((e: { name: string }) => e.name === "journal.put");
        expect(putRow.kind).toBe("command");
        expect(putRow.hasContract).toBe(true);
        expect(putRow.contract).not.toBeNull(); // 契约体随行（ServerStatusEndpoint = 摘要 + contract/output）
        expect(snap.journal).toEqual([]);
        expect(snap.live).toEqual({ subscriberCount: 0, endpoints: [] }); // 夹具无 live 端点
        expect(snap.dbNote).toBeNull(); // db 已装配且读侧快照成功

        // ---- ① 成功 command：200 + 端点头 → journal 尾部 status=ok 条目 ----
        const put = await postJson(postUrl(srv.port, "journal.put"), { message: "hello journal" });
        expect(put.status).toBe(200);
        expect(put.headers.get("x-atelier-endpoint")).toBe("journal.put");
        expect(put.headers.get("x-atelier-endpoint-kind")).toBe("command");
        expect(put.json).toEqual({ echoed: "hello journal" });

        // ---- ② 抛错 command：500 ATR-320 → journal failed 条目（D-F12：审计与数据一致） ----
        const boom = await postJson(postUrl(srv.port, "journal.explode"), { reason: "boom" });
        expect(boom.status).toBe(500);
        expect(boom.json.code).toBe("ATR-320");
        expect(boom.json.message).toContain("flaky 故意炸");

        // ---- 负例甲：query 不入账 ----
        const peek = await postJson(postUrl(srv.port, "journal.peek"), {});
        expect(peek.status).toBe(200);
        // ---- 负例乙：契约违规 ATR-201 不入账（分发未穿 handler——endpoints.ts 实读：校验失败
        //      在 journalPush 之前返回；挂账原文「契约违规哪种入账」以此实读为准） ----
        const bad = await postJson(postUrl(srv.port, "journal.guarded"), {});
        expect(bad.status).toBe(400);
        expect(bad.json.code).toBe("ATR-201");

        // ---- 快照复核：恰两条 command 条目，缺席负例，字段形状按 introspect 实际输出 ----
        const after = (await getJson(statusUrl(srv.port))).json;
        const j = after.journal;
        expect(Array.isArray(j)).toBe(true);
        expect(j).toHaveLength(2);
        expect(j.map((e: { name: string }) => e.name)).toEqual(["journal.put", "journal.explode"]); // journalPush 追加序 = 调用序

        const okEntry = j[0];
        expect(okEntry).toMatchObject({
          name: "journal.put",
          kind: "command",
          status: "ok",
          input: { message: "hello journal" },
          principal: null, // 无 auth 装配 → 如实 null（非 null principal 由迁移 journal "cli" 半边钉住）
        });
        expect(Number.isNaN(Date.parse(okEntry.ts))).toBe(false);
        expect(typeof okEntry.durMs).toBe("number");
        expect(okEntry.durMs).toBeGreaterThanOrEqual(0);
        expect(okEntry.notes).toEqual(["journal.put 入账（journal-subprocess 夹具）"]); // ctx.audit 随行
        expect(okEntry.error).toBeUndefined(); // 成功条目无 error 位

        const failEntry = j[1];
        expect(failEntry).toMatchObject({
          name: "journal.explode",
          kind: "command",
          status: "failed",
          input: { reason: "boom" },
          principal: null,
        });
        expect(failEntry.error.code).toBe("ATR-320");
        expect(failEntry.error.message).toContain("flaky 故意炸");
        expect(failEntry.error.fix).toContain("journal.explode"); // 四段式 fix 随行可结构化消费
        expect(failEntry.notes).toBeUndefined(); // notes 非空才携带——失败路径无 audit 即无键
        expect(j.map((e: { name: string }) => e.name)).not.toContain("journal.peek"); // query 永不入账
        expect(j.map((e: { name: string }) => e.name)).not.toContain("journal.guarded"); // ATR-201 不入账
      } finally {
        await srv.stop();
      }
    },
  );

  it(
    "迁移 journal 段（M7-B）：快照携 atelier_migration_journal 尾部——up ok 行 + principal 缺省 cli + head/applied/tables 段",
    { timeout: 120_000, retry: 0 },
    async () => {
      const root = ensureFixture();
      const migName = migrationName(root);
      const srv = await startJournalServer(root, "journal-server.ts");
      try {
        // 全新子进程：command journal 为空（内存环形——重启清零的诚实边界顺带钉住）
        const snap = (await getJson(statusUrl(srv.port))).json;
        expect(snap.journal).toEqual([]);

        const db = snap.db;
        expect(db).not.toBeNull();
        const tableNames = db.tables.map((t: { name: string }) => t.name);
        expect(tableNames).toEqual(expect.arrayContaining(["journal_notes", "atelier_migrations", "atelier_migration_journal"]));
        const notesTable = db.tables.find((t: { name: string }) => t.name === "journal_notes");
        expect(notesTable.columns.map((c: { name: string }) => c.name)).toEqual(["id", "note"]);
        expect(notesTable.columns.find((c: { name: string }) => c.name === "id").pk).toBe(true);

        // 迁移状态段：head/applied/pending（宿主 CLI migrate up 的后果，经子进程内省读出）
        const mig = db.migrations;
        expect(mig.note).toBeNull();
        expect(mig.head).toEqual({ id: 1, name: migName });
        expect(mig.applied).toEqual([migName]);
        expect(mig.pending).toEqual([]); // cwd=夹具根 → migrationsDir 可解析，全部已应用

        // 迁移 journal 尾部（本测试的核心③）：恰一条 up ok 行，principal = migrate CLI 缺省 "cli"
        expect(mig.journal.ok).toBe(true);
        expect(mig.journal.note).toBeNull();
        expect(mig.journal.rows).toHaveLength(1);
        const row = mig.journal.rows[0];
        expect(row).toMatchObject({
          id: 1,
          name: migName,
          action: "up",
          status: "ok",
          principal: "cli",
        });
        expect(typeof row.ts).toBe("number"); // 库内 Date.now() 毫秒（camelCase 投影——introspect.ts 同源）
        expect(typeof row.durMs).toBe("number");
        expect(row.durMs).toBeGreaterThanOrEqual(0);
        expect(typeof row.checksum).toBe("string");
        expect(row.checksum.length).toBeGreaterThan(0);
      } finally {
        await srv.stop();
      }
    },
  );

  it(
    "prod 旗标隐身负例：__ATELIER_PROD__ 置位 → GET server-status 落回 405 ATR-311（非 404——分发器顺序实读），POST 端点仍通",
    { timeout: 120_000, retry: 0 },
    async () => {
      const root = ensureFixture();
      const srv = await startJournalServer(root, "journal-server-prod.ts");
      try {
        // 同进程 POST 端点仍 200——证隐身是路由隐身，不是进程死/注册表缺失
        const put = await postJson(postUrl(srv.port, "journal.put"), { message: "prod probe" });
        expect(put.status).toBe(200);

        // prod 旗：introspectResponse 返 null → 落回非 POST 分支 ATR-311 405（endpoints.ts 分发器
        // 顺序实读：保留路由在 405 守卫之前，null 只是"不接住"，后续守卫照常走——挂账原文猜的
        // 「404/无数据」与代码不符，以代码为准如实断言）
        const hidden = await getJson(statusUrl(srv.port));
        expect(hidden.status).toBe(405);
        expect(hidden.json.code).toBe("ATR-311");
        expect(hidden.json.message).toContain("只接受 POST");
      } finally {
        await srv.stop();
      }
    },
  );
});
