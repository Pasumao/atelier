#!/usr/bin/env node
/**
 * export-openapi.mjs — `atelier export openapi`（FS-9，FS-DESIGN §13 / §2.4 / §3.4 / §6.4）。
 *
 * 端点面 → openapi-3.0.3 文档；schema 全部走 compiler/project-json.mjs 投影器（§2.4 单管线
 * 三消费之①，绝不另写一套投影）。范围克制（§13）：只导出**端点面**——组件契约/数据契约
 * 不进 OpenAPI（它们有自己的消费面：注册表/MCP/机检）。
 *
 * 端点枚举：复用 gen-endpoint.mjs 的文本扫描原语（parseProps/stripComments/identOf/
 * stringArrayOf/matchDelim/walkTsFiles 加法导出，gen-endpoint 行为零改动、生成产物字节不变）。
 * R1-C（P1-4）起 define* 调用点发现复用 gen-endpoint 的 findEndpointCalls 单一真相 walk
 * （codeMask 注释/字符串掩码 + ATR-342 名字闸 + live/invalidate/emits/idempotent 公共投影单点）——
 * 本文件第二份 define* 扫描 walk（DEFINE_RE + 私有 matchAngle）已消灭，仅保留导出面独有的
 * 超集元数据政策（auth/restful/timeoutMs/cache 值解析与行内字面量禁令）。本文件自己的历史
 * define* walk 曾与 gen-endpoint 各持一份且无掩码（注释掉的 defineQuery 产幻影端点进
 * openapi.json、多行注释区间吞真实端点、坏名字静默导出）——红绿测试钉在 openapi.test.ts。
 * 扫描面：src/server/endpoints/ 递归 + src/server/auth/endpoints.ts（gen auth 产物三件套，
 * 加法语义；openapi-golden auth 联测段先红后绿钉住）。泛型标注形态 defineCommand<Input, Output>(…)
 * （模板 example.ts / gen-compile-gate 的应用规范形态）与裸调用形态 defineCommand(…) 都认——
 * golden 机检（tests/openapi-golden.test.ts）先红后绿钉住：泛型形态曾整端点漏导出（文档漏端点 =
 * naive 文档驱动的机检盲区）。gen auth 产物三形态专项解析（同批红绿）：①端点级内联契约字面量
 * （仅 auth 扫描面放行，合成名 <name>.input/.output；用户端点面禁令不变）②auth.me 的
 * pick(users.rowSchema, […]) 本地投影（resolveLocalPickSchemas 经框架 server/db.ts 的 table()/pick()
 * 运行时同一实现重构）③auth: { type: "none" } 显式免鉴权 → 无 security 引用不进 securitySchemes；
 * securitySchemes.session 的 cookie 名实读 gen auth 产物 cookie.ts 的 SESSION_COOKIE。
 *
 * 契约取值：src/contract.ts 契约单源（`export const X = {…}` 形态，兼容 `: FlatSchema =` 注解
 * 与 `satisfies FlatSchema` 后缀）——纯文本扫描 + parseLiteral 字面量解析（gen-db.mjs 同款纪律：
 * 对象字面量 → JS 值，无 eval、无 TS 解析器、扫描器不执行被扫代码）。端点内联契约字面量
 * 在 src/server/endpoints/ 用户端点面不支持（gen endpoint 扫描器同边界）→ 显式报错指路契约单源；
 * 仅 gen auth 产物扫描面按上段放行。
 *
 * 文档形态：
 *   paths        默认 POST（请求体 = 输入契约投影；响应 200 = 输出契约投影；无 output 契约
 *                的端点响应 schema 省略 + description 注记 + x-atelier-output-contract:false）；
 *   restful: true（§3.4 互操作位，默认关）→ 该 query 端点映射 GET + reqProps/optProps →
 *                query parameters（运行时 GET 分发已启用——决策 34，2026-09-29 差距批 A7：
 *                文档位与运行时分发自此同源双真）；
 *   auth         → components.securitySchemes（session → cookie apiKey 位；apikey → apiKeyAuth
 *                header 位〔A6 决策 30〕；oauth 只预留命名空间占位声明不实现 §6.4；其余类型显式
 *                报错）；端点 → security 引用；
 *   idempotent/timeoutMs/live/kind → x-atelier-* 扩展字段；
 *   cache（A5 决策 33）→ x-atelier-cache extension（声明了才出现——"none" 字符串或
 *                { visibility, maxAge } 对象原样；未声明端点投影零变化。响应头 Cache-Control
 *                的 OpenAPI headers 投影 v1 不做，留门——见 FS-DESIGN §2.2 落地注记/决策 33）；
 *   info.title   取 --name 或应用 package.json name 或目录名。
 *
 * CLI：node atelier/gen/export-openapi.mjs --root <appDir> [--out openapi.json] [--mount /api] [--name <Title>]
 * 库形态：export buildOpenApi / writeOpenApi / scanOpenApiEndpoints / scanOpenApiEndpointFiles /
 * scanContractSchemas / parseFlatSchemaLiteral（测试与后续 MCP/OpenAPI 消费面复用同一扫描器）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { matchDelim, stripComments, identOf, walkTsFiles, findEndpointCalls, decodeEscapesCore } from "./gen-endpoint.mjs";
import { projectJsonSchema, projectFlatField } from "../compiler/project-json.mjs";
// gen auth 产物形态的本地契约解析用（运行时同一实现——绝不复刻列→FlatSchema 映射，gen-auth.mjs
// 直 import server/db.ts 渲染 DDL 同一先例）：table() 重构表定义 → pick() 投影 rowSchema 子集。
import { table as defineTable, pick as pickRowSchema } from "../server/db.ts";

const INVOKED_DIRECTLY = process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

/** 库形态结构化错误（message + fix 四段式半边；CLI 打印两行，测试断言 message/fix） */
function exportError(message, fix, context = {}) {
  return Object.assign(new Error(message), { fix, context });
}

/* ---------- 契约单源字面量解析（gen-db.mjs parseLiteral 同款纪律：无 eval、无 TS 解析器） ---------- */

class LiteralParseError extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

function litDie(message, fix) {
  throw new LiteralParseError(message, fix);
}

/** 顶层分隔符切分（状态感知：括号/字符串内的分隔符不算——gen-db splitTopLevel 同构） */
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


/** 字符串字面量解析（禁插值/拼接——内容含未转义同种引号或 ${ 即错，与 gen-db 同口径）。
 *  转义解码 = JSON.parse 语义（R1-C §4.7：此前仅映射 \n/\t，\u4e2d 解成 "u4e2d"） */
function parseStringLiteral(text, what) {
  const t = text.trim();
  const q = t[0];
  if ((q === '"' || q === "'" || q === "`") && t.length >= 2 && t[t.length - 1] === q) {
    const inner = t.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "\\") { i++; continue; }
      if (inner[i] === q) litDie(`${what}：字符串字面量含未转义的 ${q}（拼接/多段字面量超出扁平字面量纪律，§2.1）`, "写成单个普通字符串字面量");
    }
    if (q === "`" && inner.includes("${")) litDie(`${what}：模板字符串插值超出扁平字面量纪律（§2.1）`, "写成普通字符串字面量");
    const dec = decodeEscapesCore(inner);
    if (!dec.ok) litDie(`${what}：${dec.error}`, "字面量转义只认 JSON 转义集（\\n \\t \\r \\b \\f 引号 反斜杠 斜杠 \\uXXXX）——越界转义超出扁平字面量纪律（§2.1）");
    return dec.value;
  }
  litDie(`${what}：期望字符串字面量，实际「${t.slice(0, 60)}」`, "契约必须是普通对象字面量（扁平纪律，§2.1）——禁计算值/展开/函数调用");
}

/** 对象字面量 → { key: 原始文本片段 }（键必须是标识符；值文本留给上层按需解析） */
function parseObjectEntries(text, what) {
  const t = text.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) {
    litDie(`${what}：期望对象字面量，实际「${t.slice(0, 60)}」`, "契约必须是普通对象字面量（扁平纪律，§2.1）");
  }
  const entries = [];
  for (const part of splitTopLevel(t.slice(1, -1))) {
    if (part.trim() === "") continue;
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(part);
    if (!m) litDie(`${what}：无法解析的对象条目「${part.trim().slice(0, 60)}」（键必须是标识符）`, "扁平字面量纪律（§2.1）：键 = 标识符，值 = 直接字面量（禁展开/简写/计算键）");
    entries.push({ key: m[1], valueText: m[2] });
  }
  return entries;
}

/** 任意字面量解析：string | number（含 10_000 分隔符/小数/指数）| boolean | null | 数组 | 对象（递归） */
export function parseFlatLiteral(text, what) {
  const t = text.trim();
  if (t === "") litDie(`${what}：空的字面量`, "补齐契约定义（扁平纪律，§2.1）");
  const q = t[0];
  if (q === '"' || q === "'" || q === "`") return parseStringLiteral(t, what);
  if (/^[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?$/.test(t)) return Number(t.replace(/_/g, ""));
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) litDie(`${what}：数组字面量未闭合`, "检查契约语法");
    return splitTopLevel(t.slice(1, -1)).map((s) => s.trim()).filter((s) => s.length > 0).map((s) => parseFlatLiteral(s, what));
  }
  if (t.startsWith("{")) {
    const obj = {};
    for (const { key, valueText } of parseObjectEntries(t, what)) {
      obj[key] = parseFlatLiteral(valueText, `${what}.${key}`);
    }
    return obj;
  }
  litDie(
    `${what}：无法静态解析的字面量「${t.slice(0, 60)}」`,
    "扁平字面量纪律（§2.1）：契约只能是普通对象字面量与直接字面量——禁计算值/展开/函数调用/标识符引用"
  );
}

/** FlatSchema 专用包装（what 带契约名，报错可导航） */
export function parseFlatSchemaLiteral(text, what) {
  return parseFlatLiteral(text, what);
}

/* ---------- ① 契约单源扫描（src/contract.ts） ---------- */

const CONTRACT_RE = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\{/g;

/**
 * 扫 <root>/src/contract.ts 的对象字面量常量 → { file, exists, idents, byIdent }。
 * byIdent[ident] = { value } 或 { error }（解析失败惰性留存——只有被端点引用才报错，
 * 契约单源里的非 schema 常量/注释示例不拖累导出）。
 */
export function scanContractSchemas(root) {
  const file = path.join(root, "src", "contract.ts");
  const relFile = "src/contract.ts";
  if (!fs.existsSync(file)) return { file: relFile, exists: false, idents: [], byIdent: {} };
  const src = fs.readFileSync(file, "utf8");
  const idents = [];
  const byIdent = {};
  CONTRACT_RE.lastIndex = 0;
  for (let m; (m = CONTRACT_RE.exec(src));) {
    const ident = m[1];
    if (ident in byIdent) continue; // 重复声明按首个为准（TS 本身会报重复——扫描器不猜）
    idents.push(ident);
    const openPos = m.index + m[0].length - 1;
    const closePos = matchDelim(src, openPos);
    if (closePos < 0) {
      byIdent[ident] = { error: exportError(`契约常量 ${ident}：对象字面量括号不闭合`, "检查 src/contract.ts 语法（括号必须配对，扁平纪律 §2.1）") };
      continue;
    }
    const bodyText = src.slice(openPos, closePos + 1);
    try {
      byIdent[ident] = { value: parseFlatSchemaLiteral(bodyText, `契约 ${ident}`) };
    } catch (e) {
      byIdent[ident] = { error: e };
    }
  }
  return { file: relFile, exists: true, idents, byIdent };
}

/* ---------- ② 端点文件扫描（超集元数据：auth/restful/timeoutMs 值） ---------- */

/**
 * 数字值文本解析（timeoutMs：允许 10_000 数值分隔符；非数字字面量 → 显式错）
 */
function parseNumberMeta(valueText, what) {
  const t = stripComments(valueText ?? "").trim();
  if (!/^[+-]?\d[\d_]*$/.test(t)) {
    throw exportError(`${what}：必须是数字字面量，实际「${t.slice(0, 40)}」`, "写成普通数字字面量（如 10000 或 10_000）——计算值超出扫描器能力（§2.1 扁平纪律）");
  }
  return Number(t.replace(/_/g, ""));
}

/** auth 元数据解析：只认内联对象字面量 { type: "…", ... }；标识符引用/计算值 → 显式错 */
function parseAuthMeta(valueText, endpointName) {
  const t = stripComments(valueText ?? "").trim();
  if (!t.startsWith("{")) {
    throw exportError(
      `端点 ${endpointName} 的 auth 声明必须是内联对象字面量 { type: "…" }，实际「${t.slice(0, 40)}」`,
      "写成内联字面量（如 auth: { type: \"session\" }）——auth 元数据是文档化契约位，引用变量超出导出扫描器能力"
    );
  }
  const close = matchDelim(t, 0);
  if (close < 0) throw exportError(`端点 ${endpointName} 的 auth 对象字面量括号不闭合`, "检查端点文件语法");
  const auth = parseFlatSchemaLiteral(t.slice(0, close + 1), `端点 ${endpointName} 的 auth`);
  if (typeof auth.type !== "string") {
    throw exportError(`端点 ${endpointName} 的 auth.type 必须是字符串`, "写成 auth: { type: \"session\" }（EndpointAuthMeta 形态）");
  }
  return auth;
}

/**
 * cache 元数据解析（A5 差距批，决策 33）：只认内联字面量 "none"（显式零档）或
 * { visibility, maxAge } 对象；标识符引用/计算值 → 显式错（parseAuthMeta 同款纪律）。
 * 形状合法性（visibility 两值/maxAge 非负整数/未知键）由运行时 register() assertCacheMeta
 * 权威校验——扫描器只做忠实提取不重复立口径（gen-db parseSchema 解析后回灌 defineTable 复验
 * 同款「单一真相」纪律）；对象内部经 parseFlatLiteral 扁平字面量解析（无 eval、无 TS 解析器）。
 */
function parseCacheMeta(valueText, endpointName) {
  const t = stripComments(valueText ?? "").trim();
  if (/^(["'`])none\1$/.test(t)) return "none";
  if (t.startsWith("{")) {
    const close = matchDelim(t, 0);
    if (close < 0) throw exportError(`端点 ${endpointName} 的 cache 对象字面量括号不闭合`, "检查端点文件语法");
    return parseFlatLiteral(t.slice(0, close + 1), `端点 ${endpointName} 的 cache`);
  }
  throw exportError(
    `端点 ${endpointName} 的 cache 声明必须是内联字面量（"none" 或 { visibility, maxAge } 对象），实际「${t.slice(0, 40)}」`,
    "写成内联字面量（如 cache: { visibility: \"public\", maxAge: 60 }）——cache 元数据是文档化契约位，引用变量超出导出扫描器能力"
  );
}

/**
 * 扫一个端点源文件的 defineQuery/defineCommand → OpenAPI 超集端点清单。
 * 调用点发现复用 gen-endpoint 的 findEndpointCalls 单一真相 walk（R1-C P1-4：codeMask 掩码 +
 * ATR-342 名字闸 + live/invalidate/emits/idempotent 公共投影单点——本文件不再持第二份 walk）；
 * 本函数只保留导出面独有的超集元数据政策与契约取值政策。
 * 行内契约对象字面量不支持 → 显式报错（绝不静默猜）。
 *
 * opts（默认缺省 = 原行为零变化）：
 *   allowInlineLiterals — 端点级内联契约字面量放行解析（gen auth 产物形态：自包含生成码，
 *                         contract/output 就地扁平字面量；src/server/endpoints/ 用户端点维持
 *                         原禁令——契约提升单源纪律不变）。合成 schema 名 `<name>.input/.output`。
 *   localSchemas        — 本地标识符 → FlatSchema（gen auth 产物 `const meOutput = pick(…)` 的
 *                         resolveLocalPickSchemas 解析产物）；命中时合成名进文档、flat 随端点带出
 *                         （entry.contractFlat/outputFlat——buildOpenApi 经同一 §2.4 投影管线）。
 *                         R1-C 起与 gen-endpoint 同语义对 contract/output 两role都生效
 *                         （此前仅 output 位——auth 产物只对 output 用 pick，行为面等价）。
 */
export function scanOpenApiEndpoints(src, opts = {}) {
  const { allowInlineLiterals = false, localSchemas = null } = opts;
  const out = [];
  for (const call of findEndpointCalls(src)) {
    const { name, kind, props, line, live, invalidate, emits, idempotent } = call;

    // 内联契约字面量 / 本地解析 schema（仅 opts 放行的扫描面——默认面维持显式报错）
    const local = {};
    for (const role of ["contract", "output"]) {
      const raw = props[role];
      const stripped = raw != null ? stripComments(raw).trim() : null;
      const ref = identOf(raw);
      if (localSchemas != null && ref != null && localSchemas[ref] != null) {
        local[role] = { ident: `${name}.${role === "contract" ? "input" : "output"}`, flat: localSchemas[ref] };
      } else if (stripped != null && stripped.startsWith("{")) {
        if (!allowInlineLiterals) {
          throw exportError(
            `端点 ${name} 的 ${role} 是行内契约对象字面量——OpenAPI 导出不支持（gen endpoint 扫描器同边界）`,
            `把契约提升为 src/contract.ts 契约单源常量（export const … = { type: "object", … }），端点改引用常量名`
          );
        }
        const litClose = matchDelim(stripped, 0);
        if (litClose < 0) continue; // 不闭合——诚实跳过（TS 本身编译不过）
        local[role] = {
          ident: `${name}.${role === "contract" ? "input" : "output"}`,
          flat: parseFlatSchemaLiteral(stripped.slice(0, litClose + 1), `端点 ${name} 的 ${role}`),
        };
      }
    }

    const timeoutText = props.timeoutMs;
    const timeoutMs = timeoutText != null ? parseNumberMeta(timeoutText, `端点 ${name} 的 timeoutMs`) : null;
    const auth = props.auth != null ? parseAuthMeta(props.auth, name) : null;
    const cache = props.cache != null ? parseCacheMeta(props.cache, name) : null; // A5 决策 33：声明了才投影（未声明 = null）
    const restful = stripComments(props.restful ?? "").trim() === "true";
    if (restful && kind !== "query") {
      throw exportError(
        `端点 ${name} 是 command，却声明 restful: true`,
        "restful GET 分发位（§3.4，决策 34）只许 query 端点声明——写端点保持 POST（读写二分纪律）；运行时 EndpointRegistry.register() 同规则硬错（ATR-313），本处为导出面同口径拦截"
      );
    }

    out.push({
      name,
      kind,
      contract: local.contract?.ident ?? identOf(props.contract),
      output: local.output?.ident ?? identOf(props.output),
      contractFlat: local.contract?.flat ?? null,
      outputFlat: local.output?.flat ?? null,
      live,
      invalidate,
      emits,
      idempotent,
      timeoutMs,
      auth,
      cache,
      restful,
      line,
    });
  }
  return out;
}

/**
 * gen auth 产物形态窄解析：端点源内 `const <id> = pick(<tbl>.rowSchema, […])` 的本地契约投影。
 * `<tbl>` 经同文件 import 映射到同级 .ts 产物（sessions.table.ts），表定义以扁平字面量解析后经
 * 框架 server/db.ts 的 table()/pick() 重构（运行时同一实现——列→FlatSchema 映射零复刻）。
 * 窄边界（诚实）：只认这一种生成形态（扁平字面量表 + 同级 .ts import）；其余形态不进本解析，
 * 标识符照旧走契约单源解析（未声明 → 聚合报错）。解析失败惰性跳过（buildOpenApi 侧引用报错兜底）。
 */
function resolveLocalPickSchemas(file, src) {
  const flats = {};
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
    if (!rel) continue;
    const tableFile = path.resolve(path.dirname(file), rel);
    if (!fs.existsSync(tableFile)) continue;
    try {
      const tsrc = fs.readFileSync(tableFile, "utf8");
      const tm = /\btable\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*,\s*\{/.exec(tsrc);
      if (!tm) continue;
      const colsOpen = tm.index + tm[0].length - 1;
      const colsClose = matchDelim(tsrc, colsOpen);
      if (colsClose < 0) continue;
      const optsM = /^\s*,\s*\{/.exec(tsrc.slice(colsClose + 1));
      let optsClose = -1;
      let optsText = "{}";
      let tailFrom = colsClose + 1;
      if (optsM) {
        const optsOpen = colsClose + 1 + optsM[0].length - 1;
        optsClose = matchDelim(tsrc, optsOpen);
        if (optsClose < 0) continue;
        optsText = tsrc.slice(optsOpen, optsClose + 1);
        tailFrom = optsClose + 1;
      }
      if (!/^\s*\)/.test(tsrc.slice(tailFrom))) continue; // table( 参数段未按预期闭合——窄边界外
      const name = (tm[2] ?? "").replace(/\\(.)/g, "$1"); // 引号内表名（DDL 标识符白名单由 defineTable 校验）
      const cols = parseFlatSchemaLiteral(tsrc.slice(colsOpen, colsClose + 1), `表定义 ${name}`);
      const tableOpts = parseFlatSchemaLiteral(optsText, `表定义 ${name} opts`);
      const def = defineTable(name, cols, tableOpts);
      flats[constIdent] = pickRowSchema(def.rowSchema, parseFlatSchemaLiteral(m[3], `pick 键集（${constIdent}）`));
    } catch {
      /* 惰性：形态漂移/解析失败不在此报——标识符走契约单源解析路径，未声明即聚合报错 */
    }
  }
  return flats;
}

/**
 * 扫端点文件面：src/server/endpoints/ 递归 + src/server/auth/endpoints.ts（gen auth 产物，加法
 * 语义——存在才扫）。auth 面放行内联契约字面量与 pick 本地投影解析（产物三件套形态，见上）；
 * 返回按 name 排序（file 为相对路径）。
 */
export function scanOpenApiEndpointFiles(root) {
  const dir = path.join(root, "src", "server", "endpoints");
  const authFile = path.join(root, "src", "server", "auth", "endpoints.ts");
  const all = [];
  for (const file of walkTsFiles(dir)) {
    const src = fs.readFileSync(file, "utf8");
    for (const ep of scanOpenApiEndpoints(src)) {
      all.push({ ...ep, file: path.relative(root, file).split(path.sep).join("/") });
    }
  }
  if (fs.existsSync(authFile)) {
    const src = fs.readFileSync(authFile, "utf8");
    const localSchemas = resolveLocalPickSchemas(authFile, src);
    for (const ep of scanOpenApiEndpoints(src, { allowInlineLiterals: true, localSchemas })) {
      all.push({ ...ep, file: path.relative(root, authFile).split(path.sep).join("/") });
    }
  }
  return all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/* ---------- ③ OpenAPI 文档组装 ---------- */

function normalizeMount(mount) {
  return String(mount ?? "/api").replace(/^\/+|\/+$/g, "");
}

/**
 * securitySchemes：session → cookie apiKey 位（cookie 名实读 gen auth 产物 cookie.ts 的
 * SESSION_COOKIE——曾硬编码 "session" 与实际 "atelier_session" 漂移，openapi-golden auth 联测段
 * 对拍抓出后修复；无 gen auth 产物时回退旧通用名）；apikey → apiKeyAuth header 位（A6 最小切口，
 * 2026-09-28，决策 30——name = 端点 auth 声明 header ?? 缺省 x-api-key，description 恒明示装配点
 * 为实际头名权威）；oauth → 预留占位声明（§6.4，不实现）
 */
function securitySchemeFor(auth, cookieName) {
  if (auth.type === "session") {
    return {
      type: "apiKey",
      in: "cookie",
      name: cookieName ?? "session",
      description: "Atelier session 会话 cookie（gen auth 产物定义 Cookie 名——FS-DESIGN §6.2；本位为互操作投影）",
    };
  }
  if (auth.type === "apikey") {
    return {
      type: "apiKey",
      in: "header",
      name: typeof auth.header === "string" && auth.header !== "" ? auth.header : "x-api-key",
      description:
        "Atelier API key（机器客户端通道——FS-DESIGN §6.4 落地注记 2026-09-28，决策 30）：携本头（key 由服务端装配点分发）调用 auth: { type: \"apikey\" } 端点；实际头名以装配点 createHandler({ apiKeys: { header } }) 为准（缺省 x-api-key），端点 auth 声明的 header 字段为文档镜像位",
    };
  }
  if (auth.type === "oauth") {
    return {
      type: "apiKey",
      in: "header",
      name: "Authorization",
      description: "Atelier oauth 预留位（FS-DESIGN §6.4）：类型命名空间已预留、映射未实现——此条目仅占位声明，客户端集成前以框架文档为准",
      "x-atelier-reserved": true,
    };
  }
  throw exportError(
    `不支持的 auth 类型「${auth.type}」（OpenAPI 导出只实现 session/apikey；oauth 为预留占位）`,
    "改用 auth: { type: \"session\" } 或 auth: { type: \"apikey\" }，或在 FS-DESIGN §6.4 落地后再扩展映射"
  );
}

/** gen auth 产物 cookie.ts 的 SESSION_COOKIE 实读（缺产物/解析失败 → null，由调用方回退通用名） */
function sessionCookieName(root) {
  const f = path.join(root, "src", "server", "auth", "cookie.ts");
  if (!fs.existsSync(f)) return null;
  const stripped = stripComments(fs.readFileSync(f, "utf8"));
  const m = /export\s+const\s+SESSION_COOKIE\s*=\s*/.exec(stripped);
  if (!m) return null;
  const tail = stripped.slice(m.index + m[0].length).split(";")[0]?.trim();
  if (!tail) return null;
  try {
    return parseStringLiteral(tail, "SESSION_COOKIE");
  } catch {
    return null;
  }
}

/**
 * 组装 openapi-3.0.3 文档（纯函数——不落盘，字节确定性由排序与定序输出保证）。
 * opts: { mount?, name?, out? }；契约引用不存在/投影 ATR-107 → 聚合抛错（绝不静默降级）。
 */
export function buildOpenApi(root, opts = {}) {
  const mount = normalizeMount(opts.mount);
  const endpoints = scanOpenApiEndpointFiles(root);
  // 端点重名闸（R1-C，镜像运行时 EndpointRegistry.register() ATR-313）：paths[pathKey] 曾静默
  // 后者覆盖——文档与注册表二义。导出面同样 die（绝不静默覆盖），诊断带两处声明位置。
  const seenNames = new Map();
  for (const ep of endpoints) {
    const prev = seenNames.get(ep.name);
    if (prev != null) {
      throw exportError(
        `ATR-313: 端点重复注册：${ep.name}（${prev} 与 ${ep.file}:${ep.line}——生成面镜像运行时 register() 语义）`,
        "换名或先移除其一（重复端点在运行时 register() 同样 ATR-313 硬错）"
      );
    }
    seenNames.set(ep.name, `${ep.file}:${ep.line}`);
  }
  const contracts = scanContractSchemas(root);
  const cookieName = sessionCookieName(root);
  const notes = [];
  if (!contracts.exists) notes.push("未找到 src/contract.ts（契约单源）——端点若声明 contract/output 将无法解析");
  if (endpoints.length === 0) notes.push("未发现端点定义（src/server/endpoints/ 下无 defineQuery/defineCommand）——产出空 paths 文档");

  const errors = [];
  const schemas = {}; // ident → 投影结果（openapi-3.0 target）
  const referencedIdents = new Set();
  const localSchemas = {}; // 合成名 → 本地解析 FlatSchema（gen auth 产物内联字面量/pick 投影——联测校验复用同一解析）
  const resolveSchema = (ident, endpointName, role, flat = null) => {
    if (schemas[ident]) return schemas[ident];
    if (flat != null) {
      // 本地解析路径（gen auth 产物形态）：同一 §2.4 投影管线，绝不另写投影
      try {
        schemas[ident] = projectJsonSchema(flat, "openapi-3.0", { label: ident });
        referencedIdents.add(ident);
        localSchemas[ident] = flat;
        return schemas[ident];
      } catch (e) {
        errors.push(exportError(`端点 ${endpointName} 的 ${role}（本地解析 schema ${ident}）：${e.message}`, e.fix ?? "检查生成产物契约形态", e.context));
        return null;
      }
    }
    if (!contracts.exists || !contracts.idents.includes(ident)) {
      errors.push(
        exportError(
          `端点 ${endpointName} 的 ${role} 引用「${ident}」，但契约单源 ${contracts.file} 未声明该常量` +
            (contracts.exists && contracts.idents.length ? `（现有常量：${contracts.idents.join(", ")}）` : ""),
          `在 src/contract.ts 声明 FlatSchema 常量 export const ${ident} = { type: "object", … }（或修正端点引用；行内字面量不受支持）`
        )
      );
      return null;
    }
    const entry = contracts.byIdent[ident];
    if (entry.error) {
      errors.push(
        exportError(
          `契约常量 ${ident}（${endpointName} 的 ${role}）无法静态解析：${entry.error.message}`,
          entry.error.fix ?? "改写为扁平对象字面量（§2.1 纪律）"
        )
      );
      return null;
    }
    try {
      schemas[ident] = projectJsonSchema(entry.value, "openapi-3.0", { label: ident });
      referencedIdents.add(ident);
      return schemas[ident];
    } catch (e) {
      if (e.code === "ATR-107") {
        errors.push(exportError(`契约 ${ident}（${endpointName} 的 ${role}）：${e.message}`, e.fix, e.context));
      } else {
        errors.push(e);
      }
      return null;
    }
  };

  const paths = {};
  const securitySchemes = {};
  for (const ep of endpoints) {
    const inputSchema = ep.contract ? resolveSchema(ep.contract, ep.name, "contract", ep.contractFlat) : null;
    const outputSchema = ep.output ? resolveSchema(ep.output, ep.name, "output", ep.outputFlat) : null;
    if (ep.contract && !inputSchema) continue; // 错误已入账——本端点不产出（聚合报错在末尾统一抛）
    if (ep.output && !outputSchema) continue;

    const domain = ep.name.split(".")[0];
    const pathKey = "/" + (mount ? mount + "/" : "") + ep.name;
    const responses = ep.output
      ? {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${ep.output}` } } } },
        }
      : {
          "200": { description: "OK（端点未声明 output 契约——响应 schema 省略）", "x-atelier-output-contract": false },
        };
    // auth: { type: "none" } = 显式免鉴权（§6.2 显式消警位）→ 无 security 引用、不进 securitySchemes
    //（与运行时拦截语义对齐：type "none" 不过分发层鉴权拦截——文档即真相）。
    // apikey（A6，决策 30）→ 方案名固定 "apiKeyAuth"（OpenAPI 社区惯例位名，与 auth.type 解耦——
    // 同应用全部 apikey 端点共用一位，header 以首个声明定名）；session/oauth → 方案名 = auth.type。
    const secured = ep.auth != null && ep.auth.type !== "none";
    const schemeName = secured ? (ep.auth.type === "apikey" ? "apiKeyAuth" : ep.auth.type) : null;
    const security = secured ? [{ [schemeName]: [] }] : null;
    if (secured && !securitySchemes[schemeName]) securitySchemes[schemeName] = securitySchemeFor(ep.auth, cookieName);

    const extensions = {
      "x-atelier-kind": ep.kind,
      ...(ep.live ? { "x-atelier-live": true } : {}),
      ...(ep.idempotent ? { "x-atelier-idempotent": true } : {}),
      ...(ep.timeoutMs != null ? { "x-atelier-timeout-ms": ep.timeoutMs } : {}),
      // A5 决策 33：cache 档位 extension——声明了才出现（未声明端点投影零变化，golden 未动）；
      // 响应头 Cache-Control 的 OpenAPI headers 投影 v1 不做（留门，见文件头注记）
      ...(ep.cache != null ? { "x-atelier-cache": ep.cache } : {}),
    };
    const liveNote = ep.live ? ` live SSE 订阅通道 GET /${(mount ? mount + "/" : "") + ep.name}/live（FS-DESIGN §4.3；SSE 引擎归 FS-7，本位不进 paths）。` : "";

    const pathItem = {};
    if (ep.restful) {
      // §3.4 互操作位（默认关）：restful query 端点映射 GET + reqProps/optProps → query parameters
      const params = [];
      if (ep.contract) {
        const contractEntry = contracts.byIdent[ep.contract];
        for (const [k, f] of Object.entries(contractEntry.value.reqProps ?? {})) {
          params.push({ name: k, in: "query", required: true, schema: projectFlatField(f, "openapi-3.0", { label: `${ep.contract}.reqProps.${k}` }) });
        }
        for (const [k, f] of Object.entries(contractEntry.value.optProps ?? {})) {
          params.push({ name: k, in: "query", required: false, schema: projectFlatField(f, "openapi-3.0", { label: `${ep.contract}.optProps.${k}` }) });
        }
      }
      pathItem.get = {
        operationId: ep.name,
        tags: [domain],
        description: `restful 互操作位（§3.4，默认关）：声明 GET+query 形态供外部 REST 消费者——运行时 GET 分发已启用（决策 34）：GET 请求照走契约校验/鉴权/限流链，查询串按契约显式投影（未知参数显式拒绝）；POST 通道保留不撤。${liveNote}`.trim(),
        ...extensions,
        "x-atelier-restful": true,
        ...(params.length ? { parameters: params } : {}),
        responses,
        ...(security ? { security } : {}),
      };
    } else {
      pathItem.post = {
        operationId: ep.name,
        tags: [domain],
        ...(ep.live ? { description: liveNote.trim() } : {}),
        ...extensions,
        ...(inputSchema
          ? {
              requestBody: {
                required: (inputSchema.required?.length ?? 0) > 0,
                content: { "application/json": { schema: { $ref: `#/components/schemas/${ep.contract}` } } },
              },
            }
          : {}),
        responses,
        ...(security ? { security } : {}),
      };
    }
    paths[pathKey] = pathItem;
  }

  if (errors.length > 0) {
    const detail = errors.map((e) => `  · ${e.message}`).join("\n");
    throw exportError(
      `OpenAPI 导出失败（${errors.length} 项，绝不静默降级）：\n${detail}`,
      errors[0].fix ?? "按上方逐项修正后重跑 atelier export openapi"
    );
  }

  const pkgFile = path.join(root, "package.json");
  let pkgName = null;
  let pkgVersion = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    pkgName = pkg.name ?? null;
    pkgVersion = pkg.version ?? null;
  } catch {
    /* 无 package.json——诚实降级到目录名 */
  }

  const doc = {
    openapi: "3.0.3",
    info: {
      title: opts.name ?? pkgName ?? path.basename(root),
      version: pkgVersion ?? "0.0.0",
      description: "Atelier 端点面导出（FS-9）：读写二分端点 + 扁平契约投影（FS-DESIGN §13 范围克制——只导出端点面）",
    },
    servers: [{ url: "/", description: "应用 dev/prod 同源——端点路径含挂载前缀（--mount，默认 /api）" }],
    paths,
    ...((Object.keys(securitySchemes).length > 0 || referencedIdents.size > 0)
      ? {
          components: {
            ...(referencedIdents.size > 0 ? { schemas: Object.fromEntries([...referencedIdents].sort().map((id) => [id, schemas[id]])) } : {}),
            ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
          },
        }
      : {}),
  };
  const content = JSON.stringify(doc, null, 2) + "\n";
  return {
    content,
    doc,
    endpoints,
    mount: "/" + mount,
    notes,
    pathCount: Object.keys(paths).length,
    schemaIdents: [...referencedIdents].sort(),
    securityTypes: Object.keys(securitySchemes).sort(),
    /** 合成名 → 本地解析 FlatSchema（gen auth 产物内联字面量/pick 投影）——golden 联测校验复用同一解析，无第二真相 */
    localSchemas,
  };
}

/** 把 openapi.json 写盘（mkdir -p；默认 <root>/openapi.json；返回统计） */
export function writeOpenApi(root, opts = {}) {
  const built = buildOpenApi(root, opts);
  const out = path.resolve(root, opts.out ?? "openapi.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
  fs.writeFileSync(out, built.content, "utf8");
  return {
    ...built,
    file: path.relative(root, out).split(path.sep).join("/"),
    bytes: Buffer.byteLength(built.content),
    changed: before !== built.content,
  };
}

/* ---------- CLI ---------- */

function main() {
  const argv = process.argv.slice(2);
  const getOpt = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = path.resolve(getOpt("--root") ?? process.cwd());
  const mount = getOpt("--mount") ?? "/api";
  const name = getOpt("--name");
  const out = getOpt("--out") ?? "openapi.json";

  console.log(`export openapi → ${root}（mount ${mount}）`);
  try {
    const r = writeOpenApi(root, { mount, name, out });
    console.log(`  端点 ${r.endpoints.length} 个 → paths ${r.pathCount} 条（${r.endpoints.filter((e) => e.restful).length} 个 restful GET 映射）`);
    console.log(`  components.schemas ${r.schemaIdents.length}（${r.schemaIdents.join(", ") || "无"}）§2.4 投影器单管线`);
    if (r.securityTypes.length) console.log(`  securitySchemes：${r.securityTypes.join(", ")}`);
    console.log(`  写 ${r.file}：${r.bytes} 字节${r.changed ? "" : "（内容未变——regen 幂等）"}`);
    for (const n of r.notes) console.log(`  note: ${n}`);
    console.log(`done（范围克制 §13：只导出端点面——组件/数据契约不进 OpenAPI）`);
  } catch (e) {
    console.error(`error: ${e.message}`);
    if (e.fix) console.error(`fix: ${e.fix}`);
    process.exit(1);
  }
}

if (INVOKED_DIRECTLY) main();
