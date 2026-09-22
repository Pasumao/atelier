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
 *   3. const db = openSqlite(process.env.ATELIER_DB_PATH ?? ".atelier/dev.db");
 *   4. createHandler({ mount, db })                       —— 迁移：node ../../atelier/cli.mjs migrate up
 *   鉴权（gen auth 后）：createHandler({ mount, db, auth: createSessionReader(db) })
 */
export function createAppHandler(): (req: Request) => Promise<Response> {
  const mount = process.env.ATELIER_SERVER_MOUNT ?? "/api";
  return registry.createHandler({ mount });
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
    console.error("[atelier] fix：改 atelier.config.json 的 server.port 换端口，或释放被占端口后重跑。");
    process.exit(1);
  });
}
