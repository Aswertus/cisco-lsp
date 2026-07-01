# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-01

### Added

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
- TextMate grammar: known command roots are now syntax-highlighted distinctly
  (`keyword.control.command.cisco`), derived from the same generated command list.

### Changed

- Completions now resolve their documentation lazily (`resolveProvider`) instead of
  eagerly, since completion lists can now be much larger.

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

[0.4.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.4.0
[0.2.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.2.0
[0.1.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.1.0
