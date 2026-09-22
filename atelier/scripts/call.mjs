#!/usr/bin/env node
/**
 * call.mjs — `atelier call`：端点直调 CLI 通道（D-F15，FS-DESIGN §14.4 端点工作循环的验证环）。
 *
 *   atelier call <endpoint> ['<json>'] [--root <dir>] [--mount /api] [--port N] [--timeout <ms>]
 *
 * 通道语义（对表 Builder.io 四通道：HTTP（server 面）/ MCP（endpoint.* 工具族）/ dev 面调试页
 * （D-F16 观察位）/ CLI（本件）——同一端点面四条通路，契约校验全走 server 同一份）：
 *   - v1 直调**运行中的 server 面**（atelier dev 托管的 5174，或 build 产物自托管入口）：
 *     POST <mount>/<endpoint>，体 = JSON 实参（缺省 {}）。
 *   - **query/command 不分动词**（§3.4 D-F11 已定：query 与 command 同走 POST——「输入必过契约
 *     校验」单一路径，不因动词分叉；restful:true 的 GET 映射是 export openapi 的互操作投影位，
 *     运行时仍 POST）。任务书原提「从 dev 面 __atelier/registry 读 kind 分 GET/POST」与现状不
 *     符：该路由返回组件 manifest（无端点 kind），且传输协议本就 POST-only——故不做 kind 探测，
 *     诚实边界记录于此。
 *   - 不静默 spawn server（诚实边界：call 是验收环不是托管环——起 server 归 `pnpm dev`，产物
 *     自证归 `atelier build` 内建冒烟）。不可达 → ATR-403 形态结构化错误 + fix 指路，exit 1。
 *
 * 输出面：成功 = 响应 JSON 缩进打印 stdout，exit 0；失败 = ATR 结构化错误（{code,message,fix,
 * hints?}——server errorResponse 原样）上 stderr，exit 1；用法错（坏 JSON/非法端点名/缺实参）
 * exit 2（不出网）。
 *
 * 配置解析与 dev-server-host.mjs resolveServerConfig 同契约（三方契约第 2 条：atelier.config.json
 * server.port 缺省 5174 / server.mount 缺省 /api；port 0 = 自动——不可直连，须 --port 显式指定，
 * 本脚本对 0 如实按「未配置」处理并提示）。10 行内联复刻而非跨面 import：本件框架侧运行，应用侧
 * vendor 不含 dev 面（差异锁文件互不依赖——契约单源在 FS-DESIGN §11.1 文档位）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
// --k v 与 --k=v 两种形态都认（CLI 惯例两写法）；位置实参扫描时带值 flag 的值不能被误当 <json>
const FLAGS_WITH_VALUE = ["--root", "--mount", "--port", "--timeout"];
const argOf = (k) => {
  const i = argv.indexOf(k);
  if (i >= 0) return argv[i + 1];
  const hit = argv.find((a) => a.startsWith(`${k}=`));
  return hit === undefined ? undefined : hit.slice(k.length + 1);
};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const isValueFlag = FLAGS_WITH_VALUE.includes(a) || FLAGS_WITH_VALUE.some((f) => a.startsWith(`${f}=`));
  if (isValueFlag && FLAGS_WITH_VALUE.includes(a)) {
    i++; // 空格形态：吃掉 flag 值
  } else if (!isValueFlag && !a.startsWith("--")) {
    positional.push(a);
  }
}
const endpoint = positional[0];
const jsonArg = positional[1];

function die(msg, code = 2, fix) {
  console.error(msg);
  if (fix) console.error(`fix: ${fix}`);
  process.exit(code);
}

/* ---------------- 用法守卫（exit 2 档：坏输入绝不出网） ---------------- */

if (!endpoint || endpoint.startsWith("--")) {
  die("usage: atelier call <endpoint> ['<json>'] [--root <dir>] [--mount /api] [--port N] [--timeout <ms>]", 2);
}
// 端点是注册表名（点分命名空间，如 app.ping），不是 URL 路径——带分隔符/空白即用法错误
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(endpoint)) {
  die(`error: 非法端点名 "${endpoint}"（端点是注册表名，形态如 app.ping——不是 URL 路径）`, 2, "用 endpoint.list（MCP）或 dev 面 /__atelier/registry 查已注册端点名");
}
let input;
if (jsonArg === undefined) {
  input = {}; // 体缺省 = {}（无契约 query 的最简形态；有契约端点会以 ATR-201 拒绝并指明缺什么）
} else {
  try {
    input = JSON.parse(jsonArg);
  } catch {
    die(`error: JSON 实参不是合法 JSON：${jsonArg.slice(0, 120)}`, 2, `发送契约输入，例如 '{"id": 1}'；体缺省即 {}`);
  }
}
if (input === null || typeof input !== "object" || Array.isArray(input)) {
  die("error: JSON 实参必须是 JSON 对象（端点输入形态 = 契约对象）", 2);
}

/* ---------------- 目标解析：--port/--mount 显式位 > atelier.config.json > 缺省（§11.1 契约） ---------------- */

const root = path.resolve(argOf("--root") ?? process.cwd());
const cfgPath = path.join(root, "atelier.config.json");
let cfgServer = {};
try {
  cfgServer = JSON.parse(fs.readFileSync(cfgPath, "utf8")).server ?? {};
} catch {
  /* config 缺失/坏档 = 用缺省（config 是可选件——无 config 应用照样有 server 面缺省口） */
}
const cfgPort = Number(cfgServer.port);
const portFlag = argOf("--port") !== undefined ? Number(argOf("--port")) : NaN;
// port 0 = 自动分配（dev 托管语义）——直调侧无法预知实际端口，如实按未配置处理并指路
const port = Number.isFinite(portFlag) && portFlag > 0 ? portFlag : Number.isFinite(cfgPort) && cfgPort > 0 ? cfgPort : 5174;
const rawMount = String(argOf("--mount") ?? cfgServer.mount ?? "/api");
const mount = rawMount.startsWith("/") ? rawMount : `/${rawMount}`;
const timeoutMs = Number.isFinite(Number(argOf("--timeout"))) ? Number(argOf("--timeout")) : 10_000;
const url = `http://127.0.0.1:${port}${mount}/${endpoint}`;

/* ---------------- 直调：POST 同一纪律（§3.4）+ 结构化错误贯通（§15） ---------------- */

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
} catch (e) {
  const cause = e?.cause?.code ?? e?.name ?? "Error";
  if (e?.name === "TimeoutError" || cause === "AbortError") {
    die(`ATR-403: server 面无响应（${url} 超过 ${timeoutMs}ms）`, 1, "确认 server 面存活（慢端点？）——或用 --timeout <ms> 放宽时限");
  }
  die(
    `ATR-403: server 面不可达（${url} —— ${cause}）`,
    1,
    `应用目录下启动 dev 面：cd ${root} && pnpm dev（server 面随 dev 托管在 127.0.0.1:${port}）；产物部署形态则启动 build 产物入口（node dist/server.mjs）`,
  );
}

const text = await res.text();
if (!res.ok) {
  // ATR 结构化错误（server errorResponse：{code,message,fix,hints?}）原样上 stderr——agent 看得见拒因
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    /* 非 JSON 响应体（反代兜底页等）——原样透传，不伪装结构化 */
  }
  console.error(pretty);
  console.error(`\n[atelier call] ${endpoint} → HTTP ${res.status}（exit 1）`);
  process.exit(1);
}

try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  die(`ATR-320 形态：端点 2xx 但响应体不是合法 JSON（${text.slice(0, 120)}）`, 1, "检查端点 handler 返回值——端点面约定 JSON 响应");
}
