#!/usr/bin/env node
/**
 * gen-endpoint.mjs — gen endpoint 生成器（FS-M2，FS-DESIGN §7.1-7.2）。
 *
 * 输入：① <root>/src/server/endpoints/ 下递归各 .ts 的 defineQuery/defineCommand 静态文本
 *          + <root>/src/server/auth/endpoints.ts（gen auth 产物三件套——存在即纳入扫描，
 *          加法语义；FS-M2-d 挂账销账：api.ts 客户端覆盖 auth 端点）
 *       ② <root>/src/contract.ts 契约单源（export const 常量）
 *       ③ --from-specs 时 <root>/specs/*.md 的 ## 端点意图 段（§7.4）
 * 输出：① src/generated/api.ts 类型化客户端（每次 regen 全量重写，字节确定性——无时间戳、
 *          端点按名排序、模板定长；两次 regen diff 必为空，§7.3 门禁 2）
 *       ② --from-specs 时对 specs 中已声明但端点文件未定义的端点发 src/server/endpoints/<域>.ts
 *          骨架（可编译诚实 stub，handler 抛 AtrEndpointError/501）；已存在文件永不覆盖。
 *
 * 为什么禁用 TS 解析器/eval：框架零依赖纪律（与 compiler/dump.mjs 同款决策）——契约对象是
 * 扁平字面量（§2.1 纪律：对象字面量而非方法链 DSL），正则 + 括号匹配即可静态理解，
 * 引入 typescript 依赖只为读自己定义的形态得不偿失；eval 则根本不可接受（扫描器不得执行被扫代码）。
 * 边界（诚实）：非字面量端点名（变量传入）、简写属性均不识别——扫描器只认"扁平字面量"形态，
 * 识别不了就记进 notes 而不是猜（宁缺勿假）。行内契约对象字面量在 src/server/endpoints/
 * 用户端点面不识别（契约提升单源纪律）；仅 auth 扫描面（gen auth 产物，自包含生成码）放行
 * 三形态专项解析——①端点级内联契约字面量（合成名 <名>.input/.output，M7-C openapi 导出
 * 同款先例）②`const x = pick(<tbl>.rowSchema, […])` 本地表投影（列→TS 映射与 server/db.ts
 * 的 flatFieldType/table()/pick() 语义对表，交叉引用见 resolveLocalPickTypes）③auth 元数据
 * （auth: { type: "none" } 等）对本生成器无影响、解析须容忍（只认 contract/output 键）。
 *
 * 端点名与派生标识符校验（P1-8，ATR-342）：字面量端点名入口校验字符集（对齐 server/endpoints.ts
 * 的 NAME_RE——ATR-313 同源规则，字母开头的 [A-Za-z0-9_.-]）；pascalOf/camelOf 派生标识符
 * 合法性（含独立导出名撞 JS 保留字）二次闸——坏名字在生成器侧四段式 die，绝不流入产物破碎
 * api.ts；进生成码的端点名/URL 一律 JSON.stringify 转义（name as const / fetch / EventSource）。
 *
 * 扫描器掩码与单一真相（R1-C，P1-4）：findEndpointCalls 是 define* 调用点发现的唯一 walk——
 * codeMask（全文单遍状态机 → Uint8Array，技法参照 compiler/extract-schema.mjs）过滤注释/
 * 字符串/模板文本里的假命中（①注释掉的 defineQuery 不产幻影端点 ②字符串里的 defineQuery
 * 忽略 ③多行注释区间不再借 lastIndex 越界吞真实端点）；export-openapi.mjs scanOpenApiEndpoints
 * 复用本 walk（第二份 define* 扫描器已消灭），仅保留其独有的导出面政策（超集元数据
 * auth/cache/timeoutMs/restful 解析与行内字面量禁令）。端点重名在 generateApi 产产物前 die
 * （ATR-313 镜像运行时 register() 语义）；字面量转义解码统一 JSON.parse 语义（decodeEscapesCore，
 * gen-db/export-openapi 各持同款内联，跨面对拍 tests/gen-literal-parity.test.ts 钉住）。
 *
 * 自包含红线：本文件在 init/sync 的 vendor 名单内（M7 批），mcp-vendor.test.ts 机械核对
 * import 闭包精确相等——只准 import node: 内建，绝不 import 框架其他文件。与 export-openapi.mjs
 * 各自持有一份 scanner（parseFlatValue / resolveLocalPickTypes / flatSchemaToTs 为其
 * parseFlatLiteral / resolveLocalPickSchemas / §2.4 投影的兄弟实现）是既有格局——本文件
 * 因 vendor 闭包红线不能复用其实现（它可 import server/db.ts 走运行时同一实现，本文件只能
 * 文本层对表），文件头互相指认；两边形态解析由各自测试钉住（openapi-golden auth 联测段 /
 * 本文件 auth 面 describe）。
 *
 * CLI：node atelier/gen/gen-endpoint.mjs --root <appDir> [--mount /api] [--from-specs]
 * 库形态：export 纯函数（findEndpointCalls / scanEndpoints / scanContracts / scanSpecIntents /
 * scanApiClient / generateApi / generateSkeletons / stringArrayOf / RESERVED_WORDS），供测试、
 * impact.mjs 与 export-openapi.mjs 复用（同一扫描器同一真相）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const INVOKED_DIRECTLY = process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

/* ---------- 端点名与派生标识符校验（P1-8，ATR-342：坏名字绝不流入产物） ---------- */

/** 生成器侧四段式错误（code/message/fix——与 gen-db 的 GenDbError 同构，扫描器边界即纪律边界） */
export class GenEndpointError extends Error {
  constructor(code, message, fix) {
    super(message);
    this.name = "GenEndpointError";
    this.code = code;
    this.fix = fix;
  }
}

function die(code, message, fix) {
  throw new GenEndpointError(code, message, fix);
}

/** 端点名字符集口径 = server/endpoints.ts 的 NAME_RE（ATR-313 同源：URL 路径拼接的安全前提） */
const ENDPOINT_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** 独立导出名（export const <c> = …）撞即编译不过的 JS 保留字（camelOf 产物闸）。
 *  R1-C 起导出共享：gen-db.mjs 的 toCamel CRUD 函数名闸 import 同一词表（单源，绝不两份手抄）。 */
export const RESERVED_WORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public",
  "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void",
  "while", "with", "yield",
]);

const DERIVED_IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** 端点名入口校验：字面量名此前全程无字符集校验，`"`/`\`/换行可静默流入产物破碎整份 api.ts
 * （报错位置在生成文件里）；现扫描时即 ATR-342 die，诊断回到生成器侧。 */
function assertEndpointName(name, line) {
  if (ENDPOINT_NAME_RE.test(name)) return;
  die(
    "ATR-342",
    `端点名非法：「${JSON.stringify(name)}」${line > 0 ? `（端点文件第 ${line} 行）` : ""}——只允许字母开头的 [A-Za-z0-9_.-]（对齐 server/endpoints.ts NAME_RE / ATR-313）`,
    '改成合法端点名，如 "chat.ask" 或 "notes.list"（字母开头，后接字母/数字/下划线/点/连字符）'
  );
}

/* ---------- 字面量转义解码（R1-C §4.7：JSON.parse 语义单一口径） ---------- */

/**
 * 字符串字面量体内文 → 实际值（纯核，自包含——gen-db.mjs parseStringLiteral 与
 * export-openapi.mjs parseStringLiteral 因各自错误形态各持同款内联，行为由
 * tests/gen-literal-parity.test.ts 跨面对拍钉住：同一组字面量经三条消费链逐字相同）。
 * 此前三实现分叉：本文件 `\\(.)→$1` 把 `\n` 解成 "n"（端点名 `"a\nb"` 静默漂移成 "anb"），
 * gen-db/export-openapi 仅映射 \n/\t（`\u4e2d` 解成 "u4e2d"）——统一为 JSON.parse 语义：
 * 转义集 \n \t \r \b \f \" \' \\ \/ \` \uXXXX（\' 与 \` 是 JS 字面量 clothing 的必然形态，
 * 按字面字符还原）；越界转义（\x/八进制/未知）与悬空反斜杠 = 超出扁平字面量纪律（§2.1）
 * → { ok: false }，调用方按各自四段式 die（绝不静默猜）。
 */
export function decodeEscapesCore(inner) {
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

/** 名字面量文本 → 实际端点名（解码失败 = ATR-342 die——越界转义的名字绝不流入产物） */
function decodeEndpointName(raw, line) {
  const dec = decodeEscapesCore(raw);
  if (!dec.ok) {
    die(
      "ATR-342",
      `端点名字面量转义非法：${dec.error}（原文 ${JSON.stringify(raw)}${line > 0 ? `，第 ${line} 行` : ""}）`,
      "名字面量里只写明文字符或 JSON 转义集——越界转义（\\x/八进制等）超出扁平字面量纪律（§2.1）"
    );
  }
  return dec.value;
}

/* ---------- 文本扫描原语（字符串/注释感知的括号匹配——无 eval、无 TS 解析器） ---------- */

/** 跳过一个字符串字面量（含模板字面量 ${} 插值嵌套），返回结束后的下标 */
function skipString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (q === "`" && c === "$" && src[i + 1] === "{") {
      // 插值帧：括号配平，内部引号递归跳过
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === '"' || d === "'" || d === "`") {
          i = skipString(src, i);
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        i++;
      }
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}

/**
 * 匹配平衡的 <…> 泛型类型实参段（defineCommand<Input, Output>(…) 的类型标注——
 * 模板 example.ts / gen-compile-gate 的应用规范形态）。状态感知：字符串/行块注释/嵌套 <>
 * 不误判，`=>`（箭头类型）不当闭合符；返回闭 > 下标，不闭合 = -1（诚实跳过该 match）。
 * （与 export-openapi.mjs 同款——两扫描器同构同源修法，2026-09-20 泛型盲区红绿修复）
 */
export function matchAngle(src, openPos) {
  let depth = 0;
  let state = "code";
  let q = "";
  for (let i = openPos; i < src.length; i++) {
    const c = src[i];
    if (state === "str") {
      if (c === "\\") { i++; continue; }
      if (c === q) state = "code";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { state = "str"; q = c; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; continue; }
    if (c === "<") { depth++; continue; }
    if (c === ">") {
      if (src[i - 1] === "=") continue; // => 箭头类型：不是层级闭合
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** src[openPos] ∈ { ( [ { —— 返回配对闭括号下标（字符串/注释感知）；不配平 = -1 */
export function matchDelim(src, openPos) {
  const closer = { "(": ")", "[": "]", "{": "}" }[src[openPos]];
  if (!closer) return -1;
  let depth = 0;
  let i = openPos;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const n = src.indexOf("\n", i);
      if (n < 0) return -1;
      i = n;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const n = src.indexOf("*/", i + 2);
      if (n < 0) return -1;
      i = n + 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** 去注释（保留字符串原样）——供值文本再解析（export-openapi.mjs 复用同一原语，FS-9） */
export function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const j = skipString(src, i);
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const n = src.indexOf("\n", i);
      i = n < 0 ? src.length : n;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const n = src.indexOf("*/", i + 2);
      i = n < 0 ? src.length : n + 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 顶层逗号切块（括号/字符串/注释感知）——对象字面量的直接属性拆分 */
function topLevelChunks(body) {
  const chunks = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(body, i);
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      const n = body.indexOf("\n", i);
      i = n < 0 ? body.length : n;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      const n = body.indexOf("*/", i + 2);
      i = n < 0 ? body.length : n + 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      chunks.push(body.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  if (start < body.length) chunks.push(body.slice(start));
  return chunks.map((s) => s.trim()).filter(Boolean);
}

/** 对象字面量体 → 直接属性表 { key: 值文本 }；简写属性/展开不识别（诚实边界，见文件头）。
 *  export-openapi.mjs 复用同一原语（FS-9 单一扫描器真相——只加导出不改行为） */
export function parseProps(body) {
  const props = {};
  for (const chunk of topLevelChunks(body)) {
    const m = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(chunk);
    if (m) props[m[1]] = m[2].trim();
  }
  return props;
}

/** 值文本的起始标识符（契约单源纪律 = 引用常量；行内字面量不识别 → null + 由调用方记 note） */
export function identOf(valueText) {
  if (valueText == null) return null;
  const m = /^\s*(?:as\s+const\s+)?([A-Za-z_$][\w$]*)/.exec(stripComments(valueText));
  return m ? m[1] : null;
}

/** [ "a", "b" ] 值文本 → 字符串数组；非数组形态 → null（export-openapi.mjs 复用）。
 *  成员转义解码走 decodeEscapesCore（JSON.parse 语义）——越界转义显式抛错，绝不静默解错 */
export function stringArrayOf(valueText) {
  if (valueText == null) return null;
  const stripped = stripComments(valueText).trim();
  if (!stripped.startsWith("[")) return null;
  const close = matchDelim(stripped, 0);
  if (close < 0) return null;
  const inner = stripped.slice(1, close);
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;
  for (let m; (m = re.exec(inner));) {
    const dec = decodeEscapesCore(m[1] ?? m[2] ?? "");
    if (!dec.ok) throw new GenEndpointError("ATR-312", `字符串数组字面量转义非法：${dec.error}（原文 ${JSON.stringify(m[1] ?? m[2] ?? "")}）`, "扁平字面量转义集 = \\n \\t \\r \\b \\f \\\" \\' \\\\ \\/ \\` \\uXXXX（JSON.parse 语义）；改用合法转义或纯文本");
    out.push(dec.value);
  }
  return out;
}

/* ---------- auth 扫描面专项原语（gen auth 产物三形态；自包含——vendor 闭包红线只准 node:） ---------- */

/**
 * 字面量文本 → JS 值（自包含版——export-openapi.mjs parseFlatLiteral 同构同纪律：
 * 无 eval、无 TS 解析器、扫描器不执行被扫代码；本文件因 vendor 闭包红线不能复用其实现，
 * 见文件头「自包含红线」）。支持 string/number（含 10_000 分隔符）/boolean/null/数组/对象
 * 递归；其余形态（标识符引用/展开/计算值/插值）→ throw（调用方惰性降级记 note，绝不猜）。
 */
function parseFlatValue(text, what) {
  const t = stripComments(text ?? "").trim();
  if (t === "") throw new Error(`${what}：空的字面量`);
  const q = t[0];
  if (q === '"' || q === "'" || q === "`") {
    if (t.length < 2 || t[t.length - 1] !== q) throw new Error(`${what}：字符串字面量未闭合`);
    const inner = t.slice(1, -1);
    if (q === "`" && inner.includes("${")) throw new Error(`${what}：模板字符串插值超出扁平字面量纪律（§2.1）`);
    const dec = decodeEscapesCore(inner);
    if (!dec.ok) throw new Error(`${what}：${dec.error}`);
    return dec.value;
  }
  if (/^[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?$/.test(t)) return Number(t.replace(/_/g, ""));
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) throw new Error(`${what}：数组字面量未闭合`);
    return topLevelChunks(t.slice(1, -1)).map((s) => parseFlatValue(s, what));
  }
  if (t.startsWith("{")) {
    if (!t.endsWith("}")) throw new Error(`${what}：对象字面量未闭合`);
    const obj = {};
    for (const chunk of topLevelChunks(t.slice(1, -1))) {
      const m = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(chunk);
      if (!m) throw new Error(`${what}：无法解析的对象条目「${chunk.trim().slice(0, 60)}」（键必须是标识符、值必须是直接字面量——扁平纪律 §2.1）`);
      obj[m[1]] = parseFlatValue(m[2], `${what}.${m[1]}`);
    }
    return obj;
  }
  throw new Error(`${what}：无法静态解析的字面量「${t.slice(0, 60)}」（扁平纪律 §2.1：只认普通字面量——禁计算值/展开/标识符引用）`);
}

/** FlatField 叶子 → TS 类型文本（FlatOf 同款投影规则对表：runtime/contract.ts FlatLeaf——
 *  string→string/number→number/boolean→boolean/array→items 投影数组/enum→字面量联合；
 *  数值枚举同渲染字面量联合——运行时 validateFlat 的 includes 语义优先于 FlatLeaf 的
 *  string-only 收窄〔FlatOf 对数值枚举投影为 never 的已知局限，此处不照抄〕；
 *  不可渲染形态 → null，由调用方诚实回退） */
function flatLeafToTs(field) {
  if (field == null || typeof field !== "object" || Array.isArray(field)) return null;
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    return field.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  switch (field.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const inner = field.items != null ? flatLeafToTs(field.items) : null;
      return inner == null ? "unknown[]" : `${inner}[]`;
    }
    default:
      return null;
  }
}

/** FlatSchema 值 → TS 对象类型文本（reqProps 必填 / optProps 可选 ?——FlatOf 的 FlatReq&FlatOpt
 *  同款；键序 = 字面量声明序/ pick 键序，字节确定性；无属性 → Record<string, unknown>；
 *  非 object schema → null〔FlatOf 对该形态同样退化，由调用方回退〕） */
function flatSchemaToTs(schema) {
  if (schema == null || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") return null;
  const parts = [];
  for (const [k, f] of Object.entries(schema.reqProps ?? {})) {
    const t = flatLeafToTs(f);
    if (t == null) return null;
    parts.push(`${k}: ${t}`);
  }
  for (const [k, f] of Object.entries(schema.optProps ?? {})) {
    const t = flatLeafToTs(f);
    if (t == null) return null;
    parts.push(`${k}?: ${t}`);
  }
  return parts.length === 0 ? "Record<string, unknown>" : `{ ${parts.join("; ")} }`;
}

/**
 * gen auth 产物形态窄解析：端点源内 `const <id> = pick(<tbl>.rowSchema, […])` 的本地契约投影。
 * 与 export-openapi.mjs resolveLocalPickSchemas 同构（文件头互相指认），但本文件在 vendor
 * 名单内（mcp-vendor 闭包机检）只准 import node: 内建——列→TS 映射在本文件内按 server/db.ts
 * 语义对表复刻（它走运行时同一实现，本文件只能文本层），三处对表点：
 *   ① flatFieldType（db.ts）：integer/real → number，text/blob → string；
 *   ② table() rowSchema 构造（db.ts）：notNull || primaryKey → reqProps，否则 optProps；
 *      enum 透传进叶子；
 *   ③ pick()（db.ts）：键序过滤、req/opt 保持原位、未知键 = 投影失败（运行时 pick 硬错）。
 * 映射保真由 gen-endpoint.test.ts「pick 列→TS 映射对表」用例 + 真实 genAuth 产物用例钉住。
 * 窄边界（诚实）：只认这一种生成形态（扁平字面量表 + 同级 .ts import）；解析失败记入
 * failures（constIdent → 原因），标识符照旧走契约单源路径（红检传导，§7.3 门禁四）。
 */
function resolveLocalPickTypes(file, src) {
  const flats = {};
  const failures = {};
  const importMap = {};
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+\.ts)"/g)) {
    for (const piece of m[1].split(",")) {
      const ident = piece.trim().split(/\s+as\s+/).pop()?.trim();
      if (ident) importMap[ident] = m[2];
    }
  }
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*pick\(\s*([A-Za-z_$][\w$]*)\s*\.\s*rowSchema\s*,\s*(\[[^[\]]*\])\s*\)/g)) {
    const constIdent = m[1];
    const rel = importMap[m[2]];
    if (!rel) {
      failures[constIdent] = `表标识符 ${m[2]} 无同文件 .ts import 映射`;
      continue;
    }
    const tableFile = path.resolve(path.dirname(file), rel);
    if (!fs.existsSync(tableFile)) {
      failures[constIdent] = `表定义文件不存在：${rel}`;
      continue;
    }
    try {
      const tsrc = fs.readFileSync(tableFile, "utf8");
      const tm = /\btable\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*,\s*\{/.exec(tsrc);
      if (!tm) {
        failures[constIdent] = "表定义文件无 table(… 形态（gen auth 产物漂移？）";
        continue;
      }
      const colsOpen = tm.index + tm[0].length - 1;
      const colsClose = matchDelim(tsrc, colsOpen);
      if (colsClose < 0) {
        failures[constIdent] = "表列字面量括号不闭合";
        continue;
      }
      const nameDec = decodeEscapesCore(tm[2] ?? ""); // 引号内表名（DDL 白名单校验归 table() 构造期）
      if (!nameDec.ok) throw new Error(`表名字面量转义非法：${nameDec.error}`);
      const name = nameDec.value;
      const cols = parseFlatValue(tsrc.slice(colsOpen, colsClose + 1), `表定义 ${name}`);
      const keys = parseFlatValue(m[3], `pick 键集（${constIdent}）`);
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
        failures[constIdent] = "pick 键集不是字符串数组字面量";
        continue;
      }
      // —— 对表点①②：rowSchema 构造（db.ts flatFieldType + table() req/opt 分派）——
      const reqProps = {};
      const optProps = {};
      for (const [k, col] of Object.entries(cols)) {
        if (col == null || typeof col !== "object" || Array.isArray(col)) {
          throw new Error(`表 ${name} 列 ${k} 定义不是对象字面量`);
        }
        if (col.type !== "integer" && col.type !== "text" && col.type !== "real" && col.type !== "blob") {
          throw new Error(`表 ${name} 列 ${k} 类型非法：${String(col.type)}（全集：integer/text/real/blob）`);
        }
        const field = { type: col.type === "integer" || col.type === "real" ? "number" : "string" };
        if (Array.isArray(col.enum) && col.enum.length > 0) field.enum = [...col.enum];
        // 未知列键不校验（构造期校验归 table()；扫描面只取投影所需四键：type/enum/notNull/primaryKey）
        if (col.notNull === true || col.primaryKey === true) reqProps[k] = field;
        else optProps[k] = field;
      }
      // —— 对表点③：pick()（键序过滤 + req/opt 原位 + 未知键硬错）——
      const picked = { type: "object", reqProps: {} };
      const pickedOpt = {};
      for (const key of keys) {
        if (reqProps[key] != null) picked.reqProps[key] = reqProps[key];
        else if (optProps[key] != null) pickedOpt[key] = optProps[key];
        else throw new Error(`pick 键 ${key} 不在表 ${name} rowSchema 中`);
      }
      if (Object.keys(pickedOpt).length > 0) picked.optProps = pickedOpt;
      flats[constIdent] = picked;
    } catch (e) {
      failures[constIdent] = e.message;
    }
  }
  return { flats, failures };
}

/* ---------- ① 端点文件扫描 ---------- */

/** 递归 .ts 文件枚举（跳 node_modules/dist/点目录；export-openapi.mjs 复用同一枚举原语） */
export function* walkTsFiles(dir, depth = 0) {
  if (depth > 8 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      yield* walkTsFiles(path.join(dir, e.name), depth + 1);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      yield path.join(dir, e.name);
    }
  }
}

/**
 * 全文单遍状态机 → 真实代码区标记（Uint8Array，1 = code）。技法参照 compiler/extract-schema.mjs
 * 的 codeMaskOf（本文件 vendor 闭包自包含红线只准 import node:——同款技法内联，行为由掩码红绿
 * 测试钉住）。帧模型：code（顶层或模板插值）/ q（'、"）/ tpl（`，${} 插值推回 code 帧并按花括号
 * 深度归位）；// 与 /** *\/ 注释、字符串字面量、模板文本均不标记。正则字面量不解析（v1 边界，
 * 与 extract-schema.mjs 同款诚实边界：正则里嵌 "defineQuery(" 属病理输入）。
 */
function codeMaskOf(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const stack = [{ kind: "code", interp: false, depth: 0 }];
  while (i < src.length) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top.kind === "q") {
      if (c === "\\") i++;
      else if (c === top.q) stack.pop();
      i++;
      continue;
    }
    if (top.kind === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") stack.pop();
      else if (c === "$" && src[i + 1] === "{") {
        stack.push({ kind: "code", interp: true, depth: 0 });
        i += 2; // 越过 ${ 整体——若只越 $，{ 会被新插值帧当一层花括号深度计数，闭合 } 永远差一层，
        continue; //        插值帧吞掉后续真实代码（auth 产物 handler 模板串实证，extract-schema 同款修法）
      }
      i++;
      continue;
    }
    // code 帧（顶层或模板插值内；插值帧按花括号深度归位，顶层帧的 } 只是普通代码字符）
    if (top.interp && c === "}" && top.depth === 0) {
      stack.pop();
      mask[i] = 1;
      i++;
      continue;
    }
    if (top.interp && c === "{") {
      top.depth++;
      mask[i] = 1;
      i++;
      continue;
    }
    if (top.interp && c === "}") {
      top.depth--;
      mask[i] = 1;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      stack.push({ kind: "q", q: c });
      i++;
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "tpl" });
      i++;
      continue;
    }
    mask[i] = 1;
    i++;
  }
  return mask;
}

/**
 * 端点调用点发现（R1-C P1-4 单一真相 walk——export-openapi.mjs scanOpenApiEndpoints 复用，
 * 第二份 define* 扫描 walk 已消灭）。codeMask 过滤注释/字符串/模板文本里的假命中：
 *  ① 注释掉的 defineQuery 不再产幻影端点；② 字符串字面量里的 defineQuery 忽略；
 *  ③ 多行注释区间里失配的 defineQuery 花括号不再外溢——修复前 `re.lastIndex = close + 1`
 * 会把匹配延续到的真实端点整体吞掉（api.ts 缺端点 = 运行时 404 面）。
 * 名字入口即 assertEndpointName（ATR-342，export-openapi 同闸）+ 转义解码 JSON 语义。
 * 返回调用点含两扫描器语义一致的公共投影（live/invalidate/emits/idempotent——单一解析）
 * 与原始 props 文本（超集元数据 auth/cache/timeoutMs/restful 由导出面按自身政策解析）。
 */
export function findEndpointCalls(src) {
  const mask = codeMaskOf(src);
  const calls = [];
  const re = /\bdefine(Query|Command)\b/g;
  for (let m; (m = re.exec(src));) {
    if (!mask[m.index]) continue; // P1-4：注释/字符串/模板文本里的假命中——查位即弃
    const kind = m[1] === "Query" ? "query" : "command";
    const line = src.slice(0, m.index).split("\n").length;
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    // 泛型标注形态 defineCommand<Input, Output>(…)（模板 example.ts / 门禁的应用规范形态）：
    // 跳过平衡的 <…> 类型实参段再找 (——类型段不参与生成面，扁平字面量纪律不受影响
    if (src[i] === "<") {
      const closeAngle = matchAngle(src, i);
      if (closeAngle < 0) continue; // 不闭合——诚实跳过（TS 本身编译不过）
      i = closeAngle + 1;
      while (i < src.length && /\s/.test(src[i])) i++;
    }
    if (src[i] !== "(") continue; // 形态不符——诚实跳过
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '"' && src[i] !== "'" && src[i] !== "`") continue; // 非字面量名——诚实跳过
    const q = src[i];
    i++;
    const nameStart = i;
    while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
    const name = decodeEndpointName(src.slice(nameStart, i), line);
    assertEndpointName(name, line);
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== ",") continue;
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "{") continue;
    const close = matchDelim(src, i);
    if (close < 0) continue;
    const props = parseProps(src.slice(i + 1, close));

    // live/invalidate/emits/idempotent 两扫描器语义一致——walk 层一次解析（单一真相）
    let live = false;
    let invalidate = null;
    const liveText = props.live;
    if (liveText != null) {
      const stripped = stripComments(liveText).trim();
      if (stripped === "true") live = true;
      else if (stripped.startsWith("{")) {
        live = true;
        const objBody = matchDelim(stripped, 0);
        if (objBody > 0) invalidate = stringArrayOf(parseProps(stripped.slice(1, objBody)).invalidate);
      }
    }
    calls.push({
      name,
      kind,
      props,
      line,
      live,
      invalidate,
      emits: stringArrayOf(props.emits),
      idempotent: stripComments(props.idempotent ?? "").trim() === "true",
    });
    re.lastIndex = close + 1; // 越过本次调用体（handler 内不会嵌套 define*；防御性前进——
    // 掩码保证注释/字符串里的 define* 假命中不再进入解析，lastIndex 越界吞真实端点的 bug 随之消失）
  }
  return calls;
}

/**
 * 扫一个端点源文件的 defineQuery/defineCommand 调用（扁平字面量形态）——走 findEndpointCalls
 * 单一真相 walk（掩码/名字闸/公共元数据解析单点）。
 *
 * opts（缺省 = 原行为零变化；与 export-openapi.mjs scanOpenApiEndpoints 同名同义——文件头互相指认）：
 *   allowInlineLiterals — 端点级内联契约字面量放行解析（gen auth 产物形态：自包含生成码，
 *                         contract/output 就地扁平字面量；src/server/endpoints/ 用户端点面
 *                         维持原禁令——契约提升单源纪律不变）。合成名 `<name>.input/.output`
 *                         （M7-C openapi 导出同款先例），解析值随 contractFlat/outputFlat 带出；
 *                         解析失败 → 该侧 ident 置 null + unresolved 记账（诚实降级，绝不猜）；
 *                         未放行面的行内字面量记 inlineLiterals（导出面据其定政策：显式报错）。
 *   localSchemas        — 本地标识符 → FlatSchema 值（resolveLocalPickTypes 解析产物）；
 *                         命中时该侧转合成名 + flat（pick 本地投影，auth.me 形态）。
 */
export function scanEndpointSource(src, opts = {}) {
  const { allowInlineLiterals = false, localSchemas = null } = opts;
  const out = [];
  for (const call of findEndpointCalls(src)) {
    const { name, kind, props, line, live, invalidate, emits, idempotent } = call;

    // 契约取值三形态：本地 pick 投影（标识符命中 localSchemas）> 内联字面量（仅放行面）>
    // 契约单源标识符（原路径）。auth 元数据（auth: { type: "none" } 等）不在取值键内——
    // parseProps 捕获后无人读即天然容忍（对本生成器无影响）。
    const unresolved = [];
    const inlineLiterals = [];
    let contract = identOf(props.contract);
    let output = identOf(props.output);
    let contractFlat = null;
    let outputFlat = null;
    for (const role of ["contract", "output"]) {
      const raw = props[role];
      const stripped = raw != null ? stripComments(raw).trim() : null;
      const ref = role === "contract" ? contract : output;
      if (localSchemas != null && ref != null && localSchemas[ref] != null) {
        if (role === "contract") {
          contractFlat = localSchemas[ref];
          contract = `${name}.input`;
        } else {
          outputFlat = localSchemas[ref];
          output = `${name}.output`;
        }
      } else if (stripped != null && stripped.startsWith("{")) {
        if (!allowInlineLiterals) {
          // 用户端点面行内字面量不识别（契约提升单源纪律，诚实边界）——记账供导出面定政策
          inlineLiterals.push(role);
          continue;
        }
        // 行内字面量（可带 as const / satisfies 后缀——matchDelim 取平衡段，后缀自然忽略）
        const litClose = matchDelim(stripped, 0);
        if (litClose < 0) {
          unresolved.push(role); // 括号不闭合——TS 本身编译不过，诚实记账
          continue;
        }
        try {
          const flat = parseFlatValue(stripped.slice(0, litClose + 1), `端点 ${name} 的 ${role}`);
          if (role === "contract") {
            contractFlat = flat;
            contract = `${name}.input`;
          } else {
            outputFlat = flat;
            output = `${name}.output`;
          }
        } catch {
          unresolved.push(role); // 解析失败（展开/计算值/插值越界）——诚实降级，绝不猜
        }
      }
    }
    out.push({
      name,
      kind,
      contract,
      output,
      contractFlat,
      outputFlat,
      unresolved,
      inlineLiterals,
      live,
      invalidate,
      emits,
      idempotent,
      hasTimeout: props.timeoutMs != null,
      line,
    });
  }
  return out;
}

/**
 * 扫端点文件面：src/server/endpoints/ 递归 .ts + src/server/auth/endpoints.ts（gen auth 产物
 * 三件套，加法语义——存在才扫，文件不存在时行为零变化）。auth 面放行内联契约字面量与
 * pick 本地投影解析（产物三形态，见 scanEndpointSource/resolveLocalPickTypes）；端点按 name
 * 排序（file 为相对路径；authSurface 位标记产物来源——api.ts 投影段与 JSDoc 消费）。
 */
export function scanEndpoints(root) {
  const dir = path.join(root, "src", "server", "endpoints");
  const authFile = path.join(root, "src", "server", "auth", "endpoints.ts");
  const all = [];
  for (const file of walkTsFiles(dir)) {
    const src = fs.readFileSync(file, "utf8");
    for (const ep of scanEndpointSource(src)) {
      all.push({ ...ep, file: path.relative(root, file).split(path.sep).join("/") });
    }
  }
  if (fs.existsSync(authFile)) {
    const src = fs.readFileSync(authFile, "utf8");
    const { flats, failures } = resolveLocalPickTypes(authFile, src);
    for (const ep of scanEndpointSource(src, { allowInlineLiterals: true, localSchemas: flats })) {
      // pick 投影失败定向记账（键漂移等）——该侧照旧走契约单源路径（红检传导），note 可导航
      const pickFailures = {};
      for (const role of ["contract", "output"]) {
        if (ep[role] && failures[ep[role]]) pickFailures[role] = failures[ep[role]];
      }
      all.push({
        ...ep,
        authSurface: true,
        ...(Object.keys(pickFailures).length > 0 ? { pickFailures } : {}),
        file: path.relative(root, authFile).split(path.sep).join("/"),
      });
    }
  }
  return all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/* ---------- ② 契约单源扫描 ---------- */

/** 扫 <root>/src/contract.ts 的 export const <ident> = { —— 契约常量标识符（声明序） */
export function scanContracts(root) {
  const file = path.join(root, "src", "contract.ts");
  if (!fs.existsSync(file)) return { file: "src/contract.ts", exists: false, idents: [] };
  const src = fs.readFileSync(file, "utf8");
  const idents = [];
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\{/g;
  for (let m; (m = re.exec(src));) idents.push(m[1]);
  return { file: "src/contract.ts", exists: true, idents };
}

/* ---------- ③ specs 端点意图段扫描（§7.4） ---------- */

/**
 * 扫 <root>/specs/*.md 的 ## 端点意图 段。行格式：
 *   - <name>（<kind>…）：描述        ← 全角括号/冒号；kind 含 live 记 live 位
 */
export function scanSpecIntents(root) {
  const dir = path.join(root, "specs");
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const src = fs.readFileSync(path.join(dir, e.name), "utf8");
    const lines = src.split("\n");
    let inSection = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s/.test(line)) {
        inSection = /^##\s*端点意图/.test(line.trim());
        continue;
      }
      if (!inSection) continue;
      const m = /^-\s*([A-Za-z][\w.-]*)\s*（([^）]*)）\s*[:：]?\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const kindText = m[2] ?? "";
      out.push({
        name: m[1],
        kind: kindText.includes("command") ? "command" : "query",
        live: kindText.includes("live"),
        desc: (m[3] ?? "").trim(),
        file: `specs/${e.name}`,
        line: i + 1,
      });
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/* ---------- 产物生成 ---------- */

/** 端点名 → PascalCase（"chat.ask" → "ChatAsk"，类型别名用）。派生不出合法标识符 = ATR-342
 * （P1-8 派生闸：绝不产出 `type 1Input` 形态的编译不过产物）。 */
function pascalOf(name) {
  const p = name
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
  if (!DERIVED_IDENT_RE.test(p)) {
    die("ATR-342", `端点 ${name} 派生不出合法 TS 标识符（PascalCase → 「${p}」）`, '改端点名使其 PascalCase 化后是合法标识符，如 "chat.ask" → ChatAsk');
  }
  return p;
}

/** 端点名 → camelCase 导出标识符（"chat.ask" → "chatAsk"——§4.4 样例形态，调用点 .call(/.live( 的静态可 grep 面）。
 * 产物是独立导出名（export const <c>）——撞 JS 保留字（如端点名 "delete"）= 生成物编译不过，ATR-342 拦截（P1-8）。 */
function camelOf(name) {
  const p = pascalOf(name);
  const c = p[0].toLowerCase() + p.slice(1);
  if (!DERIVED_IDENT_RE.test(c) || RESERVED_WORDS.has(c)) {
    die("ATR-342", `端点 ${name} 派生不出合法导出标识符（camelCase → 「${c}」${RESERVED_WORDS.has(c) ? "——撞 JS 保留字" : ""}）`, '改端点名避免派生出保留字或非法标识符，如 "chat.ask" → chatAsk');
  }
  return c;
}

/** 相对 import 路径（posix 分隔；同目录补 ./） */
function relImport(fromDir, toFile) {
  let rel = path.relative(fromDir, toFile).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

/** JSDoc 注入消毒（R1-C）：用户可控文本（--mount、specs 描述）直插块注释前的破坏序列中性化——
 *  星号+斜杠会提前闭合注释，把注释后半变成顶层代码（破碎产物落盘）；中性化写法「星号+反斜杠+斜杠」
 *  是注释内的标准转义（JSDoc 渲染不变，注释结构完整）。端点名经 ATR-342 字符集闸（无星与斜杠）天然安全。 */
function jsDocSafe(text) {
  return String(text).replaceAll("*/", "*\\/");
}

/**
 * 生成 src/generated/api.ts 文本（纯函数——不落盘，字节确定性由排序与定长模板保证）。
 * opts: { mount?: string }
 */
export function generateApi(root, opts = {}) {
  const mount = "/" + String(opts.mount ?? "/api").replace(/^\/+|\/+$/g, "");
  const endpoints = scanEndpoints(root);
  // 端点重名闸（R1-C，镜像运行时 EndpointRegistry.register() ATR-313）：重名端点会产出重复
  // type 别名与重复 export const 的语法破碎 api.ts——生成器侧先 die，诊断带两处声明位置。
  const seenEndpoints = new Map();
  for (const e of endpoints) {
    const prev = seenEndpoints.get(e.name);
    if (prev != null) {
      const loc = (x) => (x.file != null ? `${x.file}:${x.line}` : `第 ${x.line} 行`);
      die(
        "ATR-313",
        `端点重复注册：${e.name}（${loc(prev)} 与 ${loc(e)}——生成器侧镜像运行时 register() 语义；重名会产出语法破碎的 api.ts）`,
        `换名或先移除其一（运行时 register() 对重名同样 ATR-313 硬错）；本次扫描到的端点：${endpoints.map((x) => x.name).join(", ")}`
      );
    }
    seenEndpoints.set(e.name, e);
  }
  // P2-G2 派生标识符撞名闸：精确重名闸只挡同名——chat.ask / chat-ask / chat_ask 派生同
  // ChatAsk，api.ts 会重复声明 type 别名与 export const（编译不过，恰是上方重名闸 die 文案
  // 要防的终态）。产产物前对 pascalOf 派生建 seen-set（camel 只差首字母大小写，撞 pascal ⟺
  // 撞 camel）；撞名 ATR-313 四段式 die 列两个源名（gen-db:591-598 函数名撞名闸同型先例）。
  const seenDerived = new Map();
  for (const e of endpoints) {
    const p = pascalOf(e.name);
    const prev = seenDerived.get(p);
    if (prev != null) {
      die(
        "ATR-313",
        `端点 ${prev} 与 ${e.name} 派生出同一 TS 标识符（${p}Input/${p}Output/${p}Call 等）——api.ts 会重复声明编译不过（生成器侧镜像运行时 ATR-313 语义）`,
        `改其一端点名使 PascalCase 化后不同名（如 chat-ask → chat.reply）；本次扫描到的端点：${endpoints.map((x) => x.name).join(", ")}`
      );
    }
    seenDerived.set(p, e.name);
  }
  const contracts = scanContracts(root);
  const genDir = path.join(root, "src", "generated");
  const notes = [];
  if (!contracts.exists) notes.push("未找到 src/contract.ts（契约单源）——生成物将缺类型 import");

  // 契约单源 import 面只收真实标识符——auth 面合成名（contractFlat/outputFlat 非空）不进；
  // pick 投影失败侧不是合成名：照旧走单源路径传导红检（§7.3 门禁四），note 定向记账不重复
  const isSynthetic = (e, role) => e[`${role}Flat`] != null;
  const usedIdents = [
    ...new Set(
      endpoints
        .flatMap((e) => ["contract", "output"].map((role) => (isSynthetic(e, role) ? null : e[role])))
        .filter(Boolean),
    ),
  ].sort();
  for (const e of endpoints) {
    for (const role of ["contract", "output"]) {
      if (!e[role] || isSynthetic(e, role)) continue; // 合成名/解析失败侧不查单源声明
      if (e.pickFailures?.[role]) {
        notes.push(`端点 ${e.name} 的 ${role} 本地 pick 投影 ${e[role]} 解析失败：${e.pickFailures[role]}——按契约单源未声明处理（检查 src/server/auth/endpoints.ts 与同级表定义）`);
        continue;
      }
      if (contracts.exists && !contracts.idents.includes(e[role])) {
        notes.push(`端点 ${e.name} 的 ${role} 引用 ${e[role]}，但契约单源未声明该常量（生成物仍导入——以运行时契约校验为准）`);
      }
    }
    for (const role of e.unresolved ?? []) {
      notes.push(`端点 ${e.name} 的 ${role} 内联契约字面量解析失败（auth 面放行形态）——该侧类型回退为 ${role === "contract" ? "Record<string, unknown>" : "unknown"}（诚实降级，运行时契约校验为准）`);
    }
  }
  const hasLive = endpoints.some((e) => e.live);
  const hasFlatTyped = endpoints.some((e) => ["contract", "output"].some((role) => e[role] && !isSynthetic(e, role)));
  const authEps = endpoints.filter((e) => e.authSurface);
  const contractImportPath = relImport(genDir, path.join(root, "src", "contract.ts"));
  const runtimeImportPath = relImport(genDir, path.join(root, "src", "vendor", "atelier", "runtime", "index.ts"));

  const L = [];
  L.push(`// @atelier-generated（gen endpoint）—— regen 全量重写，手改会被覆盖（FS-DESIGN §7.2 产物纪律）`);
  // 头注释条件发射：无 gen auth 产物时与既有应用产物字节全同（加法语义零漂移——regen 不产生无关 churn）
  if (authEps.length > 0) {
    L.push(`// 类型投影：用户端点面自契约单源（FlatOf）；auth 面自 gen auth 产物投影（下方 auth 投影段——`);
    L.push(`// 生成器渲染非手写，M7-C 合成名先例）。本文件零手写业务类型（双源 = ERROR）。`);
  } else {
    L.push(`// 类型全部投影自契约单源（FlatOf）+ 端点注册表元数据；本文件零手写业务类型（双源 = ERROR）。`);
  }
  L.push(`// 诚实边界：call 只做传输与错误透传（非 2xx 直接抛响应体 = ATR 四段式，fix 可执行）；`);
  L.push(`// live 失效-重算-推送的服务端引擎归 FS-7——本客户端按 §4.3 SSE 线协议消费。`);
  L.push(``);
  // FlatOf 定义在框架 server 面（db.ts）——绝不要求应用契约单源转出口（生成器自闭合，§7.2）
  const vendorServerImportPath = relImport(genDir, path.join(root, "src", "vendor", "atelier", "server", "index.ts"));
  if (usedIdents.length > 0) L.push(`import { ${usedIdents.join(", ")} } from "${contractImportPath}";`);
  if (hasFlatTyped) L.push(`import type { FlatOf } from "${vendorServerImportPath}";`);
  if (hasLive) L.push(`import { streamValue } from "${runtimeImportPath}";`);
  if (usedIdents.length > 0 || hasLive || hasFlatTyped) L.push(``);

  // 类型别名——用户端点面：FlatOf 单源投影（契约单源 import，§8.1 零内联重复类型）；按端点名排序
  for (const e of endpoints) {
    if (e.authSurface) continue;
    const base = pascalOf(e.name);
    if (e.contract) L.push(`type ${base}Input = FlatOf<typeof ${e.contract}>;`);
    if (e.output) L.push(`type ${base}Output = FlatOf<typeof ${e.output}>;`);
  }
  // auth 投影段（显式区块）：gen auth 产物投影——auth 契约单源 = gen auth 产物自身（端点级内联
  // 字面量 + users 表 pick 投影），不在应用 src/contract.ts，故类型由生成器渲染为内联别名。
  // §8.1「双源 = ERROR」红线不破：禁的是手写重复类型，此处是生成器对单一真相（gen auth 产物）
  // 的投影，regen 全量重写、与用户面 FlatOf 同为「产物投影」；合成名先例 = M7-C openapi 导出
  // （auth.login.input/.output，commit 98d3c10 批）。
  if (authEps.length > 0) {
    L.push(``);
    L.push(`// —— auth 投影段（gen auth 产物投影；M7-C 合成名先例 auth.login.input/.output 同款）——`);
    L.push(`// 来源：src/server/auth/endpoints.ts（gen auth 产物）：① 端点级内联契约字面量（合成 <名>.input/.output）`);
    L.push(`// ② pick(users.rowSchema, […]) 本地表投影（列→TS 映射与 server/db.ts flatFieldType/table/pick 对表）。`);
    L.push(`// 生成器渲染、regen 全量重写——零手写类型；auth 契约单源 = gen auth 产物自身（§8.1 双源红线不破）。`);
    for (const e of authEps) {
      const base = pascalOf(e.name);
      if (e.contract) {
        const rendered = e.contractFlat != null ? flatSchemaToTs(e.contractFlat) : null;
        if (e.contractFlat != null && rendered == null) {
          notes.push(`端点 ${e.name} 的 contract（合成 ${e.contract}）无法渲染为 TS 类型——回退 Record<string, unknown>（诚实降级）`);
        }
        L.push(`type ${base}Input = ${rendered ?? (e.contractFlat != null ? "Record<string, unknown>" : `FlatOf<typeof ${e.contract}>`)};`);
      }
      if (e.output) {
        const rendered = e.outputFlat != null ? flatSchemaToTs(e.outputFlat) : null;
        if (e.outputFlat != null && rendered == null) {
          notes.push(`端点 ${e.name} 的 output（合成 ${e.output}）无法渲染为 TS 类型——回退 unknown（诚实降级）`);
        }
        L.push(`type ${base}Output = ${rendered ?? (e.outputFlat != null ? "unknown" : `FlatOf<typeof ${e.output}>`)};`);
      }
    }
  }
  if (endpoints.some((e) => e.contract || e.output)) L.push(``);

  for (const e of endpoints) {
    const base = pascalOf(e.name);
    const inType = e.contract ? `${base}Input` : "Record<string, unknown>";
    const outType = e.output ? `${base}Output` : "unknown";
    const kindLabel = e.kind === "command" ? "command" : e.live ? "query·live" : "query";
    // auth 面 Set-Cookie 语义：客户端 fetch 同源默认携带 cookie，无需 credentials 特殊处理——
    // login 成功响应的 Set-Cookie 由浏览器存储（HttpOnly），后续请求自动携带、logout 清除
    const authNote = e.authSurface
      ? `；同源 fetch 自动携带会话 cookie（浏览器同源默认携带，无需 credentials 配置）——login 响应 Set-Cookie 由浏览器存储、logout 清除`
      : "";
    L.push(`/** ${e.name}（${kindLabel}${e.authSurface ? "·auth 面" : ""}）—— POST ${jsDocSafe(mount)}/${e.name}${e.live ? `；live SSE GET ${jsDocSafe(mount)}/${e.name}/live（§4.3）` : ""}${authNote} */`);
    L.push(`export const ${camelOf(e.name)} = Object.freeze({`);
    // P1-8：端点名进生成码一律 JSON.stringify 转义（非法字符已在入口/派生闸 die——此处转义是纵深防御）
    L.push(`  name: ${JSON.stringify(e.name)} as const,`);
    L.push(`  async call(input: ${inType}): Promise<${outType}> {`);
    L.push(`    const res = await fetch(${JSON.stringify(`${mount}/${e.name}`)}, {`);
    L.push(`      method: "POST",`);
    L.push(`      headers: { "content-type": "application/json" },`);
    L.push(`      body: JSON.stringify(input),`);
    L.push(`    });`);
    L.push(`    if (!res.ok) throw await res.json(); // 非 2xx = ATR 四段式 { code, message, context, fix }`);
    L.push(`    return (await res.json()) as ${outType};`);
    L.push(`  },`);
    if (e.live) {
      const liveUrl = JSON.stringify(`${mount}/${e.name}/live?input=`); // P1-8：URL 进生成码 JSON.stringify 转义
      L.push(`  /** live 订阅：SSE data → streamValue 三态原语直通；error 事件 → ATR 四段式帧赋 sv.error（§8.3 已落地：订阅保持，不断流） */`);
      L.push(`  live(input: ${inType}) {`);
      L.push(`    const sv = streamValue<${outType}>();`);
      L.push(`    const es = new EventSource(${liveUrl} + encodeURIComponent(JSON.stringify(input)));`);
      L.push(`    es.addEventListener("data", (e) => {`);
      L.push(`      sv.push(JSON.parse((e as MessageEvent).data) as ${outType});`);
      L.push(`    });`);
      L.push(`    es.addEventListener("error", (e) => {`);
      L.push(`      // ATR-321 四段式随 error 事件下行；解析后赋 sv.error（§8.3 error 语义位）——fix 字段由`);
      L.push(`      // UI 直接渲染为可操作提示（错误即导航贯通到最后一厘米），console 呈现退役；`);
      L.push(`      // 订阅保持——下轮写后重算继续推 data，失败不断流。无 data 的 error = 连接级中断，`);
      L.push(`      // EventSource 自动重连。`);
      L.push(`      const d = (e as MessageEvent).data;`);
      L.push(`      if (typeof d === "string" && d.length > 0) {`);
      L.push(`        try {`);
      L.push(`          sv.error = JSON.parse(d) as { code?: string; message: string; context?: unknown; fix?: string };`);
      L.push(`        } catch {`);
      L.push(`          // 非 JSON error 帧——忽略（连接级错误的自动重连由 EventSource 承担）`);
      L.push(`        }`);
      L.push(`      }`);
      L.push(`    });`);
      L.push(`    return Object.freeze({`);
      L.push(`      get values() {`);
      L.push(`        return sv.values;`);
      L.push(`      },`);
      L.push(`      get value() {`);
      L.push(`        return sv.value;`);
      L.push(`      },`);
      L.push(`      get done() {`);
      L.push(`        return sv.done;`);
      L.push(`      },`);
      L.push(`      get error() {`);
      L.push(`        return sv.error;`);
      L.push(`      },`);
      L.push(`      push: (v: ${outType}) => sv.push(v),`);
      L.push(`      finish: () => sv.finish(),`);
      L.push(`      dispose: () => es.close(),`);
      L.push(`    });`);
      L.push(`  },`);
    }
    L.push(`});`);
    L.push(``);
  }

  return { content: L.join("\n").replace(/\n+$/, "\n"), endpoints, notes, mount };
}

/** 把 api.ts 写盘（mkdir -p；返回写入字节数） */
export function writeApi(root, opts = {}) {
  const { content, endpoints, notes, mount } = generateApi(root, opts);
  const file = path.join(root, "src", "generated", "api.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  fs.writeFileSync(file, content, "utf8");
  return { file: path.relative(root, file).split(path.sep).join("/"), bytes: Buffer.byteLength(content), endpointCount: endpoints.length, changed: before !== content, notes, mount };
}

/* ---------- ④ 骨架生成（--from-specs，§7.4 → §7.1 骨架半） ---------- */

/**
 * specs 端点意图 → 端点文件骨架。只为端点文件中未定义的端点生成；
 * 目标 <域>.ts 已存在则永不覆盖（诚实跳过并记 note——补端点由人/agent 手工进行）。
 */
export function generateSkeletons(root) {
  const intents = scanSpecIntents(root);
  const existing = scanEndpoints(root);
  const existingNames = new Set(existing.map((e) => e.name));
  const missing = intents.filter((it) => !existingNames.has(it.name));
  const byDomain = new Map();
  for (const it of missing) {
    const domain = it.name.split(".")[0];
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(it);
  }
  const endpointsDir = path.join(root, "src", "server", "endpoints");
  const written = [];
  const skipped = [];
  for (const [domain, list] of [...byDomain.entries()].sort()) {
    const file = path.join(endpointsDir, `${domain}.ts`);
    const relFile = path.relative(root, file).split(path.sep).join("/");
    if (fs.existsSync(file)) {
      skipped.push({ file: relFile, reason: "已存在的端点文件永不覆盖", endpoints: list.map((x) => x.name) });
      continue;
    }
    const vendorServer = relImport(path.dirname(file), path.join(root, "src", "vendor", "atelier", "server", "index.ts"));
    const L = [];
    L.push(`/**`);
    L.push(` * ${domain} — gen endpoint 骨架（@atelier-generated；明文可改可审计。已存在文件永不覆盖——`);
    L.push(` * 本文件只会生成一次，之后是应用源码）`);
    L.push(` * 意图来源：${list[0].file} ## 端点意图（§7.4）`);
    L.push(` * 诚实 stub：handler 未实现——调用即抛 AtrEndpointError（可编译、可分发、诚实失败 501）。`);
    L.push(` * 契约占位：实现时从 src/contract.ts 挂 contract/output（FlatSchema 单源纪律），再 regen api.ts。`);
    L.push(` */`);
    L.push(`import { AtrEndpointError, defineCommand, endpointError } from "${vendorServer}";`);
    L.push(``);
    for (const it of list) {
      L.push(`/** 意图：${jsDocSafe(it.desc) || "（specs 未写描述——补上，验收命令序列是 specs 三段式纪律）"} */`);
      L.push(`export const ${camelOf(it.name)} = define${it.kind === "command" ? "Command" : "Query"}("${it.name}", {`);
      L.push(`  // contract: /* TODO：从 src/contract.ts 挂输入契约（FlatSchema 单源） */,`);
      if (it.live) L.push(`  // live: { invalidate: ["table:…"] }, /* TODO：显式失效键（键语法 table:<表名> / key:<业务键>） */`);
      L.push(`  handler: async () => {`);
      L.push(`    throw new AtrEndpointError(`);
      L.push(`      endpointError("ATR-320", "端点 ${it.name} 尚未实现（gen endpoint 骨架 stub）", "在 ${relFile} 实现 handler 并挂接 contract/output 契约"),`);
      L.push(`      501`);
      L.push(`    );`);
      L.push(`  },`);
      L.push(`});`);
      L.push(``);
    }
    const content = L.join("\n");
    fs.mkdirSync(endpointsDir, { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    written.push({ file: relFile, endpoints: list.map((x) => x.name) });
  }
  return { intents, existingCount: existing.length, written, skipped };
}

/* ---------- ⑤ 生成物回扫（api.ts 端点名 → 导出标识符映射；impact.mjs 复用） ---------- */

/** 扫 src/generated/api.ts：[{ endpoint, ident, file, line }]——生成物形态即静态可 grep 事实（§2.5 数据源②） */
export function scanApiClient(root) {
  const file = path.join(root, "src", "generated", "api.ts");
  const relFile = path.relative(root, file).split(path.sep).join("/");
  if (!fs.existsSync(file)) return { file: relFile, exists: false, clients: [] };
  const src = fs.readFileSync(file, "utf8");
  const clients = [];
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*Object\.freeze\(\s*\{/g;
  for (let m; (m = re.exec(src));) {
    const close = matchDelim(src, m.index + m[0].length - 1);
    if (close < 0) continue;
    const body = src.slice(m.index + m[0].length, close);
    const nm = /name:\s*"([^"]+)"\s+as\s+const/.exec(body);
    if (nm) clients.push({ endpoint: nm[1], ident: m[1], file: relFile, line: src.slice(0, m.index).split("\n").length });
  }
  return { file: relFile, exists: true, clients };
}

/* ---------- CLI ---------- */

function run() {
  const argv = process.argv.slice(2);
  const getOpt = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = path.resolve(getOpt("--root") ?? process.cwd());
  const mount = getOpt("--mount") ?? "/api";
  const fromSpecs = argv.includes("--from-specs");

  console.log(`gen endpoint → ${root}（mount ${mount}${fromSpecs ? "，from-specs 骨架开" : ""}）`);
  const endpoints = scanEndpoints(root);
  const contracts = scanContracts(root);
  console.log(`  扫描端点文件：${endpoints.length} 个端点（${contracts.exists ? `契约单源 ${contracts.idents.length} 常量` : "契约单源缺失"}）`);
  const authCount = endpoints.filter((e) => e.authSurface).length;
  if (authCount > 0) console.log(`  auth 面已纳入：src/server/auth/endpoints.ts（gen auth 产物投影）——${authCount} 个端点`);
  const api = writeApi(root, { mount });
  console.log(`  写 ${api.file}：${api.endpointCount} 端点 / ${api.bytes} 字节${api.changed ? "" : "（内容未变——regen 幂等）"}`);
  for (const n of api.notes) console.log(`  note: ${n}`);

  if (fromSpecs) {
    const sk = generateSkeletons(root);
    console.log(`  specs 意图 ${sk.intents.length} 条（已定义 ${sk.existingCount}）`);
    for (const w of sk.written) console.log(`  骨架写入 ${w.file}：${w.endpoints.join(", ")}`);
    for (const s of sk.skipped) console.log(`  跳过 ${s.file}：${s.reason}（${s.endpoints.join(", ")}）`);
    if (sk.intents.length === 0) console.log(`  note: specs 未发现 ## 端点意图 段（§7.4 行格式：- <name>（<kind>）：描述）`);
  }
  console.log(`done（诚实清单如上；识别不了的形态记 note 不猜——文件头边界声明）`);
}

/** CLI 壳：四段式诊断上 stderr（error/fix 两行，同 gen-db CLI 形态）+ exit 1，不裸栈崩溃 */
function main() {
  try {
    run();
  } catch (e) {
    console.error(`error: ${e.code ? `${e.code} ` : ""}${e.message}${e.fix ? `\nfix: ${e.fix}` : ""}`);
    process.exit(1);
  }
}

if (INVOKED_DIRECTLY) main();