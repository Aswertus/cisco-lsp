'use strict';

// Writes dist/CHANGELOG.md, the changelog packed into the .vsix (and so shown on the
// Marketplace and Open VSX "Changes" tab). It is CHANGELOG.md minus an *empty*
// `## [Unreleased]` section: Keep a Changelog keeps that heading as a permanent slot at the
// top of the repo file, but on a store page, which only ever shows released versions, it
// reads like a mistake. An Unreleased section that has entries is kept, so nothing written
// down is ever dropped silently. It lives in dist/ because vsce only accepts a
// --changelog-path inside the packaged files (build/ is excluded); the repo's own
// CHANGELOG.md is excluded in .vscodeignore so the two don't clash in the .vsix.
//
// Usage: node scripts/store-changelog.js   (run by `npm run package`)

const fs = require('node:fs');
const path = require('node:path');

// `## [Unreleased]` followed only by blank lines up to the next `## ` heading or the end.
const EMPTY_UNRELEASED = /^## \[Unreleased\][^\n]*\n(?:[ \t]*\n)*(?=## |$(?![\s\S]))/m;

function stripEmptyUnreleased(text) {
  if (!EMPTY_UNRELEASED.test(text)) return text;
  return text.replace(EMPTY_UNRELEASED, '').replace(/^\[Unreleased\]:[^\n]*\n/m, '');
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const out = path.join(root, 'dist', 'CHANGELOG.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    stripEmptyUnreleased(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')),
  );
  console.log(`store-changelog: wrote ${path.relative(root, out)}`);
}

module.exports = { stripEmptyUnreleased };
