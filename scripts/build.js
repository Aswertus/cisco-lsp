'use strict';

// Production build: bundles the client and server into dist/ with esbuild and
// merges every server/data/<pack>/*.json into one dist/data/commands.json.
//
// Why: the .vsix ships only dist/** — bundling removes the unbundled
// node_modules require() cascade from activation (faster startup, smaller
// package), and the merged data file turns the server's startup directory
// walk (17+ open/parse calls) into a single one. server.js still knows how to
// read the per-pack layout, but package.json's `main` points at dist/, so run
// `npm run build` (or `npm run watch`) after editing client/ or server/ and
// reload the VS Code window to test changes.
//
// Usage: node scripts/build.js [--watch]

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const watch = process.argv.includes('--watch');

function mergeData() {
  const dataDir = path.join(ROOT, 'server', 'data');
  const records = [];
  const packs = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const pack of packs) {
    for (const file of fs.readdirSync(path.join(dataDir, pack)).sort()) {
      if (!file.endsWith('.json')) continue;
      records.push(...JSON.parse(fs.readFileSync(path.join(dataDir, pack, file), 'utf8')));
    }
  }
  fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'data', 'commands.json'), JSON.stringify(records));
  return records.length;
}

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // VS Code 1.75 (our engines floor) ships Node 16.
  target: 'node16',
  minify: true,
  logLevel: 'info',
};

const clientOptions = {
  ...common,
  entryPoints: [path.join(ROOT, 'client', 'extension.js')],
  outfile: path.join(DIST, 'client.js'),
  external: ['vscode'], // provided by the VS Code runtime, never bundled
};

const serverOptions = {
  ...common,
  entryPoints: [path.join(ROOT, 'server', 'server.js')],
  outfile: path.join(DIST, 'server.js'),
};

async function main() {
  const count = mergeData();
  console.log(`Merged ${count} command records into dist/data/commands.json`);

  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(clientOptions),
      esbuild.context(serverOptions),
    ]);
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('Watching client/ and server/ for changes (Ctrl+C to stop)...');
  } else {
    await Promise.all([esbuild.build(clientOptions), esbuild.build(serverOptions)]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
