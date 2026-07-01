'use strict';

const vscode = require('vscode');
const https = require('https');
const path = require('path');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { registerOutlineSymbolProvider } = require('./registerOutlineSymbol');
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
  registerOutlineSymbolProvider(context);

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.languageId !== 'cisco') return;
      const config = vscode.workspace.getConfiguration('cisco-ios-lsp');
      if (!config.get('format.onSave', true)) return;
      event.waitUntil(
        vscode.commands
          .executeCommand('vscode.executeFormatDocumentProvider', event.document.uri, {})
          .then((edits) => edits || []),
      );
    }),
  );

  // Fire-and-forget: never let an update check disrupt activation.
  checkForUpdates(context).catch(() => {});
}

function deactivate() {
  return client?.stop();
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
