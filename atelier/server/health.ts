/**
 * health.ts — server 面健康检查端点（B4 差距批，2026-09-28；依据 docs/research/
 * 2026-09-28-fullstack-feature-gap.md §3-B4）。
 *
 * 与 introspect.ts（server-status）同族命名空间、语义分离——本文件的存在理由就是这对对照：
 *   server-status = 内省面（端点全表含契约体/journal/db 快照/jobs 段）——prod 旗下 405 ATR-311
 *                   隐身（调试面不进生产 API 面，§3.7）；statusToken 装配后要求 x-atelier-token。
 *   health        = 健康面（极简三事实，零内省内容）——prod 旗下照常 200（部署面 docker/
 *                   orchestrator/守护进程的探活口，健康面在 prod 消失 = 部署失明）；**不走
 *                   statusToken 门**（健康面无秘密，门禁只会把探活变成假死报警——orchestrator
 *                   拿不到 token，401 与宕机在它眼里同形）。
 *
 * 三事实（响应体恒恰四键，形状稳定供 orchestrator 断言）：
 *   { ok: true|false, uptimeMs: number, db: "ok"|"none"|"error", version: string|null }
 *   - uptimeMs：createHandler 装配起点（performance.now() 记一处）到本请求的 monotonic 时差——
 *     进程内单调钟，不受系统对钟回拨影响（语义 = 本 handler 体的存活时长，≈ 进程存活时长）；
 *   - db：有 db 装配 → 经 ctx 同一连接跑 SELECT 1 快路径探活 → "ok"；探活抛错 → 503 +
 *     ok:false + db:"error"（探活的语义就是非 200 可报警，orchestrator 靠状态码）；未装配 db →
 *     "none" 且仍 200（纯静态应用合法，无库不是病）；
 *   - version：产物壳注入框架版本（build.mjs 时点动态读 atelier/package.json，经
 *     __ATELIER_VERSION__ 置位先于装配——1.1.0 批 W-A 起）；dev 托管不经壳 = null（诚实：dev
 *     无版本语义）。
 *
 * 诚实边界：
 * - 非 GET → 405 ATR-311（复用既有「方法不允许」口径，不新配 ATR 码——宁缺不造）；
 * - 限流装配（createHandler({ rateLimit })）下 health 与其余路由同闸同计数（闸位单一，不分路由
 *   豁免）——探活频率应远低于配额；把 health 配进限流窗口属部署方显式选择；
 * - 探活只证「SQL 通道活着」，不证迁移 head/数据完整性（那是 migrate verify / server-status 的职责）；
 * - 本路由不经注册表（与 server-status 同款保留路径，NAME_RE 无斜杠故与端点名零冲突）、不入
 *   journal（journal 语义 = 分发穿过 handler 之后，§3.5）。
 */

/** 保留健康路径（mount 剥离后的 name 精确匹配；与 INTROSPECT_NAME 同款分发器保留字） */
export const HEALTH_NAME = "__atelier/health";

/** 健康面快照形状（响应体恒恰四键——形状稳定供 orchestrator/守护进程断言） */
export type HealthSnapshot = {
  ok: boolean;
  uptimeMs: number;
  db: "ok" | "none" | "error";
  version: string | null;
};

/** db 句柄最小探活面（SqliteDb 四原语的窄口——与 introspect.ts ReadableDb 同款结构面纪律） */
type ProbeDb = {
  prepare(sql: string): { get(...params: unknown[]): unknown };
};

/**
 * 组装健康应答（endpoints.ts 分发器保留路由调用）。opts.db = createHandler 装配的库句柄
 * （未装配 = db:"none" 仍 200）；opts.startedAtMs = createHandler 装配时刻的 performance.now()
 * 快照（monotonic 起点，endpoints.ts 记一处）；opts.version = 产物壳注入框架版本（build 壳置位；
 * dev 托管缺省 null）。同步函数：探活是单条 SELECT 1 的快路径，无需异步。
 */
export function healthResponse(opts: { db?: unknown; version?: string | null; startedAtMs: number }): Response {
  const uptimeMs = Math.max(0, Math.round(performance.now() - opts.startedAtMs));
  if (opts.db == null) {
    return healthJson({ ok: true, uptimeMs, db: "none", version: opts.version ?? null }, 200);
  }
  try {
    (opts.db as ProbeDb).prepare("SELECT 1 AS ok").get();
    return healthJson({ ok: true, uptimeMs, db: "ok", version: opts.version ?? null }, 200);
  } catch {
    // 探活抛错 = 数据面不可用：503 + ok:false + db:"error"（状态码即报警面）。uptimeMs 照报——
    // 进程还活着、库坏了，正是 orchestrator 要区分的两件事（进程崩了根本轮不到本函数应答）。
    return healthJson({ ok: false, uptimeMs, db: "error", version: opts.version ?? null }, 503);
  }
}

/** 四键体 → Response（content-type 与 introspect 200 同款；无 cache 头——探活方直连无缓存语义） */
function healthJson(body: HealthSnapshot, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
