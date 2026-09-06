import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-failure-'));
process.env.LUXX_LOCAL_STORAGE_DIR=path.join(root,'store');
process.env.LUXX_FFMPEG_PATH='/usr/bin/ffmpeg';
process.env.LUXX_FFPROBE_PATH='/usr/bin/ffprobe';
delete process.env.LUXX_LOCAL_AUTH_BYPASS;

const protectedNames=['state','assets','upload-chunk','thumbnail','upload-complete','asset-update','asset-delete','image-edit','start-media-job','kick-media-job','process-media-job-background','job','variant-update','download-manifest','media-chunk','hls','action','export-data','import-data'];
const mods={};
for(const n of [...protectedNames,'health','session','login','logout','process-media-job']) mods[n]=(await import(`../netlify/functions/${n}.mjs`)).default;
const call=async(n,url='http://local/api/'+n,opt={})=>mods[n](new Request(url,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body}));
const tests=[]; const t=(name,pass,detail='')=>{tests.push({name,pass,detail}); if(!pass) throw new Error(name+': '+detail)};

// Public surface / auth rejection.
let r=await call('health');t('health public',r.status===200,`status ${r.status}`);
r=await call('session');let sj=await r.json();t('session unauthenticated',r.status===200&&sj.authenticated===false,JSON.stringify(sj));
for(const n of protectedNames){
  let method=['upload-chunk','thumbnail','upload-complete','image-edit','start-media-job','kick-media-job','process-media-job-background','action','import-data'].includes(n)?'POST':['asset-update','variant-update'].includes(n)?'PUT':'GET';
  let url='http://local/api/'+n;
  if(n==='job')url+='?id=X'; if(n==='download-manifest')url+='?asset=X'; if(n==='media-chunk')url+='?key=original/X/part-000000'; if(n==='hls')url+='?asset=X&variant=Y';
  const rr=await call(n,url,{method,headers:{'content-type':'application/json'},body:(method==='GET'?undefined:'{}')});
  t(`unauthorized ${n}`,rr.status===401,`status ${rr.status}`);
}

r=await call('process-media-job','http://local/api/process-media-job',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});t('legacy renderer endpoint retired',r.status===410,`status ${r.status}`);

// Switch to authenticated local-test mode for validation/failure cases.
process.env.LUXX_LOCAL_AUTH_BYPASS='1';

r=await call('upload-chunk','http://local/api/upload-chunk',{method:'POST',headers:{'x-luxx-asset-id':'BAD','x-luxx-part':'1','x-luxx-total-parts':'1'},body:Buffer.from('x')});t('chunk invalid index rejected',r.status===400,`status ${r.status}`);
const tooBig=Buffer.alloc(3_500_001,1);r=await call('upload-chunk','http://local/api/upload-chunk',{method:'POST',headers:{'x-luxx-asset-id':'BIG','x-luxx-part':'0','x-luxx-total-parts':'1'},body:tooBig});t('chunk size ceiling enforced',r.status===413,`status ${r.status}`);

r=await call('upload-complete','http://local/api/upload-complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:'MISS',name:'miss.mp4',type:'video/mp4',size:100,parts:1,media_type:'VIDEO'})});t('missing chunk blocks completion',r.status===400,`status ${r.status}`);

r=await call('asset-update','http://local/api/asset-update',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:'NOPE',notes:'x'})});t('missing asset update rejected',r.status===404,`status ${r.status}`);
r=await call('variant-update','http://local/api/variant-update',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({asset_id:'NOPE',variant_id:'NOPE'})});t('missing variant update rejected',r.status===404,`status ${r.status}`);
r=await call('job','http://local/api/job?id=NOPE');t('missing job rejected',r.status===404,`status ${r.status}`);
r=await call('download-manifest','http://local/api/download-manifest?asset=NOPE');t('missing download asset rejected',r.status===404,`status ${r.status}`);
r=await call('media-chunk','http://local/api/media-chunk?key=../secret');t('path traversal media key rejected',r.status===400,`status ${r.status}`);
r=await call('hls','http://local/api/hls?asset=NOPE&variant=NOPE');t('missing HLS rejected',r.status===404,`status ${r.status}`);
r=await call('action','http://local/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});t('missing action op rejected',r.status===400,`status ${r.status}`);
r=await call('action','http://local/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'DOES_NOT_EXIST',payload:{}})});t('unknown action op rejected',r.status===400,`status ${r.status}`);
r=await call('import-data','http://local/api/import-data',{method:'POST',headers:{'content-type':'application/json'},body:'{not-json'});t('malformed import rejected',r.status===400,`status ${r.status}`);

// Method restrictions.
for(const [n,method] of [['upload-chunk','GET'],['thumbnail','GET'],['upload-complete','GET'],['asset-update','POST'],['image-edit','GET'],['start-media-job','GET'],['kick-media-job','GET'],['process-media-job-background','GET'],['variant-update','POST'],['action','GET'],['import-data','GET']]){
  const rr=await call(n,'http://local/api/'+n,{method});
  t(`method restriction ${n}`,rr.status===405,`status ${rr.status}`);
}

const report={pass:tests.every(x=>x.pass),total:tests.length,passed:tests.filter(x=>x.pass).length,failed:tests.filter(x=>!x.pass).length,tests};
await fs.writeFile('tests/FAILURE_TEST_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({pass:report.pass,total:report.total,passed:report.passed,failed:report.failed},null,2));
if(!report.pass)process.exitCode=1;
