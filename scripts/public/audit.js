#!/usr/bin/env node
// Content audit for a tree about to go public — the path checks in check.sh
// can't see production data copied *into* a tracked file.
//
//   node scripts/public/audit.js <tree-ish>
//
// Flags, in every text file of the tree (UTF-8 or UTF-16):
//   - IPv4 addresses outside documentation/example ranges (not applied to the
//     generated Cisco-PDF packs under server/data/<pack>/, which quote
//     Cisco's own example addresses — everything else still is)
//   - secret-shaped strings (private keys, tokens, IOS hashes/keys, SNMP
//     communities, IKE pre-shared keys)
//   - personal data (owner's name/mail, home-directory paths)
//   - any identifier or IP lifted from the real configs in _testing/
//     (hostnames, VRF/server/group/ACL/prefix-list names, domains) plus the
//     optional regex list in _testing/public-denywords.txt
// Exits 1 with a report when anything is found, 2 on error.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tree = process.argv[2];
if (!tree) {
  console.error('usage: audit.js <tree-ish>');
  process.exit(2);
}
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const IDENTITY_LOGIN = 'aswertus'; // public GitHub handle, see release.sh
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 1 << 28 });

// ---------------------------------------------------------------- IPv4 rules
const ipToInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const inNet = (ip, net, bits) =>
  Math.floor(ipToInt(ip) / 2 ** (32 - bits)) === Math.floor(ipToInt(net) / 2 ** (32 - bits));
// Documentation ranges: never production, so never learned from configs.
const DOC_NETS = [
  ['192.0.2.0', 24], // RFC 5737 TEST-NET-1
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['127.0.0.0', 8],
];
// Additionally tolerated in public files (placeholders) — unless a real
// config uses them, in which case the config-IP check still flags them.
const PLACEHOLDER_NETS = [['10.0.0.0', 24]];
const ALLOWED_IPS = new Set(['0.0.0.0', '1.2.3.4', '255.255.255.255']);
const MASK_OCTETS = new Set(['0', '128', '192', '224', '240', '248', '252', '254', '255']);
const isMaskLike = (ip) => ip.split('.').every((o) => MASK_OCTETS.has(o)); // masks + wildcards
const isDoc = (ip) =>
  ALLOWED_IPS.has(ip) || isMaskLike(ip) || DOC_NETS.some(([n, b]) => inNet(ip, n, b));
const ipAllowed = (ip) => isDoc(ip) || PLACEHOLDER_NETS.some(([n, b]) => inNet(ip, n, b));
const IPV4 =
  /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text in UTF-8 or UTF-16 (BOM); null for binary.
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff)
    return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (buf.length > 3 && buf[1] === 0 && buf[3] === 0 && buf[0] !== 0)
    return buf.toString('utf16le');
  return buf.includes(0) ? null : buf.toString('utf8');
}

// ------------------------------------------------------------- fixed patterns
const PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['IOS password hash/key', /\b(?:secret|password|key)\s+[0-9]\s+(?!\*)[A-Za-z0-9$./]{8,}/i],
  ['IOS type-9/8/5 hash', /\$(?:9|8|1)\$[A-Za-z0-9./]{4,}\$[A-Za-z0-9./]{8,}/],
  ['SNMP community', /\bsnmp-server community\s+(?!<|\(|WORD\b|string\b)\S+/i],
  [
    'IKE / pre-shared key',
    /\b(?:crypto isakmp key|pre-shared-key(?: local| remote)?)\s+(?:[0-9]\s+)?(?!<|\(|WORD\b|address\b)\S{4,}/i,
  ],
  ['home-directory path', /(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)[A-Za-z][\w.-]*[\\/]/],
];
// Patterns that the generated packs legitimately trigger (command syntax).
const PACK_EXEMPT = new Set(['SNMP community', 'IKE / pre-shared key', 'IOS password hash/key']);

// Personal data, derived at runtime so it is never written into this
// (public) file: every author/committer email in the private history plus
// the local git identity and OS user name.
function personalRes() {
  const log = git('log', '--all', '--format=%ae%n%ce').toString('utf8');
  const emails = new Set(
    log
      .split('\n')
      .concat(execFileSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8' }).trim())
      .map((e) => e.trim().toLowerCase())
      .filter(
        (e) =>
          e &&
          !e.endsWith('@users.noreply.github.com') &&
          e !== 'noreply@github.com' &&
          !e.endsWith('@anthropic.com'),
      ),
  );
  const FREEMAIL = [
    'gmail',
    'outlook',
    'hotmail',
    'yahoo',
    'icloud',
    'proton',
    'protonmail',
    'gmx',
    'web',
  ];
  const words = new Set();
  for (const e of emails) {
    words.add(e);
    const [local, domain] = e.split('@');
    if (local.length >= 4) words.add(local);
    const name = domain.split('.')[0];
    if (!FREEMAIL.includes(name) && name.length >= 4) words.add(name);
  }
  const user = require('node:os').userInfo().username;
  if (user.length >= 4) words.add(user.toLowerCase());
  // The public GitHub handle (from the noreply identity) is meant to be public.
  for (const m of log.matchAll(/\d+\+([\w-]+)@users\.noreply\.github\.com/g))
    words.delete(m[1].toLowerCase());
  words.delete(IDENTITY_LOGIN);
  return [...words].map((w) => [
    `personal data (${w})`,
    new RegExp(`(?<![\\w-])${escape(w)}(?![\\w-])`, 'i'),
  ]);
}

// --------------------------------------- identifiers from the real configs
// Generic IOS defaults that legitimately appear in docs/tests.
const GENERIC = new Set([
  'default',
  'mgmt-vrf',
  'mgmt-intf',
  'sla-trustpoint',
  'tp-self-signed',
  'cisco',
  'local',
  'none',
  'admin',
  'switch',
  'router',
  'lab',
  'test',
  'global',
]);
const ID_RULES = [
  /^hostname\s+(\S+)/,
  /^vrf definition\s+(\S+)/,
  /^ip vrf\s+(\S+)/,
  /\bvrf (?:forwarding|member)\s+(\S+)/,
  /^username\s+(\S+)/,
  /^ip domain[ -]name\s+(\S+)/,
  /^(?:tacacs|radius) server\s+(\S+)/,
  /^aaa group server (?:tacacs\+|radius)\s+(\S+)/,
  /^crypto pki trustpoint\s+(\S+)/,
  /^snmp-server (?:location|contact)\s+(.+)/,
  /^snmp-server community\s+(\S+)/,
  /^\s*description\s+(.{6,})/,
];
// Named objects anywhere in a line. IOS keywords are lowercase, so only names
// with an uppercase letter, digit or underscore count (keeps "permit" etc. out).
const NAMED_OBJECT =
  /\b(?:prefix-list|route-map|class-map(?: match-(?:any|all))?|policy-map(?: type \S+)?|access-list(?: (?:standard|extended))?|access-group|object-group(?: network| service)?|key chain|flow (?:exporter|monitor|record)|locator-set|receiver protocol|trustpoint|server name|server-private|vrf(?: definition| forwarding| member)?|tacacs\+|radius|service-policy(?: input| output)?|track)\s+([A-Za-z][\w.-]*)/g;
const isName = (t) => t.length >= 4 && /[A-Z0-9_]/.test(t) && !GENERIC.has(t.toLowerCase());
function configIdentifiers() {
  const dir = path.join(root, '_testing');
  let configFiles = 0;
  const ids = new Map(); // id → source file
  const ips = new Set();
  const walk = (d) =>
    fs.existsSync(d)
      ? fs
          .readdirSync(d, { withFileTypes: true })
          .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
      : [];
  // Every text file in _testing/ counts, whatever its name (sw1-confg, no extension, ...).
  for (const file of walk(dir).filter((f) => !f.endsWith('public-denywords.txt'))) {
    const text = decode(fs.readFileSync(file));
    if (text === null) continue;
    configFiles++;
    for (const line of text.split(/\r?\n/)) {
      for (const re of ID_RULES) {
        const id = line.match(re)?.[1]?.trim();
        if (id && id.length >= 4 && !GENERIC.has(id.toLowerCase()))
          ids.set(id, path.relative(root, file));
      }
      for (const m of line.matchAll(NAMED_OBJECT))
        if (isName(m[1])) ids.set(m[1], path.relative(root, file));
      for (const ip of line.match(IPV4) || []) if (!isDoc(ip)) ips.add(ip);
    }
  }
  // Without the real configs this audit can't recognise production names —
  // fail rather than pass a release that was never compared against them.
  if (!configFiles) {
    console.error(
      'public-audit: no config files under _testing/ — cannot check for production identifiers',
    );
    process.exit(2);
  }
  return { ids, ips };
}
function denyWords() {
  const f = path.join(root, '_testing', 'public-denywords.txt');
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'i'));
}

// ------------------------------------------------------------------ scan
const isPack = (p) => /^server\/data\/(?!curated\/)[^/]+\/[^/]+\.json$/.test(p);
const SKIP = (p) => p === 'package-lock.json' || /\.(png|jpe?g|gif|ico|woff2?)$/i.test(p);
const files = git('ls-tree', '-r', '-z', tree).toString('utf8').split('\0').filter(Boolean);

const { ids, ips: configIps } = configIdentifiers();
const idRegex = () =>
  ids.size
    ? new RegExp(`(?<![\\w-])(?:${[...ids.keys()].map(escape).join('|')})(?![\\w-])`, 'gi')
    : null;
// A phrase that also appears in the generated packs (text from Cisco's public
// manuals, e.g. a description like "DHCP snooping") is not production-specific.
let generic = 0;
{
  const re = idRegex();
  const packText = files
    .map((e) => e.split('\t'))
    .filter(([, p]) => p && isPack(p))
    .map(([meta]) => git('cat-file', 'blob', meta.split(' ')[2]).toString('utf8'))
    .join('\n');
  for (const m of (re && packText.match(re)) || []) {
    const key = [...ids.keys()].find((k) => k.toLowerCase() === m.toLowerCase());
    if (key && ids.delete(key)) generic++;
  }
}
const idRe = idRegex();
const extraRes = denyWords();
PATTERNS.push(...personalRes());
const findings = [];
for (const entry of files) {
  const [meta, p] = entry.split('\t');
  const [, type, sha] = meta.split(' ');
  if (type !== 'blob' || SKIP(p)) continue;
  const text = decode(git('cat-file', 'blob', sha));
  if (text === null) continue; // binary
  const pack = isPack(p);
  text.split(/\r?\n/).forEach((line, i) => {
    const where = `${p}:${i + 1}`;
    for (const ip of line.match(IPV4) || []) {
      if (configIps.has(ip)) findings.push([where, `IP from a real config: ${ip}`]);
      else if (!pack && !ipAllowed(ip))
        findings.push([
          where,
          `non-example IP: ${ip} (use 192.0.2.x / 198.51.100.x / 203.0.113.x)`,
        ]);
    }
    for (const [label, re] of PATTERNS)
      if (!(pack && PACK_EXEMPT.has(label)) && re.test(line)) findings.push([where, label]);
    const m = idRe && line.match(idRe);
    if (m)
      findings.push([
        where,
        `identifier from ${ids.get([...ids.keys()].find((k) => k.toLowerCase() === m[0].toLowerCase()))}: "${m[0]}"`,
      ]);
    for (const re of extraRes) if (re.test(line)) findings.push([where, `deny-word ${re}`]);
  });
}

console.log(
  `public-audit: ${ids.size} identifiers (+${generic} also in Cisco's manuals, ignored) + ${configIps.size} IPs from _testing/ configs, ${extraRes.length} deny-words`,
);
if (findings.length) {
  console.error(`public-audit: ${findings.length} finding(s) in ${tree}:`);
  for (const [w, what] of findings.slice(0, 200)) console.error(`  ${w}  ${what}`);
  if (findings.length > 200) console.error(`  … and ${findings.length - 200} more`);
  process.exit(1);
}
console.log(`public-audit: OK (${tree})`);
