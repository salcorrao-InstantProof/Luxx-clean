import fs from 'node:fs';
import path from 'node:path';

const copies = [
  ['video.mjs', 'netlify/lib/video.mjs'],
  ['domain.mjs', 'netlify/lib/domain.mjs'],
  ['index.html', 'public/index.html'],
  ['LUXX001_HOLD_SHEET_28DAY.json', 'config/LUXX001_HOLD_SHEET_28DAY.json'],
  ['LUXX001_HOLD_SHEET_28DAY.json', 'public/config/LUXX001_HOLD_SHEET_28DAY.json']
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) throw new Error(`INVOKE source missing at repo root: ${from}`);
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.copyFileSync(from, to);
  const st = fs.statSync(to);
  if (st.size < 1000) throw new Error(`Copied ${to} is too small (${st.size} bytes) — refused to deploy a pointer`);
  console.log(`materialized ${to} (${st.size} bytes)`);
}

const indexPath = 'public/index.html';
let html = fs.readFileSync(indexPath, 'utf8');
const before = html;
html = html.replace(
  "if(a.status==='PROCESSING_FAILED')return true;",
  "if(a.status==='PROCESSING_FAILED')return false;"
);
if (html === before) throw new Error('Could not patch isBrokenUpload — hide rule not found');
fs.writeFileSync(indexPath, html);
console.log('patched isBrokenUpload: failed videos stay visible');
