'use strict';

// PDF -> JSON command-reference extractor.
//
// Cisco's IOS/IOS-XE command-reference manuals are generated from a shared
// DITA Open Toolkit template, so the page text produced by `pdftotext
// -layout` follows a consistent shape across platforms/releases: a master
// front-matter Table of Contents (PART/CHAPTER headers followed by indented
// "<command-name> <page>" lines) followed by chapter bodies where each
// command's text begins with the bare command name (optionally with a
// parenthetical disambiguator) as a standalone line, and uses a fixed set of
// section labels (Syntax Description, Command Default, Command Modes,
// Command History, Usage Guidelines, Examples). See
// scripts/EXTRACTION_NOTES.md for the full reverse-engineering writeup this
// script implements.
//
// Usage:
//   node scripts/extract-commands.js <pdf-path> --pack <packId>
//       [--platform "Catalyst 9500"] [--release "17.15.x"]
//
// Output: one server/data/<packId>/<chapterId>.json per command chapter
// found in the PDF (chapterId is mechanically derived from the chapter
// title, not a hardcoded lookup, so future manuals' chapters slot in
// automatically). server/data/<packId>/ is fully deleted and regenerated on
// every run.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');

// Chapter counts externally verified against the real PDF for this pack
// (see scripts/EXTRACTION_NOTES.md). The raw TOC lists 1,325 entries, but 10
// of those are not real commands (1 stray cross-reference bullet miscounted
// as a VLAN-chapter entry, plus 9 conceptual/non-command subsections mixed
// into otherwise-real chapters, e.g. "Information About Tracing") -- see the
// per-chapter validation logic below and EXTRACTION_NOTES.md for the full
// list. This is a nice-to-have cross-check printed for known packs only --
// it never gates success/failure, since a genuinely new pack has no entry
// here.
const KNOWN_GOOD_COUNTS = {
  'cat9500-17.15': { total: 1315 },
};

// A chapter is allowed to have a handful of TOC entries that turn out not to
// be real commands (see the comment at the per-chapter validation site).
// Below this fraction extracted, treat it as a parsing bug instead.
const MIN_EXTRACTION_RATIO = 0.9;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack') args.pack = argv[++i];
    else if (a === '--platform') args.platform = argv[++i];
    else if (a === '--release') args.release = argv[++i];
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const pdfPath = args._[0];
if (!pdfPath || !args.pack) {
  console.error(
    'Usage: node scripts/extract-commands.js <pdf-path> --pack <packId> [--platform <name>] [--release <ver>]',
  );
  process.exit(1);
}
const packId = args.pack;
const platform = args.platform || null;
const release = args.release || null;

// ---------------------------------------------------------------------------
// 1. Extract text
// ---------------------------------------------------------------------------

console.log(`Running pdftotext -layout on ${pdfPath} ...`);
const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
  maxBuffer: 1024 * 1024 * 1024,
  encoding: 'utf8',
});
const lines = text.split('\n');
console.log(`Extracted ${lines.length} lines of text.`);

// ---------------------------------------------------------------------------
// 2. Locate and parse the master Table of Contents
// ---------------------------------------------------------------------------

const NOISE_RE = /Command Reference, Cisco IOS XE/;
const PART_RE = /^PART\s+[IVXLCDM]+\s+.*\s+\d+\s*$/;
const CHAPTER_RE = /^CHAPTER\s+\d+\s+(.*?)\s+\d+\s*$/;
const ROMAN_FOOTER_RE = /^[ivxlcdm]+$/;
const COMMAND_LINE_RE = /^\s*(\S.*?)\s+(\d+)\s*$/;

function findTocBounds() {
  const startIdx = lines.findIndex((l) => l.trim() === 'CONTENTS');
  if (startIdx === -1) {
    throw new Error('Could not find a "CONTENTS" line -- unexpected document structure.');
  }

  let firstChapterTitle = null;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = CHAPTER_RE.exec(lines[i].trim());
    if (m) {
      firstChapterTitle = m[1].trim();
      break;
    }
  }
  if (!firstChapterTitle) {
    throw new Error('Could not find the first CHAPTER heading after CONTENTS.');
  }

  let seen = 0;
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === firstChapterTitle) {
      seen++;
      if (seen === 2) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) {
    throw new Error(
      `Could not find the second occurrence of "${firstChapterTitle}" (expected real chapter-1 body start).`,
    );
  }

  return { startIdx, endIdx };
}

function parseToc(startIdx, endIdx) {
  const chapters = [];
  let current = null;

  // A few command names are long enough to wrap across two physical TOC
  // lines; the first line then has no trailing page number (so it doesn't
  // match COMMAND_LINE_RE) and is really a prefix of the next line's name.
  let pendingPrefix = '';

  for (let i = startIdx; i < endIdx; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed === 'Contents') continue;
    if (NOISE_RE.test(trimmed)) continue;
    if (ROMAN_FOOTER_RE.test(trimmed)) continue;
    if (PART_RE.test(trimmed)) continue;
    if (trimmed.startsWith('•')) continue; // stray bullet/cross-reference noise

    const chMatch = CHAPTER_RE.exec(trimmed);
    if (chMatch) {
      current = { title: chMatch[1].trim(), entries: [] };
      chapters.push(current);
      pendingPrefix = '';
      continue;
    }

    const cmdMatch = COMMAND_LINE_RE.exec(raw.replace(/\s+$/, ''));
    if (cmdMatch && current) {
      const name = pendingPrefix ? `${pendingPrefix} ${cmdMatch[1].trim()}` : cmdMatch[1].trim();
      current.entries.push({ name, page: Number(cmdMatch[2]) });
      pendingPrefix = '';
    } else if (current) {
      // No trailing page number on this line -- a wrapped name fragment.
      pendingPrefix = pendingPrefix ? `${pendingPrefix} ${trimmed}` : trimmed;
    }
  }

  return chapters;
}

// ---------------------------------------------------------------------------
// 3. Body splitting -- sequential, order-preserving anchor matching
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cisco's PDF repeats the current command's name as a small running header on
// continuation pages of a long, multi-page entry (sometimes indented a few
// spaces, sometimes flush left like the real anchor). These false headers
// match the same line shape as a genuine anchor. Requiring "Syntax
// Description" to be specifically the *first* label found nearby (rather
// than just *some* label) was tried and rejected: the gap from anchor to
// Syntax Description varies too widely across entries (some run long before
// reaching it) for any fixed window to cleanly tell a true anchor from a
// false header without misclassifying many genuine entries either way. The
// lenient check below (any of the six section labels appears soon after)
// covers the overwhelming majority of entries correctly; the rare residual
// case -- a false header for a command whose body straddles a page break
// landing exactly where another of that same entry's labels is equally
// close -- is caught after the fact instead, by detectMergedChunk() flagging
// a chunk that contains more than one full entry's worth of content.
const ANCHOR_LOOKAHEAD = 3000;

function isRealAnchor(bodyText, afterIndex) {
  const windowText = bodyText.slice(afterIndex, afterIndex + ANCHOR_LOOKAHEAD);
  return SECTION_LABELS.some((label) => labelRegex(label).test(windowText));
}

function findAnchor(bodyText, name, fromIndex) {
  const re = new RegExp(`^[ \\t]{0,4}${escapeRegExp(name)}[ \\t]*$`, 'gm');
  re.lastIndex = fromIndex;
  let m;
  while ((m = re.exec(bodyText)) !== null) {
    const end = m.index + m[0].length;
    if (isRealAnchor(bodyText, end)) {
      return { start: m.index, end };
    }
    // False running-header match -- keep scanning forward (re.lastIndex
    // already advanced past this match since the regex has the 'g' flag).
  }
  return null;
}

function splitNameContext(rawName) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(rawName);
  if (m) return { name: m[1].trim(), context: m[2].trim() };
  return { name: rawName.trim(), context: null };
}

// ---------------------------------------------------------------------------
// 4. Per-chunk field extraction
// ---------------------------------------------------------------------------

const SECTION_LABELS = [
  'Syntax Description',
  'Command Default',
  'Command Modes',
  'Command History',
  'Usage Guidelines',
  'Examples',
];

// Any section label can appear either flush-left with its content starting
// on the same line ("Command Modes        Global configuration (config)"),
// or -- typically for short/simple commands -- as an indented sub-heading
// alone on its own line, with the content starting on the next line. Both
// forms must be recognized, or the indented variant's content (e.g. a stray
// "Syntax Description" / "This command has no arguments..." pair) leaks into
// whatever the previous, found section's text is taken to be.
function labelRegex(label) {
  const escaped = label === 'Examples' ? 'Examples?' : escapeRegExp(label);
  return new RegExp(`^(?:${escaped}\\b|[ \\t]+${escaped}[ \\t]*$)`, 'm');
}

function findSectionOffsets(chunkText) {
  const offsets = {};
  let cursor = 0;
  for (const label of SECTION_LABELS) {
    const re = labelRegex(label);
    const sub = chunkText.slice(cursor);
    const m = re.exec(sub);
    if (m) {
      // `start` anchors ordering (e.g. headerEnd = earliest label start);
      // `contentStart` is where the label's own text ends, which varies
      // (the indented-alone-on-its-line form includes leading whitespace in
      // the match, the flush form doesn't), so it can't be derived from
      // `label.length` alone.
      offsets[label] = { start: cursor + m.index, contentStart: cursor + m.index + m[0].length };
      cursor = cursor + m.index + m[0].length;
    } else {
      offsets[label] = null;
    }
  }
  return offsets;
}

function sectionText(chunkText, offsets, label, nextLabels) {
  if (offsets[label] == null) return '';
  let end = chunkText.length;
  for (const next of nextLabels) {
    if (offsets[next] != null) {
      end = offsets[next].start;
      break;
    }
  }
  return chunkText.slice(offsets[label].contentStart, end);
}

function collapseWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function extractDetail(headerText) {
  const lines = headerText.split('\n');
  // Skip the anchor line itself (first non-blank line).
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  i++; // past the anchor line
  const paragraph = [];
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '') break;
    paragraph.push(lines[i].trim());
  }
  const text = collapseWs(paragraph.join(' '));
  const m = /^To\s+(.+?),\s+(?:use|issue)\s+the\s+\S.*?\bcommand\b[^.]*\.\s*/i.exec(text);
  if (m) {
    let action = m[1].trim();
    action = action.charAt(0).toUpperCase() + action.slice(1);
    if (!/[.?!]$/.test(action)) action += '.';
    return action;
  }
  return text || null;
}

// A trimmed line that itself starts with one of the fixed section labels --
// used so syntax-line collection below stops there even when `headerEnd`
// (computed from the *earliest* found label) undershoots because a command
// happens to skip straight from its syntax to a later section (e.g.
// "Command History") with no "Syntax Description"/"Command Default"/
// "Command Modes" section in between to anchor on first.
function isSectionLabelLine(trimmedLine) {
  return SECTION_LABELS.some((label) => {
    const escaped = label === 'Examples' ? 'Examples?' : escapeRegExp(label);
    return new RegExp(`^${escaped}\\b`).test(trimmedLine);
  });
}

function extractSyntax(headerText) {
  const lines = headerText.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  i++; // anchor line
  // skip intro paragraph
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '') break;
  }
  const syntaxLines = [];
  const noFormLines = [];
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (isSectionLabelLine(line)) break;
    if (/^no\s+/i.test(line)) noFormLines.push(line);
    else syntaxLines.push(line);
  }
  return {
    syntax: collapseWs(syntaxLines.join(' ')) || null,
    noForm: collapseWs(noFormLines.join(' ')) || null,
  };
}

function extractParams(syntaxDescText) {
  const lines = syntaxDescText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 1 && /^This command has no (?:arguments|keywords)/i.test(lines[0])) {
    return [];
  }
  const params = [];
  const paramStartRe = /^(\S+(?:\s\S+){0,3}?)\s{2,}(\S.*)$/;
  // A single-parameter entry is sometimes laid out with just one space
  // between the name and its description (the usual 2+ space column gap
  // only shows up when there's a multi-row table to align).
  const singleParamRe = /^(\S+)\s+(\S.*)$/;
  for (const line of lines) {
    const m =
      paramStartRe.exec(line) ||
      (params.length === 0 && lines.length === 1 ? singleParamRe.exec(line) : null);
    if (m) {
      params.push({ name: m[1].trim(), description: m[2].trim() });
    } else if (params.length > 0) {
      params[params.length - 1].description = collapseWs(
        `${params[params.length - 1].description} ${line}`,
      );
    }
  }
  return params;
}

function extractModes(commandModesText) {
  return commandModesText
    .split(/\n\s*\n/)
    .map((block) => collapseWs(block))
    .filter((block) => block !== '');
}

function summarizeUsage(usageText) {
  const collapsed = collapseWs(usageText);
  if (!collapsed) return null;
  const noteIdx = collapsed.search(/\bNote\b/);
  const bounded = noteIdx > 40 ? collapsed.slice(0, noteIdx) : collapsed;
  const sentences = bounded.match(/[^.]*\.+/g) || [bounded];
  return sentences.slice(0, 3).join(' ').trim() || null;
}

// A small number of EXEC-only commands (e.g. "show license all") fold their
// mode directly into "Command Default" (e.g. "Privileged EXEC (#)") instead
// of using a separate "Command Modes" section.
function looksLikeModeText(s) {
  return /^(Privileged EXEC|User EXEC|EXEC)\b.*\([^()]*\)\s*$/.test(s.trim());
}

// KNOWN LIMITATION (documented in scripts/EXTRACTION_NOTES.md): in a
// handful of cases, a command whose body straddles a page break right where
// a duplicate-name sibling entry begins can have its chunk boundary land on
// a false running-header match instead of the sibling's real anchor,
// producing one merged/garbled record and one missing record instead of two
// clean ones (e.g. "errdisable recovery cause", which has two near-identical
// documented forms). Several approaches to detect and reject this
// automatically were tried (requiring "Syntax Description" specifically;
// counting repeated section labels; detecting the command name recurring in
// the chunk) and each rejected far more good entries than bad ones, since
// the same surface patterns occur routinely in legitimate single entries.
// Given how rare the genuine merge case is against 1,300+ commands, this is
// accepted as-is rather than risking broad data loss chasing a perfect
// detector.

// A page's bottom-of-page running header often "forecasts" the name of the
// command whose content starts on the next page, immediately followed (after
// a few blank lines, once the page break is crossed) by that command's real
// flush-left anchor. findAnchor()'s lenient isRealAnchor() check (see its
// comment) can't always tell this forecast line apart from the real anchor,
// since both are followed by the same nearby section labels -- so it's
// common for anchorStart to land on the forecast line instead. Rather than
// trying to make anchor detection itself perfect (multiple attempts at that
// caused far more harm than good -- see the comment above), detect and skip
// over this specific, narrow pattern here: a leading line repeating
// `rawName`, then nothing but blank lines, then `rawName` again. A genuine
// entry's intro paragraph never restates the bare command name again this
// soon (it does so only after the full intro sentence, much further in).
function stripLeadingForecastHeader(chunkText, rawName) {
  const firstLineEnd = chunkText.indexOf('\n');
  if (firstLineEnd === -1) return chunkText;
  const firstLine = chunkText.slice(0, firstLineEnd).trim();
  if (firstLine !== rawName) return chunkText;

  const nameRe = new RegExp(`^[ \\t]{0,4}${escapeRegExp(rawName)}[ \\t]*$`, 'm');
  // A handful of blank lines plus the name itself -- sized off rawName's own
  // length so long command names (some run 35+ characters) still fit.
  const windowSize = rawName.length + 20;
  const lookahead = chunkText.slice(firstLineEnd + 1, firstLineEnd + 1 + windowSize);
  const m = nameRe.exec(lookahead);
  if (m && /^[ \t\n]*$/.test(lookahead.slice(0, m.index))) {
    return chunkText.slice(firstLineEnd + 1 + m.index);
  }
  return chunkText;
}

function extractCommand(chunkText, rawName, page) {
  chunkText = stripLeadingForecastHeader(chunkText, rawName);
  const offsets = findSectionOffsets(chunkText);
  // "Command History" is the one section that genuinely always appears for a
  // real command entry, including the few EXEC commands that fold their mode
  // into "Command Default" rather than a separate "Command Modes" section;
  // neither label appears in conceptual/non-command prose (e.g. chapter
  // intros), so requiring at least one of them reliably tells real commands
  // apart from those.
  if (offsets['Command Modes'] == null && offsets['Command History'] == null) {
    return null;
  }

  const headerEnd = Math.min(
    ...SECTION_LABELS.map((l) => offsets[l])
      .filter((v) => v != null)
      .map((v) => v.start),
  );
  const headerText = chunkText.slice(0, headerEnd);

  const { name, context } = splitNameContext(rawName);
  const { syntax, noForm } = extractSyntax(headerText);
  const syntaxDescText = sectionText(chunkText, offsets, 'Syntax Description', [
    'Command Default',
    'Command Modes',
  ]);
  const commandDefaultText = sectionText(chunkText, offsets, 'Command Default', [
    'Command Modes',
    'Command History',
  ]);
  const commandModesText = sectionText(chunkText, offsets, 'Command Modes', ['Command History']);
  const usageText = sectionText(chunkText, offsets, 'Usage Guidelines', ['Examples']);

  let modes = extractModes(commandModesText);
  if (modes.length === 0) {
    const defaultText = collapseWs(commandDefaultText);
    if (looksLikeModeText(defaultText)) modes = [defaultText];
  }

  return {
    name,
    context,
    detail: extractDetail(headerText),
    syntax,
    noForm,
    params: extractParams(syntaxDescText),
    modes,
    usageSummary: summarizeUsage(usageText),
    sourcePage: page,
    pack: packId,
    platform,
    release,
    source: 'pdf',
  };
}

// ---------------------------------------------------------------------------
// 5. Chapter id slugification (mechanical, not a hardcoded lookup table)
// ---------------------------------------------------------------------------

function chapterIdFromTitle(title) {
  let slug = title.replace(/\s*Commands\s*$/i, '').trim();
  slug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

// ---------------------------------------------------------------------------
// Cross-cutting artifacts kept in sync with server/data/**: the coverage
// doc, the spell-check word list, and the syntax-highlighting grammar's
// known-command-root list. All three are re-derived from whatever is
// currently on disk under server/data/ (every pack plus curated.json), not
// just the pack this run just wrote, so they stay accurate as packs are
// added or curated.json is hand-edited between runs.
// ---------------------------------------------------------------------------

function readAllCommandRecords() {
  const records = [];
  for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packPath = path.join(DATA_DIR, entry.name);
    for (const file of fs.readdirSync(packPath)) {
      if (!file.endsWith('.json')) continue;
      records.push(...JSON.parse(fs.readFileSync(path.join(packPath, file), 'utf8')));
    }
  }
  return records;
}

function updateCommandCoverage(chapterSummary, packId, platform, release, grandTotal) {
  const coveragePath = path.join(ROOT, 'COMMAND_COVERAGE.md');
  const startMarker = `<!-- AUTO-GENERATED:${packId}:START -->`;
  const endMarker = `<!-- AUTO-GENERATED:${packId}:END -->`;

  const rows = chapterSummary
    .filter((row) => row.chapterId) // skip the "SKIPPED" conceptual chapter
    .map((row) => {
      const examples = row.examples.map((n) => `\`${n}\``).join(', ');
      return `| ${row.title} | ${row.count} | ${examples} |`;
    });

  const heading = [platform, release].filter(Boolean).join(' ') || packId;
  const section = [
    startMarker,
    `## ${heading}`,
    '',
    `**${grandTotal.toLocaleString()} commands** across ${rows.length} chapters (pack \`${packId}\`):`,
    '',
    '| Chapter | Count | Examples |',
    '| --- | --- | --- |',
    ...rows,
    endMarker,
  ].join('\n');

  const introAndOutro = `# Command coverage

This summarizes the Cisco IOS/IOS-XE commands this extension recognizes for completions,
hover docs, and diagnostics. Each section below is generated from a Cisco command-reference
manual dropped into \`_manuals/\` and extracted with \`npm run extract-commands -- <pdf>
--pack <packId> --platform <name> --release <ver>\` (see \`scripts/extract-commands.js\` /
\`scripts/EXTRACTION_NOTES.md\`) -- do not hand-edit the text between an
\`AUTO-GENERATED:<packId>\` marker pair, it is overwritten on every re-run of that pack.

${section}

## Curated additions

A further set of commands lives in \`server/data/curated/curated.json\`, hand-maintained
rather than generated, because they fall into one of two cases found while reconciling this
extension's original hand-picked completions against the generated data:

- **Absent from every loaded platform reference.** For \`cat9500-17.15\` this includes the
  crypto/VPN family (\`crypto isakmp policy\`, \`crypto ipsec transform-set\`, \`crypto map\`),
  line/VTY configuration (\`login local\`, \`line vty\`, \`exec-timeout\`, \`access-class\`),
  basic syslog (\`logging\`, \`logging host\`, \`logging trap\`, \`logging facility\`), \`ip route\`,
  and a handful of others -- these commands exist on real IOS-XE devices but aren't documented
  in this platform-specific reference (they live in separate Security/Network-Management
  configuration guides).
- **"False friends"**: a bare name that collides with a *different, unrelated* command
  documented under the same name in the loaded reference. For example, this PDF's only
  \`shutdown\` entry is for ERSPAN sessions, its \`neighbor\` entry is an L2TPv3 pseudowire
  command, and \`transport\`/\`service\`/\`authentication\` (bare) are all different commands from
  the interface \`shutdown\`, BGP \`neighbor\`, line \`transport input\`, and 802.1X
  \`authentication order/event/...\` this extension curates completions for. Both the curated
  entry and the PDF's unrelated entry are shown on hover, labeled, rather than picking one.
`;

  let existing;
  try {
    existing = fs.readFileSync(coveragePath, 'utf8');
  } catch {
    existing = null;
  }

  if (existing && existing.includes(startMarker) && existing.includes(endMarker)) {
    const markerRe = new RegExp(
      `<!-- AUTO-GENERATED:${packId}:START -->[\\s\\S]*?<!-- AUTO-GENERATED:${packId}:END -->`,
    );
    fs.writeFileSync(coveragePath, existing.replace(markerRe, section));
  } else if (existing && existing.includes('<!-- AUTO-GENERATED:')) {
    // Other packs' sections already exist -- insert this pack's section
    // before the "## Curated additions" heading, leave everything else be.
    const curatedIdx = existing.indexOf('## Curated additions');
    const insertAt = curatedIdx === -1 ? existing.length : curatedIdx;
    fs.writeFileSync(
      coveragePath,
      existing.slice(0, insertAt) + section + '\n\n' + existing.slice(insertAt),
    );
  } else {
    // First run: no managed sections yet (or the file predates this
    // pack-based format entirely) -- bootstrap the whole file.
    fs.writeFileSync(coveragePath, introAndOutro);
  }
}

// A modest stoplist of common English/computing words that would otherwise
// show up constantly in command syntax and names -- skipping these keeps
// cspell.json additions focused on genuine Cisco/networking jargon instead
// of every ordinary word a command happens to contain. Over-inclusion here
// is harmless (an extra plain-English word in the list just means cspell
// never flags it, which isn't a real loss) so this doesn't need to be
// exhaustive.
const COMMON_WORD_STOPLIST = new Set([
  'show',
  'clear',
  'debug',
  'enable',
  'disable',
  'configure',
  'config',
  'set',
  'get',
  'add',
  'remove',
  'delete',
  'create',
  'update',
  'start',
  'stop',
  'enter',
  'exit',
  'allow',
  'deny',
  'permit',
  'block',
  'filter',
  'match',
  'apply',
  'attach',
  'detach',
  'bind',
  'unbind',
  'map',
  'register',
  'reset',
  'restart',
  'reload',
  'save',
  'load',
  'import',
  'export',
  'backup',
  'restore',
  'copy',
  'move',
  'rename',
  'list',
  'display',
  'print',
  'view',
  'monitor',
  'track',
  'log',
  'report',
  'summary',
  'detail',
  'brief',
  'verbose',
  'status',
  'state',
  'mode',
  'type',
  'name',
  'number',
  'value',
  'level',
  'priority',
  'weight',
  'size',
  'length',
  'width',
  'height',
  'count',
  'total',
  'average',
  'minimum',
  'maximum',
  'default',
  'custom',
  'auto',
  'manual',
  'static',
  'dynamic',
  'active',
  'inactive',
  'enabled',
  'disabled',
  'input',
  'output',
  'source',
  'destination',
  'local',
  'remote',
  'internal',
  'external',
  'primary',
  'secondary',
  'master',
  'parent',
  'child',
  'root',
  'node',
  'link',
  'path',
  'route',
  'routing',
  'router',
  'switch',
  'switching',
  'bridge',
  'bridging',
  'interface',
  'port',
  'channel',
  'group',
  'pool',
  'zone',
  'area',
  'domain',
  'region',
  'cluster',
  'instance',
  'session',
  'connection',
  'tunnel',
  'virtual',
  'physical',
  'logical',
  'global',
  'private',
  'public',
  'shared',
  'common',
  'specific',
  'general',
  'basic',
  'advanced',
  'standard',
  'extended',
  'normal',
  'special',
  'additional',
  'optional',
  'required',
  'address',
  'table',
  'entry',
  'entries',
  'record',
  'file',
  'system',
  'device',
  'server',
  'client',
  'user',
  'users',
  'password',
  'secret',
  'account',
  'access',
  'security',
  'policy',
  'profile',
  'template',
  'rule',
  'rules',
  'action',
  'event',
  'events',
  'time',
  'timer',
  'timeout',
  'interval',
  'schedule',
  'history',
  'version',
  'information',
  'description',
  'comment',
  'label',
  'reference',
  'format',
  'method',
  'process',
  'service',
  'services',
  'management',
  'network',
  'traffic',
  'packet',
  'packets',
  'frame',
  'protocol',
  'application',
  'command',
  'commands',
  'parameter',
  'parameters',
  'argument',
  'arguments',
  'option',
  'options',
  'feature',
  'features',
  'function',
  'operation',
  'sample',
  'example',
  'usage',
  'note',
  'notes',
  'warning',
  'error',
  'errors',
  'message',
  'messages',
]);

function updateCspell() {
  const cspellPath = path.join(ROOT, 'cspell.json');
  const text = fs.readFileSync(cspellPath, 'utf8');

  const existingWords = new Set();
  for (const m of text.matchAll(/"([a-z0-9-]+)"/gi)) existingWords.add(m[1].toLowerCase());

  const candidates = new Set();
  for (const record of readAllCommandRecords()) {
    for (const token of record.name.split(/[^a-z0-9]+/i)) {
      const t = token.toLowerCase();
      if (t.length < 4) continue; // short acronyms don't need listing
      if (existingWords.has(t) || COMMON_WORD_STOPLIST.has(t)) continue;
      if (/^\d+$/.test(t)) continue;
      candidates.add(t);
    }
  }

  if (candidates.size === 0) return;

  const newWords = Array.from(candidates).sort();
  const sectionHeader =
    '    // PDF-derived command vocabulary (auto-generated by extract-commands.js)';
  const newWordsBlock = newWords.map((w) => `    "${w}"`).join(',\n');

  // Append a new section right before the closing `]` of the "words" array,
  // rather than re-serializing the whole file, so hand-written comments and
  // section grouping elsewhere in the file are left untouched.
  const wordsArrayRe = /("words"\s*:\s*\[)([\s\S]*?)(\n\s*\])/;
  const updated = text.replace(wordsArrayRe, (full, open, body, close) => {
    const trimmedBody = body.replace(/,\s*$/, '');
    return `${open}${trimmedBody},\n${sectionHeader}\n${newWordsBlock}${close}`;
  });

  fs.writeFileSync(cspellPath, updated);
  console.log(`cspell.json: added ${newWords.length} new word(s).`);
}

function updateGrammar() {
  const grammarPath = path.join(ROOT, 'syntaxes', 'cisco.tmLanguage.json');
  const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));

  const roots = new Set();
  for (const record of readAllCommandRecords()) {
    roots.add(record.name.split(/\s+/)[0].toLowerCase());
  }
  const sortedRoots = Array.from(roots).sort();
  const escaped = sortedRoots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matchPattern = `(?<=^\\s*(?:no\\s+|default\\s+)?)(?:${escaped.join('|')})(?=[^-\\w]|$)`;

  grammar.repository.command_root = {
    patterns: [{ name: 'keyword.control.command.cisco', match: matchPattern }],
  };

  if (!grammar.patterns.some((p) => p.include === '#command_root')) {
    const keywordIdx = grammar.patterns.findIndex((p) => p.include === '#keyword');
    const insertAt = keywordIdx === -1 ? grammar.patterns.length : keywordIdx;
    grammar.patterns.splice(insertAt, 0, { include: '#command_root' });
  }

  fs.writeFileSync(grammarPath, JSON.stringify(grammar, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { startIdx, endIdx } = findTocBounds();
  const chapters = parseToc(startIdx, endIdx);
  const bodyText = lines.slice(endIdx).join('\n');

  console.log(`Found ${chapters.length} chapters in the master TOC.`);

  // Flatten in document order for sequential anchor matching.
  const flat = [];
  chapters.forEach((ch, chapterIdx) => {
    ch.entries.forEach((entry, entryIdx) => {
      flat.push({ chapterIdx, entryIdx, name: entry.name, page: entry.page });
    });
  });

  let cursor = 0;
  const notFound = [];
  flat.forEach((item) => {
    const anchor = findAnchor(bodyText, item.name, cursor);
    if (anchor) {
      item.anchorStart = anchor.start;
      item.anchorEnd = anchor.end;
      cursor = anchor.end;
    } else {
      item.anchorStart = null;
      notFound.push(item);
    }
  });

  if (notFound.length > 0) {
    console.log(
      `Note: ${notFound.length} TOC entries had no body anchor found (see chapter results below).`,
    );
  }

  // Determine chunk end for each found anchor = next found anchor's start.
  const found = flat.filter((i) => i.anchorStart != null);
  found.forEach((item, idx) => {
    item.chunkEnd = idx + 1 < found.length ? found[idx + 1].anchorStart : bodyText.length;
  });

  // Extract a record for every found anchor.
  found.forEach((item) => {
    const chunkText = bodyText.slice(item.anchorStart, item.chunkEnd);
    item.record = extractCommand(chunkText, item.name, item.page);
  });

  // Group by chapter, validate, write output.
  fs.rmSync(path.join(DATA_DIR, packId), { recursive: true, force: true });
  fs.mkdirSync(path.join(DATA_DIR, packId), { recursive: true });

  const summary = [];
  let grandTotal = 0;
  const errors = [];

  chapters.forEach((ch, chapterIdx) => {
    const chapterItems = flat.filter((i) => i.chapterIdx === chapterIdx);
    const validRecords = chapterItems.map((i) => i.record).filter((r) => r != null);

    if (validRecords.length === 0) {
      summary.push({ title: ch.title, count: 'SKIPPED (no command entries found)' });
      return;
    }

    if (validRecords.length !== ch.entries.length) {
      const missing = chapterItems
        .filter((i) => i.record == null)
        .map(
          (i) =>
            `${i.name} [${i.anchorStart == null ? 'no anchor found' : 'anchor found, not a real command (no Command Modes/History section)'}]`,
        );
      const ratio = validRecords.length / ch.entries.length;

      // A real command-reference chapter occasionally mixes in a small
      // number of conceptual, non-command subsections (e.g. "Information
      // About Tracing" inside the Tracing chapter) alongside its TOC's
      // command listing -- these legitimately have no command body and are
      // dropped, not an extraction bug. A large shortfall, on the other
      // hand, indicates a real parsing problem (a future manual with a
      // structural quirk this script doesn't yet handle) and must fail
      // loudly rather than silently ship an incomplete chapter.
      if (ratio < MIN_EXTRACTION_RATIO) {
        errors.push(
          `Chapter "${ch.title}": expected ${ch.entries.length} commands, extracted ${validRecords.length} ` +
            `(${(ratio * 100).toFixed(1)}%, below the ${(MIN_EXTRACTION_RATIO * 100).toFixed(0)}% threshold). ` +
            `Unextracted entries: ${missing.join(', ')}`,
        );
        return;
      }

      console.log(
        `Note: chapter "${ch.title}" had ${chapterItems.length - validRecords.length} TOC entries with no ` +
          `command body (treated as non-command subsections, not an error): ${missing.join(', ')}`,
      );
    }

    const chapterId = chapterIdFromTitle(ch.title);
    const outPath = path.join(DATA_DIR, packId, `${chapterId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(validRecords, null, 2) + '\n');
    summary.push({
      title: ch.title,
      count: validRecords.length,
      chapterId,
      examples: validRecords.slice(0, 4).map((r) => r.name),
    });
    grandTotal += validRecords.length;
  });

  console.log('\nPer-chapter results:');
  for (const row of summary) {
    console.log(
      `  ${String(row.count).padStart(5)}  ${row.title}${row.chapterId ? ` -> ${row.chapterId}.json` : ''}`,
    );
  }
  console.log(`\nTotal commands written: ${grandTotal}`);

  const known = KNOWN_GOOD_COUNTS[packId];
  if (known) {
    const status = known.total === grandTotal ? 'MATCH' : 'MISMATCH';
    console.log(
      `Known-good check for pack "${packId}": expected ${known.total}, got ${grandTotal} -> ${status}`,
    );
    if (status === 'MISMATCH') {
      errors.push(
        `Known-good total mismatch for pack "${packId}": expected ${known.total}, got ${grandTotal}.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error('\nExtraction validation FAILED:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('\nExtraction validation passed.');

  updateCommandCoverage(summary, packId, platform, release, grandTotal);
  updateCspell();
  updateGrammar();
  console.log('Updated COMMAND_COVERAGE.md, cspell.json, and syntaxes/cisco.tmLanguage.json.');
}

main();
