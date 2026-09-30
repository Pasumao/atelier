/**
 * Atelier 全站服务层 — live 端点引擎（FS-7，FS-DESIGN §4 全规格 + 决策 20 细化）：
 * 写后失效-重算-推送（SSE 下行）。零 npm 依赖、纯 Web 标准（ReadableStream/TextEncoder/
 * AbortSignal/performance）——宿主差异零触碰。
 *
 * 机制（§4.2）：command 分发成功（journal 入账后，endpoints.ts 分发器装配）→ 失效键求交
 * （command 的 emits/自动表名 × 各 live query 的 invalidate）→ 命中订阅者标 dirty → coalesce
 * 窗口（默认 50ms，同键多次写合并为一次重算）→ 重算（single-flight：同端点同 input 共享一次；
 * 重算期间新写到达 → 补一轮，不丢写）→ 逐订阅者推送 event: data。
 *
 * SSE 线协议（§4.3）：首帧 retry: 3000；心跳注释行 : ping（默认 15s，防代理断连）；
 * event: data = 首连全量 + 每次失效重算后的输出（推送前过输出面检查——ATR-216 dev+prod /
 * ATR-215 仅 dev，与 POST 通道同一单源 checkEndpointOutput，§3.7）；event: error = ATR 四段式
 * JSON（重算抛错 = ATR-321；订阅保持不断流，下轮写后自动重试）；live 端点没有 done 事件。
 *
 * 失效键（§4.1）：显式 emits 优先（分发器装配）；无 emits 时用 sqlite.ts 写捕获槽的自动表名
 * 启发式合成 table:<name>。键语法 table:<name> | key:<业务串>，注册期已过 ATR-314 校验。
 *
 * 诚实边界（§4.6 全数成文）：
 * - 单进程内存订阅（无多实例——需外部 pub/sub 归不做清单）；重连 = 全量重算（Last-Event-ID
 *   v1 忽略，无增量推送——patch 流列 B 队不承诺）；
 * - 失效粒度 = 显式键（无读集追踪）；写侧表名自动标记为启发式（并发分发交叉按"宁多勿漏"并入
 *   所有活跃捕获槽——多触发一次幂等重算，语义正确；冷门 SQL 拼写请用显式 emits）；
 * - 背压：每订阅者未消费帧数达上限（默认 32）即断流——EventSource 按 retry 自动重连，重连即
 *   全量重算，语义自愈；
 * - 首连快照按订阅者即时首算（即时性优先，不等 coalesce 窗口；同 key 重算在飞时等收尾后由
 *   pending 机制补推）；失效重算按 (端点, input) single-flight 共享——input 以 JSON 序列化串为
 *   共享键，键序不同的等价输入视为不同重算组（v1 简化）；
 * - 重算 ctx：auth=null（订阅者各自的会话差异不参与共享重算——本地单机形态；带鉴权的 live 面
 *   归 gen auth 装配后再议）、signal 为永不中止信号（timeoutMs 元数据不作用于 live 重算——
 *   分发超时语义归 POST 通道）；
 * - live×鉴权互斥（P1-5）：共享重算（coalesce/single-flight 按 (端点, input) 分组共享结果）与
 *   per-subscriber 鉴权结构冲突——registry.register() 对 live×auth(type≠none) 组合以 ATR-315
 *   注册期拒绝（fail-closed，endpoints.ts），本引擎不做 per-auth 重算（属设计扩展）；
 * - 共享重算组内多个订阅者收到同一次结果（个体推送失败/背压断流只影响自身，不影响组内他人）。
 */
import { validateFlat, type AtrError } from "../runtime/contract.ts";
import {
  checkEndpointOutput,
  endpointError,
  foldProdMessage,
  isLiveDeclared,
  type AuthReader,
  type EndpointContext,
  type EndpointDef,
  type EndpointJournalEntry,
} from "./endpoints.ts";

export type LiveEngineOptions = {
  /** coalesce 窗口 ms（§4.2 同键多次写合并为一次重算）；默认 50 */
  coalesceMs?: number;
  /** 心跳注释行间隔 ms（§4.3）；0 = 关闭；默认 15000 */
  heartbeatMs?: number;
  /** 每订阅者未消费帧数上限（背压 §4.2）；达到即断流退订；默认 32 */
  backpressureLimit?: number;
};

/** 引擎宿主（registry 协作对象的最小开面——不公开 journal 写入口，最小改法） */
export type LiveEngineHost = {
  /** 受限钩子：重算失败（ATR-321）入端点 journal（registry 私有环形缓冲的窄口） */
  journalPush(entry: EndpointJournalEntry): void;
};

const ENCODER = new TextEncoder();
const RETRY_FRAME = "retry: 3000\n\n";
const PING_FRAME = ": ping\n\n";

type LiveSubscriber = {
  id: number;
  def: EndpointDef;
  input: Record<string, unknown>;
  /** single-flight 重算组键 = 端点名 + input JSON 串（§4.2 同端点同 input 共享一次重算） */
  key: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
  /** 首算是否已尝试（含失败——error 事件后订阅保持，等待下轮写） */
  firstRecalcDone: boolean;
};

/** 同键重算状态机：scheduled = coalesce 定时器在途；running = 重算在飞；pending = 在飞期间有新写 */
type KeyState = { subs: Set<LiveSubscriber>; scheduled: boolean; running: boolean; pending: boolean };

function sseFrame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/** live 端点的失效键（§4.1）：true = 端点全名自键；{ invalidate } = 显式键 */
function liveInvalidateKeys(def: EndpointDef): string[] {
  if (def.live === true) return [`key:${def.name}`];
  if (def.live != null && typeof def.live === "object") return [...def.live.invalidate];
  return [];
}

function jsonError(status: number, err: AtrError): Response {
  return new Response(JSON.stringify(err, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export class LiveEngine {
  private readonly host: LiveEngineHost;
  private readonly coalesceMs: number;
  private readonly heartbeatMs: number;
  private readonly backpressureLimit: number;
  /** live query 定义（registry register() 喂入——引擎不反向依赖 registry，协作对象单向依赖） */
  private readonly defs = new Map<string, EndpointDef>();
  /** 端点名 → 订阅者集合（单进程内存态，§4.6 诚实边界） */
  private readonly subs = new Map<string, Set<LiveSubscriber>>();
  /** 重算组键 → 状态机（coalesce/single-flight/不丢写三合一） */
  private readonly keys = new Map<string, KeyState>();
  private db: unknown = undefined;
  private nextId = 1;
  private hbTimer: ReturnType<typeof setInterval> | null = null;

  constructor(host: LiveEngineHost, opts: LiveEngineOptions = {}) {
    this.host = host;
    this.coalesceMs = opts.coalesceMs ?? 50;
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
    this.backpressureLimit = opts.backpressureLimit ?? 32;
  }

  /** 注册表 register() 时喂入 live query 定义（command 的 live 声明不进引擎——SSE 仅面向 query；
   *  live:false = 显式无 live，同样不进——硬化7 与 endpoints.ts 同一 isLiveDeclared 口径） */
  addDefinition(def: EndpointDef): void {
    if (def.kind === "query" && isLiveDeclared(def)) this.defs.set(def.name, def);
  }

  /** createHandler 装配点（§3.2）调用：db 一次性显式注入（重复装配以最后一次为准——引擎随注册表单例） */
  attach(opts: { db?: unknown }): void {
    this.db = opts.db;
  }

  /** 内省位（MCP server.introspect 数据源，§10.1）：当前 SSE 订阅者总数 */
  subscriberCount(): number {
    let n = 0;
    for (const g of this.subs.values()) n += g.size;
    return n;
  }

  /**
   * GET /<name>/live 入口：返回 SSE Response；端点不适格（非 query / 未声明 live）返回 null
   * 由调用方回退 ATR-311。input 经 ?input=<JSON> 携带（§4.4 EventSource 拼接约定），缺省 = {}。
   */
  handleLive(req: Request, def: EndpointDef): Response | null {
    if (def.kind !== "query" || !isLiveDeclared(def)) return null; // live:false = 显式无 live（硬化7）

    let parsed: unknown = {};
    const raw = new URL(req.url).searchParams.get("input");
    if (raw != null && raw !== "") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return jsonError(
          400,
          endpointError(
            "ATR-312",
            `live 订阅的 input 查询参数不是合法 JSON`,
            "EventSource URL 以 ?input= + encodeURIComponent(JSON.stringify(input)) 携带输入，或省略该参数表示空对象 {}"
          )
        );
      }
    }
    // ---- P2-S1 POST 面同口径归一（REL-A A1）：形状闸提到 contract 分支之前 ----
    // 旧口径与 POST 面同病（P2-S1 修前原样）：形状闸只在无契约分支（else if），带契约 live 端点
    // 收 ?input=5 时 (5 ?? {}) 直接进 validateFlat → contract.ts `k in data` 对原始值抛
    // TypeError → 路由 handle 裸抛（线上宿主兜底 500，dev 泄 TypeError 原文）。live×鉴权恒被
    // ATR-315 注册期拒绝 ⇒ 该面恒为免鉴权可远程触发。两分支口径归一：input 必须缺省或为
    // JSON 对象，标量/数组一律 400 ATR-312；null 保持放行 = 缺省体语义——经下方 (parsed ?? {})
    // 归一后契约端点走 ATR-201 缺必填、无契约端点 handler 拿 {}，既有语义零变化。
    if (parsed != null && (typeof parsed !== "object" || Array.isArray(parsed))) {
      return jsonError(
        400,
        endpointError(
          "ATR-312",
          `端点 ${def.name} live input 必须缺省或为 JSON 对象`,
          `EventSource URL 以 ?input= + encodeURIComponent(JSON.stringify(input)) 携带 JSON 对象，或省略该参数表示空对象 {}`
        )
      );
    }
    const input = (parsed ?? {}) as Record<string, unknown>;
    if (def.contract != null) {
      const v = validateFlat(def.contract, input, def.name);
      if (!v.ok) return jsonError(400, v.error!); // live input 同样是不可信边界（§3.7 输入校验保留）
    }

    // Last-Event-ID：v1 忽略（重连 = 全量重算，简单且正确）——诚实边界见文件头
    void req.headers.get("last-event-id");

    const holder: { sub: LiveSubscriber | null } = { sub: null };
    req.signal.addEventListener(
      "abort",
      () => {
        if (holder.sub) this.drop(holder.sub);
      },
      { once: true }
    );
    const engine = this;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await engine.openSubscription(req, def, input, controller, holder);
      },
      cancel() {
        if (holder.sub) engine.drop(holder.sub); // 客户端断开/reader.cancel → 自动退订
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-atelier-endpoint": def.name,
        "x-atelier-endpoint-kind": "live",
      },
    });
  }

  /** command 分发成功（journal 入账后）的失效广播入口：keys = 显式 emits ?? 自动表名合成键 */
  onCommandSuccess(name: string, keys: string[]): void {
    if (keys.length === 0) return;
    void name; // 键匹配不按 command 名——键求交即导航（读写两侧显式可查，§4.1）
    for (const [epName, def] of this.defs) {
      const liveKeys = liveInvalidateKeys(def);
      if (liveKeys.length === 0) continue;
      if (!keys.some((k) => liveKeys.includes(k))) continue;
      const group = this.subs.get(epName);
      if (!group) continue;
      for (const sub of [...group]) this.markDirty(sub);
    }
  }

  private async openSubscription(
    req: Request,
    def: EndpointDef,
    input: Record<string, unknown>,
    controller: ReadableStreamDefaultController<Uint8Array>,
    holder: { sub: LiveSubscriber | null }
  ): Promise<void> {
    const sub: LiveSubscriber = {
      id: this.nextId++,
      def,
      input,
      key: `${def.name}\u0000${JSON.stringify(input)}`,
      controller,
      closed: false,
      firstRecalcDone: false,
    };
    holder.sub = sub;
    if (req.signal.aborted) {
      this.drop(sub);
      return;
    }
    this.registerSub(sub);
    this.enqueueRaw(sub, RETRY_FRAME);
    // 首连全量（§4.3）：走与失效重算同一状态机，但立即 flush（即时性优先，不等 coalesce 窗口）；
    // 同 key 重算在飞时 pending 机制保证收尾后补推（轮询上限兜底防异常宿主下死循环）。
    this.markDirty(sub);
    for (let i = 0; i < 3 && !sub.firstRecalcDone && !sub.closed; i++) {
      await this.flushKey(sub.key, true);
      if (!sub.firstRecalcDone && !sub.closed) await new Promise((r) => setTimeout(r, Math.min(this.coalesceMs, 10)));
    }
  }

  private registerSub(sub: LiveSubscriber): void {
    this.defs.set(sub.def.name, sub.def); // 自愈：直连引擎用户未经 addDefinition 也可订阅
    let group = this.subs.get(sub.def.name);
    if (!group) {
      group = new Set();
      this.subs.set(sub.def.name, group);
    }
    group.add(sub);
    this.ensureHeartbeat();
  }

  /** 退订 + 流收尾（abort/cancel/背压/推送失败统一走此——重连即全量重算，语义自愈） */
  private drop(sub: LiveSubscriber): void {
    if (sub.closed) return;
    sub.closed = true;
    const group = this.subs.get(sub.def.name);
    if (group) {
      group.delete(sub);
      if (group.size === 0) {
        this.subs.delete(sub.def.name);
        this.stopHeartbeatIfIdle();
      }
    }
    try {
      sub.controller.close();
    } catch {
      /* 流已被取消/宿主已断——退订目的已达 */
    }
  }

  private markDirty(sub: LiveSubscriber): void {
    let st = this.keys.get(sub.key);
    if (!st) {
      st = { subs: new Set(), scheduled: false, running: false, pending: false };
      this.keys.set(sub.key, st);
    }
    st.subs.add(sub);
    if (st.running) {
      st.pending = true; // 重算期间新写 → 再标 dirty 不丢写（收尾后补一轮）
      return;
    }
    this.scheduleFlushKey(sub.key);
  }

  private scheduleFlushKey(key: string): void {
    const st = this.keys.get(key);
    if (!st || st.scheduled) return;
    st.scheduled = true;
    setTimeout(() => {
      st.scheduled = false;
      void this.flushKey(key);
    }, this.coalesceMs);
  }

  /**
   * 同键 flush：coalesce（窗口内多次标 dirty 合并）+ single-flight（running 门）+ 不丢写
   * （pending 补算）三合一。immediate = true 供首连快照绕过窗口。
   */
  private async flushKey(key: string, immediate = false): Promise<void> {
    const st = this.keys.get(key);
    if (!st || st.running) return;
    const subs = [...st.subs].filter((s) => !s.closed);
    st.subs.clear();
    if (subs.length === 0) {
      if (!st.scheduled && !st.pending) this.keys.delete(key);
      return;
    }
    st.running = true;
    try {
      await this.recalc(subs[0].def, subs);
    } finally {
      st.running = false;
      if (st.pending) {
        st.pending = false; // 重算期间新写到达 → 必须再来一轮（§4.2 不丢写）
        this.scheduleFlushKey(key);
      } else if (!st.scheduled && st.subs.size === 0) {
        this.keys.delete(key);
      }
    }
  }

  /** 重算 + 逐订阅者推送（输出面检查单源 checkEndpointOutput；抛错 → ATR-321 + journal 失败入账） */
  private async recalc(def: EndpointDef, subs: LiveSubscriber[]): Promise<void> {
    if (subs.length === 0) return;
    const input = subs[0].input;
    const notes: string[] = [];
    const t0 = performance.now();
    const ctx: EndpointContext = {
      name: def.name,
      kind: def.kind,
      db: this.db,
      auth: null, // 诚实边界：共享重算不携带订阅者会话（见文件头）
      signal: new AbortController().signal, // 永不中止——timeoutMs 不作用于 live 重算（见文件头）
      audit: (note: string) => notes.push(note),
    };
    try {
      const result = await def.handler(input, ctx);
      const outErr = checkEndpointOutput(def, result); // ATR-216 dev+prod / ATR-215 仅 dev（§3.7）
      if (outErr) {
        this.pushEvent(subs, "error", JSON.stringify(outErr));
        return;
      }
      this.pushEvent(subs, "data", JSON.stringify(result ?? null));
    } catch (e) {
      // A2 硬化4：SSE error 事件（对外）经 foldProdMessage——prod 收敛为通用文案 + 指纹，dev 逐字；
      // journal 条目（日志侧）保留原始 message——dev/prod 都不真丢根因，可按指纹到 journal 检索。
      const rawMsg = (e as Error)?.message ?? String(e);
      const journalErr = endpointError(
        "ATR-321",
        `live 端点 ${def.name} 重算失败：${rawMsg}`,
        `修复 live 端点 ${def.name} 的 handler 内部错误后无需重连——订阅已保持，下一次失效写到达即自动重算；复现：POST /${def.name} 以同 input 直调 handler 看完整根因`
      );
      this.pushEvent(
        subs,
        "error",
        JSON.stringify({
          ...journalErr,
          message: `live 端点 ${def.name} 重算失败：${foldProdMessage(rawMsg)}`,
        })
      ); // 不断流：订阅保持（§4.2）
      this.host.journalPush({
        ts: new Date().toISOString(),
        name: def.name,
        kind: def.kind,
        input,
        status: "failed",
        principal: null,
        durMs: Math.round(performance.now() - t0),
        ...(notes.length > 0 ? { notes: [...notes] } : {}),
        error: journalErr,
      });
    } finally {
      for (const s of subs) s.firstRecalcDone = true; // 首算已尝试（含失败）——首连等待循环据此收敛
    }
  }

  private pushEvent(subs: LiveSubscriber[], event: string, data: string): void {
    for (const sub of subs) this.enqueueRaw(sub, sseFrame(event, data));
  }

  /**
   * 帧出站（唯一出口）：先查背压（未消费帧数 = 1 - desiredSize，默认策略 HWM=1）——达上限即断流
   * 退订（本帧被弃，客户端按 retry: 3000 重连拿全量）；再 enqueue（流已死则顺手退订）。
   */
  private enqueueRaw(sub: LiveSubscriber, text: string): void {
    if (sub.closed) return;
    const desired = sub.controller.desiredSize;
    if (desired != null && 1 - desired >= this.backpressureLimit) {
      this.drop(sub);
      return;
    }
    try {
      sub.controller.enqueue(ENCODER.encode(text));
    } catch {
      this.drop(sub);
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatMs <= 0 || this.hbTimer != null) return;
    const t = setInterval(() => {
      for (const group of this.subs.values()) {
        for (const sub of [...group]) this.enqueueRaw(sub, PING_FRAME);
      }
    }, this.heartbeatMs);
    (t as unknown as { unref?: () => void }).unref?.(); // 不阻进程退出（CLI/测试场景友好）
    this.hbTimer = t;
  }

  private stopHeartbeatIfIdle(): void {
    if (this.hbTimer != null && this.subs.size === 0) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
  }
}
