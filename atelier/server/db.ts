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

/** table() 产物：数据契约单源（gen-db 的解析对象与 MCP db.schema 的数据源同此形状） */
export type TableDef = {
  name: string;
  columns: Record<string, ColumnDef>;
  /** 主键列序（声明序）；无显式主键的 rowid 表为 []（该类表不生成 CRUD——见 gen-db） */
  primaryKey: string[];
  indexes: IndexDef[];
  /** FlatSchema 投影：端点 output 契约可直接引用表列子集（pick）——数据契约与端点契约同规范单源 */
  rowSchema: FlatSchema;
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REF_RE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;
const COLUMN_TYPES: readonly SqlColumnType[] = ["integer", "text", "real", "blob"];
const COLUMN_KEYS = ["type", "primaryKey", "notNull", "unique", "default", "enum", "references"];

/** DDL 标识符白名单：字母/下划线开头的 [A-Za-z0-9_]*——这是 DDL 免引号且免注入面的前提 */
function assertIdent(kind: string, name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`数据契约错误：${kind}名非法：${name}（只允许字母/下划线开头的 [A-Za-z0-9_]；标识符只来自契约定义，永不拼用户输入——决策 19 参数化红线）`);
  }
}

/** 列类型 → FlatSchema 叶子类型：integer/real → number，text/blob → string */
function flatFieldType(col: ColumnDef): "number" | "string" {
  return col.type === "integer" || col.type === "real" ? "number" : "string";
}

/**
 * 扁平表定义（数据契约单源入口）。列定义必须是普通对象字面量（§2.1 纪律）；
 * primaryKey 隐含 notNull（rowSchema 层）；enum 透传进 rowSchema。
 * 构造期即校验（标识符白名单/类型全集/未知键/enum 同质/references 形状）——契约错误
 * 炸在定义处，不留给运行时或生成器。
 */
export function table(
  name: string,
  columns: Record<string, ColumnDef>,
  opts: { indexes?: IndexDef[] } = {}
): TableDef {
  assertIdent("表", name);
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
      // FlatField.enum 类型标注为 string[]（既有契约域以字符串字面量为主）；数值枚举的
      // includes 值比较运行时同样成立——此处经 as 透传（不改 runtime 契约形状）。
      field.enum = [...col.enum] as string[];
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
  return {
    name,
    columns,
    primaryKey,
    indexes,
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
  return sql;
}

/**
 * 删表 DDL 文本（gen-db 迁移 down 骨架与测试用）。
 * 红线注记同 createTableSql（标识符只来自契约定义）；cascade 不隐式（§5.1）：
 * DROP 不带级联语义——启用 PRAGMA foreign_keys 且存在子表引用时，由迁移作者显式安排
 * 删除顺序或级联语句（gen-db 的 down 骨架按编号逆序回滚，子表先于父表）。
 */
export function dropTableSql(def: TableDef): string {
  return `DROP TABLE IF EXISTS ${def.name};`;
}
