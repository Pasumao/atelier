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
 * 本文件自己的 define* walk 提取 OpenAPI 需要的超集元数据（auth/restful/timeoutMs 值），
 * live/invalidate/emits/idempotent 语义与 scanEndpointSource 同构（同一原语、同一测试钉住）。
 *
 * 契约取值：src/contract.ts 契约单源（`export const X = {…}` 形态，兼容 `: FlatSchema =` 注解
 * 与 `satisfies FlatSchema` 后缀）——纯文本扫描 + parseLiteral 字面量解析（gen-db.mjs 同款纪律：
 * 对象字面量 → JS 值，无 eval、无 TS 解析器、扫描器不执行被扫代码）。端点内联契约字面量
 * 不支持（gen endpoint 扫描器同边界）→ 显式报错指路契约单源，绝不静默。
 *
 * 文档形态：
 *   paths        默认 POST（请求体 = 输入契约投影；响应 200 = 输出契约投影；无 output 契约
 *                的端点响应 schema 省略 + description 注记 + x-atelier-output-contract:false）；
 *   restful: true（§3.4 互操作位，默认关）→ 该 query 端点映射 GET + reqProps/optProps →
 *                query parameters（description 注记运行时传输仍为 POST）；
 *   auth         → components.securitySchemes（session → cookie apiKey 位；oauth 只预留命名
 *                空间占位声明不实现 §6.4；其余类型显式报错）；端点 → security 引用；
 *   idempotent/timeoutMs/live/kind → x-atelier-* 扩展字段；
 *   info.title   取 --name 或应用 package.json name 或目录名。
 *
 * CLI：node atelier/gen/export-openapi.mjs --root <appDir> [--out openapi.json] [--mount /api] [--name <Title>]
 * 库形态：export buildOpenApi / writeOpenApi / scanOpenApiEndpoints / scanOpenApiEndpointFiles /
 * scanContractSchemas / parseFlatSchemaLiteral（测试与后续 MCP/OpenAPI 消费面复用同一扫描器）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { matchDelim, parseProps, stripComments, identOf, stringArrayOf, walkTsFiles } from "./gen-endpoint.mjs";
import { projectJsonSchema, projectFlatField } from "../compiler/project-json.mjs";

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

/** 字符串字面量解析（禁插值/拼接——内容含未转义同种引号或 ${ 即错，与 gen-db 同口径） */
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
    return inner.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
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

const DEFINE_RE = /\bdefine(Query|Command)\s*\(/g;

/** 数字值文本解析（timeoutMs：允许 10_000 数值分隔符；非数字字面量 → 显式错） */
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
 * 扫一个端点源文件的 defineQuery/defineCommand → OpenAPI 超集端点清单。
 * 与 gen-endpoint scanEndpointSource 同构（同一原语；live/invalidate/emits/idempotent 语义一致），
 * 另提取 auth/restful/timeoutMs 值。行内契约对象字面量不支持 → 显式报错（绝不静默猜）。
 */
export function scanOpenApiEndpoints(src) {
  const out = [];
  DEFINE_RE.lastIndex = 0;
  for (let m; (m = DEFINE_RE.exec(src));) {
    const kind = m[1] === "Query" ? "query" : "command";
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '"' && src[i] !== "'" && src[i] !== "`") continue; // 非字面量名——诚实跳过（同 gen-endpoint）
    const q = src[i];
    i++;
    const nameStart = i;
    while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
    const name = src.slice(nameStart, i).replace(/\\(.)/g, "$1");
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== ",") continue;
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "{") continue;
    const close = matchDelim(src, i);
    if (close < 0) continue;
    const props = parseProps(src.slice(i + 1, close));

    for (const role of ["contract", "output"]) {
      const raw = props[role];
      if (raw != null && stripComments(raw).trim().startsWith("{")) {
        throw exportError(
          `端点 ${name} 的 ${role} 是行内契约对象字面量——OpenAPI 导出不支持（gen endpoint 扫描器同边界）`,
          `把契约提升为 src/contract.ts 契约单源常量（export const … = { type: "object", … }），端点改引用常量名`
        );
      }
    }

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

    const timeoutText = props.timeoutMs;
    const timeoutMs = timeoutText != null ? parseNumberMeta(timeoutText, `端点 ${name} 的 timeoutMs`) : null;
    const auth = props.auth != null ? parseAuthMeta(props.auth, name) : null;
    const restful = stripComments(props.restful ?? "").trim() === "true";
    if (restful && kind !== "query") {
      throw exportError(
        `端点 ${name} 是 command，却声明 restful: true`,
        "restful GET 映射位（§3.4）只许 query 端点声明——写端点保持 POST（读写二分纪律）"
      );
    }

    out.push({
      name,
      kind,
      contract: identOf(props.contract),
      output: identOf(props.output),
      live,
      invalidate,
      emits: stringArrayOf(props.emits),
      idempotent: stripComments(props.idempotent ?? "").trim() === "true",
      timeoutMs,
      auth,
      restful,
      line: src.slice(0, m.index).split("\n").length,
    });
    DEFINE_RE.lastIndex = close + 1; // 越过本次调用体（与 gen-endpoint 同款防御性前进）
  }
  return out;
}

/** 扫 <root>/src/server/endpoints/ 递归 .ts → 端点清单（按 name 排序，file 为相对路径） */
export function scanOpenApiEndpointFiles(root) {
  const dir = path.join(root, "src", "server", "endpoints");
  const all = [];
  for (const file of walkTsFiles(dir)) {
    const src = fs.readFileSync(file, "utf8");
    for (const ep of scanOpenApiEndpoints(src)) {
      all.push({ ...ep, file: path.relative(root, file).split(path.sep).join("/") });
    }
  }
  return all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/* ---------- ③ OpenAPI 文档组装 ---------- */

function normalizeMount(mount) {
  return String(mount ?? "/api").replace(/^\/+|\/+$/g, "");
}

/** securitySchemes：session → cookie apiKey 位；oauth → 预留占位声明（§6.4，不实现） */
function securitySchemeFor(type) {
  if (type === "session") {
    return {
      type: "apiKey",
      in: "cookie",
      name: "session",
      description: "Atelier session 会话 cookie（gen auth 产物定义 Cookie 名——FS-DESIGN §6.2；本位为互操作投影）",
    };
  }
  if (type === "oauth") {
    return {
      type: "apiKey",
      in: "header",
      name: "Authorization",
      description: "Atelier oauth 预留位（FS-DESIGN §6.4）：类型命名空间已预留、映射未实现——此条目仅占位声明，客户端集成前以框架文档为准",
      "x-atelier-reserved": true,
    };
  }
  throw exportError(
    `不支持的 auth 类型「${type}」（OpenAPI 导出只实现 session；oauth 为预留占位）`,
    "改用 auth: { type: \"session\" }，或在 FS-DESIGN §6.4 落地后再扩展映射"
  );
}

/**
 * 组装 openapi-3.0.3 文档（纯函数——不落盘，字节确定性由排序与定序输出保证）。
 * opts: { mount?, name?, out? }；契约引用不存在/投影 ATR-107 → 聚合抛错（绝不静默降级）。
 */
export function buildOpenApi(root, opts = {}) {
  const mount = normalizeMount(opts.mount);
  const endpoints = scanOpenApiEndpointFiles(root);
  const contracts = scanContractSchemas(root);
  const notes = [];
  if (!contracts.exists) notes.push("未找到 src/contract.ts（契约单源）——端点若声明 contract/output 将无法解析");
  if (endpoints.length === 0) notes.push("未发现端点定义（src/server/endpoints/ 下无 defineQuery/defineCommand）——产出空 paths 文档");

  const errors = [];
  const schemas = {}; // ident → 投影结果（openapi-3.0 target）
  const referencedIdents = new Set();
  const resolveSchema = (ident, endpointName, role) => {
    if (schemas[ident]) return schemas[ident];
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
    const inputSchema = ep.contract ? resolveSchema(ep.contract, ep.name, "contract") : null;
    const outputSchema = ep.output ? resolveSchema(ep.output, ep.name, "output") : null;
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
    const security = ep.auth ? [{ [ep.auth.type]: [] }] : null;
    if (ep.auth && !securitySchemes[ep.auth.type]) securitySchemes[ep.auth.type] = securitySchemeFor(ep.auth.type);

    const extensions = {
      "x-atelier-kind": ep.kind,
      ...(ep.live ? { "x-atelier-live": true } : {}),
      ...(ep.idempotent ? { "x-atelier-idempotent": true } : {}),
      ...(ep.timeoutMs != null ? { "x-atelier-timeout-ms": ep.timeoutMs } : {}),
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
        description: `restful 互操作位（§3.4，默认关）：声明 GET+query 形态供外部 REST 消费者——运行时传输仍为 POST。${liveNote}`.trim(),
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
