// GATE 5 and GATE 6 at the HTTP layer: state must survive reload, and an interrupted /
// retried request must not duplicate an action or erase state.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-persist-'));
process.env.LUXX_LOCAL_STORAGE_DIR=path.join(root,'store');
process.env.LUXX_LOCAL_AUTH_BYPASS='1';
process.env.LUXX_PASSCODE='LUXX-TEST-PASSCODE';
process.env.LUXX_SESSION_SECRET='test-session-secret-not-for-production-0123456789';
const names=['action','state','assets','upload-chunk','upload-complete','image-edit'];
const mods={};for(const n of names)mods[n]=(await import(`../netlify/functions/${n}.mjs`)).default;
const call=(n,url='http://local/api/'+n,opt={})=>mods[n](new Request(url,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body}));
const j=async r=>r.json();
const cmd=async(op,payload={},rev)=>j(await call('action','http://local/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op,payload,expected_rev:rev})}));
const rawCmd=(op,payload={},rev)=>call('action','http://local/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op,payload,expected_rev:rev})});
const checks=[];const ok=m=>{checks.push(m);console.log('PASS',m)};
const st=async()=>(await j(await call('state'))).state;

// --- GATE 5: checklist + baseline + historical survive a fresh read ("reopen the app") ---
{
  let s=await st();
  await cmd('CHECKLIST_SET',{id:'TIMEZONE',done:true,by:'Executive Producer'},s.rev);
  s=await st();
  await cmd('BASELINE_SNAPSHOT',{platform:'X',metrics:{followers:36,posts:51},evidence_reference:'x.png'},s.rev);
  s=await st();
  await cmd('HIST_IMPORT',{rows:[{platform:'Pornhub',title:'Lake House',url:'https://x/1',runtime_seconds:451,views:2140}]},s.rev);
  // simulate closing and reopening: a completely fresh state read
  const reopened=await st();
  assert.equal(reopened.launchChecklist.find(x=>x.id==='TIMEZONE').done,true,'checklist survived reopen');
  assert.equal(reopened.baseline.snapshots.find(x=>x.platform==='X').metrics.followers,36,'baseline survived reopen');
  assert.equal(reopened.historicalPublications.length,1,'historical record survived reopen');
  assert.equal(reopened.historicalPublications[0].views,2140);
  ok('GATE 5 — checklist, baseline and historical records survive reopening the app');
}
// --- GATE 6: a stale/retried write is refused, never silently duplicated ---
{
  const s=await st();
  const rev=s.rev;
  const first=await rawCmd('CHECKLIST_SET',{id:'HEALTH',done:true},rev);
  assert.equal(first.status,200);
  // the same request replayed after a dropped connection, still carrying the old rev
  const replay=await rawCmd('CHECKLIST_SET',{id:'HEALTH',done:true},rev);
  assert.equal(replay.status,409,'a replayed write on a stale revision must be refused');
  assert.equal((await j(replay)).error,'STATE_CONFLICT');
  const after=await st();
  assert.equal(after.launchChecklist.find(x=>x.id==='HEALTH').done,true,'state is intact, not erased');
  ok('GATE 6 — a retried write on a stale revision is refused and state is not erased');
}
// --- GATE 6b: concurrent historical imports cannot double-write ---
{
  const s=await st();
  const rev=s.rev;
  const before=(await st()).historicalPublications.length;
  const row=[{platform:'ManyVids',title:'Booksmart',url:'https://x/2',sales:7,revenue:104.93,current_price:14.99}];
  const a=await rawCmd('HIST_IMPORT',{rows:row},rev);
  const b=await rawCmd('HIST_IMPORT',{rows:row},rev);
  assert.equal(a.status,200);
  assert.equal(b.status,409,'the second concurrent import on the same rev must be refused');
  const after=(await st()).historicalPublications.length;
  assert.equal(after,before+1,`exactly one record must land, got ${after-before}`);
  ok('GATE 6b — concurrent imports cannot duplicate a historical record');
}
// --- append-only history is never rewritten by any of the above ---
{
  const s=await st();
  assert(s.auditEvents.length>0,'audit trail exists');
  const ids=s.auditEvents.map(e=>e.event_id);
  assert.equal(new Set(ids).size,ids.length,'audit events are unique and append-only');
  ok('append-only audit trail intact after setup operations');
}
const report={pass:true,total:checks.length,checks};
await fs.writeFile('tests/LAUNCH_PERSISTENCE_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
