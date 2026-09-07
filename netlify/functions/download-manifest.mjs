import {json,error} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';

function isImageVariant(a,v){
  if(a?.media_type==='IMAGE') return true;
  const kind=String(v?.variant_type||'');
  if(kind.startsWith('IMAGE')||kind.includes('PRIVACY')) return true;
  const name=String(v?.output_name||v?.variant_id||'');
  return /\.(jpe?g|png|webp)$/i.test(name);
}

export default async req=>{
  if(!verifySession(req)) return error('Unauthorized',401);
  const u=new URL(req.url);
  const asset=(u.searchParams.get('asset')||'').replace(/[^A-Za-z0-9_.-]/g,'');
  const variant=(u.searchParams.get('variant')||'').replace(/[^A-Za-z0-9_.-]/g,'');
  if(!asset) return error('Invalid request');
  const s=await store(STORES.assets);
  const a=await s.get(`assets/${asset}.json`,{type:'json'});
  if(!a) return error('Asset not found',404);
  if(!variant){
    const keys=Array.from({length:a.parts},(_,i)=>`original/${asset}/part-${String(i).padStart(6,'0')}`);
    const type=a.media_type==='IMAGE'?(a.type||'image/jpeg'):(a.type||'application/octet-stream');
    return json({ok:true,name:a.name,type,sha256:a.master_sha256,parts:keys.map(key=>({key,url:`/api/media-chunk?key=${encodeURIComponent(key)}`}))});
  }
  const v=(a.variants||[]).find(x=>x.variant_id===variant);
  if(!v?.download_parts) return error('Download not ready',404);
  const image=isImageVariant(a,v);
  let name=String(v.output_name||(image?`${variant}.jpg`:`${variant}.mp4`));
  if(image && /\.mp4$/i.test(name)) name=name.replace(/\.mp4$/i,'.jpg');
  if(image && !/\.(jpe?g|png|webp)$/i.test(name)) name=name+'.jpg';
  return json({
    ok:true,
    name,
    type:image?'image/jpeg':(v.variant_type==='IMAGE_EDIT'?'image/jpeg':'video/mp4'),
    sha256:v.sha256,
    parts:v.download_parts.map(key=>({key,url:`/api/media-chunk?key=${encodeURIComponent(key)}`}))
  });
};
export const config={path:'/api/download-manifest'};
