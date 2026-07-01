'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectBlock } = require('../server/lib/blocks');

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
