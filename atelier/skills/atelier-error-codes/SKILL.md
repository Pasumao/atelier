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
| ATR-215 | Endpoint output violates `output` contract (server developer error, NOT client) | handler returns `{id:"x"}` but output schema wants number | Fix the handler return to match the `output` flat schema; dev-only check (stripped in prod, JSON-safe stays) |
| ATR-216 | Endpoint returned non-JSON-safe value (function/Symbol/BigInt/Promise/circular) | handler returns `{ fn: () => 1 }` | Map rich objects to pure data before return; message locates the path (e.g. `$.fn`); enforced in dev AND prod |

## ATR-3xx — Runtime

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-301 | Template expression parse failure | `=>` arrow, `=` assignment, or function call (`.map(...)`) left in a `{...}` expression — leftover tokens are rejected, never silently dropped | Use named handler (`.locals({ bump })` + `on:click={bump}`); precompute with `$derived`; keep expressions simple |
| ATR-305 | Writing to a `$derived` signal | `double.value = 4` | Derive-only: change upstream `$state` instead |
| ATR-314 | `live.invalidate` / `emits` key syntax illegal | `invalidate: ["messages"]` (missing `table:`) | Key syntax: `table:<name>` (`[A-Za-z0-9_]`) or `key:<business key>`; fix the declaration at registration time |
| ATR-321 | live endpoint recalculation failed (SSE `event: error`; the stream stays open — the next invalidating write retries automatically) | `chat.list` handler throws after a write invalidates it | No reconnect needed — subscription is kept; reproduce via `POST <name>` with the same input to see the root cause, fix the handler, and the next write recovers the push; failed recalcs are journaled (status=failed, error=ATR-321) |
| ATR-322 | Endpoint exceeded its `timeoutMs` budget | handler hangs longer than the declared 10s | Raise `timeoutMs`, or unblock the handler: observe `ctx.signal` and exit early (abort stops the dispatch wait, it cannot kill the handler) |
| ATR-331 | Migration missing its `.down.sql` pair (reversibility is a hard gate) | `001_create_chats.up.sql` with no `001_create_chats.down.sql` | Write the missing down file (`gen db` scaffolds pairs; `migrate up` refuses to apply unpaired migrations) |
| ATR-332 | Applied migration file changed/missing (sha256 checksum mismatch vs `atelier_migrations`) | edited `002_add_messages.up.sql` after `migrate up` | Applied migrations are never rewritten — revert the edit (restore from git/checkpoint) or write a new numbered migration instead |
| ATR-333 | Down missing/failed, or down carries an irreversible marker (`-- 不可逆：`) without `force: true` | `migrateDown` hit a down file with `-- 不可逆：数据可弃` and no force | Read the 不可逆 note in the down file to confirm what is dropped and why it is safe, then re-run with `force: true` (irreversible ops need explicit consent, never silent defaults) |
| ATR-334 | Migration up failed inside its transaction (already rolled back) | bad SQL in `003_*.up.sql` → `CREATE TABEL` syntax error | Fix the up SQL and re-run `migrate up` — the failed step rolled back entirely, db is untouched; never put BEGIN/COMMIT inside migration files (migrator wraps each) |
| ATR-335 | Applied seed file changed (sha256 mismatch vs `atelier_seeds`) | edited `001_example.seed.sql` after `migrate seed` already applied it | Applied seeds are never rewritten — restore the file content, or append the change as a NEW `*.seed.sql` filename; dev-only escape: delete the `atelier_seeds` row and re-run (never on prod) |
| ATR-336 | Seed statement not re-runnable (bare `INSERT INTO` with no `ON CONFLICT`, or seed SQL failed — tx rolled back) | `INSERT INTO chats ...` in a `.seed.sql` file; duplicate key on re-run | Make every statement idempotent (D-F17): `INSERT OR REPLACE INTO ...` or `INSERT ... ON CONFLICT(<key>) DO UPDATE ...`; fix failing SQL and re-run (whole file rolled back, db untouched) |
| ATR-340 | Endpoint declared `auth: { type }` but the request carries no valid session (or `createHandler` has no auth reader assembled) | POST to `auth.me` (`auth: { type: "session" }`) with no session cookie | Log in first (`POST auth.login` sets the session cookie, retry with it); if no reader is assembled wire `createHandler({ db, auth: createSessionReader(db) })`; endpoints that are genuinely public declare `auth: { type: "none" }` explicitly |
| ATR-341 | Session valid but role does not match the endpoint's `auth: { type, role }` declaration | `role: "user"` session calls an endpoint declaring `role: "admin"` | Grant the principal the required role (app-side user data) or fix the endpoint's role declaration; row-level checks belong in the handler reading `ctx.auth` explicitly — no implicit RLS |

## ATR-4xx — MCP / tooling

| Code | Cause | Example | Fix |
|---|---|---|---|
| ATR-401 | Component not registered in registry | `<ModelCard/>` but file not imported | Import the component file; verify `opts.name` (pass explicitly — esbuild may rename fn) |
| ATR-402 | MCP operation denied by confirm tier | `rollback` under `deny` | Raise tier in `atelier.config.json agent.confirm`, or run CLI with human approval |
| ATR-4xx-dev | Dev server not running / port busy | MCP tools unavailable | `atelier dev` (tools live with dev lifecycle) |

> New codes: register here first + in `docs/SPEC`; errors without a code entry are developer bugs.
