'use strict';

// Cross-reference index for named IOS objects: where each class-map /
// policy-map / ACL / route-map / prefix-list / VRF is defined (column-0
// header lines) and where it is referenced (service-policy, access-group,
// match ..., vrf forwarding, ...). Powers go-to-definition, find-references,
// rename, and the undefined/unused diagnostics.
//
// All patterns capture the object name as their LAST group at the END of the
// match, so the name's column is always m.index + m[0].length - name.length.

const { DiagnosticSeverity } = require('vscode-languageserver/node');

const KINDS = [
  {
    kind: 'class-map',
    defs: [/^class-map\s+(?:type\s+\S+\s+)?(?:match-(?:any|all)\s+)?(\S+)/i],
    refs: [
      // `class NAME` inside a policy-map (class-default is built in).
      /^\s+class\s+(?:type\s+\S+\s+)?(?!class-default\b)(\S+)/gi,
      /\bmatch\s+class-map\s+(\S+)/gi,
    ],
  },
  {
    kind: 'policy-map',
    defs: [/^policy-map\s+(?:type\s+\S+\s+)?(\S+)/i],
    refs: [/\bservice-policy\s+(?:type\s+\S+\s+)?(?:(?:input|output)\s+)?(\S+)/gi],
  },
  {
    kind: 'route-map',
    defs: [/^route-map\s+(\S+)/i],
    refs: [/\broute-map\s+(\S+)/gi],
  },
  {
    kind: 'prefix-list',
    defs: [/^ip(?:v6)?\s+prefix-list\s+(\S+)/i],
    refs: [/\bprefix-list\s+(\S+)/gi],
  },
  {
    kind: 'access-list',
    defs: [/^ip\s+access-list\s+(?:standard|extended)\s+(\S+)/i, /^access-list\s+(\d+)/i],
    refs: [
      // Direction (in/out) follows the name in IOS: `ip access-group ACL in`.
      /\baccess-group\s+(\S+)/gi,
      /\baccess-class\s+(\S+)/gi,
      // `match ip address NAME` names an ACL; `... prefix-list NAME` is
      // handled by the prefix-list kind above.
      /\bmatch\s+ip\s+address\s+(?!prefix-list\b)(\S+)/gi,
    ],
  },
  {
    kind: 'vrf',
    defs: [/^(?:vrf\s+definition|ip\s+vrf(?!\s+forwarding\b))\s+(\S+)/i],
    refs: [/\bvrf\s+forwarding\s+(\S+)/gi, /\baddress-family\s+\S+\s+vrf\s+(\S+)/gi],
  },
];

function nameSpan(m) {
  const name = m[1];
  const startChar = m.index + m[0].length - name.length;
  return { name, startChar, endChar: startChar + name.length };
}

// Returns:
//   objects     — Map "<kind>\0<name>" → { kind, name, defs: [span], refs: [span] }
//                 (span = { line, startChar, endChar })
//   occurrences — flat list of { kind, name, line, startChar, endChar, isDef }
//                 for position lookup
function buildXrefIndex(lines) {
  const objects = new Map();
  const occurrences = [];

  const record = (kind, span, lineNo, isDef) => {
    const key = `${kind} ${span.name}`;
    let obj = objects.get(key);
    if (!obj) {
      obj = { kind, name: span.name, defs: [], refs: [] };
      objects.set(key, obj);
    }
    const entry = { line: lineNo, startChar: span.startChar, endChar: span.endChar };
    (isDef ? obj.defs : obj.refs).push(entry);
    occurrences.push({ kind, name: span.name, isDef, ...entry });
  };

  lines.forEach((raw, lineNo) => {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;

    for (const { kind, defs, refs } of KINDS) {
      // Multi-line definitions (route-map blocks, prefix-list/access-list
      // entry lines) legitimately repeat — every one counts as a def site.
      const defSpans = [];
      for (const defRe of defs) {
        const m = defRe.exec(line);
        if (m) {
          const span = nameSpan(m);
          defSpans.push(span.startChar);
          record(kind, span, lineNo, true);
        }
      }
      for (const refRe of refs) {
        for (const m of line.matchAll(refRe)) {
          const span = nameSpan(m);
          // A ref pattern re-matching the def already recorded on this line
          // (e.g. /route-map (\S+)/ on a `route-map RM permit 10` header).
          if (defSpans.includes(span.startChar)) continue;
          record(kind, span, lineNo, false);
        }
      }
    }
  });

  return { objects, occurrences };
}

// The occurrence whose name span contains the given position, or null.
function findAtPosition(index, line, character) {
  return (
    index.occurrences.find(
      (o) => o.line === line && character >= o.startChar && character <= o.endChar,
    ) || null
  );
}

// Warnings for references to names never defined in this file, hints for
// definitions never referenced. Partial configs are common, so undefined
// refs stay Warning (not Error) and unused defs are a low-key Hint on the
// first definition line only.
function computeXrefDiagnostics(index) {
  const diagnostics = [];
  for (const obj of index.objects.values()) {
    if (obj.defs.length === 0) {
      for (const ref of obj.refs) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: ref.line, character: ref.startChar },
            end: { line: ref.line, character: ref.endChar },
          },
          message: `${obj.kind} "${obj.name}" is referenced but never defined in this file.`,
          source: 'cisco-ios-lsp',
        });
      }
    } else if (obj.refs.length === 0) {
      const def = obj.defs[0];
      diagnostics.push({
        severity: DiagnosticSeverity.Hint,
        range: {
          start: { line: def.line, character: def.startChar },
          end: { line: def.line, character: def.endChar },
        },
        message: `${obj.kind} "${obj.name}" is defined but never referenced in this file.`,
        source: 'cisco-ios-lsp',
      });
    }
  }
  return diagnostics;
}

module.exports = { buildXrefIndex, findAtPosition, computeXrefDiagnostics };
