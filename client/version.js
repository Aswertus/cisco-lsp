'use strict';

// Pure helpers for the update check — no vscode dependency, so they can be
// unit-tested (see test/version.test.js).

function parseRepo(repoUrl) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(repoUrl || '');
  return m ? { owner: m[1], repo: m[2] } : { owner: 'Aswertus', repo: 'cisco-lsp' };
}

// Returns true if version `a` is strictly greater than `b` (semver-lite:
// numeric major.minor.patch; a "-prerelease" suffix such as `-rc.2` ranks
// below the plain version, and suffixes compare identifier by identifier,
// numerically where both are numbers — so a shared release candidate
// `0.7.0-rc.1` is offered `0.7.0` once it ships, and `rc.10` beats `rc.9`).
function isNewer(a, b) {
  const parse = (v) => {
    const [nums, ...pre] = String(v).split('-');
    return {
      nums: nums.split('.').map((n) => parseInt(n, 10) || 0),
      pre: pre.length ? pre.join('-').split('.') : null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa.nums[i] || 0;
    const y = pb.nums[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  if (!pa.pre && !pb.pre) return false;
  if (!pa.pre) return true; // release > its pre-releases
  if (!pb.pre) return false;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return false; // shorter prefix ranks lower
    if (y === undefined) return true;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    const cmp = nx !== null && ny !== null ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
    if (cmp > 0) return true;
    if (cmp < 0) return false;
  }
  return false;
}

module.exports = { parseRepo, isNewer };
