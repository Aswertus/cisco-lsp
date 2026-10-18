'use strict';

// Table of contents from the PDF's bookmark outline — the fallback for manuals
// without a front-matter "CONTENTS" section (first seen in the Catalyst 3850
// IOS XE 16.12 Command Reference; see import_scripts/EXTRACTION_NOTES.md §2).
//
// `pdftohtml -xml` prints the outline as nested <outline> blocks of
// <item page="N">title</item> lines. In Cisco's manuals the nesting is sloppy:
// each chapter's block opens inside the previous chapter's, so depth grows by
// one per chapter rather than chapters being siblings. The tree is therefore
// rebuilt from the rule that still holds — an item's parent is the nearest
// preceding item exactly one level up — and a chapter is any item whose direct
// children include leaves (items without children of their own). Those leaves
// are its entries; chapters with no leaves (a section that only holds
// subsections) are dropped. Page numbers are physical PDF pages (the viewer's
// page), not the printed folio the master TOC uses.

const { execFileSync } = require('child_process');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#')
      return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// A back-of-book index is bookmarked as one single-letter item per letter.
const INDEX_LETTER_RE = /^[A-Z]$/;

function parseOutlineXml(xml) {
  const tokens = xml.match(/<outline>|<\/outline>|<item page="\d+">[^<]*<\/item>/g) || [];
  const items = [];
  let depth = -1;
  for (const t of tokens) {
    if (t === '<outline>') {
      depth++;
      continue;
    }
    if (t === '</outline>') {
      depth--;
      continue;
    }
    const m = /<item page="(\d+)">([^<]*)<\/item>/.exec(t);
    items.push({ depth, page: Number(m[1]), name: decodeEntities(m[2]).trim(), children: [] });
  }

  for (let k = 0; k < items.length; k++) {
    for (let j = k - 1; j >= 0; j--) {
      if (items[j].depth === items[k].depth - 1) {
        items[j].children.push(items[k]);
        break;
      }
      if (items[j].depth < items[k].depth - 1) break;
    }
  }

  const chapters = [];
  for (const item of items) {
    const entries = item.children
      .filter((c) => c.children.length === 0 && !INDEX_LETTER_RE.test(c.name))
      .map((c) => ({ name: c.name, page: c.page }));
    if (entries.length > 0) chapters.push({ title: item.name, entries });
  }
  return chapters;
}

// Reads just the first page (-l 1) — the outline is printed regardless of the
// page range, and rendering the whole manual would take minutes.
function readOutlineToc(pdfPath) {
  const xml = execFileSync('pdftohtml', ['-xml', '-i', '-l', '1', '-stdout', pdfPath], {
    maxBuffer: 256 * 1024 * 1024,
    encoding: 'utf8',
  });
  return parseOutlineXml(xml);
}

module.exports = { parseOutlineXml, readOutlineToc };
