/**
 * main-server.ts — server 面装配点（FS-7 dev 托管子进程入口 + D-F14 build 产物的装配单源）。
 * dev 面 vite 插件把本文件作为子进程托管（/api/* 反代至此，src/server/** 变更热重启）；
 * `atelier build --target=node|bun` 的产物启动壳 import 本文件的 createAppHandler()——
 * 端点装配只有这一份（单一真相），直跑与被导入靠主模块判定分叉。
 * 直接运行：node src/server/main-server.ts
 *
 * env（dev 插件父进程 / build 产物壳注入，均可缺省）：
 *   ATELIER_SERVER_PORT  — 监听端口，"0" = 自动分配；缺省 5174（§11.1 邻位约定）
 *   ATELIER_SERVER_MOUNT — 端点挂载前缀；缺省 "/api"
 *   ATELIER_DB_PATH      — SQLite dev 库路径；缺省 .atelier/dev.db（本模板默认不接库，见下）
 *
 * 就绪握手：listen 成功后由框架 serve() 向 stdout 打印恰好一行
 *   ATELIER_SERVER_READY {"port":<实际端口>} —— 模板不自己写，父进程按此探活。
 *
 * 健康面（B4 差距批，2026-09-28；1.1.0 批 W-A 起 version 归产物壳注入）：GET <mount>/__atelier/
 *   health 恒在（prod 亦可见、不走 token 门），响应 = { ok, uptimeMs, db, version }——version =
 *   产物壳注入的框架版本（build 时点动态读 atelier/package.json 经 globalThis.__ATELIER_VERSION__
 *   注入，见下）；dev 托管不经壳 = null（诚实：dev 无版本语义）。orchestrator/docker 的探活口就是它。
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EndpointRegistry, serve } from "../vendor/atelier/server/index.ts";
import { echo, ping } from "./endpoints/example.ts";
import { addNote, noteList } from "./endpoints/notes.ts";

// 显式注册表（决策 18：无编译器魔法——端点一个一个 register，重复名 = ATR-313 直接红）
const registry = new EndpointRegistry();
registry.register(ping).register(echo);
// FS-7 live 直通示例对：noteList（live query，SSE 订阅）+ addNote（command，emits 失效广播）
registry.register(noteList).register(addNote);

/**
 * 装配出口：dev 托管直跑与 build 产物壳共用（单一真相）。mount 读 env（三方契约第 2 条——
 * env 读取归子进程入口）。
 *
 * 装配点（§3.2）：无 DI 容器，依赖在入口明文注入；不传 db = ctx.db 为 undefined（诚实呈现）。
 *
 * db 是 opt-in（最小全栈先行，数据面按需接线）：
 *   1. node ../../atelier/cli.mjs gen db --root .        —— schema.ts → tables/crud + 迁移骨架
 *   2. 在 import 区追加：import { openSqlite } from "../vendor/atelier/server/index.ts";
 *   3. mkdirSync(path.dirname(dbPath), { recursive: true }) 后再 openSqlite(dbPath)（宿主不建父目录；
 *      build 冒烟 cwd=dist=整目录部署语义，相对 db 路径须自足——m11 批 B 实测）
 *   4. createHandler({ mount, db })                       —— 迁移：node ../../atelier/cli.mjs migrate up
 *   鉴权（gen auth 后）：createHandler({ mount, db, auth: createSessionReader(db) })
 *
 * jobs 装配（FS-DESIGN §5.6，2026-09-28 差距批 A1/A4——队列已落地；依赖 db，接线随上面 db 步骤）：
 *   import { startJobs } from "../vendor/atelier/server/index.ts";
 *   const jobs = startJobs({
 *     db,
 *     handlers: {
 *       // type 即分发键（可 grep、显式）；未注册 type 走失败退避落账（atelier_jobs.last_error 可查）
 *       "app.hello": (job) => console.log(`[jobs] app.hello payload=${JSON.stringify(job.payload)} attempt=${job.attempt}`),
 *       "app.gc": () => console.log("[jobs] app.gc tick（recurring 清理示例：在此做 jobs.prune 等无害例行）"),
 *     },
 *     cron: [{ name: "gc", everyMs: 60 * 60_000 }], // recurring 定时：cron:gc 行，完成时刻起算下一轮
 *   });
 *   createHandler({ mount, db, jobs })   // ← ctx.jobs（tx 原子投递）/ ctx.kv（幂等去重）随之可用
 *   端点内投递：await ctx.db.tx(() => { 业务写; ctx.jobs.enqueue({ type: "app.hello", payload }) })
 *   用法全量见 src/server/jobs/README.md；诚实边界：单机单进程 worker、5 字段 cron 表达式未做。
 */
export function createAppHandler(): (req: Request) => Promise<Response> {
  const mount = process.env.ATELIER_SERVER_MOUNT ?? "/api";
  // W-A health version：version = 产物壳注入的框架版本（build.mjs 与 __ATELIER_PROD__ 同段置位、
  // 先于 await import 装配——同款时序纪律；globalThis 取值 cast 先例 = endpoints.ts isProd 同款）。
  // dev 托管直跑不经壳 → undefined ?? null = null（诚实：dev 无版本语义）；旧模板应用无注入同归
  // null——装配形态零迁移、零影响。
  return registry.createHandler({ mount, version: (globalThis as { __ATELIER_VERSION__?: string | null }).__ATELIER_VERSION__ ?? null });
}

/** 主模块判定：Node ≥23.7 / Bun 有 import.meta.main；更早的 strip-types 宿主回退 argv[1] 实路径比对。 */
function invokedDirectly(): boolean {
  // 双重断言：import.meta.main 是 Bun/Node ≥23.7 的事实特性，TS 标准 ImportMeta 类型尚未收录
  if ((import.meta as unknown as { main?: boolean }).main === true) return true;
  try {
    const arg1 = process.argv[1];
    if (!arg1) return false;
    const self = fileURLToPath(import.meta.url);
    return realpathSync(path.resolve(arg1)) === realpathSync(self);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // 端口被占 → serve reject：打印诚实错误（含 fix 指路）后 exit(1)，绝不静默。
  const port = Number(process.env.ATELIER_SERVER_PORT ?? 5174);
  serve(createAppHandler(), { port, host: "127.0.0.1" }).catch((e: unknown) => {
    console.error(`[atelier] server 启动失败：127.0.0.1:${port} —— ${(e as Error)?.message ?? String(e)}`);
    console.error("[atelier] fix：设 ATELIER_SERVER_PORT 环境变量换端口（dev 托管链路另可改 atelier.config.json 的 server.port——监督器会读取并注入该 env），或释放被占端口后重跑。");
    process.exit(1);
  });
}
