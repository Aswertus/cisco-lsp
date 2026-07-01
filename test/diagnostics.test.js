'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeDiagnostics, isValidIpv4 } = require('../server/lib/diagnostics');

const KNOWN = new Set(['hostname', 'interface', 'vlan', 'ip', 'no', 'end']);

function diags(lines) {
  return computeDiagnostics(lines, KNOWN);
}
function spans(list) {
  return list.map((d) => [d.range.start.line, d.range.start.character, d.range.end.character]);
}

test('unknown top-level command is flagged at column 0, sub-mode lines are not', () => {
  const out = diags(['interfacs GigabitEthernet1/0/1', 'interface GigabitEthernet1/0/1', ' bogus-subcommand x']);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /interfacs/);
  assert.deepEqual(spans(out), [[0, 0, 'interfacs'.length]]);
});

test('invalid interface type squiggles the type token, not an earlier occurrence', () => {
  const out = diags(['interface Gigabt1/0/2']);
  assert.equal(out.length, 1);
  assert.deepEqual(spans(out), [[0, 'interface '.length, 'interface Gigabt1/0/2'.length]]);
});

test('every out-of-range VLAN on a line is flagged at the number itself', () => {
  // The digits "5000" also appear earlier in the line — the squiggle must
  // land on the occurrence after "vlan", and every bad ref is reported
  // (4095 is matched inside "voice vlan 4095").
  const line = ' description 5000 vlan 5000 voice vlan 4095 vlan 9999';
  const out = diags(['interface GigabitEthernet1/0/1', line]);
  const vlanDiags = out.filter((d) => /VLAN/.test(d.message));
  assert.deepEqual(spans(vlanDiags), [
    [1, line.indexOf('vlan 5000') + 5, line.indexOf('vlan 5000') + 9],
    [1, line.indexOf('vlan 4095') + 5, line.indexOf('vlan 4095') + 9],
    [1, line.indexOf('vlan 9999') + 5, line.indexOf('vlan 9999') + 9],
  ]);
});

test('duplicate malformed IPv4 addresses get one squiggle each, at their own columns', () => {
  const line = ' ip address 300.1.1.1 300.1.1.1';
  const out = diags(['interface GigabitEthernet1/0/1', line]).filter((d) => /IPv4/.test(d.message));
  assert.deepEqual(spans(out), [
    [1, line.indexOf('300.1.1.1'), line.indexOf('300.1.1.1') + 9],
    [1, line.lastIndexOf('300.1.1.1'), line.lastIndexOf('300.1.1.1') + 9],
  ]);
});

test('valid config produces no diagnostics', () => {
  const out = diags([
    'hostname SW1',
    'interface GigabitEthernet1/0/1',
    ' ip address 10.0.0.1 255.255.255.0',
    ' no shutdown',
    'vlan 4094',
    'end',
  ]);
  assert.deepEqual(out, []);
});

test('isValidIpv4 edge cases', () => {
  assert.equal(isValidIpv4('0.0.0.0'), true);
  assert.equal(isValidIpv4('255.255.255.255'), true);
  assert.equal(isValidIpv4('256.1.1.1'), false);
  assert.equal(isValidIpv4('1.2.3'), false);
});
