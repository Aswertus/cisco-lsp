'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DiagnosticSeverity } = require('vscode-languageserver/node');
const {
  packFamily,
  packRelease,
  releaseLabel,
  buildPackIndex,
  resolveFamily,
  parseVersionLine,
  parseDirective,
  detectPlatform,
  selectPacks,
  completeDirective,
} = require('../server/lib/platform');

const R = (name, pack, platform) => ({ name, pack, platform, release: null, modes: [] });
const RECORDS = [
  R('switchport voice vlan', 'cat2960x-15.2.6', 'Catalyst 2960-X Switches'),
  R('switchport voice vlan', 'cat3850-16.12', 'Catalyst 3850 Switches'),
  R('switchport voice vlan', 'cat9500-17.15', 'Catalyst 9500'),
  R('switchport voice vlan', 'cat9500-17.18', 'Catalyst 9500 Switches'),
  R('stackwise-virtual', 'cat9500-26.x', 'Catalyst 9500 Switches'),
  R('mls qos', 'cat2960x-15.2.6', 'Catalyst 2960-X Switches'),
  R('ip route', null, null),
];
const pick = (p) => [p.family, p.source];

test('packFamily / packRelease / releaseLabel read the pack id', () => {
  assert.equal(packFamily('cat9500-17.15'), 'cat9500');
  assert.deepEqual(packRelease('cat9500-26.x'), [26]);
  assert.deepEqual(packRelease('cat2960x-15.2.6'), [15, 2, 6]);
  assert.equal(releaseLabel('cat9500-26.x'), '26.x');
});
test('buildPackIndex groups packs by family, sorted by release, curated skipped', () => {
  const idx = buildPackIndex(RECORDS);
  assert.deepEqual([...idx.families.keys()].sort(), ['cat2960x', 'cat3850', 'cat9500']);
  assert.deepEqual(
    idx.families.get('cat9500').map((p) => p.id),
    ['cat9500-17.15', 'cat9500-17.18', 'cat9500-26.x'],
  );
  assert.equal(idx.packs.get('cat9500-17.18').platform, 'Catalyst 9500 Switches');
});
test('resolveFamily: case, aliases, unknown', () => {
  const idx = buildPackIndex(RECORDS);
  assert.equal(resolveFamily('CAT9500', idx), 'cat9500');
  assert.equal(resolveFamily('cat9300', idx), 'cat9500');
  assert.equal(resolveFamily('cat3750', idx), null);
});
test('parseVersionLine: major.minor from IOS and IOS-XE, patch suffix ignored, indented ignored', () => {
  assert.deepEqual(parseVersionLine('version 15.2'), [15, 2]);
  assert.deepEqual(parseVersionLine('version 17.15.1a'), [17, 15]);
  assert.equal(parseVersionLine(' version 17.15'), null);
  assert.equal(parseVersionLine('version'), null);
});
test('parseDirective: valid forms, case and CRLF/trailing space', () => {
  assert.deepEqual(
    parseDirective('!!# cisco-ios-lsp platform cat9500 17.18').familyWord,
    'cat9500',
  );
  assert.deepEqual(parseDirective('!!# cisco-ios-lsp platform cat9500 17.18').release, [17, 18]);
  assert.equal(parseDirective('!!# CISCO-IOS-LSP PLATFORM CAT9300\r').familyWord, 'CAT9300');
  assert.equal(parseDirective('!!# cisco-ios-lsp platform cat9500   ').releaseWord, null);
  assert.equal(parseDirective('!!# cisco-ios-lsp platform cat9500 17.18 extra words').ok, true);
});
test('parseDirective: not a directive vs broken directive', () => {
  assert.equal(parseDirective('! cisco-ios-lsp platform cat9500'), null);
  assert.equal(parseDirective('!!# just a comment'), null);
  assert.deepEqual(parseDirective('!!# cisco-ios-lsp platform'), {
    ok: false,
    reason: 'syntax',
    range: [26, 26],
  });
  assert.equal(parseDirective('!!# cisco-ios-lsp cat9500').reason, 'syntax');
});
test('detectPlatform: directive wins, later directives flagged, invalid directive falls through', () => {
  const idx = buildPackIndex(RECORDS);
  const a = detectPlatform(
    [
      'version 15.2',
      '!!# cisco-ios-lsp platform cat9300 17.18',
      '!!# cisco-ios-lsp platform cat2960x',
    ],
    idx,
  );
  assert.equal(a.family, 'cat9500');
  assert.equal(a.source, 'directive');
  assert.equal(a.line, 1);
  assert.equal(a.diagnostics.length, 1);
  assert.match(a.diagnostics[0].message, /already set on line 2/);
  const b = detectPlatform(['!!# cisco-ios-lsp platform cat3750', 'version 17.15'], idx);
  assert.equal(b.family, 'cat9500');
  assert.equal(b.source, 'version');
  assert.equal(b.diagnostics[0].severity, DiagnosticSeverity.Warning);
  assert.match(b.diagnostics[0].message, /cat3750.*cat2960x, cat3850, cat9500/);
});
test('detectPlatform: version line → family by major; unknown major → nothing; banner body ignored', () => {
  const idx = buildPackIndex(RECORDS);
  assert.deepEqual(pick(detectPlatform(['version 16.12'], idx)), ['cat3850', 'version']);
  assert.deepEqual(pick(detectPlatform(['version 17.3'], idx)), ['cat9500', 'version']);
  assert.deepEqual(pick(detectPlatform(['version 12.4'], idx)), [null, null]);
  assert.deepEqual(
    pick(detectPlatform(['banner motd ^C', 'version 15.2', '^C', 'hostname x'], idx)),
    [null, null],
  );
  assert.deepEqual(pick(detectPlatform(['hostname x'], idx)), [null, null]);
});
test('selectPacks: preferred pack by release, family set is the whole family', () => {
  const idx = buildPackIndex(RECORDS);
  assert.equal(selectPacks(idx, 'cat9500', [17, 16]).preferredPack, 'cat9500-17.15');
  assert.equal(selectPacks(idx, 'cat9500', [17, 3]).preferredPack, 'cat9500-17.15');
  assert.equal(selectPacks(idx, 'cat9500', [26, 1]).preferredPack, 'cat9500-26.x');
  assert.equal(selectPacks(idx, 'cat9500', null).preferredPack, 'cat9500-26.x');
  assert.deepEqual([...selectPacks(idx, 'cat9500', null).familyPacks].sort(), [
    'cat9500-17.15',
    'cat9500-17.18',
    'cat9500-26.x',
  ]);
});
test('completeDirective: word by word', () => {
  const idx = buildPackIndex(RECORDS);
  const labels = (p) => completeDirective(p, idx).items.map((i) => i.label);
  assert.deepEqual(labels('!!#'), ['cisco-ios-lsp']);
  assert.deepEqual(labels('!!# cis'), ['cisco-ios-lsp']);
  assert.equal(completeDirective('!!# cis', idx).tokenStart, 4);
  assert.deepEqual(labels('!!# cisco-ios-lsp '), ['platform']);
  assert.ok(labels('!!# cisco-ios-lsp platform ').includes('cat9500'));
  assert.ok(labels('!!# cisco-ios-lsp platform ').includes('cat9300'));
  assert.deepEqual(labels('!!# cisco-ios-lsp platform cat9300 '), ['17.15', '17.18', '26.x']);
  assert.deepEqual(labels('!!# cisco-ios-lsp platform cat9500 17.18 '), []);
  assert.equal(completeDirective('interface Gi1/0/1', idx), null);
  assert.equal(completeDirective('banner motd #', idx), null);
});

test('reference configs gain no diagnostic above Hint when narrowed', (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { buildData } = require('../server/lib/data');
  const { computeDiagnostics } = require('../server/lib/diagnostics');
  const { openerBlockType } = require('../server/lib/blocks');
  const dir = path.join(__dirname, '../_testing/_reference-config');
  if (!fs.existsSync(dir)) return t.skip('no _testing/_reference-config');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cisco'));
  if (files.length === 0) return t.skip('no reference configs');
  const silentLog = { log() {}, error() {} };
  const data = buildData(path.join(__dirname, '../server/data'), silentLog);
  const ctx = { openerBlockType, isChildCommand: data.isChildCommand };
  let hints = 0;
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    const platform = detectPlatform(lines, data.packIndex);
    assert.notEqual(platform.source, null, 'platform not detected');
    const { familyPacks } = selectPacks(data.packIndex, platform.family, platform.release);
    assert.ok(familyPacks.size > 0);
    const view = data.forFamily(platform.family);
    const key = (d) => `${d.range.start.line}:${d.message}`;
    const today = new Set(computeDiagnostics(lines, data.knownTopLevel, ctx, {}).map(key));
    const narrowed = computeDiagnostics(lines, view.knownTopLevel, ctx, {
      knownElsewhere: view.knownElsewhere,
    });
    for (const d of narrowed) {
      if (d.severity === DiagnosticSeverity.Hint) hints++;
      else
        assert.ok(today.has(key(d)), `new diagnostic above Hint at line ${d.range.start.line + 1}`);
    }
  }
  t.diagnostic(`Hint count: ${hints}`);
});

test('parseDirective accepts no whitespace between !!# and cisco-ios-lsp', () => {
  assert.equal(parseDirective('!!#cisco-ios-lsp platform cat9500').ok, true);
});
test('completing word by word from "!!#" builds a line detectPlatform accepts', () => {
  const idx = buildPackIndex(RECORDS);
  // The server mirrors insertText into textEditText for editRange clients (the lib
  // does not know the client capability).
  let line = '!!#';
  const choose = [null, 'platform', 'cat9500', '17.18'];
  for (let step = 0; step < choose.length; step++) {
    const { items, tokenStart } = completeDirective(line, idx);
    const item = choose[step] ? items.find((i) => i.label === choose[step]) : items[0];
    assert.ok(item, `step ${step} offers ${choose[step]}`);
    line = line.slice(0, tokenStart) + (item.insertText ?? item.label) + ' ';
    if (step === 0) assert.equal(line, '!!# cisco-ios-lsp ');
  }
  const p = detectPlatform([line], idx);
  assert.equal(p.source, 'directive');
  assert.equal(p.family, 'cat9500');
});

test('detectPlatform: a release word that is not a version warns; the family still applies', () => {
  const idx = buildPackIndex(RECORDS);
  const p = detectPlatform(['!!# cisco-ios-lsp platform cat9500 17-18'], idx);
  assert.equal(p.family, 'cat9500');
  assert.equal(p.source, 'directive');
  assert.equal(p.release, null);
  assert.equal(p.diagnostics.length, 1);
  assert.equal(p.diagnostics[0].severity, DiagnosticSeverity.Warning);
  assert.match(p.diagnostics[0].message, /17-18/);
  assert.equal(p.diagnostics[0].range.start.character, 35);
  assert.equal(p.diagnostics[0].range.end.character, 40);
});

test('parseDirective: release words accepted whole or not at all', () => {
  const rel = (w) => parseDirective(`!!# cisco-ios-lsp platform cat9500 ${w}`).release;
  assert.deepEqual(rel('17.18'), [17, 18]);
  assert.deepEqual(rel('26.x'), [26]);
  assert.deepEqual(rel('15.2(6)E'), [15, 2]);
  assert.equal(rel('17-18'), null);
  assert.equal(rel('latest'), null);
});
