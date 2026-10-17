'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractParams } = require('../scripts/lib/extract-params');

// Layouts as `pdftotext -layout` prints them (the section label is blanked
// to spaces, so columns are absolute).
const names = (text) => extractParams(text).map((p) => p.name);

test('extractParams: a name wider than its column still starts its own row', () => {
  const text = [
    '                    vlan-id              The VLAN to be used for voice traffic. The range is 1 to 4094.',
    '                                         By default, the IP phone forwards with priority 5.',
    '',
    '                    untagged             Configures the telephone to send untagged voice traffic. This is the',
    '                                         default for the telephone.',
    '',
    '                    name vlan_name (Optional) Specifies the VLAN name to be used for voice traffic. You can',
    '                                   enter up to 128 characters.',
  ].join('\n');
  const params = extractParams(text);
  assert.deepEqual(
    params.map((p) => p.name),
    ['vlan-id', 'untagged', 'name vlan_name'],
  );
  assert.equal(
    params[1].description,
    'Configures the telephone to send untagged voice traffic. This is the default for the telephone.',
  );
  assert.equal(
    params[2].description,
    '(Optional) Specifies the VLAN name to be used for voice traffic. You can enter up to 128 characters.',
  );
});

test('extractParams: an overflowing row without a continuation line splits at (Optional)', () => {
  const text = [
    '   cost                 Path cost.',
    '   priority value (Optional) Port priority.',
  ].join('\n');
  assert.deepEqual(names(text), ['cost', 'priority value']);
});

test('extractParams: the usual two-column table and wrapped descriptions are unchanged', () => {
  const text = [
    '          dot1p                Configures the telephone to use IEEE 802.1p priority tagging and uses VLAN 0',
    '                               (the native VLAN). By default the phone uses priority 5.',
    '          none                 Does not instruct the IP telephone about the voice VLAN.',
  ].join('\n');
  const params = extractParams(text);
  assert.deepEqual(
    params.map((p) => p.name),
    ['dot1p', 'none'],
  );
  assert.match(params[0].description, /native VLAN\)\. By default/);
});

test('extractParams: a lone row with a single space, and "no arguments"', () => {
  assert.deepEqual(names('   cost Path cost. The range is from 1 to 200000000.'), ['cost']);
  assert.deepEqual(extractParams('   This command has no arguments or keywords.'), []);
  assert.deepEqual(extractParams('\n\n'), []);
});

test('extractParams: an unsplittable row is kept as text, not turned into a fake parameter', () => {
  const text = [
    '   interface-id         The interface to configure.',
    '   see the platform guide for supported values',
  ].join('\n');
  const params = extractParams(text);
  assert.deepEqual(
    params.map((p) => p.name),
    ['interface-id'],
  );
  assert.match(params[0].description, /supported values$/);
});

test('extractParams: after a page break the shifted table still yields rows', () => {
  const text = [
    '                     area-id                      (Optional) Area number associated with the OSPF address range.',
    '',
    '                            link-state-id                 (Optional) Portion of the Internet environment that is',
    '                                                          described by the advertisement.',
    '                            asbr-summary                  (Optional) Displays only the ASBR summary LSAs.',
    '                            name vlan_name (Optional) Overflowing name on the shifted page that',
    '                                           wraps.',
  ].join('\n');
  assert.deepEqual(names(text), ['area-id', 'link-state-id', 'asbr-summary', 'name vlan_name']);
});

test('extractParams: a "Note" in the description column stays part of the description', () => {
  const text = [
    '   gbic-invalid         Enables error detection for an invalid GBIC.',
    '                        Note        This error refers to an invalid SFP module.',
    '   inline-power         Enables error detection for PoE.',
  ].join('\n');
  const params = extractParams(text);
  assert.deepEqual(
    params.map((p) => p.name),
    ['gbic-invalid', 'inline-power'],
  );
  assert.match(params[0].description, /Note This error refers/);
});

test('extractParams: a repeated "Syntax Description" label is neither a parameter nor the name column', () => {
  const text = [
    '',
    'Syntax Description       chunk                           (Optional) Displays chunk memory information.',
    '',
    '                         database                        (Optional) Displays database memory information.',
  ].join('\n');
  assert.deepEqual(names(text), ['chunk', 'database']);
});

test('extractParams: a row that repeats the command name is not a parameter named after its first word', () => {
  // The PDF glues the argument onto the name ("vlanvlan_id") or describes the
  // command itself in the table.
  const voice =
    '     switchport voice vlanvlan_id Specifies to forward all voice traffic through the VLAN.';
  assert.deepEqual(extractParams(voice, 'switchport voice vlan'), [
    { name: 'vlan_id', description: 'Specifies to forward all voice traffic through the VLAN.' },
  ]);
  const self = [
    '     switchport mode access Sets the interface as a nontrunking nontagged single-VLAN',
    '                            Ethernet interface.',
  ].join('\n');
  assert.deepEqual(extractParams(self, 'switchport mode access'), []);
  // Without the command name the old behaviour stays.
  assert.deepEqual(names(voice), ['switchport']);
});

test('extractParams: single-word commands keep parameters named like the command', () => {
  assert.deepEqual(names('     exporter-name        Name of a flow exporter.', 'exporter'), [
    'exporter-name',
  ]);
  assert.deepEqual(names('     description          Comment or description.', 'description'), [
    'description',
  ]);
  assert.deepEqual(names('     channel-group-number Channel group number.', 'channel-group'), [
    'channel-group-number',
  ]);
});

test('extractParams: page furniture between table rows never reaches a description', () => {
  const text = [
    '      area-id              (Optional) Area number associated with the OSPF address range.',
    '',
    '                   Command Reference, Cisco IOS XE 17.15.x (Catalyst 9500 Switches)',
    '1691',
    '                                                              Routing',
    '    show ip ospf database',
    '',
    '      link-state-id        (Optional) Portion of the Internet environment.',
  ].join('\n');
  const params = extractParams(text, 'show ip ospf database');
  assert.deepEqual(
    params.map((p) => p.name),
    ['area-id', 'link-state-id'],
  );
  assert.equal(
    params[0].description,
    '(Optional) Area number associated with the OSPF address range.',
  );
});

test('extractParams: a name longer than four words is split at the column gap', () => {
  const text = [
    '   switch {switch_num | active | standby }                 The switch to show information for.',
    '                                                           Applies to stacks only.',
  ].join('\n');
  const params = extractParams(text);
  assert.deepEqual(
    params.map((p) => p.name),
    ['switch {switch_num | active | standby }'],
  );
  assert.match(params[0].description, /^The switch to show/);
});

test('extractParams: bulleted continuation lines do not move the name/description split', () => {
  const text = [
    '        level The severity level of messages logged to the console. The levels are:',
    '                 • Emergencies—System is unusable (severity=0)',
    '                 • Alerts—Immediate action needed (severity=1)',
  ].join('\n');
  const params = extractParams(text, 'logging console');
  assert.deepEqual(
    params.map((p) => p.name),
    ['level'],
  );
  assert.match(params[0].description, /^The severity level .* Emergencies/);
});
