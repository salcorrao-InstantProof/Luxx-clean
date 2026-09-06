import {json,error} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';
const MAX_THUMB=1_500_000;
export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  if(req.method!=='POST')return error('Method not allowed',405);
  const asset=cleanId(req.headers.get('x-luxx-asset-id'));
  if(!asset)return error('Invalid asset id');
  const body=await req.arrayBuffer();
  if(body.byteLength<1||body.byteLength>MAX_THUMB)return error('Thumbnail too large',413);
  const key=`thumb/${asset}/thumb.jpg`;
  const media=await store(STORES.media);
  await media.set(key,body,{metadata:{contentType:'image/jpeg',assetId:asset,kind:'thumbnail',size:body.byteLength}});
  return json({ok:true,key,size:body.byteLength});
};
export const config={path:'/api/thumbnail'};
