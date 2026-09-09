import fs from 'node:fs';
const p = 'public/index.html';
if (!fs.existsSync(p)) process.exit(0);
let t = fs.readFileSync(p, 'utf8');
const imgOnly = "function historyProtectedHtml(a){if(a.media_type==='IMAGE')return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;";
const allMedia = "function historyProtectedHtml(a){return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;";
if (t.includes(imgOnly)) t = t.replace(imgOnly, allMedia);
const imgOnly2 = "function historyProtectedHtml(a){if(a.media_type==='IMAGE')return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;";
if (t.includes("if(a.media_type==='IMAGE')return")) {
  t = t.replace("if(a.media_type==='IMAGE')return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;", "return `<button class=\"danger\" onclick=\"deletePicture('${a.asset_id}')\">DELETE</button>`;");
}
const boot = "setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{});ensureRoutePlacements().catch(()=>{})},0)}";
const boot2 = "setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{});ensureRoutePlacements().catch(()=>{});if(!(state.settings&&state.settings.creatorTimezone)){api('/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({creatorTimezone:'America/Chicago'})}).catch(()=>{})}},0)}";
if (t.includes(boot)) t = t.replace(boot, boot2);
else if (t.includes("setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{})},0)}")) {
  t = t.replace("setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{})},0)}", "setTimeout(()=>{refreshToday();syncLibraryConsent().catch(()=>{});if(!(state.settings&&state.settings.creatorTimezone)){api('/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({creatorTimezone:'America/Chicago'})).catch(()=>{})}},0)}");
}
fs.writeFileSync(p, t);
console.log('library ops patched');
