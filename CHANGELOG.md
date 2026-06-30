# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.2.0
[0.1.0]: https://github.com/Aswertus/cisco-lsp/releases/tag/v0.1.0
