/**
 * uploads.ts — 文件上传/资产管道（FS-DESIGN §3.4 落地注记，2026-09-28 差距批 B1；决策 32：
 * **显式注册上传面**——side-channel 明示形态，非契约 bytes 型）。否决「契约 bytes 型 / multipart
 * 直进端点分发器」：FlatSchema 无 bytes 型（超面 = ATR-102 显式 throw 既有纪律），直进要同时动
 * 契约层/校验层/OpenAPI 投影三层，爆炸半径大；显式面 = 纯加法、边界清晰，与「执行位置是部署细节
 * 不是契约细节」同哲学——**资产引用以 URL 进契约，字节走显式面**（端点 handler 拿 `{ url }`
 * 存库/返回，bytes 永不进 JSON 契约域；1.1 起 url = `<mount>/assets/<sha256>` 内容寻址句柄，
 * 整数 id 退役为内部主键——见下方下载面注记）。
 *
 * 形态与装配（jobs/email 同款 option 注入——endpoints.ts 对本模块仅 type-import，运行时单向依赖
 * 本模块 → endpoints.ts〔endpointError/foldProdMessage 单源〕，零环）：
 *   const assets = createUploadsFace({ db, dir: "…" });        // 本模块：解析/存储/记账/下载单源
 *   reg.registerUpload(defineUpload({ name: "avatar", accept: ["image/"] }));  // 兄弟注册表
 *   reg.createHandler({ db, uploads: assets });                // 路由 = POST <mount>/upload/<name>
 *                                                             //        GET  <mount>/assets/<sha256hex>
 * 上传面是**端点面的兄弟注册表**（reg.registerUpload，endpoints.ts 收口）——不混入端点表：
 * introspect 端点表形状零变化、api-diff/OpenAPI 投影/契约层三层零触碰。
 *
 * 下载面（R1 收口批 A 支，2026-09-30，架构评审 P1#1/#2，决策缺省 R-D2 拍板）：
 * - **下载句柄 = sha256 内容寻址 id**（磁盘布局本就按 sha 去重，决策 32）：`GET <mount>/assets/<sha256hex>`
 *   查账按 sha 精确匹配；AUTOINCREMENT 整数 id 退役为**内部主键不再对外**（顺序 id 可匿名枚举私有
 *   文件——旧整数 id 与一切非 64 hex 形态统一 404 ATR-310，路由归 endpoints.ts 闸后进入本模块）。
 *   上传响应把 sha 作为下载句柄返回（url = `<mount>/assets/<sha256>`）。1.1 预发布期 breaking 可接受
 *   （测试即行为定义）。
 * - **下载鉴权闸**在分发器 gateAuth 单源（endpoints.ts 资产路由块）——声明位 = UploadDef.downloadAuth
 *   （缺省跟随该上传面 auth，再缺省 session fail-closed），本模块不做鉴权判定（与上传面同链同款）。
 * - **下载响应头闸**（本模块单源）：恒 `X-Content-Type-Options: nosniff`（mime 为上传方自报不可信，
 *   嗅探面封死）；危险 mime（text/html / application/xhtml+xml / image/svg+xml 族——浏览器直接导航
 *   即同源执行面）缺省 `Content-Disposition: attachment`；其余 mime 行为不变（P1#2 存储型 XSS 收口）。
 * - **下载缓存档位**（P2-S3，2026-09-30 复校收口）：Cache-Control 的 public/private 由分发器按
 *   下载面合取鉴权声明派生（全部声明显式 none 才 public immutable，否则 private immutable——
 *   共享缓存不得暂存鉴权资产响应，对齐端点面 public×auth ATR-313 fail-closed；max-age/immutable
 *   内容寻址语义保留）；本模块只消费派生结果，不做鉴权判定（闸在 endpoints.ts gateAuth 单源）。
 *
 * 磁盘布局 = `<dir>/<yyyy-mm>/<sha256>.<ext>`（**内容寻址 = 天然去重**）：sha256 流式无关——本批
 * 请求体经桥缓冲后解析（诚实边界：不流式入盘，桥内存上界见闸位），hash 对缓冲一次算得。同 sha
 * 重传 = 同句柄（同 sha/同 url）/单文件单行（记账层去重）；「账在盘不在」（备份恢复半态/人工删除）→ 重传
 * **幂等补写**修复（不产生第二行）——两态都有用例钉住。写盘**先临时文件再 rename**（半文件对
 * 下载不可见——rename 同卷原子）+ **记账失败删孤儿文件**（不留无账字节）。
 *
 * 记账 = `atelier_assets`（决策 21/29/31 同款：惰性建表 CREATE TABLE IF NOT EXISTS + 装配期尽力，
 * 框架自管**不进应用迁移序列**，应用 schema.ts 零感知）：
 *   atelier_assets(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mime TEXT NOT NULL,
 *     size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, path TEXT NOT NULL, created_at INTEGER NOT NULL)
 * name = 上传名（filename 原文，只作元数据**永不参与路径拼接**——路径只用 sha256/ext 白名单）；
 * path = 相对 dir 的布局串（yyyy-mm/sha.ext，dir 迁移可移植；下载侧有路径穿越守卫兜底）。
 *
 * 闸位（决策 32「两道闸语义」）——A2 maxBodyBytes 机制扩展复用：
 * - **桥中途截断粗闸**（node-host.ts）：multipart/form-data 请求放行到 max(装配 maxBodyBytes,
 *   UPLOADS_DEFAULT_MAX_BYTES)，JSON 全局闸不动——粗闸只保证内存上界（宁粗勿穿）；
 * - **上传面定义精闸**（本模块）：def.maxBytes（缺省 20MB，独立于 JSON maxBodyBytes），
 *   content-length 快速拒绝 + 缓冲后实测兜底，超限 413 ATR-346 同码。
 * 与 A2「两道都设取小者」不冲突：A2 管同一资源（JSON 体）的两道闸；B1 是不同资源（multipart
 * 走独立上限），粗闸 ≥ 精闸缺省恒成立（精闸缺省 = 粗闸放行下限）。定义 maxBytes > 20MB 的部署
 * 须同步上调 createNodeServer/serve({ maxBodyBytes })（v1 不单开桥配置位——诚实边界）。
 *
 * 错误码（零新码，全复用既有分配面）：413 ATR-346 超限 / 415 ATR-415 非 multipart 或 accept
 * 不匹配（W6/P1-12 dev 面同号同语义——「媒体类型不支持」，HTTP 状态 = 码号惯例）/ 400 ATR-312
 * multipart 结构非法（缺 boundary/截断/多文件 part——JSON 非法体同槽位）/ 404 ATR-310 未装配面
 * ·未知上传面·资产不存在（未知路由资源同槽位）/ 500 ATR-320 存储与记账 IO 失败（foldProdMessage
 * 收口与分发器同源）。鉴权不在本模块——分发器 gateAuth 单源（endpoints.ts）先过门再进来。
 *
 * 诚实边界（决策 32 同文）：v1 **单文件每请求**（多文件 part 显式 400，归后续）；非文件 form
 * 字段 v1 **忽略不消费**（上传是 side-channel，结构化元数据场景等 v2 字段面）；**磁盘直写**
 * （S3/OSS 等应用自接——同 email transport 纪律；多副本部署需共享磁盘卷）；**无图片处理/缩略图/
 * 病毒扫描**（应用域）；filename 解码尽力（RFC 2231/5987 filename* 优先，解码失败回落 filename，
 * 再失败用 fallback 名——见 parseDisposition/FALLBACK_FILENAME）；写盘未 fsync（进程崩溃窗口内
 * 半文件以临时名存在，rename 原子性保证可见性——与 SQLite WAL 同级的诚实窗口）。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { endpointError, foldProdMessage } from "./endpoints.ts";

/** 上传体上限缺省值（决策 32）：独立于 JSON DEFAULT_MAX_BODY_BYTES（1MiB）；node-host.ts 桥侧同值单点复制（零 server 依赖不开 import——与 DEFAULT_MAX_BODY_BYTES 双写同款纪律，两处注释互指） */
export const UPLOADS_DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** 资产记账表名（物理名钉死——字面量消费方以本常量为准） */
export const ASSETS_TABLE = "atelier_assets";

/** 记账表 DDL（惰性建表 + 装配期尽力，决策 31 同款；sha256 UNIQUE = 内容寻址去重的库内保证） */
export const ASSETS_DDL = `CREATE TABLE IF NOT EXISTS atelier_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

/** stats() tail 条数上界（introspect server-status uploads 段的调试面有界呈现——全量走库直读，记账表 atelier_assets） */
export const UPLOADS_STATUS_TAIL_LIMIT = 20;

/* ---------------- 类型面 ---------------- */

/** 上传面定义（defineUpload 产物；auth 语义复用端点拦截链——缺省 session，见决策 32） */
export type UploadDef = {
  /** 上传面名（URL = POST <mount>/upload/<name>；命名校验与端点同款 NAME_RE，注册期闸） */
  name: string;
  /** mime 白名单（前缀匹配："image/" 前缀、"image/*" 通配、"image/png" 精确；缺省 = 不限） */
  accept?: string[];
  /** 单请求体上限字节（缺省 20MB——独立于 JSON maxBodyBytes，见闸位说明） */
  maxBytes?: number;
  /** 上传面鉴权声明（端点 EndpointAuthMeta 同构；缺省 = { type: "session" } fail-closed，auth:"none" 显式开放） */
  auth?: { type: string } & Record<string, unknown>;
  /** 下载面鉴权声明（R1 批 R-D2：缺省**跟随该上传面 auth**——再缺省 session，fail-closed 链
   *  downloadAuth ?? auth ?? session；无任何匿名可下载的缺省路径。分发器资产路由消费，见 endpoints.ts） */
  downloadAuth?: { type: string } & Record<string, unknown>;
};

/** defineUpload：纯定义构造器（命名/上限/accept 校验在注册期 registerUpload 闸——与端点同款「注册期显式失败」纪律） */
export function defineUpload(def: { name: string; accept?: string[]; maxBytes?: number; auth?: { type: string } & Record<string, unknown>; downloadAuth?: { type: string } & Record<string, unknown> }): UploadDef {
  return { ...def };
}

/** 上传响应五事实（url = `<mount>/assets/<sha256hex>`——sha 即下载句柄，内容寻址天然不可枚举；
 *  整数 id 退役为内部主键不再对外，R1 批 R-D2） */
export type UploadResult = {
  name: string;
  mime: string;
  size: number;
  sha256: string;
  url: string;
};

/** 记账行读回形态（内部投影——path 相对布局） */
type AssetRow = { id: number; name: string; mime: string; size: number; sha256: string; path: string; created_at: number };

/** 资产台账读出行（stats() tail 投影——恰六字段，**不含 path**：磁盘布局不外泄调试面）；createdAt = created_at（INTEGER epoch ms，写路径 now.getTime() 单源）转 ISO 串（email 段 ts 同款） */
export type UploadsAssetEntry = {
  id: number;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
};

/** 上传面内省读出（UploadsFace.stats() 产物——introspect.ts server-status uploads 段 assets/tail 数据源；faces 投影由 endpoints.ts 注册表侧构建，注册表 uploadsDefs 只在那儿可见） */
export type UploadsStats = {
  /** 台账聚合：COUNT(*) 与 COALESCE(SUM(size),0)；未建表/空表 = {count:0,bytes:0}（真实事实非假数据，email.tail 未建表返回 [] 同款纪律） */
  assets: { count: number; bytes: number };
  /** 台账尾部 ≤ UPLOADS_STATUS_TAIL_LIMIT 条（id 降序 新→旧——调试面最新在前）；恰六字段投影（不含 path） */
  tail: UploadsAssetEntry[];
};

/** 记账 db 句柄最小结构面（SqliteDb 四原语的结构子集——email.ts EmailLogDb 同形，测试可注入假句柄） */
export type UploadsDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint };
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
};

/** 上传面装配项（db = 记账连接——应用以同一句柄装配 createHandler({ db }) 即同源；dir = 资产落盘根，Windows 绝对/相对路径均可，写时 mkdirs） */
export type CreateUploadsFaceOptions = {
  db: UploadsDb;
  dir: string;
};

/** 上传面（createUploadsFace 产物；createHandler({ uploads }) 装配项——分发器路由后委托） */
export type UploadsFace = {
  /** POST <mount>/upload/<name>：解析 multipart 单文件 → accept/maxBytes 精闸 → 内容寻址落盘 → 记账 → 五事实 */
  handleUpload(args: { req: Request; def: UploadDef; mount: string }): Promise<Response>;
  /** GET <mount>/assets/<sha256hex>：按 sha 查账 → 流式回文件（mime/Cache-Control immutable/nosniff，危险 mime attachment）。
   *  cacheVisibility = 缓存档位（P2-S3）：分发器按下载面合取鉴权声明派生（全部声明显式 none =
   *  "public"，否则 "private"）——鉴权资产的响应不入共享缓存（对齐端点面 public×auth ATR-313
   *  fail-closed）；缺省 "private"（fail-closed——直调方只见字节不见声明，收紧不放松）。 */
  handleDownload(args: { sha: string; mount: string; cacheVisibility?: "public" | "private" }): Promise<Response>;
  /** 内省窄口（MCP 批 A）：资产台账聚合 + 尾部投影（introspect.ts server-status uploads 段数据源——命名对齐 jobs.stats() 先例；纯读不建表，SQL 单源在本文件） */
  stats(): UploadsStats;
};

/* ---------------- multipart/form-data 最小解析器（零依赖，单文件字段语义 v1） ---------------- */

const FALLBACK_FILENAME = "upload";

/** ASCII 子串查找（boundary 依 RFC 2046 为 ASCII；对 ≤20MB 缓冲一次线性扫描） */
function asciiIndexOf(haystack: Uint8Array, needle: string, from: number): number {
  const n = needle.length;
  if (n === 0 || haystack.length - from < n) return -1;
  const codes = new Array<number>(n);
  for (let j = 0; j < n; j++) codes[j] = needle.charCodeAt(j);
  const first = codes[0]!;
  outer: for (let i = from; i <= haystack.length - n; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < n; j++) {
      if (haystack[i + j] !== codes[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** 从 content-type 头取 boundary（RFC 2046：可带引号；缺/空 = null → ATR-312） */
function extractBoundary(contentType: string): string | null {
  const m = /boundary\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const raw = (m[1] ?? m[2])!.trim();
  return raw.length > 0 ? raw : null;
}

/** 顶层分号切分（引号内分号不切；反斜杠转义不切——filename="a;b.txt" 等） */
function splitParams(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let escaped = false;
  for (const c of line) {
    if (escaped) {
      cur += c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      cur += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inQuote = !inQuote;
      cur += c;
      continue;
    }
    if (c === ";" && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** 引号串去引号 + 反斜杠转义还原（RFC 2183：filename="a\"b.txt" → a"b.txt） */
function unquoteParam(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return v;
}

/**
 * RFC 2231/5987 扩展参数解码（filename*=UTF-8''%e2%82%ac.txt）：charset'lang'pct-encoded 三段——
 * **尽力语义**：charset 不被 TextDecoder 支持 / pct 序列坏 → null（回落 filename；两者皆缺 →
 * fallback 名，诚实边界见文件头）。百分号解码手工逐字节（decodeURIComponent 遇裸非 ASCII 会抛）。
 */
function decodeExtendedValue(v: string): string | null {
  const m = /^([^']*)'[^']*'(.*)$/.exec(v);
  if (!m) return null;
  const charset = (m[1] ?? "").trim().toLowerCase() || "utf-8";
  const pct = m[2] ?? "";
  const bytes: number[] = [];
  try {
    for (let i = 0; i < pct.length; i++) {
      const c = pct[i]!;
      if (c === "%" && /^[0-9a-fA-F]{2}$/.test(pct.slice(i + 1, i + 3))) {
        bytes.push(parseInt(pct.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        for (const b of new TextEncoder().encode(c)) bytes.push(b);
      }
    }
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return null; // charset 不支持/序列坏——尽力失败，回落 filename
  }
}

/** Content-Disposition 解析：name/filename（filename* 优先于 filename——与出现顺序无关；filename* 在场但解码失败且无 filename → fallback 名（诚实边界：file 语义仍在，名不可知）；完全无 filename 参数 = 非文件字段） */
function parseDisposition(line: string): { name: string | null; filename: string | null } {
  let name: string | null = null;
  let filenamePlain: string | null = null;
  let filenameExt: string | null = null;
  let sawFilenameExt = false;
  for (const raw of splitParams(line).slice(1)) {
    const eq = raw.indexOf("=");
    if (eq < 0) continue;
    const key = raw.slice(0, eq).trim().toLowerCase();
    const value = raw.slice(eq + 1).trim();
    if (key === "name" && name == null) name = unquoteParam(value);
    else if (key === "filename*" && filenameExt == null) {
      sawFilenameExt = true;
      filenameExt = decodeExtendedValue(value); // 解码失败保持 null（回落 plain / fallback 名）
    } else if (key === "filename" && filenamePlain == null) filenamePlain = unquoteParam(value);
  }
  let filename = filenameExt ?? filenamePlain;
  if (filename == null && sawFilenameExt) filename = FALLBACK_FILENAME; // file 语义在场、名不可知——fallback 诚实呈现
  if (filename != null && filename.length === 0) filename = null; // 空 filename（部分客户端发 filename=""）= 未提供
  return { name, filename };
}

type ParsedFilePart = { name: string | null; filename: string; contentType: string | null; data: Uint8Array };

/**
 * multipart 单文件解析（RFC 7578 形态）：扫描 boundary 分隔，取**首个带 filename 的 part**；
 * 多于一个文件 part = 显式失败（v1 单文件语义——静默丢数据不如看得见的失败）。CRLF 归一：
 * part 头/收尾兼容 \r\n 与\n（浏览器恒 CRLF；宽容手搓客户端）；part 内容 = 两个分隔符之间的
 * 原始字节（收尾 CRLF 归分隔符——文件字节逐位保真，含内部 \r\n 与二进制）。
 */
function parseMultipartFile(body: Uint8Array, boundary: string): { ok: true; file: ParsedFilePart } | { ok: false; reason: string } {
  const delim = "--" + boundary;
  const td = new TextDecoder(); // part 头为文本（RFC 7578 头恒 ASCII/UTF-8）
  let pos = asciiIndexOf(body, delim, 0);
  if (pos < 0) return { ok: false, reason: "multipart 体中找不到 boundary 分隔符" };
  pos += delim.length;
  let file: ParsedFilePart | null = null;
  for (;;) {
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // "--" 结尾 = close-delimiter
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    else if (body[pos] === 0x0a) pos += 1;
    else return { ok: false, reason: "boundary 后缺行尾（part 头截断）" };
    let headEnd = asciiIndexOf(body, "\r\n\r\n", pos);
    let sepLen = 4;
    if (headEnd < 0) {
      headEnd = asciiIndexOf(body, "\n\n", pos);
      sepLen = 2;
    }
    if (headEnd < 0) return { ok: false, reason: "part 头无终止空行（截断）" };
    const headText = td.decode(body.subarray(pos, headEnd));
    pos = headEnd + sepLen;
    let contentEnd = asciiIndexOf(body, "\r\n" + delim, pos);
    let endPad = 2;
    if (contentEnd < 0) {
      contentEnd = asciiIndexOf(body, "\n" + delim, pos);
      endPad = 1;
    }
    if (contentEnd < 0) return { ok: false, reason: "part 内容无收尾 boundary（截断）" };
    const data = body.subarray(pos, contentEnd);
    pos = contentEnd + endPad + delim.length;
    let disposition: string | null = null;
    let contentType: string | null = null;
    for (const line of headText.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (key === "content-disposition") disposition = value;
      else if (key === "content-type") contentType = value;
    }
    if (disposition != null && disposition.toLowerCase().startsWith("form-data")) {
      const { name, filename } = parseDisposition(disposition);
      if (filename != null) {
        if (file != null) return { ok: false, reason: "多于一个文件 part（v1 单文件语义——多文件归后续）" };
        file = { name, filename, contentType, data };
      }
    }
  }
  if (file == null) return { ok: false, reason: "未找到文件 part（multipart 字段须带 filename）" };
  return { ok: true, file };
}

/** ext 白名单清洗：取文件名末段扩展名，[A-Za-z0-9]{1,8} 才收（小写化），否则 bin（路径安全单点——filename 永不直接进路径） */
function extFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "bin";
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/** accept 匹配（mime 前缀语义）："image/" 前缀、"image/*" 通配、"image/png" 精确；大小写不敏感；part 无 content-type = 不可验证 → 不匹配 */
function acceptMatches(accept: string[], mime: string | null): boolean {
  if (mime == null || mime.length === 0) return false;
  const m = mime.split(";")[0]!.trim().toLowerCase();
  return accept.some((a) => {
    const p = a.trim().toLowerCase();
    return p === m || (p.endsWith("/") && m.startsWith(p)) || (p.endsWith("/*") && m.startsWith(p.slice(0, -1)));
  });
}

/* ---------------- 响应助手（错误码复用面——文件头对照表） ---------------- */

function errorResponse(status: number, err: ReturnType<typeof endpointError>): Response {
  return new Response(JSON.stringify(err, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/** IO 失败 500（ATR-320 域）：对外 message 经 foldProdMessage 收口（与分发器同源——prod 不逐字） */
function storageErrorResponse(what: string, e: unknown): Response {
  return errorResponse(
    500,
    endpointError("ATR-320", `上传面存储失败（${what}）：${foldProdMessage((e as Error)?.message ?? String(e))}`, "检查 uploads.dir 可写性/磁盘空间与 db 句柄状态；原始错误见 server 进程 console（prod 收敛指纹可检索）")
  );
}

/**
 * 危险 inline mime 判定（R1 批 P1#2 下载响应头闸）：mime 为上传方自报（multipart 头原文入库），
 * 按不可信输入处理——media type 取 ";" 参数前并大小写归一。危险集 = text/html / application/xhtml+xml /
 * image/svg+xml 族（svg 可内嵌脚本；带参数形态以 startsWith 覆盖）——浏览器直接导航即同源执行面，
 * 缺省强制 Content-Disposition: attachment；其余 mime 行为不变（nosniff 恒加不在此判定内）。
 */
function isDangerousInlineMime(mime: string): boolean {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  return m === "text/html" || m === "application/xhtml+xml" || m.startsWith("image/svg+xml");
}

/* ---------------- createUploadsFace ---------------- */

/** 行 → 读回投影（列名逐一逆向——形状兼容红线） */
function rowToAsset(r: Record<string, unknown>): AssetRow {
  return {
    id: Number(r.id),
    name: String(r.name),
    mime: String(r.mime),
    size: Number(r.size),
    sha256: String(r.sha256),
    path: String(r.path),
    created_at: Number(r.created_at),
  };
}

/** 临时文件名（同目录同卷保证 rename 原子；点前缀 + uuid 防碰撞，永不与 <sha>.<ext> 终名形态冲突） */
function tempName(): string {
  return `.tmp-${randomUUID()}`;
}

/**
 * 上传/资产面工厂（决策 32）：惰性建表（装配期尽力 + 写路径兜底——jobs/email 同款先例；坏句柄
 * 装配不炸，首次上传时再试并诚实 500）。纯读的下载不建表（email tail 同款「纯读不建表」纪律）。
 */
export function createUploadsFace(opts: CreateUploadsFaceOptions): UploadsFace {
  const db = opts.db;
  const dir = opts.dir;
  let tableReady = false;

  function ensureTable(): void {
    if (tableReady) return;
    db.exec(ASSETS_DDL);
    tableReady = true;
  }
  // 装配期尽力建表（jobs.ts startJobs / email.ts createEmailRecorder 同款先例：框架自管表幂等零迁移）。
  // 失败不炸装配（坏句柄留给首次上传诚实失败——上传是写路径，失败可见；下载另有缺表兜底）。
  try {
    ensureTable();
  } catch {
    /* 句柄异常——首次上传/下载时按路径各自诚实处理 */
  }

  function rowBySha(sha: string): AssetRow | null {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(ASSETS_TABLE);
    if (!has) return null;
    const r = db.prepare(`SELECT id, name, mime, size, sha256, path, created_at FROM ${ASSETS_TABLE} WHERE sha256 = ?`).get(sha);
    return r ? rowToAsset(r) : null;
  }

  /** 相对布局 → 绝对路径 + 穿越守卫（path 来自库内——人工篡改/半态防御，static-host 同款纪律） */
  function resolveAssetPath(rel: string): string | null {
    const abs = path.resolve(dir, rel);
    const root = path.resolve(dir);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null; // 越界 = 库内 path 不可信，拒绝
    return abs;
  }

  /** 写盘单源：临时文件 + rename（半文件不可见）；临时残留兜底清理。返回绝对路径。 */
  function writeFileAtomic(rel: string, data: Uint8Array): string {
    const abs = resolveAssetPath(rel);
    if (abs == null) throw new Error(`资产路径越界（库内 path 不可信）：${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), tempName());
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, abs); // 同卷 rename 原子——半文件对下载/去重补写均不可见
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* 临时文件本就不存在（写前失败）——清理兜底幂等 */
      }
      throw e;
    }
    return abs;
  }

  return {
    async handleUpload({ req, def, mount }): Promise<Response> {
      try {
        const maxBytes = def.maxBytes ?? UPLOADS_DEFAULT_MAX_BYTES;
        // ---- 精闸前媒介检查：非 multipart → 415 ATR-415（上传路由只收 multipart/form-data） ----
        const contentType = req.headers.get("content-type") ?? "";
        if (!/^multipart\/form-data/i.test(contentType.trim())) {
          return errorResponse(
            415,
            endpointError(
              "ATR-415",
              `上传面 ${def.name} 只接受 multipart/form-data（实际 content-type：${contentType || "（缺失）"}）`,
              `以 multipart/form-data; boundary=<边界> 发送单文件字段（HTML <form> 原生 FormData / fetch FormData 均可）；JSON 与其他媒介类型请走端点面（POST <mount>/<name>）`
            )
          );
        }
        const boundary = extractBoundary(contentType);
        if (boundary == null) {
          return errorResponse(400, endpointError("ATR-312", `multipart/form-data 头缺 boundary 参数`, `content-type 须携带 boundary（fetch FormData 自动生成；手搓客户端须显式给出并与体中分隔行一致）`));
        }
        // ---- 定义精闸（独立于 JSON maxBodyBytes——决策 32 闸位）：声明值快速拒绝 + 缓冲实测兜底 ----
        const declared = Number(req.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) {
          return errorResponse(
            413,
            endpointError(
              "ATR-346",
              `上传体超限：声明 ${declared} 字节 > 上传面 ${def.name} 上限 ${maxBytes}`,
              `缩小上传文件；上限由 defineUpload({ maxBytes }) 按面上调（缺省 20MB = ${UPLOADS_DEFAULT_MAX_BYTES} 字节，独立于端点面 JSON maxBodyBytes）；超限请求不落盘不入账`
            )
          );
        }
        const raw = await req.arrayBuffer();
        if (raw.byteLength > maxBytes) {
          return errorResponse(
            413,
            endpointError(
              "ATR-346",
              `上传体超限：${raw.byteLength} 字节 > 上传面 ${def.name} 上限 ${maxBytes}`,
              `缩小上传文件；上限由 defineUpload({ maxBytes }) 按面上调（缺省 20MB = ${UPLOADS_DEFAULT_MAX_BYTES} 字节）；超限请求不落盘不入账`
            )
          );
        }
        // ---- 解析（单文件语义）----
        const parsed = parseMultipartFile(new Uint8Array(raw), boundary);
        if (!parsed.ok) {
          return errorResponse(400, endpointError("ATR-312", `multipart 体非法：${parsed.reason}`, `标准 multipart/form-data 编码（fetch FormData 产物即合规）；v1 单文件语义——多文件请分请求上传`));
        }
        const file = parsed.file;
        // ---- 自报 mime 头值闸（R1 评审收口件）：multipart 头值含控制字符（\x00-\x1f/\x7f）即非法
        // 头值——入库后每次下载在 Response 头发射处抛 TypeError，该资产行被永久毒化（auth:none 池
        // 可匿名反复触发 500）。解析侧拒绝 + 下载侧 fail-safe 回落（见 handleDownload）双面封死；
        // 闸位在 accept 之前——accept 前缀匹配（"image/"）拦不住尾随控制字符的合法前缀 mime。
        if (file.contentType != null && /[\x00-\x1f\x7f]/.test(file.contentType)) {
          return errorResponse(400, endpointError("ATR-312", `multipart part content-type 含控制字符（非法头值）`, `标准 MIME 类型（如 "image/png"）；合法客户端不会产生控制字符 content-type`));
        }
        // ---- accept 精闸（mime 前缀语义）----
        if (def.accept != null && !acceptMatches(def.accept, file.contentType)) {
          return errorResponse(
            415,
            endpointError(
              "ATR-415",
              `上传面 ${def.name} 不接受该媒体类型（part content-type：${file.contentType || "（缺失）"}；accept：${def.accept.join(", ")}）`,
              `调整上传文件的类型，或修正 defineUpload({ accept }) 白名单（前缀语义："image/" / "image/*" / 精确 "image/png"）`
            )
          );
        }
        // ---- 内容寻址：sha256 → 布局 → 去重/补写/新写 ----
        const sha = createHash("sha256").update(file.data).digest("hex");
        const mime = file.contentType ?? "application/octet-stream";
        const now = new Date();
        const yyyyMm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
        const rel = `${yyyyMm}/${sha}.${extFromFilename(file.filename)}`;
        const existing = rowBySha(sha);
        if (existing != null) {
          const abs = resolveAssetPath(existing.path);
          if (abs != null && fs.existsSync(abs)) {
            // 去重命中：同内容 = 同资产（同 sha/同 url/单文件单行）——重传零写零插
            return new Response(JSON.stringify({ name: existing.name, mime: existing.mime, size: existing.size, sha256: existing.sha256, url: `${mount}/assets/${existing.sha256}` }), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }
          // 账在盘不在（备份恢复半态/人工删除）→ 幂等补写修复，不产生第二行
          writeFileAtomic(existing.path, file.data);
          return new Response(JSON.stringify({ name: existing.name, mime: existing.mime, size: existing.size, sha256: existing.sha256, url: `${mount}/assets/${existing.sha256}` }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
        writeFileAtomic(rel, file.data);
        // ---- 记账（失败 → 删孤儿文件——不留无账字节）----
        ensureTable();
        try {
          db.prepare(`INSERT INTO ${ASSETS_TABLE} (name, mime, size, sha256, path, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(file.filename, mime, file.data.byteLength, sha, rel, now.getTime());
        } catch (e) {
          const abs = resolveAssetPath(rel);
          if (abs != null) {
            try {
              fs.unlinkSync(abs);
            } catch {
              /* 孤儿清理兜底幂等（文件已在 = 去重命中形态，不该出现在本路径；真删不掉留待重传修复） */
            }
          }
          throw e;
        }
        return new Response(JSON.stringify({ name: file.filename, mime, size: file.data.byteLength, sha256: sha, url: `${mount}/assets/${sha}` }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch (e) {
        return storageErrorResponse(`上传 ${def.name}`, e);
      }
    },

    handleDownload({ sha, mount, cacheVisibility }): Promise<Response> {
      void mount; // v1 下载响应不依赖 mount（url 已在记账/上传响应侧给出）——参数留位
      try {
        ensureTable();
      } catch {
        // 记账面不可用 = 404（资产不可达是真实事实——不编 500 假象，库句柄状态见 console）
        return Promise.resolve(
          errorResponse(404, endpointError("ATR-310", `资产不可达（记账面不可用）：assets/${sha}`, "检查 createUploadsFace({ db }) 句柄状态；上传重传可修复半态"))
        );
      }
      // 查账按 sha 精确匹配（内容寻址下载句柄——R1 批 R-D2；sha 由路由 sha 形态闸保证 64 hex，
      // 调用方直调时 toLowerCase 归一消化大小写变体；? 绑定防注入不变）
      const row = db.prepare(`SELECT id, name, mime, size, sha256, path, created_at FROM ${ASSETS_TABLE} WHERE sha256 = ?`).get(sha.toLowerCase());
      if (!row) {
        return Promise.resolve(
          errorResponse(404, endpointError("ATR-310", `资产不存在：assets/${sha}`, "下载句柄 = 上传响应的 sha256/url 字段（64 位十六进制内容寻址 id，重传同内容得同句柄——内容寻址去重）；1.1 起整数自增 id 退役为内部主键不再对外"))
        );
      }
      const asset = rowToAsset(row);
      const abs = resolveAssetPath(asset.path);
      if (abs == null || !fs.existsSync(abs)) {
        // 账在盘不在：404 + 指路重传修复（幂等补写——不产生第二行）
        return Promise.resolve(
          errorResponse(404, endpointError("ATR-310", `资产文件缺失（账在盘不在）：assets/${sha}`, "重传同内容文件即可幂等修复（内容寻址补写，不产生新行）；排查 uploads.dir 卷状态"))
        );
      }
      const stream = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream<Uint8Array>;
      // 响应头闸（R1 批 P1#2）：nosniff 恒加（mime 是上传方自报，嗅探执行面封死）；危险 mime
      // 缺省 attachment（浏览器直接导航 = 同源脚本执行面）；其余 mime 行为不变。
      // attachment 不带 filename 参数——下载名回落 URL 末段 <sha256>.<ext>（ext 白名单清洗过，
      // 库内 name 为攻击者可空原文，进响应头有注入面——不给）。
      // 发射侧 fail-safe（R1 评审收口件）：存量行可能携带控制字符 mime（本批入口闸之前入库的行/
      // 直调记账面写入）——非法头值会让 Response 构造抛 TypeError，下载被永久毒化。回落
      // application/octet-stream 并强制 attachment（类型不可验证 = 按危险处理）；nosniff 恒加不变。
      const headerMime = /[\x00-\x1f\x7f]/.test(asset.mime) ? "application/octet-stream" : asset.mime;
      const headers: Record<string, string> = {
        "content-type": headerMime,
        "content-length": String(asset.size),
        // 内容寻址不可变：同 URL 恒同字节——max-age/immutable 激进缓存语义保留（决策 32）。
        // 档位（P2-S3）：visibility 由分发器按下载面合取鉴权声明派生（endpoints.ts 资产路由）——
        // 全部声明显式 none 才 public；任一面要求鉴权即 private（共享缓存旁路授权面封死，对齐
        // 端点面 public×auth ATR-313 fail-closed）。缺省 private（fail-closed）。
        "cache-control": `${cacheVisibility ?? "private"}, max-age=31536000, immutable`,
        "x-content-type-options": "nosniff",
        "x-atelier-asset": asset.sha256,
      };
      if (headerMime !== asset.mime || isDangerousInlineMime(asset.mime)) headers["content-disposition"] = "attachment";
      return Promise.resolve(new Response(stream, { status: 200, headers }));
    },

    // 内省窄口（MCP 批 A，jobs.stats()/email.tail() 同款先例）：聚合 + 尾部一次读出。
    // 纯读不建表（email.tail 同款纪律）：表未建（装配后零上传）= 零值事实不是错误——
    // 「零上传」是真实状态非假数据；聚合恒单行（COUNT/SUM 对空表 = 0/0，无需特判）。
    stats(): UploadsStats {
      const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(ASSETS_TABLE);
      if (!has) return { assets: { count: 0, bytes: 0 }, tail: [] };
      const agg = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS total FROM ${ASSETS_TABLE}`).get()!; // 常量聚合无外部值，免绑（决策 19 红线针对外部值——本文件全 ? 绑定口径不变）
      const tail = db
        .prepare(`SELECT id, name, mime, size, sha256, created_at FROM ${ASSETS_TABLE} ORDER BY id DESC LIMIT ?`)
        .all(UPLOADS_STATUS_TAIL_LIMIT)
        .map((r) => ({
          id: Number(r.id),
          name: String(r.name),
          mime: String(r.mime),
          size: Number(r.size),
          sha256: String(r.sha256),
          createdAt: new Date(Number(r.created_at)).toISOString(), // created_at = epoch ms（写路径 now.getTime() 单源）
        }));
      return { assets: { count: Number(agg.n), bytes: Number(agg.total) }, tail };
    },
  };
}
