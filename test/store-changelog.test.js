'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripEmptyUnreleased } = require('../scripts/store-changelog');

const HEAD = '# Changelog\n\nIntro.\n\n';
const V1 = '## [1.0.0] - 2026-01-01\n\n### Added\n\n- Thing.\n';

test('an empty Unreleased section is dropped', () => {
  assert.equal(stripEmptyUnreleased(`${HEAD}## [Unreleased]\n\n${V1}`), HEAD + V1);
});

test('an empty Unreleased section and its link reference are dropped', () => {
  const links =
    '\n[Unreleased]: https://example.com/compare/v1.0.0...HEAD\n[1.0.0]: https://example.com/v1\n';
  assert.equal(
    stripEmptyUnreleased(`${HEAD}## [Unreleased]\n\n${V1}${links}`),
    `${HEAD}${V1}\n[1.0.0]: https://example.com/v1\n`,
  );
});

test('an Unreleased section with entries is kept as is', () => {
  const text = `${HEAD}## [Unreleased]\n\n### Fixed\n\n- Pending.\n\n${V1}`;
  assert.equal(stripEmptyUnreleased(text), text);
});

test('the real CHANGELOG.md keeps every released version', () => {
  const real = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const versions = (s) => s.match(/^## \[\d[^\]]*\]/gm);
  assert.deepEqual(versions(stripEmptyUnreleased(real)), versions(real));
});
