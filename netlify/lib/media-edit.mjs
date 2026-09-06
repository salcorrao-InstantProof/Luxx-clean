import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {store} from './storage.mjs';import {STORES} from './model.mjs';import {assembleOriginal,assembleVariant,sha256File,storeFileParts,storeSmall,toArrayBuffer} from './media.mjs';import {uid} from './domain.mjs';import {inspectPrivacyFile,verifyPrivacySanitized} from './privacy.mjs';
async function storeHls(assetId,variantId,dir){const media=await store(STORES.media);const playlist=await fs.readFile(path.join(dir,'index.m3u8'),'utf8');const files=(await fs.readdir(dir)).filter(x=>x.startsWith('seg-')).sort();for(const f of files){const b=await fs.readFile(path.join(dir,f));await media.set(`hls/${assetId}/${variantId}/${f}`,toArrayBuffer(b),{metadata:{contentType:'video/mp2t',assetId,variantId}});}await media.set(`hls/${assetId}/${variantId}/index.m3u8`,playlist,{metadata:{contentType:'application/vnd.apple.mpegurl',assetId,variantId}});return files.length;}
async function makeHls(input,dir,bin){await fs.mkdir(dir,{recursive:true});await run(bin,['-y','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-vf',"scale=w='if(gt(ih,480),-2,iw)':h='if(gt(ih,480),480,ih)'",'-c:v','libx264','-preset','ultrafast','-b:v','900k','-maxrate','1200k','-bufsize','2400k','-c:a','aac','-b:a','96k','-hls_time','4','-hls_playlist_type','vod','-hls_flags','independent_segments','-hls_segment_filename',path.join(dir,'seg-%05d.ts'),path.join(dir,'index.m3u8')]);}
async function ff(){let p=process.env.LUXX_FFMPEG_PATH||'';if(!p){const m=await import('@ffmpeg-installer/ffmpeg');const x=m.default||m;p=x.path||x.default?.path||'';}if(!p)throw new Error('PACKAGED_RENDERER_MISSING: FFmpeg unavailable');return p;}
function run(bin,args){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve({out,err}):reject(new Error(`ffmpeg exited ${c}: ${err.slice(-3000)}`)));});}
function clamp(n,a,b,d){n=Number(n);return Number.isFinite(n)?Math.max(a,Math.min(b,n)):d;}
export async function jpegExifOrientation(file){try{const fh=await fs.open(file,'r');try{const stat=await fh.stat(),len=Math.min(stat.size,1024*1024),buf=Buffer.alloc(len);await fh.read(buf,0,len,0);if(buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return 1;let off=2;while(off+4<=buf.length){if(buf[off]!==0xff){off++;continue}const marker=buf[off+1];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7)){off+=2;continue}const segLen=buf.readUInt16BE(off+2);if(segLen<2||off+2+segLen>buf.length)break;if(marker===0xe1&&segLen>=10&&buf.subarray(off+4,off+10).toString('ascii')==='Exif\u0000\u0000'){const tiff=off+10;if(tiff+8>buf.length)break;const endian=buf.subarray(tiff,tiff+2).toString('ascii'),le=endian==='II';if(!le&&endian!=='MM')break;const u16=(o)=>le?buf.readUInt16LE(o):buf.readUInt16BE(o),u32=(o)=>le?buf.readUInt32LE(o):buf.readUInt32BE(o);if(u16(tiff+2)!==42)break;const ifd=tiff+u32(tiff+4);if(ifd+2>buf.length)break;const n=u16(ifd);for(let i=0;i<n;i++){const e=ifd+2+i*12;if(e+12>buf.length)break;if(u16(e)===0x0112){const type=u16(e+2),count=u32(e+4);if(type===3&&count>=1){const v=u16(e+8);if(v>=1&&v<=8)return v}}}}off+=2+segLen}return 1;}finally{await fh.close()}}catch{return 1}}
export function orientationFilter(o){switch(Number(o)){case 2:return 'hflip';case 3:return 'hflip,vflip';case 4:return 'vflip';case 5:return 'transpose=1,hflip';case 6:return 'transpose=1';case 7:return 'transpose=2,hflip';case 8:return 'transpose=2';default:return ''}}
async function ffprobePath(){let p=process.env.LUXX_FFPROBE_PATH||'';if(!p){try{const m=await import('@ffprobe-installer/ffprobe');const x=m.default||m;p=x.path||x.default?.path||'';}catch{}}return p}
async function imageDims(file){try{const p=await ffprobePath();if(!p)return null;const {out}=await run(p,['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file]);const j=JSON.parse(out),s=j.streams?.[0];return s&&Number(s.width)>0&&Number(s.height)>0?{width:Number(s.width),height:Number(s.height)}:null}catch{return null}}
function cropExpr(aspect,bias=.68){if(aspect==='1:1')return `crop='min(iw,ih)':'min(iw,ih)':'(iw-ow)/2':'(ih-oh)/2'`;if(aspect==='4:5')return `crop='if(gte(iw/ih,4/5),ih*4/5,iw)':'if(gte(iw/ih,4/5),ih,iw*5/4)':'if(gte(iw/ih,4/5),(iw-ow)/2,0)':'if(gte(iw/ih,4/5),0,max(0,min(ih-oh,(ih-oh)*${bias.toFixed(2)})))'`;if(aspect==='9:16')return `crop='if(gte(iw/ih,9/16),ih*9/16,iw)':'if(gte(iw/ih,9/16),ih,iw*16/9)':'if(gte(iw/ih,9/16),(iw-ow)/2,0)':'if(gte(iw/ih,9/16),0,max(0,min(ih-oh,(ih-oh)*0.74)))'`;return ''}
// Tone/sharpen only. Crop is applied and verified as a separate stage so that a dimension
// change caused by an intentional crop can never be mistaken for an orientation failure.
function imageAdjustFilter(recipe){const b=clamp(recipe.brightness,-1,1,0),c=clamp(recipe.contrast,.5,2,1),s=clamp(recipe.saturation,0,3,1),w=clamp(recipe.warmth,-1,1,0),sharp=clamp(recipe.sharpen,0,3,0.4);let vf=`eq=brightness=${b}:contrast=${c}:saturation=${s}`;if(w!==0){const rr=(1+w*.08).toFixed(3),bb=(1-w*.08).toFixed(3);vf+=`,colorchannelmixer=rr=${rr}:gg=1:bb=${bb}`;}if(sharp>0)vf+=`,unsharp=5:5:${sharp.toFixed(2)}:5:5:0`;return vf;}
function imageFilter(recipe){const vf=imageAdjustFilter(recipe);const crop=cropExpr(String(recipe.aspect||'ORIGINAL'),0.68);return crop?vf+','+crop:vf;}
// Mirrors cropExpr arithmetically so the rendered output can be asserted against an expected
// geometry instead of against the input dimensions.
export function expectedCropDims(w,h,aspect){
  w=Number(w);h=Number(h);
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return null;
  const a=String(aspect||'ORIGINAL');
  if(a==='ORIGINAL')return {width:w,height:h};
  const ratio={'1:1':1,'4:5':4/5,'9:16':9/16}[a];
  if(!ratio)return null;
  let ow,oh;
  if(w/h>=ratio){oh=h;ow=h*ratio;}else{ow=w;oh=w/ratio;}
  ow=Math.round(ow);oh=Math.round(oh);
  // A crop must never claim pixels the source does not have.
  if(ow>w+1||oh>h+1)return null;
  return {width:Math.min(ow,w),height:Math.min(oh,h)};
}
function dimsMatch(actual,expected,tol=3){return !!actual&&!!expected&&Math.abs(actual.width-expected.width)<=tol&&Math.abs(actual.height-expected.height)<=tol;}
function videoFilter(recipe){const b=clamp(recipe.brightness,-1,1,0),c=clamp(recipe.contrast,.5,2,1),s=clamp(recipe.saturation,0,3,1);let vf=`eq=brightness=${b}:contrast=${c}:saturation=${s}`;const aspect=String(recipe.aspect||'ORIGINAL');const crop=cropExpr(aspect,0.62);if(crop)vf+=`,`+crop;return vf;}
export function autoBestImageRecipe(asset={}){const score=Number(asset.research_prior_score||0),technical=String(asset.technical_grade||'');return {brightness:technical==='D'?0.06:0.025,contrast:technical==='D'?1.08:1.04,saturation:1.04,warmth:0.03,sharpen:technical==='A'?0.25:0.45,aspect:'ORIGINAL',mode:'AUTO_BEST',crop_version:'ORIENTATION_VERIFIED_V3',processing_version:'ORIENTATION_VERIFIED_V3',basis:score?'SOURCE METADATA + CONSERVATIVE TECHNICAL PRIOR':'CONSERVATIVE TECHNICAL PRIOR'};}
export async function editImage({asset_id,source_variant_id=null,recipe={},auto_best=false}){const as=await store(STORES.assets),asset=await as.get(`assets/${asset_id}.json`,{type:'json'});if(!asset||asset.media_type!=='IMAGE')throw new Error('Image asset not found');const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-img-'));try{const source=source_variant_id?(asset.variants||[]).find(v=>v.variant_id===source_variant_id):null;const input=source?await assembleVariant(asset,source,tmp,'jpg'):await assembleOriginal(asset,tmp,'img');const requestedAspect=String(recipe?.aspect||'ORIGINAL');const exifOrientation=source?1:await jpegExifOrientation(input);const orient=orientationFilter(exifOrientation);const id=uid('IMGVAR'),out=path.join(tmp,`${id}.jpg`),oriented=path.join(tmp,`${id}-oriented.jpg`),thumb=path.join(tmp,`${id}-thumb.jpg`),bin=await ff();
    const finalRecipe=auto_best?{...autoBestImageRecipe(asset),aspect:'ORIGINAL',aspect_requested:requestedAspect,exif_orientation:exifOrientation,orientation_filter:orient||'NONE',orientation_verified:false}:{...recipe,mode:'MANUAL',aspect_requested:requestedAspect,exif_orientation:exifOrientation,orientation_filter:orient||'NONE'};
    // STAGE 1 - orientation only. Verified against the source dimensions, which is the only
    // thing that comparison is valid for. v1.4.6 ran orientation and crop in one pass and then
    // compared the cropped output to the input, so every non-ORIGINAL aspect always failed.
    const orientArgs=['-y','-noautorotate','-i',input,'-map_metadata','-1'];
    const orientFilters=[orient,'setsar=1'].filter(Boolean).join(',');
    if(orientFilters)orientArgs.push('-vf',orientFilters);
    orientArgs.push('-frames:v','1','-q:v','2',oriented);
    await run(bin,orientArgs);
    const inDims=await imageDims(input),orientedDims=await imageDims(oriented);
    const swap=[5,6,7,8].includes(exifOrientation);
    const expectedOriented=inDims?(swap?{width:inDims.height,height:inDims.width}:inDims):null;
    if(!dimsMatch(orientedDims,expectedOriented,2))throw new Error(`ORIENTATION_VERIFICATION_FAILED: EXIF ${exifOrientation}; input ${inDims?.width||'?'}x${inDims?.height||'?'}; oriented ${orientedDims?.width||'?'}x${orientedDims?.height||'?'}`);
    // STAGE 2 - tone plus crop, asserted against the expected crop geometry. If the requested
    // crop is not geometrically safe for this frame, fall back to the full frame rather than
    // shipping a crop LUXX cannot stand behind.
    let effectiveAspect=String(finalRecipe.aspect||'ORIGINAL');
    let expectedFinal=expectedCropDims(orientedDims.width,orientedDims.height,effectiveAspect);
    let cropFallback=false;
    if(!expectedFinal&&effectiveAspect!=='ORIGINAL'){effectiveAspect='ORIGINAL';expectedFinal={width:orientedDims.width,height:orientedDims.height};cropFallback=true;}
    finalRecipe.aspect=effectiveAspect;
    await run(bin,['-y','-i',oriented,'-map_metadata','-1','-vf',imageFilter({...finalRecipe,aspect:effectiveAspect})+',setsar=1','-frames:v','1','-q:v','2',out]);
    let outDims=await imageDims(out);
    if(!dimsMatch(outDims,expectedFinal,3)){
      if(effectiveAspect==='ORIGINAL')throw new Error(`CROP_VERIFICATION_FAILED: expected ${expectedFinal?.width}x${expectedFinal?.height}; got ${outDims?.width||'?'}x${outDims?.height||'?'}`);
      // Crop rendered to unexpected geometry. Fall back to the verified full frame.
      effectiveAspect='ORIGINAL';cropFallback=true;finalRecipe.aspect='ORIGINAL';
      expectedFinal={width:orientedDims.width,height:orientedDims.height};
      await run(bin,['-y','-i',oriented,'-map_metadata','-1','-vf',imageFilter({...finalRecipe,aspect:'ORIGINAL'})+',setsar=1','-frames:v','1','-q:v','2',out]);
      outDims=await imageDims(out);
      if(!dimsMatch(outDims,expectedFinal,3))throw new Error(`CROP_VERIFICATION_FAILED: full-frame fallback also failed for ${asset_id}`);
    }
    finalRecipe.orientation_verified=true;finalRecipe.crop_verified=true;finalRecipe.crop_policy=cropFallback?'ORIGINAL_FALLBACK_CROP_UNSAFE_FOR_THIS_FRAME':(effectiveAspect==='ORIGINAL'?'ORIGINAL':'VERIFIED_CROP');finalRecipe.crop_version='ORIENTATION_VERIFIED_V4';finalRecipe.processing_version='ORIENTATION_VERIFIED_V3';finalRecipe.input_dimensions=inDims;finalRecipe.oriented_dimensions=orientedDims;finalRecipe.output_dimensions=outDims;await run(bin,['-y','-i',out,'-map_metadata','-1','-vf',"scale='min(480,iw)':-2,setsar=1",'-frames:v','1','-q:v','5',thumb]);const stored=await storeFileParts(`variant/${asset_id}/${id}`,out,'image/jpeg');const th=await storeSmall(`thumb/${asset_id}/${id}.jpg`,thumb,'image/jpeg',{assetId:asset_id,variantId:id,orientationVerified:true});const privacy=await verifyPrivacySanitized(out,{mediaType:'IMAGE'});if(!privacy.metadata_stripped_verified)throw new Error('Privacy verification failed for image derivative');const v={variant_id:id,asset_id,master_asset_id:asset_id,parent_variant_id:source_variant_id,variant_type:'IMAGE_EDIT',platform:null,recipe:finalRecipe,rendered:true,orientation_verified:true,created_at:new Date().toISOString(),sha256:await sha256File(out),size:stored.size,download_parts:stored.parts,thumbnail_key:th.key,output_name:`${asset_id}_${id}.jpg`,privacy_safe_export:true,metadata_stripped:true,privacy_verification:privacy,evidence_label:finalRecipe.crop_policy==='ORIGINAL_FALLBACK_CROP_UNSAFE_FOR_THIS_FRAME'?`ORIENTATION-VERIFIED FULL FRAME — ${finalRecipe.aspect_requested} crop was not geometrically safe for this photo, so the full frame was kept`:finalRecipe.crop_policy==='VERIFIED_CROP'?`ORIENTATION-VERIFIED ${finalRecipe.aspect} CROP — orientation baked into pixels, crop geometry verified against the rendered output`:'ORIENTATION-VERIFIED TECHNICAL OPTIMIZATION — EXIF orientation baked into pixels before metadata removal'};asset.variants=asset.variants||[];asset.variants.push(v);asset.visual_score=null;asset.updated_at=new Date().toISOString();await as.setJSON(`assets/${asset_id}.json`,asset);return {asset,variant:v};}finally{await fs.rm(tmp,{recursive:true,force:true});}}

export async function sanitizeImageForPrivacy({asset_id}){const as=await store(STORES.assets),asset=await as.get(`assets/${asset_id}.json`,{type:'json'});if(!asset||asset.media_type!=='IMAGE')throw new Error('Image asset not found');const existing=(asset.variants||[]).find(v=>v.variant_id==='PRIVACY-SAFE-V3'&&v.privacy_safe_export===true&&v.orientation_verified===true);if(existing)return {asset,variant:existing,already_exists:true};const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-privacy-img-'));try{const input=await assembleOriginal(asset,tmp,'img'),id='PRIVACY-SAFE-V3',out=path.join(tmp,`${id}.jpg`),thumb=path.join(tmp,`${id}-thumb.jpg`),bin=await ff(),exifOrientation=await jpegExifOrientation(input),orient=orientationFilter(exifOrientation);const originalScan=await inspectPrivacyFile(input,{mediaType:'IMAGE',ffprobePath:await ffprobePath()});const filters=[orient,'setsar=1'].filter(Boolean).join(',');const args=['-y','-noautorotate','-i',input,'-map_metadata','-1'];if(filters)args.push('-vf',filters);args.push('-frames:v','1','-q:v','2',out);await run(bin,args);const inDims=await imageDims(input),outDims=await imageDims(out);let orientationVerified=false;if(inDims&&outDims){const swap=[5,6,7,8].includes(exifOrientation),expected=swap?{width:inDims.height,height:inDims.width}:inDims;orientationVerified=Math.abs(outDims.width-expected.width)<=2&&Math.abs(outDims.height-expected.height)<=2;}if(!orientationVerified)throw new Error('Privacy derivative orientation verification failed');await run(bin,['-y','-i',out,'-map_metadata','-1','-vf',"scale='min(480,iw)':-2,setsar=1",'-frames:v','1','-q:v','5',thumb]);const privacy=await verifyPrivacySanitized(out,{mediaType:'IMAGE',ffprobePath:await ffprobePath()});if(!privacy.metadata_stripped_verified)throw new Error('Privacy verification failed for posting-safe image');const stored=await storeFileParts(`variant/${asset_id}/${id}`,out,'image/jpeg');const th=await storeSmall(`thumb/${asset_id}/${id}.jpg`,thumb,'image/jpeg',{assetId:asset_id,variantId:id,privacySafe:true,orientationVerified:true});const v={variant_id:id,asset_id,master_asset_id:asset_id,parent_variant_id:null,variant_type:'PRIVACY_SAFE_EXPORT',platform:null,recipe:{metadata:'STRIPPED',pixel_content:'ORIENTATION_NORMALIZED_THEN_REENCODED',processing_version:'ORIENTATION_VERIFIED_V3',exif_orientation:exifOrientation,orientation_filter:orient||'NONE',orientation_verified:true,input_dimensions:inDims,output_dimensions:outDims},rendered:true,orientation_verified:true,created_at:new Date().toISOString(),sha256:await sha256File(out),size:stored.size,download_parts:stored.parts,thumbnail_key:th.key,output_name:`${asset_id}_${id}.jpg`,privacy_safe_export:true,metadata_stripped:true,privacy_verification:privacy,evidence_label:'PRIVACY SHIELD V3 — orientation normalized first; embedded metadata stripped; visible scene clues still require review'};asset.variants=asset.variants||[];asset.variants.push(v);asset.privacy={...originalScan,status:'SAFE_EXPORT_READY',safe_export_variant_id:id,metadata_stripping_verified:true,updated_at:new Date().toISOString()};asset.updated_at=new Date().toISOString();await as.setJSON(`assets/${asset_id}.json`,asset);return {asset,variant:v,already_exists:false};}finally{await fs.rm(tmp,{recursive:true,force:true});}}

export async function editVideo({asset_id,source_variant_id=null,recipe={}}){const as=await store(STORES.assets),asset=await as.get(`assets/${asset_id}.json`,{type:'json'});if(!asset||asset.media_type!=='VIDEO')throw new Error('Video asset not found');const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'luxx-videdit-'));try{const source=source_variant_id?(asset.variants||[]).find(v=>v.variant_id===source_variant_id):null;const input=source?await assembleVariant(asset,source,tmp,'mp4'):await assembleOriginal(asset,tmp,'mp4');const id=uid('VIDVAR'),out=path.join(tmp,`${id}.mp4`),poster=path.join(tmp,`${id}-poster.jpg`),hlsDir=path.join(tmp,`${id}-hls`),bin=await ff();const segsIn=Array.isArray(recipe.segments)?recipe.segments:null;
    const start=Math.max(0,Number(recipe.trim_start||0)),duration=Number(recipe.trim_duration||0);
    let segments=null;
    if(segsIn&&segsIn.length){
      // Every requested range is validated against the real source before anything renders.
      const srcSecs=Number(asset.analysis?.duration_seconds||0);
      segments=segsIn.map((x,i)=>{
        const st=Number(x.start),du=Number(x.duration??(Number(x.end)-Number(x.start)));
        if(!Number.isFinite(st)||st<0)throw new Error(`Segment ${i+1} has an invalid start.`);
        if(!Number.isFinite(du)||du<=0)throw new Error(`Segment ${i+1} has an invalid duration.`);
        if(srcSecs&&st+du>srcSecs+0.05)throw new Error(`Segment ${i+1} runs past the end of the source.`);
        return {start:Number(st.toFixed(3)),duration:Number(du.toFixed(3)),end:Number((st+du).toFixed(3))};
      });
    }
    if(segments&&segments.length>1){
      // Cut each piece with identical encoding parameters, then concatenate losslessly.
      const parts=[];
      for(let i=0;i<segments.length;i++){
        const seg=segments[i],pf=path.join(tmp,`${id}-seg${i}.mp4`);
        // ACCURATE SEEK. A fast -ss before -i snaps to the nearest keyframe, so each
        // segment overshoots and the error accumulates across a multi-segment cut. The
        // input seek is placed AFTER -i, which decodes to the exact requested frame, and
        // a keyframe is forced at the segment boundary so the concat is clean.
        await run(bin,['-y','-i',input,'-ss',String(seg.start),'-t',String(seg.duration),
          '-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-vf',videoFilter(recipe),
          '-c:v','libx264','-preset','ultrafast','-crf','23','-force_key_frames','expr:gte(t,0)',
          '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
          '-avoid_negative_ts','make_zero','-fflags','+genpts','-reset_timestamps','1',pf]);
        parts.push(pf);
      }
      const listFile=path.join(tmp,`${id}-concat.txt`);
      await fs.writeFile(listFile,parts.map(f=>`file '${f.replace(/'/g,"'\\''")}'`).join('\n'));
      const joined=path.join(tmp,`${id}-joined.mp4`);
      await run(bin,['-y','-f','concat','-safe','0','-i',listFile,'-c','copy','-movflags','+faststart',joined]);
      // Each AAC segment carries encoder priming and pads to a whole 1024-sample frame, so
      // four joined segments overshoot the target by ~0.17s even with accurate video seeks.
      // A final exact-duration trim brings the output back to the requested length; the
      // stream copy means it lands on a frame boundary rather than re-encoding again.
      const wanted=Number(recipe.target_seconds)||segments.reduce((a,x)=>a+x.duration,0);
      await run(bin,['-y','-i',joined,'-t',String(Number(wanted.toFixed(3))),
        '-map','0:v:0','-map','0:a?','-c','copy','-avoid_negative_ts','make_zero','-movflags','+faststart',out]);
    }else{
      const one=segments&&segments.length===1?segments[0]:{start,duration};
      const args=['-y','-i',input];
      if(one.start>0)args.push('-ss',String(one.start));
      if(one.duration>0)args.push('-t',String(one.duration));
      args.push('-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_chapters','-1','-vf',videoFilter(recipe),'-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart',out);
      await run(bin,args);
    }await run(bin,['-y','-ss','0.5','-i',out,'-map_metadata','-1','-frames:v','1','-vf',"scale='min(640,iw)':-2",'-q:v','4',poster]);await makeHls(out,hlsDir,bin);const hls_segments=await storeHls(asset_id,id,hlsDir);const stored=await storeFileParts(`variant/${asset_id}/${id}`,out,'video/mp4');const th=await storeSmall(`thumb/${asset_id}/${id}.jpg`,poster,'image/jpeg',{assetId:asset_id,variantId:id});const privacy=await verifyPrivacySanitized(out,{mediaType:'VIDEO'});if(!privacy.metadata_stripped_verified)throw new Error('Privacy verification failed for video derivative');const v={variant_id:id,asset_id,master_asset_id:asset_id,parent_variant_id:source_variant_id,variant_type:recipe.cut_kind==='SUGGESTED'?'SUGGESTED_CUT':(segments&&segments.length>1?'MULTI_SEGMENT_CUT':'VIDEO_EDIT'),
      cut_label:recipe.cut_label||null,
      cut_method:recipe.cut_method||null,
      target_seconds:recipe.target_seconds!=null?Number(recipe.target_seconds):null,
      source_segments:segments?structuredClone(segments):null,
      segment_count:segments?segments.length:1,
      platform:null,
      start_timestamp:String(segments?segments[0].start:start),
      end_timestamp:segments?String(segments[segments.length-1].end):(duration>0?String(start+duration):null),
      final_runtime:segments?Number(segments.reduce((a,x)=>a+x.duration,0).toFixed(3)):(duration>0?duration:null),thumbnail_frame_timestamp_or_reference:'0.5s',title_direction:'',description_direction:'',cta:'',tracking_route_id:null,price_if_applicable:null,price_creator_approved:false,native_listing_measurement_capability:false,recipe:{trim_start:segments?segments[0].start:start,trim_duration:segments?null:(duration||null),segments:segments?structuredClone(segments):null,brightness:clamp(recipe.brightness,-1,1,0),contrast:clamp(recipe.contrast,.5,2,1),saturation:clamp(recipe.saturation,0,3,1),aspect:String(recipe.aspect||'ORIGINAL')},rendered:true,hls_url:`/api/hls?asset=${asset_id}&variant=${id}`,hls_segments,created_at:new Date().toISOString(),sha256:await sha256File(out),size:stored.size,download_parts:stored.parts,thumbnail_key:th.key,output_name:`${asset_id}_${id}.mp4`,privacy_safe_export:true,metadata_stripped:true,privacy_verification:privacy,evidence_label:'CREATOR-EDITED DERIVATIVE — not a proven revenue-best segment'};asset.variants=asset.variants||[];asset.variants.push(v);asset.updated_at=new Date().toISOString();await as.setJSON(`assets/${asset_id}.json`,asset);return {asset,variant:v};}finally{await fs.rm(tmp,{recursive:true,force:true});}}
