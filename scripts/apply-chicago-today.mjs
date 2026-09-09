import fs from 'node:fs';
const p = 'public/index.html';
if (!fs.existsSync(p)) process.exit(0);
let t = fs.readFileSync(p, 'utf8');
const old = "const today=new Date().toISOString().slice(0,10);";
const neu = "const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});";
if (t.includes(old)) {
  t = t.replace(old, neu);
  fs.writeFileSync(p, t);
  console.log('TODAY date set to America/Chicago');
} else {
  console.log('TODAY date line not found or already patched');
}
