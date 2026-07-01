'use strict';

const vscode = require('vscode');
const { symbolsInfo } = require('./symbolsInfo');

// Ported from Y-Ysss/vscode-cisco-config-highlight (src/registerOutlineSymbol.ts), MIT
// licensed. Settings moved to the cisco-ios-lsp.outline.* namespace since this is a different
// extension. See THIRD_PARTY_NOTICES.md.

function registerOutlineSymbolProvider(context) {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'cisco' },
      new CiscoConfigDocumentSymbolProvider(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cisco-ios-lsp.outline')) {
        invalidatePatternCache();
      }
    }),
  );
}

const regExpJoin = (delimiter, list) => {
  return new RegExp(list.map((item) => item.source).join(delimiter));
};

const regexPattern = (name) => {
  const d = symbolsInfo[name];
  return new RegExp(
    `(?<index_${name}>${d.pattern.source})(?<submatch_${name}>${d.item_pattern.source})`,
  );
};

const buildSettingsPattern = () => {
  const symbols = vscode.workspace.getConfiguration('cisco-ios-lsp').get('outline.symbolsList', {});
  const patterns = Object.entries(symbols)
    .filter(([, enabled]) => enabled)
    .map(([name]) => regexPattern(name));
  return patterns.length ? regExpJoin('|', patterns) : null;
};

// Pattern cache: undefined = not yet built, null = built but no symbols enabled
let patternCache;

const invalidatePatternCache = () => {
  patternCache = undefined;
};

const getCachedPattern = () => {
  if (patternCache === undefined) {
    patternCache = buildSettingsPattern();
  }
  return patternCache;
};

class CiscoConfigDocumentSymbolProvider {
  provideDocumentSymbols(document) {
    const enabledOutlinePanel = vscode.workspace
      .getConfiguration('cisco-ios-lsp')
      .get('outline.showSymbolsInOutlinePanel', false);
    if (!enabledOutlinePanel) {
      return [];
    }
    const pattern = getCachedPattern();
    if (!pattern) {
      return [];
    }
    const symbols = [];
    const INDEX_PREFIX_LEN = 'index_'.length;
    let category_name = '';
    let parent_name = '';
    let base_node = symbols;
    let parent_node = symbols;
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const m = line.text.match(pattern);
      if (!m?.groups) {
        continue;
      }
      const data = Object.entries(m.groups).filter(([, v]) => v !== undefined);
      if (data[1][1] === '') {
        continue;
      }
      const label = data[1][1].trim();
      const info = symbolsInfo[data[0][0].slice(INDEX_PREFIX_LEN)];
      const position = line.range;
      if (info.category_name === 'command') {
        symbols.push(
          new vscode.DocumentSymbol(
            label,
            info.detail,
            vscode.SymbolKind.Event,
            position,
            position,
          ),
        );
        parent_node = symbols[symbols.length - 1].children;
        base_node = symbols[symbols.length - 1].children;
        category_name = info.category_name;
        continue;
      }

      if (category_name !== info.category_name) {
        base_node.push(
          new vscode.DocumentSymbol(
            info.category_name,
            '',
            info.parent_kind ?? vscode.SymbolKind.Namespace,
            position,
            position,
          ),
        );
        parent_node = base_node[base_node.length - 1].children;
        category_name = info.category_name;
      }

      if (info.parent_name) {
        const matched = label.match(info.parent_name);
        if (matched) {
          parent_name = matched[0];
        }
      }

      const node = parent_node[parent_node.length - 1];
      if (parent_node.length > 0 && parent_name === label && node.detail !== info.detail) {
        node.children.push(
          new vscode.DocumentSymbol(label, info.detail, info.kind, position, position),
        );
      } else {
        parent_node.push(
          new vscode.DocumentSymbol(label, info.detail, info.kind, position, position),
        );
      }
    }
    return symbols;
  }
}

module.exports = { registerOutlineSymbolProvider, CiscoConfigDocumentSymbolProvider };
