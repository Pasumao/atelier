---
name: atelier-testing
description: Atelier acceptance loop. Command semantics with STUB honesty (lint/e2e/package not runnable, exit 4), DoD mapping, real assertion primitives (Vitest + validateFlat + mountComponent), build-artifact prod-strip semantics (decision 27), screenshot diff MUST be reviewed. Load when running checks, tests, snapshots, builds, or verifying a task.
---

# Acceptance Loop (DoD execution)

## Command semantics

| Command | Tier | What it proves | Fails when |
|---|---|---|---|
| `atelier check` | MINI | eight-layer structural contradictions (= struct check: server boundary, migration pairing/checksum, import allowlist) | structural violations (ERROR level, hard gate) |
| `atelier test` | MINI* | forwards to the app's test runner (Vitest) — includes the co-located `.atr.spec.ts` contract/behavior tests and styling/state discipline guard tests | assertions red |
| `atelier snapshot [--update]` | MINI* | visual regression vs `.atr/snapshots/` | pixel diff vs baseline |
| `atelier build` | MINI | prod artifact: static face + single-container server shell, spawn smoke self-check | build or smoke exits non-zero |
| `atelier lint` | STUB | not runnable — exits 4 honestly (ruleset ships with `@atelier/eslint`); meanwhile the soft constraints live in skill docs + guard tests | — |
| `atelier e2e` | STUB | not runnable — exits 4 honestly (browser loop ships with review-ui); meanwhile `snapshot check` covers the regression half | — |

## Build prod-strip semantics (decision 27)

`atelier build` artifacts run **prod semantics — the dev face is stripped**, two-sided:

- **Browser face**: vite build folds the build-prod constant (dev serve does not define it) — dev-only branches are dead-code-eliminated; `src/main.ts` dev wiring (state bridge / registry self-check / session anchor) sits behind `if (import.meta.env.DEV)` and compiles out.
- **Server face**: the generated `dist/server.mjs` shell presets the prod flag before loading the app — per-request behavior switches live.

What the artifact no longer does: no ATR error cards, props/contract validation skipped (bugs surface as plain runtime errors, not ATR cards), `/__atelier/server-status` debug surface hidden (405 ATR-311).

Honest boundaries (v1): server face is behavior-level activation, no DCE (code still ships, semantics switched off); runtime barrel not tree-shaken (dev branches fold inside modules); `.atr-error-card` CSS remains (harmless).

## DoD → commands (use this order; never skip the review step)

1. `atelier check` → 2. `atelier test` (incl. guard tests — the soft-constraint carrier while `lint` is a stub) → 3. `atelier snapshot` (diff **reviewed**) → 4. self-check `locked`/deps → 5. `diff.report` to human

## Assertion primitives (real idiom — mirror the template app `.atr.spec.ts`)

```ts
import { describe, it, expect } from "vitest";
import { validateFlat } from "../runtime/contract"; // vendored runtime barrel
import { mountComponent } from "../runtime";        // real render path

// contract face: AtrError four segments, code + key hints in fix
const r = validateFlat(schema, payload);
expect(r.ok).toBe(false);
expect(r.error?.code).toBe("ATR-201");
expect(r.error?.fix).toContain("title");

// behavior face: mount the component on a minimal inline DOM shim (mirroring
// atelier/tests/dom-shim.ts — appendChild move semantics + textContent),
// drive real events through the render path, assert the rendered output
expect(container.textContent).toContain("done");
```

`atelier/runtime` exports **no** `expect`/`verify` — assertions come from Vitest; component behavior is asserted through the real render path (`mountComponent` + DOM-shim `textContent`), contract violations through `validateFlat` ATR errors (read `fix`, execute).

## Snapshot discipline (the known pitfall)

- `snapshot.review_diff` returns the diff image — **review it**. Never auto-accept a diff to make tests green
- `--update` is explicit-only, and only after human review
- Baseline lives in `.atr/snapshots/` (git-managed); a changed baseline is a change report, not a fix

## Common failures

| Symptom | Fix |
|---|---|
| Tests green but UI broken | You accepted a snapshot diff — revert baseline and review visually |
| Flaky snapshot | Freeze data/timing in the test itself (fixed seed, no `Date.now()` in render paths); the visual diff is byte-then-pixel |
| `check` red on union | Contract has wide union — switch to literal discriminant |

## Spec discipline (EARS + constitution)

- 开工阅读序：`specs/constitution.md` → `specs/guardrails.md` → 对应 spec → 代码；违反宪法条款的 spec 提案直接拒绝（feedback 注明条款号）。
- 验收语句用 **EARS**（`WHEN/IF/WHILE/WHERE … THE SYSTEM SHALL …`）——每条落点 = `.atr.spec.ts` 命名用例；没有用例承接的验收不算完成（**规格 = 可执行测试**）。
- spec 文件 human-owned：可提案修改，不得静默改写。
