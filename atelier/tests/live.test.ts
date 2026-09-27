/**
 * live.test.ts — FS-7 服务端 live 端点引擎（FS-DESIGN §4 全规格 + 决策 20）验收：
 *   SSE 线协议（retry: 3000 / 心跳注释行 / 首连全量，§4.3）· 显式 emits 失效 + 写侧自动表名
 *   启发式（§4.1 薄层，node:sqlite 实测）· coalesce 同键合并（§4.2）· single-flight 共享重算
 *   （含重算期间新写不丢）· 重算抛错 ATR-321（error 事件不断流 + journal 失败入账，D-F12 同源）
 *   · 推送前输出面检查（ATR-215 仅 dev / ATR-216 dev+prod，§3.7）· 背压断流（重连即全量，语义自愈）
 *   · abort 退订 · POST/GET 既有路由回归。
 * 纪律（§14.2）：时序正向断言一律轮询 + 截止时间（withTimeout / SseReader.peek）；仅"不再推送"
 *   的负向断言用短 settle 等待（观察缺席必须给窗口）。先红后绿：ATR-321 与失效匹配两用例在
 *   live.ts 实现前先跑红、实现后跑绿（证据见提交说明）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { defineCommand, defineQuery, EndpointRegistry } from "../server/endpoints";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import type { FlatSchema } from "../runtime/contract";

const G = globalThis as { __ATELIER_PROD__?: boolean };
afterAll(() => {
  G.__ATELIER_PROD__ = false; // 恢复 dev 语义，防污染同进程后续测试（同 server-v2.test.ts 约定）
});

/* ---------------- SSE 读端（测试侧线协议解析；内部泵持续收帧入队，peek 超时弃权不丢帧） ---------------- */

type SseEvent = { event: string; data: string; raw: string };

class SseReader {
  private queue: SseEvent[] = [];
  private waiters: ((v: SseEvent | { done: true }) => void)[] = [];
  private buf = "";
  private doneFlag = false;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    void this.pump(reader);
  }

  static from(res: Response): SseReader {
    return new SseReader(res.body!.getReader());
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const dec = new TextDecoder();
    for (;;) {
      let idx = this.buf.indexOf("\n\n");
      while (idx >= 0) {
        const raw = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 2);
        this.enqueueFrame(raw);
        idx = this.buf.indexOf("\n\n");
      }
      const r = await reader.read();
      if (r.done) break;
      this.buf += dec.decode(r.value);
    }
    this.doneFlag = true;
    for (const w of this.waiters.splice(0)) w({ done: true });
  }

  private enqueueFrame(raw: string): void {
    let event = "message";
    const datas: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) datas.push(line.slice(5).trim());
    }
    const frame: SseEvent = { event, data: datas.join("\n"), raw };
    const w = this.waiters.shift();
    if (w) w(frame);
    else this.queue.push(frame);
  }

  async next(): Promise<SseEvent | { done: true }> {
    const q = this.queue.shift();
    if (q) return q;
    if (this.doneFlag) return { done: true };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** 带截止的观察：ms 内无帧 → null（弃权即摘除等待者，后续帧仍入队不丢——负向断言专用） */
  async peek(ms: number): Promise<SseEvent | { done: true } | null> {
    const q = this.queue.shift();
    if (q) return q;
    if (this.doneFlag) return { done: true };
    return await new Promise((resolve) => {
      const entry = (v: SseEvent | { done: true }) => {
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(null);
      }, ms);
      this.waiters.push(entry);
    });
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`截止超时：${label}（${ms}ms 内未发生）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 轮询 + 截止时间（时序断言纪律：不固定 sleep） */
async function waitFor(pred: () => boolean, deadlineMs = 2000, stepMs = 5): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`轮询截止：条件在 ${deadlineMs}ms 内未满足`);
}

/** 负向断言：settle 窗口内不得有新帧（观察"缺席"必须给窗口——与正向轮询纪律并行不悖） */
async function expectNoFrame(sse: SseReader, settleMs = 150): Promise<void> {
  const f = await sse.peek(settleMs);
  expect(f).toBeNull();
}

/* ---------------- fixtures ---------------- */

const listOutput: FlatSchema = {
  type: "object",
  reqProps: { count: { type: "number" }, items: { type: "array", items: { type: "string" } } },
};

function makeReg(liveOpts: { coalesceMs?: number; heartbeatMs?: number; backpressureLimit?: number } = {}): EndpointRegistry {
  // 测试默认关心跳（真实默认 15s）；coalesce 用短窗口钉语义、避免 flaky（生产默认 50ms）
  return new EndpointRegistry({ live: { heartbeatMs: 0, ...liveOpts } });
}

function get(handler: (req: Request) => Promise<Response>, url: string, signal?: AbortSignal): Promise<Response> {
  return handler(new Request(url, { method: "GET", signal }));
}
function liveUrl(name: string, input?: unknown): string {
  const q = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return `http://local.test/${name}/live${q}`;
}
function post(handler: (req: Request) => Promise<Response>, name: string, body: unknown): Promise<Response> {
  return handler(new Request(`http://local.test/${name}`, { method: "POST", body: JSON.stringify(body) }));
}

describe("live 引擎：SSE 线协议与首连（FS-DESIGN §4.3）", () => {
  it("首连全量快照：text/event-stream 头 + retry: 3000 首帧 + event:data 全量（handler 即时首算）", async () => {
    const reg = makeReg();
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => ({ count: 2, items: ["a", "b"] }),
      })
    );
    const res = await get(reg.createHandler(), liveUrl("chat.list"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-atelier-endpoint")).toBe("chat.list");
    const sse = SseReader.from(res);
    const retry = await withTimeout(sse.next(), 1000, "retry 首帧");
    expect("done" in retry).toBe(false);
    expect((retry as SseEvent).raw).toBe("retry: 3000");
    const snap = (await withTimeout(sse.next(), 1000, "首连 data 全量")) as SseEvent;
    expect(snap.event).toBe("data");
    expect(JSON.parse(snap.data)).toEqual({ count: 2, items: ["a", "b"] });
    expect(reg.liveEngine.subscriberCount()).toBe(1);
  });

  it("input 查询参数：?input= JSON 直达 handler；非法 JSON → 400 ATR-312；无契约数组 → 400 ATR-312；契约违规 → 400 ATR-201（非 SSE JSON 错误）", async () => {
    const reg = makeReg();
    const echo: FlatSchema = { type: "object", reqProps: { k: { type: "number" } } };
    reg.register(defineQuery("q.echo", { contract: echo, live: true, handler: (input) => ({ got: input.k }) }));
    reg.register(defineQuery("q.free", { live: true, handler: (input) => ({ got: input }) }));
    const handler = reg.createHandler();

    const res = await get(handler, liveUrl("q.echo", { k: 7 }));
    const sse = SseReader.from(res);
    await sse.next(); // retry 帧
    const snap = (await withTimeout(sse.next(), 1000, "带 input 首连 data")) as SseEvent;
    expect(JSON.parse(snap.data)).toEqual({ got: 7 });

    const bad = await get(handler, `http://local.test/q.free/live?input={oops`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("ATR-312");

    const arr = await get(handler, `http://local.test/q.free/live?input=${encodeURIComponent("[1,2]")}`);
    expect(arr.status).toBe(400); // 无契约端点：数组 input 不敞开（与 POST 同纪律）
    expect((await arr.json()).code).toBe("ATR-312");

    const miss = await get(handler, liveUrl("q.echo")); // 契约端点缺 input = {} → ATR-201
    expect(miss.status).toBe(400);
    expect((await miss.json()).code).toBe("ATR-201");
  });

  it("心跳注释行（§4.3 防代理断连）：heartbeatMs 到点推 : ping", async () => {
    const reg = makeReg({ heartbeatMs: 10 });
    reg.register(defineQuery("chat.list", { live: { invalidate: ["table:messages"] }, handler: () => ({ count: 0, items: [] }) }));
    const sse = SseReader.from(await get(reg.createHandler(), liveUrl("chat.list")));
    let ping: SseEvent | null = null;
    for (let i = 0; i < 20 && !ping; i++) {
      const f = await withTimeout(sse.peek(500), 1000, "心跳帧");
      if (f === null || "done" in f) break;
      if (f.raw.startsWith(": ping")) ping = f;
    }
    expect(ping).not.toBeNull();
  });
});

describe("live 引擎：失效-重算-推送（FS-DESIGN §4.1/§4.2）", () => {
  it("显式 emits 失效：命中 invalidate 键 → 重算推送；不命中键 → 不推（读写两侧显式可查）", async () => {
    const reg = makeReg({ coalesceMs: 10 });
    const store = { items: ["a"] };
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => ({ count: store.items.length, items: [...store.items] }),
      })
    );
    reg.register(
      defineCommand("chat.send", {
        emits: ["table:messages"],
        handler: () => {
          store.items.push("b");
          return { ok: true };
        },
      })
    );
    reg.register(defineCommand("other.send", { emits: ["table:other"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    await sse.next(); // retry + 首连全量

    expect((await post(handler, "chat.send", {})).status).toBe(200);
    const push = (await withTimeout(sse.next(), 2000, "失效重算推送")) as SseEvent;
    expect(push.event).toBe("data");
    expect(JSON.parse(push.data)).toEqual({ count: 2, items: ["a", "b"] });

    await post(handler, "other.send", {});
    await expectNoFrame(sse); // 不命中键不推
  });

  it("coalesce（§4.2）：窗口内两次写合并为一次重算（重算计数器实证）；窗口后无二次推送", async () => {
    const reg = makeReg({ coalesceMs: 50 });
    const store = { items: ["a"] };
    let recalcs = 0;
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => {
          recalcs++;
          return { count: store.items.length, items: [...store.items] };
        },
      })
    );
    reg.register(
      defineCommand("chat.send", {
        emits: ["table:messages"],
        handler: () => {
          store.items.push(`x${store.items.length}`);
          return { ok: true };
        },
      })
    );
    const handler = reg.createHandler();
    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    await sse.next();
    expect(recalcs).toBe(1); // 首连快照

    await Promise.all([post(handler, "chat.send", {}), post(handler, "chat.send", {})]);
    const push = (await withTimeout(sse.next(), 2000, "coalesce 合并推送")) as SseEvent;
    expect(push.event).toBe("data");
    expect(JSON.parse(push.data).count).toBe(3); // 两次写的数据都在
    await expectNoFrame(sse); // 窗口后无二次推送
    expect(recalcs).toBe(2); // 首连 1 + 合并后 1（两次写只算一次）
  });

  it("single-flight（§4.2）：同端点同 input 两订阅者共享一次重算（重算增量 = 1，双方都收到推送）", async () => {
    const reg = makeReg({ coalesceMs: 20 });
    let recalcs = 0;
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: (input) => {
          recalcs++;
          return { count: input.k as number, items: [] };
        },
      })
    );
    reg.register(defineCommand("chat.send", { emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const sseA = SseReader.from(await get(handler, liveUrl("chat.list", { k: 1 })));
    const sseB = SseReader.from(await get(handler, liveUrl("chat.list", { k: 1 })));
    for (const sse of [sseA, sseB]) {
      await sse.next();
      await sse.next(); // 各自首连全量
    }
    expect(recalcs).toBe(2); // 首连各自首算

    await post(handler, "chat.send", {});
    const pa = (await withTimeout(sseA.next(), 2000, "A 失效推送")) as SseEvent;
    const pb = (await withTimeout(sseB.next(), 2000, "B 失效推送")) as SseEvent;
    expect(pa.event).toBe("data");
    expect(pb.event).toBe("data");
    expect(JSON.parse(pa.data)).toEqual({ count: 1, items: [] });
    expect(JSON.parse(pb.data)).toEqual({ count: 1, items: [] });
    expect(recalcs).toBe(3); // 增量 = 1：同键共享一次重算
  });

  it("single-flight 按 input 分组：不同 input 的订阅者各自重算（增量 = 2，各收各的结果）", async () => {
    const reg = makeReg({ coalesceMs: 20 });
    let recalcs = 0;
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: (input) => {
          recalcs++;
          return { count: input.k as number, items: [] };
        },
      })
    );
    reg.register(defineCommand("chat.send", { emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const sseA = SseReader.from(await get(handler, liveUrl("chat.list", { k: 1 })));
    const sseB = SseReader.from(await get(handler, liveUrl("chat.list", { k: 2 })));
    for (const sse of [sseA, sseB]) {
      await sse.next();
      await sse.next();
    }
    expect(recalcs).toBe(2);

    await post(handler, "chat.send", {});
    const pa = (await withTimeout(sseA.next(), 2000, "A(k=1) 推送")) as SseEvent;
    const pb = (await withTimeout(sseB.next(), 2000, "B(k=2) 推送")) as SseEvent;
    expect(JSON.parse(pa.data)).toEqual({ count: 1, items: [] });
    expect(JSON.parse(pb.data)).toEqual({ count: 2, items: [] });
    expect(recalcs).toBe(4); // 增量 = 2：不同 input 不共享
  });

  it("single-flight 不丢写（§4.2）：重算期间新写到达 → 重算完成后补一轮（最终数据不缺）", async () => {
    const reg = makeReg({ coalesceMs: 15 });
    const store = { items: ["a"] };
    let recalcs = 0;
    let gate: Promise<void> | null = null;
    let openGate: (() => void) | null = null;
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: async () => {
          recalcs++;
          if (gate) await gate; // 人为拉长重算，制造"重算期间新写"窗口
          return { count: store.items.length, items: [...store.items] };
        },
      })
    );
    reg.register(
      defineCommand("chat.send", {
        emits: ["table:messages"],
        handler: () => {
          store.items.push(`w${store.items.length}`);
          return { ok: true };
        },
      })
    );
    const handler = reg.createHandler();
    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    await sse.next();
    expect(recalcs).toBe(1);

    gate = new Promise((r) => {
      openGate = r;
    });
    await post(handler, "chat.send", {}); // 触发重算 R1（挂在 gate 上）
    await waitFor(() => recalcs === 2); // R1 已开始
    await post(handler, "chat.send", {}); // R1 在飞期间的新写 → 必须再标 dirty
    openGate!();

    const p1 = (await withTimeout(sse.next(), 2000, "R1 推送")) as SseEvent;
    const p2 = (await withTimeout(sse.next(), 2000, "R2 补算推送")) as SseEvent;
    expect(p1.event).toBe("data");
    expect(p2.event).toBe("data");
    expect(JSON.parse(p2.data).count).toBe(3); // 最终数据不缺（a + w1 + w2）
    expect(recalcs).toBe(3); // 快照 + R1 + 补算
  });

  it("重算抛错 → event:error ATR-321 四段式（订阅保持不断流）+ journal 失败入账 + 下次写恢复", async () => {
    const reg = makeReg({ coalesceMs: 10 });
    let failNext = false;
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => {
          if (failNext) throw new Error("db 连接抖动");
          return { count: 1, items: [] };
        },
      })
    );
    reg.register(defineCommand("chat.send", { emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    await sse.next();

    failNext = true;
    await post(handler, "chat.send", {});
    const errEvent = (await withTimeout(sse.next(), 2000, "ATR-321 error 事件")) as SseEvent;
    expect(errEvent.event).toBe("error");
    const atr = JSON.parse(errEvent.data);
    expect(atr.code).toBe("ATR-321");
    expect(atr.message).toContain("db 连接抖动"); // 根因随行
    expect(atr.fix).toContain("chat.list"); // fix 可执行：指名端点
    expect(atr.context).toBeDefined(); // 四段式形状

    failNext = false;
    await post(handler, "chat.send", {});
    const recovered = (await withTimeout(sse.next(), 2000, "恢复推送")) as SseEvent;
    expect(recovered.event).toBe("data"); // 订阅保持——无需重连即恢复

    const failedEntries = reg.journal().filter((e) => e.status === "failed"); // journal 时间轴：command ok 与 query 失败同源呈现（D-F12）
    expect(failedEntries).toHaveLength(1);
    const entry = failedEntries[0];
    expect(entry).toMatchObject({ name: "chat.list", kind: "query", principal: null });
    expect(entry.error?.code).toBe("ATR-321");
    expect(typeof entry.durMs).toBe("number");
  });

  it("推送前输出面检查（§3.7 dev 强制）：output 契约违规 → error 事件 ATR-215，订阅保持", async () => {
    const reg = makeReg({ coalesceMs: 10 });
    let violate = false;
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => (violate ? ({ count: "不是数字" } as never) : { count: 1, items: [] }),
      })
    );
    reg.register(defineCommand("chat.send", { emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    await sse.next();

    violate = true;
    await post(handler, "chat.send", {});
    const errEvent = (await withTimeout(sse.next(), 2000, "ATR-215 error 事件")) as SseEvent;
    expect(errEvent.event).toBe("error");
    expect(JSON.parse(errEvent.data).code).toBe("ATR-215");

    violate = false;
    await post(handler, "chat.send", {});
    const ok = (await withTimeout(sse.next(), 2000, "恢复推送")) as SseEvent;
    expect(ok.event).toBe("data"); // 订阅保持
  });

  it("prod 剥离（§3.7）：output 违规放行为 data（校验剥离）；JSON-safe 检查保留 → ATR-216（对外设防）", async () => {
    G.__ATELIER_PROD__ = true;
    try {
      const reg = makeReg({ coalesceMs: 10 });
      reg.register(
        defineQuery("prod.violate", {
          output: listOutput,
          live: { invalidate: ["table:messages"] },
          handler: () => ({ count: "违规但 prod 剥离" }) as never,
        })
      );
      reg.register(
        defineQuery("prod.unsafe", {
          live: { invalidate: ["table:messages"] },
          handler: () => ({ leak: () => 1 }) as never,
        })
      );
      const handler = reg.createHandler();
      const sse1 = SseReader.from(await get(handler, liveUrl("prod.violate")));
      await sse1.next();
      const lax = (await withTimeout(sse1.next(), 1000, "prod 违规放行")) as SseEvent;
      expect(lax.event).toBe("data"); // 输出契约校验 prod 剥离——违规值原样推送
      expect(JSON.parse(lax.data)).toEqual({ count: "违规但 prod 剥离" });

      const sse2 = SseReader.from(await get(handler, liveUrl("prod.unsafe")));
      await sse2.next();
      const unsafe = (await withTimeout(sse2.next(), 1000, "ATR-216 error 事件")) as SseEvent;
      expect(unsafe.event).toBe("error"); // JSON-safe dev+prod 都启用
      expect(JSON.parse(unsafe.data).code).toBe("ATR-216");
    } finally {
      G.__ATELIER_PROD__ = false;
    }
  });

  it("背压（§4.2）：未消费帧数达上限 → 断流退订（客户端按 retry 重连即全量重算，语义自愈）", async () => {
    const reg = makeReg({ coalesceMs: 5, backpressureLimit: 2 });
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => ({ count: 1, items: [] }),
      })
    );
    reg.register(defineCommand("chat.send", { emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const res = await get(handler, liveUrl("chat.list"));
    const reader = res.body!.getReader(); // 取 reader 但不读——制造积压（SseReader 的泵会消费，此处不用它）
    await post(handler, "chat.send", {}); // retry+快照 2 帧未消费 → 触顶，重算推送被弃并断流
    await waitFor(() => reg.liveEngine.subscriberCount() === 0, 2000); // 轮询退订

    const dec = new TextDecoder();
    const chunks: string[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(dec.decode(r.value));
    }
    expect(chunks).toEqual(["retry: 3000\n\n", `event: data\ndata: ${JSON.stringify({ count: 1, items: [] })}\n\n`]); // 触顶推送帧被弃
    expect(reg.liveEngine.subscriberCount()).toBe(0);
  });

  it("abort 退订（req.signal）：断开即清理，流收尾不再收推", async () => {
    const reg = makeReg();
    reg.register(
      defineQuery("chat.list", {
        output: listOutput,
        live: { invalidate: ["table:messages"] },
        handler: () => ({ count: 1, items: [] }),
      })
    );
    reg.register(defineCommand("chat.send", { emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const ac = new AbortController();
    const sse = SseReader.from(await get(handler, liveUrl("chat.list"), ac.signal));
    await sse.next();
    await sse.next();
    expect(reg.liveEngine.subscriberCount()).toBe(1);

    ac.abort();
    const closed = await withTimeout(sse.next(), 1000, "abort 后流收尾");
    expect("done" in closed).toBe(true); // abort → 自动退订 + 流关闭
    expect(reg.liveEngine.subscriberCount()).toBe(0);
    await post(handler, "chat.send", {});
    expect("done" in (await sse.next())).toBe(true); // 已退订——后续写不再有帧
  });

  it("live: true 自键失效（§4.1 向后兼容）：emits key:<端点全名> 命中，其余键不推", async () => {
    const reg = makeReg({ coalesceMs: 10 });
    const store = { n: 0 };
    reg.register(defineQuery("feed.list", { live: true, handler: () => ({ n: store.n }) }));
    reg.register(
      defineCommand("feed.bump", {
        emits: ["key:feed.list"],
        handler: () => {
          store.n++;
          return { ok: true };
        },
      })
    );
    reg.register(defineCommand("feed.other", { emits: ["key:elsewhere"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();
    const sse = SseReader.from(await get(handler, liveUrl("feed.list")));
    await sse.next();
    const snap = (await withTimeout(sse.next(), 1000, "首连 data")) as SseEvent;
    expect(JSON.parse(snap.data)).toEqual({ n: 0 });

    await post(handler, "feed.bump", {});
    const push = (await withTimeout(sse.next(), 2000, "自键失效推送")) as SseEvent;
    expect(push.event).toBe("data");
    expect(JSON.parse(push.data)).toEqual({ n: 1 });

    await post(handler, "feed.other", {});
    await expectNoFrame(sse);
  });

  it("live×鉴权 fail-closed（P1-5 红检）：live 与 auth.type≠none 组合在 register() 即抛 ATR-315 四段式，不进注册表", () => {
    const reg = makeReg();
    const registerBad = () =>
      reg.register(
        defineQuery("secret.feed", {
          auth: { type: "session" },
          live: { invalidate: ["table:messages"] },
          handler: () => ({ count: 0, items: [] }),
        })
      );
    let threw: unknown = null;
    try {
      registerBad();
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull(); // 红检核心：注册期必须显式拒绝（此前静默注册 = SSE 旁路鉴权）
    const atr = (threw as { atr?: { code: string; message: string; context: unknown; fix: string } }).atr;
    expect(atr?.code).toBe("ATR-315");
    expect(atr?.message).toContain("secret.feed");
    expect(atr?.message).toContain("session");
    expect(atr?.context).toBeDefined(); // 四段式形状
    expect(atr?.fix).toContain("auth");
    expect(reg.has("secret.feed")).toBe(false); // fail-closed：不进注册表（也就不进 live 引擎、不可被 GET /live 订阅）
    expect(reg.liveEngine.subscriberCount()).toBe(0);
    // role 变体同码拒绝
    expect(() =>
      reg.register(defineQuery("admin.feed", { auth: { type: "session", role: "admin" }, live: true, handler: () => 1 }))
    ).toThrow(/ATR-315/);
    // command 声明 live 的非法组合不在此列（SSE 仅面向 query——kind 校验在别处，但 live×auth 拒绝对 command 同样生效）
    expect(() =>
      reg.register(defineCommand("admin.cmd", { auth: { type: "session" }, live: { invalidate: ["table:x"] }, handler: () => 1 }))
    ).toThrow(/ATR-315/);
  });

  it("live×鉴权回归（P1-5）：auth:none / 未声明 auth 的 live 端点照常注册与订阅；带 auth 的非 live 端点 POST 门禁不受影响", async () => {
    const reg = makeReg();
    reg.register(defineQuery("feed.none", { auth: { type: "none" }, live: true, handler: () => ({ n: 1 }) }));
    reg.register(defineQuery("feed.legacy", { live: { invalidate: ["table:messages"] }, handler: () => ({ n: 2 }) })); // LiveNotes/app.notes 形态
    reg.register(defineCommand("feed.bump", { auth: { type: "session" }, emits: ["table:messages"], handler: () => ({ ok: true }) }));
    const handler = reg.createHandler({ auth: () => null }); // 无有效会话的客户端
    const sse1 = SseReader.from(await get(handler, liveUrl("feed.none")));
    await sse1.next();
    const snap1 = (await withTimeout(sse1.next(), 1000, "auth:none live 首连")) as SseEvent;
    expect(snap1.event).toBe("data");
    expect(JSON.parse(snap1.data)).toEqual({ n: 1 });
    const sse2 = SseReader.from(await get(handler, liveUrl("feed.legacy")));
    await sse2.next();
    const snap2 = (await withTimeout(sse2.next(), 1000, "未声明 auth live 首连")) as SseEvent;
    expect(snap2.event).toBe("data");
    expect(JSON.parse(snap2.data)).toEqual({ n: 2 });
    const denied = await post(handler, "feed.bump", {}); // 带 auth 的 command：POST 门禁照常（401 ATR-340）
    expect(denied.status).toBe(401);
    expect((await denied.json()).code).toBe("ATR-340");
  });

  it("GET /live 路由（加法不改旧）：非 live 端点/未知端点/非 query 维持 ATR-311；POST 通道与 mount 不受影响", async () => {
    const reg = makeReg();
    reg.register(defineQuery("chat.list", { live: { invalidate: ["table:messages"] }, handler: () => ({ count: 0, items: [] }) }));
    reg.register(defineQuery("plain.q", { handler: () => ({ ok: true }) }));
    reg.register(defineCommand("weird.cmd", { live: { invalidate: ["table:x"] }, handler: () => ({ ok: true }) }));
    const handler = reg.createHandler();

    const g1 = await get(handler, "http://local.test/plain.q"); // 非 live 端点 GET → 维持 ATR-311
    expect(g1.status).toBe(405);
    expect((await g1.json()).code).toBe("ATR-311");
    const g2 = await get(handler, "http://local.test/unknown.ep/live"); // 未知端点 /live → ATR-311
    expect(g2.status).toBe(405);
    expect((await g2.json()).code).toBe("ATR-311");
    const g3 = await get(handler, liveUrl("weird.cmd")); // live 声明的 command → SSE 仅面向 query
    expect(g3.status).toBe(405);
    expect((await g3.json()).code).toBe("ATR-311");

    const p1 = await post(handler, "chat.list", {}); // live 端点 POST 直调不受影响
    expect(p1.status).toBe(200);
    expect(await p1.json()).toEqual({ count: 0, items: [] });

    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    const snap = (await withTimeout(sse.next(), 1000, "无 mount 首连")) as SseEvent;
    expect(snap.event).toBe("data");

    const api = reg.createHandler({ mount: "/api" }); // mount 前缀 + /live 组合
    const sse2 = SseReader.from(await get(api, "http://local.test/api/chat.list/live"));
    await sse2.next();
    const snap2 = (await withTimeout(sse2.next(), 1000, "mount 首连")) as SseEvent;
    expect(snap2.event).toBe("data");
  });
});

/* node:sqlite 仅 Node ≥22.5 内建（同 server.test.ts 守卫模式）；写捕获薄层挂在 sqlite.ts 包装层，
 * 必须真宿主实测。Bun 不在场——bun 路径与 node 共用同一 wrapStatement（诚实边界见 sqlite.ts 头注）。 */
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

describeSqlite("live 引擎：写侧自动表名启发式（§4.1 薄层，node:sqlite 实测）", () => {
  it("无 emits 的 command 经 ctx.db 写 messages → table:messages 命中失效（INSERT/UPDATE/DELETE 捕获，写他表不误报）", async () => {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    db.exec("CREATE TABLE audit_log (id INTEGER PRIMARY KEY)");
    const reg = makeReg({ coalesceMs: 10 });
    reg.register(
      defineQuery("chat.list", {
        live: { invalidate: ["table:messages"] },
        handler: (_input, ctx) => ({ n: (ctx.db as SqliteDb).prepare("SELECT COUNT(*) AS n FROM messages").get()!.n }),
      })
    );
    reg.register(
      defineCommand("chat.send", {
        handler: (_input, ctx) => {
          (ctx.db as SqliteDb).prepare("INSERT INTO messages (body) VALUES (?)").run("hi");
          return { ok: true };
        },
      })
    );
    reg.register(
      defineCommand("chat.fix", {
        handler: (_input, ctx) => {
          (ctx.db as SqliteDb).prepare("UPDATE messages SET body = ? WHERE id = 1").run("yo");
          return { ok: true };
        },
      })
    );
    reg.register(
      defineCommand("audit.mark", {
        handler: (_input, ctx) => {
          (ctx.db as SqliteDb).prepare("INSERT INTO audit_log (id) VALUES (1)").run();
          return { ok: true };
        },
      })
    );
    const handler = reg.createHandler({ db });
    const sse = SseReader.from(await get(handler, liveUrl("chat.list")));
    await sse.next();
    const snap = (await withTimeout(sse.next(), 1000, "首连 data")) as SseEvent;
    expect(JSON.parse(snap.data)).toEqual({ n: 0 });

    await post(handler, "chat.send", {});
    const p1 = (await withTimeout(sse.next(), 2000, "INSERT 失效推送")) as SseEvent;
    expect(JSON.parse(p1.data)).toEqual({ n: 1 });

    await post(handler, "chat.fix", {});
    const p2 = (await withTimeout(sse.next(), 2000, "UPDATE 失效推送")) as SseEvent;
    expect(JSON.parse(p2.data)).toEqual({ n: 1 });

    await post(handler, "audit.mark", {});
    await expectNoFrame(sse); // 写他表（audit_log）不误报

    reg.register(
      defineCommand("chat.wipe", {
        handler: (_input, ctx) => {
          (ctx.db as SqliteDb).prepare("DELETE FROM messages").run();
          return { ok: true };
        },
      })
    );
    await post(handler, "chat.wipe", {});
    const p3 = (await withTimeout(sse.next(), 2000, "DELETE 失效推送")) as SseEvent;
    expect(JSON.parse(p3.data)).toEqual({ n: 0 });
  });

  it("显式 emits 优先于自动表名（§4.1）：声明 emits 的 command 写表不触发 table: 失效——显式声明即全责", async () => {
    const db = await openSqlite(":memory:");
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY)");
    const reg = makeReg({ coalesceMs: 10 });
    reg.register(
      defineQuery("chat.list", {
        live: { invalidate: ["table:messages"] },
        handler: (_input, ctx) => ({ n: (ctx.db as SqliteDb).prepare("SELECT COUNT(*) AS n FROM messages").get()!.n }),
      })
    );
    reg.register(defineQuery("bus.list", { live: { invalidate: ["key:explicit"] }, handler: () => ({ ok: true }) }));
    reg.register(
      defineCommand("chat.send", {
        emits: ["key:explicit"], // 显式声明优先：写 messages 也不再自动合成 table:messages
        handler: (_input, ctx) => {
          (ctx.db as SqliteDb).prepare("INSERT INTO messages (id) VALUES (1)").run();
          return { ok: true };
        },
      })
    );
    const handler = reg.createHandler({ db });
    const sseTable = SseReader.from(await get(handler, liveUrl("chat.list")));
    const sseKey = SseReader.from(await get(handler, liveUrl("bus.list")));
    for (const sse of [sseTable, sseKey]) {
      await sse.next();
      await sse.next();
    }
    await post(handler, "chat.send", {});
    const keyPush = (await withTimeout(sseKey.next(), 2000, "显式键推送")) as SseEvent;
    expect(keyPush.event).toBe("data"); // 显式键命中
    await expectNoFrame(sseTable); // 自动表名被显式 emits 压制
  });
});
