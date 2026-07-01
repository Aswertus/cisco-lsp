'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildXrefIndex, findAtPosition, computeXrefDiagnostics } = require('../server/lib/xref');

const CONFIG = [
  /* 0 */ 'class-map match-any VOICE',
  /* 1 */ ' match dscp ef',
  /* 2 */ 'policy-map EDGE',
  /* 3 */ ' class VOICE',
  /* 4 */ '  priority percent 30',
  /* 5 */ ' class class-default',
  /* 6 */ 'interface GigabitEthernet1/0/1',
  /* 7 */ ' service-policy output EDGE',
  /* 8 */ ' ip access-group ACL_IN in',
  /* 9 */ ' vrf forwarding CUST',
  /* 10 */ 'route-map RM permit 10',
  /* 11 */ ' match ip address prefix-list PL',
  /* 12 */ 'ip vrf CUST',
];

test('defs and refs are indexed with exact name spans', () => {
  const index = buildXrefIndex(CONFIG);

  const cm = index.objects.get('class-map VOICE');
  assert.deepEqual(cm.defs, [{ line: 0, startChar: 20, endChar: 25 }]);
  assert.deepEqual(cm.refs, [{ line: 3, startChar: 7, endChar: 12 }]);

  const pm = index.objects.get('policy-map EDGE');
  assert.equal(pm.defs.length, 1);
  assert.deepEqual(pm.refs, [{ line: 7, startChar: 23, endChar: 27 }]);

  // class-default is built in, never a reference
  assert.equal(index.objects.has('class-map class-default'), false);

  // a route-map header is a def only — the ref pattern must not re-match it
  const rm = index.objects.get('route-map RM');
  assert.equal(rm.defs.length, 1);
  assert.equal(rm.refs.length, 0);
});

test('findAtPosition resolves the occurrence under the cursor', () => {
  const index = buildXrefIndex(CONFIG);
  const hit = findAtPosition(index, 7, 25); // inside "EDGE" on the service-policy line
  assert.equal(hit.kind, 'policy-map');
  assert.equal(hit.name, 'EDGE');
  assert.equal(hit.isDef, false);
  assert.equal(findAtPosition(index, 4, 3), null);
});

test('undefined references warn, unused definitions hint', () => {
  const index = buildXrefIndex(CONFIG);
  const diags = computeXrefDiagnostics(index);

  const undef = diags.filter((d) => /never defined/.test(d.message));
  // ACL_IN and prefix-list PL are referenced but not defined; VRF CUST is
  // defined (line 12) and referenced (line 9) so it must NOT appear.
  assert.deepEqual(undef.map((d) => d.message).sort(), [
    'access-list "ACL_IN" is referenced but never defined in this file.',
    'prefix-list "PL" is referenced but never defined in this file.',
  ]);

  const unused = diags.filter((d) => /never referenced/.test(d.message));
  assert.deepEqual(unused.map((d) => d.message), [
    'route-map "RM" is defined but never referenced in this file.',
  ]);
});
