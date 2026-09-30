---
name: atelier
description: Atelier framework skill (root). Write .atr.ts components, streaming UI, state transactions, style tokens, acceptance testing, package exe. Load first for any Atelier task.
---

# Atelier — Quick Start

> Read this first. Detail lives in sub-skill packages (load on demand). Never read whole repo for small changes.

## Project anatomy

```
src/                     # .atr.ts components (export const X = component(...))
specs/                   # human intent + acceptance (single authority, read before editing)
atelier.config.json      # semantic tokens + locked components + agent confirm mode (SSOT)
.atr/snapshots/          # screenshot baselines (git-managed, never auto-accept)
```

## Golden component (copy-friendly)

```ts
import { component, $state, html } from "atelier/runtime";

export const Greeting = component(function Greeting(props: { name: string }) {
  const open = $state(false);
  const toggle = () => (open.value = !open.value);
  return html`
    <h1>Hello {props.name}</h1>
    <button on:click={toggle}>{open.value ? "Close" : "Open"}</button>
  `.locals({ props, open, toggle });
}, { name: "Greeting", schema: { type: "object", reqProps: { name: { type: "string" } }, optProps: {} } });
```

## Work loop (always)

1. Read `specs/` (intent + acceptance, human-owned)
2. Ground truth before edits: MCP `structure.map` → registry → tokens → state snapshot (see `atelier-mcp-tools/SKILL.md`)
3. Edit `.atr.ts` — explicit `$state/$derived/$effect`, no magic
4. `atelier dev` — watch compile errors + HMR
5. Self-verify: `atelier check` → `atelier test` → `atelier snapshot` (diff MUST be reviewed, not auto-accepted; `atelier lint` is a STUB, exit 4 — guard tests carry the soft constraints)
6. Produce `diff.report`, wait for human approve/disapprove (feedback writes back to `specs/`)

## DoD

1. `atelier check` passes, 2. `atelier test` all green (incl. guard tests — the soft-constraint carrier), 3. snapshot diff reviewed (no auto-accept), 4. no `locked` touched / no new deps, 5. diff report attached.

## Hard bans (check/ATR error)

- Hardcoded style values (use semantic tokens only)
- Hand-written typewriter (`setInterval` polling for streaming text — use `streamValue`)
- Generics / wide string unions in contract types
- Bare `window/document` in components (no DOM globals in render paths — the decision-9 `atelier.env` primitive is not implemented yet), implicit global state (use `$state`/store)

## Sub-skills (skill packages, load on demand)

| Trigger | Skill package |
|---|---|
| write/edit components | `atelier-component-model` |
| streaming output / tool call cards | `atelier-streaming` |
| state / rollback / time-travel | `atelier-state-transactions` |
| styling / tokens / layout | `atelier-styling` |
| run checks / tests / snapshots / build | `atelier-testing` |
| query or change framework state (MCP tools) | `atelier-mcp-tools` |
| any `ATR-xxx` error | `atelier-error-codes` |

> Commands above are the only valid CLI surface (see ARCHITECTURE §8). Errors: read `fix` and execute.
> Missing the atelier MCP tool surface in this session? Register once: `node atelier/mcp/server.mjs` (stdio, zero-dep; dev URL via ATELIER_DEV_URL) — or rerun `init-ai.mjs` to write client configs.
