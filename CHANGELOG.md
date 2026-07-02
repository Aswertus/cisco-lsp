# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Flush-left block recovery**: a block typed without indentation (e.g. `interface X`
  followed by `spanning-tree bpdufilter` at column 0) is now detected by the linter and fixed
  by the formatter — each un-indented child gets a warning and is indented to the file's own
  indent width (falling back to IOS-native 1 space). A line is only treated as a child when
  the command is documented for that block's mode in the loaded command data; unknown or
  global commands end the block and are left alone, so back-to-back blocks without `!`
  separators are never mis-indented. Covers a broadened opener set: `interface`, `router`,
  `line`, `class-map`, `policy-map`, `vrf definition`, `vlan <n>`,
  `flow record/exporter/monitor`, `service-template`, `template`, `route-map`,
  `ip/ipv6 access-list`, `aaa group server`, `key chain`, `radius/tacacs server`,
  `device-tracking policy`, `crypto map`.
- **Auto-indent on Enter** after any of the block openers above (`indentationRules` in the
  language configuration), with 1-space indentation contributed as the `[cisco]` editor
  default (`editor.insertSpaces` / `editor.tabSize`).
- Completions: the new block openers are recognised as contexts too (e.g. commands documented
  for VRF or VLAN configuration mode are offered inside `vrf definition` / `vlan` blocks); a
  recognised block whose bucket holds no commands falls back to the top-level list.

- **Go to definition / find references / rename** (F12 / Shift+F12 / F2) for named objects:
  class-maps, policy-maps, named + numbered ACLs, route-maps, prefix-lists, and VRFs, linking
  each definition to the places it is applied (`service-policy`, `access-group`,
  `access-class`, `match ...`, `vrf forwarding`, `address-family ... vrf`, ...).
- **Cross-reference diagnostics**: referencing an object that is never defined in the file
  warns; defining one that is never referenced shows a hint.
- **Folding ranges** for every indented config block, spanning `!` separators.
- **Format on save** for the indentation fixes, now driven by VS Code's own
  `editor.formatOnSave` (contributed as a `[cisco]` language default).
- Completions now work after a leading `no `, and accepting a multiword command replaces the
  full typed prefix (no more `ip ip address` after typing `ip addr`).
- Unit tests (`npm test`, node:test) covering the indentation scanner/formatter round-trip,
  block detection, diagnostic positions, data loading, xref index, and document symbols; run
  in CI and on packaging.

### Changed

- **Faster startup and typing**: client and server are bundled with esbuild into single
  `dist/` files, the command data ships as one merged JSON parsed lazily right after the LSP
  handshake, per-block completion lists are precomputed once, and the document's split lines
  are cached per version instead of re-split on every keystroke/hover.
- The outline is now served by the language server (`textDocument/documentSymbol`); symbols
  span their whole block, so breadcrumbs and sticky scroll track the enclosing block.
  Existing `cisco-ios-lsp.outline.*` settings keep working; same-category blocks now merge
  into one outline group, and class-map labels drop the `match-any`/`match-all` prefix.
- Diagnostics precision: every out-of-range VLAN / malformed IPv4 on a line is flagged at its
  own position (previously only the first, sometimes at the wrong column); a corrupt command
  data file is skipped with a logged error instead of crashing the server.
- `server.js` split into testable `server/lib/` modules; ESLint upgraded to v10 flat config.

### Removed

- The `cisco-ios-lsp.format.onSave` setting — use the standard per-language
  `editor.formatOnSave` (enabled for `cisco` files by default) instead.

## [0.5.0] - 2026-07-01

### Added

- Bundled TextMate grammar (`syntaxes/cisco.tmLanguage.json`) and `language-configuration.json`
  for the `cisco` language, adapted from `Y-Ysss.cisco-config-highlight` (MIT licensed; see
  `THIRD_PARTY_NOTICES.md`). The extension now provides its own syntax highlighting, including
  data-driven command-root highlighting (`keyword.control.command.cisco`) derived from the
  same generated command list described below.
- Outline panel / breadcrumbs support (`client/registerOutlineSymbol.js`,
  `client/symbolsInfo.js`), also adapted from `Y-Ysss.cisco-config-highlight`. Off by default;
  enable with `cisco-ios-lsp.outline.showSymbolsInOutlinePanel`, configure categories with
  `cisco-ios-lsp.outline.symbolsList`.
- README sections on coexisting with `Y-Ysss.cisco-config-highlight` and on Material Icon
  Theme file-icon associations.
- Command data is now generated from official Cisco Command Reference PDFs instead of
  hand-typed: completions, hover docs, and diagnostics cover **1,315 commands** across 16
  chapters of the Catalyst 9500 IOS XE 17.15.x reference (up from ~150 hand-picked entries),
  via a new re-runnable extractor (`npm run extract-commands`) so future manuals (other
  platforms/releases) can be added the same way.
- New `exec` completion bucket for `show`/`clear`/`debug`-style EXEC-mode commands (~40% of
  the loaded command set), alongside the existing interface/router/class-map/policy-map/line
  contextual buckets.
- Hover now does a longest-prefix match against the full command set and shows every
  documented variant when a name is ambiguous (e.g. a command meaning different things in
  different modes), instead of a small fixed lookup table.
- `COMMAND_COVERAGE.md` and `cspell.json` are now regenerated from the same command data.

### Changed

- Completions now resolve their documentation lazily (`resolveProvider`) instead of
  eagerly, since completion lists can now be much larger.

### Removed

- `extensionDependencies` on `Y-Ysss.cisco-config-highlight` — no longer required since
  highlighting is bundled. That extension can still be installed alongside this one.

## [0.2.0] - 2026-06-30

### Added

- Startup update check: notifies when a newer version is published on GitHub Releases, with
  an "Open Releases" action. Inactive while the repo is private; activates automatically once
  it is public. Toggle with the `cisco-ios-lsp.checkForUpdates` setting.

## [0.1.0] - 2026-06-30

Initial release.

### Added

- Language server for Cisco IOS/IOS-XE config files (built on the `cisco` language ID
  from `Y-Ysss.cisco-config-highlight`):
  - **Completions** — context-aware by config block (interface, router, class-map,
    policy-map, line, global).
  - **Hover** — syntax reminders for known keywords.
  - **Diagnostics** — unknown top-level commands, invalid interface types, out-of-range
    VLAN IDs, malformed IPv4 addresses.
- Packaging as a shareable `.vsix` (`npm run package`), with production dependencies
  bundled (no build step).
- Original Golden Gate Bridge icon with a terminal-style wordmark.
- Automated releases: pushing a `vX.Y.Z` tag builds and publishes the `.vsix` via GitHub
  Actions.

[0.5.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.5.0
[0.2.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.2.0
[0.1.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.1.0
