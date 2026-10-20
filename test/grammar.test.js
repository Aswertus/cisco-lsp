'use strict';

// Spot checks of TextMate grammar rules whose regexes are easy to get subtly wrong. The
// patterns are plain Oniguruma that JavaScript's RegExp also understands, so they are
// matched here directly; the first match on a line is what the tokenizer would colour.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const grammar = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'cisco.tmLanguage.json'), 'utf8'),
);
const vrfRule = grammar.repository.vrf.patterns[0];
const vrf = new RegExp(vrfRule.match);

// [line, keyword (capture 1), VRF name (capture 4)] — or null when the rule must not match.
const CASES = [
  ['vrf definition MGMT', 'vrf', 'MGMT'],
  [' vrf forwarding MGMT', 'vrf', 'MGMT'],
  ['ip route vrf MGMT 0.0.0.0 0.0.0.0 203.0.113.254', 'vrf', 'MGMT'],
  [' tunnel vrf INET', 'vrf', 'INET'],
  // Front-door / inside VRFs on VPN tunnels and crypto profiles: the whole word is the keyword.
  [' match fvrf INET', 'fvrf', 'INET'],
  [' match fvrf any', 'fvrf', 'any'],
  ['crypto keyring KR-INET vrf INET', 'vrf', 'INET'],
  [' ivrf CORP', 'ivrf', 'CORP'],
  // Words that merely contain "vrf" are not the keyword.
  [' description myvrf link', null],
  [' set cvrf X', null],
];

for (const [line, keyword, name] of CASES) {
  test(`vrf rule: ${JSON.stringify(line)}`, () => {
    const m = vrf.exec(line);
    if (keyword === null) {
      assert.equal(m, null, `must not match, got ${JSON.stringify(m && m[0])}`);
      return;
    }
    assert.ok(m, 'must match');
    assert.equal(m[1], keyword);
    assert.equal(m[4], name);
  });
}

test('vrf rule keeps its scopes', () => {
  assert.equal(vrfRule.captures['1'].name, 'entity.name.class.vrf.declaration.cisco');
  assert.equal(vrfRule.captures['4'].name, 'entity.name.tag.vrf.vrf-name.cisco');
});
