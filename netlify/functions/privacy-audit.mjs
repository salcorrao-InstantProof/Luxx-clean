import {error,json,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';
import {sanitizeImageForPrivacy} from '../lib/media-edit.mjs';

export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  if(req.method!=='POST')return error('Method not allowed',405);
  const b=await readJson(req),asset_id=cleanId(b?.asset_id);
  if(!asset_id)return error('Missing asset_id');
  const assets=await store(STORES.assets),a=await assets.get(`assets/${asset_id}.json`,{type:'json'});
  if(!a)return error('Asset not found',404);
  if(a.media_type!=='IMAGE')return error('Image privacy audit only; videos are audited during video processing.',409);
  try{
    a.privacy={...(a.privacy||{}),status:'PROCESSING',started_at:new Date().toISOString(),original_policy:'PRIVATE_IMMUTABLE_MASTER — never the recommended posting file'};
    await assets.setJSON(`assets/${asset_id}.json`,a);
    const r=await sanitizeImageForPrivacy({asset_id});
    return json({ok:true,asset:r.asset,variant:r.variant,already_exists:r.already_exists});
  }catch(e){
    const cur=await assets.get(`assets/${asset_id}.json`,{type:'json'});
    if(cur){cur.privacy={...(cur.privacy||{}),status:'FAILED',error:String(e?.message||e),updated_at:new Date().toISOString()};await assets.setJSON(`assets/${asset_id}.json`,cur);}
    throw e;
  }
};
export const config={path:'/api/privacy-audit',background:true};
