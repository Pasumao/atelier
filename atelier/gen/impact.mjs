#!/usr/bin/env node
/**
 * impact.mjs — 契约影响面分析（FS-M2，FS-DESIGN §2.5，M2 出口件）。
 *
 * v1 两跳静态链（全部静态可判，不做跨端点数据流推导——那需要类型级分析，tsgo 观察位）：
 *   契约键（contract.ts 常量标识符）
 *     → ① 引用它的端点（扫 src/server/endpoints/ 递归 .ts 的 contract: / output: 标识符——
 *        与 gen-endpoint.mjs 同一扫描器同一真相）
 *     → ② 前端调用点（src/generated/api.ts 提供 端点名 → 导出标识符 映射（§2.5 数据源②：
 *        name as const 字面量静态可 grep）；再扫 src 下递归各 .ts（含 *.atr.ts）中
 *        `<ident>.call(` / `<ident>.live(` 引用）
 *
 * "impact 是导航不是门禁"：输出导航报告，exit 恒 0——阻断权在类型错误与契约校验本身（§2.5）。
 * 边界（诚实）：只认 `<ident>.call(` / `.live(` 精确文本引用（不认解构别名/重命名导入）；
 * 动态引用不在静态链内——契约校验在运行时仍会拦（失败即导航）。
 *
 * CLI：node atelier/gen/impact.mjs <contractKey> --root <appDir>
 * 库形态：export 纯函数（findEndpointsByContract / findCallSites / impactReport），供测试复用。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { scanEndpoints, scanApiClient, scanContracts } from "./gen-endpoint.mjs";

const INVOKED_DIRECTLY = process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

/** ① 契约键 → 引用端点（contract:/output: 双向——改契约对输入与输出两侧都算影响） */
export function findEndpointsByContract(root, contractKey) {
  return scanEndpoints(root)
    .map((e) => {
      const roles = [];
      if (e.contract === contractKey) roles.push("contract");
      if (e.output === contractKey) roles.push("output");
      return { ...e, roles };
    })
    .filter((e) => e.roles.length > 0);
}

function* walkSources(srcDir, depth = 0) {
  if (depth > 8 || !fs.existsSync(srcDir)) return;
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "generated" || e.name === "vendor" || e.name.startsWith(".")) continue;
      yield* walkSources(path.join(srcDir, e.name), depth + 1);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      yield path.join(srcDir, e.name);
    }
  }
}

/**
 * ② 端点调用点：扫 src 下递归 .ts（含 *.atr.ts；generated/vendor 排除——一个是事实源自身、
 * 一个是框架内核）中的 `<ident>.call(` / `<ident>.live(`。
 */
export function findCallSites(root, idents) {
  if (idents.length === 0) return [];
  const wanted = new Map(idents.map((i) => [i, []]));
  for (const file of walkSources(path.join(root, "src"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");
    for (const ident of idents) {
      const re = new RegExp(`\\b${ident}\\.(call|live)\\(`, "g");
      for (let m; (m = re.exec(src));) {
        wanted.get(ident).push({ ident, usage: m[1], file: rel, line: src.slice(0, m.index).split("\n").length });
      }
    }
  }
  return wanted;
}

/**
 * 影响面报告（纯数据——CLI 打印与测试断言共用同一结构）。
 * 返回 { contractKey, knownContract, endpoints, callSites, notes }。
 */
export function impactReport(root, contractKey) {
  const notes = [];
  const contracts = scanContracts(root);
  const knownContract = contracts.idents.includes(contractKey);
  if (contracts.exists && !knownContract) {
    notes.push(`契约单源（${contracts.file}）未声明 ${contractKey}——若为字段级键请改用常量标识符（v1 只做常量粒度）`);
  }
  const endpoints = findEndpointsByContract(root, contractKey);
  const api = scanApiClient(root);
  if (!api.exists) notes.push(`${api.file} 不存在——先跑 gen endpoint 生成客户端，调用点链路才能接通`);
  const nameToIdent = new Map(api.clients.map((c) => [c.endpoint, c.ident]));

  const endpointNames = endpoints.map((e) => e.name);
  const unmapped = endpointNames.filter((n) => !nameToIdent.has(n));
  for (const n of unmapped) {
    notes.push(`端点 ${n} 在 ${api.file} 无映射（未生成或生成物过期）——该端点的调用点链路中断（regen 可修复）`);
  }
  const idents = [...new Set(endpointNames.map((n) => nameToIdent.get(n)).filter(Boolean))];
  const callSites = [...findCallSites(root, idents).values()].flat();
  if (endpoints.length === 0) {
    notes.push(`未发现静态引用（v1 两跳静态链只覆盖 contract:/output: 显式引用与 .call(/.live( 调用点；运行时动态引用仍由契约校验拦截）`);
  }
  return { contractKey, knownContract, endpoints, callSites, notes };
}

/** 报告打印（导航格式：契约 → 端点 → 调用点，带 file:line 可跳转） */
function printReport(r) {
  console.log(`契约影响面（impact v1 两跳静态链——导航报告，不阻断；exit 恒 0）`);
  console.log(`契约键: ${r.contractKey}${r.knownContract ? "" : "（契约单源未声明）"}`);
  console.log(`  ↑ 端点（${r.endpoints.length}）:`);
  for (const e of r.endpoints) {
    console.log(`    - ${e.name}（${e.kind} · ${e.roles.join("+")}）${e.file}:${e.line}`);
  }
  console.log(`  ↑ 前端调用点（${r.callSites.length}）:`);
  for (const c of r.callSites) {
    console.log(`    - ${c.ident}.${c.usage}(  ${c.file}:${c.line}`);
  }
  for (const n of r.notes) console.log(`  note: ${n}`);
}

function main() {
  const argv = process.argv.slice(2);
  const key = argv.find((a) => !a.startsWith("--"));
  const rootIdx = argv.indexOf("--root");
  const root = path.resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd());
  if (!key) {
    console.log(`usage: node atelier/gen/impact.mjs <contractKey> --root <appDir>`);
    console.log(`  例：node atelier/gen/impact.mjs chatInputSchema --root .`);
    process.exit(0); // 导航工具：参数缺失也给 0（usage 即导航）
  }
  printReport(impactReport(root, key));
  // "impact 是导航不是门禁"（§2.5）：无论命中与否 exit 恒 0——阻断权在类型错误与契约校验本身
  process.exit(0);
}

if (INVOKED_DIRECTLY) main();
