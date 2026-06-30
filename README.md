# cisco-ios-lsp

VS Code extension — Cisco IOS/IOS-XE IntelliSense via Language Server Protocol.

Adds **context-aware completions**, **hover documentation**, and **real-time diagnostics**
to Cisco config files. Works alongside
[`Y-Ysss.cisco-config-highlight`](https://marketplace.visualstudio.com/items?itemName=Y-Ysss.cisco-config-highlight),
which provides syntax highlighting and the `cisco` language ID. That extension is declared
as a required dependency and is loaded automatically.

---

## Features

| Capability | Detail |
|------------|--------|
| **Completions** | Auto-triggered, block-aware: completions change depending on whether the cursor is inside an `interface`, `router bgp`, `class-map`, `policy-map`, `line vty`, or at global level |
| **Hover docs** | Syntax reminders for known keywords — e.g. hover `dot1x` → `dot1x pae { authenticator \| supplicant \| both }` |
| **Diagnostics** | Squiggly errors on unknown top-level commands, invalid interface names, VLAN numbers outside 1–4094, and malformed IP addresses |

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

`Y-Ysss.cisco-config-highlight` registers `.cisco` and `.config`.
This extension additionally registers:

| Extension | Language |
|-----------|----------|
| `.cfg` | `cisco` |
| `.ios` | `cisco` |

To add further extensions (e.g. `.conf`) add a `files.associations` entry to your
VS Code workspace `settings.json`:

```json
"files.associations": {
  "*.conf": "cisco"
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
3. **Dependency:** this extension builds on `Y-Ysss.cisco-config-highlight`. VS Code installs
   it automatically from the Marketplace when you install the `.vsix`. On a restricted /
   air-gapped network without Marketplace access, install that extension manually first.
4. Reload the window (`Ctrl+Shift+P` → **Developer: Reload Window**).

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

### Interface — physical

| Keyword | Aliases |
|---------|---------|
| `GigabitEthernet` | `gi` |
| `FastEthernet` | `fa` |
| `TenGigabitEthernet` | `te` |
| `TwentyFiveGigE` | `twe` |
| `FortyGigabitEthernet` | `fo` |
| `HundredGigE` | `hu` |

### Interface — logical

`Port-channel` (`po`), `Tunnel` (`tu`), `Loopback` (`lo`), `Vlan` (SVI)

### Interface config block

`ip address`, `shutdown`, `no shutdown`, `description`, `duplex`, `speed`, `mtu`,
`carrier-delay`, `ip helper-address`

### Switchport

`switchport mode access/trunk`, `switchport access vlan`,
`switchport trunk allowed vlan`, `switchport nonegotiate`,
`spanning-tree portfast`, `spanning-tree bpduguard enable`

### 802.1X / MAB

`dot1x pae authenticator`, `mab`, `access-session`,
`authentication event/order/priority/host-mode/open/timer`

### QoS — Policy

`class-map match-any/all`, `policy-map`, `class`,
`service-policy input/output`, `bandwidth`, `police`, `set`, `priority`

### Parameter maps & templates

`parameter-map type`, `template`, `source template`

### VLANs

`vlan` block, `name`, `switchport trunk native vlan`

### Routing

`router bgp`, `router ospf`, `router eigrp`, `ip route`,
`network`, `neighbor`, `redistribute`

### BGP-EVPN / VXLAN

`l2vpn evpn`, `replication-mode`, `route-target`, `vni`,
`address-family l2vpn evpn`, `advertise-pip`

### VPN / Crypto

`crypto isakmp policy`, `crypto ipsec transform-set`, `crypto map`,
`tunnel source/destination/mode`

### Management

`hostname`, `enable secret`, `username`, `line vty`, `login local`,
`transport input ssh`, `ip ssh version 2`, `logging`, `ntp server`,
`ip domain-name`, `service timestamps`

### ACL / Security

`ip access-list standard/extended`, `permit`, `deny`,
`ip inspect`, `zone security`, `zone-pair security`

### TACACS+ / AAA

`aaa new-model`, `aaa authentication login`, `aaa authorization`,
`tacacs server`, `address ipv4`, `key`

### Syslog

`logging host`, `logging trap`, `logging facility`

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
9. Delete `test.cfg` when done.

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
