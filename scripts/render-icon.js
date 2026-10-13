'use strict';

// Renders images/icon.svg → images/icon.png (256x256).
//
// Why a script (and not a normal dependency):
//   The renderer @resvg/resvg-js bundles a ~4 MB native binary. If it were a
//   project dependency it would be packaged into the .vsix (vsce ships prod
//   node_modules). So it is installed only when regenerating the icon, then
//   removed again:
//
//     npm install --no-save @resvg/resvg-js
//     npm run render-icon          # = node scripts/render-icon.js
//     rm -rf node_modules/@resvg   # keep it out of the next .vsix
//
// The icon needs a monospace font for the terminal text. resvg loads system
// fonts; Liberation Mono / DejaVu Sans Mono / Noto Sans Mono all work. The SVG
// lists several mono families as fallbacks.

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'images', 'icon.svg');
const pngPath = path.join(root, 'images', 'icon.png');

const svg = fs.readFileSync(svgPath);
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 256 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Liberation Mono' },
});

fs.writeFileSync(pngPath, resvg.render().asPng());
console.log('Wrote', path.relative(root, pngPath), '—', fs.statSync(pngPath).size, 'bytes');
