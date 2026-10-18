'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocMarkdown, orderHoverRecords, platformFooter } = require('../server/lib/docs');
const { buildPackIndex } = require('../server/lib/platform');

const REC = (pack, platform, release) => ({
  name: 'switchport voice vlan',
  pack,
  platform,
  release,
  syntax: 'switchport voice vlan x',
  params: [],
});
const ALL = [
  REC('cat2960x-15.2.6', 'Catalyst 2960-X Switches', '15.2(6)E'),
  REC('cat9500-17.15', 'Catalyst 9500', '17.15.x'),
  REC('cat9500-17.18', 'Catalyst 9500 Switches', '17.18.x'),
];
test('no selection: every record, labelled (today)', () => {
  const r = orderHoverRecords(ALL, { familyPacks: null, preferredPack: null });
  assert.equal(r.records.length, 3);
  assert.equal(r.labelled, true);
});
test('preferred pack only, unlabelled; curated rides along', () => {
  const cur = { ...REC(null, null, null), name: 'ip route' };
  const r = orderHoverRecords([...ALL, cur], {
    familyPacks: new Set(['cat9500-17.15', 'cat9500-17.18']),
    preferredPack: 'cat9500-17.18',
  });
  assert.deepEqual(
    r.records.map((x) => x.pack),
    ['cat9500-17.18', null],
  );
  assert.equal(r.labelled, false);
  // A command only curated documents (`ip route`) still shows, unlabelled.
  const only = orderHoverRecords([cur], {
    familyPacks: new Set(['cat9500-17.18']),
    preferredPack: 'cat9500-17.18',
  });
  assert.deepEqual(
    only.records.map((x) => x.pack),
    [null],
  );
  assert.equal(only.labelled, false);
});
test('falls back to the family, then to everything, labelled', () => {
  const fam = orderHoverRecords(ALL.slice(0, 2), {
    familyPacks: new Set(['cat9500-17.15', 'cat9500-17.18']),
    preferredPack: 'cat9500-17.18',
  });
  assert.deepEqual(
    fam.records.map((x) => x.pack),
    ['cat9500-17.15'],
  );
  assert.equal(fam.labelled, true);
  const other = orderHoverRecords(ALL.slice(0, 1), {
    familyPacks: new Set(['cat9500-17.18']),
    preferredPack: 'cat9500-17.18',
  });
  assert.deepEqual(
    other.records.map((x) => x.pack),
    ['cat2960x-15.2.6'],
  );
  assert.equal(other.labelled, true);
});
test('buildDocMarkdown: label only when asked, footer last', () => {
  const md = buildDocMarkdown([ALL[2]], { labelled: false, footer: '_Platform: X_' });
  assert.ok(!md.includes('**Catalyst 9500 Switches 17.18.x**'));
  assert.ok(md.endsWith('\n\n---\n\n_Platform: X_'));
  assert.ok(
    buildDocMarkdown([ALL[2]], { labelled: true }).startsWith('**Catalyst 9500 Switches 17.18.x**'),
  );
  assert.ok(buildDocMarkdown(ALL).startsWith('**Catalyst 2960-X Switches 15.2(6)E**'));
});
test('platformFooter names platform, release label and source', () => {
  const idx = buildPackIndex(ALL);
  assert.equal(
    platformFooter({ source: 'version' }, idx, 'cat9500-17.18'),
    '_Platform: Catalyst 9500 Switches 17.18 — from the version line_',
  );
  assert.match(
    platformFooter({ source: 'directive' }, idx, 'cat9500-17.15'),
    /Catalyst 9500 17\.15 — from the `!!#` directive_$/,
  );
});

test('orderHoverRecords treats a curated record without a pack field as curated', () => {
  const { orderHoverRecords } = require('../server/lib/docs');
  const curated = { name: 'x' };
  const other = { name: 'x', pack: 'cat9500-17.15' };
  const out = orderHoverRecords([curated, other], {
    familyPacks: new Set(['cat9500-17.15']),
    preferredPack: 'cat2960x-15.2.6',
  });
  assert.deepEqual(out.records, [curated]);
});
test('findHoverRecords on a narrowed map finds the shorter own name before a longer foreign one', () => {
  const { findHoverRecords } = require('../server/lib/docs');
  const own = new Map([['ip igmp snooping', [{ pack: 'cat9500-17.15' }]]]);
  const all = new Map([
    ...own,
    ['ip igmp snooping robustness-variable', [{ pack: 'cat3850-16.12' }]],
  ]);
  const tokens = 'ip igmp snooping robustness-variable 3'.split(' ');
  assert.equal(
    findHoverRecords(tokens, { commandsByName: own, maxCommandWords: 4 })[0].pack,
    'cat9500-17.15',
  );
  assert.equal(
    findHoverRecords(tokens, { commandsByName: all, maxCommandWords: 4 })[0].pack,
    'cat3850-16.12',
  );
});
