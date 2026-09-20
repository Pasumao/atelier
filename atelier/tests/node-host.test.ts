/**
 * node-host.test.ts — FS-7 dev 托管 Node http ↔ Web 标准 fetch 桥（FS-DESIGN §11.1，D-F14 单源）验收：
 *   POST JSON roundtrip · GET query roundtrip · 多 Set-Cookie 逐条透传（auth 会话依赖，绝不逗号合并）
 *   · SSE ReadableStream 增量 write 不缓冲 · 错误 Response 状态/体透传 · content-type 头透传
 *   · serve() 就绪握手行（契约第 3 条：恰好一行 `ATELIER_SERVER_READY {"port":N}`，spawn 真实子进程
 *   截 stdout——顺带验证 Node 原生 type stripping 可直接跑本文件）· port 0 → 握手报实际端口且可请求
 *   · handler 抛错 500 兜底 · 固定端口被占 EADDRINUSE 原样上抛（框架层不静默换口）。
 * 纪律（§14.2）：全部 127.0.0.1、listen 一律端口 0（用例 6 固定冷门口除外）；afterAll 收尾关服 +
 *   closeAllConnections（Windows 防孤儿进程/句柄悬挂）；spawn 子进程自带超时兜底 kill。
 *   先红后绿：node-host.ts 实现前整文件跑红（模块不存在），实现后跑绿（证据见提交说明）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { get as httpGet, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createNodeServer, serve } from "../server/node-host";

/* ---------------- 测试基建：收尾关服 + 端口 0 listen + 子进程握手行截取 ---------------- */

const created: Server[] = [];
const spawned: ChildProcess[] = [];
const tmpDir = mkdtempSync(join(tmpdir(), "atelier-node-host-"));
// 子进程脚本的 import 目标：框架本源 node-host.ts（Node 原生 type stripping 直接跑 .ts）
const NODE_HOST_URL = pathToFileURL(fileURLToPath(new URL("../server/node-host.ts", import.meta.url))).href;

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

async function listenOn(server: Server): Promise<number> {
  created.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return portOf(server);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 轮询 + 截止时间（时序断言纪律：不固定 sleep 等状态） */
async function waitFor(pred: () => boolean, deadlineMs = 5000, stepMs = 10): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(stepMs);
  }
  throw new Error(`轮询截止：条件在 ${deadlineMs}ms 内未满足`);
}

/** spawn 真实 node 子进程跑握手契约（stdout/stderr 同槽累积，text() 供轮询，done 收尸） */
function spawnNodeHost(script: string): { proc: ChildProcess; text: () => string; done: Promise<string> } {
  const file = join(tmpDir, `nh-${spawned.length + 1}.mjs`);
  writeFileSync(file, script, "utf8");
  const proc = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
  spawned.push(proc);
  let out = "";
  proc.stdout!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  proc.stderr!.on("data", (c: Buffer) => (out += c.toString("utf8")));
  const done = new Promise<string>((resolve) => proc.on("exit", () => resolve(out)));
  return { proc, text: () => out, done };
}

/** node:http 客户端原始响应（rawHeaders 保真——验证多 Set-Cookie 逐条独立行） */
function rawGet(port: number, path: string): Promise<{ statusCode: number | undefined; rawHeaders: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: "127.0.0.1", port, path }, (res: IncomingMessage) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString("utf8")));
      res.on("end", () => resolve({ statusCode: res.statusCode, rawHeaders: res.rawHeaders, body }));
    }).on("error", reject);
  });
}

afterAll(async () => {
  for (const p of spawned) if (p.exitCode === null && !p.killed) p.kill();
  for (const s of created) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

/* ---------------- 用例 ---------------- */

describe("FS-7 node-host：Node http ↔ Web 标准 fetch 桥", () => {
  it("POST JSON roundtrip：请求体缓冲读取 + 响应回写（真 listen 127.0.0.1:0 + fetch）", async () => {
    const server = createNodeServer(async (req) => {
      const body = await req.json();
      return Response.json({ got: body, method: req.method, ct: req.headers.get("content-type") });
    });
    const port = await listenOn(server);
    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: 1, s: "中文" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: { x: 1, s: "中文" }, method: "POST", ct: "application/json" });
  });

  it("GET query roundtrip：URL 拼装与 searchParams 解析", async () => {
    const server = createNodeServer(async (req) => {
      expect(req.method).toBe("GET");
      return new Response(`q=${new URL(req.url).searchParams.get("q")}`);
    });
    const port = await listenOn(server);
    const res = await fetch(`http://127.0.0.1:${port}/probe?q=你好`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("q=你好");
  });

  it("多 Set-Cookie 逐条回写（rawHeaders 两条独立行，绝不逗号合并）", async () => {
    const server = createNodeServer(async () => {
      const res = new Response("ok");
      res.headers.append("set-cookie", "sid=abc123; Path=/; HttpOnly");
      res.headers.append("set-cookie", "theme=dark; Path=/");
      return res;
    });
    const port = await listenOn(server);
    const r = await rawGet(port, "/login");
    expect(r.statusCode).toBe(200);
    const cookies: string[] = [];
    for (let i = 0; i < r.rawHeaders.length; i += 2) {
      if (r.rawHeaders[i]!.toLowerCase() === "set-cookie") cookies.push(r.rawHeaders[i + 1]!);
    }
    expect(cookies).toEqual(["sid=abc123; Path=/; HttpOnly", "theme=dark; Path=/"]);
  });

  it("SSE ReadableStream 增量 write 不缓冲（第 1 块先到，流未结束）", async () => {
    const server = createNodeServer(async () => {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(enc.encode("data: one\n\n"));
          await sleep(60);
          c.enqueue(enc.encode("data: two\n\n"));
          await sleep(60);
          c.enqueue(enc.encode("data: three\n\n"));
          c.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
    });
    const port = await listenOn(server);
    const res = await fetch(`http://127.0.0.1:${port}/live`);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    let firstAt = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstAt === 0) firstAt = Date.now();
      text += dec.decode(value, { stream: true });
    }
    const endedAt = Date.now();
    expect(text).toContain("data: one");
    expect(text).toContain("data: two");
    expect(text).toContain("data: three");
    // 增量性判据：第 1 块到达后流还持续了 ≥50ms（若整体缓冲，第 1 块与 done 同时到，差 ≈ 0）
    expect(endedAt - firstAt).toBeGreaterThanOrEqual(50);
  });

  it("错误 Response 透传：422 状态码 + JSON 体原样", async () => {
    const server = createNodeServer(async () =>
      Response.json({ error: { code: "ATR-215", message: "输出违规" } }, { status: 422 })
    );
    const port = await listenOn(server);
    const res = await fetch(`http://127.0.0.1:${port}/x`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "ATR-215", message: "输出违规" } });
  });

  it("content-type 与自定义响应头透传", async () => {
    const server = createNodeServer(async () =>
      new Response("<h1>hi</h1>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "x-atelier-probe": "bridge" },
      })
    );
    const port = await listenOn(server);
    const res = await fetch(`http://127.0.0.1:${port}/page`);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-atelier-probe")).toBe("bridge");
  });

  it("handler 抛错 → 500 ATR-320 形态兜底（分发器漏网接住）", async () => {
    const server = createNodeServer(async () => {
      throw new Error("boom");
    });
    const port = await listenOn(server);
    const res = await fetch(`http://127.0.0.1:${port}/x`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "ATR-320" } });
  });

  it("serve() 就绪握手行格式精确匹配（子进程截 stdout，契约第 3 条）", async () => {
    const PORT = 17890; // 冷门口：仅此用例用固定端口验证精确格式
    const { proc, text, done } = spawnNodeHost(
      `import { serve } from ${JSON.stringify(NODE_HOST_URL)};\n` +
        `await serve(async () => new Response("hi"), { port: ${PORT} });\n`
    );
    try {
      await waitFor(() => text().includes("\n"));
      expect(text()).toBe(`ATELIER_SERVER_READY {"port":${PORT}}\n`);
    } finally {
      proc.kill();
    }
    await done;
  }, 15000);

  it("serve() port 0 → 握手报实际绑定端口且可请求", async () => {
    const { proc, text, done } = spawnNodeHost(
      `import { serve } from ${JSON.stringify(NODE_HOST_URL)};\n` +
        `await serve(async (req) => new Response("pong:" + new URL(req.url).searchParams.get("q")), { port: 0 });\n` +
        `setTimeout(() => process.exit(0), 10000);\n`
    );
    try {
      await waitFor(() => /^ATELIER_SERVER_READY \{"port":\d+\}\r?\n/.test(text()));
      const m = text().match(/^ATELIER_SERVER_READY \{"port":(\d+)\}\r?\n/m)!;
      const port = Number(m[1]);
      expect(port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${port}/echo?q=1`);
      expect(await res.text()).toBe("pong:1");
    } finally {
      proc.kill();
    }
    await done;
  }, 15000);

  it("serve() 固定端口被占 → EADDRINUSE 原样上抛（不静默换口）", async () => {
    // 静默并捕获本进程 stdout（serve() 的握手行）——顺带断言同进程调用握手行为一致
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let s1: Server;
    try {
      s1 = await serve(async () => new Response("first"), { port: 0 });
    } finally {
      process.stdout.write = orig;
    }
    created.push(s1);
    const port = portOf(s1);
    expect(writes.join("")).toBe(`ATELIER_SERVER_READY {"port":${port}}\n`);
    await expect(serve(async () => new Response("second"), { port })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
