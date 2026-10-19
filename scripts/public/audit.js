#!/usr/bin/env node
// Content audit for a tree about to go public — the path checks in check.sh
// can't see production data copied *into* a tracked file.
//
//   node scripts/public/audit.js <tree-ish> [<base-tree-ish>]
//
// Images can't be read for content, so for every image the audit
//   - flags embedded metadata (PNG text/EXIF chunks, JPEG EXIF/XMP/IPTC/
//     comments, GIF comments/XMP, WebP EXIF/XMP) — screenshot tools and
//     editors write user names, paths and software there;
//   - fails on image formats it can't inspect for metadata;
//   - lists every image that is new or changed against <base-tree-ish>
//     (default: everything) — those must be looked at by a person before
//     the release (CLAUDE.md, "Repositories & Branch Policy").
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

// A crash must not look like "findings" (exit 1): every unexpected error is exit 2.
process.on('uncaughtException', (err) => {
  console.error(`public-audit: internal error — ${err.stack || err}`);
  process.exit(2);
});

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tree = process.argv[2];
if (!tree) {
  console.error('usage: audit.js <tree-ish> [<base-tree-ish>]');
  process.exit(2);
}
const base = process.argv[3];
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
  // `.`/`-`/`_` too: GitHub's newer stateless installation tokens (ghs_..., ~520
  // chars) aren't plain alphanumerics.
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_.-]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
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
// `git config user.email`: exit 0 = an address, exit 1 = unset. Anything else (unreadable config,
// git missing) is a fault that must not silently become "no address".
function configuredEmail(res) {
  if (res.status === 0) return res.stdout.trim();
  if (res.status === 1) return '';
  throw new Error(
    `git config user.email failed: ${res.error || res.stderr || `exit ${res.status}`}`,
  );
}
function personalRes() {
  const log = git('log', '--all', '--format=%ae%n%ce').toString('utf8');
  // `git config` exits 1 when user.email is unset — that is "no address", not an error.
  const configured = spawnSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8' });
  const emails = new Set(
    log
      .split('\n')
      .concat(configuredEmail(configured))
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

// ---------------------------------------------------------------- images
// Metadata blocks per format, found by walking the file structure (a byte
// search would hit random bytes inside the compressed pixel data). Bytes after
// the format's end marker are flagged too: a cropping tool can leave the
// uncropped original there ("aCropalypse", CVE-2023-28303, Windows Snipping
// Tool) — invisible when looking at the image.
const trailing = (fmt, end, b) =>
  end < b.length
    ? [`${fmt}: ${b.length - end} bytes after the end marker (hidden data — re-save the image)`]
    : [];
function pngMeta(b) {
  const found = [];
  let end = -1;
  for (let i = 8; i + 8 <= b.length;) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type)) {
      const key =
        type === 'eXIf'
          ? ''
          : ` "${b.toString('latin1', i + 8, Math.min(i + 8 + len, i + 8 + 40)).split('\0')[0]}"`;
      found.push(`PNG ${type}${key}`);
    }
    if (type === 'IEND') {
      end = i + 12 + len;
      break;
    }
    i += 12 + len;
  }
  if (end < 0) return [...found, 'PNG structure not understood (no IEND)'];
  return [...found, ...trailing('PNG', end, b)];
}
function jpegMeta(b) {
  const found = [];
  let i = 2;
  let stop = null; // 'sos' | 'eoi' — anything else means the walk lost the structure
  for (; i + 4 <= b.length && b[i] === 0xff;) {
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) {
      stop = marker === 0xda ? 'sos' : 'eoi';
      break; // start of scan / end
    }
    const len = b.readUInt16BE(i + 2);
    const head = b.toString('latin1', i + 4, i + 4 + Math.min(len - 2, 32));
    if (marker === 0xe1) found.push(head.startsWith('Exif') ? 'JPEG EXIF' : 'JPEG XMP/APP1');
    else if (marker === 0xed) found.push('JPEG IPTC/Photoshop');
    else if (marker === 0xfe) found.push('JPEG comment');
    i += 2 + len;
  }
  if (!stop && i + 2 <= b.length && b[i] === 0xff && b[i + 1] === 0xd9) stop = 'eoi';
  if (!stop) return [...found, 'JPEG structure not understood'];
  // Inside scan data a literal 0xFF is stuffed as FF 00, so the first FF D9
  // after the start of scan is the real end of image.
  const eoi = stop === 'eoi' ? i : b.indexOf(Buffer.from([0xff, 0xd9]), i);
  if (eoi < 0) return [...found, 'JPEG structure not understood (no end of image)'];
  return [...found, ...trailing('JPEG', eoi + 2, b)];
}
function gifMeta(b) {
  const found = [];
  const skipSubBlocks = (i) => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    return i + 1;
  };
  let i = 13;
  if (b[10] & 0x80) i += 3 * 2 ** ((b[10] & 7) + 1); // global color table
  let end = -1;
  while (i < b.length) {
    if (b[i] === 0x3b) {
      end = i + 1; // trailer
      break;
    }
    if (b[i] === 0x2c) {
      // image descriptor (+ local color table), LZW min code size, data
      let j = i + 10;
      if (b[i + 9] & 0x80) j += 3 * 2 ** ((b[i + 9] & 7) + 1);
      i = skipSubBlocks(j + 1);
    } else if (b[i] === 0x21) {
      const label = b[i + 1];
      if (label === 0xfe) found.push('GIF comment');
      if (label === 0xff) {
        const app = b.toString('latin1', i + 3, i + 14);
        if (!/^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(app)) found.push(`GIF application data "${app}"`);
      }
      i = skipSubBlocks(i + 2);
    } else {
      found.push('GIF structure not understood');
      return found;
    }
  }
  if (end < 0) return [...found, 'GIF structure not understood (no trailer)'];
  return [...found, ...trailing('GIF', end, b)];
}
function webpMeta(b) {
  const found = [];
  for (let i = 12; i + 8 <= b.length;) {
    const type = b.toString('latin1', i, i + 4);
    const len = b.readUInt32LE(i + 4);
    if (type === 'EXIF' || type === 'XMP ') found.push(`WebP ${type.trim()}`);
    i += 8 + len + (len & 1);
  }
  return found;
}
const IMAGE = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|avif|heic)$/i;
function imageMeta(p, b) {
  try {
    if (/\.png$/i.test(p)) return pngMeta(b);
    if (/\.jpe?g$/i.test(p)) return jpegMeta(b);
    if (/\.gif$/i.test(p)) return gifMeta(b);
    if (/\.webp$/i.test(p)) return webpMeta(b);
  } catch (e) {
    return [`could not parse (${e.message})`];
  }
  return ['format not supported by the metadata check — convert to PNG'];
}

// ------------------------------------------------------------------ scan
const isPack = (p) => /^server\/data\/(?!curated\/)[^/]+\/[^/]+\.json$/.test(p);
const SKIP = (p) => p === 'package-lock.json' || /\.woff2?$/i.test(p);
const baseBlobs = new Map(
  base
    ? git('ls-tree', '-r', '-z', base)
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((e) => [e.split('\t')[1], e.split(' ')[2].split('\t')[0]])
    : [],
);
const reviewImages = [];
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
  if (IMAGE.test(p)) {
    const buf = git('cat-file', 'blob', sha);
    for (const what of imageMeta(p, buf)) findings.push([p, `image metadata: ${what}`]);
    if (baseBlobs.get(p) !== sha) reviewImages.push(p);
    continue;
  }
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
if (reviewImages.length) {
  console.log(
    `public-audit: REVIEW ${reviewImages.length} image(s) new/changed since ${base || '(no base)'} — look at each one before releasing:`,
  );
  for (const p of reviewImages) console.log(`  ${p}`);
}
console.log(`public-audit: OK (${tree})`);
