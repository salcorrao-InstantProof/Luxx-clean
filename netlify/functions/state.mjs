import {json,error} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES,seedState} from '../lib/model.mjs';
import {VERSION,CREATOR_RESTRICTIONS,ROUTE_CATALOG,ensureChecklist} from '../lib/domain.mjs';

const LEGACY_MAP={
  X_TO_OF_FREE_01:['X_BIO_TO_OF_FREE_01','X_PINNED_TO_OF_FREE_01','X_POST_TO_OF_FREE_01'],
  X_TO_FANSLY_01:['X_BIO_TO_FANSLY_01','X_PINNED_TO_FANSLY_01','X_POST_TO_FANSLY_01'],
  X_TO_LINKTREE_01:['X_BIO_TO_LINKTREE_01','X_PINNED_TO_LINKTREE_01','X_POST_TO_LINKTREE_01'],
  PH_TO_OF_FREE_01:['PH_PROFILE_TO_OF_FREE_01','PH_VIDEO_DESC_TO_OF_FREE_01'],
  PH_TO_FANSLY_01:['PH_PROFILE_TO_FANSLY_01','PH_VIDEO_DESC_TO_FANSLY_01'],
  PH_TO_LINKTREE_01:['PH_PROFILE_TO_LINKTREE_01','PH_VIDEO_DESC_TO_LINKTREE_01'],
  OF_FREE_TO_OF_PAID_01:['OF_FREE_BIO_TO_OF_PAID_01','OF_FREE_PINNED_TO_OF_PAID_01','OF_FREE_POST_TO_OF_PAID_01','OF_FREE_MESSAGE_TO_OF_PAID_01'],
  OF_FREE_PPV_01:['OF_FREE_MESSAGE_PPV_01'],
  OF_PAID_PPV_01:['OF_PAID_PPV_MESSAGE_01'],
  LINKTREE_TO_OF_FREE_01:['LINKTREE_BUTTON_TO_OF_FREE_01'],
  LINKTREE_TO_OF_PAID_01:['LINKTREE_BUTTON_TO_OF_PAID_01'],
  LINKTREE_TO_MV_01:['LINKTREE_BUTTON_TO_MV_01'],
  LINKTREE_TO_FANSLY_01:['LINKTREE_BUTTON_TO_FANSLY_01']
};
function placementKey(v=''){
  const x=String(v).trim().toUpperCase().replace(/[\s/\-]+/g,'_');
  if(x.includes('PINNED'))return 'PINNED_POST';
  if(x.includes('VIDEO')&&x.includes('DESCRIPTION'))return 'VIDEO_DESCRIPTION';
  if(x.includes('CREATOR')&&x.includes('PROFILE'))return 'CREATOR_PROFILE';
  if(x.includes('PROFILE')||x.includes('BIO'))return 'BIO';
  if(x.includes('MESSAGE'))return 'MESSAGE';
  if(x.includes('POST'))return 'POST';
  if(x.includes('BUTTON'))return 'BUTTON';
  return x;
}
function copyLegacySetup(old,target){
  for(const k of ['tracking_url_or_identifier','destination_confirmed','test_performed','verification_evidence','native_linkage_capability','verified_at']){
    if(old[k]!==undefined&&old[k]!==null&&old[k]!=='')target[k]=old[k];
  }
  if(old.attribution_scope)target.attribution_scope=old.attribution_scope;
  if(old.verification_status)target.verification_status=old.verification_status;
  if(old.active_status)target.active_status=old.active_status;
  target.intended_placement=target.placement||target.intended_placement;
  target.migrated_from_route_id=old.route_id;
}

export async function getState(){
  const s=await store(STORES.state);let state=await s.get('state.json',{type:'json'}),changed=false;
  if(!state){state=seedState();changed=true;}
  state.settings=state.settings||{};
  if(!state.settings.creatorRestrictions){state.settings.creatorRestrictions=structuredClone(CREATOR_RESTRICTIONS);changed=true;}
  if(state.settings.autoDestinationPlanning!==true){state.settings.autoDestinationPlanning=true;changed=true;}
  state.accounts=state.accounts||[];state.routes=state.routes||[];
  const ensureAccount=(row)=>{if(!state.accounts.some(x=>x.account_id===row.account_id)){state.accounts.push(row);changed=true;}};
  const ensureRoute=(row)=>{if(!state.routes.some(x=>x.route_id===row.route_id)){state.routes.push(structuredClone(row));changed=true;}};
  ensureAccount({account_id:'ACC-FANSLY',platform:'Fansly',role:'DISCOVERY / MONETIZATION EXPERIMENT',status:'ACTIVE',seed:'Existing account; profile photo only / near-empty baseline — exact counts to capture before first LUXX action'});
  ensureAccount({account_id:'ACC-LINKTREE',platform:'Linktree',role:'ROUTING HUB',status:'ACTIVE',seed:'Existing routing hub; current destinations include ManyVids, X, OnlyFans Paid and OnlyFans Free; add Fansly after verified'});
  for(const row of ROUTE_CATALOG)ensureRoute(row);

  // Preserve old route records for audit, but move any deterministically placement-bound setup into the new route ID.
  for(const [oldId,newIds] of Object.entries(LEGACY_MAP)){
    const old=state.routes.find(r=>r.route_id===oldId);if(!old||old.legacy_replaced_by)continue;
    let target=null;
    if(newIds.length===1)target=state.routes.find(r=>r.route_id===newIds[0]);
    else{
      const pk=placementKey(old.intended_placement||old.placement||'');
      target=state.routes.find(r=>newIds.includes(r.route_id)&&placementKey(r.placement)===pk)||null;
    }
    if(target&&old.tracking_url_or_identifier&&!target.tracking_url_or_identifier){copyLegacySetup(old,target);changed=true;}
    old.legacy_replaced_by=target?.route_id||newIds.join(',');
    old.active_status='INACTIVE';
    old.verification_status=old.verification_status==='VERIFIED'?'LEGACY_VERIFIED':old.verification_status;
    changed=true;
  }

  state.settings.defaultPostWindows=state.settings.defaultPostWindows||{};
  if(!state.settings.defaultPostWindows.Fansly){state.settings.defaultPostWindows.Fansly='6–10 PM local — EXPERIMENTAL DEFAULT';changed=true;}
  if(typeof state.rev!=='number'){state.rev=0;changed=true;}
  if(!Array.isArray(state.cropJudgements)){state.cropJudgements=[];changed=true;}
  if(!Array.isArray(state.camSessions)){state.camSessions=[];changed=true;}
  if(!Array.isArray(state.launchChecklist)){state.launchChecklist=[];changed=true;}
  if(state.settings.creatorTimezone===''){state.settings.creatorTimezone='';}
  if(state.settings.creatorTimezone===undefined){state.settings.creatorTimezone='';changed=true;}
  if(state.schemaVersion!==VERSION){state.schemaVersion=VERSION;state.buildName='LUXX Creator Pilot v1.7.0';changed=true;}
  const before=(state.launchChecklist||[]).length;ensureChecklist(state);if((state.launchChecklist||[]).length!==before)changed=true;
  if(changed)await s.setJSON('state.json',state);return state;
}
export async function putState(state){const s=await store(STORES.state);state.updatedAt=new Date().toISOString();await s.setJSON('state.json',state);return state;}
export default async req=>{if(!verifySession(req))return error('Unauthorized',401);if(req.method!=='GET')return error('Use production action/import endpoints for writes.',405);return json({ok:true,state:await getState()});};
export const config={path:'/api/state'};
