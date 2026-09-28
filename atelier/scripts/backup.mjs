#!/usr/bin/env node
/**
 * backup.mjs — `atelier db backup`（差距批 A3，FS-DESIGN §5.7 落地注记 2026-09-28）。
 *
 *   atelier db backup --out <file> [--root <dir>] [--db <file>] [--force] [--no-verify]
 *
 * 实现 = SQLite `VACUUM INTO`：单语句零依赖、node:sqlite/bun:sqlite 两宿主通用、产物天然
 * 压缩整理（页级重写即 VACUUM 语义）；不用宿主专属 backup API（两宿主备份面差异不值得——
 * 「宿主差异锁死 sqlite.ts」的纪律不为此破例）。在线备份：VACUUM INTO 读快照（WAL 下同
 * 一致），不要求停机、不锁写。
 *
 * 库路径解析与 scripts/migrate.mjs 同一口径：--db <file>（相对 root 解析）→ 缺省
 * <root>/.atelier/dev.db（§11.1）；不读 atelier.config.json（库路径从来不是 config 项——
 * dev 面 env 注入与 build 产物 env 同走 ATELIER_DB_PATH，CLI 域显式 --db 优先）。
 *
 * 自证面（与 checkpoint「可验证性叙事」同构）：备份完成即对产物跑 PRAGMA quick_check，
 * stdout 打印一行结构化证据（单行 JSON，agent 直接 JSON.parse 消费；成功路径零 stderr 噪声）：
 *   {"out":…,"bytes":…,"sha256":<前12位>,"quickCheck":"ok","durMs":…,"source":…}
 * --no-verify = 逃生口：跳过 quick_check，证据行**无 quickCheck 字段**（没验证就不冒充验证过）。
 *
 * 显式破坏面（§18 R7 同纪律）：VACUUM INTO 对已存在目标本身报错——无 --force 先行拒绝并给
 * 中文指引；--force 先删旧产物（含 -wal/-shm 伴生）再备份，绝不静默覆盖。--out 与源库同路径
 * 一律拒绝（连 --force 也不放行：同路径「覆盖」= 删源库，该破坏面不可被旗标同意）。
 *
 * 诚实边界：无内建定时备份 job（应用可经 server/jobs.ts recurring job 自行调度 backup——
 * 差距批 A1 落地件）；无云复制（决策 19 边界不变，Litestream 仍是流式容灾的外部路径）；
 * 无增量备份（全量快照语义，每次整库）；单文件库快照——库外状态（如应用自有文件存储）不在
 * 本命令射程。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const [sub, ...rest] = process.argv.slice(2);
const argOf = (k) => {
  const i = rest.indexOf(k);
  return i >= 0 ? rest[i + 1] : undefined;
};

// die 签名全仓大一统（建议书 A5）：die(msg, code = 2)——msg 单串自含 error/usage/fix 全部文案
function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

if (sub !== "backup") {
  die("usage: atelier db backup --root <dir> --out <file> [--db <file>] [--force] [--no-verify]");
}

const root = path.resolve(argOf("--root") ?? process.cwd());
// 库路径解析与 scripts/migrate.mjs 同一行口径（--db 相对 root；缺省 .atelier/dev.db）
const dbFile = path.resolve(root, argOf("--db") ?? path.join(".atelier", "dev.db"));
const outRaw = argOf("--out");
if (outRaw === undefined || outRaw === "") {
  die("error: --out is required（备份产物路径）\nfix: atelier db backup --out backups/dev-<日期>.db [--root <dir>] [--force] [--no-verify]");
}
const outFile = path.resolve(outRaw);
const force = rest.includes("--force");
const verify = !rest.includes("--no-verify");

/** 证据行/错误文案里的路径统一正斜杠（Windows 形态可读、JSON 免转义） */
const norm = (p) => path.resolve(p).replace(/\\/g, "/");
const samePath = (a, b) => {
  const [x, y] = [norm(a), norm(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/* ---------------- 前置守卫（坏输入在动手前即拦：exit 2 = usage / exit 1 = 拒绝） ---------------- */

if (samePath(outFile, dbFile)) {
  die(`error: 备份目标与源库相同（${norm(outFile)}）——同路径覆盖等于删源库，--force 也不放行\nfix: --out 换一个路径，备份产物与源库必须是两个文件`, 1);
}

if (!fs.existsSync(dbFile)) {
  die(`error: 源库不存在：${norm(dbFile)}——备份不静默建库（备份的对象是迁移的产物，空库没有意义）\nfix: 先 migrate up 建库并应用迁移；要备份别的库用 --db <file> 显式指定`, 1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true }); // node:sqlite 不建父目录——装配层负责（migrate up 同款）

if (fs.existsSync(outFile)) {
  if (force !== true) {
    die(`error: 备份目标已存在：${norm(outFile)}（VACUUM INTO 不覆盖既有文件）\nfix: 换一个 --out 路径；确认要覆盖时加 --force（显式破坏动作：旧产物先删后备，绝不静默覆盖）`, 1);
  }
  // --force = 显式同意覆盖：旧产物与其潜在 -wal/-shm 伴生先删后备
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(outFile + suffix, { force: true });
}

/* ---------------- VACUUM INTO：在线单文件快照 ---------------- */

// SQL 字面量：Windows 路径统一正斜杠 + 单引号成对转义（win32 实测形态，win32/posix 两相兼容）
const sqlLiteral = (p) => `'${norm(p).replace(/'/g, "''")}'`;

const t0 = performance.now();
try {
  const { openSqlite } = await import("../server/sqlite.ts"); // TS 库经 Node 类型剥离直 import（migrate.mjs 同先例）
  const db = await openSqlite(dbFile); // busy_timeout 5000ms 随 A2 统一 PRAGMA——在线备份不锁写
  try {
    db.exec(`VACUUM INTO ${sqlLiteral(outFile)}`);
  } finally {
    db.close();
  }
} catch (e) {
  // AtrEndpointError 携带四段式 atr（code/message/fix）——结构化优先于堆栈（决策 9，migrate.mjs 同款）
  const atr = e?.atr;
  if (atr) {
    console.error(`[atelier db backup] ${atr.code}: ${atr.message}`);
    console.error(`fix: ${atr.fix}`);
    process.exit(1);
  }
  die(`[atelier db backup] 备份失败：${e?.message ?? String(e)}\nfix: 检查源库可开（未被独占锁死）与 --out 目录可写；失败可能残留半个产物文件，排除后重跑（同路径需 --force）`, 1);
}

/* ---------------- 自证：quick_check + sha256（agent 可直接消费的证据行） ---------------- */

let quickCheck;
if (verify) {
  try {
    const { openSqlite } = await import("../server/sqlite.ts");
    const copy = await openSqlite(outFile);
    try {
      quickCheck = String(copy.prepare("PRAGMA quick_check").get()?.quick_check ?? "");
    } finally {
      copy.close();
    }
  } catch (e) {
    die(`[atelier db backup] 产物校验失败（${norm(outFile)} 不可开）：${e?.message ?? String(e)}\nfix: 磁盘空间/杀软扫描占用是常见因——排除后同路径重跑需 --force`, 1);
  }
  if (quickCheck !== "ok") {
    die(`[atelier db backup] 产物 quick_check 未通过：${quickCheck || "(空)"}\nfix: 产物留在 ${norm(outFile)} 供取证——先对源库跑 PRAGMA integrity_check 排除源损坏，再加 --force 重跑`, 1);
  }
}

// 流式哈希（不整读进内存——库大时同口径）；证据行只报前 12 位（定位用，完整性自证用全量重算）
async function sha256Of(file) {
  const h = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

const bytes = fs.statSync(outFile).size;
const sha256 = (await sha256Of(outFile)).slice(0, 12);
const durMs = Math.round(performance.now() - t0);

// 结构化证据行（单行 JSON；--no-verify 时无 quickCheck 字段）
console.log(JSON.stringify({ out: norm(outFile), bytes, sha256, ...(verify ? { quickCheck } : {}), durMs, source: norm(dbFile) }));
