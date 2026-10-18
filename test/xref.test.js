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
  assert.deepEqual(
    unused.map((d) => d.message),
    ['route-map "RM" is defined but never referenced in this file.'],
  );
});

test('LISP prefix-list block opener counts as a definition', () => {
  const diags = computeXrefDiagnostics(
    buildXrefIndex([
      'router lisp',
      ' prefix-list LOCAL_EIDS',
      '  198.51.100.0/24',
      ' service ipv4',
      '  itr map-resolver 192.0.2.1 prefix-list LOCAL_EIDS',
    ]),
  );
  assert.deepEqual(
    diags.filter((d) => /never defined/.test(d.message)),
    [],
  );
});

test('ntp access-group: the type keyword is not an ACL name, the ACL is', () => {
  const index = buildXrefIndex([
    'ip access-list standard NTP_ACL',
    ' 10 permit 10.0.0.0 0.255.255.255',
    'ntp access-group peer NTP_ACL',
  ]);
  assert.equal(index.objects.has('access-list peer'), false);
  const acl = index.objects.get('access-list NTP_ACL');
  assert.equal(acl.defs.length, 1);
  assert.equal(acl.refs.length, 1);
});

test('unusedObjects: false drops the never-used hints, keeps never-defined warnings', () => {
  const index = buildXrefIndex([
    'class-map match-any CM-UNUSED',
    ' match dscp ef',
    'interface Gi1/0/1',
    ' service-policy input PM-MISSING',
  ]);
  const all = computeXrefDiagnostics(index);
  assert.deepEqual(all.map((d) => d.severity).sort(), [2, 4]);
  const filtered = computeXrefDiagnostics(index, { unusedObjects: false });
  assert.deepEqual(
    filtered.map((d) => d.severity),
    [2],
  );
  assert.deepEqual(computeXrefDiagnostics(index, {}).length, 2, 'default keeps the hints');
});

test('vrf: routing, multicast, LISP and service commands count as uses; descriptions do not', () => {
  const lines = [
    'vrf definition BLUE',
    ' address-family ipv4',
    'ip route vrf BLUE 0.0.0.0 0.0.0.0 192.0.2.1',
    'ipv6 route vrf BLUE ::/0 2001:db8::1',
    'ip multicast-routing vrf BLUE',
    'ip pim vrf BLUE rp-address 192.0.2.10',
    'ntp server vrf BLUE 192.0.2.123',
    'ip name-server vrf BLUE 192.0.2.53',
    'ip domain lookup vrf BLUE',
    'router lisp',
    ' instance-id 4099',
    '  service ipv4',
    '   eid-table vrf BLUE',
    'interface Gi1/0/1',
    ' description uplink in vrf RED',
  ];
  const index = buildXrefIndex(lines);
  const blue = [...index.objects.values()].find((o) => o.kind === 'vrf' && o.name === 'BLUE');
  assert.deepEqual(
    blue.refs.map((r) => r.line),
    [2, 3, 4, 5, 6, 7, 8, 12],
  );
  assert.ok(
    ![...index.objects.values()].some((o) => o.kind === 'vrf' && o.name === 'RED'),
    'free text in a description is no reference',
  );
  assert.deepEqual(computeXrefDiagnostics(index), [], 'BLUE is used, nothing undefined');
});
