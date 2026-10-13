'use strict';

// Pure helpers for the update check — no vscode dependency, so they can be
// unit-tested (see test/version.test.js).

function parseRepo(repoUrl) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(repoUrl || '');
  return m ? { owner: m[1], repo: m[2] } : { owner: 'Aswertus', repo: 'cisco-lsp' };
}

// Returns true if version `a` is strictly greater than `b` (semver-lite:
// numeric major.minor.patch, any "-prerelease" suffix ignored).
function isNewer(a, b) {
  const parse = (v) =>
    String(v)
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

module.exports = { parseRepo, isNewer };
