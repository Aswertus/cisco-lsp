'use strict';

const {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  CompletionItemKind,
  DiagnosticSeverity,
  TextDocumentSyncKind,
  MarkupKind,
} = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ---------------------------------------------------------------------------
// Completion data
// ---------------------------------------------------------------------------
//
// Each entry: { label, detail, kind?, doc? }
// `kind` defaults to Keyword. `doc` (optional) is the hover/detail markdown.

const K = CompletionItemKind;

// Interface types — offered after typing `interface ` and at slot completion.
const INTERFACE_TYPES = [
  { label: 'GigabitEthernet', detail: 'physical — 1G (alias: gi)' },
  { label: 'FastEthernet', detail: 'physical — 100M (alias: fa)' },
  { label: 'TenGigabitEthernet', detail: 'physical — 10G (alias: te)' },
  { label: 'TwentyFiveGigE', detail: 'physical — 25G (alias: twe)' },
  { label: 'FortyGigabitEthernet', detail: 'physical — 40G (alias: fo)' },
  { label: 'HundredGigE', detail: 'physical — 100G (alias: hu)' },
  { label: 'Port-channel', detail: 'logical — LAG bundle (alias: po)' },
  { label: 'Tunnel', detail: 'logical — tunnel interface (alias: tu)' },
  { label: 'Loopback', detail: 'logical — loopback (alias: lo)' },
  { label: 'Vlan', detail: 'logical — switched virtual interface (SVI)' },
];

// Inside an `interface` block.
const INTERFACE_CONFIG = [
  { label: 'ip address', detail: 'set IPv4 address', doc: 'ip address <addr> <mask>' },
  { label: 'no ip address', detail: 'remove IPv4 address' },
  { label: 'description', detail: 'interface description text' },
  { label: 'shutdown', detail: 'administratively disable' },
  { label: 'no shutdown', detail: 'enable the interface' },
  { label: 'duplex', detail: 'duplex { auto | full | half }' },
  { label: 'speed', detail: 'speed { auto | 10 | 100 | 1000 | ... }' },
  { label: 'mtu', detail: 'mtu <64-9216>' },
  { label: 'carrier-delay', detail: 'carrier-delay <seconds>' },
  { label: 'ip helper-address', detail: 'ip helper-address <addr>' },
  { label: 'switchport mode access', detail: 'set port to access mode' },
  { label: 'switchport mode trunk', detail: 'set port to trunk mode' },
  { label: 'switchport access vlan', detail: 'switchport access vlan <1-4094>' },
  { label: 'switchport trunk allowed vlan', detail: 'switchport trunk allowed vlan <list>' },
  { label: 'switchport trunk native vlan', detail: 'switchport trunk native vlan <id>' },
  { label: 'switchport nonegotiate', detail: 'disable DTP negotiation' },
  { label: 'spanning-tree portfast', detail: 'enable PortFast on this port' },
  { label: 'spanning-tree bpduguard enable', detail: 'enable BPDU Guard' },
  { label: 'dot1x pae authenticator', detail: 'set 802.1X PAE role to authenticator' },
  { label: 'mab', detail: 'enable MAC Authentication Bypass' },
  { label: 'access-session', detail: 'access-session { host-mode | control-direction | ... }' },
  { label: 'authentication event', detail: 'authentication event <event> action <action>' },
  { label: 'authentication order', detail: 'authentication order dot1x mab' },
  { label: 'authentication priority', detail: 'authentication priority dot1x mab' },
  { label: 'authentication host-mode', detail: 'authentication host-mode { single-host | multi-auth | ... }' },
  { label: 'authentication open', detail: 'enable open (monitor) mode' },
  { label: 'authentication timer', detail: 'authentication timer { reauthenticate | restart } <sec>' },
  { label: 'service-policy input', detail: 'service-policy input <policy-map>' },
  { label: 'service-policy output', detail: 'service-policy output <policy-map>' },
  { label: 'source template', detail: 'source template <name>' },
  { label: 'tunnel source', detail: 'tunnel source <interface | addr>' },
  { label: 'tunnel destination', detail: 'tunnel destination <addr>' },
  { label: 'tunnel mode', detail: 'tunnel mode { gre | ipsec ipv4 | ... }' },
];

// Inside a `router bgp/ospf/eigrp` block.
const ROUTER_CONFIG = [
  { label: 'network', detail: 'network <addr> [mask <mask>]' },
  { label: 'neighbor', detail: 'neighbor <addr> remote-as <asn>' },
  { label: 'redistribute', detail: 'redistribute { connected | static | ospf | ... }' },
  { label: 'address-family', detail: 'address-family { ipv4 | ipv6 | l2vpn evpn }' },
  { label: 'address-family l2vpn evpn', detail: 'enter L2VPN EVPN address family' },
  { label: 'bgp router-id', detail: 'bgp router-id <addr>' },
  { label: 'route-target', detail: 'route-target { import | export | both } <rt>' },
  { label: 'vni', detail: 'vni <vni-number>' },
  { label: 'advertise-pip', detail: 'advertise PIP (primary IP) in EVPN' },
];

// Inside a `class-map` block.
const CLASS_MAP_CONFIG = [
  { label: 'match access-group', detail: 'match access-group { name <acl> | <number> }' },
  { label: 'match dscp', detail: 'match dscp <value>' },
  { label: 'match protocol', detail: 'match protocol <name>' },
];

// Inside a `policy-map` block.
const POLICY_MAP_CONFIG = [
  { label: 'class', detail: 'class { <class-map> | class-default }' },
  { label: 'bandwidth', detail: 'bandwidth { <kbps> | percent <pct> }' },
  { label: 'police', detail: 'police <bps> [burst]' },
  { label: 'set', detail: 'set { dscp | precedence | qos-group } <value>' },
  { label: 'priority', detail: 'priority [ <kbps> | percent <pct> ]' },
];

// Inside a `line vty/console` block.
const LINE_CONFIG = [
  { label: 'login local', detail: 'authenticate against local user database' },
  { label: 'login authentication', detail: 'login authentication <aaa-list>' },
  { label: 'transport input ssh', detail: 'allow SSH only' },
  { label: 'transport input', detail: 'transport input { ssh | telnet | none | all }' },
  { label: 'exec-timeout', detail: 'exec-timeout <minutes> [seconds]' },
  { label: 'access-class', detail: 'access-class <acl> { in | out }' },
];

// Global configuration level.
const GLOBAL_CONFIG = [
  { label: 'interface', detail: 'enter interface configuration' },
  { label: 'router bgp', detail: 'router bgp <asn>' },
  { label: 'router ospf', detail: 'router ospf <process-id>' },
  { label: 'router eigrp', detail: 'router eigrp <as | name>' },
  { label: 'ip route', detail: 'ip route <prefix> <mask> <next-hop>' },
  { label: 'vlan', detail: 'vlan <1-4094>' },
  { label: 'class-map', detail: 'class-map [ match-any | match-all ] <name>' },
  { label: 'class-map match-any', detail: 'class-map match-any <name>' },
  { label: 'class-map match-all', detail: 'class-map match-all <name>' },
  { label: 'policy-map', detail: 'policy-map <name>' },
  { label: 'parameter-map type', detail: 'parameter-map type <type> <name>' },
  { label: 'template', detail: 'template <name>' },
  { label: 'l2vpn evpn', detail: 'enter L2VPN EVPN configuration' },
  { label: 'hostname', detail: 'hostname <name>' },
  { label: 'username', detail: 'username <name> privilege <0-15> secret <pw>' },
  { label: 'enable secret', detail: 'enable secret <password>' },
  { label: 'line vty', detail: 'line vty <first> <last>' },
  { label: 'line console', detail: 'line console 0' },
  { label: 'logging', detail: 'logging { host | trap | facility } ...' },
  { label: 'logging host', detail: 'logging host <addr>' },
  { label: 'logging trap', detail: 'logging trap <level>' },
  { label: 'logging facility', detail: 'logging facility <facility>' },
  { label: 'ntp server', detail: 'ntp server <addr>' },
  { label: 'ip ssh version 2', detail: 'force SSHv2' },
  { label: 'ip domain-name', detail: 'ip domain-name <name>' },
  { label: 'ip domain name', detail: 'ip domain name <name>' },
  { label: 'service timestamps', detail: 'service timestamps { debug | log } datetime ...' },
  { label: 'ip access-list standard', detail: 'ip access-list standard <name>' },
  { label: 'ip access-list extended', detail: 'ip access-list extended <name>' },
  { label: 'aaa new-model', detail: 'enable the AAA subsystem' },
  { label: 'aaa authentication login', detail: 'aaa authentication login <list> <method>' },
  { label: 'aaa authorization', detail: 'aaa authorization <type> <list> <method>' },
  { label: 'tacacs server', detail: 'tacacs server <name>' },
  { label: 'crypto isakmp policy', detail: 'crypto isakmp policy <priority>' },
  { label: 'crypto ipsec transform-set', detail: 'crypto ipsec transform-set <name> <transforms>' },
  { label: 'crypto map', detail: 'crypto map <name> <seq> ipsec-isakmp' },
  { label: 'zone security', detail: 'zone security <name>' },
  { label: 'zone-pair security', detail: 'zone-pair security <name> source <z> destination <z>' },
];

// ---------------------------------------------------------------------------
// Hover documentation — keyed by the first significant token(s).
// ---------------------------------------------------------------------------

const HOVER_DOCS = {
  dot1x: 'dot1x pae { authenticator | supplicant | both }\n\nConfigures the 802.1X Port Access Entity role.',
  mab: 'mab [ eap ]\n\nEnables MAC Authentication Bypass — authenticate by MAC when 802.1X is absent.',
  switchport: 'switchport mode { access | trunk | dynamic }\n\nLayer-2 port configuration.',
  'spanning-tree': 'spanning-tree { portfast | bpduguard | bpdufilter | guard } ...',
  interface: 'interface <type><slot/port>\n\nEnter interface configuration mode.',
  vlan: 'vlan <1-4094>\n\nCreate or configure a VLAN. Valid IDs are 1–4094 (1002–1005 reserved).',
  'router': 'router { bgp <asn> | ospf <pid> | eigrp <as> }\n\nEnter a routing-protocol process.',
  'access-session': 'access-session { host-mode | control-direction | port-control } ...',
  authentication: 'authentication { order | priority | event | host-mode | open | timer } ...',
  'service-policy': 'service-policy { input | output } <policy-map>',
  'class-map': 'class-map [ match-any | match-all ] <name>\n\nDefine traffic-classification criteria.',
  'policy-map': 'policy-map <name>\n\nDefine QoS actions applied to classes.',
  'route-target': 'route-target { import | export | both } <ASN:nn | IP:nn>',
  vni: 'vni <vni-number>\n\nVXLAN Network Identifier mapping.',
  tacacs: 'tacacs server <name>\n  address ipv4 <addr>\n  key <shared-secret>',
  logging: 'logging { host <addr> | trap <level> | facility <facility> }',
  hostname: 'hostname <name>\n\nSet the device hostname.',
};

// ---------------------------------------------------------------------------
// Known top-level command roots — for typo diagnostics.
// ---------------------------------------------------------------------------

const KNOWN_TOP_LEVEL = new Set([
  'interface', 'router', 'ip', 'ipv6', 'vlan', 'class-map', 'policy-map',
  'parameter-map', 'template', 'l2vpn', 'hostname', 'username', 'enable',
  'line', 'logging', 'ntp', 'service', 'aaa', 'tacacs', 'radius', 'crypto',
  'zone', 'zone-pair', 'no', 'access-list', 'snmp-server', 'spanning-tree',
  'vtp', 'banner', 'boot', 'clock', 'domain', 'errdisable', 'lldp', 'cdp',
  'mac', 'port-channel', 'standby', 'track', 'route-map', 'key', 'object-group',
  'archive', 'event', 'flow', 'license', 'platform', 'redundancy', 'vrf',
  'controller', 'voice', 'dial-peer', 'end', 'exit', 'version', 'frame-relay',
  'monitor', 'qos', 'mls', 'system', 'device-tracking', 'authentication',
  'dot1x', 'epm', 'identity', 'policy', 'subscriber', 'cts', 'pki',
]);

// Valid IOS-XE interface type names (lower-cased), incl. common abbreviations.
const VALID_INTERFACE_TYPES = [
  'gigabitethernet', 'gi', 'gig', 'fastethernet', 'fa', 'tengigabitethernet',
  'te', 'ten', 'twentyfivegige', 'twe', 'fortygigabitethernet', 'fo', 'fou',
  'hundredgige', 'hu', 'port-channel', 'po', 'tunnel', 'tu', 'loopback', 'lo',
  'vlan', 'bdi', 'serial', 'se', 'ethernet', 'eth', 'e', 'cellular', 'async',
  'dialer', 'virtual-template', 'multilink', 'pseudowire', 'nve', 'appgigabitethernet',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the current configuration block by walking backwards from `line`
 * over physical lines, using leading indentation as the block boundary signal
 * (IOS sub-mode commands are indented; the block header is at column 0 / less
 * indented). Falls back to scanning for the nearest less-indented header.
 *
 * Returns one of: 'interface' | 'router' | 'class-map' | 'policy-map' |
 *                 'line' | 'global'
 */
function detectBlock(lines, lineIndex) {
  const current = lines[lineIndex] ?? '';
  const currentIndent = leadingSpaces(current);

  // A header at column 0 with the cursor line indented means we're inside it.
  // Walk up to the nearest line with strictly less indentation than the
  // current line (its parent), or to a column-0 header.
  for (let i = lineIndex - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('!')) continue;

    const indent = leadingSpaces(raw);
    // The parent block header is less indented than the current line.
    if (indent < currentIndent || (currentIndent === 0 && indent === 0)) {
      const header = raw.trim().toLowerCase();
      const block = classifyHeader(header);
      if (block) return block;
      // A column-0 non-block line means we're back at global scope.
      if (indent === 0) return 'global';
    }
  }
  return 'global';
}

function classifyHeader(header) {
  if (header.startsWith('interface ')) return 'interface';
  if (header.startsWith('router ')) return 'router';
  if (header.startsWith('class-map')) return 'class-map';
  if (header.startsWith('policy-map')) return 'policy-map';
  if (header.startsWith('line ')) return 'line';
  return null;
}

function leadingSpaces(s) {
  const m = s.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function toCompletionItems(entries) {
  return entries.map((e) => ({
    label: e.label,
    kind: e.kind || K.Keyword,
    detail: e.detail,
    documentation: e.doc
      ? { kind: MarkupKind.Markdown, value: '```\n' + e.doc + '\n```' }
      : undefined,
  }));
}

function isValidIpv4(addr) {
  const parts = addr.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

// ---------------------------------------------------------------------------
// LSP lifecycle
// ---------------------------------------------------------------------------

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {
      // Auto-trigger after a space (next-token) and on '.' is not relevant here.
      triggerCharacters: [' '],
      resolveProvider: false,
    },
    hoverProvider: true,
  },
}));

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const lineIndex = params.position.line;
  const currentLine = lines[lineIndex] ?? '';
  const prefix = currentLine.slice(0, params.position.character);
  const trimmed = prefix.trim().toLowerCase();

  // Special case: right after `interface ` → offer interface types.
  if (/^interface\s+\S*$/.test(trimmed) || /^interface\s+$/.test(prefix.toLowerCase())) {
    return toCompletionItems(
      INTERFACE_TYPES.map((t) => ({ ...t, kind: K.Class })),
    );
  }

  const block = detectBlock(lines, lineIndex);

  switch (block) {
    case 'interface':
      return toCompletionItems(INTERFACE_CONFIG);
    case 'router':
      return toCompletionItems(ROUTER_CONFIG);
    case 'class-map':
      return toCompletionItems(CLASS_MAP_CONFIG);
    case 'policy-map':
      return toCompletionItems(POLICY_MAP_CONFIG);
    case 'line':
      return toCompletionItems(LINE_CONFIG);
    case 'global':
    default:
      return toCompletionItems(GLOBAL_CONFIG);
  }
});

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const line = doc.getText().split(/\r?\n/)[params.position.line] ?? '';
  const tokens = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Try a two-word key first (e.g. "class-map"), then the first token.
  const twoWord = tokens.slice(0, 2).join(' ');
  const doc1 = HOVER_DOCS[twoWord] || HOVER_DOCS[tokens[0]];
  if (!doc1) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: '```\n' + doc1 + '\n```' },
  };
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function validate(doc) {
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const diagnostics = [];

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;

    const indent = leadingSpaces(line);
    const tokens = trimmed.split(/\s+/);
    const first = tokens[0].toLowerCase();

    // (1) Unknown top-level command (only flag column-0 commands).
    if (indent === 0 && !KNOWN_TOP_LEVEL.has(first)) {
      addDiag(
        diagnostics,
        i,
        line.indexOf(tokens[0]),
        tokens[0].length,
        `Unknown command "${tokens[0]}" — possible typo.`,
        DiagnosticSeverity.Warning,
      );
    }

    // (2) Invalid interface type name.
    if (first === 'interface' && tokens[1]) {
      const typeName = tokens[1].toLowerCase().match(/^[a-z-]+/)?.[0] || '';
      if (typeName && !VALID_INTERFACE_TYPES.includes(typeName)) {
        const col = line.indexOf(tokens[1]);
        addDiag(
          diagnostics,
          i,
          col,
          tokens[1].length,
          `"${tokens[1]}" is not a recognised IOS-XE interface type.`,
          DiagnosticSeverity.Warning,
        );
      }
    }

    // (3) VLAN number out of range (1–4094). Matches "vlan <n>" and
    //     "switchport access vlan <n>".
    const vlanMatch = trimmed.match(/\bvlan\s+(\d+)\b/i);
    if (vlanMatch) {
      const n = Number(vlanMatch[1]);
      if (n < 1 || n > 4094) {
        const col = line.indexOf(vlanMatch[1], line.toLowerCase().indexOf('vlan'));
        addDiag(
          diagnostics,
          i,
          col,
          vlanMatch[1].length,
          `VLAN ${n} is out of range (must be 1–4094).`,
          DiagnosticSeverity.Error,
        );
      }
    }

    // (4) Malformed IPv4 address (basic dotted-quad shape but bad octet).
    const ipCandidates = trimmed.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
    ipCandidates.forEach((cand) => {
      if (!isValidIpv4(cand)) {
        const col = line.indexOf(cand);
        addDiag(
          diagnostics,
          i,
          col,
          cand.length,
          `"${cand}" is not a valid IPv4 address (octets must be 0–255).`,
          DiagnosticSeverity.Error,
        );
      }
    });
  });

  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

function addDiag(list, line, character, length, message, severity) {
  if (character < 0) character = 0;
  list.push({
    severity,
    range: {
      start: { line, character },
      end: { line, character: character + length },
    },
    message,
    source: 'cisco-ios-lsp',
  });
}

// Debounce validation per-document on change.
const debounceTimers = new Map();

function scheduleValidation(doc) {
  const prev = debounceTimers.get(doc.uri);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    doc.uri,
    setTimeout(() => {
      debounceTimers.delete(doc.uri);
      validate(doc);
    }, 300),
  );
}

documents.onDidChangeContent((e) => scheduleValidation(e.document));
documents.onDidClose((e) => {
  const t = debounceTimers.get(e.document.uri);
  if (t) clearTimeout(t);
  debounceTimers.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
