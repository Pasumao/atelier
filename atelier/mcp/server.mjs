#!/usr/bin/env node
/**
 * server.mjs — Atelier built-in MCP Server (stdio transport, zero-dependency)
 *
 * Decision 7: "framework-embedded agent layer". This server exposes the
 * Atelier tool surface (query / operation / audit faces) to any MCP-capable
 * coding agent (Claude Code, Cursor, Codex, VS Code Copilot).
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over stdio (MCP spec).
 *   handled: initialize · notifications/initialized · ping · tools/list · tools/call
 *            (+ empty prompts/resources lists so hosts probe cleanly)
 *
 * Single-source discipline (scripts/check-skills.mjs enforced):
 *   tools/list is GENERATED from ../mcp/mcp-definitions.json — flat schema
 *   (reqProps/optProps) is translated to standard JSON Schema here.
 *
 * Tool execution: forwarded to the running dev surface (default
 * http://127.0.0.1:5173, override with ATELIER_DEV_URL) via ENDPOINT_MAP.
 * Tools with status != "implemented" answer with a structured, actionable
 * error (ATR style) instead of being hidden — agents see the full design.
 *
 * Security baseline (ARCHITECTURE §9): localhost only, no exec of raw model
 * strings; every mutation goes through the dev surface confirm tiers later.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import readline from "node:readline";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { inspectStructure } from "../scripts/struct.mjs";
import { confirmGate, readAgentConfig } from "./confirm.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFS = JSON.parse(fs.readFileSync(path.join(HERE, "mcp-definitions.json"), "utf8"));
const SERVER_INFO = { name: "atelier", version: DEFS.$meta?.version ?? "0.1.0" };
const PROTOCOL_LATEST = "2025-06-18";
const BASE = (process.env.ATELIER_DEV_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const PROJECT_ROOT_ENV = process.env.ATELIER_PROJECT_ROOT;

/** dev-surface routes used by implemented tools (extend as endpoints land) */
const ENDPOINT_MAP = {
  "registry.list_components": "/__atelier/registry",
  "registry.get_component": "/__atelier/registry", // list; filtered by args.name below
  "tokens.list": "/__atelier/tokens",
  "state.snapshot": "/__atelier/state-snapshot",
  "ui.screenshot": "/__atelier/screenshot",
};

/* ---------- schema translation: flat (decision 6) → standard JSON Schema ---------- */
function flatToJsonSchema(params) {
  if (!params || params.type !== "object") return { type: "object", properties: {}, required: [] };
  const req = params.reqProps ?? {};
  const opt = params.optProps ?? {};
  return {
    type: "object",
    properties: { ...structuredClone(req), ...structuredClone(opt) },
    required: Object.keys(req),
    additionalProperties: false,
  };
}

/** P2-2② toolsets 分组按需启用：ATELIER_TOOLSETS=query,operation（逗号分隔 face 名）只暴露
 * 子集——上下文窗口紧张或权限面收敛时用；缺省全部暴露。face 取值见 mcp-definitions.json。 */
const TOOLSETS = (process.env.ATELIER_TOOLSETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TOOLS = DEFS.tools
  .filter((t) => TOOLSETS.length === 0 || TOOLSETS.includes(t.face))
  .map((t) => ({
    name: t.name,
    description: `[${t.face}]${t.status === "pending" ? " (specified, wiring pending)" : ""} ${t.summary}`,
    inputSchema: flatToJsonSchema(t.params),
  }));

/** P2-2② 四段式错误 → MCP structured error：isError=true + structuredContent{code,message,fix}，
 * 文本保持原形（"\nfix: ..."）——不破坏既有解析方，宿主可二选一消费。 */
function toolError(codeText, fixText) {
  const e = new Error(`${codeText}\nfix: ${fixText}`);
  const m = /^(ATR-[\w-]+):\s*([\s\S]*)$/.exec(codeText);
  e.atr = { code: m ? m[1] : "ATR-ERR", message: m ? m[2] : codeText, fix: fixText };
  return e;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const DEV_TOKEN = (() => {
  for (const p of [path.join(PROJECT_ROOT_ENV ?? process.cwd(), ".atelier", "dev-token")]) {
    try { return fs.readFileSync(p, "utf8").trim(); } catch { /* next */ }
  }
  return "";
})();
async function devJson(pathWithQuery, init = {}) {
  const headers = { ...(init.headers ?? {}), "x-atelier-token": DEV_TOKEN };
  const r = await fetch(`${BASE}${pathWithQuery}`, { signal: AbortSignal.timeout(45000), ...init, headers }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`,
      `start the dev server ('atelier dev' inside your Atelier app dir) or set ATELIER_DEV_URL`,
    );
  });
  if (!r.ok && r.status === 401) {
    throw toolError("ATR-402: dev token rejected", "read .atelier/dev-token next to the app root and send it as x-atelier-token");
  }
  return r.json();
}

/** P0-1 downlink: enqueue a command for the open page over SSE, then poll its ack. */
async function bridgeCall(op, args = {}) {
  const enq = await devJson("/__atelier/bridge/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, args }),
  });
  const clients = enq.clients ?? 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    await sleepMs(250);
    const st = await devJson(`/__atelier/bridge/cmd-status?id=${encodeURIComponent(enq.id)}`);
    if (st.status === "done") {
      if (st.ok) return st.result;
      throw toolError("ATR-4xx-dev: downlink op failed on the page", st.error ?? "see the page console");
    }
  }
  throw toolError(
    `ATR-4xx-dev: no open page answered "${op}" within 10s${clients ? "" : ` (SSE subscribers: ${clients})`}`,
    "keep the app open in a dev preview — transient screenshot/headless instances are closed by design",
  );
}

/** run scripts/checkpoint.mjs in the app root; its --json payload is stdout (pretty for list, single-line for save/rollback) */
function checkpointCli(args, cwd) {
  const script = path.join(HERE, "..", "scripts", "checkpoint.mjs");
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  const errLines = (r.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (r.status !== 0) {
    const msg = (errLines.find((l) => l.startsWith("error: ")) ?? errLines.at(-1) ?? `checkpoint exited ${r.status}`).replace(/^error: /, "");
    const fix = errLines.find((l) => l.startsWith("fix: "))?.slice(5);
    throw toolError(`ATR-4xx-checkpoint: ${msg}`, fix ?? "run checkpoint.source_list for the timeline");
  }
  const out = (r.stdout ?? "").trim();
  try { return JSON.parse(out); } catch { /* fall through: last line may still be the payload */ }
  const last = out.split("\n").at(-1) ?? "";
  try { return JSON.parse(last); } catch { return { ok: true, raw: last }; }
}

async function callTool(name, args) {
  const PROJECT_ROOT = process.env.ATELIER_PROJECT_ROOT ?? process.cwd();

  /* ---- confirm 闸（决策 15）：破坏性操作（回滚族）过 agent.confirm 档，deny → ATR-402 结构化拒绝 ---- */
  const denial = confirmGate(readAgentConfig(PROJECT_ROOT), name);
  if (denial) throw toolError(`${denial.code}: ${denial.message}`, denial.fix);

  /* ---- downlink-executed tools (runtime lives in the open page; P0-1 SSE channel) ---- */
  if (name === "checkpoint.list") return bridgeCall("checkpoint.list", {});
  if (name === "checkpoint.rollback") return bridgeCall("checkpoint.rollback", args ?? {});
  if (name === "state.time_travel") return bridgeCall("state.time_travel", args ?? {});
  if (name === "state.graph") return bridgeCall("state.graph", {}); // P2-1：依赖图（F-1 收尾）
  if (name === "state.journal")
    return bridgeCall("state.journal", { lines: Math.max(1, Math.min(500, Number(args?.lines ?? 100))) });
  if (name === "ui.a11y") {
    const j = await devJson("/__atelier/a11y"); // P2-2③：无障碍树文本化
    return j;
  }
  if (name === "audit.log") {
    const j = await devJson(`/__atelier/audit?lines=${Math.max(1, Math.min(500, Number(args?.lines ?? 50)))}`);
    return j.rows;
  }

  /* ---- locally computed tools (no dev-surface round trip) ---- */
  if (name === "structure.map") return inspectStructure(args?.root ?? PROJECT_ROOT);
  if (name === "structure.check") {
    const res = inspectStructure(args?.root ?? PROJECT_ROOT);
    return { verdict: res.summary.errors > 0 ? "FAILED" : "PASSED", ...res };
  }
  /* decision-15 source checkpoints: thin spawn over scripts/checkpoint.mjs — same code path as the
   * CLI, so the P2-2 未检不锚 snapshot gate applies identically to MCP-originated anchors. No
   * --no-gate over the wire: the escape hatch stays a human CLI act. */
  if (name === "checkpoint.source_list") return checkpointCli(["list", "--json"], PROJECT_ROOT);
  if (name === "checkpoint.source_commit") {
    return checkpointCli(["save", String(args?.message ?? `AI turn ${new Date().toISOString()}`), "--json"], PROJECT_ROOT);
  }
  if (name === "checkpoint.source_rollback") {
    if (!args?.id) throw toolError("ATR-401: checkpoint.source_rollback requires args.id", "pick one from checkpoint.source_list output");
    return checkpointCli(["rollback", String(args.id), "--json"], PROJECT_ROOT);
  }

  /* ---- F-2 二期：构建期静态依赖图查询（read-only，不跑应用、不需要 dev face）----
   * thin spawn over compiler/codegen.mjs --graph-only（单源 = 同一收集器），读 stage ② dump
   * 出组件级 deps 清单；无 dump 时结构化报错指路 compile。 */
  if (name === "graph.static") {
    const root = path.resolve(String(args?.root ?? PROJECT_ROOT));
    const astDir = path.join(root, ".atr", "ast");
    if (!fs.existsSync(path.join(astDir, "index.json"))) {
      throw toolError(
        `ATR-401: no stage-② dump at ${astDir}`,
        "run 'node <repo>/atelier/cli.mjs compile --root <appDir>' first, then retry graph.static",
      );
    }
    const codegen = path.join(HERE, "..", "compiler", "codegen.mjs");
    const r = spawnSync(process.execPath, [codegen, "--ast", astDir, "--graph-only", "--quiet"], { encoding: "utf8", timeout: 60000 });
    if (r.status !== 0) {
      throw toolError("ATR-500: static graph build failed", (r.stderr ?? "").trim().split("\n").slice(-3).join(" | ") || "inspect .atr/ast dump integrity");
    }
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw toolError("ATR-500: graph payload unparseable", "rerun graph.static; if it persists, check codegen.mjs --graph-only output");
    }
  }

  /* ---- P0 backlog 批次转绿（2026-08-29）：state.get / test.run / diff.report / feedback.read / docs.search ---- */
  if (name === "state.get") {
    const p = String(args?.path ?? "").trim();
    if (!p) {
      throw toolError(
        "ATR-401: state.get requires args.path",
        'syntax "sig-<n>" or "sig-<n>.<sub.path>" (e.g. "sig-0" / "sig-0.items.2.label") — wire shape via state.snapshot',
      );
    }
    const snap = await devJson("/__atelier/state-snapshot");
    if (!snap || snap.ok === false) {
      throw toolError("ATR-4xx-dev: no bridge state available yet", snap?.note ?? "open the app once in dev preview so the page pushes its signal graph");
    }
    const parts = p.split(".").filter(Boolean);
    const head = parts[0] ?? "";
    const idx = head.startsWith("sig-") ? Number(head.slice(4)) : /^\d+$/.test(head) ? Number(head) : NaN;
    if (Number.isNaN(idx)) {
      throw toolError(
        `ATR-401: state.get path must start at a signal key ("sig-<n>"), got "${head}"`,
        `the live graph exposes sig-0 … sig-${Math.max(0, (snap.signalCount ?? 1) - 1)} — full shape via state.snapshot`,
      );
    }
    const sig = (snap.signals ?? [])[idx];
    if (!sig) {
      throw toolError(
        `ATR-401: no signal "${head}" in the live graph`,
        `snapshot has ${snap.signalCount ?? 0} signals; known boundary: signals mounted after bridge install are invisible until reload`,
      );
    }
    let value = sig.value;
    for (const seg of parts.slice(1)) {
      if (value === null || typeof value !== "object" || !(seg in value)) {
        throw toolError(`ATR-401: path "${p}" breaks at segment "${seg}"`, `value at this depth: ${JSON.stringify(value)?.slice(0, 240) ?? String(value)}`);
      }
      value = value[seg];
    }
    return { path: p, signalKey: sig.key, value, snapshotAt: snap.at, href: snap.href };
  }

  if (name === "docs.search") {
    const q = String(args?.q ?? "").trim().toLowerCase();
    if (!q) throw toolError("ATR-401: docs.search requires args.q", 'e.g. "HMR state preserve" or "ATR-204"');
    const terms = q.split(/\s+/).filter(Boolean);
    const files = [];
    const walk = (dir, depth = 0) => {
      if (depth > 4) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p2 = path.join(dir, e.name);
        if (e.isDirectory()) walk(p2, depth + 1);
        else if (/\.(md|txt)$/i.test(e.name)) files.push(p2);
      }
    };
    // 语料（ARCHITECTURE §工具表）：框架规格文档单源 + skill 包 + 工作区 AGENTS.md + 应用 llms.txt
    walk(path.join(HERE, "..", "docs"));
    walk(path.join(HERE, "..", "skills"));
    try { if (fs.statSync(path.join(HERE, "..", "..", "AGENTS.md")).isFile()) files.push(path.join(HERE, "..", "..", "AGENTS.md")); } catch { /* absent */ }
    try { if (fs.statSync(path.join(PROJECT_ROOT, "llms.txt")).isFile()) files.push(path.join(PROJECT_ROOT, "llms.txt")); } catch { /* absent */ }
    const scored = [];
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      const lower = text.toLowerCase();
      let score = 0;
      const hits = [];
      for (const t of terms) {
        const n = t ? lower.split(t).length - 1 : 0;
        if (n > 0) { score += n; hits.push({ term: t, count: n }); }
      }
      if (!score) continue;
      const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(f)).trim();
      if (title.toLowerCase().includes(terms[0]) || lower.split("\n")[0]?.includes(terms[0])) score += 10;
      const lines = text.split("\n");
      const li = lines.findIndex((l) => l.toLowerCase().includes(terms[0]));
      const excerpt = li >= 0 ? lines.slice(Math.max(0, li - 1), li + 3).join(" ⏎ ").slice(0, 300) : title;
      scored.push({ file: f, title, score, hits, excerpt });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    return {
      query: q,
      scanned: files.length,
      results: top,
      note: top.length ? undefined : `no hit for ${JSON.stringify(q)} in framework docs / skill packages / AGENTS.md / llms.txt`,
    };
  }

  if (name === "test.run") {
    const filter = args?.filter ? String(args.filter).trim() : "";
    if (/["'`|;&<>]/.test(filter)) {
      throw toolError("ATR-401: test.run filter must be a plain file-name pattern", `got ${JSON.stringify(filter)} — no shell metacharacters; e.g. "contract" or "src/greeting"`);
    }
    // 与应用 package.json "test" 同一表面（vitest run）；filter 作 vitest 位置参数（文件名过滤）
    const r = spawnSync("pnpm", filter ? ["test", filter] : ["test"], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 180000,
      shell: process.platform === "win32", // pnpm 在 Windows 是 .cmd
    });
    if (r.error) {
      if (r.error.code === "ENOENT") throw toolError("ATR-4xx-test: pnpm not found on PATH", "install pnpm, or run the suite via CLI ('atelier test')");
      throw toolError(`ATR-4xx-test: test run terminated (${r.error.code ?? "killed"})`, "run the suite locally ('pnpm test') to inspect the hanging test");
    }
    const lines = (r.stdout ?? "").split("\n").map((l) => l.trimEnd());
    return {
      ok: r.status === 0,
      exitCode: r.status,
      filter: filter || null,
      summary: {
        testFiles: lines.find((l) => /Test Files\s+\S/.test(l))?.trim() ?? null,
        tests: lines.find((l) => /Tests\s+\S/.test(l))?.trim() ?? null,
      },
      outputTail: lines.filter(Boolean).slice(-60),
    };
  }

  if (name === "diff.report") {
    // 基线 = 最近一条 source checkpoint 锚点；本工具提供机器可核的文件级事实
    //（per-change 语义摘要由发起评审的 agent 附在报告后），落盘 .atelier/diff-report.md 供人审。
    const cps = checkpointCli(["list", "--json"], PROJECT_ROOT);
    // checkpoints.jsonl 的锚字段是 sha（旧条目兼容 commit）；回滚条目无 sha，自然被过滤
    const base = [...(Array.isArray(cps) ? cps : [])].reverse().find((c) => c?.sha || c?.commit) ?? null;
    if (!base?.sha && !base?.commit) {
      throw toolError("ATR-4xx-checkpoint: no source checkpoint to diff against", "create one first: checkpoint.source_commit (or CLI 'atelier checkpoint save')");
    }
    const baseCommit = base.sha ?? base.commit;
    const baseId = base.id ?? "?";
    const baseName = base.name ?? "";
    const git = (gitArgs) => {
      const g = spawnSync("git", gitArgs, { cwd: PROJECT_ROOT, encoding: "utf8" });
      if (g.status !== 0) {
        throw toolError(`ATR-4xx-git: git ${gitArgs[0]} failed`, (g.stderr ?? "").trim() || "run inside a git-managed app workspace");
      }
      return g.stdout ?? "";
    };
    const stat = git(["diff", "--stat", baseCommit]).trim();
    const numstat = git(["diff", "--numstat", baseCommit]).trim();
    const status = git(["status", "--short"]).trim();
    const short = String(baseCommit).slice(0, 7);
    const report = [
      "# Atelier diff report",
      "",
      `- Generated: ${new Date().toISOString()}`,
      `- Baseline: checkpoint ${baseId} "${baseName}" (${short})`,
      "- Scope: working tree vs baseline（文件级事实；语义摘要由发起评审的 agent 补充）",
      "",
      "## Diff stat",
      "",
      "```",
      stat || "(no tracked changes)",
      "```",
      "",
      "## Working tree status",
      "",
      "```",
      status || "(clean)",
      "```",
      "",
      "## Per-file adds/deletes",
      "",
      numstat || "(none)",
      "",
    ].join("\n");
    const reportPath = path.join(PROJECT_ROOT, ".atelier", "diff-report.md");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, report, "utf8");
    return { reportPath, baseline: { id: baseId, commit: baseCommit, name: baseName }, report };
  }

  if (name === "feedback.read") {
    const specsDir = path.join(PROJECT_ROOT, "specs");
    const rows = [];
    try {
      const jl = fs.readFileSync(path.join(specsDir, "feedback.jsonl"), "utf8");
      for (const line of jl.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try { rows.push({ kind: "jsonl", ...JSON.parse(t) }); } catch { rows.push({ kind: "jsonl", raw: t, note: "unparsable line" }); }
      }
    } catch { /* no feedback.jsonl yet */ }
    try {
      for (const f of fs.readdirSync(specsDir)) {
        if (f.endsWith(".feedback.md")) {
          rows.push({ kind: "markdown", file: path.join(specsDir, f), content: fs.readFileSync(path.join(specsDir, f), "utf8") });
        }
      }
    } catch { /* no specs/ dir yet */ }
    return {
      rows,
      note: rows.length
        ? undefined
        : 'no human feedback recorded yet. Convention: append one JSON line per verdict to specs/feedback.jsonl ({at, verdict: "approve"|"disapprove", target, note}) or drop a free-form specs/<name>.feedback.md — the review UI (P2-5) writes the same format',
    };
  }
  if (name === "snapshot.diff" || name === "snapshot.review_diff") {
    const shot = await fetch(`${BASE}/__atelier/screenshot?compare=1`, {
      signal: AbortSignal.timeout(60000),
      headers: { "x-atelier-token": DEV_TOKEN },
    }).catch((e) => {
      throw toolError(`ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`, "start the dev server ('atelier dev' inside your Atelier app dir) first");
    });
    const j = await shot.json();
    if (!j.ok) throw toolError("ATR-4xx-dev: capture failed", j.error ?? "inspect dev server logs");
    const dir = path.join(PROJECT_ROOT, ".atr", "snapshots");
    fs.mkdirSync(dir, { recursive: true });
    const curPath = path.join(dir, "current.png");
    const basePath = path.join(dir, "baseline.png");
    fs.writeFileSync(curPath, Buffer.from(j.imageBase64, "base64"));
    const out = { paths: { current: curPath, baseline: fs.existsSync(basePath) ? basePath : null } };
    if (!fs.existsSync(basePath)) {
      out.match = null;
      out.note = "no baseline yet — review current; promote intentionally via 'atelier snapshot check --update' or save a first baseline";
    } else {
      const h = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      const byteSame = h(curPath) === h(basePath);
      const threshold = Number(j.threshold ?? 0.12);
      const ratio = j.pixelDiff ? j.pixelDiff.mismatchRatio : null;
      // same verdict ladder as scripts/snapshot.mjs (P1-8): MATCH / PIXMATCH / MISMATCH
      out.byteMatch = byteSame;
      out.pixelDiff = j.pixelDiff ?? null;
      out.threshold = threshold;
      out.verdict = byteSame ? "MATCH" : ratio !== null && !j.pixelDiff.dimsDiffer && ratio <= threshold ? "PIXMATCH" : "MISMATCH";
      out.note = out.verdict === "MATCH"
        ? "pixel-stable against baseline"
        : out.verdict === "PIXMATCH"
          ? `bytes differ but mismatchRatio ${ratio.toExponential(2)} ≤ ${threshold} (fonts/AA jitter is not a regression)`
          : `differs from baseline${ratio !== null ? ` (mismatchRatio ${ratio.toExponential(2)} > ${threshold})` : ""} — review both images side by side; promotion is a CLI/human act`;
    }
    if (name === "snapshot.review_diff") out.imageBase64 = j.imageBase64;
    return out;
  }

  const def = DEFS.tools.find((t) => t.name === name);
  if (!def) {
    throw toolError(`ATR-404: unknown tool "${name}"`, "pick a tool from tools/list output");
  }
  if (def.status !== "implemented") {
    throw toolError(
      `ATR-4xx-dev: "${name}" is specified but not wired yet (status=pending)`,
      `implement its route in the dev plugin (see mcp-definitions.json summary), then run 'atelier dev'; usage guidance: skill "atelier-mcp-tools"`
    );
  }
  let route = ENDPOINT_MAP[name];
  if (!route) {
    throw toolError(
      `ATR-4xx-dev: no route mapped for "${name}"`,
      "add it to ENDPOINT_MAP in mcp/server.mjs once the dev endpoint exists"
    );
  }
  // fetch the route; never interpolate raw values into paths except whitelisted query params below
  const res = await fetch(BASE + route, {
    signal: AbortSignal.timeout(4000),
    headers: { "x-atelier-token": DEV_TOKEN },
  }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`,
      "start the dev server ('atelier dev' inside your Atelier app dir) or set ATELIER_DEV_URL",
    );
  });
  if (res.status === 401) {
    throw toolError("ATR-402: dev token rejected", "read .atelier/dev-token next to the app root and send it as x-atelier-token");
  }
  if (!res.ok) {
    throw toolError(`ATR-4xx-dev: dev surface returned HTTP ${res.status} for ${route}`, "check dev server logs");
  }
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { data = body; }

  if (name === "registry.get_component") {
    const wanted = args?.name;
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.components)
        ? data.components
        : [];
    const hit = list.find((c) => c?.name === wanted || c?.id === wanted);
    if (!hit) {
      throw toolError(
        `ATR-401: component "${wanted ?? "(none)"}" not registered`,
        `registered names: ${list.map((c) => c?.name ?? c?.id).join(", ") || "(empty)"} — import the component file and pass opts.name explicitly`
      );
    }
    return hit;
  }
  return data;
}

/* ---------- stdio JSON-RPC plumbing ---------- */
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
      return;
    case "notifications/initialized":
    case "$/cancelRequest":
      return; // notifications: no reply
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "prompts/list":
      reply(id, { prompts: [] });
      return;
    case "resources/list":
      reply(id, { resources: [] });
      return;
    case "tools/call": {
      const name = params?.name;
      try {
        const out = await callTool(name, params?.arguments);
        reply(id, {
          content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }],
          isError: false,
        });
      } catch (e) {
        const result = {
          content: [{ type: "text", text: e?.message ?? String(e) }],
          isError: true,
        };
        if (e?.atr) result.structuredContent = e.atr; // P2-2②：四段式结构化映射
        reply(id, result);
      }
      return;
    }
    default:
      if (id !== undefined) replyError(id, -32601, `method not supported: ${method}`);
  }
}

/* ---------- lifecycle ---------- */
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  Promise.resolve(handle(msg)).catch((e) => {
    // last-resort containment: an unexpected crash must not kill the session
    if (msg?.id !== undefined && msg?.id !== null) {
      replyError(msg.id, -32603, `internal error: ${e?.message ?? String(e)}`);
    }
  });
});
rl.on("close", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("SIGHUP", () => process.exit(0));

process.stderr.write(`[atelier-mcp] ${SERVER_INFO.name}@${SERVER_INFO.version}: ${TOOLS.length} tools, dev=${BASE}\n`);
