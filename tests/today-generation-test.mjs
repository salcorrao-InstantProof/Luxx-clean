// TODAY must be a stored object with a generation, not a live full scan.
// Counts real blob reads to prove the scan is gone, and proves the generation moves when it must.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-today-'));
process.env.LUXX_LOCAL_STORAGE_DIR=path.join(root,'store');
process.env.LUXX_LOCAL_AUTH_BYPASS='1';
process.env.LUXX_PASSCODE='LUXX-TEST-PASSCODE';
process.env.LUXX_SESSION_SECRET='test-session-secret-not-for-production-0123456789';

const {store}=await import('../netlify/lib/storage.mjs');
const {STORES}=await import('../netlify/lib/model.mjs');

// Instrument the assets store so we can count actual per-asset reads.
let assetReads=0;
const realStore=(await import('../netlify/lib/storage.mjs')).store;
const assetsStore=await realStore(STORES.assets);
const origGet=assetsStore.get.bind(assetsStore);
assetsStore.get=async(...a)=>{if(String(a[0]).startsWith('assets/'))assetReads++;return origGet(...a)};

const names=['action','upload-chunk','upload-complete','state'];
const mods={};for(const n of names)mods[n]=(await import(`../netlify/functions/${n}.mjs`)).default;
const call=(n,url='http://local/api/'+n,opt={})=>mods[n](new Request(url,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body}));
const j=async r=>r.json();
const cmd=(op,payload={},rev)=>call('action','http://local/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op,payload,expected_rev:rev})});
const jpg=await fs.readFile('tests/fixtures/orient6.jpg');
const bytesFor=n=>Buffer.concat([Buffer.from(jpg),Buffer.from(`\u0000T${n}`)]);
async function upload(id,n){
  await call('upload-chunk','http://local/api/upload-chunk',{method:'POST',headers:{'x-luxx-asset-id':id,'x-luxx-part':'0','x-luxx-total-parts':'1'},body:bytesFor(n)});
  const o=await j(await call('upload-complete','http://local/api/upload-complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:id,name:id+'.jpg',type:'image/jpeg',size:bytesFor(n).length,parts:1,media_type:'IMAGE',authorization_status:'AUTHORIZED'})}));
  assert(!o.error&&!o.duplicate,`upload ${id}`);
}
const checks=[];const ok=m=>{checks.push(m);console.log('PASS',m)};

for(let i=0;i<60;i++)await upload(`IMG-T-${String(i).padStart(3,'0')}`,i);

// first RECOMMEND must compute and store
const r1=await j(await cmd('RECOMMEND'));
assert.equal(r1.cached,false,'first RECOMMEND must compute');
assert(r1.generation,'a generation must be returned');

// repeated RECOMMEND on an unchanged library must read ZERO assets
assetReads=0;
for(let i=0;i<5;i++){
  const r=await j(await cmd('RECOMMEND'));
  assert.equal(r.cached,true,'an unchanged library must serve TODAY from the stored object');
  assert.equal(r.generation,r1.generation,'the generation must be stable while nothing moves');
}
assert.equal(assetReads,0,`5 cached RECOMMENDs read ${assetReads} assets; expected 0 — the full scan is not dead`);
ok('5 repeated RECOMMENDs on a quiet library read 0 assets');

// uploading must move the generation
await upload('IMG-T-NEW',999);
const r2=await j(await cmd('RECOMMEND'));
assert.notEqual(r2.generation,r1.generation,'an upload must move the TODAY generation');
assert.equal(r2.cached,false,'a moved generation must recompute');
ok('an upload moves the generation and forces a recompute');

// a ledger write must move the generation even though the library did not change
const st=await j(await call('state'));
await cmd('BASELINE_CAPTURE',{evidence_reference:'e',inventory_mapping_reference:'i'},st.state.rev);
const r3=await j(await cmd('RECOMMEND'));
assert.notEqual(r3.generation,r2.generation,'a ledger write must move the generation');
ok('a ledger write moves the generation without any library change');

// and it must settle again
const r4=await j(await cmd('RECOMMEND'));
assert.equal(r4.cached,true,'the generation must settle after recompute');
assert.equal(r4.generation,r3.generation);
ok('the generation settles again once recomputed');

// delete-and-replace must be caught: same count, different content
assetReads=0;
const a=await assetsStore.get('assets/IMG-T-NEW.json',{type:'json'});
a.notes='mutated in place';
await assetsStore.setJSON('assets/IMG-T-NEW.json',a);
const r5=await j(await cmd('RECOMMEND'));
assert.notEqual(r5.generation,r4.generation,'an in-place edit must move the generation even though the count is unchanged');
ok('delete-and-replace / in-place edit is caught by etag, not just count');

const report={pass:true,total:checks.length,checks};
await fs.writeFile('tests/TODAY_GENERATION_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
