import fs from 'node:fs';
import path from 'node:path';

const ladderUpload = 'video LADDER 33488.js';
if (fs.existsSync(ladderUpload) && fs.statSync(ladderUpload).size >= 20000) {
  fs.copyFileSync(ladderUpload, 'video.mjs');
  console.log('promoted', ladderUpload, 'to video.mjs (', fs.statSync('video.mjs').size, 'bytes)');
}

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

if (fs.existsSync('LUXX_CTA_PACK.md')) {
  fs.mkdirSync('public/config', {recursive: true});
  fs.copyFileSync('LUXX_CTA_PACK.md', 'public/config/LUXX_CTA_PACK.md');
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
html = html.replace(/<button class="secondary" onclick="openVideoReview\('\$\{a\.asset_id\}'\)">REVIEW EXISTING<\/button>/g, '');
const capFn = `function sheetCaption(t){\n  if(t.caption)return t.caption;\n  const n=String(t.name||'');\n  if(/MV-1/i.test(n))return 'this is MV-1. if you only open one file of mine, make it this.';\n  if(t.site==='X')return 'face stays off. the rest of me does not.';\n  if(t.site==='OF_FREE')return /cam/i.test(n)?'just off cam. this page gets the short version. paid got what happened after.':'short version lives here. the uncut one does not.';\n  if(t.site==='OF_PAID')return /cam/i.test(n)?'just logged off. still warm and it is someone\\'s fault.':'this one is staying on paid. not cropping it.';\n  if(t.site==='DMS')return /tip/i.test(n)?'{name}, thank you for {tip} tonight. if that was fun, the paid page is where the rest lives.':'hey — new scene going out tonight. $10, no pressure either way.';\n  if(t.site==='PORNHUB')return 'no face. short cut of the longer file.';\n  if(t.site==='MANYVIDS')return 'title says the scene, preview on, tags filled.';\n  if(t.site==='CHATURBATE')return 'back after a break — be gentle or don\\'t';\n  return '';\n}\nfunction sheetHow(t){\n  if(t.site==='DMS')return 'Same $10 offer. Broadcast, not just-for-you. Attach from the app. NO tracking link in the message.';\n  if(t.site==='OF_FREE')return 'Post the privacy-safe file. NO link in the caption.';\n  if(t.site==='OF_PAID')return 'Post the privacy-safe file on paid. Copy the caption. NO tracking link.';\n  if(t.site==='X')return 'Post the file on the card. One line. Do NOT paste a link. Website field already has https://onlyfans.com/luxx4free/c6 . If you see her face in the frame, skip and pick another.';\n  if(t.site==='PORNHUB')return 'Paste this as the LAST LINE of the video description, nothing else on that line: https://onlyfans.com/luxx4free/c10 . Do not put that link in Official Website. Official Website stays https://onlyfans.com/luxx4free/c7 .';\n  if(t.site==='MANYVIDS')return 'Native listing. NO OnlyFans tracking link on ManyVids.';\n  if(t.site==='CHATURBATE')return 'Room title from the card. Tip prices are hers. NO OnlyFans link required in the title.';\n  return '';\n}\n`;
html = html.replace('function renderTodaySheet', capFn+'function renderTodaySheet');
const noteNeedle = "${t.note?`<div class=\"jobNote\">${esc(t.note)}</div>`:''}";
const notePlus = noteNeedle
  + "${sheetHow(t)?`<div class=\"jobNote\"><b>Do this</b><div>${esc(sheetHow(t))}</div></div>`:''}"
  + "${sheetCaption(t)?`<div class=\"jobNote\"><b>Caption / message</b><div>${esc(sheetCaption(t))}</div><button class=\"secondary\" onclick=\"copyCaption(sheetCaption(t))\">COPY</button></div>`:''}";
html = html.replace(noteNeedle, notePlus);
fs.writeFileSync(indexPath, html);

const domainPath = 'netlify/lib/domain.mjs';
let domain = fs.readFileSync(domainPath, 'utf8');
const needle = "if(usedOnSite(a,site))return false;\n    return true;";
const insert = "if(usedOnSite(a,site,state))return false;\n    if(platform&&a.platform_eligibility_source==='MANUAL'&&!(a.platform_eligibility||[]).includes(platform)&&site!=='X'&&site!=='PORNHUB')return false;\n    return true;";
if (domain.includes(needle)) domain = domain.replace(needle, insert);
domain = domain.replace(
  'function usedOnSite(asset,site){\n  const platform=SITE_TO_PLATFORM[site];\n  if(!platform)return false;\n  return (asset.used_on||[]).includes(platform);\n}',
  'function usedOnSite(asset,site,state){\n  const platform=SITE_TO_PLATFORM[site];\n  if(!platform)return false;\n  if((asset.used_on||[]).includes(platform))return true;\n  const id=asset.asset_id;\n  return (state&&state.tasks||[]).some(t=>t&&t.asset_id===id&&t.site===site);\n}'
);
domain = domain.replace(
  'export function bindFileForTask(state,task,assets=[]){\n  const pool=bindableAssets(state,task.site,assets);\n  if(!pool.length)return null;',
  "export function bindFileForTask(state,task,assets=[]){\n  let pool=bindableAssets(state,task.site,assets);\n  if(!pool.length&&(task.site==='X'||task.site==='PORNHUB')){\n    pool=(assets||[]).filter(a=>a&&a.authorization_status==='AUTHORIZED'&&a.availability!=='QUARANTINED'&&a.availability!=='UNAVAILABLE'&&(a.variants||[]).some(v=>v&&(v.privacy_safe_export===true||v.metadata_stripped===true))&&!usedOnSite(a,task.site,state));\n  }\n  if(!pool.length)return null;"
);
domain = domain.replace(
  'if(bound)taken.add(bound.asset_id);',
  'if(bound){taken.add(bound.asset_id);if(t.needs_file&&!t.asset_id)t.asset_id=bound.asset_id;}'
);
domain = domain.replace(
  "appendAudit(state,'TASK',t.task_id,'TASK_COMPLETE',{done:t.done,money,count});",
  "if(t.done&&t.asset_id){state.actions=state.actions||[];state.actions.push({action_id:uid('ACT'),asset_id:t.asset_id,status:'EXECUTED',executed_at:new Date().toISOString(),source:'HOLD_SHEET',site:t.site,task_id:t.task_id});}\n  appendAudit(state,'TASK',t.task_id,'TASK_COMPLETE',{done:t.done,money,count,asset_id:t.asset_id||null});"
);
fs.writeFileSync(domainPath, domain);
