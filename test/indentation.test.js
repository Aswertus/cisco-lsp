'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scanIndentation, computeFormattingEdits } = require('../server/lib/indentation');

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
