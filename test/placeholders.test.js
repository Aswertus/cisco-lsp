'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findPlaceholders,
  placeholderAt,
  overlapsPlaceholder,
} = require('../server/lib/placeholders');

// IOS-hash-shaped strings ($<type>$<salt>$<hash>) built at runtime from filler letters:
// no hash-like text may sit in the source, which the public content audit scans.
const fakeHash = (type, salt, body) => ['', type, salt, body].join('$');

// The highlighted text per line, for compact assertions.
const texts = (lines, fill) => findPlaceholders(lines, fill).map((p) => p.text);

test('placeholders: the whole argument around a fill run is one placeholder', () => {
  assert.deepEqual(
    texts([
      'interface VlanXX',
      ' ip address 10.10.X.1 255.255.255.0',
      ' ip helper-address X.X.X.X',
      ' switchport trunk allowed vlan XX,YY',
    ]),
    ['VlanXX', '10.10.X.1', 'X.X.X.X', 'XX,YY'],
  );
});

test('placeholders: angle brackets, $VAR, ${VAR} and Jinja expressions', () => {
  assert.deepEqual(
    texts([
      ' description Users <SITE>',
      ' service-policy input <POLICY>',
      'interface ${UPLINK}',
      ' ip access-group {{ acl_name }} in',
      ' logging host $LOGHOST',
    ]),
    ['<SITE>', '<POLICY>', '${UPLINK}', '{{ acl_name }}', '$LOGHOST'],
  );
});

test('placeholders: Jinja statement and comment lines are covered whole', () => {
  const found = findPlaceholders(['{% for p in uplinks %}', '  {# note #}', '{% endfor %}']);
  assert.deepEqual(
    found.map((p) => [p.line, p.startChar, p.endChar]),
    [
      [0, 0, 22],
      [1, 2, 12],
      [2, 0, 12],
    ],
  );
});

test('placeholders: custom fill characters (letters and symbols)', () => {
  assert.deepEqual(texts([' logging host 192.0.2.NN', 'interface Vlan##'], 'XN#'), [
    '192.0.2.NN',
    'Vlan##',
  ]);
  assert.deepEqual(texts([' logging host 192.0.2.NN'], 'X'), []);
});

test('placeholders: real IOS config is not mistaken for a template', () => {
  assert.deepEqual(
    texts([
      'hostname DEMO-ACCESS-01',
      'interface TenGigabitEthernet1/0/1',
      ' description XXL uplink to MX-core',
      `enable secret 9 ${fakeHash('9', 'a'.repeat(14), 'b'.repeat(43))}`,
      `username admin privilege 15 secret 8 ${fakeHash('8', 'c'.repeat(14), 'd'.repeat(43))}`,
      `username ops secret 14 ${fakeHash('14', 'eeee', 'f'.repeat(6) + '.' + 'g'.repeat(20))}`,
      'dot1x system-auth-control',
      'class-map match-any demo-police-dot1x-auth',
      ' description 2 x 10G to core',
      ' ip address 192.0.2.1 255.255.255.0',
      '! comment with <SOMETHING> and X',
      'vlan 5000',
    ]),
    [],
  );
});

test('placeholders: lookup by position and by range', () => {
  const found = findPlaceholders([' ip address 10.10.X.1 255.255.255.0']);
  assert.equal(placeholderAt(found, 0, 12)?.text, '10.10.X.1');
  assert.equal(placeholderAt(found, 0, 21)?.text, '10.10.X.1'); // just after the last char
  assert.equal(placeholderAt(found, 0, 25), null);
  const range = (s, e) => ({ start: { line: 0, character: s }, end: { line: 0, character: e } });
  assert.equal(overlapsPlaceholder(found, range(12, 21)), true);
  assert.equal(overlapsPlaceholder(found, range(22, 35)), false);
  assert.equal(
    overlapsPlaceholder(found, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 5 },
    }),
    false,
  );
});

// ------------------------------------------------- scanners on config templates
const { computeDiagnostics } = require('../server/lib/diagnostics');
const { computeFormattingEdits } = require('../server/lib/indentation');
const { buildXrefIndex, computeXrefDiagnostics, findAtPosition } = require('../server/lib/xref');

const KNOWN = new Set([
  'hostname',
  'interface',
  'vlan',
  'router',
  'route-map',
  'ip',
  'snmp-server',
]);
const messages = (lines) => [
  ...computeDiagnostics(lines, KNOWN).map((d) => `${d.range.start.line + 1} ${d.message}`),
  ...computeXrefDiagnostics(buildXrefIndex(lines)).map(
    (d) => `${d.range.start.line + 1} ${d.message}`,
  ),
];

const TEMPLATE = [
  '<GLOBAL-SETTINGS>', // 1 lone placeholder line
  '$BANNER', // 2
  '{# Jinja comment #}', // 3
  'interface VlanXX', // 4
  ' service-policy input <POLICY>', // 5
  ' ip access-group ACL-XXX in', // 6
  'interface GigabitEthernet1/0/${PORT}', // 7
  '   {% if voice %}', // 8 odd indent inside a block
  ' switchport voice vlan {{ voice_vlan }}', // 9
  ' {% endif %}', // 10
  'interface {{ uplink }}', // 11
  ' service-policy output {{ policy_name }}', // 12
  ' vrf forwarding VRF-XXX', // 13
  'route-map RM-XXX permit 10', // 14
  ' match ip address prefix-list PL-<SITE>', // 15
  'router bgp {{ asn }}', // 16
  ' neighbor {{ peer }} route-map RM-XXX in', // 17
  '{% for v in vlans %}', // 18
  'vlan {{ v.id }}', // 19
  '{% endfor %}', // 20
];

test('templates: no diagnostics on placeholders or template lines', () => {
  assert.deepEqual(messages(TEMPLATE), []);
});

test('templates: the formatter leaves template lines alone', () => {
  assert.deepEqual(computeFormattingEdits(TEMPLATE), []);
});

test('templates: real problems next to placeholders are still reported', () => {
  assert.deepEqual(
    messages(['interface VlanXX', ' switchport access vlan 5000', 'interfacs Gi1/0/1']),
    [
      '2 VLAN 5000 is out of range (must be 1–4094).',
      '3 Unknown command "interfacs" — possible typo.',
    ],
  );
  assert.deepEqual(messages(['interface Gigabit1/0/1']), [
    '1 "Gigabit1/0/1" is not a recognised IOS-XE interface type.',
  ]);
});

test('templates: {{ policy_name }} is one name, and placeholder names still link', () => {
  const index = buildXrefIndex(TEMPLATE);
  const policy = index.objects.get('policy-map {{ policy_name }}');
  assert.ok(policy, 'whole Jinja expression is the name');
  assert.deepEqual(policy.refs[0], { line: 11, startChar: 23, endChar: 40 });
  const rm = index.objects.get('route-map RM-XXX');
  assert.equal(rm.defs.length, 1);
  assert.equal(rm.refs.length, 1); // F12 / Shift+F12 / rename still work
  assert.equal(findAtPosition(index, 16, 32)?.name, 'RM-XXX');
});

test('multigigabit interfaces are recognised', () => {
  assert.deepEqual(
    messages([
      'interface FiveGigabitEthernet1/0/1',
      'interface Fi1/0/3',
      'interface TwoGigabitEthernet1/0/4',
      'interface Tw1/0/5',
    ]),
    [],
  );
});
