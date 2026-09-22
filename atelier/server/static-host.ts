/**
 * Atelier 全站服务层 — 自托管单容器静态托管（D-F14 `atelier build` 产物启动壳的框架侧单源之二，
 * FS-DESIGN §12）。产物 = node/bun 单入口 + SQLite 卷：单入口同时服务**静态前端 dist** 与
 * **<mount>/* 端点面**——withStaticHost 把两者合成一个 Web 标准 handler，serve()（node-host.ts）
 * 负责监听与就绪握手，启动壳（build.mjs 生成物）只做 env 解析与装配。
 *
 * 差异锁本文件（框架纪律，同 node-host.ts）：Node 宿主差异只允许出现在 server/ 域内——只用
 * node:fs/node:path 内置模块、零新依赖、TS 仅 erasable 语法（type stripping 直接可跑）；Bun 宿主
 * 走 node:fs 兼容层同源跑（bun:sqlite 差异在 sqlite.ts，与本件无关）。
 *
 * 诚实边界：
 * - 精确文件或 404：**不做 SPA history fallback**（模板应用单页、无客户端路由；真出现路由型应用
 *   再议 fallback 开关——先做深再命名）；目录请求归一到目录内 index.html；"/" → index.html；
 * - 仅 GET/HEAD（静态面语义；其余动词 405——端点面的 POST 不受影响，分派在 mount 前缀判定之前）；
 * - 无 ETag/Range/条件请求（单容器内网/回环形态，带宽不敏感；CDN 化归反代——TLS 同归反代）；
 *   cache-control: no-cache 全量（vite 产物文件名带 hash，no-cache + ETag 缺位下仍每次重验但
 *   命中即 200——诚实简单优先，缓存策略挂账）；
 * - 路径穿越守卫：decodeURIComponent 后 resolve 必须仍落在根目录内，越界一律 404（不泄露存在性）；
 * - 同步读盘（readFileSync）：单容器 JSON 端点为主的形态可接受；大文件吞吐不是目标场景。
 */
import fs from "node:fs";
import path from "node:path";
import type { WebHandler } from "./node-host.ts";

/** 极简 MIME 表：vite 产物会出现的扩展名全覆盖，未知扩展名一律 application/octet-stream（不猜） */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export type StaticHostOptions = {
  /** 静态根目录（产物 dist 的绝对路径——build 启动壳按自身文件位置解析后传入） */
  dir: string;
  /** 端点挂载前缀（与 createHandler 的 mount 同值同源——前缀内走 api，前缀外走静态） */
  mount: string;
  /** 目录请求的归一文件名，缺省 index.html */
  index?: string;
};

/**
 * 合成 handler：<mount>/** → api（透传，含 ATR 结构化错误语义）；其余 → 静态文件（GET/HEAD，
 * 精确文件或 404）。mount 缺斜杠归一（与 endpoints.ts createHandler 同款归一口径）。
 */
export function withStaticHost(api: WebHandler, opts: StaticHostOptions): WebHandler {
  const rootDir = path.resolve(opts.dir);
  const mount = "/" + opts.mount.replace(/^\/+|\/+$/g, "");
  const indexName = opts.index ?? "index.html";

  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === mount || url.pathname.startsWith(`${mount}/`)) return api(req);

    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response(`method not allowed（静态托管仅 GET/HEAD——端点调用走 POST ${mount}/<name>）\n`, {
        status: 405,
        headers: { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" },
      });
    }

    // 路径穿越守卫：解码后 resolve 必须仍在根内（Windows 盘符/反斜杠由 path.resolve 归一吸收）
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return notFound(url.pathname);
    }
    const abs = path.resolve(rootDir, "." + rel.replaceAll("\\", "/"));
    if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) return notFound(url.pathname);

    let file = abs;
    let st = fs.statSync(file, { throwIfNoEntry: false });
    if (st?.isDirectory()) {
      file = path.join(file, indexName);
      st = fs.statSync(file, { throwIfNoEntry: false });
    }
    if (!st?.isFile()) return notFound(url.pathname);

    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const body = new Uint8Array(fs.readFileSync(file));
    return new Response(req.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(st.size),
        "cache-control": "no-cache",
      },
    });
  };
}

/** 静态 404（诚实最小：不回 SPA 兜底页，不泄露根外存在性） */
function notFound(requested: string): Response {
  return new Response(`not found: ${requested}\n`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}
