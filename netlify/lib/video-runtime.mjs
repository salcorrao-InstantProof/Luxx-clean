import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {store} from './storage.mjs';
import {STORES,CHUNK_SIZE} from './model.mjs';

export const STAGE_BUDGET_MS = Number(process.env.LUXX_STAGE_BUDGET_MS || 150000);
export function trace(msg){if(process.env.LUXX_TEST_TRACE==='1')console.log('[VIDEO]',msg);}
export function toArrayBuffer(buf){return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);}
export async function resolveVideoBinaries(){
  let ffmpeg=process.env.LUXX_FFMPEG_PATH||'',ffprobe=process.env.LUXX_FFPROBE_PATH||'';
  if(!ffmpeg){const m=await import('@ffmpeg-installer/ffmpeg');const x=m.default||m;ffmpeg=x.path||x.default?.path||'';}
  if(!ffprobe){const m=await import('@ffprobe-installer/ffprobe');const x=m.default||m;ffprobe=x.path||x.default?.path||'';}
  if(!ffmpeg||!ffprobe)throw new Error('PACKAGED_RENDERER_MISSING: FFmpeg/ffprobe binary unavailable in deployed function bundle');
  await fs.access(ffmpeg); await fs.access(ffprobe);
  return {ffmpeg,ffprobe};
}
export async function paths(){return resolveVideoBinaries();}
export function run(bin,args,{capture=true,timeoutMs=240000}={}){
  console.log('[LUXX_RENDER_EXEC]',JSON.stringify({executable:bin,args}));
  return new Promise((resolve,reject)=>{
    const isFfmpeg=/^ffmpeg(?:\.exe)?$/i.test(path.basename(bin));
    const finalArgs=isFfmpeg&&!args.includes('-nostdin')?['-nostdin',...args]:args;
    const p=spawn(bin,finalArgs,{stdio:capture?['ignore','pipe','pipe']:['ignore','ignore','pipe']});
    let out='',err='',settled=false;
    const finish=(fn,val)=>{if(settled)return;settled=true;clearTimeout(timer);fn(val)};
    const timer=setTimeout(()=>{try{p.kill('SIGTERM')}catch{}finish(reject,new Error(path.basename(bin)+' timed out'));},timeoutMs);
    if(p.stdout)p.stdout.on('data',d=>out+=d);
    if(p.stderr)p.stderr.on('data',d=>err+=d);
    p.on('error',e=>finish(reject,e));
    p.on('close',code=>code===0?finish(resolve,{out,err}):finish(reject,new Error(path.basename(bin)+' exited '+code+': '+err.slice(-4000))));
  });
}
export async function setJob(job_id,patch){
  const s=await store(STORES.jobs);
  const key='jobs/'+job_id+'.json';
  const job=(await s.get(key,{type:'json'}))||{job_id};
  Object.assign(job,patch,{updated_at:new Date().toISOString()});
  await s.setJSON(key,job);
  return job;
}
export async function assemble(asset,tmp){
  const media=await store(STORES.media);
  const out=path.join(tmp,'master.bin');
  const w=fss.createWriteStream(out);
  for(let i=0;i<asset.parts;i++){
    const key='original/'+asset.asset_id+'/part-'+String(i).padStart(6,'0');
    const b=await media.get(key,{type:'arrayBuffer'});
    if(!b)throw new Error('Missing original chunk '+i);
    if(!w.write(Buffer.from(b)))await new Promise(r=>w.once('drain',r));
  }
  await new Promise((r,j)=>{w.end(r);w.on('error',j)});
  return out;
}
export async function sha256File(fp){
  const h=crypto.createHash('sha256');
  for await(const c of fss.createReadStream(fp))h.update(c);
  return h.digest('hex');
}
export async function probe(fp,ffprobe){
  const {out}=await run(ffprobe,['-v','error','-show_entries','format=duration:stream=index,codec_type,width,height,r_frame_rate,codec_name:stream_tags=rotate','-of','json','-show_streams',fp]);
  const j=JSON.parse(out),duration=Number(j.format?.duration||0),video=j.streams?.find(x=>x.codec_type==='video'),audio=j.streams?.find(x=>x.codec_type==='audio');
  if(!duration||!video)throw new Error('No playable video stream found');
  let rotation=0;
  const rotTag=Number(video.tags?.rotate);
  if(Number.isFinite(rotTag))rotation=((rotTag%360)+360)%360;
  const dm=(video.side_data_list||[]).find(x=>x.rotation!=null);
  if(dm&&Number.isFinite(Number(dm.rotation)))rotation=((Math.round(Number(dm.rotation))%360)+360)%360;
  const swap=rotation===90||rotation===270;
  return {duration,width:video.width||null,height:video.height||null,rotation,display_width:swap?(video.height||null):(video.width||null),display_height:swap?(video.width||null):(video.height||null),orientation:swap?'PORTRAIT_ROTATED':(Number(video.width||0)>=Number(video.height||0)?'LANDSCAPE':'PORTRAIT'),has_audio:!!audio,codec:video.codec_name||null};
}
function parseRanges(text,prefix){
  const starts=[],ends=[],reS=new RegExp(prefix+'_start:([0-9.]+)','g'),reE=new RegExp(prefix+'_end:([0-9.]+)','g');
  for(const m of text.matchAll(reS))starts.push(Number(m[1]));
  for(const m of text.matchAll(reE))ends.push(Number(m[1]));
  return starts.map((s,i)=>[s,ends[i]??s+2]);
}
function overlap(a,b,c,d){return Math.max(0,Math.min(b,d)-Math.max(a,c));}
export async function analyze(fp,meta,ffmpeg){
  let sceneTimes=[],bad=[],silence=[];
  try{
    const r=await run(ffmpeg,['-hide_banner','-i',fp,'-vf',"scale=320:-2,select='gt(scene,0.28)',showinfo,blackdetect=d=1:pix_th=0.10,freezedetect=noise=0.003:d=2",'-an','-f','null','-']);
    for(const m of r.err.matchAll(/pts_time:([0-9.]+)/g))sceneTimes.push(Number(m[1]));
    bad=[...parseRanges(r.err,'black'),...parseRanges(r.err,'freeze')];
  }catch(e){console.log('[LUXX_ANALYZE] video-pass failed',String(e?.message||e).slice(0,200));}
  if(meta.has_audio)try{
    const r=await run(ffmpeg,['-hide_banner','-i',fp,'-af','silencedetect=noise=-45dB:d=1.2','-vn','-f','null','-']);
    silence=parseRanges(r.err,'silence');
  }catch{}
  console.log('[LUXX_ANALYZE]',JSON.stringify({method:'full-decode-combined',scenes:sceneTimes.length,bad:bad.length,silence:silence.length}));
  return {sceneTimes,bad,silence,analyze_path:'full-decode-combined'};
}
function scoreWindow(start,len,a){
  const end=start+len;
  const scenes=a.sceneTimes.filter(t=>t>=start&&t<end).length;
  let bad=0,sil=0;
  for(const [s,e] of a.bad)bad+=overlap(start,end,s,e);
  for(const [s,e] of a.silence)sil+=overlap(start,end,s,e);
  return 10+Math.min(20,scenes*1.6)-bad*2.5-sil*.25;
}
export const CUT_METHOD='TECHNICAL HEURISTIC — scene-change, black-frame, freeze and silence detection only. No semantic understanding of the content.';
export function parseTargetDuration(input){
  if(input===null||input===undefined||input==='')throw new Error('Enter a target length.');
  if(typeof input==='number'){
    if(!Number.isFinite(input)||input<=0)throw new Error('Target length must be greater than zero.');
    return Number(input.toFixed(3));
  }
  const raw=String(input).trim();
  if(!/^\d{1,2}(:\d{1,2}){0,2}(\.\d+)?$/.test(raw))throw new Error('Target length is not MM:SS or H:MM:SS.');
  const parts=raw.split(':').map(Number);
  let secs;
  if(parts.length===1)secs=parts[0];
  else if(parts.length===2)secs=parts[0]*60+parts[1];
  else secs=parts[0]*3600+parts[1]*60+parts[2];
  if(!(secs>0))throw new Error('Target length must be greater than zero.');
  return Number(secs.toFixed(3));
}
export function formatDuration(secs){
  const s=Math.max(0,Number(secs)||0),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;
  const ss=(r<10?'0':'')+(Number.isInteger(r)?r:r.toFixed(2));
  return h?`${h}:${String(m).padStart(2,'0')}:${ss}`:`${m}:${ss}`;
}
export function planSuggestedCut(sourceDuration,target,analysis={},{segments:wanted=null,min_segment=4}={}){
  const src=Number(sourceDuration),t=Number(target);
  if(!Number.isFinite(src)||src<=0)throw new Error('The source duration is unknown.');
  if(!Number.isFinite(t)||t<=0)throw new Error('Target length must be greater than zero.');
  if(t>src+0.001)throw new Error('Target length is longer than the source.');
  const bad=(analysis.bad||[]).map(b=>({start:Number(b.start)||0,end:Number(b.end)||0}));
  const silence=(analysis.silence||[]).map(b=>({start:Number(b.start)||0,end:Number(b.end)||0}));
  const overlapsBad=(a,b)=>bad.some(x=>x.start<b&&x.end>a);
  const count=wanted&&wanted>0?Math.floor(wanted):(t/src>0.6?1:Math.max(1,Math.min(4,Math.round(t/Math.max(min_segment*2,12)))));
  const per=t/count;
  if(per<min_segment&&count>1)return planSuggestedCut(src,t,analysis,{segments:Math.max(1,Math.floor(t/min_segment)),min_segment});
  const segs=[],usable=Math.max(0,src-per);
  for(let i=0;i<count;i++){
    const ideal=count===1?Math.min(usable,Math.max(0,(src-per)/2)):usable*(i/(count-1||1));
    let start=Math.min(Math.max(0,ideal),Math.max(0,src-per));
    let guard=0;
    while(overlapsBad(start,start+per)&&guard<40&&start+per+2<=src){start+=2;guard++;}
    for(const prev of segs)if(start<prev.end&&start+per>prev.start)start=Math.min(prev.end,Math.max(0,src-per));
    start=Number(Math.max(0,Math.min(start,src-per)).toFixed(3));
    segs.push({start,duration:Number(per.toFixed(3)),end:Number((start+per).toFixed(3)),silent:silence.some(x=>x.start<start+per&&x.end>start)});
  }
  segs.sort((a,b)=>a.start-b.start);
  return {target_seconds:Number(t.toFixed(3)),planned_seconds:Number(segs.reduce((a,x)=>a+x.duration,0).toFixed(3)),source_seconds:Number(src.toFixed(3)),segments:segs,segment_count:segs.length,label:'SUGGESTED '+formatDuration(t)+' CUT',method:CUT_METHOD,disclosure:'Segments were chosen by technical analysis only.'};
}
export function choosePlan(duration,a){
  const teaserCount=duration>=180?3:duration>=90?2:1,teaserLen=Math.min(20,Math.max(8,duration/(teaserCount*4)));
  const candidates=[];
  for(let s=0;s<=Math.max(0,duration-teaserLen);s+=2)candidates.push({start:s,score:scoreWindow(s,teaserLen,a)});
  if(!candidates.length)candidates.push({start:0,score:scoreWindow(0,Math.min(teaserLen,duration),a)});
  const ranked=[...candidates].sort((x,y)=>y.score-x.score||x.start-y.start);
  const pick=(minSep)=>{const out=[];for(const c of ranked){if(out.length>=teaserCount)break;if(out.some(k=>Math.abs(k.start-c.start)<minSep))continue;out.push(c);}return out;};
  let chosen=pick(Math.max(teaserLen,duration/12));
  if(chosen.length<teaserCount)chosen=pick(teaserLen);
  if(chosen.length<teaserCount)chosen=ranked.slice(0,teaserCount);
  chosen.sort((x,y)=>x.start-y.start);
  const teasers=chosen.map(c=>({start:Number(c.start.toFixed(3)),duration:Number(Math.min(teaserLen,duration-c.start).toFixed(3)),score:Number(c.score.toFixed(2)),selection:'GLOBAL_BEST_NON_OVERLAPPING'}));
  const master={start:0,duration:Number(duration.toFixed(3)),score:Number(scoreWindow(0,Math.min(duration,60),a).toFixed(2)),full_source:true};
  return {full_master:master,master_is_full_source:true,main:master,teasers,candidates_considered:candidates.length,master_method:'The privacy-safe export spans the entire source. No automatic truncation.',teaser_method:'FFmpeg technical heuristic over all candidate windows'};
}
export async function exportMasterCopy(input,out,ffmpeg){
  await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-c','copy','-movflags','+faststart',out]);
}
export async function renderClip(input,out,start,duration,ffmpeg){
  await run(ffmpeg,['-y','-ss',String(start),'-i',input,'-t',String(duration),'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M','-c:a','aac','-b:a','128k','-movflags','+faststart',out]);
}
export async function makeHls(input,dir,ffmpeg){
  await fs.mkdir(dir,{recursive:true});
  await run(ffmpeg,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-vf',"scale=w='if(gt(ih,480),-2,iw)':h='if(gt(ih,480),480,ih)'",'-c:v','libx264','-preset','ultrafast','-b:v','900k','-maxrate','1200k','-bufsize','2400k','-c:a','aac','-b:a','96k','-hls_time','4','-hls_playlist_type','vod','-hls_flags','independent_segments','-hls_segment_filename',path.join(dir,'seg-%05d.ts'),path.join(dir,'index.m3u8')]);
}
export async function storeHls(assetId,variantId,dir){
  const media=await store(STORES.media);
  const playlist=await fs.readFile(path.join(dir,'index.m3u8'),'utf8');
  const files=(await fs.readdir(dir)).filter(x=>x.startsWith('seg-')).sort();
  for(const f of files){
    const b=await fs.readFile(path.join(dir,f));
    await media.set('hls/'+assetId+'/'+variantId+'/'+f,toArrayBuffer(b),{metadata:{contentType:'video/mp2t',assetId,variantId}});
  }
  await media.set('hls/'+assetId+'/'+variantId+'/index.m3u8',playlist,{metadata:{contentType:'application/vnd.apple.mpegurl',assetId,variantId}});
  return files.length;
}
export async function storeMp4Parts(assetId,variantId,fp){
  const media=await store(STORES.media),parts=[];
  const fh=await fs.open(fp,'r');
  try{
    const st=await fh.stat(); let off=0,i=0;
    while(off<st.size){
      const len=Math.min(CHUNK_SIZE,st.size-off),buf=Buffer.alloc(len);
      await fh.read(buf,0,len,off);
      const key='variant/'+assetId+'/'+variantId+'/part-'+String(i).padStart(6,'0');
      await media.set(key,toArrayBuffer(buf),{metadata:{contentType:'video/mp4',assetId,variantId,part:i,size:len}});
      parts.push(key); off+=len; i++;
    }
  }finally{await fh.close();}
  return parts;
}
