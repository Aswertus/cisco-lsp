'use strict';

const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const path = require('path');

let client;

function activate(context) {
  const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));

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
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };
