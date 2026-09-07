import crypto from 'node:crypto';
import {error,json,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {processVideoJob} from '../lib/video.mjs';
import {editVideo} from '../lib/media-edit.mjs';
import {cleanId} from '../lib/ids.mjs';

function hashToken(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function safeEq(a,b){try{const x=Buffer.from(String(a||''),'hex'),y=Buffer.from(String(b||''),'hex');return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);}catch{return false;}}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function patchJob(id,patch){
  const s=await store(STORES.jobs),k=`jobs/${id}.json`,j=await s.get(k,{type:'json'});
  if(!j)throw new Error('Job not found');
  Object.assign(j,patch,{updated_at:new Date().toISOString()});
  await s.setJSON(k,j);
  return j;
}
async function readJob(jobs,id){
  const key=`jobs/${id}.json`;
  for(const wait of [0,50,100,200,400,800]){
    if(wait)await sleep(wait);
    const job=await jobs.get(key,{type:'json'});
    if(job)return job;
  }
  return null;
}

export default async req=>{
  if(req.method!=='POST') return error('Method not allowed',405);
  const url=new URL(req.url);
  let body={};
  try{body=await readJson(req)||{};}catch{body={};}
  const id=cleanId(url.searchParams.get('job_id')||body?.job_id);
  const supplied=String(
    url.searchParams.get('worker_token')||
    body?.worker_token||
    req.headers.get('x-luxx-worker-token')||
    ''
  );
  const sessionOK=verifySession(req);
  if(!id){
    if(!sessionOK&&!supplied) return error('Unauthorized worker invocation',401);
    return error('Missing job_id',400);
  }

  const jobs=await store(STORES.jobs);
  const job=await readJob(jobs,id);
  if(!job) return error('Job not found',404);

  const tokenOK=!!(supplied&&job.worker_token_hash&&safeEq(hashToken(supplied),job.worker_token_hash));
  const kickedAt=job.trigger_requested_at?new Date(job.trigger_requested_at).getTime():0;
  const recentKick=Number.isFinite(kickedAt)&&Date.now()-kickedAt<30000&&!!job.worker_token_hash;
  if(supplied&&!tokenOK&&!sessionOK){
    try{await patchJob(id,{trigger_error:'WORKER_AUTH_REJECTED',trigger_failed_at:new Date().toISOString()});}catch{}
    return error('Unauthorized worker invocation',401);
  }
  if(!sessionOK&&!tokenOK&&!recentKick){
    try{await patchJob(id,{trigger_error:'WORKER_AUTH_REJECTED',trigger_failed_at:new Date().toISOString()});}catch{}
    return error('Unauthorized worker invocation',401);
  }

  if(job.status==='COMPLETE') return json({ok:true,already_complete:true});
  await patchJob(id,{
    worker_accepted_at:new Date().toISOString(),
    status:'RUNNING',
    progress:Math.max(1,Number(job.progress||0)),
    error:null,
    trigger_error:null
  });
  try{
    if(job.kind==='AUTO_VIDEO'){await processVideoJob(id);return json({ok:true});}
    if(job.kind==='VIDEO_EDIT'){
      const r=await editVideo({asset_id:job.asset_id,source_variant_id:job.source_variant_id,recipe:job.recipe});
      await patchJob(id,{status:'COMPLETE',progress:100,completed_at:new Date().toISOString(),variant_id:r.variant.variant_id});
      return json({ok:true});
    }
    return error('Unknown job kind');
  }catch(e){
    await patchJob(id,{status:'FAILED',progress:0,error:String(e?.stack||e),failed_at:new Date().toISOString()});
    throw e;
  }
};
export const config={path:'/api/process-media-job-background'};
