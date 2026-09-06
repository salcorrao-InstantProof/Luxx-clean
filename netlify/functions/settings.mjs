import {json,error,readJson} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {getState,putState} from './state.mjs';
import {appendAudit} from '../lib/domain.mjs';

// Timezone is the one setting LUXX cannot infer and must not guess. Without it, a "learned"
// posting window is meaningless, so postingWindowFor stays on the labelled default.
const ALLOWED=/^[A-Za-z]+\/[A-Za-z_\-+0-9]+$/;

export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  if(req.method!=='PUT')return error('Method not allowed',405);
  const b=await readJson(req);
  const state=await getState();
  if('creatorTimezone' in b){
    const tz=String(b.creatorTimezone||'').trim();
    if(tz&&!ALLOWED.test(tz))return error('Invalid timezone identifier');
    if(tz){try{new Intl.DateTimeFormat('en-US',{timeZone:tz})}catch{return error('Unknown timezone identifier')}}
    state.settings.creatorTimezone=tz;
    appendAudit(state,'SYSTEM','SETTINGS','CREATOR_TIMEZONE_SET',{creatorTimezone:tz});
  }
  if(Number.isFinite(Number(b.measurementHours))&&Number(b.measurementHours)>0&&Number(b.measurementHours)<=336){
    state.settings.measurementHours=Number(b.measurementHours);
  }
  state.rev=Number(state.rev||0)+1;
  await putState(state);
  return json({ok:true,settings:state.settings,state});
};
export const config={path:'/api/settings'};
