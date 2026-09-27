/**
 * dev-review-pages.mjs — dev 面人可读页面族（D-F16 调试页 + §11.2/§11.3 review 扩展的呈现层）。
 *
 * 框架自有模块（framework-owned）；init/sync 时随 dev 面五件 vendor 进应用 scripts/
 * （init/sync 的 DEV_FILES 白名单——两处名单同步加行），由 atelier-dev-plugin.mjs 引入：
 *   - endpointsPageHtml()       → GET /__atelier/endpoints（D-F16：端点表 + try-it + schema 展示）
 *   - reviewExtScript()         → GET /__atelier/review-ext.js（review 页扩展：迁移时间轴 ×
 *                                 checkpoint 对齐 / 端点行为 diff / 统一时间轴——数据来自
 *                                 /__atelier/review-data，注入既有 review 页不重写它）
 * 鉴权（P1-12）：页面不再内嵌 token——同源 fetch/脚本标签自动携带一次性 HttpOnly cookie，
 * 由 dev 面 token 门放行；页面自身在 /__atelier/* 门内出焉。
 *
 * 纯 dev 面 vanilla HTML/JS（对齐既有 review UI 风格），零新增依赖、零构建步骤。
 * 数据面契约：/__atelier/server-status（server/introspect.ts 产出 + dev 父进程补充）与
 * /__atelier/review-data（dev-review-data.mjs 聚合）。
 */

/** HTML 转义（与既有 review 页同款 esc 语义——调试页渲染的一切动态值都过它） */
const ESC_SNIPPET = `function esc(s){const d=document.createElement("div");d.textContent=String(s??"");return d.innerHTML;}`;

/**
 * D-F16 `/__atelier/endpoints` 调试页。
 * 数据源 = /__atelier/server-status（token 门内）。诚实边界：
 * - try-it 对 query 与 command 一律 POST <mount>/<name>（JSON 体）——端点运行时契约如此
 *   （契约校验要求 JSON 体；GET 通道只保留给 /live SSE），任务书里"query=GET"的简写不成立；
 * - server 面未就绪 → 页头横幅如实呈现 note，不渲染假表。
 */
export function endpointsPageHtml() {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Atelier Endpoints（D-F16）</title><style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1a1a2e;background:#fafafa}
h1{font-size:18px} h2{font-size:15px;margin:18px 0 8px}
.card{background:#fff;border:1px solid #e2e2e8;border-radius:8px;padding:14px;margin-bottom:16px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #e2e2e8;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f4f4f8} tr:hover td{background:#fbfbff}
code{background:#f4f4f8;padding:1px 4px;border-radius:4px}
.muted{color:#777}.ok{color:#2e7d32}.bad{color:#c62828}
.tag{display:inline-block;border:1px solid #c9c9d4;border-radius:4px;padding:0 6px;margin:1px;font-size:12px}
.tag.command{border-color:#e07b00;color:#e07b00}.tag.query{border-color:#1565c0;color:#1565c0}
button{padding:6px 14px;border-radius:6px;border:1px solid #c9c9d4;background:#fff;cursor:pointer}
button:hover{filter:brightness(.96)}
textarea,input{padding:6px 8px;border:1px solid #c9c9d4;border-radius:6px;font:13px/1.4 ui-monospace,monospace}
textarea{width:100%;min-height:80px;box-sizing:border-box}
#try-output{white-space:pre-wrap;font:13px/1.4 ui-monospace,monospace;background:#f8f8fa;border:1px solid #e2e2e8;border-radius:6px;padding:10px;min-height:40px}
details>summary{cursor:pointer}
.banner{border:1px solid #e07b00;background:#fff7ef;color:#8a5200;border-radius:8px;padding:10px 14px;margin-bottom:16px}
</style></head><body>
<h1>Atelier Endpoints <span class="muted">— D-F16（端点表 · try-it · schema）· 数据源 /__atelier/server-status</span></h1>
<div id="banner"></div>
<div class="card"><h2>server 状态</h2><div id="server-status" class="muted">loading…</div></div>
<div class="card"><h2>端点表</h2>
<table id="endpoint-table"><thead><tr>
<th>name</th><th>kind</th><th>auth</th><th>live / 失效键</th><th>idempotent</th><th>timeoutMs</th><th>契约（input/output）</th><th></th>
</tr></thead><tbody id="endpoint-rows"><tr><td colspan="8" class="muted">loading…</td></tr></tbody></table>
</div>
<div class="card"><h2>try-it <span class="muted">— POST &lt;mount&gt;/&lt;name&gt;，JSON 体 = 契约输入（query/command 同走 POST：契约校验要求 JSON 体；GET 仅 /live SSE 通道）</span></h2>
<div>endpoint：<input id="try-name" placeholder="name（点表内 Try 链入）" style="width:260px"/>
超时：<input id="try-timeout" value="15000" style="width:80px"/>ms</div>
<textarea id="try-input" placeholder='{"msg": "hi"}'></textarea><br/><br/>
<button id="try-send">POST</button> <span id="try-meta" class="muted"></span>
<div id="try-output" class="muted">响应或 ATR 结构化错误会出现在这里</div>
</div>
<script>
${ESC_SNIPPET}
let STATUS = null;
function schemaCell(ep){
  const bits = [];
  if (ep.contract) bits.push(["input", ep.contract]); else bits.push(null);
  if (ep.output) bits.push(["output", ep.output]); else bits.push(null);
  const present = bits.filter(Boolean);
  if (!present.length) return '<span class="muted">（无契约——不校验）</span>';
  return present.map(([k, sch]) => {
    const reqs = sch.reqProps ? Object.keys(sch.reqProps) : [];
    const opts = sch.optProps ? Object.keys(sch.optProps) : [];
    const brief = "{ " + reqs.map(r=>r+": "+(sch.reqProps[r].type||"?")).join(", ") + (opts.length?", "+opts.map(o=>o+"?").join(", "):"") + " }";
    return '<details id="schema-detail"><summary>' + k + ' <code>' + esc(brief) + '</code></summary><pre>' + esc(JSON.stringify(sch, null, 2)) + '</pre></details>';
  }).join(" ");
}
function render(){
  const banner = document.getElementById("banner");
  if (!STATUS || STATUS.ok !== true) {
    banner.innerHTML = '<div class="banner">server 面不可用：' + esc(STATUS && STATUS.note ? STATUS.note : "server-status 不可达") + '<br/><span class="muted">fix：应用目录 pnpm dev（server 面由 dev 托管自动拉起）；确认 src/server/main-server.ts 装配了端点。</span></div>';
    document.getElementById("server-status").textContent = "（不可用）";
    return;
  }
  banner.innerHTML = "";
  const s = STATUS.server || {};
  const live = STATUS.live || {};
  const mig = (STATUS.db && STATUS.db.migrations) || null;
  document.getElementById("server-status").innerHTML =
    "host <code>" + esc(s.host ?? "?") + "</code> · mount <code>" + esc(s.mount ?? "/") + "</code>" +
    " · startedAt <code>" + esc(s.startedAt ?? "?") + "</code> · 热重启 <code>" + esc(s.restarts ?? 0) + "</code> 次" +
    " · db <code>" + esc(s.dbPath ?? "（未装配）") + "</code>" +
    " · live 订阅 <code>" + esc(live.subscriberCount ?? 0) + "</code>" +
    " · journal <code>" + esc((STATUS.journal || []).length) + "</code> 条（环形，重启清零）" +
    (mig ? " · 迁移 head <code>" + esc(mig.head ? ("#" + mig.head.id + " " + mig.head.name) : "（无）") + "</code>" + ((STATUS.db && STATUS.db.migrations && STATUS.db.migrations.pending || []).length ? ' <span class="bad">pending ' + esc(STATUS.db.migrations.pending.length) + '</span>' : "")
         : " · <span class='muted'>迁移状态缺省" + esc(STATUS.dbNote ? "（" + STATUS.dbNote + "）" : "") + "</span>");
  const rows = (STATUS.endpoints || []).map((ep) => {
    const inv = (ep.invalidateKeys || []).map(k=>'<span class="tag">'+esc(k)+'</span>').join(" ") + (ep.emits||[]).map(k=>'<span class="tag">'+esc(k)+'→</span>').join(" ");
    return '<tr>' +
      '<td><code>' + esc(ep.name) + '</code></td>' +
      '<td><span class="tag ' + esc(ep.kind) + '">' + esc(ep.kind) + '</span></td>' +
      '<td>' + (ep.authType ? esc(ep.authType) + (ep.authRole ? '·' + esc(ep.authRole) : '') : '<span class="muted">none</span>') + '</td>' +
      '<td>' + (ep.live ? "live " + inv : (inv || '<span class="muted">—</span>')) + '</td>' +
      '<td>' + (ep.idempotent ? '<span class="ok">yes</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td>' + (ep.timeoutMs != null ? esc(ep.timeoutMs) : '<span class="muted">—</span>') + '</td>' +
      '<td>' + schemaCell(ep) + '</td>' +
      '<td><a href="#" onclick="pick(\\'' + esc(ep.name) + '\\');return false;">Try</a></td>' +
    '</tr>';
  }).join("");
  document.getElementById("endpoint-rows").innerHTML = rows || '<tr><td colspan="8" class="muted">（注册表为空——在 src/server/main-server.ts register 端点）</td></tr>';
}
function pick(name){
  document.getElementById("try-name").value = name;
  const ep = (STATUS && STATUS.endpoints || []).find(function(e){ return e.name === name; });
  if (ep && ep.contract) {
    const sample = {};
    const reqs = ep.contract.reqProps || {};
    for (const k of Object.keys(reqs)) sample[k] = reqs[k].type === "number" ? 1 : reqs[k].type === "string" ? "" : null;
    document.getElementById("try-input").value = JSON.stringify(sample);
  } else {
    document.getElementById("try-input").value = "{}";
  }
}
window.pick = pick;
document.getElementById("try-send").onclick = async function(){
  const name = document.getElementById("try-name").value.trim();
  const out = document.getElementById("try-output");
  const meta = document.getElementById("try-meta");
  if (!name) { out.className = "bad"; out.textContent = "先填 endpoint 名（或点表内 Try）"; return; }
  let body = {};
  const raw = document.getElementById("try-input").value.trim();
  try { body = raw ? JSON.parse(raw) : {}; } catch (e) { out.className = "bad"; out.textContent = "输入不是合法 JSON：" + e.message; return; }
  const mount = (STATUS && STATUS.server && STATUS.server.mount) || "/api";
  const ctrl = new AbortController();
  const timer = setTimeout(function(){ ctrl.abort(); }, Number(document.getElementById("try-timeout").value) || 15000);
  const t0 = performance.now();
  out.className = "muted"; out.textContent = "…POST " + mount + "/" + name;
  try {
    const r = await fetch(mount + "/" + name, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await r.text();
    meta.textContent = "HTTP " + r.status + " · " + Math.round(performance.now() - t0) + "ms";
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* 原样呈现 */ }
    out.className = r.ok ? "ok" : "bad";
    out.textContent = pretty;
  } catch (e) {
    out.className = "bad";
    out.textContent = e.name === "AbortError" ? "超时中止（AbortSignal）" : String(e);
  } finally { clearTimeout(timer); }
};
async function load(){
  try {
    // P1-12：无 token 头——同源 fetch 自动携带一次性 HttpOnly cookie，token 门经 cookie 放行
    const r = await fetch("/__atelier/server-status");
    STATUS = await r.json();
  } catch (e) { STATUS = { ok: false, note: String(e) }; }
  render();
}
load();
setInterval(load, 5000);
</script></body></html>`;
}

/**
 * review 页扩展脚本（/__atelier/review-ext.js）：注入既有 /__atelier/review 页，
 * 追加三个 section（§11.2 迁移时间轴×checkpoint 对齐 / 端点行为 diff；§11.3 统一时间轴）。
 * 数据全部来自 /__atelier/review-data（token 门内），不引入第二数据面。
 */
export function reviewExtScript() {
  return `/* review 扩展（FS-M6 §11.2/§11.3）——由 atelier-dev-plugin 注入 /__atelier/review 页。 */
(function(){
${ESC_SNIPPET}
const ROOT = document.createElement("div");
ROOT.id = "server-review";
ROOT.innerHTML = '<h2>迁移时间轴 × checkpoint 对齐 <span class="muted">— §11.2（"这个锚点在 schema 哪个版本"一处可答）</span></h2>' +
  '<div class="row"><div class="col card"><h3>迁移（atelier_migrations，只读）</h3><ul id="migration-timeline" class="muted">loading…</ul><div id="migration-note" class="muted"></div></div>' +
  '<div class="col card"><h3>checkpoint 锚点（本地台账）</h3><ul id="checkpoint-align" class="muted">loading…</ul><div id="checkpoint-note" class="muted"></div></div></div>' +
  '<h2>端点行为 diff <span class="muted">— §11.2（checkpoint 前后 command journal：这轮调了哪些端点、成败、耗时）</span></h2>' +
  '<div class="card">锚点：<select id="diff-anchor"><option value="">（选择 checkpoint）</option></select> <span id="diff-summary" class="muted"></span>' +
  '<div id="diff-detail"></div></div>' +
  '<h2>审计统一时间轴 <span class="muted">— §11.3（command journal + MCP/dev 操作审计 + 迁移审计 三源归一：agent 这轮做了什么）</span></h2>' +
  '<div class="card"><ul id="unified-timeline" class="muted">loading…</ul></div>';
document.body.appendChild(ROOT);
const style = document.createElement("style");
style.textContent = '#server-review h3{font-size:13px;margin:8px 0 6px} #server-review li{margin:2px 0} ' +
  '.src{display:inline-block;border-radius:4px;padding:0 6px;font-size:11px;border:1px solid #c9c9d4;margin-right:6px}' +
  '.src.command{border-color:#1565c0;color:#1565c0}.src.audit{border-color:#7b1fa2;color:#7b1fa2}.src.migration{border-color:#2e7d32;color:#2e7d32}';
document.head.appendChild(style);

const REL = { equal: ["对齐当前库头", "ok"], behind: ["落后于当前库头（rollback 该锚会被 21-③ 拒绝——先 migrate down）", "bad"], ahead: ["超前于当前库头（库被 down 过？）", "bad"], unknown: ["无迁移头（vacuous 锚定或库不在）", "muted"] };
let DATA = null;

function renderMigrations() {
  const ul = document.getElementById("migration-timeline");
  const note = document.getElementById("migration-note");
  const m = DATA.migrations || {};
  if (!m.ok) { ul.innerHTML = "<li>" + esc(m.note || "迁移状态缺省") + "</li>"; note.textContent = ""; return; }
  ul.innerHTML = (m.rows || []).map(function(r) {
    return "<li><code>" + esc(new Date(r.appliedAt).toLocaleString()) + "</code> #" + esc(r.id) + " " + esc(r.name) +
      (r.downVerified ? ' <span class="ok">down✔</span>' : "") + "</li>";
  }).join("") || "<li>(空——migrate up 后出现在这里)</li>";
  note.textContent = m.source === "server-status" ? "来源：server 面 server-status（子进程只读）" : "来源：node:sqlite 只读直开（server 面不在时的兜底——Node 内建实验性模块）";
}
function renderCheckpoints() {
  const ul = document.getElementById("checkpoint-align");
  const note = document.getElementById("checkpoint-note");
  const sel = document.getElementById("diff-anchor");
  const cp = DATA.checkpoints || {};
  if (!cp.ok) { ul.innerHTML = "<li>" + esc(cp.note || "台账不可用") + "</li>"; note.textContent = ""; sel.innerHTML = '<option value="">（无台账）</option>'; return; }
  const aligned = DATA.aligned || [];
  ul.innerHTML = aligned.map(function(a) {
    const rel = REL[a.relation] || REL.unknown;
    const head = a.migrationHead ? "head=#" + esc(a.migrationHead.id) + " " + esc(a.migrationHead.name) : "无迁移头";
    return "<li><code>" + esc(a.id) + "</code> " + esc(a.name) + ' <span class="muted">' + esc(new Date(a.at).toLocaleString()) + "</span><br/>" +
      '<span class="muted">' + head + " · " + '</span><span class="' + rel[1] + '">' + esc(rel[0]) + "</span></li>";
  }).join("") || "<li>(空——atelier checkpoint save 后出现在这里)</li>";
  note.textContent = "台账是本地态（.gitignore）——缺失即降级，不假数据";
  sel.innerHTML = '<option value="">（选择 checkpoint）</option>' + aligned.map(function(a) {
    return '<option value="' + esc(a.id) + '">' + esc(a.id + " " + a.name) + "</option>";
  }).join("");
}
function renderDiff() {
  const box = document.getElementById("diff-detail");
  const sum = document.getElementById("diff-summary");
  const d = DATA.diff;
  if (!d) { sum.textContent = ""; box.innerHTML = '<span class="muted">选择一个 checkpoint 查看前后 command journal 窗口对比（journal 为内存环形——重启清零，跨重启历史见统一时间轴的 audit 源）</span>'; return; }
  if (d.note) { sum.textContent = ""; box.innerHTML = '<span class="bad">' + esc(d.note) + "</span>"; return; }
  const fmt = function(s) { return s.calls + " 调用（ok " + s.ok + " / failed " + s.failed + "，Σ " + s.durMs + "ms）"; };
  sum.innerHTML = "锚定前：" + esc(fmt(d.summary.before)) + " → 本轮未锚定：" + esc(fmt(d.summary.since));
  const list = function(rows) {
    return rows.length ? "<ul>" + rows.map(function(r) {
      return '<li><span class="' + (r.status === "failed" ? "bad" : "ok") + '">' + esc(r.status) + "</span> <code>" + esc(r.name) + "</code> " +
        '<span class="muted">' + esc(new Date(r.ts).toLocaleTimeString()) + " · " + esc(r.durMs != null ? r.durMs + "ms" : "?") + (r.principal ? " · " + esc(r.principal) : "") + "</span></li>";
    }).join("") + "</ul>" : '<span class="muted">（无）</span>';
  };
  box.innerHTML = "<h3>锚定前窗口（上一轮）</h3>" + list(d.before) + "<h3>本轮（锚点之后）</h3>" + list(d.since);
}
function renderTimeline() {
  const ul = document.getElementById("unified-timeline");
  const rows = DATA.timeline || [];
  ul.innerHTML = rows.length ? rows.map(function(r) {
    return '<li><span class="src ' + esc(r.source) + '">' + esc(r.source) + "</span> <code>" + esc(r.name) + "</code> " +
      '<span class="' + (r.status === "failed" ? "bad" : "muted") + '">' + esc(r.status) + "</span> " +
      '<span class="muted">' + esc(new Date(r.ts).toLocaleString()) + (r.principal ? " · " + esc(r.principal) : "") + (r.durMs != null ? " · " + esc(r.durMs) + "ms" : "") + "</span>" +
      (r.detail ? '<br/><span class="muted">' + esc(r.detail) + "</span>" : "") + "</li>";
  }).join("") : "<li>(空——三源都还没有记录)</li>";
}
function render() { renderMigrations(); renderCheckpoints(); renderDiff(); renderTimeline(); }
async function load(anchorId) {
  try {
    // P1-12：无 token 头——同源 fetch 自动携带一次性 HttpOnly cookie
    const r = await fetch("/__atelier/review-data" + (anchorId ? "?anchor=" + encodeURIComponent(anchorId) : ""));
    DATA = await r.json();
  } catch (e) { DATA = { ok: false, migrations: { ok: false, note: String(e) }, checkpoints: { ok: false }, timeline: [] }; }
  render();
}
document.getElementById("diff-anchor").onchange = function(e) { load(e.target.value || null); };
load(null);
setInterval(function() { load(document.getElementById("diff-anchor").value || null); }, 5000);
})();
`;
}
