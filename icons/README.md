# File icon

| File                     | Role                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| `cisco-file.svg`         | Ships: the `cisco` language icon (`contributes.languages[].icon`, light + dark). |
| `cisco-file-outline.svg` | Kept alternative, not shipped (excluded via `.vscodeignore`).                    |

Both are the network-diagram **switch** symbol — a rounded square with two opposing
arrows — in Material Teal 600 (`#00897b`) on Material Icon Theme's 32 px grid.
`cisco-file.svg` is byte-for-byte the file submitted to that theme
(material-extensions/vscode-material-icon-theme#3625): one even-odd path, the arrows cut
out of the filled box, every vertex on a whole 16 px pixel (their "pixel-perfect" rule; they
use no `<mask>`). The outline variant keeps Material Design's `swap_horiz` glyph (Apache
2.0) and thins out at 16 px, which is why the filled one ships. Chosen by the owner on
2026-10-18 from five candidates shown at explorer size.

VS Code caches extension language icons inside the generated icon-theme CSS and only
rebuilds that when the extension's version changes. After editing the SVG, switch the file
icon theme away and back (**Preferences: File Icon Theme**) to see the change; a window
reload is not enough.
