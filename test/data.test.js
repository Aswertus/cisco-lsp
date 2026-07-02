'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadCommands,
  classifyModesToBlock,
  classifyModesToBlocks,
  buildData,
} = require('../server/lib/data');
const { isNewer, parseRepo } = require('../client/version');

const silentLog = { log() {}, error() {} };

function makeDataDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cisco-lsp-data-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const RECORDS = [
  { name: 'switchport mode', modes: ['Interface configuration (config-if)'] },
  { name: 'neighbor remote-as', modes: ['Router configuration (config-router)'] },
  { name: 'show running-config', modes: ['Privileged EXEC'] },
  { name: 'hostname', modes: ['Global configuration'] },
];

test('a corrupt pack file is skipped with a logged error, the rest still loads', () => {
  const errors = [];
  const dir = makeDataDir({
    'pack/good.json': JSON.stringify(RECORDS),
    'pack/corrupt.json': '{ this is not JSON',
  });
  const commands = loadCommands(dir, { log() {}, error: (m) => errors.push(m) });
  assert.equal(commands.length, RECORDS.length);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /corrupt\.json/);
});

test('a merged commands.json is preferred over the pack layout', () => {
  const dir = makeDataDir({
    'commands.json': JSON.stringify(RECORDS.slice(0, 1)),
    'pack/extra.json': JSON.stringify(RECORDS),
  });
  assert.equal(loadCommands(dir, silentLog).length, 1);
});

test('classifyModesToBlock buckets by documented command mode', () => {
  assert.equal(classifyModesToBlock(['Interface configuration (config-if)']), 'interface');
  assert.equal(classifyModesToBlock(['Router configuration (config-router)']), 'router');
  assert.equal(classifyModesToBlock(['QoS class-map configuration (config-cmap)']), 'class-map');
  assert.equal(classifyModesToBlock(['Privileged EXEC (#)']), 'exec');
  assert.equal(classifyModesToBlock(['Global configuration (config)']), 'global');
  assert.equal(classifyModesToBlock(undefined), 'global');
});

test('classifyModesToBlocks: new buckets, multi-mode commands land in every match', () => {
  assert.deepEqual(classifyModesToBlocks(['VRF configuration (config-vrf)']), ['vrf']);
  assert.deepEqual(classifyModesToBlocks(['VLAN configuration (config-vlan)']), ['vlan']);
  assert.deepEqual(classifyModesToBlocks(['Flow exporter configuration']), ['flow-exporter']);
  // "service template configuration" contains the substring "template
  // configuration" but must land only in the service-template bucket.
  assert.deepEqual(
    classifyModesToBlocks(['Service template configuration (config-service-template)']),
    ['service-template'],
  );
  assert.deepEqual(
    classifyModesToBlocks([
      'Interface configuration (config-if)',
      'Template configuration (config-template)',
    ]),
    ['interface', 'template'],
  );
  // The single-bucket variant keeps the first (completion) bucket.
  assert.equal(
    classifyModesToBlock([
      'Interface configuration (config-if)',
      'Template configuration (config-template)',
    ]),
    'interface',
  );
});

test('buildData: blockCommandNames feeds the isChildCommand evidence check', () => {
  const dir = makeDataDir({
    'pack/cmds.json': JSON.stringify([
      ...RECORDS,
      { name: 'rd', modes: ['VRF configuration (config-vrf)'] },
    ]),
  });
  const data = buildData(dir, silentLog);

  assert.ok(data.isChildCommand('interface', 'switchport mode access'));
  assert.ok(data.isChildCommand('interface', 'switchport mode')); // exact match
  assert.ok(data.isChildCommand('vrf', 'rd 1:4103'));
  assert.ok(!data.isChildCommand('interface', 'switchport modeX')); // token boundary
  assert.ok(!data.isChildCommand('interface', 'hostname SW1')); // global command
  assert.ok(!data.isChildCommand('vlan', 'rd 1:4103')); // wrong block
});

test('buildData derives indexes, merged top-level bucket and knownTopLevel', () => {
  const dir = makeDataDir({ 'pack/cmds.json': JSON.stringify(RECORDS) });
  const data = buildData(dir, silentLog);

  assert.equal(data.commandCount, 4);
  assert.equal(data.maxCommandWords, 2);
  assert.ok(data.commandsByName.has('switchport mode'));

  const labels = (block) => (data.completionItemsByBlock.get(block) || []).map((i) => i.label);
  assert.deepEqual(labels('interface'), ['switchport mode']);
  assert.deepEqual(labels('router'), ['neighbor remote-as']);
  // top-level = global + exec commands, never interface/router ones
  assert.deepEqual(labels('top-level').sort(), ['hostname', 'show running-config']);

  // First word of every loaded command lands in knownTopLevel (plus base set)
  assert.ok(data.knownTopLevel.has('show'));
  assert.ok(data.knownTopLevel.has('no')); // from the base set
  assert.ok(!data.knownTopLevel.has('running-config'));
});

test('client version helpers: isNewer / parseRepo', () => {
  assert.equal(isNewer('0.6.0', '0.5.0'), true);
  assert.equal(isNewer('0.5.0', '0.5.0'), false);
  assert.equal(isNewer('0.5.0', '0.10.0'), false); // numeric, not lexicographic
  assert.equal(isNewer('1.0.0-beta', '1.0.0'), false); // prerelease suffix ignored
  assert.deepEqual(parseRepo('https://github.com/Aswertus/cisco-lsp.git'), {
    owner: 'Aswertus',
    repo: 'cisco-lsp',
  });
});
