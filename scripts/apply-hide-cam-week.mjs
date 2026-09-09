import fs from 'node:fs';

const hideFn = `function isCanceledCamTask(t){\n  const d=String(t&&t.date||'');\n  if(d!=='2026-09-09'&&d!=='2026-09-11')return false;\n  if(t.site==='CHATURBATE')return true;\n  return /chaturbate|tip menu|off cam|who tipped/i.test(String(t.name||''));\n}\n`;

const indexPath = 'public/index.html';
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes('function isCanceledCamTask')) {
    html = html.replace('function renderTodaySheet', hideFn + 'function renderTodaySheet');
  }
  html = html.replace(
    'const jobs=assigned.map(t=>({...t,...(byId.get(t.task_id)||{})}));',
    'const jobs=assigned.map(t=>({...t,...(byId.get(t.task_id)||{})})).filter(t=>!isCanceledCamTask(t));'
  );
  html = html.replace(
    "+(todayPlan.cam_day?' · CAM DAY':'')",
    "+((todayPlan.cam_day&&!['2026-09-09','2026-09-11'].includes(new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})))?' · CAM DAY':'')"
  );
  fs.writeFileSync(indexPath, html);
  console.log('hid this-week cam cards in TODAY');
}

const domainPath = 'netlify/lib/domain.mjs';
if (fs.existsSync(domainPath)) {
  let domain = fs.readFileSync(domainPath, 'utf8');
  const needle = '    if(existing.length)continue;';
  const insert = "    if(existing.length){\n      if(date==='2026-09-09'||date==='2026-09-11'){\n        state.tasks=(state.tasks||[]).filter(t=>!(t.date===date&&t.source==='HOLD_SHEET'));\n        for(const step of steps)made.push(createTask(state,{...step,date,source:'HOLD_SHEET'}));\n      }\n      continue;\n    }";
  if (domain.includes(needle) && !domain.includes("date==='2026-09-09'||date==='2026-09-11'")) {
    domain = domain.replace(needle, insert);
    fs.writeFileSync(domainPath, domain);
    console.log('hold-sheet import can replace this-week cam days');
  }
}
