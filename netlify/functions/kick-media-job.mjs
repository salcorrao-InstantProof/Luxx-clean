import crypto from 'node:crypto';
import {error,json,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';

function tokenHash(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex');}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function readJob(jobs,key){
  for(const wait of [0,50,100,200,400,800]){
    if(wait)await sleep(wait);
    const job=await jobs.get(key,{type:'json'});
    if(job)return job;
  }
  return null;
}

export default async req=>{
  if(!verifySession(req)) return error('Unauthorized',401);
  if(req.method!=='POST') return error('Method not allowed',405);
  const body=await readJson(req), job_id=cleanId(body?.job_id);
  if(!job_id) return error('Missing job_id');
  const jobs=await store(STORES.jobs), key=`jobs/${job_id}.json`;
  const job=await readJob(jobs,key);
  if(!job) return error('Job not found',404);
  if(!['AUTO_VIDEO','VIDEO_EDIT'].includes(job.kind)) return error('Unsupported job kind');
  if(job.status==='COMPLETE') return json({ok:true,already_complete:true,job_id});
  const age=job.updated_at?Date.now()-new Date(job.updated_at).getTime():Infinity;
  if(job.status==='RUNNING'&&Number.isFinite(age)&&age<90000){
    return json({ok:true,already_running:true,job_id,job_status:job.status,progress:Number(job.progress||0)});
  }

  const token=crypto.randomBytes(32).toString('base64url');
  job.worker_token_hash=tokenHash(token);
  job.trigger_attempts=Number(job.trigger_attempts||0)+1;
  job.trigger_requested_at=new Date().toISOString();
  job.trigger_error=null;
  if(job.status==='FAILED') { job.status='QUEUED'; job.progress=0; job.error=null; }
  await jobs.setJSON(key,job);

  const origin=process.env.URL||process.env.DEPLOY_PRIME_URL||new URL(req.url).origin;
  const target=new URL('/api/process-media-job-background',origin);
  target.searchParams.set('job_id',job_id);
  target.searchParams.set('worker_token',token);

  let response;
  try{
    response=await fetch(target,{
      method:'POST',
      headers:{'content-type':'application/json','x-luxx-worker-token':token},
      body:JSON.stringify({job_id,worker_token:token})
    });
  }catch(e){
    const latest=(await jobs.get(key,{type:'json'}))||job;
    latest.trigger_error=String(e?.message||e);
    latest.trigger_failed_at=new Date().toISOString();
    await jobs.setJSON(key,latest);
    return error(`Could not start background renderer: ${latest.trigger_error}`,502);
  }
  if(!response.ok && response.status!==202){
    const txt=await response.text().catch(()=> '');
    const latest=(await jobs.get(key,{type:'json'}))||job;
    latest.trigger_error=`HTTP ${response.status}${txt?': '+txt.slice(0,500):''}`;
    latest.trigger_failed_at=new Date().toISOString();
    latest.trigger_http_status=response.status;
    await jobs.setJSON(key,latest);
    return error(`Background renderer rejected the job (${response.status})`,502);
  }

  let latest=(await jobs.get(key,{type:'json'}))||job;
  latest.triggered_at=new Date().toISOString();
  latest.trigger_http_status=response.status;
  await jobs.setJSON(key,latest);

  const claimed=new Set(['RUNNING','CONTINUE','FAILED','COMPLETE']);
  for(const wait of [200,400,600,800,1000,1200]){
    await sleep(wait);
    latest=(await jobs.get(key,{type:'json'}))||latest;
    if(latest.worker_accepted_at||claimed.has(latest.status)||latest.trigger_error==='WORKER_AUTH_REJECTED')break;
  }
  if(!(latest.worker_accepted_at||claimed.has(latest.status))){
    latest.trigger_error='BACKGROUND_ACCEPTED_BUT_WORKER_DID_NOT_CLAIM';
    latest.trigger_failed_at=new Date().toISOString();
    await jobs.setJSON(key,latest);
    return json({
      ok:false,
      error:'BACKGROUND_ACCEPTED_BUT_WORKER_DID_NOT_CLAIM',
      job_id,
      background_status:response.status,
      job_status:latest.status,
      trigger_attempts:Number(latest.trigger_attempts||1)
    },502);
  }

  return json({
    ok:true,
    job_id,
    background_status:response.status,
    trigger_attempts:Number(latest.trigger_attempts||1),
    job_status:latest.status,
    progress:Number(latest.progress||0),
    claimed:true
  });
};
export const config={path:'/api/kick-media-job'};
