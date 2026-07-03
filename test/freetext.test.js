'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createFreeTextTracker } = require('../server/lib/freetext');
const { computeDiagnostics } = require('../server/lib/diagnostics');
const { computeFormattingEdits, computeFoldingRanges } = require('../server/lib/indentation');
const { buildXrefIndex } = require('../server/lib/xref');

const KNOWN = new Set(['hostname', 'banner', 'interface', 'ip', 'no', 'end', 'crypto']);

// The shape that triggered the bug: ASCII-art banner body full of tokens
// that look like unknown commands / weird indentation.
const BANNER_FILE = [
  'hostname SW1',
  'banner login ^C',
  '+----------------------------------+',
  '|                                  |',
  '|        |         |               |',
  '|      .|||||.   .|||||.           |',
  '|      C i s c o   S y s t e m s   |',
  '|         --> BORDER ROUTER <--    |',
  '+----------------------------------+',
  '^C',
  '!',
  'interface GigabitEthernet1/0/1',
  ' no shutdown',
];

const CERT_FILE = [
  'crypto pki certificate chain SLA-TrustPoint',
  ' certificate ca 01',
  '  30820321 30820209 A0030201 02020101 300D0609 2A864886 F70D0101 0B050030',
  '  32310E30 0C060355 040A1305 43697363 6F312030 1E060355 04031317 43697363',
  '        quit',
  ' certificate self-signed 01',
  '  30820330 30820218 A0030201 02020101 300D0609 2A864886 F70D0101 05050030',
  '        quit',
  '!',
  'interface GigabitEthernet1/0/1',
  ' no shutdown',
];

test('banner tracker: opener is a command, body and closing line are not', () => {
  const isFreeText = createFreeTextTracker();
  assert.equal(isFreeText('banner login ^C', 'banner login ^C'), false);
  assert.equal(isFreeText('| free text |', '| free text |'), true);
  assert.equal(isFreeText('^C', '^C'), true); // closing line
  assert.equal(isFreeText('hostname SW1', 'hostname SW1'), false); // back to config
});

test('banner tracker: single-character delimiter and one-liner banners', () => {
  const isFreeText = createFreeTextTracker();
  assert.equal(isFreeText('banner motd #', 'banner motd #'), false);
  assert.equal(
    isFreeText('Unauthorized access prohibited', 'Unauthorized access prohibited'),
    true,
  );
  assert.equal(isFreeText('end of banner #', 'end of banner #'), true);
  // One-liner closes on the opener itself — the next line is config again.
  assert.equal(isFreeText('banner motd #No access#', 'banner motd #No access#'), false);
  assert.equal(isFreeText('hostname SW1', 'hostname SW1'), false);
});

test('certificate tracker: hex payload and quit are free text, opener is not', () => {
  const isFreeText = createFreeTextTracker();
  assert.equal(isFreeText(' certificate ca 01', 'certificate ca 01'), false);
  assert.equal(isFreeText('  30820321 30820209', '30820321 30820209'), true);
  assert.equal(isFreeText('        quit', 'quit'), true); // terminator
  assert.equal(isFreeText(' certificate 1DC06641', 'certificate 1DC06641'), false); // re-arms
  assert.equal(isFreeText('  A0030201 02020101', 'A0030201 02020101'), true);
});

test('certificate tracker: "crypto pki certificate chain" opener does not arm cert mode', () => {
  const isFreeText = createFreeTextTracker();
  assert.equal(
    isFreeText('crypto pki certificate chain TP', 'crypto pki certificate chain TP'),
    false,
  );
  assert.equal(isFreeText(' certificate ca 01', 'certificate ca 01'), false);
  assert.equal(isFreeText('  30820321 30820209', '30820321 30820209'), true);
});

test('no diagnostics fire inside a banner body', () => {
  const out = computeDiagnostics(BANNER_FILE, KNOWN);
  assert.deepEqual(out, []);
});

test('no diagnostics fire inside certificate payloads', () => {
  const out = computeDiagnostics(CERT_FILE, KNOWN);
  assert.deepEqual(out, []);
});

test('the formatter never edits banner or certificate lines', () => {
  assert.deepEqual(computeFormattingEdits(BANNER_FILE), []);
  assert.deepEqual(computeFormattingEdits(CERT_FILE), []);
});

test('banner art indentation creates no folding ranges', () => {
  const ranges = computeFoldingRanges(BANNER_FILE);
  // Only the real interface block folds.
  assert.deepEqual(ranges, [{ startLine: 11, endLine: 12 }]);
});

test('banner text creates no cross-references', () => {
  const { occurrences } = buildXrefIndex([
    'banner motd ^C',
    'apply access-group LOCKDOWN before entry',
    '^C',
  ]);
  assert.deepEqual(occurrences, []);
});
