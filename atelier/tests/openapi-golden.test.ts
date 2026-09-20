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
 * defineCommand<Input, Output>(…)——模板 example.ts 的 app.echo 即此形态，整端点漏导出；
 * 修复 + 扫描器单测钉在 openapi.test.ts（同目录扫描器 describe）。
 *
 * 诚实边界：auth 端点不在 golden 面（装配 session 读取器归 gen auth 产物联测；securitySchemes
 * 投影已由 openapi.test.ts 快照钉住）；command ctx.audit 的 journal 入账在子进程内，本测试不可
 * 内省（server-v2.test.ts 进程内已钉）；bun 宿主桥不在本文件（sqlite.ts 同款挂账）。
 * skip 策略：宿主 node < 23.6（无默认 type stripping，子进程跑不了 .ts fixture）→ 整组诚实 skip。
 * 纪律（§14.2）：全部 127.0.0.1、listen 一律 port 0；用例收尾 stop() 杀子进程，afterAll 兜底
 * 收尸后才删临时目录（Windows 孤儿进程零容忍，dev-server-host.test.ts 同款）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOpenApi, scanContractSchemas, writeOpenApi } from "../gen/export-openapi.mjs";
import { validateFlat, type FlatSchema } from "../runtime/contract.ts";

const FRAMEWORK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const SERVER_INDEX = path.join(FRAMEWORK, "server", "index.ts");
const MOUNT = "/api"; // golden 标准装配：与 writeOpenApi/子进程启动壳共用同一挂载事实

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

/** 子进程启动壳（与 dev 托管子进程同源：serve() 即 D-F14 启动壳单源） */
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

function makeGoldenApp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-openapi-golden-"));
  tmpRoots.push(root);
  w(root, "src/contract.ts", contractSource());
  w(root, "src/server/endpoints/chat.ts", chatSource());
  w(root, "src/server/endpoints/browse.ts", browseSource());
  w(root, "src/server/endpoints/meta.ts", metaSource(false));
  w(root, "golden-server.ts", bootstrapSource());
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

async function postJson(url: string, body: unknown): Promise<{ status: number; headers: Headers; json: any; text: string }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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

/** golden harness：读盘上文档 → 探针集合比对 → 逐 path×method 构造请求打真实 server */
async function runGoldenHarness(root: string, baseUrl: string): Promise<GoldenResult> {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8")) as OpenApiDoc;
  const contracts = scanContractSchemas(root).byIdent as Record<string, { value?: FlatSchema }>;
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

  return { ok: failures.length === 0, failures, checked, docNames, serverNames };
}

/* ---------------- 用例 ---------------- */

d("FS-9 §13 OpenAPI golden：导出文档生成的请求打真实 server 全端点通（文档即真相）", () => {
  it(
    "golden 全通：5 paths 逐端点文档生成请求全绿（POST 契约二次校验 / restful GET 形 / live SSE 首帧）",
    { timeout: 60_000, retry: 0 },
    async () => {
      const root = makeGoldenApp();
      const exported = writeOpenApi(root); // 真实导出管线（CLI main() 的同一直调）
      expect(exported.pathCount).toBe(5);
      expect(fs.existsSync(path.join(root, "openapi.json"))).toBe(true);

      const server = await startGoldenServer(root);
      try {
        const h = await runGoldenHarness(root, `http://127.0.0.1:${server.port}`);
        expect(h.failures).toEqual([]);
        expect(h.ok).toBe(true);
        expect(h.docNames).toEqual(h.serverNames); // 文档端点集 ≡ server 注册表（双向）
        expect(h.docNames).toEqual(["browse.list", "chat.ask", "chat.get", "chat.stream", "meta.ping"]);
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
        // 文档形态 sanity：restful 映射 GET、live 端点带 x-atelier-live（golden 断言的依据位）
        const doc = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8"));
        expect(doc.paths["/api/browse.list"].get["x-atelier-restful"]).toBe(true);
        expect(doc.paths["/api/chat.stream"].post["x-atelier-live"]).toBe(true);
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
