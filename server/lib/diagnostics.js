'use strict';

const { DiagnosticSeverity } = require('vscode-languageserver/node');
const { scanIndentation } = require('./indentation');

// Valid IOS-XE interface type names (lower-cased), incl. common abbreviations.
const VALID_INTERFACE_TYPES = new Set([
  'gigabitethernet',
  'gi',
  'gig',
  'fastethernet',
  'fa',
  'tengigabitethernet',
  'te',
  'ten',
  'twentyfivegige',
  'twe',
  'fortygigabitethernet',
  'fo',
  'fou',
  'hundredgige',
  'hu',
  'port-channel',
  'po',
  'tunnel',
  'tu',
  'loopback',
  'lo',
  'vlan',
  'bdi',
  'serial',
  'se',
  'ethernet',
  'eth',
  'e',
  'cellular',
  'async',
  'dialer',
  'virtual-template',
  'multilink',
  'pseudowire',
  'nve',
  'appgigabitethernet',
  // LISP virtual interfaces (SD-Access fabric), e.g. LISP0, LISP0.4097.
  'lisp',
  // Cat9k management Bluetooth port, e.g. Bluetooth0/4.
  'bluetooth',
]);

function isValidIpv4(addr) {
  const parts = addr.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
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

// All per-file checks in one scanIndentation traversal: indentation
// consistency, mixed tabs/spaces, flush-left block children (when
// `blockContext` provides the {openerBlockType, isChildCommand} predicates —
// see scanIndentation in lib/indentation.js), unknown top-level commands,
// interface type names, VLAN ranges, IPv4 shape. `knownTopLevel` comes from
// the loaded command data (see lib/data.js).
function computeDiagnostics(lines, knownTopLevel, blockContext = {}) {
  const diagnostics = [];

  scanIndentation(
    lines,
    (i, indent, expected) => {
      addDiag(
        diagnostics,
        i,
        0,
        indent,
        `Inconsistent indentation: this line uses ${indent} space(s), but sibling lines in this block use ${expected}.`,
        DiagnosticSeverity.Warning,
      );
    },
    (i, leadingLength) => {
      addDiag(
        diagnostics,
        i,
        0,
        leadingLength,
        'Indentation mixes tabs and spaces.',
        DiagnosticSeverity.Warning,
      );
    },
    (i, line, trimmed, indent, isFlushChild) => {
      const tokens = trimmed.split(/\s+/);
      const first = tokens[0].toLowerCase();

      // (1) Unknown top-level command (only flag column-0 commands —
      //     flush-left block children are sub-mode commands, not top-level,
      //     even though they physically sit at column 0).
      if (indent === 0 && !isFlushChild && !knownTopLevel.has(first)) {
        addDiag(
          diagnostics,
          i,
          0,
          tokens[0].length,
          `Unknown command "${tokens[0]}" — possible typo.`,
          DiagnosticSeverity.Warning,
        );
      }

      // (2) Invalid interface type name.
      if (first === 'interface' && tokens[1]) {
        const typeName = tokens[1].toLowerCase().match(/^[a-z-]+/)?.[0] || '';
        if (typeName && !VALID_INTERFACE_TYPES.has(typeName)) {
          // Search after the "interface" keyword so a type token that also
          // occurs earlier in the line can't shift the squiggle.
          const col = line.indexOf(tokens[1], indent + tokens[0].length);
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

      // (3) VLAN numbers out of range (1–4094). Matches every "vlan <n>" on
      //     the line (e.g. "switchport access vlan <n>"), positioned by the
      //     match itself rather than a first-occurrence string search.
      for (const m of line.matchAll(/\bvlan\s+(\d+)\b/gi)) {
        const n = Number(m[1]);
        if (n < 1 || n > 4094) {
          addDiag(
            diagnostics,
            i,
            m.index + m[0].length - m[1].length,
            m[1].length,
            `VLAN ${n} is out of range (must be 1–4094).`,
            DiagnosticSeverity.Error,
          );
        }
      }

      // (4) Malformed IPv4 addresses (basic dotted-quad shape but bad octet).
      for (const m of line.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) {
        if (!isValidIpv4(m[0])) {
          addDiag(
            diagnostics,
            i,
            m.index,
            m[0].length,
            `"${m[0]}" is not a valid IPv4 address (octets must be 0–255).`,
            DiagnosticSeverity.Error,
          );
        }
      }
    },
    {
      openerBlockType: blockContext.openerBlockType,
      isChildCommand: blockContext.isChildCommand,
      onMissingIndent: (i, indentLen, expectedIndent, header) => {
        addDiag(
          diagnostics,
          i,
          0,
          lines[i].replace(/\r$/, '').length,
          `Line belongs to the "${header}" block above but is not indented; expected ${expectedIndent} space(s).`,
          DiagnosticSeverity.Warning,
        );
      },
    },
  );

  return diagnostics;
}

module.exports = { VALID_INTERFACE_TYPES, isValidIpv4, computeDiagnostics };
