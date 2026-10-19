'use strict';

// The extension ships default token colours (package.json → configurationDefaults →
// editor.tokenColorCustomizations) so Cisco config files get the Y-Ysss/Daybreak colour
// layering on any theme. A rule whose scope the grammar never emits is a silent no-op, and
// the grammar's rule order decides which label a word like `permit` gets at the start of a
// line — both are invisible failures, so pin them here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const grammar = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'syntaxes', 'cisco.tmLanguage.json'), 'utf8'),
);

const customizations = pkg.contributes.configurationDefaults['editor.tokenColorCustomizations'];
const darkRules = customizations.textMateRules;
const lightRules = customizations['[*Light*]'].textMateRules;

function emittedScopes(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => emittedScopes(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.name === 'string' && node.name.endsWith('.cisco')) out.add(node.name);
    Object.values(node).forEach((v) => emittedScopes(v, out));
  }
  return out;
}

function selectors(rules) {
  return rules.flatMap((r) => (Array.isArray(r.scope) ? r.scope : [r.scope]));
}

test('default token colours exist for dark and light themes', () => {
  assert.ok(Array.isArray(darkRules) && darkRules.length > 0);
  assert.ok(Array.isArray(lightRules) && lightRules.length > 0);
  for (const rule of [...darkRules, ...lightRules]) {
    assert.match(rule.settings.foreground, /^#[0-9A-Fa-f]{6}$/, JSON.stringify(rule));
  }
});

test('light rules override exactly the selectors the dark rules set', () => {
  assert.deepEqual(new Set(selectors(lightRules)), new Set(selectors(darkRules)));
});

test('every colour rule is confined to Cisco files and targets a scope the grammar emits', () => {
  const scopes = emittedScopes(grammar);
  for (const selector of selectors(darkRules)) {
    const m = /^source\.cisco ([a-z0-9_.-]+)$/.exec(selector);
    assert.ok(m, `selector "${selector}" must be "source.cisco <scope prefix>"`);
    const prefix = m[1];
    assert.ok(
      [...scopes].some((s) => s === prefix || s.startsWith(prefix + '.')),
      `no grammar rule emits a scope under "${prefix}"`,
    );
  }
});

test('the grammar lets config keywords win over the command-root rule', () => {
  // `permit`, `deny`, `shutdown` … are both generated command roots and hand-written
  // config keywords. The keyword label must win (as in the Y-Ysss grammar), otherwise an
  // ACL entry's `permit` takes the command colour instead of the keyword colour.
  const order = grammar.patterns.map((p) => p.include);
  for (const rule of ['#keyword', '#command_root', '#param1']) {
    assert.ok(order.includes(rule), `grammar has no ${rule} pattern`);
  }
  assert.ok(order.indexOf('#keyword') < order.indexOf('#command_root'), order.join(' '));
  assert.ok(order.indexOf('#command_root') < order.indexOf('#param1'), order.join(' '));
});
