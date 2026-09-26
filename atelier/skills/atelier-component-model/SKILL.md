---
name: atelier-component-model
description: Write/edit Atelier components (.atr.ts). Component structure, props contract discipline, $state scoping, common failures ATR-201 / contract leaks. Load when creating or modifying a component.
---

# Component Model (.atr.ts)

## Structure (fixed)

```ts
// ChatMessage.atr.ts
import { component, $state, $derived, html } from "atelier/runtime";

export const chatSchema = {
  type: "object",                       // flat schema: no $ref / oneOf
  reqProps: { text: { type: "string" }, status: { type: "string", enum: ["thinking", "streaming", "done"] } },
  optProps: { tools: { type: "array", items: { type: "string" } } },
};

export const ChatMessage = component(function ChatMessage(props: { text: string; status: "thinking" | "streaming" | "done" }) {
  const open = $state(false);           // component-scoped signal only
  const badge = $derived(() => (props.status === "thinking" ? "…" : "✅"));
  return html`
    <div class="msg">
      <span>{badge.value}</span><p>{props.text}</p>
      {#if props.status === "done"}<span class="msg__ok">done</span>{/if}
      {#each props.tools ?? [] as t}<code>{t}</code>{/each}
    </div>
  `.locals({ props, open, badge });
}, { name: "ChatMessage", schema: chatSchema });
```

## Contract discipline (H1/H2)

- Props are **pure data + literal discriminants**: `status: "running" | "done"`, never wide unions (`string`)
- **No generics / mapped types** in contracts
- `schema` in component metadata is the single source; runtime validates on render (ATR-201 on mismatch)
- Dynamic attrs are **reactive props** (F-5): parent signal change propagates into the child; `<b>{props.text}</b>` re-renders on parent update. **Initial-only** reads stay one-shot: `$state(props.start ?? 0)` captures the mount-time value — re-sync via `$effect` if needed. Never write to `props.*` (parent owns them).

## $state rules

- Create signals **inside** the component function; never module-level state (implicit global ban)
- Mutate via `.value =`; read in templates via `{sig.value}` — subscription is automatic
- `$derived` is read-only (write → ATR-305). Derive, don't cache by hand.

## bind: two-way binding (v1, decision 25)

- `bind:value={sig}` / `bind:checked={sig}` — one attr, two directions: signal → control (attr effect) + control → signal (event write-back). Runtime funnels both into the single `bindTwoWay` point.
- Target must be a **single writable `$state`** declared in the component: `$derived` → ATR-305 (read-only), non-signal / illegal target / element-attr pair outside the surface → ATR-324, duplicate `bind:` on same element+attr → ATR-325
- Support surface (v1): `bind:value` × input(text-like) / textarea (`input` event) + select (`change` event); `bind:checked` × input[type=checkbox|radio] (`change` event). Outside it, use one-way `attr={expr}` + an explicit `on:` handler
- v1 explicitly NOT supported: same-name radio group (multi-value binding), event modifiers (`.prevent`/`.stop`), two-way on non-form elements
- No feedback loop: programmatic `el.value=` does not fire input/change (DOM spec) — signal → control writes never bounce back; see `templates/app/src/components/FormBinding.atr.ts` for the copy-friendly example

## Props annotation is the schema (v1 extraction, decision 26)

- The `(props: {...})` type annotation on a component IS its schema source: the compiler extracts a flat schema from it and the dev plugin registers it into the runtime sink (prepended before `component()` evaluates, so the fallback picks it up). No handwritten `schema:` needed — see `templates/app/src/components/SchemaProbe.atr.ts` (the no-handwritten-schema reference)
- Mapping surface (v1): `string` / `number` / `boolean` / `Array<leaf>` → `{type:"array",items}` / string-literal union → `{type:"string",enum}`; `prop?: T` → `optProps`, required `prop: T` → `reqProps`
- **Explicit handwritten schema still wins**: when both exist, `opts.schema` takes precedence (sink never overrides it) — delete the handwritten one after migrating to annotations, or the two will drift
- Beyond the surface → **ATR-102** (generics / intersections / utility types / unions with non-literal members / nested objects / `any` / `unknown`): hand-write the flat schema for that prop instead
- Annotation absent (no `(props: {...})` annotation, or param not named `props`) → silently skipped: no schema, no render-time validation — existing components are unaffected
- Extraction runs at dev time via the vendored extractor (`scripts/compiler/extract-schema.mjs`): existing apps get it from `atelier sync`; without it the plugin degrades honestly (warn, no injection) and components render unvalidated

## Common failures

| Symptom | Code | Fix |
|---|---|---|
| Props missing/wrong type at render | ATR-201 | Read `fix` (lists all keys) — add mutating props per schema |
| Component name not found | ATR-401 | Import the component file; name = opts.name (`ModelCard` vs `ModelCard2` pitfall: esbuild may rename — always pass `name` explicitly) |
| State shared across instances | — | Move `$state` call inside the component fn |
| Template expression not updating | — | Signal values must be **read through `.value`** in expressions (e.g. `meta.value.x`, not `meta.x`) |

## Related

- Transactions & rollback: `atelier-state-transactions`
- Streaming values: `atelier-streaming`
