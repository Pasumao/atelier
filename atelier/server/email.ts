/**
 * email.ts — email 适配边界（FS-DESIGN §5.8 落地注记，2026-09-28 差距批 B3；决策 31：
 * **显式 transport 接口 + 内建可验证的投递记账**）。同「不内嵌 LLM/不内建云复制」纪律：
 * **框架不内建真实发送**（SMTP/Resend/SES 一律应用自接——实现 EmailTransport 接口的任意模块，
 * 装配点 createHandler({ email }) 显式接线，明文可见）；内建唯一 transport = **mock**
 * （mockTransport：零 IO 恒成功、dev/prod 同语义，落记账表可审计——「agent 可验证的投递记账」）。
 *
 * 记账 = **追加事件表** `atelier_email_log`（决策 21/29 同款模式：迁移 journal/command journal
 * 同构——**追加式**一行 = 一次投递请求 / **框架自管**不进应用迁移序列，应用 schema.ts 零感知 /
 * **建表在装配期尽力完成**（CREATE TABLE IF NOT EXISTS 幂等零迁移，jobs.ts startJobs 同款先例）：
 * SQLite DDL 是事务性的，若留到 tx 内的首次投递才建，业务事务回滚会把 CREATE TABLE 一起回滚、
 * 记账表面随业务事务消失——表面必须在事务外成立，回滚只回滚**行**不回滚表面；坏句柄装配不炸，
 * 首次投递时再试并原样上抛）。表（schema 固定，字段名勿改）：
 *   atelier_email_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
 *     transport TEXT NOT NULL, "to" TEXT NOT NULL, subject TEXT NOT NULL,
 *     payload TEXT, status TEXT NOT NULL CHECK(status IN ('ok','failed')), error TEXT)
 * 注意 "to" 是 SQLite 关键字——DDL 与全部查询恒双引号（红检前实证：裸 to 报 syntax error）。
 *
 * send 语义（tests/email.test.ts 钉死）：
 * - **先 transport 后记账**（成功/失败两态都记——投递失败是记账事实不是异常）；
 * - transport 抛错/拒绝 → send **不抛**，resolve `{ id, status: "failed", error }`——调用方拿
 *   status 自行决定重试/告警（返回值语义，不是异常语义）；
 * - **记账本身失败 → send 原样上抛**（不可记账 ≠ 假账——与 command journal 落库失败 console.warn
 *   降级是有意差异：journal 是旁路审计，记账是 send 返回值的组成部分，记不上就诚实失败）。
 *
 * 事务边界（诚实声明，决策 29 同款）：记账 INSERT 经装配时传入的 db 句柄执行——应用以**同一个
 * 句柄**装配 createEmailRecorder({ db }) 与 createHandler({ db, email }) 时，`ctx.db.tx(() => {
 * 业务写; ctx.email.send(...) })` 内业务写与记账行同事务；transport 与 DB 写**不同源时无分布式
 * 事务**（真实 transport 先于记账已发生，tx 回滚只回滚记账行不召回邮件）；**mock transport 零
 * 外部 IO**（同步 send，记账 INSERT 与调用方同栈执行）→ mock + tx = 完全原子（用例钉死）。
 * 写捕获槽注记：记账 INSERT 发生在 handler 执行期内（command 分发的捕获槽开着）——
 * table:atelier_email_log 可能并入自动失效键（sqlite.ts「宁多勿漏」哲学，与 handler 内
 * ctx.jobs.enqueue 的 INSERT 同款）：至多一次幂等重算，无正确性影响。
 *
 * 脱敏：payload 落库前经 endpoints.ts `redactSensitiveInput`（W2 词根单源）——journal input 与
 * email payload 同一收口，持久层不二次实现脱敏（两处注释互指；from/cc/bcc/text/html 值内嵌套
 * 敏感键同样替换 "[redacted]"，to/subject 列直存不脱敏——收件人与主题是投递事实本体，脱敏 them
 * 会让记账不可用；应用若需机密主题请自行在调用侧泛化）。
 *
 * 诚实边界（决策 31 同文）：
 * - **无模板引擎**：subject/body 调用方给（框架不掺渲染 opinion）；
 * - **无队列联动强制**：大量发送请经 ctx.jobs 自行投递（send 是同步记账原语，不是后台任务）；
 * - **无退订/合规面**：营销邮件的退订链接/合规边界是应用域；
 * - mock 表即真信源：mock 不落任何"已发送"假象之外的状态，投递史 = atelier_email_log 行；
 *   dev 面 review 时间轴消费记账表归后续批；
 * - 行数基裁剪（缺省 1 万，写时惰性裁最老——决策 29 同款）：最老投递滚出窗口即不可查，时间基
 *   裁剪 v1 不做；库删即史灭（同迁移 journal 口径）；
 * - 内省 email 段（introspect.ts server-status）走 tail 窄口只读投影，prod 隐身语义沿用调试面
 *   整体（introspectResponse prod 返回 null）。
 */
import { redactSensitiveInput } from "./endpoints.ts";

export const EMAIL_LOG_TABLE = "atelier_email_log";

/** 追加事件表 DDL（CREATE TABLE IF NOT EXISTS——装配期尽力执行 + append 兜底；"to" 恒双引号） */
export const EMAIL_LOG_DDL = `CREATE TABLE IF NOT EXISTS atelier_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  transport TEXT NOT NULL,
  "to" TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok','failed')),
  error TEXT
)`;

/** 行数基保留窗口缺省值（决策 31：行数基不做时间基——决策 29 同款简化，诚实边界） */
export const DEFAULT_EMAIL_LOG_MAX_ROWS = 10_000;

/** error 列/返回值截断上限（≈2KB）：transport 错误摘要落全量无排查增益，可读头部足够导航 */
export const EMAIL_ERROR_MAX_CHARS = 2048;

/* ---------------- 类型面 ---------------- */

/**
 * 外发邮件（调用方给 subject/body——无模板引擎，诚实边界）：to/subject 必填，
 * from/cc/bcc/text/html 可选；可选字段只在**在场时**进记账 payload（缺省不落 null 键）。
 */
export type OutgoingEmail = {
  to: string;
  subject: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
  text?: string;
  html?: string;
};

/**
 * 显式 transport 接口（决策 31 核心）：应用自接 SMTP/Resend/SES 等任意发送通道。
 * name 自报进记账 transport 列（如 "mock" | "resend" | "smtp"——装配哪个通道账上就是谁）；
 * send 抛错（同步 throw 或 Promise 拒绝）= 投递失败，记账 failed + error 摘要，
 * **send 调用方（recorder）不因此抛错**。
 */
export type EmailTransport = {
  name: string;
  send(msg: OutgoingEmail): Promise<void> | void;
};

/** send 返回值（不抛语义的载体）：status = "ok" | "failed"；failed 携 error 摘要 */
export type EmailSendResult = {
  id: number;
  status: "ok" | "failed";
  error?: string;
};

/** 记账行读回形态（tail / 内省的数据源单源）：ts = ISO 串（人/agent 可读，journal 条目同款）；payload = JSON round-trip */
export type EmailLogEntry = {
  id: number;
  ts: string;
  transport: string;
  to: string;
  subject: string;
  payload: unknown;
  status: "ok" | "failed";
  error?: string;
};

/** 投递记账器（createEmailRecorder 产物；createHandler({ email }) 装配项） */
export type EmailRecorder = {
  /**
   * 投递一封邮件并记账：先 transport（抛错/拒绝 → failed 记账）后记账 INSERT（失败原样上抛——
   * 不可记账 ≠ 假账）。返回值恒 resolve（transport 失败不抛，语义见文件头）。
   */
  send(msg: OutgoingEmail): Promise<EmailSendResult>;
  /** 库尾只读（id 降序取尾再反转为入账序）；表未建（尚无投递）= []（纯读不建表，零假数据） */
  tail(n: number): EmailLogEntry[];
};

/** ctx.email 绑定视图（endpoints.ts createHandler 组装——send 直通装配的 recorder；记账经 ctx.db 同连接） */
export type BoundEmail = { send(msg: OutgoingEmail): Promise<EmailSendResult> };

/** 装配项（db = 记账连接；应用以同一句柄装配 createHandler({ db }) 即得 tx 原子性） */
export type CreateEmailRecorderOptions = {
  db: EmailLogDb;
  /** 缺省 = mockTransport()（内建唯一 transport：零发送落账可审计） */
  transport?: EmailTransport;
  /** 行数基保留窗口（缺省 1 万；写时惰性裁最老） */
  maxRows?: number;
};

/** 记账 db 句柄最小结构面（SqliteDb 四原语的结构子集——测试可用假句柄注入记账失败路径） */
export type EmailLogDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint };
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
};

/* ---------------- mock transport（内建唯一 transport） ---------------- */

/**
 * 内建 mock transport：零 IO 恒成功（不碰网络/文件系统），dev/prod 同语义——
 * 投递史 = atelier_email_log 行（真信源），应用/测试可经 recorder.tail 读回验证。
 * 抛错路径由测试注入 failing transport 验证（本函数恒成功，无失败分支可测）。
 */
export function mockTransport(): EmailTransport {
  return {
    name: "mock",
    send(_msg: OutgoingEmail): void {
      /* 零 IO 恒成功——记账由 recorder 统一落（本函数只承担「发送」这个已兑现的 no-op） */
    },
  };
}

/* ---------------- createEmailRecorder ---------------- */

function truncateError(msg: string): string {
  return msg.length > EMAIL_ERROR_MAX_CHARS ? msg.slice(0, EMAIL_ERROR_MAX_CHARS) : msg;
}

function safeJsonParse(text: unknown): unknown {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // 半截串（人工损坏等）——投影 payload 如实 null，绝不抛（读路径零反噬）
  }
}

/** 行 → 读回形态投影（字段逐一逆向，见文件头对照——tail/内省形状兼容红线） */
function rowToEntry(r: Record<string, unknown>): EmailLogEntry {
  const entry: EmailLogEntry = {
    id: Number(r.id),
    ts: new Date(Number(r.ts)).toISOString(),
    transport: String(r.transport),
    to: String(r.to_addr),
    subject: String(r.subject),
    payload: safeJsonParse(r.payload),
    status: r.status === "failed" ? "failed" : "ok",
  };
  if (typeof r.error === "string" && r.error.length > 0) entry.error = r.error;
  return entry;
}

/**
 * 投递记账器工厂（决策 31）：惰性建表（首次投递时）+ 先 transport 后记账 + 行数基惰性裁剪。
 * 裁剪法与 command-journal.ts 同款：AUTOINCREMENT 单调 → 「保最新 maxRows」≡ 主键点删
 * `id ≤ lastId − maxRows`（每次写后不变式成立，无周期窗口期超限）。
 * send 内 mock transport 走同步路径（thenable 才 await——零微任务间隙，tx 内与业务写同栈）。
 */
export function createEmailRecorder(opts: CreateEmailRecorderOptions): EmailRecorder {
  const db = opts.db;
  const transport = opts.transport ?? mockTransport(); // 缺省 = mock（内建唯一 transport 纪律）
  const maxRows = Math.max(1, Math.trunc(opts.maxRows ?? DEFAULT_EMAIL_LOG_MAX_ROWS));
  let tableReady = false;
  let lastId = 0;

  /** 表面保证（幂等 DDL）：append 与装配期共用；失败原样上抛（调用方决定语义，本层不吞） */
  function ensureTable(): void {
    if (tableReady) return;
    db.exec(EMAIL_LOG_DDL);
    tableReady = true;
  }
  // 装配时尽力建表（jobs.ts startJobs 同款先例：框架自管表，CREATE TABLE IF NOT EXISTS 幂等零迁移）。
  // 为什么不在首次投递时才建：SQLite DDL 是**事务性**的——tx 内的首次投递会把 CREATE TABLE 一起
  // 回滚，记账表面随业务事务消失（红检：tests/email.test.ts tx 回滚用例）——表面必须在事务外成立，
  // 回滚只回滚**行**（绝无孤儿账），不回滚表面本身。坏句柄装配不炸（尽力语义）：首次投递时
  // ensureTable 再试，届时原样上抛（记账失败语义，见 send）。
  try {
    ensureTable();
  } catch {
    /* 句柄异常——留给首次投递诚实上抛 */
  }

  /** 记账单源（transport 之后调用；任何失败原样上抛——调用方决定语义，本层不吞） */
  function append(entry: { status: "ok" | "failed"; error?: string; msg: OutgoingEmail }): number {
    ensureTable();
    // payload = 可选字段只收在场键（缺省不落 null 键）→ W2 词根单源脱敏 → JSON 落库。
    // JSON.stringify 抛错（循环引用等调用方滥用）= 记账失败 → send 上抛（诚实语义，见文件头）。
    const raw: Record<string, unknown> = {};
    if (entry.msg.from != null) raw.from = entry.msg.from;
    if (entry.msg.cc != null) raw.cc = entry.msg.cc;
    if (entry.msg.bcc != null) raw.bcc = entry.msg.bcc;
    if (entry.msg.text != null) raw.text = entry.msg.text;
    if (entry.msg.html != null) raw.html = entry.msg.html;
    const payloadSql = JSON.stringify(redactSensitiveInput(raw));
    const r = db
      .prepare(
        `INSERT INTO ${EMAIL_LOG_TABLE} (ts, transport, "to", subject, payload, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(Date.now(), transport.name, entry.msg.to, entry.msg.subject, payloadSql, entry.status, entry.error ?? null);
    lastId = Math.max(lastId, Number(r.lastInsertRowid ?? 0));
    if (lastId > maxRows) {
      db.prepare(`DELETE FROM ${EMAIL_LOG_TABLE} WHERE id <= ?`).run(lastId - maxRows);
    }
    return lastId;
  }

  return {
    async send(msg: OutgoingEmail): Promise<EmailSendResult> {
      // ---- 先 transport：thenable 才 await（mock 同步 send 零间隙）；抛错/拒绝 = 投递失败两态记账 ----
      let error: string | undefined;
      try {
        const r = transport.send(msg);
        if (r != null && typeof (r as Promise<void>).then === "function") await r;
      } catch (e) {
        error = truncateError((e as Error)?.message ?? String(e));
      }
      // ---- 后记账：成功/失败两态都记；记账失败原样上抛（不可记账 ≠ 假账）----
      const id = append({ status: error === undefined ? "ok" : "failed", error, msg });
      return error === undefined ? { id, status: "ok" } : { id, status: "failed", error };
    },
    tail(n: number): EmailLogEntry[] {
      // 纯读不建表：表未建（装配后零投递）= [] ——「装配但零投递」的真实事实，非假数据
      const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(EMAIL_LOG_TABLE);
      if (!has) return [];
      const rows = db
        .prepare(`SELECT id, ts, transport, "to" AS to_addr, subject, payload, status, error FROM ${EMAIL_LOG_TABLE} ORDER BY id DESC LIMIT ?`)
        .all(Math.max(1, Math.trunc(n)))
        .reverse();
      return rows.map(rowToEntry);
    },
  };
}
