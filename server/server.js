'use strict';

// LSP wiring only — the actual logic lives in server/lib/ so it can be
// unit-tested without spinning up a connection:
//   lib/data.js         command data loading + derived indexes
//   lib/blocks.js       configuration-block detection for completions
//   lib/indentation.js  shared indentation scan (diagnostics + formatter)
//   lib/diagnostics.js  all per-file checks
//   lib/docs.js         hover / completion-resolve Markdown

const {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  CompletionItemKind,
  TextDocumentSyncKind,
  MarkupKind,
} = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');
const path = require('path');

const { buildData } = require('./lib/data');
const { detectBlock } = require('./lib/blocks');
const { computeDiagnostics } = require('./lib/diagnostics');
const { computeFormattingEdits } = require('./lib/indentation');
const { buildDocMarkdown, findHoverRecords } = require('./lib/docs');

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

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

const INTERFACE_TYPE_ITEMS = INTERFACE_TYPES.map((e) => ({
  label: e.label,
  kind: CompletionItemKind.Class,
  detail: e.detail,
}));

// ---------------------------------------------------------------------------
// Lazily-built command indexes
// ---------------------------------------------------------------------------
//
// Loading + indexing ~1,400 records (1.9 MB of JSON) takes tens of
// milliseconds — enough to keep it off the initialize handshake so the
// client isn't blocked waiting on capabilities. getData() memoizes; the
// onInitialized hook warms it right after the handshake, and every feature
// handler calls it so correctness never depends on the warm-up having run.

const DATA_DIR = path.join(__dirname, 'data');
let dataCache = null;

function getData() {
  if (dataCache) return dataCache;
  const started = Date.now();
  dataCache = buildData(DATA_DIR, connection.console);
  connection.console.log(
    `Command data ready: ${dataCache.commandCount} records indexed in ${Date.now() - started}ms.`,
  );
  return dataCache;
}

// ---------------------------------------------------------------------------
// Per-document line cache
// ---------------------------------------------------------------------------

// Split-lines cache, keyed by document URI and invalidated by version, so
// completion/hover/validate don't each re-split the whole document text on
// every keystroke. Entries are dropped in onDidClose.
const lineCache = new Map();

function getLines(doc) {
  const cached = lineCache.get(doc.uri);
  if (cached && cached.version === doc.version) return cached.lines;
  const lines = doc.getText().split(/\r?\n/);
  lineCache.set(doc.uri, { version: doc.version, lines });
  return lines;
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

// Warm the command indexes right after the handshake instead of during it —
// setImmediate so the `initialized` notification itself isn't blocked either.
connection.onInitialized(() => {
  setImmediate(getData);
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const lines = getLines(doc);
  const lineIndex = params.position.line;
  const currentLine = lines[lineIndex] ?? '';
  const prefix = currentLine.slice(0, params.position.character);
  const trimmed = prefix.trim().toLowerCase();

  // Special case: right after `interface ` → offer interface types.
  if (/^interface\s+\S*$/.test(trimmed) || /^interface\s+$/.test(prefix.toLowerCase())) {
    return INTERFACE_TYPE_ITEMS;
  }

  const block = detectBlock(lines, lineIndex);

  // Top-level (no enclosing block) completion offers both `global` and
  // `exec` commands: a .cisco file is a config file, not a session
  // transcript, so it doesn't itself distinguish an EXEC prompt from a
  // config prompt the way `detectBlock` distinguishes interface/router/etc.
  // sub-modes from their headers.
  const { completionItemsByBlock } = getData();
  if (block === 'global') return completionItemsByBlock.get('top-level');
  return completionItemsByBlock.get(block) || [];
});

connection.onCompletionResolve((item) => {
  if (!item.data) return item;
  const records = getData().commandsByName.get(item.data);
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

  const line = getLines(doc)[params.position.line] ?? '';
  let tokens = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens[0] === 'no' && tokens.length > 1) tokens = tokens.slice(1);

  const records = findHoverRecords(tokens, getData());
  if (!records) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: buildDocMarkdown(records) },
  };
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function validate(doc) {
  const diagnostics = computeDiagnostics(getLines(doc), getData().knownTopLevel);
  connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return computeFormattingEdits(getLines(doc));
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
  lineCache.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
