# src/server/jobs/ — 后台任务目录位（FS-DESIGN §5.6）

> 本目录是**文档位与约定位**，不是运行中的队列。放这里的是「延迟到将来做」的后台工作脚本/说明，
> 不改变端点运行时的任何行为。

## v1 口径（诚实声明）

- **v1 无内建队列**。框架不提供 worker、不提供 jobs 表、不做定时调度——command 端点内的所有
  工作都在请求内**内联执行**，执行完才返回响应。
- 因此：**长任务（编译、批量写、外部调用等可能超过数秒的工作）的 command 必须声明
  `timeoutMs` 元数据**。超时 = ATR-322（HTTP 503）；abort 只停止 dispatch 等待、不能杀掉
  handler 自身——handler 应监听 `ctx.signal` 在安全点提前退出并落账（半成品状态要么回滚要么
  可重入，不要依赖被杀）。
- 需要异步推进的长工作，v1 的合法做法是**拆成多个 command**（客户端分步调用或轮询一个
  query 端点查进度——进度状态存表或内存，显式可查），而不是在 handler 里挂住等待。

## 将来 job 化的接口位（已预留，不实现）

- **契约兼容**：command 契约不因同步/异步执行改变——`emits` 失效键、审计 journal、
  `idempotent`/`timeoutMs` 元数据都已就位。将来把某个 command 改成经队列执行时，客户端与
  契约零改动：执行位置是部署细节，不是契约细节。
- **jobs 表 sketch**：`id/queue/payload/status/priority/attempts/run_at/locked_by/locked_at`
  + `UPDATE ... WHERE status='pending' AND run_at<=? RETURNING` 原子取出 + 指数退避（设计清单
  教材 = River；SQLite 无 LISTEN/NOTIFY，轮询自适应：忙短闲长）。全文见
  `atelier/docs/FS-DESIGN.md` §5.6（P2+ 候选，立项走 `BACKLOG.md`）。
- 队列落地的价值位：`ctx.db.tx` 内写 jobs 表 = 业务写入与任务投递同一事务（原子化投递）。

## 目录约定

- 将来与本目录相关的产物放 `src/server/jobs/**`（如 job 定义、worker 入口）；struct 检查对
  本目录无额外规则（它属于 `src/server/**` 边界层——前端图不得 import，同 server 面纪律）。
- 本文件随 `atelier init` 模板落盘；升级口径以框架仓同路径文件为准（`atelier sync` 不触碰
  应用 `src/`——对比手抄）。
