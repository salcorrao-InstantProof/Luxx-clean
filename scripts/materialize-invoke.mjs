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

const hideBefore = html;
html = html.replace(
  "if(a.status==='PROCESSING_FAILED')return true;",
  "if(a.status==='PROCESSING_FAILED')return false;"
);
if (html === hideBefore) throw new Error('Could not patch isBrokenUpload — hide rule not found');

const histOld = "function historyProtectedHtml(a){\n  const refs=historyReferences(a);\n  if(!refs.length)return `<button class=\"danger\" onclick=\"deleteUnusedAsset('${a.asset_id}')\">DELETE DUPLICATE</button>`;";
const histNew = "async function deletePicture(id){\n  if(!confirm('Are you sure you want to delete this? It leaves the library. This cannot be undone.'))return;\n  try{await api('/asset-delete',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:id,confirm_erase:true})});closeModal();await load();render()}catch(e){alert(e.message)}}\nfunction historyProtectedHtml(a){\n  if(a.media_type==='IMAGE')return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;\n  const refs=historyReferences(a);\n  if(!refs.length)return `<button class=\"danger\" onclick=\"deleteUnusedAsset('${a.asset_id}')\">DELETE DUPLICATE</button>`;";
if (!html.includes("function historyProtectedHtml(a)")) throw new Error('historyProtectedHtml missing');
html = html.replace(
  "function historyProtectedHtml(a){",
  "async function deletePicture(id){if(!confirm('Are you sure you want to delete this? It leaves the library. This cannot be undone.'))return;try{await api('/asset-delete',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:id,confirm_erase:true})});closeModal();await load();render()}catch(e){alert(e.message)}}\nfunction historyProtectedHtml(a){if(a.media_type==='IMAGE')return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;"
);
fs.writeFileSync(indexPath, html);
console.log('patched index.html: photos get confirmed DELETE');

const videoPath = 'netlify/lib/video.mjs';
let video = fs.readFileSync(videoPath, 'utf8');
const beforeVideo = video;
video = video.split("-map','0:a?").join("-map','0:a:0");
video = video.split('-map 0:a?').join('-map 0:a:0');
if (video === beforeVideo) throw new Error('Could not patch APAC audio map in video.mjs');
fs.writeFileSync(videoPath, video);
console.log('patched video.mjs: map first audio only (drop APAC)');
