'use strict';

const {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  CompletionItemKind,
  DiagnosticSeverity,
  TextDocumentSyncKind,
  MarkupKind,
} = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');
const fs = require('fs');
const path = require('path');

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const K = CompletionItemKind;

// Interface types — offered after typing `interface ` and at slot completion.
const INTERFACE_TYPES = [
  { label: 'GigabitEthernet', detail: 'physical — 1G (alias: gi)' },
  { label: 'FastEthernet', detail: 'physical — 100M (alias: fa)' },
  { label: 'TenGigabitEthernet', detail: 'physical — 10G (alias: te)' },
  { label: 'TwentyFiveGigE', detail: 'physical — 25G (alias: twe)' },
  { label: 'FortyGigabitEthernet', detail: 'physical — 40G (alias: fo)' },
  { label: 'HundredGigE', detail: 'physical — 100G (alias: hu)' },
  { label: 'Port-channel', detail: 'logical — LAG bundle (alias: po)' },
  { label: 'Tunnel', detail: 'logical — tunnel interface (alias: tu)' },
  { label: 'Loopback', detail: 'logical — loopback (alias: lo)' },
  { label: 'Vlan', detail: 'logical — switched virtual interface (SVI)' },
];

// Valid IOS-XE interface type names (lower-cased), incl. common abbreviations.
const VALID_INTERFACE_TYPES = [
  'gigabitethernet',
  'gi',
  'gig',
  'fastethernet',
  'fa',
  'tengigabitethernet',
  'te',
  'ten',
  'twentyfivegige',
  'twe',
  'fortygigabitethernet',
  'fo',
  'fou',
  'hundredgige',
  'hu',
  'port-channel',
  'po',
  'tunnel',
  'tu',
  'loopback',
  'lo',
  'vlan',
  'bdi',
  'serial',
  'se',
  'ethernet',
  'eth',
  'e',
  'cellular',
  'async',
  'dialer',
  'virtual-template',
  'multilink',
  'pseudowire',
  'nve',
  'appgigabitethernet',
];

// ---------------------------------------------------------------------------
// Command data — loaded from server/data/<packId>/*.json (PDF-derived, see
// scripts/extract-commands.js and scripts/EXTRACTION_NOTES.md) plus
// server/data/curated/curated.json (hand-maintained; see the reconciliation
// notes in that Phase's commit for why each entry stays hand-written).
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, 'data');

function loadAllCommands() {
  const commands = [];
  for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packDir = path.join(DATA_DIR, entry.name);
    for (const file of fs.readdirSync(packDir)) {
      if (!file.endsWith('.json')) continue;
      const records = JSON.parse(fs.readFileSync(path.join(packDir, file), 'utf8'));
      commands.push(...records);
    }
  }
  return commands;
}

const ALL_COMMANDS = loadAllCommands();

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

const COMMANDS_BY_BLOCK = new Map();
for (const command of ALL_COMMANDS) {
  const block = classifyModesToBlock(command.modes);
  if (!COMMANDS_BY_BLOCK.has(block)) COMMANDS_BY_BLOCK.set(block, []);
  COMMANDS_BY_BLOCK.get(block).push(command);
}

// Longest-prefix hover/lookup index. Array-valued because command names can
// repeat (documented under two different syntaxes/modes in the source, or —
// once more than one pack is loaded — the same name on two platforms).
const COMMANDS_BY_NAME = new Map();
for (const command of ALL_COMMANDS) {
  const key = command.name.toLowerCase();
  if (!COMMANDS_BY_NAME.has(key)) COMMANDS_BY_NAME.set(key, []);
  COMMANDS_BY_NAME.get(key).push(command);
}

const MAX_COMMAND_WORDS = Math.max(1, ...ALL_COMMANDS.map((c) => c.name.split(/\s+/).length));

// ---------------------------------------------------------------------------
// Known top-level command roots — for typo diagnostics.
// ---------------------------------------------------------------------------
//
// Base set covers keywords that aren't "commands" in the data's sense (no,
// end, exit, ...) plus everything already known to be valid before command
// data existed; the loop below adds every loaded command's first token on
// top. Purely additive, so it can only grow as more commands/packs load.

const KNOWN_TOP_LEVEL = new Set([
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
for (const command of ALL_COMMANDS) {
  KNOWN_TOP_LEVEL.add(command.name.split(/\s+/)[0].toLowerCase());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the current configuration block by walking backwards from `line`
 * over physical lines, using leading indentation as the block boundary signal
 * (IOS sub-mode commands are indented; the block header is at column 0 / less
 * indented). Falls back to scanning for the nearest less-indented header.
 *
 * Returns one of: 'interface' | 'router' | 'class-map' | 'policy-map' |
 *                 'line' | 'global'
 */
function detectBlock(lines, lineIndex) {
  const current = lines[lineIndex] ?? '';
  const currentIndent = leadingSpaces(current);

  // A header at column 0 with the cursor line indented means we're inside it.
  // Walk up to the nearest line with strictly less indentation than the
  // current line (its parent), or to a column-0 header.
  for (let i = lineIndex - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('!')) continue;

    const indent = leadingSpaces(raw);
    // The parent block header is less indented than the current line.
    if (indent < currentIndent || (currentIndent === 0 && indent === 0)) {
      const header = raw.trim().toLowerCase();
      const block = classifyHeader(header);
      if (block) return block;
      // A column-0 non-block line means we're back at global scope.
      if (indent === 0) return 'global';
    }
  }
  return 'global';
}

function classifyHeader(header) {
  if (header.startsWith('interface ')) return 'interface';
  if (header.startsWith('router ')) return 'router';
  if (header.startsWith('class-map')) return 'class-map';
  if (header.startsWith('policy-map')) return 'policy-map';
  if (header.startsWith('line ')) return 'line';
  return null;
}

function leadingSpaces(s) {
  const m = s.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function toInterfaceTypeItems(entries) {
  return entries.map((e) => ({
    label: e.label,
    kind: K.Class,
    detail: e.detail,
  }));
}

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
      kind: K.Keyword,
      detail: c.detail || c.syntax || undefined,
      data: key,
    });
  }
  return items;
}

// Builds the hover/completion-resolve documentation for one or more command
// records sharing a name (duplicates are shown together, labeled by
// platform/release when more than one is loaded, rather than picking one
// arbitrarily and hiding the rest).
function buildDocMarkdown(records) {
  const blocks = records.map((r) => {
    const parts = [];
    const syntaxLines = [r.syntax, r.noForm].filter(Boolean).join('\n');
    if (syntaxLines) parts.push('```\n' + syntaxLines + '\n```');
    if (r.params && r.params.length) {
      parts.push(r.params.map((p) => `- **${p.name}** — ${p.description}`).join('\n'));
    }
    if (r.usageSummary) parts.push(r.usageSummary);
    let block = parts.join('\n\n');
    if (records.length > 1) {
      const label = [r.platform, r.release].filter(Boolean).join(' ') || r.context || r.source;
      if (label) block = `**${label}**\n\n${block}`;
    }
    return block;
  });
  return blocks.join('\n\n---\n\n');
}

function findHoverRecords(tokens) {
  for (let n = Math.min(tokens.length, MAX_COMMAND_WORDS); n >= 1; n--) {
    const records = COMMANDS_BY_NAME.get(tokens.slice(0, n).join(' '));
    if (records) return records;
  }
  return null;
}

function isValidIpv4(addr) {
  const parts = addr.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

// ---------------------------------------------------------------------------
// LSP lifecycle
// ---------------------------------------------------------------------------

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {
      // Auto-trigger after a space (next-token) and on '.' is not relevant here.
      triggerCharacters: [' '],
      resolveProvider: true,
    },
    hoverProvider: true,
    documentFormattingProvider: true,
  },
}));

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const lineIndex = params.position.line;
  const currentLine = lines[lineIndex] ?? '';
  const prefix = currentLine.slice(0, params.position.character);
  const trimmed = prefix.trim().toLowerCase();

  // Special case: right after `interface ` → offer interface types.
  if (/^interface\s+\S*$/.test(trimmed) || /^interface\s+$/.test(prefix.toLowerCase())) {
    return toInterfaceTypeItems(INTERFACE_TYPES);
  }

  const block = detectBlock(lines, lineIndex);

  // Top-level (no enclosing block) completion offers both `global` and
  // `exec` commands: a .cisco file is a config file, not a session
  // transcript, so it doesn't itself distinguish an EXEC prompt from a
  // config prompt the way `detectBlock` distinguishes interface/router/etc.
  // sub-modes from their headers.
  if (block === 'global') {
    return toCommandCompletionItems([
      ...(COMMANDS_BY_BLOCK.get('global') || []),
      ...(COMMANDS_BY_BLOCK.get('exec') || []),
    ]);
  }
  return toCommandCompletionItems(COMMANDS_BY_BLOCK.get(block) || []);
});

connection.onCompletionResolve((item) => {
  if (!item.data) return item;
  const records = COMMANDS_BY_NAME.get(item.data);
  if (!records) return item;
  item.documentation = { kind: MarkupKind.Markdown, value: buildDocMarkdown(records) };
  return item;
});

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const line = doc.getText().split(/\r?\n/)[params.position.line] ?? '';
  let tokens = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens[0] === 'no' && tokens.length > 1) tokens = tokens.slice(1);

  const records = findHoverRecords(tokens);
  if (!records) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: buildDocMarkdown(records) },
  };
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

// Shared traversal behind both the indentation diagnostics (validate()) and
// the documentFormatting handler, so the linter and the formatter can never
// disagree about what's wrong with a file's indentation.
//
// onSiblingMismatch(lineIndex, indent, expectedIndent) — a non-blank/!/#
// line's indent disagrees with the indent its prior siblings under the same
// parent line already established, using indentation depth alone (not a
// keyword whitelist like `classifyHeader`) so it works for any IOS
// block-opening command, not just the interface/router/class-map/policy-map/
// line subset `classifyHeader` recognizes. A line that is *deeper* than the
// line before it is always accepted as the start of a new nested level
// (mirrors how Python's INDENT token works) — this only catches a later
// sibling disagreeing with the level its prior siblings already established.
//
// onMixedTabsSpaces(lineIndex, leadingLength) — leading whitespace mixing
// tabs and spaces, regardless of structural position. Cisco IOS config
// output never intentionally uses tabs for indentation, so any mix is a
// reliable signal of accidental/corrupted formatting. Runs on every line,
// including blank/comment ones, since it doesn't depend on block structure.
//
// A line flagged mixed-tabs is excluded from the sibling-mismatch check:
// its indentation can't be trusted to reflect deliberate depth (that's
// exactly why depth-comparison alone misses tab corruption in the first
// place — a tab always reads as "one char deeper," so it's silently
// accepted as valid new nesting rather than compared to siblings), and
// letting both fire would hand the formatter two conflicting edits over the
// same range.
function scanIndentation(lines, onSiblingMismatch, onMixedTabsSpaces) {
  const stack = [{ indent: -1, childIndent: null }]; // sentinel: true column-0 scope

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const leading = line.match(/^[ \t]*/)[0];
    const isMixed = leading.includes(' ') && leading.includes('\t');
    if (isMixed) {
      onMixedTabsSpaces(i, leading.length);
    }

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;

    const indent = leadingSpaces(line);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (indent > parent.indent) {
      if (parent.childIndent === null) {
        parent.childIndent = indent;
      } else if (indent !== parent.childIndent && !isMixed) {
        onSiblingMismatch(i, indent, parent.childIndent);
      }
      stack.push({ indent, childIndent: null });
    }
  });
}

function checkIndentation(lines, diagnostics) {
  scanIndentation(
    lines,
    (i, indent, expected) => {
      addDiag(
        diagnostics,
        i,
        0,
        indent,
        `Inconsistent indentation: this line uses ${indent} space(s), but sibling lines in this block use ${expected}.`,
        DiagnosticSeverity.Warning,
      );
    },
    () => {},
  );
}

function checkMixedIndentation(lines, diagnostics) {
  scanIndentation(lines, () => {}, (i, leadingLength) => {
    addDiag(
      diagnostics,
      i,
      0,
      leadingLength,
      'Indentation mixes tabs and spaces.',
      DiagnosticSeverity.Warning,
    );
  });
}

function validate(doc) {
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const diagnostics = [];

  checkIndentation(lines, diagnostics);
  checkMixedIndentation(lines, diagnostics);

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('#')) return;

    const indent = leadingSpaces(line);
    const tokens = trimmed.split(/\s+/);
    const first = tokens[0].toLowerCase();

    // (1) Unknown top-level command (only flag column-0 commands).
    if (indent === 0 && !KNOWN_TOP_LEVEL.has(first)) {
      addDiag(
        diagnostics,
        i,
        line.indexOf(tokens[0]),
        tokens[0].length,
        `Unknown command "${tokens[0]}" — possible typo.`,
        DiagnosticSeverity.Warning,
      );
    }

    // (2) Invalid interface type name.
    if (first === 'interface' && tokens[1]) {
      const typeName = tokens[1].toLowerCase().match(/^[a-z-]+/)?.[0] || '';
      if (typeName && !VALID_INTERFACE_TYPES.includes(typeName)) {
        const col = line.indexOf(tokens[1]);
        addDiag(
          diagnostics,
          i,
          col,
          tokens[1].length,
          `"${tokens[1]}" is not a recognised IOS-XE interface type.`,
          DiagnosticSeverity.Warning,
        );
      }
    }

    // (3) VLAN number out of range (1–4094). Matches "vlan <n>" and
    //     "switchport access vlan <n>".
    const vlanMatch = trimmed.match(/\bvlan\s+(\d+)\b/i);
    if (vlanMatch) {
      const n = Number(vlanMatch[1]);
      if (n < 1 || n > 4094) {
        const col = line.indexOf(vlanMatch[1], line.toLowerCase().indexOf('vlan'));
        addDiag(
          diagnostics,
          i,
          col,
          vlanMatch[1].length,
          `VLAN ${n} is out of range (must be 1–4094).`,
          DiagnosticSeverity.Error,
        );
      }
    }

    // (4) Malformed IPv4 address (basic dotted-quad shape but bad octet).
    const ipCandidates = trimmed.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
    ipCandidates.forEach((cand) => {
      if (!isValidIpv4(cand)) {
        const col = line.indexOf(cand);
        addDiag(
          diagnostics,
          i,
          col,
          cand.length,
          `"${cand}" is not a valid IPv4 address (octets must be 0–255).`,
          DiagnosticSeverity.Error,
        );
      }
    });
  });

  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

function addDiag(list, line, character, length, message, severity) {
  if (character < 0) character = 0;
  list.push({
    severity,
    range: {
      start: { line, character },
      end: { line, character: character + length },
    },
    message,
    source: 'cisco-ios-lsp',
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// Fixes exactly what checkIndentation/checkMixedIndentation flag — nothing
// more. A file that's already internally consistent produces no edits, even
// if it uses a different indent width than IOS's native 1-space-per-level
// convention.
connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const lines = doc.getText().split(/\r?\n/);
  const edits = [];

  scanIndentation(
    lines,
    (i, indent, expected) => {
      edits.push({
        range: { start: { line: i, character: 0 }, end: { line: i, character: indent } },
        newText: ' '.repeat(expected),
      });
    },
    (i, leadingLength) => {
      edits.push({
        range: { start: { line: i, character: 0 }, end: { line: i, character: leadingLength } },
        newText: ' '.repeat(leadingLength),
      });
    },
  );

  return edits;
});

// Debounce validation per-document on change.
const debounceTimers = new Map();

function scheduleValidation(doc) {
  const prev = debounceTimers.get(doc.uri);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    doc.uri,
    setTimeout(() => {
      debounceTimers.delete(doc.uri);
      validate(doc);
    }, 300),
  );
}

documents.onDidChangeContent((e) => scheduleValidation(e.document));
documents.onDidClose((e) => {
  const t = debounceTimers.get(e.document.uri);
  if (t) clearTimeout(t);
  debounceTimers.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
