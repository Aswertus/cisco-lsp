# cisco-ios-lsp

VS Code extension — Cisco IOS/IOS-XE IntelliSense via Language Server Protocol.

Adds **context-aware completions**, **hover documentation**, **real-time diagnostics**,
**syntax highlighting**, and an **outline panel** to Cisco config files — all bundled, no
other extension required.

Syntax highlighting and the outline feature are adapted from
[`Y-Ysss.cisco-config-highlight`](https://marketplace.visualstudio.com/items?itemName=Y-Ysss.cisco-config-highlight)
(MIT licensed — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). This extension uses the
same `cisco` language ID and the same `source.cisco` grammar scope hierarchy, so it stays
compatible with that extension, its themes, and token-color customizations. See the
"Coexisting with `Y-Ysss.cisco-config-highlight`" section below if you have both installed.

---

## Features

| Capability      | Detail                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Completions** | Auto-triggered, block-aware: completions change depending on whether the cursor is inside an `interface`, `router bgp`, `class-map`, `policy-map`, `line vty`, or at global level |
| **Hover docs**  | Syntax reminders for known keywords — e.g. hover `dot1x` → `dot1x pae { authenticator \| supplicant \| both }`                                                                    |
| **Diagnostics** | Squiggly errors on unknown top-level commands, invalid interface names, VLAN numbers outside 1–4094, and malformed IP addresses                                                   |

---

## Architecture

```
VS Code (UI)
  └─ LSP client  (client/extension.js)
       └─ spawns server/server.js as a child process
            ↕ JSON-RPC over stdio
```

VS Code starts `server.js` when a `cisco`-language file opens and kills it on exit.
No daemon, no network, no always-on process.

---

## File associations

This extension registers the `cisco` language for:

| Extension | Language |
| --------- | -------- |
| `.cisco`  | `cisco`  |
| `.config` | `cisco`  |
| `.cfg`    | `cisco`  |
| `.ios`    | `cisco`  |

(`.cisco` / `.config` match `Y-Ysss.cisco-config-highlight`'s associations; `.cfg` / `.ios` are
additions from this extension.)

To add further extensions (e.g. `.conf`) add a `files.associations` entry to your
VS Code workspace `settings.json`:

```json
"files.associations": {
  "*.conf": "cisco"
}
```

---

## Coexisting with `Y-Ysss.cisco-config-highlight`

It's safe to have both extensions installed. Both declare a TextMate grammar for the same
`cisco` language id under the same `source.cisco` scope hierarchy, so any theme or
`editor.tokenColorCustomizations` you've configured renders identically no matter which
grammar VS Code ends up using to tokenize a file — VS Code doesn't expose a setting to choose
between two grammars contributed for the same language id (this is
[undocumented/non-configurable upstream behavior](https://github.com/microsoft/vscode/issues/127917)).

If you want to deterministically pick one:

- **Disable `Y-Ysss.cisco-config-highlight`** to use only this extension's bundled grammar,
  completions, hover, diagnostics, and outline panel.
- **Disable `cisco-ios-lsp`** to fall back to the original extension's highlighting and
  outline only, losing this extension's LSP features.

There's no supported way to mix "grammar from one, everything else from the other" — disabling
one of the two extensions is the only deterministic switch.

---

## Outline panel

Enable `cisco-ios-lsp.outline.showSymbolsInOutlinePanel` (default off) to show config structure
in the Outline view and breadcrumbs:

- Prompt commands (`hostname#`, `hostname>`)
- VRF declarations (`ip vrf <name>`)
- BGP (`router bgp <asn>`, `address-family ...`)
- `class-map` / `policy-map` blocks
- `interface` blocks and sub-interfaces (e.g. `GigabitEthernet0/1.10`)

Use `cisco-ios-lsp.outline.symbolsList` to toggle individual categories.

---

## Icon theme (Material Icon Theme)

[`PKief.material-icon-theme`](https://marketplace.visualstudio.com/items?itemName=PKief.material-icon-theme)
already assigns its "settings" icon to `.config` files by default. Add this to your workspace
or user `settings.json` to get the same icon for the other extensions this extension
registers:

```json
"material-icon-theme.files.associations": {
  "*.cisco": "settings",
  "*.cfg": "settings",
  "*.ios": "settings"
}
```

---

## Install (coworkers)

You only need the prebuilt `.vsix` file — no Node.js, no cloning.

1. Get the `cisco-ios-lsp-<version>.vsix`:
   - **From a GitHub Release (preferred):** open the
     [Releases page](https://github.com/Aswertus/cisco-lsp/releases), and download the
     `.vsix` asset from the latest release. The repo is **private**, so you must be added as
     a collaborator and signed in to GitHub to see it — ask Aswertus for access.
   - **Or** get the file directly from Aswertus (Teams / email / share drive).
2. Install it, either:
   - **GUI:** VS Code → Extensions panel → `⋯` menu (top-right) → **Install from VSIX…** →
     pick the file, or
   - **CLI:** `code --install-extension cisco-ios-lsp-0.1.0.vsix`
3. Reload the window (`Ctrl+Shift+P` → **Developer: Reload Window**).

No other extension is required — highlighting and the outline panel are bundled. See
"Coexisting with `Y-Ysss.cisco-config-highlight`" above if you also have that extension
installed.

---

## Updating

Sideloaded extensions (installed from a `.vsix`) **do not auto-update** — only Marketplace
extensions do. To move to a newer version:

1. Download the newer `cisco-ios-lsp-<version>.vsix` from the
   [Releases page](https://github.com/Aswertus/cisco-lsp/releases).
2. **Install from VSIX…** again — VS Code replaces the old version in place; your settings
   are kept.
3. Reload the window.

**Update notifications:** the extension checks the Releases API on startup and shows a
notification when a newer version is available. It is **inactive while the repo is private**
(the API call is unauthorized, so it silently does nothing) and **activates automatically if
the repo is made public** — no token needed on anyone's machine. Disable it with the
`cisco-ios-lsp.checkForUpdates` setting.

---

## Build the .vsix

To produce the shareable file (requires Node.js + npm):

```bash
cd /home/matthias/cisco-lsp
npm install
npm run package        # → cisco-ios-lsp-<version>.vsix in the repo root
```

The production dependencies are bundled into the `.vsix`, so it runs on any machine with
VS Code — no separate `npm install` on the coworker's side.

---

## Cutting a release

Releases are automated. A push of a version tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the `.vsix` and
publishes a GitHub Release with it attached — no local build needed.

```bash
# 1. bump "version" in package.json (e.g. 0.1.0 → 0.1.1)
# 2. add a matching section to CHANGELOG.md
# 3. commit the bump
git commit -am "release: v0.1.1"
# 4. tag and push — this is what kicks off the release
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions then creates the **v0.1.1** release with `cisco-ios-lsp-0.1.1.vsix` attached.
Coworkers download it from the [Releases page](https://github.com/Aswertus/cisco-lsp/releases).
The tag version should match `version` in `package.json`.

---

## Install (development)

For working on the extension itself, symlink the repo into VS Code Server so edits take
effect on reload (no rebuild needed):

```bash
cd /home/matthias/cisco-lsp
npm install
ln -sf /home/matthias/cisco-lsp ~/.vscode-server/extensions/cisco-ios-lsp
```

Then in VS Code: `Ctrl+Shift+P` → **Developer: Reload Window**.

The symlink points VS Code Server at the live repo — edits to `server.js` take effect
after a window reload (no compile step; plain Node.js).

---

## Command coverage

See [COMMAND_COVERAGE.md](COMMAND_COVERAGE.md) for the full list of interface types,
keywords, and config blocks covered by completions, hover, and diagnostics.

---

## Verification

After installing:

1. Create `test.cfg` in any workspace → language bar shows **Cisco Config**.
2. Type `interface ` (with space) at the top → dropdown lists all interface types.
3. Type `gi` → `GigabitEthernet` appears; select it and type a slot/port.
4. Inside `interface GigabitEthernet0/1`, type `sw` → switchport completions; `ro` absent.
5. At global level: `class-map` → class-map completion; `tu` → `Tunnel` interface.
6. Hover over `dot1x` → syntax reminder popup.
7. Type `interfacs ` (deliberate typo) → red squiggle diagnostic.
8. Type `vlan 5000` → out-of-range VLAN diagnostic.
9. Confirm syntax highlighting (keywords, addresses, comments) appears without any other
   extension installed.
10. Enable `cisco-ios-lsp.outline.showSymbolsInOutlinePanel`, add a `router bgp 65000` and an
    `interface GigabitEthernet0/1` block → Outline panel shows both as nested entries.
11. Delete `test.cfg` when done.

---

## Development

```bash
npm run lint      # ESLint (eslint:recommended, Node env)
npm run format    # Prettier (printWidth 100, single quotes)
```

---

## AI-assisted development

This project was developed with the assistance of **AI — currently Anthropic's Claude**.
AI tooling was used to scaffold the extension, write and refine the language-server logic,
and produce documentation.

If you fork, reuse, or build on this code, please be aware of that origin. The code is
provided under the MIT [LICENSE](LICENSE) "as is", without warranty — review it before using
it in production network environments.
