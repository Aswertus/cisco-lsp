---
name: reference-import-manual
description: Where to find the procedure for ingesting a new Cisco IOS/IOS-XE command-reference PDF (new platform or release) into this extension's command data
metadata:
  type: reference
---

The full procedure lives in `CLAUDE.md`'s "Regenerating Command Data" section — read that
first, it covers the invocation, the `packId` convention, and what gets kept in sync
automatically. `scripts/EXTRACTION_NOTES.md` documents the PDF's structural quirks
(running headers, wrapped TOC lines, duplicate-name entries, indented vs. flush section
labels) discovered while building the extractor — read it before touching
`scripts/extract-commands.js` itself, since these quirks are exactly what a new manual is
likely to also hit.

Quick shape of the command (see CLAUDE.md for the full explanation):

```bash
# poppler-utils (pdftotext/pdfinfo) required — system package, not npm
# drop the PDF into _manuals/ (gitignored) first, then:
npm run extract-commands -- _manuals/<file>.pdf --pack <packId> \
  --platform "<Platform name>" --release "<IOS-XE release>"
npm run format
```

One `packId` per platform+release (e.g. `cat9500-17.15`); the script only touches that
pack's own `server/data/<packId>/` directory, regenerates `COMMAND_COVERAGE.md`'s section for
it, adds new words to `cspell.json`, and updates the grammar's `command_root` rule — all
re-derived from whatever's currently under `server/data/**`, not just the new pack.

See [[feedback_surgical_staging]] if the files this touches (`cspell.json`, `CLAUDE.md`,
`package.json`, etc.) already have unrelated pending edits sitting in the working tree.
