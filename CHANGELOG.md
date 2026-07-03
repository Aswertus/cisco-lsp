# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-07-03

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
- **Auto-indent on Enter** (experimental, off by default) after any of the block openers
  above, with 1-space indentation contributed as the `[cisco]` editor default
  (`editor.insertSpaces` / `editor.tabSize`). Enable with the
  `cisco-ios-lsp.experimental.autoIndent` setting; takes effect immediately when toggled.
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
- **Three new command-reference packs**: `cat9500-17.18` (1,312 commands, IOS XE 17.18.x),
  `cat9500-26.x` (1,227 commands, IOS XE 26.x.x), and `cat2960x-15.2.6` (435 commands,
  Catalyst 2960-X, classic IOS 15.2(6)E) — extracted from Cisco Command Reference PDFs via
  `npm run extract-commands`.

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
- `_testing/` (real production config backups used as diagnostic ground truth) is no longer
  git-versioned — gitignored and untracked, including its existing history.

### Removed

- The `cisco-ios-lsp.format.onSave` setting — use the standard per-language
  `editor.formatOnSave` (enabled for `cisco` files by default) instead.

### Fixed

- **Banner bodies and certificate payloads are now treated as free text**: everything
  between a banner's delimiters (`banner login ^C ... ^C`, `banner motd #...#`, including
  one-liners) and the hex dump between `certificate ...` and `quit` in a
  `crypto pki certificate chain` block is skipped by all line scanners — no more
  "Unknown command" / indentation warnings on ASCII-art banner lines, the formatter never
  re-indents that content, it can't create false cross-references, and it no longer
  produces folding ranges.
- Reconciled against a production Catalyst 9500 SD-Access config (`_testing/test.cisco`):
  - `LISP0[.n]` and `Bluetooth0/4` are recognised interface types.
  - ~140 curated command entries for families the Cat9500 Command Reference PDF doesn't
    cover: `call-home`, `control-plane`, `netconf-yang`, model-driven `telemetry`
    subscriptions/receivers/transforms, `transceiver type`, `crypto pki`
    trustpoints/certificate chains, RADIUS CoA (`aaa server radius dynamic-author`),
    `vrf definition`/`rd`, `router lisp` (locator-sets, eid-tables, sites, services),
    IS-IS router and interface commands, con/aux line commands, and assorted globals
    (`clock`, `ntp`, `snmp-server`, `ip ssh/http/pim/msdp`, ...).
  - New block buckets (openers + mode classification + auto-indent + completions):
    `call-home`, `control-plane`, `crypto pki trustpoint`, `crypto pki certificate
    chain`, the three `telemetry` modes, `transceiver type`, and RADIUS dynamic-author.
  - Cross-reference fixes: a LISP `prefix-list NAME` block opener counts as the
    prefix-list's definition, and in `ntp access-group peer ACL` the keyword `peer` is no
    longer mistaken for the ACL name (the ACL itself is now the reference).
- `scripts/extract-commands.js`: the TOC running-header noise filter only matched the IOS-XE
  `Command Reference, Cisco IOS XE` wording. Classic-IOS "Consolidated Platform Command
  Reference" manuals (e.g. the new 2960-X pack) repeat `Command Reference, Cisco IOS
  Release` instead, so those header lines leaked through and corrupted 13 TOC entries by
  gluing onto the next command name. Broadened `NOISE_RE` to match the shared prefix.

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
