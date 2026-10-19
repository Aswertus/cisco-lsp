'use strict';

// scripts/public/import-pr.sh: a public pull request is cherry-picked onto the
// dev branch with its author kept and the source commit recorded (`-x`), so
// release.sh can credit the contributor on the squashed release commit.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'public', 'import-pr.sh');

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@users.noreply.github.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

// Every scratch dir goes through mkTmp and is removed when this file's tests finish;
// without it each run leaves dozens of dirs behind and fills a tmpfs /tmp's inodes.
const tmpDirs = [];
function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd, args, env = ENV) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(cwd, name, content, message, author) {
  fs.writeFileSync(path.join(cwd, name), content);
  git(cwd, ['add', name]);
  const env = author
    ? { ...ENV, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email }
    : ENV;
  git(cwd, ['commit', '-q', '-m', message], env);
  return git(cwd, ['rev-parse', 'HEAD']);
}

// A "public" bare repo with main = one release commit and PR #7 on top of it,
// and a dev clone with its own unrelated history and `public` as a remote.
function setup() {
  const tmp = mkTmp('import-pr-');
  const pubWork = path.join(tmp, 'public-work');
  const pubBare = path.join(tmp, 'public.git');
  const dev = path.join(tmp, 'dev');
  git(tmp, ['init', '-q', '-b', 'main', pubWork]);
  commitFile(pubWork, 'README.md', 'release\n', 'release: v0.7.0');
  const prSha = commitFile(pubWork, 'fix.txt', 'contributed\n', 'fix: handle foo', {
    name: 'Contributor',
    email: 'contrib@example.com',
  });
  git(tmp, ['clone', '-q', '--bare', pubWork, pubBare]);
  git(pubBare, ['update-ref', 'refs/heads/main', `${prSha}~1`]);
  git(pubBare, ['update-ref', 'refs/pull/7/head', prSha]);

  git(tmp, ['init', '-q', '-b', 'main', dev]);
  commitFile(dev, 'README.md', 'dev\n', 'dev history');
  git(dev, ['checkout', '-q', '-b', 'claude_dev']);
  git(dev, ['remote', 'add', 'public', pubBare]);
  return { dev, prSha };
}

test('import-pr: cherry-picks the PR onto the dev branch, keeping author and source commit', () => {
  const { dev, prSha } = setup();
  const out = execFileSync('bash', [SCRIPT, '7'], { cwd: dev, env: ENV, encoding: 'utf8' });
  assert.match(out, /cherry-picking 1 commit\(s\) of PR #7 onto claude_dev/);
  assert.equal(fs.readFileSync(path.join(dev, 'fix.txt'), 'utf8'), 'contributed\n');
  assert.equal(git(dev, ['log', '-1', '--format=%an <%ae>']), 'Contributor <contrib@example.com>');
  assert.match(
    git(dev, ['log', '-1', '--format=%B']),
    new RegExp(`cherry picked from commit ${prSha}`),
  );
  assert.equal(git(dev, ['tag']), ''); // --no-tags: nothing from public lands in refs/tags
});

test('import-pr: refuses main, a dirty tree and an unknown PR', () => {
  const { dev } = setup();
  const run = (args, cwd = dev) => {
    try {
      execFileSync('bash', [SCRIPT, ...args], { cwd, env: ENV, encoding: 'utf8', stdio: 'pipe' });
      return { ok: true };
    } catch (err) {
      return { ok: false, stderr: String(err.stderr) };
    }
  };
  let r = run(['99']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /#99 not found/);

  fs.writeFileSync(path.join(dev, 'scratch.txt'), 'x');
  r = run(['7']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /not clean/);
  fs.unlinkSync(path.join(dev, 'scratch.txt'));

  git(dev, ['checkout', '-q', 'main']);
  r = run(['7']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /never cherry-pick onto main/);

  r = run(['abc']);
  assert.equal(r.ok, false);
});
