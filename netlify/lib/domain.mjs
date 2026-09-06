import crypto from 'node:crypto';

export const VERSION='1.7.0-rc3-zero-surprise-release';
export const PLATFORMS=['X','Pornhub','OnlyFans Free','OnlyFans Paid','ManyVids','Fansly','Chaturbate'];
export const REVENUE_TYPES=['SUBSCRIPTION','PPV','TIP','CUSTOM_ORDER','MANYVIDS_SALE','OTHER'];
export const nowISO=()=>new Date().toISOString();
export const uid=(p)=>`${p}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

export const CREATOR_RESTRICTIONS={
  X:{no_face:true,label:'No face imagery on X',review_flag:'x_face_safe'},
  Pornhub:{no_face:true,label:'No face imagery on Pornhub',review_flag:'ph_face_safe'}
};
// A destination that forbids face requires an explicit human confirmation on the asset
// or the derivative. Absence of a confirmation is never treated as permission.
export function faceSafeConfirmed(asset,platform){
  const rule=CREATOR_RESTRICTIONS[platform];
  if(!rule||!rule.no_face)return true;
  if(asset?.[rule.review_flag]===true)return true;
  // A face-safe confirmation on any rendered derivative also satisfies the destination.
  return (asset?.variants||[]).some(v=>v&&v[rule.review_flag]===true);
}
export function faceRestrictedPlatforms(){return Object.keys(CREATOR_RESTRICTIONS).filter(p=>CREATOR_RESTRICTIONS[p].no_face);}
const AUTO_IMAGE_PLATFORMS=['OnlyFans Free','OnlyFans Paid','Fansly'];
const AUTO_VIDEO_PLATFORMS=['OnlyFans Paid','ManyVids','Pornhub','Fansly','OnlyFans Free'];

export function autoPlatformEligibility(asset){
  if(!asset||asset.authorization_status!=='AUTHORIZED'||asset.availability!=='AVAILABLE')return [];
  let out=asset.media_type==='VIDEO'?[...AUTO_VIDEO_PLATFORMS]:[...AUTO_IMAGE_PLATFORMS];
  // Every face-restricted destination is fail-closed. Creator #001 declared NO FACE for
  // BOTH X and Pornhub, so neither is granted without an explicit face-safe confirmation.
  // A destination that is auto-eligible by media type is REMOVED again if it forbids face
  // and no confirmation exists; a destination that is not auto-eligible is only added once
  // the confirmation is present.
  for(const plat of faceRestrictedPlatforms()){
    const ok=faceSafeConfirmed(asset,plat);
    out=out.filter(x=>x!==plat);
    if(ok&&(plat==='X'||AUTO_VIDEO_PLATFORMS.includes(plat)||AUTO_IMAGE_PLATFORMS.includes(plat)))out.push(plat);
  }
  return [...new Set(out)];
}
export function effectivePlatformEligibility(asset){
  if(!asset)return [];
  if(asset.platform_eligibility_source==='MANUAL')return Array.isArray(asset.platform_eligibility)?asset.platform_eligibility:[];
  const existing=Array.isArray(asset.platform_eligibility)?asset.platform_eligibility:[];
  return existing.length?existing:autoPlatformEligibility(asset);
}
function destinationPrior(mediaType,platform){
  if(mediaType==='VIDEO')return {'OnlyFans Paid':2.4,'ManyVids':2.1,'Pornhub':1.5,'Fansly':1.45,'OnlyFans Free':1.3,X:.6}[platform]||0;
  return {'OnlyFans Free':2.4,'OnlyFans Paid':1.7,'Fansly':1.35,X:.6}[platform]||0;
}
// The previous build flipped from "operational prior" to "CREATOR-SPECIFIC DIRECTIONAL EVIDENCE"
// the moment a single action was measured. A destination claim now needs the sample size that
// matches the strength of the claim being made.
export function destinationConfidence(primary){
  const n=Number(primary?.n_own||0);
  if(n>=16)return `PROVEN FOR YOU — ${n} measured results on this destination`;
  if(n>=6)return `EARLY SIGNAL — ${n} measured results, not yet conclusive`;
  if(n>=1)return `OPERATIONAL PRIOR — ${n} measured result${n===1?'':'s'} so far, too few to compare`;
  return 'OPERATIONAL PRIOR — not proven creator-specific lift';
}
export function recommendAssetUse(state,asset){
  const eligible=effectivePlatformEligibility(asset);
  if(!asset||asset.authorization_status!=='AUTHORIZED')return {status:'HOLD',primary:null,secondary:[],eligible_platforms:eligible,reason:'Authorization must be AUTHORIZED before LUXX can recommend distribution.',basis:'HARD ELIGIBILITY GATE',confidence:'BLOCKED'};
  if(asset.availability!=='AVAILABLE')return {status:'HOLD',primary:null,secondary:[],eligible_platforms:eligible,reason:`Asset is ${asset.availability||'not available'}.`,basis:'HARD ELIGIBILITY GATE',confidence:'BLOCKED'};
  if(!eligible.length)return {status:'HOLD',primary:null,secondary:[],eligible_platforms:[],reason:'No permitted destination is available after creator restrictions.',basis:'CREATOR RESTRICTIONS',confidence:'BLOCKED'};
  const ranked=eligible.map(platform=>{const route=preferredRoute(state||seedState(),platform)||null,obj=objectiveFor(platform,route),score=candidateScore(state||seedState(),asset,null,platform,obj);const cta=ctaFor(platform,obj.code,route,{tags:asset.semantic?.tags||[],rotation:assetUsage(state||seedState(),asset.asset_id).use_count}),timing=postingWindowFor(state||seedState(),platform);const routeReady=route?routeUsable(route,{asset_id:asset.asset_id,variant_id:null}):false;return {platform,score:Number((score.score+destinationPrior(asset.media_type,platform)).toFixed(4)),evidence:score.evidence,n:score.n,n_own:score.n_own,evidence_tier:score.evidence_tier,objective:obj.label,route_id:route?.route_id||null,route_ready:routeReady,cta:cta.text,cta_basis:cta.basis,posting_window:timing.window,timing_basis:timing.basis};}).sort((a,b)=>b.score-a.score);
  const primary=ranked[0],secondary=ranked.slice(1,3);
  const funnel=asset.media_type==='VIDEO'?'MONETIZE THE MASTER/MAIN CUT; USE SHORTER DERIVATIVES FOR ACQUISITION AND NURTURE':'NURTURE ON ONLYFANS FREE; MOVE QUALIFIED AUDIENCE TO ONLYFANS PAID';
  const blockers=[];
  if(!state?.baseline?.locked)blockers.push('Baseline not locked');
  // Route readiness is PER DESTINATION. An asset that has at least one ready destination
  // is not blocked; naming another platform's unverified route as its blocker was wrong.
  const readyDestinations=ranked.filter(x=>x.route_ready).map(x=>x.platform);
  if(!readyDestinations.length){
    const named=ranked.filter(x=>x.route_id).map(x=>`${x.platform} (${x.route_id})`);
    blockers.push(named.length?`No verified route yet for: ${named.join(', ')}`:'No route configured for any eligible destination');
  }
  // X is a REVIEW state, not a discard. The master is untouched and stays usable elsewhere.
  for(const plat of faceRestrictedPlatforms()){
    if(!faceSafeConfirmed(asset,plat))
      blockers.push(`NEEDS ${plat.toUpperCase()} CROP / REVIEW — choose or create a face-safe version and confirm it before ${plat} use. The master is unchanged and remains usable on destinations that allow face.`);
  }
  return {status:blockers.filter(x=>!x.startsWith('X excluded')).length?'RECOMMENDED_NOT_READY':'RECOMMENDED',primary:primary?.platform||null,secondary:secondary.map(x=>x.platform),eligible_platforms:eligible,ranked_destinations:ranked,funnel_role:funnel,cta:primary?.cta||'',cta_basis:primary?.cta_basis||'',posting_window:primary?.posting_window||'',timing_basis:primary?.timing_basis||'',reason:`${asset.media_type==='VIDEO'?'Video':'Image'} destination plan ranked by funnel role, media type, creator-specific measured history when available, and operational priors.`,basis:'FUNNEL ROLE + MEDIA TYPE + CREATOR RESTRICTIONS + CREATOR-SPECIFIC HISTORY WHEN SUFFICIENT',confidence:destinationConfidence(primary),evidence_tier:evidenceTier(primary?.n_own||0),
    ready_destinations:readyDestinations,blockers};
}
export function decorateAssetForUse(state,asset){
  if(!asset)return asset;
  if(asset.platform_eligibility_source!=='MANUAL'){
    asset.platform_eligibility=autoPlatformEligibility(asset);
    asset.platform_eligibility_source='LUXX_AUTO';
  }
  asset.destination_plan=recommendAssetUse(state,asset);
  // use_count / last_used_at are derived from the append-only action ledger and written back
  // here so the Library UI and the delete guard see the true values. They were previously
  // initialised to 0 on upload and never incremented anywhere.
  const usage=assetUsage(state,asset.asset_id);
  asset.use_count=usage.use_count;
  asset.last_used_at=usage.last_used_at;
  if(usage.ever_used_prospectively)asset.ever_used_prospectively=true;
  asset.destination_plan_updated_at=nowISO();
  return asset;
}

export function appendAudit(state,entity_type,entity_id,event_type,data={}){
  const e={event_id:uid('EVT'),entity_type,entity_id,event_type,timestamp:nowISO(),data:structuredClone(data)};
  state.auditEvents.push(e);return e;
}

export const ROUTE_CATALOG=[
  // X: placement-specific acquisition routes. Daily LUXX posts default to POST; bio/pinned remain persistent conversion routes.
  route('X_POST_TO_OF_FREE_01','X','OnlyFans Free','SOURCE','POST',10),
  route('X_PINNED_TO_OF_FREE_01','X','OnlyFans Free','SOURCE','PINNED_POST',20),
  route('X_BIO_TO_OF_FREE_01','X','OnlyFans Free','SOURCE','BIO',30),
  route('X_POST_TO_FANSLY_01','X','Fansly','SOURCE','POST',40),
  route('X_PINNED_TO_FANSLY_01','X','Fansly','SOURCE','PINNED_POST',50),
  route('X_BIO_TO_FANSLY_01','X','Fansly','SOURCE','BIO',60),
  route('X_POST_TO_LINKTREE_01','X','Linktree','SOURCE','POST',70),
  route('X_PINNED_TO_LINKTREE_01','X','Linktree','SOURCE','PINNED_POST',80),
  route('X_BIO_TO_LINKTREE_01','X','Linktree','SOURCE','BIO',90),

  // Pornhub: separate profile and per-video description attribution.
  route('PH_VIDEO_DESC_TO_OF_FREE_01','Pornhub','OnlyFans Free','SOURCE','VIDEO_DESCRIPTION',10),
  route('PH_PROFILE_TO_OF_FREE_01','Pornhub','OnlyFans Free','SOURCE','CREATOR_PROFILE',20),
  route('PH_VIDEO_DESC_TO_FANSLY_01','Pornhub','Fansly','SOURCE','VIDEO_DESCRIPTION',30),
  route('PH_PROFILE_TO_FANSLY_01','Pornhub','Fansly','SOURCE','CREATOR_PROFILE',40),
  route('PH_VIDEO_DESC_TO_LINKTREE_01','Pornhub','Linktree','SOURCE','VIDEO_DESCRIPTION',50),
  route('PH_PROFILE_TO_LINKTREE_01','Pornhub','Linktree','SOURCE','CREATOR_PROFILE',60),

  // OnlyFans Free: the destination link is created on Paid, then copied into each Free placement.
  route('OF_FREE_POST_TO_OF_PAID_01','OnlyFans Free','OnlyFans Paid','SOURCE','POST',10),
  route('OF_FREE_PINNED_TO_OF_PAID_01','OnlyFans Free','OnlyFans Paid','SOURCE','PINNED_POST',20),
  route('OF_FREE_BIO_TO_OF_PAID_01','OnlyFans Free','OnlyFans Paid','SOURCE','BIO',30),
  route('OF_FREE_MESSAGE_TO_OF_PAID_01','OnlyFans Free','OnlyFans Paid','SOURCE','MESSAGE',40),
  {...route('OF_FREE_POST_PPV_01','OnlyFans Free','Native paid post / PPV','INTERNAL','NATIVE_POST',50),verification_status:'VERIFIED',active_status:'ACTIVE',native_linkage_capability:true},
  {...route('OF_FREE_MESSAGE_PPV_01','OnlyFans Free','Native paid message / PPV','INTERNAL','NATIVE_MESSAGE',60),verification_status:'VERIFIED',active_status:'ACTIVE',native_linkage_capability:true},

  // OnlyFans Paid: retain/monetize the paid audience natively rather than forcing an outbound funnel.
  {...route('OF_PAID_FEED_01','OnlyFans Paid','Native subscription feed','INTERNAL','NATIVE_FEED',10),verification_status:'VERIFIED',active_status:'ACTIVE',native_linkage_capability:true},
  {...route('OF_PAID_PPV_MESSAGE_01','OnlyFans Paid','Native paid message / PPV','INTERNAL','NATIVE_MESSAGE',20),verification_status:'VERIFIED',active_status:'ACTIVE',native_linkage_capability:true},

  // ManyVids: direct sale is the monetization route.
  {...route('MV_LISTING_01','ManyVids','Native listing sale','INTERNAL','NATIVE_LISTING',10),verification_status:'VERIFIED',active_status:'ACTIVE',native_linkage_capability:true},

  // Fansly: internal discovery routes are separately measurable. Custom inbound links from X/PH are defined above.
  {...route('FANSLY_FYP_01','Fansly','Fansly FYP discovery','INTERNAL','FYP',10),verification_status:'UNVERIFIED',active_status:'INACTIVE',native_linkage_capability:true},
  {...route('FANSLY_SUGGESTIONS_01','Fansly','Fansly Suggestions discovery','INTERNAL','SUGGESTIONS',20),verification_status:'UNVERIFIED',active_status:'INACTIVE',native_linkage_capability:true},
  {...route('FANSLY_SEARCH_01','Fansly','Fansly Search discovery','INTERNAL','SEARCH',30),verification_status:'UNVERIFIED',active_status:'INACTIVE',native_linkage_capability:true},
  {...route('FANSLY_NATIVE_01','Fansly','Native Fansly follow / subscribe / PPV','INTERNAL','NATIVE_PROFILE',40),verification_status:'UNVERIFIED',active_status:'INACTIVE',native_linkage_capability:true},

  // Chaturbate: start with native monetization. External-link placement remains uncreated until current platform policy is verified.
  {...route('CB_NATIVE_TIPS_01','Chaturbate','Native Chaturbate tips','INTERNAL','LIVE_ROOM',10),verification_status:'VERIFIED',active_status:'ACTIVE',native_linkage_capability:true},

  // Linktree: each button is its own measurable outbound placement.
  route('LINKTREE_BUTTON_TO_OF_FREE_01','Linktree','OnlyFans Free','SOURCE','BUTTON',10),
  route('LINKTREE_BUTTON_TO_OF_PAID_01','Linktree','OnlyFans Paid','SOURCE','BUTTON',20),
  route('LINKTREE_BUTTON_TO_FANSLY_01','Linktree','Fansly','SOURCE','BUTTON',30),
  route('LINKTREE_BUTTON_TO_MV_01','Linktree','ManyVids','SOURCE','BUTTON',40),
  route('LINKTREE_BUTTON_TO_X_01','Linktree','X','SOURCE','BUTTON',50)
];

export function seedState(){return {
  schemaVersion:VERSION,buildName:'LUXX v1.7.0 RC3 — Zero-Surprise Release',parent:{name:'LUXX Simplified Revenue Pilot v1.2.1',sha256:'e9d271b68415600f0ec19dc10829dd73f30c4c7e7bcdce25c39279c930d5dc1c'},
  rev:0,
  creator:{creator_id:'CREATOR-001',display_name:'Creator #001'},
  baseline:{captured:false,locked:false,captured_at:null,locked_at:null,evidence_reference:'',inventory_mapping_reference:'',notes:'',snapshots:[]},
  accounts:[
    {account_id:'ACC-X',platform:'X',role:'ACQUISITION / DISCOVERY',status:'ACTIVE',seed:'36 followers; 51 posts reported'},
    {account_id:'ACC-PH',platform:'Pornhub',role:'ACQUISITION / DISCOVERY',status:'ACTIVE',seed:'8 videos; 364 subscribers; ~8,700 views'},
    {account_id:'ACC-OFF',platform:'OnlyFans Free',role:'NURTURE / CONVERSION',status:'ACTIVE',seed:'~150 followers; 98 posts / 144 media'},
    {account_id:'ACC-OFP',platform:'OnlyFans Paid',role:'MONETIZATION',status:'ACTIVE',seed:'4 subscribers total; ~3 outside payers'},
    {account_id:'ACC-MV',platform:'ManyVids',role:'DIRECT SALE',status:'ACTIVE',seed:'7 uploads/listings reported'},
    {account_id:'ACC-FANSLY',platform:'Fansly',role:'DISCOVERY / MONETIZATION EXPERIMENT',status:'ACTIVE',seed:'Existing account; profile photo only / near-empty baseline — exact counts to capture before first LUXX action'},
    {account_id:'ACC-LINKTREE',platform:'Linktree',role:'ROUTING HUB',status:'ACTIVE',seed:'Existing routing hub linking ManyVids, X, OnlyFans Paid, OnlyFans Free; add Fansly after verified'},
    {account_id:'ACC-CB',platform:'Chaturbate',role:'ACQUISITION / DISCOVERY',status:'DORMANT',seed:'1,343 followers reported'}
  ],
  routes:ROUTE_CATALOG.map(r=>structuredClone(r)),
  prescriptions:[],actions:[],outcomes:[],measurementCorrections:[],revenueEvents:[],customOrders:[],brandShoots:[],historicalPublications:[],cropJudgements:[],camSessions:[],libraryGaps:[],reservedTrackingUrls:[],profileCopy:[],profileCopyHistory:[],launchChecklist:[],auditEvents:[],settings:{measurementHours:24,creatorRestrictions:structuredClone(CREATOR_RESTRICTIONS),autoDestinationPlanning:true,creatorTimezone:'',camAvailability:emptyCamAvailability(),defaultPostWindows:{X:'6–9 PM local — EXPERIMENTAL DEFAULT',Pornhub:'6–10 PM local — EXPERIMENTAL DEFAULT','OnlyFans Free':'6–9 PM local — EXPERIMENTAL DEFAULT','OnlyFans Paid':'7–10 PM local — EXPERIMENTAL DEFAULT',ManyVids:'6–10 PM local — EXPERIMENTAL DEFAULT',Fansly:'6–10 PM local — EXPERIMENTAL DEFAULT'}}
};}
function route(id,source,destination,scope,placement='',priority=100){return {route_id:id,source,destination,attribution_scope:scope,placement,intended_placement:placement,priority,verification_status:'UNVERIFIED',active_status:'INACTIVE',tracking_url_or_identifier:'',destination_confirmed:false,test_performed:'',verification_evidence:'',native_linkage_capability:false,bound_variant_id:null,bound_asset_id:null,verified_at:null};}
export function usableRoutes(state,source,ctx={}){
  const rows=(state?.routes||[]).filter(r=>r.source===source&&!r.legacy_replaced_by&&routeUsable(r,ctx));
  rows.sort((a,b)=>(Number(a.priority??100)-Number(b.priority??100))||String(a.route_id).localeCompare(String(b.route_id)));
  return rows;
}
export function preferredRoute(state,source,ctx={},usableOnly=false){const rows=(state?.routes||[]).filter(r=>r.source===source&&!r.legacy_replaced_by&&(!usableOnly||routeUsable(r,ctx)));rows.sort((a,b)=>(Number(a.priority??100)-Number(b.priority??100))||String(a.route_id).localeCompare(String(b.route_id)));return rows[0]||null;}

export function captureBaseline(state,{evidence_reference,inventory_mapping_reference,notes='',snapshots=null}={}){
  if(state.baseline.locked)throw new Error('Baseline is already locked.');
  if(!String(evidence_reference||'').trim())throw new Error('Baseline evidence/reference is required.');
  if(!String(inventory_mapping_reference||'').trim())throw new Error('Inventory mapping reference is required.');
  // Capture PROMOTES what was reviewed. Omitting snapshots means "keep what is there",
  // never "throw the reviewed numbers away". Passing an explicit array replaces them.
  const kept=Array.isArray(snapshots)?structuredClone(snapshots):structuredClone(state.baseline.snapshots||[]);
  state.baseline={...state.baseline,captured:true,captured_at:nowISO(),evidence_reference:String(evidence_reference).trim(),inventory_mapping_reference:String(inventory_mapping_reference).trim(),notes:String(notes||''),
    snapshots:kept.map(x=>({...x,review_state:'REVIEWED_AND_CAPTURED'}))};
  appendAudit(state,'BASELINE','CREATOR-001','BASELINE_CAPTURED',{evidence_reference:state.baseline.evidence_reference,inventory_mapping_reference:state.baseline.inventory_mapping_reference,platforms:kept.map(x=>x.platform),snapshot_count:kept.length});return state.baseline;
}
export function lockBaseline(state){if(!state.baseline.captured)throw new Error('Capture the baseline before locking it.');if(state.baseline.locked)return state.baseline;state.baseline.locked=true;state.baseline.locked_at=nowISO();appendAudit(state,'BASELINE','CREATOR-001','BASELINE_LOCKED',{snapshot:structuredClone(state.baseline)});return state.baseline;}
export function updateRoute(state,route_id,patch){const r=state.routes.find(x=>x.route_id===route_id);if(!r)throw new Error('Route not found.');for(const k of ['tracking_url_or_identifier','test_performed','verification_evidence','bound_variant_id','bound_asset_id'])if(k in patch)r[k]=patch[k]??'';if(r.placement)r.intended_placement=r.placement;else if('intended_placement' in patch)r.intended_placement=patch.intended_placement??'';for(const k of ['destination_confirmed','native_linkage_capability'])if(k in patch)r[k]=!!patch[k];if(patch.attribution_scope&&['SOURCE','ACTION','INTERNAL'].includes(patch.attribution_scope))r.attribution_scope=patch.attribution_scope;if(patch.verification_status==='VERIFIED'){
    if(r.attribution_scope!=='INTERNAL'&&(!r.tracking_url_or_identifier||!r.intended_placement||!r.destination_confirmed||!r.test_performed||!r.verification_evidence))throw new Error('External route verification requires identifier, placement, destination confirmation, test and evidence.');
    r.verification_status='VERIFIED';r.verified_at=nowISO();
    // Verification proves the URL lands. It does NOT prove the URL is installed in the
    // live placement, so it must never activate the route on its own.
    if(r.attribution_scope==='INTERNAL')r.active_status='ACTIVE';
    else if(r.placement_installed!==true)r.active_status='INACTIVE';
  } else if(patch.verification_status==='UNVERIFIED'){r.verification_status='UNVERIFIED';r.active_status='INACTIVE';r.placement_installed=false;r.verified_at=null;}
  if('placement_installed' in patch&&patch.placement_installed===false){r.placement_installed=false;r.active_status='INACTIVE';r.activated_at=null;}
  appendAudit(state,'ROUTE',r.route_id,'ROUTE_UPDATED',{snapshot:structuredClone(r)});return r;
}
export function calculateAttributionCeiling(route,ctx={}){
  // Attribution precision comes from verification, scope and binding — never from whether
  // the link is currently installed. Requiring ACTIVE here collapsed two separate ideas and
  // silently deflated SOURCE/INTERNAL/ACTION attribution to UNATTRIBUTED, erasing valid
  // partial and historical attribution. Posting eligibility still requires ACTIVE; that gate
  // lives in routeUsable(), where an inactive route is correctly refused new jobs.
  if(!route||route.verification_status!=='VERIFIED')return 'UNATTRIBUTED';
  if(route.attribution_scope==='INTERNAL')return route.native_linkage_capability?'EXACT':'PARTIAL';
  if(route.attribution_scope==='SOURCE')return 'PARTIAL';
  if(route.attribution_scope==='ACTION'){
    const hasBinding=!!(route.bound_variant_id||route.bound_asset_id);
    const boundOk=hasBinding&&(!route.bound_variant_id||route.bound_variant_id===ctx.variant_id)&&(!route.bound_asset_id||route.bound_asset_id===ctx.asset_id);
    return boundOk&&!!route.tracking_url_or_identifier?'EXACT':'PARTIAL';
  }
  return 'UNATTRIBUTED';
}

// ===========================================================================
// ROUTE STATE — CONFIGURED / VERIFIED / ACTIVE ARE THREE DIFFERENT THINGS
//   CONFIGURED  a tracking URL exists and is bound to this exact route
//   VERIFIED    that URL was opened and lands on the intended destination
//   ACTIVE      the verified URL is actually installed in the live placement
// A route that merely works is not ACTIVE. Only an explicit placement
// confirmation, with evidence, can activate an external route.
// ===========================================================================
export const ROUTE_STATES=['NOT_CONFIGURED','CONFIGURED','VERIFIED','ACTIVE'];
export function routeState(route){
  if(!route)return 'NOT_CONFIGURED';
  if(route.attribution_scope==='INTERNAL')
    return route.verification_status==='VERIFIED'&&route.active_status==='ACTIVE'?'ACTIVE':'CONFIGURED';
  if(route.active_status==='ACTIVE'&&route.placement_installed===true)return 'ACTIVE';
  if(route.verification_status==='VERIFIED')return 'VERIFIED';
  if(route.tracking_url_or_identifier)return 'CONFIGURED';
  return 'NOT_CONFIGURED';
}
// What the operator must still do to get this route live, in her words.
export function routeActivationSteps(route){
  const st=routeState(route);
  if(st==='ACTIVE')return [];
  if(route?.attribution_scope==='INTERNAL')return st==='ACTIVE'?[]:['Native measurement route. Nothing to install.'];
  const steps=[];
  if(st==='NOT_CONFIGURED')steps.push(`Create the tracking link for ${route.source} ${route.placement||''} → ${route.destination} and paste it into this route.`);
  if(st==='NOT_CONFIGURED'||st==='CONFIGURED')steps.push('Open the tracking link and confirm it lands on the intended destination, then mark it VERIFIED with the evidence.');
  steps.push(`Install ${route.tracking_url_or_identifier||'the verified link'} in the exact live placement: ${route.source} ${(route.placement||'').replace(/_/g,' ').toLowerCase()}.`);
  steps.push('Then confirm the placement here to make the route ACTIVE.');
  if(route.activation_blocker)steps.push(`Known blocker: ${route.activation_blocker}`);
  return steps;
}
// Confirming a live placement is the ONLY way an external route becomes ACTIVE.
export function confirmRoutePlacement(state,route_id,{placement_evidence,installed_at=null,confirmed_by='Creator',notes=''}={}){
  const r=state.routes.find(x=>x.route_id===route_id);
  if(!r)throw new Error('Route not found.');
  if(r.attribution_scope==='INTERNAL')throw new Error('A native route has no external placement to install.');
  if(r.verification_status!=='VERIFIED')throw new Error('Verify the tracking link lands on its destination before confirming the placement.');
  if(!String(placement_evidence||'').trim())throw new Error('Confirming a live placement requires evidence of where the link was installed.');
  r.placement_installed=true;
  r.placement_evidence=String(placement_evidence).trim();
  r.activated_at=installed_at||nowISO();
  r.activation_blocker=null;
  r.active_status='ACTIVE';
  r.activation_confirmed_by=confirmed_by;
  if(notes)r.activation_notes=String(notes).slice(0,500);
  appendAudit(state,'ROUTE',r.route_id,'ROUTE_PLACEMENT_CONFIRMED',{snapshot:structuredClone(r)});
  return r;
}
export function deactivateRoute(state,route_id,{reason}={}){
  const r=state.routes.find(x=>x.route_id===route_id);
  if(!r)throw new Error('Route not found.');
  if(!String(reason||'').trim())throw new Error('Taking a route out of service requires a reason.');
  r.placement_installed=false;r.active_status='INACTIVE';r.activated_at=null;
  r.activation_blocker=String(reason).trim();
  appendAudit(state,'ROUTE',r.route_id,'ROUTE_DEACTIVATED',{reason:r.activation_blocker});
  return r;
}
// Reserved tracking URLs exist but belong to no route. They must never be silently
// attached to one, least of all to a native route that needs no outbound URL.
export function reserveTrackingUrl(state,{url,reason=''}={}){
  const u=String(url||'').trim();
  if(!u)throw new Error('A reserved URL is required.');
  state.reservedTrackingUrls=state.reservedTrackingUrls||[];
  const bound=(state.routes||[]).find(r=>r.tracking_url_or_identifier===u);
  if(bound)throw new Error(`That URL is already bound to ${bound.route_id} and is not reserved.`);
  if(!state.reservedTrackingUrls.some(x=>x.url===u)){
    state.reservedTrackingUrls.push({url:u,state:'UNASSIGNED_RESERVED',reason:String(reason||'').slice(0,500),reserved_at:nowISO()});
    appendAudit(state,'ROUTE','RESERVED_URL','TRACKING_URL_RESERVED',{url:u,reason});
  }
  return state.reservedTrackingUrls;
}
export function reservedTrackingUrls(state){return structuredClone(state?.reservedTrackingUrls||[]);}

// The operator's real route configuration, imported rather than hard-coded.
// Each entry may carry: route_id, tracking_url, verified{test_performed,evidence},
// placement_installed + placement_evidence, activation_blocker.
export function importRouteConfig(state,payload={}){
  const rows=Array.isArray(payload)?payload:(payload.routes||[]);
  if(!rows.length&&!(payload.reserved_unassigned_urls||[]).length)
    throw new Error('The route configuration contained no routes.');
  const applied=[],skipped=[];
  for(const row of rows){
    const id=String(row.route_id||'').trim();
    const r=state.routes.find(x=>x.route_id===id);
    if(!r){skipped.push({route_id:id,reason:'no such route in the catalog; routes are never invented from a config file'});continue;}
    if(r.attribution_scope==='INTERNAL'&&row.tracking_url){
      skipped.push({route_id:id,reason:'native route: an outbound tracking URL is not attached'});continue;
    }
    if(row.tracking_url)updateRoute(state,id,{tracking_url_or_identifier:String(row.tracking_url).trim()});
    const want=String(row.state||'').toUpperCase();
    if(want==='VERIFIED'||want==='ACTIVE'){
      updateRoute(state,id,{destination_confirmed:true,
        test_performed:row.test_performed||'Opened the tracking link and confirmed it lands on the intended destination.',
        verification_evidence:row.verification_evidence||'Operator-reported manual verification.',
        verification_status:'VERIFIED'});
    }
    if(want==='ACTIVE'){
      confirmRoutePlacement(state,id,{
        placement_evidence:row.placement_evidence||`Operator installed and tested this link in the live ${String(r.placement||'').replace(/_/g,' ').toLowerCase()} placement.`,
        installed_at:row.installed_at||null,confirmed_by:row.confirmed_by||'Creator',notes:row.notes||''});
    }else if(row.activation_blocker){
      r.activation_blocker=String(row.activation_blocker).slice(0,500);
    }
    applied.push({route_id:id,state:routeState(r)});
  }
  for(const res of (payload.reserved_unassigned_urls||[]))reserveTrackingUrl(state,{url:res.url,reason:res.reason});
  appendAudit(state,'ROUTE','ROUTE_CONFIG','ROUTE_CONFIG_IMPORTED',{applied:applied.length,skipped:skipped.length});
  return {applied,skipped,reserved:reservedTrackingUrls(state),
    note:'Verification and activation are separate. A route is ACTIVE only where the operator confirmed the link is installed in its exact live placement.'};
}
export function routeInventory(state){
  return (state?.routes||[]).map(r=>({route_id:r.route_id,source:r.source,placement:r.placement,
    destination:r.destination,scope:r.attribution_scope,state:routeState(r),
    tracking_url:r.tracking_url_or_identifier||null,
    placement_evidence:r.placement_evidence||null,activation_blocker:r.activation_blocker||null,
    activation_steps:routeActivationSteps(r)}));
}

// ===========================================================================
// SUGGESTED CUT PLANNING (pure)
// The same planner as netlify/lib/video.mjs, kept here so the command path does not
// have to load the ffmpeg-bound module. video.mjs owns rendering; this owns planning.
// ===========================================================================
export const CUT_METHOD_NOTE='TECHNICAL HEURISTIC — scene-change, black-frame, freeze and silence detection only. No semantic understanding of the content.';
export function parseTargetDurationPure(input){
  if(input===null||input===undefined||input==='')throw new Error('Enter a target length.');
  if(typeof input==='number'){
    if(!Number.isFinite(input)||input<=0)throw new Error('Target length must be greater than zero.');
    return Number(input.toFixed(3));
  }
  const raw=String(input).trim();
  if(!/^\d{1,2}(:\d{1,2}){0,2}(\.\d+)?$/.test(raw))throw new Error(`Target length "${raw}" is not MM:SS or H:MM:SS.`);
  const parts=raw.split(':').map(Number);
  if(parts.some(n=>!Number.isFinite(n)||n<0))throw new Error('Target length is not a valid time.');
  let secs;
  if(parts.length===1)secs=parts[0];
  else if(parts.length===2){if(parts[1]>=60)throw new Error('Seconds must be under 60.');secs=parts[0]*60+parts[1];}
  else{if(parts[1]>=60||parts[2]>=60)throw new Error('Minutes and seconds must be under 60.');secs=parts[0]*3600+parts[1]*60+parts[2];}
  if(!(secs>0))throw new Error('Target length must be greater than zero.');
  return Number(secs.toFixed(3));
}
export function formatDurationPure(secs){
  const s=Math.max(0,Number(secs)||0),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;
  const ss=(r<10?'0':'')+(Number.isInteger(r)?r:r.toFixed(2));
  return h?`${h}:${String(m).padStart(2,'0')}:${ss}`:`${m}:${ss}`;
}
export function planSuggestedCutPure(sourceDuration,target,analysis={},{segments:wanted=null,min_segment=4}={}){
  const src=Number(sourceDuration),t=Number(target);
  if(!Number.isFinite(src)||src<=0)throw new Error('The source duration is unknown.');
  if(!Number.isFinite(t)||t<=0)throw new Error('Target length must be greater than zero.');
  if(t>src+0.001)throw new Error(`Target length ${formatDurationPure(t)} is longer than the source (${formatDurationPure(src)}). LUXX will not loop or pad footage.`);
  const bad=(analysis.bad||[]).map(b=>({start:Number(b.start)||0,end:Number(b.end)||0}));
  const silence=(analysis.silence||[]).map(b=>({start:Number(b.start)||0,end:Number(b.end)||0}));
  const overlapsBad=(a,b)=>bad.some(x=>x.start<b&&x.end>a);
  const count=wanted&&wanted>0?Math.floor(wanted):(t/src>0.6?1:Math.max(1,Math.min(4,Math.round(t/Math.max(min_segment*2,12)))));
  const per=t/count;
  if(per<min_segment&&count>1)return planSuggestedCutPure(src,t,analysis,{segments:Math.max(1,Math.floor(t/min_segment)),min_segment});
  const segs=[],usable=Math.max(0,src-per);
  for(let i=0;i<count;i++){
    const ideal=count===1?Math.min(usable,Math.max(0,(src-per)/2)):usable*(i/(count-1||1));
    let start=Math.min(Math.max(0,ideal),Math.max(0,src-per)),guard=0;
    while(overlapsBad(start,start+per)&&guard<40&&start+per+2<=src){start+=2;guard++;}
    for(const prev of segs)if(start<prev.end&&start+per>prev.start)start=Math.min(prev.end,Math.max(0,src-per));
    start=Number(Math.max(0,Math.min(start,src-per)).toFixed(3));
    segs.push({start,duration:Number(per.toFixed(3)),end:Number((start+per).toFixed(3)),
      silent:silence.some(x=>x.start<start+per&&x.end>start)});
  }
  segs.sort((a,b)=>a.start-b.start);
  return {target_seconds:Number(t.toFixed(3)),planned_seconds:Number(segs.reduce((a,x)=>a+x.duration,0).toFixed(3)),
    source_seconds:Number(src.toFixed(3)),segments:segs,segment_count:segs.length,
    label:`SUGGESTED ${formatDurationPure(t)} CUT`,method:CUT_METHOD_NOTE,
    disclosure:'Segments were chosen by technical analysis only. LUXX does not understand what happens in the footage and makes no claim that this is the best or a proven cut.'};
}
export function routeUsable(route,ctx={}){if(!route||route.verification_status!=='VERIFIED'||route.active_status!=='ACTIVE')return false;if(route.attribution_scope==='ACTION'){if(route.bound_variant_id&&route.bound_variant_id!==ctx.variant_id)return false;if(route.bound_asset_id&&route.bound_asset_id!==ctx.asset_id)return false;if(!route.bound_variant_id&&!route.bound_asset_id)return false;}return calculateAttributionCeiling(route,ctx)!=='UNATTRIBUTED';}
export function assetEligible(asset,platform,{historicalAllowed=false}={}){return !!asset&&asset.authorization_status==='AUTHORIZED'&&asset.availability==='AVAILABLE'&&effectivePlatformEligibility(asset).includes(platform)&&(historicalAllowed||asset.historical_usage_status!=='HISTORICAL_BASELINE');}
export function variantMissingFields(v,platform){if(!v)return ['variant'];const base=['variant_id','asset_id','variant_type','final_runtime','thumbnail_frame_timestamp_or_reference','title_direction','description_direction','cta'];const req=[...base];if(platform==='Pornhub')req.push('start_timestamp','end_timestamp','tracking_route_id');if(platform==='ManyVids')req.push('tracking_route_id','price_if_applicable','price_creator_approved','native_listing_measurement_capability');return req.filter(k=>v[k]===null||v[k]===undefined||v[k]===''||((k==='price_creator_approved'||k==='native_listing_measurement_capability')&&!v[k]));}
export function variantReadyForPlatform(v,platform){return variantMissingFields(v,platform).length===0;}
export function ctaFor(platform,objective,route,ctx={}){const dest=route?.destination||'destination';const hooks={
'X':['You only saw the preview.','Curious what happened next?','A little preview for you.','This is only the beginning.','I saved the rest for somewhere less public.','If this caught your attention,','Glasses on. Trouble next.','Book closed. Other ideas now.'],
'Pornhub':['This is the preview.','Want the rest?','The complete drop is waiting.','If you liked this clip,','There is more from this set.','Keep going from here.'],
'OnlyFans Free':['Free preview.','A little taste first.','This one gets better.','If you want the complete drop,','You made it to the preview.','VIP gets the rest.','Bookish on the feed, less innocent on VIP.'],
'OnlyFans Paid':['Full access starts here.','This one is for VIP.','Ready for the complete drop?','The full set is here.','Your next unlock is waiting.','Open when you want the rest.'],
'ManyVids':['Watch the complete release.','The full video is ready.','Want the entire scene?','Get the complete version.','This is available as a full release.'],
'Fansly':['Follow for the next drop.','Found me here? Stay for the rest.','The full post is waiting.','Follow now and keep going.','More from this set is here.','You found the preview.'],
'Chaturbate':['I’m live now.','Come hang out live.','The room is open.','Join me live.','I’m on cam now.']};const closes={
'X':[`See the rest on ${dest} ↓`,`More is waiting on ${dest} ↓`,`Start here: ${dest} ↓`,`The next part is on ${dest} ↓`,`Keep going on ${dest} ↓`],
'Pornhub':[`Continue on ${dest}.`,`See more on ${dest}.`,`The rest is on ${dest}.`,`Find the next drop on ${dest}.`],
'OnlyFans Free':objective==='CONVERT_FREE_TO_PAID'?[`Unlock the full version on VIP.`,`The complete drop is on VIP.`,`VIP has the rest.`,`Continue on the paid page.`,`Open the full version on VIP.`]:[`Continue on the linked page.`,`The next update is on the linked page.`,`Keep going from here.`],
'OnlyFans Paid':[`Open the full paid drop.`,`Unlock the complete version here.`,`Continue to the full post.`,`Open the complete set.`,`See the entire release here.`],
'ManyVids':[`Get the complete video from this listing.`,`Watch the full release here.`,`The complete version is available here.`,`Open the full listing.`],
'Fansly':[`Follow and open the full post.`,`Follow for the next release.`,`Unlock the complete post when you’re ready.`,`More is on my Fansly.`,`Stay here for the next drop.`],
'Chaturbate':[`Join the room.`,`Come say hi.`,`Watch live now.`,`See me live.`]};const H=hooks[platform]||['Want more?','Keep going.','The next part is ready.'],C=closes[platform]||[`Continue to ${dest}.`,`See more on ${dest}.`,`Open ${dest}.`],catalog=[];for(const h of H)for(const c of C)catalog.push(`${h} ${c}`);const tone=['Playful','Direct','Curious','Bookish'];for(const t of tone)for(const c of C)catalog.push(`${t==='Bookish'?'One more chapter?':t==='Playful'?'You know you want the next part.':t==='Curious'?'Wondering what comes next?':'Ready for more?'} ${c}`);const uniq=[...new Set(catalog)];
  // Concept-aware preference. Semantic tags are optional; when absent this is a no-op and the
  // behaviour degrades to plain rotation rather than failing.
  const tags=(ctx.tags||[]).map(t=>String(t).toLowerCase()).filter(Boolean);
  const matched=tags.length?uniq.filter(line=>{const l=line.toLowerCase();return tags.some(t=>l.includes(t));}):[];
  const pool=matched.length>=3?matched:uniq;
  // Rotate on prior usage of this route so the same three lines are not shown every day.
  // The old build seeded from the route_id character sum, which is constant for the life of
  // the route, so the same three captions appeared forever and never varied by asset.
  const rotation=Number(ctx.rotation||0);
  const seed=String(route?.route_id||platform).split('').reduce((a,c)=>a+c.charCodeAt(0),0)+rotation*3;
  const picks=[pool[seed%pool.length],pool[(seed+7)%pool.length],pool[(seed+19)%pool.length]];
  const uniquePicks=[...new Set(picks)];
  while(uniquePicks.length<3&&uniquePicks.length<pool.length)uniquePicks.push(pool[(seed+uniquePicks.length*11+3)%pool.length]);
  const basis=matched.length>=3
    ?`Matched to this photo (${tags.slice(0,3).join(', ')}) from ${pool.length} options for this platform and objective. Not yet ranked by your results.`
    :`Starting options for this platform and objective, from a catalog of ${uniq.length}. Not yet ranked by your results.`;
  return {text:uniquePicks[0],options:uniquePicks.slice(0,3),catalog_size:uniq.length,concept_matched:matched.length>=3,basis};}
// Returns the clock hour of an ISO timestamp in a named IANA timezone, or null if it cannot
// be resolved. The previous build called Date#getHours(), which on Netlify is UTC, and then
// labelled the result "local" to the creator — wrong by 5-8 hours for a US creator.
export function hourInTimezone(iso,timezone){
  if(!iso||!timezone)return null;
  try{
    const d=new Date(iso);
    if(Number.isNaN(d.getTime()))return null;
    const h=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hour12:false}).format(d));
    return Number.isFinite(h)?h%24:null;
  }catch{return null}
}
function hourLabel(h){const suffix=h<12?'AM':'PM';const twelve=h%12===0?12:h%12;return `${twelve} ${suffix}`;}
export function postingWindowFor(state,platform){
  // Chaturbate timing is the creator's configured availability, never a default window.
  // RC1 seeded an 8-11 PM Chaturbate default here, which is exactly the evening block
  // this release removed from the schedule.
  if(platform==='Chaturbate'){
    const cam=camAvailability(state);
    return cam.configured
      ?{window:cam.window_label,basis:'CONFIGURED CAM AVAILABILITY',confidence:'GUESS / DEFAULT — an availability constraint, not a proven best time',timezone:cam.timezone}
      :{window:CAM_NOT_CONFIGURED_LABEL,basis:'SETUP REQUIRED',confidence:'No cam availability configured. LUXX will not assume a time.'};
  }
  const fallback={window:(state.settings.defaultPostWindows||{})[platform]||'6–9 PM local — EXPERIMENTAL DEFAULT',basis:'OPERATIONAL PRIOR',confidence:'EXPERIMENTAL DEFAULT — not proven'};
  const timezone=state.settings?.creatorTimezone||'';
  // No timezone configured means LUXX genuinely does not know what "local" means for this
  // creator. It must not guess, so it stays on the labelled default.
  if(!timezone)return fallback;
  const measured=state.actions.filter(a=>a.platform===platform&&a.status==='MEASURED').map(a=>({a,o:state.outcomes.find(o=>o.action_id===a.action_id)})).filter(x=>x.o?.raw?.gross_revenue!=null||x.o?.raw?.tracked_clicks!=null);
  // A learned window is a CREATOR_SPECIFIC claim, so it needs the CREATOR_SPECIFIC sample size.
  if(measured.length<16)return fallback;
  const byHour=new Map();
  for(const x of measured){
    const h=hourInTimezone(x.a.executed_at,timezone);
    if(h===null)continue;
    const score=Number(x.o.raw.gross_revenue||0)+Number(x.o.raw.tracked_clicks||0);
    const v=byHour.get(h)||{n:0,s:0};v.n++;v.s+=score;byHour.set(h,v);
  }
  const ranked=[...byHour].filter(([,v])=>v.n>=3).sort((a,b)=>(b[1].s/b[1].n)-(a[1].s/a[1].n));
  if(!ranked.length)return fallback;
  const [h,v]=ranked[0];
  return {window:`Around ${hourLabel(h)} ${timezone.split('/').pop().replace(/_/g,' ')} time`,basis:'CREATOR-SPECIFIC MEASURED HISTORY',confidence:`CREATOR-SPECIFIC — ${measured.length} results, ${v.n} in this hour`,timezone,hour:h};
}
function objectiveFor(platform,route){if(platform==='Fansly')return {code:'FANSLY_DISCOVERY_MONETIZATION',label:'Test Fansly discovery and monetization from a clean baseline.'};if(platform==='ManyVids')return {code:'DIRECT_SALE',label:'Generate direct listing sales and attributable revenue.'};if(platform==='OnlyFans Paid')return {code:'PAID_CONTENT',label:'Generate creator-approved paid-content revenue.'};if(platform==='OnlyFans Free'&&route?.destination==='OnlyFans Paid')return {code:'CONVERT_FREE_TO_PAID',label:'Convert qualified free audience to the paid page.'};return {code:'ACQUIRE_FREE_AUDIENCE',label:`Move qualified audience through ${route?.route_id||'the verified route'}.`};}
function outcomeFor(state,id){return [...state.outcomes].reverse().find(o=>o.action_id===id&&o.measurement_state==='MEASURED');}
function revenueFor(state,id,precision=null){return state.revenueEvents.filter(r=>r.action_id===id&&(!precision||r.attribution_precision===precision)).reduce((s,r)=>s+Number(r.gross_amount||0),0);}
// Shrinkage strength. A single measured action moves the estimate ~1/(K+1) of the way
// toward what was observed, not all the way. At n=K the observation carries half the weight.
export const SHRINK_K=8;
// Hard ceiling on how far measured history alone may move a candidate. Without this a single
// high-revenue day produced a ~120 point swing while every other signal was worth ~2.
export const EVIDENCE_CAP=25;
export const FATIGUE_WINDOW_DAYS=7;

function actionSignal(state,a,o){
  let s=Number(o.raw?.paid_conversions||0)*8+Number(o.raw?.free_joins||0)*4+Number(o.raw?.manyvids_sales||0)*10+revenueFor(state,a.action_id,a.attribution_precision==='EXACT'?'EXACT':null)*0.15;
  const effort=Number(a.creator_effort_minutes||0);
  if(effort>0)s+=revenueFor(state,a.action_id)/effort*0.5;
  return s;
}
// ELIGIBILITY GATE. Reuses only rules v1.6.0 already enforced elsewhere to exclude unusable
// media: authorization, availability, a verified privacy-safe derivative, and verified
// orientation. No new exposure/sharpness/coverage constants are invented in this release --
// v1.6.0 has no established numeric floor for those, so none is manufactured here.
export function passesTechnicalGate(asset){
  if(!asset)return {pass:false,reason:'No asset.'};
  if(asset.authorization_status!=='AUTHORIZED')return {pass:false,reason:'Authorization is not confirmed.'};
  if(asset.availability!=='AVAILABLE')return {pass:false,reason:`Asset is ${asset.availability||'not available'}.`};
  const safe=(asset.variants||[]).find(v=>v.privacy_safe_export===true&&v.metadata_stripped===true);
  if(!safe)return {pass:false,reason:'No privacy-safe posting derivative yet — Privacy Shield has not finished.'};
  return {pass:true,reason:''};
}
// Retained for the LIBRARY's technical display only. Deliberately NOT called by candidateScore.
export function visualTerm(asset){
  const v=Number(asset?.visual_score?.score);
  if(!Number.isFinite(v))return 0;
  return Math.max(-10,Math.min(10,(v-68)/2.8));
}
// Usage is DERIVED from the append-only action ledger, never from a stored counter.
// The previous build kept asset.use_count as a field and never incremented it anywhere,
// so the anti-repetition term was dead and TODAY prescribed the same asset indefinitely.
export function assetUsage(state,asset_id,now=Date.now()){
  let use_count=0,last_used_at=null,recent_uses=0;
  const cutoff=now-30*86400000;
  for(const a of state?.actions||[]){
    if(a.asset_id!==asset_id)continue;
    if(!['EXECUTED','MEASURED'].includes(a.status))continue;
    use_count++;
    const t=a.executed_at?Date.parse(a.executed_at):NaN;
    if(Number.isFinite(t)&&t>=cutoff)recent_uses++;
    if(a.executed_at&&(!last_used_at||a.executed_at>last_used_at))last_used_at=a.executed_at;
  }
  return {use_count,recent_uses,last_used_at,ever_used_prospectively:use_count>0};
}
// Recency/fatigue. Strong immediately after use, decaying to zero across FATIGUE_WINDOW_DAYS,
// plus a bounded long-run overuse penalty. This is what forces TODAY to rotate.
// The recency penalty deliberately exceeds EVIDENCE_CAP so that even a proven winner steps
// aside for a few days after being used. Without that, the best-performing asset is prescribed
// every single day, the audience sees the same photo repeatedly, and LUXX never gathers
// evidence about anything else. The penalty decays to zero across the window, so a strong
// asset naturally returns roughly weekly rather than being retired.
export function fatigueTerm(usage,now=Date.now()){
  let f=0;
  const last=usage?.last_used_at?Date.parse(usage.last_used_at):NaN;
  if(Number.isFinite(last)){
    const days=Math.max(0,(now-last)/86400000);
    if(days<FATIGUE_WINDOW_DAYS)f-=(EVIDENCE_CAP+5)*(1-days/FATIGUE_WINDOW_DAYS);
  }
  f-=Math.min(6,Number(usage?.recent_uses??usage?.use_count??0)*1.5);
  return f;
}

// ===========================================================================
// PRE-PURCHASE TREATMENT CONTRACT
//
// On a PPV send the fan pays BEFORE seeing the file. What they act on is a preview, a delivery
// mode, an audience they belong to, and a price. So an unlock is evidence about that TREATMENT,
// not proof about the hidden master.
//
// The master is not nothing: the preview is cut from it, and a dead photo makes a dead teaser.
// But it is not the object the fan judged, so it must never be the object the stamp names.
//
// The treatment key deliberately EXCLUDES asset_id / master / filename, so evidence accumulates
// across different hidden masters used the same way. Keying to an exact photo would fight
// rotation and exclusivity discipline and make CALL unreachable.
// ===========================================================================
export const PREVIEW_STYLES=['BLURRED_CLOSE_CROP','CENSORED_FULL_BODY','SHORT_CLIP','COVERED_TEASE','TEXT_ONLY','NONE'];
export const AUDIENCE_SEGMENTS=['ACTIVE_SUBSCRIBERS','LAPSED_BUYERS','NEW_SUBSCRIBERS','VIP_SPENDERS','ALL_FANS'];
export const PRICE_BANDS=['NONE','UNDER_10','10_15','16_25','26_50','OVER_50'];

export function deliveryModeFor(route){
  const p=String(route?.placement||route?.intended_placement||'').toUpperCase();
  if(p==='NATIVE_MESSAGE'||p==='MESSAGE')return 'PPV_DM';
  if(p==='NATIVE_POST')return 'PPV_LOCKED_POST';
  if(p==='NATIVE_FEED')return 'PAID_FEED';
  if(p==='NATIVE_LISTING')return 'LISTING';
  if(p==='LIVE_ROOM')return 'LIVE';
  return p||'OTHER';
}
export function priceBandFor(price){
  const n=Number(price);
  if(!Number.isFinite(n)||n<=0)return 'NONE';
  if(n<10)return 'UNDER_10';
  if(n<16)return '10_15';
  if(n<26)return '16_25';
  if(n<51)return '26_50';
  return 'OVER_50';
}
// Attribution scope identity. The v1.6.0 bug: evidence pooled on platform+objective only, so
// six PPV-DM unlocks could stamp CALL on a PAID FEED line. Scope now carries the delivery mode
// and the route's own attribution scope, so NATIVE_MESSAGE can never score NATIVE_FEED.
export function scopeKeyForRoute(route){
  return `${String(route?.attribution_scope||'UNKNOWN')}|${deliveryModeFor(route)}`;
}
export function treatmentKey({preview_style,delivery_mode,audience_segment,price_band,scope}){
  if(!preview_style||!audience_segment)return null;   // incomplete treatment is not a class
  return [preview_style,delivery_mode||'OTHER',audience_segment,price_band||'NONE',scope||'UNKNOWN'].join('|');
}
export function treatmentLabel(t){
  if(!t)return '';
  const words={BLURRED_CLOSE_CROP:'Blurred close crop',CENSORED_FULL_BODY:'Censored full body',SHORT_CLIP:'Short clip',COVERED_TEASE:'Covered tease',TEXT_ONLY:'Text only',NONE:'No preview'};
  const seg={ACTIVE_SUBSCRIBERS:'active subscribers',LAPSED_BUYERS:'lapsed buyers',NEW_SUBSCRIBERS:'new subscribers',VIP_SPENDERS:'VIP spenders',ALL_FANS:'all fans'};
  const mode={PPV_DM:'PPV DM',PPV_LOCKED_POST:'locked post',PAID_FEED:'paid feed',LISTING:'listing',LIVE:'live room'};
  const band={NONE:'no price',UNDER_10:'under $10','10_15':'$10-15','16_25':'$16-25','26_50':'$26-50',OVER_50:'over $50'};
  return `${words[t.preview_style]||t.preview_style} → ${mode[t.delivery_mode]||t.delivery_mode} → ${seg[t.audience_segment]||t.audience_segment} → ${band[t.price_band]||t.price_band}`;
}
// A purchase-conversion claim needs a real observable denominator. Without a counted send there
// is no unlock RATE, only a revenue total, and a total cannot support a conversion claim.
export function makesConversionClaim(route){
  return ['PPV_DM','PPV_LOCKED_POST','LISTING'].includes(deliveryModeFor(route));
}
// Only PPV DMs have an observable exposure denominator. Feed/post exposure is not countable, so
// a feed purchase-conversion claim can never qualify. Impressions are never inferred.
export function denominatorObservable(route){return deliveryModeFor(route)==='PPV_DM';}
// The treatment a MEASURED action actually carries. Recorded at execution, never backfilled.
// Stable identifiers for the two treatments an action carries. The ACTUAL one is what
// evidence accrues to; the prescribed one is kept only so a deviation is visible.
export function prescribedTreatmentId(action){
  const t=action?.frozen_prescription?.proposed_treatment||action?.proposed_treatment;
  return t?treatmentKey(t):null;
}
export function actualTreatmentId(action){
  const t=action?.executed_treatment;
  return t?treatmentKey(t):null;
}
export function treatmentDeviation(action){
  const prescribed=prescribedTreatmentId(action),actual=actualTreatmentId(action);
  if(!actual)return {prescribed_treatment_id:prescribed,actual_treatment_id:null,deviated:false,
    note:'Not executed yet. Evidence will accrue to whatever is actually sent.'};
  return {prescribed_treatment_id:prescribed,actual_treatment_id:actual,
    deviated:!!prescribed&&prescribed!==actual,
    note:prescribed&&prescribed!==actual
      ?'Execution differed from the prescription. Evidence accrues to what was ACTUALLY used.'
      :'Execution matched the prescription.'};
}
export function treatmentOfAction(state,a){
  if(!a?.executed_treatment)return null;
  return treatmentKey(a.executed_treatment);
}

export function candidateScore(state,asset,variant,platform,objective,opts={}){
  const now=opts.now??Date.now();
  let score=20;
  const route=opts.route||null;
  const scope=route?scopeKeyForRoute(route):null;
  const proposedTreatment=opts.treatment||null;
  const proposedKey=proposedTreatment?treatmentKey(proposedTreatment):null;
  const conversionClaim=route?makesConversionClaim(route):false;
  // Evidence is scoped by attribution scope, not by platform+objective alone. Without this,
  // NATIVE_MESSAGE PPV unlocks pooled into NATIVE_FEED because both collapse to PAID_CONTENT.
  const same=state.actions.filter(a=>{
    if(a.status!=='MEASURED')return false;
    if(a.platform!==platform||a.objective_code!==objective.code)return false;
    if(scope){const r=(state.routes||[]).find(x=>x.route_id===a.route_id);if(!r||scopeKeyForRoute(r)!==scope)return false;}
    return true;
  });
  let exactVariant=[],exactAsset=[],treatmentSet=[];
  if(conversionClaim){
    // PPV: the fan never saw the master, so identity is the TREATMENT, never the asset.
    // A qualifying observation also needs a real recorded denominator.
    treatmentSet=proposedKey?same.filter(a=>treatmentOfAction(state,a)===proposedKey&&Number(a.sent_to)>0):[];
  }else{
    // Non-PPV: the audience actually saw the file before acting, so asset identity is honest.
    exactVariant=same.filter(a=>variant&&a.variant_id===variant.variant_id&&a.attribution_precision==='EXACT');
    exactAsset=same.filter(a=>a.asset_id===asset.asset_id&&a.attribution_precision==='EXACT');
  }
  const ownSet=conversionClaim?treatmentSet:(exactVariant.length?exactVariant:exactAsset.length?exactAsset:[]);
  const ownIds=new Set(ownSet.map(a=>a.action_id));
  let nOwn=0,ownSum=0;
  for(const a of ownSet){const o=outcomeFor(state,a.action_id);if(!o)continue;nOwn++;ownSum+=actionSignal(state,a,o);}
  // Platform context is computed from OTHER assets only, then itself shrunk toward the neutral
  // prior by its own sample size. Previously an unmeasured asset inherited the platform average
  // at full strength, which made every asset tie with the one proven winner.
  let nCtx=0,ctxSum=0;
  for(const a of same){if(ownIds.has(a.action_id))continue;const o=outcomeFor(state,a.action_id);if(!o)continue;nCtx++;ctxSum+=actionSignal(state,a,o);}
  const platformEst=ctxSum/(SHRINK_K+nCtx);
  const estimate=(platformEst*SHRINK_K+ownSum)/(SHRINK_K+nOwn);
  score+=Math.max(-EVIDENCE_CAP,Math.min(EVIDENCE_CAP,estimate));
  // Technical quality is an ELIGIBILITY GATE (passesTechnicalGate), never a revenue ranker.
  // Both former ranking paths are removed: visualTerm() and variant.technical_score. Sharpness
  // does not predict what earns, and leaving either here was sharpness pretending to be taste.
  if(asset.research_prior_score!=null)score+=Math.max(-3,Math.min(3,Number(asset.research_prior_score)/35));
  // Everything above this line is a claim about how well this asset should perform.
  // The fatigue term below is scheduling, not prediction: it exists to force rotation.
  // They are reported separately so calibration can grade the prediction on its own.
  const quality=Number(score.toFixed(4));
  const usage=assetUsage(state,asset.asset_id);
  score+=fatigueTerm(usage,now);
  let nCtxAll=0;for(const a of same){const o=outcomeFor(state,a.action_id);if(o)nCtxAll++;}
  const n=ownSet.length?nOwn:nCtxAll;
  const evidence=n?(conversionClaim?'TREATMENT_HISTORY':exactVariant.length?'EXACT_VARIANT_HISTORY':exactAsset.length?'EXACT_MASTER_HISTORY':'CONTEXT_HISTORY'):'OPERATIONAL_PRIOR';
  return {score:Number(score.toFixed(4)),quality,evidence,n,n_own:nOwn,
    evidence_tier:evidenceTier(nOwn),
    // Carried so the stamp can name exactly what the evidence is about.
    evidence_object:conversionClaim?'TREATMENT':'ASSET',
    treatment_key:conversionClaim?proposedKey:null,
    scope_key:scope,
    conversion_claim:conversionClaim,
    denominator_observable:route?denominatorObservable(route):false,
    // Six zero-unlock observations must not mint a CALL merely because n reached 6.
    favorable:nOwn>0&&ownSum>0,
    estimate:Number(estimate.toFixed(4))};
}
// Shared vocabulary for what LUXX is allowed to claim at a given sample size.
export function evidenceTier(n){return n>=30?'ESTABLISHED':n>=16?'CREATOR_SPECIFIC':n>=6?'DIRECTIONAL':'STARTING';}
export function generateRecommendation(state,assets){
  if(!state.baseline.locked)return {ready:false,reason:'Baseline information incomplete.',fix:'Capture and lock the before-state baseline.'};
  const candidates=[];let sawEligibleAsset=false,sawRouteFailure=false,sawVideoIncomplete=false,sawPrivacyPending=false,sawTechnicalFail=false,lastGateReason='';
  for(const asset of assets){
    for(const platform of effectivePlatformEligibility(asset)){
      if(!asset||asset.authorization_status!=='AUTHORIZED'||asset.availability!=='AVAILABLE'||!effectivePlatformEligibility(asset).includes(platform))continue;
      const gate=passesTechnicalGate(asset);
      if(!gate.pass){sawTechnicalFail=true;lastGateReason=gate.reason;continue;}
      sawEligibleAsset=true;
      let variants=(asset.variants||[]).filter(v=>v.rendered!==false&&v.privacy_safe_export===true&&v.metadata_stripped===true&&(!v.platform||v.platform===platform));
      if(!variants.length){sawPrivacyPending=true;continue;}
      // A HISTORICAL_BASELINE master remains historical, but newly rendered privacy-safe derivatives are prospective candidates.
      if(asset.media_type==='VIDEO'&&['Pornhub','ManyVids'].includes(platform)){
        const complete=variants.filter(v=>variantReadyForPlatform(v,platform));
        if(!complete.length){sawVideoIncomplete=true;continue;}
        variants=complete;
      }
      let anyRouteForAsset=false;
      for(const variant of variants){
        const ctx={asset_id:asset.asset_id,variant_id:variant.variant_id};
        const routes=usableRoutes(state,platform,ctx);
        if(!routes.length){sawRouteFailure=true;continue;}
        for(const route of routes){
          anyRouteForAsset=true;const obj=objectiveFor(platform,route);const score=candidateScore(state,asset,variant,platform,obj,{route,treatment:proposeTreatment(state,route,variant)});const usage=assetUsage(state,asset.asset_id);const cta=ctaFor(platform,obj.code,route,{tags:asset.semantic?.tags||[],rotation:usage.use_count}),timing=postingWindowFor(state,platform);candidates.push({asset,variant,platform,route,objective:obj,score,cta,timing});
        }
      }
      if(!anyRouteForAsset)sawRouteFailure=true;
    }
  }
  if(!candidates.length){
    if(sawPrivacyPending)return {ready:false,reason:'Privacy-safe posting derivative not ready.',fix:'Let Privacy Shield finish, then use the sanitized derivative rather than the private original.'};
    if(sawVideoIncomplete)return {ready:false,reason:'Video variant instructions incomplete.',fix:'Complete title, description, CTA, tracking, runtime, thumbnail and required platform fields.'};
    if(sawRouteFailure)return {ready:false,reason:'Tracking route unverified.',fix:'Verify and activate the route in LIBRARY → ROUTES.'};
    if(!sawEligibleAsset&&sawTechnicalFail)return {ready:false,reason:'No media passed the technical gate.',fix:lastGateReason||'Authorize media and let Privacy Shield finish.'};
    if(!sawEligibleAsset)return {ready:false,reason:'No authorized prepared media is ready.',fix:'Upload media, authorize it and set platform eligibility.'};
    return {ready:false,reason:'No valid candidate.',fix:'Review setup and media eligibility.'};
  }
  // Deterministic, explainable tiebreak. Previously equal scores fell through to Array#sort
  // stability, which meant the winner was whatever order the blob store happened to list —
  // so TODAY returned the same asset every day. Ties now go to the least recently used asset.
  candidates.sort((a,b)=>{
    if(b.score.score!==a.score.score)return b.score.score-a.score.score;
    const ua=assetUsage(state,a.asset.asset_id),ub=assetUsage(state,b.asset.asset_id);
    if(ua.use_count!==ub.use_count)return ua.use_count-ub.use_count;
    const la=ua.last_used_at||'',lb=ub.last_used_at||'';
    if(la!==lb)return la<lb?-1:1;
    return String(a.asset.asset_id).localeCompare(String(b.asset.asset_id));
  });
  return {ready:true,candidate:candidates[0],candidates};
}
export function createPrescription(state,rec){if(!rec?.ready)throw new Error(rec?.reason||'Recommendation is not ready.');const c=rec.candidate;const p={prescription_id:uid('RX'),revision_of:null,status:'PRESCRIBED',created_at:nowISO(),platform:c.platform,objective_code:c.objective.code,objective:c.objective.label,asset_id:c.asset.asset_id,variant_id:c.variant?.variant_id||null,route_id:c.route.route_id,attribution_ceiling:calculateAttributionCeiling(c.route,{asset_id:c.asset.asset_id,variant_id:c.variant?.variant_id}),exact_action:`Use privacy-safe derivative ${c.variant?.variant_id||'prepared derivative'} from ${c.asset.asset_id} on ${c.platform}.`,cta:c.cta.text,cta_options:c.cta.options||[c.cta.text],cta_basis:c.cta.basis,cta_selected_index:0,cta_selection_source:'DEFAULT_FIRST_OPTION',posting_window:c.timing.window,posting_window_basis:c.timing.basis,reason_summary:c.score.evidence_object==='TREATMENT'
    ?`${c.score.evidence_tier} · ${c.score.n_own||0} comparable measured sends for this pre-purchase treatment · candidate score ${c.score.score}`
    :`${c.score.evidence_tier} · ${c.score.n_own||0} measured results for this photo in this placement · candidate score ${c.score.score}`,evidence_n_own:c.score.n_own||0,evidence_tier:c.score.evidence_tier,candidate_score:c.score.score,job_class:c.job_class||null,job_intent:c.job_intent||null,proposed_treatment:c.score.conversion_claim?proposeTreatment(state,c.route,c.variant):null,proposed_treatment_key:c.score.treatment_key||null,evidence_object:c.score.evidence_object,scope_key:c.score.scope_key,predicted_quality:c.score.quality,creator_authorization_status:c.asset.authorization_status,measurement_plan:{due_hours:state.settings.measurementHours,fields:['views','tracked_clicks','free_joins','paid_conversions','manyvids_sales','gross_revenue','ppv_purchases','tips','custom_video_orders']},data_confidence:(()=>{const t=c.score.evidence_object==='TREATMENT';const unit=t?'comparable measured sends for this pre-purchase treatment':'measured results for this photo in this placement';const tail=t?' Evidence belongs to the treatment, never to the hidden file.':'';return c.score.n_own>=16?`CREATOR-SPECIFIC — ${c.score.n_own} ${unit}. Still no causal conversion-lift claim.${tail}`:c.score.n_own>=CALL_THRESHOLD?`DIRECTIONAL — ${c.score.n_own} ${unit}. Not yet conclusive.${tail}`:`OPERATIONAL ONLY — No conversion-lift claim possible at current sample.${tail}`})(),frozen_snapshot:null};state.prescriptions.push(p);appendAudit(state,'PRESCRIPTION',p.prescription_id,'PRESCRIPTION_CREATED',{snapshot:structuredClone(p)});return p;}
export function approvePrescription(state,id,assets=[]){const p=state.prescriptions.find(x=>x.prescription_id===id);if(!p)throw new Error('Prescription not found.');if(!state.baseline.locked)throw new Error('Baseline is not locked.');if(p.status!=='PRESCRIBED')throw new Error('Only a prescribed item can be approved.');const asset=assets.find(x=>x.asset_id===p.asset_id);if(!asset||asset.authorization_status!=='AUTHORIZED'||asset.availability!=='AVAILABLE')throw new Error('Asset is no longer eligible for approval.');const route=state.routes.find(r=>r.route_id===p.route_id);if(p.route_id&&!routeUsable(route,{asset_id:p.asset_id,variant_id:p.variant_id}))throw new Error('Tracking route is no longer usable for this exact candidate.');const selectedVariant=(asset.variants||[]).find(v=>v.variant_id===p.variant_id);if(!selectedVariant||selectedVariant.privacy_safe_export!==true||selectedVariant.metadata_stripped!==true)throw new Error('Privacy-safe posting derivative is required before approval.');if(asset.media_type==='VIDEO'&&['Pornhub','ManyVids'].includes(p.platform)){if(!variantReadyForPlatform(selectedVariant,p.platform))throw new Error('Video variant instructions are incomplete.');}p.status='APPROVED';p.approved_at=nowISO();p.frozen_snapshot=structuredClone({...p,frozen_snapshot:null});const a={action_id:uid('ACT'),prescription_id:p.prescription_id,parent_action_id:null,action_kind:p.action_kind||'PROSPECTIVE',status:'APPROVED',created_at:nowISO(),approved_at:p.approved_at,platform:p.platform,objective_code:p.objective_code,objective:p.objective,asset_id:p.asset_id,variant_id:p.variant_id,route_id:p.route_id,attribution_precision:p.attribution_ceiling,job_class:p.job_class||null,job_intent:p.job_intent||null,frozen_prescription:structuredClone(p.frozen_snapshot),creator_effort_minutes:null};state.actions.push(a);appendAudit(state,'ACTION',a.action_id,'PRESCRIPTION_APPROVED',{prescription_id:p.prescription_id,frozen_snapshot:structuredClone(a.frozen_prescription)});return a;}
export function changePrescription(state,id,{reason,changes={}}){const old=state.prescriptions.find(x=>x.prescription_id===id);if(!old)throw new Error('Prescription not found.');if(!String(reason||'').trim())throw new Error('Change reason is required.');old.status='REVISED';old.revised_at=nowISO();const p={...structuredClone(old),...structuredClone(changes),prescription_id:uid('RX'),revision_of:old.prescription_id,status:'PRESCRIBED',created_at:nowISO(),approved_at:null,frozen_snapshot:null,change_reason:String(reason).trim()};state.prescriptions.push(p);appendAudit(state,'PRESCRIPTION',old.prescription_id,'PRESCRIPTION_REVISED',{new_prescription_id:p.prescription_id,reason:p.change_reason});return p;}
export const CTA_SELECTION_SOURCES=['DEFAULT_FIRST_OPTION','CREATOR_SELECTED'];
// The creator picks one of the ready-to-use captions already attached to the
// prescription. Free text is not accepted here: an arbitrary caption is a CHANGE with
// the creator's own reason, not a selection among the options LUXX offered.
export function selectPrescriptionCta(state,{prescription_id,cta_index,cta}={}){
  const p=state.prescriptions.find(x=>x.prescription_id===prescription_id);
  if(!p)throw new Error('Prescription not found.');
  if(p.status!=='PRESCRIBED')throw new Error('Only a prescribed item can have its caption selected.');
  const options=(p.cta_options||[]).filter(Boolean);
  if(!options.length)throw new Error('This prescription has no caption options.');
  let idx=Number.isInteger(cta_index)?cta_index:options.indexOf(String(cta??''));
  if(!(idx>=0&&idx<options.length))throw new Error('That caption is not one of the options on this prescription.');
  const chosen=options[idx];
  // Selecting what is already selected is a no-op. It must not manufacture a revision.
  if(chosen===p.cta&&Number(p.cta_selected_index)===idx)return p;
  return changePrescription(state,prescription_id,{
    reason:`Creator selected ready-to-use caption ${idx+1} of ${options.length}.`,
    changes:{cta:chosen,cta_options:[...options],cta_selected_index:idx,cta_selection_source:'CREATOR_SELECTED'}
  });
}
export function declinePrescription(state,id,{reason}){const p=state.prescriptions.find(x=>x.prescription_id===id);if(!p)throw new Error('Prescription not found.');if(!String(reason||'').trim())throw new Error('Decline reason is required.');p.status='DECLINED';p.declined_at=nowISO();p.decline_reason=String(reason).trim();appendAudit(state,'PRESCRIPTION',p.prescription_id,'PRESCRIPTION_DECLINED',{reason:p.decline_reason});return p;}
function p_proposedKey(state,a){const k=a?.frozen_prescription?.proposed_treatment_key;return k||null;}
export function executeAction(state,id,payload={}){const {execution_reference,creator_effort_minutes,operator_role}=payload;const a=state.actions.find(x=>x.action_id===id);if(!a)throw new Error('Action not found.');if(a.status!=='APPROVED')throw new Error('Only an approved action can be marked posted.');if(!String(execution_reference||'').trim())throw new Error('External/native execution reference is required.');const effort=Number(creator_effort_minutes);if(!Number.isFinite(effort)||effort<0)throw new Error('Creator effort minutes must be 0 or greater.');a.status='EXECUTED';a.executed_at=nowISO();a.execution_reference=String(execution_reference).trim();a.creator_effort_minutes=effort;a.operator_role=['Creator','Executive Producer'].includes(operator_role)?operator_role:'Creator';
  // What she ACTUALLY sent, which may differ from what TODAY proposed. Evidence accrues to the
  // executed treatment, never the proposed one. Nothing is backfilled or defaulted: a missing
  // field leaves the treatment incomplete, and an incomplete treatment cannot qualify for CALL.
  const route=(state.routes||[]).find(r=>r.route_id===a.route_id)||null;
  const ps=PREVIEW_STYLES.includes(payload.preview_style)?payload.preview_style:null;
  const seg=AUDIENCE_SEGMENTS.includes(payload.audience_segment)?payload.audience_segment:null;
  const priceRaw=Number(payload.price_charged);
  const sent=Number(payload.sent_to);
  a.price_charged=Number.isFinite(priceRaw)&&priceRaw>0?priceRaw:null;
  a.sent_to=Number.isFinite(sent)&&sent>0?Math.round(sent):null;
  a.executed_treatment=(ps&&seg)?{preview_style:ps,delivery_mode:deliveryModeFor(route),audience_segment:seg,price_band:priceBandFor(a.price_charged),scope:scopeKeyForRoute(route)}:null;
  a.executed_treatment_key=a.executed_treatment?treatmentKey(a.executed_treatment):null;
  a.proposed_treatment_key=p_proposedKey(state,a)||null;
  a.treatment_deviated=!!(a.proposed_treatment_key&&a.executed_treatment_key&&a.proposed_treatment_key!==a.executed_treatment_key);const o={outcome_id:uid('OUT'),action_id:a.action_id,measurement_state:'SCHEDULED',scheduled_at:nowISO(),due_at:new Date(Date.now()+Number(state.settings.measurementHours||24)*3600000).toISOString(),raw:{}};state.outcomes.push(o);appendAudit(state,'ACTION',a.action_id,'ACTION_EXECUTED',{execution_reference:a.execution_reference,creator_effort_minutes:effort,operator_role:a.operator_role,due_at:o.due_at});return {action:a,outcome:o};}

// ===========================================================================
// NATIVE RESULT FIELDS PER PLATFORM
// Only fields the platform actually exposes. Pornhub's per-video analytics screen
// shows exactly these six; nothing else is inferred. A field left blank stays
// unknown and is never written as zero.
// ===========================================================================
export const GENERIC_RESULT_FIELDS=['views','tracked_clicks','free_joins','paid_conversions','manyvids_sales','gross_revenue','ppv_purchases','tips','custom_video_orders'];
export const NATIVE_RESULT_FIELDS={
  'Pornhub':['total_views','total_earnings','rating_percent','favorites','comments','playlist_additions'],
  'Chaturbate':['tips','tokens','gross_revenue','followers_delta'],
  'ManyVids':['manyvids_sales','gross_revenue','views']
};
export function resultFieldsFor(platform){
  const native=NATIVE_RESULT_FIELDS[platform]||[];
  return {native,generic:GENERIC_RESULT_FIELDS,
    fields:[...new Set([...native,...GENERIC_RESULT_FIELDS])],
    note:native.length
      ?`${platform} exposes these natively. Anything it does not show stays blank, and blank means unknown.`
      :'Blank means unknown. Enter 0 only for an observed zero.'};
}
export function recordMeasurement(state,outcome_id,raw){const o=state.outcomes.find(x=>x.outcome_id===outcome_id);if(!o)throw new Error('Outcome not found.');if(o.measurement_state==='MEASURED')throw new Error('Use measurement correction for an already measured outcome.');o.measurement_state='MEASURED';o.measured_at=nowISO();o.raw={};for(const [k,v] of Object.entries(raw||{}))if(v!==''&&v!==null&&v!==undefined){const n=Number(v);if(Number.isFinite(n))o.raw[k]=n;}const a=state.actions.find(x=>x.action_id===o.action_id);if(a)a.status='MEASURED';appendAudit(state,'OUTCOME',o.outcome_id,'MEASUREMENT_RECORDED',{raw:structuredClone(o.raw)});return o;}
export function correctMeasurement(state,outcome_id,{reason,raw}){const o=state.outcomes.find(x=>x.outcome_id===outcome_id);if(!o||o.measurement_state!=='MEASURED')throw new Error('Measured outcome not found.');if(!String(reason||'').trim())throw new Error('Correction reason is required.');const c={correction_id:uid('COR'),outcome_id,created_at:nowISO(),reason:String(reason).trim(),previous_raw:structuredClone(o.raw),new_raw:{}};for(const [k,v] of Object.entries(raw||{}))if(v!==''&&v!==null&&v!==undefined){const n=Number(v);if(Number.isFinite(n))c.new_raw[k]=n;}state.measurementCorrections.push(c);o.raw=structuredClone(c.new_raw);o.corrected_at=c.created_at;appendAudit(state,'OUTCOME',outcome_id,'MEASUREMENT_CORRECTED',{correction_id:c.correction_id,reason:c.reason,previous_raw:c.previous_raw,new_raw:c.new_raw});return c;}
export function recordRevenue(state,{action_id,event_type,gross_amount,notes=''}){if(!REVENUE_TYPES.includes(event_type))throw new Error('Invalid revenue type.');const a=action_id?state.actions.find(x=>x.action_id===action_id):null;if(action_id&&!a)throw new Error('Action not found.');const amount=Number(gross_amount);if(!Number.isFinite(amount)||amount<0)throw new Error('Revenue amount must be 0 or greater.');const r={revenue_event_id:uid('REV'),action_id:action_id||null,event_type,gross_amount:amount,attribution_precision:a?.attribution_precision||'UNATTRIBUTED',created_at:nowISO(),notes:String(notes||'')};state.revenueEvents.push(r);appendAudit(state,'REVENUE',r.revenue_event_id,'REVENUE_RECORDED',{snapshot:structuredClone(r)});return r;}
export function recordCustomOrder(state,{action_id=null,amount,customer_reference='',deliverable='',status='ORDERED'}){const r=recordRevenue(state,{action_id,event_type:'CUSTOM_ORDER',gross_amount:amount,notes:deliverable});const c={custom_order_id:uid('CUS'),revenue_event_id:r.revenue_event_id,action_id,customer_reference:String(customer_reference||'').slice(0,120),deliverable:String(deliverable||'').slice(0,500),status,created_at:nowISO()};state.customOrders.push(c);appendAudit(state,'CUSTOM_ORDER',c.custom_order_id,'CUSTOM_ORDER_RECORDED',{snapshot:structuredClone(c)});return c;}
export function createHistoricalPublication(state,{asset_id,platform,external_reference,title='',published_at=null,notes=''}){const h={historical_publication_id:uid('HIST'),asset_id,platform,external_reference:String(external_reference||''),title:String(title||''),published_at:published_at||null,notes:String(notes||''),status:'HISTORICAL_BASELINE',created_at:nowISO()};state.historicalPublications.push(h);appendAudit(state,'HISTORICAL_PUBLICATION',h.historical_publication_id,'HISTORICAL_PUBLICATION_RECORDED',{snapshot:structuredClone(h)});return h;}
export function reviewHistoricalVideo(state,assets,{historical_publication_id}){const h=state.historicalPublications.find(x=>x.historical_publication_id===historical_publication_id);if(!h)throw new Error('Historical publication not found.');const a=assets.find(x=>x.asset_id===h.asset_id);if(!a||a.media_type!=='VIDEO')throw new Error('Historical video master not found.');const main=(a.variants||[]).find(v=>v.variant_type==='MAIN_CUT'||v.variant_id==='MAIN-CUT');const teasers=(a.variants||[]).filter(v=>v.variant_type==='TEASER');let recommendation='KEEP';let reason='No prepared replacement is available yet.';if(main&&Number(a.analysis?.duration_seconds||0)>Number(main.duration_seconds||0)+20){recommendation='RE-EDIT';reason=`A shorter rendered main cut exists (${Math.round(main.duration_seconds)}s vs ${Math.round(a.analysis.duration_seconds)}s master) plus ${teasers.length} teaser(s).`;}
  if(a.authorization_status!=='AUTHORIZED'){recommendation='HOLD';reason='Authorization is not currently AUTHORIZED.';}
  const route=preferredRoute(state,h.platform,{asset_id:a.asset_id,variant_id:main?.variant_id},true);const tracking_ready=routeUsable(route,{asset_id:a.asset_id,variant_id:main?.variant_id});return {historical_publication_id:h.historical_publication_id,recommendation,reason,derivative_complete:!!main,teaser_count:teasers.length,tracking_ready,prospective_action_allowed:state.baseline.locked&&a.authorization_status==='AUTHORIZED'&&!!main&&tracking_ready};}
export function createHistoricalUpdate(state,assets,{historical_publication_id}){const review=reviewHistoricalVideo(state,assets,{historical_publication_id});if(!review.prospective_action_allowed)throw new Error('Historical update is not ready: complete derivative, authorization, baseline and tracking first.');const h=state.historicalPublications.find(x=>x.historical_publication_id===historical_publication_id),a=assets.find(x=>x.asset_id===h.asset_id),v=(a.variants||[]).find(x=>x.variant_id==='MAIN-CUT'||x.variant_type==='MAIN_CUT'),r=preferredRoute(state,h.platform,{asset_id:a.asset_id,variant_id:v.variant_id},true);const obj=objectiveFor(h.platform,r),cta=ctaFor(h.platform,obj.code,r),timing=postingWindowFor(state,h.platform);const p={prescription_id:uid('RX'),revision_of:null,status:'PRESCRIBED',action_kind:'HISTORICAL_UPDATE',historical_publication_id:h.historical_publication_id,created_at:nowISO(),platform:h.platform,objective_code:'OPTIMIZE_EXISTING',objective:`Prospectively improve an existing ${h.platform} item while preserving historical truth.`,asset_id:a.asset_id,variant_id:v.variant_id,route_id:r.route_id,attribution_ceiling:calculateAttributionCeiling(r,{asset_id:a.asset_id,variant_id:v.variant_id}),exact_action:`Publish the prepared replacement variant ${v.variant_id}; do not erase the historical record.`,cta:cta.text,cta_basis:cta.basis,posting_window:timing.window,posting_window_basis:timing.basis,reason_summary:review.reason,creator_authorization_status:a.authorization_status,measurement_plan:{due_hours:state.settings.measurementHours,fields:['views','tracked_clicks','free_joins','paid_conversions','manyvids_sales','gross_revenue']},data_confidence:'OPERATIONAL ONLY — No conversion-lift claim possible at current sample',frozen_snapshot:null};state.prescriptions.push(p);appendAudit(state,'PRESCRIPTION',p.prescription_id,'HISTORICAL_UPDATE_PRESCRIBED',{historical_publication_id:h.historical_publication_id});return p;}
export function createBrandShoot(state,{name,gap,brand_direction,target_platforms=[],required_assets='',notes=''}){if(!String(name||'').trim()||!String(gap||'').trim())throw new Error('Shoot name and evidence gap are required.');const s={shoot_id:uid('SHOOT'),name:String(name).trim(),gap:String(gap).trim(),brand_direction:String(brand_direction||''),target_platforms:target_platforms.filter(x=>PLATFORMS.includes(x)),required_assets:String(required_assets||''),notes:String(notes||''),status:'DRAFT',created_at:nowISO(),approved_at:null,reference_asset_ids:[],references_selected_at:null};state.brandShoots.push(s);appendAudit(state,'SHOOT',s.shoot_id,'BRAND_SHOOT_DRAFTED',{snapshot:structuredClone(s)});return s;}
export function approveBrandShoot(state,id){const s=state.brandShoots.find(x=>x.shoot_id===id);if(!s)throw new Error('Shoot not found.');if(s.status!=='DRAFT')throw new Error('Only a draft shoot can be approved.');s.status='APPROVED';s.approved_at=nowISO();appendAudit(state,'SHOOT',s.shoot_id,'BRAND_SHOOT_APPROVED',{snapshot:structuredClone(s)});return s;}

export function setBrandShootReferences(state,id,asset_ids=[]){const s=state.brandShoots.find(x=>x.shoot_id===id);if(!s)throw new Error('Shoot not found.');if(s.status!=='APPROVED')throw new Error('Approve the branch before selecting Library references.');const ids=[...new Set((asset_ids||[]).map(String))].slice(0,24);s.reference_asset_ids=ids;s.references_selected_at=nowISO();appendAudit(state,'SHOOT',s.shoot_id,'BRAND_SHOOT_REFERENCES_SELECTED',{asset_ids:[...ids]});return s;}

export function dueOutcomes(state,at=new Date()){return state.outcomes.filter(o=>o.measurement_state==='SCHEDULED'&&new Date(o.due_at)<=at);}
export function rankAssets(state,assets,{platform=''}={}){const out=[];for(const a of assets){for(const p of (platform?[platform]:effectivePlatformEligibility(a))){if(!assetEligible(a,p,{historicalAllowed:true}))continue;const r=preferredRoute(state,p),obj=objectiveFor(p,r);const vars=a.media_type==='VIDEO'?(a.variants||[]).filter(v=>v.rendered!==false):[null];for(const v of vars){const s=candidateScore(state,a,v,p,obj);out.push({asset_id:a.asset_id,variant_id:v?.variant_id||null,platform:p,score:s.score,evidence:s.evidence,n:s.n});}}}return out.sort((a,b)=>b.score-a.score);}
export function exportState(state){return structuredClone(state);}
export function mergeImport(state,incoming){if(!incoming||typeof incoming!=='object')throw new Error('Invalid import.');const allowed=['accounts','routes','prescriptions','actions','outcomes','measurementCorrections','revenueEvents','customOrders','brandShoots','historicalPublications','auditEvents'];for(const k of allowed){if(!Array.isArray(incoming[k]))continue;const idKey={accounts:'account_id',routes:'route_id',prescriptions:'prescription_id',actions:'action_id',outcomes:'outcome_id',measurementCorrections:'correction_id',revenueEvents:'revenue_event_id',customOrders:'custom_order_id',brandShoots:'shoot_id',historicalPublications:'historical_publication_id',auditEvents:'event_id'}[k];const existing=new Set(state[k].map(x=>x[idKey]));for(const row of incoming[k])if(row&&row[idKey]&&!existing.has(row[idKey])){state[k].push(structuredClone(row));existing.add(row[idKey]);}}
  if(incoming.baseline?.locked&&!state.baseline.locked)state.baseline=structuredClone(incoming.baseline);appendAudit(state,'SYSTEM','IMPORT','STATE_IMPORTED',{schemaVersion:incoming.schemaVersion||null});return state;}
export function csvRows(state){const rows=[['action_id','status','platform','asset_id','variant_id','route_id','attribution_precision','executed_at','operator_role','creator_effort_minutes','measurement_state','views','tracked_clicks','free_joins','paid_conversions','manyvids_sales','gross_revenue','recorded_revenue']];for(const a of state.actions){const o=outcomeFor(state,a.action_id);rows.push([a.action_id,a.status,a.platform,a.asset_id,a.variant_id||'',a.route_id||'',a.attribution_precision||'',a.executed_at||'',a.operator_role||'',a.creator_effort_minutes??'',o?.measurement_state||'',o?.raw?.views??'',o?.raw?.tracked_clicks??'',o?.raw?.free_joins??'',o?.raw?.paid_conversions??'',o?.raw?.manyvids_sales??'',o?.raw?.gross_revenue??'',revenueFor(state,a.action_id)]);}return rows;}
export function validateAppendOnly(before,after){const pairs=[['actions','action_id'],['outcomes','outcome_id'],['revenueEvents','revenue_event_id'],['customOrders','custom_order_id'],['auditEvents','event_id'],['measurementCorrections','correction_id'],['historicalPublications','historical_publication_id'],['cropJudgements','judgement_id'],['camSessions','cam_session_id'],['libraryGaps','gap_id'],['profileCopyHistory','profile_copy_event_id']];for(const [k,id] of pairs){const b=before[k]||[],a=after[k]||[];const map=new Map(a.map(x=>[x[id],x]));for(const old of b){const cur=map.get(old[id]);if(!cur)throw new Error(`Append-only violation: ${k} removed ${old[id]}`);if(k==='auditEvents'&&JSON.stringify(cur)!==JSON.stringify(old))throw new Error(`Append-only violation: audit event changed ${old[id]}`);if(k==='actions'&&old.frozen_prescription&&JSON.stringify(cur.frozen_prescription)!==JSON.stringify(old.frozen_prescription))throw new Error(`Frozen prescription changed for ${old[id]}`);}}
  const bp=new Map((before.prescriptions||[]).filter(x=>x.frozen_snapshot).map(x=>[x.prescription_id,x.frozen_snapshot]));const ap=new Map((after.prescriptions||[]).map(x=>[x.prescription_id,x]));for(const [id,snap] of bp){const cur=ap.get(id);if(!cur)throw new Error(`Frozen prescription removed ${id}`);if(JSON.stringify(cur.frozen_snapshot)!==JSON.stringify(snap))throw new Error(`Frozen prescription snapshot changed ${id}`);}
  return true;}

export function applyCommand(state,assets,op,payload={}){switch(op){
  case 'BASELINE_CAPTURE':return captureBaseline(state,payload);
  case 'BASELINE_LOCK':return lockBaseline(state);
  case 'ROUTE_UPDATE':return updateRoute(state,payload.route_id,payload);
  case 'ROUTE_CONFIRM_PLACEMENT':return confirmRoutePlacement(state,payload.route_id,payload);
  case 'ROUTE_DEACTIVATE':return deactivateRoute(state,payload.route_id,payload);
  case 'ROUTE_CONFIG_IMPORT':return importRouteConfig(state,payload);
  case 'ROUTE_INVENTORY':return routeInventory(state);
  case 'RESERVE_TRACKING_URL':return reserveTrackingUrl(state,payload);
  case 'RECOMMEND':return generateRecommendation(state,assets);
  case 'PRESCRIBE':return createPrescription(state,generateRecommendation(state,assets));
  case 'APPROVE':return approvePrescription(state,payload.prescription_id,assets);
  case 'CHANGE':return changePrescription(state,payload.prescription_id,payload);
  case 'CTA_SELECT':return selectPrescriptionCta(state,payload);
  case 'DECLINE':return declinePrescription(state,payload.prescription_id,payload);
  case 'EXECUTE':return executeAction(state,payload.action_id,payload);
  case 'MEASURE':return recordMeasurement(state,payload.outcome_id,payload.raw);
  case 'CORRECT_MEASUREMENT':return correctMeasurement(state,payload.outcome_id,payload);
  case 'REVENUE':return recordRevenue(state,payload);
  case 'CUSTOM_ORDER':return recordCustomOrder(state,payload);
  case 'HISTORICAL_PUBLICATION':return createHistoricalPublication(state,payload);
  case 'HISTORICAL_REVIEW':return reviewHistoricalVideo(state,assets,payload);
  case 'HISTORICAL_UPDATE':return createHistoricalUpdate(state,assets,payload);
  case 'BRAND_SHOOT_CREATE':return createBrandShoot(state,payload);
  case 'BRAND_SHOOT_APPROVE':return approveBrandShoot(state,payload.shoot_id);
  case 'BRAND_SHOOT_SET_REFERENCES':return setBrandShootReferences(state,payload.shoot_id,payload.asset_ids||[]);
  case 'RANK':return rankAssets(state,assets,payload);
  case 'REPORTS':return {effort:effortEconomics(state),calibration:calibrationReport(state),overrides:overrideSignal(state),since_baseline:sinceBaseline(state),crop_evidence:cropEvidence(state),treatment_learning:treatmentLearning(state),visible_asset_learning:visibleAssetLearning(state),job_performance:jobPerformance(state),cam:camSummary(state),checklist:checklistProgress(state),baseline_coverage:baselineCoverage(state),baseline_review:baselineReview(state),cam_availability:camAvailability(state),produce:produceStatus(state)};
  case 'PROOF_PACK':return proofPack(state);
  case 'CROP_JUDGE':return recordCropJudgement(state,payload);
  case 'CROP_EVIDENCE':return cropEvidence(state);
  case 'TODAY_PLAN':return buildTodayPlan(state,assets,payload);
  case 'JOB_DIAGNOSE':return diagnoseJobHold(state,assets,payload);
  case 'JOB_REPAIR_CONTEXT':return jobRepairContext(state,assets,payload,diagnoseJobHold(state,assets,payload));
  case 'HIST_IMPORT':return importHistoricalPublications(state,payload.rows||[]);
  case 'HIST_PARSE_CSV':return parseHistoricalCsv(payload.text||'');
  case 'HIST_UPSERT':return upsertHistoricalPublication(state,payload);
  case 'HIST_SUGGEST_MATCH':return suggestHistoricalMatch(state,assets,payload.historical_publication_id);
  case 'HIST_LINK':return linkHistoricalToMaster(state,payload);
  case 'HIST_REVIEW':return setHistoricalReview(state,payload);
  case 'CHECKLIST_SET':return setChecklistItem(state,payload);
  case 'CHECKLIST':return {items:ensureChecklist(state),progress:checklistProgress(state)};
  case 'BASELINE_SNAPSHOT':return recordBaselineSnapshot(state,payload);
  case 'BASELINE_COVERAGE':return baselineCoverage(state);
  case 'CAM_SESSION':return recordCamSession(state,payload);
  case 'CAM_AVAILABILITY_SET':return setCamAvailability(state,payload);
  case 'CAM_AVAILABILITY':return camAvailability(state);
  case 'CAM_DAY_STATUS':return {day:payload.day,state:camDayStatus(state,payload.day),window:camWindowForDay(state,payload.day)};
  case 'RESULT_FIELDS':return resultFieldsFor(payload.platform);
  case 'SUGGEST_CUT':{
    const a=(assets||[]).find(x=>x.asset_id===payload.asset_id);
    if(!a||a.media_type!=='VIDEO')throw new Error('Video asset not found.');
    const src=Number(a.analysis?.duration_seconds||0);
    if(!src)throw new Error('The source duration is not known yet. Wait for processing to finish.');
    return planSuggestedCutPure(src,parseTargetDurationPure(payload.target),a.analysis||{},
      payload.segments?{segments:Number(payload.segments)}:{});
  }
  case 'TREATMENT_DEVIATION':return treatmentDeviation(state.actions.find(a=>a.action_id===payload.action_id));
  case 'BASELINE_IMPORT':return importBaseline(state,payload);
  case 'BASELINE_IMPORT_PARSE':return parseBaselineImport(payload.text!==undefined?payload.text:payload);
  case 'BASELINE_REVIEW':return baselineReview(state);
  case 'PROFILE_COPY_IMPORT':return importProfileCopy(state,payload);
  case 'PROFILE_COPY':return profileCopy(state,payload.platform||null);
  case 'PROFILE_COPY_REVIEW':return profileCopyReview(state);
  case 'LAUNCH_CHECKLIST':return creatorLaunchChecklist(state);
  case 'PROFILE_COPY_INSTALLED':return recordInstalledProfileCopy(state,payload);
  case 'BASELINE_CANDIDATE_ADAPT':return adaptBaselineCandidate(payload.text!==undefined?payload.text:payload);
  case 'SOURCE_INVENTORY':return payload&&Object.keys(payload).filter(k=>k!=='operator_role').length?recordSourceInventory(state,payload):sourceInventory(state);
  case 'LIBRARY_GAP_RECORD':return recordLibraryGap(state,payload);
  case 'PRODUCE_STATUS':return produceStatus(state);
  case 'CAM_SUMMARY':return camSummary(state);
  case 'JOB_PERFORMANCE':return jobPerformance(state);
  case 'TODAY_LIST':return buildTodayList(state,generateRecommendation(state,assets),payload);
  case 'PRESCRIBE_PICK':return createPrescriptionForPick(state,generateRecommendation(state,assets),payload);
  default:throw new Error('Unknown operation.');
}}

// ===========================================================================
// DERIVED REPORTING
// Everything below is computed from data LUXX already captures. No new state,
// no new storage, no model calls. These exist because the frozen prescription
// plus append-only outcome ledger make claims possible here that a tool without
// them cannot make honestly.
// ===========================================================================

// What an hour of the creator's own time is actually worth, per route.
// creator_effort_minutes has been captured on every executed action since v1.2
// and nothing has ever read it except a small term in the candidate score.
export function effortEconomics(state){
  const rows=new Map();
  let totalMinutes=0,totalRevenue=0,totalActions=0;
  for(const a of state.actions||[]){
    if(!['EXECUTED','MEASURED'].includes(a.status))continue;
    const mins=Number(a.creator_effort_minutes);
    if(!Number.isFinite(mins))continue;
    const rev=revenueFor(state,a.action_id);
    const key=a.route_id||'UNATTRIBUTED';
    const r=rows.get(key)||{route_id:key,platform:a.platform,minutes:0,revenue:0,n:0};
    r.minutes+=mins;r.revenue+=rev;r.n++;rows.set(key,r);
    totalMinutes+=mins;totalRevenue+=rev;totalActions++;
  }
  const list=[...rows.values()].map(r=>({...r,
    hours:Number((r.minutes/60).toFixed(2)),
    revenue_per_hour:r.minutes>0?Number((r.revenue/(r.minutes/60)).toFixed(2)):null,
    // Below 6 results this is an observation, not a rate worth acting on.
    reportable:r.n>=6
  })).sort((a,b)=>(b.revenue_per_hour??-1)-(a.revenue_per_hour??-1));
  return {
    routes:list,
    total_hours:Number((totalMinutes/60).toFixed(2)),
    total_revenue:Number(totalRevenue.toFixed(2)),
    overall_revenue_per_hour:totalMinutes>0?Number((totalRevenue/(totalMinutes/60)).toFixed(2)):null,
    actions:totalActions,
    reportable:totalActions>=6
  };
}

// Does LUXX's own ranking actually predict outcomes? Concordant/discordant pair counting
// (Kendall's tau) over comparable actions: same platform, both measured, different scores.
// A tool that freezes its prescription can grade itself. Most cannot, so most do not.
export function calibrationReport(state){
  const pts=[];
  for(const a of state.actions||[]){
    if(a.status!=='MEASURED')continue;
    const frozen=a.frozen_prescription||{};
    // Grade the predictive component only. The full candidate score includes the fatigue
    // penalty, which is a rotation mechanism; scoring it against outcomes measures scheduling
    // noise, not forecasting skill, and produces a spurious negative correlation.
    const predicted=Number(frozen.predicted_quality ?? frozen.candidate_score);
    if(!Number.isFinite(predicted))continue;
    const o=outcomeFor(state,a.action_id);
    if(!o)continue;
    const n_own=Number(a.frozen_prescription?.evidence_n_own||0);
    const actual=Number(o.raw?.paid_conversions||0)*8+Number(o.raw?.free_joins||0)*4+Number(o.raw?.manyvids_sales||0)*10+revenueFor(state,a.action_id)*0.15;
    pts.push({platform:a.platform,predicted,actual,n_own,action_id:a.action_id});
  }
  let concordant=0,discordant=0,ties=0;
  for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){
    if(pts[i].platform!==pts[j].platform)continue;
    const dp=pts[i].predicted-pts[j].predicted, da=pts[i].actual-pts[j].actual;
    if(dp===0||da===0){ties++;continue}
    if((dp>0)===(da>0))concordant++;else discordant++;
  }
  const comparable=concordant+discordant;
  const tau=comparable?Number(((concordant-discordant)/comparable).toFixed(3)):null;
  const MIN_OBS=20, BAND=0.45;
  // Deliberately NOT a self-awarded grade. A product that has earned trust by refusing green
  // chips should not spend it on a report card. This describes what the recommendations rested
  // on and, specifically, where that footing was thin.
  const thin=pts.filter(p=>Number(p.n_own||0)<6).length;
  let verdict;
  if(pts.length<MIN_OBS)verdict=`Most recommendations so far rested on very little: ${pts.length} of them have a measured result attached, and LUXX needs ${MIN_OBS} before any statement about its own ranking would mean anything.`;
  else if(comparable<10)verdict=`LUXX has not yet made enough differing calls on the same destination to say whether its ranking is carrying weight.`;
  else if(tau>=BAND)verdict=`Across ${pts.length} measured results, the option LUXX rated higher did do better more often than not. ${thin} of those recommendations still rested on fewer than 6 results for that asset.`;
  else if(tau<=-BAND)verdict=`Across ${pts.length} measured results, the option LUXX rated higher did WORSE more often than not. Your own judgement is currently the better signal — treat TODAY as a rotation aid until this turns around.`;
  else verdict=`Across ${pts.length} measured results, LUXX's ranking is not yet separating better options from worse ones. It is doing useful work as a rotation and tracking aid; it is not yet a prediction.`;
  return {samples:pts.length,comparable_pairs:comparable,concordant,discordant,ties,tau,verdict,thin_evidence:thin,
    caveat:'Pairs are not independent observations; the sample size that matters is the number of measured results, not the pair count.',
    reportable:pts.length>=MIN_OBS&&comparable>=10};
}

// The creator overriding LUXX is a signal about LUXX, not about the creator.
// Decline and change reasons have always been required and stored, and never read.
export function overrideSignal(state){
  const byPlatform=new Map();
  const reasons=[];
  for(const p of state.prescriptions||[]){
    const k=p.platform||'UNKNOWN';
    const r=byPlatform.get(k)||{platform:k,prescribed:0,declined:0,revised:0};
    r.prescribed++;
    if(p.status==='DECLINED'){r.declined++;if(p.decline_reason)reasons.push({platform:k,kind:'DECLINED',reason:p.decline_reason,at:p.declined_at});}
    if(p.status==='REVISED'){r.revised++;}
    byPlatform.set(k,r);
  }
  for(const p of state.prescriptions||[])if(p.change_reason)reasons.push({platform:p.platform,kind:'CHANGED',reason:p.change_reason,at:p.created_at});
  const rows=[...byPlatform.values()].map(r=>({...r,
    override_rate:r.prescribed?Number(((r.declined+r.revised)/r.prescribed).toFixed(2)):0
  })).sort((a,b)=>b.override_rate-a.override_rate);
  const worst=rows.find(r=>r.prescribed>=5&&r.override_rate>=0.5)||null;
  return {
    rows,
    recent_reasons:reasons.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,8),
    flag:worst?`You have overridden ${Math.round(worst.override_rate*100)}% of LUXX prescriptions for ${worst.platform}. LUXX is probably wrong about that destination, not you.`:null
  };
}

// Receipts. For every executed action: exactly what LUXX froze at approval, exactly what was
// done, exactly what was measured. This is only possible because the prescription is frozen
// and the outcome ledger is append-only.
export function proofPack(state){
  const rows=[];
  for(const a of state.actions||[]){
    if(!['EXECUTED','MEASURED'].includes(a.status))continue;
    const f=a.frozen_prescription||{};
    const o=outcomeFor(state,a.action_id);
    const corrections=(state.measurementCorrections||[]).filter(c=>o&&c.outcome_id===o.outcome_id);
    rows.push({
      action_id:a.action_id,
      prescribed_at:f.created_at||null,
      approved_at:a.approved_at||null,
      executed_at:a.executed_at||null,
      luxx_said:{platform:f.platform,asset_id:f.asset_id,variant_id:f.variant_id,route_id:f.route_id,cta:f.cta,posting_window:f.posting_window,objective:f.objective,evidence_tier:f.evidence_tier||null,candidate_score:f.candidate_score??null},
      creator_did:{execution_reference:a.execution_reference||null,operator_role:a.operator_role||null,creator_effort_minutes:a.creator_effort_minutes??null},
      measured:o?{state:o.measurement_state,raw:o.raw,measured_at:o.measured_at||null}:null,
      corrections:corrections.map(c=>({at:c.created_at,reason:c.reason,previous:c.previous_raw,corrected:c.new_raw})),
      attribution_precision:a.attribution_precision||'UNATTRIBUTED',
      revenue:Number(revenueFor(state,a.action_id).toFixed(2))
    });
  }
  return {
    creator:state.creator?.display_name||'Creator',
    baseline_locked_at:state.baseline?.locked_at||null,
    baseline_evidence:state.baseline?.evidence_reference||null,
    generated_at:nowISO(),
    actions:rows.sort((a,b)=>String(b.executed_at||'').localeCompare(String(a.executed_at||''))),
    note:'Every row is the prescription frozen at approval time, not a reconstruction. Rows with attribution_precision PARTIAL or UNATTRIBUTED cannot be causally credited to LUXX.'
  };
}

// Everything that has happened since the baseline was locked. Honest denominator.
export function sinceBaseline(state){
  const at=state.baseline?.locked_at;
  if(!at||!state.baseline?.locked)return {locked:false,note:'Baseline is not locked, so LUXX has no honest before-state to compare against.'};
  const after=(state.actions||[]).filter(a=>a.executed_at&&a.executed_at>=at);
  const measured=after.filter(a=>a.status==='MEASURED');
  let revenue=0,exact=0;
  for(const a of after){revenue+=revenueFor(state,a.action_id);if(a.attribution_precision==='EXACT')exact++;}
  const days=Math.max(1,Math.round((Date.now()-Date.parse(at))/86400000));
  return {
    locked:true,locked_at:at,days,
    actions:after.length,measured:measured.length,
    revenue:Number(revenue.toFixed(2)),
    exactly_attributed:exact,
    // The only revenue LUXX may claim is the exactly-attributed portion.
    claimable_note:exact?`${exact} of ${after.length} actions carry EXACT attribution. Only those can be credited to LUXX.`:'No action yet carries EXACT attribution, so no revenue can be causally credited to LUXX.'
  };
}

// ===========================================================================
// CROP EVIDENCE — the falsification channel for the next intelligence claim
//
// LUXX cannot see where a face, hand or foot is. It therefore must not claim a crop is good.
// The temptation is to leave that as a permanent apology. Instead this records the one piece
// of ground truth that would let a future claim be tested: did the creator keep the crop or
// throw it away.
//
// Nothing here makes LUXX smarter. It makes the NEXT step falsifiable, and it exists before
// the claim rather than after it. When a cheap face/subject detector is added, its narrow
// claim ("this crop keeps the subject in frame") can be scored against these labels instead
// of being asserted.
// ===========================================================================
export function recordCropJudgement(state,{asset_id,variant_id,verdict,aspect='',reason=''}){
  if(!['KEPT','REJECTED'].includes(verdict))throw new Error('Crop verdict must be KEPT or REJECTED.');
  if(!asset_id||!variant_id)throw new Error('Crop judgement requires an asset and a variant.');
  const j={judgement_id:uid('CROPJ'),asset_id:String(asset_id),variant_id:String(variant_id),
    aspect:String(aspect||''),verdict,reason:String(reason||'').slice(0,300),created_at:nowISO()};
  state.cropJudgements=state.cropJudgements||[];
  state.cropJudgements.push(j);
  appendAudit(state,'CROP',j.judgement_id,'CROP_JUDGED',{snapshot:structuredClone(j)});
  return j;
}
export function cropEvidence(state){
  const rows=state.cropJudgements||[];
  const byAspect=new Map();
  for(const r of rows){
    const k=r.aspect||'UNKNOWN';
    const v=byAspect.get(k)||{aspect:k,kept:0,rejected:0};
    if(r.verdict==='KEPT')v.kept++;else v.rejected++;
    byAspect.set(k,v);
  }
  const list=[...byAspect.values()].map(v=>({...v,n:v.kept+v.rejected,
    keep_rate:v.kept+v.rejected?Number((v.kept/(v.kept+v.rejected)).toFixed(2)):null}));
  const total=rows.length,kept=rows.filter(r=>r.verdict==='KEPT').length;
  // 20 was a pilot number and better-than-chance on 20 is a coin with a story. The floor for
  // even DISCUSSING auto-recommendation is 50 creator-labelled crops, scored by balanced
  // accuracy (raw accuracy is meaningless when keeps and rejects are unbalanced) on a HOLDOUT
  // the signal was not tuned against. AUTO is deliberately NOT wired to this number.
  const MIN=50, HOLDOUT_MIN=20;
  return {
    total,kept,rejected:total-kept,
    keep_rate:total?Number((kept/total).toFixed(2)):null,
    by_aspect:list,
    reportable:total>=MIN,
    // The claim this evidence would license, and the bar it must clear. Stated up front so it
    // cannot be quietly moved once results are in.
    balance:{kept_share:total?Number((kept/total).toFixed(2)):null,
      // A degenerate label set cannot validate anything, however many rows it has.
      usable:total>=MIN&&kept>=HOLDOUT_MIN/2&&(total-kept)>=HOLDOUT_MIN/2},
    next_claim:`LUXX may begin auto-recommending a cropped variant only when a crop-quality signal beats chance on BALANCED ACCURACY (not raw accuracy), measured on a holdout of at least ${HOLDOUT_MIN} creator-labelled crops that the signal was not tuned on, drawn from at least ${MIN} total judged crops with both verdicts well represented. Labels must come from the creator, not from whoever built the signal. Nothing is wired to this number: clearing it authorises a conversation, not an automatic behaviour change.`,
    status:total>=MIN
      ?`${total} judged crops on record — enough to START testing a crop-quality signal against a holdout. AUTO BEST stays on the full frame until one passes.`
      :`${total} of ${MIN} judged crops. LUXX keeps AUTO BEST on the full frame and makes no crop-quality claim.`
  };
}

// ===========================================================================
// TODAY'S PICK — the product
//
// A short list of real files already in the library, each with a plain reason drawn from the
// creator's own measured results, and a GUESS stamp wherever that footing is thin.
//
// The stamp is the point. Anyone can ship "suggested posts". Almost nobody will print
// "we are guessing" on their own recommendation. This is the same refusal already applied to
// crops, on the one screen that matters.
//
// LUXX does not post, message, schedule, or generate anything. It names files that already
// exist and says how confident it is about each one.
// ===========================================================================
export const CALL_THRESHOLD=6;   // minimum qualifying sample of COMPARABLE measured results.
// Reaching it is necessary and never sufficient: favourable evidence is also required, and for
// locked PPV the comparable unit is the pre-purchase treatment, never the hidden file.
export const TODAY_MIN=3;
export const TODAY_MAX=7;

function daysSince(iso,now=Date.now()){
  const t=iso?Date.parse(iso):NaN;
  return Number.isFinite(t)?Math.max(0,Math.round((now-t)/86400000)):null;
}

// Why this file, in the creator's terms. Never "the model liked it".
export function pickReason(state,asset_id,n_own,now=Date.now(),evidence_object='ASSET'){
  const u=assetUsage(state,asset_id,now);
  const d=daysSince(u.last_used_at,now);
  const history=!u.use_count?'never posted through LUXX'
    :d===0?'used today'
    :d===1?'last used yesterday'
    :`last used ${d} days ago`;
  const treatment=evidence_object==='TREATMENT';
  let evidence;
  if(treatment){
    // The unit of evidence is the pre-purchase treatment. The hidden file has no record.
    if(n_own>=30)evidence=`consistently your strongest pre-purchase treatment across ${n_own} comparable measured sends`;
    else if(n_own>=16)evidence=`your best pre-purchase treatment here — ${n_own} comparable measured sends`;
    else if(n_own>=CALL_THRESHOLD)evidence=`working for you so far — ${n_own} comparable measured sends for this treatment`;
    else if(n_own>=1)evidence=`only ${n_own} comparable measured send${n_own===1?'':'s'} for this treatment`;
    else evidence='LUXX has never measured this pre-purchase treatment';
  }else{
    if(n_own>=30)evidence=`consistently your strongest here across ${n_own} measured results`;
    else if(n_own>=16)evidence=`your best performer on this route — ${n_own} measured results`;
    else if(n_own>=CALL_THRESHOLD)evidence=`working for you so far — ${n_own} measured results`;
    else if(n_own>=1)evidence=`only ${n_own} measured result${n_own===1?'':'s'} on this photo`;
    else evidence='LUXX has never measured this photo';
  }
  return {evidence,history,evidence_object:treatment?'TREATMENT':'ASSET',
    text:`${evidence.charAt(0).toUpperCase()+evidence.slice(1)}; ${history}.`};
}


// TODAY prescribes the FULL pre-purchase treatment alongside the hidden asset. If a treatment
// class already carries qualifying evidence in this scope, propose that one; otherwise propose
// a concrete, actionable default which by definition carries no evidence and stays GUESS.
export function proposeTreatment(state,route,variant){
  if(!route||!makesConversionClaim(route))return null;
  const scope=scopeKeyForRoute(route);
  const delivery=deliveryModeFor(route);
  const band=priceBandFor(variant?.price_if_applicable);
  const tally=new Map();
  for(const a of state.actions||[]){
    if(a.status!=='MEASURED')continue;
    const t=a.executed_treatment;
    if(!t||t.scope!==scope||t.price_band!==band)continue;
    if(!(Number(a.sent_to)>0))continue;
    const k=treatmentKey(t);if(!k)continue;
    const o=outcomeFor(state,a.action_id);if(!o)continue;
    const v=tally.get(k)||{t,n:0,sum:0};
    v.n++;v.sum+=actionSignal(state,a,o);tally.set(k,v);
  }
  const best=[...tally.values()].filter(v=>v.n>=CALL_THRESHOLD&&v.sum>0).sort((a,b)=>(b.sum/b.n)-(a.sum/a.n))[0];
  if(best)return {...best.t};
  return {preview_style:'BLURRED_CLOSE_CROP',delivery_mode:delivery,audience_segment:'ACTIVE_SUBSCRIBERS',price_band:band,scope};
}
// One line per ASSET, not per asset-platform pair. Showing the same photo five times because it
// is eligible on five destinations is a warehouse tour, not a pick.
export function buildTodayList(state,rec,{limit=5,now=Date.now()}={}){
  if(!rec?.ready)return {ready:false,reason:rec?.reason||'No valid recommendation yet.',fix:rec?.fix||'',lines:[]};
  const cap=Math.max(TODAY_MIN,Math.min(TODAY_MAX,Number(limit)||5));
  const bestPerAsset=new Map();
  for(const c of rec.candidates||[]){
    const prev=bestPerAsset.get(c.asset.asset_id);
    if(!prev||c.score.score>prev.score.score)bestPerAsset.set(c.asset.asset_id,c);
  }
  const ordered=[...bestPerAsset.values()].sort((a,b)=>b.score.score-a.score.score).slice(0,cap);
  const lines=ordered.map((c,i)=>{
    const n_own=Number(c.score.n_own||0);
    const isConversion=!!c.score.conversion_claim;
    const treatment=isConversion?proposeTreatment(state,c.route,c.variant):null;
    // CALL requires: enough COMPARABLE observations, in the same treatment class and attribution
    // scope, each carrying a real denominator, AND favourable evidence. Six zero-unlock results
    // are six observations and still not a CALL.
    const qualifies=n_own>=CALL_THRESHOLD&&!!c.score.favorable&&(!isConversion||!!c.score.treatment_key);
    const stamp=qualifies?'CALL':'GUESS';
    const treatment_label=treatment?treatmentLabel(treatment):'';
    const reason=pickReason(state,c.asset.asset_id,n_own,now,isConversion?'TREATMENT':'ASSET');
    return {
      rank:i+1,
      asset_id:c.asset.asset_id,
      asset_name:c.asset.name||c.asset.asset_id,
      variant_id:c.variant?.variant_id||null,
      media_type:c.asset.media_type,
      platform:c.platform,
      route_id:c.route.route_id,
      placement:c.route.placement||c.route.intended_placement||'',
      destination:c.route.destination||'',
      objective:c.objective.label,
      cta:c.cta.text,
      cta_options:c.cta.options||[],
      posting_window:c.timing.window,
      stamp,
      // The stamp names the TREATMENT, never the photo. A PPV buyer never saw the master, so
      // unlock revenue can never make the hidden file a proven seller.
      stamp_object:isConversion?'TREATMENT':'ASSET',
      treatment:treatment||null,
      treatment_label,
      stamp_subject:isConversion?treatment_label:`this photo on ${c.platform}`,
      stamp_note:isConversion
        ?(stamp==='CALL'
          ?`CALL — ${n_own} comparable measured sends for this treatment: ${treatment_label}. This is evidence about the treatment, not about the photo.`
          :`GUESS — LUXX does not have ${CALL_THRESHOLD} comparable measured sends for this treatment: ${treatment_label}. The buyer never sees the file before paying, so the photo itself cannot earn a CALL.`)
        :(stamp==='CALL'
          ?`CALL — ${n_own} measured results for this photo in this exact placement.`
          :`GUESS — fewer than ${CALL_THRESHOLD} comparable measured results in this placement. LUXX is going on rotation and eligibility, not on evidence that it earns.`),
      why:reason.text,
      evidence_n:n_own,
      evidence_tier:c.score.evidence_tier
    };
  });
  const calls=lines.filter(l=>l.stamp==='CALL').length;
  return {
    ready:true,
    lines,
    calls,
    guesses:lines.length-calls,
    // The honest headline. If nothing is a call, say so first rather than burying it.
    headline:calls?`${calls} call${calls===1?'':'s'}, ${lines.length-calls} guess${lines.length-calls===1?'':'es'}.`
      :`All ${lines.length} are guesses. LUXX does not yet have ${CALL_THRESHOLD} measured results on any of these photos.`,
    promise:'These are files you already shot. LUXX does not post, message, schedule, or generate anything.'
  };
}

// Approve a specific line rather than whatever happened to rank first.
export function createPrescriptionForPick(state,rec,{asset_id,variant_id=null,platform,job_class=null,job_intent=null}){
  if(!rec?.ready)throw new Error(rec?.reason||'Recommendation is not ready.');
  const same=(rec.candidates||[]).filter(c=>c.asset.asset_id===asset_id&&c.platform===platform&&((c.variant?.variant_id||null)===(variant_id||null)));
  const job=job_intent?{platform,intent:job_intent}:null;
  const match=(job?same.find(c=>candidateFitsJob(state,c,job)):null)||same[0];
  if(!match)throw new Error('That pick is no longer available. Reload TODAY and choose again.');
  return createPrescription(state,{ready:true,candidate:{...match,job_class,job_intent},candidates:rec.candidates});
}

// RESULTS must use the same contract. Asset-level learning is kept ONLY where the audience
// actually saw the file before acting. For locked PPV the learned object is the treatment.
export function treatmentLearning(state){
  const t=new Map();
  for(const a of state.actions||[]){
    if(a.status!=='MEASURED')continue;
    const key=a.executed_treatment_key;
    if(!key||!(Number(a.sent_to)>0))continue;
    const o=outcomeFor(state,a.action_id);if(!o)continue;
    const v=t.get(key)||{key,label:treatmentLabel(a.executed_treatment),n:0,sent:0,unlocks:0,revenue:0};
    v.n++;v.sent+=Number(a.sent_to);
    v.unlocks+=Number(o.raw?.ppv_purchases??o.raw?.paid_conversions??0);
    v.revenue+=revenueFor(state,a.action_id);
    t.set(key,v);
  }
  const rows=[...t.values()].map(v=>({...v,
    revenue:Number(v.revenue.toFixed(2)),
    unlock_rate:v.sent?Number((v.unlocks/v.sent).toFixed(4)):null,
    rev_per_recipient:v.sent?Number((v.revenue/v.sent).toFixed(2)):null,
    reportable:v.n>=CALL_THRESHOLD
  })).sort((a,b)=>(b.rev_per_recipient??-1)-(a.rev_per_recipient??-1));
  const best=rows.find(r=>r.reportable)||null;
  return {rows,best,
    headline:best?`Best current PPV treatment: ${best.label}`:'Not enough comparable PPV sends yet to name a best treatment.',
    note:'PPV buyers pay before seeing the file, so this names the pre-purchase treatment, never the hidden photo.'};
}
// Asset-level learning, scoped honestly: only where the file was visible before the action.
export function visibleAssetLearning(state){
  const m=new Map();
  for(const a of state.actions||[]){
    if(a.status!=='MEASURED')continue;
    const r=(state.routes||[]).find(x=>x.route_id===a.route_id);
    if(r&&makesConversionClaim(r))continue;      // locked PPV: the master was never seen
    const o=outcomeFor(state,a.action_id);if(!o)continue;
    const v=m.get(a.asset_id)||{id:a.asset_id,score:0,n:0};
    v.score+=Number(o.raw?.paid_conversions||0)*8+Number(o.raw?.free_joins||0)*4+Number(o.raw?.tracked_clicks||0);
    v.n++;m.set(a.asset_id,v);
  }
  const rows=[...m.values()].sort((a,b)=>b.score-a.score);
  return {rows,best:rows[0]||null,
    note:'Only placements where the audience actually saw the file before acting are counted here.'};
}

// ===========================================================================
// WEEK-1 OPERATING PLAN — TODAY AS A DAILY MONEY PLAN
//
// TODAY is organised by JOB first, then LUXX picks the best eligible asset/treatment INSIDE
// that job. A Pornhub teaser, an OF PPV, an OF wall post and a cam shift are different jobs and
// must never compete for one global #1 score.
//
// The schedule below is a FROZEN OPERATIONAL PRIOR. It is not creator-specific proof and every
// line carries DEFAULT/GUESS until RESULTS earns something stronger.
// ===========================================================================
export const JOB_CLASSES=['MONETIZE','ACQUIRE','LIVE','PRODUCE'];
export const PILOT_TIMEZONE='America/Chicago';
export const MAX_JOBS_NORMAL=4;
export const MAX_JOBS_CAM=5;

// ---------------------------------------------------------------------------
// CAM AVAILABILITY — CONFIGURED, NEVER HARD-CODED
// v1.7.0 RC1 shipped a fixed '8:00-11:00 PM Central' cam window and fixed cam days.
// Neither was ever confirmed by the creator. Both are removed. LUXX now ships with
// NOTHING scheduled and refuses to invent a LIVE time until the exact weekday
// availability is configured in SETUP.
//
// Saturday and Sunday are a hard constraint. They cannot be enabled from anywhere:
// not from settings, not from an import, not from a schedule entry.
// ---------------------------------------------------------------------------
export const CAM_WEEKDAYS=['MON','TUE','WED','THU','FRI'];
export const CAM_FORBIDDEN_DAYS=['SAT','SUN'];
export const CAM_NOT_CONFIGURED_LABEL='SETUP REQUIRED — CAM AVAILABILITY NOT FINALIZED';

function parseClock(v){
  const m=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v==null?'':v).trim());
  return m?Number(m[1])*60+Number(m[2]):null;
}
export function clockLabel(mins){
  if(!Number.isFinite(mins))return '';
  const h=Math.floor(mins/60),m=mins%60,suffix=h<12?'AM':'PM',twelve=h%12===0?12:h%12;
  return `${twelve}:${String(m).padStart(2,'0')} ${suffix}`;
}
// A datetime-local input has no timezone. RC1 handed that bare wall-clock string
// straight to Date.parse, which reads it as UTC -- so a real 9:05 AM Central cam
// session resolved to 4:05 AM Central and was flagged as outside the window. A
// zoneless timestamp is the creator's wall clock and is resolved in her timezone.
export function hasExplicitZone(v){return /(?:Z|[+-]\d{2}:?\d{2})$/.test(String(v==null?'':v).trim());}
function zoneOffsetMinutes(ms,timezone){
  const dtf=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const parts={};for(const p of dtf.formatToParts(new Date(ms)))if(p.type!=='literal')parts[p.type]=p.value;
  let hour=Number(parts.hour);if(hour===24)hour=0;
  const asUTC=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),hour,Number(parts.minute),Number(parts.second));
  return (asUTC-ms)/60000;
}
export function resolveCreatorInstant(value,timezone=PILOT_TIMEZONE){
  const raw=String(value==null?'':value).trim();
  if(!raw)return null;
  if(hasExplicitZone(raw)){const t=Date.parse(raw);return Number.isFinite(t)?new Date(t).toISOString():null;}
  const m=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if(!m){const t=Date.parse(raw);return Number.isFinite(t)?new Date(t).toISOString():null;}
  const naive=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]||0));
  let ms=naive-zoneOffsetMinutes(naive,timezone)*60000;
  ms=naive-zoneOffsetMinutes(ms,timezone)*60000;   // second pass settles DST boundaries
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
export function minutesInTimezone(iso,timezone){
  if(!iso||!timezone)return null;
  try{
    const d=new Date(iso);if(Number.isNaN(d.getTime()))return null;
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(d);
    const o={};for(const x of parts)if(x.type!=='literal')o[x.type]=x.value;
    let h=Number(o.hour);if(h===24)h=0;
    return h*60+Number(o.minute);
  }catch{return null}
}
export function emptyCamAvailability(){return {configured:false,days:[],earliest_start:'',latest_end:'',start_minutes:null,end_minutes:null,timezone:'',configured_at:null};}
export function setCamAvailability(state,{days=[],earliest_start,latest_end,timezone,day_windows=null,unavailable_days=null}={}){
  const clean=[...new Set((days||[]).map(x=>String(x==null?'':x).toUpperCase().slice(0,3)))];
  const weekend=clean.filter(x=>CAM_FORBIDDEN_DAYS.includes(x));
  if(weekend.length)throw new Error('Saturday and Sunday cam is not available. Weekend LIVE cannot be enabled.');
  const bad=clean.filter(x=>!CAM_WEEKDAYS.includes(x));
  if(bad.length)throw new Error(`Not an allowed weekday: ${bad.join(', ')}`);
  const dayWindowKeys=Object.keys(day_windows||{}).map(x=>String(x).toUpperCase().slice(0,3));
  if(!clean.length&&!dayWindowKeys.length)throw new Error('Choose at least one weekday.');
  const s=parseClock(earliest_start),e=parseClock(latest_end);
  if((s===null||e===null)&&!dayWindowKeys.length)throw new Error('Enter earliest start and latest end as 24-hour HH:MM.');
  if(s!==null&&e!==null&&e<=s)throw new Error('Latest end must be after earliest start.');
  const tz=String(timezone||state?.settings?.creatorTimezone||PILOT_TIMEZONE);
  try{new Intl.DateTimeFormat('en-US',{timeZone:tz});}catch{throw new Error('Unknown timezone.');}
  // Optional per-day windows. Where a day has its own window it overrides the shared one;
  // days omitted entirely stay UNDECLARED rather than being assumed unavailable.
  const windows={};
  for(const [day,w] of Object.entries(day_windows||{})){
    const dd=String(day||'').toUpperCase().slice(0,3);
    if(CAM_FORBIDDEN_DAYS.includes(dd))throw new Error('Saturday and Sunday cam is not available.');
    if(!CAM_WEEKDAYS.includes(dd))throw new Error(`Not an allowed weekday: ${dd}`);
    const ws=parseClock(w.start??w.earliest_start),we=parseClock(w.end??w.latest_end);
    if(ws===null||we===null)throw new Error(`Enter ${dd} start and end as 24-hour HH:MM.`);
    if(we<=ws)throw new Error(`${dd} end must be after its start.`);
    windows[dd]={start:w.start??w.earliest_start,end:w.end??w.latest_end,start_minutes:ws,end_minutes:we};
  }
  const declaredDays=CAM_WEEKDAYS.filter(d=>clean.includes(d)||windows[d]);
  const unavailable=[...new Set([...CAM_FORBIDDEN_DAYS,...(unavailable_days||[]).map(x=>String(x).toUpperCase().slice(0,3))])];
  const cfg={configured:true,days:declaredDays,
    earliest_start:String(earliest_start).trim(),latest_end:String(latest_end).trim(),
    start_minutes:s,end_minutes:e,timezone:tz,
    day_windows:windows,
    unavailable_days:unavailable,
    undeclared_days:CAM_WEEKDAYS.filter(d=>!declaredDays.includes(d)&&!unavailable.includes(d)),
    configured_at:nowISO()};
  state.settings=state.settings||{};
  state.settings.camAvailability=cfg;
  appendAudit(state,'SETTINGS','CAM_AVAILABILITY','CAM_AVAILABILITY_SET',{snapshot:structuredClone(cfg)});
  return cfg;
}
export function camAvailability(state){
  const c=state?.settings?.camAvailability;
  if(!c||!c.configured)return {...emptyCamAvailability(),label:CAM_NOT_CONFIGURED_LABEL,
    window_label:'',
    note:'LUXX will not invent a cam time. Set the exact weekday availability in SETUP → CAM AVAILABILITY. Saturday and Sunday remain unavailable.'};
  const perDay=Object.keys(c.day_windows||{}).length
    ? c.days.map(d=>`${d} ${clockLabel((c.day_windows[d]||c).start_minutes)}–${clockLabel((c.day_windows[d]||c).end_minutes)}`).join(' · ')
    : `${c.days.join(', ')} · ${clockLabel(c.start_minutes)}–${clockLabel(c.end_minutes)}`;
  return {...c,label:`${perDay} ${c.timezone}`,
    day_states:Object.fromEntries([...CAM_WEEKDAYS,...CAM_FORBIDDEN_DAYS].map(d=>[d,camDayStatus(state,d)])),
    window_label:`${clockLabel(c.start_minutes)}–${clockLabel(c.end_minutes)} ${c.timezone}`,
    note:'Availability is a constraint, not evidence. The chosen time stays GUESS / DEFAULT until creator-specific measured results say otherwise.'};
}
export const CAM_DAY_STATES=['AVAILABLE','UNAVAILABLE','UNDECLARED','NOT_CONFIGURED'];
// Per-day availability. A weekday with no declaration is UNDECLARED, never "unavailable".
export function camDayStatus(state,code){
  const c=state?.settings?.camAvailability;
  if(CAM_FORBIDDEN_DAYS.includes(code))return 'UNAVAILABLE';
  if(!c||!c.configured)return 'NOT_CONFIGURED';
  if((c.days||[]).includes(code))return 'AVAILABLE';
  if((c.unavailable_days||[]).includes(code))return 'UNAVAILABLE';
  return 'UNDECLARED';
}
export function camWindowForDay(state,code){
  const c=state?.settings?.camAvailability;
  if(!c||!c.configured||camDayStatus(state,code)!=='AVAILABLE')return null;
  const w=(c.day_windows||{})[code];
  const startM=w?w.start_minutes:c.start_minutes, endM=w?w.end_minutes:c.end_minutes;
  return {start_minutes:startM,end_minutes:endM,label:`${clockLabel(startM)}–${clockLabel(endM)} ${c.timezone}`};
}
export function camAllowedOnDay(state,code){
  if(CAM_FORBIDDEN_DAYS.includes(code))return false;
  const c=state?.settings?.camAvailability;
  if(!c||!c.configured)return false;
  return (c.days||[]).includes(code);
}
// A proposed LIVE slot must sit inside the configured window on an allowed weekday.
export function camSlotAllowed(state,{day,start,end}={}){
  const st=camDayStatus(state,day);
  if(st!=='AVAILABLE')return {allowed:false,day_state:st,reason:
    st==='UNAVAILABLE'?(CAM_FORBIDDEN_DAYS.includes(day)?'Saturday and Sunday cam is not available.':'That weekday was declared unavailable.')
    :st==='UNDECLARED'?'Availability for that weekday has not been declared. LUXX will not assume it.'
    :'Cam availability has not been configured.'};
  const w=camWindowForDay(state,day);
  const s=parseClock(start),e=parseClock(end);
  if(s===null||e===null)return {allowed:false,reason:'A LIVE slot needs a start and an end.'};
  if(s<w.start_minutes||e>w.end_minutes)return {allowed:false,reason:`Outside the declared ${day} window ${clockLabel(w.start_minutes)}–${clockLabel(w.end_minutes)}.`};
  if(e<=s)return {allowed:false,reason:'End must be after start.'};
  return {allowed:true,reason:''};
}

// ---------------------------------------------------------------------------
// PRODUCE GATE — OFF UNTIL A LIBRARY / FUNNEL GAP IS DOCUMENTED
// The creator is uploading her existing library. LUXX does not know that she needs
// new production, so it must not prescribe a shoot. An empty calendar slot is not a
// gap. A gap is a counted shortfall recorded against the reviewed Library.
// ---------------------------------------------------------------------------
export const LIBRARY_GAP_TYPES=['X_FACE_SAFE_TEASER','PH_TEASER_DERIVATIVE','PPV_INVENTORY','PAID_WALL_INVENTORY','VERTICAL_ACQUISITION','CREATIVE_VARIETY'];
export function recordLibraryGap(state,{gap_type,evidence_reference,counted_have,counted_needed,notes=''}){
  if(!LIBRARY_GAP_TYPES.includes(gap_type))throw new Error(`Unknown gap type: ${gap_type}`);
  if(!String(evidence_reference||'').trim())throw new Error('A documented gap needs an evidence reference from the reviewed Library.');
  const have=Number(counted_have),need=Number(counted_needed);
  if(!Number.isFinite(have)||!Number.isFinite(need))throw new Error('A documented gap needs counted have and counted needed.');
  if(have>=need)throw new Error('That is not a gap: counted inventory already meets the counted need.');
  const g={gap_id:uid('GAP'),gap_type,evidence_reference:String(evidence_reference).trim(),
    counted_have:have,counted_needed:need,shortfall:need-have,notes:String(notes||'').slice(0,1000),
    status:'DOCUMENTED',created_at:nowISO()};
  state.libraryGaps=state.libraryGaps||[];
  state.libraryGaps.push(g);
  appendAudit(state,'LIBRARY_GAP',g.gap_id,'LIBRARY_GAP_DOCUMENTED',{snapshot:structuredClone(g)});
  return g;
}
export function documentedGaps(state){return (state?.libraryGaps||[]).filter(g=>g.status==='DOCUMENTED');}
export function produceStatus(state){
  const gaps=documentedGaps(state);
  return {active:gaps.length>0,gaps,
    reason:gaps.length?`${gaps.length} documented Library/funnel gap(s).`:'PRODUCE is OFF. No documented Library or funnel gap has been recorded against the reviewed Library.',
    note:'Existing authorized media comes first. A shoot is never scheduled because the calendar has room. If inventory is sufficient, NO NEW SHOOT NEEDED is the correct answer.'};
}
export function produceAllowed(state){return documentedGaps(state).length>0;}

// A Pornhub teaser job may only take a real teaser/trailer derivative. A MAIN CUT, a
// full scene, or a generic Pornhub-eligible video is never an acceptable substitute.
export const TEASER_VARIANT_TYPES=['TEASER','TRAILER'];
export const FULL_CUT_VARIANT_TYPES=['MAIN_CUT','FULL_SCENE','FULL','ORIGINAL','MASTER'];
export function isTeaserDerivative(variant){
  if(!variant)return false;
  const t=String(variant.variant_type||'').toUpperCase();
  const id=String(variant.variant_id||'').toUpperCase();
  if(FULL_CUT_VARIANT_TYPES.includes(t))return false;
  if(id==='MAIN-CUT'||id==='MAIN_CUT')return false;
  return TEASER_VARIANT_TYPES.includes(t);
}

// intent -> what LUXX is trying to accomplish, and which platform/placement satisfies it.
// LIVE is deliberately absent: cam days come from configured availability, never from a
// frozen schedule. PPV monetization is OnlyFans PAID; Free is nurture/conversion only.
export const WEEK1_SCHEDULE={
  MON:[{job:'MONETIZE',intent:'OF_PAID_WALL',platform:'OnlyFans Paid',label:'OnlyFans Paid wall / value post'},
       {job:'ACQUIRE',intent:'X_TEASER',platform:'X',label:'One X teaser'}],
  TUE:[{job:'MONETIZE',intent:'OF_WALL_REENGAGE',platform:'OnlyFans Free',label:'OnlyFans Free wall / re-engagement'},
       {job:'ACQUIRE',intent:'X_TEASER',platform:'X',label:'One X teaser'}],
  WED:[{job:'MONETIZE',intent:'PPV_DM',platform:'OnlyFans Paid',label:'One PPV DM on OnlyFans Paid'},
       {job:'ACQUIRE',intent:'PH_TEASER',platform:'Pornhub',label:'One Pornhub teaser / trailer'}],
  THU:[{job:'MONETIZE',intent:'OF_WALL_VALUE',platform:'OnlyFans Free',label:'OnlyFans Free wall / BTS / value'},
       {job:'ACQUIRE',intent:'ONE_DISCOVERY',platform:'X',label:'ONE discovery action (not several)'}],
  FRI:[{job:'MONETIZE',intent:'OF_LIGHT_SUPPORT',platform:'OnlyFans Paid',label:'Light supporting paid-page activity'},
       {job:'ACQUIRE',intent:'X_TEASER',platform:'X',label:'One X teaser'}],
  SAT:[{job:'MONETIZE',intent:'PPV_DM',platform:'OnlyFans Paid',label:'One PPV DM on OnlyFans Paid'}],
  SUN:[{job:'MONETIZE',intent:'PPV_BUNDLE',platform:'OnlyFans Paid',label:'PPV / bundle or missed-week offer on OnlyFans Paid'},
       {job:'ACQUIRE',intent:'X_TEASER',platform:'X',label:'Light X'}]
};
const DAY_CODES=['SUN','MON','TUE','WED','THU','FRI','SAT'];
export function todayTimezone(state){return state?.settings?.creatorTimezone||PILOT_TIMEZONE;}
export function dayCodeFor(date=new Date(),timezone=PILOT_TIMEZONE){
  try{
    const wd=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short'}).format(new Date(date));
    const map={Sun:'SUN',Mon:'MON',Tue:'TUE',Wed:'WED',Thu:'THU',Fri:'FRI',Sat:'SAT'};
    if(map[wd])return map[wd];
  }catch{}
  // Last-resort fallback still resolves in the creator's zone rather than raw UTC.
  try{
    const wd=new Intl.DateTimeFormat('en-US',{timeZone:PILOT_TIMEZONE,weekday:'short'}).format(new Date(date));
    const map={Sun:'SUN',Mon:'MON',Tue:'TUE',Wed:'WED',Thu:'THU',Fri:'FRI',Sat:'SAT'};
    if(map[wd])return map[wd];
  }catch{}
  return DAY_CODES[new Date(date).getUTCDay()];
}
// The creator-local calendar date, so a Sunday evening in Central never previews Monday
// just because UTC has already rolled over.
export function creatorLocalDateParts(date=new Date(),timezone=PILOT_TIMEZONE){
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const [y,m,d]=f.format(new Date(date)).split('-').map(Number);
  return {year:y,month:m,day:d,iso_date:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`};
}
// Next occurrence of a day code, counted forward from the creator-local date.
export function dateForDayCode(code,{from=new Date(),timezone=PILOT_TIMEZONE}={}){
  const today=dayCodeFor(from,timezone);
  const delta=(DAY_CODES.indexOf(code)-DAY_CODES.indexOf(today)+7)%7;
  const {iso_date}=creatorLocalDateParts(from,timezone);
  const base=new Date(`${iso_date}T12:00:00Z`);
  return new Date(base.getTime()+delta*86400000).toISOString();
}
export function scheduleForDay(code){return (WEEK1_SCHEDULE[code]||[]).map(j=>({...j}));}

// Does this candidate satisfy this job? Jobs are matched on platform plus, for PPV, the
// delivery mode. A wall post and a PPV DM are different jobs even on the same platform.
// PH_TEASER additionally requires a real teaser derivative -- a full cut never qualifies.
export function candidateFitsJob(state,c,job){
  if(c.platform!==job.platform)return false;
  const mode=deliveryModeFor(c.route);
  if(job.intent==='PPV_DM')return mode==='PPV_DM';
  if(job.intent==='PPV_BUNDLE')return mode==='PPV_DM'||mode==='PPV_LOCKED_POST';
  if(job.intent==='OF_PAID_WALL'||job.intent==='OF_LIGHT_SUPPORT')return mode==='PAID_FEED';
  if(job.intent==='OF_WALL_REENGAGE'||job.intent==='OF_WALL_VALUE')return mode!=='PPV_DM'&&mode!=='PPV_LOCKED_POST';
  if(job.intent==='PH_TEASER')return isTeaserDerivative(c.variant);
  return true;
}


// ===========================================================================
// HOLD DIAGNOSTICS  (§6) and JOB-AWARE LIBRARY REPAIR (§7)
// A job that cannot run must say WHY in the creator's terms and send her to the
// right place. RC2A said "nothing eligible for this job" even when the domain knew
// the baseline was unlocked or the exact route was unverified.
// ===========================================================================
export const HOLD_CODES=['BASELINE_NOT_LOCKED','ROUTE_NOT_VERIFIED','PAID_FEED_ROUTE_NOT_READY',
  'PRIVACY_SAFE_NOT_READY','PH_TEASER_REQUIRED','VIDEO_FIELDS_INCOMPLETE','PROCESSING_INCOMPLETE',
  'AUTHORIZATION_REQUIRED','NEEDS_X_CROP_REVIEW','ALREADY_USED_TODAY','NO_QUALIFYING_MEDIA'];
export const RECOVERY_ACTIONS={FIX_SETUP:'FIX SETUP',FIX_LIBRARY:'FIX LIBRARY',CAM_AVAILABILITY:'CAM AVAILABILITY'};

// Which delivery modes actually satisfy a job intent. A job is served only by its own
// placement, so no unrelated route can gate it or stand in for it.
export function requiredDeliveryModesFor(intent){
  switch(intent){
    case 'PPV_DM':return ['PPV_DM'];
    case 'PPV_BUNDLE':return ['PPV_DM','PPV_LOCKED_POST'];
    case 'OF_PAID_WALL':
    case 'OF_LIGHT_SUPPORT':return ['PAID_FEED'];
    case 'OF_WALL_REENGAGE':
    case 'OF_WALL_VALUE':return ['POST','BIO','PINNED_POST','MESSAGE','NATIVE_FEED','PAID_FEED'];
    default:return null;   // any usable route on that platform
  }
}
// The Week-1 funnel destination each job is actually for. Naming every theoretically
// matching route (Fansly, Linktree) as a blocker is noise: only the intended placement
// gates the job, which is the ONE SOURCE + ONE PLACEMENT + ONE DESTINATION rule applied
// to diagnostics as well as to selection.
export function intendedDestinationFor(job){
  switch(job.intent){
    case 'X_TEASER':
    case 'ONE_DISCOVERY':
    case 'PH_TEASER':return 'OnlyFans Free';
    case 'OF_WALL_REENGAGE':
    case 'OF_WALL_VALUE':return 'OnlyFans Paid';
    default:return null;   // native/internal placements
  }
}
// The routes on this job's platform that could serve it, split by readiness.
export function jobRouteStatus(state,job,ctx={}){
  const modes=requiredDeliveryModesFor(job.intent);
  const dest=intendedDestinationFor(job);
  let all=(state?.routes||[]).filter(r=>r.source===job.platform&&!r.legacy_replaced_by
    &&(!modes||modes.includes(deliveryModeFor(r))));
  if(dest){
    const scoped=all.filter(r=>r.destination===dest);
    if(scoped.length)all=scoped;
  }else{
    const native=all.filter(r=>r.attribution_scope==='INTERNAL');
    if(native.length)all=native;
  }
  const sorted=all.sort((a,b)=>(Number(a.priority??100)-Number(b.priority??100))||String(a.route_id).localeCompare(String(b.route_id)));
  const usable=sorted.filter(r=>routeUsable(r,ctx));
  return {candidates:sorted.map(r=>r.route_id),usable:usable.map(r=>r.route_id),
    route:usable[0]||null,unverified:sorted.filter(r=>!routeUsable(r,ctx)).map(r=>r.route_id)};
}
function assetsForPlatform(assets,platform){
  return (assets||[]).filter(a=>effectivePlatformEligibility(a).includes(platform));
}
// The specific reason this job cannot run, plus where to send the creator.
export function diagnoseJobHold(state,assets,job,opts={}){
  const mk=(code,label,why,recovery,extra={})=>({hold:true,hold_code:code,hold_label:label,why,recovery,...extra});
  // A candidate that fits this job but was already taken by an earlier job today is a
  // rotation outcome, not a missing-media problem. Say that, rather than inventing a
  // reason the creator cannot act on.
  if(opts.fit_before_rotation>0&&opts.fit_after_rotation===0)
    return mk('ALREADY_USED_TODAY','HOLD — MEDIA ALREADY USED TODAY',
      `The only eligible media for this job is already scheduled for another job today, and LUXX does not post the same file twice in one day. Add more eligible media, or run this job on another day.`,
      RECOVERY_ACTIONS.FIX_LIBRARY,{used_asset_ids:[...(opts.used_asset_ids||[])].slice(0,24)});
  if(!state?.baseline?.locked)
    return mk('BASELINE_NOT_LOCKED','HOLD — BASELINE NOT LOCKED',
      'The before-LUXX baseline has not been captured and locked, so no prospective job can be prescribed.',
      RECOVERY_ACTIONS.FIX_SETUP);
  const rs=jobRouteStatus(state,job);
  const mediaNote=job.platform==='X'
    ?(assets||[]).filter(a=>a.authorization_status==='AUTHORIZED'&&a.availability==='AVAILABLE'&&a.x_face_safe!==true)
    :[];
  if(!rs.candidates.length)
    return mk('ROUTE_NOT_VERIFIED','HOLD — ROUTE NOT VERIFIED',
      `No route exists for ${job.platform} in the placement this job needs.`,
      RECOVERY_ACTIONS.FIX_SETUP,{route_ids:[]});
  if(!rs.usable.length){
    const paidFeed=rs.unverified.includes('OF_PAID_FEED_01');
    return mk(paidFeed?'PAID_FEED_ROUTE_NOT_READY':'ROUTE_NOT_VERIFIED',
      paidFeed?'HOLD — OF PAID FEED ROUTE NOT READY':'HOLD — ROUTE NOT VERIFIED',
      `This job needs ${rs.unverified.join(' or ')} verified and active before it can run. No other route may stand in for it.`,
      RECOVERY_ACTIONS.FIX_SETUP,{route_ids:rs.unverified,
        secondary_hold:mediaNote.length?{hold_code:'NEEDS_X_CROP_REVIEW',hold_label:'NEEDS X CROP / REVIEW',
          x_review_candidates:mediaNote.slice(0,24).map(a=>a.asset_id)}:null});
  }
  // Media side. Only assets that are eligible for THIS platform are considered.
  const pool=assetsForPlatform(assets,job.platform);
  // Authorization is checked first: an unauthorized asset has no platform eligibility at
  // all, so it would otherwise be reported as "no media" instead of "needs authorizing".
  const unauthorized=(assets||[]).filter(a=>a.authorization_status!=='AUTHORIZED');
  const quarantined=(assets||[]).filter(a=>a.authorization_status==='AUTHORIZED'&&a.availability!=='AVAILABLE');
  if(!pool.length&&(unauthorized.length||quarantined.length))
    return mk('AUTHORIZATION_REQUIRED','HOLD — AUTHORIZATION REQUIRED',
      unauthorized.length
        ?`${unauthorized.length} item${unauthorized.length===1?'':'s'} still need authorization before any job can use them. Authorize only what the creator has actually approved.`
        :`Every candidate is quarantined or unavailable.`,
      RECOVERY_ACTIONS.FIX_LIBRARY,{candidate_asset_ids:[...unauthorized,...quarantined].slice(0,24).map(a=>a.asset_id)});
  if(job.platform==='X'){
    // X is fail-closed on face. That is a review task, not a reason to discard media.
    const needsReview=(assets||[]).filter(a=>a.authorization_status==='AUTHORIZED'&&a.availability==='AVAILABLE'&&a.x_face_safe!==true);
    if(!pool.length&&needsReview.length)
      return mk('NEEDS_X_CROP_REVIEW','NEEDS X CROP / REVIEW',
        `${needsReview.length} authorized item${needsReview.length===1?'':'s'} could serve X once a face-safe crop or version is chosen and confirmed. The master is unchanged and stays usable everywhere else.`,
        RECOVERY_ACTIONS.FIX_LIBRARY,{x_review_candidates:needsReview.slice(0,24).map(a=>a.asset_id)});
  }
  if(!pool.length)
    return mk('NO_QUALIFYING_MEDIA','HOLD — NO QUALIFYING MEDIA',
      `No authorized media is eligible for ${job.platform} yet.`,RECOVERY_ACTIONS.FIX_LIBRARY);
  if(!pool.some(a=>a.authorization_status==='AUTHORIZED'))
    return mk('AUTHORIZATION_REQUIRED','HOLD — AUTHORIZATION REQUIRED',
      'The media for this job is not authorized yet. Authorize only what the creator has actually approved.',
      RECOVERY_ACTIONS.FIX_LIBRARY);
  const live=pool.filter(a=>a.authorization_status==='AUTHORIZED'&&a.availability==='AVAILABLE');
  if(!live.length)
    return mk('AUTHORIZATION_REQUIRED','HOLD — AUTHORIZATION REQUIRED',
      'Every candidate for this job is quarantined or unavailable.',RECOVERY_ACTIONS.FIX_LIBRARY);
  if(live.some(a=>a.media_type==='VIDEO'&&a.status&&a.status!=='READY_FOR_REVIEW'))
    return mk('PROCESSING_INCOMPLETE','HOLD — PROCESSING INCOMPLETE',
      'Video processing has not finished for the candidates of this job.',RECOVERY_ACTIONS.FIX_LIBRARY);
  if(!live.some(a=>(a.variants||[]).some(v=>v.privacy_safe_export===true&&v.metadata_stripped===true)))
    return mk('PRIVACY_SAFE_NOT_READY','HOLD — PRIVACY-SAFE VERSION NOT READY',
      'Privacy Shield has not produced a safe export yet. LUXX will not post an original master.',
      RECOVERY_ACTIONS.FIX_LIBRARY);
  if(job.intent==='PH_TEASER'){
    // A rendered teaser whose platform fields are still empty is not "no teaser". Saying
    // PH TEASER REQUIRED there sends the creator hunting for something she already has.
    const teasers=[];
    for(const a of live)for(const v of (a.variants||[]))if(isTeaserDerivative(v))teasers.push({a,v});
    if(teasers.length){
      const missing=[...new Set(teasers.flatMap(({v})=>variantMissingFields(v,'Pornhub')))];
      if(missing.length)
        return mk('VIDEO_FIELDS_INCOMPLETE','HOLD — VIDEO DETAILS INCOMPLETE',
          `A teaser exists but its Pornhub details are not filled in yet: ${missing.join(', ')}. Complete them in LIBRARY and this job can run.`,
          RECOVERY_ACTIONS.FIX_LIBRARY,{missing_fields:missing,
            candidate_asset_ids:[...new Set(teasers.map(({a})=>a.asset_id))].slice(0,24)});
    }
    return mk('PH_TEASER_REQUIRED','HOLD — PH TEASER REQUIRED',
      'No valid teaser or trailer derivative exists. A main cut, a full master or a generic Pornhub-eligible video is never substituted.',
      RECOVERY_ACTIONS.FIX_LIBRARY,{required_variant_types:[...TEASER_VARIANT_TYPES]});
  }
  return mk('NO_QUALIFYING_MEDIA','HOLD — NO QUALIFYING MEDIA',
    'Nothing currently qualifies for this exact job.',RECOVERY_ACTIONS.FIX_LIBRARY);
}
// Everything LIBRARY needs to repair exactly this job, instead of a generic dump.
export function jobRepairContext(state,assets,job,diag){
  const modes=requiredDeliveryModesFor(job.intent);
  const media=job.intent==='PH_TEASER'?['VIDEO']:job.platform==='Pornhub'?['VIDEO']:['IMAGE','VIDEO'];
  return {
    job:job.job,intent:job.intent,platform:job.platform,label:job.label,
    route_ids:diag?.route_ids||jobRouteStatus(state,job).candidates,
    delivery_modes:modes,
    permitted_media_types:media,
    requires_derivative:job.intent==='PH_TEASER'?'TEASER_OR_TRAILER':'PRIVACY_SAFE_EXPORT',
    hold_code:diag?.hold_code||null,
    recovery:diag?.recovery||RECOVERY_ACTIONS.FIX_LIBRARY,
    rejection_reasons:diag?diag.why:'',
    candidate_asset_ids:(diag?.x_review_candidates)||assetsForPlatform(assets,job.platform).slice(0,24).map(a=>a.asset_id)
  };
}

// The daily plan. Short by construction: one line per scheduled job, nothing else.
export function buildTodayPlan(state,assets,{date=new Date(),timezone=null,now=Date.now(),day_code=null}={}){
  const tz=timezone||todayTimezone(state);
  // A day preview is resolved in the creator's timezone. Never from a raw UTC browser date.
  const code=day_code&&DAY_CODES.includes(String(day_code).toUpperCase())
    ?String(day_code).toUpperCase()
    :dayCodeFor(date,tz);
  const avail=camAvailability(state);
  const camDay=camAllowedOnDay(state,code);
  const weekend=CAM_FORBIDDEN_DAYS.includes(code);
  const jobs=scheduleForDay(code).filter(j=>j.job!=='LIVE'&&j.job!=='PRODUCE');
  const cap=camDay?MAX_JOBS_CAM:MAX_JOBS_NORMAL;
  const rec=generateRecommendation(state,assets);
  const pool=rec.ready?rec.candidates:[];
  const lines=[];
  const usedAssets=new Set();
  // LIVE first, and only when the creator's own configured availability allows it.
  if(camDay){
    lines.push({job:'LIVE',intent:'CAM_SHIFT',platform:'Chaturbate',
      label:`Chaturbate pilot shift — ${avail.window_label}`,
      kind:'LIVE_SESSION',actionable:true,stamp:'GUESS',
      stamp_object:'SCHEDULE',stamp_subject:`cam shift inside ${avail.window_label}`,
      stamp_note:'GUESS — the time comes from the availability you configured, not from measured results. It is not a proven best time.',
      cam_window:avail.window_label,cam_days:avail.days,cam_timezone:avail.timezone,
      why:'Cam pilot inside your configured weekday availability. LUXX has no measured cam history yet.',
      basis:'CONFIGURED AVAILABILITY / GUESS TIME'});
  }else if(!weekend){
    lines.push({job:'LIVE',intent:'CAM_SHIFT',platform:'Chaturbate',
      label:avail.configured?'No cam scheduled today':CAM_NOT_CONFIGURED_LABEL,
      kind:avail.configured?'NOT_SCHEDULED':'SETUP_REQUIRED',actionable:false,stamp:'GUESS',
      stamp_object:'SCHEDULE',stamp_subject:avail.configured?'no cam configured for this weekday':'cam availability not finalized',
      stamp_note:avail.configured
        ?'GUESS — this weekday is not in the configured cam availability, so no LIVE job is scheduled.'
        :'GUESS — LUXX has no cam availability yet and will not invent a time. Nothing is scheduled.',
      why:avail.note,basis:'SETUP REQUIRED'});
  }
  for(const job of jobs){
    if(lines.length>=cap)break;
    const fitAll=pool.filter(c=>candidateFitsJob(state,c,job));
    const fit=fitAll.filter(c=>!usedAssets.has(c.asset.asset_id));
    if(!fit.length){
      const diag=diagnoseJobHold(state,assets,job,{fit_before_rotation:fitAll.length,fit_after_rotation:fit.length,used_asset_ids:usedAssets});
      lines.push({job:job.job,intent:job.intent,platform:job.platform,label:job.label,
        kind:'BLOCKED',hold:true,hold_code:diag.hold_code,hold_label:diag.hold_label,
        recovery:diag.recovery,route_ids:diag.route_ids||null,
        what_to_do:job.label,
        placement:(jobRouteStatus(state,job).candidates.length?(state.routes.find(r=>r.route_id===jobRouteStatus(state,job).candidates[0])||{}).placement:null)||null,
        tracking_url:(state.routes.find(r=>r.route_id===(jobRouteStatus(state,job).candidates[0]||''))||{}).tracking_url_or_identifier||null,
        route_state:routeState(state.routes.find(r=>r.route_id===(jobRouteStatus(state,job).candidates[0]||''))),
        route_activation_steps:routeActivationSteps(state.routes.find(r=>r.route_id===(jobRouteStatus(state,job).candidates[0]||''))),
        required_result_fields:resultFieldsFor(job.platform).fields,
        repair_context:jobRepairContext(state,assets,job,diag),
        stamp:'GUESS',stamp_object:'JOB',stamp_subject:job.label,
        stamp_note:`GUESS — ${diag.hold_label}. This job cannot run until that is fixed.`,
        why:diag.why,
        basis:'DEFAULT / WEEK-1 SCHEDULE'});
      continue;
    }
    const best=fit.sort((a,b)=>b.score.score-a.score.score)[0];
    const rs=jobRouteStatus(state,job);
    const chosenRoute=best.route;
    const rState=routeState(chosenRoute);
    usedAssets.add(best.asset.asset_id);
    const listLine=buildTodayList(state,{ready:true,candidate:best,candidates:[best]},{limit:3,now}).lines[0];
    lines.push({...listLine,job:job.job,intent:job.intent,label:job.label,kind:'ACTION',actionable:true,
      basis:'DEFAULT / WEEK-1 SCHEDULE',
      // Everything the operator needs to execute this without looking anything up.
      what_to_do:job.label,
      placement:chosenRoute?.placement||null,
      placement_label:String(chosenRoute?.placement||'').replace(/_/g,' ').toLowerCase()||null,
      tracking_url:chosenRoute?.tracking_url_or_identifier||null,
      route_state:rState,
      route_is_native:chosenRoute?.attribution_scope==='INTERNAL',
      route_activation_steps:rState==='ACTIVE'?[]:routeActivationSteps(chosenRoute),
      route_note:chosenRoute?.attribution_scope==='INTERNAL'
        ?'Native measurement. There is no outbound link to place.'
        :(rState==='ACTIVE'
          ?'This tracker is installed in the live placement. Use exactly this link.'
          :'This route is not live yet, so the result cannot be attributed to it until the link is installed.'),
      required_result_fields:resultFieldsFor(job.platform).fields,
      native_result_fields:resultFieldsFor(job.platform).native,
      derivative_required:job.intent==='PH_TEASER'?'TEASER_OR_TRAILER':'PRIVACY_SAFE_EXPORT',
      alternate_routes_rejected:rs.candidates.filter(id=>id!==chosenRoute?.route_id),
      needs_sent_to:!!listLine&&listLine.stamp_object==='TREATMENT'&&deliveryModeFor(best.route)==='PPV_DM'});
  }
  // PRODUCE is OFF unless a Library/funnel gap has actually been documented. An unused
  // slot in the day is never a reason to shoot.
  const produce=produceStatus(state);
  if(produce.active&&lines.length<cap){
    const g=produce.gaps[0];
    lines.push({job:'PRODUCE',intent:'GAP_SHOOT',platform:'',label:`Shoot to close a documented gap: ${g.gap_type}`,
      kind:'PRODUCE',actionable:true,stamp:'GUESS',stamp_object:'GAP',stamp_subject:g.gap_type,
      gap_id:g.gap_id,gap_evidence:g.evidence_reference,gap_shortfall:g.shortfall,
      stamp_note:`GUESS — this shoot exists to close a counted shortfall (${g.counted_have} of ${g.counted_needed}), not because the schedule had room.`,
      why:`Documented gap ${g.gap_type}: ${g.counted_have} usable vs ${g.counted_needed} needed. Evidence: ${g.evidence_reference}.`,
      basis:'DOCUMENTED LIBRARY GAP'});
  }
  return {
    ready:true,day:code,timezone:tz,cam_day:camDay,cap,
    cam_availability:avail,
    cam_setup_required:!avail.configured,
    produce,
    lines:lines.slice(0,cap),
    schedule_basis:'FROZEN WEEK-1 OPERATIONAL DEFAULT — not creator-specific proof. Every cadence and time here is a GUESS until RESULTS earns something stronger. Cam days and times come from configured availability, never from this schedule.',
    promise:'These are files you already shot. LUXX does not post, message, schedule, or generate anything.',
    hold_reason:rec.ready?null:rec.reason,
    hold_fix:rec.ready?null:rec.fix
  };
}

// ===========================================================================
// HISTORICAL PUBLICATION INTAKE  (LIBRARY -> existing historical area, no new tab)
// Existing Pornhub / ManyVids / OF / Fansly work is recorded as historical truth. It is never
// deleted or rewritten. Matching to a LUXX master is SUGGESTED, never silently applied.
// ===========================================================================
export const REVIEW_STATUSES=['KEEP','RE-EDIT','REPLACE','RETIRE'];
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
export function normalizeTitle(t){return String(t||'').toLowerCase().replace(/\.[a-z0-9]{2,4}$/,'').replace(/[^a-z0-9]+/g,' ').trim();}

export function upsertHistoricalPublication(state,row={}){
  if(!PLATFORMS.includes(row.platform))throw new Error(`Unknown platform: ${row.platform}`);
  const h={
    historical_publication_id:row.historical_publication_id||uid('HIST'),
    platform:row.platform,
    title:String(row.title||'').slice(0,300),
    url:String(row.url||row.external_reference||'').slice(0,600),
    external_reference:String(row.external_reference||row.url||'').slice(0,600),
    published_at:row.published_at||null,
    runtime_seconds:num(row.runtime_seconds),
    views:num(row.views),
    likes:num(row.likes),
    rating:num(row.rating),
    sales:num(row.sales),
    revenue:num(row.revenue),
    current_price:num(row.current_price),
    current_description:String(row.current_description||'').slice(0,4000),
    current_cta_link:String(row.current_cta_link||'').slice(0,600),
    usage_status:row.usage_status==='PROSPECTIVE'?'PROSPECTIVE':'HISTORICAL',
    asset_id:row.asset_id||null,
    match_confirmed:row.asset_id?!!row.match_confirmed:false,
    review_status:REVIEW_STATUSES.includes(row.review_status)?row.review_status:null,
    notes:String(row.notes||'').slice(0,2000),
    status:'HISTORICAL_BASELINE',
    created_at:nowISO()
  };
  state.historicalPublications=state.historicalPublications||[];
  state.historicalPublications.push(h);
  appendAudit(state,'HISTORICAL_PUBLICATION',h.historical_publication_id,'HISTORICAL_PUBLICATION_RECORDED',{snapshot:structuredClone(h)});
  return h;
}
// Bulk intake. Rows are validated individually; a bad row is reported, never silently dropped.
export function importHistoricalPublications(state,rows=[]){
  if(!Array.isArray(rows))throw new Error('Import expects an array of rows.');
  const imported=[],errors=[];
  rows.forEach((r,i)=>{
    try{imported.push(upsertHistoricalPublication(state,r));}
    catch(e){errors.push({row:i+1,error:String(e?.message||e),data:r});}
  });
  appendAudit(state,'SYSTEM','HISTORICAL_IMPORT','HISTORICAL_PUBLICATIONS_IMPORTED',{imported:imported.length,errors:errors.length});
  return {imported:imported.length,errors,ids:imported.map(x=>x.historical_publication_id)};
}
export function parseHistoricalCsv(text){
  const lines=String(text||'').split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2)return [];
  const split=l=>{const out=[];let cur='',q=false;for(const ch of l){if(ch==='"'){q=!q;continue}if(ch===','&&!q){out.push(cur);cur='';continue}cur+=ch}out.push(cur);return out.map(x=>x.trim());};
  const head=split(lines[0]).map(h=>h.toLowerCase().replace(/\s+/g,'_'));
  return lines.slice(1).map(l=>{const c=split(l),o={};head.forEach((h,i)=>{if(c[i]!==undefined&&c[i]!=='')o[h]=c[i]});return o;});
}
// Suggest, never auto-link. Ambiguity must be resolved by a human.
export function suggestHistoricalMatch(state,assets,historical_publication_id){
  const h=(state.historicalPublications||[]).find(x=>x.historical_publication_id===historical_publication_id);
  if(!h)throw new Error('Historical publication not found.');
  const ht=normalizeTitle(h.title);
  const scored=[];
  for(const a of assets||[]){
    let score=0,why=[];
    const an=normalizeTitle(a.name);
    if(ht&&an){
      if(an===ht){score+=60;why.push('exact title match');}
      else{
        const ha=new Set(ht.split(' ').filter(w=>w.length>2));
        const aa=new Set(an.split(' ').filter(w=>w.length>2));
        const shared=[...ha].filter(w=>aa.has(w));
        if(shared.length){score+=Math.min(35,shared.length*12);why.push(`title words: ${shared.slice(0,3).join(', ')}`);}
      }
    }
    const rt=Number(h.runtime_seconds),ad=Number(a.analysis?.duration_seconds);
    if(Number.isFinite(rt)&&Number.isFinite(ad)&&rt>0&&ad>0){
      const diff=Math.abs(rt-ad)/Math.max(rt,ad);
      if(diff<=0.02){score+=40;why.push('runtime matches within 2%');}
      else if(diff<=0.10){score+=20;why.push('runtime within 10%');}
      else{score-=25;why.push('runtime does not match');}
    }
    if(h.notes&&a.batch_id&&h.notes.toLowerCase().includes(String(a.batch_id).toLowerCase())){score+=15;why.push('batch referenced in notes');}
    if(score>0)scored.push({asset_id:a.asset_id,name:a.name,score,why});
  }
  scored.sort((x,y)=>y.score-x.score);
  const top=scored[0]||null,second=scored[1]||null;
  // High confidence still requires confirmation; it only changes how the UI presents it.
  const confident=!!top&&top.score>=60&&(!second||top.score-second.score>=25);
  return {historical_publication_id,candidates:scored.slice(0,5),suggested:top,
    confidence:confident?'STRONG':top?'AMBIGUOUS':'NONE',
    requires_confirmation:true,
    note:confident?'Strong suggestion. Confirm before LUXX links it.':'Ambiguous or weak. LUXX will not link this without you choosing.'};
}
export function linkHistoricalToMaster(state,{historical_publication_id,asset_id,confirmed}){
  if(confirmed!==true)throw new Error('A historical publication can only be linked to a master by explicit confirmation.');
  const h=(state.historicalPublications||[]).find(x=>x.historical_publication_id===historical_publication_id);
  if(!h)throw new Error('Historical publication not found.');
  h.asset_id=String(asset_id);h.match_confirmed=true;h.matched_at=nowISO();
  appendAudit(state,'HISTORICAL_PUBLICATION',h.historical_publication_id,'HISTORICAL_MATCH_CONFIRMED',{asset_id:h.asset_id});
  return h;
}
export function setHistoricalReview(state,{historical_publication_id,review_status,notes}){
  if(!REVIEW_STATUSES.includes(review_status))throw new Error('Review status must be KEEP, RE-EDIT, REPLACE or RETIRE.');
  const h=(state.historicalPublications||[]).find(x=>x.historical_publication_id===historical_publication_id);
  if(!h)throw new Error('Historical publication not found.');
  h.review_status=review_status;
  if(notes!=null)h.notes=String(notes).slice(0,2000);
  h.reviewed_at=nowISO();
  // The historical record itself is never rewritten or deleted; only the review verdict moves.
  appendAudit(state,'HISTORICAL_PUBLICATION',h.historical_publication_id,'HISTORICAL_REVIEW_SET',{review_status,notes:h.notes});
  return h;
}

// ===========================================================================
// LAUNCH CHECKLIST, PER-PLATFORM BASELINE, CAM SESSIONS, LAUNCH TIER
// All inside the existing product structure. No new primary navigation.
// ===========================================================================
export const LAUNCH_CHECKLIST=[
  ['BACKUP_BEFORE','Back up current LUXX state (RESULTS → BACKUP JSON)'],
  ['SAME_SITE','Confirm this is the SAME Netlify site (media and state are attached to it)'],
  ['ROLES','Confirm Creator / Executive Producer roles on both phones'],
  ['HEALTH','Run System Health'],
  ['TIMEZONE','Set timezone to America/Chicago'],
  ['PLATFORM_BEFORE','Capture the BEFORE-state for every platform (screenshots)'],
  ['BASELINE_CAPTURE','Enter the exact baseline numbers in LUXX'],
  ['REVIEW_TOGETHER','Review the baseline together, out loud'],
  ['BASELINE_LOCK','LOCK BASELINE'],
  ['ROUTES_CONFIGURE','Configure the Priority-A tracking routes'],
  ['ROUTES_VERIFY','Verify each route with a real click test'],
  ['HIST_PORNHUB','Record / import historical Pornhub publications'],
  ['HIST_MANYVIDS','Record / import historical ManyVids publications'],
  ['OF_FREE_PAID','Confirm OF Free → Paid tracking placements'],
  ['OF_PAID_NATIVE','Confirm OF Paid native feed / PPV measurement'],
  ['FANSLY','Confirm Fansly setup (only if the account is actually used)'],
  ['CHATURBATE','Confirm Chaturbate account, schedule, camera and mic'],
  ['UPLOAD_CORE','Upload Launch Core media'],
  ['REVIEW_SAFETY','Review authorization / quarantine / privacy / X-face restrictions'],
  ['UPLOAD_ARCHIVE','Upload the remaining archive'],
  ['DUPES','Run exact-duplicate cleanup'],
  ['DRY_RUN','Run a full dry-run (TODAY → execute → measure)'],
  ['BACKUP_AFTER','Export the post-setup backup']
];
export function ensureChecklist(state){
  state.launchChecklist=state.launchChecklist||[];
  const have=new Set(state.launchChecklist.map(x=>x.id));
  for(const [id,label] of LAUNCH_CHECKLIST)if(!have.has(id))state.launchChecklist.push({id,label,done:false,done_at:null,by:null});
  // keep canonical order even if items were added across versions
  const order=new Map(LAUNCH_CHECKLIST.map(([id],i)=>[id,i]));
  state.launchChecklist.sort((a,b)=>(order.get(a.id)??99)-(order.get(b.id)??99));
  return state.launchChecklist;
}
export function setChecklistItem(state,{id,done,by}){
  ensureChecklist(state);
  const it=state.launchChecklist.find(x=>x.id===id);
  if(!it)throw new Error('Unknown checklist item.');
  it.done=!!done;it.done_at=done?nowISO():null;it.by=done?(by||null):null;
  appendAudit(state,'SYSTEM','CHECKLIST',done?'CHECKLIST_ITEM_DONE':'CHECKLIST_ITEM_CLEARED',{id,by:it.by});
  return it;
}
export function checklistProgress(state){
  const list=ensureChecklist(state);
  const done=list.filter(x=>x.done).length;
  return {done,total:list.length,next:list.find(x=>!x.done)||null,complete:done===list.length};
}

export const BASELINE_PLATFORMS=['X','Pornhub','OnlyFans Free','OnlyFans Paid','ManyVids','Fansly','Chaturbate'];
// Exact numbers are entered by the operators. Seed strings are shown as reference only and are
// never written into a snapshot as if they were measured.
export function recordBaselineSnapshot(state,{platform,metrics={},evidence_reference='',notes='',not_available=[]}){
  if(!BASELINE_PLATFORMS.includes(platform))throw new Error(`Unknown platform: ${platform}`);
  if(state.baseline.locked)throw new Error('Baseline is locked. Use an append-only correction instead.');
  const clean={};const na=[...new Set((not_available||[]).map(String))];
  for(const [k,v] of Object.entries(metrics)){
    // A metric the operator could not obtain is recorded as NOT AVAILABLE. It is never zero.
    if(v===''||v==null||String(v).trim().toUpperCase()==='NOT_AVAILABLE'||String(v).trim().toUpperCase()==='NOT AVAILABLE'){if(String(v??'').trim())na.push(k);continue;}
    const n=Number(v);if(Number.isFinite(n))clean[k]=n;
  }
  state.baseline.snapshots=(state.baseline.snapshots||[]).filter(s=>s.platform!==platform);
  const snap={platform,metrics:clean,not_available:[...new Set(na)],source:'MANUAL',review_state:'ENTERED',evidence_reference:String(evidence_reference||''),notes:String(notes||''),captured_at:nowISO()};
  state.baseline.snapshots.push(snap);
  appendAudit(state,'BASELINE',platform,'BASELINE_SNAPSHOT_CAPTURED',{snapshot:structuredClone(snap)});
  return snap;
}
export function baselineCoverage(state){
  const have=new Set((state.baseline?.snapshots||[]).map(s=>s.platform));
  return {captured:[...have],missing:BASELINE_PLATFORMS.filter(p=>!have.has(p)),locked:!!state.baseline?.locked};
}


// ===========================================================================
// BASELINE IMPORT  (SETUP -> IMPORT BASELINE, no new primary navigation)
// One structured file carries every exact platform number. It populates the
// existing baseline review fields and stops there:
//     IMPORT -> REVIEW -> CAPTURE BASELINE -> LOCK BASELINE
// It never captures, never locks, and never overwrites a locked baseline. A value
// the creator could not obtain stays NOT AVAILABLE and is never turned into zero.
// Old August seed strings on state.accounts are reference only and are never read
// by the import, so they cannot be promoted into the September launch baseline.
// ===========================================================================
export const BASELINE_IMPORT_PLATFORMS=[...BASELINE_PLATFORMS,'Linktree'];
export const BASELINE_NOT_AVAILABLE=['NOT_AVAILABLE','NOT AVAILABLE','N/A','NA','UNAVAILABLE','UNKNOWN'];
export const BASELINE_IMPORT_SCHEMA='LUXX_BASELINE_IMPORT_V1';

function isNotAvailable(v){
  if(v===null||v===undefined)return true;
  const t=String(v).trim();
  if(!t)return true;
  return BASELINE_NOT_AVAILABLE.includes(t.toUpperCase());
}
// Accepts: {rows:[...]}, a bare array of rows, or {platforms:{X:{followers:36}}}.
export function parseBaselineImport(input){
  let data=input;
  if(typeof input==='string'){
    const text=input.trim();
    if(!text)throw new Error('The baseline import file is empty.');
    if(text.startsWith('{')||text.startsWith('[')){
      try{data=JSON.parse(text);}catch{throw new Error('Baseline import is not valid JSON.');}
    }else{
      return {schema:BASELINE_IMPORT_SCHEMA,format:'CSV',rows:parseBaselineCsv(text)};
    }
  }
  if(Array.isArray(data))return {schema:BASELINE_IMPORT_SCHEMA,format:'JSON',rows:normalizeBaselineRows(data)};
  if(data&&typeof data==='object'){
    if(Array.isArray(data.rows))return {schema:String(data.schema||BASELINE_IMPORT_SCHEMA),format:'JSON',captured_on:data.captured_on||null,rows:normalizeBaselineRows(data.rows)};
    if(data.platforms&&typeof data.platforms==='object'){
      const rows=[];
      for(const [platform,metrics] of Object.entries(data.platforms)){
        if(!metrics||typeof metrics!=='object')continue;
        for(const [metric,value] of Object.entries(metrics))rows.push({platform,metric,value});
      }
      return {schema:String(data.schema||BASELINE_IMPORT_SCHEMA),format:'JSON',captured_on:data.captured_on||null,rows:normalizeBaselineRows(rows)};
    }
  }
  throw new Error('Baseline import must contain rows, or a platforms object.');
}
export function parseBaselineCsv(text){
  const lines=String(text||'').split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length)throw new Error('The baseline CSV is empty.');
  const head=lines[0].split(',').map(x=>x.trim().toLowerCase());
  const need=['platform','metric','value'];
  for(const k of need)if(!head.includes(k))throw new Error(`Baseline CSV needs a ${k} column.`);
  const rows=[];
  for(const line of lines.slice(1)){
    const cells=line.split(',');
    const row={};
    head.forEach((h,i)=>{row[h]=(cells[i]??'').trim();});
    rows.push(row);
  }
  return normalizeBaselineRows(rows);
}
function normalizeBaselineRows(rows){
  const out=[];
  for(const r of rows||[]){
    if(!r||typeof r!=='object')continue;
    const platform=String(r.platform||'').trim();
    const metric=String(r.metric||'').trim();
    if(!platform||!metric)throw new Error('Every baseline row needs a platform and a metric.');
    if(!BASELINE_IMPORT_PLATFORMS.includes(platform))throw new Error(`Unknown baseline platform: ${platform}`);
    const raw=r.value;
    const na=isNotAvailable(raw);
    let value=null;
    if(!na){
      const n=Number(raw);
      if(!Number.isFinite(n))throw new Error(`Baseline value for ${platform} / ${metric} is neither a number nor NOT_AVAILABLE.`);
      value=n;
    }
    out.push({platform,metric,value,not_available:na,
      unit:String(r.unit||r.type||'').trim(),
      evidence_reference:String(r.evidence_reference||r.evidence||'').trim(),
      notes:String(r.notes||'').trim()});
  }
  if(!out.length)throw new Error('The baseline import contained no rows.');
  return out;
}
// Populates the existing per-platform baseline snapshots for human review.
// Returns what a reviewer needs to see. Does not capture. Does not lock.
export function importBaseline(state,payload={}){
  if(state?.baseline?.locked)throw new Error('Baseline is already locked. IMPORT BASELINE will not overwrite a locked baseline. Use an append-only correction instead.');
  // A LUXX_BASELINE_LOCK_CANDIDATE document is adapted onto the import rows first.
  let candidate=null;
  const raw=payload&&payload.text!==undefined?payload.text:payload;
  const probe=typeof raw==='string'&&raw.trim().startsWith('{')?(()=>{try{return JSON.parse(raw)}catch{return null}})():raw;
  if(probe&&typeof probe==='object'&&probe.schema===BASELINE_CANDIDATE_SCHEMA)candidate=adaptBaselineCandidate(probe);
  const parsed=candidate
    ?{schema:BASELINE_CANDIDATE_SCHEMA,format:'CANDIDATE',rows:normalizeBaselineRows(candidate.rows)}
    :(payload&&Array.isArray(payload.rows)&&!payload.text
      ?{schema:BASELINE_IMPORT_SCHEMA,format:'JSON',rows:normalizeBaselineRows(payload.rows)}
      :parseBaselineImport(raw));
  const import_id=uid('BLIMP');
  const byPlatform=new Map();
  for(const r of parsed.rows){
    const v=byPlatform.get(r.platform)||{platform:r.platform,metrics:{},units:{},not_available:[],rows:[],evidence_reference:'',notes:[]};
    if(r.not_available){v.not_available.push(r.metric);}
    else{v.metrics[r.metric]=r.value;}
    if(r.unit)v.units[r.metric]=r.unit;
    if(r.evidence_reference&&!v.evidence_reference)v.evidence_reference=r.evidence_reference;
    if(r.notes)v.notes.push(`${r.metric}: ${r.notes}`);
    v.rows.push(r);
    byPlatform.set(r.platform,v);
  }
  state.baseline.snapshots=state.baseline.snapshots||[];
  const platforms=[];
  for(const v of byPlatform.values()){
    state.baseline.snapshots=state.baseline.snapshots.filter(s=>s.platform!==v.platform);
    const snap={platform:v.platform,metrics:v.metrics,units:v.units,
      not_available:[...new Set(v.not_available)],
      evidence_reference:v.evidence_reference,notes:v.notes.join(' · '),
      source:'IMPORT',import_id,review_state:'IMPORTED_PENDING_REVIEW',captured_at:nowISO()};
    state.baseline.snapshots.push(snap);
    platforms.push(v.platform);
  }
  state.baseline.last_import={import_id,at:nowISO(),platforms:[...platforms],
    row_count:parsed.rows.length,
    not_available_count:parsed.rows.filter(r=>r.not_available).length};
  appendAudit(state,'BASELINE',import_id,'BASELINE_IMPORTED',{platforms:[...platforms],rows:parsed.rows.length});
  if(candidate&&candidate.source_inventory&&candidate.source_inventory.photos!==null)
    recordSourceInventory(state,{...candidate.source_inventory,counted_on:candidate.baseline_date,
      notes:'From the baseline candidate document.'});
  return {import_id,imported:parsed.rows.length,platforms,
    candidate:candidate?{baseline_date:candidate.baseline_date,state:candidate.state,
      source_inventory:candidate.source_inventory,creator_rules:candidate.creator_rules,
      pre_lock_requirements:candidate.pre_lock_requirements}:null,
    snapshots:state.baseline.snapshots.filter(s=>s.import_id===import_id).map(s=>structuredClone(s)),
    not_available:parsed.rows.filter(r=>r.not_available).map(r=>`${r.platform} / ${r.metric}`),
    captured:!!state.baseline.captured,locked:!!state.baseline.locked,
    review_required:true,auto_locked:false,
    next_step:'REVIEW the imported values, then CAPTURE BASELINE, then LOCK BASELINE.',
    note:'Imported values are not the official baseline until a human reviews them and locks it. NOT AVAILABLE stayed NOT AVAILABLE and was never written as zero.'};
}

// ===========================================================================
// BASELINE CANDIDATE ADAPTER  (schema LUXX_BASELINE_LOCK_CANDIDATE)
// The operator's collection format nests metrics under each platform and carries a
// truth_state per metric. It is mapped mechanically onto the existing import rows.
// Nothing is invented: an UNKNOWN truth_state stays unknown, an observed zero stays
// zero, and the ManyVids price list is preserved value by value rather than averaged.
// ===========================================================================
export const BASELINE_CANDIDATE_SCHEMA='LUXX_BASELINE_LOCK_CANDIDATE';
const CANDIDATE_PLATFORM_MAP={x:'X',onlyfans_free:'OnlyFans Free',onlyfans_paid:'OnlyFans Paid',
  pornhub:'Pornhub',manyvids:'ManyVids',fansly:'Fansly',chaturbate:'Chaturbate',linktree:'Linktree'};
export function adaptBaselineCandidate(payload){
  const doc=typeof payload==='string'?JSON.parse(payload):payload;
  if(!doc||typeof doc!=='object')throw new Error('The baseline candidate file is not readable.');
  if(doc.schema&&doc.schema!==BASELINE_CANDIDATE_SCHEMA)
    throw new Error(`Unexpected baseline schema: ${doc.schema}`);
  if(!doc.platforms||typeof doc.platforms!=='object')throw new Error('The baseline candidate has no platforms.');
  const rows=[],unknown=[];
  const ref=(p)=>doc.baseline_date?`${p} observed ${doc.baseline_date}`:`${p} observed`;
  for(const [key,block] of Object.entries(doc.platforms)){
    const platform=CANDIDATE_PLATFORM_MAP[String(key).toLowerCase()];
    if(!platform)throw new Error(`Unknown baseline platform in candidate file: ${key}`);
    for(const [metric,cell] of Object.entries(block.metrics||{})){
      const truth=String(cell?.truth_state||'').toUpperCase();
      const isUnknown=truth==='UNKNOWN'||cell?.value===null||cell?.value===undefined;
      if(isUnknown)unknown.push(`${platform} / ${metric}`);
      rows.push({platform,metric,
        value:isUnknown?'NOT_AVAILABLE':cell.value,
        evidence_reference:block.url||ref(platform),
        notes:isUnknown?'Not measured on the baseline date. Unknown, not zero.':`truth_state ${truth||'OBSERVED'}`});
    }
    // Every observed listing price is kept individually. An average would be a number
    // the operator never observed.
    (block.listing_prices_usd||[]).forEach((cell,i)=>{
      const truth=String(cell?.truth_state||'').toUpperCase();
      const isUnknown=truth==='UNKNOWN'||cell?.value===null||cell?.value===undefined;
      rows.push({platform,metric:`listing_price_${i+1}`,value:isUnknown?'NOT_AVAILABLE':cell.value,
        unit:'usd',evidence_reference:block.url||ref(platform),
        notes:isUnknown?'Unknown, not zero.':'Observed listed price.'});
    });
  }
  const inv=doc.creator_source_inventory||null;
  return {schema:BASELINE_CANDIDATE_SCHEMA,baseline_date:doc.baseline_date||null,
    state:doc.state||'REVIEW_REQUIRED',rows,unknown,
    source_inventory:inv?{photos:inv.photos?.value??null,videos:inv.videos?.value??null,
      total_media:inv.total_media?.value??null,produce_default:inv.produce_default||'OFF'}:null,
    creator_rules:Object.fromEntries(Object.entries(doc.platforms)
      .filter(([,b])=>Array.isArray(b.creator_rules)&&b.creator_rules.length)
      .map(([k,b])=>[CANDIDATE_PLATFORM_MAP[String(k).toLowerCase()],b.creator_rules])),
    pre_lock_requirements:doc.pre_lock_requirements||[],
    note:'These are candidate observations for review. Importing them does not capture or lock anything.'};
}
// Records the creator's own counted source inventory. It is an observation, not a gap,
// and on its own it never turns PRODUCE on.
export function recordSourceInventory(state,{photos=null,videos=null,total_media=null,counted_on=null,notes=''}={}){
  const n=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;};
  const inv={photos:n(photos),videos:n(videos),total_media:n(total_media),
    counted_on:counted_on||nowISO(),notes:String(notes||'').slice(0,500),
    produce_default:'OFF',
    note:'Counted source media. Existing authorized media comes first; PRODUCE stays off until a documented gap.'};
  state.sourceInventory=inv;
  appendAudit(state,'BASELINE','SOURCE_INVENTORY','SOURCE_INVENTORY_RECORDED',{snapshot:structuredClone(inv)});
  return inv;
}
export function sourceInventory(state){return state?.sourceInventory?structuredClone(state.sourceInventory):null;}

// ===========================================================================
// LAUNCH PROFILE COPY  (v1.8.0)
// The bio for each platform is operator-supplied launch copy and nothing more. It is a
// GUESS / LAUNCH HYPOTHESIS: never optimized, winning, proven or best, and it can only
// change on properly scoped measured evidence. PRESCRIBED copy (what LUXX asks her to
// install) is recorded separately from ACTUAL copy (what is genuinely on the profile),
// and the CURRENT OLD bio stays UNKNOWN until she captures it. None of it is invented.
// ===========================================================================
export const PROFILE_COPY_SCHEMA='LUXX_LAUNCH_PROFILE_COPY';
export const PROFILE_COPY_EVIDENCE='GUESS / LAUNCH HYPOTHESIS';
export const FORBIDDEN_COPY_CLAIMS=[/\boptimi[sz]ed\b/i,/\bwinning\b/i,/\bproven\b/i,/\bbest[- ]performing\b/i,/\bhigh[- ]converting\b/i];
export function importProfileCopy(state,payload={}){
  const doc=typeof payload==='string'?JSON.parse(payload):(payload.text?JSON.parse(payload.text):payload);
  if(!doc||doc.schema!==PROFILE_COPY_SCHEMA)throw new Error(`Unexpected profile copy schema: ${doc&&doc.schema}`);
  const rows=doc.profiles||[];
  if(!rows.length)throw new Error('The launch profile copy contained no platforms.');
  const out=[];
  for(const r of rows){
    const platform=String(r.platform||'').trim();
    if(!PLATFORMS.includes(platform)&&platform!=='Linktree')throw new Error(`Unknown platform in profile copy: ${platform}`);
    const bio=String(r.prescribed_bio||'');
    if(!bio.trim())throw new Error(`${platform} has no prescribed launch bio.`);
    for(const re of FORBIDDEN_COPY_CLAIMS)
      if(re.test(bio)||re.test(String(r.prescribed_cta||'')))
        throw new Error(`${platform} bio makes an evidence claim (${re}). Launch copy is a hypothesis, not a result.`);
    if(r.char_limit&&bio.length>Number(r.char_limit))
      throw new Error(`${platform} bio is ${bio.length} characters against a ${r.char_limit} limit and was not shortened.`);
    // A bio may not carry a tracking URL that is not the one configured for its route.
    for(const m of bio.matchAll(/https?:\/\/\S+/g)){
      const url=m[0].replace(/[.,)]+$/,'');
      const bound=(state.routes||[]).find(x=>x.tracking_url_or_identifier===url);
      if(!bound||!(r.route_ids||[]).includes(bound.route_id))
        throw new Error(`${platform} bio contains a link that is not this profile's configured tracker: ${url}`);
    }
    if(r.native_destination&&r.tracking_url)
      throw new Error(`${platform} is a native destination and must not be given an outbound tracking URL.`);
    out.push({platform,account:String(r.account||''),
      prescribed_bio:bio,prescribed_cta:String(r.prescribed_cta||''),
      intended_destination:String(r.intended_destination||''),
      route_ids:[...(r.route_ids||[])],
      tracking_url:r.tracking_url||null,native_destination:!!r.native_destination,
      char_limit:r.char_limit??null,shortened:!!r.shortened,shortening_note:r.shortening_note||null,
      week_1_state:r.week_1_state||null,install_note:r.install_note||null,
      // UNKNOWN is preserved. It is never filled in from anywhere.
      current_old_bio:r.current_old_bio??null,
      current_old_bio_state:r.current_old_bio?'CAPTURED':'UNKNOWN',
      actual_installed_bio:r.actual_installed_bio??null,
      actual_installed_state:r.actual_installed_bio?'INSTALLED':'NOT_INSTALLED',
      evidence_label:PROFILE_COPY_EVIDENCE,
      imported_at:nowISO()});
  }
  state.profileCopy=out;
  appendAudit(state,'PROFILE_COPY','LAUNCH_COPY','PROFILE_COPY_IMPORTED',{platforms:out.map(x=>x.platform)});
  return {imported:out.length,platforms:out.map(x=>x.platform),
    note:'Prescribed launch copy only. Nothing is installed, nothing is captured, and no bio is evidence of anything.'};
}
export function profileCopy(state,platform=null){
  const rows=structuredClone(state?.profileCopy||[]);
  return platform?rows.find(x=>x.platform===platform)||null:rows;
}
// Records what was ACTUALLY installed, alongside the old copy it replaced. Both are
// operator observations; neither is inferred and neither rewrites history.
export function recordInstalledProfileCopy(state,{platform,actual_bio,previous_bio=null,evidence_reference='',installed_at=null,by='Creator'}={}){
  const row=(state.profileCopy||[]).find(x=>x.platform===platform);
  if(!row)throw new Error(`No launch copy configured for ${platform}.`);
  if(!String(actual_bio||'').trim())throw new Error('Recording an installed bio requires the text that is actually on the profile.');
  if(!String(evidence_reference||'').trim())throw new Error('Recording an installed bio requires evidence, such as a screenshot reference.');
  row.actual_installed_bio=String(actual_bio);
  row.actual_installed_state='INSTALLED';
  row.actual_matches_prescribed=String(actual_bio)===row.prescribed_bio;
  row.installed_at=installed_at||nowISO();
  row.installed_by=by;
  row.install_evidence=String(evidence_reference).trim();
  if(previous_bio!==null&&String(previous_bio).trim()){
    row.current_old_bio=String(previous_bio);
    row.current_old_bio_state='CAPTURED';
  }
  state.profileCopyHistory=state.profileCopyHistory||[];
  state.profileCopyHistory.push({profile_copy_event_id:uid('PCOPY'),platform,
    prescribed_bio:row.prescribed_bio,actual_bio:row.actual_installed_bio,
    previous_bio:row.current_old_bio??null,matches_prescribed:row.actual_matches_prescribed,
    evidence_reference:row.install_evidence,recorded_at:nowISO(),by});
  appendAudit(state,'PROFILE_COPY',platform,'PROFILE_COPY_INSTALLED',
    {matches_prescribed:row.actual_matches_prescribed,evidence_reference:row.install_evidence});
  return structuredClone(row);
}
// What the operator still has to install, and where each bio points.
export function profileCopyReview(state){
  const rows=profileCopy(state);
  return {platforms:rows.map(r=>({platform:r.platform,account:r.account,
      prescribed_bio:r.prescribed_bio,prescribed_cta:r.prescribed_cta,
      intended_destination:r.intended_destination,route_ids:r.route_ids,
      route_states:r.route_ids.map(id=>({route_id:id,state:routeState((state.routes||[]).find(x=>x.route_id===id))})),
      tracking_url:r.tracking_url,current_old_bio_state:r.current_old_bio_state,
      actual_installed_state:r.actual_installed_state,
      matches_prescribed:r.actual_matches_prescribed??null,
      evidence_label:r.evidence_label,install_note:r.install_note||null})),
    pending_install:rows.filter(r=>r.actual_installed_state!=='INSTALLED').map(r=>r.platform),
    unknown_old_copy:rows.filter(r=>r.current_old_bio_state==='UNKNOWN').map(r=>r.platform),
    note:'Every bio is a launch hypothesis. Old live copy stays UNKNOWN until the operator captures it on launch day.'};
}

// ===========================================================================
// CREATOR LAUNCH CHECKLIST
// Generated ENTIRELY from the frozen launch-profile configuration and the route
// catalogue. It copies; it never authors. No bio is rewritten, shortened, merged or
// invented here, and no route state is changed by producing or completing a step.
// Every step is a launch hypothesis to install and verify, never a proven result.
// ===========================================================================
export function creatorLaunchChecklist(state){
  const rows=profileCopy(state);
  if(!rows.length)throw new Error('No launch profile copy is configured. Import it before building the checklist.');
  const routeOf=id=>(state.routes||[]).find(r=>r.route_id===id)||null;
  const steps=rows.map((r,i)=>{
    const routes=r.route_ids.map(id=>{
      const rt=routeOf(id);
      return {route_id:id,state:routeState(rt),
        destination:rt?rt.destination:null,
        placement:rt?rt.placement:null,
        tracking_url:rt?(rt.tracking_url_or_identifier||null):null,
        native:rt?rt.attribution_scope==='INTERNAL':false,
        activation_steps:routeState(rt)==='ACTIVE'?[]:routeActivationSteps(rt),
        activation_blocker:rt?(rt.activation_blocker||null):null};
    });
    const outbound=routes.filter(x=>!x.native&&x.tracking_url);
    return {
      order:i+1,
      platform:r.platform,
      account:r.account,
      // Exact frozen copy. Character-for-character, never re-worded.
      bio:r.prescribed_bio,
      bio_length:r.prescribed_bio.length,
      char_limit:r.char_limit,
      shortened:!!r.shortened,
      cta:r.prescribed_cta,
      destination:r.intended_destination,
      native_destination:!!r.native_destination,
      links_to_install:outbound.map(x=>({route_id:x.route_id,url:x.tracking_url,placement:x.placement,destination:x.destination})),
      routes,
      platform_rules:(CREATOR_RESTRICTIONS[r.platform]&&CREATOR_RESTRICTIONS[r.platform].no_face)
        ?[`${CREATOR_RESTRICTIONS[r.platform].label}. A face-visible master may still be used on destinations that allow face.`]
        :[],
      week_1_state:r.week_1_state||null,
      install_note:r.install_note||null,
      // Completion state. Nothing is ticked by generating the list.
      bio_installed:r.actual_installed_state==='INSTALLED',
      bio_matches_prescribed:r.actual_matches_prescribed??null,
      old_bio_captured:r.current_old_bio_state==='CAPTURED',
      required_evidence:[
        'Screenshot the CURRENT profile before changing anything, so the old copy is captured rather than lost.',
        'Install the exact bio text above.',
        ...(outbound.length?outbound.map(x=>`Install ${x.tracking_url} in the ${String(x.placement||'').replace(/_/g,' ').toLowerCase()} placement, then open it and confirm it lands on ${x.destination}.`):[]),
        'Screenshot the profile after the change as install evidence.',
        ...(outbound.length?['Confirm the placement in LUXX so the route becomes ACTIVE.']:[])
      ],
      evidence_label:r.evidence_label
    };
  });
  const pendingRoutes=steps.flatMap(x=>x.routes).filter(x=>x.state!=='ACTIVE');
  return {
    title:'CREATOR LAUNCH CHECKLIST',
    generated_at:nowISO(),
    source:'config/LUXX001_LAUNCH_PROFILE_COPY.json + the tracking route catalogue',
    evidence_label:PROFILE_COPY_EVIDENCE,
    steps,
    totals:{platforms:steps.length,
      bios_installed:steps.filter(x=>x.bio_installed).length,
      old_bios_captured:steps.filter(x=>x.old_bio_captured).length,
      links_to_install:steps.reduce((a,x)=>a+x.links_to_install.length,0),
      routes_not_active:pendingRoutes.length},
    note:'Every bio here is copied verbatim from the frozen configuration and is a launch hypothesis, not a proven result. Old live copy stays UNKNOWN until it is captured on launch day. Completing a step in the world does not change a route state in LUXX; confirming the placement does.'
  };
}
export function baselineReview(state){
  const snaps=(state?.baseline?.snapshots||[]).map(s=>structuredClone(s));
  return {snapshots:snaps,
    imported:snaps.filter(s=>s.source==='IMPORT').length,
    pending_review:snaps.filter(s=>s.review_state==='IMPORTED_PENDING_REVIEW').length,
    captured:!!state?.baseline?.captured,locked:!!state?.baseline?.locked,
    missing:BASELINE_PLATFORMS.filter(p=>!snaps.some(s=>s.platform===p)),
    flow:['IMPORT','REVIEW','CAPTURE BASELINE','LOCK BASELINE']};
}

// Cam pilot. Native measurement only. No downstream OF attribution is invented, and no external
// link is placed into Chaturbate: the conservative external-route restriction stays.
export function recordCamSession(state,{started_at,ended_at,effort_minutes,followers_start,followers_end,tips_tokens,native_revenue,notes='',theme=''}){
  if(!started_at||!ended_at)throw new Error('A cam session needs a start and an end.');
  const eff=Number(effort_minutes);
  if(!Number.isFinite(eff)||eff<0)throw new Error('Effort minutes must be 0 or greater.');
  const tz=todayTimezone(state);
  // A zoneless datetime-local value is the creator's own wall clock, not UTC.
  const startISO=resolveCreatorInstant(started_at,tz),endISO=resolveCreatorInstant(ended_at,tz);
  if(!startISO||!endISO)throw new Error('A cam session needs a readable start and end time.');
  if(Date.parse(endISO)<=Date.parse(startISO))throw new Error('The session end must be after the session start.');
  const startDay=dayCodeFor(startISO,tz),endDay=dayCodeFor(endISO,tz);
  if(CAM_FORBIDDEN_DAYS.includes(startDay)||CAM_FORBIDDEN_DAYS.includes(endDay))
    throw new Error('Saturday and Sunday cam is not available. A weekend cam session cannot be scheduled or recorded.');
  const avail=state?.settings?.camAvailability;
  let deviation=null;
  if(avail&&avail.configured){
    if(!(avail.days||[]).includes(startDay))deviation=`Recorded on ${startDay}, which is not in the configured cam availability.`;
    else{
      const w=camWindowForDay(state,startDay)||{start_minutes:avail.start_minutes,end_minutes:avail.end_minutes};
      const m0=minutesInTimezone(startISO,tz),m1=minutesInTimezone(endISO,tz);
      if(m0!==null&&m0<w.start_minutes)deviation=`Started before the declared ${startDay} window ${clockLabel(w.start_minutes)}.`;
      else if(m1!==null&&m1>w.end_minutes)deviation=`Ended after the declared ${startDay} window ${clockLabel(w.end_minutes)}.`;
    }
  }
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
  const s={cam_session_id:uid('CAM'),started_at:startISO,ended_at:endISO,
    started_at_input:String(started_at),ended_at_input:String(ended_at),
    session_minutes:Math.round((Date.parse(endISO)-Date.parse(startISO))/60000),
    effort_minutes:eff,
    followers_start:n(followers_start),followers_end:n(followers_end),
    followers_delta:(n(followers_start)!=null&&n(followers_end)!=null)?n(followers_end)-n(followers_start):null,
    tips_tokens:n(tips_tokens),native_revenue:n(native_revenue),
    theme:String(theme||'').slice(0,200),
    day_code:startDay,timezone:tz,
    availability_configured:!!(avail&&avail.configured),
    outside_configured_availability:!!deviation,
    deviation_note:deviation,
    notes:String(notes||'').slice(0,1000),
    attribution_note:'Native Chaturbate measurement only. LUXX does not infer OnlyFans signups from a cam shift without an observable route.',
    created_at:nowISO()};
  state.camSessions=state.camSessions||[];
  state.camSessions.push(s);
  if(s.native_revenue)recordRevenue(state,{event_type:'TIP',gross_amount:s.native_revenue,notes:`Chaturbate session ${s.cam_session_id}`});
  appendAudit(state,'CAM',s.cam_session_id,'CAM_SESSION_RECORDED',{snapshot:structuredClone(s)});
  return s;
}
export function camSummary(state){
  const rows=state.camSessions||[];
  const hours=rows.reduce((a,b)=>a+Number(b.effort_minutes||0),0)/60;
  const rev=rows.reduce((a,b)=>a+Number(b.native_revenue||0),0);
  const fol=rows.reduce((a,b)=>a+Number(b.followers_delta||0),0);
  return {sessions:rows.length,hours:Number(hours.toFixed(2)),native_revenue:Number(rev.toFixed(2)),
    followers_gained:fol,
    revenue_per_hour:hours>0?Number((rev/hours).toFixed(2)):null,
    reportable:rows.length>=CALL_THRESHOLD,
    outside_availability:rows.filter(r=>r.outside_configured_availability).length,
    time_claim:'GUESS / DEFAULT — the cam time is an availability constraint, never evidence that it is the optimal time.',
    note:rows.length>=CALL_THRESHOLD?'':`Cam is a pilot. Fewer than ${CALL_THRESHOLD} sessions is not enough to judge it, and no cam time may be called optimal.`};
}

// RESULTS grouped by the job that was actually performed.
export function jobPerformance(state){
  const byJob=new Map();
  for(const a of state.actions||[]){
    if(!['EXECUTED','MEASURED'].includes(a.status))continue;
    const job=a.job_class||'UNCLASSIFIED';
    const o=outcomeFor(state,a.action_id);
    const v=byJob.get(job)||{job,n:0,effort_minutes:0,revenue:0,conversions:0,sent_to:0,with_denominator:0};
    v.n++;v.effort_minutes+=Number(a.creator_effort_minutes||0);
    v.revenue+=revenueFor(state,a.action_id);
    if(Number(a.sent_to)>0){v.sent_to+=Number(a.sent_to);v.with_denominator++;}
    if(o)v.conversions+=Number(o.raw?.ppv_purchases||0)+Number(o.raw?.paid_conversions||0)+Number(o.raw?.free_joins||0);
    byJob.set(job,v);
  }
  return [...byJob.values()].map(v=>({...v,
    revenue:Number(v.revenue.toFixed(2)),
    hours:Number((v.effort_minutes/60).toFixed(2)),
    revenue_per_hour:v.effort_minutes>0?Number((v.revenue/(v.effort_minutes/60)).toFixed(2)):null,
    reportable:v.n>=CALL_THRESHOLD})).sort((a,b)=>b.revenue-a.revenue);
}
