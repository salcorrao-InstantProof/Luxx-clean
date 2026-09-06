// The single test the reviewer asked for:
//   poll, upload, poll again, assert client library == server count and no asset vanished
//   without a delete event.
// This is the invariant that v1.4.7 broke and that every future paging/polling change must hold.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-inv-'));
process.env.LUXX_LOCAL_STORAGE_DIR=path.join(root,'store');
process.env.LUXX_LOCAL_AUTH_BYPASS='1';
process.env.LUXX_PASSCODE='LUXX-TEST-PASSCODE';
process.env.LUXX_SESSION_SECRET='test-session-secret-not-for-production-0123456789';

const names=['assets','assets-index','upload-chunk','upload-complete','asset-delete'];
const mods={};for(const n of names)mods[n]=(await import(`../netlify/functions/${n}.mjs`)).default;
const call=(n,url='http://local/api/'+n,opt={})=>mods[n](new Request(url,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body}));
const j=async r=>r.json();
const jpg=await fs.readFile('tests/fixtures/orient6.jpg');
const bytesFor=n=>Buffer.concat([Buffer.from(jpg),Buffer.from(`\u0000LUXX${n}`)]);

async function upload(id,n){
  await call('upload-chunk','http://local/api/upload-chunk',{method:'POST',headers:{'x-luxx-asset-id':id,'x-luxx-part':'0','x-luxx-total-parts':'1'},body:bytesFor(n)});
  const out=await j(await call('upload-complete','http://local/api/upload-complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:id,name:id+'.jpg',type:'image/jpeg',size:bytesFor(n).length,parts:1,media_type:'IMAGE',authorization_status:'AUTHORIZED'})}));
  assert(!out.error&&!out.duplicate,`upload ${id}: ${out.error||'duplicate'}`);
}
// Mirrors the client's fetchAllAssets(): walk every page, then compare against the server total.
async function clientLibrary(pageSize=120){
  let out=[],cursor=0,guard=0,total=null;
  while(guard++<80){
    const a=await j(await call('assets',`http://local/api/assets?limit=${pageSize}&cursor=${cursor}`));
    total=a.total;out=out.concat(a.assets||[]);
    if(a.next_cursor==null||!(a.assets||[]).length)break;
    cursor=a.next_cursor;
  }
  return {assets:out,total};
}
const idx=async()=>j(await call('assets-index'));
const checks=[];const ok=(m)=>{checks.push(m);console.log('PASS',m)};

// --- cross the 120 default page size, which is where v1.4.7 silently truncated ---
for(let i=0;i<130;i++)await upload(`IMG-${String(i).padStart(4,'0')}`,i);

const poll1=await idx();
const lib1=await clientLibrary();
assert.equal(lib1.assets.length,lib1.total,'client library must equal server total');
assert.equal(lib1.assets.length,poll1.count,'client library must equal the index count');
assert.equal(lib1.assets.length,130,`expected 130 assets past the 120 page boundary, got ${lib1.assets.length}`);
assert.equal(new Set(lib1.assets.map(a=>a.asset_id)).size,130,'no duplicates across pages');
ok('130 assets survive a full paged read past the 120 boundary');

// --- a single un-cursored page must NOT be mistaken for the whole library ---
const firstPage=await j(await call('assets','http://local/api/assets?limit=120&cursor=0'));
assert.equal(firstPage.assets.length,120);
assert(firstPage.next_cursor!=null,'a truncated read must advertise more pages');
assert(firstPage.total>firstPage.assets.length,'total must expose that the page is partial');
ok('a partial page cannot masquerade as the complete library');

// --- poll, upload, poll again: signature must move, nothing may vanish ---
const before=await idx();
await upload('IMG-NEW-0001',9999);
const after=await idx();
assert.notEqual(after.signature,before.signature,'the index signature must change after an upload');
assert.equal(after.count,before.count+1,'the index count must increase by exactly one');
const lib2=await clientLibrary();
assert.equal(lib2.assets.length,after.count,'client library must equal server count after upload');
const missing=lib1.assets.map(a=>a.asset_id).filter(id=>!lib2.assets.some(x=>x.asset_id===id));
assert.deepEqual(missing,[],`assets vanished without a delete: ${missing.join(',')}`);
ok('poll -> upload -> poll: nothing vanished without a delete event');

// --- an unchanged library must produce an identical signature (no needless hydration) ---
const a1=await idx(),a2=await idx();
assert.equal(a1.signature,a2.signature,'a quiet library must produce a stable signature');
assert.equal(a1.count,a2.count);
ok('an unchanged library yields a stable signature, so the poll does no work');

// --- a real delete must move the signature and reduce the count ---
const doomed=lib2.assets.find(a=>a.asset_id==='IMG-NEW-0001');
assert(doomed,'target asset present');
const del=await call('asset-delete','http://local/api/asset-delete',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:'IMG-NEW-0001'})});
assert.equal(del.status,200,'unused asset should be deletable');
const afterDel=await idx();
assert.equal(afterDel.count,after.count-1,'delete must reduce the count by exactly one');
assert.notEqual(afterDel.signature,after.signature,'delete must move the signature');
ok('a genuine delete is visible in both count and signature');

// --- tiny page size must still cover the library exactly once ---
const small=await clientLibrary(7);
assert.equal(small.assets.length,small.total,'small pages must still cover everything');
assert.equal(new Set(small.assets.map(a=>a.asset_id)).size,small.total,'no duplicates at small page size');
ok('paging at limit=7 covers the library exactly once');


// --- RACE: the signature moves twice while a hydrate is in flight ---
// The client must never end up holding a set that matches neither generation. It may lag by one
// frame, but it must be able to DETECT that it lagged, which is what the count comparison gives.
{
  const beforeSig=await idx();
  const hydrate=clientLibrary(9);              // slow, many pages
  await upload('IMG-RACE-A',70001);            // first change mid-hydrate
  await upload('IMG-RACE-B',70002);            // second change mid-hydrate
  const lib=await hydrate;
  const afterSig=await idx();
  assert.notEqual(afterSig.signature,beforeSig.signature,'two uploads must move the signature');
  // The hydrate may legitimately be stale, but the staleness must be detectable, never silent.
  const stale=lib.assets.length!==afterSig.count;
  assert(lib.assets.length<=afterSig.count,'a hydrate must never report MORE assets than exist');
  assert(lib.assets.length===lib.total||stale,'a hydrate must be internally consistent or detectably stale');
  // And a fresh hydrate must converge.
  const settled=await clientLibrary(9);
  assert.equal(settled.assets.length,afterSig.count,'a hydrate after the writes must converge on the true count');
  ok('signature moving twice mid-hydrate is detectable and converges on the next read');
}

// --- RACE: a delete lands while a hydrate is walking pages ---
{
  await upload('IMG-RACE-DEL',70003);
  const beforeCount=(await idx()).count;
  const hydrate=clientLibrary(9);
  const del=await call('asset-delete','http://local/api/asset-delete',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:'IMG-RACE-DEL'})});
  assert.equal(del.status,200);
  const lib=await hydrate;
  const after=await idx();
  assert.equal(after.count,beforeCount-1,'the delete must land');
  assert(!lib.assets.some(a=>a.asset_id===undefined),'a page racing a delete must not yield undefined entries');
  assert.equal(new Set(lib.assets.map(a=>a.asset_id)).size,lib.assets.length,'a delete mid-walk must not duplicate an asset across pages');
  const settled=await clientLibrary(9);
  assert.equal(settled.assets.length,after.count,'the next hydrate must converge after a mid-walk delete');
  assert(!settled.assets.some(a=>a.asset_id==='IMG-RACE-DEL'),'the deleted asset must be gone once settled');
  ok('a delete during hydrate cannot duplicate, corrupt, or resurrect an asset');
}

const report={pass:true,total:checks.length,checks};
await fs.writeFile('tests/LIBRARY_INVARIANT_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
