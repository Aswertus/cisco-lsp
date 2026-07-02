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
// onLine(lineIndex, line, trimmed, indent, isFlushChild) — optional extra
// callback invoked for every non-blank/!/# line, so callers with additional
// per-line checks (computeDiagnostics()'s command/VLAN/IP checks) can share
// this single traversal instead of re-splitting and re-scanning the same
// lines again. `isFlushChild` is true for lines the flush-left recovery
// (below) identified as un-indented block children — they are NOT top-level
// lines even though their physical indent says so.
//
// options.{openerBlockType, isChildCommand, onMissingIndent} — all three
// together enable flush-left block recovery: a block typed without any
// indentation, e.g.
//
//   interface GigabitEthernet0/0
//   spanning-tree bpdufilter
//   no shutdown
//
// gives depth-comparison nothing to work with (every line reads as a
// column-0 sibling), so the opener keyword (openerBlockType, lib/blocks.js)
// plus per-line positive evidence (isChildCommand: the command exists in the
// opener's block per the data packs' `modes` field) identify the children,
// and onMissingIndent(lineIndex, indentLen, expectedIndent, header) reports
// each one. A line with NO evidence ends the block and is left alone —
// deliberate: real configs don't reliably separate blocks with `!`/blanks
// (`dot1x system-auth-control` can directly follow a `service-template`
// block), so guessing "everything after an opener is a child" would
// mis-indent global commands. Conservative trade-off: a child whose command
// is missing from the loaded packs isn't auto-indented. Nested sub-modes
// typed flush-left (`address-family` under `vrf definition`) are indented
// one level under the outer opener only; deeper nesting is enforced once
// real indentation exists.
function scanIndentation(lines, onSiblingMismatch, onMixedTabsSpaces, onLine, options = {}) {
  const { openerBlockType, isChildCommand, onMissingIndent } = options;
  const flushEnabled = !!(openerBlockType && isChildCommand && onMissingIndent);
  const indentUnit = flushEnabled ? findIndentUnit(lines) : 1;

  const stack = [{ indent: -1, childIndent: null }]; // sentinel: true column-0 scope
  // Flush-left recovery state: set right after a block-opener line, cleared
  // by separators (blank/!/#), a deeper real child, mixed-tab lines, another
  // opener, end/exit, or any line without child evidence.
  let flush = null;

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const leading = line.match(/^[ \t]*/)[0];
    const isMixed = leading.includes(' ') && leading.includes('\t');
    if (isMixed) {
      onMixedTabsSpaces(i, leading.length);
    }

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) {
      flush = null;
      return;
    }

    const indent = leadingSpaces(line);
    let effectiveIndent = indent;
    let isFlushChild = false;

    if (flush) {
      if (isMixed || indent > flush.openerIndent) {
        // Untrustworthy indent, or a real indented child — normal path.
        flush = null;
      } else if (
        !openerBlockType(trimmed) &&
        !/^(end|exit)\b/i.test(trimmed) &&
        isChildCommand(flush.block, trimmed.replace(/^(no|default)\s+/i, ''))
      ) {
        isFlushChild = true;
        effectiveIndent = flush.expectedIndent;
        onMissingIndent(i, indent, flush.expectedIndent, flush.header);
      } else {
        flush = null;
      }
    }

    if (onLine) onLine(i, line, trimmed, indent, isFlushChild);

    while (stack.length > 1 && effectiveIndent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (effectiveIndent > parent.indent) {
      if (parent.childIndent === null) {
        parent.childIndent = effectiveIndent;
      } else if (effectiveIndent !== parent.childIndent && !isMixed) {
        onSiblingMismatch(i, effectiveIndent, parent.childIndent);
      }
      stack.push({ indent: effectiveIndent, childIndent: null });
    }

    if (flushEnabled && !isFlushChild) {
      const block = isMixed ? null : openerBlockType(trimmed);
      flush = block
        ? {
            block,
            header: trimmed,
            openerIndent: effectiveIndent,
            expectedIndent: effectiveIndent + indentUnit,
          }
        : null;
    }
  });
}

// The indent width flush-left recovery should apply: the first real
// parent→child indent delta in the file (so fixes match the file's own
// style), falling back to IOS's native 1 space. Tab-indented lines are
// skipped — their width is not comparable.
function findIndentUnit(lines) {
  let prevIndent = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) continue;
    const leading = line.match(/^[ \t]*/)[0];
    if (leading.includes('\t')) {
      prevIndent = null;
      continue;
    }
    if (prevIndent !== null && leading.length > prevIndent) return leading.length - prevIndent;
    prevIndent = leading.length;
  }
  return 1;
}

// Fixes exactly what computeDiagnostics' indentation checks flag — nothing
// more. A file that's already internally consistent produces no edits, even
// if it uses a different indent width than IOS's native 1-space-per-level
// convention. Pass { openerBlockType, isChildCommand } to also fix
// flush-left block children (see scanIndentation) — the formatter supplies
// its own onMissingIndent so linter and formatter can never disagree.
// Returns LSP TextEdits.
function computeFormattingEdits(lines, options = {}) {
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
    null,
    {
      openerBlockType: options.openerBlockType,
      isChildCommand: options.isChildCommand,
      onMissingIndent: (i, indentLen, expectedIndent) => {
        edits.push({
          range: { start: { line: i, character: 0 }, end: { line: i, character: indentLen } },
          newText: ' '.repeat(expectedIndent),
        });
      },
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

module.exports = {
  leadingSpaces,
  scanIndentation,
  findIndentUnit,
  computeFormattingEdits,
  computeFoldingRanges,
};
