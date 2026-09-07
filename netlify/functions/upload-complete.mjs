import crypto from 'node:crypto';import {json,error,readJson} from '../lib/http.mjs';import {verifySession} from '../lib/auth.mjs';import {store} from '../lib/storage.mjs';import {STORES,CHUNK_SIZE} from '../lib/model.mjs';import {autoPlatformEligibility} from '../lib/domain.mjs';import {cleanId} from '../lib/ids.mjs';
let _heicCache=null;
async function heicDecodable(){
  if(_heicCache!==null)return _heicCache;
  try{
    const {resolveVideoBinaries}=await import('../lib/video.mjs');
    const {ffmpeg}=await resolveVideoBinaries();
    const {execFile}=await import('node:child_process');
    _heicCache=await new Promise(res=>{
      execFile(ffmpeg,['-hide_banner','-decoders'],{timeout:15000},(e,out)=>{
        if(e)return res(false);
        res(/\bhevc\b/.test(String(out))&&/\b(heif|heic|libheif)\b/i.test(String(out)));
      });
    });
  }catch{_heicCache=false}
  return _heicCache;
}
export async function completeUpload(body){
  const asset_id=cleanId(body?.asset_id),name=String(body?.name||'').slice(0,240),type=String(body?.type||'application/octet-stream').slice(0,120),size=Number(body?.size),parts=Number(body?.parts),media_type=body?.media_type==='VIDEO'?'VIDEO':'IMAGE';
  if(!asset_id||!name||!Number.isFinite(size)||size<1||!Number.isInteger(parts)||parts<1)return {error:'Invalid upload manifest'};
  const expected=Math.ceil(size/CHUNK_SIZE);
  if(parts!==expected)return {error:`Expected ${expected} chunks, got ${parts}`};
  const media=await store(STORES.media),hash=crypto.createHash('sha256');
  const {blobs}=await media.list({prefix:`original/${asset_id}/part-`});
  const present=new Set((blobs||[]).map(b=>b.key));
  for(let i=0;i<parts;i++){
    const key=`original/${asset_id}/part-${String(i).padStart(6,'0')}`;
    if(!present.has(key))return {error:`Missing chunk ${i}`};
  }
  const ends=await Promise.all([0,parts-1].map(i=>media.getWithMetadata(`original/${asset_id}/part-${String(i).padStart(6,'0')}`,{type:'arrayBuffer'})));
  for(const e of ends){
    if(!e)return {error:'Missing first or last chunk'};
    hash.update(Buffer.from(e.data));
  }
  hash.update(String(size));
  const tailExpected=size-(parts-1)*CHUNK_SIZE;
  const tailActual=ends[1].data.byteLength;
  if(tailActual!==tailExpected) return {error:`Last chunk is ${tailActual} bytes, expected ${tailExpected}. The upload is incomplete.`};
  const digest=hash.digest('hex');
  const assets=await store(STORES.assets);
  if(await assets.get(`assets/${asset_id}.json`,{type:'json'}))return {error:'Asset already exists'};
  const listed=await assets.list({prefix:'assets/'});
  for(const row of listed.blobs||[]){
    const prior=await assets.get(row.key,{type:'json'});
    if(prior?.upload_identity&&prior.upload_identity===digest){
      for(let i=0;i<parts;i++) await media.delete(`original/${asset_id}/part-${String(i).padStart(6,'0')}`);
      await media.delete(`thumb/${asset_id}/thumb.jpg`);
      return {duplicate:true,existing_asset_id:prior.asset_id,master_sha256:digest,upload_identity:digest};
    }
  }
  const tk=`thumb/${asset_id}/thumb.jpg`;
  const thumbnail_key=await media.getMetadata(tk)?tk:null;
  const heic=/heic|heif/i.test(name)||/heic|heif/i.test(type);
  if(heic&&media_type==='IMAGE'&&!(await heicDecodable())){
    for(let i=0;i<parts;i++) await media.delete(`original/${asset_id}/part-${String(i).padStart(6,'0')}`);
    await media.delete(tk);
    return {error:'This build cannot process HEIC/HEIF photos. On iPhone set Settings > Camera > Formats to Most Compatible, or export these photos as JPEG, then upload again.'};
  }
  const asset={asset_id,media_type,name,type,size,parts,chunk_size:CHUNK_SIZE,original_immutable:true,uploaded_at:new Date().toISOString(),status:media_type==='VIDEO'?'PROCESSING_REQUIRED':'READY_FOR_REVIEW',authorization_status:['AUTHORIZED','NOT_AUTHORIZED','UNCLEAR'].includes(body?.authorization_status)?body.authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:body?.historical_usage_status==='HISTORICAL_BASELINE'?'HISTORICAL_BASELINE':'PROSPECTIVE',platform_eligibility:Array.isArray(body?.platform_eligibility)&&body.platform_eligibility.length?body.platform_eligibility:[],platform_eligibility_source:Array.isArray(body?.platform_eligibility)&&body.platform_eligibility.length?'MANUAL_UPLOAD':'LUXX_AUTO',commercial_role:[],notes:String(body?.notes||''),master_sha256:digest,upload_identity:digest,batch_id:String(body?.batch_id||'').slice(0,120)||null,thumbnail_key,variants:[],analysis:null,job_id:null,use_count:0,last_used_at:null,privacy:{status:media_type==='VIDEO'?'AWAITING_VIDEO_PROCESSING':'SCAN_REQUIRED',embedded_geolocation_detected:null,sensitive_metadata_classes:[],exact_location_values_stored:false,original_policy:'PRIVATE_IMMUTABLE_MASTER - never the recommended posting file',safe_export_variant_id:null,metadata_stripping_verified:false,visual_location_cues:'NOT_AUTOMATICALLY_VERIFIED'},visual_location_review_status:'NOT_REVIEWED'};
  if(asset.platform_eligibility_source==='LUXX_AUTO') asset.platform_eligibility=autoPlatformEligibility(asset);
  if(media_type==='VIDEO'){
    asset.job_id=`JOB-${crypto.randomUUID()}`;
    const jobs=await store(STORES.jobs);
    await jobs.setJSON(`jobs/${asset.job_id}.json`,{job_id:asset.job_id,asset_id,kind:'AUTO_VIDEO',status:'QUEUED',created_at:new Date().toISOString(),progress:0});
  }
  await assets.setJSON(`assets/${asset_id}.json`,asset);
  return {asset};
}
export default async req=>{
  if(!verifySession(req)) return error('Unauthorized',401);
  if(req.method!=='POST') return error('Method not allowed',405);
  const r=await completeUpload(await readJson(req));
  if(r.error) return error(r.error);
  return json({ok:true,...r});
};
export const config={path:'/api/upload-complete'};
