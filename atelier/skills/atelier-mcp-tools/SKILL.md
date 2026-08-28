---
name: atelier-mcp-tools
description: Atelier built-in tool surface. Query / operation / audit faces, command-to-tool mapping, confirm tiers, audit logging, flat-schema params. Load when you need to inspect or change framework state.
---

# Built-in Tool Surface (MCP, in-process with `atelier dev`)

## Three faces (never mix privileges)

| Face | Tools | Power |
|---|---|---|
| **Query (read-only)** | `structure.map` · `structure.check` · `registry.list_components` · `registry.get_component` · `tokens.list` · `state.snapshot` · `state.get` · `ui.screenshot` · `docs.search` | inspect only — `structure.*` computed server-locally, no dev server needed |
| **Operation** | `checkpoint.list` · `checkpoint.rollback` · `checkpoint.source_list` · `checkpoint.source_commit` · `checkpoint.source_rollback` · `state.time_travel` · `test.run` · `snapshot.diff` · `snapshot.review_diff` · `diff.report` | changes state; **audit-logged**, confirm tier applies |
| **Audit** | `audit.log` · `feedback.read` | read side effects + human feedback |

## Command ↔ tool mapping (use the tool when the CLI is not enough)

| CLI | MCP tool |
|---|---|
| `atelier dev` (start) | (tools become available) |
| `atelier test` | `test.run` |
| `atelier snapshot` | `snapshot.diff` / `snapshot.review_diff` |
| `atelier review` | `diff.report` + `feedback.read` |
| rollback (any) | `checkpoint.rollback` / `checkpoint.source_rollback` |
| `atelier checkpoint save` | `checkpoint.source_commit` (same code path — 未检不锚 snapshot gate applies; `--no-gate` escape hatch is CLI-only) |

## Confirm tiers & audit (decision 12)

- `atelier.config.json → agent.confirm`: `auto` (AI may auto-rollback, default) | `ask` | `deny`
- Destructive ops (rollback/source_rollback) always: confirm tier + audit-log entry
- dev/MCP binds 127.0.0.1 only + one-time token (`requireToken`)

## Params = flat schema (decision 6)

Tools accept **flat** schemas (no `$ref`/`oneOf`) — identical to component contracts. If a tool's `fix`/schema is unfamiliar, query `docs.search` instead of guessing.

## Common failures

| Symptom | Fix |
|---|---|
| `ATR-402` permission denied | Check `agent.confirm` tier; ask human to raise to auto for this op, or perform via CLI with approval |
| Registry missing component | Component file not imported/registered (`opts.name` mismatch — pass `name` explicitly) |
| Diff can't be reviewed | Use `snapshot.review_diff` (image + baseline), review before `--update` |
