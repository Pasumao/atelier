---
name: atelier-streaming
description: Streaming UI with Atelier primitives. streamValue push/finish, optimisticList pending/commit/revert, no hand-written typewriter. Load when doing streaming output, tool-call cards, optimistic updates.
---

# Streaming & Optimistic UI

## streamValue (streaming text — the only way)

```ts
import { streamValue, $derived, html } from "atelier/runtime";

const intro = streamValue<string>();
const text = $derived(() => intro.values.join(""));

// feed from a real stream (SSE / fetch reader); never setInterval-poke strings
const feed = async () => {
  const r = await fetch("/api/stream");
  for await (const chunk of r.body ?? []) { intro.push(new TextDecoder().decode(chunk)); await sleep(14); }
  intro.finish();
};
// template: <p>{text.value}</p><span>{intro.done ? "" : "▋"}</span>
```

- `values: T[]` — append-only; `done: boolean` — completion flag (subscribe both)
- Template reads `{intro.value}` / `{text.value}` — re-render is automatic
- **Ban**: hand-writing `setInterval`/polling to assemble text (lint: `no-manual-typewriter`). If you catch yourself doing it, refactor to `streamValue`.

## optimisticList (tool-call cards / async adds)

```ts
const tools = optimisticList<{ id: string; name: string }>();
tools.optimisticAdd({ id: "t1", name: "web_search" });   // pending…
tools.commit("t1");                                      // confirmed
tools.revert("t1");                                      // rolled back (e.g. API failure)
// template: {#each tools.values as t}<span class={t.status === "pending" ? "pending" : "ok"}>{t.it.name}</span>{/each}
```

- `status: "pending" | "committed"` drives UI; `revert()` also records the rollback (visible as truth)
- Rollbacks are covered by the transaction store — commit state snapshots around optimistic phases (see `atelier-state-transactions`)

## Common failures

| Symptom | Fix |
|---|---|
| Streaming text stuck | Read values through `.value` in template; push must replace array (`list.value = [...list.value, v]` style) |
| Tool card never settles | Call `commit(id)` with the **same id** as `optimisticAdd` |
| UI flickers on every char | Don't read `intro.values` in $derived per-char work; batch pushes per sentence |
