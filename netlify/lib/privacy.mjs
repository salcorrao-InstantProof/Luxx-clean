import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

function run(bin,args,{timeoutMs=60000}={}){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:['ignore','pipe','pipe']});let out='',err='',done=false;const finish=(fn,val)=>{if(done)return;done=true;clearTimeout(timer);fn(val)};const timer=setTimeout(()=>{try{p.kill('SIGTERM')}catch{}finish(reject,new Error(`${path.basename(bin)} privacy probe timed out`));},timeoutMs);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',e=>finish(reject,e));p.on('close',c=>c===0?finish(resolve,{out,err}):finish(reject,new Error(`${path.basename(bin)} privacy probe exited ${c}: ${err.slice(-1500)}`)));});}

function readU16(buf,off,le){return le?buf.readUInt16LE(off):buf.readUInt16BE(off)}
function readU32(buf,off,le){return le?buf.readUInt32LE(off):buf.readUInt32BE(off)}
function inRange(buf,off,n=1){return Number.isInteger(off)&&off>=0&&off+n<=buf.length}

export function inspectJpegExifBuffer(buf){
  const out={has_exif:false,gps_present:false,device_make_or_model:false,capture_time:false};
  if(!Buffer.isBuffer(buf)||buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return out;
  let p=2;
  while(p+4<=buf.length){
    if(buf[p]!==0xff){p++;continue;}
    const marker=buf[p+1];p+=2;
    if(marker===0xda||marker===0xd9)break;
    if(marker===0x00||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(!inRange(buf,p,2))break;const len=buf.readUInt16BE(p);if(len<2||!inRange(buf,p,len))break;
    if(marker===0xe1&&len>=8&&buf.subarray(p+2,p+8).toString('latin1')==='Exif\x00\x00'){
      out.has_exif=true;const tiff=p+8;if(!inRange(buf,tiff,8)){p+=len;continue;}
      const bo=buf.subarray(tiff,tiff+2).toString('ascii'),le=bo==='II';if(!le&&bo!=='MM'){p+=len;continue;}
      if(readU16(buf,tiff+2,le)!==42){p+=len;continue;}
      const ifd0=tiff+readU32(buf,tiff+4,le);
      const scanIfd=(base,isExif=false)=>{
        if(!inRange(buf,base,2))return;const count=readU16(buf,base,le);
        for(let i=0;i<count;i++){
          const e=base+2+i*12;if(!inRange(buf,e,12))break;const tag=readU16(buf,e,le);
          if(tag===0x8825)out.gps_present=true;
          if(tag===0x010f||tag===0x0110)out.device_make_or_model=true;
          if(tag===0x0132||(isExif&&(tag===0x9003||tag===0x9004)))out.capture_time=true;
          if(tag===0x8769){const ex=tiff+readU32(buf,e+8,le);scanIfd(ex,true);}
        }
      };
      scanIfd(ifd0,false);
    }
    p+=len;
  }
  return out;
}

function classifyTag(key,val,classes){const k=String(key||'').toLowerCase(),v=String(val||'');
  if(/gps|latitude|longitude|location|iso6709/.test(k)||/[+-]\d{2,3}\.\d{3,}[+-]\d{2,3}\.\d{3,}\/?/.test(v))classes.add('GEOLOCATION');
  if(/(^|[._-])(make|model|device)([._-]|$)/.test(k)||/com\.apple\.quicktime\.(make|model)/.test(k))classes.add('DEVICE_IDENTITY');
  if(/creation[_ -]?time|datetime|date_time|datecreated|created/.test(k))classes.add('CAPTURE_TIME');
  if(/artist|author|copyright|owner|comment|description/.test(k))classes.add('IDENTITY_TEXT');
}
function collectTags(obj,classes,prefix=''){
  if(!obj||typeof obj!=='object')return;
  for(const [k,v] of Object.entries(obj)){
    const key=prefix?`${prefix}.${k}`:k;
    if(v&&typeof v==='object')collectTags(v,classes,key);else classifyTag(key,v,classes);
  }
}
async function sampleBytes(fp,max=8*1024*1024){const st=await fs.stat(fp);if(st.size<=max)return fs.readFile(fp);const fh=await fs.open(fp,'r');try{const half=Math.floor(max/2),a=Buffer.alloc(half),b=Buffer.alloc(half);await fh.read(a,0,half,0);await fh.read(b,0,half,Math.max(0,st.size-half));return Buffer.concat([a,b]);}finally{await fh.close();}}

export async function inspectPrivacyFile(fp,{mediaType='IMAGE',ffprobePath=null}={}){
  const classes=new Set(),basis=[];let ffprobeTags={};
  if(!ffprobePath){try{const m=await import('@ffprobe-installer/ffprobe');ffprobePath=(m.default||m).path||m.path||null;}catch{}}
  try{
    if(ffprobePath){const {out}=await run(ffprobePath,['-v','error','-show_entries','format_tags:stream_tags','-of','json',fp]);ffprobeTags=JSON.parse(out||'{}');collectTags(ffprobeTags,classes);basis.push('FFPROBE_TAG_SCAN');}
  }catch{basis.push('FFPROBE_TAG_SCAN_UNAVAILABLE');}
  try{
    const sample=await sampleBytes(fp);const low=sample.toString('latin1').toLowerCase();
    if(/gpslatitude|gpslongitude|gpsposition|location\.iso6709|com\.apple\.quicktime\.location|iso6709/.test(low))classes.add('GEOLOCATION');
    if(/datetimeoriginal|creation_time|datecreated/.test(low))classes.add('CAPTURE_TIME');
    if(/com\.apple\.quicktime\.(make|model)|iphone|camera model/.test(low))classes.add('DEVICE_IDENTITY');
    if(mediaType==='IMAGE'){
      const ex=inspectJpegExifBuffer(sample);if(ex.has_exif)basis.push('JPEG_EXIF_SCAN');if(ex.gps_present)classes.add('GEOLOCATION');if(ex.device_make_or_model)classes.add('DEVICE_IDENTITY');if(ex.capture_time)classes.add('CAPTURE_TIME');
    }
    basis.push('BINARY_METADATA_SIGNATURE_SCAN');
  }catch{basis.push('BINARY_SCAN_UNAVAILABLE');}
  return {status:'AUDITED',embedded_geolocation_detected:classes.has('GEOLOCATION'),sensitive_metadata_classes:[...classes].sort(),exact_location_values_stored:false,inspection_basis:[...new Set(basis)],original_policy:'PRIVATE_IMMUTABLE_MASTER — never the recommended posting file',visual_location_cues:'NOT_AUTOMATICALLY_VERIFIED'};
}

export async function verifyPrivacySanitized(fp,{mediaType='IMAGE',ffprobePath=null}={}){const scan=await inspectPrivacyFile(fp,{mediaType,ffprobePath});const disallowed=scan.sensitive_metadata_classes.filter(x=>['GEOLOCATION','DEVICE_IDENTITY','CAPTURE_TIME','IDENTITY_TEXT'].includes(x));return {...scan,metadata_stripped_verified:disallowed.length===0,safe_export:disallowed.length===0,remaining_sensitive_classes:disallowed};}
