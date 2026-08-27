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
import { inspectStructure } from "../scripts/struct.mjs";

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

const TOOLS = DEFS.tools.map((t) => ({
  name: t.name,
  description: `[${t.face}]${t.status === "pending" ? " (specified, wiring pending)" : ""} ${t.summary}`,
  inputSchema: flatToJsonSchema(t.params),
}));

/* ---------- tool error helper: every failure is actionable (SPEC §3) ---------- */
function toolError(codeText, fixText) {
  return new Error(`${codeText}\nfix: ${fixText}`);
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const DEV_TOKEN = (() => {
  for (const p of [path.join(PROJECT_ROOT_ENV ?? process.cwd(), ".atelier", "dev-token"), path.join(PROJECT_ROOT_ENV ?? process.cwd(), "prototype", ".atelier", "dev-token")]) {
    try { return fs.readFileSync(p, "utf8").trim(); } catch { /* next */ }
  }
  return "";
})();
async function devJson(pathWithQuery, init = {}) {
  const headers = { ...(init.headers ?? {}), "x-atelier-token": DEV_TOKEN };
  const r = await fetch(`${BASE}${pathWithQuery}`, { signal: AbortSignal.timeout(45000), ...init, headers }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`,
      "start the dev server ('pnpm dev' inside prototype/) or set ATELIER_DEV_URL",
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

async function callTool(name, args) {
  const PROJECT_ROOT = process.env.ATELIER_PROJECT_ROOT ?? process.cwd();

  /* ---- downlink-executed tools (runtime lives in the open page; P0-1 SSE channel) ---- */
  if (name === "checkpoint.list") return bridgeCall("checkpoint.list", {});
  if (name === "checkpoint.rollback") return bridgeCall("checkpoint.rollback", args ?? {});
  if (name === "state.time_travel") return bridgeCall("state.time_travel", args ?? {});
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
  if (name === "snapshot.diff" || name === "snapshot.review_diff") {
    const shot = await fetch(`${BASE}/__atelier/screenshot`, { signal: AbortSignal.timeout(40000) }).catch((e) => {
      throw toolError(`ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`, "start the dev server ('atelier dev') first");
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
      out.match = h(curPath) === h(basePath);
      out.note = out.match ? "pixel-stable against baseline" : "differs from baseline — review both images side by side; promotion is a CLI/human act";
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
  const res = await fetch(BASE + route, { signal: AbortSignal.timeout(4000) }).catch((e) => {
    throw toolError(
      `ATR-4xx-dev: dev surface unreachable at ${BASE} (${e.cause?.code ?? e.name})`,
      "start the dev server ('pnpm dev' inside prototype/) or set ATELIER_DEV_URL"
    );
  });
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
        reply(id, {
          content: [{ type: "text", text: e?.message ?? String(e) }],
          isError: true,
        });
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
