'use strict';

const { leadingSpaces } = require('./indentation');

function classifyHeader(header) {
  if (header.startsWith('interface ')) return 'interface';
  if (header.startsWith('router ')) return 'router';
  if (header.startsWith('class-map')) return 'class-map';
  if (header.startsWith('policy-map')) return 'policy-map';
  if (header.startsWith('line ')) return 'line';
  return null;
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

module.exports = { classifyHeader, detectBlock };
