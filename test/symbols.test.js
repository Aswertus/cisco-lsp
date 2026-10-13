'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildDocumentSymbols } = require('../server/lib/symbols');

const CONFIG = [
  /* 0 */ 'interface GigabitEthernet0/1',
  /* 1 */ ' description uplink',
  /* 2 */ ' no shutdown',
  /* 3 */ 'interface GigabitEthernet0/1.10',
  /* 4 */ ' encapsulation dot1Q 10',
  /* 5 */ 'router bgp 65000',
  /* 6 */ ' address-family ipv4',
  /* 7 */ '  network 10.0.0.0 mask 255.0.0.0',
  /* 8 */ 'class-map match-any VOICE',
  /* 9 */ ' match dscp ef',
];

test('block symbols span their whole block, grouped by category', () => {
  const syms = buildDocumentSymbols(CONFIG, {});
  const byName = new Map(syms.map((s) => [s.name, s]));

  const iface = byName.get('interface');
  const gi = iface.children.find((c) => c.name === 'GigabitEthernet0/1');
  // Full block range (incl. the adopted sub-interface), selection = header line.
  assert.equal(gi.range.start.line, 0);
  assert.equal(gi.range.end.line, 4);
  assert.equal(gi.selectionRange.end.line, 0);

  // Sub-interface nests under its parent interface.
  assert.deepEqual(gi.children.map((c) => c.name), ['GigabitEthernet0/1.10']);

  // address-family nests under the router bgp entry.
  const bgp = byName.get('router bgp').children[0];
  assert.equal(bgp.name, '65000');
  assert.deepEqual(bgp.children.map((c) => c.name), ['ipv4']);
  assert.equal(bgp.range.end.line, 7);

  // class-map label omits the match-any prefix.
  assert.deepEqual(byName.get('class-map').children.map((c) => c.name), ['VOICE']);
});

test('per-category toggles suppress matching symbols', () => {
  const syms = buildDocumentSymbols(CONFIG, { interface: false, sub_interface: false });
  assert.deepEqual(syms.map((s) => s.name), ['router bgp', 'class-map']);
});

test('prompt commands become top-level groups', () => {
  const syms = buildDocumentSymbols(['SW1#configure terminal', 'interface Gi0/1', ' shutdown'], {});
  assert.equal(syms.length, 1);
  assert.equal(syms[0].name, 'configure terminal');
  assert.deepEqual(syms[0].children.map((c) => c.name), ['interface']);
});
