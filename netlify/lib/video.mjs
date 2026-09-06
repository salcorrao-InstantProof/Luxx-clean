import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {store} from './storage.mjs';
import {STORES} from './model.mjs';
import {inspectPrivacyFile,verifyPrivacySanitized} from './privacy.mjs';
import {
  STAGE_BUDGET_MS,
  run,
  trace,
  toArrayBuffer,
  setJob,
  assemble,
  sha256File,
  probe,
  analyze,
  choosePlan,
  exportMasterCopy,
  renderClip,
  makeHls,
  storeHls,
  storeMp4Parts,
  paths,
} from './video-runtime.mjs';

export {
  STAGE_BUDGET_MS,
  resolveVideoBinaries,
  CUT_METHOD,
  parseTargetDuration,
  formatDuration,
  planSuggestedCut,
} from './video-runtime.mjs';

async function variantRecord(asset,tmp,input,variantId,label,start,duration,ffmpeg,{copyMaster=false}={}){
  const mp4=path.join(tmp,variantId+'.mp4');
  const hlsDir=path.join(tmp,variantId+'-hls');
  const poster=path.join(tmp,variantId+'-poster.jpg');
  trace(variantId+' render start');
  if(copyMaster){
    try{await exportMasterCopy(input,mp4,ffmpeg);}
    catch(e){console.log('[LUXX_MASTER_COPY_FALLBACK]',String(e?.message||e).slice(0,180));await renderClip(input,mp4,start,duration,ffmpeg);}
  }else{
    await renderClip(input,mp4,start,duration,ffmpeg);
  }
  await run(ffmpeg,['-y','-ss','0.5','-i',mp4,'-map_metadata','-1','-frames:v','1','-vf',"scale='min(640,iw)':-2",'-q:v','4',poster]);
  const media=await store(STORES.media);
  const pb=await fs.readFile(poster);
  const thumbnail_key='thumb/'+asset.asset_id+'/'+variantId+'.jpg';
  await media.set(thumbnail_key,toArrayBuffer(pb),{metadata:{contentType:'image/jpeg',assetId:asset.asset_id,variantId}});
  let hls_segments=0;
  try{
    if(variantId==='FULL-MASTER'){
      await fs.mkdir(hlsDir,{recursive:true});
      await run(ffmpeg,['-y','-i',mp4,'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-c','copy','-hls_time','4','-hls_playlist_type','vod','-hls_flags','independent_segments','-hls_segment_filename',path.join(hlsDir,'seg-%05d.ts'),path.join(hlsDir,'index.m3u8')]);
    }else{
      await makeHls(mp4,hlsDir,ffmpeg);
    }
    hls_segments=await storeHls(asset.asset_id,variantId,hlsDir);
  }catch(e){
    console.log('[LUXX_HLS]',variantId,String(e?.message||e).slice(0,180));
    if(variantId!=='FULL-MASTER')throw e;
  }
  const privacy=await verifyPrivacySanitized(mp4,{mediaType:'VIDEO'});
  if(!privacy.metadata_stripped_verified)throw new Error('Privacy verification failed for '+variantId);
  const download_parts=await storeMp4Parts(asset.asset_id,variantId,mp4);
  const sha256=await sha256File(mp4);
  const stat=await fs.stat(mp4);
  return {
    variant_id:variantId,asset_id:asset.asset_id,master_asset_id:asset.asset_id,variant_type:label,
    start_seconds:start,duration_seconds:duration,start_timestamp:String(start),end_timestamp:String(start+duration),
    final_runtime:duration,thumbnail_frame_timestamp_or_reference:'0.5s',thumbnail_key,
    title_direction:'',description_direction:'',cta:'',tracking_route_id:null,price_if_applicable:null,
    price_creator_approved:false,native_listing_measurement_capability:false,platform:null,
    recipe:{trim_start:start,trim_duration:duration,video_codec:'h264',audio_codec:'aac'},
    rendered:true,rendered_at:new Date().toISOString(),sha256,size:stat.size,
    hls_url:'/api/hls?asset='+asset.asset_id+'&variant='+variantId,hls_segments,download_parts,
    output_name:asset.asset_id+'_'+variantId+'.mp4',privacy_safe_export:true,metadata_stripped:true,
    privacy_verification:privacy,evidence_label:'TECHNICAL HEURISTIC — not a proven revenue-best segment'
  };
}

export async function processVideoJob(job_id){
  const jobs=await store(STORES.jobs),assets=await store(STORES.assets);
  const job=await jobs.get('jobs/'+job_id+'.json',{type:'json'});
  if(!job)throw new Error('Job not found');
  const asset=await assets.get('assets/'+job.asset_id+'.json',{type:'json'});
  if(!asset||asset.media_type!=='VIDEO')throw new Error('Video asset not found');
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-'));
  const stageStarted=Date.now();
  const budgetSpent=()=>Date.now()-stageStarted>STAGE_BUDGET_MS;
  try{
    asset.status='PROCESSING';
    asset.processing_started_at=new Date().toISOString();
    asset.processing_error=null;
    await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
    await setJob(job_id,{status:'RUNNING',progress:5,handed_off:false});
    const {ffmpeg,ffprobe}=await paths();
    const input=await assemble(asset,tmp);
    asset.master_sha256=await sha256File(input);
    await setJob(job_id,{progress:15});
    const meta=await probe(input,ffprobe);
    const privacyScan=await inspectPrivacyFile(input,{mediaType:'VIDEO',ffprobePath:ffprobe});
    asset.privacy={...privacyScan,status:'PROCESSING_SAFE_DERIVATIVES',safe_export_variant_id:null,metadata_stripping_verified:false,updated_at:new Date().toISOString()};
    await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
    await setJob(job_id,{progress:25,probe:meta,privacy:{embedded_geolocation_detected:privacyScan.embedded_geolocation_detected,sensitive_metadata_classes:privacyScan.sensitive_metadata_classes}});
    if(!asset.thumbnail_key){
      try{
        const poster=path.join(tmp,'MASTER-poster.jpg');
        const at=Math.max(0,Math.min(meta.duration*.1,Math.max(0,meta.duration-0.5)));
        await run(ffmpeg,['-y','-ss',String(at),'-i',input,'-map_metadata','-1','-frames:v','1','-vf',"scale='min(640,iw)':-2",'-q:v','4',poster]);
        const media=await store(STORES.media);
        const pb=await fs.readFile(poster);
        const k='thumb/'+asset.asset_id+'/MASTER.jpg';
        await media.set(k,toArrayBuffer(pb),{metadata:{contentType:'image/jpeg',assetId:asset.asset_id,variantId:'MASTER'}});
        asset.thumbnail_key=k;
        asset.thumbnail_frame_timestamp_or_reference=at.toFixed(2)+'s';
        await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
      }catch{}
    }
    const cached=asset.analysis&&asset.analysis.analyzed_master_sha256===asset.master_sha256&&asset.analysis.plan?asset.analysis:null;
    if(!cached&&budgetSpent()){
      await setJob(job_id,{status:'CONTINUE',progress:30,stage:'ANALYZE',note:'Probe complete. Analysis continues in the next invocation.'});
      console.log('[LUXX_HANDOFF] budget spent before analysis; handing off');
      return {job:await setJob(job_id,{}),asset,continued:true};
    }
    const analysis=cached
      ?{sceneTimes:cached.scene_times||[],bad:cached.bad_ranges||[],silence:cached.silence_ranges||[],reused:true,analyze_path:'cached'}
      :await analyze(input,meta,ffmpeg);
    const plan=(cached&&cached.plan)?cached.plan:choosePlan(meta.duration,analysis);
    asset.analysis={duration_seconds:meta.duration,width:meta.width,height:meta.height,scene_changes:(analysis.sceneTimes||[]).length,scene_times:analysis.sceneTimes||[],bad_ranges:analysis.bad,silence_ranges:analysis.silence,plan,analyzed_master_sha256:asset.master_sha256,analysis_reused:!!cached,analyze_path:analysis.analyze_path||null,method:'FFmpeg technical heuristic: scene activity with black/freeze/silence penalties; no semantic desire/attractiveness claim'};
    await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
    await setJob(job_id,{progress:40,plan});
    const targets=[{id:'FULL-MASTER',label:'FULL_MASTER',start:plan.full_master.start,duration:plan.full_master.duration},...plan.teasers.map((t,i)=>({id:'TEASER-'+(i+1),label:'TEASER',start:t.start,duration:t.duration}))];
    const done=new Set(job.completed_variants||[]);
    const managed=new Set(['FULL-MASTER','MAIN-CUT','TEASER-1','TEASER-2','TEASER-3','TEASER-4']);
    const variants=(asset.variants||[]).filter(v=>managed.has(v.variant_id)&&done.has(v.variant_id));
    for(let i=0;i<targets.length;i++){
      const t=targets[i];
      if(done.has(t.id)&&variants.some(v=>v.variant_id===t.id)){
        await setJob(job_id,{progress:62+Math.round((i+1)/targets.length*30),resumed_variant:t.id});
        continue;
      }
      if(budgetSpent()){
        await setJob(job_id,{status:'CONTINUE',progress:62+Math.round(i/targets.length*30),stage:'RENDER',completed_variants:[...done],note:'Time budget spent after '+done.size+' of '+targets.length+' variants.'});
        console.log('[LUXX_HANDOFF] budget spent before '+t.id+'; handing off with '+done.size+' of '+targets.length+' complete');
        return {job:await setJob(job_id,{}),asset,continued:true};
      }
      const v=await variantRecord(asset,tmp,input,t.id,t.label,t.start,t.duration,ffmpeg,{copyMaster:t.id==='FULL-MASTER'});
      const kept=variants.filter(x=>x.variant_id!==t.id); kept.push(v); variants.length=0; variants.push(...kept);
      asset.variants=[...(asset.variants||[]).filter(x=>!managed.has(x.variant_id)),...variants];
      await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
      done.add(t.id);
      await setJob(job_id,{progress:62+Math.round((i+1)/targets.length*30),completed_variants:[...done]});
    }
    const main=variants.find(v=>v.variant_id==='FULL-MASTER')||variants.find(v=>v.variant_id==='MAIN-CUT')||variants[0];
    asset.variants=[...(asset.variants||[]).filter(v=>!managed.has(v.variant_id)),...variants];
    asset.status='READY_FOR_REVIEW';
    asset.processing_completed_at=new Date().toISOString();
    asset.privacy={...(asset.privacy||{}),status:'SAFE_EXPORTS_READY',safe_export_variant_id:main.variant_id,metadata_stripping_verified:variants.every(v=>v.privacy_safe_export===true&&v.privacy_verification?.metadata_stripped_verified===true),updated_at:new Date().toISOString()};
    await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
    await setJob(job_id,{status:'COMPLETE',progress:100,completed_at:new Date().toISOString(),variant_ids:variants.map(v=>v.variant_id)});
    return {asset,job:await jobs.get('jobs/'+job_id+'.json',{type:'json'})};
  }catch(e){
    asset.status='PROCESSING_FAILED';
    asset.processing_error=String(e?.message||e);
    asset.privacy={...(asset.privacy||{}),status:asset.privacy?.status||'PROCESSING_FAILED',error:String(e?.message||e),updated_at:new Date().toISOString()};
    await assets.setJSON('assets/'+asset.asset_id+'.json',asset);
    await setJob(job_id,{status:'FAILED',error:String(e?.stack||e),progress:0});
    throw e;
  }finally{
    await fs.rm(tmp,{recursive:true,force:true});
  }
}
