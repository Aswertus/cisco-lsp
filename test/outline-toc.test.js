'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOutlineXml } = require('../import_scripts/outline-toc');

// Shape of `pdftohtml -xml` output for a manual without a front-matter TOC
// (Catalyst 3850 16.12): a chapter's <outline> holds its commands AND the next
// chapter's title, whose own <outline> then opens one level deeper — so depth
// grows by one per chapter instead of chapters being siblings. Index letters
// trail the last chapter at the same depth as its commands.
const XML = `
<outline>
<item page="1">Command Reference, Cisco IOS XE Gibraltar 16.12.x (Catalyst 3850 Switches)</item>
<item page="3">Using the Command-Line Interface</item>
<outline>
<item page="4">Using the Command-Line Interface</item>
<outline>
<item page="4">Understanding Command Modes</item>
<item page="7">Using Command History</item>
<outline>
<item page="7">Changing the Command History Buffer Size</item>
</outline>
<item page="17">Cisco TrustSec Commands</item>
<outline>
<item page="18">cts authorization list</item>
<item page="47">propagate sgt (cts manual)</item>
<item page="49">show cts &amp; sxp &lt;filters&gt;</item>
<item page="61">Interface and Hardware Commands</item>
<outline>
<item page="62">client vlan</item>
<item page="64">debug ilpower</item>
<item page="1400">A</item>
<item page="1401">B</item>
</outline>
</outline>
</outline>
</outline>
</outline>
`;

test('parseOutlineXml: chapters are items with childless children, in document order', () => {
  const chapters = parseOutlineXml(XML);
  assert.deepEqual(
    chapters.map((c) => [c.title, c.entries.map((e) => e.name)]),
    [
      ['Using the Command-Line Interface', ['Understanding Command Modes']],
      ['Using Command History', ['Changing the Command History Buffer Size']],
      [
        'Cisco TrustSec Commands',
        ['cts authorization list', 'propagate sgt (cts manual)', 'show cts & sxp <filters>'],
      ],
      ['Interface and Hardware Commands', ['client vlan', 'debug ilpower']],
    ],
  );
});

test('parseOutlineXml: keeps the PDF page of every entry', () => {
  const chapters = parseOutlineXml(XML);
  const trustsec = chapters.find((c) => c.title === 'Cisco TrustSec Commands');
  assert.deepEqual(
    trustsec.entries.map((e) => e.page),
    [18, 47, 49],
  );
});

test('parseOutlineXml: single-letter index entries are not commands', () => {
  const chapters = parseOutlineXml(XML);
  const names = chapters.flatMap((c) => c.entries.map((e) => e.name));
  assert.ok(!names.includes('A') && !names.includes('B'));
});

test('parseOutlineXml: no outline → no chapters', () => {
  assert.deepEqual(parseOutlineXml('<pdf2xml></pdf2xml>'), []);
});
