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

// Which contextual completion bucket a command belongs to, derived from its
// `modes` text (the PDF's "Command Modes" field, or a hand-assigned
// equivalent for curated entries). EXEC-mode commands (show/clear/debug) are
// ~40% of the PDF corpus -- too large to fold into `global` without mixing
// two mutually-exclusive contexts (you're either at a `#` EXEC prompt or a
// `(config)#` prompt, never both) -- so they get their own bucket. VRF and
// route-map modes were checked too and are vanishingly rare (well under 1%
// of commands), not worth dedicated buckets; they fall through to `global`.
function classifyModesToBlock(modes) {
  const joined = (modes || []).join(' | ').toLowerCase();
  if (/config-if\b|interface configuration/.test(joined)) return 'interface';
  if (/config-router\b|router (configuration|address family)/.test(joined)) return 'router';
  if (/config-cmap\b|class-map/.test(joined)) return 'class-map';
  if (/config-pmap\b|policy-map/.test(joined)) return 'policy-map';
  if (/config-line\b|^line /.test(joined)) return 'line';
  if (/\bexec\b/.test(joined)) return 'exec';
  return 'global';
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

  return {
    commandCount: allCommands.length,
    commandsByName,
    maxCommandWords,
    completionItemsByBlock,
    knownTopLevel,
  };
}

module.exports = { loadCommands, classifyModesToBlock, KNOWN_TOP_LEVEL_BASE, buildData };
