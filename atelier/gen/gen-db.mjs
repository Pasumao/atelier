#!/usr/bin/env node
/**
 * gen-db.mjs — `atelier gen db`（FS-DESIGN §5.2，FS-5 组成，FS-M2(m2b)）。
 *
 * 读 <root>/src/server/db/schema.ts，生成三类产物（§5.2 表）：
 *   a. src/generated/db/tables.ts        每表行类型 + 表元数据规范命名导出（显式 import schema.ts）
 *   b. src/generated/db/crud.ts          每表 4 个薄函数 GetByPk/Insert/Update/Delete + 分页二原语
 *                                        ListPaged/Count（B7，无 opt-in 全 PK 表无条件生成）+ 全文搜索
 *                                        二原语 FtsSearch/FtsCount（B6，仅 opts.fts 表生成；SQL 内联可读、全参数化）
 *   c. src/server/db/migrations/NNN_<table>.{up,down}.sql  建表/删表迁移骨架（**追加式**：
 *      只为尚无迁移的表生成，编号 = 现有最大 NNN+1 递增；已存在迁移文件永不重写，§5.4）
 *   d. src/server/db/seeds/001_example.seed.sql  种子目录 + 示例骨架（D-F17，FS-M2(m2d) 加法；
 *      只在文件缺失时落一次盘，已存在永不重写——与迁移同款追加式纪律）
 *
 * 为什么是纯文本扫描器（dump.mjs 先例）：schema.ts 遵守扁平字面量纪律（§2.1——列定义是
 * 普通对象字面量，无方法链/无计算值/无展开），这使得"找 `export const X = table(` 调用 +
 * 状态感知括号匹配 + 字面量解析"完全可靠；禁用 TS 解析器（依赖重）与 eval（注入面）。
 * 遇到任何无法静态解析的形状 → 硬错（GenDbError），绝不静默降级——解析器能力边界即纪律边界。
 * 解析出的定义回灌 `server/db.ts` 的 table() 复验 + DDL 用其 createTableSql/dropTableSql 渲染
 * （同一真相源：契约校验与迁移 DDL 不出现第二套实现；Node ≥22.18 类型剥离直 import .ts，同 dump.mjs）。
 *
 * 用法：
 *   node atelier/gen/gen-db.mjs --root <appDir>
 *     --root  应用目录（缺省 cwd）；输出诚实清单（写了哪些文件）
 * 纯 API：import { genDb, parseSchema, GenDbError } from "<repo>/atelier/gen/gen-db.mjs"
 *
 * 命名校验（P1-8，ATR-343）：表名入口校验（字母开头的 [A-Za-z0-9_]）+ toPascal/toCamel 派生
 * 标识符合法性兜底——坏名字（如 `_1`）此前一路产出 `export type 1Row` 编译不过的非法 TS，
 * 现生成器侧四段式 die（message + fix），破产物绝不落盘。R1-C（P1-13）补保留字闸：表名
 * delete/void/class 等经 toCamel 派生出保留字（词表与 gen-endpoint ATR-342 单源共享）——
 * 表名会以裸标识符进 SQLite DDL/CRUD SQL（CREATE TABLE delete = 保留字语法错误），同码 die。
 *
 * 红线（决策 19）：产物 SQL 全参数化、零值拼接——值一律 ? 绑定；UPDATE 的 SET 列名来自
 * 生成时允许清单（contract 定义，非运行时输入）。产物不做查询构造器/关系 API/懒加载（§5.2 克制声明）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createTableSql, dropTableSql, table as defineTable } from "../server/db.ts";
// R1-C（P1-13）：保留字词表与 gen-endpoint ATR-342 派生闸单源共享（gen-db 不在 vendor 闭包
// 名单内，框架侧 import 同仓 .mjs 零成本）——绝不两份手抄漂移。
import { RESERVED_WORDS } from "./gen-endpoint.mjs";

const COLUMN_TYPES = new Set(["integer", "text", "real", "blob"]);
// P1-8（ATR-343）：字母开头——下划线/数字开头的表名（`_1` 通过旧宽松 IDENT_RE）经 toPascal
// 派生出 `1` → `export type 1Row` 编译不过的非法 TS；生成器侧入口即拒（运行时 db.ts 的
// table() 校验口径不在本文件收口内，那里不渲染 TS 标识符）。
const IDENT_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export class GenDbError extends Error {
  constructor(message, fix, code) {
    super(message);
    this.name = "GenDbError";
    this.fix = fix;
    if (code) this.code = code;
  }
}

function die(message, fix, code) {
  throw new GenDbError(message, fix, code);
}

/* ---------- 状态感知扫描基元（注释/字符串不参与结构；与 dump.mjs 同方法论） ---------- */

/** 把源码中的注释与字符串内容替换为空白（保长度、保换行）——结构正则只在 code 面跑 */
export function maskLiterals(src) {
  let out = "";
  let i = 0;
  let state = "code"; // code | line | block | str
  let q = "";
  while (i < src.length) {
    const c = src[i];
    const d = i + 1 < src.length ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { state = "str"; q = c; out += " "; i++; continue; }
      out += c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; } else out += " ";
      i++; continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    // str：转义吞两字符；其余字符串内容一律空白化
    if (c === "\\") { out += "  "; i += 2; continue; }
    if (c === q) { state = "code"; out += " "; i++; continue; }
    out += c === "\n" ? "\n" : " "; i++; continue;
  }
  return out;
}

/** 从 openIdx 的 "(" 起做括号匹配（状态感知），返回闭括号下标；不闭合 = 硬错 */
export function matchParen(src, openIdx) {
  let depth = 0;
  let state = "code";
  let q = "";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    const d = i + 1 < src.length ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; i++; continue; }
      if (c === "/" && d === "*") { state = "block"; i++; continue; }
      if (c === '"' || c === "'" || c === "`") { state = "str"; q = c; continue; }
      if (c === "(") depth++;
      if (c === ")") { depth--; if (depth === 0) return i; }
      continue;
    }
    if (state === "line") { if (c === "\n") state = "code"; continue; }
    if (state === "block") { if (c === "*" && d === "/") { state = "code"; i++; } continue; }
    if (c === "\\") { i++; continue; }
    if (c === q) state = "code";
  }
  throw new GenDbError("括号不闭合：table(...) 调用未找到闭括号", "检查 schema.ts 语法（括号必须配对；扁平字面量纪律，§2.1）");
}

/** 顶层分隔符切分（状态感知：括号/字符串内的分隔符不算） */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let state = "code";
  let q = "";
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === "code") {
      if (c === '"' || c === "'" || c === "`") { state = "str"; q = c; cur += c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      if (c === ")" || c === "]" || c === "}") depth--;
      if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += c;
      continue;
    }
    cur += c;
    if (state === "str") {
      if (c === "\\") { cur += text[i + 1] ?? ""; i++; continue; }
      if (c === q) state = "code";
    }
  }
  parts.push(cur);
  return parts;
}

/** 字符串字面量体内文 → 实际值（decodeEscapesCore 同款内联——gen-endpoint.mjs 单源注释；
 *  行为由 tests/gen-literal-parity.test.ts 跨面对拍钉住） */
function decodeEscapesCore(inner) {
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const d = inner[i + 1];
    if (d === undefined) return { ok: false, error: "转义序列悬空（字面量以反斜杠结尾）" };
    if (d === "n") { out += "\n"; i++; continue; }
    if (d === "t") { out += "\t"; i++; continue; }
    if (d === "r") { out += "\r"; i++; continue; }
    if (d === "b") { out += "\b"; i++; continue; }
    if (d === "f") { out += "\f"; i++; continue; }
    if (d === '"' || d === "'" || d === "\\" || d === "/" || d === "`") { out += d; i++; continue; }
    if (d === "u") {
      const hex = inner.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        return { ok: false, error: "转义 \\u 需要 4 位十六进制（实际「" + inner.slice(i, i + 6) + "」）" };
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    return { ok: false, error: "转义序列超出扁平字面量纪律（只认 JSON 转义集 \\n \\t \\r \\b \\f 引号 反斜杠 斜杠 \\uXXXX；\\x/八进制等越界）" };
  }
  return { ok: true, value: out };
}

/** 字符串字面量解析（禁插值/拼接——内容含未转义同种引号或 ${ 即硬错）。
 *  转义解码 = JSON.parse 语义（R1-C §4.7：此前仅映射 \n/\t，\u4e2d 解成 "u4e2d"） */
function parseStringLiteral(text, what) {
  const t = text.trim();
  const q = t[0];
  if ((q === '"' || q === "'" || q === "`") && t.length >= 2 && t[t.length - 1] === q) {
    const inner = t.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "\\") { i++; continue; }
      if (inner[i] === q) {
        die(`${what}：字符串字面量含未转义的 ${q}（拼接/多段字面量超出扁平字面量纪律，§2.1）`, "写成单个普通字符串字面量");
      }
    }
    if (q === "`" && inner.includes("${")) {
      die(`${what}：模板字符串插值超出扁平字面量纪律（§2.1）`, "写成普通字符串字面量");
    }
    const dec = decodeEscapesCore(inner);
    if (!dec.ok) {
      die(`${what}：${dec.error}`, "字面量转义只认 JSON 转义集（\\n \\t \\r \\b \\f 引号 反斜杠 斜杠 \\uXXXX）——越界转义超出扁平字面量纪律（§2.1）");
    }
    return dec.value;
  }
  die(`${what}：期望字符串字面量，实际「${t.slice(0, 60)}」`, "列定义必须是普通对象字面量（扁平纪律，§2.1）——禁计算值/展开/函数调用");
}

/** 任意字面量解析：string | number | boolean | null | 数组 | 对象（递归）；其余形状硬错 */
function parseLiteral(text, what) {
  const t = text.trim();
  if (t === "") die(`${what}：空的字面量`, "补齐列定义（扁平纪律，§2.1）");
  const q = t[0];
  if (q === '"' || q === "'" || q === "`") return parseStringLiteral(t, what);
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) die(`${what}：数组字面量未闭合`, "检查 schema.ts 语法");
    return splitTopLevel(t.slice(1, -1))
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => parseLiteral(s, what));
  }
  if (t.startsWith("{")) return parseObjectLiteral(t, what);
  die(
    `${what}：无法静态解析的字面量「${t.slice(0, 60)}」`,
    "扁平字面量纪律（§2.1）：列定义只能是普通对象字面量与直接字面量——禁计算值/展开/函数调用/标识符引用"
  );
}

/** 对象字面量 → { key: 原始文本片段 }（顶层键必须是标识符；值文本留给上层按需解析） */
function parseObjectEntries(text, what) {
  const t = text.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) {
    die(`${what}：期望对象字面量，实际「${t.slice(0, 60)}」`, "列定义必须是普通对象字面量（扁平纪律，§2.1）");
  }
  const entries = [];
  for (const part of splitTopLevel(t.slice(1, -1))) {
    if (part.trim() === "") continue;
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(part);
    if (!m) {
      die(`${what}：无法解析的对象条目「${part.trim().slice(0, 60)}」（键必须是标识符）`, "扁平字面量纪律（§2.1）：键 = 标识符，值 = 直接字面量");
    }
    entries.push({ key: m[1], valueText: m[2] });
  }
  return entries;
}

function parseObjectLiteral(text, what) {
  const obj = {};
  for (const { key, valueText } of parseObjectEntries(text, what)) {
    obj[key] = parseLiteral(valueText, `${what}.${key}`);
  }
  return obj;
}

/* ---------- schema.ts 解析：export const X = table("name", {列}, {opts?}) ---------- */

const TABLE_CALL_RE = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*table\s*\(/g;

/**
 * 解析 schema.ts 源文本 → 表定义数组（源码声明序）。
 * 只认 `export const X = table(...)` 形态（schema 单源文件纪律：每表一个具名导出）。
 * 解析结果回灌 server/db.ts 的 table() 复验（契约校验单一真相源），并带出 rowSchema。
 */
export function parseSchema(src, sourceName = "schema.ts") {
  const masked = maskLiterals(src);
  const tables = [];
  TABLE_CALL_RE.lastIndex = 0;
  for (let m; (m = TABLE_CALL_RE.exec(masked));) {
    const constName = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(src, openIdx);
    const args = splitTopLevel(src.slice(openIdx + 1, closeIdx)).map((s) => s.trim()).filter((s) => s.length > 0);
    if (args.length < 2 || args.length > 3) {
      die(`表 ${constName}：table() 需要 (名称, 列定义[, 选项]) 二到三个参数`, "对齐 FS-DESIGN §5.1 形态");
    }
    const name = parseStringLiteral(args[0], `表 ${constName} 的名称`);
    if (!IDENT_RE.test(name)) {
      die(`表名非法：${name}（只允许字母开头的 [A-Za-z0-9_]——下划线/数字开头派生不出合法 TS 类型名，如 toPascal("_1") = "1" → export type 1Row）`, "改成字母开头的表名，如 chats、notes（表名进 DDL 标识符白名单——决策 19 参数化红线的前提）", "ATR-343");
    }
    const columns = {};
    for (const { key, valueText } of parseObjectEntries(args[1], `表 ${name} 的列定义`)) {
      const col = parseObjectLiteral(valueText, `表 ${name} 列 ${key}`);
      if (!COLUMN_TYPES.has(col.type)) {
        die(`表 ${name} 列 ${key}：type 非法「${String(col.type)}」（全集 integer/text/real/blob）`, "对齐 §5.1 列类型全集");
      }
      if (col.default !== undefined && typeof col.default !== "string" && typeof col.default !== "number" && col.default !== null) {
        die(`表 ${name} 列 ${key}：default 只允许 string/number/null`, "对齐 ColumnDef 形状（server/db.ts）");
      }
      if (col.references != null && !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(col.references)) {
        die(`表 ${name} 列 ${key}：references 非法「${col.references}」（格式 "<table>.<column>"）`, "对齐 §5.1 关系声明形态");
      }
      if (col.enum != null && (!Array.isArray(col.enum) || col.enum.length === 0)) {
        die(`表 ${name} 列 ${key}：enum 必须是非空数组`, "对齐契约 enum 形态");
      }
      columns[key] = col;
    }
    let indexes;
    let fts;
    if (args.length === 3) {
      const opts = parseObjectLiteral(args[2], `表 ${name} 的选项`);
      indexes = Array.isArray(opts.indexes) ? opts.indexes : [];
      for (const idx of indexes) {
        if (typeof idx.name !== "string" || !Array.isArray(idx.columns) || idx.columns.length === 0) {
          die(`表 ${name} 的索引定义不完整（需要 name + 非空 columns）`, "对齐 §5.1 indexes 形态");
        }
      }
      // fts（B6）：parseLiteral 已解析为纯值对象，形状/列存在性/text 类型/单列 integer 主键
      // 全部交由下方 defineTable 回灌复验（契约校验单一真相源，不在解析器里另立一套口径）
      fts = opts.fts;
    }
    // 回灌 table() 复验：未知键/enum 同质/索引列存在性/主键缺失/fts 形状等全按 db.ts 口径硬错
    const def = defineTable(name, columns, {
      ...(indexes != null ? { indexes } : {}),
      ...(fts != null ? { fts } : {}),
    });
    if (def.primaryKey.length === 0) {
      die(`表 ${name} 无主键`, "生成 CRUD 需要主键；确无主键的表请走手写 SQL 通道（ctx.db.prepare 直用，§5.3）");
    }
    tables.push({ constName, def });
  }
  if (tables.length === 0) {
    die(`${sourceName} 中没有找到任何 table() 定义`, "在 src/server/db/schema.ts 里按 §5.1 形态写表定义（export const x = table(...)）");
  }
  return tables;
}

/* ---------- 命名与路径 ---------- */

function toPascal(name) {
  const p = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(p)) {
    // P1-8 派生标识符兜底（入口校验后的第二道闸）：派生不出合法 TS 类型名 → ATR-343，绝不产出编译不过的产物
    die(`表 ${name} 派生不出合法 TS 类型名（toPascal → 「${p}」）`, "改表名为字母开头（如 chats → ChatsRow）——派生标识符合法性是产物可编译的前提", "ATR-343");
  }
  return p;
}

function toCamel(name) {
  const p = toPascal(name);
  const c = p[0].toLowerCase() + p.slice(1);
  // R1-C（P1-13）：保留字闸（词表 = gen-endpoint ATR-342 同一单源）。表名 delete/void/class 等
  // 通过 IDENT_RE 与 toPascal 检查后，toCamel 派生出保留字——生成的迁移 DDL 与 CRUD SQL 会把
  // 表名以裸标识符写进 SQLite（CREATE TABLE delete = 保留字语法错误，node:sqlite 实证；SQLite
  // 关键字大小写不敏感，"Delete" 同闸），产物整体不可用。生成器侧 ATR-343 die（绝不落盘）。
  if (RESERVED_WORDS.has(c)) {
    die(
      `表 ${name} 撞 JS 保留字（toCamel → 「${c}」）——表名会以裸标识符进 SQLite DDL/CRUD SQL（CREATE TABLE ${name} 是保留字语法错误），产物不可用`,
      `改表名避开保留字（如 delete → deleted_items）——词表与 gen-endpoint 端点派生闸（ATR-342）同一单源`,
      "ATR-343"
    );
  }
  return c;
}

/** TS import 相对路径（posix 分隔；不以 . 开头补 ./） */
function relImport(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function relDisplay(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/** 列 → TS 类型（enum 透传为字面量联合） */
function tsType(col) {
  if (col.enum) return col.enum.map((v) => (typeof v === "string" ? JSON.stringify(v) : String(v))).join(" | ");
  return col.type === "integer" || col.type === "real" ? "number" : "string";
}

function rowRequired(col) {
  return col.notNull === true || col.primaryKey === true;
}

/* ---------- 产物渲染（纯函数：同输入 → 字节全同，regen 幂等的保证） ---------- */

function renderTables(tables, schemaFile, vendorDbFile, outFile) {
  const relSchema = relImport(outFile, schemaFile);
  const relVendorDb = relImport(outFile, vendorDbFile);
  const lines = [];
  lines.push("// @atelier-generated (gen db) — 表元数据与行类型。改 src/server/db/schema.ts 后 regen（迁移为追加式，永不重写）。");
  lines.push("// 显式 import 闭合（决策 23）：元数据单源在 schema.ts 的 table() 定义，此处仅按 TableDef 收口类型并规范命名。");
  lines.push(`import { ${tables.map((t) => t.constName).join(", ")} } from "${relSchema}";`);
  lines.push(`import type { TableDef } from "${relVendorDb}";`);
  lines.push("");
  for (const { def, constName } of tables) {
    lines.push(`export const ${def.name}Table: TableDef = ${constName};`);
    lines.push(`export type ${toPascal(def.name)}Row = {`);
    for (const [k, col] of Object.entries(def.columns)) {
      lines.push(`  ${k}: ${tsType(col)}${rowRequired(col) ? "" : " | null"};`);
    }
    lines.push("};");
    // Insert 输入类型与 Row 同源（tables.ts 单源）：全列显式（INTEGER 单主键可省——rowid 自增；
    // 默认值不在此消解，调用方显式传值）
    const pkAuto = def.primaryKey.length === 1 && def.columns[def.primaryKey[0]].type === "integer";
    lines.push(`export type ${toPascal(def.name)}Insert = {`);
    for (const [k, col] of Object.entries(def.columns)) {
      const optional = col.primaryKey === true && pkAuto;
      lines.push(`  ${k}${optional ? "?" : ""}: ${tsType(col)}${optional || rowRequired(col) ? "" : " | null"};`);
    }
    lines.push("};");
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

function renderCrud(tables, vendorSqliteFile, outFile) {
  const relVendor = relImport(outFile, vendorSqliteFile);
  const lines = [];
  lines.push("// @atelier-generated (gen db) — 极薄参数化 CRUD + 分页二原语 + 全文搜索二原语（§5.2：四原语 + ListPaged/Count（B7，全 PK 表）+ FtsSearch/FtsCount（B6，仅 fts 表）量级，SQL 字面量内联可读）。");
  lines.push("// 红线（决策 19）：全参数化、零值拼接——值一律 ? 绑定；UPDATE 的 SET 列名来自下方生成时允许清单");
  lines.push("// （contract 定义，非运行时输入）。手写 SQL（join/聚合）一等公民：ctx.db.prepare 直用（§5.3）。");
  lines.push(`import type { SqliteDb, SqliteRunResult } from "${relVendor}";`);
  const tableTypes = tables.flatMap(({ def }) => [`${toPascal(def.name)}Insert`, `${toPascal(def.name)}Row`]);
  lines.push(`import type { ${tableTypes.join(", ")} } from "./tables.ts";`);
  lines.push("");
  for (const { def } of tables) {
    const t = def;
    const fn = toCamel(t.name);
    const Pascal = toPascal(t.name);
    const cols = Object.keys(t.columns);
    const selCols = cols.join(", ");
    const pkCols = t.primaryKey;
    const pkAuto = pkCols.length === 1 && t.columns[pkCols[0]].type === "integer";
    const where = pkCols.map((k) => `${k} = ?`).join(" AND ");
    const pkArgs = pkCols.map((k) => `pk.${k}`).join(", ");
    const pkParam = `{ ${pkCols.map((k) => `${k}: ${tsType(t.columns[k])}`).join("; ")} }`;
    const patchType = `Partial<Omit<${Pascal}Insert, ${pkCols.map((k) => JSON.stringify(k)).join(" | ")}>>`;

    lines.push(`// —— ${t.name} ——`);
    lines.push("");
    // Insert 输入：全列显式（INTEGER 单主键可省——rowid 自增；默认值不在此消解，调用方显式传值）
    lines.push(`export function ${fn}GetByPk(db: Pick<SqliteDb, "prepare">, pk: ${pkParam}): ${Pascal}Row | undefined {`);
    lines.push(`  return db.prepare("SELECT ${selCols} FROM ${t.name} WHERE ${where}").get(${pkArgs}) as ${Pascal}Row | undefined;`);
    lines.push("}");
    lines.push("");
    const runArgs = cols.map((k) => (pkAuto && k === pkCols[0] ? `values.${k} ?? null` : `values.${k}`)).join(", ");
    lines.push(`export function ${fn}Insert(db: Pick<SqliteDb, "prepare">, values: ${Pascal}Insert): SqliteRunResult {`);
    lines.push(`  return db.prepare("INSERT INTO ${t.name} (${selCols}) VALUES (${cols.map(() => "?").join(", ")})").run(${runArgs});`);
    lines.push("}");
    lines.push("");
    const updatable = cols.filter((k) => !pkCols.includes(k));
    lines.push(`const ${fn}UpdateColumns: Record<string, true> = { ${updatable.map((k) => `${k}: true`).join(", ")} };`);
    lines.push("");
    lines.push("/**");
    lines.push(` * 更新按主键 + 显式列集（partial 输入）：SET 列名过滤自 ${fn}UpdateColumns 允许清单——`);
    lines.push(" * 拼进 SQL 的只是 contract 定义的列名（非运行时输入），值全参数化，零值拼接（决策 19 红线）。");
    lines.push(" * 空补丁 = no-op（不生成裸 UPDATE）。");
    lines.push(" */");
    lines.push(`export function ${fn}Update(db: Pick<SqliteDb, "prepare">, pk: ${pkParam}, patch: ${patchType}): SqliteRunResult {`);
    lines.push(`  const keys = Object.keys(patch).filter((k) => ${fn}UpdateColumns[k]);`);
    lines.push("  if (keys.length === 0) return { changes: 0, lastInsertRowid: 0 };");
    lines.push(`  return db.prepare(\`UPDATE ${t.name} SET \${keys.map((k) => \`\${k} = ?\`).join(", ")} WHERE ${where}\`).run(`);
    lines.push(`    ...keys.map((k) => (patch as Record<string, unknown>)[k])${pkArgs ? ", " + pkArgs : ""},`);
    lines.push("  );");
    lines.push("}");
    lines.push("");
    lines.push(`export function ${fn}Delete(db: Pick<SqliteDb, "prepare">, pk: ${pkParam}): SqliteRunResult {`);
    lines.push(`  return db.prepare("DELETE FROM ${t.name} WHERE ${where}").run(${pkArgs});`);
    lines.push("}");
    lines.push("");
    // 分页二原语（B7，与 CRUD 同条件生成）：LIMIT/OFFSET v1（keyset 留门）；ORDER BY 主键升序
    // （复合主键全列）保证分页窗口决定论稳定；负 limit 在 SQLite 语义=无界查询，生成代码内
    // 一行显式守卫硬错不静默（决策 19 参数化红线不因分页破例——LIMIT/OFFSET 值仍全 ? 绑定）。
    lines.push("/**");
    lines.push(` * 分页列表（B7）：ORDER BY 主键升序${pkCols.length > 1 ? "（复合主键全列）" : ""}——同 limit/offset 恒同窗口，无重复/漏行；`);
    lines.push(" * limit/offset 必须为非负整数（负 limit 在 SQLite 语义下是无界查询，显式硬错不静默）。");
    lines.push(" */");
    lines.push(`export function ${fn}ListPaged(db: Pick<SqliteDb, "prepare">, opts: { limit: number; offset?: number }): ${Pascal}Row[] {`);
    lines.push(`  if (!Number.isInteger(opts.limit) || opts.limit < 0 || !Number.isInteger(opts.offset ?? 0) || (opts.offset ?? 0) < 0) throw new Error("${fn}ListPaged：limit/offset 必须是非负整数（正确用法：${fn}ListPaged(db, { limit: 20, offset: 0 })，offset 缺省 0）——负 limit 在 SQLite 中是无界查询，拒绝静默");`);
    lines.push(`  return db.prepare("SELECT ${selCols} FROM ${t.name} ORDER BY ${pkCols.join(", ")} LIMIT ? OFFSET ?").all(opts.limit, opts.offset ?? 0) as ${Pascal}Row[];`);
    lines.push("}");
    lines.push("");
    lines.push(`export function ${fn}Count(db: Pick<SqliteDb, "prepare">): number {`);
    lines.push(`  return (db.prepare("SELECT COUNT(*) AS n FROM ${t.name}").get() as { n: number }).n;`);
    lines.push("}");
    lines.push("");
    // 全文搜索二原语（B6，仅 opts.fts 表生成）：external-content 虚表 <t>_fts 由触发器同步
    // （DDL 单源在 server/db.ts createTableSql/dropTableSql），这里只投影查询面。
    if (t.fts) {
      const ft = `${t.name}_fts`;
      const pkCol = pkCols[0];
      // 列名必须表名限定：external-content 虚表暴露同名列，裸列名在 JOIN 里 ambiguous
      // （真 node:sqlite 对拍抓出后修正）；仍保持显式列清单风格（对齐四原语）。
      const selQualified = cols.map((k) => `${t.name}.${k}`).join(", ");
      const baseSql = `SELECT ${selQualified} FROM ${t.name} JOIN ${ft} ON ${t.name}.${pkCol} = ${ft}.rowid WHERE ${ft} MATCH ? ORDER BY bm25(${ft})`;
      lines.push("/**");
      lines.push(` * 全文搜索（B6）：主表 JOIN ${ft}（rowid 直连），bm25 相关度升序（更负 = 更相关）。`);
      lines.push(" * query 是 FTS5 MATCH 语法：应用侧负责转义与前缀 * 拼接；query 全程 ? 绑定零拼接（决策 19），");
      lines.push(" * MATCH 语法错误诚实冒泡为 SQLite 异常。默认 unicode61 分词器：按空格/标点切词，连续中文串 =");
      lines.push(" * 整串单 token（不按字切）——整串/前缀 * 查询可命中、中段子串不命中；需真分词请应用侧预处理");
      lines.push(" * 或手改迁移加 tokenize 选项（诚实边界见 FS-DESIGN §5.2）。limit/offset 守卫与 ListPaged（B7）");
      lines.push(" * 同款：非负整数硬错；不传 = 全量命中（分页显式传）。");
      lines.push(" */");
      lines.push(`const ${fn}FtsSql = "${baseSql}";`);
      lines.push(`export function ${fn}FtsSearch(db: Pick<SqliteDb, "prepare">, query: string, opts: { limit?: number; offset?: number } = {}): ${Pascal}Row[] {`);
      lines.push(`  if ((opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 0)) || (opts.offset !== undefined && (!Number.isInteger(opts.offset) || opts.offset < 0))) throw new Error("${fn}FtsSearch：limit/offset 必须是非负整数（与 ListPaged 同款守卫，B7）；不传 = 全量命中，分页显式传");`);
      lines.push(`  if (opts.limit === undefined && opts.offset !== undefined) throw new Error("${fn}FtsSearch：offset 必须与 limit 同传（无 limit 的 offset 无分页窗口，拒绝静默忽略）");`);
      lines.push("  if (opts.limit === undefined) {");
      lines.push(`    return db.prepare(${fn}FtsSql).all(query) as ${Pascal}Row[];`);
      lines.push("  }");
      lines.push(`  return db.prepare(\`\${${fn}FtsSql} LIMIT ? OFFSET ?\`).all(query, opts.limit, opts.offset ?? 0) as ${Pascal}Row[];`);
      lines.push("}");
      lines.push("");
      lines.push(`export function ${fn}FtsCount(db: Pick<SqliteDb, "prepare">, query: string): number {`);
      lines.push(`  return (db.prepare("SELECT COUNT(*) AS n FROM ${ft} WHERE ${ft} MATCH ?").get(query) as { n: number }).n;`);
      lines.push("}");
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

function renderMigrationUp(def) {
  return [
    `-- migration gen db 骨架（up）：可手改；改后 checksum 即固定（改已应用文件 = ATR-332，§5.4）。`,
    `-- 事务由迁移器逐条包裹：本文件不得自带 BEGIN/COMMIT。`,
    createTableSql(def),
    "",
  ].join("\n");
}

function renderMigrationDown(def) {
  return [
    `-- migration gen db 骨架（down）：可手改。`,
    `-- 级联不隐式（§5.1）：如启用 PRAGMA foreign_keys 且有子表引用，需先删子表或在此显式写级联——`,
    `-- 不可逆：DROP TABLE 会丢弃该表全部数据；确认安全后以 migrate down --force 执行（§18 R7；删本行标记 = 显式声明非破坏）。`,
    dropTableSql(def),
    "",
  ].join("\n");
}

/** 种子示例骨架（D-F17，FS-M2(m2d) 加法）：纯注释占位——取消注释并替换成应用自己的幂等语句 */
function renderSampleSeed() {
  return [
    `-- seed 示例（gen db 骨架，D-F17）：执行 migrate seed 前改成你的种子数据。`,
    `-- 每条语句必须幂等（UPSERT 语义，重复执行安全）：INSERT OR REPLACE INTO ... 或 INSERT ... ON CONFLICT(<键>) DO UPDATE ...`,
    `-- 状态记于 atelier_seeds（name/checksum/applied_at）：已应用且文件被改 = ATR-335 拒绝；`,
    `-- 裸 INSERT 且全文无 ON CONFLICT = ATR-336 拒绝（应用前静态拦截）。已应用种子永不重写（同迁移追加式纪律）。`,
    `-- 幂等语句模板（取消注释并替换表/列/值）：`,
    `-- INSERT OR REPLACE INTO chats (id, name) VALUES (1, '示例行（替换成你的种子数据）');`,
    ``,
  ].join("\n");
}

/** 新表拓扑排序（新表间 references 依赖先行；已出迁移的表视为已存在；环 = 硬错）。稳定：依赖外保声明序 */
export function topoSortNewTables(defs) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const state = new Map(); // name -> "visiting" | "done"
  const out = [];
  const visit = (d, path_) => {
    const s = state.get(d.name);
    if (s === "done") return;
    if (s === "visiting") {
      die(`表 references 形成环：${[...path_, d.name].join(" → ")}`, "拆解循环引用（迁移骨架无法排序）");
    }
    state.set(d.name, "visiting");
    for (const col of Object.values(d.columns)) {
      if (col.references == null) continue;
      const dep = byName.get(col.references.split(".")[0]);
      if (dep) visit(dep, [...path_, d.name]); // 仅新表间排序；已出迁移的表按已存在处理
    }
    state.set(d.name, "done");
    out.push(d);
  };
  for (const d of defs) visit(d, []);
  return out;
}

/* ---------- 主入口 ---------- */

/**
 * 纯 API：给定应用根目录，产出 tables.ts / crud.ts / 迁移骨架（追加式）。
 * regen 幂等：a/b 全量重写（同 schema 输入 → 字节全同）；c 只追加新编号，已存在文件永不重写。
 * 返回诚实清单 { written: string[], migrationsAppended: string[] }（相对 root 的 posix 路径，
 * 仅本次实际写入的文件）。
 */
export function genDb(root) {
  const schemaFile = path.join(root, "src", "server", "db", "schema.ts");
  if (!fs.existsSync(schemaFile)) {
    die(`找不到 ${relDisplay(root, schemaFile)}`, "先建 src/server/db/schema.ts（形态见 FS-DESIGN §5.1）——gen db 以它为契约单源");
  }
  const src = fs.readFileSync(schemaFile, "utf8");
  const tables = parseSchema(src, relDisplay(root, schemaFile));

  // 生成函数名冲突检查（camel 化可能撞名，如 chat_messages 与 chatMessages）
  const seenFn = new Map();
  for (const t of tables) {
    const fn = toCamel(t.def.name);
    if (seenFn.has(fn)) {
      die(`表 ${seenFn.get(fn)} 与 ${t.def.name} 的 CRUD 函数名冲突（${fn}GetByPk 等）`, "改其中一个表名");
    }
    seenFn.set(fn, t.def.name);
  }

  const genDir = path.join(root, "src", "generated", "db");
  const migDir = path.join(root, "src", "server", "db", "migrations");
  const vendorSqlite = path.join(root, "src", "vendor", "atelier", "server", "sqlite.ts");
  const vendorDb = path.join(root, "src", "vendor", "atelier", "server", "db.ts");
  const tablesFile = path.join(genDir, "tables.ts");
  const crudFile = path.join(genDir, "crud.ts");
  fs.mkdirSync(genDir, { recursive: true });
  fs.mkdirSync(migDir, { recursive: true });

  const written = [];
  const put = (file, content) => {
    fs.writeFileSync(file, content);
    written.push(relDisplay(root, file));
  };

  put(tablesFile, renderTables(tables, schemaFile, vendorDb, tablesFile));
  put(crudFile, renderCrud(tables, vendorSqlite, crudFile));

  // 迁移骨架：只对尚无迁移（无 NNN_<table>.up.sql）的表生成；编号 = 现有最大 NNN+1 递增
  const existing = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
  const nums = existing.map((f) => /^(\d+)_/.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  const maxN = nums.length > 0 ? Math.max(...nums) : 0;
  const width = Math.max(3, String(maxN).length);
  const covered = (tName) => existing.some((f) => new RegExp(`^\\d+_${tName}\\.up\\.sql$`).test(f));
  const pending = topoSortNewTables(tables.map((t) => t.def)).filter((t) => !covered(t.name));
  let n = maxN;
  const migrationsAppended = [];
  for (const def of pending) {
    n += 1;
    const num = String(n).padStart(width, "0");
    const up = path.join(migDir, `${num}_${def.name}.up.sql`);
    const down = path.join(migDir, `${num}_${def.name}.down.sql`);
    // 双保险：迁移文件永不重写（§5.4 追加式）——编号推进已保证，仍以防外部并发/手误
    if (fs.existsSync(up) || fs.existsSync(down)) {
      die(`迁移 ${num}_${def.name} 已存在，拒绝重写`, "已生成/已应用的迁移永不重写（§5.4）；如需变更请手写新编号迁移");
    }
    put(up, renderMigrationUp(def));
    put(down, renderMigrationDown(def));
    migrationsAppended.push(def.name);
  }

  // 种子骨架（D-F17，追加式）：目录 + 示例文件只落一次盘，已存在永不重写（regen 幂等）
  const seedsDir = path.join(root, "src", "server", "db", "seeds");
  const sampleSeed = path.join(seedsDir, "001_example.seed.sql");
  if (!fs.existsSync(sampleSeed)) {
    fs.mkdirSync(seedsDir, { recursive: true });
    fs.writeFileSync(sampleSeed, renderSampleSeed());
    written.push(relDisplay(root, sampleSeed));
  }
  return { written, migrationsAppended };
}

/* ---------- CLI（独立运行时；纯 API 消费方不走此段） ---------- */

const INVOKED_DIRECTLY = process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (INVOKED_DIRECTLY) {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = path.resolve(argOf("--root") ?? process.cwd());
  try {
    const { written, migrationsAppended } = genDb(root);
    console.log(`gen db：${root}`);
    for (const f of written) console.log(`- 写入 ${f}`);
    console.log(
      migrationsAppended.length > 0
        ? `迁移骨架（追加式，已存在文件永不重写）：${migrationsAppended.join(", ")}`
        : "迁移骨架：无新增（所有表已有迁移或无新表）"
    );
    console.log(`done：${written.length} 个文件。regen 幂等：再跑一次应零新增。`);
  } catch (e) {
    console.error(`error: ${e.message}${e.fix ? `\nfix: ${e.fix}` : ""}`);
    process.exit(1);
  }
}
