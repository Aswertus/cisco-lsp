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
const { createFreeTextTracker } = require('./freetext');
const { findPlaceholders, overlapsPlaceholder } = require('./placeholders');

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
    defs: [
      /^ip(?:v6)?\s+prefix-list\s+(\S+)/i,
      // LISP prefix-list block opener inside `router lisp` — the whole
      // (indented) line is just `prefix-list NAME`.
      /^\s*prefix-list\s+(\S+)$/i,
    ],
    refs: [/\bprefix-list\s+(\S+)/gi],
  },
  {
    kind: 'access-list',
    defs: [/^ip\s+access-list\s+(?:standard|extended)\s+(\S+)/i, /^access-list\s+(\d+)/i],
    refs: [
      // Direction (in/out) follows the name in IOS: `ip access-group ACL in`.
      // `ntp access-group` is excluded: its next token is a keyword
      // (peer/serve/...), handled by the dedicated pattern below.
      /(?<!ntp )\baccess-group\s+(\S+)/gi,
      /\bntp\s+access-group\s+(?:ipv4\s+|ipv6\s+)?(?:peer|serve-only|serve|query-only)\s+(\S+)/gi,
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

// `m` matched the masked line (same columns); the name is read from the
// original line so masking never leaks into names, rename edits or messages.
function nameSpan(m, line) {
  const startChar = m.index + m[0].length - m[1].length;
  const endChar = startChar + m[1].length;
  return { name: line.slice(startChar, endChar), startChar, endChar };
}

// Jinja expressions may contain spaces (`service-policy output {{ policy_name }}`):
// mask their inner whitespace, column-preserving, so `(\S+)` captures the
// whole expression as one name instead of just `{{`.
const maskTemplateExpressions = (line) =>
  line.replace(/\{\{.*?\}\}/g, (m) => m.replace(/\s/g, '\u0001'));

// Returns:
//   objects     — Map "<kind>\0<name>" → { kind, name, defs: [span], refs: [span],
//                 placeholder } (span = { line, startChar, endChar }; placeholder:
//                 the name is a template placeholder — see lib/placeholders.js)
//   occurrences — flat list of { kind, name, line, startChar, endChar, isDef }
//                 for position lookup
// options.placeholderFill: the fill characters setting (default "X").
function buildXrefIndex(lines, options = {}) {
  const objects = new Map();
  const occurrences = [];
  const placeholders = findPlaceholders(lines, options.placeholderFill);

  const record = (kind, span, lineNo, isDef) => {
    const key = `${kind} ${span.name}`;
    let obj = objects.get(key);
    if (!obj) {
      obj = { kind, name: span.name, defs: [], refs: [], placeholder: false };
      objects.set(key, obj);
    }
    const entry = { line: lineNo, startChar: span.startChar, endChar: span.endChar };
    (isDef ? obj.defs : obj.refs).push(entry);
    occurrences.push({ kind, name: span.name, isDef, ...entry });
    if (
      overlapsPlaceholder(placeholders, {
        start: { line: lineNo, character: span.startChar },
        end: { line: lineNo, character: span.endChar },
      })
    ) {
      obj.placeholder = true;
    }
  };

  const isFreeTextLine = createFreeTextTracker();

  lines.forEach((raw, lineNo) => {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    // Free text (banner bodies, certificate payloads) must not create refs
    // (a banner mentioning "access-group X" is prose, not config).
    if (isFreeTextLine(line, trimmed)) return;
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;
    const masked = maskTemplateExpressions(line);

    for (const { kind, defs, refs } of KINDS) {
      // Multi-line definitions (route-map blocks, prefix-list/access-list
      // entry lines) legitimately repeat — every one counts as a def site.
      const defSpans = [];
      for (const defRe of defs) {
        const m = defRe.exec(masked);
        if (m) {
          const span = nameSpan(m, line);
          defSpans.push(span.startChar);
          record(kind, span, lineNo, true);
        }
      }
      for (const refRe of refs) {
        for (const m of masked.matchAll(refRe)) {
          const span = nameSpan(m, line);
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
// first definition line only. Placeholder names (RM-XXX, <POLICY>,
// {{ policy_name }}) are still linked for F12/rename but never reported:
// whether they are defined is decided when the template is filled in.
function computeXrefDiagnostics(index) {
  const diagnostics = [];
  for (const obj of index.objects.values()) {
    if (obj.placeholder) continue;
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
