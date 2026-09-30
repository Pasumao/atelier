/**
 * 数据契约（FS-DESIGN §5.1，FS-3/FS-4 数据面基座，FS-M2(m2b)）。
 * `table()` 扁平字面量定义 = 数据域契约单源：与组件/端点契约同一 FlatSchema 规范
 * （runtime/contract.ts，禁 $ref/oneOf；不新增第二套 schema 语言）。
 * 纪律（§2.1）：契约对象是普通 TS 值（对象字面量），不是方法链 DSL——扁平字面量对
 * LLM 分布最友好，且能被 gen-db 的纯文本扫描器处理（无需类型求值）。
 *
 * 本模块纯 TS 零依赖、不 import sqlite：DDL 文本（createTableSql/dropTableSql）只被
 * gen-db 迁移骨架与测试消费，永不直接执行用户输入——见各函数 JSDoc 的参数化红线注记。
 * 列类型全集 = SQLite 四原始类型（integer/text/real/blob），无 Date/JSON 魔法类型：
 * 时间 = integer epoch ms、复合结构 = 手动 JSON 列 + 应用层映射（显式优于魔法）。
 * 诚实边界：rowSchema 是写入输入的校验面（insert/update 前过 validateFlat）；行读取面
 * 以 gen-db 产出的 Row 类型为准（FlatSchema 无二进制域，blob 列投影为 string 仅作形状提示）。
 */
import type { FlatField, FlatSchema } from "../runtime/contract.ts";

/** 列类型全集（v1）：SQLite 四原始存储类——参数化友好（§5.1） */
export type SqlColumnType = "integer" | "text" | "real" | "blob";

/** 列定义（扁平字面量；未知键在 table() 构造时即硬错——拼错约束名不静默吞） */
export type ColumnDef = {
  type: SqlColumnType;
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  /** SQL DEFAULT 字面量（string/number/null；blob 列不给 default） */
  default?: string | number | null;
  /** 枚举值（同质 string[] 或 number[]；透传进 rowSchema——校验在契约层，DDL 不重复 CHECK） */
  enum?: readonly (string | number)[];
  /** 显式关系声明，格式 "<table>.<column>"——生成迁移时产出 FK；cascade 不隐式（§5.1） */
  references?: string;
};

export type IndexDef = { name: string; columns: string[]; unique?: boolean };

/**
 * FTS5 全文搜索声明（B6，opts.fts）：external-content 模式——虚表 `<t>_fts` 以 content='<t>'
 * 免双写存储、content_rowid='<pk>' 直连主表 rowid 别名（故仅支持单列 integer 主键的表），
 * 同步触发器三元组 `<t>_fts_ai/_ad/_au` 由 createTableSql/dropTableSql 按 DDL 单源产出。
 */
export type FtsDef = { columns: string[] };

/** table() 产物：数据契约单源（gen-db 的解析对象与 MCP db.schema 的数据源同此形状） */
export type TableDef = {
  name: string;
  columns: Record<string, ColumnDef>;
  /** 主键列序（声明序）；无显式主键的 rowid 表为 []（该类表不生成 CRUD——见 gen-db） */
  primaryKey: string[];
  indexes: IndexDef[];
  /** FTS5 全文搜索声明（B6，opts.fts 透传；未声明则无此键——产物形状纯加法） */
  fts?: FtsDef;
  /** FlatSchema 投影：端点 output 契约可直接引用表列子集（pick）——数据契约与端点契约同规范单源 */
  rowSchema: FlatSchema;
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REF_RE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;
const COLUMN_TYPES: readonly SqlColumnType[] = ["integer", "text", "real", "blob"];
const COLUMN_KEYS = ["type", "primaryKey", "notNull", "unique", "default", "enum", "references"];

/**
 * SQLite 官方关键字词表（P2-G1，https://sqlite.org/lang_keywords.html 全集）：表/列/索引名
 * 以裸标识符拼进 DDL/CRUD（CREATE TABLE order / SELECT … ORDER BY limit / UPDATE SET …），
 * 撞关键字 = 语法错误且 migrate 时才炸——构造期单一真相源必须在此拦下。SQLite 关键字大小写
 * 不敏感，比对一律小写化。gen-db 生成路径经 table() 回灌复验同受闸（词表绝不两份手抄）。
 */
const SQLITE_KEYWORDS: ReadonlySet<string> = new Set([
  "abort", "action", "add", "after", "all", "alter", "always", "analyze", "and", "as", "asc", "attach",
  "autoincrement", "before", "begin", "between", "by", "cascade", "case", "cast", "check", "collate",
  "column", "commit", "conflict", "constraint", "create", "cross", "current", "current_date",
  "current_time", "current_timestamp", "database", "default", "deferrable", "deferred", "delete",
  "desc", "detach", "distinct", "do", "drop", "each", "else", "end", "escape", "except", "exclude",
  "exclusive", "exists", "explain", "fail", "filter", "first", "following", "for", "foreign", "from",
  "full", "generated", "glob", "group", "groups", "having", "if", "ignore", "immediate", "in", "index",
  "indexed", "initially", "inner", "insert", "instead", "into", "is", "isnull", "join", "key", "last",
  "left", "like", "limit", "match", "materialized", "natural", "no", "not", "nothing", "notnull",
  "null", "nulls", "of", "offset", "on", "or", "order", "others", "outer", "over", "partition",
  "plan", "pragma", "preceding", "primary", "query", "raise", "range", "recursive", "references",
  "regexp", "reindex", "release", "rename", "replace", "restrict", "returning", "right", "rollback",
  "row", "rows", "savepoint", "select", "set", "table", "temp", "temporary", "then", "ties", "to",
  "transaction", "trigger", "unbounded", "union", "unique", "update", "using", "vacuum", "values",
  "view", "virtual", "when", "where", "window", "with", "without",
]);

/** DDL 标识符白名单：字母/下划线开头的 [A-Za-z0-9_]* 且不撞 SQLite 关键字——这是 DDL 免引号、
 * 免注入面、免「migrate 时才炸」的前提（P2-G1：字符集 + 关键字双闸都在构造期） */
function assertIdent(kind: string, name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`数据契约错误：${kind}名非法：${name}（只允许字母/下划线开头的 [A-Za-z0-9_]；标识符只来自契约定义，永不拼用户输入——决策 19 参数化红线）`);
  }
  if (SQLITE_KEYWORDS.has(name.toLowerCase())) {
    // ATR-343 命名闸族码（与 gen-db 表名闸同族单源）：message 自含细节 + fix 属性随错误对象
    // 透传（gen-db CLI 按 message + fix 两行打印；运行时直用 table() 的应用读 message 即全量）。
    throw Object.assign(
      new Error(
        `数据契约错误（ATR-343）：${kind}名「${name}」是 SQLite 保留字——裸标识符会拼进 DDL/CRUD SQL（如 CREATE TABLE … ${name} / SELECT … FROM ${name}），是语法错误且要到 migrate 才炸，契约绝不带病入库\n` +
        `fix: 改${kind}名避开 SQLite 关键字（如 order → orders、limit → max_rows；词表 = SQLite 官方关键字全集，https://sqlite.org/lang_keywords.html）`,
      ),
      { code: "ATR-343", fix: `改${kind}名避开 SQLite 关键字（大小写不敏感；词表 = SQLite 官方关键字全集）` },
    );
  }
}

/** 列类型 → FlatSchema 叶子类型：integer/real → number，text/blob → string */
function flatFieldType(col: ColumnDef): "number" | "string" {
  return col.type === "integer" || col.type === "real" ? "number" : "string";
}

/**
 * 扁平表定义（数据契约单源入口）。列定义必须是普通对象字面量（§2.1 纪律）；
 * primaryKey 隐含 notNull（rowSchema 层）；enum 透传进 rowSchema；
 * opts.fts 声明 FTS5 全文搜索（B6：external-content 虚表 + 触发器同步，仅 text 列 +
 * 单列 integer 主键表——校验见下）。
 * 构造期即校验（标识符白名单/类型全集/未知键/enum 同质/references 形状/opts 键/fts 形状）——
 * 契约错误炸在定义处，不留给运行时或生成器。
 */
export function table(
  name: string,
  columns: Record<string, ColumnDef>,
  opts: { indexes?: IndexDef[]; fts?: { columns: string[] } } = {}
): TableDef {
  assertIdent("表", name);
  for (const k of Object.keys(opts)) {
    if (k !== "indexes" && k !== "fts") {
      throw new Error(`数据契约错误：表 ${name} 有未知选项 ${k}（允许：indexes/fts——拼错约束名必须硬错）`);
    }
  }
  const keys = Object.keys(columns);
  if (keys.length === 0) {
    throw new Error(`数据契约错误：表 ${name} 至少需要一列`);
  }
  const primaryKey: string[] = [];
  const reqProps: Record<string, FlatField> = {};
  const optProps: Record<string, FlatField> = {};
  for (const key of keys) {
    assertIdent(`表 ${name} 的列`, key);
    const col = columns[key];
    for (const k of Object.keys(col)) {
      if (!COLUMN_KEYS.includes(k)) {
        throw new Error(`数据契约错误：表 ${name} 列 ${key} 有未知键 ${k}（允许：${COLUMN_KEYS.join("/")}——拼错约束名必须硬错）`);
      }
    }
    if (!COLUMN_TYPES.includes(col.type)) {
      throw new Error(`数据契约错误：表 ${name} 列 ${key} 类型非法：${String(col.type)}（全集：${COLUMN_TYPES.join("/")}）`);
    }
    if (col.references != null && !REF_RE.test(col.references)) {
      throw new Error(`数据契约错误：表 ${name} 列 ${key} references 非法：${col.references}（格式 "<table>.<column>"）`);
    }
    if (col.enum != null) {
      if (!Array.isArray(col.enum) || col.enum.length === 0) {
        throw new Error(`数据契约错误：表 ${name} 列 ${key} enum 必须是非空数组`);
      }
      const allStr = col.enum.every((v) => typeof v === "string");
      const allNum = col.enum.every((v) => typeof v === "number");
      if (!allStr && !allNum) {
        throw new Error(`数据契约错误：表 ${name} 列 ${key} enum 必须同质（全 string 或全 number）`);
      }
    }
    const field: FlatField = { type: flatFieldType(col) };
    if (col.enum != null) {
      // FlatField.enum 已放宽为 (string|number)[]（R1-C §4.7——此前 string[] 标注是撒谎窄化，
      // 数值枚举须经 as 硬转透传）；table() 构造期已校验同质，直接透传零窄化。
      field.enum = [...col.enum];
    }
    const required = col.notNull === true || col.primaryKey === true;
    if (required) reqProps[key] = field;
    else optProps[key] = field;
    if (col.primaryKey) primaryKey.push(key);
  }
  const indexes = opts.indexes ?? [];
  for (const idx of indexes) {
    assertIdent(`表 ${name} 的索引`, idx.name);
    if (!Array.isArray(idx.columns) || idx.columns.length === 0) {
      throw new Error(`数据契约错误：表 ${name} 索引 ${idx.name} 至少需要一列`);
    }
    for (const c of idx.columns) {
      if (!(c in columns)) {
        throw new Error(`数据契约错误：表 ${name} 索引 ${idx.name} 引用未知列 ${c}`);
      }
    }
  }
  let fts: FtsDef | undefined;
  if (opts.fts != null) {
    if (typeof opts.fts !== "object" || Array.isArray(opts.fts)) {
      throw new Error(`数据契约错误：表 ${name} 的 fts 必须是对象（{ columns: string[] }）`);
    }
    for (const k of Object.keys(opts.fts)) {
      if (k !== "columns") {
        throw new Error(`数据契约错误：表 ${name} 的 fts 有未知键 ${k}（允许：columns——拼错约束名必须硬错）`);
      }
    }
    if (!Array.isArray(opts.fts.columns) || opts.fts.columns.length === 0) {
      throw new Error(`数据契约错误：表 ${name} 的 fts 至少需要一列（FTS5 虚表无列不可用）`);
    }
    const seen = new Set<string>();
    for (const c of opts.fts.columns) {
      if (!(c in columns)) {
        throw new Error(`数据契约错误：表 ${name} fts 引用未知列 ${c}`);
      }
      if (columns[c].type !== "text") {
        throw new Error(`数据契约错误：表 ${name} fts 列 ${c} 类型非法：只允许 text（实际 ${columns[c].type}——FTS5 索引的是文本列）`);
      }
      if (seen.has(c)) {
        throw new Error(`数据契约错误：表 ${name} fts 列重复：${c}`);
      }
      seen.add(c);
    }
    // FTS5 external-content 的 content_rowid 需要 rowid 别名列——单列 INTEGER PRIMARY KEY。
    // 复合主键/无主键/text 主键表暂不支持 fts（诚实硬错指路，不静默产出跑不起来的 DDL）。
    if (primaryKey.length !== 1 || columns[primaryKey[0]].type !== "integer") {
      const actual =
        primaryKey.length === 0
          ? "无主键"
          : primaryKey.length > 1
            ? `复合主键 ${primaryKey.join("/")}`
            : `${columns[primaryKey[0]].type} 主键 ${primaryKey[0]}`;
      throw new Error(
        `数据契约错误：表 ${name} 开启 fts 要求单列 integer 主键（FTS5 external-content 以 content_rowid 直连主表 rowid 别名；实际：${actual}）——复合主键/text 主键表暂不支持 fts，请去掉 fts 或走手写 SQL 通道（ctx.db.prepare 直用，§5.3）`
      );
    }
    fts = { columns: [...opts.fts.columns] };
  }
  return {
    name,
    columns,
    primaryKey,
    indexes,
    ...(fts ? { fts } : {}),
    rowSchema: { type: "object", reqProps, ...(Object.keys(optProps).length > 0 ? { optProps } : {}) },
  };
}

/**
 * rowSchema 子集投影：端点 output 契约直接引用表列子集（§5.1——数据契约与端点契约同源）。
 * 必选/可选属性保持原位（req 归 req、opt 归 opt）；未知键硬错（拼列名不静默）。
 * optProps 为空时省略（对齐手写 FlatSchema 习惯）。
 */
export function pick(rowSchema: FlatSchema, keys: readonly string[]): FlatSchema {
  const reqProps: Record<string, FlatField> = {};
  const optProps: Record<string, FlatField> = {};
  for (const k of keys) {
    if (rowSchema.reqProps[k]) reqProps[k] = rowSchema.reqProps[k];
    else if (rowSchema.optProps?.[k]) optProps[k] = rowSchema.optProps[k];
    else {
      throw new Error(`pick：键 ${k} 不在 rowSchema 中（可用：${[...Object.keys(rowSchema.reqProps), ...Object.keys(rowSchema.optProps ?? {})].join(", ")}）`);
    }
  }
  return { type: "object", reqProps, ...(Object.keys(optProps).length > 0 ? { optProps } : {}) };
}

/** SQL 字面量渲染（DEFAULT 用）：string 单引号 + '' 转义；null/number 直书 */
function sqlLiteral(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

const SQL_TYPE: Record<SqlColumnType, string> = { integer: "INTEGER", text: "TEXT", real: "REAL", blob: "BLOB" };

/**
 * 建表 DDL 文本（gen-db 迁移骨架与测试用；多语句以 ";\n" 分隔，db.exec 可直跑）。
 * 红线注记（决策 19）：DDL **标识符只来自契约定义**（table() 构造期已过白名单校验）、
 * 永不拼用户输入；列值本就不进 DDL（default 是契约字面量非运行时输入）。
 * cascade 不隐式（§5.1）：绝不产出 ON DELETE CASCADE——需要级联在迁移 SQL 里显式写。
 * primaryKey 列一律补 NOT NULL（不依赖 SQLite 对非 INTEGER PRIMARY KEY 的历史可空怪癖）；
 * 单列整型主键仍是 rowid 别名（INSERT 省略即自增）。
 * fts（B6）：声明 opts.fts 的表在主表/索引之后追加 FTS5 external-content 三件套——
 * `CREATE VIRTUAL TABLE <t>_fts USING fts5(<cols>, content='<t>', content_rowid='<pk>')`
 * 免双写存储（索引在虚表、行值留主表，读时经 rowid 直连）+ 同步触发器三元组
 * `<t>_fts_ai`（AFTER INSERT 直插）/`_ad`（AFTER DELETE 走 `<t>_fts(<t>_fts,...) VALUES('delete',...)`
 * 特殊 delete 命令）/`_au`（AFTER UPDATE 先 delete 后插）；虚表列名/触发器体里的 new./old.
 * 引用同样只来自契约列名，不破参数化红线。
 */
export function createTableSql(def: TableDef): string {
  const lines: string[] = [];
  for (const [key, col] of Object.entries(def.columns)) {
    const parts = [`  ${key} ${SQL_TYPE[col.type]}`];
    if (col.primaryKey && def.primaryKey.length === 1) parts.push("PRIMARY KEY");
    if (col.primaryKey || col.notNull) parts.push("NOT NULL");
    if (col.unique) parts.push("UNIQUE");
    if (col.default !== undefined) parts.push(`DEFAULT ${sqlLiteral(col.default)}`);
    if (col.references) {
      const m = REF_RE.exec(col.references)!;
      parts.push(`REFERENCES ${m[1]}(${m[2]})`);
    }
    lines.push(parts.join(" "));
  }
  if (def.primaryKey.length > 1) {
    lines.push(`  PRIMARY KEY (${def.primaryKey.join(", ")})`);
  }
  let sql = `CREATE TABLE IF NOT EXISTS ${def.name} (\n${lines.join(",\n")}\n);`;
  for (const idx of def.indexes) {
    sql += `\nCREATE ${idx.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${idx.name} ON ${def.name} (${idx.columns.join(", ")});`;
  }
  if (def.fts) {
    const ft = `${def.name}_fts`;
    const pk = def.primaryKey[0];
    const colList = def.fts.columns.join(", ");
    const insCols = `rowid, ${colList}`;
    const newVals = [`new.${pk}`, ...def.fts.columns.map((c) => `new.${c}`)].join(", ");
    const oldVals = [`old.${pk}`, ...def.fts.columns.map((c) => `old.${c}`)].join(", ");
    sql += `\nCREATE VIRTUAL TABLE IF NOT EXISTS ${ft} USING fts5(${colList}, content='${def.name}', content_rowid='${pk}');`;
    sql += `\nCREATE TRIGGER IF NOT EXISTS ${ft}_ai AFTER INSERT ON ${def.name} BEGIN\n  INSERT INTO ${ft}(${insCols}) VALUES (${newVals});\nEND;`;
    sql += `\nCREATE TRIGGER IF NOT EXISTS ${ft}_ad AFTER DELETE ON ${def.name} BEGIN\n  INSERT INTO ${ft}(${ft}, ${insCols}) VALUES ('delete', ${oldVals});\nEND;`;
    sql += `\nCREATE TRIGGER IF NOT EXISTS ${ft}_au AFTER UPDATE ON ${def.name} BEGIN\n  INSERT INTO ${ft}(${ft}, ${insCols}) VALUES ('delete', ${oldVals});\n  INSERT INTO ${ft}(${insCols}) VALUES (${newVals});\nEND;`;
  }
  return sql;
}

/**
 * 删表 DDL 文本（gen-db 迁移 down 骨架与测试用）。
 * 红线注记同 createTableSql（标识符只来自契约定义）；cascade 不隐式（§5.1）：
 * DROP 不带级联语义——启用 PRAGMA foreign_keys 且存在子表引用时，由迁移作者显式安排
 * 删除顺序或级联语句（gen-db 的 down 骨架按编号逆序回滚，子表先于父表）。
 * fts（B6）：声明 fts 的表先 DROP TRIGGER ×3（触发器先删）再 DROP 虚表，最后主表——
 * external-content 虚表不会随主表自动消失，顺序颠倒会留下悬空索引。
 */
export function dropTableSql(def: TableDef): string {
  if (!def.fts) return `DROP TABLE IF EXISTS ${def.name};`;
  const ft = `${def.name}_fts`;
  return [
    `DROP TRIGGER IF EXISTS ${ft}_ai;`,
    `DROP TRIGGER IF EXISTS ${ft}_ad;`,
    `DROP TRIGGER IF EXISTS ${ft}_au;`,
    `DROP TABLE IF EXISTS ${ft};`,
    `DROP TABLE IF EXISTS ${def.name};`,
  ].join("\n");
}
