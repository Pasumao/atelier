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
| ATR-105 | Server boundary import leak — frontend entry graph reaches a server module | `src/main.ts` → `import { api } from "./server/api.ts"` | Frontend reaches server state only via endpoint HTTP calls (generated client); move the import into `src/server/**` or the server entry (`src/main-server.ts`) — `src/vendor/atelier/server/**` must never enter the frontend graph |
| ATR-106 | Bare import whose package name is outside `package.json` deps (hallucinated package / slopsquatting) | `import { ghost } from "hallucinated-pkg"` with no such entry in dependencies/devDependencies | Install the real package (`pnpm add <pkg>`) or correct the specifier — bare names must resolve to `dependencies ∪ devDependencies`; check `atelier struct check` for the offending file list |

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
| ATR-331 | Migration missing its `.down.sql` pair (reversibility is a hard gate) | `001_create_chats.up.sql` with no `001_create_chats.down.sql` | Write the missing down file (`gen db` scaffolds pairs; `migrate up` refuses to apply unpaired migrations) |
| ATR-332 | Applied migration file changed/missing (sha256 checksum mismatch vs `atelier_migrations`) | edited `002_add_messages.up.sql` after `migrate up` | Applied migrations are never rewritten — revert the edit (restore from git/checkpoint) or write a new numbered migration instead |
| ATR-333 | Down missing/failed, or down carries an irreversible marker (`-- 不可逆：`) without `force: true` | `migrateDown` hit a down file with `-- 不可逆：数据可弃` and no force | Read the 不可逆 note in the down file to confirm what is dropped and why it is safe, then re-run with `force: true` (irreversible ops need explicit consent, never silent defaults) |
| ATR-334 | Migration up failed inside its transaction (already rolled back) | bad SQL in `003_*.up.sql` → `CREATE TABEL` syntax error | Fix the up SQL and re-run `migrate up` — the failed step rolled back entirely, db is untouched; never put BEGIN/COMMIT inside migration files (migrator wraps each) |

## ATR-4xx — MCP / tooling

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-401 | Component not registered in registry | `<ModelCard/>` but file not imported | Import the component file; verify `opts.name` (pass explicitly — esbuild may rename fn) |
| ATR-402 | MCP operation denied by confirm tier | `rollback` under `deny` | Raise tier in `atelier.config.json agent.confirm`, or run CLI with human approval |
| ATR-4xx-dev | Dev server not running / port busy | MCP tools unavailable | `atelier dev` (tools live with dev lifecycle) |

> New codes: register here first + in `docs/SPEC`; errors without a code entry are developer bugs.
