/**
 * proxy-resilience.test.ts — R3 结构债批（B 件）§4.6 两小件之 forwardRequest 代理韧性红绿：
 * 「dev-server-host.mjs:253-283 forwardRequest 无代理超时、客户端中断不销毁上游（SSE 场景滞留）」。
 *
 * 红检口径（实现前实测为红）：
 *   A. 上游永不返回响应头 → 代理永久悬挂（客户端无界等待）→ 红在「有界 504」缺失；
 *   B. 客户端中断（SSE 客户端 abort）→ 上游不被销毁，server 面 live 生成器滞留 → 红在「上游 close」缺失。
 * 转绿口径（SSE 豁免论证一并钉住）：
 *   A'. 上游响应头等待期有界（缺省 UPSTREAM_HEADERS_TIMEOUT_MS，可 options 注入小值直测）——超时
 *       proxyReq.destroy() + 504 ATR JSON（错误码沿用 ATR-403 族，不新增错误码——contract-checks
 *       CHECK 1 对账面）；
 *   B'. res close（且响应未写完）→ 销毁上游——SSE 透传路径天然豁免误杀：闸只在「客户端已断开」
 *       时触发，客户端在位的长连接（哪怕完全空闲）零影响（用例 C 钉住：头到达后流式期不受
 *       headers 超时约束，200ms 级超时配置下流仍存活 >1s）。
 * 纪律：dev-server-host.test.ts 既有断言零修改全绿为本件门（ECONNREFUSED → 503 / SSE 首帧透传 /
 * JSON roundtrip 形态不变）。
 */
import { afterAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { forwardRequest, UPSTREAM_HEADERS_TIMEOUT_MS } from "../dev/dev-server-host.mjs";

const servers: http.Server[] = [];
afterAll(async () => {
  const list = servers.splice(0);
  // 红态（修复前）悬挂连接不许挂住收尾——先强制断尽 socket 再 close
  for (const s of list) (s as any).closeAllConnections?.();
  await Promise.all(list.map((s) => new Promise<void>((r) => (s.listening ? s.close(() => r()) : r()))));
});

function listen(srv: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve((srv.address() as AddressInfo).port));
  });
}

/** 轮询至断言成立或超时（时序断言不用 sleep 猜）。 */
async function waitFor(what: string, probe: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`等待超时（${timeoutMs}ms）：${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("R3-B 件④a：forwardRequest 上游超时 + 客户端中断销毁上游（SSE 豁免）", () => {
  it("红检 A：上游永不返回响应头 → 有界 504 ATR JSON + 上游 socket 被销毁（修复前：永久悬挂）", async () => {
    const conns = new Set<unknown>();
    const upstream = http.createServer(() => {
      /* 故意不响应：头等待期悬挂现场 */
    });
    upstream.on("connection", (c) => {
      conns.add(c);
      c.on("close", () => conns.delete(c));
    });
    const upPort = await listen(upstream);
    servers.push(upstream);

    const front = http.createServer((req, res) => forwardRequest(upPort, req, res, { headersTimeoutMs: 300 }));
    const frontPort = await listen(front);
    servers.push(front);

    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${frontPort}/api/hang`, { signal: AbortSignal.timeout(4000) });
    expect(r.status).toBe(504);
    const j = (await r.json()) as { ok: boolean; error: string; fix: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("ATR-403"); // 错误码族沿用（不新增错误码——contract-checks CHECK 1 对账面）
    expect(j.error).toContain("超时");
    expect(typeof j.fix).toBe("string");
    expect(Date.now() - t0, "有界：远小于 fetch 兜底窗").toBeLessThan(3000);
    await waitFor("上游 socket 销毁", () => conns.size === 0, 2000); // 修复前：上游连接滞留
  });

  it("红检 B：客户端中断（SSE 客户端 abort）→ 上游被销毁（修复前：server 面 live 生成器滞留）", async () => {
    let upstreamClosed = false;
    let ticks = 0;
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write("data: first\n\n");
      const timer = setInterval(() => res.write(`data: t${++ticks}\n\n`), 100);
      res.on("close", () => {
        upstreamClosed = true;
        clearInterval(timer);
      });
    });
    const upPort = await listen(upstream);
    servers.push(upstream);

    const front = http.createServer((req, res) => forwardRequest(upPort, req, res)); // 走缺省超时
    const frontPort = await listen(front);
    servers.push(front);

    const ctrl = new AbortController();
    const r = await fetch(`http://127.0.0.1:${frontPort}/api/live`, { signal: ctrl.signal });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const reader = (r.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // 首帧到达（透传形态不变）
    ctrl.abort(); // 客户端中断
    await waitFor("上游（server 面 SSE 生成器）收尾", () => upstreamClosed, 3000); // 修复前：永不知晓 → 红
    expect(upstreamClosed).toBe(true);
  });

  it("SSE 豁免论证：头到达后流式期不受 headers 超时约束——200ms 级超时配置下长连接仍存活 >1s", async () => {
    let ticks = 0;
    let upstreamClosed = false;
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" }); // 头立即到达 → 超时闸即撤
      res.write("data: first\n\n");
      const timer = setInterval(() => res.write(`data: t${++ticks}\n\n`), 100);
      res.on("close", () => {
        upstreamClosed = true;
        clearInterval(timer);
      });
    });
    const upPort = await listen(upstream);
    servers.push(upstream);

    // headersTimeoutMs 压到 200ms：若闸误伤流式期，流活不过 200ms
    const front = http.createServer((req, res) => forwardRequest(upPort, req, res, { headersTimeoutMs: 200 }));
    const frontPort = await listen(front);
    servers.push(front);

    const ctrl = new AbortController();
    const r = await fetch(`http://127.0.0.1:${frontPort}/api/live`, { signal: ctrl.signal });
    expect(r.status).toBe(200);
    const reader = (r.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 1200; // 远超 200ms 闸——流仍持续推送即豁免论证
    while (Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
    }
    ctrl.abort();
    expect(buf).toContain("data: first");
    expect((buf.match(/data: t/g) ?? []).length, "头后流式期持续推送（未被超时闸误杀）").toBeGreaterThanOrEqual(5);
    await waitFor("abort 后上游收尾", () => upstreamClosed, 3000);
  });

  it("缺省超时常量导出：有限正数（15s 级——server 面冷启动/热重启秒级完成之上）", () => {
    expect(Number.isFinite(UPSTREAM_HEADERS_TIMEOUT_MS)).toBe(true);
    expect(UPSTREAM_HEADERS_TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
    expect(UPSTREAM_HEADERS_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });
});
