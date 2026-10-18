# PDF extraction methodology

How `import_scripts/extract-commands.js` turns a Cisco IOS/IOS-XE command-reference PDF into the
per-chapter JSON files under `server/data/<packId>/`. Written while ingesting the first pack
(`cat9500-17.15`, the Catalyst 9500 IOS XE 17.15.x Command Reference, 2,592 pages, 1,315
real commands). Cisco generates this whole manual family from a shared DITA Open Toolkit
template (confirmed via the PDF's own metadata: `Creator: DITA Open Toolkit`), so the
structural conventions below are expected to recur across other platforms/releases, not be
specific to this one document. Re-run the script against a new manual, then read this doc
side by side with its output to spot where a new manual diverges.

## 1. Tooling

```
pdfinfo <pdf>                  # page count, title, producer -- sanity check before parsing
pdftotext -layout <pdf> -      # MUST use -layout: preserves the column alignment the TOC
                                # and "Syntax Description" parameter tables depend on
```

Both ship in `poppler-utils` (a system package, not an npm dependency -- install it via your
OS package manager, e.g. `apt-get install poppler-utils` / `dnf install poppler-utils`).

## 2. Locating the master Table of Contents

The document has a front-matter TOC (the authoritative source of every command name + page
number) followed by the chapter bodies. Two things look like a TOC at first glance -- only
one is reliable:

- **Master front-matter TOC** (use this): starts after a line that is exactly `CONTENTS`,
  structured as repeating `PART <roman-numeral> <Title> <page>` / `CHAPTER <n> <Title>
<page>` header lines, each followed by indented `<command-name> <page>` lines.
- **Per-chapter in-body bullet list** (looked cleaner, rejected): each chapter body opens
  with its own `<Chapter Title>\n  • <command>, on page <n>\n  • ...` recap. Chapter titles
  sometimes wrap across two physical lines, and bullet-prefixed lines (`•`) also occur inside
  ordinary Usage Guidelines prose later in the chapter body -- both cause false matches in a
  naive scanner.

Find the TOC's end / first chapter body's start by searching for the **second** occurrence
of the first chapter's exact title line (the first is the TOC entry, the second is the real
heading where body content begins).

**Manuals without any front-matter TOC** (first seen: `cat3850-16.12`, the Catalyst 3850
IOS XE Gibraltar 16.12.x reference, which goes straight from the legal page into chapter 1;
its chapter openers' `• <command>, on page <n>` bullet lists exist for the first chapter
only): the script falls back to the **PDF bookmark outline**, read with
`pdftohtml -xml -i -l 1 -stdout` (the outline is printed whatever the page range; `-l 1`
keeps it to a second) and parsed by `import_scripts/outline-toc.js` (unit-tested in
`test/outline-toc.test.js`). The outline carries the same chapter → command tree as a master
TOC — the already-ingested 9500 17.15 manual's outline has 1,326 items for 1,325 TOC
entries — but its nesting is sloppy: a chapter's `<outline>` holds its commands _and the
next chapter's title_, whose own `<outline>` opens one level deeper, so depth grows by one
per chapter. The parser rebuilds the tree from the rule that does hold (an item's parent is
the nearest preceding item exactly one level up), takes every item with childless children
as a chapter and those children as its entries, and drops single-letter items (the back-of-
book index). Conceptual chapters ("Using the Command-Line Interface") come through with
their subsection titles as entries and are skipped by the usual 0-valid-records rule. With
no TOC region to cut off, the body is the whole text. Outline page numbers are physical PDF
pages (what a viewer shows), not the printed folio — so `sourcePage` means that for such a
pack.

## 3. Parsing the master TOC into `(chapter, command, page)` triples

```
^PART\s+[IVXLCDM]+\s+.*\s+\d+\s*$        -> part divider, not a command
^CHAPTER\s+\d+\s+(.*?)\s+\d+\s*$         -> $1 = chapter title, starts a new command list
^\s*(\S.*?)\s+(\d+)\s*$                  -> $1 = command name, $2 = page number
```

**Do not require leading whitespace** on the command-line regex. Most TOC entries are
indented, but some appear flush-left at column 0 in the same chapter as indented siblings
(e.g. `ip nhrp map  546`, `nat64 enable  641`). Requiring `^\s{2,}` silently drops these.

Filter out, before applying the command-line regex: the repeated running header (containing
`Command Reference, Cisco IOS`), lines that are exactly `Contents`, bare lowercase
roman-numeral footers (`xi`, `xii`, ...), `PART <roman>` lines, and lines starting with `•`
(stray cross-reference bullets -- one was found leaking into the VLAN chapter's TOC region
verbatim as `• Using the Command-Line Interface, on page`, which is not a real command).

**Running-header wording varies by manual family.** IOS-XE "Command Reference" manuals
(e.g. `cat9500-*`) repeat `Command Reference, Cisco IOS XE <release> (<platform>)`, but
classic-IOS "Consolidated Platform Command Reference" manuals (e.g. `cat2960x-15.2.6`)
repeat `Consolidated Platform Command Reference, Cisco IOS Release <release>
(<platform>)` instead -- no `XE` token. The original filter regex only matched the `XE`
form, so on the 2960-X manual these header lines fell through to the wrapped-name-fragment
buffer (§ above) and got glued as a bogus prefix onto the next real TOC entry, corrupting
its name so its body anchor was never found (13 commands silently lost this way on first
extraction, until the ratio-validated re-run below caught it). `NOISE_RE` now matches the
shared prefix `Command Reference, Cisco IOS\b`, covering both wordings.

`chapterId` is derived **mechanically** from the chapter title (strip a trailing "Commands",
lowercase, slugify) rather than a hardcoded lookup table, so a future manual's chapters
(whatever they're titled) slot in automatically.

**Wrapped TOC lines**: a few command names are long enough to wrap across two physical TOC
lines; the first line then has no trailing page number (so it doesn't match the command-line
regex) and is really a prefix of the next line's name (e.g. `show platform software
classification switch active F0 class-group-manager class-group client acl` wraps onto a
second line `   all 170`). The parser buffers any non-matching, non-noise line as a pending
prefix and prepends it to the next line that _does_ match.

## 4. Validating the parse: no hardcoded magic numbers

Rather than asserting against literal numbers specific to one PDF, the script asserts a
structural invariant that holds for any well-formed manual: **per chapter, the number of
successfully-extracted commands must equal the number of TOC entries for that chapter** --
with two tolerances, both logged, neither silent:

- **0 valid records in a chapter** -> the whole chapter is skipped (not written), e.g. the
  conceptual "Using the Command-Line Interface" chapter, which lists subsection titles
  ("Understanding Command Modes", ...) in the same TOC shape as real commands but has no
  command body for any of them.
- **A small shortfall (ratio >= `MIN_EXTRACTION_RATIO`, currently 90%)** -> the chapter is
  still written with whatever was extracted, and a non-fatal note lists what was dropped and
  why. This covers two real, recurring cases found in the `cat9500-17.15` PDF: (a) a handful
  of conceptual, non-command subsections mixed into an otherwise-real chapter (e.g.
  "Information About Tracing" inside the Tracing chapter), and (b) commands whose body
  couldn't be cleanly isolated due to PDF-rendering quirks (see Known limitations below).
- **A larger shortfall (< 90%)** -> fatal. This is the loud-failure path meant to catch a
  genuine parsing bug on a new, differently-structured manual.

For `cat9500-17.15` specifically: the raw TOC has 1,325 entries; 10 of those are not real
commands (1 VLAN-chapter bullet artifact + 9 conceptual subsections), so the verified total
is **1,315**, recorded in the script's `KNOWN_GOOD_COUNTS` table as an optional, informational
cross-check for that one pack (never a blocking check for a new pack with no entry there).

## 5. Splitting chapter bodies into per-command chunks

Walk the ordered TOC list (across **all** chapters at once, in document order -- chapter
boundaries are not separately detected; trust the TOC's chapter assignment, since a chapter's
last command's chunk simply runs until the next chapter's first command's anchor). For each
entry, find the next occurrence of its name as a standalone line (up to ~4 leading spaces of
tolerance), **strictly after** the previous command's chunk end. This sequential,
order-preserving approach (not a name-keyed dictionary) is required because:

- **~101 commands have a parenthetical disambiguator** reused verbatim as the body anchor
  (e.g. `enable (interface configuration)`) -- stripped into a separate `context` field.
- **21 command names repeat verbatim with no disambiguator**, documenting genuinely different
  syntax under the same bare CLI surface form (e.g. `hw-module beacon` has two entries: one
  taking `{off|on} switch switch-number`, another taking `{rp {active|standby}|slot
slot-number|ssd} {off|on|status}`).

**A candidate anchor line must be told apart from a false one.** Cisco's PDF repeats a
page's _upcoming_ command name as a small running header at the bottom of the page before it
("forecasting" what starts on the next page), and also repeats the _current_ command's name
as a running header on continuation pages of a long, multi-page entry. Both match the same
line shape as a genuine anchor.

- The **general acceptance check** (`isRealAnchor`): a candidate is accepted if any of the
  six section labels (see below) appears within a lookahead window. Several stricter
  alternatives were tried and rejected -- requiring "Syntax Description" specifically;
  requiring it within a small window; requiring it to be the _earliest_ label found -- each
  rejected far more genuine anchors than false ones, because the gap from anchor to "Syntax
  Description" varies too widely across entries (a few hundred characters for a short
  command, 1,000+ for one with a long keyword-alternation syntax block) for any one rule to
  cleanly separate true from false on that signal alone.
- **The specific "forecast header" pattern is corrected after acceptance**
  (`stripLeadingForecastHeader`): when the lenient check above still picks the forecast line
  (this is the common case -- it happens whenever a command starts a fresh page, which is
  often), the chunk's first line repeats `rawName` exactly, then nothing but blank lines,
  then `rawName` again. That specific shape is detected and the leading forecast line +
  blanks are stripped before any field extraction runs. The lookahead window for the second
  occurrence is sized off the name's own length (`rawName.length + 20`), not a fixed
  constant -- a fixed 40-character window was tried first and silently failed for longer
  command names (35+ characters), since the repeated name plus blank lines didn't fit.

## 6. Extracting fields from each chunk

Every command entry follows a fixed structure, anchored on six section-label strings:
`Syntax Description`, `Command Default`, `Command Modes`, `Command History`, `Usage
Guidelines`, `Examples`. Two label-formatting variants exist and both must be recognized:

- **Flush-left with content on the same line** (the common case):
  `Command Modes        Global configuration (config)`.
- **Indented, alone on its own line**, content starting on the next line -- seen for short,
  simple commands (e.g. `fast-detection`'s `Syntax Description` heading, and `Example`/
  `Examples` singular-vs-plural sub-headings for entries with just one example). Matching
  only the flush form caused indented-heading content (e.g. "This command has no keywords or
  arguments.") to leak into whatever the _previous_ found section's text was taken to be.

Per chunk, fields extracted: `name` (parenthetical stripped) + `context` (the stripped
parenthetical, or null); `detail` (the intro sentence, with the "To ... use the X command in
Y mode" boilerplate framing trimmed down to just the action, when that exact phrasing
matches -- phrasing varies enough across entries, e.g. "Configures the ..." instead of "To
...", that this is best-effort, not a hard requirement); `syntax` / `noForm`; `params`
(see "Syntax Description tables" below); `modes` (can list more than one, blank-line-separated; a handful of
EXEC-only commands fold their mode directly into `Command Default`, e.g. `Privileged EXEC
(#)`, instead of a separate `Command Modes` section -- detected and used as a fallback);
`usageSummary` (first 2-3 sentences, stopped before any `Note` callout or the `Examples`
section); `sourcePage`. `Examples` content itself is never extracted into the JSON.

**`extractSyntax` stops collecting lines at the first line that itself looks like a section
label**, regardless of where the computed `headerEnd` boundary falls. This matters because a
few commands skip straight from their syntax line to a later section (e.g. straight to
`Command History`, with no `Syntax Description`/`Command Default`/`Command Modes` in
between to anchor on first) -- without this check, the syntax field swallowed that later
section's heading and content.

## 7. Known limitations (accepted, not fixed)

- **A rare merged/garbled record for some duplicate-named commands.** When a command's body
  straddles a page break right where its own duplicate-name sibling begins (e.g.
  `errdisable recovery cause`, `hw-module beacon`), the chunk boundary can land on a false
  running header instead of the sibling's real anchor, producing one merged record with
  garbled `syntax`/`detail` text and one missing record instead of two clean ones. Multiple
  detection approaches were tried (requiring "Syntax Description" specifically as the
  earliest label; counting repeated "Command History" occurrences; detecting the command
  name recurring anywhere in the chunk) -- each rejected far more good entries than it caught
  bad ones, since the same surface patterns occur routinely in legitimate single entries.
  Given how rare the genuine merge case is against 1,315 commands, it's accepted as-is.
- **A handful of long, niche "show platform hardware/software fed ..." diagnostic commands**
  (mostly in the TrustSec and Interface/Hardware chapters) have names long enough that they
  wrap across lines in both the TOC _and_ the body in ways the wrap-handling above doesn't
  fully reconstruct, or have stray content (e.g. a piped example like `| inc SGACL`) leaked
  into the TOC name itself. These end up in the per-chapter "not extracted" tolerance bucket.
- **Rare PDF text-extraction glue artifacts** at the source: e.g. `area nssa`'s syntax field
  reads "...use the area nssa **command**area area-id nssa..." with a missing space between
  "command" and "area" -- present in the raw `pdftotext` output itself, not introduced by this
  script. Not corrected; flagged here so it isn't mistaken for a parsing bug later.

These known-limitation entries total well under 1% of the 1,315-command pack and were
judged not worth the risk of broader regressions chasing a fully general fix (see the
sequence of rejected attempts in `import_scripts/extract-commands.js`'s comments for specifics).

## 8. Adding a future manual

```
node import_scripts/extract-commands.js <pdf-path> --pack <packId> [--platform "<name>"] [--release "<ver>"]
```

Pick a short `packId` slug (e.g. `cat9300-17.12`). The script fully regenerates that pack's
own `server/data/<packId>/` subdirectory from scratch and never touches another pack's
files. Re-read this document while reviewing the new pack's output, and update it if the new
manual reveals a structural variant the cases above don't already cover.

## Syntax Description tables (`params`)

Parsed by `import_scripts/extract-params.js` (unit-tested in `test/extract-params.test.js`) from
the section text **with its real columns**: `sectionColumns` blanks the label to spaces instead
of cutting it off. Rows are told apart by **indentation**, not only by the 2+ space gap
between name and description — the gap alone lost rows in ~700 commands (2026-10). Quirks
handled, each with a test:

- **Overflowing name**: a name wider than its column (`name vlan_name` in
  `switchport voice vlan`) leaves one space before the description. The row still starts in
  the name column; the description starts where the next (continuation) line starts — but
  only if the text there begins like a description (capital or `(Optional)`), because
  bulleted continuations are indented deeper (`logging console`'s `level`).
- **Page breaks**: the table continues shifted right on the next page (names at column 28
  instead of 21). A row with a clear gap left of the description column re-anchors the
  name/description columns. Page furniture in between (footer "Command Reference, Cisco
  IOS ...", page number, chapter title, running header = command name) is dropped.
- **`Note` callouts** sit in the description column and stay description text, not a
  parameter named "Note".
- **Repeated label**: some entries print "Syntax Description" twice; every occurrence is
  blanked.
- **Long names** (more than four words, e.g. `switch {switch_num | active | standby }`) are
  split at the first wide gap.
- **Rows that repeat the command** (multi-word commands only): `switchport voice
vlanvlan_id Specifies ...` (argument glued on in the PDF) yields `vlan_id`; `switchport
mode access Sets the interface ...` describes the command itself and yields no parameter.
  Single-word commands are excluded — their parameters are often named like them
  (`description`, `exporter` → `exporter-name`).
- A row that can't be split is kept as description text, never turned into a fake parameter;
  "This command has no arguments or keywords." gives an empty `params`.

When changing the parser, regenerate every pack and diff `params` per command against the
previous data (names lost, names grown by a word, junk names, footer text in descriptions)
before committing.
