# m3-fs/next — 对照臂（Next.js）基线与评分件（FS-10 执行半）

> 对照臂 = **Next.js（App Router + Route Handlers/Server Actions + Drizzle/SQLite + zod）**
> （D-F21 拍板，protocol §1.1 对表定稿）。本目录是执行半交付件：基线装配脚本、判据实现
> （grade + harness）、任务书转译件 ×3。**判据语义全同、判据实现分臂**（protocol §4.2 明写
> 的不对称）——本 README 冻结 next 臂的实现口径，是等价性评审与威胁清单的载体。
>
> 状态：三件均已实现并自证（自证证据见 §6）；**转译件待同批评审冻结**；本目录不构成出数
> 资格（正控参考解 ×3 / 负控 fixture 集 / RUNBOOK 武装归集成批次）。

## 1. 文件导航

| 文件 | 内容 |
|---|---|
| [setup-baseline-next.mjs](setup-baseline-next.mjs) | 基线装配：`node setup-baseline-next.mjs --target <dir> [--force] [--variant baseline\|task3]`。内嵌全部模板（版本精确钉死）、`pnpm install`、构建级自检（tsc → 起 dev → GET /api/notes == 种子 2 行 → 杀进程）。`--variant task3` 注入种子缺陷（002 up 已应用 + down 缺失 + 契约/前端未消费 priority）并自验缺陷在位（verify 必须红）。`--emit-manifest <file> --manifest-only` 从内嵌模板再生 [baseline-manifest.json](baseline-manifest.json)（sha256 冻结参照，评分对表用；改模板必须再生并评审） |
| [grade-next.mjs](grade-next.mjs) | 评分 CLI：`node grade-next.mjs --task <id> --attempt <appDir> [--out <file>]`，exit 0/1；grade JSON 形状与 atelier 臂一致（`{ok, task, attempt, at, checks[], summary, tail}`），checks[].id 逐字用 brief 判据编号，落盘 `<attempt>/m3fs-grade.json` |
| [harness/acceptance-c.spec.tsx](harness/acceptance-c.spec.tsx) | C 类 harness（jsdom + @testing-library/react）。由 grade-next 注入 attempt 根目录、用 attempt 自身 vitest 驱动、评完即删；场景结果走**结果文件**（env `ATELIER_M3FS_C_OUT`）不走 stdout——vitest 失败输出的代码帧会回显 spec 源码，字面标记会被污染（自证中实证过的坑） |
| [tasks/task1.brief.next.md](tasks/task1.brief.next.md) / [task2](tasks/task2.brief.next.md) / [task3](tasks/task3.brief.next.md) | 转译件 ×3：目标态与判据语义逐条保持（编号不变），栈名词等价替换 |

## 2. 基线冻结口径

### 2.1 依赖版本表（精确钉版，2026-09-20 装配实证）

| 包 | 版本 | 角色 |
|---|---|---|
| next | 15.5.25 | App Router（webpack dev，非 turbopack） |
| react / react-dom | 19.3.0 | UI |
| better-sqlite3 | 12.11.1 | SQLite 宿主（native；node 24 win-x64 走 prebuild） |
| drizzle-orm | 0.44.7 | 数据访问（better-sqlite3 driver） |
| drizzle-kit | 0.31.10 | 迁移生成工具（devDep，供解题者选用；见 §2.3 down 口径） |
| zod | 3.25.76 | 契约单源 |
| typescript | 5.9.3 | S 类门（strict） |
| vitest | 3.2.7 | T 类门 + C 类 harness 驱动 |
| jsdom | 26.1.0 | C 类环境 |
| @testing-library/react / dom | 16.3.3 / 10.4.2 | C 类挂载/驱动 |
| eslint / eslint-config-next / @eslint/eslintrc | 9.39.5 / 15.5.25 / 3.3.7 | S 类门（flat config） |
| @types/*（node 24.13.6 / react 19.3.0 / react-dom 19.3.0 / better-sqlite3 9.6.0） | — | 类型 |

环境元数据：node v24.18.1 / pnpm 11.21.0 / Windows 10 x64（冻结时点，波报告如实登记）。
pnpm ≥10/11 不再读 package.json 的 `pnpm` 字段：构建脚本白名单唯一生效位是模板里的
`pnpm-workspace.yaml`（`allowBuilds` + `onlyBuiltDependencies`，放行 better-sqlite3 /
esbuild / unrs-resolver）——装配脚本自带原生绑定探针与 rebuild 重试（prebuild 下载偶发
中断属网络抖动，缓存后重试即过）。

### 2.2 路由表（R 类黑盒驱动面，映射写死）

| 路由 | 方法 | 语义 | atelier 臂对应 |
|---|---|---|---|
| `/api/notes` | GET | 列表快照，`{notes:[…]}`，输出经契约校验（违规 → 500） | `notes.list`（query + output 契约） |
| `/api/notes` | POST | 创建；契约违规 → **结构化 400**（JSON：`code`/`message`/`fix`/`issues`）；task2 起 id 客户端生成随请求上行（**JSON number 正整数**，B 臂接口修订钉死：字符串 id 属契约违规 → 400；服务端同 id 幂等合并） | `notes.create`（command + ATR-201 面 + idempotent upsert） |
| `/api/notes/stream` | GET | live 通道（task2 由解题者装配）：SSE，首连全量帧，写侧显式触发失效推送；**帧 = `data:` 行 JSON**（`{notes:[…]}` 或裸数组皆可，行按 `id` 匹配）；**心跳必须用 SSE 注释行（`: ping`）**，data 帧会被 R3 记为推送 | `notes.list` 的 `live` + `notes.create` 的 `emits`（ATR-321 面） |

客户端列表组件 = `src/components/NotesList.tsx`（默认导出或命名导出 `NotesList`）——C 类
挂载点，等价 atelier 臂 `NotesPage.atr.ts` 的地位。R 类场景窗口（三臂同值，protocol §8.4；
**R2 口径 B 臂接口修订钉死：≤1s 墙钟、自 POST 收到 2xx 响应起计，首连全量帧不计窗口**）：
成功写后推送 **≤1s**；失败后无帧观察窗 **1.2s**（违规载荷双探针：`{body:""}` 与
`{id:"x", body:…}`——后者考 id 类型钉死）；随后一次成功写验证订阅保持。

### 2.3 迁移口径（S 类的 up→down→up 干跑载体）

- 迁移文件 = `drizzle/migrations/NNN_<name>.up.sql` + 同 stem `.down.sql` **成对手写 SQL**
  （记录口径：基线不用 drizzle-kit journal 形态——**drizzle-kit 无 down 生成**是真实边界，
  也是转译件陷阱节的取材点）；种子 = `drizzle/seeds/001_seed_notes.sql`（幂等 `INSERT OR
  IGNORE`，id 固定 1/2，≥2 行）；
- 状态表 = `_migrations(name, checksum, applied_at)`，checksum = sha256(up 侧内容)——已应用
  文件被改 → up/verify 报 integrity 错（ATR-332 的等价实现）；down 侧不在 checksum 口径内
  （ATR-331"缺什么补什么"的等价语义）；
- 管理器 = 基线自带 `scripts/db.mjs`（`up / down --to / seed / verify / query`）；`verify` =
  影子库（backup 快照或空库）干跑：成对检查 → up → down --to 0 → up → schema 幂等比对 →
  checksum 体检。这是 protocol §4.2 S 类"up→down→up 影子库干跑幂等"的 next 臂实现，等价
  atelier 臂的 `migrate verify`；
- 评分确定性：grade 开始即清空 `attempt/data`（库由 predev 从文件态重建）——一切判据只依赖
  **文件态**，不依赖解题者本地库历史；task3 的 D1 sha256 对表对象 = 冻结 manifest（等价
  atelier 臂"sha256 对得上状态表"——状态表本身随库重建，冻结 manifest 才是稳定参照）。

### 2.4 与 atelier 臂基线的等价对表（评审重点）与已知差异 = 有效威胁清单

| 项 | atelier 臂（protocol §2） | next 臂 | 等价性判读 / 威胁 |
|---|---|---|---|
| 契约单源 | `src/contract.ts`（FlatSchema） | `src/lib/contract.ts`（zod） | 同构：输入/输出契约单源，端点 import 消费；M6 判"无内联复本" |
| 表契约 | `table()` 扁平定义 | drizzle `sqliteTable` | 同构列（id 自增 PK / body NOT NULL / createdAt epoch ms int） |
| 迁移 | `migrate up/down/verify`（成对 SQL + sha256 状态表） | `scripts/db.mjs`（成对 SQL + sha256 状态表） | **同构**（有意做成同口径）；差异：atelier 有 CLI 门禁联动（struct 八层），next 以 S 类 bundle 判据替代 |
| 端点 | `defineQuery/defineCommand` + Web 标准分发 | Route Handlers（GET/POST） | 读写二分语义保持；差异：atelier 的契约校验/审计/幂等元数据是框架内建，next 基线在 route 内显式写（输出校验 8 行）——**解题者可绕过契约直写**，M6 的单源检查是弱化的守卫（威胁：next 臂契约纪律更靠自觉） |
| live | 内建 live 端点引擎（失效-重算-推送 + coalesce） | **无内建**——SSE Route Handler + 订阅表由解题者装配 | 这正是 §1.1 选 Next 的论证：考点不被框架内建消解；差异：next 臂 task2 工作量更大（威胁：若 task2 next 全红，可能是装配负担而非能力差异——解读时须结合 R1 是否部分达成） |
| 前端 | `.atr.ts` 模板 + 三态原语 | React 客户端组件 + 自选装配（EventSource/useOptimistic） | 断言层对齐：C 类 DOM 钩子契约逐字同文 |
| 守卫 | `struct check` 八层 + `api-diff` + regen 幂等 | `tsc --noEmit` + eslint + 迁移成对/verify + `pnpm test` | protocol §4.2 授权的等价强度替代；差异：**next 无 API 面快照门**（无生成物）——api-diff 判据语义由"契约单源完好（M6）"近似承载，弱于 atelier 臂（威胁：列入解读注记） |
| agent 脚手架 | skills/AGENTS.md/llms.txt（skill 臂可见性差异） | 无（next 臂不装本仓技能；Next 官方 agent 脚手架随包语义在本基线无对应产物——版本见 §2.1，如有官方 AGENTS.md 产物随波报告登记） | next 臂 = "主流栈裸知识"对照，语义与 protocol §1 一致 |
| DOM 钩子 | atelier harness 自己的查找面 | `data-note-id` / `data-pending` / `data-rollbacked`（转译件原文收录，基线列表组件已带 `data-note-id`） | 基线带钩子是**测量面**（非功能偏置）；待定/回滚钩子由解题者在 task2/3 实现 |

已知差异汇总（出数解读必读）：①上面表格中标注"威胁"的三行；②next 臂 C 类要求客户端提交
路径真实走 `fetch("/api/notes")`（Server Action 在 jsdom 网络面不可见——转译件已如实声明）；
③next 臂 R 类对 SSE 帧的事件名不敏感（解析所有 `data:` 行），C 类 mock 只按无名 data 帧
（`message`/`onmessage`）投递——转译件已钉死。这三条都已写进转译件正文，非隐藏规则。

## 3. 判据实现分臂（S/R/C 每类在 next 臂的落法）

| 类 | atelier 臂 | next 臂实现（本目录） |
|---|---|---|
| S | `struct check`（八层）+ `api-diff` + regen 字节幂等 | `pnpm exec tsc --noEmit` exit 0 + `pnpm exec eslint .` exit 0 + 迁移成对（含 001 sha 对表 manifest）+ `scripts/db.mjs verify` 影子干跑 exit 0；契约单源检查（M6：route import 契约 + 契约含目标声明）承载"生成物同源"判据语义 |
| R | 起 server（`ATELIER_SERVER_READY` 握手）→ HTTP/SSE/DB 黑盒场景 | 起 `pnpm dev`（predev 迁移+种子；轮询 `GET /api/notes` 就绪，180s 上限）→ node fetch 驱动 §2.2 路由表：R1 首连全量（帧行 ⊇ GET 行）、R2 写后 ≤1s 推送、R3 违规 400 + 1.2s 无帧 + 订阅保持；SSE 客户端 = fetch 流式读取逐帧解析（对事件名不敏感） |
| C | dom-shim 挂载组件驱动提交入口（同语义断言） | jsdom + @testing-library/react 挂载 `NotesList`，fetch/EventSource mock 驱动：C1 成功提交 → pending 先行 → 帧后同 id 仅一行且非 pending；C2 失败提交（mock 400，错误体含 `code`/`message`/`fix`）→ 待定项消失 + `data-rollbacked` 含 id + fix 文本可见。C 类 harness 结果走文件不走 stdout（代码帧污染，§1） |
| T | 应用侧 `pnpm test` 全绿 | 同字面：`pnpm test`（vitest run）exit 0 |

判据编号与语义逐条对应转译件判据表；task3 = task1 ∪ task2 判据 + D1/D2（同号判据在
grade JSON 中以 desc 前缀 `[task1]`/`[task2]` 区分，id 逐字）。bundle 判据（M3/M8/D2）
的 category 落 `S`（静态门禁束，含 test 门）；`T` 类保留给纯 test 门语义，未单独出条——
与 atelier 臂 bundle 判据的处理一致。

## 4. 运行方式

    # 基线装配（attempt 骨架）
    node atelier/benchmarks/m3-fs/next/setup-baseline-next.mjs --target <dir>            # baseline
    node atelier/benchmarks/m3-fs/next/setup-baseline-next.mjs --target <dir> --variant task3

    # 评分（三任务）
    node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task1-column-change --attempt <dir>
    node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task2-live-reconcile --attempt <dir>
    node atelier/benchmarks/m3-fs/next/grade-next.mjs --task task3-fullstack-rescue --attempt <dir>

评分时长量级：2-4 分钟/次（tsc/lint/test + dev 启动 + R 场景 + C harness + T 门）。
注意：attempt 路径含空格时 Windows shell 派生不可靠（grade 会显式拒绝）；评分会清空
attempt 的 `data/` 并落盘 `m3fs-grade.json`。

## 5. task3 变体（种子缺陷注入口径）

`--variant task3` 相对 baseline 的差异（与 atelier 臂同构注入）：
`002_add_priority.up.sql` **在位且已应用**（setup 跑 up+seed 落账，状态表 checksum = 种子
内容）、`002_add_priority.down.sql` **缺失**、`src/db/schema.ts` 已声明 priority、契约与
前端**未**消费 priority。setup 自检验证缺陷在位：`db.mjs verify` 必须 exit 1（缺 down）。
评分侧 D1 的 sha256 对表对象 = 冻结 manifest 中 `002_add_priority.up.sql` 条目。

## 6. 自证证据（2026-09-20，本 worktree 实跑，attempt 全部在系统临时目录）

| 步骤 | 命令 / 操作 | 结果 |
|---|---|---|
| 装基线 | `setup-baseline-next.mjs --target <tmp>` | exit 0：装配 21 文件 + install 442 包 + tsc ✓ + dev 起来 + `GET /api/notes` == 种子 2 行 |
| 装基线（task3 变体） | `setup-baseline-next.mjs --target <tmp> --variant task3` | exit 0：装配 + 自检全绿，且**缺陷在位自验证通过**（`db.mjs verify` 红于缺 down 侧） |
| 基线负向 | `grade-next.mjs --task task1 …`（未解基线） | exit 1，FAIL 1/8（仅 M8 绿——基线本身全绿，方向正确） |
| task1 正控 | 手写参考解（002 迁移对 + 契约 + route + 组件 + 守卫测试同步）→ grade | exit 0，**PASS 8/8**（S/R/C/T 全类绿） |
| task1 负例 | 删 `002_*.down.sql` → grade | exit 1，FAIL 5/8（M2 成对红 / M3 verify 红 / M8 束红——S 类抓红有效） |
| task2 正控 | 新基线 + 最小参考解（SSE Route Handler + 客户端对账）→ grade | exit 0，**PASS 8/8**（R1 首连全量 / R2 2xx 后 1s 墙钟推送 / R3 违规 400 + 1.2s 无帧 + 订阅保持 / C1-C2 对账三态 / M1-M3 全绿） |
| task3 正控 | task3 变体 + 组合参考解（只补 down + 全链贯通）→ grade | exit 0，**PASS 18/18**（D1 sha 对表 + 往返数据面等价 + task1∪task2 判据并集全绿） |
| 评分器红绿记录 | ①C 类 stdout 字面标记被 vitest 失败输出的代码帧回显污染（未解基线 M7 假绿）→ 改结果文件传递（复跑转红）；②C spec 场景漏 `fireEvent.click`（正控冒烟抓出 c1/c2 全红）→ 补上（复跑转绿）；③影子干跑 `down --to 002` 为无操作（语义 = 回滚到 002 之后）→ 改 `--to 001`；④task3 分支漏给 `[task1] M3` 占位赋值（空 detail 假红）→ 补赋值；⑤参考解把辅助函数导出进 route 文件 → **`.next/types` 路由类型体检让 tsc 红**（真实框架边界，非评分器 bug）——参考解重构为 `src/lib/notes-bus.ts` 模块后复评转绿，边界回填进 task2/task3 转译件陷阱节 | 前四处为评分器自身 bug、第五处为框架边界取证，正控/负控双向复跑闭环——印证 RUNBOOK §5"正控只证明对的能给过，负控才证明错的抓得住"必须双向跑 |

## 7. 诚实边界

1. 本 README §2.4 的"威胁"行是**基线差异的如实登记**，不是已完成的对冲——等价性最终由
   两臂基线脚本的同批评审裁决（protocol §8.3：基线不对等 = 数据作废）；
2. 转译件 ×3 为 v1 待评审，未冻结前不可作为对照臂会话 prompt；
3. 负控 fixture 集（每任务"差一点错"变异样本 ×N）与正控参考解 ×3 的仓库化归集成批次
   （RUNBOOK §5 前置门）——本目录自证中的负例是临时目录操作，未 fixture 化；
4. C 类 mock 的 EventSource 投递语义（无名 data 帧）与 R 类的全帧解析差异见 §2.2——已是
   转译件正文的一部分，但"R 绿 C 红"的组合（如解题者用命名事件）仍可能出现，解读时按
   brief 已声明处理，不算评分器误判；
5. `next dev`（webpack）为 R 类运行时形态；生产构建（`next build`/`next start`）在基线
   可用但评分未走（dev 对全部 attempt 同值，公平性不受影响；构建产物差异列为潜在威胁）。
