# Contributing to cisco-ios-lsp

Developer notes: how the extension is built, tested and released. For what the extension
does and how to use it, see the [README](README.md).

---

## Architecture

```
VS Code (UI)
  └─ LSP client  (dist/client.js — bundled from client/)
       └─ spawns dist/server.js (bundled from server/) as a child process
            ↕ JSON-RPC over stdio
```

VS Code starts the server when a `cisco`-language file opens and stops it on exit. There is
no daemon, no always-on process, and no network access apart from the optional update check.
Client and server are bundled with esbuild into single files, and the command data ships as
one merged JSON file, so activation stays fast.

The language logic lives in `server/lib/` (completions context, diagnostics, indentation,
cross-references, outline) and is unit-tested under `test/`. `server/server.js` only wires
it to the LSP.

## Setup

Requires Node.js 22 and npm.

```bash
npm install
npm run build          # or: npm run watch (rebuilds on every change)
ln -sf "$PWD" ~/.vscode-server/extensions/cisco-ios-lsp   # or ~/.vscode/extensions/
```

Then in VS Code: `Ctrl+Shift+P` → **Developer: Reload Window**. VS Code loads the bundled
`dist/` output, so after editing `client/` or `server/` run `npm run build` (or keep
`npm run watch` running) and reload the window.

```bash
npm run build     # bundle client+server into dist/ (esbuild) + merge command data
npm run watch     # same, rebuilding on every source change
npm test          # unit tests (node:test — no framework dependency)
npm run lint      # ESLint (flat config, @eslint/js recommended, Node globals)
npm run format    # Prettier (printWidth 100, single quotes)
```

## Command data

Completions, hover docs and the known-command checks come from Cisco command-reference PDFs,
extracted by `import_scripts/extract-commands.js` into `server/data/<pack>/` (one directory per
manual) — see [COMMAND_COVERAGE.md](COMMAND_COVERAGE.md) for what is covered and
[import_scripts/EXTRACTION_NOTES.md](import_scripts/EXTRACTION_NOTES.md) before changing the extractor.
Commands a manual doesn't contain are added by hand in `server/data/curated/curated.json`.

## Building a .vsix

```bash
npm run package        # → build/cisco-ios-lsp-<version>.vsix
```

`npm run package` lints, tests and bundles before packaging, so the `.vsix` is fully
self-contained. Its store page is [STORE.md](STORE.md), not this repository's README
(`vsce package --readme-path STORE.md`). Images on the store page are absolute links to
`media/` on this repository's `main` branch.

Install a `.vsix` via **Extensions → ⋯ → Install from VSIX…** or
`code --install-extension cisco-ios-lsp-<version>.vsix`.

## Manual check

After installing a build:

1. Create `test.cfg` in any workspace → the language bar shows **Cisco Config**.
2. Type `interface ` (with space) at the top → the dropdown lists all interface types.
3. Type `gi` → `GigabitEthernet` appears; select it and type a slot/port.
4. Inside `interface GigabitEthernet0/1`, type `sw` → switchport completions; `ro` absent.
5. At global level: `class-map` → class-map completion; `tu` → `Tunnel` interface.
6. Hover over `dot1x` → syntax reminder popup.
7. Type `interfacs ` (deliberate typo) → red squiggle diagnostic.
8. Type `vlan 5000` → out-of-range VLAN diagnostic.
9. Inside an `interface` block, indent one sub-command differently from its siblings (e.g. 1
   space vs. 2) → inconsistent-indentation diagnostic. Mix a tab into a line's leading
   whitespace → mixed tabs/spaces diagnostic.
10. Type three lines — `interface GigabitEthernet0/1`, `  description X` (2 spaces), then
    ` ip address 192.0.2.4 255.255.255.0` (1 space) — save → the `ip address` line snaps to
    2 spaces to match its sibling. Save again → no further change. Save a file with no
    indentation issues → byte-identical after save.
11. Syntax highlighting (keywords, addresses, comments) appears without any other extension
    installed.
12. Enable `cisco-ios-lsp.outline.showSymbolsInOutlinePanel`, add a `router bgp 64500` and an
    `interface GigabitEthernet0/1` block → the Outline panel shows both as nested entries.
13. Add `class-map match-any VOICE` + a `policy-map PM` containing ` class VOICE`, then
    `service-policy output PM` on an interface → F12 on `PM` jumps to the policy-map,
    Shift+F12 lists both places, F2 renames all of them. `service-policy output TYPO` gets an
    undefined-reference warning.
14. Click the folding arrow next to an `interface` header → the whole block folds.

## Releases

Releases are cut by the maintainer: `scripts/public/release.sh vX.Y.Z` opens a release PR
on this repository; after it is merged with **Rebase and merge** (keeps the noreply author),
`scripts/public/release.sh vX.Y.Z --tag` tags `main`. The tag triggers [`release.yml`](.github/workflows/release.yml), which builds the
`.vsix` and publishes a GitHub Release with it attached, then starts
[`publish.yml`](.github/workflows/publish.yml), which publishes that exact `.vsix` to the
VS Code Marketplace and Open VSX. Pre-release versions (`X.Y.Z-rc.N`) are not published to
the stores: a release candidate is built with `npm run package` at that version and shared
as the `build/cisco-ios-lsp-X.Y.Z-rc.N.vsix` file, and the update check treats it as older
than the final `X.Y.Z`. The tag version must match `version` in `package.json`.

Pull requests on this repository are welcome, but `main` only ever receives release
commits, so a PR is not merged here: the maintainer cherry-picks it into the development
repository (you stay the author of that commit), it ships with the next release, and the
release commit carries a `Co-authored-by:` line for you. The PR is then closed with a note
naming that release.

## AI-assisted development

This project was developed with the assistance of AI — currently Anthropic's Claude. AI
tooling was used to scaffold the extension, write and refine the language-server logic, and
produce documentation. The code is provided under the MIT [LICENSE](LICENSE) "as is",
without warranty — review it before using it in production network environments.

## Issues

Issues use forms (`.github/ISSUE_TEMPLATE/`): bug, false warning / missing command, platform
or release support, and idea; blank issues are off and security reports go to private
vulnerability reporting ([SECURITY.md](SECURITY.md)). Each form sets a label (`bug`,
`false-positive`, `platform`, `idea`) — the labels must exist in the repository, or GitHub
silently drops them. [`lock-closed.yml`](.github/workflows/lock-closed.yml) locks issues 30
days after they were closed, so finished topics don't collect late comments.
