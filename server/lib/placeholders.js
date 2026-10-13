'use strict';

// Template placeholders in config templates — values still to be filled in
// before the config is deployed:
//   <NAME>, $VAR / ${VAR}, Jinja {{ expr }} / {% stmt %} / {# comment #},
//   and runs of the user's fill characters (setting
//   cisco-ios-lsp.placeholders.fillCharacters, default "X"): VlanXX,
//   10.10.X.1, X.X.X.X.
//
// A placeholder's range covers the whole argument it sits in (up to the
// neighbouring whitespace), so `10.10.X.1` is one placeholder, not its `X`.
// Lines that are a Jinja statement or comment are covered whole. `!` comment
// lines are skipped. Shared by the client (highlighting) and the server
// (hover note, suppressing diagnostics on placeholders) — pure, no deps.

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const regexCache = new Map();

function placeholderRegex(fill = 'X') {
  if (regexCache.has(fill)) return regexCache.get(fill);
  const parts = [
    '\\{\\{.*?\\}\\}',
    '\\{%.*?%\\}',
    '\\{#.*?#\\}',
    '<[^<>\\s]+>',
    // $VAR / ${VAR} — not inside IOS password hashes like $9$salt$hash.
    '(?<![\\w$])\\$\\{[A-Za-z_]\\w*\\}',
    '(?<![\\w$])\\$[A-Za-z_]\\w*',
  ];
  for (const ch of new Set(String(fill).replace(/\s/g, ''))) {
    if (/[a-z]/i.test(ch)) {
      const up = reEscape(ch.toUpperCase());
      const lo = reEscape(ch.toLowerCase());
      // Single capital not glued to a letter/digit before it: Gi1/0/X, 10.10.X.1
      // (but not dot1X / 802.1X).
      parts.push(`(?<![A-Za-z0-9])${up}(?![A-Za-z])`);
      // Single lower-case letter only in address context (next to . / :):
      // x.x.x.x — not the "x" in dot1x or in "2 x 10G".
      parts.push(`(?<![A-Za-z0-9])${lo}(?=[./:])|(?<=[./:])${lo}(?![A-Za-z0-9])`);
      parts.push(`(?<![A-Z])${up}{2,}(?![A-Z])`); // XX.. not touching other capitals: VlanXX
    } else {
      parts.push(`${reEscape(ch)}+`); // symbols: any run (Vlan##)
    }
  }
  const re = new RegExp(parts.join('|'), 'g');
  regexCache.set(fill, re);
  return re;
}

// [{ line, startChar, endChar, text }] for every placeholder in `lines`.
function findPlaceholders(lines, fill = 'X') {
  const re = placeholderRegex(fill);
  const found = [];
  lines.forEach((text, line) => {
    if (/^\s*!/.test(text)) return;
    const statement = text.match(/^(\s*)(\{[%#].*)$/);
    if (statement) {
      const start = statement[1].length;
      const end = text.trimEnd().length;
      found.push({ line, startChar: start, endChar: end, text: text.slice(start, end) });
      return;
    }
    let last = null;
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      let start = m.index;
      let end = m.index + m[0].length;
      while (start > 0 && !/\s/.test(text[start - 1])) start--;
      while (end < text.length && !/\s/.test(text[end])) end++;
      // IOS secret hashes ($9$salt$hash, $14$...) are random characters that
      // can contain "$Ab..." or "XX" — never a placeholder.
      if (/^\$\d+\$/.test(text.slice(start, end))) continue;
      if (last && start <= last.endChar) {
        last.endChar = Math.max(last.endChar, end);
        last.text = text.slice(last.startChar, last.endChar);
      } else {
        last = { line, startChar: start, endChar: end, text: text.slice(start, end) };
        found.push(last);
      }
    }
  });
  return found;
}

// The placeholder under a cursor position (inclusive of its end, like VS Code
// hover), or null.
function placeholderAt(found, line, character) {
  return (
    found.find((p) => p.line === line && character >= p.startChar && character <= p.endChar) ?? null
  );
}

// Whether an LSP range (single- or multi-line) touches any placeholder.
function overlapsPlaceholder(found, range) {
  return found.some((p) => {
    if (p.line < range.start.line || p.line > range.end.line) return false;
    const from = p.line === range.start.line ? range.start.character : 0;
    const to = p.line === range.end.line ? range.end.character : Infinity;
    return p.startChar < to && from < p.endChar;
  });
}

module.exports = { placeholderRegex, findPlaceholders, placeholderAt, overlapsPlaceholder };
