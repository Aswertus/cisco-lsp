# File icon

| File                     | Role                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| `cisco-file.svg`         | Ships: the `cisco` language icon (`contributes.languages[].icon`, light + dark). |
| `cisco-file-outline.svg` | Kept alternative, not shipped (excluded via `.vscodeignore`).                    |

Both are the network-diagram **switch** symbol — a rounded square with two opposing
arrows — in Material Teal 600 (`#00897b`) on Material Icon Theme's 32 px grid, so either
file could go upstream to that theme unchanged. The arrows are Material Design's
`swap_horiz` glyph (Apache 2.0). `cisco-file.svg` is the filled box with the arrows knocked
out through a mask; the outline variant thins out at 16 px, which is why the filled one
ships. Chosen by the owner on 2026-10-18 from five candidates shown at explorer size.

VS Code caches extension language icons inside the generated icon-theme CSS and only
rebuilds that when the extension's version changes. After editing the SVG, switch the file
icon theme away and back (**Preferences: File Icon Theme**) to see the change; a window
reload is not enough.
