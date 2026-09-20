/**
 * acceptance.spec.ts — M3-FS R/C 类评分 harness（FS-10 执行半；S/T 类在 grade.mjs）。
 * 由 grade.mjs 驱动：env ATELIER_M3FS_TASK（task id）+ ATELIER_M3FS_ATTEMPT（attempt 目录）
 * + ATELIER_M3FS_OUT（结果 JSON 落点）。无 env 时（常规 pnpm test 扫到本文件）整体 skip。
 *
 * 结果契约：逐判据 try/catch 取证 → { checks: [{id, category, desc, pass, detail?}] }
 * 增量写进 ATELIER_M3FS_OUT（每判据落一次盘——中途崩溃也有已完成判据可读）。
 * **本 spec 的 vitest exit code 不是评分依据**——判据结果以 JSON 为单一真相（grade.mjs 读入合并）。
 * 语义划线：本 spec 内发生的一切失败（断言不符 / server 起不来 / 组件文件缺失）都是**正当判红**
 * （detail 携带现场）；grade.mjs 侧的 `error` 位只留给真正的评分基础设施故障（spec 未产出 JSON、
 * 内省模块加载炸等）——negative-check 据此区分"错的抓住了"与"崩溃假红"。
 *
 * R 类（服务端黑盒）：spawn 真实 server（node <attempt>/src/server/main-server.ts，
 *   ATELIER_SERVER_PORT=0 → 读 stdout 握手行 ATELIER_SERVER_READY 拿端口——openapi-golden.test.ts
 *   同源手法；ATELIER_DB_PATH 指向 .atelier/dev.db 的临时副本——场景写库绝不弄脏原库），
 *   fetch + SSE 解析器按 scenario-spec 逐条驱动。推送/静默断言窗口 = 1000ms 轮询（三臂同值）。
 * C 类（客户端对账）：dom-shim（tests/dom-shim.ts）+ mock EventSource/fetch（模板 LiveNotes.spec
 *   同款手法）挂载 attempt 的 src/components/NotesPage.atr.ts，按 DOM 钩子契约驱动提交入口。
 *   挂载用 attempt 自己 vendored 的 runtime（src/runtime）+ 其 registry——与真实应用同实例语义。
 *
 * 场景规格单一锚 = 同目录 scenario-spec.md（三臂语义同文；断言窗口对三臂同值，规格不公=数据作废）。
 */
import { afterAll, describe, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { DatabaseSync } from "node:sqlite";
import { findByTag, makeContainer, serialize } from "../../../tests/dom-shim.ts";

const TASK = process.env.ATELIER_M3FS_TASK ?? "";
const ATTEMPT = process.env.ATELIER_M3FS_ATTEMPT ?? "";
const OUT = process.env.ATELIER_M3FS_OUT ?? "";

/* ---------------- 场景常量（与 scenario-spec.md 同文；窗口对三臂同值） ---------------- */

const MOUNT = "/api";
const LIST_NAME = "notes.list";
const CREATE_NAME = "notes.create";
/**
 * 基线种子行 id（scenario-spec「基线形态」钉死；R1 首连全量必须含全部三个）。
 * brief v2：id = 客户端生成的 JSON number（正整数）——比较一律 String() 化，类型无关。
 */
const SEED_IDS = ["1", "2", "3"];
/** C 类挂载馈送行：task1/task3 行内含 priority（M7 要求行内可见）；task2 无 priority */
const C_ROWS = (task: string): Record<string, unknown>[] =>
  task === "task2-live-reconcile"
    ? [
        { id: 101, body: "alpha", createdAt: 11 },
        { id: 202, body: "beta", createdAt: 22 },
      ]
    : [
        { id: 101, body: "alpha", createdAt: 11, priority: 3 },
        { id: 202, body: "beta", createdAt: 22, priority: 7 },
      ];
const PUSH_WINDOW_MS = 1000; // R2：POST 成功后同一订阅 ≤1s 内须收到含该 id 的 data 帧
const QUIET_WINDOW_MS = 1000; // R3：违规 POST 后 1s 静默窗口内不得有新帧
const FIRST_FRAME_TIMEOUT_MS = 5000; // R1：首连全量帧的宽限（含 server 冷启动余量）
const SERVER_START_TIMEOUT_MS = 15000; // ATELIER_SERVER_READY 握手宽限
/** ATR-201 四段式样例（C2 失败注入用；四键俱全 = 四段式形状） */
const ATR201 = {
  code: "ATR-201",
  message: "body: 长度 0 小于最小 1",
  context: { component: CREATE_NAME },
  fix: "按契约修正输入：body 非空（scenario-spec C2 注入样例）",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isCreate = (t: string): boolean => t === "task1-column-change" || t === "task3-fullstack-rescue";
const hasLive = (t: string): boolean => t === "task2-live-reconcile" || t === "task3-fullstack-rescue";

/* ---------------- 结果记账（增量落盘） ---------------- */

type Check = { id: string; category: "R" | "C"; desc: string; pass: boolean; detail?: string };
const recorded: Check[] = [];

function flushOut(): void {
  if (!OUT) return;
  try {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ checks: recorded }, null, 2) + "\n", "utf8");
  } catch {
    /* 落盘失败时由 grade.mjs 的"读不到结果 = 基础设施错误"路径兜住 */
  }
}

/** 判据执行器：一切异常（断言不符 / server 起不来 / 文件缺失）= 正当判红，detail 携带现场 */
async function judge(id: string, category: "R" | "C", desc: string, run: () => Promise<void>): Promise<void> {
  let check: Check;
  try {
    await run();
    check = { id, category, desc, pass: true };
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}` : String(e);
    check = { id, category, desc, pass: false, detail: msg.slice(0, 500) };
  }
  recorded.push(check);
  flushOut();
}

/* ---------------- R 类：真实 server（openapi-golden 同源 spawn 手法） ---------------- */

let dbCopyDir: string | null = null;
let dbCopyFile: string | null = null;
let serverProc: ChildProcess | null = null;
let baseUrl = "";
let serverStderr = "";
let serverStarted = false;
let serverStartPromise: Promise<void> | null = null;

async function startServer(): Promise<void> {
  const mainServer = path.join(ATTEMPT, "src", "server", "main-server.ts");
  if (!fs.existsSync(mainServer)) throw new Error(`attempt 缺 src/server/main-server.ts：${ATTEMPT}`);
  const srcDb = path.join(ATTEMPT, ".atelier", "dev.db");
  if (!fs.existsSync(srcDb)) throw new Error("attempt 缺 .atelier/dev.db（基线未装配/未迁移）");
  dbCopyDir = fs.mkdtempSync(path.join(os.tmpdir(), "m3fs-rc-db-"));
  dbCopyFile = path.join(dbCopyDir, "dev-copy.db");
  fs.copyFileSync(srcDb, dbCopyFile);

  const proc = spawn(process.execPath, [mainServer], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ATELIER_SERVER_PORT: "0", ATELIER_SERVER_MOUNT: MOUNT, ATELIER_DB_PATH: dbCopyFile! },
  });
  serverProc = proc;
  let out = "";
  proc.stdout!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  proc.stderr!.on("data", (c: Buffer) => (serverStderr += c.toString("utf8")));
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  for (;;) {
    const m = out.match(/^ATELIER_SERVER_READY \{"port":(\d+)\}\r?\n/m);
    if (m) {
      baseUrl = `http://127.0.0.1:${Number(m[1])}`;
      serverStarted = true;
      return;
    }
    if (proc.exitCode !== null) throw new Error(`server 提前退出（exit ${proc.exitCode}）：${(out + "\n" + serverStderr).slice(0, 400)}`);
    if (Date.now() > deadline) throw new Error(`server ${SERVER_START_TIMEOUT_MS}ms 未就绪：${(out + "\n" + serverStderr).slice(0, 400)}`);
    await sleep(25);
  }
}

/** R 判据共用入口：server 只起一次（首用判据触发）；启动失败 = 所有依赖判据正当判红 */
function ensureServer(): Promise<void> {
  if (serverStarted) return Promise.resolve();
  serverStartPromise = serverStartPromise ?? startServer();
  return serverStartPromise;
}

async function stopServer(): Promise<void> {
  const proc = serverProc;
  serverProc = null;
  if (proc && proc.exitCode === null && !proc.killed) {
    const exited = new Promise<void>((r) => proc.once("exit", () => r()));
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
    if (proc.exitCode === null) proc.kill("SIGKILL"); // Windows 孤儿进程零容忍（openapi-golden 同款兜底）
    await exited.catch(() => {});
  }
  await sleep(100); // 句柄释放宽限
  if (dbCopyDir) {
    try { fs.rmSync(dbCopyDir, { recursive: true, force: true }); } catch { /* temp 收尾 */ }
    dbCopyDir = null;
    dbCopyFile = null;
  }
}

async function post(name: string, body: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${baseUrl}${MOUNT}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 保留 null，由断言显式失败 */ }
  return { status: res.status, json, text };
}

/** SSE 订阅读取器：retry/data/error 帧解析（§4.3 线协议）；next(timeout) 超时返回 null */
class SseReader {
  private ac = new AbortController();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buf = "";
  private queue: { event: string; data: string }[] = [];
  private waiters: ((v: { event: string; data: string } | null) => void)[] = [];
  closed = false;
  sawRetryFirst = false;

  constructor(rawUrl: string) {
    void this.start(rawUrl);
  }

  private async start(rawUrl: string): Promise<void> {
    try {
      const res = await fetch(rawUrl, { signal: this.ac.signal, headers: { accept: "text/event-stream" } });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("text/event-stream")) {
        const body = await res.text().catch(() => "");
        throw new Error(`live 订阅非 SSE 响应：HTTP ${res.status} ct=${ct} body=${body.slice(0, 160)}`);
      }
      this.reader = res.body!.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) {
          this.closed = true;
          break;
        }
        const chunk = dec.decode(value, { stream: true });
        if (!this.sawRetryFirst) this.sawRetryFirst = (this.buf + chunk).startsWith("retry: 3000");
        this.buf += chunk;
        const blocks = this.buf.split("\n\n");
        this.buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const evLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!evLine || !dataLine) continue; // 注释/心跳块（": ping"）自然跳过
          this.enqueue({ event: evLine.slice("event: ".length).trim(), data: dataLine.slice("data: ".length) });
        }
      }
    } catch (e) {
      if (!this.ac.signal.aborted) {
        this.closed = true;
        this.enqueue({ event: "__transport_error", data: String((e as Error).message ?? e) });
      }
    } finally {
      for (const w of this.waiters.splice(0)) w(null);
    }
  }

  private enqueue(frame: { event: string; data: string }): void {
    const w = this.waiters.shift();
    if (w) w(frame);
    else this.queue.push(frame);
  }

  /** 下一帧；timeout 内无帧 → null（R3 静默窗口断言即用此语义） */
  next(timeoutMs: number): Promise<{ event: string; data: string } | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      let fired = false;
      const fn = (frame: { event: string; data: string } | null) => {
        if (fired) return;
        fired = true;
        clearTimeout(t);
        resolve(frame);
      };
      const t = setTimeout(() => fn(null), timeoutMs);
      this.waiters.push(fn);
    });
  }

  dispose(): void {
    this.ac.abort();
    void this.reader?.cancel().catch(() => {});
  }
}

/* ---------------- C 类：dom-shim + mock EventSource/fetch（LiveNotes.spec 同款手法） ---------------- */

type AnyNode = any;

class MockEventSource {
  static instances: MockEventSource[] = [];
  static reset(): void {
    MockEventSource.instances = [];
  }
  url: string;
  closed = false;
  listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ data });
  }
}

type FetchCall = { url: string; method: string; body: Record<string, unknown> };
type MockReply = { status: number; json: unknown };
type Responder = (call: FetchCall) => MockReply | Promise<MockReply>;
let fetchCalls: FetchCall[] = [];
let createResponder: Responder = () => ({ status: 200, json: {} });
let listResponder: Responder = () => ({ status: 200, json: { notes: [] } });
let originalFetch: unknown = null;
let originalEventSource: unknown = null;
let networkMocked = false;

function installNetworkMocks(rows: Record<string, unknown>[]): void {
  const g = globalThis as unknown as Record<string, unknown>;
  originalFetch = g.fetch;
  originalEventSource = g.EventSource;
  fetchCalls = [];
  MockEventSource.reset();
  listResponder = () => ({ status: 200, json: { notes: rows.map((r) => ({ ...r })) } });
  createResponder = () => ({ status: 200, json: {} });
  g.EventSource = MockEventSource;
  g.fetch = (async (rawUrl: unknown, init?: { method?: string; body?: string }) => {
    const call: FetchCall = {
      url: String(rawUrl),
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    };
    fetchCalls.push(call);
    const reply = await (call.url.includes(CREATE_NAME)
      ? createResponder(call)
      : call.url.includes(LIST_NAME)
        ? listResponder(call)
        : { status: 404, json: { code: "ATR-310", message: "mock fetch：未知 URL", context: {}, fix: "-" } });
    await sleep(0); // 与真实 fetch 同为异步边界（submit 的 await 语义不变）
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.json };
  }) as unknown as typeof fetch;
  networkMocked = true;
}

function restoreNetworkMocks(): void {
  if (!networkMocked) return;
  const g = globalThis as unknown as Record<string, unknown>;
  if (originalFetch !== undefined) g.fetch = originalFetch;
  if (originalEventSource !== undefined) g.EventSource = originalEventSource;
  networkMocked = false;
}

let cRuntime: any = null;
let notesPageDef: any = null;

/** 懒加载 attempt 的 vendored runtime + NotesPage 组件（shim/mocks 就位后才触发真实加载） */
async function ensureComponentLoaded(): Promise<void> {
  if (notesPageDef) return;
  const compFile = path.join(ATTEMPT, "src", "components", "NotesPage.atr.ts");
  if (!fs.existsSync(compFile)) throw new Error("attempt 缺 src/components/NotesPage.atr.ts（产出布局未交付）");
  const rtMod = await import(url.pathToFileURL(path.join(ATTEMPT, "src", "runtime", "index.ts")).href);
  cRuntime = rtMod;
  const mod = await import(url.pathToFileURL(compFile).href);
  notesPageDef = mod.NotesPage ?? mod.default ?? null;
  if (!notesPageDef) throw new Error("NotesPage.atr.ts 未导出 NotesPage");
}

/** 挂载全新 NotesPage 实例（attempt 自己的 runtime + registry，不传 props），返回容器与其 EventSource */
async function mountNotesPage(): Promise<{ container: AnyNode; es: MockEventSource | null }> {
  await ensureComponentLoaded();
  const container = makeContainer();
  cRuntime.mountComponent(notesPageDef, {}, container, cRuntime.registry, (schema: unknown, data: unknown) =>
    cRuntime.validateFlat(schema as never, data as never),
  );
  await flush();
  const es = MockEventSource.instances[MockEventSource.instances.length - 1] ?? null;
  return { container, es };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise<void>((r) => queueMicrotask(() => r()));
  }
};

function findByAttr(node: AnyNode, name: string, value?: string): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (n: AnyNode): void => {
    if (!n) return;
    if (n.type === "element") {
      const v = typeof n.getAttribute === "function" ? n.getAttribute(name) : null;
      if (v !== null && (value === undefined || v === value)) out.push(n);
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(node);
  return out;
}

/** 驱动提交入口（DOM 钩子契约：一个文本 <input> + 一个提交按钮） */
async function driveSubmit(container: AnyNode, text: string): Promise<void> {
  const input = findByTag(container, "input")[0];
  if (!input) throw new Error("DOM 钩子契约缺提交入口的文本 <input>（scenario-spec DOM 钩子契约）");
  input.dispatchEvent({ type: "input", target: { value: text } });
  await flush();
  const button = findByTag(container, "button")[0];
  if (!button) throw new Error("DOM 钩子契约缺提交按钮 <button>（scenario-spec DOM 钩子契约）");
  button.dispatchEvent({ type: "click" });
  await flush();
}

/* ---------------- 判据实现 ---------------- */

let sharedReader: SseReader | null = null;

/** task1/task3 M4：契约可选 priority（0-9）+ 行为（带 priority 落库一致；省略按 0） */
async function checkM4(): Promise<void> {
  await ensureServer();
  const epMod = await import(url.pathToFileURL(path.join(ATTEMPT, "src", "server", "endpoints", "notes.ts")).href);
  const create = Object.values(epMod).find((v: any) => v && v.kind === "command" && v.name === CREATE_NAME) as any;
  if (!create) throw new Error(`端点模块无 ${CREATE_NAME} def`);
  const opt = (create.contract as any)?.optProps?.priority;
  const req = (create.contract as any)?.reqProps?.priority;
  if (!opt || req || opt.type !== "number" || opt.min !== 0 || opt.max !== 9) {
    throw new Error(`notes.create 输入契约 optProps.priority 须为 {type:"number", min:0, max:9}（可选），实际 optProps=${JSON.stringify(opt ?? null)} reqProps=${JSON.stringify(req ?? null)}`);
  }
  const withP = await post(CREATE_NAME, { id: 20250920101, body: "m4 note", priority: 7 });
  if (withP.status !== 200) throw new Error(`带 priority 的创建被拒：HTTP ${withP.status} ${withP.text.slice(0, 160)}`);
  if (String(withP.json?.priority) !== "7") throw new Error(`成功载荷应回显 priority=7，实际 ${JSON.stringify(withP.json)}`);
  const noP = await post(CREATE_NAME, { id: 20250920102, body: "m4b note" });
  if (noP.status !== 200) throw new Error(`省略 priority 的创建被拒：HTTP ${noP.status} ${noP.text.slice(0, 160)}`);
  // 落库检查打在库副本上（R 场景 db = .atelier/dev.db 的临时副本，server 经 ATELIER_DB_PATH 打开它）
  await sleep(50); // SQLite 同步写，宽限一次调度
  const db = new DatabaseSync(dbCopyFile!, { readOnly: true });
  try {
    const rows = db.prepare("SELECT id, body, priority FROM notes WHERE id IN (20250920101, 20250920102)").all() as any[];
    const r7 = rows.find((r) => String(r.id) === "20250920101");
    const r0 = rows.find((r) => String(r.id) === "20250920102");
    if (!r7 || Number(r7.priority) !== 7) throw new Error(`带 priority=7 的调用落库值不一致：${JSON.stringify(rows)}`);
    if (!r0 || Number(r0.priority) !== 0) throw new Error(`省略 priority 应按 0 落库：${JSON.stringify(rows)}`);
  } finally {
    db.close();
  }
}

/** task1/task3 M5：notes.list 返回行含 priority（200 = dev 态输出校验不红） */
async function checkM5(): Promise<void> {
  await ensureServer();
  const res = await post(LIST_NAME, {});
  if (res.status !== 200) throw new Error(`notes.list 非 200（dev 态输出校验红 = ATR-215 面）：HTTP ${res.status} ${res.text.slice(0, 160)}`);
  const rows = res.json?.notes;
  if (!Array.isArray(rows)) throw new Error(`notes.list 响应缺 notes 数组：${res.text.slice(0, 160)}`);
  const hit = rows.find((r: any) => String(r?.id) === "20250920101");
  if (!hit) throw new Error(`列表行缺 20250920101（R 场景内创建的行应可读出）：${JSON.stringify(rows).slice(0, 200)}`);
  if (hit.priority === undefined || Number(hit.priority) !== 7) throw new Error(`列表行未携带/不一致 priority：${JSON.stringify(hit)}`);
}

/** task2/task3 R1：SSE 首连全量 data 帧（retry 先行 + 三个种子 id 俱全） */
async function checkR1(): Promise<void> {
  await ensureServer();
  const reader = new SseReader(`${baseUrl}${MOUNT}/${LIST_NAME}/live`);
  sharedReader = reader;
  const frame = await reader.next(FIRST_FRAME_TIMEOUT_MS);
  if (!frame) throw new Error(`首连 ${FIRST_FRAME_TIMEOUT_MS}ms 内未收到任何帧`);
  if (frame.event === "__transport_error") throw new Error(`live 通道传输失败：${frame.data}`);
  if (frame.event !== "data") throw new Error(`首帧 event 应为 data，实际 ${frame.event}`);
  if (!reader.sawRetryFirst) throw new Error("SSE 流未以 retry: 3000 起始（§4.3 线协议违例）");
  const parsed = JSON.parse(frame.data);
  const ids = (parsed?.notes ?? []).map((n: any) => String(n?.id));
  const missing = SEED_IDS.filter((s) => !ids.includes(s));
  if (missing.length > 0) throw new Error(`首连全量帧缺种子行 ${missing.join(",")}（首连=全量重算）：${JSON.stringify(ids)}`);
}

/** task2/task3 R2：POST 成功（客户端 id）→ ≤1s 同一订阅收到含该 id 的 data 帧 */
async function checkR2(): Promise<void> {
  if (!sharedReader) throw new Error("R1 未建立订阅（前置判据未跑/未过）");
  const payload = { id: 20250920001, body: "push me" }; // 客户端生成正整数（brief v2：JSON number）
  const res = await post(CREATE_NAME, payload);
  if (res.status !== 200) throw new Error(`POST ${CREATE_NAME} 被拒：HTTP ${res.status} ${res.text.slice(0, 160)}`);
  if (String(res.json?.id) !== "20250920001") throw new Error(`成功载荷应含客户端 id（同 id 合并前提），实际 ${JSON.stringify(res.json)}`);
  const frame = await sharedReader.next(PUSH_WINDOW_MS); // 窗口起算 = POST 收到 2xx 响应（scenario-spec §4）
  if (!frame || frame.event !== "data") throw new Error(`${PUSH_WINDOW_MS}ms 窗口内未收到写后推送帧（coalesce~50ms + 传输时延后应到达）`);
  const ids = ((JSON.parse(frame.data)?.notes ?? []) as any[]).map((n) => String(n?.id));
  if (!ids.includes("20250920001")) throw new Error(`推送帧不含新行 id 20250920001：${JSON.stringify(ids)}`);
}

/** task2/task3 R3：违规 POST → ATR-201 四段式；live 通道无新帧且订阅保持 */
async function checkR3(): Promise<void> {
  if (!sharedReader) throw new Error("R1 未建立订阅（前置判据未跑/未过）");
  const res = await post(CREATE_NAME, { id: "m3fs-r3-bad", body: "" });
  if (res.status !== 400) throw new Error(`违规输入应 400，实际 HTTP ${res.status}`);
  const b = res.json ?? {};
  const fourPart = typeof b.code === "string" && typeof b.message === "string" && b.context != null && typeof b.fix === "string" && b.fix.length > 0;
  if (b.code !== "ATR-201" || !fourPart) throw new Error(`应答非 ATR-201 四段式 {code,message,context,fix}：${res.text.slice(0, 200)}`);
  const frame = await sharedReader.next(QUIET_WINDOW_MS);
  if (frame !== null) throw new Error(`失败路径 ${QUIET_WINDOW_MS}ms 静默窗口内 live 通道出现新帧（事件=${frame.event}）：${frame.data.slice(0, 120)}`);
  if (sharedReader.closed) throw new Error("live 订阅已断（失败路径订阅必须保持；断流重连语义归框架，组件不该亲手断）");
}

/** task1/task3 M7：挂载后 DOM 行内可见既有行 priority 值 */
async function checkM7(): Promise<void> {
  const rows = C_ROWS(TASK);
  installNetworkMocks(rows);
  try {
    const { container, es } = await mountNotesPage();
    if (es) {
      es.emit("data", JSON.stringify({ notes: rows })); // 组件若走 live 首帧形态（task3 常见）
      await flush();
    }
    const domRows = findByAttr(container, "data-note-id");
    if (domRows.length < rows.length) throw new Error(`行元素（data-note-id）不足：${domRows.length} < ${rows.length}；DOM=${serialize(container).slice(0, 300)}`);
    const row1 = findByAttr(container, "data-note-id", "101")[0];
    const row2 = findByAttr(container, "data-note-id", "202")[0];
    if (!row1 || !row2) throw new Error(`缺种子行元素 101/202：DOM=${serialize(container).slice(0, 300)}`);
    if (!row2.textContent.includes("7")) throw new Error(`202 行内未渲染 priority=7：行文本="${row2.textContent}"`);
    if (!row1.textContent.includes("3")) throw new Error(`101 行内未渲染 priority=3：行文本="${row1.textContent}"`);
  } finally {
    restoreNetworkMocks();
  }
}

/** task2/task3 C1：成功提交——待定先行 → 帧对账同 id 仅一次、状态已确认 */
async function checkC1(): Promise<void> {
  const rows = C_ROWS(TASK);
  installNetworkMocks(rows);
  try {
    const { container, es } = await mountNotesPage();
    if (!es) throw new Error("组件未建立 live 订阅（mock EventSource 无实例）——task2/3 客户端必须有 live 通道消费");
    es.emit("data", JSON.stringify({ notes: rows })); // 首连全量
    await flush();
    if (findByAttr(container, "data-note-id").length < rows.length) {
      throw new Error(`首帧后种子行未渲染：DOM=${serialize(container).slice(0, 300)}`);
    }
    // 挂起 POST：待定先行渲染断言必须发生在响应落地前（LiveNotes.spec 同款 deferred 手法）
    let reply: (r: MockReply) => void = () => {};
    createResponder = () => new Promise<MockReply>((res) => (reply = res));
    await driveSubmit(container, "hello m3fs");
    const call = fetchCalls.find((c) => c.url.includes(CREATE_NAME));
    if (!call) throw new Error("点击提交后未发出 notes.create 调用");
    const id = String(call.body.id ?? "");
    if (!id) throw new Error(`提交请求缺客户端 id（同 id 幂等合并的前提）：${JSON.stringify(call.body)}`);
    if (call.body.body !== "hello m3fs") throw new Error(`提交请求 body 不符：${JSON.stringify(call.body)}`);
    const pendingRow = findByAttr(container, "data-note-id", id)[0];
    if (!pendingRow) throw new Error(`待定行未以 data-note-id="${id}" 先行渲染：DOM=${serialize(container).slice(0, 300)}`);
    if (pendingRow.getAttribute("data-pending") !== "true") throw new Error(`待定行缺 data-pending="true"：DOM=${serialize(container).slice(0, 300)}`);
    // POST 2xx → live 推送（真相源）：窗口过后同 id 单行、已确认、服务端数据胜出
    reply({ status: 200, json: { ...call.body, createdAt: 33 } });
    await flush();
    es.emit("data", JSON.stringify({ notes: [...rows, { ...call.body, createdAt: 44 }] }));
    await flush();
    const merged = findByAttr(container, "data-note-id", id);
    if (merged.length !== 1) throw new Error(`对账后同 id 行数=${merged.length}（须恰好 1——无重复行）`);
    if (merged[0].getAttribute("data-pending") === "true") throw new Error("推送窗口过后行仍 pending（应已确认）");
    if (!merged[0].textContent.includes("hello m3fs")) throw new Error(`对账后行文本缺 body："${merged[0].textContent}"`);
    // 列表其余部分不被弄脏（task2 目标态第 3 条）
    for (const s of ["101", "202"]) {
      if (findByAttr(container, "data-note-id", s).length !== 1) throw new Error(`成功路径弄脏了既有行 ${s}`);
    }
  } finally {
    restoreNetworkMocks();
  }
}

/** task2/task3 C2：失败提交——待定项消失 + 回滚名单含 id + 错误态 fix 可见；既有行不被弄脏 */
async function checkC2(): Promise<void> {
  const rows = C_ROWS(TASK);
  installNetworkMocks(rows);
  try {
    const { container, es } = await mountNotesPage();
    if (!es) throw new Error("组件未建立 live 订阅（mock EventSource 无实例）");
    es.emit("data", JSON.stringify({ notes: rows }));
    await flush();
    createResponder = () => ({ status: 400, json: ATR201 }); // 立即失败注入
    await driveSubmit(container, "doomed note");
    const call = fetchCalls.find((c) => c.url.includes(CREATE_NAME));
    if (!call) throw new Error("点击提交后未发出 notes.create 调用");
    const id = String(call.body.id ?? "");
    if (!id) throw new Error(`提交请求缺客户端 id：${JSON.stringify(call.body)}`);
    // ① 待定项从列表消失
    const gone = findByAttr(container, "data-note-id", id);
    if (gone.length !== 0) throw new Error(`失败后待定行仍在列表（data-note-id="${id}"）——revert 未执行：DOM=${serialize(container).slice(0, 300)}`);
    // ② 回滚名单含该 id（data-rollbacked 元素，内容含被回滚 id）
    const rolled = findByAttr(container, "data-rollbacked");
    if (rolled.length === 0 || !rolled.some((el) => el.textContent.includes(id))) {
      throw new Error(`回滚名单（data-rollbacked 元素，内容含被回滚 id）缺失：DOM=${serialize(container).slice(0, 300)}`);
    }
    // ③ 错误信息（含 fix 提示）在 DOM 可见
    const text = container.textContent;
    if (!text.includes("ATR-201")) throw new Error(`错误态未呈现 ATR 码：DOM 文本="${text.slice(0, 300)}"`);
    if (!text.includes(ATR201.fix)) throw new Error(`错误态未呈现 fix 提示（"${ATR201.fix}"）：DOM 文本="${text.slice(0, 300)}"`);
    // ④ 既有行不被弄脏（task2 目标态第 3 条）
    for (const s of ["101", "202"]) {
      if (findByAttr(container, "data-note-id", s).length !== 1) throw new Error(`失败路径弄脏了既有行 ${s}`);
    }
  } finally {
    restoreNetworkMocks();
  }
}

/* ---------------- 用例编排（R 先 C 后；R 共用同一订阅——task2/3「场景续」） ---------------- */

(TASK && ATTEMPT && OUT ? describe : describe.skip)(`M3-FS acceptance [${TASK || "none"}]`, () => {
  if (isCreate(TASK)) {
    it("M4：notes.create 可选 priority（0-9）契约 + 落库一致 + 省略按 0", async () => {
      await judge("M4", "R", "notes.create 输入契约含可选 priority（0-9）；带 priority 调用落库值一致；省略按 0", checkM4);
    });
    it("M5：notes.list 返回行含 priority（200 = dev 态输出校验不红）", async () => {
      await judge("M5", "R", "notes.list 返回行含 priority（dev 态输出校验不红 = HTTP 200）", checkM5);
    });
  }

  if (hasLive(TASK)) {
    it("R1：SSE 订阅 live 通道，首连收到全量 data 帧", async () => {
      await judge("R1", "R", "SSE 订阅列表 live 通道，首连收到全量 data 帧", checkR1);
    });
    it("R2：POST 成功创建后 ≤1s 同一订阅收到含该 id 的 data 帧", async () => {
      await judge("R2", "R", "POST 成功创建（客户端 id）后 ≤1s 窗口内同一订阅收到含该 id 的 data 帧", checkR2);
    });
    it("R3：违规 POST 收 ATR-201 四段式；live 无新帧且订阅保持", async () => {
      await judge("R3", "R", "POST 违规输入收到 ATR-201 四段式，且 live 通道无新帧、订阅保持", checkR3);
    });
  }

  if (isCreate(TASK)) {
    it("M7：挂载后行内可见既有行 priority 值", async () => {
      await judge("M7", "C", "前端组件渲染优先级（挂载后行内可见既有行 priority 值）", checkM7);
    });
  }

  if (hasLive(TASK)) {
    it("C1：成功提交——待定先行 → 帧对账同 id 仅一次", async () => {
      await judge("C1", "C", "成功提交：待定项出现→推送窗口后列表含该 id 且仅一次、状态已确认", checkC1);
    });
    it("C2：失败提交——待定项消失 + 回滚名单 + 错误态 fix 可见", async () => {
      await judge("C2", "C", "失败提交：待定项消失、回滚名单含该 id、错误态含 fix 可见", checkC2);
    });
  }

  afterAll(async () => {
    sharedReader?.dispose();
    sharedReader = null;
    await stopServer();
    flushOut();
  });
});
