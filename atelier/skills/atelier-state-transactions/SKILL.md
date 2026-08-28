---
name: atelier-state-transactions
description: Atelier state transactions. store.commit/rollback/timeTravel, named checkpoints for AI turns, app state vs source rollback (decision 15), no implicit global state. Load when doing state changes, rollback, time-travel, AI multi-turn edits.
---

# State Transactions

## API

```ts
import { store } from "atelier/runtime";

store.commit("AI round 2");   // named checkpoint: N mutations = 1 operation (merge semantics)
store.rollback();             // restore to previous named checkpoint (pops it)
store.timeTravel("cp-3");     // replay-anywhere; history stays intact
store.list();                 // [{ id, name, at }] — the human-visible timeline
```

- Checkpoint granularity = atomic change; **name it per AI turn** ("one round = one checkpoint")
- Tracked signals are only `$state` — `$derived` recomputes from upstream automatically (never snapshot it)

## Two layers of rollback (decision 15 — critical)

| Layer | What it covers | Mechanism |
|---|---|---|
| **App state** | signals / UI state | `store.rollback()` (immediate) |
| **Source** | filesystem (.atr.ts / config) | git — `checkpoint.source_rollback` via MCP, or `git reset --soft` + working tree restore |

> Mistake to avoid: wanting to revert an edit but only rolling back UI state. Source rollback is the git track — both tracks are anchored together when `checkpoint.source_commit` runs; the anchor refuses while the live render mismatches the snapshot baseline (未检不锚 gate, P2-2).

## Rules

- No module-level mutable state; no implicit globals (use `$state` in component)
- Shared/inter-component state → dedicated store module exporting signals
- Before destructive ops in dev: `store.commit(name)` first, so rollback is one step

## Common failures

| Symptom | Fix |
|---|---|
| `store.rollback()` throws ATR-305 | You registered a `$derived` in the snapshot — derived signals are auto-recomputed, only `$state` is tracked |
| UI shows old state after time-travel | Wait for microtask batch flush; if stale, read via a `$derived` that also touches `refresh.value` |
| Checkpoint lost after rollback | Rollback pops; keep history via `timeTravel` for replay instead |
