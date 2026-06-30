# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

`cisco-ios-lsp` is a VS Code extension that adds **completions**, **hover docs**, and
**diagnostics** for Cisco IOS/IOS-XE config files. It depends on
`Y-Ysss.cisco-config-highlight` for the `cisco` language ID and syntax highlighting.

## Architecture

```
VS Code (UI)
  └─ client/extension.js      — LSP client, spawns the server
       └─ server/server.js    — LSP server, JSON-RPC over stdio
```

No compile step — plain Node.js. VS Code spawns `server.js` on `cisco`-language file open
and kills it on exit.

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest, `npm` scripts (`lint`, `format`) |
| `client/extension.js` | LSP client — starts/stops the server |
| `server/server.js` | LSP server — completions, hover, diagnostics logic |
| `.vscode/extensions.json` | Recommended extensions |
| `.vscode/settings.json` | Workspace settings (theme, formatter, rulers) |
| `cspell.json` | Custom word list for Code Spell Checker |

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
  lint/format configs) out of the package. `README.md` and `LICENSE` are included.
- `extensionDependencies` pulls in `Y-Ysss.cisco-config-highlight` on the user's machine
  automatically (from the Marketplace) at install time.

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

Custom technical terms live in `cspell.json` (`words` array). Add new terms there when
introducing new Cisco commands, LSP/tooling names, or extension identifiers that aren't
plain English. Short acronyms (≤3 chars) don't need listing.
