'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectBlock, openerBlockType } = require('../server/lib/blocks');

const CONFIG = [
  /* 0 */ 'hostname SW1',
  /* 1 */ 'interface GigabitEthernet1/0/1',
  /* 2 */ ' description uplink',
  /* 3 */ '!',
  /* 4 */ 'router bgp 65000',
  /* 5 */ ' neighbor 10.0.0.1 remote-as 65001',
  /* 6 */ 'class-map match-any CM',
  /* 7 */ ' match dscp ef',
  /* 8 */ 'policy-map PM',
  /* 9 */ ' class CM',
  /* 10 */ 'line vty 0 4',
  /* 11 */ ' transport input ssh',
  /* 12 */ '',
  /* 13 */ '! comment',
  /* 14 */ ' after-comment-indented',
];

test('detects each block type from an indented line', () => {
  assert.equal(detectBlock(CONFIG, 2), 'interface');
  assert.equal(detectBlock(CONFIG, 5), 'router');
  assert.equal(detectBlock(CONFIG, 7), 'class-map');
  assert.equal(detectBlock(CONFIG, 9), 'policy-map');
  assert.equal(detectBlock(CONFIG, 11), 'line');
});

test('column-0 line after a plain column-0 command is global scope', () => {
  assert.equal(detectBlock(CONFIG, 0), 'global');
  assert.equal(detectBlock(['hostname SW1', 'ntp server 10.0.0.1'], 1), 'global');
});

test('column-0 line right after a block header stays in that block (unindented transcript style)', () => {
  // Deliberate: only a column-0 NON-block line resets to global, so pasted
  // session transcripts (where sub-commands are not indented) still get
  // block-aware completions.
  assert.equal(detectBlock(['interface GigabitEthernet1/0/1', 'ip address 10.0.0.1'], 1), 'interface');
});

test('blank and comment lines are skipped when walking up to the header', () => {
  // Line 14 is indented; the walk skips the comment (13) and blank (12) and
  // reaches "line vty 0 4" (10) as the nearest less-indented header.
  assert.equal(detectBlock(CONFIG, 14), 'line');
});

test('indented line under a non-block header falls back to global', () => {
  const lines = ['banner motd ^C', ' welcome', '^C'];
  assert.equal(detectBlock(lines, 1), 'global');
});

test('openerBlockType recognises the extended block-opener set', () => {
  assert.equal(openerBlockType('interface GigabitEthernet1/0/1'), 'interface');
  assert.equal(openerBlockType('router bgp 65000'), 'router');
  assert.equal(openerBlockType('line vty 0 4'), 'line');
  assert.equal(openerBlockType('vrf definition CUST-A'), 'vrf');
  assert.equal(openerBlockType('vlan 100'), 'vlan');
  assert.equal(openerBlockType('flow exporter EXP-1'), 'flow-exporter');
  assert.equal(openerBlockType('flow record REC-1'), 'flow-record');
  assert.equal(openerBlockType('service-template WEBAUTH'), 'service-template');
  assert.equal(openerBlockType('route-map RM-OUT permit 10'), 'route-map');
  assert.equal(openerBlockType('ip access-list extended ACL-IN'), 'access-list');
  assert.equal(openerBlockType('aaa group server tacacs+ DNAC-GROUP'), 'aaa-group');
  assert.equal(openerBlockType('key chain KC-OSPF'), 'key-chain');
});

test('openerBlockType rejects look-alike one-liners and sub-commands', () => {
  assert.equal(openerBlockType('vlan internal allocation policy ascending'), null);
  assert.equal(openerBlockType('no shutdown'), null);
  assert.equal(openerBlockType('description uplink'), null);
  assert.equal(openerBlockType('hostname SW1'), null);
  assert.equal(openerBlockType('ip access-group ACL-IN in'), null);
  assert.equal(openerBlockType('switchport access vlan 10'), null);
});

test('detectBlock recognises the new block headers for completions', () => {
  assert.equal(detectBlock(['vrf definition CUST-A', ' rd 1:1'], 1), 'vrf');
  assert.equal(detectBlock(['vlan 100', ' name SERVERS'], 1), 'vlan');
  assert.equal(detectBlock(['flow exporter EXP-1', ' destination 10.0.0.1'], 1), 'flow-exporter');
});
