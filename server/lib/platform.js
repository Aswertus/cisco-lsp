'use strict';

const { DiagnosticSeverity } = require('vscode-languageserver/node');
const { createFreeTextTracker } = require('./freetext');

// Platform selection — which platform family and release a config is for, so
// later layers can narrow command data to the packs that apply. Two sources:
//
// 1. A `!!#` directive comment, always authoritative (first valid one wins):
//      !!# cisco-ios-lsp platform <family> [<release>]
//    Family and release are matched case-insensitively; trailing words are
//    ignored; whitespace after `!!#` is optional. `!!#` is an ordinary IOS comment (`!` lines), so a config with
//    the directive still loads on a device.
//
// 2. Otherwise the config's own `version X.Y` line (column 0, outside banners
//    and certificate payloads). The major picks the family when exactly one
//    family has a pack for it (15 → cat2960x, 16 → cat3850, 17 → cat9500);
//    two families sharing a major yield the union, an unknown major nothing.
//
// The family rule is deliberately lenient: any family with a pack counts, and
// unknown names are reported rather than guessed, so a typo never silently
// narrows the data to the wrong platform. Pack ids look like `<family>-<release>`
// (`cat9500-17.15`, `cat9500-26.x`, `cat2960x-15.2.6`); curated records
// (pack: null) belong to no platform and are never indexed here.

// Families whose commands are covered by another family's manual.
const FAMILY_ALIASES = {
  cat9k: 'cat9500',
  cat9200: 'cat9500',
  cat9300: 'cat9500',
  cat9400: 'cat9500',
  cat9600: 'cat9500',
};

function packFamily(packId) {
  return packId.slice(0, packId.lastIndexOf('-'));
}

function releaseLabel(packId) {
  return packId.slice(packId.lastIndexOf('-') + 1);
}

// Digits of the release suffix up to the first `x` or `(`.
function packRelease(packId) {
  return parseDigits(releaseLabel(packId)) || [];
}

function parseDigits(word) {
  const m = /^\d+(?:\.\d+)*/.exec(word);
  return m ? m[0].split('.').map(Number) : null;
}

function compareRelease(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function buildPackIndex(records) {
  const families = new Map();
  const packs = new Map();
  for (const r of records) {
    if (!r.pack) continue;
    let pack = packs.get(r.pack);
    if (!pack) {
      pack = {
        id: r.pack,
        family: packFamily(r.pack),
        release: packRelease(r.pack),
        label: releaseLabel(r.pack),
        platform: r.platform,
      };
      packs.set(r.pack, pack);
      if (!families.has(pack.family)) families.set(pack.family, []);
      families.get(pack.family).push(pack);
    }
  }
  for (const list of families.values()) list.sort((a, b) => compareRelease(a.release, b.release));
  return { families, packs };
}

function resolveFamily(word, index) {
  const w = word.toLowerCase();
  const family = FAMILY_ALIASES[w] || w;
  return index.families.has(family) ? family : null;
}

function parseVersionLine(line) {
  const m = /^version\s+(\d+)\.(\d+)/.exec(line);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const DIRECTIVE_RE = /^!!#\s*cisco-ios-lsp(?=\s|$)/i;
// A release word must be a whole version — `17.18`, `15.2.6`, `26.x` or the
// IOS form `15.2(6)E` — so `17-18` or `latest` is reported, not half-read.
const RELEASE_WORD_RE = /^\d+(\.\d+)*(\.x|\(\d+\)[a-z0-9]*)?$/i;

// null → not a directive; otherwise the parsed words (ranges are columns in
// `line`). The family is resolved by the caller, which has the pack index.
function parseDirective(line) {
  const trimmed = line.trim();
  const m = DIRECTIVE_RE.exec(trimmed);
  if (!m) return null;
  const offset = line.indexOf(trimmed);
  const end = offset + trimmed.length;
  const words = [];
  const wordRe = /\S+/g;
  wordRe.lastIndex = m[0].length;
  let w;
  while ((w = wordRe.exec(trimmed))) {
    words.push({ text: w[0], start: offset + w.index, end: offset + w.index + w[0].length });
  }
  if (words.length < 2 || words[0].text.toLowerCase() !== 'platform') {
    // Nothing follows `platform` (or the prefix): point at the line end.
    const bare =
      words.length === 0 || (words.length === 1 && words[0].text.toLowerCase() === 'platform');
    return { ok: false, reason: 'syntax', range: [bare ? end : words[0].start, end] };
  }
  const family = words[1];
  const release = words[2] || null;
  return {
    ok: true,
    familyWord: family.text,
    releaseWord: release ? release.text : null,
    release: release && RELEASE_WORD_RE.test(release.text) ? parseDigits(release.text) : null,
    familyRange: [family.start, family.end],
    releaseRange: release ? [release.start, release.end] : null,
  };
}

function diag(line, start, end, message, severity) {
  return {
    severity,
    range: { start: { line, character: start }, end: { line, character: end } },
    message,
    source: 'cisco-ios-lsp',
  };
}

function detectPlatform(lines, index) {
  const isFreeTextLine = createFreeTextTracker();
  const diagnostics = [];
  let directive = null;
  let version = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isFreeTextLine(line, trimmed)) continue;
    const d = parseDirective(line);
    if (d) {
      const start = line.indexOf(trimmed);
      const end = start + trimmed.length;
      const family = d.ok ? resolveFamily(d.familyWord, index) : null;
      if (directive) {
        diagnostics.push(
          diag(
            i,
            start,
            end,
            `Platform already set on line ${directive.line + 1}`,
            DiagnosticSeverity.Information,
          ),
        );
      } else if (family) {
        directive = { family, release: d.release, line: i };
        // A release word that isn't a version (`17-18`, `latest`) would
        // silently select the family's newest pack — say so instead.
        if (d.releaseWord && !d.release) {
          diagnostics.push(
            diag(
              i,
              d.releaseRange[0],
              d.releaseRange[1],
              `"${d.releaseWord}" is not a release like 17.18 — using the newest ${family} reference`,
              DiagnosticSeverity.Warning,
            ),
          );
        }
      } else if (d.ok) {
        const known = [...index.families.keys()].sort().join(', ');
        const aliases = Object.keys(FAMILY_ALIASES).join(', ');
        diagnostics.push(
          diag(
            i,
            d.familyRange[0],
            d.familyRange[1],
            `Unknown platform "${d.familyWord}" — known: ${known} (aliases: ${aliases})`,
            DiagnosticSeverity.Warning,
          ),
        );
      } else {
        diagnostics.push(
          diag(
            i,
            d.range[0],
            d.range[1],
            'Expected `!!# cisco-ios-lsp platform <family> [<release>]`',
            DiagnosticSeverity.Warning,
          ),
        );
      }
    } else if (!version && line.length && line === line.trimStart()) {
      const release = parseVersionLine(line);
      if (release) version = { release, line: i };
    }
  }
  if (directive) {
    return { ...directive, source: 'directive', diagnostics };
  }
  if (version) {
    const names = [...index.families]
      .filter(([, packs]) => packs.some((p) => p.release[0] === version.release[0]))
      .map(([name]) => name)
      .sort();
    if (names.length) {
      return {
        family: names.length === 1 ? names[0] : names,
        release: version.release,
        source: 'version',
        line: version.line,
        diagnostics,
      };
    }
    return { family: null, release: version.release, source: null, line: null, diagnostics };
  }
  return { family: null, release: null, source: null, line: null, diagnostics };
}

function selectPacks(index, family, release) {
  const names = Array.isArray(family) ? family : [family];
  const familyPacks = new Set();
  for (const name of names) for (const p of index.families.get(name) || []) familyPacks.add(p.id);
  const packs = index.families.get(names[0]) || [];
  let preferred = null;
  if (packs.length) {
    const fits = release ? packs.filter((p) => compareRelease(p.release, release) <= 0) : packs;
    preferred = fits.length ? fits[fits.length - 1] : packs[0];
  }
  return { familyPacks, preferredPack: preferred ? preferred.id : null };
}

// Candidates for the word being typed in a `!!#` directive; `prefix` is the
// line up to the cursor. The client filters by the partial word.
function completeDirective(prefix, index) {
  const m = /^\s*!!#/.exec(prefix);
  if (!m) return null;
  const rest = prefix.slice(m[0].length);
  const words = [];
  const wordRe = /\S+/g;
  let w;
  while ((w = wordRe.exec(rest)))
    words.push({ text: w[0].toLowerCase(), start: m[0].length + w.index });
  const typing = rest.length > 0 && !/\s$/.test(rest) && words.length > 0;
  const done = typing ? words.slice(0, -1) : words;
  const tokenStart = typing ? words[words.length - 1].start : prefix.length;
  const latest = (family) => index.families.get(family).at(-1).platform || '';
  let items = [];
  if (done.length === 0) {
    // Right after a bare `!!#` write the canonical spaced form.
    const item = { label: 'cisco-ios-lsp', detail: 'directive' };
    if (/!!#$/.test(prefix)) item.insertText = ' cisco-ios-lsp';
    items = [item];
  } else if (done[0].text === 'cisco-ios-lsp') {
    if (done.length === 1) {
      items = [{ label: 'platform', detail: 'select the platform' }];
    } else if (done[1].text === 'platform' && done.length === 2) {
      for (const f of [...index.families.keys()].sort()) {
        items.push({ label: f, detail: latest(f) });
      }
      for (const [alias, target] of Object.entries(FAMILY_ALIASES)) {
        if (index.families.has(target)) items.push({ label: alias, detail: `→ ${target}` });
      }
    } else if (done[1].text === 'platform' && done.length === 3) {
      const family = resolveFamily(done[2].text, index);
      if (family) {
        items = index.families
          .get(family)
          .map((p) => ({ label: p.label, detail: p.platform || '' }));
      }
    }
  }
  return { items, tokenStart };
}

module.exports = {
  FAMILY_ALIASES,
  packFamily,
  packRelease,
  releaseLabel,
  compareRelease,
  buildPackIndex,
  resolveFamily,
  parseVersionLine,
  parseDirective,
  detectPlatform,
  selectPacks,
  completeDirective,
};
