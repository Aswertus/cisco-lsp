'use strict';

// Document symbols (outline panel / breadcrumbs), served over LSP so any
// editor gets them. The categories and their SymbolKinds follow the outline
// originally adapted from Y-Ysss/vscode-cisco-config-highlight (MIT, see
// THIRD_PARTY_NOTICES.md), which lived client-side before; unlike that
// version, each block symbol spans its whole indented block (not just the
// header line), so breadcrumbs and sticky scroll track the enclosing block.
//
// `enabled` mirrors the cisco-ios-lsp.outline.symbolsList setting keys:
// command, ip_vrf, router_bgp, address_family, class_map, policy_map,
// interface, sub_interface (missing keys default to enabled).

const { SymbolKind } = require('vscode-languageserver/node');
const { leadingSpaces } = require('./indentation');

function isOn(enabled, key) {
  return enabled[key] !== false;
}

// Last line of the block opened at lines[headerIndex]: every following line
// that is blank/comment or more indented than the header belongs to it.
function blockEnd(lines, headerIndex) {
  const headerIndent = leadingSpaces(lines[headerIndex]);
  let end = headerIndex;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) continue;
    if (leadingSpaces(lines[i]) <= headerIndent) break;
    end = i;
  }
  return end;
}

function buildDocumentSymbols(lines, enabled) {
  const root = [];

  // Symbols group under the most recent prompt-command node when there is
  // one (pasted session transcripts), otherwise under the document root.
  let base = root;
  let containers = new Map(); // category name → container symbol in `base`
  let lastBgp = null;
  let interfaces = new Map(); // interface name → symbol, for sub-interfaces

  const makeSymbol = (name, detail, kind, startLine, endLine) => ({
    name,
    detail,
    kind,
    range: {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: (lines[endLine] || '').length },
    },
    selectionRange: {
      start: { line: startLine, character: 0 },
      end: { line: startLine, character: (lines[startLine] || '').length },
    },
    children: [],
  });

  // DocumentSymbol children must sit inside their parent's range; blocks that
  // belong together logically (bgp ↔ address-family, interface ↔
  // sub-interface, category containers) aren't always nested in the text, so
  // grow the parent to cover the child.
  const grow = (parent, range) => {
    if (
      range.end.line > parent.range.end.line ||
      (range.end.line === parent.range.end.line &&
        range.end.character > parent.range.end.character)
    ) {
      parent.range = { start: parent.range.start, end: range.end };
    }
  };

  const adopt = (parent, child) => {
    parent.children.push(child);
    grow(parent, child.range);
  };

  const container = (category, startLine, endLine) => {
    let node = containers.get(category);
    if (!node) {
      node = makeSymbol(category, '', SymbolKind.Namespace, startLine, endLine);
      containers.set(category, node);
      base.push(node);
    }
    return node;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!')) continue;

    // Prompt command (`hostname# command`): a new top-level group.
    const prompt = /^([0-9a-zA-Z-]+[#>])\s*(\S.*?)\s*$/.exec(line);
    if (prompt) {
      if (isOn(enabled, 'command')) {
        const node = makeSymbol(prompt[2], 'command', SymbolKind.Event, i, i);
        root.push(node);
        base = node.children;
        containers = new Map();
        lastBgp = null;
        interfaces = new Map();
      }
      continue;
    }

    let m;
    if ((m = /^[ \t]*interface[ \t]+(\S+)/i.exec(line))) {
      const name = m[1];
      const end = blockEnd(lines, i);
      const dot = name.indexOf('.');
      if (dot !== -1) {
        if (!isOn(enabled, 'sub_interface')) continue;
        const node = makeSymbol(name, 'sub-interface', SymbolKind.Interface, i, end);
        const parent = interfaces.get(name.slice(0, dot));
        if (parent) {
          adopt(parent, node);
          // The container holds the parent, so it must span the child too.
          grow(container('interface', i, end), node.range);
        } else {
          adopt(container('interface', i, end), node);
        }
      } else {
        if (!isOn(enabled, 'interface')) continue;
        const node = makeSymbol(name, 'interface', SymbolKind.Class, i, end);
        adopt(container('interface', i, end), node);
        interfaces.set(name, node);
      }
    } else if ((m = /^[ \t]*router[ \t]+bgp[ \t]+(\d+)/i.exec(line))) {
      if (!isOn(enabled, 'router_bgp')) continue;
      const end = blockEnd(lines, i);
      const node = makeSymbol(m[1], 'router bgp', SymbolKind.Class, i, end);
      adopt(container('router bgp', i, end), node);
      lastBgp = node;
    } else if ((m = /^[ \t]*address-family[ \t]+(\S.*?)\s*$/i.exec(line))) {
      if (!isOn(enabled, 'address_family')) continue;
      const end = blockEnd(lines, i);
      const node = makeSymbol(m[1], 'address-family', SymbolKind.Field, i, end);
      if (lastBgp) adopt(lastBgp, node);
      else adopt(container('router bgp', i, end), node);
    } else if ((m = /^[ \t]*ip[ \t]+vrf[ \t]+(?!forwarding\b)(\S.*?)\s*$/i.exec(line))) {
      if (!isOn(enabled, 'ip_vrf')) continue;
      const end = blockEnd(lines, i);
      adopt(container('ip_vrf', i, end), makeSymbol(m[1], 'ip vrf', SymbolKind.Field, i, end));
    } else if ((m = /^[ \t]*class-map[ \t]+(?:type\s+\S+\s+)?(?:match-(?:any|all)\s+)?(\S.*?)\s*$/i.exec(line))) {
      if (!isOn(enabled, 'class_map')) continue;
      const end = blockEnd(lines, i);
      adopt(
        container('class-map', i, end),
        makeSymbol(m[1], 'class-map', SymbolKind.Variable, i, end),
      );
    } else if ((m = /^[ \t]*policy-map[ \t]+(\S.*?)\s*$/i.exec(line))) {
      if (!isOn(enabled, 'policy_map')) continue;
      const end = blockEnd(lines, i);
      adopt(
        container('policy-map', i, end),
        makeSymbol(m[1], 'policy-map', SymbolKind.Variable, i, end),
      );
    }
  }

  return root;
}

module.exports = { buildDocumentSymbols };
