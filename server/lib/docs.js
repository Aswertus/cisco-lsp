'use strict';

// Builds the hover/completion-resolve documentation for one or more command
// records sharing a name (duplicates are shown together, labeled by
// platform/release when more than one is loaded, rather than picking one
// arbitrarily and hiding the rest).
function buildDocMarkdown(records) {
  const blocks = records.map((r) => {
    const parts = [];
    const syntaxLines = [r.syntax, r.noForm].filter(Boolean).join('\n');
    if (syntaxLines) parts.push('```\n' + syntaxLines + '\n```');
    if (r.params && r.params.length) {
      parts.push(r.params.map((p) => `- **${p.name}** — ${p.description}`).join('\n'));
    }
    if (r.usageSummary) parts.push(r.usageSummary);
    let block = parts.join('\n\n');
    if (records.length > 1) {
      const label = [r.platform, r.release].filter(Boolean).join(' ') || r.context || r.source;
      if (label) block = `**${label}**\n\n${block}`;
    }
    return block;
  });
  return blocks.join('\n\n---\n\n');
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

module.exports = { buildDocMarkdown, findHoverRecords };
