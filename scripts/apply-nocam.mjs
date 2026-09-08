import fs from 'node:fs';
if (!fs.existsSync('HOLD_WEEK1_NOCAM.json')) process.exit(0);
const patch = JSON.parse(fs.readFileSync('HOLD_WEEK1_NOCAM.json', 'utf8'));
for (const dest of ['config/LUXX001_HOLD_SHEET_28DAY.json', 'public/config/LUXX001_HOLD_SHEET_28DAY.json']) {
  if (!fs.existsSync(dest)) continue;
  const sheet = JSON.parse(fs.readFileSync(dest, 'utf8'));
  if (patch.rule0 && Array.isArray(sheet.locked_rules)) sheet.locked_rules[0] = patch.rule0;
  for (const day of sheet.days || []) {
    if (patch.days && patch.days[day.date]) day.steps = patch.days[day.date];
  }
  fs.writeFileSync(dest, JSON.stringify(sheet, null, 2));
  console.log('applied HOLD_WEEK1_NOCAM to', dest);
}
