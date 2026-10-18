'use strict';

// Builds the hover/completion-resolve documentation for one or more command
// records sharing a name (duplicates are shown together, labeled by
// platform/release when more than one is loaded, rather than picking one
// arbitrarily and hiding the rest).
function buildDocMarkdown(records, { labelled = records.length > 1, footer } = {}) {
  const blocks = records.map((r) => {
    const parts = [];
    const syntaxLines = [r.syntax, r.noForm].filter(Boolean).join('\n');
    if (syntaxLines) parts.push('```\n' + syntaxLines + '\n```');
    if (r.params && r.params.length) {
      parts.push(r.params.map((p) => `- **${p.name}** — ${p.description}`).join('\n'));
    }
    if (r.usageSummary) parts.push(r.usageSummary);
    let block = parts.join('\n\n');
    if (labelled) {
      const label = [r.platform, r.release].filter(Boolean).join(' ') || r.context || r.source;
      if (label) block = `**${label}**\n\n${block}`;
    }
    return block;
  });
  const md = blocks.join('\n\n---\n\n');
  return footer ? `${md}\n\n---\n\n${footer}` : md;
}

// Narrows hover records to the selected platform: the preferred pack's records
// (plus curated ones, `pack: null`) unlabelled; else the family's; else all,
// labelled. Without a selection nothing is filtered (today's behaviour).
function orderHoverRecords(records, { familyPacks, preferredPack }) {
  if (!familyPacks) return { records, labelled: records.length > 1 };
  const own = records.filter((r) => r.pack == null || r.pack === preferredPack);
  if (own.length) return { records: own, labelled: false };
  const fam = records.filter((r) => familyPacks.has(r.pack));
  if (fam.length) return { records: fam, labelled: true };
  return { records, labelled: true };
}

// One-line hover footer naming the platform in effect and where it came from.
function platformFooter(platform, index, preferredPack) {
  const pack = index.packs.get(preferredPack);
  const how = platform.source === 'directive' ? 'the `!!#` directive' : 'the version line';
  return `_Platform: ${pack.platform} ${pack.label} — from ${how}_`;
}

// Longest-prefix lookup: the longest leading token sequence that names a
// known command wins (so hovering anywhere on `switchport access vlan 10`
// finds `switchport access vlan`, not `switchport`).
function findHoverRecords(tokens, { commandsByName, maxCommandWords }) {
  for (let n = Math.min(tokens.length, maxCommandWords); n >= 1; n--) {
    const records = commandsByName.get(tokens.slice(0, n).join(' '));
    if (records) return records;
  }
  return null;
}

module.exports = { buildDocMarkdown, findHoverRecords, orderHoverRecords, platformFooter };
