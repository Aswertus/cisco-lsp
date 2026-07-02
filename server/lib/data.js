'use strict';

const fs = require('fs');
const path = require('path');
const { CompletionItemKind } = require('vscode-languageserver/node');

// ---------------------------------------------------------------------------
// Command data — loaded from <dataDir>/commands.json (merged at build time by
// scripts/build.js) or, in the source layout, <dataDir>/<packId>/*.json
// (PDF-derived, see scripts/extract-commands.js and
// scripts/EXTRACTION_NOTES.md) plus <dataDir>/curated/curated.json
// (hand-maintained; see the reconciliation notes in that Phase's commit for
// why each entry stays hand-written).
// ---------------------------------------------------------------------------

// `log` matches connection.console's shape ({ log, error }).
function loadCommands(dataDir, log) {
  // Packaged layout: one merged file — a single open+parse at startup
  // instead of a directory walk over 17+ files.
  const merged = path.join(dataDir, 'commands.json');
  if (fs.existsSync(merged)) {
    try {
      return JSON.parse(fs.readFileSync(merged, 'utf8'));
    } catch (err) {
      log.error(`Merged command data unreadable (${err.message}) — falling back to pack files.`);
    }
  }

  // Dev/source layout: one directory per pack.
  const commands = [];
  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packDir = path.join(dataDir, entry.name);
    for (const file of fs.readdirSync(packDir)) {
      if (!file.endsWith('.json')) continue;
      // One corrupt pack file must not take down the whole server — skip it
      // and log to the client's output channel.
      try {
        const records = JSON.parse(fs.readFileSync(path.join(packDir, file), 'utf8'));
        commands.push(...records);
      } catch (err) {
        log.error(`Skipping unreadable data file ${entry.name}/${file}: ${err.message}`);
      }
    }
  }
  return commands;
}

// Which contextual block bucket(s) a command belongs to, derived from its
// `modes` text (the PDF's "Command Modes" field, or a hand-assigned
// equivalent for curated entries). EXEC-mode commands (show/clear/debug) are
// ~40% of the PDF corpus -- too large to fold into `global` without mixing
// two mutually-exclusive contexts (you're either at a `#` EXEC prompt or a
// `(config)#` prompt, never both) -- so they get their own bucket.
//
// Bucket names must match the `block` values in lib/blocks.js's
// BLOCK_OPENERS table: the flush-left indentation recovery (see
// lib/indentation.js) uses an opener's block name to look up which commands
// count as evidence of being that block's child. Rule order matters only for
// classifyModesToBlock()'s single-bucket result (completions): the original
// five buckets stay first so a command matching both an old and a new bucket
// keeps its completion bucket.
const MODE_BUCKET_RULES = [
  ['interface', /config-if\b|interface configuration/],
  ['router', /config-router\b|router (configuration|address family)/],
  ['class-map', /config-cmap\b|class-map/],
  ['policy-map', /config-pmap\b|policy-map/],
  ['line', /config-line\b|^line /],
  ['vrf', /config-vrf\b|vrf configuration/],
  ['vlan', /config-vlan\b|vlan configuration/],
  ['flow-record', /config-flow-record\b|flow record configuration/],
  ['flow-exporter', /config-flow-exporter\b|flow exporter configuration/],
  ['flow-monitor', /config-flow-monitor\b|flow monitor configuration/],
  ['service-template', /config-service-template\b|service template configuration/],
  // Negative lookbehind: "service template configuration" contains the
  // substring "template configuration" and must not land here too.
  ['template', /config-template\b|(?<!service[- ])template configuration/],
  ['route-map', /config-route-map\b|route-map configuration/],
  ['access-list', /config-(std|ext)-nacl\b|named access list configuration/],
  ['aaa-group', /config-sg-|server group configuration/],
  ['key-chain', /config-keychain\b|key-?chain configuration/],
  ['radius-server', /config-radius-server\b|radius server configuration/],
  ['tacacs-server', /config-server-tacacs\b|tacacs server configuration/],
  ['device-tracking', /config-device-tracking\b|device-tracking configuration/],
  ['crypto-map', /config-crypto-map\b|crypto map configuration/],
];

// All matching buckets — a command valid in several modes lands in every one
// (needed by the flush-child evidence check). `exec`/`global` are fallbacks,
// never combined with a real block bucket.
function classifyModesToBlocks(modes) {
  const joined = (modes || []).join(' | ').toLowerCase();
  const blocks = [];
  for (const [block, re] of MODE_BUCKET_RULES) {
    if (re.test(joined)) blocks.push(block);
  }
  if (blocks.length === 0) blocks.push(/\bexec\b/.test(joined) ? 'exec' : 'global');
  return blocks;
}

// Single-bucket variant used for completions (one command, one list).
function classifyModesToBlock(modes) {
  return classifyModesToBlocks(modes)[0];
}

// Known top-level command roots — for typo diagnostics. Base set covers
// keywords that aren't "commands" in the data's sense (no, end, exit, ...)
// plus everything already known to be valid before command data existed;
// buildData() adds every loaded command's first token on top. Purely
// additive, so it can only grow as more commands/packs load.
const KNOWN_TOP_LEVEL_BASE = new Set([
  'interface',
  'router',
  'ip',
  'ipv6',
  'vlan',
  'class-map',
  'policy-map',
  'parameter-map',
  'template',
  'l2vpn',
  'hostname',
  'username',
  'enable',
  'line',
  'logging',
  'ntp',
  'service',
  'aaa',
  'tacacs',
  'radius',
  'crypto',
  'zone',
  'zone-pair',
  'no',
  'access-list',
  'snmp-server',
  'spanning-tree',
  'vtp',
  'banner',
  'boot',
  'clock',
  'domain',
  'errdisable',
  'lldp',
  'cdp',
  'mac',
  'port-channel',
  'standby',
  'track',
  'route-map',
  'key',
  'object-group',
  'archive',
  'event',
  'flow',
  'license',
  'platform',
  'redundancy',
  'vrf',
  'controller',
  'voice',
  'dial-peer',
  'end',
  'exit',
  'version',
  'frame-relay',
  'monitor',
  'qos',
  'mls',
  'system',
  'device-tracking',
  'authentication',
  'dot1x',
  'epm',
  'identity',
  'policy',
  'subscriber',
  'cts',
  'pki',
]);

// Only label/kind/detail are built eagerly; the full documentation is
// computed lazily in onCompletionResolve (see the capability flag in
// onInitialize) so a large completion list (the `global` bucket alone can
// hold 300+ entries) doesn't serialize a rich Markdown doc for every item on
// every keystroke-triggered request.
function toCommandCompletionItems(commands) {
  const seen = new Set();
  const items = [];
  for (const c of commands) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue; // dedupe same-named entries within one bucket
    seen.add(key);
    items.push({
      label: c.name,
      kind: CompletionItemKind.Keyword,
      detail: c.detail || c.syntax || undefined,
      data: key,
    });
  }
  return items;
}

// Loads the command data and builds every derived index in one go:
//   commandsByName          — longest-prefix hover/lookup index; array-valued
//                             because command names can repeat (two
//                             syntaxes/modes in one source, or the same name
//                             on two platforms once several packs load)
//   maxCommandWords         — longest command name, bounds hover lookups
//   completionItemsByBlock  — static completion-item array per block, plus
//                             'top-level' merging `global` + `exec` (see the
//                             comment at the completion handler)
//   knownTopLevel           — KNOWN_TOP_LEVEL_BASE + each command's first word
function buildData(dataDir, log) {
  const allCommands = loadCommands(dataDir, log);

  const commandsByBlock = new Map();
  for (const command of allCommands) {
    const block = classifyModesToBlock(command.modes);
    if (!commandsByBlock.has(block)) commandsByBlock.set(block, []);
    commandsByBlock.get(block).push(command);
  }

  const commandsByName = new Map();
  for (const command of allCommands) {
    const key = command.name.toLowerCase();
    if (!commandsByName.has(key)) commandsByName.set(key, []);
    commandsByName.get(key).push(command);
  }

  const maxCommandWords = Math.max(1, ...allCommands.map((c) => c.name.split(/\s+/).length));

  const completionItemsByBlock = new Map();
  for (const [block, commands] of commandsByBlock) {
    completionItemsByBlock.set(block, toCommandCompletionItems(commands));
  }
  completionItemsByBlock.set(
    'top-level',
    toCommandCompletionItems([
      ...(commandsByBlock.get('global') || []),
      ...(commandsByBlock.get('exec') || []),
    ]),
  );

  const knownTopLevel = new Set(KNOWN_TOP_LEVEL_BASE);
  for (const command of allCommands) {
    knownTopLevel.add(command.name.split(/\s+/)[0].toLowerCase());
  }

  // Per-block command-name sets, feeding the flush-left indentation
  // recovery's evidence check (lib/indentation.js): a column-0 line right
  // after a block opener is only treated as that block's child if its
  // command is known to exist in that block's mode. `global`/`exec` buckets
  // are skipped — they can never be child evidence.
  const blockCommandNames = new Map();
  for (const command of allCommands) {
    for (const block of classifyModesToBlocks(command.modes)) {
      if (block === 'global' || block === 'exec') continue;
      if (!blockCommandNames.has(block)) blockCommandNames.set(block, new Set());
      blockCommandNames.get(block).add(command.name.toLowerCase());
    }
  }

  const isChildCommand = (block, text) => {
    const names = blockCommandNames.get(block);
    if (!names) return false;
    const t = text.toLowerCase();
    if (names.has(t)) return true;
    for (const name of names) {
      if (t.startsWith(name + ' ')) return true;
    }
    return false;
  };

  return {
    commandCount: allCommands.length,
    commandsByName,
    maxCommandWords,
    completionItemsByBlock,
    knownTopLevel,
    blockCommandNames,
    isChildCommand,
  };
}

module.exports = {
  loadCommands,
  classifyModesToBlock,
  classifyModesToBlocks,
  KNOWN_TOP_LEVEL_BASE,
  buildData,
};
