# 全栈功能差距调研（2026-09-28）

> 性质：功能缺口专项调研（阶段 3.5 收口、1.0.0 release-ready 之后、阶段四 npm 发布待外部动作的窗口期）。
> 依据：`FS-DESIGN.md` §16 留门/B队对表 × `BACKLOG.md` 评审队列与 jobs README 实文 × 三路调研（2026-09-19）
> × 本日代码事实核验（grep 零命中项如实记录）+ 外部佐证一轮（Rails 8 Solid Queue / SQLite 生产可用性）。
> 分工纪律：本文只给差距清单与排序建议；**立项/排期唯一源仍是 `BACKLOG.md`**，构成新决策的项须走
> `design-decisions.md`。〔议〕= 本报告建议，未拍板。

---

## 0. 结论速览

全站化主线（FS-1~11）已把「端点运行时 + 数据契约 + 迁移 + auth 三件套 + live SSE + 生成器 + OpenAPI +
dev 托管 + build/call + MCP 36 工具」做成了闭环；从「真实应用能不能只用 Atelier 建出来」的角度扫，
剩余差距集中在**四类**：

| 类 | 一句话 | 代表项 |
|---|---|---|
| A. 已在册留门、条件已熟 | 设计书自己登记的 P2+/B 队，行业方向已验证 | **SQLite 极薄队列 + jobs + cron（§5.6）**、备份 CLI（§5.7）、限流（评审队列）、cache 档位（§2.2）、幂等键持久化、OAuth 资源服务器口（§6.4） |
| B. 未登记的真空白 | 本次代码核验 grep 零命中、设计书与调研均未评估 | **文件上传/multipart**、密码重置与邮箱验证流、email 适配边界、prod 健康检查、command journal 持久化、FTS5 搜索、分页 helper |
| C. 质量债前置件 | 评审队列 B 包（未排期），公网部署前必须过 | server 安全收口包（限流/体上限/scrypt 参数/PRAGMA/错误收敛/迁移表 UNIQUE） |
| D. 生态线大件 | 阶段四范畴，不属全栈线 | 前端路由器、组件库、i18n |

**总判断**：下一批全栈功能的旗舰应是**队列/jobs 线**——它是设计书唯一完整留了 sketch + 错误码段
（ATR-35x）+ 目录约定 + 契约兼容论证的候选项，且被 jobs README 明文承认为「v1 无内建队列」的诚实边界；
行业侧 Rails 8 Solid Queue 把「SQLite 单库承载队列」变成了默认生产形态，方向无风险。它同时解锁
邮件发送、定时备份、webhook、长任务出请求路径四件依赖事。次优先是安全收口包（部署前提）与
备份 CLI（S 级、与 checkpoint 同构）。文件上传是唯一需要**先做设计决策**的新面。

---

## 1. 现状基线（2026-09-28 快照）

**已闭环**（不重复展开，见 BACKLOG 归档行）：query/command 端点 + 契约校验 + 审计 journal ·
live SSE 失效-重算-推送 · SQLite 双宿主（bun 实测）+ 数据契约 + 可逆迁移 + 种子 · gen db/endpoint/auth ·
OpenAPI 导出 + golden · api-diff 门禁 · struct 八层 · dev 面托管/调试页/三源时间轴 · MCP 36 工具
（stdio + vendored HTTP 直连 + ask 审批 + Tasks）· build 产物自证 + call CLI · checkpoint 三道门。
门禁基线 674 用例绿。

**全栈运行时的既有边界**（如实，为差距定位）：
- 端点输入 = JSON 体；无 multipart/FormData/blob 通路（`server/endpoints.ts`、`node-host.ts` grep 零命中）。
- 请求体不流式、无界缓冲（评审队列在册 P2）。
- v1 无内建队列/worker/调度——长任务 = command 内联 + `timeoutMs` + 拆端点轮询（jobs README 实文）。
- auth = 邮箱密码 + 会话 cookie 三件套（login/logout/me）；无密码重置/邮箱验证/OAuth 登录/API key。
- 无限速/失败锁定（评审队列在册「钩子位」）。
- 内省面 = `__atelier/server-status`（dev 面，prod 405 隐身）；无 prod 健康端点。
- command journal = 内存环形，重启清零（迁移 journal 已持久化，command 未）。
- CLI 无 `db backup`/`VACUUM INTO` 任何形态；备份目前只是 §5.7 文档位。
- 无 FTS/搜索、无分页原语、无 CORS 配置面（同源姿态）。

---

## 2. A 类：已在册留门项盘点（设计书自己的未来功能位）

按「引入条件是否已满足」重排，均为〔议〕：

| # | 项 | 在册位置 | 引入条件评估 | 估量 |
|---|---|---|---|---|
| A1 | **SQLite 极薄队列 + jobs 运行时 + cron** | FS-DESIGN §5.6（P2+ 候选，接口位先行）；ATR-35x 预留；jobs README 全文 sketch；BACKLOG 候选池未列（设计书在册） | **已满足**：jobs 表 sketch 完整（River 教材清单 + RETURNING 原子取出 + 指数退避 + 轮询自适应）；行业验证见 §4；依赖它的功能（备份调度/邮件/长任务）都已排队 | L |
| A2 | **server 安全收口包**（含限流/失败锁定钩子位） | 建议书 B-3 → BACKLOG 评审队列（未排期） | **公网部署前提**，与 npm 发布时点（D-3）联动；其中「限流 + 登录失败锁定」是新功能面，其余为硬化 | M |
| A3 | **`atelier db backup` 备份 CLI** | FS-DESIGN §5.7（文档位：Litestream 参照，「不内建云复制」） | SQLite backup API / `VACUUM INTO` 均零依赖可用；A1 落地后可加定时备份 job；与 checkpoint/可验证性叙事同构 | S |
| A4 | 幂等键持久化 | FS-DESIGN（「需要键持久化，SQLite 键值表候选归队列 P2+ 批次」） | 随 A1 同批（jobs 表同款键值面）；单独立项价值低 | S（并入 A1） |
| A5 | cache 元数据档位（`cache:"private"` 等） | FS-DESIGN §2.2（位先固化，默认 none） | 维持 B 队：等真实应用需求；引入时走显式契约一步到位（Next 教训在册） | S-M |
| A6 | agent 身份 / OAuth 资源服务器口 | FS-DESIGN §6.4（契约位预留：auth type `oauth` 命名空间 + securitySchemes 段） | Better Auth MCP 插件需求位实证；**最小切口 = API key/token 授权**（机器客户端访问数据服务层），OAuth 全套维持远期 | S（API key）/ M-L（OAuth） |
| A7 | GET for query（REST 互操作） | §16.4（`restful` 映射位，默认关；D-F11） | 维持留门：OpenAPI 已可映射，浏览器直访/缓存语义需求未现 | — |

---

## 3. B 类：未登记的真空白（本次新识别，均需设计拍板）

| # | 项 | 事实依据 | 形态建议〔议〕 | 估量 |
|---|---|---|---|---|
| B1 | **文件上传/资产管道** | `server/endpoints.ts`/`node-host.ts` 无 multipart/FormData/blob；W6 刚把非 JSON content-type 收紧为 415——上传被**显式挡在门外**但无替代通路 | 先决件=请求体上限与流式（评审队列）；契约形态二选一：① 契约扩展 bytes 型输入（multipart 直进端点分发器）② 显式 side-channel 上传端点 + 磁盘布局约定 + static-host 复用托管。**需新决策**（D-29 候选） | M |
| B2 | **密码重置 + 邮箱验证流** | gen auth 仅三件套；设计书 §6.1 提过 magic link 变体=regen 选模板（Phoenix 启示），未实现 | 随 gen auth regen 模板族扩展（token 表 + 过期 + 端点对）；依赖 B3 的发送边界 | M |
| B3 | **email 适配边界** | 框架零命中；无 transport 概念 | 显式 transport 接口（应用自接 SMTP/Resend 等）+ dev 面 mock 落 journal（可审计、可 review 时间轴呈现）——同「不内嵌 LLM/不内建云复制」纪律：**框架不内建发送，内建可验证的投递记账** | S（接口+mock） |
| B4 | **prod 健康检查端点** | server-status prod 405（内省面隐身是对的）；部署面（docker/orchestrator/守护进程）无探活口 | `__health` 极简端点（uptime/db 可开/版本号三事实，无内省），prod 可见、不走 token 门 | S |
| B5 | **command journal 持久化** | 内存环形重启清零（多批挂账原样）；迁移 journal 已做持久表先例（atelier_migration_journal + principal/durMs/status） | 同款追加表 + 保留窗口（如 N 天/N 万条裁剪）；敏感键脱敏已就位（评审批 W2），review 三源时间轴消费链已存在，落库即得「重启不灭的审计面」 | S-M |
| B6 | FTS5 全文搜索 | 零命中 | gen db 表定义可选 `fts: true` → 生成 FTS5 虚表 + 触发器同步 + CRUD 投影；属数据面能力扩张，需求驱动 | S-M |
| B7 | 分页/游标 helper | 零命中；gen-db CRUD 为四原语薄层 | crud 生成物加 `listPaged`（LIMIT/OFFSET 或 keyset）可选项；DX 小件 | S |
| B8 | CORS/机器客户端配置面 | 同源姿态（Origin/Host 闸 + SameSite=Strict） | 与 A6（API key）合并考虑：无第二方消费者则不做；做了 API key 再议 CORS 显式配置 | — |

---

## 4. 行业对表（2026-09 口径，外部佐证）

| 能力 | Rails 8.x | Encore.ts | SvelteKit 3 RC | Laravel 12 | Atelier 现状 → 建议 |
|---|---|---|---|---|---|
| 后台队列 | **Solid Queue（默认，SQLite 可承载）** | 内建（源码注解 → 基础设施） | — （队列外置） | 内建 | 无 → **A1 立项**（设计 sketch 已留） |
| 定时任务/cron | Solid Queue recurring | 内建 cron | — | Scheduler | 无 → 随 A1 |
| 邮件 | ActionMailer | — | — | Mailable | 无 → B2/B3（接口+记账不发送） |
| 文件上传 | 内建 | 内建 storage | form actions 原生 FormData | 内建 | 无 → B1（需先拍契约形态） |
| 限流 | rack-attack 惯例 | — | — | 内建 | 无 → A2 |
| 备份 | SQLite 生态（Litestream 指南） | — | — | — | 文档位 → A3 CLI |
| 健康检查 | /up（Rails 7.1 起内建） | 内建 health | — | /up | 无 → B4 |
| 搜索 | pg 全文惯例 | — | — | Scout | 无 → B6 按需 |

外部佐证要点：Rails 8 的「Solid 三件套」把 **SQLite 单库承载队列/缓存**变成默认生产形态（去 Redis 路线，
与决策 19 同向）；早期 recurring job 有过 bug（2024-11 issue）但方向已收敛。Bun 1.4 内建 cron 佐证单机
调度已是运行时标配预期。其余框架细节见 `research/2026-09-report{1,2,3}`（9 天前，无需重扫）。

**差异化切入提醒**（报告三 §11 结论延续）：队列/上传/邮件这些「电池件」别人也有，Atelier 的打法是把
它们做成**可验证性基建**——jobs 进统一时间轴与 review UI、投递与业务写入同事务（原子化投递是 Redis
队列给不了的性质，设计书原文）、email mock 落 journal、备份与 checkpoint 同构。叙事仍是「别人给 agent
上下文，Atelier 给 agent 证据」。

---

## 5. 优先级建议〔议〕

```
第一批（1.0 后首个功能批，建议窗口 = 阶段四启动后并行）
  1. A2 安全收口包（M）——公网部署前提；限流/锁定是其中唯一新功能面
  2. A1 队列 + jobs + cron + A4 幂等键（L）——旗舰功能批；契约兼容论证已就位（command 改队列执行零契约改动）
  3. A3 备份 CLI（S）——可独立先行，队列落地后补定时备份
第二批（需设计拍板，与第一批可并行设计）
  4. B1 上传/资产管道（M）——先决：请求体上限+流式（A2 内）；需新决策（契约形态）
  5. B2+B3 密码重置/邮箱验证 + email 接口（M+S）
  6. A6 最小切口 API key（S）——OpenAPI 导出面向机器客户端的自然收口
  7. B4 健康端点 + B5 journal 持久化（S+S）——部署与审计的最小运维面
第三批（按需触发，不预投）
  8. B6 FTS / B7 分页 / A5 cache 档位 / A7 GET for query
生态线（阶段四范畴，本报告不排）
  前端路由器（全栈应用多页体验的最大前端缺口）、组件库、i18n
```

排序依据：① A2 是发布后一切对外暴露的前提且已在册；② A1 是唯一「设计完整度最高 × 行业已验证 ×
解锁依赖件最多（备份调度/邮件/长任务/webhook）」的项；③ B 类按「真实应用第一天就会撞上」排序
（上传 > 找回密码 > 机器客户端 > 运维面）。

---

## 6. 与「不做清单」的边界复核

本报告建议项与既有决策无冲突，逐条确认：
- 不碰 SSR/RSC/服务器驱动 UI（决策 4/20）——B1 上传是数据面非渲染面。
- 不碰 CRDT/离线/全量同步（决策 5/20）。
- 不做 Redis/PG 队列（决策 19）——A1 明确 SQLite 极薄自研。
- 不做云复制/Postgres 适配（决策 19）——A3 是本地备份 CLI + Litestream 指南文档位。
- 不内嵌 LLM（总原则）——B3 email 同款纪律：接口+记账，不内建发送。
- 单体工坊不变——A1 队列为进程内 worker（单 dev 进程/单产物语义内），不做多服务编排。
- 微服务/多实例横向扩展不在本报告任何建议中。

**需新决策的点**（拟 D-29~D-32，立项时走 design-decisions）：
- D-29 上传契约形态：multipart 进分发器 vs side-channel 端点 + 资产布局（含 static-host 复用边界）。
- D-30 email transport 边界与 mock 记账口径。
- D-31 API key 形态（与 §6.4 OAuth 留门的关系：先行最小切口还是等 OAuth 全套）。
- D-32 command journal 持久化形状（追加表 vs 复用迁移 journal 模式；保留窗口策略）。

---

## 7. 诚实边界

- 本报告为**功能差距综合**，未重做 9 天前的三路调研（框架横向/后端格局无实质变化窗口）；唯一新外部
  核验 = Rails Solid Queue/SQLite 生产路线一轮。
- B 类「零命中」结论基于 `grep`（multipart/formData/blob/upload/rateLimit/backup/VACUUM/health 等关键词，
  server/ + gen/ + cli.mjs 范围）；若存在别名实现（可能性低）以代码实读为准。
- 全部〔议〕项未经用户拍板；估量 S/M/L 沿用既有口径，未做拆解。
- A1 的「条件已满足」指设计与外部验证层面；实施仍需红检先行、契约冻结、三门禁全套（既有纪律不变）。

---

*调研与撰写：2026-09-28。证据源：仓库内文档（ROADMAP/BACKLOG/FS-DESIGN/design-decisions/三路调研/jobs
README）+ 代码 grep 核验 + Rails Solid Queue 外部检索。*
