'use strict';

const vscode = require('vscode');
const https = require('https');
const path = require('path');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { parseRepo, isNewer } = require('./version');

let client;

function activate(context) {
  // Both dev and packaged runs load the built output — `main` points at
  // dist/client.js, so the sibling dist/server.js is always present.
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  client = new LanguageClient(
    'cisco-ios-lsp',
    'Cisco IOS LSP',
    {
      run: { module: serverModule, transport: TransportKind.stdio },
      debug: { module: serverModule, transport: TransportKind.stdio },
    },
    {
      documentSelector: [{ scheme: 'file', language: 'cisco' }],
    },
  );

  client.start();

  // Format-on-save comes from the `configurationDefaults` contribution in
  // package.json ("[cisco]": { "editor.formatOnSave": true }) — VS Code runs
  // our documentFormattingProvider itself; no save hook needed here.

  syncAutoIndent();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cisco-ios-lsp.experimental.autoIndent')) syncAutoIndent();
    }),
    { dispose: () => autoIndentDisposable?.dispose() },
  );

  // Fire-and-forget: never let an update check disrupt activation.
  checkForUpdates(context).catch(() => {});
}

function deactivate() {
  return client?.stop();
}

// ---------------------------------------------------------------------------
// Auto-indent on Enter (experimental, off by default)
//
// Enter after a block-opening command starts the next line indented by 1
// space (the [cisco] editor default). Gated behind the experimental
// cisco-ios-lsp.experimental.autoIndent setting, so the rules are applied
// dynamically here rather than statically in language-configuration.json.
// KEEP THE PATTERN IN SYNC with the BLOCK_OPENERS table in
// server/lib/blocks.js (see CLAUDE.md, "Adding a New Block Type").
// ---------------------------------------------------------------------------

const INCREASE_INDENT_PATTERN =
  /^\s*(?:interface |router |line |class-map|policy-map|vrf definition |vlan \d|flow (?:record|exporter|monitor) |service-template |template |route-map |ip access-list (?:standard|extended) |ipv6 access-list |aaa group server |key chain |radius server |tacacs server |device-tracking policy |crypto map |call-home$|control-plane|crypto pki (?:trustpoint|certificate chain) |telemetry (?:ietf subscription|receiver protocol|transform) |transceiver type |aaa server radius dynamic-author).*$/;

let autoIndentDisposable;

function syncAutoIndent() {
  const enabled = vscode.workspace
    .getConfiguration('cisco-ios-lsp')
    .get('experimental.autoIndent', false);
  if (enabled && !autoIndentDisposable) {
    autoIndentDisposable = vscode.languages.setLanguageConfiguration('cisco', {
      indentationRules: { increaseIndentPattern: INCREASE_INDENT_PATTERN },
    });
  } else if (!enabled && autoIndentDisposable) {
    autoIndentDisposable.dispose();
    autoIndentDisposable = undefined;
  }
}

// ---------------------------------------------------------------------------
// Update check
//
// Polls the public GitHub Releases API and notifies when a newer version
// exists. While the repository is private the unauthenticated request returns
// 404 and this silently no-ops; it starts working automatically if the repo is
// made public. No token is ever required on the user's machine.
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // at most once per day

async function checkForUpdates(context) {
  const config = vscode.workspace.getConfiguration('cisco-ios-lsp');
  if (!config.get('checkForUpdates', true)) return;

  const last = context.globalState.get('lastUpdateCheck', 0);
  if (Date.now() - last < CHECK_INTERVAL_MS) return;
  // Recorded before the request on purpose: a failed check (offline, repo
  // private) also waits out the interval instead of retrying the network on
  // every window reload.
  await context.globalState.update('lastUpdateCheck', Date.now());

  const pkg = context.extension.packageJSON;
  const current = pkg.version;
  const { owner, repo } = parseRepo(pkg.repository && pkg.repository.url);

  const release = await fetchLatestRelease(owner, repo);
  if (!release || !release.tag_name) return;

  const latest = release.tag_name.replace(/^v/, '');
  if (!isNewer(latest, current)) return;
  if (context.globalState.get('lastNotifiedVersion') === latest) return;

  const open = 'Open Releases';
  const mute = "Don't show again";
  const url = release.html_url || `https://github.com/${owner}/${repo}/releases`;
  const choice = await vscode.window.showInformationMessage(
    `Cisco IOS IntelliSense ${latest} is available (you have ${current}).`,
    open,
    mute,
  );

  await context.globalState.update('lastNotifiedVersion', latest);
  if (choice === open) {
    vscode.env.openExternal(vscode.Uri.parse(url));
  } else if (choice === mute) {
    await config.update('checkForUpdates', false, vscode.ConfigurationTarget.Global);
  }
}

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      {
        headers: {
          'User-Agent': 'cisco-ios-lsp',
          Accept: 'application/vnd.github+json',
        },
        timeout: 5000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume(); // drain
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

module.exports = { activate, deactivate };
