'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  scanIndentation,
  findIndentUnit,
  computeFormattingEdits,
  computeFoldingRanges,
} = require('../server/lib/indentation');
const { openerBlockType } = require('../server/lib/blocks');

// Small fixture standing in for buildData()'s pack-derived isChildCommand.
const FLUSH_CHILDREN = new Map([
  ['interface', ['description', 'shutdown', 'spanning-tree bpdufilter', 'ip address']],
  ['vlan', ['name']],
  ['service-template', ['inactivity-timer']],
]);
const flushOpts = {
  openerBlockType,
  isChildCommand: (block, text) => {
    const t = text.toLowerCase();
    return (FLUSH_CHILDREN.get(block) || []).some((n) => t === n || t.startsWith(n + ' '));
  },
};

function scan(lines) {
  const mismatches = [];
  const mixed = [];
  scanIndentation(
    lines,
    (i, indent, expected) => mismatches.push({ i, indent, expected }),
    (i, leadingLength) => mixed.push({ i, leadingLength }),
  );
  return { mismatches, mixed };
}

// Applies the leading-whitespace edits computeFormattingEdits produces (each
// edit replaces line[0..end.character] on a single line).
function applyEdits(lines, edits) {
  const out = [...lines];
  for (const e of edits) {
    const i = e.range.start.line;
    out[i] = e.newText + out[i].slice(e.range.end.character);
  }
  return out;
}

test('consistent file produces no findings', () => {
  const { mismatches, mixed } = scan([
    'interface GigabitEthernet1/0/1',
    ' description uplink',
    ' switchport access vlan 10',
    '!',
    'router bgp 65000',
    ' neighbor 10.0.0.1 remote-as 65001',
    '',
  ]);
  assert.deepEqual(mismatches, []);
  assert.deepEqual(mixed, []);
});

test('later sibling disagreeing with established indent is flagged', () => {
  const { mismatches } = scan([
    'interface GigabitEthernet1/0/1',
    '  description uplink',
    ' switchport access vlan 10', // 1 space vs established 2
  ]);
  assert.deepEqual(mismatches, [{ i: 2, indent: 1, expected: 2 }]);
});

test('a deeper line starts a new nested level and is not a mismatch', () => {
  const { mismatches } = scan([
    'policy-map PM',
    ' class CM',
    '  police 1000000', // deeper than previous line → new level, fine
  ]);
  assert.deepEqual(mismatches, []);
});

test('mixed tabs/spaces is flagged and excluded from the sibling check', () => {
  const { mismatches, mixed } = scan([
    'interface GigabitEthernet1/0/1',
    '  description uplink',
    ' \tshutdown', // mixed leading whitespace, depth also differs
  ]);
  assert.deepEqual(mixed, [{ i: 2, leadingLength: 2 }]);
  assert.deepEqual(mismatches, []);
});

test('blank and comment lines do not interrupt a block', () => {
  const { mismatches } = scan([
    'interface GigabitEthernet1/0/1',
    '  description uplink',
    '! comment',
    '',
    ' switchport access vlan 10',
  ]);
  assert.deepEqual(mismatches, [{ i: 4, indent: 1, expected: 2 }]);
});

test('formatter round-trip: applying the edits yields a clean, stable file', () => {
  const lines = [
    'interface GigabitEthernet1/0/1',
    '  description uplink',
    ' ip address 10.0.0.1 255.255.255.0', // sibling mismatch → snaps to 2
    'interface GigabitEthernet1/0/2',
    ' \tshutdown', // mixed tabs → same width, spaces only
  ];
  const edits = computeFormattingEdits(lines);
  assert.equal(edits.length, 2);

  const fixed = applyEdits(lines, edits);
  assert.equal(fixed[2], '  ip address 10.0.0.1 255.255.255.0');
  assert.equal(fixed[4], '  shutdown');

  // Idempotent: a fixed file produces no further edits or findings.
  assert.deepEqual(computeFormattingEdits(fixed), []);
  const { mismatches, mixed } = scan(fixed);
  assert.deepEqual(mismatches, []);
  assert.deepEqual(mixed, []);
});

test('flush-left block children are indented, matching the file\'s own indent width', () => {
  const lines = [
    'interface GigabitEthernet0/0',
    'spanning-tree bpdufilter',
    'no shutdown',
    '',
    'interface GigabitEthernet0/1',
    '  description LAN',
    '  no shutdown',
  ];
  const edits = computeFormattingEdits(lines, flushOpts);
  assert.equal(edits.length, 2);

  const fixed = applyEdits(lines, edits);
  // The file's own blocks indent by 2, so the flush children snap to 2.
  assert.equal(fixed[1], '  spanning-tree bpdufilter');
  assert.equal(fixed[2], '  no shutdown');
  assert.equal(fixed[5], '  description LAN'); // already-indented block untouched

  // Idempotent: the fixed file produces no further edits.
  assert.deepEqual(computeFormattingEdits(fixed, flushOpts), []);
});

test('flush children in a file with no indented blocks default to 1 space', () => {
  const lines = ['interface GigabitEthernet0/0', 'shutdown'];
  const fixed = applyEdits(lines, computeFormattingEdits(lines, flushOpts));
  assert.equal(fixed[1], ' shutdown');
  assert.equal(findIndentUnit(lines), 1);
});

test('a line without child evidence ends the flush block and is left alone', () => {
  // Mirrors _testing/test.cisco:359-373 — service-template blocks appear
  // back-to-back with no !/blank separator, directly followed by global
  // commands like `dot1x system-auth-control`.
  const lines = [
    'service-template WEBAUTH',
    'inactivity-timer 3600',
    'dot1x system-auth-control',
    'service-template CRITICAL',
    'service-template CRITICAL2',
  ];
  const edits = computeFormattingEdits(lines, flushOpts);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].range.start.line, 1);
});

test('flush evidence is per-block: `name` under vlan yes, a global command no', () => {
  assert.equal(computeFormattingEdits(['vlan 100', 'name SERVERS'], flushOpts).length, 1);
  assert.deepEqual(computeFormattingEdits(['vlan 100', 'ip routing'], flushOpts), []);
});

test('separators and exit/end terminate a flush block', () => {
  assert.deepEqual(
    computeFormattingEdits(['interface GigabitEthernet1/0/1', '!', 'shutdown'], flushOpts),
    [],
  );
  assert.deepEqual(
    computeFormattingEdits(['interface GigabitEthernet1/0/1', 'exit', 'shutdown'], flushOpts),
    [],
  );
});

test('an already-indented file produces no flush edits', () => {
  const lines = [
    'interface GigabitEthernet1/0/1',
    ' description uplink',
    ' shutdown',
    '!',
    'vlan 100',
    ' name SERVERS',
  ];
  assert.deepEqual(computeFormattingEdits(lines, flushOpts), []);
});

test('scanIndentation reports flush children to onLine with the isFlushChild flag', () => {
  const flags = [];
  scanIndentation(
    ['interface GigabitEthernet1/0/1', 'description LAN', 'hostname SW1'],
    () => {},
    () => {},
    (i, line, trimmed, indent, isFlushChild) => flags.push([i, !!isFlushChild]),
    { ...flushOpts, onMissingIndent: () => {} },
  );
  assert.deepEqual(flags, [
    [0, false],
    [1, true], // evidence: `description` is an interface command
    [2, false], // no evidence: `hostname` ended the block
  ]);
});

test('folding ranges follow indentation blocks, spanning ! separators but not ending on them', () => {
  const ranges = computeFoldingRanges([
    /* 0 */ 'interface GigabitEthernet1/0/1',
    /* 1 */ ' description uplink',
    /* 2 */ ' !',
    /* 3 */ ' switchport access vlan 10',
    /* 4 */ '!',
    /* 5 */ 'hostname SW1',
    /* 6 */ 'policy-map PM',
    /* 7 */ ' class CM',
    /* 8 */ '  priority percent 30',
  ]);
  ranges.sort((a, b) => a.startLine - b.startLine);
  assert.deepEqual(ranges, [
    { startLine: 0, endLine: 3 }, // folds across the indented `!`, ends before line 4
    { startLine: 6, endLine: 8 },
    { startLine: 7, endLine: 8 }, // nested class block folds independently
  ]);
});
