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
  const src = fs.statSync(from);
  if (from === 'video.mjs' && src.size < 20000) {
    throw new Error(`video.mjs is ${src.size} bytes — truncated. Need the 33488-byte ladder. Refusing to deploy.`);
  }
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.copyFileSync(from, to);
  const st = fs.statSync(to);
  if (st.size < 1000) throw new Error(`Copied ${to} is too small (${st.size} bytes) — refused to deploy a pointer`);
  console.log(`materialized ${to} (${st.size} bytes)`);
}

const placeSrc = fs.existsSync('LUXX001_ROUTE_PLACEMENTS_FINAL.json')
  ? 'LUXX001_ROUTE_PLACEMENTS_FINAL.json'
  : 'config/LUXX001_ROUTE_PLACEMENTS_FINAL.json';
if (!fs.existsSync(placeSrc)) throw new Error('Missing LUXX001_ROUTE_PLACEMENTS_FINAL.json');
fs.mkdirSync('public/config', {recursive: true});
fs.copyFileSync(placeSrc, 'public/config/LUXX001_ROUTE_PLACEMENTS_FINAL.json');

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
html = html.replace(
  '<button class="secondary" onclick="loadHoldSheet()">Load 28-day plan</button>',
  '<button class="secondary" onclick="loadHoldSheet()">Load 28-day plan</button><button class="secondary" onclick="installRoutePlacements(true)">Install tracking routes</button>'
);
html = html.replace(
  'async function loadHoldSheet(){',
  `async function installRoutePlacements(ask){\n  if(ask && !confirm('Write the Sep 5 tracking URLs onto the matching routes in LUXX? Already-recorded work is not erased.'))return;\n  try{\n    const doc=await (await fetch('/config/LUXX001_ROUTE_PLACEMENTS_FINAL.json',{cache:'no-store'})).json();\n  const r=await api('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'ROUTE_CONFIG_IMPORT',payload:doc})});\n    const res=r&&r.result;\n    await load();render();\n    if(ask)alert('Tracking routes installed. Applied '+(res&&res.applied?res.applied.length:0)+', skipped '+(res&&res.skipped?res.skipped.length:0)+'.');\n  }catch(e){if(ask)alert(e.message);}\n}\nasync function ensureRoutePlacements(){\n  const has=(state.routes||[]).some(r=>String(r.tracking_url_or_identifier||'').includes('luxx4free/c6'));\n  if(!has) await installRoutePlacements(false);\n}\nasync function loadHoldSheet(){`
);
html = html.replace(
  'setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{})},0)}',
  'setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{});ensureRoutePlacements().catch(()=>{})},0)}'
);
const capFn = `function sheetCaption(t){\n  const price=t.price||'$10';\n  if(t.site==='OF_FREE')return 'This is the free-page view. Turn around and it is on paid.';\n  if(t.site==='OF_PAID')return 'Caught me with these pulled to the side. '+price+' if you want to keep looking.';\n  if(t.site==='X')return 'New drop. Link in bio.';\n  if(t.site==='DMS')return 'I put something on the paid page I did not leave on free. '+price+'.';\n  if(t.site==='PORNHUB')return 'Full version and more on my OnlyFans. Official Website link below.';\n  if(t.site==='MANYVIDS')return 'Full scene on ManyVids. Preview on.';\n  if(t.site==='CHATURBATE')return 'Tip menu is up. Two paid shows if the room is spending.';\n  return '';\n}\nfunction sheetHow(t){\n  if(t.site==='DMS')return 'Lock a $10 PPV in OnlyFans. Attach the Paid photo yourself. LUXX does not attach a file on this card.';\n  if(t.site==='OF_FREE')return 'Post the privacy-safe photo. No link in the caption.';\n  if(t.site==='OF_PAID')return 'Post the privacy-safe photo. Set PPV to the price on this card if it is locked.';\n  return '';\n}\n`;
html = html.replace('function renderTodaySheet', capFn+'function renderTodaySheet');
html = html.replace(
  "${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}",
  "${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}${sheetHow(t)?`<div class=\"jobNote\"><b>Do this</b><div>${esc(sheetHow(t))}</div></div>`:''}${sheetCaption(t)?`<div class=\"jobNote\"><b>Caption / message</b><div>${esc(sheetCaption(t))}</div><button class=\"secondary\" onclick=\"copyCaption(sheetCaption({site:'"+t.site+"',price:'"+String(t.price||'').replace(/'/g,'')+"'}))\">COPY</button></div>`:''}"
);
fs.writeFileSync(indexPath, html);

const domainPath = 'netlify/lib/domain.mjs';
let domain = fs.readFileSync(domainPath, 'utf8');
const needle = "if(usedOnSite(a,site))return false;\n    return true;";
const insert = "if(usedOnSite(a,site))return false;\n    if(platform&&a.platform_eligibility_source==='MANUAL'&&!(a.platform_eligibility||[]).includes(platform))return false;\n    return true;";
if (domain.includes(needle)) domain = domain.replace(needle, insert);
fs.writeFileSync(domainPath, domain);
