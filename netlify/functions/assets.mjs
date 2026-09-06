import {json,error} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {getState} from './state.mjs';
import {decorateAssetForUse} from '../lib/domain.mjs';

// Blob reads are network round trips. v1.4.6 read every asset sequentially and conditionally
// wrote each one back, on every page load and after every mutation, which is where a real
// media bank exceeded the function time limit. Reads are now batched and the write-back is
// bounded so one slow request can never cascade.
const READ_BATCH=20;
const MAX_WRITEBACK=25;
const DEFAULT_LIMIT=120;

function privacyMigration(a){
  if(!a.visual_location_review_status)a.visual_location_review_status='NOT_REVIEWED';
  const safe=(a.variants||[]).find(v=>v.privacy_safe_export===true&&v.metadata_stripped===true);
  if(!a.privacy){
    a.privacy={status:safe?'SAFE_EXPORT_READY':a.media_type==='IMAGE'?'SCAN_REQUIRED':'AWAITING_VIDEO_PROCESSING',embedded_geolocation_detected:null,sensitive_metadata_classes:[],exact_location_values_stored:false,original_policy:'PRIVATE_IMMUTABLE_MASTER — never the recommended posting file',safe_export_variant_id:safe?.variant_id||null,metadata_stripping_verified:!!safe,visual_location_cues:'NOT_AUTOMATICALLY_VERIFIED'};
    return true;
  }
  let changed=false;
  if(!a.privacy.original_policy){a.privacy.original_policy='PRIVATE_IMMUTABLE_MASTER — never the recommended posting file';changed=true;}
  if(a.privacy.exact_location_values_stored!==false){a.privacy.exact_location_values_stored=false;changed=true;}
  if(!a.privacy.visual_location_cues){a.privacy.visual_location_cues='NOT_AUTOMATICALLY_VERIFIED';changed=true;}
  if(safe&&!a.privacy.safe_export_variant_id){a.privacy.safe_export_variant_id=safe.variant_id;a.privacy.metadata_stripping_verified=true;a.privacy.status='SAFE_EXPORT_READY';changed=true;}
  return changed;
}

async function mapLimited(items,fn,size){
  const out=[];
  for(let i=0;i<items.length;i+=size)out.push(...await Promise.all(items.slice(i,i+size).map(fn)));
  return out;
}

export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  const url=new URL(req.url);
  const limit=Math.max(1,Math.min(500,Number(url.searchParams.get('limit'))||DEFAULT_LIMIT));
  const cursor=Math.max(0,Number(url.searchParams.get('cursor'))||0);
  const s=await store(STORES.assets),jobs=await store(STORES.jobs),state=await getState();
  const {blobs}=await s.list({prefix:'assets/'});
  const keys=blobs.map(b=>b.key).sort();
  const total=keys.length;

  // Paging order is by key: stable, total, and deterministic, which is the only property
  // paging correctness actually needs (no drops, no duplicates, no reshuffle mid-walk).
  // It is NOT a chronological guarantee. Asset ids happen to embed a base36 timestamp, but
  // identity must not be coupled to the clock, so nothing here depends on that. Display order
  // is uploaded_at and is applied by the client once it holds the complete set.
  keys.sort();
  const pageKeys=keys.slice(cursor,cursor+limit);
  const page=(await mapLimited(pageKeys,k=>s.get(k,{type:'json'}).catch(()=>null),READ_BATCH)).filter(Boolean);

  const pending=[];
  for(const a of page){
    let changed=privacyMigration(a);
    if(a.media_type==='VIDEO'&&!a.thumbnail_key){const v=(a.variants||[]).find(x=>x.variant_id==='MAIN-CUT'&&x.thumbnail_key)||(a.variants||[]).find(x=>x.thumbnail_key);if(v?.thumbnail_key){a.thumbnail_key=v.thumbnail_key;changed=true;}}
    const before=JSON.stringify({platform_eligibility:a.platform_eligibility,platform_eligibility_source:a.platform_eligibility_source,destination_plan:a.destination_plan,x_face_safe:a.x_face_safe,use_count:a.use_count,last_used_at:a.last_used_at});
    decorateAssetForUse(state,a);
    const after=JSON.stringify({platform_eligibility:a.platform_eligibility,platform_eligibility_source:a.platform_eligibility_source,destination_plan:a.destination_plan,x_face_safe:a.x_face_safe,use_count:a.use_count,last_used_at:a.last_used_at});
    if(before!==after)changed=true;
    if(changed)pending.push(a);
  }
  // Bounded write-back. Anything not persisted this round is still correct in the response and
  // is persisted on a later load, so a large library cannot stall the read path.
  await mapLimited(pending.slice(0,MAX_WRITEBACK),a=>s.setJSON(`assets/${a.asset_id}.json`,a).catch(()=>null),READ_BATCH);

  await mapLimited(page.filter(a=>a.job_id),async a=>{
    const j=await jobs.get(`jobs/${a.job_id}.json`,{type:'json'}).catch(()=>null);
    if(!j)return null;
    const stamp=j.updated_at||j.created_at||a.processing_started_at||a.uploaded_at,age_ms=stamp?Math.max(0,Date.now()-new Date(stamp).getTime()):null;
    const stale=Number.isFinite(age_ms)&&age_ms>180000&&(a.variants||[]).length===0&&['QUEUED','RUNNING','COMPLETE'].includes(j.status)&&a.status!=='READY_FOR_REVIEW';
    a.processing_job={job_id:j.job_id,status:j.status,progress:Number(j.progress||0),error:j.error||null,created_at:j.created_at||null,updated_at:j.updated_at||j.created_at||null,age_ms,stale,completed_variants:j.completed_variants||[]};
    return null;
  },READ_BATCH);

  const next_cursor=cursor+limit<total?cursor+limit:null;
  return json({ok:true,assets:page,total,cursor,next_cursor,paging_order:'KEY_STABLE_NOT_CHRONOLOGICAL',writeback_deferred:Math.max(0,pending.length-MAX_WRITEBACK)});
};
export const config={path:'/api/assets'};
