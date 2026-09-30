#!/usr/bin/env node
/**
 * codegen.mjs — Atelier compiler stage ③ (P0-2): expanded template AST → 静态 effect 图代码。
 *
 * 输入：stage ② dump 的 AST（.atr/ast/<Component>.json），或 in-process 直传 raw（同一解析器
 * parseTemplate ⇒ 与 dump 同树，单一来源不破）。输出两种形态，同一发射器产出：
 *
 *   - compileFunction(name, raw) → CompiledTemplate 对象（program 经 new Function 构造，
 *     零文件落盘；vitest / in-process 消费）
 *   - compileModuleSource(name, raws) → 零 import 的 ES 模块源码（`export const compiledList`；
 *     CLI 落盘 .atr/compiled/<Component>.mjs 供应用 import 后 registerCompiled）
 *
 * 生成代码的形态（验收：BACKLOG P0-2③）：
 *   · 结构构建是直线 createElement/appendChild——运行时无字符串解析、无 AST 分派
 *   · 每处 {expr} / 动态 attr / {#if} / {#each} 的 effect 接线在编译期定点生成（静态 effect 图）
 *   · F-5 effect 所有权：{#if} 换支 / {#each} 行移除/全清重建的 teardown 经 rt.withTeardown/
 *     rt.runCleanup 发射，与解释器共用同一 teardownStack（僵尸 effect 红检见 tests/codegen.test.ts）
 *   · 运行时能力（$effect/evalExpr/bindExpr/bindTwoWay/bindEvent/mountComponent…）经 ctx.rt 注入
 *     （runtime/template.ts 的 __compiledRT，解释器同函数）⇒ 产物与 runtime 路径/打包布局
 *     零耦合，语义同源。
 *   · 错误卡分支双旗守卫（决策 27）：emitComponent 的组件未注册卡 / validateProps 失败卡均以
 *     !(rt.BUILD_PROD || rt.dynProd()) 守卫发射——与解释器同款语义，vite build define 折叠后
 *     dev 分支 DCE 剔除（形态与行为钉见 tests/codegen-prodflags.test.ts）。
 *   · 表达式仍走 rt.evalExpr（解析结果已按源文本 memoize，见 runtime/expr.ts）——
 *     「零解析」仅对模板结构成立，对本发射器生成的直线接线成立，对表达式求值不成立（诚实边界）。
 *
 * Usage:
 *   node atelier/compiler/codegen.mjs --ast <dir> [--out <dir>] [--quiet] [--graph]
 *     --ast   stage ② dump 目录（含 index.json；默认 <root>/.atr/ast）
 *     --out   产物目录（默认 <ast-dir>/../compiled）
 *     --graph 同时落盘构建期静态依赖图 <ast-dir>/../graph/<Component>.json（F-2 二期）
 *   node atelier/compiler/codegen.mjs --ast <dir> --graph-only [--quiet]
 *     查询模式：零落盘，把合并的组件依赖图 JSON 打到 stdout（MCP graph.static 单源）
 *
 * Zero npm dependencies. Requires Node ≥ 22.18（直载 runtime TS，与 dump.mjs 同约束）。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { isTsExtensionLoadError, nodeGuardError, nodeSupportsTsImport } from "./node-guard.mjs";

/* REL-A A4：runtime TS 绑定改为闸后动态加载——旧口径顶层静态 import（dump.mjs 同病：Node
 * 22.12~22.17 在任何闸逻辑前死于 ERR_UNKNOWN_FILE_EXTENSION；本文件此前连闸都没有）。库消费
 * 面（compileFunction 等同步导出，vitest 多处静态 import）保持同步签名：模块求值期闸后加载
 * 一次（闸错/加载错作为 Error 值延迟持有），首次使用时以四段式抛出，CLI main() 入口即取即 die。 */
const __runtimeTs = await (async () => {
  if (!nodeSupportsTsImport(process.versions.node)) return nodeGuardError(process.versions.node);
  try {
    const [tpl, expr] = await Promise.all([import("../runtime/template.ts"), import("../runtime/expr.ts")]);
    return { ...tpl, ...expr };
  } catch (e) {
    if (isTsExtensionLoadError(e)) return nodeGuardError(process.versions.node); // 双保险：同款四段式
    return e; // 其余加载错误原样延迟（首次使用时抛——旧行为 = 模块求值期裸抛，语义不弱化）
  }
})();
function runtimeTs() {
  if (__runtimeTs instanceof Error) throw __runtimeTs;
  return __runtimeTs;
}

const INVOKED_DIRECTLY =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

function die(message, fix) {
  console.error(`error: ${message}${fix ? `\nfix: ${fix}` : ""}`);
  process.exit(1);
}

const esc = (s) => JSON.stringify(String(s));

class CodegenError extends Error {
  constructor(message) {
    super(message);
    this.code = "ATR-1xx-codegen";
  }
}

/* ---------- 样式抽取：runtime extractStyleBlocks 单点（R1-B 支 P1 #6）----------
 * 与解释器 mountComponentInner 同一函数同一正则（修复前本文件 /g 全注入、解释器非全局正则
 * 只注入首个——同一组件 dev/prod 渲染分叉，且此处注释自称「同一正则」不成立）。 */

/* ---------- 静态依赖提取（决策 3 / F-2 第一期） ----------
 * 每个响应式挂点（bindExpr / {#if} test / {#each} expr+key 及子树）在发射时同步收集其
 * 表达式引用的作用域根标识符；挂载期求值（组件 props）与事件期求值（on:）分桶另记。
 * 语义：**语法级引用集 = 运行时追踪集的超集**（含 {#if}/{:else}、&&/||/?: 的未执行分支，
 * 与 {#each} 子作用域变量已被滤除）——产物据此可做构建期依赖图与未来跳过追踪的可靠性依据。
 */
function newDepState() {
  return { locals: new Set(), reactive: new Set(), mount: new Set(), events: new Set() };
}
function collect(st, bucket, expr) {
  for (const id of runtimeTs().exprRootIdents(expr)) {
    if (!st.locals.has(id)) st[bucket].add(id);
  }
}

/* ---------- 发射器：AST → program 源码（不美化、不优化，直译解释器 renderNode 语义） ---------- */

function emitNodes(nodes, scopeVar, target, out, uid, st) {
  for (const n of nodes) emitNode(n, scopeVar, target, out, uid, st);
}

function emitNode(n, SV, T, out, uid, st) {
  switch (n.kind) {
    case "text": {
      out.push(`${T}.appendChild(document.createTextNode(${esc(n.text)}));`);
      return;
    }
    case "expr": {
      collect(st, "reactive", n.expr);
      const tn = uid("tn");
      out.push(`const ${tn} = document.createTextNode("");`);
      out.push(`rt.bindExpr(${esc(n.expr)}, ${SV}, (v) => { ${tn}.textContent = rt.stringify(v); });`);
      out.push(`${T}.appendChild(${tn});`);
      return;
    }
    case "element": {
      if (String(n.tag).toLowerCase() === "style") return; // 解释器同款：scoped 样式上层注入，渲染为 null
      if (n.component) return emitComponent(n, SV, T, out, uid, st);
      const el = uid("el");
      out.push(`{`);
      out.push(`  const ${el} = document.createElement(${esc(n.tag)});`);
      emitAttrs(n.attrs, SV, el, n.tag, out, uid, st);
      if (n.children?.length) {
        const c = uid("c");
        out.push(`  const ${c} = document.createDocumentFragment();`);
        emitNodes(n.children, SV, c, out, uid, st);
        out.push(`  ${el}.appendChild(${c});`);
      }
      out.push(`  ${T}.appendChild(${el});`);
      out.push(`}`);
      return;
    }
    case "if":
      return emitIf(n, SV, T, out, uid, st);
    case "each":
      return emitEach(n, SV, T, out, uid, st);
    default:
      throw new CodegenError(`unknown node kind: ${JSON.stringify(n?.kind)} — stage ③ 覆盖 text/expr/element（attr 面 on:/bind:/动态/静态）/if/each；` +
        `收到未知节点请先确认 stage ② dump 与 runtime 解析器版本一致`);
  }
}

/** 属性：保持原序（on: 事件 / bind: 双向 / 动态 bindExpr / 静态 setAttribute 按模板出现顺序发射） */
function emitAttrs(attrs, SV, el, tag, out, uid, st) {
  for (const a of attrs ?? []) {
    if (a.name.startsWith("on:")) {
      collect(st, "events", a.value);
      // 事件修饰族 v1（决策 25 后置候选，m9 批集成收口）：整名发射 rt.bindEvent 单点——
      // 修饰符解析/白名单/ATR-326 分层全部收在 runtime 单点（parseEventMods 双路径同源），
      // 与解释器 renderNode element 分支 on: 支路同位同构；无修饰符行为逐字节不变。
      // collect 论证：监听器内事件期 evalExpr 读 handler 表达式 ⇒ 静态清单收 events 桶不变。
      out.push(`  rt.bindEvent(${el}, ${esc(a.name)}, ${esc(a.value)}, ${SV});`);
    } else if (a.name === "bind:group") {
      // 决策 25 v1.2（m10 批）radio group 双向绑定：与解释器 renderNode element 分支同位同构——
      // 同一单点 rt.bindGroup(el, name, expr, scope, tag)（bindTwoWay 五参同款），组语义/身份键/
      // ATR-327/槽位守卫全部收在 runtime 单点内。m9 on: 整名发射教训沿用：attr 全名进发射，
      // 不 slice（bind:group 无修饰符形态，整名纪律不破）。
      // collect 论证与 bind: 同款：bindGroup 下行 effect 订阅目标信号 ⇒ 运行时追踪集必含 bind
      // 目标 ⇒ 超集不变式（F-2 依赖图）⇒ 与 dynamic 支路同桶收集（reactive）。
      collect(st, "reactive", a.value);
      out.push(`  rt.bindGroup(${el}, ${esc(a.name)}, ${esc(a.value)}, ${SV}, ${esc(tag)});`);
    } else if (a.name.startsWith("bind:")) {
      // 决策 25 双向绑定（bind:value/bind:checked）：与解释器 renderNode element 分支同位
      //（先于 dynamic 单向支路）同构——同一单点 rt.bindTwoWay(el, name, expr, scope, tag)，
      // 糖化形态（动态 attr effect 订阅 + 元素事件回写 sig.value）全部收在 runtime 单点内。
      // 错误面同构：bindTwoWay 的校验失败（ATR-305 派生只读 / ATR-324 目标或组合非法 /
      // ATR-325 重复绑定）由 runtime 单点呈现（dev 错误卡替换元素 / prod recordRuntimeError）——
      // codegen 发射即信任 runtime 单点，不重复校验。
      // collect 论证：bindTwoWay 内部自建 attr effect（bindExpr 同源订阅，自行 evalExpr 读
      // 目标信号）⇒ 运行时追踪集必含 bind 目标；静态清单若漏收将破「语法级引用集 ⊇ 运行时
      // 追踪集」超集不变式（F-2 依赖图 / 未来跳过追踪的可靠性依据）⇒ 与 dynamic 支路同桶
      // 收集（reactive）。
      collect(st, "reactive", a.value);
      out.push(`  rt.bindTwoWay(${el}, ${esc(a.name)}, ${esc(a.value)}, ${SV}, ${esc(tag)});`);
    } else if (a.dynamic) {
      // R1-B 支（P1 #5，2026-09-30 架构评审）：动态属性单点 rt.bindAttr——布尔属性存在性语义
      // （BOOLEAN_ATTRS 25 项 false → removeAttribute + ATR-328 dev 一次性可疑值警示）收在
      // runtime 单点，与解释器 renderNode dynamic 支路同位同构。修复前本支路只发射
      // setAttribute——编译应用 disabled={false} 落 disabled="false"（存在即真 ⇒ 语义反转）。
      // collect 论证与 bind: 同款：bindAttr 内部 bindExpr effect 订阅目标信号 ⇒ 运行时追踪集
      // 必含目标 ⇒ 超集不变式（F-2 依赖图）保持，同桶收集（reactive）。
      collect(st, "reactive", a.value);
      out.push(`  rt.bindAttr(${el}, ${esc(a.name)}, ${esc(a.value)}, ${SV}, ${esc(tag)});`);
    } else {
      out.push(`  ${el}.setAttribute(${esc(a.name)}, ${esc(a.value)});`);
    }
  }
}

/** 子组件：与解释器同款——dev 渲染错误卡 / prod 记录后占位放行（决策 27 双旗，prod 批归档行挂账的本批收口）。
 * 决策 27 集成收口（M9 codegen strip）：解释器两处错误卡分支已旗控（template.ts 组件未注册 fallback 卡 /
 * validateProps 失败卡），而本发射器此前无旗控——用编译产物的应用在 prod 构建里仍残留 atr-error-card
 * 代码（动态不可达但条件非常量，DCE 不掉）。两处发射改为解释器同款双路（语义逐点同构）。
 * 诚实边界：产物发射形态 = `!(rt.BUILD_PROD || rt.dynProd())`（双旗经 __compiledRT 注入，产物零 import），
 * 与解释器同款双旗短路语义（任一旗真即 prod）；发射源是属性访问 rt.BUILD_PROD，define 折叠 + 分支 DCE
 * 能否剥离归真实 vite build 构建管线验证（prod 批 build-gate 模式），单测只钉守卫形态与运行时行为
 * （tests/codegen-prodflags.test.ts）。
 * F-5 响应式 props：表达式归 mount 桶（父侧 effect 求值回写）；挂载返回 root（wrapper 即弃，append 语义逐字节一致） */
function emitComponent(n, SV, T, out, uid, st) {
  const def = uid("def");
  out.push(`{`);
  out.push(`  const ${def} = registry.get(${esc(n.tag)});`);
  out.push(`  if (!${def}) {`);
  // 组件未注册（解释器 template.ts:948-955 同构）：dev = atr-error-card（文案逐字）；
  // prod = recordRuntimeError（ATR-401，message 形态照解释器 template.ts:949）+ 空 span 占位（不静默）。
  out.push(`    if (!(rt.BUILD_PROD || rt.dynProd())) {`);
  out.push(`      const fb = document.createElement("div");`);
  out.push(`      fb.className = "atr-error-card";`);
  out.push(`      fb.textContent = "ATR-4xx: 组件未注册：" + ${esc(n.tag)} + "（检查 import 是否只注册于组件文件）";`);
  out.push(`      ${T}.appendChild(fb);`);
  out.push(`    } else {`);
  out.push(`      rt.recordRuntimeError({ code: "ATR-401", message: "组件未注册：" + ${esc(n.tag)} });`);
  out.push(`      ${T}.appendChild(document.createElement("span"));`);
  out.push(`    }`);
  out.push(`  } else {`);
  out.push(`    const props = {};`);
  for (const a of n.attrs ?? []) {
    if (a.dynamic) collect(st, "mount", a.value); // F-5 响应式 props：表达式归 mount 桶（父侧 effect 求值回写）
    out.push(
      a.dynamic
        ? `    rt.bindProp(${esc(a.value)}, ${SV}, props, ${esc(a.name)});`
        : `    props[${esc(a.name)}] = ${esc(a.value)};`,
    );
  }
  out.push(`    const v = rt.validateProps(${def}.schema, props, validate);`);
  // validateProps 失败卡（解释器 template.ts:967 同构）。语义逐点核验：dev 无旗 = !v.ok 原语义；
  // prod = validateProps 早退 ok 本就不可达，守卫仅为 define 折叠后 DCE 剔除（动态旗开同早退，else 支挂载语义不变）。
  out.push(`    if (!(rt.BUILD_PROD || rt.dynProd()) && !v.ok) {`);
  out.push(`      const errBox = document.createElement("div");`);
  out.push(`      errBox.className = "atr-error-card";`);
  out.push("      errBox.textContent = `${v.error?.code} ${v.error?.message} — fix: ${v.error?.fix ?? \"\"}`;");
  out.push(`      ${T}.appendChild(errBox);`);
  out.push(`    } else {`);
  out.push(`      const wrapper = document.createElement("span");`);
  out.push(`      ${T}.appendChild(rt.mountComponent(${def}, props, wrapper, registry, validate));`);
  out.push(`    }`);
  out.push(`  }`);
  out.push(`}`);
}

/** {#if}/{:else}：test 链顺序求值、首个命中即停（未命中的分支不求值 ⇒ 依赖追踪行为与解释器一致）。
 * F-5 teardown：换支时旧分支 cleanup 先整体析构（rt.runCleanup），新分支构建包在 rt.withTeardown
 * 里——期间 bindExpr/bindProp/嵌套实例全部落入分支 cleanup 集，与解释器同栈同源（僵尸 effect 红检）。 */
function emitIf(n, SV, T, out, uid, st) {
  const anchor = uid("anchor");
  const cur = uid("cur");
  const cln = uid("cln");
  const builders = (n.blocks ?? []).map((b) => {
    const fn = uid("b");
    const c = uid("c");
    if (b.test !== null) collect(st, "reactive", b.test);
    const lines = [
      `const ${fn} = () => {`,
      `  const ${c} = document.createDocumentFragment();`,
    ];
    emitNodes(b.children ?? [], SV, c, lines, uid, st);
    lines.push(`  return ${c};`);
    lines.push(`};`);
    return { fn, test: b.test, lines };
  });
  out.push(`{`);
  for (const b of builders) out.push(...b.lines);
  out.push(`  const ${anchor} = document.createElement("span");`);
  out.push(`  ${anchor}.style.display = "contents";`);
  out.push(`  let ${cur} = -1;`);
  out.push(`  let ${cln} = [];`);
  out.push(`  const d${cln} = rt.$effect(() => {`);
  out.push(`    let chosen = -1;`);
  (n.blocks ?? []).forEach((b, i) => {
    if (b.test === null) {
      out.push(`    if (chosen < 0) chosen = ${i}; // {:else}（顺序即命中规则）`);
    } else {
      out.push(`    if (chosen < 0) { if (rt.booly(rt.evalExpr(${esc(b.test)}, ${SV}))) chosen = ${i}; }`);
    }
  });
  out.push(`    if (chosen !== ${cur}) {`);
  out.push(`      rt.runCleanup(${cln});`);
  out.push(`      ${cln} = [];`);
  out.push(`      rt.withTeardown(${cln}, () => {`);
  out.push(`        while (${anchor}.firstChild) ${anchor}.removeChild(${anchor}.firstChild);`);
  out.push(`        if (chosen >= 0) ${anchor}.appendChild([${builders.map((b) => b.fn).join(", ")}][chosen]());`);
  out.push(`      });`);
  out.push(`      ${cur} = chosen;`);
  out.push(`    }`);
  out.push(`  });`);
  // 节点级收尾：if 节点整体被上级析构时当前分支 cleanup 一并析构（解释器同款补口）
  out.push(`  rt.captureCleanup(() => { rt.runCleanup(${cln}); d${cln}(); });`);
  out.push(`  ${T}.appendChild(${anchor});`);
  out.push(`}`);
}

/** {#each}：keyed 走同款 reconcile（Map 复用 + appendChild 重排）；无 by 全清重建。
 * 子作用域变量经 uid 唯一化——嵌套 each 的内层展开 { ...外层scope } 不会自引用。
 * F-5 teardown：行构建包 rt.withTeardown（行内 effect/嵌套实例落入行 cleanup 集），
 * 行移除 rt.runCleanup 整行析构；无 key 全清重建前先析构上一轮全部行——与解释器同栈同源。 */
function emitEach(n, SV, T, out, uid, st) {
  const host = uid("host");
  const scv = uid("scope"); // 本层 each 的子作用域变量名（每 item 一个，childScope 语义）
  collect(st, "reactive", n.expr); // 迭代源在外层作用域求值
  const st2 = { ...st, locals: new Set([...st.locals, n.item, n.index]) }; // 子树滤除本层 item/index
  out.push(`{`);
  out.push(`  const ${host} = document.createElement("span");`);
  out.push(`  ${host}.style.display = "contents";`);
  if (n.keyExpr) {
    const live = uid("live");
    const rows = uid("rows");
    const idxMap = uid("rowIdx");
    // P-A P2-R5a：行内 index 引用面（与解释器同源判定——无引用零隐藏信号开销）
    const usesIdx = runtimeTs().templateUsesIndex(n.children, n.index);
    out.push(`  const ${live} = new Map();`);
    out.push(`  const ${rows} = new Map();`);
    out.push(`  const ${idxMap} = new Map();`);
    out.push(`  const d${rows} = rt.$effect(() => {`);
    out.push(`    const arr = (rt.evalExpr(${esc(n.expr)}, ${SV}) ?? []);`);
    out.push(`    const nextKeys = new Set();`);
    out.push(`    arr.forEach((item, i) => {`);
    out.push(`      const ${scv} = { ...${SV}, [${esc(n.item)}]: item, [${esc(n.index)}]: i };`);
    out.push(`      let k;`);
    out.push(`      try { k = rt.stringify(rt.evalExpr(${esc(n.keyExpr)}, ${scv})); } catch { k = \`\${i}\`; }`);
    // R-D4b（ATR-353）：重复身份键 dev 一次性警示单点（与解释器 keyed 支路同源；折叠语义不变）
    out.push(`      rt.warnEachDupKey(${live}, k, nextKeys);`);
    out.push(`      nextKeys.add(k);`);
    out.push(`      let el = ${live}.get(k);`);
    out.push(`      if (!el) {`);
    out.push(`        const box = document.createElement("span");`);
    out.push(`        box.style.display = "contents";`);
    out.push(`        const rowSet = [];`);
    out.push(`        rt.withTeardown(rowSet, () => {`);
    // P-A P2-R5a：行作用域单点（rt.eachRowScope——needIdx 时注入隐藏行 index 信号，随行
    // cleanup 注销；解释器 keyed 支路同函数，双路径同源）
    out.push(`          const row = rt.eachRowScope(${SV}, item, ${esc(n.item)}, ${esc(n.index)}, i, ${usesIdx});`);
    out.push(`          const ${scv} = row.scope;`);
    if (usesIdx) out.push(`          ${idxMap}.set(k, row.index);`);
    out.push(`          const c = document.createDocumentFragment();`);
    emitNodes(n.children ?? [], scv, "c", out, uid, st2);
    out.push(`          box.appendChild(c);`);
    out.push(`        });`);
    out.push(`        ${rows}.set(k, rowSet);`);
    out.push(`        el = box;`);
    out.push(`        ${live}.set(k, el);`);
    out.push(`      } else {`);
    // P-A P2-R5a：key 命中复用 DOM——幸存行 index 信号对齐新遍历序（解释器同款；未变化不写）
    out.push(`        const idxSig = ${idxMap}.get(k);`);
    out.push(`        if (idxSig && idxSig.value !== i) idxSig.value = i;`);
    out.push(`      }`);
    out.push(`      ${host}.appendChild(el); // 同序 no-op；乱序即重排`);
    out.push(`    });`);
    out.push(`    for (const [k, el] of [...${live}]) {`);
    out.push(`      if (!nextKeys.has(k)) {`);
    out.push(`        el.remove();`);
    out.push(`        rt.runCleanup(${rows}.get(k) ?? []);`);
    out.push(`        ${rows}.delete(k);`);
    out.push(`        ${idxMap}.delete(k);`);
    out.push(`      }`);
    out.push(`    }`);
    out.push(`  });`);
    // 节点级收尾：each 节点整体被上级析构时全部行的 cleanup 一并析构（解释器同款补口）
    out.push(`  rt.captureCleanup(() => {`);
    out.push(`    for (const s of ${rows}.values()) rt.runCleanup(s);`);
    out.push(`    ${rows}.clear();`);
    out.push(`    d${rows}();`);
    out.push(`  });`);
  } else {
    const rows = uid("rows");
    out.push(`  let ${rows} = [];`);
    out.push(`  const d${rows} = rt.$effect(() => {`);
    out.push(`    const arr = (rt.evalExpr(${esc(n.expr)}, ${SV}) ?? []);`);
    out.push(`    rt.runCleanup(${rows});`);
    out.push(`    ${rows} = [];`);
    out.push(`    rt.withTeardown(${rows}, () => {`);
    out.push(`      while (${host}.firstChild) ${host}.removeChild(${host}.firstChild);`);
    out.push(`      arr.forEach((item, i) => {`);
    out.push(`        const ${scv} = { ...${SV}, [${esc(n.item)}]: item, [${esc(n.index)}]: i };`);
    out.push(`        const c = document.createDocumentFragment();`);
    emitNodes(n.children ?? [], scv, "c", out, uid, st2);
    out.push(`        ${host}.appendChild(c);`);
    out.push(`      });`);
    out.push(`    });`);
    out.push(`  });`);
    out.push(`  rt.captureCleanup(() => { rt.runCleanup(${rows}); d${rows}(); });`);
  }
  out.push(`  ${T}.appendChild(${host});`);
  out.push(`}`);
}

/* ---------- 对外 API ---------- */

/** raw → CompiledTemplate（in-process；program 由 new Function 构造，零落盘零 import） */
export function compileFunction(name, raw) {
  const ast = runtimeTs().parseTemplate(raw);
  const { body, deps } = programWithDeps(ast);
  let program;
  try {
    program = new Function("ctx", body); // 生成源码受控于本发射器（不接触调用方输入字符串的执行语义）
  } catch (e) {
    throw new CodegenError(`generated program failed to parse (compiler bug): ${e.message}`);
  }
  return { name, raw, styles: runtimeTs().extractStyleBlocks(raw), deps, program };
}

/** raw[] → 完整 ES 模块源码（零 import；应用侧 import 后 registerCompiled 即接入快路径）。
 * 决策 26 v1 留位兑现：opts.schema（CLI main 自 dump.schema 透传的 FlatSchema，仅可提取组件
 * 携带）存在时在 `export const compiled` 之后追加 `export const compiledSchema = <JSON 字面量>;`
 * ——JSON.stringify 确定性序列化（同输入同键序）保证 regen 字节幂等；schema 缺省时产物与
 * 加法前逐字节一致（冻结契约硬约束，golden 钉 tests/schema-codegen.test.ts）。 */
export function compileModuleSource(name, raws, opts = {}) {
  const entries = raws.map((raw) => programWithDeps(runtimeTs().parseTemplate(raw)));
  const schema = opts.schema;
  return [
    `// generated by atelier/compiler/codegen.mjs (P0-2 stage ③) — do not edit by hand`,
    `// component: ${name} · schema: atelier-compiled/0.1 · 运行时能力经 ctx.rt 注入（__compiledRT）`,
    `// deps（F-2 静态依赖清单）＝ 语法级引用集 ⊇ 运行时追踪集（含未执行分支，已滤除 each 子作用域变量）`,
    `export const compiledList = [`,
    ...entries.map(({ body, deps }) =>
      [
        `  {`,
        `    name: ${esc(name)},`,
        `    deps: { reactive: ${JSON.stringify(deps.reactive)}, mount: ${JSON.stringify(deps.mount)}, events: ${JSON.stringify(deps.events)} },`,
        `    program(ctx) {`,
        indentLines(body, "    "),
        `    },`,
        `  },`,
      ].join("\n"),
    ),
    `];`,
    `export const compiled = compiledList[0];`,
    // 决策 26：仅当 schema 存在才发射（dump 面无 schema 键 = 无注解组件，产物形态与旧版逐字节一致）
    ...(schema !== undefined ? [`export const compiledSchema = ${JSON.stringify(schema)};`] : []),
    ``,
  ].join("\n");
}

/** AST → program(ctx) 函数体源码 + 静态依赖清单（发射器唯一出口；compileFunction / compileModuleSource 共用） */
export function programWithDeps(ast) {
  const serial = { n: 0 };
  const uid = (p) => `${p}${++serial.n}`;
  const st = newDepState();
  const out = [
    `const { scope, registry, validate, rt } = ctx;`,
    `const frag = document.createDocumentFragment();`,
  ];
  emitNodes(ast, "scope", "frag", out, uid, st);
  out.push(`return frag;`);
  const deps = {
    reactive: [...st.reactive].sort(),
    mount: [...st.mount].sort(),
    events: [...st.events].sort(),
  };
  return { body: out.join("\n"), deps };
}

/** 兼容出口：只要源码（compileFunction / compileModuleSource 内部走 programWithDeps） */
export function programSource(ast) {
  return programWithDeps(ast).body;
}

/** F-2 二期：raws → 构建期静态依赖图（决策 3「不跑应用即可查询」的查询工件）。
 * 单源 = programWithDeps 同一收集器；组件级 = 各模板清单的并集。
 * 语义边界沿用一期诚实标注：语法级引用集 ⊇ 运行时追踪集（含未执行分支）。 */
export function buildGraph(name, raws) {
  const acc = { reactive: new Set(), mount: new Set(), events: new Set() };
  for (const raw of raws) {
    const { deps } = programWithDeps(runtimeTs().parseTemplate(raw));
    for (const k of Object.keys(acc)) for (const id of deps[k]) acc[k].add(id);
  }
  return {
    component: name,
    schema: "atelier-graph/0.1",
    deps: {
      reactive: [...acc.reactive].sort(),
      mount: [...acc.mount].sort(),
      events: [...acc.events].sort(),
    },
  };
}

function indentLines(text, pad) {
  return text.split("\n").map((l) => pad + l).join("\n");
}

/* ---------- CLI：消费 stage ② dump → .atr/compiled/<Component>.mjs ---------- */

function* findJson(dir, depth = 0) {
  if (depth > 2 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) yield* findJson(path.join(dir, e.name), depth + 1);
    else if (e.name.endsWith(".json") && e.name !== "index.json") yield path.join(dir, e.name);
  }
}

function main() {
  try {
    runtimeTs(); // REL-A A4：闸错在此显式 die（四段式），不放 ERR_UNKNOWN_FILE_EXTENSION 原始栈
  } catch (e) {
    die(e.message, e.fix);
  }
  const argv = process.argv.slice(2);
  const argOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const AST_DIR = path.resolve(argOf("--ast") ?? path.join(process.cwd(), ".atr", "ast"));
  const OUT_DIR = path.resolve(argOf("--out") ?? path.join(AST_DIR, "..", "compiled"));
  const QUIET = argv.includes("--quiet");
  const GRAPH = argv.includes("--graph"); // F-2 二期：同时落盘 .atr/graph/<Component>.json
  const GRAPH_ONLY = argv.includes("--graph-only"); // 查询模式：不落盘任何产物，合并图 JSON → stdout（MCP graph.static 单源）
  if (!fs.existsSync(path.join(AST_DIR, "index.json"))) {
    die(`no stage ② dump at ${AST_DIR}`, "run 'node atelier/compiler/dump.mjs --root <appDir>' first");
  }
  const GRAPH_DIR = path.resolve(argOf("--graph-dir") ?? path.join(AST_DIR, "..", "graph"));
  if (!GRAPH_ONLY) fs.mkdirSync(OUT_DIR, { recursive: true });
  let components = 0;
  let templates = 0;
  const graphs = [];
  for (const f of findJson(AST_DIR)) {
    const dump = JSON.parse(fs.readFileSync(f, "utf8"));
    const name = dump.component;
    if (!name || name === "(module)" || !Array.isArray(dump.templates)) continue;
    const raws = dump.templates.map((t) => t.raw);
    if (GRAPH || GRAPH_ONLY) graphs.push(buildGraph(name, raws));
    if (!GRAPH_ONLY) {
      // 决策 26 v1：dump.schema 透传进产物（无注解组件 = undefined → 不发射，产物形态不变）
      const src = compileModuleSource(name, raws, { schema: dump.schema });
      fs.writeFileSync(path.join(OUT_DIR, `${name}.mjs`), src, "utf8");
      if (GRAPH) {
        fs.mkdirSync(GRAPH_DIR, { recursive: true });
        fs.writeFileSync(path.join(GRAPH_DIR, `${name}.json`), JSON.stringify(graphs[graphs.length - 1], null, 2) + "\n", "utf8");
      }
    }
    components += 1;
    templates += dump.templates.length;
  }
  if (GRAPH_ONLY) {
    process.stdout.write(JSON.stringify({ schema: "atelier-graph/0.1", components: graphs }) + "\n");
    return;
  }
  if (!QUIET) {
    console.log(`[atelier-compiler] stage ③ codegen: ${components} component(s), ${templates} template(s)`);
    console.log(`  → ${path.relative(process.cwd(), OUT_DIR)}${path.sep}<Component>.mjs（应用侧 import + registerCompiled 即接入零 tokenize 快路径）`);
    if (GRAPH) console.log(`  → ${path.relative(process.cwd(), GRAPH_DIR)}${path.sep}<Component>.json（F-2 构建期依赖图）`);
  }
}

if (INVOKED_DIRECTLY) main();
