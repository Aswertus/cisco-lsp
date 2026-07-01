'use strict';

// Indentation analysis shared by the diagnostics (lib/diagnostics.js) and the
// documentFormatting handler, so the linter and the formatter can never
// disagree about what's wrong with a file's indentation.

function leadingSpaces(s) {
  const m = s.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

// onSiblingMismatch(lineIndex, indent, expectedIndent) — a non-blank/!/#
// line's indent disagrees with the indent its prior siblings under the same
// parent line already established, using indentation depth alone (not a
// keyword whitelist like `classifyHeader`) so it works for any IOS
// block-opening command, not just the interface/router/class-map/policy-map/
// line subset `classifyHeader` recognizes. A line that is *deeper* than the
// line before it is always accepted as the start of a new nested level
// (mirrors how Python's INDENT token works) — this only catches a later
// sibling disagreeing with the level its prior siblings already established.
//
// onMixedTabsSpaces(lineIndex, leadingLength) — leading whitespace mixing
// tabs and spaces, regardless of structural position. Cisco IOS config
// output never intentionally uses tabs for indentation, so any mix is a
// reliable signal of accidental/corrupted formatting. Runs on every line,
// including blank/comment ones, since it doesn't depend on block structure.
//
// A line flagged mixed-tabs is excluded from the sibling-mismatch check:
// its indentation can't be trusted to reflect deliberate depth (that's
// exactly why depth-comparison alone misses tab corruption in the first
// place — a tab always reads as "one char deeper," so it's silently
// accepted as valid new nesting rather than compared to siblings), and
// letting both fire would hand the formatter two conflicting edits over the
// same range.
//
// onLine(lineIndex, line, trimmed, indent) — optional extra callback invoked
// for every non-blank/!/# line, so callers with additional per-line checks
// (computeDiagnostics()'s command/VLAN/IP checks) can share this single
// traversal instead of re-splitting and re-scanning the same lines again.
function scanIndentation(lines, onSiblingMismatch, onMixedTabsSpaces, onLine) {
  const stack = [{ indent: -1, childIndent: null }]; // sentinel: true column-0 scope

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const leading = line.match(/^[ \t]*/)[0];
    const isMixed = leading.includes(' ') && leading.includes('\t');
    if (isMixed) {
      onMixedTabsSpaces(i, leading.length);
    }

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;

    const indent = leadingSpaces(line);
    if (onLine) onLine(i, line, trimmed, indent);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (indent > parent.indent) {
      if (parent.childIndent === null) {
        parent.childIndent = indent;
      } else if (indent !== parent.childIndent && !isMixed) {
        onSiblingMismatch(i, indent, parent.childIndent);
      }
      stack.push({ indent, childIndent: null });
    }
  });
}

// Fixes exactly what computeDiagnostics' indentation checks flag — nothing
// more. A file that's already internally consistent produces no edits, even
// if it uses a different indent width than IOS's native 1-space-per-level
// convention. Returns LSP TextEdits.
function computeFormattingEdits(lines) {
  const edits = [];
  scanIndentation(
    lines,
    (i, indent, expected) => {
      edits.push({
        range: { start: { line: i, character: 0 }, end: { line: i, character: indent } },
        newText: ' '.repeat(expected),
      });
    },
    (i, leadingLength) => {
      edits.push({
        range: { start: { line: i, character: 0 }, end: { line: i, character: leadingLength } },
        newText: ' '.repeat(leadingLength),
      });
    },
  );
  return edits;
}

// Folding ranges from indentation: every line followed by deeper-indented
// content opens a foldable block ending at its last such line. Blank and
// !/# comment lines neither open nor close blocks (IOS uses `!` between
// blocks), so a block folds across them but never ends on one.
function computeFoldingRanges(lines) {
  const ranges = [];
  const stack = []; // open blocks: { indent, startLine, lastContentLine }

  const close = (block) => {
    if (block.lastContentLine > block.startLine) {
      ranges.push({ startLine: block.startLine, endLine: block.lastContentLine });
    }
  };

  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;
    const indent = leadingSpaces(raw);
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      close(stack.pop());
    }
    for (const open of stack) open.lastContentLine = i;
    stack.push({ indent, startLine: i, lastContentLine: i });
  });
  while (stack.length) close(stack.pop());

  return ranges;
}

module.exports = { leadingSpaces, scanIndentation, computeFormattingEdits, computeFoldingRanges };
