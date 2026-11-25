// Post-process the single-file build: inline the icon, drop the manifest link (not usable from file://).
import fs from 'node:fs';
const f = 'dist-single/index.html';
const svg = fs.readFileSync('public/icon.svg', 'utf8');
let html = fs.readFileSync(f, 'utf8');
html = html
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(svg)}">`)
  .replace(/<link rel="manifest"[^>]*>\s*/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '');
fs.writeFileSync('dist-single/Writing Studio.html', html);
console.log('wrote dist-single/Writing Studio.html');
