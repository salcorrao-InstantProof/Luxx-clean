import {json,error,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';
import {cleanId} from '../lib/ids.mjs';
import {autoPlatformEligibility} from '../lib/domain.mjs';
export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  if(req.method!=='POST')return error('Method not allowed',405);
  const b=await readJson(req),ids=[...new Set((b?.asset_ids||[]).map(cleanId).filter(Boolean))].slice(0,500);
  if(!ids.length)return error('No assets selected');
  if(!['AUTHORIZED','UNCLEAR','NOT_AUTHORIZED'].includes(b.authorization_status))return error('Invalid authorization status');
  const s=await store(STORES.assets);let updated=0,skipped=0;
  for(const id of ids){const key=`assets/${id}.json`,a=await s.get(key,{type:'json'});if(!a){skipped++;continue;}if(a.availability==='QUARANTINED'){skipped++;continue;}a.authorization_status=b.authorization_status;if(a.platform_eligibility_source!=='MANUAL')a.platform_eligibility=autoPlatformEligibility(a);a.updated_at=new Date().toISOString();await s.setJSON(key,a);updated++;}
  return json({ok:true,updated,skipped});
};
export const config={path:'/api/asset-batch-update'};
