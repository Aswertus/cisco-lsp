# Cisco IOS/IOS-XE IntelliSense

**Write and review Cisco IOS / IOS-XE configurations with the editor support you're used to
from programming languages:** context-aware completions, command documentation on hover,
live error checking, jump-to-definition and rename for named objects, and format on save.

![Completions and hover docs while editing an interface block](https://raw.githubusercontent.com/Aswertus/cisco-lsp/main/media/hero.gif)

- **Built from Cisco's own command references.** About 1,600 commands, with syntax, a
  description and usage notes, extracted from the Catalyst 9500 (IOS-XE 17.15, 17.18, 26.x)
  and Catalyst 2960-X (IOS 15.2) command references.
- **Runs entirely on your machine.** Your configs never leave the editor. The only network
  request is an optional check for new versions, which you can turn off.
- **Self-contained.** Syntax highlighting, outline and all language features are included.
  Nothing else to install.

---

## Features

### Completions that know where you are

Suggestions change with the block your cursor is in: `interface`, `router bgp`,
`class-map`, `policy-map`, `line vty`, `vrf definition`, `vlan` and more, or global
configuration. They also work after `no `, and accepting a multi-word command replaces
everything you've typed of it.

![Interface-level completions](https://raw.githubusercontent.com/Aswertus/cisco-lsp/main/media/completions.png)

### Command documentation on hover

Hover any command to see its syntax, what it does, and Cisco's usage notes, without
leaving the config.

![Hover documentation for switchport voice vlan](https://raw.githubusercontent.com/Aswertus/cisco-lsp/main/media/hover.png)

### Catch mistakes before they reach a device

Problems are underlined as you type and listed in the **Problems** panel:

- unknown or misspelled commands
- invalid interface names, VLAN IDs outside 1–4094, malformed IPv4 addresses
- a policy-map, class-map, ACL, route-map, prefix-list or VRF that is used but never
  defined, and one that is defined but never used
- inconsistent indentation, mixed tabs and spaces, and block sub-commands typed without
  indentation

Banner text and certificate data are never flagged. Each check can be tuned in the settings:
report unknown commands as information or not at all, list commands your platform needs in
`ignoredCommands`, or turn off the unused-object hints and the indentation checks.

![Diagnostics in the editor and the Problems panel](https://raw.githubusercontent.com/Aswertus/cisco-lsp/main/media/diagnostics.png)

### Navigate and rename named objects

On a class-map, policy-map, ACL, route-map, prefix-list or VRF name:

- **F12**: go to its definition
- **Shift+F12**: list every place it is applied (`service-policy`, `access-group`,
  `vrf forwarding`, `match`, ...)
- **F2**: rename the definition and every reference at once

![Renaming a policy-map everywhere it is used](https://raw.githubusercontent.com/Aswertus/cisco-lsp/main/media/rename.gif)

### Templates with placeholders

Working on a template? Placeholders such as `<HOSTNAME>`, `$MGMT_IP`, Jinja/Ansible
`{{ vlan_id }}` and `{% for %}` lines, or fill characters like `VlanXX` and `10.10.X.1` are
highlighted as a whole, explained on hover ("replace before deploying"), and never raise
false warnings. Choose from four highlight styles, or turn it off, and set your own fill
characters (for example `X` and `N`).

### Format on save, folding and outline

- **Format on save** fixes exactly the indentation problems the checks report, and nothing
  else. Also available via **Format Document** (Shift+Alt+F).
- **Folding**: every config block folds, across `!` separators, and works with sticky
  scroll.
- **Outline and breadcrumbs** (opt-in): interfaces, sub-interfaces, VRFs, BGP and its
  address families, class-maps and policy-maps.

![Outline panel with VRFs, class-maps, policy-maps, interfaces and BGP](https://raw.githubusercontent.com/Aswertus/cisco-lsp/main/media/outline.png)

---

## Getting started

1. Install the extension.
2. Open a config file. Files ending in `.cfg`, `.ios`, `.cisco` or `.config` are recognized
   automatically. For other names, pick **Cisco Config** from the language picker in the
   status bar, or add an association to your settings:

   ```json
   "files.associations": { "*.conf": "cisco" }
   ```

3. Config files get their own tab icon (a teal switch symbol). Icon themes that use language
   icons, such as the built-in Seti, show it in the explorer too. Material Icon Theme users:
   see the GitHub README for the one-line setting.
4. The extension narrows hover, completions and the unknown-command check to the platform a
   file is for, read from its `version` line. To choose explicitly, add a comment such as
   `!!# cisco-ios-lsp platform cat9500 17.18`. A command documented only for another
   platform is shown as a hint, never an error.

## Settings

| Setting                                           | Default      | What it does                                                                                                                                                |
| ------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cisco-ios-lsp.diagnostics.unknownCommands`       | `warning`    | Report commands not in the loaded Cisco command references as `warning`, `information`, or `off`. A command documented only for another platform is a hint. |
| `cisco-ios-lsp.diagnostics.ignoredCommands`       | `[]`         | Commands never reported as unknown, e.g. `["platform qos"]` (whole leading words, any case).                                                                |
| `cisco-ios-lsp.diagnostics.unusedObjects`         | `true`       | Hint when a class-map, policy-map, ACL, route-map, prefix-list or VRF is defined but never used.                                                            |
| `cisco-ios-lsp.diagnostics.indentation`           | `true`       | Report indentation problems (format on save still fixes them).                                                                                              |
| `cisco-ios-lsp.outline.showSymbolsInOutlinePanel` | `false`      | Show the config structure in the Outline panel and breadcrumbs.                                                                                             |
| `cisco-ios-lsp.outline.symbolsList`               | all on       | Choose which kinds of blocks appear in the outline.                                                                                                         |
| `cisco-ios-lsp.placeholders.style`                | `background` | How template placeholders are highlighted: `background`, `underline`, `italic`, `backgroundUnderline` or `off`.                                             |
| `cisco-ios-lsp.placeholders.fillCharacters`       | `X`          | Characters that stand for "fill in later", e.g. `XN` for `VlanXX` and `10.10.N.1`.                                                                          |
| `cisco-ios-lsp.checkForUpdates`                   | `true`       | For `.vsix` installs: check GitHub Releases for a newer version on startup.                                                                                 |
| `cisco-ios-lsp.experimental.autoIndent`           | `false`      | Indent the next line after a block-opening command such as `interface X`.                                                                                   |

Format on save uses VS Code's own `editor.formatOnSave` setting and is on by default for
Cisco config files.

## Syntax colours on any theme

Config files get their own colour layering without switching themes: the command word,
option keywords (`access`, `input`, `permit`), the names you chose (VLANs, ACLs, class-maps,
VRFs), interface types, numbers, descriptions and comments each have their own colour. The
palette is the one `Y-Ysss.cisco-config-highlight` shows together with the Daybreak theme.
Dark themes get Daybreak's values; themes with "Light" in their name get the same hues
darkened. Your own `editor.tokenColorCustomizations` take precedence.

## Works alongside Cisco Config Highlight

If you also have `Y-Ysss.cisco-config-highlight` installed, both work together: they share
the same language ID and highlighting scopes, so your theme looks the same. Disable either
one to choose which highlighting is used. If you keep both, set
`"cisco-config-highlight.diagnostics.enabled": false`: its checks don't know template
placeholders and report values like `XX.XX.XX.XX` as invalid addresses.

---

## Feedback

Found a false warning, a missing command or a bug, or want support for another platform?
[Open an issue](https://github.com/Aswertus/cisco-lsp/issues/new/choose) and pick the
matching form, or use **Help → Report Issue…** in VS Code. Issues are public, so include
only the few lines needed and replace hostnames, real IP addresses, passwords and keys.

## Links

- [Full command coverage](https://github.com/Aswertus/cisco-lsp/blob/main/COMMAND_COVERAGE.md)
- [Changelog](https://github.com/Aswertus/cisco-lsp/blob/main/CHANGELOG.md)
- [Source code](https://github.com/Aswertus/cisco-lsp) (MIT license)
- [Same colours in Remote Desktop Manager](https://github.com/Aswertus/cisco-rdm-highlighting):
  a syntax-highlighting profile for Devolutions RDM SSH sessions

Cisco, IOS and Catalyst are trademarks of Cisco Systems, Inc. This extension is an
independent project and is not affiliated with or endorsed by Cisco.
