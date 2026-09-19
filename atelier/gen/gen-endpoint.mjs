#!/usr/bin/env node
/**
 * gen-endpoint.mjs — gen endpoint 生成器（FS-M2，FS-DESIGN §7.1-7.2）。
 *
 * 输入：① <root>/src/server/endpoints/ 下递归各 .ts 的 defineQuery/defineCommand 静态文本
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
 * 边界（诚实）：非字面量端点名（变量传入）、行内契约对象字面量、简写属性均不识别——
 * 扫描器只认"扁平字面量"形态，识别不了就记进 notes 而不是猜（宁缺勿假）。
 *
 * CLI：node atelier/gen/gen-endpoint.mjs --root <appDir> [--mount /api] [--from-specs]
 * 库形态：export 纯函数（scanEndpoints / scanContracts / scanSpecIntents / scanApiClient /
 * generateApi / generateSkeletons），供测试与 impact.mjs 复用（同一扫描器同一真相）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const INVOKED_DIRECTLY = process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

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

/** 去注释（保留字符串原样）——供值文本再解析 */
function stripComments(src) {
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

/** 对象字面量体 → 直接属性表 { key: 值文本 }；简写属性/展开不识别（诚实边界，见文件头） */
function parseProps(body) {
  const props = {};
  for (const chunk of topLevelChunks(body)) {
    const m = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(chunk);
    if (m) props[m[1]] = m[2].trim();
  }
  return props;
}

/** 值文本的起始标识符（契约单源纪律 = 引用常量；行内字面量不识别 → null + 由调用方记 note） */
function identOf(valueText) {
  if (valueText == null) return null;
  const m = /^\s*(?:as\s+const\s+)?([A-Za-z_$][\w$]*)/.exec(stripComments(valueText));
  return m ? m[1] : null;
}

/** [ "a", "b" ] 值文本 → 字符串数组；非数组形态 → null */
function stringArrayOf(valueText) {
  if (valueText == null) return null;
  const stripped = stripComments(valueText).trim();
  if (!stripped.startsWith("[")) return null;
  const close = matchDelim(stripped, 0);
  if (close < 0) return null;
  const inner = stripped.slice(1, close);
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;
  for (let m; (m = re.exec(inner));) out.push((m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1"));
  return out;
}

/* ---------- ① 端点文件扫描 ---------- */

function* walkTsFiles(dir, depth = 0) {
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

/** 扫一个端点源文件的 defineQuery/defineCommand 调用（扁平字面量形态） */
export function scanEndpointSource(src) {
  const out = [];
  const re = /\bdefine(Query|Command)\s*\(/g;
  for (let m; (m = re.exec(src));) {
    const kind = m[1] === "Query" ? "query" : "command";
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '"' && src[i] !== "'" && src[i] !== "`") continue; // 非字面量名——诚实跳过
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
    out.push({
      name,
      kind,
      contract: identOf(props.contract),
      output: identOf(props.output),
      live,
      invalidate,
      emits: stringArrayOf(props.emits),
      hasTimeout: props.timeoutMs != null,
      idempotent: stripComments(props.idempotent ?? "").trim() === "true",
      line: src.slice(0, m.index).split("\n").length,
    });
    re.lastIndex = close + 1; // 越过本次调用体（handler 内不会嵌套 define*；防御性前进）
  }
  return out;
}

/** 扫 <root>/src/server/endpoints/ 递归 .ts → 端点清单（按 name 排序，file 为相对路径） */
export function scanEndpoints(root) {
  const dir = path.join(root, "src", "server", "endpoints");
  const all = [];
  for (const file of walkTsFiles(dir)) {
    const src = fs.readFileSync(file, "utf8");
    for (const ep of scanEndpointSource(src)) {
      all.push({ ...ep, file: path.relative(root, file).split(path.sep).join("/") });
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

/** 端点名 → PascalCase（"chat.ask" → "ChatAsk"，类型别名用） */
function pascalOf(name) {
  return name
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

/** 端点名 → camelCase 导出标识符（"chat.ask" → "chatAsk"——§4.4 样例形态，调用点 .call(/.live( 的静态可 grep 面） */
function camelOf(name) {
  const p = pascalOf(name);
  return p[0].toLowerCase() + p.slice(1);
}

/** 相对 import 路径（posix 分隔；同目录补 ./） */
function relImport(fromDir, toFile) {
  let rel = path.relative(fromDir, toFile).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

/**
 * 生成 src/generated/api.ts 文本（纯函数——不落盘，字节确定性由排序与定长模板保证）。
 * opts: { mount?: string }
 */
export function generateApi(root, opts = {}) {
  const mount = "/" + String(opts.mount ?? "/api").replace(/^\/+|\/+$/g, "");
  const endpoints = scanEndpoints(root);
  const contracts = scanContracts(root);
  const genDir = path.join(root, "src", "generated");
  const notes = [];
  if (!contracts.exists) notes.push("未找到 src/contract.ts（契约单源）——生成物将缺类型 import");

  const usedIdents = [...new Set(endpoints.flatMap((e) => [e.contract, e.output]).filter(Boolean))].sort();
  for (const e of endpoints) {
    for (const role of ["contract", "output"]) {
      if (e[role] && contracts.exists && !contracts.idents.includes(e[role])) {
        notes.push(`端点 ${e.name} 的 ${role} 引用 ${e[role]}，但契约单源未声明该常量（生成物仍导入——以运行时契约校验为准）`);
      }
    }
  }
  const hasLive = endpoints.some((e) => e.live);
  const contractImportPath = relImport(genDir, path.join(root, "src", "contract.ts"));
  const runtimeImportPath = relImport(genDir, path.join(root, "src", "vendor", "atelier", "runtime", "index.ts"));

  const L = [];
  L.push(`// @atelier-generated（gen endpoint）—— regen 全量重写，手改会被覆盖（FS-DESIGN §7.2 产物纪律）`);
  L.push(`// 类型全部投影自契约单源（FlatOf）+ 端点注册表元数据；本文件零手写业务类型（双源 = ERROR）。`);
  L.push(`// 诚实边界：call 只做传输与错误透传（非 2xx 直接抛响应体 = ATR 四段式，fix 可执行）；`);
  L.push(`// live 失效-重算-推送的服务端引擎归 FS-7——本客户端按 §4.3 SSE 线协议消费。`);
  L.push(``);
  if (usedIdents.length > 0) L.push(`import { ${usedIdents.join(", ")}, type FlatOf } from "${contractImportPath}";`);
  if (hasLive) L.push(`import { streamValue } from "${runtimeImportPath}";`);
  if (usedIdents.length > 0 || hasLive) L.push(``);

  // 类型别名（按端点名排序 = 端点清单序）
  for (const e of endpoints) {
    const base = pascalOf(e.name);
    if (e.contract) L.push(`type ${base}Input = FlatOf<typeof ${e.contract}>;`);
    if (e.output) L.push(`type ${base}Output = FlatOf<typeof ${e.output}>;`);
  }
  if (endpoints.some((e) => e.contract || e.output)) L.push(``);

  for (const e of endpoints) {
    const base = pascalOf(e.name);
    const inType = e.contract ? `${base}Input` : "Record<string, unknown>";
    const outType = e.output ? `${base}Output` : "unknown";
    const kindLabel = e.kind === "command" ? "command" : e.live ? "query·live" : "query";
    L.push(`/** ${e.name}（${kindLabel}）—— POST ${mount}/${e.name}${e.live ? `；live SSE GET ${mount}/${e.name}/live（§4.3）` : ""} */`);
    L.push(`export const ${camelOf(e.name)} = Object.freeze({`);
    L.push(`  name: "${e.name}" as const,`);
    L.push(`  async call(input: ${inType}): Promise<${outType}> {`);
    L.push(`    const res = await fetch("${mount}/${e.name}", {`);
    L.push(`      method: "POST",`);
    L.push(`      headers: { "content-type": "application/json" },`);
    L.push(`      body: JSON.stringify(input),`);
    L.push(`    });`);
    L.push(`    if (!res.ok) throw await res.json(); // 非 2xx = ATR 四段式 { code, message, context, fix }`);
    L.push(`    return (await res.json()) as ${outType};`);
    L.push(`  },`);
    if (e.live) {
      L.push(`  /** live 订阅：SSE data → streamValue 三态原语直通；error 事件 = ATR-321（订阅保持，不断流） */`);
      L.push(`  live(input: ${inType}) {`);
      L.push(`    const sv = streamValue<${outType}>();`);
      L.push(`    const es = new EventSource("${mount}/${e.name}/live?input=" + encodeURIComponent(JSON.stringify(input)));`);
      L.push(`    es.addEventListener("data", (e) => {`);
      L.push(`      sv.push(JSON.parse((e as MessageEvent).data) as ${outType});`);
      L.push(`    });`);
      L.push(`    es.addEventListener("error", (e) => {`);
      L.push(`      // ATR-321 四段式随 error 事件下行；streamValue v1 无 error 位（§8.3 议），先 console 呈现；`);
      L.push(`      // 订阅保持——下轮写后重算继续推 data。无 data 的 error = 连接级中断，EventSource 自动重连。`);
      L.push(`      const d = (e as MessageEvent).data;`);
      L.push(`      if (typeof d === "string" && d.length > 0) {`);
      L.push(`        try {`);
      L.push(`          const atr = JSON.parse(d) as { code?: string; message?: string; fix?: string };`);
      L.push(`          console.error("[atelier] " + (atr.code ?? "ATR-321") + ": " + (atr.message ?? "") + "\\nfix: " + (atr.fix ?? ""));`);
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
      L.push(`/** 意图：${it.desc || "（specs 未写描述——补上，验收命令序列是 specs 三段式纪律）"} */`);
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

function main() {
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

if (INVOKED_DIRECTLY) main();
