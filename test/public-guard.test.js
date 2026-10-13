'use strict';

// Attacks on the public-repo guard (scripts/public/check.sh and
// scripts/git-hooks/pre-push), each one a bypass that once worked or easily
// could. Every test builds throwaway git repos; nothing touches this checkout.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IDENTITY = { name: 'Aswertus', email: '1096961+Aswertus@users.noreply.github.com' };
const ZERO = '0'.repeat(40);

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Someone');
  git('config', 'user.email', 'someone@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  // The guard scripts live on disk (untracked), like in a real checkout.
  fs.mkdirSync(path.join(dir, 'scripts/public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts/git-hooks'), { recursive: true });
  for (const f of ['scripts/public/check.sh', 'scripts/git-hooks/pre-push', '.publicignore']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    fs.chmodSync(path.join(dir, f), 0o755);
  }
  return { dir, git };
}

// Commit exactly `files` ({path: content}) as a fresh root or on `parent`.
function commitFiles(
  { dir },
  files,
  { parent, message = 'release: v1.0.0', identity = IDENTITY } = {},
) {
  const idx = path.join(dir, '.git', `idx-${Math.random()}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  for (const [p, content] of Object.entries(files)) {
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: dir,
      input: content,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${sha},${p}`], {
      cwd: dir,
      env,
    });
  }
  const tree = execFileSync('git', ['write-tree'], { cwd: dir, env, encoding: 'utf8' }).trim();
  const idEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
  const args = ['commit-tree', tree, '-m', message, ...(parent ? ['-p', parent] : [])];
  return execFileSync('git', args, { cwd: dir, env: idEnv, encoding: 'utf8' }).trim();
}

const check = ({ dir }, target) =>
  spawnSync('bash', ['scripts/public/check.sh', target], { cwd: dir, encoding: 'utf8' }).status;

const CLEAN = { 'README.md': 'hello\n', 'server/server.js': '// code\n' };

test('check.sh: a clean tree passes', () => {
  const r = tmpRepo();
  assert.equal(check(r, commitFiles(r, CLEAN)), 0);
});

for (const bad of [
  'CLAUDE.md',
  'Claude.md', // case variants from macOS/Windows clients
  '.Claude/settings.json',
  'docs/AGENTS.md',
  '.kiro/spec.md',
  '_Testing/x.txt',
  '_manuals/manual.pdf',
  'configs/core-sw.CISCO',
  'backup/sw01-confg', // IOS default archive name
  'sw01-running-config',
]) {
  test(`check.sh: blocks ${bad}`, () => {
    const r = tmpRepo();
    assert.equal(check(r, commitFiles(r, { ...CLEAN, [bad]: 'x\n' })), 1);
  });
}

test('check.sh: a negated .gitignore (in the tree and on disk) cannot un-block', () => {
  const r = tmpRepo();
  const neg = '!CLAUDE.md\n!.claude/\n!_testing/\n!*.cisco\n';
  fs.writeFileSync(path.join(r.dir, '.gitignore'), neg);
  const c = commitFiles(r, {
    ...CLEAN,
    '.gitignore': neg,
    'CLAUDE.md': 'x',
    '_testing/sw.cisco': 'x',
  });
  assert.equal(check(r, c), 1);
});

test('check.sh: an emptied .publicignore still enforces the built-in NEVER list', () => {
  const r = tmpRepo();
  fs.writeFileSync(path.join(r.dir, '.publicignore'), '# nothing here\n');
  assert.equal(check(r, commitFiles(r, { ...CLEAN, '.claude/settings.json': '{}' })), 1);
});

test('check.sh: a missing pattern file is an error, not a pass', () => {
  const r = tmpRepo();
  fs.rmSync(path.join(r.dir, '.publicignore'));
  assert.equal(check(r, commitFiles(r, CLEAN)), 2);
});

test('check.sh: a submodule (gitlink) is blocked', () => {
  const r = tmpRepo();
  const base = commitFiles(r, CLEAN);
  const idx = path.join(r.dir, '.git', 'idx-sub');
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  execFileSync('git', ['read-tree', base], { cwd: r.dir, env });
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${base},vendor/private`], {
    cwd: r.dir,
    env,
  });
  const tree = execFileSync('git', ['write-tree'], { cwd: r.dir, env, encoding: 'utf8' }).trim();
  assert.equal(check(r, tree), 1);
});

test('check.sh: a file that only ever existed in a merge commit is caught by the range check', () => {
  const r = tmpRepo();
  const base = commitFiles(r, CLEAN);
  const side = commitFiles(r, { ...CLEAN, 'b.js': 'b' }, { parent: base });
  // Merge resolution adds _testing/leak.cisco; the next commit deletes it again.
  const mergeTree = commitFiles(r, { ...CLEAN, 'b.js': 'b', '_testing/leak.cisco': 'x' });
  const treeSha = r.git('rev-parse', `${mergeTree}^{tree}`);
  const merge = r.git('commit-tree', treeSha, '-p', base, '-p', side, '-m', 'merge');
  const after = commitFiles(r, { ...CLEAN, 'b.js': 'b' }, { parent: merge });
  assert.equal(check(r, after), 0, 'tip tree is clean');
  assert.equal(check(r, `${base}..${after}`), 1, 'history is not');
});

// ------------------------------------------------------------------ pre-push
// A local bare repo stands in for the public remote; any URL that isn't the
// private cisco-lsp-dev repo is guarded.
function withRemote() {
  const r = tmpRepo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'public-guard-bare-'));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  return { ...r, url: bare };
}
const prePush = ({ dir, url }, lines, remoteUrl = url) =>
  spawnSync('bash', ['scripts/git-hooks/pre-push', 'public', remoteUrl], {
    cwd: dir,
    input: lines.map((l) => l.join(' ')).join('\n') + '\n',
    encoding: 'utf8',
  });
// Refused by the guard itself (exit 1 + its message), not by a crash.
const refused = (out, msg) => {
  assert.equal(out.status, 1, `${msg || ''} ${out.stderr}`);
  assert.match(out.stderr, /pre-push \(public guard/);
};
const seedMain = (r) => {
  const c = commitFiles(r, CLEAN);
  execFileSync('git', ['push', '-q', '--no-verify', r.url, `${c}:refs/heads/main`], { cwd: r.dir });
  return c;
};

test('pre-push: the private dev repo passes through, in any URL spelling', () => {
  const r = withRemote();
  const leak = commitFiles(r, { 'CLAUDE.md': 'x' }, { message: 'wip' });
  for (const u of [
    'https://github.com/Aswertus/cisco-lsp-dev.git',
    'git@github.com:aswertus/Cisco-LSP-dev',
  ]) {
    assert.equal(prePush(r, [['x', leak, 'refs/heads/claude_dev', ZERO]], u).status, 0, u);
  }
});

test('pre-push: a proper release commit on release/v* is allowed', () => {
  const r = withRemote();
  const main = seedMain(r);
  const rel = commitFiles(r, { ...CLEAN, 'new.js': 'x' }, { parent: main });
  const out = prePush(r, [['x', rel, 'refs/heads/release/v1.0.0', ZERO]]);
  assert.equal(out.status, 0, out.stderr);
});

for (const [name, mk] of [
  [
    'a forbidden path',
    (r, main) => commitFiles(r, { ...CLEAN, '.claude/x': 'x' }, { parent: main }),
  ],
  [
    'two new commits (private history)',
    (r, main) => commitFiles(r, CLEAN, { parent: commitFiles(r, { a: 'a' }, { parent: main }) }),
  ],
  [
    'a non-release commit message',
    (r, main) =>
      commitFiles(r, { ...CLEAN, n: 'n' }, { parent: main, message: 'wip: secret plans' }),
  ],
  [
    'a personal author identity',
    (r, main) =>
      commitFiles(
        r,
        { ...CLEAN, n: 'n' },
        { parent: main, identity: { name: 'Me', email: 'me@example.invalid' } },
      ),
  ],
  ['a bare tree instead of a commit', (r) => r.git('rev-parse', `${commitFiles(r, CLEAN)}^{tree}`)],
]) {
  test(`pre-push: blocks ${name}`, () => {
    const r = withRemote();
    const main = seedMain(r);
    refused(prePush(r, [['x', mk(r, main), 'refs/heads/release/v1.0.0', ZERO]]));
  });
}

test('pre-push: blocks dev branches, direct pushes to main and tags on new commits', () => {
  const r = withRemote();
  const main = seedMain(r);
  const rel = commitFiles(r, { ...CLEAN, n: 'n' }, { parent: main });
  refused(prePush(r, [['x', rel, 'refs/heads/claude_dev', ZERO]]));
  refused(prePush(r, [['x', rel, 'refs/heads/main', main]]));
  refused(prePush(r, [['x', rel, 'refs/tags/v1.0.0', ZERO]]));
});

test('pre-push: an annotated tag must come from release.sh (tagger identity)', () => {
  const r = withRemote();
  const main = seedMain(r);
  r.git('tag', '-a', 'v1.0.0', '-m', 'release: v1.0.0', main);
  const tagSha = r.git('rev-parse', 'v1.0.0');
  assert.notEqual(
    prePush(r, [['x', tagSha, 'refs/tags/v1.0.0', ZERO]]).status,
    0,
    'personal tagger',
  );
  const env = {
    ...process.env,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
  };
  execFileSync('git', ['tag', '-f', '-a', 'v1.0.0', '-m', 'release: v1.0.0', main], {
    cwd: r.dir,
    env,
  });
  const out = prePush(r, [['x', r.git('rev-parse', 'v1.0.0'), 'refs/tags/v1.0.0', ZERO]]);
  assert.equal(out.status, 0, out.stderr);
});

test('tag-object.sh: the tag release.sh pushes passes the guard, a foreign tagger does not', () => {
  const r = withRemote();
  const main = seedMain(r);
  fs.copyFileSync(
    path.join(ROOT, 'scripts/public/tag-object.sh'),
    path.join(r.dir, 'scripts/public/tag-object.sh'),
  );
  const tree = r.git('rev-parse', `${main}^{tree}`);
  const mk = (name, email, commit = main) =>
    execFileSync('bash', ['scripts/public/tag-object.sh', commit, tree, 'v1.0.0', name, email], {
      cwd: r.dir,
      encoding: 'utf8',
    }).trim();
  const tagSha = mk(IDENTITY.name, IDENTITY.email);
  assert.equal(r.git('cat-file', '-t', tagSha), 'tag');
  assert.equal(r.git('rev-parse', `${tagSha}^{commit}`), main);
  assert.equal(r.git('tag', '-l'), '', 'no local refs/tags/ entry is created');
  const out = prePush(r, [['x', tagSha, 'refs/tags/v1.0.0', ZERO]]);
  assert.equal(out.status, 0, out.stderr);
  refused(prePush(r, [['x', mk('Me', 'me@example.invalid'), 'refs/tags/v1.0.0', ZERO]]));
});

test('tag-object.sh: refuses a commit whose content is not the release tree, whatever its subject', () => {
  const r = withRemote();
  const main = seedMain(r);
  fs.copyFileSync(
    path.join(ROOT, 'scripts/public/tag-object.sh'),
    path.join(r.dir, 'scripts/public/tag-object.sh'),
  );
  // A later PR squash-merged under a reused title, carrying other content.
  const other = commitFiles(
    r,
    { ...CLEAN, 'extra.js': 'x' },
    {
      parent: main,
      message: 'release: v1.0.0 (#2)',
    },
  );
  const out = spawnSync(
    'bash',
    [
      'scripts/public/tag-object.sh',
      other,
      r.git('rev-parse', `${main}^{tree}`),
      'v1.0.0',
      IDENTITY.name,
      IDENTITY.email,
    ],
    { cwd: r.dir, encoding: 'utf8' },
  );
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stderr, /does not carry the expected release tree/);
  assert.equal(out.stdout, '', 'no tag object id is printed');
});

test('pre-push: guarded even when the public URL is spelled differently', () => {
  const r = withRemote();
  const leak = commitFiles(r, { 'CLAUDE.md': 'x' }, { message: 'wip' });
  for (const u of [
    'git@github.com:aswertus/cisco-lsp.git',
    'https://github.com/Aswertus/Cisco-LSP',
    'ssh://git@ssh.github.com:443/Aswertus/cisco-lsp.git',
  ]) {
    // Point the URL at the local bare repo so the hook's ls-remote never
    // touches the network — a refusal must come from the guard itself.
    r.git('config', `url.${r.url}.insteadOf`, u);
    const out = prePush(r, [['x', leak, 'refs/heads/claude_dev', ZERO]], u);
    assert.notEqual(out.status, 0, u);
    assert.match(out.stderr, /pre-push \(public guard/, u);
    r.git('config', '--unset', `url.${r.url}.insteadOf`);
  }
});

test('check.sh: a negation (!) line in .publicignore is refused', () => {
  const r = tmpRepo();
  fs.appendFileSync(path.join(r.dir, '.publicignore'), '!CLAUDE.md\n');
  assert.equal(check(r, commitFiles(r, { ...CLEAN, 'CLAUDE.md': 'x' })), 2);
});

// ------------------------------------------------------------------- audit.js
// Fake production data, assembled at runtime so this (public) file never
// contains a non-example IP literal.
const FAKE_HOST = 'FAKE-HOST-7';
const FAKE_IP = ['172', '31', '254', '77'].join('.');
function auditRepo(configText = `hostname ${FAKE_HOST}\n ip address ${FAKE_IP} 255.255.255.0\n`) {
  const r = tmpRepo();
  fs.copyFileSync(
    path.join(ROOT, 'scripts/public/audit.js'),
    path.join(r.dir, 'scripts/public/audit.js'),
  );
  if (configText !== null) {
    fs.mkdirSync(path.join(r.dir, '_testing'));
    fs.writeFileSync(path.join(r.dir, '_testing', 'sw-confg'), configText);
  }
  return r;
}
const audit = (r, tree) =>
  spawnSync('node', ['scripts/public/audit.js', tree], { cwd: r.dir, encoding: 'utf8' });

test('audit: a clean tree passes', () => {
  const r = auditRepo();
  const out = audit(r, commitFiles(r, CLEAN));
  assert.equal(out.status, 0, out.stderr);
});

test('audit: a hostname from a real config is flagged (config without extension)', () => {
  const r = auditRepo();
  const out = audit(
    r,
    commitFiles(r, { ...CLEAN, 'docs/x.md': `see ${FAKE_HOST.toLowerCase()}\n` }),
  );
  assert.equal(out.status, 1);
  assert.match(out.stderr, /identifier from _testing/);
});

test('audit: an IP from a real config is flagged, also in UTF-16 files', () => {
  const r = auditRepo();
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(`ntp server ${FAKE_IP}\n`, 'utf16le'),
  ]);
  const out = audit(r, commitFiles(r, { ...CLEAN, 'notes.md': utf16 }));
  assert.equal(out.status, 1);
  assert.match(out.stderr, /IP from a real config/);
});

test('audit: SNMP communities and pre-shared keys are flagged', () => {
  const r = auditRepo();
  const out = audit(
    r,
    commitFiles(r, {
      ...CLEAN,
      // Joined at runtime so the audit of this public file doesn't flag them.
      'a.md': ['snmp-server community', 'Wh4tever RO\n'].join(' '),
      'b.md': ['crypto isakmp key', 'S3cretKey address 0.0.0.0\n'].join(' '),
    }),
  );
  assert.equal(out.status, 1);
  assert.match(out.stderr, /SNMP community/);
  assert.match(out.stderr, /pre-shared key/);
});

test('audit: without configs in _testing/ it refuses (exit 2) instead of passing', () => {
  const r = auditRepo(null);
  assert.equal(audit(r, commitFiles(r, CLEAN)).status, 2);
});

// ------------------------------------------------------ Claude Code hook
// Lives in .claude/, which never goes public — skipped in a public clone.
const HOOK = path.join(ROOT, '.claude/hooks/public-guard.sh');
const hook = (payload, env = process.env) =>
  spawnSync('/bin/bash', [HOOK], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...env, CLAUDE_PROJECT_DIR: ROOT },
  });
const decision = (out) =>
  out.stdout.trim() ? JSON.parse(out.stdout).hookSpecificOutput.permissionDecision : 'pass';
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const skip = !fs.existsSync(HOOK);
// Spelled in pieces so this file's own text doesn't trip the hook when edited.
const NO_VERIFY = ['--no', 'verify'].join('-');

test('claude hook: ordinary commands and edits pass silently', { skip }, () => {
  assert.equal(decision(hook(bash('npm test'))), 'pass');
  assert.equal(decision(hook(bash('cat scripts/public/release.sh'))), 'pass');
  const edit = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(ROOT, 'server/lib/data.js') },
  };
  assert.equal(decision(hook(edit)), 'pass');
});

test('claude hook: hook bypasses are denied outright', { skip }, () => {
  for (const c of [
    `git push ${NO_VERIFY} origin x`,
    'H=hooks' + 'Path; git -c core.$H=/tmp/x push origin x',
    'git -c remote.origin.url=https://example.invalid/x.git push origin x',
    'GIT_CONFIG_GLOBAL=/tmp/c git push origin x',
  ]) {
    assert.equal(decision(hook(bash(c))), 'deny', c);
  }
});

test(
  'claude hook: shell writes to guard files and edits via other paths need approval',
  { skip },
  () => {
    assert.equal(decision(hook(bash("printf 'exit 0' > .claude/hooks/public-guard.sh"))), 'ask');
    assert.equal(decision(hook(bash('chmod -x scripts/git-hooks/pre-push'))), 'ask');
    const sneaky = `${ROOT}/./scripts/public/../public/check.sh`;
    assert.equal(decision(hook({ tool_name: 'Write', tool_input: { file_path: sneaky } })), 'ask');
  },
);

test(
  'claude hook: an internal error blocks (exit 2) instead of letting the command run',
  { skip },
  () => {
    const out = hook(bash('git push public x'), { PATH: '/nonexistent' });
    assert.equal(out.status, 2, out.stderr);
  },
);

// ------------------------------------------------------------ audit: images
// Minimal synthetic images; the metadata check walks the file structure, so
// CRCs and pixel data don't need to be valid.
const pngChunk = (type, data = Buffer.alloc(0)) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
const png = (...chunks) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13)),
    ...chunks,
    pngChunk('IDAT', Buffer.from('pixels-with-@-and-tEXt-bytes')),
    pngChunk('IEND'),
  ]);
const gif = (...ext) =>
  Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([1, 0, 1, 0, 0, 0, 0]), // 1x1, no global color table
    ...ext,
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0]), // image + data
    Buffer.from([0x3b]),
  ]);
const NETSCAPE = Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]);
const auditWithBase = (r, tree, base) =>
  spawnSync('node', ['scripts/public/audit.js', tree, ...(base ? [base] : [])], {
    cwd: r.dir,
    encoding: 'utf8',
  });

test('audit: clean images pass and are listed for visual review', () => {
  const r = auditRepo();
  const out = auditWithBase(
    r,
    commitFiles(r, { ...CLEAN, 'media/a.png': png(), 'media/b.gif': gif(NETSCAPE) }),
  );
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /REVIEW 2 image\(s\)/);
  assert.match(out.stdout, /media\/a\.png/);
});

test('audit: only images new or changed against the base are listed', () => {
  const r = auditRepo();
  const base = commitFiles(r, { ...CLEAN, 'media/a.png': png() });
  const next = commitFiles(r, { ...CLEAN, 'media/a.png': png(), 'media/new.png': png() });
  const out = auditWithBase(r, next, base);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /REVIEW 1 image\(s\)/);
  assert.doesNotMatch(out.stdout, /media\/a\.png/);
});

for (const [name, file, data] of [
  [
    'PNG text chunk (e.g. Software/Author)',
    'shot.png',
    png(pngChunk('tEXt', Buffer.from('Author\0someone'))),
  ],
  ['PNG EXIF chunk', 'shot.png', png(pngChunk('eXIf', Buffer.from('MM')))],
  [
    'JPEG EXIF',
    'photo.jpg',
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 8, ...Buffer.from('Exif\0\0'), 0xff, 0xd9]),
  ],
  [
    'JPEG comment',
    'photo.jpeg',
    Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0, 5, ...Buffer.from('hi!'), 0xff, 0xd9]),
  ],
  ['GIF comment', 'anim.gif', gif(Buffer.from([0x21, 0xfe, 3, ...Buffer.from('abc'), 0]))],
  [
    'GIF XMP application block',
    'anim.gif',
    gif(Buffer.from([0x21, 0xff, 11, ...Buffer.from('XMP DataXMP'), 1, 0x3c, 0])),
  ],
  ['an uninspectable format (BMP)', 'pic.bmp', Buffer.from('BM-not-checked')],
  // Hidden data after the end marker (aCropalypse: the uncropped original).
  [
    'bytes after PNG IEND',
    'shot.png',
    Buffer.concat([png(), Buffer.from('uncropped-original-pixels')]),
  ],
  ['a PNG without IEND', 'shot.png', png().subarray(0, -12)],
  ['bytes after the GIF trailer', 'anim.gif', Buffer.concat([gif(NETSCAPE), Buffer.from('xx')])],
  [
    'bytes after JPEG end of image',
    'photo.jpg',
    Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 0xff, 0x00, 2, 0xff, 0xd9, 0x55, 0x55]),
  ],
]) {
  test(`audit: flags ${name}`, () => {
    const r = auditRepo();
    const out = auditWithBase(r, commitFiles(r, { ...CLEAN, [`media/${file}`]: data }));
    assert.equal(out.status, 1, out.stdout);
    assert.match(out.stderr, /image metadata/);
  });
}
