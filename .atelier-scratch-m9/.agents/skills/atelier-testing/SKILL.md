---
name: atelier-testing
description: Atelier acceptance loop. atelier check/lint/test/snapshot/e2e/build semantics, DoD mapping, build-artifact prod-strip semantics (decision 27), screenshot diff MUST be reviewed (no auto-accept). Load when running checks, tests, snapshots, builds, or verifying a task.
---

# Acceptance Loop (DoD execution)

## Command semantics

| Command | What it proves | Fails when |
|---|---|---|
| `atelier check` | types strict + contract extraction + token validation | H1/H3 violations (hard gate) |
| `atelier lint` | soft constraints (ruleset, warning-level) | style/value discipline, typewriter, >400-line files |
| `atelier test` | behaviour/interaction assertions (Vitest) | assertions red |
| `atelier snapshot [--update]` | visual regression vs `.atr/snapshots/` | pixel diff vs baseline |
| `atelier e2e` | browser loop: structure assertions + screenshot diff | DOM mismatch |
| `atelier build` | prod artifact: static face + single-container server shell, spawn smoke self-check | build or smoke exits non-zero |

## Build prod-strip semantics (decision 27)

`atelier build` artifacts run **prod semantics — the dev face is stripped**, two-sided:

- **Browser face**: vite build folds the build-prod constant (dev serve does not define it) — dev-only branches are dead-code-eliminated; `src/main.ts` dev wiring (state bridge / registry self-check / session anchor) sits behind `if (import.meta.env.DEV)` and compiles out.
- **Server face**: the generated `dist/server.mjs` shell presets the prod flag before loading the app — per-request behavior switches live.

What the artifact no longer does: no ATR error cards, props/contract validation skipped (bugs surface as plain runtime errors, not ATR cards), `/__atelier/server-status` debug surface hidden (405 ATR-311).

Honest boundaries (v1): server face is behavior-level activation, no DCE (code still ships, semantics switched off); runtime barrel not tree-shaken (dev branches fold inside modules); `.atr-error-card` CSS remains (harmless).

## DoD → commands (use this order; never skip 4)

1. `atelier check` → 2. `atelier lint` → 3. `atelier test` → 4. `atelier snapshot` (diff **reviewed**) → 5. self-check `locked`/deps → 6. `diff.report` to human

## Snapshot discipline (the known pitfall)

- `snapshot.review_diff` returns the diff image — **review it**. Never auto-accept a diff to make tests green
- `--update` is explicit-only, and only after human review
- Baseline lives in `.atr/snapshots/` (git-managed); a changed baseline is a change report, not a fix

## Assertion primitives

```ts
import { expect } from "atelier/runtime";
expect(el).toBeVisible();
expect(el).toHaveText("done");
verify(() => finalState === "done");   // stream-aware: assert final state, not intermediate
```

## Common failures

| Symptom | Fix |
|---|---|
| Tests green but UI broken | You accepted a snapshot diff — revert baseline and review visually |
| Flaky snapshot | Freeze timing/seed in test (`playtest.fixed_delta`-style deterministic mode) |
| `check` red on union | Contract has wide union — switch to literal discriminant |

## Spec discipline (EARS + constitution)

- 开工阅读序：`specs/constitution.md` → `specs/guardrails.md` → 对应 spec → 代码；违反宪法条款的 spec 提案直接拒绝（feedback 注明条款号）。
- 验收语句用 **EARS**（`WHEN/IF/WHILE/WHERE … THE SYSTEM SHALL …`）——每条落点 = `.atr.spec.ts` 命名用例；没有用例承接的验收不算完成（**规格 = 可执行测试**）。
- spec 文件 human-owned：可提案修改，不得静默改写。
