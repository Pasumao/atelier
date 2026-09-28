# src/server/jobs/ — 后台任务目录位（FS-DESIGN §5.6，2026-09-28 差距批 A1/A4 起**队列已落地**）

> 演进口径：v1（2026-09-25）本目录是纯文档位——"无内建队列、command 内联执行"诚实声明；
> 2026-09-28 差距批把 FS-DESIGN §5.6 的 sketch 兑现为框架件（`vendor/atelier/server/jobs.ts`，
> 零新依赖），本目录仍是**应用侧 job 定义与用法文档的约定位置**，队列机制本体归框架 vendor。

## 装配（`src/server/main-server.ts`，一次显式接线）

```ts
import { openSqlite, startJobs } from "../../vendor/atelier/server/index.ts";

const db = await openSqlite(dbPath);          // worker 连接（与 createHandler 的 db 同库即可）
const jobs = startJobs({
  db,
  handlers: {
    // type 即分发键（可 grep、显式）；未注册 type 走失败退避路径落账，绝不静默吞行
    "mail.welcome": async (job) => { /* job.payload 是 enqueue 存的 JSON 载荷 */ },
    "cron:gc": async () => { /* recurring 定时任务体 */ },
  },
  cron: [{ name: "gc", everyMs: 60_000 }],    // recurring：cron:<name> 行，完成即重排
});
registry.createHandler({ mount, db, jobs });  // ← ctx.jobs / ctx.kv 随装配出现
```

## 用法（端点内）

```ts
// 原子投递：enqueue 经 ctx.db 同连接执行——与业务写同一事务（tx 抛错 job 行一并回滚）
await ctx.db.tx(() => {
  ctx.db.prepare("INSERT INTO orders ...").run(...);
  ctx.jobs.enqueue({ type: "mail.welcome", payload: { orderId } });
});

// 幂等去重（A4 显式原语；不自动改 command 语义——idempotent 元数据仍是纯声明）
if (!ctx.kv.setIfAbsent(`pay:${input.orderId}`, { at: Date.now() })) return { dup: true };
```

- 失败重试：handler 抛错 → 指数退避（`min(2^attempt × 1s, 60s)`）重试至 `maxAttempts`
  （缺省 5）→ `failed` + `last_error`（2KB 截断）。
- 定时任务：`cron: [{ name, everyMs, payload?, queue? }]`——完成时刻起算下一轮，**misfire 追
  一次不补差**；声明幂等（活跃行在场不重建），进程重启自愈死亡行。
- 内省：dev 面 `GET /api/__atelier/server-status` 的 `jobs` 段（各 status 计数 + 尾部 20 条）；
  `jobs.prune({ olderThanMs })` 清 done/failed 老行、`jobs.stop()` 优雅停机。
- 参数纪律：`enqueue`/`kv` 参数非法同步抛 ATR-350/351（码面见 `atelier-error-codes` 技能包）。

## 诚实边界（设计即边界，不静默）

- **单机单进程**：worker 串行执行（一次一个 job）；跨进程仅靠原子取出保证不重复投递，无公平性/
  分布式语义——多实例部署需外部队列，v1 不做。
- **5 字段 cron 表达式未做**：recurring = `everyMs` 固定周期（完成时刻起算），覆盖定时场景的
  绝大多数形态；复杂日历调度是显式非目标。
- SQLite 无 LISTEN/NOTIFY：投递唤醒仅同进程即时，跨进程靠轮询兜底（忙 50ms ↔ 空闲退避至 5s）。
- **MCP/CLI 工具族未接**（`jobs.*` 工具/`atelier call` 面）与 review 时间轴接线归后续批；
  `timeoutMs`/长任务内联口径对无 jobs 装配的应用照旧成立。

## 目录约定

- 应用侧 job handler 建议内聚在本目录（`src/server/jobs/**`）；struct 检查对本目录无额外规则
  （它属于 `src/server/**` 边界层——前端图不得 import，同 server 面纪律）。
- 本文件随 `atelier init` 模板落盘；升级口径以框架仓同路径文件为准（`atelier sync` 不触碰
  应用 `src/`——对比手抄）。
