import {json,error,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';
import {uid} from '../lib/domain.mjs';

export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  if(req.method!=='POST')return error('Method not allowed',405);
  const b=await readJson(req),asset_id=cleanId(b?.asset_id),kind=String(b?.kind||''),reason=String(b?.reason||'MANUAL').slice(0,80);
  if(!asset_id||!['AUTO_VIDEO','VIDEO_EDIT'].includes(kind))return error('Invalid media job');
  const assets=await store(STORES.assets),a=await assets.get(`assets/${asset_id}.json`,{type:'json'});
  if(!a||a.media_type!=='VIDEO')return error('Video asset not found',404);
  const jobs=await store(STORES.jobs);

  if(kind==='AUTO_VIDEO'&&a.job_id){
    const existing=await jobs.get(`jobs/${a.job_id}.json`,{type:'json'});
    if(existing&&['QUEUED','RUNNING','CONTINUE'].includes(existing.status)){
      return json({ok:true,job:existing,reused:true});
    }
  }

  const job_id=uid('JOB');
  const job={job_id,asset_id,kind,status:'QUEUED',progress:0,created_at:new Date().toISOString(),source_variant_id:cleanId(b?.source_variant_id)||null,recipe:b?.recipe||{},reason};
  await jobs.setJSON(`jobs/${job_id}.json`,job);
  if(kind==='AUTO_VIDEO'){
    a.job_id=job_id;a.status='PROCESSING_REQUIRED';a.processing_error=null;a.processing_requested_at=new Date().toISOString();
    a.processing_retry_count=Number(a.processing_retry_count||0)+(reason==='INITIAL_UPLOAD'?0:1);a.processing_last_reason=reason;if(reason==='RENDERER_V136_RECOVERY')a.renderer_recovery_version='1.3.6';
    a.privacy={...(a.privacy||{}),status:'AWAITING_VIDEO_PROCESSING',original_policy:'PRIVATE_IMMUTABLE_MASTER — never the recommended posting file'};
    await assets.setJSON(`assets/${asset_id}.json`,a);
  }
  return json({ok:true,job});
};
export const config={path:'/api/start-media-job'};
