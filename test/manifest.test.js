'use strict';

// The extension manifest references files that VS Code loads at runtime. A path that is
// wrong or excluded from the .vsix fails silently (VS Code just shows no icon), so check
// them here, where a failure is loud.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function assertShipped(relPath) {
  const abs = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(abs), `${relPath} is referenced by package.json but does not exist`);
  const ignore = fs
    .readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const top = relPath.replace(/^\.\//, '').split('/')[0];
  for (const pattern of ignore) {
    assert.notEqual(
      pattern,
      relPath.replace(/^\.\//, ''),
      `${relPath} is excluded from the .vsix by .vscodeignore`,
    );
    assert.notEqual(
      pattern,
      `${top}/**`,
      `${relPath} is excluded from the .vsix by .vscodeignore (${pattern})`,
    );
  }
}

test('every language icon in package.json exists, is an SVG and ships in the .vsix', () => {
  const languages = pkg.contributes.languages;
  assert.ok(languages.length > 0);
  for (const lang of languages) {
    assert.ok(lang.icon, `language "${lang.id}" has no icon`);
    for (const theme of ['light', 'dark']) {
      const rel = lang.icon[theme];
      assert.ok(rel, `language "${lang.id}" icon has no "${theme}" entry`);
      assert.match(rel, /\.svg$/, `language icon ${rel} must be an SVG`);
      assertShipped(rel);
      const svg = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.match(
        svg,
        /^<svg[^>]*\sviewBox="0 0 32 32"/,
        `${rel} must be a 32×32 SVG (Material Icon Theme grid)`,
      );
      assert.doesNotMatch(
        svg,
        /data:image|<image/,
        `${rel} must be pure vector, no embedded bitmap`,
      );
    }
  }
});
