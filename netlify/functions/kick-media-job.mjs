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
  const job=await jobs.get(key,{type:'json'});
  if(!job) return error('Job not found',404);
  if(!['AUTO_VIDEO','VIDEO_EDIT'].includes(job.kind)) return error('Unsupported job kind');
  if(job.status==='COMPLETE') return json({ok:true,already_complete:true,job_id});

  const token=crypto.randomBytes(32).toString('base64url');
  job.worker_token_hash=tokenHash(token);
  job.trigger_attempts=Number(job.trigger_attempts||0)+1;
  job.trigger_requested_at=new Date().toISOString();
  if(job.status==='FAILED') { job.status='QUEUED'; job.progress=0; job.error=null; }
  await jobs.setJSON(key,job);

  const target=process.env.LUXX_LOCAL_STORAGE_DIR
    ? new URL('/api/process-media-job-background',req.url)
    : new URL('/.netlify/functions/process-media-job-background',req.url);
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
  const latest=(await jobs.get(key,{type:'json'}))||job;latest.triggered_at=new Date().toISOString();latest.trigger_http_status=response.status;latest.trigger_error=null;await jobs.setJSON(key,latest);
  return json({ok:true,job_id,background_status:response.status,trigger_attempts:Number(latest.trigger_attempts||job.trigger_attempts||1),job_status:latest.status,progress:Number(latest.progress||0)});
};
export const config={path:'/api/kick-media-job'};
