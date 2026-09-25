/**
 * openapi-golden.test.ts — FS-DESIGN §13 golden 判据机检：「用导出文档生成的请求打真实 server
 * 全端点通（文档即真相）」。
 *
 * 全链（零手改、零平行真相）：临时 fixture 应用（契约单源 + 3 个端点文件 6 端点，覆盖普通
 * query（输入+输出契约）/ command（reqProps+output+ctx.audit+emits）/ restful GET 映射 /
 * live{invalidate} / 无契约 query 五种形态）→ writeOpenApi 真实导出管线落盘 openapi.json →
 * **从盘上文档本身**逐 path×method 构造请求（「扁平投影 → 合法示例值」小生成器：enum→首项 /
 * number→1 夹取 [minimum,maximum] / boolean→true / string→固定候选串过 pattern 与长度界；
 * reqProps 全填；无法诚实生成 → 显式失败，绝不生成违约值）→ 打真实 loopback server：
 * node-host serve()（port 0 + ATELIER_SERVER_READY 握手行）拉起子进程——与 dev 托管子进程
 * 同源启动壳（D-F14 单源），fixture 端点由子进程经 EndpointRegistry 显式注册。
 *
 * 逐形态断言：
 *   · POST（query/command 同走 POST）：2xx + x-atelier-endpoint 头 + 响应过框架 validateFlat
 *     二次校验（契约单源经 scanContractSchemas 解析——与导出同一扫描器，无第二真相）；
 *   · restful GET 映射（§3.4 互操作位）：按文档 GET+query parameters 构造真 GET（文档注记
 *     「运行时传输仍为 POST」→ 期望 405 ATR-311），再按注记以同值走 POST 全通；
 *   · live（x-atelier-live）：GET /live?input=… 读 SSE 流首个 event: data 帧（§4.3 线协议：
 *     首帧 retry: 3000 先行），断言 JSON 可解析 + 过输出契约后关闭；
 *   · 端点集探针：POST 未知路径 → ATR-310 的 context.hints = server 注册表名集 → 与文档
 *     paths 双向比对（文档端点集 ≡ server 端点集，文档机检不是单行道）。
 *
 * 漂移红证（§14.2 不假红——证明请求真的由文档驱动、server 真的在校验）：
 *   ①-A server 新增端点未重导出 → 只迭代文档路径的 naive 驱动是假绿盲区 → 探针集合比对必须红；
 *   ①-B server 删端点未重导出 → 文档生成的请求吃 ATR-310 红 + 集合比对红；
 *   ②   篡改文档删必填字段 → 文档骗客户端生成缺字段请求 → server ATR-201 被显式断言出来。
 *   两个负例的断言敏感性已验（致盲法）：临时注释集合比对 / 放宽状态码判据 → 恰好三条负例变红、
 *   golden 全通仍绿；恢复后全绿——负例不假红。
 *
 * golden 跑出的真实 bug（已红绿修复）：scanOpenApiEndpoints 曾不认泛型标注形态
 * defineCommand&lt;Input, Output>(…)——模板 example.ts 的 app.echo 即此形态，整端点漏导出；
 * 修复 + 扫描器单测钉在 openapi.test.ts（同目录扫描器 describe）。
 *
 * auth 联测段（FS-M4 诚实边界关闭，2026-09-25 先红后绿）：主 golden 夹具升级为 init → gen auth →
 * migrate up 全链（扫描面加法纳入 src/server/auth/endpoints.ts），golden 流程新增 auth 段：
 * 导出文档含 auth 三端点 → auth.me 匿名 401 ATR-340 → login 错误凭据 401 且不种 cookie →
 * login（body 字段集由文档 requestBody $ref 驱动，真实凭据由夹具种子提供——凭据永不进文档）
 * 200 + Set-Cookie 入手工 jar → securitySchemes.session 与实际 Set-Cookie cookie 名对拍 →
 * 携 cookie 打 auth.me 200 且过输出契约（FlatSchema 复用导出扫描器的本地解析——无第二真相）→
 * auth.logout 200 + 清 cookie（Max-Age=0）→ me 再打 401 ATR-340（会话已销毁）。
 * 扫描器侧为此落地的行为差修复（同批红绿）：gen auth 产物三形态——①端点级内联契约字面量
 * （login contract/output、logout output——auth 扫描面放行解析，src/server/endpoints/ 用户端点
 * 的行内字面量禁令不变）②auth.me 的 `pick(users.rowSchema, […])` 本地投影（经框架 server/db.ts
 * 的 table()/pick() 用运行时同一实现重构，绝不复刻列→FlatSchema 映射）③auth: { type: "none" }
 * 显式免鉴权 → 无 security 引用、不进 securitySchemes；securitySchemes.session 的 cookie 名从
 * gen auth 产物 cookie.ts 的 SESSION_COOKIE 实读（曾硬编码 "session"，与实际 "atelier_session"
 * 漂移——被本联测对拍抓出后修复）。
 *
 * 诚实边界：command ctx.audit 的 journal 入账在子进程内，本测试不可
 * 内省（server-v2.test.ts 进程内已钉）；bun 宿主桥不在本文件（sqlite.ts 同款挂账）；
 * api.ts 类型化客户端（gen endpoint）不覆盖 auth 端点属另一挂账面（gen-auth 产物头注同款边界）。
 * skip 策略：宿主 node < 23.6（无默认 type stripping，子进程跑不了 .ts fixture）→ 整组诚实 skip。
 * 纪律（§14.2）：全部 127.0.0.1、listen 一律 port 0；用例收尾 stop() 杀子进程，afterAll 兜底
 * 收尸后才删临时目录（Windows 孤儿进程零容忍，dev-server-host.test.ts 同款）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOpenApi, scanContractSchemas, writeOpenApi } from "../gen/export-openapi.mjs";
import { validateFlat, type FlatSchema } from "../runtime/contract.ts";

const FRAMEWORK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const SERVER_INDEX = path.join(FRAMEWORK, "server", "index.ts");
const CLI = path.join(FRAMEWORK, "cli.mjs");
const MOUNT = "/api"; // golden 标准装配：与 writeOpenApi/子进程启动壳共用同一挂载事实

/** auth 联测段夹具常量：凭据只进夹具种子与测试（凭据永不进导出文档——golden 纪律） */
const AUTH_CREDS = { email: "golden@atelier.dev", password: "golden-pass" };
const AUTH_DB_REL = path.join(".atelier", "golden.db"); // migrate up --db 与启动壳 openSqlite 共用同一库文件

/** node ≥23.6 才默认启用 type stripping（子进程要直跑 .ts fixture 与框架 server 面） */
const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split(".").map(Number);
const TYPE_STRIPPING_OK = NODE_MAJOR! > 23 || (NODE_MAJOR === 23 && NODE_MINOR! >= 6);
const d: typeof describe = TYPE_STRIPPING_OK ? describe : describe.skip;

/* ---------------- fixture：临时应用（契约单源 + 端点文件 + 子进程启动壳） ---------------- */

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

const serverIndexUrl = JSON.stringify(pathToFileURL(SERVER_INDEX).href);

/** 契约单源（真实应用同形态：import type + satisfies——type stripping 下 type import 被擦除） */
function contractSource(): string {
  return `import type { FlatSchema } from ${JSON.stringify(pathToFileURL(path.join(FRAMEWORK, "runtime", "contract.ts")).href)};

export const chatAskInput = {
  type: "object",
  reqProps: { chatId: { type: "number", min: 1 }, content: { type: "string", min: 1, max: 140, pattern: "^[a-z]" } },
  optProps: { tags: { type: "array", items: { type: "string" }, max: 5 } },
} satisfies FlatSchema;

export const chatMessage = {
  type: "object",
  reqProps: { id: { type: "number" }, chatId: { type: "number" }, role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string" } },
} satisfies FlatSchema;

export const chatStreamInput = {
  type: "object",
  reqProps: { chatId: { type: "number", min: 1 } },
} satisfies FlatSchema;

export const chatStreamStats = {
  type: "object",
  reqProps: { chatId: { type: "number" }, count: { type: "number" } },
} satisfies FlatSchema;

export const browseListInput = {
  type: "object",
  reqProps: { chatId: { type: "number", min: 1 } },
  optProps: { limit: { type: "number", max: 100 } },
} satisfies FlatSchema;

export const browseListStats = {
  type: "object",
  reqProps: { total: { type: "number" } },
} satisfies FlatSchema;
`;
}

function chatSource(): string {
  return `import { defineCommand, defineQuery } from ${serverIndexUrl};
import { chatAskInput, chatMessage, chatStreamInput, chatStreamStats } from "../../contract.ts";

export const chatAsk = defineCommand<{ chatId: number; content: string }, { id: number; chatId: number; role: string; content: string }>("chat.ask", {
  contract: chatAskInput,
  output: chatMessage,
  emits: ["table:messages"],
  handler: async (input, ctx) => {
    ctx.audit("golden:chat.ask 入账");
    return { id: 1, chatId: input.chatId, role: "user", content: input.content };
  },
});

export const chatGet = defineQuery<{ chatId: number; content: string }, { id: number; chatId: number; role: string; content: string }>("chat.get", {
  contract: chatAskInput,
  output: chatMessage,
  handler: (input) => ({ id: 2, chatId: input.chatId, role: "assistant", content: input.content }),
});

export const chatStream = defineQuery<{ chatId: number }, { chatId: number; count: number }>("chat.stream", {
  contract: chatStreamInput,
  output: chatStreamStats,
  live: { invalidate: ["table:messages"] },
  handler: (input) => ({ chatId: input.chatId, count: 1 }),
});
`;
}

function browseSource(): string {
  return `import { defineQuery } from ${serverIndexUrl};
import { browseListInput, browseListStats } from "../../contract.ts";

export const browseList = defineQuery<{ chatId: number; limit?: number }, { total: number }>("browse.list", {
  contract: browseListInput,
  output: browseListStats,
  restful: true,
  handler: (input) => ({ total: input.limit ?? 0 }),
});
`;
}

function metaSource(extra: boolean): string {
  return `import { defineQuery } from ${serverIndexUrl};

export const metaPing = defineQuery("meta.ping", {
  handler: () => ({ pong: true }),
});
${extra ? `
export const metaExtra = defineQuery("meta.extra", {
  handler: () => ({ extra: true }),
});
` : ""}`;
}

/** auth 变体启动壳：gen auth 产物装配位（auth.ts 头注释同款：registerAuthEndpoints + createSessionReader 显式注入） */
function authBootstrapSource(root: string): string {
  return `import { EndpointRegistry, openSqlite, serve } from "./src/vendor/atelier/server/index.ts";
import * as chatEndpoints from "./src/server/endpoints/chat.ts";
import * as browseEndpoints from "./src/server/endpoints/browse.ts";
import * as metaEndpoints from "./src/server/endpoints/meta.ts";
import { registerAuthEndpoints } from "./src/server/auth/endpoints.ts";
import { createSessionReader, createUser, findUserByEmail } from "./src/server/auth/auth.ts";

const db = await openSqlite(${JSON.stringify(path.join(root, AUTH_DB_REL))});
const registry = new EndpointRegistry();
registerAuthEndpoints(registry); // auth.login / auth.logout / auth.me（gen auth 产物装配位，无 import 副作用魔法）
for (const mod of [chatEndpoints, browseEndpoints, metaEndpoints]) {
  for (const value of Object.values(mod)) {
    const def = value as { kind?: unknown; name?: unknown; handler?: unknown };
    if ((def.kind === "query" || def.kind === "command") && typeof def.name === "string" && typeof def.handler === "function") {
      registry.register(def as never);
    }
  }
}
// golden 凭据种子：走 gen auth 产物自己的 createUser（scrypt 哈希——测试不手写平行哈希实现）
if (findUserByEmail(db, ${JSON.stringify(AUTH_CREDS.email)}) == null) {
  await createUser(db, ${JSON.stringify(AUTH_CREDS.email)}, ${JSON.stringify(AUTH_CREDS.password)}, "golden");
}
const handler = registry.createHandler({ mount: ${JSON.stringify(MOUNT)}, db, auth: createSessionReader(db) }); // ← 显式装配
await serve(handler, { port: 0 });
`;
}

/** 通用启动壳（与 dev 托管子进程同源：serve() 即 D-F14 启动壳单源） */
function bootstrapSource(): string {
  return `import { EndpointRegistry } from ${serverIndexUrl};
import { serve } from ${JSON.stringify(pathToFileURL(path.join(FRAMEWORK, "server", "node-host.ts")).href)};
import * as chatEndpoints from "./src/server/endpoints/chat.ts";
import * as browseEndpoints from "./src/server/endpoints/browse.ts";
import * as metaEndpoints from "./src/server/endpoints/meta.ts";

const registry = new EndpointRegistry();
for (const mod of [chatEndpoints, browseEndpoints, metaEndpoints]) {
  for (const value of Object.values(mod)) {
    const def = value as { kind?: unknown; name?: unknown; handler?: unknown };
    if ((def.kind === "query" || def.kind === "command") && typeof def.name === "string" && typeof def.handler === "function") {
      registry.register(def as never);
    }
  }
}
const handler = registry.createHandler({ mount: ${JSON.stringify(MOUNT)} });
await serve(handler, { port: 0 });
`;
}

function makeGoldenApp(opts: { auth?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-openapi-golden-"));
  tmpRoots.push(root);
  if (opts.auth === true) {
    // init 全链：vendor 布局是 gen auth 产物 import 面（../../vendor/atelier/*）的前提——
    // 纯文件组装（无 pnpm install：server 子进程只吃 .ts 直跑与 vendor 相对导入）
    const r = spawnSync(process.execPath, [CLI, "init", "--target", root, "--name", "GoldenAuthFs", "--no-ai"], { cwd: FRAMEWORK, encoding: "utf8", windowsHide: true });
    if (r.status !== 0) throw new Error(`atelier init 失败（exit ${r.status}）：\n${r.stdout?.slice(-800)}\n${r.stderr?.slice(-800)}`);
    expect(fs.existsSync(path.join(root, "src", "vendor", "atelier", "server", "index.ts"))).toBe(true);
    // 模板示例端点清场（example.ts/notes.ts）——golden 文档端点集必须由夹具自身决定，不耦合模板演进
    for (const f of fs.readdirSync(path.join(root, "src", "server", "endpoints"))) {
      fs.rmSync(path.join(root, "src", "server", "endpoints", f), { force: true });
    }
  }
  w(root, "src/contract.ts", contractSource());
  w(root, "src/server/endpoints/chat.ts", chatSource());
  w(root, "src/server/endpoints/browse.ts", browseSource());
  w(root, "src/server/endpoints/meta.ts", metaSource(false));
  w(root, "golden-server.ts", opts.auth === true ? authBootstrapSource(root) : bootstrapSource());
  if (opts.auth === true) {
    const run = (args: string[]) => {
      const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { cwd: FRAMEWORK, encoding: "utf8", windowsHide: true });
      if (r.status !== 0) throw new Error(`atelier ${args.join(" ")} 失败（exit ${r.status}）：\n${r.stdout?.slice(-800)}\n${r.stderr?.slice(-800)}`);
    };
    run(["gen", "auth"]); // 产物：src/server/auth/*（sessions.table/cookie/auth/endpoints）+ 001_auth 迁移对
    run(["migrate", "up", "--db", AUTH_DB_REL]); // users/sessions 表落库（auth.login 的 findUserByEmail 前提）
  }
  return root;
}

/* ---------------- 真实 server：spawn 子进程 + 握手行取实际端口 + 可靠收尸 ---------------- */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function startGoldenServer(root: string): Promise<{ port: number; stop: () => Promise<void> }> {
  const proc = spawn(process.execPath, [path.join(root, "golden-server.ts")], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
    if (proc.exitCode !== null) throw new Error(`golden server 提前退出（exit ${proc.exitCode}）：\n${out}\n${err}`);
    if (Date.now() > deadline) throw new Error(`golden server 15s 未就绪：\n${out}\n${err}`);
    await sleep(25);
  }
}

/* ---------------- 文档驱动的请求构造（只读盘上 openapi.json——文档即真相） ---------------- */

type JsonSchemaLeaf = {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  pattern?: string;
  items?: JsonSchemaLeaf;
};
type JsonSchemaObject = { type?: string; properties?: Record<string, JsonSchemaLeaf>; required?: string[] };
type OperationObject = {
  parameters?: Array<{ name: string; in?: string; required?: boolean; schema?: JsonSchemaLeaf }>;
  requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
  responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  "x-atelier-restful"?: boolean;
  "x-atelier-live"?: boolean;
};
type PathItem = { get?: OperationObject; post?: OperationObject };
type OpenApiDoc = { paths: Record<string, PathItem>; components?: { schemas?: Record<string, JsonSchemaObject> } };

type GoldenFailure = { endpoint: string; step: string; kind: "status" | "transport" | "contract" | "drift"; message: string };
type GoldenResult = {
  ok: boolean;
  failures: GoldenFailure[];
  /** 机器可查的覆盖清单：探针/每端点 POST/restful GET 形/live SSE 首帧逐一入账 */
  checked: string[];
  docNames: string[];
  serverNames: string[];
  /** 被专用联测段接管而跳过通用文档驱动环的端点名（跳过必须显式入账——不假装跑过） */
  skipped: string[];
};

/** 「扁平投影 → 合法示例值」小生成器（对投影后关键字工作——请求真的由文档生成） */
function genLeaf(s: JsonSchemaLeaf): unknown {
  if (s.enum && s.enum.length > 0) return s.enum[0];
  switch (s.type) {
    case "number": {
      let v = 1;
      if (typeof s.minimum === "number" && v < s.minimum) v = s.minimum;
      if (typeof s.maximum === "number" && v > s.maximum) v = s.maximum;
      return v;
    }
    case "boolean":
      return true;
    case "array": {
      const n = Math.max(1, typeof s.minItems === "number" ? s.minItems : 1);
      return Array.from({ length: n }, () => (s.items ? genLeaf(s.items) : "golden"));
    }
    default: {
      const candidates = ["golden", "abcdef", "sample", "a"];
      let v = s.pattern ? candidates.find((c) => new RegExp(s.pattern!).test(c)) : "golden";
      if (v === undefined) throw new Error(`示例值生成器：pattern /${s.pattern}/ 无固定候选串命中（诚实失败，绝不生成违约值）`);
      if (typeof s.minLength === "number") v = v.padEnd(s.minLength, "x");
      if (typeof s.maxLength === "number" && v.length > s.maxLength) v = v.slice(0, s.maxLength);
      return v;
    }
  }
}

function genBody(projected: JsonSchemaObject): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of projected.required ?? []) {
    const leaf = projected.properties?.[key];
    if (!leaf) throw new Error(`文档内部不自洽：required "${key}" 无 properties 描述`);
    body[key] = genLeaf(leaf);
  }
  return body;
}

async function postJson(url: string, body: unknown, cookie?: string): Promise<{ status: number; headers: Headers; json: any; text: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 诚实保留 null——由调用方记失败 */
  }
  return { status: res.status, headers: res.headers, json, text };
}

/** 读 SSE 流到首个 event: data 帧即返回（调用方 finally abort 关闭——§4.3 golden 级验证） */
async function readFirstLiveDataFrame(url: string): Promise<{ retryFirst: boolean; data: unknown }> {
  const ac = new AbortController();
  const res = await fetch(url, { signal: ac.signal, headers: { accept: "text/event-stream" } });
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.includes("text/event-stream")) {
    ac.abort();
    const text = await res.text().catch(() => "");
    throw new Error(`live 订阅非 SSE 响应：HTTP ${res.status} ct=${ct} body=${text.slice(0, 160)}`);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const blocks = buf.split("\n\n").slice(0, -1); // 只认完整帧（尾块可能被 chunk 边界截断）
      for (const block of blocks) {
        const lines = block.split("\n");
        if (!lines.includes("event: data")) continue;
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!dataLine) throw new Error("event: data 帧缺 data 行（§4.3 线协议违例）");
        return { retryFirst: buf.startsWith("retry: 3000\n\n"), data: JSON.parse(dataLine.slice("data: ".length)) };
      }
    }
    throw new Error("SSE 流结束仍未收到 event: data 帧");
  } finally {
    ac.abort();
    await reader.cancel().catch(() => {});
  }
}

/** golden harness：读盘上文档 → 探针集合比对 → 逐 path×method 构造请求打真实 server
 *  （opts.skipNames：交给专用联测段的端点名——跳过显式入账 skipped，集合比对仍然双向覆盖） */
async function runGoldenHarness(root: string, baseUrl: string, opts: { skipNames?: string[] } = {}): Promise<GoldenResult> {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8")) as OpenApiDoc;
  const contracts = scanContractSchemas(root).byIdent as Record<string, { value?: FlatSchema }>;
  const skipNames = new Set(opts.skipNames ?? []);
  const skipped: string[] = [];
  const failures: GoldenFailure[] = [];
  const checked: string[] = [];
  const f = (failure: GoldenFailure) => failures.push(failure);

  // ① 端点集探针：ATR-310 的 context.hints = server 注册表名集 → 与文档 paths 双向比对
  const docNames = Object.keys(doc.paths).map((p) => {
    if (!p.startsWith(MOUNT + "/")) throw new Error(`文档路径 ${p} 不在挂载前缀 ${MOUNT} 下`);
    return p.slice(MOUNT.length + 1);
  }).sort();
  let serverNames: string[] = [];
  try {
    const probe = await postJson(`${baseUrl}${MOUNT}/__atelier_golden_probe`, {});
    if (probe.status !== 404 || probe.json?.code !== "ATR-310") {
      f({ endpoint: "(探针)", step: "端点集探针", kind: "transport", message: `探针响应异常：HTTP ${probe.status} ${probe.text.slice(0, 120)}` });
    } else {
      serverNames = ((probe.json?.context?.hints ?? []) as unknown[]).map(String).sort();
    }
  } catch (e) {
    f({ endpoint: "(探针)", step: "端点集探针", kind: "transport", message: `探针请求失败：${(e as Error).message}` });
  }
  checked.push("probe:endpoint-set");
  for (const n of docNames) {
    if (!serverNames.includes(n)) f({ endpoint: n, step: "端点集比对", kind: "drift", message: `文档端点 ${n} 不在 server 注册表（文档骗了客户端——该请求必失败）` });
  }
  for (const n of serverNames) {
    if (!docNames.includes(n)) f({ endpoint: n, step: "端点集比对", kind: "drift", message: `server 端点 ${n} 未进导出文档（文档漏导出——naive 文档驱动的机检盲区）` });
  }

  // ② 逐 path×method：从文档本身构造请求打真实 server
  for (const [pathKey, item] of Object.entries(doc.paths)) {
    const name = pathKey.slice(MOUNT.length + 1);
    if (skipNames.has(name)) {
      skipped.push(name); // 专用联测段接管（如 auth.*——有状态 cookie 流，通用环无法诚实驱动）
      continue;
    }
    try {
      const op = item.post ?? item.get;
      if (!op) {
        f({ endpoint: name, step: "文档解析", kind: "transport", message: `path ${pathKey} 无 post/get operation` });
        continue;
      }
      const body: Record<string, unknown> = {};
      if (op["x-atelier-restful"] === true) {
        // §3.4 互操作形：按文档 GET+query 映射构造真 GET（文档注记「运行时传输仍为 POST」→ 期望 405 ATR-311）
        const qs = new URLSearchParams();
        for (const p of op.parameters ?? []) if (p.required && p.schema) qs.set(p.name, String(genLeaf(p.schema)));
        try {
          const g = await fetch(`${baseUrl}${pathKey}?${qs.toString()}`);
          const gj: any = await g.json().catch(() => null);
          if (!(g.status === 405 && gj?.code === "ATR-311")) {
            f({ endpoint: name, step: "restful GET 形", kind: "status", message: `restful GET 形未按文档注记被拒（期望 405 ATR-311——运行时传输仍为 POST）：HTTP ${g.status}` });
          }
        } catch (e) {
          f({ endpoint: name, step: "restful GET 形", kind: "transport", message: (e as Error).message });
        }
        checked.push(`restful:${name}:GET-shape`);
        for (const p of op.parameters ?? []) if (p.required && p.schema) body[p.name] = genLeaf(p.schema); // 同值按注记走 POST
      } else if (op.requestBody?.content?.["application/json"]?.schema?.$ref) {
        const ident = op.requestBody.content["application/json"].schema!.$ref!.split("/").pop()!;
        const projected = doc.components?.schemas?.[ident];
        if (!projected) f({ endpoint: name, step: "文档解析", kind: "transport", message: `requestBody $ref ${ident} 不在 components.schemas（文档内部不自洽）` });
        else Object.assign(body, genBody(projected));
      }

      // POST：2xx + 端点头 + 输出契约二次校验
      const r = await postJson(`${baseUrl}${pathKey}`, body);
      if (r.status !== 200) {
        const code = r.json?.code ?? r.json?.error?.code ?? "(无错误码)";
        const msg = r.json?.message ?? r.json?.error?.message ?? r.text.slice(0, 160);
        f({ endpoint: name, step: "POST", kind: "status", message: `文档生成的请求被 server 拒绝：HTTP ${r.status} ${code}: ${msg}` });
      } else {
        if (r.headers.get("x-atelier-endpoint") !== name) {
          f({ endpoint: name, step: "POST", kind: "transport", message: `x-atelier-endpoint 头 ${r.headers.get("x-atelier-endpoint")} ≠ ${name}` });
        }
        if (r.json == null) f({ endpoint: name, step: "POST", kind: "contract", message: "200 响应体不是合法 JSON" });
        const outRef = op.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
        if (outRef) {
          const flat = contracts[outRef.split("/").pop()!]?.value;
          if (!flat) f({ endpoint: name, step: "POST", kind: "contract", message: `响应 $ref ${outRef} 无法从契约单源解析为 FlatSchema` });
          else {
            const v = validateFlat(flat, r.json as Record<string, unknown>, name);
            if (!v.ok) f({ endpoint: name, step: "POST", kind: "contract", message: `响应不过输出契约：${v.error?.message}` });
          }
        }
      }
      checked.push(`post:${name}`);

      // live：x-atelier-live → GET /live SSE 首帧（§4.3：retry 帧先行 + data 可解析 + 过输出契约）
      if (op["x-atelier-live"] === true) {
        const inputQs = Object.keys(body).length > 0 ? `?input=${encodeURIComponent(JSON.stringify(body))}` : "";
        try {
          const frame = await readFirstLiveDataFrame(`${baseUrl}${pathKey}/live${inputQs}`);
          if (!frame.retryFirst) f({ endpoint: name, step: "live SSE", kind: "contract", message: "SSE 流首帧不是 retry: 3000（§4.3 线协议违例）" });
          const outRef = op.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
          if (outRef) {
            const flat = contracts[outRef.split("/").pop()!]?.value;
            if (!flat) f({ endpoint: name, step: "live SSE", kind: "contract", message: `live 输出 $ref ${outRef} 无法从契约单源解析为 FlatSchema` });
            else {
              const v = validateFlat(flat, frame.data as Record<string, unknown>, name);
              if (!v.ok) f({ endpoint: name, step: "live SSE", kind: "contract", message: `live data 帧不过输出契约：${v.error?.message}` });
            }
          }
        } catch (e) {
          f({ endpoint: name, step: "live SSE", kind: "transport", message: (e as Error).message });
        }
        checked.push(`live:${name}:data-frame`);
      }
    } catch (e) {
      f({ endpoint: name, step: "golden 步进", kind: "transport", message: (e as Error).message });
    }
  }

  return { ok: failures.length === 0, failures, checked, docNames, serverNames, skipped };
}

/* ---------------- auth 联测段：登录→会话→登出全流（FS-M4 诚实边界关闭） ---------------- */

type AuthSegResult = { ok: boolean; failures: GoldenFailure[]; checked: string[] };

/**
 * auth 端点联测段：文档形态对拍（paths/security/securitySchemes.cookie 名）+ 真实 cookie 流
 * （手工 jar：login Set-Cookie → me 携 cookie → logout 清 → me 401）。响应契约校验用
 * buildOpenApi 返回的本地解析 FlatSchema（与导出同一扫描器、同一 §2.4 投影输入——无第二真相）。
 */
async function runAuthGoldenSegment(root: string, baseUrl: string): Promise<AuthSegResult> {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8")) as OpenApiDoc & {
    components?: { schemas?: Record<string, JsonSchemaObject>; securitySchemes?: Record<string, { type?: string; in?: string; name?: string }> };
  };
  const localSchemas = (buildOpenApi(root) as { localSchemas?: Record<string, FlatSchema> }).localSchemas ?? {};
  const failures: GoldenFailure[] = [];
  const checked: string[] = [];
  const f = (failure: GoldenFailure) => failures.push(failure);
  const urlOf = (name: string) => `${baseUrl}${MOUNT}/${name}`;

  // ① 文档形态：auth 三端点在 paths；security 投影对拍（none = 显式免鉴权 → 无 security 引用）
  for (const name of ["auth.login", "auth.logout", "auth.me"]) {
    if (!doc.paths[`${MOUNT}/${name}`]?.post) {
      f({ endpoint: name, step: "auth 文档形态", kind: "drift", message: `导出文档缺 ${name}（扫描面未覆盖 src/server/auth/endpoints.ts）` });
    }
  }
  checked.push("auth-doc:paths");
  const loginOp = doc.paths[`${MOUNT}/auth.login`]?.post;
  const meOp = doc.paths[`${MOUNT}/auth.me`]?.post;
  const logoutOp = doc.paths[`${MOUNT}/auth.logout`]?.post;
  if (loginOp && loginOp.security !== undefined) {
    f({ endpoint: "auth.login", step: "auth 文档形态", kind: "contract", message: `auth: { type: "none" }（显式免鉴权）不应产生 security 引用：${JSON.stringify(loginOp.security)}` });
  }
  for (const [name, op] of [["auth.me", meOp], ["auth.logout", logoutOp]] as const) {
    if (op && JSON.stringify(op.security) !== JSON.stringify([{ session: [] }])) {
      f({ endpoint: name, step: "auth 文档形态", kind: "contract", message: `auth: { type: "session" } 的 security 引用异常：${JSON.stringify(op.security)}` });
    }
  }
  checked.push("auth-doc:security-projection");

  // ② me 匿名（无 cookie）→ 401 ATR-340（分发层拦截在 handler 之前）
  const anon = await postJson(urlOf("auth.me"), {});
  if (!(anon.status === 401 && anon.json?.code === "ATR-340")) {
    f({ endpoint: "auth.me", step: "匿名拦截", kind: "status", message: `期望 401 ATR-340，实际 HTTP ${anon.status} ${anon.text.slice(0, 120)}` });
  }
  checked.push("auth:me:401-anon");

  // ③ login 错误凭据 → 401 ATR-340 + 不种 cookie（失败路径无 Set-Cookie——gen auth 端点注释同款纪律）
  const bad = await postJson(urlOf("auth.login"), { email: AUTH_CREDS.email, password: "wrong-password" });
  if (!(bad.status === 401 && bad.json?.code === "ATR-340")) {
    f({ endpoint: "auth.login", step: "错误凭据", kind: "status", message: `期望 401 ATR-340，实际 HTTP ${bad.status} ${bad.text.slice(0, 120)}` });
  }
  if ((bad.headers.getSetCookie?.() ?? []).length > 0) {
    f({ endpoint: "auth.login", step: "错误凭据", kind: "contract", message: "登录失败路径不得 Set-Cookie（失败路径不种会话）" });
  }
  checked.push("auth:login:401-wrong-password");

  // ④ login（body 字段集由文档 requestBody $ref 驱动）→ 200 + Set-Cookie 入 jar + 响应过 login.output 契约
  const inputRef = loginOp?.requestBody?.content?.["application/json"]?.schema?.$ref;
  const inputSchema = inputRef ? doc.components?.schemas?.[inputRef.split("/").pop()!] : undefined;
  if (JSON.stringify([...(inputSchema?.required ?? [])].sort()) !== JSON.stringify(["email", "password"])) {
    f({ endpoint: "auth.login", step: "文档形状", kind: "contract", message: `requestBody $ref ${inputRef ?? "(缺)"} 的 required 与真实凭据字段（email/password）不一致：${JSON.stringify(inputSchema?.required ?? null)}` });
  }
  const login = await postJson(urlOf("auth.login"), { email: AUTH_CREDS.email, password: AUTH_CREDS.password });
  const setCookies = login.headers.getSetCookie?.() ?? [];
  const sessionSet = setCookies.find((c) => /^(?:atelier_session|session)=/.test(c));
  let jar: string | null = null;
  if (!(login.status === 200 && login.json?.ok === true)) {
    f({ endpoint: "auth.login", step: "登录", kind: "status", message: `期望 200 { ok: true }，实际 HTTP ${login.status} ${login.text.slice(0, 120)}` });
  }
  const loginFlat = localSchemas["auth.login.output"];
  if (!loginFlat) {
    f({ endpoint: "auth.login", step: "登录", kind: "contract", message: "auth.login.output 不在导出扫描器本地解析 schema（内联 output 字面量未被解析）" });
  } else {
    const v = validateFlat(loginFlat, (login.json ?? {}) as Record<string, unknown>, "auth.login");
    if (!v.ok) f({ endpoint: "auth.login", step: "登录", kind: "contract", message: `登录响应不过 output 契约：${v.error?.message}` });
  }
  if (!sessionSet) {
    f({ endpoint: "auth.login", step: "登录", kind: "transport", message: `成功登录无 Set-Cookie（headers.getSetCookie = ${JSON.stringify(setCookies)}）` });
  } else {
    jar = sessionSet.split(";")[0] ?? null; // 手工 jar：name=value 原样回传（HttpOnly 等属性归服务端）
  }
  checked.push("auth:login:200:set-cookie");

  // ⑤ securitySchemes.session 对拍实际行为：cookie 名（曾硬编码 "session" 漂移——此处抓出）
  const scheme = doc.components?.securitySchemes?.session;
  const actualCookieName = sessionSet?.split("=")[0] ?? null;
  if (!scheme || scheme.type !== "apiKey" || scheme.in !== "cookie" || !scheme.name) {
    f({ endpoint: "(securitySchemes)", step: "对拍", kind: "contract", message: `导出文档缺 session 方案或形态异常：${JSON.stringify(scheme ?? null)}` });
  } else if (actualCookieName != null && scheme.name !== actualCookieName) {
    f({ endpoint: "(securitySchemes)", step: "对拍", kind: "contract", message: `securitySchemes.session.name「${scheme.name}」≠ 实际 Set-Cookie cookie 名「${actualCookieName}」（文档骗客户端——携错名 cookie 将永远 401）` });
  }
  checked.push("auth-doc:security-scheme-vs-set-cookie");

  // ⑥ me 携 cookie → 200 + { email, role } 过 auth.me.output 契约 + 主体即登录者
  const me = await postJson(urlOf("auth.me"), {}, jar ?? undefined);
  if (me.status !== 200) {
    f({ endpoint: "auth.me", step: "携 cookie", kind: "status", message: `期望 200，实际 HTTP ${me.status} ${me.text.slice(0, 120)}` });
  }
  const meFlat = localSchemas["auth.me.output"];
  if (!meFlat) {
    f({ endpoint: "auth.me", step: "携 cookie", kind: "contract", message: "auth.me.output 不在导出扫描器本地解析 schema（pick(rowSchema, […]) 投影未被解析）" });
  } else {
    const v = validateFlat(meFlat, (me.json ?? {}) as Record<string, unknown>, "auth.me");
    if (!v.ok) f({ endpoint: "auth.me", step: "携 cookie", kind: "contract", message: `me 响应不过 output 契约：${v.error?.message}` });
  }
  if (me.json?.email !== AUTH_CREDS.email) {
    f({ endpoint: "auth.me", step: "携 cookie", kind: "contract", message: `会话主体 ${JSON.stringify(me.json?.email ?? null)} ≠ 登录者 ${AUTH_CREDS.email}` });
  }
  checked.push("auth:me:200:contract");

  // ⑦ logout 携 cookie → 200 + 清 cookie（Max-Age=0）
  const logout = await postJson(urlOf("auth.logout"), {}, jar ?? undefined);
  const clearCookie = (logout.headers.getSetCookie?.() ?? []).find((c) => /Max-Age=0/.test(c));
  if (!(logout.status === 200 && logout.json?.ok === true)) {
    f({ endpoint: "auth.logout", step: "登出", kind: "status", message: `期望 200 { ok: true }，实际 HTTP ${logout.status} ${logout.text.slice(0, 120)}` });
  }
  if (!clearCookie) {
    f({ endpoint: "auth.logout", step: "登出", kind: "contract", message: `登出响应无 Max-Age=0 清除 cookie：${JSON.stringify(logout.headers.getSetCookie?.() ?? [])}` });
  }
  checked.push("auth:logout:200:clear-cookie");

  // ⑧ me 再打 → 401 ATR-340（会话已销毁——cookie 残留也不认）
  const after = await postJson(urlOf("auth.me"), {}, jar ?? undefined);
  if (!(after.status === 401 && after.json?.code === "ATR-340")) {
    f({ endpoint: "auth.me", step: "登出后", kind: "status", message: `期望 401 ATR-340（会话已销毁），实际 HTTP ${after.status} ${after.text.slice(0, 120)}` });
  }
  checked.push("auth:me:401-after-logout");

  return { ok: failures.length === 0, failures, checked };
}

/* ---------------- 用例 ---------------- */

d("FS-9 §13 OpenAPI golden：导出文档生成的请求打真实 server 全端点通（文档即真相）", () => {
  it(
    "golden 全通：8 paths 逐端点文档生成请求全绿（POST 契约二次校验 / restful GET 形 / live SSE 首帧）+ auth 联测段全流",
    { timeout: 120_000, retry: 0 },
    async () => {
      const root = makeGoldenApp({ auth: true });
      const exported = writeOpenApi(root); // 真实导出管线（CLI main() 的同一直调）
      expect(exported.pathCount).toBe(8); // 5 夹具端点 + gen auth 三件套（auth.login/logout/me）
      expect(exported.securityTypes).toEqual(["session"]);
      expect(fs.existsSync(path.join(root, "openapi.json"))).toBe(true);
      // auth 三件套由导出面点名（gen auth v1 固定契约——漏一即红）
      expect(exported.endpoints.map((e: { name: string }) => e.name).filter((n: string) => n.startsWith("auth."))).toEqual([
        "auth.login",
        "auth.logout",
        "auth.me",
      ]);

      const server = await startGoldenServer(root);
      try {
        // auth.* 交给 auth 联测段（有状态 cookie 流，通用环无法诚实驱动）——跳过显式入账
        const authNames = ["auth.login", "auth.logout", "auth.me"];
        const h = await runGoldenHarness(root, `http://127.0.0.1:${server.port}`, { skipNames: authNames });
        expect(h.failures).toEqual([]);
        expect(h.ok).toBe(true);
        expect(h.docNames).toEqual(h.serverNames); // 文档端点集 ≡ server 注册表（双向——auth 三件套同过探针）
        expect(h.docNames).toEqual(["auth.login", "auth.logout", "auth.me", "browse.list", "chat.ask", "chat.get", "chat.stream", "meta.ping"]);
        expect(h.skipped).toEqual(authNames);
        // 覆盖清单逐项入账（paths 按名序遍历；restful 双断言、live 帧各占一条）
        expect(h.checked).toEqual([
          "probe:endpoint-set",
          "restful:browse.list:GET-shape",
          "post:browse.list",
          "post:chat.ask",
          "post:chat.get",
          "post:chat.stream",
          "live:chat.stream:data-frame",
          "post:meta.ping",
        ]);

        // auth 联测段：文档形态对拍 + login→me→logout→401 全流（手工 jar）
        const a = await runAuthGoldenSegment(root, `http://127.0.0.1:${server.port}`);
        expect(a.failures).toEqual([]);
        expect(a.ok).toBe(true);
        expect(a.checked).toEqual([
          "auth-doc:paths",
          "auth-doc:security-projection",
          "auth:me:401-anon",
          "auth:login:401-wrong-password",
          "auth:login:200:set-cookie",
          "auth-doc:security-scheme-vs-set-cookie",
          "auth:me:200:contract",
          "auth:logout:200:clear-cookie",
          "auth:me:401-after-logout",
        ]);

        // 文档形态 sanity：restful 映射 GET、live 端点带 x-atelier-live、auth.me 携 session 引用、
        // securitySchemes.session 的 cookie 名 = gen auth 产物 SESSION_COOKIE（对拍行为见联测段⑤）
        const doc = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8"));
        expect(doc.paths["/api/browse.list"].get["x-atelier-restful"]).toBe(true);
        expect(doc.paths["/api/chat.stream"].post["x-atelier-live"]).toBe(true);
        expect(doc.paths["/api/auth.me"].post.security).toEqual([{ session: [] }]);
        expect(doc.paths["/api/auth.login"].post.security).toBeUndefined();
        expect(doc.components.securitySchemes.session).toMatchObject({ type: "apiKey", in: "cookie", name: "atelier_session" });
        expect(buildOpenApi(root).endpoints.filter((e: { restful: boolean }) => e.restful)).toHaveLength(1);
      } finally {
        await server.stop();
      }
    },
  );

  it(
    "红证①-A：server 新增端点未重导出 → naive 文档驱动是假绿盲区 → 探针集合比对必须抓红",
    { timeout: 60_000, retry: 0 },
    async () => {
      const root = makeGoldenApp();
      writeOpenApi(root); // 导出在先
      w(root, "src/server/endpoints/meta.ts", metaSource(true)); // 之后新增 meta.extra，不重导出
      const server = await startGoldenServer(root);
      try {
        const h = await runGoldenHarness(root, `http://127.0.0.1:${server.port}`);
        expect(h.ok).toBe(false);
        expect(h.serverNames).toContain("meta.extra");
        expect(h.docNames).not.toContain("meta.extra");
        const drift = h.failures.filter((x) => x.kind === "drift");
        expect(drift).toHaveLength(1);
        expect(drift[0].endpoint).toBe("meta.extra");
        expect(drift[0].message).toContain("未进导出文档");
        // 除漂移外全部请求仍绿——盲区只此一处（不是大面积坏被误报成漂移）
        expect(h.failures.filter((x) => x.kind !== "drift")).toEqual([]);
      } finally {
        await server.stop();
      }
    },
  );

  it(
    "红证①-B：server 删端点未重导出 → 文档生成的请求吃 ATR-310 红 + 集合比对红",
    { timeout: 60_000, retry: 0 },
    async () => {
      const root = makeGoldenApp();
      writeOpenApi(root); // 导出在先
      w(root, "src/server/endpoints/browse.ts", "// browse.list 已从 server 面删除（golden 红证①-B：文档未重导出）\n");
      const server = await startGoldenServer(root);
      try {
        const h = await runGoldenHarness(root, `http://127.0.0.1:${server.port}`);
        expect(h.ok).toBe(false);
        const drift = h.failures.filter((x) => x.kind === "drift");
        expect(drift).toHaveLength(1);
        expect(drift[0].endpoint).toBe("browse.list");
        expect(drift[0].message).toContain("不在 server 注册表");
        const postFail = h.failures.filter((x) => x.step === "POST");
        expect(postFail).toHaveLength(1);
        expect(postFail[0].endpoint).toBe("browse.list");
        expect(postFail[0].message).toContain("ATR-310");
        // 其余端点不受牵连
        expect(h.failures.filter((x) => x.endpoint !== "browse.list")).toEqual([]);
      } finally {
        await server.stop();
      }
    },
  );

  it(
    "红证②：篡改文档删必填字段 → 文档骗客户端生成缺字段请求 → server ATR-201 被显式断言出来",
    { timeout: 60_000, retry: 0 },
    async () => {
      const root = makeGoldenApp();
      writeOpenApi(root);
      const docFile = path.join(root, "openapi.json");
      const doc = JSON.parse(fs.readFileSync(docFile, "utf8"));
      const schema = doc.components.schemas.chatAskInput;
      expect(schema.required).toContain("content"); // 篡改前文档真实声明
      delete schema.properties.content;
      schema.required = schema.required.filter((k: string) => k !== "content");
      fs.writeFileSync(docFile, JSON.stringify(doc, null, 2) + "\n", "utf8");

      const server = await startGoldenServer(root); // server 面未变——契约仍在校验
      try {
        const h = await runGoldenHarness(root, `http://127.0.0.1:${server.port}`);
        expect(h.ok).toBe(false);
        expect(h.docNames).toEqual(h.serverNames); // 端点集无漂移——纯粹是文档在字段级撒谎
        const lies = h.failures.filter((x) => x.endpoint === "chat.ask");
        expect(lies).toHaveLength(1);
        expect(lies[0].step).toBe("POST");
        expect(lies[0].kind).toBe("status");
        expect(lies[0].message).toContain("ATR-201");
        expect(lies[0].message).toContain("content");
        // 文档字段级撒谎沿 $ref 传播：chat.get 引用同一契约，生成的请求同样缺 content 同样中弹
        // （文档即真相的另一面——文档错一个 schema，所有引用方一起被骗）
        const collateral = h.failures.filter((x) => x.endpoint === "chat.get");
        expect(collateral).toHaveLength(1);
        expect(collateral[0].message).toContain("ATR-201");
        expect(collateral[0].message).toContain("content");
        // 其余端点不受牵连
        expect(h.failures.filter((x) => x.endpoint !== "chat.ask" && x.endpoint !== "chat.get")).toEqual([]);
      } finally {
        await server.stop();
      }
    },
  );
});
