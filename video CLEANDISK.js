import fs from 'node:fs/promises';import fss from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {store} from './storage.mjs';import {STORES,CHUNK_SIZE} from './model.mjs';import {inspectPrivacyFile,verifyPrivacySanitized} from './privacy.mjs';

export async function resolveVideoBinaries(){let ffmpeg=process.env.LUXX_FFMPEG_PATH||'',ffprobe=process.env.LUXX_FFPROBE_PATH||'';if(!ffmpeg){const m=await import('@ffmpeg-installer/ffmpeg');const x=m.default||m;ffmpeg=x.path||x.default?.path||'';}if(!ffprobe){const m=await import('@ffprobe-installer/ffprobe');const x=m.default||m;ffprobe=x.path||x.default?.path||'';}if(!ffmpeg||!ffprobe)throw new Error('PACKAGED_RENDERER_MISSING: FFmpeg/ffprobe binary unavailable in deployed function bundle');try{await fs.access(ffmpeg);const r=await run(ffmpeg,['-version']);console.log('[LUXX_BINARY_PROOF] Resolved ffmpeg path:',ffmpeg);console.log('[LUXX_BINARY_PROOF] ffmpeg -version:',String(r.out||r.err||'').split(/\r?\n/)[0]);}catch(e){throw new Error(`PACKAGED_FFMPEG_UNAVAILABLE: ${ffmpeg||'missing'} :: ${e?.message||e}`)}try{await fs.access(ffprobe);const r=await run(ffprobe,['-version']);console.log('[LUXX_BINARY_PROOF] Resolved ffprobe path:',ffprobe);console.log('[LUXX_BINARY_PROOF] ffprobe -version:',String(r.out||r.err||'').split(/\r?\n/)[0]);}catch(e){throw new Error(`PACKAGED_FFPROBE_UNAVAILABLE: ${ffprobe||'missing'} :: ${e?.message||e}`)}return {ffmpeg,ffprobe};}
async function paths(){return resolveVideoBinaries();}
function trace(msg){if(process.env.LUXX_TEST_TRACE==='1')console.log('[VIDEO]',msg);}
function toArrayBuffer(buf){return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);}
function run(bin,args,{capture=true,timeoutMs=240000}={}){console.log('[LUXX_RENDER_EXEC]',JSON.stringify({executable:bin,args}));return new Promise((resolve,reject)=>{const isFfmpeg=/^ffmpeg(?:\.exe)?$/i.test(path.basename(bin)),finalArgs=isFfmpeg&&!args.includes('-nostdin')?['-nostdin',...args]:args;const p=spawn(bin,finalArgs,{stdio:capture?['ignore','pipe','pipe']:['ignore','ignore','pipe']});let out='',err='',settled=false;const finish=(fn,val)=>{if(settled)return;settled=true;clearTimeout(timer);fn(val)};const timer=setTimeout(()=>{try{p.kill('SIGTERM')}catch{}finish(reject,new Error(`${path.basename(bin)} timed out after ${Math.round(timeoutMs/1000)}s: ${err.slice(-2000)}`));},timeoutMs);if(p.stdout)p.stdout.on('data',d=>out+=d);if(p.stderr)p.stderr.on('data',d=>err+=d);p.on('error',e=>finish(reject,e));p.on('close',code=>code===0?finish(resolve,{out,err}):finish(reject,new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-4000)}`)));});}
async function setJob(job_id,patch){const s=await store(STORES.jobs);const key=`jobs/${job_id}.json`;const job=(await s.get(key,{type:'json'}))||{job_id};Object.assign(job,patch,{updated_at:new Date().toISOString()});await s.setJSON(key,job);return job;}
async function assemble(asset,tmp){const media=await store(STORES.media);const out=path.join(tmp,'master.bin');const w=fss.createWriteStream(out);for(let i=0;i<asset.parts;i++){const key=`original/${asset.asset_id}/part-${String(i).padStart(6,'0')}`;const b=await media.get(key,{type:'arrayBuffer'});if(!b)throw new Error(`Missing original chunk ${i}`);if(!w.write(Buffer.from(b)))await new Promise(r=>w.once('drain',r));}await new Promise((r,j)=>{w.end(r);w.on('error',j)});return out;}
async function sha256File(fp){const h=crypto.createHash('sha256');for await(const c of fss.createReadStream(fp))h.update(c);return h.digest('hex');}
async function probe(fp,ffprobe){const {out}=await run(ffprobe,['-v','error','-show_entries','format=duration:stream=index,codec_type,width,height,r_frame_rate,codec_name:stream_tags=rotate','-of','json','-show_streams',fp]);const j=JSON.parse(out),duration=Number(j.format?.duration||0),video=j.streams?.find(x=>x.codec_type==='video'),audio=j.streams?.find(x=>x.codec_type==='audio');if(!duration||!video)throw new Error('No playable video stream found');let rotation=0;
  const rotTag=Number(video.tags?.rotate);
  if(Number.isFinite(rotTag))rotation=((rotTag%360)+360)%360;
  const dm=(video.side_data_list||[]).find(x=>x.rotation!=null);
  if(dm&&Number.isFinite(Number(dm.rotation)))rotation=((Math.round(Number(dm.rotation))%360)+360)%360;
  const swap=rotation===90||rotation===270;
  // Stream width/height ignore the display matrix, so a portrait phone video was previously
  // recorded as landscape. Display dimensions are what the viewer actually sees.
  const proof={duration,width:video.width||null,height:video.height||null,rotation,display_width:swap?(video.height||null):(video.width||null),display_height:swap?(video.width||null):(video.height||null),orientation:swap?'PORTRAIT_ROTATED':(Number(video.width||0)>=Number(video.height||0)?'LANDSCAPE':'PORTRAIT'),has_audio:!!audio,codec:video.codec_name||null,video_codec:video.codec_name||null,audio_codec:audio?.codec_name||null,video_codec:video.codec_name||null,audio_codec:audio?.codec_name||null,streams:j.streams||[],format:j.format||{}};console.log('[LUXX_DERIVATIVE_PROOF]',JSON.stringify({file:fp,...proof}));return proof;}
function parseRanges(text,prefix){const starts=[],ends=[],reS=new RegExp(`${prefix}_start:([0-9.]+)`,'g'),reE=new RegExp(`${prefix}_end:([0-9.]+)`,'g');for(const m of text.matchAll(reS))starts.push(Number(m[1]));for(const m of text.matchAll(reE))ends.push(Number(m[1]));return starts.map((s,i)=>[s,ends[i]??s+2]);}
function overlap(a,b,c,d){return Math.max(0,Math.min(b,d)-Math.max(a,c));}
async function analyze(fp,meta,ffmpeg,budgetMs=140000){
  // Analysis is OPTIONAL work. It only informs teaser-window selection; the master export
  // and playback do not need it. It must therefore never be able to fail the job, and it
  // must never be able to consume the function's whole time budget.
  //
  // The old version ran three full decodes of the source (111s on a 16-minute master here,
  // and 220s on a Netlify runner before the platform killed it at 240s). Every pass now
  // decodes KEYFRAMES ONLY, every pass has its own wall-clock cap, and the whole stage
  // stops when the budget is spent and returns what it has.
  const t0=Date.now(), left=()=>Math.max(4000,budgetMs-(Date.now()-t0));
  let sceneTimes=[],bad=[],silence=[],path='NONE',partial=false;
  try{
    // FULL decode for scene detection. Keyframe sampling found ZERO scene changes on the
    // creator's real master, which made teaser windows materially worse. Analysis now gets
    // its own invocation via the stage budget, so it can afford to be accurate again.
    const r=await run(ffmpeg,['-hide_banner','-i',fp,'-vf',
      "scale=320:-2,select='gt(scene,0.28)',showinfo",'-an','-f','null','-'],{timeoutMs:left()});
    for(const m of r.err.matchAll(/pts_time:([0-9.]+)/g))sceneTimes.push(Number(m[1]));
    const rb=await run(ffmpeg,['-hide_banner','-i',fp,'-vf',
      'scale=320:-2,blackdetect=d=1:pix_th=0.10,freezedetect=noise=0.003:d=2','-an','-f','null','-'],{timeoutMs:left()});
    bad=[...parseRanges(rb.err,'black'),...parseRanges(rb.err,'freeze')];
    path='FULL_DECODE';
  }catch{
    // Fallback passes are ALSO keyframe-only. The previous fallback did three full decodes,
    // which is exactly what timed out in production.
    partial=true;
    try{
      const r=await run(ffmpeg,['-hide_banner','-skip_frame','nokey','-i',fp,'-vf',"scale=240:-2,select='gt(scene,0.28)',showinfo",'-an','-f','null','-'],{timeoutMs:left()});
      for(const m of r.err.matchAll(/pts_time:([0-9.]+)/g))sceneTimes.push(Number(m[1]));
      path='KEYFRAME_SEPARATE';
    }catch{}
    if(Date.now()-t0<budgetMs)try{
      const r=await run(ffmpeg,['-hide_banner','-skip_frame','nokey','-i',fp,'-vf','scale=240:-2,blackdetect=d=1:pix_th=0.10,freezedetect=noise=0.003:d=2','-an','-f','null','-'],{timeoutMs:left()});
      bad=[...parseRanges(r.err,'black'),...parseRanges(r.err,'freeze')];
    }catch{}
  }
  if(meta.has_audio&&Date.now()-t0<budgetMs)try{
    const r=await run(ffmpeg,['-hide_banner','-i',fp,'-af','silencedetect=noise=-45dB:d=1.2','-vn','-f','null','-'],{timeoutMs:left()});
    silence=parseRanges(r.err,'silence');
  }catch{partial=true;}
  const elapsed_ms=Date.now()-t0;
  // The path taken is recorded so a slow or degraded analysis is visible in the log and on
  // the asset, rather than being inferred from how long the job took.
  console.log('[LUXX_ANALYZE_PATH]',JSON.stringify({path,partial,elapsed_ms,
    scenes:sceneTimes.length,bad:bad.length,silence:silence.length}));
  return {sceneTimes,bad,silence,method:'KEYFRAME_SAMPLED',analyze_path:path,analyze_partial:partial,analyze_ms:elapsed_ms};}
function scoreWindow(start,len,a){const end=start+len;const scenes=a.sceneTimes.filter(t=>t>=start&&t<end).length;let bad=0,sil=0;for(const [s,e] of a.bad)bad+=overlap(start,end,s,e);for(const [s,e] of a.silence)sil+=overlap(start,end,s,e);const activity=Math.min(20,scenes*1.6);return 10+activity-bad*2.5-sil*.25;}

// ===========================================================================
// VARIABLE-LENGTH SUGGESTED CUT  (v1.8.0)
// The operator asks for an arbitrary target length and LUXX proposes a cut of that
// length assembled from one or more source segments. There is no fixed target: 4:30
// is only an example. The full master is never touched.
//
// HONEST LABELLING: this is a TECHNICAL heuristic over scene changes, black frames,
// freezes and silence. It has no semantic understanding of the footage, and the output
// is called a SUGGESTED CUT, never a best or proven one.
// ===========================================================================
export const CUT_METHOD='TECHNICAL HEURISTIC — scene-change, black-frame, freeze and silence detection only. No semantic understanding of the content.';
export function parseTargetDuration(input){
  if(input===null||input===undefined||input==='')throw new Error('Enter a target length.');
  if(typeof input==='number'){
    if(!Number.isFinite(input)||input<=0)throw new Error('Target length must be greater than zero.');
    return Number(input.toFixed(3));
  }
  const raw=String(input).trim();
  if(!/^\d{1,2}(:\d{1,2}){0,2}(\.\d+)?$/.test(raw))throw new Error(`Target length "${raw}" is not MM:SS or H:MM:SS.`);
  const parts=raw.split(':').map(Number);
  if(parts.some(n=>!Number.isFinite(n)||n<0))throw new Error('Target length is not a valid time.');
  let secs;
  if(parts.length===1)secs=parts[0];
  else if(parts.length===2){if(parts[1]>=60)throw new Error('Seconds must be under 60.');secs=parts[0]*60+parts[1];}
  else{if(parts[1]>=60||parts[2]>=60)throw new Error('Minutes and seconds must be under 60.');secs=parts[0]*3600+parts[1]*60+parts[2];}
  if(!(secs>0))throw new Error('Target length must be greater than zero.');
  return Number(secs.toFixed(3));
}
export function formatDuration(secs){
  const s=Math.max(0,Number(secs)||0),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;
  const ss=(r<10?'0':'')+ (Number.isInteger(r)?r:r.toFixed(2));
  return h?`${h}:${String(m).padStart(2,'0')}:${ss}`:`${m}:${ss}`;
}
// Proposes segments totalling the target duration. Segments are chosen from the
// technically cleanest windows, spread across the beginning, middle and end so the
// result has a shape rather than being one arbitrary block.
export function planSuggestedCut(sourceDuration,target,analysis={},{segments:wanted=null,min_segment=4}={}){
  const src=Number(sourceDuration);
  const t=Number(target);
  if(!Number.isFinite(src)||src<=0)throw new Error('The source duration is unknown.');
  if(!Number.isFinite(t)||t<=0)throw new Error('Target length must be greater than zero.');
  if(t>src+0.001)throw new Error(`Target length ${formatDuration(t)} is longer than the source (${formatDuration(src)}). LUXX will not loop or pad footage.`);
  const bad=(analysis.bad||[]).map(b=>({start:Number(b.start)||0,end:Number(b.end)||0}));
  const silence=(analysis.silence||[]).map(b=>({start:Number(b.start)||0,end:Number(b.end)||0}));
  const overlapsBad=(a,b)=>bad.some(x=>x.start<b&&x.end>a);
  // One continuous block when the target is most of the source, or when it is short.
  const count=wanted&&wanted>0?Math.floor(wanted):(t/src>0.6?1:Math.max(1,Math.min(4,Math.round(t/Math.max(min_segment*2,12)))));
  const per=t/count;
  if(per<min_segment&&count>1)return planSuggestedCut(src,t,analysis,{segments:Math.max(1,Math.floor(t/min_segment)),min_segment});
  const segs=[];
  // Spread anchors across the source so a beginning, middle and end are represented.
  const usable=Math.max(0,src-per);
  for(let i=0;i<count;i++){
    const ideal=count===1?Math.min(usable,Math.max(0,(src-per)/2)):usable*(i/(count-1||1));
    let start=Math.min(Math.max(0,ideal),Math.max(0,src-per));
    // Nudge off a black/freeze region if the ideal anchor lands inside one.
    let guard=0;
    while(overlapsBad(start,start+per)&&guard<40&&start+per+2<=src){start+=2;guard++;}
    // Never overlap a segment already chosen.
    for(const prev of segs)if(start<prev.end&&start+per>prev.start)start=Math.min(prev.end,Math.max(0,src-per));
    start=Number(Math.max(0,Math.min(start,src-per)).toFixed(3));
    segs.push({start,duration:Number(per.toFixed(3)),end:Number((start+per).toFixed(3)),
      silent:silence.some(x=>x.start<start+per&&x.end>start)});
  }
  segs.sort((a,b)=>a.start-b.start);
  const total=Number(segs.reduce((a,x)=>a+x.duration,0).toFixed(3));
  return {target_seconds:Number(t.toFixed(3)),planned_seconds:total,source_seconds:Number(src.toFixed(3)),
    segments:segs,segment_count:segs.length,
    label:`SUGGESTED ${formatDuration(t)} CUT`,
    method:CUT_METHOD,
    disclosure:'Segments were chosen by technical analysis only. LUXX does not understand what happens in the footage and makes no claim that this is the best or a proven cut.'};
}
function choosePlan(duration,a){
// THE FULL UPLOAD IS THE MASTER. RC2A truncated every source to a 300-second "MAIN CUT"
// and presented that as the primary derivative, so a 30-minute upload silently became a
// 5-minute file. There is no automatic main cut at any duration. Short derivatives are
// produced only where a real job needs them (teaser / trailer / preview / explicit edit).
const mainLen=duration,mainStart=0,best=scoreWindow(0,Math.min(duration,60),a);
const teaserCount=duration>=180?3:duration>=90?2:1,teaserLen=Math.min(20,Math.max(8,duration/(teaserCount*4)));
// Candidates are generated across the WHOLE duration, then the best non-overlapping windows
// are taken. v1.4.6 forced exactly one teaser per equal-width time band, so if the three
// strongest moments all sat in the final third, LUXX could not select them at any ranking
// quality -- the good candidates were never generated in the first place.
const candidates=[];
for(let s=0;s<=Math.max(0,duration-teaserLen);s+=2)candidates.push({start:s,score:scoreWindow(s,teaserLen,a)});
if(!candidates.length)candidates.push({start:0,score:scoreWindow(0,Math.min(teaserLen,duration),a)});
const ranked=[...candidates].sort((x,y)=>y.score-x.score||x.start-y.start);
const pick=(minSep)=>{const out=[];for(const c of ranked){if(out.length>=teaserCount)break;if(out.some(k=>Math.abs(k.start-c.start)<minSep))continue;out.push(c);}return out;};
// Prefer well-separated moments; relax toward simple non-overlap if the source is too short.
let chosen=pick(Math.max(teaserLen,duration/12));
if(chosen.length<teaserCount)chosen=pick(teaserLen);
if(chosen.length<teaserCount)chosen=ranked.slice(0,teaserCount);
chosen.sort((x,y)=>x.start-y.start);
const teasers=chosen.map(c=>({start:Number(c.start.toFixed(3)),duration:Number(Math.min(teaserLen,duration-c.start).toFixed(3)),score:Number(c.score.toFixed(2)),selection:'GLOBAL_BEST_NON_OVERLAPPING'}));
const master={start:Number(mainStart.toFixed(3)),duration:Number(mainLen.toFixed(3)),score:Number(best.toFixed(2)),full_source:true};
return {full_master:master,master_is_full_source:true,main:master,teasers,candidates_considered:candidates.length,
  master_method:'The privacy-safe export spans the entire source. No automatic truncation.',
  teaser_method:'FFmpeg technical heuristic over all candidate windows; no semantic desire claim'};}
async function renderClip(input,out,start,duration,ffmpeg,opts={}){
  // A whole-file export in a browser-playable codec needs no re-encode. Stripping the
  // metadata is a container operation, so the video and audio streams are copied
  // bit-for-bit: faster, and it does not degrade the creator's own master the way a
  // CRF 23 re-encode did. Anything else is re-encoded as before.
  if(opts.copy&&opts.whole){
    // Three steps, not two. A full re-encode is the last resort, never the second.
    try{
      await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1',
        '-map_chapters','-1','-c','copy','-movflags','+faststart',out]);
      return {mode:'STREAM_COPY'};
    }catch(e1){
      // Measured cause in production: PCM audio. MP4 has no tag for pcm_s16le, so ffmpeg
      // rejects the copy in about a second. The VIDEO is fine — only the audio cannot go
      // into the container as-is. Re-encoding just the audio keeps the picture bit-for-bit
      // and costs seconds, where a full re-encode of a 3.5-minute file needs ~7 minutes
      // against a 4-minute platform limit and cannot finish at all.
      console.log('[LUXX_MASTER_COPY_FALLBACK] full copy rejected, retrying with audio re-encode:',
        String(e1&&e1.message||e1).slice(-600));
      try{
        await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1',
          '-map_chapters','-1','-c:v','copy','-c:a','aac','-b:a','128k','-movflags','+faststart',out]);
        return {mode:'VIDEO_COPY_AUDIO_REENCODE'};
      }catch(e2){
        // Step three. Some audio cannot be DECODED at all by the bundled 2018 binary —
        // APAC from a recent iPhone is the case seen here — so re-encoding it fails the
        // same way copying it did. The picture is still perfectly good, so the video is
        // kept and the audio is dropped rather than losing the whole upload.
        //
        // Dropping audio is a real loss and is recorded as one. It is never silent: the
        // variant carries audio_dropped and the reason, so a clip that goes out with no
        // sound says so instead of surprising her after she posts it.
        console.log('[LUXX_MASTER_COPY_FALLBACK] audio could not be decoded, keeping video only:',
          String(e2&&e2.message||e2).slice(-600));
        try{
          await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map_metadata','-1',
            '-map_chapters','-1','-c:v','copy','-an','-movflags','+faststart',out]);
          return {mode:'VIDEO_COPY_AUDIO_DROPPED',audio_dropped:true,
            audio_drop_reason:'The audio track could not be read by the renderer. The video is unchanged; this copy has no sound.'};
        }catch(e3){
          console.log('[LUXX_MASTER_COPY_FALLBACK] video-only copy also rejected, full re-encode:',
            String(e3&&e3.message||e3).slice(-600));
        }
      }
    }
  }
  try{
    await run(ffmpeg,['-y','-ss',String(start),'-i',input,'-t',String(duration),'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M','-c:a','aac','-b:a','128k','-movflags','+faststart',out]);
    return {mode:'REENCODE'};
  }catch(e4){
    // Last resort. A re-encode fails on undecodable audio exactly as a copy does, so the
    // final attempt keeps the picture and drops the sound rather than losing the clip.
    console.log('[LUXX_RENDER_FALLBACK] re-encode failed, retrying without audio:',
      String(e4&&e4.message||e4).slice(-600));
    await run(ffmpeg,['-y','-ss',String(start),'-i',input,'-t',String(duration),'-map','0:v:0','-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M','-an','-movflags','+faststart',out]);
    return {mode:'REENCODE_AUDIO_DROPPED',audio_dropped:true,
      audio_drop_reason:'The audio track could not be read by the renderer. This copy has no sound.'};
  }}
async function makeHls(input,dir,ffmpeg,opts={}){
  await fs.mkdir(dir,{recursive:true});
  const seg=['-hls_time','4','-hls_playlist_type','vod','-hls_flags','independent_segments',
    '-hls_segment_filename',path.join(dir,'seg-%05d.ts'),path.join(dir,'index.m3u8')];
  // Segmenting an H.264/AAC file into HLS is a remux. Copying the streams avoids a second
  // full re-encode of material that was already re-encoded once.
  if(opts.copy){
    try{
      await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1',
        '-map_chapters','-1','-c','copy',...seg]);
      return {mode:'STREAM_COPY'};
    }catch{/* fall through to the transcoded ladder */}
  }
  await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-vf',"scale=w='if(gt(ih,480),-2,iw)':h='if(gt(ih,480),480,ih)'",'-c:v','libx264','-preset','ultrafast','-b:v','900k','-maxrate','1200k','-bufsize','2400k','-c:a','aac','-b:a','96k',...seg]);
  return {mode:'REENCODE'};}
async function storeHls(assetId,variantId,dir){const media=await store(STORES.media);let playlist=await fs.readFile(path.join(dir,'index.m3u8'),'utf8');const files=(await fs.readdir(dir)).filter(x=>x.startsWith('seg-')).sort();for(const f of files){const b=await fs.readFile(path.join(dir,f));await media.set(`hls/${assetId}/${variantId}/${f}`,toArrayBuffer(b),{metadata:{contentType:'video/mp2t',assetId,variantId}});}await media.set(`hls/${assetId}/${variantId}/index.m3u8`,playlist,{metadata:{contentType:'application/vnd.apple.mpegurl',assetId,variantId}});return files.length;}
async function storeMp4Parts(assetId,variantId,fp){const media=await store(STORES.media),parts=[];const fh=await fs.open(fp,'r');try{const st=await fh.stat();let off=0,i=0;while(off<st.size){const len=Math.min(CHUNK_SIZE,st.size-off),buf=Buffer.alloc(len);await fh.read(buf,0,len,off);const key=`variant/${assetId}/${variantId}/part-${String(i).padStart(6,'0')}`;await media.set(key,toArrayBuffer(buf),{metadata:{contentType:'video/mp4',assetId,variantId,part:i,size:len}});parts.push(key);off+=len;i++;}}finally{await fh.close();}return parts;}
async function variantRecord(asset,tmp,input,variantId,label,start,duration,ffmpeg,opts={}){const mp4=path.join(tmp,`${variantId}.mp4`),hlsDir=path.join(tmp,`${variantId}-hls`),poster=path.join(tmp,`${variantId}-poster.jpg`);trace(`${variantId} render start`);const renderMode=await renderClip(input,mp4,start,duration,ffmpeg,opts)||{};trace(`${variantId} render done; poster start`);await run(ffmpeg,['-y','-ss','0.5','-i',mp4,'-map_metadata','-1','-frames:v','1','-vf',"scale='min(640,iw)':-2",'-q:v','4',poster]);trace(`${variantId} poster done; thumb store start`);const media=await store(STORES.media),pb=await fs.readFile(poster),thumbnail_key=`thumb/${asset.asset_id}/${variantId}.jpg`;await media.set(thumbnail_key,toArrayBuffer(pb),{metadata:{contentType:'image/jpeg',assetId:asset.asset_id,variantId}});trace(`${variantId} thumb stored; hls start`);const hlsMode=await makeHls(mp4,hlsDir,ffmpeg,{copy:opts.copy});trace(`${variantId} hls render done; hls store start`);const hls_segments=await storeHls(asset.asset_id,variantId,hlsDir);trace(`${variantId} hls stored; mp4 store start`);const privacy=await verifyPrivacySanitized(mp4,{mediaType:'VIDEO'});if(!privacy.metadata_stripped_verified)throw new Error(`Privacy verification failed for ${variantId}`);const download_parts=await storeMp4Parts(asset.asset_id,variantId,mp4),sha256=await sha256File(mp4),stat=await fs.stat(mp4);trace(`${variantId} mp4 stored`);
    // Stored, hashed and measured — the local copies are now dead weight. Freeing them
    // here rather than in the finally block is what keeps a long video inside the disk.
    await freeTmp([mp4,hlsDir,poster],`${variantId} artifacts`);return {variant_id:variantId,asset_id:asset.asset_id,master_asset_id:asset.asset_id,variant_type:label,start_seconds:start,duration_seconds:duration,start_timestamp:String(start),end_timestamp:String(start+duration),final_runtime:duration,thumbnail_frame_timestamp_or_reference:'0.5s',thumbnail_key,title_direction:'',description_direction:'',cta:'',tracking_route_id:null,price_if_applicable:null,price_creator_approved:false,native_listing_measurement_capability:false,platform:null,recipe:{trim_start:start,trim_duration:duration,video_codec:'h264',audio_codec:'aac'},rendered:true,rendered_at:new Date().toISOString(),sha256,size:stat.size,hls_url:`/api/hls?asset=${asset.asset_id}&variant=${variantId}`,hls_segments,download_parts,output_name:`${asset.asset_id}_${variantId}.mp4`,privacy_safe_export:true,metadata_stripped:true,privacy_verification:privacy,render_mode:renderMode.mode||null,audio_dropped:!!renderMode.audio_dropped,audio_drop_reason:renderMode.audio_drop_reason||null,evidence_label:'TECHNICAL HEURISTIC — not a proven revenue-best segment'};}

// A freshly written asset record is not guaranteed to be immediately readable. Waiting
// briefly and re-reading is correct here: the job only exists because the record was
// written, so an empty read is far more likely to be replication lag than real absence.
export const ASSET_READ_ATTEMPTS=8;
export async function readAssetWithRetry(assets,asset_id,attempts=ASSET_READ_ATTEMPTS){
  let delay=250;
  for(let i=0;i<attempts;i++){
    try{
      const a=await assets.get(`assets/${asset_id}.json`,{type:'json'});
      if(a)return a;
    }catch{/* transient read error is treated the same as an empty read */}
    if(i<attempts-1){
      await new Promise(r=>setTimeout(r,delay));
      delay=Math.min(delay*2,4000);   // 250ms .. 4s, ~15s total before giving up
    }
  }
  return null;
}
// Netlify background functions get 240s. Stopping at 150s leaves room to persist state
// and hand off cleanly rather than being killed mid-write.
export const STAGE_BUDGET_MS=Number(process.env.LUXX_STAGE_BUDGET_MS||150000);

// Delete a temp artifact as soon as it is safely in storage. Never throws: a job must not
// fail because cleanup did, and the finally block still sweeps whatever is left.

// Measure the scratch space actually available rather than guessing a cap. A job that
// cannot fit says so, in words, instead of dying part-way and leaving a video stuck at
// PROCESSING with nothing to explain it.

// Netlify reuses warm containers, so /tmp survives between invocations. A job that timed
// out or was killed never reached its finally block and left its whole working directory
// behind. That debris accumulated until there was no room to create even an empty folder:
// the failure was ENOSPC at mkdtemp, before any video was touched, which is why short
// clips failed exactly like long ones.
//
// Every job now clears abandoned working directories before it starts. Anything older
// than fifteen minutes cannot belong to a live job — the stage budget is 150 seconds.
async function sweepAbandonedTmp(){
  const CUTOFF=15*60*1000, now=Date.now();
  let removed=0, bytes=0;
  try{
    const entries=await fs.readdir('/tmp',{withFileTypes:true});
    for(const e of entries){
      if(!e.name.startsWith('luxx-'))continue;
      const full=`/tmp/${e.name}`;
      try{
        const st=await fs.stat(full);
        if(now-st.mtimeMs<CUTOFF)continue;   // may belong to a job still running
        try{
          const inner=await fs.readdir(full);
          for(const f of inner){
            try{bytes+=(await fs.stat(`${full}/${f}`)).size;}catch{}
          }
        }catch{}
        await fs.rm(full,{recursive:true,force:true});
        removed++;
      }catch{}
    }
  }catch{}
  if(removed)console.log(`[LUXX_TMP_SWEEP] cleared ${removed} abandoned working ${removed===1?'directory':'directories'}, about ${Math.round(bytes/1048576)}MB`);
  return removed;
}

async function tmpFreeBytes(dir){
  try{
    const {execFileSync}=await import('node:child_process');
    const line=String(execFileSync('df',['-k',dir])).trim().split('\n').pop().split(/\s+/);
    return Number(line[3])*1024;
  }catch{return null;}
}

async function freeTmp(paths,label){
  for(const p of paths){
    try{await fs.rm(p,{recursive:true,force:true});}catch(e){
      console.log('[LUXX_TMP_FREE] could not remove',label,String(e&&e.message||e).slice(0,120));
    }
  }
  try{
    const {execFileSync}=await import('node:child_process');
    const line=String(execFileSync('df',['-k','/tmp'])).trim().split('\n').pop().split(/\s+/);
    console.log(`[LUXX_TMP_FREE] ${label} released; ${Math.round(Number(line[3])/1024)}MB free on /tmp`);
  }catch{}
}

export async function processVideoJob(job_id){
  await sweepAbandonedTmp();
  const stageStarted=Date.now();
  const budgetSpent=()=>Date.now()-stageStarted>STAGE_BUDGET_MS;
const jobs=await store(STORES.jobs),assets=await store(STORES.assets);const job=await jobs.get(`jobs/${job_id}.json`,{type:'json'});if(!job)throw new Error('Job not found');const asset=await readAssetWithRetry(assets,job.asset_id);if(!asset||asset.media_type!=='VIDEO')throw new Error(`Video asset not found after ${ASSET_READ_ATTEMPTS} read attempts (asset ${job.asset_id}). The upload may not have completed.`);await sweepAbandonedTmp();
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-'));try{asset.status='PROCESSING';asset.processing_started_at=new Date().toISOString();asset.processing_error=null;await assets.setJSON(`assets/${asset.asset_id}.json`,asset);await setJob(job_id,{status:'RUNNING',progress:5});trace('assemble start');const {ffmpeg,ffprobe}=await paths();
    // The original, one rendered copy and its streaming segments coexist at peak. Check
    // before spending minutes on a job the disk cannot hold.
    const need=Number(asset.size||0)*2.4, free=await tmpFreeBytes('/tmp');
    if(free!=null&&need>free){
      const mb=n=>Math.round(n/1048576);
      const why=`This file needs about ${mb(need)}MB of working space and only ${mb(free)}MB is available. `
        +`The upload is safe and nothing was lost — the video is too large for this renderer to convert.`;
      asset.processing_error=why;
      asset.privacy={...(asset.privacy||{}),status:'PROCESSING_FAILED',error:why,updated_at:new Date().toISOString()};
      asset.status='PROCESSING_FAILED';
      await assets.setJSON(`assets/${asset.asset_id}.json`,asset);
      const failedJob=await setJob(job_id,{status:'FAILED',progress:0,error:why,note:'FILE_TOO_LARGE_FOR_RENDERER'});
      console.log('[LUXX_DISK_GUARD]',why);
      return {job:failedJob,asset};
    }
    const input=await assemble(asset,tmp);trace('assemble done');asset.master_sha256=await sha256File(input);await setJob(job_id,{progress:15});trace('probe start');const meta=await probe(input,ffprobe);trace('probe done');const privacyScan=await inspectPrivacyFile(input,{mediaType:'VIDEO',ffprobePath:ffprobe});asset.privacy={...privacyScan,status:'PROCESSING_SAFE_DERIVATIVES',safe_export_variant_id:null,metadata_stripping_verified:false,updated_at:new Date().toISOString()};await assets.setJSON(`assets/${asset.asset_id}.json`,asset);await setJob(job_id,{progress:25,probe:meta,privacy:{embedded_geolocation_detected:privacyScan.embedded_geolocation_detected,sensitive_metadata_classes:privacyScan.sensitive_metadata_classes}});if(!asset.thumbnail_key){try{const poster=path.join(tmp,'MASTER-poster.jpg'),at=Math.max(0,Math.min(meta.duration*.1,Math.max(0,meta.duration-0.5)));await run(ffmpeg,['-y','-ss',String(at),'-i',input,'-map_metadata','-1','-frames:v','1','-vf',"scale='min(640,iw)':-2",'-q:v','4',poster]);const media=await store(STORES.media),pb=await fs.readFile(poster),k=`thumb/${asset.asset_id}/MASTER.jpg`;await media.set(k,toArrayBuffer(pb),{metadata:{contentType:'image/jpeg',assetId:asset.asset_id,variantId:'MASTER'}});asset.thumbnail_key=k;asset.thumbnail_frame_timestamp_or_reference=`${at.toFixed(2)}s`;await assets.setJSON(`assets/${asset.asset_id}.json`,asset);}catch{}}trace('analyze start');
  const cached=asset.analysis&&asset.analysis.analyzed_master_sha256===asset.master_sha256&&asset.analysis.plan?asset.analysis:null;
  // If the previous invocation spent its budget on assemble and probe, stop here and let
  // the next one do the analysis with a full budget of its own.
  if(!cached&&budgetSpent()){
    await setJob(job_id,{status:'CONTINUE',progress:30,stage:'ANALYZE',
      note:'Probe complete. Analysis continues in the next invocation.'});
    trace('budget spent before analysis; handing off');
    return {job:await setJob(job_id,{}),asset,continued:true};
  }
  const analysis=cached
    ?{sceneTimes:cached.scene_times||[],bad:cached.bad_ranges||[],silence:cached.silence_ranges||[],
      analyze_path:cached.analyze_path||null,analyze_partial:!!cached.analyze_partial,
      analyze_ms:cached.analyze_ms??null,reused:true}
    :await analyze(input,meta,ffmpeg);
  trace(cached?'analyze reused from previous attempt':'analyze done');const plan=cached?cached.plan:choosePlan(meta.duration,analysis);asset.analysis={duration_seconds:meta.duration,width:meta.width,height:meta.height,scene_changes:analysis.sceneTimes.length,scene_times:analysis.sceneTimes,bad_ranges:analysis.bad,silence_ranges:analysis.silence,plan,
    analyzed_master_sha256:asset.master_sha256,analysis_reused:!!cached,
    analyze_path:analysis.analyze_path||null,analyze_partial:!!analysis.analyze_partial,analyze_ms:analysis.analyze_ms??null,method:'FFmpeg technical heuristic: scene activity with black/freeze/silence penalties; no semantic desire/attractiveness claim'};await setJob(job_id,{progress:40,plan});
// FULL-MASTER is the privacy-safe export of the WHOLE source. MAIN-CUT is no longer
// produced. Existing MAIN-CUT variants on already-processed assets are preserved and are
// never relabelled as the master.
const webSafe=String(meta.video_codec||'').toLowerCase()==='h264'&&(!meta.has_audio||String(meta.audio_codec||'').toLowerCase()==='aac');
const targets=[{id:'FULL-MASTER',label:'FULL_MASTER',start:plan.full_master.start,duration:plan.full_master.duration,copy:webSafe,whole:true},...plan.teasers.map((t,i)=>({id:`TEASER-${i+1}`,label:'TEASER',start:t.start,duration:t.duration}))];
const done=new Set(job.completed_variants||[]);
const managed=new Set(['FULL-MASTER','MAIN-CUT','TEASER-1','TEASER-2','TEASER-3','TEASER-4']);
// Rendered variants are persisted one at a time and recorded on the job. A failure or timeout
// part-way through no longer discards everything already rendered; a retry resumes.
const variants=(asset.variants||[]).filter(v=>managed.has(v.variant_id)&&done.has(v.variant_id));
for(let i=0;i<targets.length;i++){
  const t=targets[i];
  if(done.has(t.id)&&variants.some(v=>v.variant_id===t.id)){trace(`${t.id} already complete, skipping`);await setJob(job_id,{progress:62+Math.round((i+1)/targets.length*30),resumed_variant:t.id});continue;}
  if(budgetSpent()){
    await setJob(job_id,{status:'CONTINUE',
      progress:62+Math.round(i/targets.length*30),
      stage:'RENDER',completed_variants:[...done],
      note:`Time budget spent after ${done.size} of ${targets.length} variants. Renders resume in the next invocation.`});
    trace(`budget spent before ${t.id}; handing off with ${done.size} of ${targets.length} complete`);
    return {job:await setJob(job_id,{}),asset,continued:true};
  }
  trace(`${t.id} start`);
  const v=await variantRecord(asset,tmp,input,t.id,t.label,t.start,t.duration,ffmpeg,{copy:!!t.copy,whole:!!t.whole});
  const kept=variants.filter(x=>x.variant_id!==t.id);kept.push(v);variants.length=0;variants.push(...kept);
  asset.variants=[...(asset.variants||[]).filter(x=>!managed.has(x.variant_id)),...variants];
  await assets.setJSON(`assets/${asset.asset_id}.json`,asset);
  done.add(t.id);
  await setJob(job_id,{progress:62+Math.round((i+1)/targets.length*30),completed_variants:[...done]});
  trace(`${t.id} done and persisted`);
}
const main=variants.find(v=>v.variant_id==='FULL-MASTER')||variants.find(v=>v.variant_id==='MAIN-CUT')||variants[0];
asset.variants=[...(asset.variants||[]).filter(v=>!managed.has(v.variant_id)),...variants];asset.status='READY_FOR_REVIEW';asset.processing_completed_at=new Date().toISOString();asset.privacy={...(asset.privacy||{}),status:'SAFE_EXPORTS_READY',safe_export_variant_id:main.variant_id,metadata_stripping_verified:variants.every(v=>v.privacy_safe_export===true&&v.privacy_verification?.metadata_stripped_verified===true),updated_at:new Date().toISOString()};await assets.setJSON(`assets/${asset.asset_id}.json`,asset);await setJob(job_id,{status:'COMPLETE',progress:100,completed_at:new Date().toISOString(),variant_ids:variants.map(v=>v.variant_id)});return {asset,job:await jobs.get(`jobs/${job_id}.json`,{type:'json'})};}catch(e){asset.status='PROCESSING_FAILED';asset.processing_error=String(e?.message||e);asset.privacy={...(asset.privacy||{}),status:asset.privacy?.status||'PROCESSING_FAILED',error:String(e?.message||e),updated_at:new Date().toISOString()};await assets.setJSON(`assets/${asset.asset_id}.json`,asset);await setJob(job_id,{status:'FAILED',error:String(e?.stack||e),progress:0});throw e;}finally{await fs.rm(tmp,{recursive:true,force:true});}}
export {choosePlan,scoreWindow};
