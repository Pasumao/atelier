---
name: atelier-error-codes
description: Atelier error code reference. ATR-1xx compile / 2xx contract / 3xx runtime / 4xx MCP. Each entry cause, example, fix. Load when any ATR-xxx appears.
---

# Error Codes (ATR-xxx)

> Every error is `{ code, message, context, fix }`. **Read `fix` and execute** — it is machine-actionable, not human prose.
> Domains: **1xx compile · 2xx contract/validation · 3xx runtime · 4xx MCP/tooling**

## ATR-1xx — Compile

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-101 | Template syntax error (unclosed tag/block) | `{#each}` without `{/each}` | Close the block; expression braces balanced |
| ATR-103 | Contract type violates H1 (generic/mapped in contract) | `props: Array<T>` used in props | Replace with pure data + literal discriminants |

## ATR-2xx — Contract

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-201 | Props missing/wrong type vs flat schema | `ModelCard` got no `name` | `fix` lists available keys — fill per schema (`name`, `badge`, `tagline`, `highlights`) |
| ATR-204 | Style references undefined token | `var(--color-1)` (not in config) | `fix` lists valid tokens; use an existing semantic token or add one to `atelier.config.json` |
| ATR-205 | Input not a JSON object | contract demo got `"string"` | Return an object with string keys |

## ATR-3xx — Runtime

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-301 | Template expression parse failure | `=>` arrow, `=` assignment, or function call (`.map(...)`) left in a `{...}` expression — leftover tokens are rejected, never silently dropped | Use named handler (`.locals({ bump })` + `on:click={bump}`); precompute with `$derived`; keep expressions simple |
| ATR-305 | Writing to a `$derived` signal | `double.value = 4` | Derive-only: change upstream `$state` instead |

## ATR-4xx — MCP / tooling

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-401 | Component not registered in registry | `<ModelCard/>` but file not imported | Import the component file; verify `opts.name` (pass explicitly — esbuild may rename fn) |
| ATR-402 | MCP operation denied by confirm tier | `rollback` under `deny` | Raise tier in `atelier.config.json agent.confirm`, or run CLI with human approval |
| ATR-4xx-dev | Dev server not running / port busy | MCP tools unavailable | `atelier dev` (tools live with dev lifecycle) |

> New codes: register here first + in `docs/SPEC`; errors without a code entry are developer bugs.
