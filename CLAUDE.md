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

## Branch Policy

- Active development happens on `claude_dev`.
- **Never push** without explicit user approval.
- Commit each meaningful change so work can be rolled back.

## cSpell Word List Maintenance

Custom technical terms live in `cspell.json` (`words` array). Add new terms there when
introducing new Cisco commands, LSP/tooling names, or extension identifiers that aren't
plain English. Short acronyms (≤3 chars) don't need listing.
