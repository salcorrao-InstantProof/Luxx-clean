import {json,error,readJson} from '../lib/http.mjs';import {verifySession} from '../lib/auth.mjs';import {store} from '../lib/storage.mjs';import {STORES} from '../lib/model.mjs';import {getState,putState} from './state.mjs';import {applyCommand,validateAppendOnly,dueOutcomes,rankAssets} from '../lib/domain.mjs';
import {librarySignature,generationFor,readCachedToday,writeCachedToday} from '../lib/today-cache.mjs';
// TODAY needs every candidate, so this cannot be paged, but it must not be sequential:
// one round trip per asset was the second full library scan on every single command.
const READ_BATCH=20;
async function allAssets(){
  const s=await store(STORES.assets),{blobs}=await s.list({prefix:'assets/'}),out=[];
  for(let i=0;i<blobs.length;i+=READ_BATCH){
    const chunk=await Promise.all(blobs.slice(i,i+READ_BATCH).map(b=>s.get(b.key,{type:'json'}).catch(()=>null)));
    for(const x of chunk)if(x)out.push(x);
  }
  return out;
}
export default async req=>{if(!verifySession(req))return error('Unauthorized',401);if(req.method!=='POST')return error('Method not allowed',405);const b=await readJson(req);if(!b?.op)return error('Missing operation');const READ_ONLY=['DUE','RANK','RECOMMEND','HISTORICAL_REVIEW','REPORTS','PROOF_PACK','CROP_EVIDENCE','TODAY_PLAN','CHECKLIST','BASELINE_COVERAGE','CAM_SUMMARY','JOB_PERFORMANCE','HIST_SUGGEST_MATCH','HIST_PARSE_CSV'];
  const state=await getState();
  // RECOMMEND is the hot path: it fires on page load and after every mutation. If neither the
  // library nor the ledger has moved, the prescription cannot have changed, so return the
  // stored object and read NO assets at all.
  if(b.op==='RECOMMEND'||b.op==='TODAY_LIST'){
    const lib=await librarySignature();
    const generation=generationFor(lib.signature,state.rev);
    const cached=await readCachedToday(generation);
    const field=b.op==='RECOMMEND'?'recommendation':'today_list';
    if(cached&&cached[field]!==undefined)return json({ok:true,result:cached[field],state,cached:true,generation});
    const assets=await allAssets();
    const rec=applyCommand(state,assets,'RECOMMEND',{});
    const list=applyCommand(state,assets,'TODAY_LIST',b.payload||{});
    // Both are computed from the same scan and stored together, so the pick list never costs a
    // second walk of the library.
    await writeCachedToday(generation,{recommendation:rec,today_list:list},{library_count:lib.count,rev:Number(state.rev||0)});
    return json({ok:true,result:field==='recommendation'?rec:list,state,cached:false,generation});
  }
  // Approving a specific line needs the media bank to revalidate the exact pick.
  if(b.op==='PRESCRIBE_PICK')b.__needsAssets=true;
  const before=structuredClone(state);
  // Only commands that actually need the media bank pay for it.
  const NEEDS_ASSETS=['RANK','PRESCRIBE','PRESCRIBE_PICK','APPROVE','HISTORICAL_REVIEW','HISTORICAL_UPDATE','TODAY_PLAN','HIST_SUGGEST_MATCH','HIST_PARSE_CSV'];
  const assets=NEEDS_ASSETS.includes(b.op)?await allAssets():[];
  // Optimistic concurrency. Two overlapping commands previously did read-modify-write against a
  // single state.json with no guard, so one silently lost its changes. The client sends the rev
  // it last saw; a mismatch is reported rather than overwritten.
  if(!READ_ONLY.includes(b.op)&&b.expected_rev!=null&&Number(b.expected_rev)!==Number(state.rev||0)){
    return json({ok:false,error:'STATE_CONFLICT',expected_rev:Number(b.expected_rev),current_rev:Number(state.rev||0),state},409);
  }
  try{
    let result;
    if(b.op==='DUE')result=dueOutcomes(state);
    else if(b.op==='RANK')result=rankAssets(state,assets,b.payload||{});
    else result=applyCommand(state,assets,b.op,b.payload||{});
    validateAppendOnly(before,state);
    if(!READ_ONLY.includes(b.op)){
      const fresh=await getState();
      if(Number(fresh.rev||0)!==Number(state.rev||0))return json({ok:false,error:'STATE_CONFLICT',expected_rev:Number(state.rev||0),current_rev:Number(fresh.rev||0),state:fresh},409);
      state.rev=Number(state.rev||0)+1;
      await putState(state);
    }
    return json({ok:true,result,state});
  }catch(e){return error(String(e?.message||e),400);}};
export const config={path:'/api/action'};
