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
html = html.replace(
  "if(a.status==='PROCESSING_FAILED')return true;",
  "if(a.status==='PROCESSING_FAILED')return false;"
);
html = html.replace(
  "function historyProtectedHtml(a){",
  "async function deletePicture(id){if(!confirm('Are you sure you want to delete this? It leaves the library. This cannot be undone.'))return;try{await api('/asset-delete',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:id,confirm_erase:true})});closeModal();await load();render()}catch(e){alert(e.message)}}\nfunction historyProtectedHtml(a){if(a.media_type==='IMAGE')return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;"
);
const capFn = `function sheetCaption(t){\n  const price=t.price||'$10';\n  if(t.site==='OF_FREE')return 'This is the free-page view. Turn around and it is on paid.';\n  if(t.site==='OF_PAID')return 'Caught me with these pulled to the side. '+price+' if you want to keep looking.';\n  if(t.site==='X')return 'New drop. Link in bio.';\n  if(t.site==='DMS')return 'I put something on the paid page I did not leave on free. '+price+'.';\n  if(t.site==='PORNHUB')return 'Full version and more on my OnlyFans. Official Website link below.';\n  if(t.site==='MANYVIDS')return 'Full scene on ManyVids. Preview on.';\n  if(t.site==='CHATURBATE')return 'Tip menu is up. Two paid shows if the room is spending.';\n  return '';\n}\nfunction sheetHow(t){\n  if(t.site==='DMS')return 'TEXT ONLY. Do not attach a file from LUXX. Paste the caption as the message. Same line every send. Count how many you sent.';\n  if(t.site==='OF_FREE')return 'Post the privacy-safe photo. No link in the caption.';\n  if(t.site==='OF_PAID')return 'Post the privacy-safe photo. Set PPV to the price on this card if it is locked.';\n  return '';\n}\n`;
html = html.replace('function renderTodaySheet', capFn+'function renderTodaySheet');
const noteOld = "${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}";
const noteNew = "${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}${sheetHow(t)?`<div class=\"jobNote\"><b>Do this</b><div>${esc(sheetHow(t))}</div></div>`:''}${sheetCaption(t)?`<div class=\"jobNote\"><b>Caption / message</b><div>${esc(sheetCaption(t))}</div><button type=\"button\" class=\"secondary\" onclick=\"copyCaption(sheetCaption(window.__lastTask))\">COPY</button></div>`:''}";
html = html.replace(
  "${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}",
  "${(()=>{window.__lastTask=t;return '';})()}${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}${sheetHow(t)?`<div class=\"jobNote\"><b>Do this</b><div>${esc(sheetHow(t))}</div></div>`:''}${sheetCaption(t)?`<div class=\"jobNote\"><b>Caption / message</b><div>${esc(sheetCaption(t))}</div><button class=\"secondary\" onclick=\"copyCaption(sheetCaption({site:'"+t.site+"',price:'"+String(t.price||'').replace(/'/g,'')+"'}))\">COPY</button></div>`:''}"
);
fs.writeFileSync(indexPath, html);

const videoPath = 'netlify/lib/video.mjs';
let video = fs.readFileSync(videoPath, 'utf8');
video = video.split("-map','0:a?").join("-map','0:a:0");
video = video.split('-map 0:a?').join('-map 0:a:0');
fs.writeFileSync(videoPath, video);

const domainPath = 'netlify/lib/domain.mjs';
let domain = fs.readFileSync(domainPath, 'utf8');
const needle = "if(usedOnSite(a,site))return false;\n    return true;";
const insert = "if(usedOnSite(a,site))return false;\n    if(platform&&a.platform_eligibility_source==='MANUAL'&&!(a.platform_eligibility||[]).includes(platform))return false;\n    return true;";
if (domain.includes(needle)) domain = domain.replace(needle, insert);
fs.writeFileSync(domainPath, domain);
