import {json,error,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';
import {getState} from './state.mjs';

async function delPrefix(s,prefix){
  const {blobs}=await s.list({prefix});
  for(const b of blobs) await s.delete(b.key);
  return blobs.length;
}

export default async req=>{
  if(!verifySession(req)) return error('Unauthorized',401);
  if(req.method!=='DELETE') return error('Method not allowed',405);
  const b=await readJson(req), id=cleanId(b?.asset_id);
  if(!id) return error('Missing asset_id');
  const assets=await store(STORES.assets), media=await store(STORES.media), jobs=await store(STORES.jobs);
  const a=await assets.get(`assets/${id}.json`,{type:'json'});
  if(!a) return error('Asset not found',404);

  const confirmed=b?.confirm_erase===true;
  if(a.media_type==='IMAGE' && confirmed){
    let deleted=0;
    for(const prefix of [`original/${id}/`,`variant/${id}/`,`thumb/${id}/`]) deleted+=await delPrefix(media,prefix);
    const jl=await jobs.list({prefix:'jobs/'});
    for(const x of jl.blobs){
      const j=await jobs.get(x.key,{type:'json'});
      if(j?.asset_id===id){ await jobs.delete(x.key); deleted++; }
    }
    await assets.delete(`assets/${id}.json`);
    return json({ok:true,asset_id:id,deleted_objects:deleted,rule:'CONFIRMED_IMAGE_ERASE'});
  }

  const state=await getState();
  const refs=[];
  for(const [k,v] of Object.entries(state)){
    if(k==='settings'||k==='accounts') continue;
    try{ if(JSON.stringify(v).includes(id)) refs.push(k); }catch{}
  }
  if(refs.length||a.ever_used_prospectively||Number(a.use_count||0)>0)
    return error(`This asset has entered LUXX history and cannot be erased. Mark it UNAVAILABLE instead. Referenced by: ${refs.join(', ')||'usage history'}`,409);

  let deleted=0;
  for(const prefix of [`original/${id}/`,`variant/${id}/`,`thumb/${id}/`,`hls/${id}/`]) deleted+=await delPrefix(media,prefix);
  const jl=await jobs.list({prefix:'jobs/'});
  for(const x of jl.blobs){
    const j=await jobs.get(x.key,{type:'json'});
    if(j?.asset_id===id){ await jobs.delete(x.key); deleted++; }
  }
  await assets.delete(`assets/${id}.json`);
  return json({ok:true,asset_id:id,deleted_objects:deleted,rule:'SAFE_UNUSED_DUPLICATE_ONLY'});
};
export const config={path:'/api/asset-delete'};
