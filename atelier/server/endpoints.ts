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
 * 安全域（A2 收口批）：346 请求体超上限（413，maxBodyBytes 可配）；
 * 344 限流窗口超配额（429，rateLimit 显式装配、缺省不启用）；
 * 345 登录失败锁定（423，gen auth 产物内实现——本模块头表随批登记同一分配面）。
 * jobs 域（A1/A4 差距批，jobs.ts 单文件实现，§5.6）：350 jobs 投递参数非法（enqueue/cron）/
 * 351 幂等键 KV 参数非法——调用点同步抛错，经本分发器的 AtrEndpointError 缺省 422 映射承接；
 * 鉴权域（FS-M2(m2d) 加法，§6.2）：340 会话缺失/读取器未装配（401）/ 341 角色不符（403）——
 * 只对声明 auth: { type }（type !== "none"）的端点拦截，未声明端点行为零变化（向后兼容）；
 * A6 API key 最小切口（2026-09-28，决策 30）加 apikey 分支：auth.type:"apikey" = 机器客户端通道
 * （人机双通道并存——会话优先，无会话才比对 createHandler({ apiKeys }) 静态 key，缺省不启用恒拒
 * fail-closed；timingSafeEqual 恒时比较，长度不齐与等长 dummy 同形）；auth.type:"session" 等其余
 * 类型不读 key 头（类型互斥——key 不能越权拿用户身份）；
 * live SSE 通道不设 per-subscriber 门禁（引擎共享重算 ctx.auth=null）——live×auth(type≠none) 组合
 * 在 register() 即以 ATR-315 拒绝（fail-closed，见 register 内注释），声明不可能被静默忽略。
 * 依赖注入（§3.2）：无 DI 容器——db / auth 由 createHandler 装配点一次性显式注入，装配代码明文可见。
 * B3 差距批（2026-09-28，决策 31）加 email 装配位：ctx.email = { send }（email.ts 单源——显式
 * transport 接口 + 投递记账，框架不内建真实发送；本模块只做装配层透传与 introspect 段接线）。
 * B1 差距批（2026-09-28，决策 32）加上传/资产面：uploads = createUploadsFace({ db, dir }) 产物
 * 装配项（uploads.ts 单源——解析/存储/记账/下载；本模块只做兄弟注册表 registerUpload 收口 + 路由
 * 分发 + gateAuth 鉴权单源复用；上传面不入端点表——introspect 端点表形状零变化）；路由
 * POST <mount>/upload/<name> + GET <mount>/assets/<id>；multipart 桥面粗闸见 node-host.ts
 * （max(maxBodyBytes, 20MB)），定义精闸在上传面（413 ATR-346 同码）。
 * A5 差距批（2026-09-29，决策 33）加 cache 元数据档位：cache?: "none" | { visibility, maxAge }——
 * FS-DESIGN §2.2「位先固化」的兑现。对象档（真实缓存声明）只许 query 端点（command 带 = 写端点
 * 缓存语义自相矛盾；live query 带 = SSE 通道有自己的头语义）——register() 定义期硬错
 * （assertCacheMeta，ATR-313 同码先例见 registerUpload）；"none" 显式零档全端点可声明（「不缓存」
 * 是无缓存声明非缓存声明，位先固化形状保持）；visibility:"public" × auth(≠"none")
 * 互斥（共享缓存缓存鉴权响应 = 泄露面，fail-closed）；对象档 maxAge 必须非负整数、无隐式默认
 * （缺 maxAge 就是错——Next 缓存语义三年三变的教训：引入缓存必须一步到位显式契约化）。分发
 * 成功路径对声明对象档的 query 端点注入 Cache-Control: private|public, max-age=N（错误路径
 * errorResponse 不加——错误响应不该被缓存）；"none" 与未声明 = 零变化（无 Cache-Control 头）。
 * A7 差距批（2026-09-29，决策 34）加 restful GET 分发：EndpointDef.restful = true 的 **query** 端点
 * 接受 GET <mount>/<name>?<query>（D-F11 留门的运行时扩张——restful 声明此前只活在 OpenAPI 文档位，
 * 传输面从「文档位」扩为「文档+运行时双真」）。输入构造 = URL 查询串按契约显式类型投影
 * （buildRestfulInput：number Number(v)/boolean 只认 "true"/"false"/string 原样/array 重复键收集；
 * 未知参数与标量重复键显式拒绝 400 ATR-312——URL 是代理日志/浏览器历史里的公共面，寄生参数
 * 不得静默流进 handler，与 POST JSON 体未知键经 validateFlat 静默放行的既有口径**有意分叉**）；
 * 投影产物照走 validateFlat 同链（缺必填/范围违规 → ATR-201，与 POST 同码同文风）；鉴权
 * （gateAuth 单源）/限流（分发器最前闸）/journal（query 永不入账）/成功响应构造（x-atelier-* 头 +
 * A5 Cache-Control 注入）与 POST 全同链——分发 tail 提取为 dispatchEndpoint 共享闭包（纯搬运，
 * POST 行为零变化）。command 声明 restful = 注册期 ATR-313 硬错（export-openapi 扫描器同规则，
 * 声明不可能被静默吞）；未声明 restful 端点零变化（GET 仍落 405 ATR-311 兜底，文案补导航指路）。
 * v2 边界（诚实）：gen auth 产物（会话原语/cookie/端点骨架）归 FS-5 生成器，本模块只做装配层拦截；
 * live 为全量引擎（FS-7，live.ts 协作对象：SSE 失效-重算-推送——单进程内存订阅、重连全量重算，
 * 诚实边界随 live.ts 文件头）；注册表为单进程内存态；command journal 自 B5 差距批（2026-09-28，
 * 决策 29）起为「内存环形 + 追加事件表」双层——db 已装配即持久（command-journal.ts 单源），内存
 * 环形保留为无 db / persist:false / 落库失败 / 读回落时的兜底，增益层不是替代；
 * timeout 中止只停止等待，handler 自身须监听 ctx.signal 提前退出。
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { validateFlat, type AtrError, type FlatField, type FlatSchema } from "../runtime/contract.ts";
import { LiveEngine, type LiveEngineOptions } from "./live.ts";
import { beginWriteCapture, endWriteCapture, type SqliteDb, type WriteCapture } from "./sqlite.ts";
import { INTROSPECT_NAME, introspectResponse } from "./introspect.ts";
import { HEALTH_NAME, healthResponse } from "./health.ts";
import { createCommandJournalSink, type CommandJournalPersistOptions, type CommandJournalSink } from "./command-journal.ts";
import type { BoundJobs, JobsHandle, KvView } from "./jobs.ts"; // 仅类型——运行时单向依赖 jobs.ts → endpoints.ts，零环
import type { BoundEmail, EmailRecorder } from "./email.ts"; // 仅类型——运行时单向依赖 email.ts → endpoints.ts（redactSensitiveInput 单源），零环
import type { UploadDef, UploadsFace } from "./uploads.ts"; // 仅类型——运行时单向依赖 uploads.ts → endpoints.ts（endpointError/foldProdMessage 单源），零环（B1 差距批，决策 32）

export type EndpointKind = "query" | "command";

/** 鉴权声明位（决策 18：元数据先固化形状，gen auth 产物与机检/MCP 消费归 FS-5/FS-6） */
export type EndpointAuthMeta = { type: string } & Record<string, unknown>;

/**
 * 缓存语义声明位（差距批 A5，决策 33——FS-DESIGN §2.2「位先固化」的兑现）：
 * `"none"` = 显式零档（声明「此端点不缓存」——传输语义与未声明相同、声明进内省/OpenAPI；
 * 全端点可声明，「不缓存」是无缓存声明非缓存声明）；
 * 对象档 = `{ visibility: "private" | "public"; maxAge: 非负整数秒 }`（真实缓存声明，只许
 * query 端点——register() 定义期硬错见 assertCacheMeta），分发成功路径据此注入
 * `Cache-Control: private|public, max-age=N`。未声明 = 零变化（不发 Cache-Control）；
 * **无隐式默认**（缺 maxAge 就是错，不给默认值——显式优于隐式正是本决策的存在理由，
 * §2.2/§16 对表 Next 缓存语义三年三变的教训）。
 */
export type EndpointCacheMeta = "none" | { visibility: "private" | "public"; maxAge: number };

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
  /**
   * jobs 投递口（A1 差距批，§5.6；可选位——仅 createHandler({ jobs }) 装配后存在）。
   * enqueue 固定经 ctx.db 同连接执行 → `ctx.db.tx(() => { 业务写; ctx.jobs.enqueue(...) })`
   * 投递与业务写同一事务原子（tx 抛错 job 行一并回滚）；语义全量见 jobs.ts（ATR-350 参数面）。
   * live 重算 ctx（live.ts）不带本位——共享重算无请求连接，job 化长任务从 command handler 投递。
   */
  jobs?: BoundJobs;
  /**
   * 幂等键 KV（A4 差距批，§5.6；可选位——仅 createHandler({ jobs }) 装配后存在）：
   * get/set/setIfAbsent 显式原语，绑定 ctx.db 同连接（与业务写同事务）。**不自动改 command/
   * idempotent 元数据语义**（§3.6 元数据保持纯声明）——handler 显式 setIfAbsent 去重。
   */
  kv?: KvView;
  /**
   * email 投递口（B3 差距批，§5.8；可选位——仅 createHandler({ email }) 装配后存在）。
   * send 直通装配的 recorder（createEmailRecorder 产物）——记账 INSERT 经 ctx.db 同一连接 →
   * `ctx.db.tx(() => { 业务写; ctx.email.send(...) })` 业务写与记账行同事务（mock transport
   * 零外部 IO = 完全原子；真实 transport 无分布式事务——回滚只回滚记账不召回邮件，诚实边界
   * 见 email.ts）。未装配 = ctx.email 不存在（jobs/kv 同款可选位诚实呈现）。
   */
  email?: BoundEmail;
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
  /** 缓存语义显式声明（§2.2，差距批 A5 决策 33）：档位形状与定义期硬错规则见 EndpointCacheMeta */
  cache?: EndpointCacheMeta;
  /**
   * restful 互操作位（§3.4，差距批 A7 决策 34）：true = 该 **query** 端点接受
   * GET <mount>/<name>?<query> 分发（URL 查询串按契约显式投影，鉴权/限流/校验/journal 与 POST
   * 全同链——见 buildRestfulInput 与分发器 restful GET 分支）。默认关：未声明 = 零变化
   * （GET 落既有 405 ATR-311 兜底）；command 声明 = 注册期 ATR-313 硬错（读写二分纪律——
   * export-openapi 扫描器同规则）。OpenAPI 文档位（export-openapi restful 分支）与运行时分发
   * 自此同源双真；v1 不进内省（EndpointSummary 零形状——留门注记见 docs/design-decisions.md）。
   */
  restful?: boolean;
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
  /** 缓存档位（A5 决策 33 MCP/introspect 消费位）：声明了才出现（未声明无键——形状冻结纯加法） */
  cache?: EndpointCacheMeta;
  authType?: string;
  /** 角色声明（§6.2 MCP 消费位）：auth: { type, role } 声明了 role 时携带（agent 可查"哪些端点要什么身份"） */
  authRole?: string;
};

export function endpointError(code: string, message: string, fix: string, hints?: string[]): AtrError {
  return { code, message, context: { component: "atelier-server", hints }, fix };
}

/**
 * 限流装配项（A2 功能批，in-memory v1）：显式声明纪律——缺省不启用，零行为变化。
 * 滑动窗口按 key 计数：窗口内第 max+1 个请求 → 429 + ATR-344 + Retry-After 头。
 * 诚实边界（随装配点注释重申）：单进程内存态，重启清零；多实例部署需外置限流器（v1 不做）；
 * 键表软上限（超 1 万键清半）防海量伪造 IP 撑爆内存——宁可瞬时放开不无界吃内存。
 */
export type RateLimitOptions = {
  /** 滑动窗口长度 ms */
  windowMs: number;
  /** 窗口内每 key 允许的最大请求数 */
  max: number;
  /**
   * 限流键提取（缺省读 x-atelier-remote-addr 头——node-host 桥从 socket 对端注入并覆盖入站
   * 同名头（防伪造），无该头的直挂调用落 "unknown" 共享桶；反代链后面的部署应自定义 keyBy
   * 读可信跳（如自身反代追加的 x-forwarded-for 尾值）。
   */
  keyBy?: (req: Request) => string;
};

/** 限流缺省键：桥注入的 x-atelier-remote-addr → 兜底共享桶（诚实：缺头时所有调用方同桶） */
function defaultRateLimitKey(req: Request): string {
  return req.headers.get("x-atelier-remote-addr") ?? "unknown";
}

/** 限流判定（滑动窗口，纯同步）：true = 放行（时间戳已入桶）；false = 超限（附 Retry-After 秒数） */
function tickRateLimit(buckets: Map<string, number[]>, opts: RateLimitOptions, key: string, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const cutoff = now - opts.windowMs;
  let list = buckets.get(key);
  if (list == null) {
    list = [];
    buckets.set(key, list);
  }
  while (list.length > 0 && list[0]! <= cutoff) list.shift(); // 滑出窗口的时间戳出列
  if (list.length >= opts.max) {
    const retryMs = list[0]! + opts.windowMs - now; // 最早入窗时间戳滑出的时刻 = 桶腾出位子的时刻
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  list.push(now);
  // 键表有界（诚实边界见 RateLimitOptions）：超软上限清一半（Map 插入序 ≈ 最旧键优先）
  if (buckets.size > 10_000) {
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (buckets.size <= 5_000) break;
    }
  }
  return { ok: true };
}

/** 429 ATR-344 响应（Retry-After 头 = 距桶腾出位子的秒数，向上取整最少 1） */
function rateLimitResponse(retryAfterSec: number): Response {
  const res = errorResponse(
    429,
    endpointError(
      "ATR-344",
      "请求过于频繁：限流窗口内已超配额（429）",
      `等待 Retry-After 指示的秒数后重试；配额与窗口由装配点 createHandler({ rateLimit: { windowMs, max } }) 显式声明（缺省不限流）。诚实边界：单进程内存态，重启清零`
    )
  );
  res.headers.set("retry-after", String(retryAfterSec));
  return res;
}

/**
 * API key 装配项（A6 最小切口，2026-09-28，决策 30）：机器客户端静态 key 比对——显式声明纪律，
 * 缺省不启用（未装配时 auth.type:"apikey" 端点的 key 通道恒拒 fail-closed，与 rateLimit/statusToken
 * 同款）。不建 key 管理面/数据库表/轮换系统（OAuth 全套仍归 FS-DESIGN §6.4 预留位）：key 无过期/
 * 无吊销列表（重启即重读装配配置）、无 per-key 审计主体区分（principal = label ?? "api-key"，
 * 装配级 label）、限流共用全局桶。诚实边界随装配点注释重申。
 */
export type ApiKeysOptions = {
  /** 允许的静态 key 清单（机器客户端携 header 比对；非法项——非字符串/空串——恒不命中不抛） */
  keys: string[];
  /** key 头名（缺省 "x-api-key"）；端点 auth 声明的 header 字段可按端点覆盖（文档即真相同源，见分发拦截处） */
  header?: string;
  /** 装配级审计主体自报（journal principal 缺省 "api-key"；v1 无 per-key 区分） */
  label?: string;
};

/**
 * API key 恒时比较（A6，决策 30）：node:crypto timingSafeEqual 逐一比对**全部** keys（不提前返回——
 * 不泄露命中序位），非法输入不抛恒 false。长度不齐也恒时：与目标 key **等长的全零 dummy** 跑一次
 * 真实 timingSafeEqual（恒 false）——每个装配 key 恰好一次同长度比较，时间形态与命中路径同形，
 * 不泄露装配 key 的长度侧信道。与 introspect.ts tokenEq（单对字符串先哈希定长再比）机制不同：
 * 本函数面对 key 清单须逐 key 等形迭代，两处注释互指。
 */
export function apiKeyMatches(presented: unknown, keys: readonly unknown[]): boolean {
  if (typeof presented !== "string") return false;
  let hit = false;
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) continue; // 非法装配项恒不命中（fail-closed，不抛）
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(key, "utf8");
    if (a.length === b.length) {
      if (timingSafeEqual(a, b)) hit = true;
    } else {
      timingSafeEqual(Buffer.alloc(b.length), b); // 等长 dummy 烧同样一次比较（恒 false，返回值弃用）
    }
  }
  return hit;
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

/**
 * 缓存档位定义期校验（差距批 A5，决策 33——FS-DESIGN §2.2「位先固化」的兑现）。定义期 =
 * register() 注册期显式失败（ATR-313——registerUpload maxBytes/accept 参数校验同码先例，
 * 不另开新码），报错文风对齐 assertInvalidateKeys/ATR-315：「契约错误炸在定义处」：
 *   ① 显式零档 "none" 全端点可声明（command/live 亦然——「此端点不缓存」是无缓存声明非缓存
 *      声明，无语义矛盾；位先固化形状保持，server-v2 基线用例钉住）；
 *   ② 对象档（真实缓存声明）只许非 live 的 query 端点——command 带 = 写端点缓存响应语义
 *      自相矛盾；live query 带 = SSE 通道有自己的头语义（缓存头对推送无意义，且 live×cache
 *      组合会把「订阅即重算」的实时语义与「可缓存」声明并置误导消费方）；live:false = 显式
 *      无 live（isLiveDeclared 同口径，与 ATR-315 一致）不触发；
 *   ③ visibility:"public" × auth(≠"none") 互斥——public 允许共享缓存（CDN/代理）暂存响应，
 *      鉴权端点的响应是按主体变化的私有数据，被共享缓存命中 = 跨主体泄露面，fail-closed；
 *      private（仅浏览器/私有缓存）任意 auth 可；public × auth:none（显式消警）可；
 *   ④ 对象档形状 = { visibility: "private" | "public", maxAge: 非负整数秒 }——visibility 只认
 *      两值；maxAge **无隐式默认**（缺 maxAge 就是错，不给默认值——显式优于隐式正是本决策的
 *      存在理由）；未知键收紧硬错（db.ts table() opts 同款纪律，静默忽略元数据键 = 声明被吞）。
 */
function assertCacheMeta(def: EndpointDef): void {
  const cache = def.cache;
  if (cache == null) return; // 未声明 = 零变化（分发器不发 Cache-Control，内省/OpenAPI 无键）
  if (cache === "none") return; // 显式零档：传输语义与未声明相同（无 Cache-Control），声明进内省/OpenAPI
  if (def.kind === "command") {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 是 command，却声明 cache——写端点缓存响应语义自相矛盾`,
        "移除该 command 的 cache 声明（写端点不缓存）；确需缓存头的是读取面时，改用 query 端点声明"
      )
    );
  }
  if (isLiveDeclared(def)) {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 同时声明 live 与 cache——live SSE 通道有自己的头语义，Cache-Control 不适用`,
        "二选一：需要缓存头则移除 live 声明，改普通 query 端点经 POST 直调；需要 SSE 失效推送则移除 cache 声明"
      )
    );
  }
  if (typeof cache !== "object" || Array.isArray(cache)) {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 的 cache 档位非法：${String(JSON.stringify(cache) ?? cache)}（只认 "none" 或 { visibility, maxAge } 对象）`,
        `写成 cache: "none" 或 cache: { visibility: "private" | "public", maxAge: <非负整数秒> }`
      )
    );
  }
  const unknownKeys = Object.keys(cache).filter((k) => k !== "visibility" && k !== "maxAge");
  if (unknownKeys.length > 0) {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 的 cache 声明含未知键：${unknownKeys.join(", ")}（对象档只认 visibility/maxAge 两键）`,
        "修正 cache: { visibility: \"private\" | \"public\", maxAge: <非负整数秒> }——v1 不做 stale-while-revalidate 等扩展指令（要了再加，无隐式默认）"
      )
    );
  }
  if (cache.visibility !== "private" && cache.visibility !== "public") {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 的 cache.visibility 非法：${String(cache.visibility)}（只认 "private" | "public"）`,
        '写成 visibility: "private"（仅浏览器/私有缓存可存）或 visibility: "public"（共享缓存可存，且不得声明 auth ≠ none）'
      )
    );
  }
  if (cache.maxAge === undefined) {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 的 cache 声明缺 maxAge（无隐式默认——显式优于隐式正是本决策的存在理由）`,
        "补 maxAge: <非负整数秒>（缓存多久，秒）；0 = 显式零秒（禁缓存邻域）也须写明"
      )
    );
  }
  if (!Number.isInteger(cache.maxAge) || cache.maxAge < 0) {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 的 cache.maxAge 非法：${String(cache.maxAge)}（须为非负整数秒）`,
        "写成非负整数字面量（如 30、60）；负数/小数/非数值均非法——Cache-Control 的 max-age 指令只接受非负整数秒"
      )
    );
  }
  if (cache.visibility === "public" && def.auth != null && def.auth.type !== "none") {
    throw new AtrEndpointError(
      endpointError(
        "ATR-313",
        `端点 ${def.name} 同时声明 cache.visibility: "public" 与 auth: { type: "${def.auth.type}" }——public 允许共享缓存（CDN/代理）暂存响应，鉴权端点的响应按主体变化，被共享缓存命中 = 跨主体泄露面`,
        '三选一：改 visibility: "private"（仅浏览器私有缓存）；该端点确属全员可缓存时显式声明 auth: { type: "none" }；或移除 cache 声明'
      )
    );
  }
}

/** 超时竞速哨兵：Promise.race 输家判定用（区别于 handler 自身抛出的任何错误） */
const TIMEOUT_BREACH = Symbol("atelier-endpoint-timeout");

/* ---- restful GET 输入构造（差距批 A7，决策 34）：URL 查询串 → 契约输入对象 ----
 * 每参数值是字符串，按端点输入契约（FlatSchema reqProps/optProps，runtime/contract.ts FlatField
 * 类型全集 = string | number | boolean | array）做**显式类型投影**——有什么类型投影什么，不猜：
 *   string   原样透传（URLSearchParams 已解码）；
 *   number   Number(v)；空串（`?n=`——Number("")===0 的无声陷阱）与 NaN 显式拒绝；
 *   boolean  只认 "true"/"false"（URL 惯例两值——"1"/"yes" 不猜）；
 *   array    重复键收集（URLSearchParams.getAll，Web 标准——?tag=a&tag=b → ["a","b"]；单值 =
 *            单元素数组），元素按 items 逐个投影（无 items = 原样字符串，与 collectFlatIssues
 *            无 items 不查元素的既有口径一致；items 嵌套数组无查询串表示 → 拒绝）。
 * 未知参数显式拒绝（400 ATR-312）：POST JSON 体的未知键经 validateFlat **静默放行**（既有口径，
 * runtime/contract.ts 零改动），GET 查询串**有意更严**——URL 是代理日志/浏览器历史里的公共面，
 * utm_source/缓存戳等寄生参数静默流进 handler 输入；无契约端点 = 无投影依据，带参即拒（fix 指路补契约）。
 * 标量字段重复键（?id=1&id=2）同样拒绝——get() 取首值是无声猜测，不猜。
 * 码位复用先例：ATR-312 = 传输层输入形态非法槽位（决策 32 multipart 结构非法「JSON 非法体同槽位」
 * 同款）——本处 = 查询串投影失败，与契约违规 ATR-201（validateFlat 域）分层。
 * 限定红线：本函数只投影**在场**参数；缺必填由下方 validateFlat 同链报 ATR-201（与 POST 缺字段
 * 同码同文风）——投影层不重复立缺字段口径，GET/POST 一致性由同链保证。 */

/** 单叶子投影（string/number/boolean；array 仅作嵌套数组拒绝位——顶层数组在 buildRestfulInput 收集） */
function projectQueryLeaf(field: FlatField, raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (field.type) {
    case "string":
      return { ok: true, value: raw };
    case "number": {
      if (raw === "") return { ok: false, reason: "空串不是数值字面量（?n= 会被 Number 静默转 0——显式拒绝）" };
      const n = Number(raw);
      if (Number.isNaN(n)) return { ok: false, reason: `"${raw}" 不是数值字面量` };
      return { ok: true, value: n };
    }
    case "boolean":
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return { ok: false, reason: `"${raw}" 不是布尔字面量（只认 "true"/"false"）` };
    case "array":
      return { ok: false, reason: "数组元素不支持嵌套数组（扁平 schema 红线——约束只挂叶子）" };
  }
}

/** 投影失败的 400 ATR-312 统一出口（消息指明字段与原因；schemaless = 无契约端点带参） */
function restfulInputError(def: EndpointDef, key: string, info: { field: FlatField | null; reason: string; schemaless: boolean }): AtrError {
  if (info.schemaless) {
    return endpointError(
      "ATR-312",
      `端点 ${def.name} 的 GET 查询参数 "${key}" 不在契约中（该端点未声明 contract——GET 查询串按契约投影，无契约即无投影依据）`,
      `为端点 ${def.name} 声明 contract（FlatSchema 契约单源）后 GET 分发才有输入面，或改用 POST 直调（JSON 体，无契约时须为对象）`
    );
  }
  if (info.field == null) {
    return endpointError(
      "ATR-312",
      `端点 ${def.name} 的 GET 查询参数 "${key}" 不在契约 reqProps/optProps 中（未知参数显式拒绝——决策 34）`,
      "只用契约声明的参数；确需携带契约外数据时改用 POST 直调（JSON 体——未知键经契约校验静默放行是 POST 既有口径，两通道有意分叉：URL 是公共面）"
    );
  }
  return endpointError(
    "ATR-312",
    `端点 ${def.name} 的 GET 查询参数 "${key}" 投影失败（契约类型 ${info.field.type}）：${info.reason}`,
    `按契约类型传值：number = 十进制数字面量（如 42）、boolean = "true"/"false"、string = 原样、array = 重复键（?tag=a&tag=b）、标量字段不认重复键；确需携带契约外数据时改用 POST 直调`
  );
}

/**
 * restful GET 分发的输入构造单源（分发器 restful GET 分支调用；语义全量见上方块注）。
 * 返回 { ok: true, input } = 投影成功（**在场参数**的对象——缺必填交由 validateFlat 同链）；
 * { ok: false, error } = 400 ATR-312（未知参数/投影失败/重复键）。
 */
function buildRestfulInput(def: EndpointDef, searchParams: URLSearchParams): { ok: true; input: Record<string, unknown> } | { ok: false; error: AtrError } {
  const schema = def.contract;
  const req = schema?.reqProps ?? {};
  const opt = schema?.optProps ?? {};
  const known = new Map<string, FlatField>();
  for (const [k, f] of Object.entries(req)) known.set(k, f);
  for (const [k, f] of Object.entries(opt)) known.set(k, f);
  const input: Record<string, unknown> = {};
  for (const key of new Set(searchParams.keys())) {
    const field = known.get(key);
    if (field == null) {
      return { ok: false, error: restfulInputError(def, key, { field: null, reason: "", schemaless: schema == null }) };
    }
    if (field.type === "array") {
      const items: unknown[] = [];
      for (const raw of searchParams.getAll(key)) {
        const one = projectQueryLeaf(field.items ?? { type: "string" }, raw);
        if (!one.ok) return { ok: false, error: restfulInputError(def, key, { field, reason: one.reason, schemaless: false }) };
        items.push(one.value);
      }
      input[key] = items;
      continue;
    }
    const values = searchParams.getAll(key);
    if (values.length > 1) {
      return { ok: false, error: restfulInputError(def, key, { field, reason: `重复出现 ${values.length} 次（标量参数不认重复键）`, schemaless: false }) };
    }
    const one = projectQueryLeaf(field, values[0]!);
    if (!one.ok) return { ok: false, error: restfulInputError(def, key, { field, reason: one.reason, schemaless: false }) };
    input[key] = one.value;
  }
  return { ok: true, input };
}

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

/**
 * 鉴权拦截单源（B1 差距批收口：原分发器内联拦截链提为函数——端点分发与上传面路由**同一链**复用，
 * 两处消息/码位零漂移）。语义（§6.2）：auth.type:"apikey" = 机器客户端通道（会话优先 + 静态 key
 * 恒时比对，缺省不启用恒拒 fail-closed——决策 30）；其余 type（≠"none"）= 会话通道（读取器未装配
 * 与无会话同码 ATR-340，fix 分流）；role 声明不符 → ATR-341。auth.type:"none" 不进本函数（调用方
 * 判定后跳过——显式消警语义不变）。kindLabel = 消息主语（"端点" | "上传面"）——端点侧取 "端点"
 * 时消息与收口前逐字节一致（行为零变化红线）。
 */
type AuthGate = { ok: true; auth: AuthInfo } | { ok: false; response: Response };

function gateAuth(kindLabel: string, name: string, authMeta: EndpointAuthMeta, readAuth: AuthReader | undefined, apiKeys: ApiKeysOptions | undefined, req: Request): AuthGate {
  let identity: AuthInfo | null;
  if (authMeta.type === "apikey") {
    // ---- A6 API key 最小切口（2026-09-28，决策 30）：机器客户端通道，人机双通道并存 ----
    // 会话优先：readAuth 照常调用一次并复用进 ctx（总调用次数纪律不变），有效会话直接走
    // 会话身份（与 type:"session" 端点同语义——人机同权限时人先行，会话是更强身份）；无会话才
    // 落到 key 比对。key 通道缺省不启用：未装配 apiKeys = 恒拒 fail-closed（不静默全开）。
    // 头名解析：端点 auth 声明 header（文档即真相同源——export-openapi 同式投影）优先于
    // 装配 apiKeys.header，再落到缺省 "x-api-key"。
    const metaHeader = (authMeta as { header?: unknown }).header;
    const keyHeader = typeof metaHeader === "string" && metaHeader !== "" ? metaHeader : (apiKeys?.header ?? "x-api-key");
    const sessionAuth = readAuth ? readAuth(req) : null;
    if (sessionAuth != null) {
      identity = sessionAuth; // 会话是更强身份——落到底部共享 role 检查（与收口前控制流同构）
    } else if (apiKeys == null) {
      // fail-closed：key 通道未装配（装配点开发者遗漏）——机器客户端恒拒，fix 指向装配点
      return {
        ok: false,
        response: errorResponse(
          401,
          endpointError(
            "ATR-340",
            `${kindLabel} ${name} 要求 apikey 鉴权，但 createHandler 未装配 apiKeys（机器客户端通道缺省不启用）`,
            `装配点显式接线：createHandler({ apiKeys: { keys: [...] } })（缺省头 ${keyHeader}，可用 header 字段自定义；人用会话 cookie 通道不受影响）；该${kindLabel}确属免鉴权时显式声明 auth: { type: "none" }（§6.2）`,
            [name]
          )
        ),
      };
    } else {
      const presented = req.headers.get(keyHeader);
      if (presented == null || !apiKeyMatches(presented, apiKeys.keys)) {
        // 错 key 与缺头同码同文案（不区分呈现——不给探测者额外信息差）
        return {
          ok: false,
          response: errorResponse(
            401,
            endpointError(
              "ATR-340",
              `${kindLabel} ${name} 要求 apikey 鉴权，请求未携带有效 API key（header ${keyHeader}）`,
              `机器客户端携 ${keyHeader} 头重试（key 由装配点 createHandler({ apiKeys }) 分发）；人用会话 cookie 通道不受影响（先建立会话再调用 = POST auth.login）`,
              [name]
            )
          ),
        };
      }
      // apikey 身份（AuthInfo 同构投影）：principal = 装配级 label ?? "api-key"——journal 审计
      // 主体随之（无 per-key 区分，诚实边界见 ApiKeysOptions）；无角色面（声明 role 的端点
      // 对 key 身份走底部共享 ATR-341 恒拒——v1 不做 per-key 角色）。
      identity = { type: "apikey", principal: apiKeys.label ?? "api-key" };
    }
  } else {
    identity = readAuth ? readAuth(req) : null;
    if (identity == null) {
      // 读取器未装配（装配点开发者遗漏）与请求无会话（调用方问题）同码 ATR-340（401），fix 分流：
      return {
        ok: false,
        response: errorResponse(
          401,
          readAuth
            ? endpointError(
                "ATR-340",
                `${kindLabel} ${name} 要求 ${authMeta.type} 鉴权，请求未携带有效会话`,
                `先建立会话再调用（gen auth 产物 = POST auth.login，成功响应 Set-Cookie 会话 cookie，携 cookie 重试）；该${kindLabel}确属免鉴权时显式声明 auth: { type: "none" }（显式选择优于沉默缺省，§6.2）`,
                [name]
              )
            : endpointError(
                "ATR-340",
                `${kindLabel} ${name} 声明了 auth: { type: "${authMeta.type}" }，但 createHandler 未装配 auth 会话读取器`,
                `装配点显式接线：createHandler({ db, auth: createSessionReader(db) })（gen auth 产物 auth.ts 提供读取器工厂）；该${kindLabel}确属免鉴权时改为 auth: { type: "none" }`,
                [name]
              )
        ),
      };
    }
  }
  // ---- 共享 role 检查（会话/apikey 两身份同过此门——与收口前「下方 ATR-341」位置同构） ----
  const wantRole = (authMeta as { role?: unknown }).role;
  if (typeof wantRole === "string" && identity.role !== wantRole) {
    const actual = typeof identity.role === "string" ? identity.role : "（无角色）";
    return {
      ok: false,
      response: errorResponse(
        403,
        endpointError(
          "ATR-341",
          `${kindLabel} ${name} 要求角色 ${wantRole}，会话主体 ${identity.principal ?? "（匿名）"} 的角色是 ${actual}`,
          `为该主体授予 ${wantRole} 角色（应用侧用户数据，行级判断在 handler 内读 ctx.auth 显式做——RLS 式隐式策略不做，§6.2），或修正 auth: { type, role } 声明`,
          [name]
        )
      ),
    };
  }
  return { ok: true, auth: identity };
}

export class EndpointRegistry {
  private defs = new Map<string, EndpointDef>();
  /**
   * B1 差距批（2026-09-28，决策 32）：上传面**兄弟注册表**——不混入端点表（list()/names()/
   * introspect 端点表形状零变化；api-diff/OpenAPI 投影/契约层零触碰）。定义经 defineUpload
   * 构造、registerUpload 注册（命名/重名/参数校验同端点「注册期显式失败」纪律，ATR-313 同码）。
   */
  private uploadsDefs = new Map<string, UploadDef>();
  private journalBuf: EndpointJournalEntry[] = [];
  readonly journalLimit: number;
  /**
   * B5（决策 29）：command journal 持久写口槽位——createHandler 装配 db 且未显式关闭时持有
   * （command-journal.ts 工厂产物）；null = 纯内存（无 db / persist:false）。注册表单槽位：
   * 同 registry 多次 createHandler 以最后一次装配为准（重启语义 = 新实例新 registry，正常装配
   * 不触发）。journalPush 是唯一消费点（kind 守卫 + 落库失败降级都在那里收口）。
   */
  private journalSink: CommandJournalSink | null = null;
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
    // ---- cache 档位定义期硬错（A5 差距批，决策 33；规则全量见 assertCacheMeta 注释）：
    //      对象档（真实缓存声明）只许非 live 的 query 端点；public×auth(≠none) 泄露面互斥；
    //      对象档形状（visibility 两值 + maxAge 非负整数无隐式默认 + 未知键收紧）——注册期
    //      显式失败（ATR-313），声明不可能被静默忽略。"none" 显式零档全端点可声明（位先固化
    //      形状保持——server-v2 基线用例钉住 command 上 "none" 合法，且「不缓存」声明无语义矛盾） ----
    assertCacheMeta(def as EndpointDef);
    // ---- restful 互操作位定义期硬错（差距批 A7，决策 34）：restful GET 分发只许 query 端点声明。
    //      command 带 = 写端点不存在 GET 分发语义（读写二分纪律，D-F11）；export-openapi 扫描器
    //      同规则先例（scanOpenApiEndpoints restful 分支同文案同拦截）——运行时不校验的话，
    //      command+restful 会静默注册成功、直到导出 OpenAPI 才炸（声明被吞 = 晚失败），与
    //      assertCacheMeta「契约错误炸在定义处」同款纪律（ATR-313 同码，不另开新码） ----
    if (def.restful === true && def.kind !== "query") {
      throw new AtrEndpointError(
        endpointError(
          "ATR-313",
          `端点 ${def.name} 是 command，却声明 restful: true`,
          "restful GET 分发位（§3.4，决策 34）只许 query 端点声明——写端点保持 POST（读写二分纪律）；确有 GET 读面需求时改用 query 端点声明"
        )
      );
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

  /**
   * 上传面显式注册（B1 差距批，决策 32；reg.register 的兄弟形态）：命名同端点 NAME_RE、重名/
   * maxBytes/accept 参数非法 = ATR-313（端点注册冲突或命名非法同码——「注册冲突或命名非法」
   * 同一槽位，消息主语「上传面」）。auth 校验不做（端点同款——形状由消费方 gateAuth 消费）。
   */
  registerUpload(def: UploadDef): this {
    if (typeof def?.name !== "string" || !NAME_RE.test(def.name)) {
      throw new AtrEndpointError(endpointError("ATR-313", `上传面名非法：${String(def?.name)}`, "上传面名只允许字母开头的 [A-Za-z0-9_.-]（与端点同名文法——URL 路径拼接的安全前提）"));
    }
    if (this.uploadsDefs.has(def.name)) {
      throw new AtrEndpointError(endpointError("ATR-313", `上传面重复注册：${def.name}`, `换名或先移除；已注册上传面：${this.uploadNames().join(", ") || "（无）"}`, this.uploadNames()));
    }
    if (def.maxBytes != null && (!Number.isFinite(def.maxBytes) || def.maxBytes <= 0)) {
      throw new AtrEndpointError(endpointError("ATR-313", `上传面 ${def.name} maxBytes 非法：${String(def.maxBytes)}（须为正数）`, "以字节数声明单请求上限（缺省 20MB = 20971520，独立于端点面 JSON maxBodyBytes）"));
    }
    if (def.accept != null && (!Array.isArray(def.accept) || def.accept.some((a) => typeof a !== "string" || a.trim() === ""))) {
      throw new AtrEndpointError(endpointError("ATR-313", `上传面 ${def.name} accept 非法（须为非空字符串数组）`, `mime 白名单前缀语义："image/" 前缀 / "image/*" 通配 / "image/png" 精确；不限类型时省略 accept 字段`));
    }
    this.uploadsDefs.set(def.name, def);
    return this;
  }

  /** 上传面定义读取（分发器按名取用；缺省 = undefined → 404 ATR-310 未知上传面） */
  upload(name: string): UploadDef | undefined {
    return this.uploadsDefs.get(name);
  }

  /** 已注册上传面名（排序；与端点 names() 分列——端点表零混入） */
  uploadNames(): string[] {
    return [...this.uploadsDefs.keys()].sort();
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
        ...(d.cache != null ? { cache: d.cache } : {}),
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
    // B5（决策 29）：脱敏后的条目就是持久化单源——内存与持久表各写一份（增益层不是替代），
    // 持久层不二次实现脱敏。
    const stored: EndpointJournalEntry = { ...entry, input: redactSensitiveInput(entry.input) };
    this.journalBuf.push(stored);
    while (this.journalBuf.length > this.journalLimit) this.journalBuf.shift();
    // kind 守卫：只 command 条目入表——live 引擎的 query 重算失败条目（ATR-321）是诊断非命令
    // 审计，留内存环形（表名与 status CHECK 语义都是 command 域，见 command-journal.ts 头注）。
    // 落库失败 = console.warn 降级不抛（审计不挡业务：该条只存内存环形，绝不反噬 command 响应）。
    if (entry.kind === "command" && this.journalSink != null) {
      try {
        this.journalSink.append(stored);
      } catch (e) {
        console.warn(`[atelier] command journal 落库失败（降级：条目仅存内存环形，不反噬 command 响应）: ${(e as Error)?.message ?? String(e)}`);
      }
    }
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
   * → 声明 live 的 query 端点走 SSE 订阅（live.ts 引擎：失效-重算-推送）；A7 加法通道（决策 34）：
   * GET <mount>/<name>?<query> → 声明 restful:true 的 query 端点走运行时 GET 分发（查询串按契约
   * 显式投影 buildRestfulInput，鉴权/限流/校验/journal/成功响应构造与 POST 全同链）；其余非 POST
   * 维持 ATR-311 兜底（fix 补指路 restful 导航）。装配点（§3.2）：db / auth 一次性显式注入，无 DI 容器——装配代码在应用入口明文可见。
   * A2 硬化3：maxBodyBytes = 请求体上限（缺省 1MiB），JSON 解析处校验，超限 413 ATR-346
   * （不进 handler、不入 journal——与鉴权拦截同款"被拒之门前不触碰 handler"语义）；
   * node-host 桥侧另有读体中途截断的同上限闸（更早、更省内存），本兜底覆盖直挂宿主/进程内调用。
   * A2 硬化5：statusToken = server-status 调试面门禁（缺省不设 = 行为零变化；设置后 GET
   * <mount>/__atelier/server-status 要求 x-atelier-token 头，401 ATR-340——见 introspect.ts）。
   * A1/A4 差距批：jobs = startJobs 产物句柄（jobs.ts）装配——ctx 增 jobs.enqueue（固定经 db
   * 同连接执行 → tx 原子投递）与 ctx.kv（幂等键显式原语，绑定 db）；未装配 = 两 ctx 位不存在
   * （可选位诚实呈现，行为零变化）。
   * B4 差距批（2026-09-28）：version = 健康面装配点自报版本（可选，缺省 null——语义与边界见
   * health.ts）；startedAtMs 在本装配点记一处（performance.now()）作 uptimeMs 的 monotonic 起点。
   * B5 差距批（2026-09-28，决策 29）：journal = { persist?, maxRows? }——command journal 持久化。
   * persist 缺省 = db 已装配即 true（开箱即得持久审计面）；persist:false 显式关闭回纯内存；
   * 无 db 恒内存（现状零变化）。maxRows = 行数基保留窗口（缺省 1 万，写时惰性裁最老）。
   * 落库失败由 journalPush 统一 console.warn 降级，不反噬 command 响应（命令审计面见 command-journal.ts）。
   * A6 差距批（2026-09-28，决策 30）：apiKeys = { keys, header?, label? } 机器客户端静态 key 比对
   * 装配项——auth.type:"apikey" 端点的 key 通道（缺省不启用 = 恒拒 fail-closed；会话优先双通道
   * 并存；timingSafeEqual 恒时比较见 apiKeyMatches；诚实边界 = key 无过期/吊销/管理面，OAuth 全套
   * 仍归 FS-DESIGN §6.4 预留位）。
   * B3 差距批（2026-09-28，决策 31）：email = createEmailRecorder 产物（email.ts）装配项——
   * 显式 transport 接口 + 内建可验证的投递记账（框架不内建真实发送，mock 为内建唯一 transport）；
   * ctx.email = { send } 绑定视图（记账经 ctx.db 同连接，tx 原子性见 EndpointContext.email）；
   * 未装配 = ctx.email 不存在（行为零变化），introspect email 段同样缺省（零假数据）。
   * B1 差距批（2026-09-28，决策 32）：uploads = createUploadsFace({ db, dir }) 产物（uploads.ts）
   * 装配项——上传/资产面路由分发（POST <mount>/upload/<name> + GET <mount>/assets/<id>）；
   * 面未装配时这两族路由诚实 404 ATR-310 指路装配（不落回「未知端点/改 POST」误导文案）；
   * 上传定义经 reg.registerUpload 注册（兄弟注册表不入端点表），鉴权经 gateAuth 单源（缺省
   * session fail-closed），定义精闸（maxBytes）在面内——JSON maxBodyBytes 闸对上传路由不生效
   * （multipart 独立上限，桥面粗闸见 node-host.ts）。
   */
  createHandler(
    opts: { mount?: string; db?: unknown; auth?: AuthReader; maxBodyBytes?: number; statusToken?: string; rateLimit?: RateLimitOptions; apiKeys?: ApiKeysOptions; jobs?: JobsHandle; email?: EmailRecorder; version?: string | null; journal?: CommandJournalPersistOptions; uploads?: UploadsFace } = {}
  ): (req: Request) => Promise<Response> {
    const startedAtMs = performance.now(); // B4 健康面 uptime 起点（装配时刻 = handler 体诞生时刻）
    const mount = opts.mount ? "/" + opts.mount.replace(/^\/+|\/+$/g, "") : "";
    const db = opts.db; // 无库应用不传 = undefined（ctx.db 直通，诚实呈现）
    // B5（决策 29）：journal 持久写口装配（persist 缺省 = db 已装配即 true；显式关闭/无 db = 纯内存）。
    // 惰性建表在首条 command 入账时发生（旧库零迁移获得该表）；落库失败降级在 journalPush 收口。
    this.journalSink =
      db != null && opts.journal?.persist !== false
        ? createCommandJournalSink(db as SqliteDb, { maxRows: opts.journal?.maxRows })
        : null;
    const readAuth = opts.auth;
    // A6（决策 30）：API key 装配项（缺省不启用——显式声明纪律；auth.type:"apikey" 端点的 key
    // 通道只在装配后开放，会话通道不受本装配影响——人机双通道并存，见分发拦截处）。
    const apiKeys = opts.apiKeys;
    const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const statusToken = opts.statusToken; // A2 硬化5：server-status 门禁（未设 = 行为零变化）
    // A2 功能7：限流（缺省不启用——显式声明纪律；buckets 随本 handler 单例，重启即清零）
    const rateLimit = opts.rateLimit;
    const rateBuckets = rateLimit != null ? new Map<string, number[]>() : null;
    const rateKeyOf = rateLimit?.keyBy ?? defaultRateLimitKey;
    // A1/A4 差距批：jobs 句柄 → ctx.jobs/ctx.kv 绑定视图（预构一次——db 随本 handler 定死）
    const jobsHandle = opts.jobs;
    const ctxJobs: BoundJobs | undefined = jobsHandle != null ? { enqueue: (job) => jobsHandle.enqueue(job, db as SqliteDb) } : undefined;
    const ctxKv = jobsHandle != null ? jobsHandle.kv.bound(db as SqliteDb) : undefined;
    // B3 差距批（决策 31）：email recorder → ctx.email 绑定视图（send 直通；记账经 recorder 装配的
    // db 句柄——应用以同一句柄装配 createHandler({ db }) 与 createEmailRecorder({ db }) 即得 tx 原子性）
    const emailHandle = opts.email;
    const ctxEmail: BoundEmail | undefined = emailHandle != null ? { send: (msg) => emailHandle.send(msg) } : undefined;
    // B1 差距批（决策 32）：上传/资产面（uploads.ts 单源——解析/存储/记账/下载）；未装配 =
    // 路由诚实 404 指路装配（见下方路由块）。鉴权在分发器 gateAuth（缺省 session fail-closed），
    // 定义精闸在面内——本模块只做注册表与路由分派。
    const uploadsFace = opts.uploads;
    this.liveEngine.attach({ db }); // FS-7：live 重算与 POST 分发共用同一装配句柄
    /**
     * 分发共享 tail（差距批 A7，决策 34 提取）：ctx 装配（db/auth/signal/audit/setCookie/jobs/kv/email）
     * → handler 调用（timeout race）→ 输出面检查（ATR-215/216 单源）→ command journal 与失效广播
     * → 200 响应构造（x-atelier-* 头 + A5 Cache-Control 注入 + Set-Cookie 透传）。POST 分发与
     * restful GET 分发共用同一构造——cache 注入、query 永不入账、x-atelier-endpoint 头、超时/抛错
     * 映射两通道自动零差。提取为**纯搬运**（语句逐字保留，POST 行为零变化红线），调用方 =
     * 下方 POST 分发与 restful GET 分支。
     */
    const dispatchEndpoint = async (def: EndpointDef, payload: Record<string, unknown>, authRequired: boolean, gatedAuth: AuthInfo | null, req: Request): Promise<Response> => {
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
        // A1/A4 差距批（可选位——未装配 = undefined，与 setCookie 同款防御形态；无 jobs 面零开销）
        ...(ctxJobs != null ? { jobs: ctxJobs, kv: ctxKv } : {}),
        // B3 差距批（决策 31，可选位——未装配 = ctx.email 不存在，jobs/kv 同款诚实呈现）
        ...(ctxEmail != null ? { email: ctxEmail } : {}),
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
          // ---- B5（决策 29）收槽先于 journal 入账：持久化写经同一装配句柄，而 sqlite.ts 捕获槽
          //      把写记录并入**所有**活跃槽——若入账时本 command 的槽仍开着，atelier_command_journal
          //      的 INSERT 会被捕获进自家槽、混入自动失效键（keys 恒多一条 table:atelier_command_journal
          //      污染广播面）。收槽 = 纯收集无副作用（finally 兜底对 null 判空幂等，失败路径不受影响）；
          //      失效广播仍在 journal 入账之后（§4.2 语义只动收槽时刻、不动广播时刻）。红检：
          //      tests/journal-persist.test.ts 收槽顺序用例（onCommandSuccess 键面断言）。 ----
          const captured = capture ? endWriteCapture(capture) : [];
          capture = null;
          this.journalPush(this.journalEntry(def, payload, "ok", principal, durMs(), notes));
          // ---- FS-7 失效广播（§4.2，journal 入账后）：键 = 显式 emits 优先，否则写侧自动表名捕获合成 table:<name> ----
          const keys = def.emits ?? captured.map((t) => `table:${t}`);
          if (keys.length > 0) this.liveEngine.onCommandSuccess(def.name, keys);
        }
        const okHeaders = new Headers({
          "content-type": "application/json; charset=utf-8",
          "x-atelier-endpoint": def.name,
          "x-atelier-endpoint-kind": def.kind,
        });
        // ---- cache 档位（A5 差距批，决策 33）：声明对象档的 query 端点 200 响应注入 Cache-Control ----
        // 只在分发成功路径注入（错误路径 errorResponse 不加——ATR 结构化错误不该被缓存）；
        // "none" 与未声明 = 无头（显式零档与沉默缺省同传输语义，声明差异只进内省/OpenAPI）；
        // live+cache 组合已被注册期拒绝（ATR-313）——SSE 推送路径不涉。
        if (def.kind === "query" && def.cache != null && typeof def.cache === "object") {
          okHeaders.set("cache-control", `${def.cache.visibility}, max-age=${def.cache.maxAge}`);
        }
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
    return async (req: Request): Promise<Response> => {
      // ---- A2 功能7：限流闸（最前——限的是「打到本 handler 的请求」，不分路由；SSE 订阅亦计一次） ----
      if (rateLimit != null && rateBuckets != null) {
        const verdict = tickRateLimit(rateBuckets, rateLimit, rateKeyOf(req), Date.now());
        if (!verdict.ok) return rateLimitResponse(verdict.retryAfterSec);
      }
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
        const res = introspectResponse(this, { db, mount: mount || "/", statusToken, req, jobs: opts.jobs, email: opts.email });
        if (res) return res;
      }

      // ---- B4 差距批（2026-09-28）：健康面路由 GET <mount>/__atelier/health → 三事实 JSON（health.ts）。
      //      与 introspect 同族命名空间、语义分离：server-status=内省面（prod 405 隐身，上方路由）、
      //      health=健康面（prod 恒在——docker/orchestrator 的探活口，永不离线）；**不走 statusToken 门**
      //      （健康面无秘密，门禁只会把探活变成假死报警）；非 GET → 405 ATR-311（既有口径复用，不新配码）；
      //      db 探活抛错 → 503（ok:false + db:"error"——状态码即报警面）。限流闸（本函数最前）对
      //      health 同样计数（闸位单一不分路由豁免）。三事实组装单源 = healthResponse（health.ts）。 ----
      if (name === HEALTH_NAME) {
        if (req.method !== "GET") {
          return errorResponse(
            405,
            endpointError("ATR-311", `健康检查端点只接受 GET：${req.method} ${url.pathname}`, `改为 GET ${mount || ""}/${HEALTH_NAME}（探活 = 幂等读，无请求体；响应 = { ok, uptimeMs, db, version } 四键 JSON）`)
          );
        }
        return healthResponse({ db, version: opts.version ?? null, startedAtMs });
      }

      // ---- B1 差距批（2026-09-28，决策 32）：上传/资产面路由（兄弟注册表——不入端点表，
      //      introspect 端点表形状零变化）。POST <mount>/upload/<name> + GET <mount>/assets/<id>。
      //      端点名文法不含 "/"，upload//assets/ 前缀与端点名空间天然不相交（assets 限数字 id、
      //      upload 限 NAME_RE 名，不匹配的形态照旧落既有 404/405 路径——端点面零扰动）。
      //      面未装配 = 诚实 404 ATR-310 指路装配（落回既有路径会把 GET 资产误报成 405「改
      //      POST」、把上传路由报成「未知端点」——都误导指路）。限流闸（本函数最前）对上传/
      //      下载同样计数（上传是最贵的请求形态——闸位单一不分路由豁免）。 ----
      const uploadRoute = name.startsWith("upload/") ? name.slice("upload/".length) : null;
      if (uploadRoute != null) {
        if (uploadsFace == null) {
          return errorResponse(
            404,
            endpointError(
              "ATR-310",
              `上传/资产面未装配：${url.pathname}`,
              "装配点显式接线：createHandler({ db, uploads: createUploadsFace({ db, dir }) })（uploads.ts 决策 32）；上传定义经 reg.registerUpload(defineUpload({ name, accept?, maxBytes?, auth? })) 注册（兄弟注册表，不入端点表）"
            )
          );
        }
        if (req.method !== "POST") {
          return errorResponse(405, endpointError("ATR-311", `上传面只接受 POST：${req.method} ${url.pathname}`, `改为 POST ${mount || ""}/upload/${uploadRoute}，multipart/form-data 单文件字段体`));
        }
        const upDef = this.uploadsDefs.get(uploadRoute);
        if (!upDef) {
          return errorResponse(404, endpointError("ATR-310", `未知上传面：${uploadRoute}`, `用以下已注册上传面之一：${this.uploadNames().join(", ") || "（无）"}`, this.uploadNames()));
        }
        // 鉴权拦截链单源复用（gateAuth）：**缺省 session**（上传是写面——落盘+记账，未声明 =
        // fail-closed 要求会话，与端点「未声明 = 开放」有意差异）；auth: { type: "none" } = 显式
        // 消警开放，不进 gateAuth（与端点判定同款——显式选择优于沉默缺省，决策 32）。拦截在面内
        // 任何落盘之前——被拒之门前不触碰存储（与端点「不进 handler」同款语义）。
        const upAuth = (upDef.auth ?? { type: "session" }) as EndpointAuthMeta;
        if (upAuth.type !== "none") {
          const gate = gateAuth("上传面", uploadRoute, upAuth, readAuth, apiKeys, req);
          if (!gate.ok) return gate.response;
        }
        return uploadsFace.handleUpload({ req, def: upDef, mount: mount || "" });
      }
      const assetRoute = /^assets\/(\d+)$/.exec(name)?.[1] ?? null;
      if (assetRoute != null) {
        if (uploadsFace == null) {
          return errorResponse(
            404,
            endpointError(
              "ATR-310",
              `上传/资产面未装配：${url.pathname}`,
              "装配点显式接线：createHandler({ db, uploads: createUploadsFace({ db, dir }) })（uploads.ts 决策 32）；上传定义经 reg.registerUpload(defineUpload({ name, accept?, maxBytes?, auth? })) 注册（兄弟注册表，不入端点表）"
            )
          );
        }
        if (req.method !== "GET") {
          return errorResponse(405, endpointError("ATR-311", `资产面只接受 GET：${req.method} ${url.pathname}`, `改为 GET ${mount || ""}/assets/${assetRoute}（内容寻址不可变——响应带 Cache-Control: immutable）`));
        }
        return uploadsFace.handleDownload({ id: assetRoute, mount: mount || "" });
      }

      // ---- 差距批 A7（决策 34）：restful GET 分发（D-F11 留门的运行时扩张）——声明 restful:true 的
      //      query 端点接受 GET <mount>/<name>?<query>。插在 POST 分发兜底之前；与上方 /live 后缀
      //      路由天然无冲突（带 /live 后缀的请求先被截走走 SSE）；未声明 restful / command / 未知
      //      端点的 GET 不在此拦截——落回下方既有 405 ATR-311 兜底（默认关零变化）。
      //      鉴权与 POST 同链（gateAuth 单源，拦截在输入构造之前——「被拒之门前不触碰 handler」
      //      同款语义）；输入构造 = buildRestfulInput（URL 查询串按契约显式投影，未知参数/投影失败
      //      → 400 ATR-312）；投影产物照走 validateFlat 同链（缺必填/范围违规 ATR-201，与 POST
      //      同码同文风，GET/POST 一致性由此保证）；成功路径复用 dispatchEndpoint——Cache-Control
      //      注入/x-atelier-* 头/journal（query 永不入账）/超时与抛错映射与 POST 自动零差。 ----
      if (req.method === "GET") {
        const getDef = this.defs.get(name);
        if (getDef != null && getDef.kind === "query" && getDef.restful === true) {
          const authMeta = getDef.auth;
          const authRequired = authMeta != null && authMeta.type !== "none";
          let gatedAuth: AuthInfo | null = null;
          if (authRequired) {
            const gate = gateAuth("端点", name, authMeta, readAuth, apiKeys, req);
            if (!gate.ok) return gate.response;
            gatedAuth = gate.auth;
          }
          const built = buildRestfulInput(getDef, url.searchParams);
          if (!built.ok) return errorResponse(400, built.error);
          if (getDef.contract != null) {
            const v = validateFlat(getDef.contract, built.input, getDef.name);
            if (!v.ok) return errorResponse(400, v.error!); // 与 POST 缺字段/类型错同链同码 ATR-201
          }
          return dispatchEndpoint(getDef, built.input, authRequired, gatedAuth, req);
        }
        // 非 restful / command / 未知名 → 不拦截，落回下方 405 兜底（restful 默认关 = 零变化）
      }

      if (req.method !== "POST") {
        return errorResponse(405, endpointError("ATR-311", `端点只接受 POST：${req.method} ${url.pathname}`, `GET 分发仅限声明 restful:true 的 query 端点（决策 34——声明后 GET ${mount}/${name}?<query-params>，查询串按契约投影；未声明端点行为零变化）；或改 POST ${mount}/${name}，JSON 体 = 契约输入`, this.names()));
      }
      const def = this.defs.get(name);
      if (!def) {
        return errorResponse(404, endpointError("ATR-310", `未知端点：${name}`, `用以下已注册端点之一：${this.names().join(", ") || "（无）"}`, this.names()));
      }

      // ---- 鉴权拦截（§6.2，FS-M2(m2d) 加法）：只对声明 auth: { type } 且 type !== "none" 的端点生效 ----
      // auth: { type: "none" } = 显式消警（"沉默缺省"才是 agent 高错区）。未声明端点连 readAuth 的
      // 调用时机都维持原状（仍在 dispatchEndpoint ctx 装配处调用一次）——行为零变化。拦截在 handler 之前，
      // journal 不记账（journal 语义 = "分发穿过 handler 之后"，§3.5——被拒之门的请求未触达 handler）。
      // 声明了 auth 的端点：readAuth 在此处调用一次并复用进 ctx（总调用次数与旧路径相同）。
      // B1 差距批：拦截链提为模块级 gateAuth 单源（上传面路由同链复用——两处消息/码位零漂移，
      // 端点侧 kindLabel="端点" 时消息逐字节一致）；A7（决策 34）restful GET 分发同链复用（GET 与
      // POST 鉴权零语义差——session/apikey/role 全支持）。
      const authMeta = def.auth;
      const authRequired = authMeta != null && authMeta.type !== "none";
      let gatedAuth: AuthInfo | null = null;
      if (authRequired) {
        const gate = gateAuth("端点", name, authMeta, readAuth, apiKeys, req);
        if (!gate.ok) return gate.response;
        gatedAuth = gate.auth;
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
      // ---- 输入就绪：ctx 装配/handler/输出面/journal/响应构造走 dispatchEndpoint 共享 tail ----
      // （A7 决策 34 提取为闭包——POST 与 restful GET 两通道同一构造，cache 联动自动一致）
      return dispatchEndpoint(def, payload, authRequired, gatedAuth, req);
    };
  }
}

function errorResponse(status: number, err: AtrError): Response {
  return new Response(JSON.stringify(err, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
