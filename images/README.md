# Extension icon

| File | Role |
|------|------|
| `icon.svg` | Editable vector source — the single source of truth. |
| `icon.png` | 256×256 raster generated from `icon.svg`; this is what ships (VS Code requires a PNG icon). |

## Design

An **original** mark, not a copy of any trademarked logo:

- **Golden Gate Bridge** in International Orange (`#D8472B` / `#E8633F`) on a
  "daybreak" dawn-sky gradient. The vertical suspender cables double as a row of
  signal bars — a nod to the bridge that inspired Cisco's own logo, drawn fresh
  here to avoid trademark issues.
- A **terminal strip** below the deck renders the extension name as a typed
  command: a `›` prompt, `Cisco IOS` / `IntelliSense`, and a cursor block —
  tying the mark to the CLI / IntelliSense theme.

It was authored as hand-written SVG (vector markup = code) rather than generated
by an image model — no external service, no cost.

## Regenerating the PNG

The renderer (`@resvg/resvg-js`) is **deliberately not** a project dependency: it
bundles a ~4 MB native binary that must not end up in the `.vsix`. Install it just
for the render, then remove it.

```bash
# from the repo root
npm install --no-save @resvg/resvg-js
npm run render-icon            # node scripts/render-icon.js → images/icon.png
rm -rf node_modules/@resvg     # keep it out of the next package
```

The terminal text needs a monospace font; the SVG falls back across
Liberation Mono → DejaVu Sans Mono → Noto Sans Mono, all common on Linux.

## Editing

Edit `icon.svg`, re-run the steps above, then rebuild the extension
(`npm run package`) to embed the new PNG. `icon.svg` and this `README.md` are
excluded from the `.vsix` via `.vscodeignore`; only `icon.png` is shipped.
