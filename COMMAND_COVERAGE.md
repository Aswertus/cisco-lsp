# Command coverage

This summarizes the Cisco IOS/IOS-XE commands this extension recognizes for completions,
hover docs, and diagnostics. Each section below is generated from a Cisco command-reference
manual dropped into `_manuals/` and extracted with `npm run extract-commands -- <pdf>
--pack <packId> --platform <name> --release <ver>` (see `scripts/extract-commands.js` /
`scripts/EXTRACTION_NOTES.md`) -- do not hand-edit the text between an
`AUTO-GENERATED:<packId>` marker pair, it is overwritten on every re-run of that pack.

<!-- AUTO-GENERATED:cat9500-17.15:START -->

## Catalyst 9500 17.15.x

**1,315 commands** across 16 chapters (pack `cat9500-17.15`):

| Chapter                                           | Count | Examples                                                                                                                                                |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cisco SD-Access Commands                          | 48    | `broadcast-underlay`, `database-mapping`, `dynamic-eid`, `dynamic-eid detection multiple-addr`                                                          |
| Cisco TrustSec Commands                           | 61    | `address`, `clear cts environment-data`, `clear cts policy-server statistics`, `content-type json`                                                      |
| High Availability Commands                        | 52    | `clear diagnostic event-log`, `clear secure-stackwise-virtual interface`, `diagnostic monitor`, `diagnostic schedule module`                            |
| Interface and Hardware Commands                   | 83    | `bluetooth pin`, `carrier-delay`, `debug ilpower`, `debug interface`                                                                                    |
| IP Addressing Services Commands                   | 193   | `clear ip nhrp`, `clear ipv6 access-list`, `clear ipv6 dhcp`, `clear ipv6 dhcp binding`                                                                 |
| IP Multicast Routing Commands                     | 55    | `clear ip mfib counters`, `clear ip mroute`, `clear ip pim snooping vlan`, `debug condition vrf`                                                        |
| Layer 2/3 Commands                                | 125   | `avb`, `channel-group`, `channel-protocol`, `clear l2protocol-tunnel counters`                                                                          |
| MPLS Commands                                     | 49    | `autodiscovery`, `backup peer`, `encapsulation mpls`, `ip pim sparse-mode`                                                                              |
| Network Management Commands                       | 139   | `cache`, `clear flow exporter`, `clear flow monitor`, `clear snmp stats hosts`                                                                          |
| QoS Commands                                      | 31    | `auto qos classify`, `auto qos trust`, `auto qos video`, `auto qos voip`                                                                                |
| IP Routing Commands                               | 93    | `accept-lifetime`, `address-family ipv4`, `address-family ipv6`, `address-family l2vpn`                                                                 |
| Security                                          | 145   | `aaa accounting`, `aaa accounting dot1x`, `aaa accounting identity`, `aaa authentication dot1x`                                                         |
| Cisco Identity Based Networking Services Commands | 85    | `aaa accounting identity`, `aaa local authentication`, `absolute-timer`, `access-group`                                                                 |
| System Management Commands                        | 105   | `arp`, `boot`, `cat`, `copy`                                                                                                                            |
| Tracing Commands                                  | 30    | `set platform software trace`, `show platform software trace level`, `request platform software trace archive`, `show platform software btrace-manager` |
| VLAN Commands                                     | 21    | `clear vtp counters`, `access-session voice skip-data-vlan`, `debug sw-vlan`, `debug sw-vlan ifs`                                                       |

<!-- AUTO-GENERATED:cat9500-17.15:END -->

## Curated additions

A further set of commands lives in `server/data/curated/curated.json`, hand-maintained
rather than generated, because they fall into one of two cases found while reconciling this
extension's original hand-picked completions against the generated data:

- **Absent from every loaded platform reference.** For `cat9500-17.15` this includes the
  crypto/VPN family (`crypto isakmp policy`, `crypto ipsec transform-set`, `crypto map`),
  line/VTY configuration (`login local`, `line vty`, `exec-timeout`, `access-class`),
  basic syslog (`logging`, `logging host`, `logging trap`, `logging facility`), `ip route`,
  and a handful of others -- these commands exist on real IOS-XE devices but aren't documented
  in this platform-specific reference (they live in separate Security/Network-Management
  configuration guides).
- **"False friends"**: a bare name that collides with a _different, unrelated_ command
  documented under the same name in the loaded reference. For example, this PDF's only
  `shutdown` entry is for ERSPAN sessions, its `neighbor` entry is an L2TPv3 pseudowire
  command, and `transport`/`service`/`authentication` (bare) are all different commands from
  the interface `shutdown`, BGP `neighbor`, line `transport input`, and 802.1X
  `authentication order/event/...` this extension curates completions for. Both the curated
  entry and the PDF's unrelated entry are shown on hover, labeled, rather than picking one.
