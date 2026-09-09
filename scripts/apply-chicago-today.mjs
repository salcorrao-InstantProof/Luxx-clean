import fs from 'node:fs';
const chicago = "new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})";
const utc = "new Date().toISOString().slice(0,10)";
for (const p of ['public/index.html', 'netlify/lib/domain.mjs']) {
  if (!fs.existsSync(p)) continue;
  let t = fs.readFileSync(p, 'utf8');
  if (!t.includes(utc)) {
    console.log(p, 'no UTC today stamp');
    continue;
  }
  t = t.split(utc).join(chicago);
  fs.writeFileSync(p, t);
  console.log(p, 'TODAY stamps set to America/Chicago');
}
