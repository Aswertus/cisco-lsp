'use strict';

const { leadingSpaces } = require('./indentation');

// Block-opening commands: a line matching one of these enters an IOS
// sub-mode whose children are indented under it. One entry per opener,
// `block` naming the bucket produced by classifyModesToBlocks() in
// lib/data.js (that pairing is what lets the flush-left indentation recovery
// ask "is this command valid inside this opener's block?").
//
// KEEP IN SYNC (by hand — the client bundle doesn't require this module)
// with `INCREASE_INDENT_PATTERN` in client/extension.js.
const BLOCK_OPENERS = [
  { prefix: 'interface ', block: 'interface' },
  { prefix: 'router ', block: 'router' },
  { prefix: 'class-map', block: 'class-map' },
  { prefix: 'policy-map', block: 'policy-map' },
  { prefix: 'line ', block: 'line' },
  { prefix: 'vrf definition ', block: 'vrf' },
  // Requires a digit: `vlan internal allocation policy ...`, `vlan dot1q ...`
  // are one-liners, not config-vlan mode.
  { regex: /^vlan \d/, block: 'vlan' },
  { prefix: 'flow record ', block: 'flow-record' },
  { prefix: 'flow exporter ', block: 'flow-exporter' },
  { prefix: 'flow monitor ', block: 'flow-monitor' },
  { prefix: 'service-template ', block: 'service-template' },
  { prefix: 'template ', block: 'template' },
  { prefix: 'route-map ', block: 'route-map' },
  { regex: /^ip access-list (standard|extended) /, block: 'access-list' },
  { prefix: 'ipv6 access-list ', block: 'access-list' },
  { prefix: 'aaa group server ', block: 'aaa-group' },
  { prefix: 'key chain ', block: 'key-chain' },
  { prefix: 'radius server ', block: 'radius-server' },
  { prefix: 'tacacs server ', block: 'tacacs-server' },
  { prefix: 'device-tracking policy ', block: 'device-tracking' },
  { prefix: 'crypto map ', block: 'crypto-map' },
  // Bare-word openers: anchored so one-liner variants can't match by prefix.
  { regex: /^call-home$/, block: 'call-home' },
  { regex: /^control-plane\b/, block: 'control-plane' },
  { prefix: 'crypto pki trustpoint ', block: 'pki-trustpoint' },
  { prefix: 'crypto pki certificate chain ', block: 'pki-cert-chain' },
  { prefix: 'telemetry ietf subscription ', block: 'telemetry-subscription' },
  { prefix: 'telemetry receiver protocol ', block: 'telemetry-receiver' },
  { prefix: 'telemetry transform ', block: 'telemetry-transform' },
  { prefix: 'transceiver type ', block: 'transceiver' },
  { prefix: 'aaa server radius dynamic-author', block: 'radius-da' },
];

// The block bucket a line opens, or null if it opens none. Accepts any
// casing; expects the line already trimmed.
function openerBlockType(line) {
  const header = line.toLowerCase();
  for (const opener of BLOCK_OPENERS) {
    if (opener.prefix ? header.startsWith(opener.prefix) : opener.regex.test(header)) {
      return opener.block;
    }
  }
  return null;
}

function classifyHeader(header) {
  return openerBlockType(header);
}

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

module.exports = { classifyHeader, openerBlockType, detectBlock };
