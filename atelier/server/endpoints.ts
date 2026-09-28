/**
 * Atelier 全站服务层（决策 18/20，FS-1 + FS-M2 端点运行时 v2）— 端点运行时内核。
 * 读写二分：query（读）/ command（写，成功后自动入审计 journal）；**显式注册表**，
 * 无编译器魔法（与 SvelteKit remote functions 的行业收敛线同形，差异在此）。
 * 传输 = Web 标准 Request/Response（决策 18：Bun 优化态、Node 兜底——本模块零宿主 API 依赖；
 * AbortSignal.any/timeout 为 Web 标准，Node ≥20/Bun 同代支持）。
 * 契约 = 决策 6 扁平 schema 单源（validateFlat），输入校验失败 → ATR-201；v2 加 output 输出契约
 * （dev 态校验，违规 → ATR-215；prod 剥离但 JSON-safe 检查保留——"对内证伪可剥离、对外设防保留"§3.7）。
 * 错误码（决策 9 四域的 3xx 运行时域）：310 未知端点 / 311 方法不允许 / 312 非法 JSON /
 * 313 端点注册冲突或命名非法 / 314 live/invalidate 键语法非法 / 315 live×auth 组合不支持（注册期拒绝，P1-5 fail-closed）/
 * 320 handler 抛错 /
 * 321 live 重算失败（SSE error 事件，不断流——live.ts）/ 322 端点超时；2xx 契约域：215 输出契约违规
 * （开发者错误）/ 216 输出非 JSON-safe；SQLite 宿主面见 sqlite.ts ATR-330。
 * 安全域（A2 收口批）：346 请求体超上限（413，maxBodyBytes 可配）。
 * 鉴权域（FS-M2(m2d) 加法，§6.2）：340 会话缺失/读取器未装配（401）/ 341 角色不符（403）——
 * 只对声明 auth: { type }（type !== "none"）的端点拦截，未声明端点行为零变化（向后兼容）；
 * live SSE 通道不设 per-subscriber 门禁（引擎共享重算 ctx.auth=null）——live×auth(type≠none) 组合
 * 在 register() 即以 ATR-315 拒绝（fail-closed，见 register 内注释），声明不可能被静默忽略。
 * 依赖注入（§3.2）：无 DI 容器——db / auth 由 createHandler 装配点一次性显式注入，装配代码明文可见。
 * v2 边界（诚实）：gen auth 产物（会话原语/cookie/端点骨架）归 FS-5 生成器，本模块只做装配层拦截；
 * live 为全量引擎（FS-7，live.ts 协作对象：SSE 失效-重算-推送——单进程内存订阅、重连全量重算，
 * 诚实边界随 live.ts 文件头）；注册表与 journal 为单进程内存态（多实例/落盘归后续）；
 * timeout 中止只停止等待，handler 自身须监听 ctx.signal 提前退出。
 */
import { createHash } from "node:crypto";
import { validateFlat, type AtrError, type FlatSchema } from "../runtime/contract.ts";
import { LiveEngine, type LiveEngineOptions } from "./live.ts";
import { beginWriteCapture, endWriteCapture, type WriteCapture } from "./sqlite.ts";
import { INTROSPECT_NAME, introspectResponse } from "./introspect.ts";

export type EndpointKind = "query" | "command";

/** 鉴权声明位（决策 18：元数据先固化形状，gen auth 产物与机检/MCP 消费归 FS-5/FS-6） */
export type EndpointAuthMeta = { type: string } & Record<string, unknown>;

/** 会话主体信息（§3.2）：gen auth 装配的会话读取器产出；无 auth 应用 = null */
export type AuthInfo = { type: string; principal?: string } & Record<string, unknown>;

/** 会话读取器（createHandler({ auth }) 装配注入）：从请求读会话，未装配 = 无 auth 面 */
export type AuthReader = (req: Request) => AuthInfo | null;

/**
 * 端点处理上下文（§3.2，v2 加法扩展：name/kind 不动）。
 * TDb = 装配注入的数据库句柄类型（无库应用不传 db，ctx.db 运行时为 undefined——
 * 类型上诚实呈现为 unknown，需要句柄的端点用 defineCommand<Input, Output, SqliteDb> 标注）。
 */
export type EndpointContext<TDb = unknown> = {
  name: string;
  kind: EndpointKind;
  db: TDb;
  auth: AuthInfo | null;
  signal: AbortSignal;
  audit: (note: string) => void;
  /**
   * Set-Cookie 侧通道（§6.1 gen auth 装配语义，FS-M2(m2d) 加法）：成功响应透传 Set-Cookie 头
   * （AtrEndpointError 失败路径不带——登录失败不该种 cookie）。多次调用 = 多枚 cookie；
   * 值为完整序列化串（含 HttpOnly/SameSite 属性——gen auth 产物 cookie.ts 负责序列化）。
   * 可选位：只有 createHandler 装配的 ctx 才有——手工构造 ctx 的宿主为 undefined，
   * handler 以 ctx.setCookie?.() 调用（防御形态，gen auth 骨架即如此）。
   */
  setCookie?: (serialized: string) => void;
};

/** live/emits 失效键语法（§4.1）：表级或业务键——读写两侧都显式可查，非法 = ATR-314 */
const INVALIDATE_KEY_RE = /^(?:table:[A-Za-z0-9_]+|key:.+)$/;

/**
 * 「声明了 live」的统一判定（A2 安全收口批，硬化7）：true 或 { invalidate } 对象 = 声明 live；
 * `live: false` = 显式声明**无** live（显式选择优于沉默缺省的同款纪律），不再是「配了 live 对象」。
 * 四处判定点统一引用本谓词（register ATR-315 / addDefinition 喂入 / createHandler /live 通道 /
 * introspect live 名单），摘要 list() 的既有口径（liveDeclared）与本谓词语义一致，零行为漂移。
 */
export function isLiveDeclared(def: Pick<EndpointDef, "live">): boolean {
  return def.live === true || (def.live != null && typeof def.live === "object");
}

export type EndpointDef<TInput = Record<string, unknown>, TOutput = unknown, TDb = unknown> = {
  kind: EndpointKind;
  name: string;
  /** 输入契约（决策 6 扁平 schema 单源；缺省 = 不校验——只许给无入参的端点） */
  contract?: FlatSchema;
  /** 输出契约（§2.3）：客户端类型（FlatOf 投影）+ dev 态运行时校验（违规 ATR-215）+ OpenAPI 响应 schema 三用；prod 剥离 */
  output?: FlatSchema;
  /** 超时（§3.6）：AbortSignal.timeout(ms) 与 req.signal 合并注入 ctx.signal；超时 → ATR-322（503） */
  timeoutMs?: number;
  /** live 端点（§4.1）：true = 端点全名自键失效；{ invalidate } = 显式失效键。SSE 引擎见 live.ts（FS-7） */
  live?: boolean | { invalidate: string[] };
  /** command 写侧声明（§4.1）：该 command 触达的失效键（显式声明优先于自动表名启发式） */
  emits?: string[];
  /** 幂等元数据（§3.6）：客户端重试语义 + OpenAPI 文档位；服务端去重存储 v1 不做 */
  idempotent?: boolean;
  /** 缓存语义显式声明（§2.2）：v1 只固化 "none" 一档——引入缓存时必须显式契约化，无隐式默认 */
  cache?: "none";
  auth?: EndpointAuthMeta;
  handler: (input: TInput, ctx: EndpointContext<TDb>) => TOutput | Promise<TOutput>;
};

export function defineQuery<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown, TDb = unknown>(
  name: string,
  def: Omit<EndpointDef<TInput, TOutput, TDb>, "kind" | "name">
): EndpointDef<TInput, TOutput, TDb> {
  return { kind: "query", name, ...def };
}

export function defineCommand<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown, TDb = unknown>(
  name: string,
  def: Omit<EndpointDef<TInput, TOutput, TDb>, "kind" | "name">
): EndpointDef<TInput, TOutput, TDb> {
  return { kind: "command", name, ...def };
}

/**
 * 审计 journal 条目（D-F12）：command 入账（成功与失败同源呈现），query 不入账。
 * principal/durMs 对"handler 已执行"的条目恒存在（入账只在分发穿过 handler 之后）；
 * notes/error 仅在非空时携带。
 * input 经写入单源 journalPush 递归敏感键脱敏（P1-6）：password/secret/token/authorization 等
 * 词根键（不区分大小写）→ 值替换 "[redacted]"——auth.login 的密码不进内存审计环 +
 * GET /__atelier/server-status（introspect.ts）+ review 页/MCP 工具整条消费链。
 */
export type EndpointJournalEntry = {
  ts: string;
  name: string;
  kind: EndpointKind;
  input: unknown;
  status: "ok" | "failed";
  principal: string | null;
  durMs: number;
  notes?: string[];
  error?: AtrError;
};

export type EndpointSummary = {
  name: string;
  kind: EndpointKind;
  live: boolean;
  hasContract: boolean;
  /** 输出契约有无（v2：生成物类型与 OpenAPI 响应 schema 的依据位） */
  hasOutput: boolean;
  /** 失效键（MCP 消费位）：live 端点的失效键（true = key:<端点全名> 自键；显式 = 声明序） */
  invalidateKeys?: string[];
  /** command 写侧失效键（emits 声明原样） */
  emits?: string[];
  timeoutMs?: number;
  idempotent?: boolean;
  authType?: string;
  /** 角色声明（§6.2 MCP 消费位）：auth: { type, role } 声明了 role 时携带（agent 可查"哪些端点要什么身份"） */
  authRole?: string;
};

export function endpointError(code: string, message: string, fix: string, hints?: string[]): AtrError {
  return { code, message, context: { component: "atelier-server", hints }, fix };
}

/** 框架内部抛错形态（同 runtime 惯例：message 带码前缀），四段式字段随行可结构化消费。
 *  v2：httpStatus（构造第二参）= 分发层的 HTTP 映射（§3.3），缺省 422——401/403/404/409 等
 *  业务语义由端点自带，HTTP status 只是传输层映射，结构化错误才是 agent 的导航面。 */
export class AtrEndpointError extends Error {
  readonly atr: AtrError;
  readonly httpStatus?: number;
  constructor(err: AtrError, httpStatus?: number) {
    super(`${err.code}: ${err.message}`);
    this.name = "AtrEndpointError";
    this.atr = err;
    this.httpStatus = httpStatus;
  }
}

/** prod 旗（§3.7）：与 runtime/template.ts 的 __ATELIER_PROD__ 同款机制同款读法 */
function isProd(): boolean {
  return (globalThis as { __ATELIER_PROD__?: boolean }).__ATELIER_PROD__ === true;
}

/**
 * prod 错误 message 收敛（A2 硬化4 单源，live.ts ATR-321 同语义引用本函数；node-host.ts 桥因
 * 零 server 依赖单点复制同款实现，三处注释互指）：未捕获抛错的原始 message 可能携带 SQL 片段/
 * 路径/栈帧/凭据残片——prod 态不逐字对外，收敛为通用文案 + 短指纹（sha256 前 8 位 hex）。
 * 同一错误恒得同一指纹：拿指纹到 server 侧日志（journal/console——dev/prod 都保留原始错误，
 * 收敛只是对外姿态，不真丢根因）检索全量上下文。dev 态（__ATELIER_PROD__ 未置）逐字返回。
 * 传输零宿主依赖的主张不变（指纹不在传输面）：node:crypto 与 sqlite.ts/migrate.ts 同款宿主面，
 * Bun 有兼容层（差异锁死单文件纪律）。
 */
export function foldProdMessage(raw: string): string {
  if (!isProd()) return raw;
  const fp = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 8);
  return `内部错误（prod 已收敛，指纹 ${fp}；server 侧日志保留完整根因，可按指纹检索）`;
}

/**
 * 请求体上限缺省值（A2 硬化3）：1MiB。node-host.ts 桥侧同值单点复制（不跨模块开私有口——
 * 与 isProd 的 isProd/introspect 双写同款纪律，两处注释互指），装配点经 createHandler({ maxBodyBytes })
 * 与 createNodeServer/serve({ maxBodyBytes }) 各自可配；两道闸都设时取小者生效（分发器兜底校验恒在）。
 */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * 输出面检查（§2.3/§3.7 单源）：POST 分发器与 live 推送前（live.ts）共用同一校验——两通道零语义差。
 * 返回 null = 通过；ATR-216（JSON-safe，dev+prod 都启用——对外设防）；ATR-215（输出契约，仅 dev 强制）。
 */
export function checkEndpointOutput(def: { name: string; output?: FlatSchema }, result: unknown): AtrError | null {
  const unsafe = findJsonUnsafePath(result);
  if (unsafe) {
    return endpointError(
      "ATR-216",
      `端点 ${def.name} 返回了不可 JSON 序列化的值：${unsafe}`,
      `在端点 ${def.name} 的 handler 返回前把富对象显式映射为纯数据（函数/Symbol/BigInt/Promise/循环引用均不可序列化）；定位：${unsafe}`
    );
  }
  if (def.output != null && !isProd()) {
    if (result == null || typeof result !== "object" || Array.isArray(result)) {
      return endpointError(
        "ATR-215",
        `端点 ${def.name} 输出契约违规：期望 JSON 对象，实际 ${result === null ? "null" : Array.isArray(result) ? "array" : typeof result}`,
        `修正端点 ${def.name} 的 handler 返回值以匹配 output 契约（FlatSchema 形态 = 对象；这是服务端开发者错误，与输入侧 ATR-201 区分）`
      );
    }
    const v = validateFlat(def.output, result as Record<string, unknown>, def.name);
    if (!v.ok) {
      return {
        ...v.error!,
        code: "ATR-215",
        fix: `输出契约是服务端开发者错误（与输入侧 ATR-201 区分）：修正端点 ${def.name} 的 handler 返回值以匹配 output 契约。${v.error!.fix}`,
      };
    }
  }
  return null;
}

/**
 * JSON-safe 检查（§2.3）：函数/Symbol/BigInt/循环引用/Promise → 返回定位路径，否则 null。
 * dev+prod 都启用（§3.7"对外设防"——JSON.stringify 对这些值要么抛含糊异常要么静默损坏）。
 * undefined 属性不报（JSON.stringify 本就跳过）；诚实边界：Map/Set 序列化为 {} 的静默损坏
 * v1 不检测（未列入 ATR-216 码面，出现真实需求再补）。
 */
function findJsonUnsafePath(v: unknown, path = "$", seen: Set<object> = new Set()): string | null {
  if (v === undefined) return null;
  const t = typeof v;
  if (t === "function") return `${path}（function）`;
  if (t === "symbol") return `${path}（symbol）`;
  if (t === "bigint") return `${path}（bigint）`;
  if (t !== "object" || v === null) return null;
  if (v instanceof Promise) return `${path}（Promise——异步泄漏，JSON.stringify 会静默变成 {}）`;
  if (seen.has(v)) return `${path}（循环引用）`;
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = findJsonUnsafePath(v[i], `${path}[${i}]`, seen);
        if (hit) return hit;
      }
      return null;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const hit = findJsonUnsafePath(val, `${path}.${k}`, seen);
      if (hit) return hit;
    }
    return null;
  } finally {
    seen.delete(v);
  }
}

/** 注册期键语法校验（ATR-314）：live.invalidate 与 emits 共用同一语法 */
function assertInvalidateKeys(keys: unknown, owner: string): void {
  const bad = Array.isArray(keys)
    ? (keys as unknown[]).filter((k) => typeof k !== "string" || !INVALIDATE_KEY_RE.test(k))
    : [keys]; // 非数组 = 整体非法（收成单元素数组保 bad 恒为 unknown[]）
  if (!Array.isArray(keys) || bad.length > 0) {
    throw new AtrEndpointError(
      endpointError(
        "ATR-314",
        `${owner} 失效键非法：${Array.isArray(bad) ? bad.join(", ") : String(bad)}`,
        "键语法：table:<表名>（[A-Za-z0-9_]）或 key:<任意业务键>；修正 live.invalidate / emits 声明"
      )
    );
  }
}

/** 超时竞速哨兵：Promise.race 输家判定用（区别于 handler 自身抛出的任何错误） */
const TIMEOUT_BREACH = Symbol("atelier-endpoint-timeout");

/* ---- journal input 敏感键脱敏（P1-6）：写入单源收口（journalPush），POST 分发与 live 引擎条目同源受保护 ----
 * 键名含下列词根即视为敏感（不区分大小写，子串命中——accessToken/refresh_token 等派生拼写一并覆盖）：
 * 词根清单按"宁可多脱、不可漏脱"取常用凭据词；新凭据形态出现时在此追加。
 * 值整体替换为占位串（fail-closed：敏感键下的任意结构不外泄），非敏感键与嵌套结构原样保留（排查可用）。 */
const SENSITIVE_KEY_RE = /pass(?:word|wd)?|pwd|secret|token|authorization|credential|api[-_]?key|private[-_]?key/i;
const REDACTED_PLACEHOLDER = "[redacted]";

/** 递归脱敏：不改原对象（handler 仍持有原输入），返回脱敏副本；循环引用防御（正常 JSON 输入不出现） */
export function redactSensitiveInput(input: unknown, seen: Set<object> = new Set()): unknown {
  if (input === null || typeof input !== "object") return input;
  if (seen.has(input)) return REDACTED_PLACEHOLDER;
  seen.add(input);
  try {
    if (Array.isArray(input)) return input.map((v) => redactSensitiveInput(v, seen));
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return input; // 非普通对象（Date/Map 等，JSON 输入不会出现）原样保留
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED_PLACEHOLDER : redactSensitiveInput(v, seen);
    }
    return out;
  } finally {
    seen.delete(input);
  }
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export class EndpointRegistry {
  private defs = new Map<string, EndpointDef>();
  private journalBuf: EndpointJournalEntry[] = [];
  readonly journalLimit: number;
  /** FS-7 live 引擎（协作对象）：SSE 订阅/失效重算/推送；内省位 subscriberCount()（§10.1 数据源） */
  readonly liveEngine: LiveEngine;

  constructor(opts: { journalLimit?: number; live?: LiveEngineOptions } = {}) {
    this.journalLimit = opts.journalLimit ?? 500;
    // journalPush 经受限钩子窄口进入私有环形缓冲（最小开面——不公开 journal 写入口）
    this.liveEngine = new LiveEngine({ journalPush: (entry) => this.journalPush(entry) }, opts.live);
  }

  /** 显式注册（决策 18：无编译器魔法；重复名/非法名 = ATR-313，live/emits 键非法 = ATR-314，抛 AtrEndpointError） */
  register<TInput extends Record<string, unknown>, TOutput, TDb>(def: EndpointDef<TInput, TOutput, TDb>): this {
    if (!NAME_RE.test(def.name)) {
      throw new AtrEndpointError(endpointError("ATR-313", `端点名非法：${def.name}`, "端点名只允许字母开头的 [A-Za-z0-9_.-]（URL 路径拼接的安全前提）"));
    }
    if (this.defs.has(def.name)) {
      throw new AtrEndpointError(endpointError("ATR-313", `端点重复注册：${def.name}`, `换名或先移除；已注册端点：${this.names().join(", ") || "（无）"}`, this.names()));
    }
    if (def.live != null && typeof def.live !== "boolean") {
      assertInvalidateKeys((def.live as { invalidate?: unknown }).invalidate, `端点 ${def.name} live.invalidate`);
    }
    if (def.emits != null) {
      assertInvalidateKeys(def.emits, `端点 ${def.name} emits`);
    }
    // ---- live×鉴权 fail-closed（P1-5，ATR-315）：live SSE 通道与端点级鉴权声明互斥，注册期显式拒绝 ----
    // GET /live 路由不经过 POST 通道的 readAuth 门禁，且 live 引擎重算 ctx.auth=null（live.ts 诚实边界）：
    // 若放行组合，端点声明的 auth 会被 SSE 通道静默忽略（未认证客户端直接订阅）。引擎的共享重算模型
    // （coalesce/single-flight 按 (端点, input) 分组共享结果）与 per-subscriber 鉴权在结构上冲突——
    // per-auth 重算属设计扩展（见 live.ts 文件头），本处把"不支持"变成看得见的失败（fail-closed）。
    // auth: { type: "none" } = 显式消警，与 live 组合放行。判定用 isLiveDeclared（硬化7）：
    // live:false = 显式声明无 live，不触发本拦截（A2 批前误伤——与 addDefinition/handleLive 同口径）。
    if (isLiveDeclared(def) && def.auth != null && def.auth.type !== "none") {
      throw new AtrEndpointError(
        endpointError(
          "ATR-315",
          `端点 ${def.name} 同时声明 live 与 auth: { type: "${def.auth.type}" }——live SSE 通道不支持端点级鉴权（共享重算 ctx.auth=null，声明会被静默忽略）`,
          `三选一：该读面确属免鉴权时显式声明 auth: { type: "none" }；需要鉴权的数据改用普通（非 live）query 端点经 POST 直调（走 readAuth 门禁）；或把失效键交给免鉴权 live 端点、敏感过滤在 handler 内按 ctx.auth 自行做（POST 通道可见 ctx.auth，live 重算不可见）`,
          [def.name]
        )
      );
    }
    // 内部存储收口为非泛型形态（分发按 name 取用，泛型只活在注册调用点的类型检查里）
    this.defs.set(def.name, def as EndpointDef);
    if (def.kind === "query" && isLiveDeclared(def)) this.liveEngine.addDefinition(def as EndpointDef); // FS-7：live query 喂入引擎（live:false 不进——硬化7）
    return this;
  }

  get(name: string): EndpointDef | undefined {
    return this.defs.get(name);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  names(): string[] {
    return [...this.defs.keys()].sort();
  }

  /** 契约摘要（MCP endpoint.list 的数据源，FS-6 复用）：v2 加 output/失效键/timeout/idempotent 位 */
  list(): EndpointSummary[] {
    return this.names().map((name) => {
      const d = this.defs.get(name)!;
      const liveDeclared = d.live === true || (d.live != null && typeof d.live === "object");
      const invalidateKeys =
        d.live === true ? [`key:${name}`] : d.live != null && typeof d.live === "object" ? [...d.live.invalidate] : undefined;
      return {
        name,
        kind: d.kind,
        live: liveDeclared,
        hasContract: d.contract != null,
        hasOutput: d.output != null,
        ...(invalidateKeys ? { invalidateKeys } : {}),
        ...(d.emits ? { emits: [...d.emits] } : {}),
        ...(d.timeoutMs != null ? { timeoutMs: d.timeoutMs } : {}),
        ...(d.idempotent != null ? { idempotent: d.idempotent } : {}),
        ...(d.auth ? { authType: d.auth.type } : {}),
        ...(d.auth != null && typeof (d.auth as { role?: unknown }).role === "string"
          ? { authRole: (d.auth as { role?: unknown }).role as string }
          : {}),
      };
    });
  }

  /** 审计 journal（只读视图；command 入账——成功与失败同源（D-F12），环形有界同决策 5 journalLimit 口径） */
  journal(): readonly EndpointJournalEntry[] {
    return this.journalBuf;
  }

  private journalPush(entry: EndpointJournalEntry): void {
    // P1-6 脱敏收口：journal 唯一写入口（POST 分发与 live 引擎 host 钩子都经此）——
    // 在 append 前对 input 做递归敏感键脱敏，server-status/review/MCP 全部消费面同源受保护。
    this.journalBuf.push({ ...entry, input: redactSensitiveInput(entry.input) });
    while (this.journalBuf.length > this.journalLimit) this.journalBuf.shift();
  }

  /** 失败/成功条目的公共字段装配：notes 非空才携带（条目形状诚实最小化） */
  private journalEntry(
    def: EndpointDef,
    input: unknown,
    status: "ok" | "failed",
    principal: string | null,
    durMs: number,
    notes: string[],
    error?: AtrError
  ): EndpointJournalEntry {
    return {
      ts: new Date().toISOString(),
      name: def.name,
      kind: def.kind,
      input,
      status,
      principal,
      durMs,
      ...(notes.length > 0 ? { notes: [...notes] } : {}),
      ...(error ? { error } : {}),
    };
  }

  /**
   * Web 标准分发器 v2。约定：POST <mount>/<name>，请求体 = JSON 输入（query 与 command
   * 同走 POST——输入必须过契约校验这条纪律不因动词分叉）；FS-7 加法通道：GET <mount>/<name>/live
   * → 声明 live 的 query 端点走 SSE 订阅（live.ts 引擎：失效-重算-推送），其余非 POST 维持 ATR-311。
   * 装配点（§3.2）：db / auth 一次性显式注入，无 DI 容器——装配代码在应用入口明文可见。
   * A2 硬化3：maxBodyBytes = 请求体上限（缺省 1MiB），JSON 解析处校验，超限 413 ATR-346
   * （不进 handler、不入 journal——与鉴权拦截同款"被拒之门前不触碰 handler"语义）；
   * node-host 桥侧另有读体中途截断的同上限闸（更早、更省内存），本兜底覆盖直挂宿主/进程内调用。
   * A2 硬化5：statusToken = server-status 调试面门禁（缺省不设 = 行为零变化；设置后 GET
   * <mount>/__atelier/server-status 要求 x-atelier-token 头，401 ATR-340——见 introspect.ts）。
   */
  createHandler(
    opts: { mount?: string; db?: unknown; auth?: AuthReader; maxBodyBytes?: number; statusToken?: string } = {}
  ): (req: Request) => Promise<Response> {
    const mount = opts.mount ? "/" + opts.mount.replace(/^\/+|\/+$/g, "") : "";
    const db = opts.db; // 无库应用不传 = undefined（ctx.db 直通，诚实呈现）
    const readAuth = opts.auth;
    const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const statusToken = opts.statusToken; // A2 硬化5：server-status 门禁（未设 = 行为零变化）
    this.liveEngine.attach({ db }); // FS-7：live 重算与 POST 分发共用同一装配句柄
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      let rest = url.pathname;
      if (mount && rest.startsWith(mount)) rest = rest.slice(mount.length);
      const name = rest.replace(/^\/+|\/+$/g, "");

      // ---- FS-7 live 路由：GET /<mount>/<name>/live → SSE（仅声明 live 的 query 端点；其余非 POST 维持 ATR-311） ----
      if (req.method === "GET" && name.endsWith("/live")) {
        const base = name.slice(0, -"/live".length);
        const liveDef = base !== "" ? this.defs.get(base) : undefined;
        if (liveDef && liveDef.kind === "query" && isLiveDeclared(liveDef)) { // live:false 通道关闭（硬化7）
          const sse = this.liveEngine.handleLive(req, liveDef);
          if (sse) return sse;
        }
        return errorResponse(
          405,
          endpointError(
            "ATR-311",
            `端点只接受 POST：${req.method} ${url.pathname}（/live SSE 通道仅面向声明 live 的 query 端点）`,
            `订阅 live query：GET ${mount}/${base || "<name>"}/live；直调端点：POST ${mount}/${base || "<name>"}，JSON 体 = 契约输入`,
            this.names()
          )
        );
      }

      // ---- D-F16 保留内省路由（§10.3）：GET <mount>/__atelier/server-status → 运行时事实 JSON。
      //      dev 面 server-status（父进程代理）与 MCP endpoint.* 族、调试页三处同源；prod 旗下
      //      introspectResponse 返回 null，落回下方既有 ATR 路径（调试面不进生产 API 面）。
      //      A2 硬化5：statusToken 装配项透传——设置后该路由要求 x-atelier-token 头（401 ATR-340），
      //      未设置 = 行为零变化；prod 隐身优先于 token 判定（判定在 introspect 内部）。 ----
      if (req.method === "GET" && name === INTROSPECT_NAME) {
        const res = introspectResponse(this, { db, mount: mount || "/", statusToken, req });
        if (res) return res;
      }

      if (req.method !== "POST") {
        return errorResponse(405, endpointError("ATR-311", `端点只接受 POST：${req.method} ${url.pathname}`, `改为 POST ${mount}/${name}，JSON 体 = 契约输入`, this.names()));
      }
      const def = this.defs.get(name);
      if (!def) {
        return errorResponse(404, endpointError("ATR-310", `未知端点：${name}`, `用以下已注册端点之一：${this.names().join(", ") || "（无）"}`, this.names()));
      }

      // ---- 鉴权拦截（§6.2，FS-M2(m2d) 加法）：只对声明 auth: { type } 且 type !== "none" 的端点生效 ----
      // auth: { type: "none" } = 显式消警（"沉默缺省"才是 agent 高错区）。未声明端点连 readAuth 的
      // 调用时机都维持原状（仍在下方 ctx 装配处调用一次）——行为零变化。拦截在 handler 之前，
      // journal 不记账（journal 语义 = "分发穿过 handler 之后"，§3.5——被拒之门的请求未触达 handler）。
      // 声明了 auth 的端点：readAuth 在此处调用一次并复用进 ctx（总调用次数与旧路径相同）。
      const authMeta = def.auth;
      const authRequired = authMeta != null && authMeta.type !== "none";
      let gatedAuth: AuthInfo | null = null;
      if (authRequired) {
        gatedAuth = readAuth ? readAuth(req) : null;
        if (gatedAuth == null) {
          // 读取器未装配（装配点开发者遗漏）与请求无会话（调用方问题）同码 ATR-340（401），fix 分流：
          return errorResponse(
            401,
            readAuth
              ? endpointError(
                  "ATR-340",
                  `端点 ${name} 要求 ${authMeta.type} 鉴权，请求未携带有效会话`,
                  `先建立会话再调用（gen auth 产物 = POST auth.login，成功响应 Set-Cookie 会话 cookie，携 cookie 重试）；该端点确属免鉴权时显式声明 auth: { type: "none" }（显式选择优于沉默缺省，§6.2）`,
                  [name]
                )
              : endpointError(
                  "ATR-340",
                  `端点 ${name} 声明了 auth: { type: "${authMeta.type}" }，但 createHandler 未装配 auth 会话读取器`,
                  `装配点显式接线：createHandler({ db, auth: createSessionReader(db) })（gen auth 产物 auth.ts 提供读取器工厂）；该端点确属免鉴权时改为 auth: { type: "none" }`,
                  [name]
                )
          );
        }
        const wantRole = (authMeta as { role?: unknown }).role;
        if (typeof wantRole === "string" && gatedAuth.role !== wantRole) {
          const actual = typeof gatedAuth.role === "string" ? gatedAuth.role : "（无角色）";
          return errorResponse(
            403,
            endpointError(
              "ATR-341",
              `端点 ${name} 要求角色 ${wantRole}，会话主体 ${gatedAuth.principal ?? "（匿名）"} 的角色是 ${actual}`,
              `为该主体授予 ${wantRole} 角色（应用侧用户数据，行级判断在 handler 内读 ctx.auth 显式做——RLS 式隐式策略不做，§6.2），或修正端点 auth: { type, role } 声明`,
              [name]
            )
          );
        }
      }

      // ---- A2 硬化3：请求体上限（缺省 1MiB，maxBodyBytes 可配）——超限 413 ATR-346 ----
      // content-length 声明值先快速拒绝（不读体）；实际字节在缓冲后再兜底校验（声明可缺失/失真）。
      const overLimitError = (bytes: number): Response =>
        errorResponse(
          413,
          endpointError(
            "ATR-346",
            `请求体超限：${bytes} 字节 > 上限 ${maxBodyBytes}（端点 ${name}）`,
            `缩小请求体（分批/裁剪字段）；服务端上限由装配点调整：createHandler({ maxBodyBytes })（缺省 1MiB = ${DEFAULT_MAX_BODY_BYTES} 字节）。超限请求不进 handler、不入审计 journal`
          )
        );
      const declaredLength = Number(req.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) return overLimitError(declaredLength);

      let input: unknown;
      try {
        const raw = await req.arrayBuffer();
        if (raw.byteLength > maxBodyBytes) return overLimitError(raw.byteLength);
        input = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return errorResponse(400, endpointError("ATR-312", `请求体不是合法 JSON`, "发送 application/json 体，例如 {\"id\": 1}"));
      }
      if (def.contract != null) {
        const v = validateFlat(def.contract, input as Record<string, unknown>, def.name);
        if (!v.ok) return errorResponse(400, v.error!);
      } else if (input != null && (typeof input !== "object" || Array.isArray(input))) {
        return errorResponse(400, endpointError("ATR-312", `端点 ${name} 无契约，输入必须缺省或为 JSON 对象`, "发送空对象 {} 或为该端点补 contract（推荐：契约单源纪律）"));
      }
      const payload = (input ?? {}) as Record<string, unknown>;

      // ---- v2 ctx 装配（§3.2）：db / auth / signal / audit ----
      const notes: string[] = [];
      // auth：拦截过的端点复用拦截结果（readAuth 只调一次）；未声明端点维持旧路径（此处调用）
      const auth = authRequired ? gatedAuth : readAuth ? readAuth(req) : null;
      const principal = auth?.principal ?? null;
      // Set-Cookie 收集（§6.1）：ctx.setCookie 经此透传进成功响应头（Headers.append 支持多枚
      // set-cookie 的独立行承载）；失败路径（AtrEndpointError/超时/契约违规）不合并——登录失败不种 cookie。
      const setCookies: string[] = [];
      // timeoutMs 声明 → AbortSignal.timeout 与 req.signal 合并（Web 标准 AbortSignal.any）；
      // signal 中止只负责让监听它的 handler 退出 + 分发停等，强杀 handler 副作用在 JS 无解（诚实边界）。
      const timeoutSignal = def.timeoutMs != null ? AbortSignal.timeout(def.timeoutMs) : undefined;
      const signal = timeoutSignal ? AbortSignal.any([req.signal, timeoutSignal]) : req.signal;
      const ctx: EndpointContext = {
        name: def.name,
        kind: def.kind,
        db,
        auth,
        signal,
        audit: (note: string) => {
          notes.push(note);
        },
        setCookie: (serialized: string) => {
          // 开发者传值护栏（HTTP 头注入面）：空串/换行直接走 handler 抛错路径（ATR-320 兜底，消息可定位）
          if (typeof serialized !== "string" || serialized.length === 0 || /[\r\n]/.test(serialized)) {
            throw new Error(`ctx.setCookie 值非法（须为非空且不含换行的完整序列化 cookie 串——gen auth 产物 cookie.ts 的 serializeSessionCookie 负责序列化）`);
          }
          setCookies.push(serialized);
        },
      };
      const t0 = performance.now();
      const durMs = (): number => Math.round(performance.now() - t0);
      let capture: WriteCapture | null = null; // FS-7 写捕获槽：command 分发期间收集写目标表（§4.1 自动表名启发式）
      try {
        let result: unknown;
        capture = def.kind === "command" ? beginWriteCapture() : null;
        if (timeoutSignal) {
          const breach = new Promise<never>((_, reject) => {
            timeoutSignal.addEventListener("abort", () => reject(TIMEOUT_BREACH), { once: true });
          });
          result = await Promise.race([Promise.resolve(def.handler(payload, ctx)), breach]);
        } else {
          result = await def.handler(payload, ctx);
        }

        // ---- a+b. 输出面检查（§2.3 单源 checkEndpointOutput——live 推送前同源，两通道零语义差）：
        //          JSON-safe（dev+prod 都启用，对外设防）+ 输出契约（仅 dev 强制，prod 剥离） ----
        const outErr = checkEndpointOutput(def, result);
        if (outErr) {
          if (def.kind === "command") this.journalPush(this.journalEntry(def, payload, "failed", principal, durMs(), notes, outErr));
          return errorResponse(500, outErr);
        }

        if (def.kind === "command") {
          this.journalPush(this.journalEntry(def, payload, "ok", principal, durMs(), notes));
          // ---- FS-7 失效广播（§4.2，journal 入账后）：键 = 显式 emits 优先，否则写侧自动表名捕获合成 table:<name> ----
          const captured = capture ? endWriteCapture(capture) : [];
          capture = null;
          const keys = def.emits ?? captured.map((t) => `table:${t}`);
          if (keys.length > 0) this.liveEngine.onCommandSuccess(def.name, keys);
        }
        const okHeaders = new Headers({
          "content-type": "application/json; charset=utf-8",
          "x-atelier-endpoint": def.name,
          "x-atelier-endpoint-kind": def.kind,
        });
        for (const c of setCookies) okHeaders.append("set-cookie", c);
        return new Response(JSON.stringify(result ?? null), { status: 200, headers: okHeaders });
      } catch (e) {
        const dur = durMs();
        // ---- d. 超时（§3.6）：ATR-322（503）——race 输家或 handler 因中止信号抛错 ----
        if (e === TIMEOUT_BREACH || (timeoutSignal != null && timeoutSignal.aborted)) {
          const err = endpointError(
            "ATR-322",
            `端点 ${def.name} 超时（超过 ${def.timeoutMs}ms 未完成）`,
            `提高端点 ${def.name} 的 timeoutMs，或排查 handler 阻塞：handler 应监听 ctx.signal 提前退出（中止只停等分发，不能强杀 handler）`
          );
          if (def.kind === "command") this.journalPush(this.journalEntry(def, payload, "failed", principal, dur, notes, err));
          return errorResponse(503, err);
        }
        // ---- c. 端点自带错误（§3.3）：HTTP = httpStatus ?? 422，四段式原样透出 ----
        if (e instanceof AtrEndpointError) {
          if (def.kind === "command") this.journalPush(this.journalEntry(def, payload, "failed", principal, dur, notes, e.atr));
          return errorResponse(e.httpStatus ?? 422, e.atr);
        }
        // ---- 未捕获抛错：500 ATR-320（journal 记失败——审计与数据一致，D-F12） ----
        // A2 硬化4：journal 条目保留原始 message（日志侧 dev/prod 都不真丢）；对外 message 经
        // foldProdMessage——prod 收敛为通用文案 + 指纹，dev 逐字（即 journalErr 与响应原样一致）。
        const detail = `端点 ${def.name} handler 抛错：${(e as Error)?.message ?? String(e)}`;
        const journalErr = endpointError(
          "ATR-320",
          detail,
          `修复端点 ${def.name} 的 handler 内部错误；失败 command 亦入审计 journal（status=failed + 根因 error），journal() 时间轴可查"代理改了什么、砸了什么"`
        );
        if (def.kind === "command") this.journalPush(this.journalEntry(def, payload, "failed", principal, dur, notes, journalErr));
        const err = endpointError(
          "ATR-320",
          `端点 ${def.name} handler 抛错：${foldProdMessage((e as Error)?.message ?? String(e))}`,
          journalErr.fix
        );
        return errorResponse(500, err);
      } finally {
        // FS-7 捕获槽兜底：失败路径（抛错/超时/输出面违规的早退）也必须收槽——防槽泄漏与跨分发串写；
        // 失败 command 不广播（§4.2 只在提交成功后失效），捕获结果就此丢弃。
        if (capture) endWriteCapture(capture);
      }
    };
  }
}

function errorResponse(status: number, err: AtrError): Response {
  return new Response(JSON.stringify(err, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
