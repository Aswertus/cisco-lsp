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

test('LISP prefix-list block opener counts as a definition', () => {
  const diags = computeXrefDiagnostics(
    buildXrefIndex([
      'router lisp',
      ' prefix-list SITE_LOCAL_EIDS_V4',
      '  10.1.10.0/24',
      ' service ipv4',
      '  itr map-resolver 10.96.4.129 prefix-list SITE_LOCAL_EIDS_V4',
    ]),
  );
  assert.deepEqual(
    diags.filter((d) => /never defined/.test(d.message)),
    [],
  );
});

test('ntp access-group: the type keyword is not an ACL name, the ACL is', () => {
  const index = buildXrefIndex([
    'ip access-list standard deny_ntp_query',
    ' 10 permit 10.0.0.0 0.255.255.255',
    'ntp access-group peer deny_ntp_query',
  ]);
  assert.equal(index.objects.has('access-list peer'), false);
  const acl = index.objects.get('access-list deny_ntp_query');
  assert.equal(acl.defs.length, 1);
  assert.equal(acl.refs.length, 1);
});
