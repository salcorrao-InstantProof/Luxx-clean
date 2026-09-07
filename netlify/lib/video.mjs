import path from 'node:path';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {store} from './storage.mjs';
import {STORES,CHUNK_SIZE} from './model.mjs';
import {inspectPrivacyFile,verifyPrivacySanitized} from './privacy.mjs';
import {paths,trace,toArrayBuffer,run,setJob,assemble,sha256File,probe,analyze,choosePlan} from './video-core.mjs';

async function renderClip(input,out,start,duration,ffmpeg){
  const head=['-y','-ss',String(start),'-i',input,'-t',String(duration),'-map_metadata','-1','-map_chapters','-1','-movflags','+faststart'];
  const attempts=[
    [...head,'-map','0:v:0','-map','0:a?','-c','copy',out],
    [...head,'-map','0:v:0','-map','0:a?','-c:v','copy','-c:a','aac','-b:a','128k',out],
    [...head,'-map','0:v:0','-an','-c:v','copy',out],
    [...head,'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M','-c:a','aac','-b:a','128k',out],
    [...head,'-map','0:v:0','-an','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M',out]
  ];
  let last;
  for(const args of attempts){
    try{await run(ffmpeg,args);return;}catch(e){last=e;}
  }
  throw last;
}
async function makeHls(input,dir,ffmpeg){
  await fs.mkdir(dir,{recursive:true});
  const seg=path.join(dir,'seg-%05d.ts'),idx=path.join(dir,'index.m3u8');
  const head=['-y','-i',input,'-map_metadata','-1','-map_chapters','-1','-vf',"scale=w='if(gt(ih,480),-2,iw)':h='if(gt(ih,480),480,ih)'",'-c:v','libx264','-preset','ultrafast','-b:v','900k','-maxrate','1200k','-bufsize','2400k','-hls_time','4','-hls_playlist_type','vod','-hls_flags','independent_segments','-hls_segment_filename',seg];
  let last;
  for(const args of [
    [...head,'-map','0:v:0','-map','0:a?','-c:a','aac','-b:a','96k',idx],
    [...head,'-map','0:v:0','-an',idx]
  ]){
    try{await run(ffmpeg,args);return;}catch(e){last=e;}
  }
  throw last;
}
async function storeHls(assetId,variantId,dir){const media=await store(STORES.media);let playlist=await fs.readFile(path.join(dir,'index.m3u8'),'utf8');const files=(await fs.readdir(dir)).filter(x=>x.startsWith('seg-')).sort();for(const f of files){const b=await fs.readFile(path.join(dir,f));await media.set(`hls/${assetId}/${variantId}/${f}`,toArrayBuffer(b),{metadata:{contentType:'video/mp2t',assetId,variantId}});}await media.set(`hls/${assetId}/${variantId}/index.m3u8`,playlist,{metadata:{contentType:'application/vnd.apple.mpegurl',assetId,variantId}});return files.length;}
async function storeMp4Parts(assetId,variantId,fp){const media=await store(STORES.media),parts=[];const fh=await fs.open(fp,'r');try{const st=await fh.stat();let off=0,i=0;while(off<st.size){const len=Math.min(CHUNK_SIZE,st.size-off),buf=Buffer.alloc(len);await fh.read(buf,0,len,off);const key=`variant/${assetId}/${variantId}/part-${String(i).padStart(6,'0')}`;await media.set(key,toArrayBuffer(buf),{metadata:{contentType:'video/mp4',assetId,variantId,part:i,size:len}});parts.push(key);off+=len;i++;}}finally{await fh.close();}return parts;}
