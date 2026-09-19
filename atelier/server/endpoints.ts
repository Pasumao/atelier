/**
 * Atelier 全站服务层（决策 18/20，FS-1）— 端点运行时内核。
 * 读写二分：query（读）/ command（写，成功后自动入审计 journal）；**显式注册表**，
 * 无编译器魔法（与 SvelteKit remote functions 的行业收敛线同形，差异在此）。
 * 传输 = Web 标准 Request/Response（决策 18：Bun 优化态、Node 兜底——本模块零宿主 API 依赖）。
 * 契约 = 决策 6 扁平 schema 单源（validateFlat），校验失败 → ATR-2xx 四段式 JSON。
 * 错误码（决策 9 四域的 3xx 运行时域）：310 未知端点 / 311 方法不允许 / 312 非法 JSON /
 * 313 端点注册冲突或命名非法 / 320 handler 抛错；SQLite 宿主面见 sqlite.ts ATR-330。
 * v1 边界（诚实）：鉴权仅元数据位（gen auth 执行面归 FS-5）；live 仅元数据（SSE→
 * streamValue 直通归 FS-7）；注册表与 journal 为单进程内存态（多实例/持久化归后续）。
 */
import { validateFlat, type AtrError, type FlatSchema } from "../runtime/contract.ts";

export type EndpointKind = "query" | "command";

/** 鉴权声明位（决策 18：元数据先固化形状，gen auth 产物与机检/MCP 消费归 FS-5/FS-6） */
export type EndpointAuthMeta = { type: string } & Record<string, unknown>;

export type EndpointContext = { name: string; kind: EndpointKind };

export type EndpointDef<TInput = Record<string, unknown>, TOutput = unknown> = {
  kind: EndpointKind;
  name: string;
  /** 输入契约（决策 6 扁平 schema 单源；缺省 = 不校验——只许给无入参的端点） */
  contract?: FlatSchema;
  /** live 端点：写事务后重算推送（元数据 v1 即注册；SSE 直通信号图归 FS-7） */
  live?: boolean;
  auth?: EndpointAuthMeta;
  handler: (input: TInput, ctx: EndpointContext) => TOutput | Promise<TOutput>;
};

export function defineQuery<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown>(
  name: string,
  def: Omit<EndpointDef<TInput, TOutput>, "kind" | "name">
): EndpointDef<TInput, TOutput> {
  return { kind: "query", name, ...def };
}

export function defineCommand<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown>(
  name: string,
  def: Omit<EndpointDef<TInput, TOutput>, "kind" | "name">
): EndpointDef<TInput, TOutput> {
  return { kind: "command", name, ...def };
}

export type EndpointJournalEntry = { ts: string; name: string; kind: EndpointKind; input: unknown };

export type EndpointSummary = {
  name: string;
  kind: EndpointKind;
  live: boolean;
  hasContract: boolean;
  authType?: string;
};

export function endpointError(code: string, message: string, fix: string, hints?: string[]): AtrError {
  return { code, message, context: { component: "atelier-server", hints }, fix };
}

/** 框架内部抛错形态（同 runtime 惯例：message 带码前缀），四段式字段随行可结构化消费 */
export class AtrEndpointError extends Error {
  readonly atr: AtrError;
  constructor(err: AtrError) {
    super(`${err.code}: ${err.message}`);
    this.name = "AtrEndpointError";
    this.atr = err;
  }
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export class EndpointRegistry {
  private defs = new Map<string, EndpointDef>();
  private journalBuf: EndpointJournalEntry[] = [];
  readonly journalLimit: number;

  constructor(opts: { journalLimit?: number } = {}) {
    this.journalLimit = opts.journalLimit ?? 500;
  }

  /** 显式注册（决策 18：无编译器魔法；重复名/非法名 = ATR-313 硬错，抛 AtrEndpointError） */
  register(def: EndpointDef): this {
    if (!NAME_RE.test(def.name)) {
      throw new AtrEndpointError(endpointError("ATR-313", `端点名非法：${def.name}`, "端点名只允许字母开头的 [A-Za-z0-9_.-]（URL 路径拼接的安全前提）"));
    }
    if (this.defs.has(def.name)) {
      throw new AtrEndpointError(endpointError("ATR-313", `端点重复注册：${def.name}`, `换名或先移除；已注册端点：${this.names().join(", ") || "（无）"}`, this.names()));
    }
    this.defs.set(def.name, def);
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

  /** 契约摘要（MCP endpoint.list 的数据源，FS-6 复用） */
  list(): EndpointSummary[] {
    return this.names().map((name) => {
      const d = this.defs.get(name)!;
      return {
        name,
        kind: d.kind,
        live: d.live === true,
        hasContract: d.contract != null,
        ...(d.auth ? { authType: d.auth.type } : {}),
      };
    });
  }

  /** 审计 journal（只读视图；command 成功调用入账，环形有界同决策 5 journalLimit 口径） */
  journal(): readonly EndpointJournalEntry[] {
    return this.journalBuf;
  }

  private journalPush(entry: EndpointJournalEntry): void {
    this.journalBuf.push(entry);
    while (this.journalBuf.length > this.journalLimit) this.journalBuf.shift();
  }

  /**
   * Web 标准分发器。约定：POST <mount>/<name>，请求体 = JSON 输入（query 与 command
   * 同走 POST——输入必须过契约校验这条纪律不因动词分叉；GET 语义留给 FS-7 的 live SSE）。
   */
  createHandler(opts: { mount?: string } = {}): (req: Request) => Promise<Response> {
    const mount = opts.mount ? "/" + opts.mount.replace(/^\/+|\/+$/g, "") : "";
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      let rest = url.pathname;
      if (mount && rest.startsWith(mount)) rest = rest.slice(mount.length);
      const name = rest.replace(/^\/+|\/+$/g, "");

      if (req.method !== "POST") {
        return errorResponse(405, endpointError("ATR-311", `端点只接受 POST：${req.method} ${url.pathname}`, `改为 POST ${mount}/${name}，JSON 体 = 契约输入`, this.names()));
      }
      const def = this.defs.get(name);
      if (!def) {
        return errorResponse(404, endpointError("ATR-310", `未知端点：${name}`, `用以下已注册端点之一：${this.names().join(", ") || "（无）"}`, this.names()));
      }
      let input: unknown;
      try {
        input = await req.json();
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
      try {
        const result = await def.handler(payload, { name: def.name, kind: def.kind });
        if (def.kind === "command") {
          this.journalPush({ ts: new Date().toISOString(), name: def.name, kind: def.kind, input: payload });
        }
        return new Response(JSON.stringify(result ?? null), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "x-atelier-endpoint": def.name, "x-atelier-endpoint-kind": def.kind },
        });
      } catch (e) {
        return errorResponse(500, endpointError("ATR-320", `端点 ${def.name} handler 抛错：${(e as Error)?.message ?? String(e)}`, "修复 handler 内部错误；command 失败不会入 journal（审计只记成功写入）"));
      }
    };
  }
}

function errorResponse(status: number, err: AtrError): Response {
  return new Response(JSON.stringify(err, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
