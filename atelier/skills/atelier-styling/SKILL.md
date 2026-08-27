---
name: atelier-styling
description: Atelier styling with semantic tokens. atelier.config.json single source, var(--token) only, scoped blocks, ATR-204 fix with available values. Load when styling, tokens, layout, or ATR-204 appears.
---

# Styling & Design Tokens

## Single source: `atelier.config.json`

```jsonc
{ "tokens": { "color": { "primary": "#4D6BFE", "surface": "#171C28" },
              "space": { "md": "16px" }, "radius": { "md": "10px" } } }
```

→ compiles to CSS custom properties: `--color-primary`, `--space-md`, `--radius-md` (group.name → kebab-case)

## Hard rule (H3)

- Styles may only use `var(--token)` or generated utility classes (`bg-primary`, `space-md`)
- **No hardcoded colors/spacing/fonts** (lint: `no-hardcoded-style-value`)
- Missing token → `ATR-204` at compile/validate with the **list of valid values** in `fix` — read it and grep `atelier.config.json`

## Scoped blocks

```ts
return html`
  <div class="card">…</div>
  <style scoped>
    .card { background: var(--color-surface); margin: var(--space-md); border-radius: var(--radius-md); }
  </style>
`.locals({ props });
```

- `<style scoped>` is component-scoped at compile time; global styles may only reference tokens

## Utility quick reference

| Token shape | Example | Utility |
|---|---|---|
| color | `--color-primary` | `bg-primary` / `text-primary` (generated) |
| space | `--space-md` | `p-md` / `m-md` (generated on demand) |
| radius | `--radius-md` | `rounded-md` |

## Common failures

| Symptom | Fix |
|---|---|
| `ATR-204` unknown token | Read `fix` → use one of the listed values; check `atelier.config.json` `tokens` groups (color/space/radius/font) |
| Style not applied | Keep selectors inside `<style scoped>`; class names must match exactly (`model-card__head`, not `model-card_head`) |
| "Drift" between pages | Never add ad-hoc colors — add a **semantic token** to config first (design token, not color value) |
