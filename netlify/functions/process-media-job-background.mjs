import crypto from 'node:crypto';
import {error,json,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {cleanId} from '../lib/ids.mjs';
import {STORES} from '../lib/model.mjs';
import {processVideoJob} from '../lib/video.mjs';
import {editVideo} from '../lib/media-edit.mjs';

function hashToken(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function safeEq(a,b){try{const x=Buffer.from(String(a||''),'hex'),y=Buffer.from(String(b||''),'hex');return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);}catch{return false;}}
async function patchJob(id,patch){const s=await store(STORES.jobs),k=`jobs/${id}.json`,j=await s.get(k,{type:'json'});if(!j)throw new Error('Job not found');Object.assign(j,patch,{updated_at:new Date().toISOString()});await s.setJSON(k,j);return j;}

export default async req=>{
  if(req.method!=='POST') return error('Method not allowed',405);
  let q={};
  try{q=Object.fromEntries(new URL(req.url).searchParams);}catch{}
  const b=await readJson(req).catch(()=>({}));
  const supplied=String(q.worker_token||b?.worker_token||req.headers.get('x-luxx-worker-token')||'');
  const sessionOK=verifySession(req);
  const id=cleanId(String(q.job_id||b?.job_id||''));
  if(!sessionOK&&!supplied&&!id)return error('Unauthorized worker invocation',401);
  if(!id)return error('Missing job_id',400);
  const jobs=await store(STORES.jobs);
  let job=null;
  for(let attempt=0,wait=200;attempt<6;attempt++){
    try{job=await jobs.get(`jobs/${id}.json`,{type:'json'});}catch{}
    if(job&&(sessionOK||job.worker_token_hash))break;
    if(attempt<5){await new Promise(r=>setTimeout(r,wait));wait=Math.min(wait*2,2000);}
  }
  if(!job)return error('Job not found after 6 read attempts',404);
  const tokenOK=job.worker_token_hash&&safeEq(hashToken(supplied),job.worker_token_hash);
  const requestedAt=Date.parse(job.trigger_requested_at||0)||0;
  const freshKick=!!job.worker_token_hash&&requestedAt&&(Date.now()-requestedAt)<30000;
  if(!sessionOK&&!tokenOK&&!(freshKick&&!supplied)){
    try{await patchJob(id,{status:'QUEUED',trigger_error:'WORKER_AUTH_REJECTED: the renderer was invoked but its credential did not match the job.',trigger_failed_at:new Date().toISOString()});}catch{}
    return error('Unauthorized worker invocation',401);
  }
  if(job.status==='COMPLETE') return json({ok:true,already_complete:true});
  await patchJob(id,{worker_accepted_at:new Date().toISOString(),status:'RUNNING',progress:Math.max(1,Number(job.progress||0)),error:null});
  try{
    if(job.kind==='AUTO_VIDEO'){await processVideoJob(id);return json({ok:true});}
    if(job.kind==='VIDEO_EDIT'){const r=await editVideo({asset_id:job.asset_id,source_variant_id:job.source_variant_id,recipe:job.recipe});await patchJob(id,{status:'COMPLETE',progress:100,completed_at:new Date().toISOString(),variant_id:r.variant.variant_id});return json({ok:true});}
    return error('Unknown job kind');
  }catch(e){await patchJob(id,{status:'FAILED',progress:0,error:String(e?.stack||e),failed_at:new Date().toISOString()});throw e;}
};
export const config={path:'/api/process-media-job-background'};
