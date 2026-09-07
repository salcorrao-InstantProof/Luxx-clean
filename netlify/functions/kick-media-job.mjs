import crypto from 'node:crypto';
import {error,json,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';

function tokenHash(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex');}

export default async req=>{
  if(!verifySession(req)) return error('Unauthorized',401);
  if(req.method!=='POST') return error('Method not allowed',405);
  const body=await readJson(req), job_id=cleanId(body?.job_id);
  if(!job_id) return error('Missing job_id');
  const jobs=await store(STORES.jobs), key=`jobs/${job_id}.json`;
  let job=null;
  for(let attempt=0,wait=200;attempt<6;attempt++){
    try{job=await jobs.get(key,{type:'json'});}catch{}
    if(job)break;
    if(attempt<5){await new Promise(r=>setTimeout(r,wait));wait=Math.min(wait*2,2000);}
  }
  if(!job) return error('Job not found after 6 read attempts',404);
  if(!['AUTO_VIDEO','VIDEO_EDIT'].includes(job.kind)) return error('Unsupported job kind');
  if(job.status==='COMPLETE') return json({ok:true,already_complete:true,job_id});
  const movedAt=Date.parse(job.updated_at||job.created_at||0)||0;
  if(job.status==='RUNNING'&&movedAt&&Date.now()-movedAt<90000)
    return json({ok:true,already_running:true,job_id,job_status:job.status,progress:Number(job.progress||0)});

  const token=crypto.randomBytes(32).toString('base64url');
  job.worker_token_hash=tokenHash(token);
  job.trigger_attempts=Number(job.trigger_attempts||0)+1;
  job.trigger_requested_at=new Date().toISOString();
  if(job.status==='FAILED') { job.status='QUEUED'; job.progress=0; job.error=null; }
  await jobs.setJSON(key,job);

  const origin=process.env.URL||process.env.DEPLOY_PRIME_URL||new URL(req.url).origin;
  const target=new URL('/api/process-media-job-background',origin);
  target.searchParams.set('job_id',job_id);
  target.searchParams.set('worker_token',token);
  let response;
  try{
    response=await fetch(target,{method:'POST',headers:{'content-type':'application/json','x-luxx-worker-token':token},body:JSON.stringify({job_id,worker_token:token})});
  }catch(e){
    const latest=(await jobs.get(key,{type:'json'}))||job;latest.trigger_error=String(e?.message||e);latest.trigger_failed_at=new Date().toISOString();await jobs.setJSON(key,latest);
    return error(`Could not start background renderer: ${latest.trigger_error}`,502);
  }
  if(!response.ok && response.status!==202){
    const txt=await response.text().catch(()=> '');
    const latest=(await jobs.get(key,{type:'json'}))||job;latest.trigger_error=`HTTP ${response.status}${txt?': '+txt.slice(0,500):''}`;latest.trigger_failed_at=new Date().toISOString();await jobs.setJSON(key,latest);
    return error(`Background renderer rejected the job (${response.status})`,502);
  }
  const latest=(await jobs.get(key,{type:'json'}))||job;
  latest.triggered_at=new Date().toISOString();latest.trigger_http_status=response.status;latest.trigger_error=null;
  await jobs.setJSON(key,latest);
  let after=latest,claimed=false;
  for(let i=0;i<8;i++){
    await new Promise(r=>setTimeout(r,500));
    after=(await jobs.get(key,{type:'json'}))||after;
    if(after.worker_accepted_at||['RUNNING','CONTINUE','COMPLETE','FAILED'].includes(String(after.status||''))){claimed=true;break;}
    if(String(after.trigger_error||'').startsWith('WORKER_AUTH_REJECTED'))break;
  }
  if(!claimed){
    if(!after.trigger_error)
      after.trigger_error='BACKGROUND_ACCEPTED_BUT_WORKER_DID_NOT_CLAIM: the renderer was invoked and returned 202, but never picked up the job.';
    after.trigger_failed_at=new Date().toISOString();
    await jobs.setJSON(key,after);
    return json({ok:false,started:false,job_id,background_status:response.status,
      job_status:after.status,trigger_error:after.trigger_error},202);
  }
  return json({ok:true,started:true,job_id,background_status:response.status,
    trigger_attempts:Number(after.trigger_attempts||1),job_status:after.status,progress:Number(after.progress||0)});
};
export const config={path:'/api/kick-media-job'};
