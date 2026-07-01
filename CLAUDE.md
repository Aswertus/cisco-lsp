# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

`cisco-ios-lsp` is a VS Code extension that adds **completions**, **hover docs**,
**diagnostics**, **format on save**, **syntax highlighting**, and an **outline panel** for
Cisco IOS/IOS-XE config files. It owns the `cisco` language ID, registering a bundled TextMate
grammar (`syntaxes/cisco.tmLanguage.json`) adapted from `Y-Ysss.cisco-config-highlight` (MIT licensed,
see `THIRD_PARTY_NOTICES.md`) — no other extension is required, though that one can still be
installed alongside it (see README "Coexisting with `Y-Ysss.cisco-config-highlight`").

## Architecture

```
VS Code (UI)
  ├─ contributes.grammars     — syntaxes/cisco.tmLanguage.json (TextMate, scope source.cisco)
  ├─ client/extension.js      — LSP client, spawns the server, registers the outline provider
  │    ├─ server/server.js    — LSP server, JSON-RPC over stdio
  │    └─ client/registerOutlineSymbol.js — VS Code DocumentSymbolProvider (outline panel)
  │         └─ client/symbolsInfo.js      — regex/SymbolKind data for outline categories
```

No compile step — plain Node.js. VS Code spawns `server.js` on `cisco`-language file open
and kills it on exit. The grammar and outline provider are adapted from
`Y-Ysss.cisco-config-highlight` (MIT licensed; see `THIRD_PARTY_NOTICES.md`). `server.js`
itself holds no command data inline — at startup it globs every
`server/data/<packId>/*.json` file (one directory per ingested Cisco command-reference
manual, plus `server/data/curated/curated.json` for hand-maintained entries) into memory,
then classifies each command into a completion bucket from its documented command mode and
builds a name-indexed lookup for hover.

## Key Files

| File                               | Purpose                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `package.json`                     | Extension manifest, `npm` scripts (`lint`, `format`, `extract-commands`)                    |
| `client/extension.js`              | LSP client — starts/stops the server, registers outline provider                            |
| `client/registerOutlineSymbol.js`  | Outline panel `DocumentSymbolProvider`                                                      |
| `client/symbolsInfo.js`            | Regex/`SymbolKind` data the outline provider matches against                                |
| `server/server.js`                 | LSP server — completions, hover, diagnostics logic                                          |
| `server/data/<packId>/*.json`      | Generated command data, one directory per ingested manual (see "Regenerating Command Data") |
| `server/data/curated/curated.json` | Hand-maintained command entries — same schema as generated data, `source: "curated"`        |
| `scripts/extract-commands.js`      | PDF → JSON extractor; re-run whenever a manual is added or updated                          |
| `scripts/EXTRACTION_NOTES.md`      | How the PDF structure was reverse-engineered — read before touching the extractor           |
| `syntaxes/cisco.tmLanguage.json`   | TextMate grammar for syntax highlighting                                                    |
| `language-configuration.json`      | Comments/brackets for the `cisco` language                                                  |
| `THIRD_PARTY_NOTICES.md`           | Attribution for code adapted from `Y-Ysss.cisco-config-highlight`                           |
| `.vscode/extensions.json`          | Recommended extensions                                                                      |
| `.vscode/settings.json`            | Workspace settings (theme, formatter, rulers)                                               |
| `cspell.json`                      | Custom word list for Code Spell Checker (partly auto-generated, see below)                  |

## Development Workflow

```bash
npm install
# Symlink repo into VS Code Server extensions so edits take effect on reload:
ln -sf /home/matthias/cisco-lsp ~/.vscode-server/extensions/cisco-ios-lsp

npm run lint      # ESLint
npm run format    # Prettier
```

Reload VS Code window (`Ctrl+Shift+P` → **Developer: Reload Window**) after editing
`server.js` or `client/extension.js`.

## Regenerating Command Data

Command completions/hover/diagnostics data is generated from official Cisco IOS/IOS-XE
**Command Reference** PDFs, not hand-typed. To ingest a manual (the first time, or after
Cisco publishes an update):

```bash
# Requires poppler-utils (pdftotext/pdfinfo) — a system package, not an npm dependency:
#   apt-get install poppler-utils   /   dnf install poppler-utils

# Drop the PDF into _manuals/ (gitignored — only the generated JSON is committed), then:
npm run extract-commands -- _manuals/<file>.pdf --pack <packId> \
  --platform "<Platform name>" --release "<IOS-XE release>"
npm run format   # re-format the generated JSON/docs
```

- `packId` is a short slug (e.g. `cat9500-17.15`) — pick a new one per platform/release; the
  script fully regenerates only that pack's `server/data/<packId>/` directory and never
  touches other packs, so multiple manuals coexist without conflicts.
- The script also re-derives `COMMAND_COVERAGE.md`'s per-pack section, adds any new
  Cisco/networking terms to `cspell.json`, and updates the TextMate grammar's
  `command_root` highlighting rule — all from whatever is currently under `server/data/**`,
  so these three stay in sync automatically.
- It self-validates (per-chapter extracted-vs-TOC counts) and exits non-zero on a genuine
  parsing problem rather than silently shipping incomplete data — read the printed report if
  it fails. **Read `scripts/EXTRACTION_NOTES.md` first** if extending or debugging the
  extractor; it documents the PDF's structural quirks (running headers, wrapped TOC lines,
  duplicate-name entries, indented vs. flush section labels) discovered while building it.
- Not every real IOS-XE command is in a given platform's Command Reference (e.g. this
  Catalyst 9500 manual has no crypto/VPN or line/VTY commands — see `curated.json`'s "not in
  the PDF" entries), and a bare name can mean something unrelated to what you'd expect (a
  "false friend" — e.g. this PDF's only `shutdown` entry is ERSPAN-specific). Check
  `server/data/curated/curated.json` before assuming a missing/surprising command is a bug in
  the extractor.

## Packaging / Release

The extension is distributed as a sideloaded `.vsix` file (no Marketplace).

```bash
npm install
npm run package        # vsce package → cisco-ios-lsp-<version>.vsix
```

- Bump `version` in `package.json` before packaging a new release.
- Production `dependencies` (the `vscode-languageserver*` packages) are bundled into the
  `.vsix` by vsce — **no esbuild / no compile step**.
- `.vscodeignore` keeps dev-only files (`.vscode/`, `CLAUDE.md`, `cspell.json`, `.claude/`,
  lint/format configs, `scripts/**`, `_manuals/**`) out of the package. `README.md`,
  `COMMAND_COVERAGE.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `syntaxes/`, and
  `language-configuration.json` are included, and so is `server/data/**/*.json` — the
  generated command data is a runtime dependency of `server.js`, not a dev-only file. The
  source PDFs under `_manuals/` are excluded (multi-MB each; only the generated JSON needs
  to ship).
- No `extensionDependencies` — the grammar and outline provider are bundled, so the `.vsix`
  is fully self-contained.

Share the resulting `.vsix`; coworkers install via **Extensions → ⋯ → Install from VSIX…**.

### Automated releases (preferred)

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which runs `npm ci` +
`npm run package` and publishes a GitHub Release with the `.vsix` attached. To release:

```bash
# bump version in package.json + update CHANGELOG.md, then:
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z && git push origin vX.Y.Z
```

The tag version must match `version` in `package.json`. The repo (`Aswertus/cisco-lsp`) is
**private**, so coworkers need collaborator access to download release assets. The local
`npm run package` above remains the offline/manual fallback.

The client's startup **update check** (`client/extension.js`) calls the public Releases API:
it no-ops (404) while the repo is private and starts working once the repo is public — no
token required on user machines.

## Branch Policy

- Active development happens on `claude_dev`.
- **Never push** without explicit user approval.
- Commit each meaningful change so work can be rolled back.

## cSpell Word List Maintenance

Custom technical terms live in `cspell.json` (`words` array). Most Cisco/networking terms are
now added automatically by `npm run extract-commands` (see "Regenerating Command Data")
whenever a manual is ingested. Add terms by hand only for non-command vocabulary: LSP/tooling
names, extension identifiers, or Cisco terms that don't come from a command name. Short
acronyms (≤3 chars) don't need listing.
