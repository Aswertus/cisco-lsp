'use strict';

const vscode = require('vscode');

// Ported from Y-Ysss/vscode-cisco-config-highlight (src/symbolsInfo.ts), MIT licensed.
// See THIRD_PARTY_NOTICES.md.
const symbolsInfo = {
  command: {
    pattern: /^(?!\s)[0-9a-zA-Z-]+(?:(#|>))(?!.*(#|>|\s)$)/,
    kind: vscode.SymbolKind.String,
    parent_kind: vscode.SymbolKind.Event,
    category_name: 'command',
    detail: 'command',
    item_pattern: /.*$/,
  },
  ip_vrf: {
    pattern: /^[ \t]*ip\svrf(?!\sforwarding)[ \t]/,
    kind: vscode.SymbolKind.Field,
    category_name: 'ip_vrf',
    detail: 'ip vrf',
    item_pattern: /.*$/,
  },
  router_bgp: {
    pattern: /^[ \t]*router\sbgp[ \t]/,
    kind: vscode.SymbolKind.Class,
    category_name: 'router bgp',
    detail: 'router bgp',
    item_pattern: /\d*$/,
  },
  address_family: {
    pattern: /^[ \t]*(address-family)[ \t]/,
    kind: vscode.SymbolKind.Field,
    category_name: 'router bgp',
    parent_name: '.*',
    detail: 'address-family',
    item_pattern: /.*$/,
  },
  class_map: {
    pattern: /^[ \t]*(class-map)[ \t]/,
    kind: vscode.SymbolKind.Variable,
    category_name: 'class-map',
    detail: 'class-map',
    item_pattern: /.*$/,
  },
  policy_map: {
    pattern: /^[ \t]*(policy-map)[ \t]/,
    kind: vscode.SymbolKind.Variable,
    category_name: 'policy-map',
    detail: 'policy-map',
    item_pattern: /.*$/,
  },
  interface: {
    pattern: /^[ \t]*(interface)[ \t]/,
    kind: vscode.SymbolKind.Class,
    category_name: 'interface',
    detail: 'interface',
    item_pattern: /[^.]*$/,
  },
  sub_interface: {
    pattern: /^[ \t]*(interface)[ \t]/,
    kind: vscode.SymbolKind.Interface,
    category_name: 'interface',
    parent_name: '.+.',
    detail: 'sub-interface',
    item_pattern: /.*\..*$/,
  },
};

module.exports = { symbolsInfo };
