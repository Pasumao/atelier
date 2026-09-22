/**
 * dev-review-data.mjs — review 扩展（§11.2）与审计统一时间轴（§11.3）的数据归一层。
 *
 * 框架自有模块（framework-owned）；init/sync 时随 dev 面五件 vendor 进应用 scripts/，
 * 由 atelier-dev-plugin.mjs 以相对路径引入（DEV_FILES 白名单——init/sync 两处名单同步加行）。
 * 全部纯 Node 内建（fs/path + node:sqlite 兜底位），零新增依赖。
 *
 * 数据面三源（§11.3"agent 这轮做了什么"一处可答）：
 *   1. command journal   —— server 面运行时事实，经 dev 面代理的 server-status.journal 消费
 *                           （内存环形、重启清零的诚实边界见 server/introspect.ts）；
 *   2. MCP/dev 操作审计  —— 既有 .atelier/audit.jsonl（/__atelier/audit 同一文件，只复用不重建）；
 *   3. 迁移审计          —— server-status.db.migrations.rows（atelier_migrations 状态表 = 决策 19
 *                           "迁移即 checkpoint 审计对象"的现成数据源）；server 面不在时兜底：
 *                           node:sqlite 只读直开 dev 库（Node ≥22.5 内建，实验性标注——
 *                           checkpoint.mjs readMigrationHead 同先例；只跑 SELECT，不写不锁）。
 *                           诚实挂账：状态表只记 applied 时刻，down 成功即删行 → down 历史无处
 *                           可记（决策 21 台账形状预留位）；principal/duration 无持久化，归一置 null。
 *
 * 归一形状（§11.3 字段对齐 ts/name/principal/duration）：
 *   { ts, source: "command"|"audit"|"migration", name, status, principal, durMs, detail }
 *
 * checkpoint 台账（§11.2）：.atelier/checkpoints.jsonl 本地态（15d9059 起 gitignore）——缺失时
 * 全部相关段诚实降级（ok:false + note），绝不假数据。migrationHead 字段是决策 21-③ 既有产物，
 * 本模块只读不写（CLI 台账格式缺口如需补字段，归 cli.mjs 所有者，见批次报告）。
 */
import fs from "node:fs";
import path from "node:path";

/** 台账/审计/库文件路径约定（与 checkpoint.mjs / dev 插件 AUDIT_FILE 同源常量，此处只读） */
export const LEDGER_FILE = path.join(".atelier", "checkpoints.jsonl");
export const AUDIT_FILE = path.join(".atelier", "audit.jsonl");
export const DEFAULT_DB_FILE = path.join(".atelier", "dev.db");

/** 人话摘要截断（detail 只做呈现，不做数据） */
function clip(v, n = 160) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s == null) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 毫秒 epoch → ISO（非法值如实返回 null，绝不编时间） */
function msToIso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

/* ---------------- §11.2 checkpoint 台账（本地态，缺失即降级） ---------------- */

/**
 * 读 checkpoint 台账。返回 { ok, rows, note? }；文件缺失/不可读 = ok:false + note（rows 恒为数组）。
 * 坏行跳过不炸（台账是 append-only jsonl，局部损坏不该拖死整个 review 面）。
 */
export function readCheckpointLedger(root) {
  const p = path.join(root, LEDGER_FILE);
  if (!fs.existsSync(p)) {
    return { ok: false, rows: [], note: "无 checkpoint 台账（.atelier/checkpoints.jsonl 不存在——台账是本地态，不入库；锚定一个：atelier checkpoint save <名称>）" };
  }
  try {
    const rows = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: [], note: `checkpoint 台账不可读：${e?.message ?? e}` };
  }
}

/* ---------------- §11.3 源 2：MCP/dev 操作审计（复用 audit.jsonl，不重建） ---------------- */

/**
 * 读 dev 面审计尾行（与 /__atelier/audit 同一数据文件同一语义：尾部 N 行，坏行跳过）。
 * 文件尚不存在 = 正常态（ok:true + 空行单）——不是错误，审计文件首条写入前就长这样。
 */
export function readAuditTail(root, lines = 200) {
  const p = path.join(root, AUDIT_FILE);
  try {
    const rows = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean)
      .slice(-Math.max(1, lines));
    return { ok: true, rows };
  } catch {
    return { ok: true, rows: [], note: "audit.jsonl 尚无记录（非 GET 的 /__atelier/* 与命令回执会入账）" };
  }
}

/* ---------------- §11.3 源 3：迁移审计（server-status 优先，node:sqlite 只读兜底） ---------------- */

/**
 * 从 server-status 快照取迁移行（首选路径——server 子进程持句柄，dev 父进程不重复开库）。
 * serverStatus 为空/无 db 段 → { ok:false, note }（由调用方决定是否走兜底）。
 */
export function migrationsFromServerStatus(serverStatus) {
  const mig = serverStatus?.db?.migrations;
  if (!mig || !Array.isArray(mig.rows)) {
    return { ok: false, rows: [], head: null, source: "server-status", note: "server-status 未携带迁移行（server 面未就绪或未装配 db）" };
  }
  return { ok: true, rows: mig.rows, head: mig.head ?? null, source: "server-status", note: null };
}

/**
 * 兜底：node:sqlite 只读直开 dev 库读 atelier_migrations（server 面不在时 review 页仍可答
 * "库在哪个 schema 版本"）。诚实标注：node:sqlite 为 Node 内建实验性模块（checkpoint.mjs
 * 同先例）；只跑 SELECT 不写不锁（SQLite 多进程读并发安全由文件锁保证）；打不开/无表 →
 * ok:false + note，绝不假数据。
 */
export async function readMigrationsSqlite(root, dbRel = DEFAULT_DB_FILE) {
  const dbFile = path.isAbsolute(dbRel) ? dbRel : path.join(root, dbRel);
  if (!fs.existsSync(dbFile)) {
    return { ok: false, rows: [], head: null, source: "sqlite-readonly", note: `库不存在（${path.relative(root, dbFile) || dbFile}）——迁移审计缺省` };
  }
  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    try {
      db = new DatabaseSync(dbFile, { readOnly: true });
    } catch {
      // 旧 Node 无 readOnly 选项 → 普通打开（本模块只跑 SELECT，同 checkpoint.mjs readMigrationHead 先例）
      db = new DatabaseSync(dbFile);
    }
  } catch (e) {
    return { ok: false, rows: [], head: null, source: "sqlite-readonly", note: `node:sqlite 打不开库（${e?.message ?? e}）——迁移审计缺省` };
  }
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("atelier_migrations");
    if (!has) {
      return { ok: false, rows: [], head: null, source: "sqlite-readonly", note: "库内无 atelier_migrations 表（migrate up first）" };
    }
    const rows = db
      .prepare("SELECT id, name, checksum, applied_at, down_verified FROM atelier_migrations ORDER BY id")
      .all()
      .map((r) => ({ id: Number(r.id), name: String(r.name), checksum: String(r.checksum), appliedAt: Number(r.applied_at), downVerified: Number(r.down_verified ?? 0) === 1 }));
    const last = rows[rows.length - 1] ?? null;
    return { ok: true, rows, head: last ? { id: last.id, name: last.name } : null, source: "sqlite-readonly", note: null };
  } catch (e) {
    return { ok: false, rows: [], head: null, source: "sqlite-readonly", note: `迁移表不可读（${e?.message ?? e}）` };
  } finally {
    try { db.close(); } catch { /* 已关闭 */ }
  }
}

/* ---------------- §11.3 归一：三源同构（ts/name/principal/duration 字段对齐） ---------------- */

/** command journal → 归一行（source=command；status/principal/durMs 原生直传） */
export function normalizeJournal(entries) {
  return (entries ?? []).map((e) => ({
    ts: String(e?.ts ?? ""),
    source: "command",
    name: String(e?.name ?? "?"),
    status: e?.status === "failed" ? "failed" : "ok",
    principal: e?.principal ?? null,
    durMs: Number.isFinite(e?.durMs) ? e.durMs : null,
    detail: clip(
      e?.status === "failed" && e?.error
        ? `${e?.kind ?? "command"} ${e.error.code ?? ""} ${e.error.message ?? ""} · input=${clip(e?.input, 80)}`
        : `${e?.kind ?? "command"} input=${clip(e?.input, 80)}${Array.isArray(e?.notes) && e.notes.length ? ` · notes=${clip(e.notes)}` : ""}`,
    ),
  })).filter((r) => r.ts);
}

/** dev/MCP 操作审计 → 归一行（source=audit；kind → name，agent → principal，ack 失败 → failed） */
export function normalizeAudit(rows) {
  return (rows ?? []).map((r) => {
    const d = r?.detail ?? {};
    const failed = r?.kind === "command.ack" && d.ok === false;
    return {
      ts: String(r?.at ?? ""),
      source: "audit",
      name: String(r?.kind ?? "?"),
      status: failed ? "failed" : "info",
      principal: typeof d?.agent === "string" ? d.agent : null,
      durMs: null,
      detail: clip(d),
    };
  }).filter((r) => r.ts);
}

/** 迁移审计 → 归一行（source=migration；applied_at(ms) → ISO；principal/durMs 无持久化诚实置 null） */
export function normalizeMigrations(rows) {
  return (rows ?? []).map((r) => ({
    ts: msToIso(r?.appliedAt ?? r?.applied_at) ?? "",
    source: "migration",
    name: String(r?.name ?? "?"),
    status: "applied",
    principal: null,
    durMs: null,
    detail: `#${r?.id ?? "?"} ${r?.name ?? ""}（down_verified=${r?.downVerified ? 1 : 0}）——迁移审计挂账：down 即删行无历史，principal/durMs 不落库（决策 21 台账形状预留）`,
  })).filter((r) => r.ts);
}

/**
 * 三源归并：按 ts 降序（ISO 字符串字典序 = 时间序，同刻条目按 source 稳定）。
 * groups = 归一行数组的数组；返回单条时间轴（不截断——截断归呈现层）。
 */
export function mergeTimeline(groups) {
  return ([]).concat(...groups).sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
    return String(a.source).localeCompare(String(b.source));
  });
}

/* ---------------- §11.2 端点行为 diff：checkpoint 前后 command journal 对比 ---------------- */

/**
 * 窗口对比：before = (prevAt, anchorAt]（上一轮已锚定的行为），since = (anchorAt, now]（本轮未锚定）。
 * prevAt 为 null（首锚）时 before = 全部 <= anchorAt。summary 聚合 calls/ok/failed/durMs 总量。
 * 诚实边界：journal 是内存环形（上限 + 重启清零）——窗口覆盖面受此限制，跨重启历史归 audit 源。
 */
export function endpointWindows(journalRows, anchorAt, prevAt) {
  const rows = (journalRows ?? []).filter((r) => r?.ts);
  const inBefore = rows.filter((r) => r.ts <= anchorAt && (prevAt == null || r.ts > prevAt));
  const inSince = rows.filter((r) => r.ts > anchorAt);
  const summarize = (list) => ({
    calls: list.length,
    ok: list.filter((r) => r.status === "ok").length,
    failed: list.filter((r) => r.status === "failed").length,
    durMs: list.reduce((s, r) => s + (Number.isFinite(r?.durMs) ? r.durMs : 0), 0),
    byName: list.reduce((m, r) => {
      const k = String(r.name);
      m[k] = m[k] ?? { calls: 0, ok: 0, failed: 0, durMs: 0 };
      m[k].calls += 1;
      m[k][r.status === "failed" ? "failed" : "ok"] += 1;
      m[k].durMs += Number.isFinite(r?.durMs) ? r.durMs : 0;
      return m;
    }, {}),
  });
  return { before: inBefore, since: inSince, summary: { before: summarize(inBefore), since: summarize(inSince) } };
}

/* ---------------- §11.2 锚点 × 迁移 head 对齐（"这个锚点在 schema 哪个版本"一处可答） ---------------- */

/**
 * 对齐结果 relation（决策 21-③ rollback 门同口径）：
 *   equal   = 锚点 head 与当前库 head 一致；
 *   behind  = 锚点 head 低于当前库 head——rollback 该锚会被 21-③ 拒绝（须先 migrate down）；
 *   ahead   = 锚点 head 高于当前库 head（库被 down 过）；
 *   unknown = 锚点无 migrationHead（vacuous 锚定：无库/无表）或当前无库头。
 */
export function alignCheckpointsMigrations(checkpointRows, currentHead) {
  return (checkpointRows ?? [])
    .filter((r) => r?.type === "save")
    .map((r) => {
      const head = r.migrationHead ?? null;
      let relation = "unknown";
      if (head && currentHead) relation = head.id === currentHead.id ? "equal" : head.id < currentHead.id ? "behind" : "ahead";
      return { id: r.id, name: r.name, at: r.at, migrationHead: head, relation };
    });
}

/* ---------------- 聚合：/__atelier/review-data 的载荷 ---------------- */

/**
 * 组装 review 扩展数据（§11.2 + §11.3 一口）。serverStatus = dev 面代理的 server-status 快照
 * （可为 null——server 面未托管/未就绪；相关段降级 + note）。anchorId = checkpoint save 的 id，
 * 给出则附 diff（窗口 = 该锚与前一个 save 锚之间 / 之后）。migrationsOverride = async 入口
 * （buildReviewDataAsync）解析好的迁移段——保持同步聚合逻辑单源，本函数不做 IO 兜底。
 */
export function buildReviewData({ root, serverStatus = null, anchorId = null, migrationsOverride = null }) {
  const checkpoints = readCheckpointLedger(root);

  // 迁移审计：优先 server-status（子进程持句柄，父进程不重复开库）；async 入口已试过
  // node:sqlite 只读兜底时直接用其结果（migrationsOverride）。
  const migrations = migrationsOverride ?? migrationsFromServerStatus(serverStatus);

  const journalEntries = Array.isArray(serverStatus?.journal) ? serverStatus.journal : [];
  const journal = Array.isArray(serverStatus?.journal)
    ? { ok: true, entries: journalEntries, note: null }
    : { ok: false, entries: [], note: "command journal 不可用（server 面未就绪/未托管——启动 pnpm dev 后恢复；journal 为内存环形，重启清零）" };

  const audit = readAuditTail(root, 200);

  const journalRows = normalizeJournal(journal.entries);
  const auditRows = normalizeAudit(audit.rows);
  const migrationRows = normalizeMigrations(migrations.rows);
  const timeline = mergeTimeline([journalRows, auditRows, migrationRows]);

  const saves = checkpoints.rows.filter((r) => r.type === "save");
  const head = migrations.head ?? null;
  const aligned = checkpoints.ok ? alignCheckpointsMigrations(checkpoints.rows, head) : [];

  let diff = null;
  if (checkpoints.ok && journal.ok && anchorId) {
    const idx = saves.findIndex((r) => r.id === anchorId);
    if (idx >= 0) {
      const anchor = saves[idx];
      const prev = saves[idx + 1] ?? null; // saves 为时间升序（台账 append-only）
      diff = { anchor: anchor.id, anchorAt: anchor.at, prev: prev ? prev.id : null, ...endpointWindows(journalRows, anchor.at, prev ? prev.at : null) };
    } else {
      diff = { anchor: anchorId, note: "未知锚点 id（checkpoint 台账里没有该 save）" };
    }
  }

  return {
    ok: true,
    at: new Date().toISOString(),
    checkpoints,
    migrations,
    journal,
    audit,
    aligned,
    diff,
    timeline,
  };
}

/**
 * buildReviewData 的 async 版（真正路由入口）：server-status 缺迁移行时先试 node:sqlite 只读兜底
 * （dbPath 由插件按 atelier.config.json server.dbPath 解析注入；缺省 .atelier/dev.db），再聚合。
 */
export async function buildReviewDataAsync({ root, serverStatus = null, anchorId = null, dbPath = null }) {
  let migrations = migrationsFromServerStatus(serverStatus);
  if (!migrations.ok) {
    migrations = await readMigrationsSqlite(root, dbPath ?? DEFAULT_DB_FILE);
  }
  return buildReviewData({ root, serverStatus, anchorId, migrationsOverride: migrations });
}
