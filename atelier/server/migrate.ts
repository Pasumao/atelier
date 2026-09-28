/**
 * 可逆迁移器（FS-DESIGN §5.4 全规格，FS-4，FS-M2(m2b)；持久 journal = 决策 21 台账预留位关闭，
 * M6 尾件批挂账候选池第二枚）。
 * 迁移目录形态：`NNN_<name>.up.sql` / `NNN_<name>.down.sql` 成对（缺 down = ATR-331，
 * 可逆性是硬门槛）；按 NNN 升序应用、逆序回滚；name = 文件 stem（如 `001_create_chats`）。
 *
 * 状态表 schema 固定（struct 守卫侧按同 schema 检查——字段名勿改）：
 *   atelier_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
 *                      applied_at INTEGER NOT NULL, down_verified INTEGER DEFAULT 0)
 * checksum = sha256(up.sql 文件内容 utf8，node:crypto)；应用前对已应用条目校验，文件被改
 * 或缺失 = ATR-332（完整性域，up/down 两路径同口径）。
 *
 * 迁移 journal（追加式审计史，决策 21 台账预留位的落地形态——**新表**而非改状态表形状）：
 *   atelier_migration_journal(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
 *     name TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('up','down')),
 *     status TEXT NOT NULL CHECK(status IN ('ok','failed')), principal TEXT,
 *     dur_ms INTEGER, checksum TEXT)
 * 每次迁移执行（成功与失败都写 = §3.5 审计失败条目同纪律）追加一行：成功条目与迁移同事务
 * （journal 与状态表原子一致），失败条目在 ROLLBACK 后独立落（不掩盖原始 ATR-33x）。
 * CREATE TABLE IF NOT EXISTS 惰性建表——旧库首次 up/down 自动获得，atelier_migrations 形状
 * 与 sha256 体检/checksum 语义零影响；纯读面（migrateStatus / readMigrationJournal）不建表。
 * 只追加永不改删（append-only 审计纪律）。
 *
 * 错误码语义（FS-DESIGN §15，正交切分）：
 *   ATR-331 迁移缺 down 配对（up 拒绝应用不成对迁移）
 *   ATR-332 迁移完整性破坏（已应用文件被改/缺失，sha256 对不上）
 *   ATR-333 down 缺失 / down 失败 / down 标注不可逆且未 force（§18 R7 风险约定：
 *           down 文件含 `-- 不可逆：` 标记注释时必须显式 force:true，无静默默认）
 *   ATR-334 up 失败（事务已回滚；含 up 目标不存在——up 域操作无法执行）
 * 四段式经 endpoints.ts 的 AtrEndpointError/endpointError 复用（决策 9）。
 *
 * 诚实边界（§5.4）：无自动 diff 生成 down（v1 只生成新表成对骨架，改列迁移手写过 verify）；
 * 单库单线无多环境分支；down_verified 位恒 0（状态表形状冻结——down 历史改记于
 * atelier_migration_journal，本列留作兼容位）；journal 只记**执行位**结果（进到事务执行的
 * up/down），前置拒绝（完整性体检 ATR-332 / 缺 down ATR-331 / 目标不存在 / 不可逆未 force）
 * 不入 journal——那是拒绝不是执行；seed 动作不入本 journal（种子有自己的 atelier_seeds
 * 记账，且种子是数据引导不是 schema 迁移）；journal 是库内追加史——库删即史灭，不含
 * rollback/清库场景的重建；principal 在 CLI 场景恒为缺省值（无服务端主体概念，
 * ATELIER_PRINCIPAL env 可覆盖）；失败条目的写入自身失败时不掩盖原始迁移错误（诚实缺口：
 * 该次失败未入史）；目录畸形（编号冲突/历史空洞）抛普通 Error——那是环境损坏而非四码
 * 契约违约；迁移文件不得自带 BEGIN/COMMIT（事务由迁移器统一逐条包裹）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AtrEndpointError, endpointError } from "./endpoints.ts";
import { openSqlite, type SqliteDb } from "./sqlite.ts";

/** 状态表 DDL（schema 固定，struct 守卫侧同源核对——字段名勿改） */
export const MIGRATIONS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS atelier_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL, down_verified INTEGER DEFAULT 0)";

/**
 * 状态表 name 唯一索引（A2 硬化6）：迁移器自身不产生重名行，但手工/脚本误插会破坏 head 判定
 * （max id）与完整性体检的 name 1:1 假设——唯一索引把"损坏可见"提前到写入时。
 * 取最小升级方案：**不在 CREATE TABLE 里加 UNIQUE**（既有库拿不到惰性 DDL 升级，还需安全重建），
 * 而是命名唯一索引 + migrateUp 惰性执行（IF NOT EXISTS 幂等）——新库/旧库最终索引对象一致，
 * 状态表列形状零变化（struct 守卫/checkpoint 联动/sha256 体检三面消费者零感知）。
 * 旧库若已有重名行（迁移器从不产生，出现即人工损坏）索引创建失败原样抛出——fail loudly，
 * 绝不静默带病继续（诚实边界：此时需人工清重后重跑 migrate up）。
 */
export const MIGRATIONS_NAME_UK_DDL =
  "CREATE UNIQUE INDEX IF NOT EXISTS atelier_migrations_name_uk ON atelier_migrations (name)";

/**
 * 迁移 journal DDL（决策 21 台账预留位关闭）：追加式审计史——只 INSERT 不 UPDATE/DELETE。
 * 独立新表而非给 atelier_migrations 加列/行：状态表形状被 struct 守卫、checkpoint 联动
 * （migrationHead = max id）、sha256 体检三面消费，动形状 = 三处联动风险换一个史字段；
 * 追加表零触碰既有语义且天然承载多轮 up→down→up 历史（状态表一行 = 当前态，journal 一行
 * = 一次事件，两种真相各司其职）。
 */
export const MIGRATION_JOURNAL_DDL =
  "CREATE TABLE IF NOT EXISTS atelier_migration_journal (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('up','down')), status TEXT NOT NULL CHECK(status IN ('ok','failed')), principal TEXT, dur_ms INTEGER, checksum TEXT)";

const STATUS_TABLE = "atelier_migrations";
const JOURNAL_TABLE = "atelier_migration_journal";
/** journal 尾部上限（introspect server-status 快照携带量——快照有界，全量走库直读） */
export const MIGRATION_JOURNAL_TAIL_LIMIT = 200;
const FILE_RE = /^(\d+)_([A-Za-z0-9_-]+)\.(up|down)\.sql$/;
/** 不可逆标记注释（§18 R7 风险约定）：`-- 不可逆：<说明为何安全/丢弃什么>` */
const IRREVERSIBLE_RE = /--\s*不可逆：/;

export type MigrationStep = { name: string; checksum: string; durMs: number };

/** 迁移 journal 行（读取面 camelCase；库内列 = ts/name/action/status/principal/dur_ms/checksum） */
export type MigrationJournalEntry = {
  id: number;
  ts: number;
  name: string;
  action: "up" | "down";
  status: "ok" | "failed";
  principal: string | null;
  durMs: number | null;
  checksum: string | null;
};

export type MigrationJournalRead = { ok: boolean; rows: MigrationJournalEntry[]; note: string | null };

export type MigrateStatus = {
  applied: {
    name: string;
    checksum: string;
    appliedAt: number;
    downVerified: boolean;
    irreversible: boolean;
    /** 状态表有记录但目录中文件缺失（完整性破坏——migrate up/down 会以 ATR-332 拒绝） */
    fileMissing: boolean;
    checksumOk: boolean;
  }[];
  pending: { name: string; hasDown: boolean; irreversible: boolean }[];
};

export type MigrateVerifyResult = {
  ok: boolean;
  steps: MigrationStep[];
  /** 幂等破坏描述（最终 sqlite_master 与首次 up 后不一致时给出差异清单） */
  mismatch?: string;
  /** 干跑中途撞上 ATR-33x（缺 down/被改/up·down 执行失败）时的结构化摘要 */
  error?: { code: string; message: string };
};

type MigrationFile = {
  n: number;
  name: string;
  upPath: string;
  downPath: string | null;
  upSql: string;
  downSql: string | null;
  /** sha256(upSql)——迁移身份（up 记账 / down 校验同一口径） */
  checksum: string;
  irreversible: boolean;
};

function fail(code: string, message: string, fix: string, hints?: string[]): AtrEndpointError {
  return new AtrEndpointError(endpointError(code, message, fix, hints));
}

function errMsg(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** 扫描迁移目录：按 NNN 升序；编号冲突（同 NNN 不同名）= 目录损坏，普通 Error */
function scanMigrations(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  const byName = new Map<string, { n: number; base: string; up?: string; down?: string }>();
  for (const file of fs.readdirSync(dir)) {
    const m = FILE_RE.exec(file);
    if (!m) continue;
    const n = Number(m[1]);
    const name = `${m[1]}_${m[2]}`;
    const slot = byName.get(name) ?? { n, base: m[2] };
    if (slot.n !== n || slot.base !== m[2]) {
      throw new Error(`迁移目录损坏：${file} 与既有条目编号/名称冲突（${dir}）`);
    }
    slot[m[3] === "up" ? "up" : "down"] = path.join(dir, file);
    byName.set(name, slot);
  }
  const seenN = new Map<number, string>();
  const files: MigrationFile[] = [];
  for (const [name, slot] of byName) {
    const prev = seenN.get(slot.n);
    if (prev != null) {
      throw new Error(`迁移目录损坏：编号 ${slot.n} 被 ${prev} 与 ${name} 同时占用（${dir}）`);
    }
    seenN.set(slot.n, name);
    const upSql = slot.up != null ? fs.readFileSync(slot.up, "utf8") : "";
    const downSql = slot.down != null ? fs.readFileSync(slot.down, "utf8") : null;
    files.push({
      n: slot.n,
      name,
      upPath: slot.up ?? "",
      downPath: slot.down ?? null,
      upSql,
      downSql,
      checksum: checksumOf(upSql),
      irreversible: downSql != null && IRREVERSIBLE_RE.test(downSql),
    });
  }
  return files.sort((a, b) => a.n - b.n);
}

/** 状态表行读取（表不存在 = 空数组——status 对未迁移库是纯读，不建表） */
function readStatusRows(db: SqliteDb): { name: string; checksum: string; applied_at: number; down_verified: number }[] {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(STATUS_TABLE);
  if (!has) return [];
  return db
    .prepare(`SELECT name, checksum, applied_at, down_verified FROM ${STATUS_TABLE} ORDER BY id`)
    .all() as { name: string; checksum: string; applied_at: number; down_verified: number }[];
}

/* ---------------- 迁移 journal（追加式审计史：决策 21 台账预留位关闭） ---------------- */

/**
 * journal 主体解析：显式 opts.principal 优先 → ATELIER_PRINCIPAL env 覆盖 → 'cli' 缺省。
 * CLI 场景没有服务端主体概念（诚实边界）；server 侧将来装配迁移执行时可显式传入会话主体。
 */
function journalPrincipal(explicit?: string): string {
  return explicit ?? process.env.ATELIER_PRINCIPAL ?? "cli";
}

type JournalAppend = {
  name: string;
  action: "up" | "down";
  status: "ok" | "failed";
  principal: string;
  durMs: number;
  checksum: string;
};

/**
 * journal 追加写（惰性建表——旧库首次 up/down 自动获得 journal，向后兼容零迁移）。
 * 调用方负责在正确的事务位置写入：成功条目与迁移**同事务**（journal 与状态表原子一致，
 * 库状态与审计史永不脱节）；失败条目在 ROLLBACK **之后**独立落（事务已不存在）。
 */
function appendJournal(db: SqliteDb, entry: JournalAppend): void {
  db.exec(MIGRATION_JOURNAL_DDL);
  db.prepare(`INSERT INTO ${JOURNAL_TABLE} (ts, name, action, status, principal, dur_ms, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    Date.now(),
    entry.name,
    entry.action,
    entry.status,
    entry.principal,
    entry.durMs,
    entry.checksum
  );
}

/** 失败条目落账（ROLLBACK 后调用）：journal 写入失败不掩盖原始迁移错误——原始 ATR-33x 的
 * 可导航性优先，代价是诚实缺口（该次失败未入史）。静默的只是审计追加，不是迁移失败。 */
function appendJournalFailedQuietly(db: SqliteDb, entry: JournalAppend): void {
  try {
    appendJournal(db, entry);
  } catch {
    /* journal 不可写（磁盘满/库锁/只读连接）——原始错误照抛 */
  }
}

/**
 * 迁移 journal 只读（review 面 §11.3 与后续审计消费的单源读取口）：表不存在 = ok:false +
 * note（journal 时代之前的旧库诚实降级——此前 down 历史无处可考，绝不假数据）。纯读不建表。
 */
export function readMigrationJournal(db: SqliteDb): MigrationJournalRead {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(JOURNAL_TABLE);
  if (!has) {
    return { ok: false, rows: [], note: "库内无 atelier_migration_journal 表（journal 时代之前的旧库——下次 migrate up/down 惰性建表，此前的 down 历史无处可考）" };
  }
  const rows = db
    .prepare(`SELECT id, ts, name, action, status, principal, dur_ms, checksum FROM ${JOURNAL_TABLE} ORDER BY id`)
    .all()
    .map((r) => ({
      id: Number(r.id),
      ts: Number(r.ts),
      name: String(r.name),
      action: r.action === "down" ? "down" : "up",
      status: r.status === "failed" ? "failed" : "ok",
      principal: r.principal == null ? null : String(r.principal),
      durMs: r.dur_ms == null ? null : Number(r.dur_ms),
      checksum: r.checksum == null ? null : String(r.checksum),
    })) as MigrationJournalEntry[];
  return { ok: true, rows, note: null };
}

/** 目标解析：纯数字 = NNN 编号；否则 = 完整 stem（`001_create_chats`）。找不到返回 null */
function resolveTarget(files: MigrationFile[], to: string): MigrationFile | null {
  if (/^\d+$/.test(to)) {
    const n = Number(to);
    return files.find((f) => f.n === n) ?? null;
  }
  return files.find((f) => f.name === to) ?? null;
}

/** 迁移状态（纯读，不建状态表不落任何写）：已应用（含完整性体检）/待应用 清单 */
export function migrateStatus(db: SqliteDb, dir: string): MigrateStatus {
  const files = scanMigrations(dir);
  const fileByName = new Map(files.map((f) => [f.name, f]));
  const appliedNames = new Set<string>();
  const applied = readStatusRows(db).map((row) => {
    appliedNames.add(row.name);
    const f = fileByName.get(row.name);
    return {
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
      downVerified: row.down_verified === 1,
      irreversible: f?.irreversible ?? false,
      fileMissing: f == null || f.upPath === "",
      checksumOk: f != null && checksumOf(f.upSql) === row.checksum,
    };
  });
  const pending = files
    .filter((f) => !appliedNames.has(f.name))
    .map((f) => ({ name: f.name, hasDown: f.downPath != null, irreversible: f.irreversible }));
  return { applied, pending };
}

/**
 * 顺序应用待迁移（逐条事务包裹，记 checksum）。opts.to = 目标（编号或 stem），只应用到它；
 * opts.principal = journal 主体（缺省 ATELIER_PRINCIPAL env → 'cli'）。
 * 步骤：先对全部已应用条目做完整性体检（文件缺失/被改 = ATR-332，与是否有待应用无关——
 * 每次都查，漂移不过夜），再逐条 pending：缺 down = ATR-331 → BEGIN IMMEDIATE 应用 +
 * 记账 + journal ok 行（同事务，原子一致）→ COMMIT；失败 ROLLBACK = ATR-334 + journal
 * failed 行（回滚后独立落，不掩盖原始错误）。返回每次应用的 { name, checksum, durMs }。
 */
export function migrateUp(db: SqliteDb, dir: string, opts: { to?: string; principal?: string } = {}): MigrationStep[] {
  db.exec(MIGRATIONS_TABLE_DDL);
  db.exec(MIGRATIONS_NAME_UK_DDL); // A2 硬化6：name 唯一（惰性幂等——既有库首迁自动补索引）
  const files = scanMigrations(dir);
  const fileByName = new Map(files.map((f) => [f.name, f]));
  const principal = journalPrincipal(opts.principal);

  // 完整性体检（ATR-332）：状态表有记录就必须能对上目录里的文件（up 文件是 checksum 对象）
  for (const row of readStatusRows(db)) {
    const f = fileByName.get(row.name);
    if (f == null || f.upPath === "") {
      throw fail("ATR-332", `已应用迁移 ${row.name} 的文件在目录中缺失（${dir}）`, "恢复该迁移文件（git/ checkpoint 台账找回）；文件内容必须与应用时逐字一致（sha256 记账于 atelier_migrations）", [row.name]);
    }
    if (checksumOf(f.upSql) !== row.checksum) {
      throw fail("ATR-332", `已应用迁移 ${row.name} 的文件被改（sha256 与应用时不符）`, `已应用迁移永不重写（§5.4）——撤销对 ${f.upPath} 的修改，或恢复后另出一条新迁移`, [row.name]);
    }
  }

  let target: MigrationFile | null = null;
  if (opts.to != null) {
    target = resolveTarget(files, opts.to);
    if (target == null) {
      throw fail("ATR-334", `up 目标迁移不存在：${opts.to}`, `用目录内实际存在的编号或 stem（可用：${files.map((f) => f.name).join(", ") || "（目录为空）"}）`);
    }
  }

  const appliedNames = new Set(readStatusRows(db).map((r) => r.name));
  const head = Math.max(0, ...files.filter((f) => appliedNames.has(f.name)).map((f) => f.n));
  const pending = files.filter((f) => !appliedNames.has(f.name) && (target == null || f.n <= target.n));
  for (const f of pending) {
    if (f.n < head) {
      // 理论上完整性体检已拦住"低编号文件缺失"，此处防的是历史空洞（如 002 晚于 003 才出现）
      throw new Error(`迁移历史空洞：${f.name} 未应用但编号小于已应用头 ${head}（${dir}）`);
    }
  }

  const steps: MigrationStep[] = [];
  for (const f of pending) {
    if (f.upPath === "") {
      // 只剩 down 的目录残缺（up 是迁移本体与 checksum 对象）——比 331 更根本，先拦
      throw fail("ATR-332", `迁移 ${f.name} 缺 up 文件（${f.name}.up.sql 不存在）`, "迁移以 up 文件为本体（down 是配对回滚件）——恢复 up 文件或删除残缺对后重写", [f.name]);
    }
    if (f.downPath == null) {
      throw fail("ATR-331", `迁移 ${f.name} 缺 down 配对（${f.name}.down.sql 不存在）`, "补写 down 文件（可逆性是硬门槛，§5.4）——gen db 只生成成对骨架；up 在配齐前拒绝应用该迁移", [f.name]);
    }
    const t0 = performance.now();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(f.upSql);
      db.prepare(`INSERT INTO ${STATUS_TABLE} (name, checksum, applied_at, down_verified) VALUES (?, ?, ?, 0)`).run(f.name, f.checksum, Date.now());
      // journal ok 行与迁移同事务：状态表记账与审计史原子一致（决策 21 台账预留位关闭）
      appendJournal(db, { name: f.name, action: "up", status: "ok", principal, durMs: Math.round(performance.now() - t0), checksum: f.checksum });
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ROLLBACK 本身失败（连接已坏）——不掩盖原始错误 */
      }
      // 失败条目也在案（§3.5 审计失败条目同纪律）——回滚后事务已不存在，独立落账
      appendJournalFailedQuietly(db, { name: f.name, action: "up", status: "failed", principal, durMs: Math.round(performance.now() - t0), checksum: f.checksum });
      throw fail("ATR-334", `迁移 ${f.name} up 失败，事务已回滚：${errMsg(e)}`, `修复 ${f.upPath} 中的 SQL 后重跑（失败即整条回滚，库未受影响）；迁移文件不得自带 BEGIN/COMMIT——事务由迁移器统一包裹`, [f.name]);
    }
    steps.push({ name: f.name, checksum: f.checksum, durMs: Math.round(performance.now() - t0) });
  }
  return steps;
}

/**
 * 逆序回滚。opts.to = 回滚到该目标为止（编号或 stem；目标本身保留）；**无 to = 只回滚
 * 最后一条**（破坏面最小的缺省）；opts.principal = journal 主体（缺省同 up）。
 * 语义：完整性体检（文件被改/缺失 = ATR-332，同 up 口径）→ down 缺失 = ATR-333 → 含
 * `-- 不可逆：` 标记且未 force = ATR-333（fix 指明风险约定）→ BEGIN IMMEDIATE 执行 down +
 * 删状态行 + journal ok 行（同事务——down 历史自此持久，状态行删了 journal 还在）→ COMMIT；
 * 失败 ROLLBACK = ATR-333 + journal failed 行（回滚后独立落）。
 */
export function migrateDown(db: SqliteDb, dir: string, opts: { to?: string; force?: boolean; principal?: string } = {}): MigrationStep[] {
  const files = scanMigrations(dir);
  const fileByName = new Map(files.map((f) => [f.name, f]));
  const rows = readStatusRows(db).reverse(); // id 降序 = 应用逆序
  const principal = journalPrincipal(opts.principal);

  let revert: typeof rows;
  if (opts.to != null) {
    const target = resolveTarget(files, opts.to);
    if (target == null) {
      throw fail("ATR-333", `down 目标迁移不存在：${opts.to}`, `用目录内实际存在的编号或 stem（可用：${files.map((f) => f.name).join(", ") || "（目录为空）"}）`);
    }
    revert = rows.filter((r) => (fileByName.get(r.name)?.n ?? Infinity) > target.n);
  } else {
    revert = rows.slice(0, 1);
  }

  const steps: MigrationStep[] = [];
  for (const row of revert) {
    const f = fileByName.get(row.name);
    if (f == null || checksumOf(f.upSql) !== row.checksum) {
      throw fail("ATR-332", `迁移 ${row.name} 文件缺失或被改（sha256 与应用时不符），down 拒绝执行`, "先恢复该迁移文件至应用时内容（git/ checkpoint 台账找回），再回滚——在未校验的库状态上回滚不可信");
    }
    if (f.downSql == null) {
      throw fail("ATR-333", `迁移 ${f.name} 缺 down 文件，无法回滚`, `补写 ${f.name}.down.sql（迁移必须成对——可逆性是硬门槛，§5.4）`, [f.name]);
    }
    if (f.irreversible && opts.force !== true) {
      throw fail("ATR-333", `迁移 ${f.name} 的 down 标注不可逆，未获显式确认`, `读 ${f.name}.down.sql 中的「-- 不可逆：」注释，确认丢弃数据的范围与理由；确要回滚时以 force: true 显式执行（§18 R7：不可逆操作必须显式确认，无静默默认）`, [f.name]);
    }
    const t0 = performance.now();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(f.downSql);
      db.prepare(`DELETE FROM ${STATUS_TABLE} WHERE name = ?`).run(f.name);
      // journal ok 行与 down 同事务：状态行删除而 journal 留痕——down 历史不再无处可记
      appendJournal(db, { name: f.name, action: "down", status: "ok", principal, durMs: Math.round(performance.now() - t0), checksum: row.checksum });
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* 不掩盖原始错误 */
      }
      // 失败条目也在案（§3.5 同纪律）——回滚后独立落账，不掩盖原始 ATR-333
      appendJournalFailedQuietly(db, { name: f.name, action: "down", status: "failed", principal, durMs: Math.round(performance.now() - t0), checksum: row.checksum });
      throw fail("ATR-333", `迁移 ${f.name} down 失败，事务已回滚：${errMsg(e)}`, `修复 ${f.name}.down.sql 中的 SQL 后重跑（失败即整条回滚，库未受影响）`, [f.name]);
    }
    steps.push({ name: f.name, checksum: row.checksum, durMs: Math.round(performance.now() - t0) });
  }
  return steps;
}

/**
 * 重放校验（干跑影子库 :memory:）：up→down(force)→up，最终 sqlite_master 与首次 up 后
 * 逐对象一致 = 幂等通过。影子库干跑无真实数据，不可逆标记不阻断 verify（verify 的目的
 * 正是检验 down 的可执行性）——内部以 force:true 回放，真实回滚不受此影响。
 * 形参说明：**签名不含 db**——影子库由本函数自建（openSqlite(":memory:")），传入宿主句柄
 * 无消费面；与其他三个 API 的 (db, dir) 不同构是有意为之（避免忽略参数的误导 API）。
 * 干跑中途撞上 ATR-33x → ok:false + error 摘要（verify 是报告不是炸弹）。
 */
export async function migrateVerify(dir: string): Promise<MigrateVerifyResult> {
  const shadow = await openSqlite(":memory:");
  const steps: MigrationStep[] = [];
  const snapshot = (): { name: string; sql: string | null }[] =>
    shadow.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string;
      sql: string | null;
    }[];
  try {
    steps.push(...migrateUp(shadow, dir));
    const first = snapshot();
    // 全量逆序回滚：无 to 的 down 缺省只回滚 head（破坏面最小）——verify 用循环清空影子库
    let downed: MigrationStep[];
    do {
      downed = migrateDown(shadow, dir, { force: true });
      steps.push(...downed);
    } while (downed.length > 0);
    steps.push(...migrateUp(shadow, dir));
    const second = snapshot();

    const a = new Map(first.map((r) => [r.name, r.sql]));
    const b = new Map(second.map((r) => [r.name, r.sql]));
    const names = [...new Set([...a.keys(), ...b.keys()])].sort();
    const diffs = names.filter((n) => a.get(n) !== b.get(n)).map((n) => `${n}（首次up后:${a.get(n) != null ? "有" : "无"} → 回放后:${b.get(n) != null ? "有" : "无"}）`);
    if (diffs.length > 0) {
      return { ok: false, steps, mismatch: `up→down→up 后 schema 不一致（幂等破坏）：${diffs.join("；")}` };
    }
    return { ok: true, steps };
  } catch (e) {
    if (e instanceof AtrEndpointError) {
      return { ok: false, steps, error: { code: e.atr.code, message: e.message } };
    }
    throw e;
  } finally {
    shadow.close();
  }
}
