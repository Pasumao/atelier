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

## $state rules

- Create signals **inside** the component function; never module-level state (implicit global ban)
- Mutate via `.value =`; read in templates via `{sig.value}` — subscription is automatic
- `$derived` is read-only (write → ATR-305). Derive, don't cache by hand.

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
