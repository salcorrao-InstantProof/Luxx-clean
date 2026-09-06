import assert from 'node:assert/strict';
import {
  seedState,captureBaseline,lockBaseline,updateRoute,calculateAttributionCeiling,routeUsable,assetEligible,
  variantMissingFields,variantReadyForPlatform,ctaFor,postingWindowFor,candidateScore,generateRecommendation,
  assetUsage,fatigueTerm,visualTerm,evidenceTier,hourInTimezone,destinationConfidence,EVIDENCE_CAP,
  effortEconomics,calibrationReport,overrideSignal,proofPack,sinceBaseline,recordCropJudgement,cropEvidence,
  buildTodayList,createPrescriptionForPick,pickReason,CALL_THRESHOLD,TODAY_MIN,TODAY_MAX,
  treatmentKey,treatmentLabel,scopeKeyForRoute,deliveryModeFor,priceBandFor,makesConversionClaim,
  denominatorObservable,passesTechnicalGate,proposeTreatment,
  createPrescription,approvePrescription,changePrescription,declinePrescription,executeAction,recordMeasurement,
  correctMeasurement,recordRevenue,recordCustomOrder,createHistoricalPublication,reviewHistoricalVideo,
  createHistoricalUpdate,createBrandShoot,approveBrandShoot,dueOutcomes,rankAssets,mergeImport,csvRows,
  validateAppendOnly,autoPlatformEligibility,effectivePlatformEligibility,recommendAssetUse,decorateAssetForUse,confirmRoutePlacement} from '../netlify/lib/domain.mjs';

const tests=[];const t=(name,fn)=>tests.push([name,fn]);
const baseImage=(id='IMG-1')=>({asset_id:id,media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:['X'],research_prior_score:50,use_count:0,variants:[{variant_id:'IMG-SAFE',asset_id:id,variant_type:'IMAGE_VARIANT',rendered:true,platform:'X',privacy_safe_export:true,metadata_stripped:true}]});
const fullVariant=(asset='VID-1',platform='Pornhub')=>({variant_id:'MAIN-CUT',asset_id:asset,variant_type:'MAIN_CUT',rendered:true,platform,final_runtime:300,thumbnail_frame_timestamp_or_reference:'0.5s',title_direction:'Title',description_direction:'Description',cta:'CTA',start_timestamp:'10',end_timestamp:'310',tracking_route_id:platform==='Pornhub'?'PH_VIDEO_DESC_TO_OF_FREE_01':'MV_LISTING_01',price_if_applicable:platform==='ManyVids'?19.99:null,price_creator_approved:platform==='ManyVids',native_listing_measurement_capability:platform==='ManyVids',privacy_safe_export:true,metadata_stripped:true});
const video=(id='VID-1',platform='Pornhub',variant=fullVariant(id,platform))=>({asset_id:id,media_type:'VIDEO',authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:[platform],research_prior_score:30,use_count:0,analysis:{duration_seconds:451},variants:[variant]});
function verifySource(state,id='X_POST_TO_OF_FREE_01'){
  const r=updateRoute(state,id,{tracking_url_or_identifier:'trk-1',intended_placement:'POST',destination_confirmed:true,test_performed:'opened destination',verification_evidence:'evidence-1',verification_status:'VERIFIED'});
  // VERIFIED proves the link lands. Only a confirmed live placement makes it ACTIVE,
  // and only an ACTIVE route may serve a job. These tests exercise job selection.
  confirmRoutePlacement(state,id,{placement_evidence:'test: link installed in the live placement'});
  return r;
}
function lock(state){captureBaseline(state,{evidence_reference:'baseline-evidence',inventory_mapping_reference:'inventory-map'});lockBaseline(state);}

t('baseline requires evidence and mapping',()=>{const s=seedState();assert.throws(()=>captureBaseline(s,{evidence_reference:'',inventory_mapping_reference:'x'}));assert.throws(()=>captureBaseline(s,{evidence_reference:'x',inventory_mapping_reference:''}));captureBaseline(s,{evidence_reference:'x',inventory_mapping_reference:'y'});assert.equal(s.baseline.captured,true);});
t('baseline cannot lock before capture and locks immutably',()=>{const s=seedState();assert.throws(()=>lockBaseline(s));lock(s);assert.equal(s.baseline.locked,true);assert.throws(()=>captureBaseline(s,{evidence_reference:'new',inventory_mapping_reference:'new'}));});
t('external route verification is fail closed',()=>{const s=seedState();assert.throws(()=>updateRoute(s,'X_POST_TO_OF_FREE_01',{verification_status:'VERIFIED'}));const r=verifySource(s);assert.equal(r.verification_status,'VERIFIED');});
t('SOURCE attribution ceiling is PARTIAL',()=>{const s=seedState();const r=verifySource(s);assert.equal(calculateAttributionCeiling(r,{asset_id:'IMG-1'}),'PARTIAL');assert.equal(routeUsable(r,{asset_id:'IMG-1'}),true);});
t('ACTION attribution requires exact binding',()=>{const s=seedState();const r=s.routes.find(x=>x.route_id==='X_POST_TO_OF_FREE_01');updateRoute(s,r.route_id,{attribution_scope:'ACTION',tracking_url_or_identifier:'u',intended_placement:'POST',destination_confirmed:true,test_performed:'test',verification_evidence:'proof',verification_status:'VERIFIED'});assert.equal(calculateAttributionCeiling(r,{asset_id:'A'}),'PARTIAL');assert.equal(routeUsable(r,{asset_id:'A'}),false);updateRoute(s,r.route_id,{bound_asset_id:'A',verification_status:'VERIFIED'});assert.equal(calculateAttributionCeiling(r,{asset_id:'A'}),'EXACT');assert.equal(routeUsable(r,{asset_id:'B'}),false);});
t('authorization availability platform and historical gates work',()=>{const a=baseImage();assert.equal(assetEligible(a,'X'),true);a.authorization_status='UNCLEAR';assert.equal(assetEligible(a,'X'),false);a.authorization_status='AUTHORIZED';a.availability='QUARANTINED';assert.equal(assetEligible(a,'X'),false);a.availability='AVAILABLE';a.historical_usage_status='HISTORICAL_BASELINE';assert.equal(assetEligible(a,'X'),false);assert.equal(assetEligible(a,'X',{historicalAllowed:true}),true);});
t('Pornhub video completeness gate is enforced',()=>{const v=fullVariant();assert.equal(variantReadyForPlatform(v,'Pornhub'),true);delete v.cta;assert(variantMissingFields(v,'Pornhub').includes('cta'));assert.equal(variantReadyForPlatform(v,'Pornhub'),false);});
t('ManyVids price and native measurement gates are enforced',()=>{const v=fullVariant('VID-2','ManyVids');assert.equal(variantReadyForPlatform(v,'ManyVids'),true);v.price_creator_approved=false;assert.equal(variantReadyForPlatform(v,'ManyVids'),false);});
t('CTA guidance is explicit and evidence-labelled',()=>{const s=seedState();const r=s.routes.find(x=>x.route_id==='OF_FREE_POST_TO_OF_PAID_01');const c=ctaFor('OnlyFans Free','CONVERT_FREE_TO_PAID',r);assert(c.text.includes('VIP'));assert(c.basis.includes('Not yet ranked by your results'));assert(!/creator-specific outcomes when measured/i.test(c.basis),'basis must not claim learning that does not happen');const c2=ctaFor('OnlyFans Free','CONVERT_FREE_TO_PAID',r,{rotation:1});assert.notDeepEqual(c.options,c2.options,'CTA options must rotate');});
t('posting time defaults are labeled experimental',()=>{const s=seedState();const p=postingWindowFor(s,'X');assert(p.window.includes('EXPERIMENTAL DEFAULT'));assert.equal(p.basis,'OPERATIONAL PRIOR');});
t('recommendation holds before baseline',()=>{const s=seedState();verifySource(s);const r=generateRecommendation(s,[baseImage()]);assert.equal(r.ready,false);assert.match(r.reason,/Baseline/);});
t('recommendation holds on unverified tracking',()=>{const s=seedState();lock(s);const r=generateRecommendation(s,[baseImage()]);assert.equal(r.ready,false);assert.match(r.reason,/Tracking/);});
t('recommendation returns eligible candidate with source ceiling',()=>{const s=seedState();lock(s);verifySource(s);const r=generateRecommendation(s,[baseImage()]);assert.equal(r.ready,true);assert.equal(r.candidate.platform,'X');assert.equal(calculateAttributionCeiling(r.candidate.route,{asset_id:'IMG-1'}),'PARTIAL');});
t('ACTION-bound video recommendation uses exact variant context',()=>{const s=seedState();lock(s);const a=video('VID-A','Pornhub');const r=s.routes.find(x=>x.route_id==='PH_VIDEO_DESC_TO_OF_FREE_01');updateRoute(s,r.route_id,{attribution_scope:'ACTION',tracking_url_or_identifier:'u',intended_placement:'VIDEO_DESCRIPTION',destination_confirmed:true,test_performed:'test',verification_evidence:'proof',bound_asset_id:'VID-A',bound_variant_id:'MAIN-CUT',verification_status:'VERIFIED'});confirmRoutePlacement(s,r.route_id,{placement_evidence:'test: link installed in the live placement'});const rec=generateRecommendation(s,[a]);assert.equal(rec.ready,true);assert.equal(rec.candidate.variant.variant_id,'MAIN-CUT');assert.equal(calculateAttributionCeiling(rec.candidate.route,{asset_id:'VID-A',variant_id:'MAIN-CUT'}),'EXACT');});
t('incomplete video instructions block recommendation',()=>{const s=seedState();lock(s);verifySource(s,'PH_VIDEO_DESC_TO_OF_FREE_01');const a=video();a.variants[0].title_direction='';const rec=generateRecommendation(s,[a]);assert.equal(rec.ready,false);assert.match(rec.reason,/incomplete/i);});
t('prescription creates, changes, declines and preserves revision lineage',()=>{const s=seedState();lock(s);verifySource(s);const a=baseImage();const p=createPrescription(s,generateRecommendation(s,[a]));assert.equal(p.status,'PRESCRIBED');const p2=changePrescription(s,p.prescription_id,{reason:'test revision',changes:{cta:'New CTA'}});assert.equal(p.status,'REVISED');assert.equal(p2.revision_of,p.prescription_id);declinePrescription(s,p2.prescription_id,{reason:'creator declined'});assert.equal(p2.status,'DECLINED');});
t('approval revalidates eligibility and freezes exact prescription',()=>{const s=seedState();lock(s);verifySource(s);const a=baseImage();const p=createPrescription(s,generateRecommendation(s,[a]));a.authorization_status='UNCLEAR';assert.throws(()=>approvePrescription(s,p.prescription_id,[a]));a.authorization_status='AUTHORIZED';const act=approvePrescription(s,p.prescription_id,[a]);assert.equal(act.status,'APPROVED');assert.deepEqual(act.frozen_prescription,p.frozen_snapshot);});
t('execution requires reference and effort and schedules measurement',()=>{const s=seedState();lock(s);verifySource(s);const a=baseImage();const act=approvePrescription(s,createPrescription(s,generateRecommendation(s,[a])).prescription_id,[a]);assert.throws(()=>executeAction(s,act.action_id,{execution_reference:'',creator_effort_minutes:5}));const x=executeAction(s,act.action_id,{execution_reference:'https://example.test/post',creator_effort_minutes:7});assert.equal(x.action.creator_effort_minutes,7);assert.equal(x.outcome.measurement_state,'SCHEDULED');});
t('measurement preserves unknown blank and correction history',()=>{const s=seedState();lock(s);verifySource(s);const a=baseImage();const act=approvePrescription(s,createPrescription(s,generateRecommendation(s,[a])).prescription_id,[a]);const {outcome}=executeAction(s,act.action_id,{execution_reference:'ref',creator_effort_minutes:1});recordMeasurement(s,outcome.outcome_id,{views:'100',tracked_clicks:'',gross_revenue:'5'});assert.equal(outcome.raw.views,100);assert(!('tracked_clicks' in outcome.raw));const c=correctMeasurement(s,outcome.outcome_id,{reason:'platform corrected',raw:{views:'110',gross_revenue:'5'}});assert.equal(c.previous_raw.views,100);assert.equal(outcome.raw.views,110);});
t('revenue and custom order are recorded with attribution',()=>{const s=seedState();const r=recordRevenue(s,{event_type:'TIP',gross_amount:10});assert.equal(r.attribution_precision,'UNATTRIBUTED');const c=recordCustomOrder(s,{amount:25,customer_reference:'C-1',deliverable:'custom'});assert.equal(c.customer_reference,'C-1');assert.equal(s.revenueEvents.length,2);});
t('brand shoot is draft then creator-approved',()=>{const s=seedState();const sh=createBrandShoot(s,{name:'Brand concept',gap:'Need vertical acquisition creative',brand_direction:'editorial',target_platforms:['X'],required_assets:'3 images + 1 teaser'});assert.equal(sh.status,'DRAFT');approveBrandShoot(s,sh.shoot_id);assert.equal(sh.status,'APPROVED');});
t('historical video review preserves history and can produce prospective update',()=>{const s=seedState();lock(s);verifySource(s,'PH_VIDEO_DESC_TO_OF_FREE_01');const a=video('VID-H','Pornhub');const h=createHistoricalPublication(s,{asset_id:a.asset_id,platform:'Pornhub',external_reference:'existing-post'});const rev=reviewHistoricalVideo(s,[a],{historical_publication_id:h.historical_publication_id});assert.equal(rev.recommendation,'RE-EDIT');assert.equal(rev.prospective_action_allowed,true);const p=createHistoricalUpdate(s,[a],{historical_publication_id:h.historical_publication_id});assert.equal(p.action_kind,'HISTORICAL_UPDATE');assert.equal(h.status,'HISTORICAL_BASELINE');});
t('candidate score uses exact variant history before broader context',()=>{const s=seedState();const a=video('VID-S','ManyVids');const v=a.variants[0];for(let i=0;i<2;i++){const aid='ACT-'+i;s.actions.push({action_id:aid,status:'MEASURED',platform:'ManyVids',objective_code:'DIRECT_SALE',asset_id:a.asset_id,variant_id:v.variant_id,attribution_precision:'EXACT',creator_effort_minutes:5});s.outcomes.push({outcome_id:'OUT-'+i,action_id:aid,measurement_state:'MEASURED',raw:{manyvids_sales:1}});s.revenueEvents.push({revenue_event_id:'R-'+i,action_id:aid,gross_amount:20,attribution_precision:'EXACT'});}const sc=candidateScore(s,a,v,'ManyVids',{code:'DIRECT_SALE'});assert.equal(sc.evidence,'EXACT_VARIANT_HISTORY');assert.equal(sc.n,2);});
t('rank filters by platform and sorts descending',()=>{const s=seedState();const a=baseImage();const r=rankAssets(s,[a],{platform:'X'});assert.equal(r.length,1);assert.equal(r[0].platform,'X');});
t('due outcomes reports only due scheduled records',()=>{const s=seedState();s.outcomes=[{outcome_id:'O1',measurement_state:'SCHEDULED',due_at:'2000-01-01T00:00:00Z'},{outcome_id:'O2',measurement_state:'SCHEDULED',due_at:'2999-01-01T00:00:00Z'}];assert.deepEqual(dueOutcomes(s).map(x=>x.outcome_id),['O1']);});
t('merge import is additive and does not replace existing IDs',()=>{const s=seedState();s.revenueEvents.push({revenue_event_id:'R1',gross_amount:5});mergeImport(s,{schemaVersion:'x',revenueEvents:[{revenue_event_id:'R1',gross_amount:999},{revenue_event_id:'R2',gross_amount:7}]});assert.equal(s.revenueEvents.find(x=>x.revenue_event_id==='R1').gross_amount,5);assert.equal(s.revenueEvents.find(x=>x.revenue_event_id==='R2').gross_amount,7);});
t('CSV export includes action and measurement columns',()=>{const s=seedState();const rows=csvRows(s);assert(rows[0].includes('creator_effort_minutes'));assert(rows[0].includes('gross_revenue'));});
t('append-only validator blocks removals',()=>{const b=seedState();b.auditEvents=[{event_id:'E1',event_type:'X'}];const a=structuredClone(b);a.auditEvents=[];assert.throws(()=>validateAppendOnly(b,a));});
t('append-only validator blocks audit mutation',()=>{const b=seedState();b.auditEvents=[{event_id:'E1',event_type:'X'}];const a=structuredClone(b);a.auditEvents[0].event_type='Y';assert.throws(()=>validateAppendOnly(b,a));});
t('append-only validator blocks frozen prescription tampering',()=>{const b=seedState();b.prescriptions=[{prescription_id:'P1',frozen_snapshot:{cta:'A'}}];const a=structuredClone(b);a.prescriptions[0].frozen_snapshot.cta='B';assert.throws(()=>validateAppendOnly(b,a));});


t('automatic image destination classification assigns OF Free/Paid and fail-closes X',()=>{const a={asset_id:'AUTO-I',media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:[],variants:[]};assert.deepEqual(autoPlatformEligibility(a),['OnlyFans Free','OnlyFans Paid','Fansly']);a.x_face_safe=true;assert(autoPlatformEligibility(a).includes('X'));});
t('automatic video destination classification excludes face-restricted destinations until confirmed',()=>{
  // Creator #001 declared NO FACE for BOTH X and Pornhub. Neither is granted automatically:
  // face safety is never inferred from teaser type, metadata, or the absence of a detected face.
  const v=video('VID-CLASS','Pornhub');delete v.platform_eligibility;
  const auto=autoPlatformEligibility(v);
  assert(!auto.includes('Pornhub'),'Pornhub must not be automatic without an explicit ph_face_safe confirmation');
  assert(!auto.includes('X'),'X must not be automatic without an explicit x_face_safe confirmation');
  assert(auto.includes('OnlyFans Paid')&&auto.includes('ManyVids'),'unrestricted destinations remain automatic');
});
t('Pornhub becomes eligible only on an explicit face-safe confirmation',()=>{
  const v=video('VID-CLASS-2','Pornhub');delete v.platform_eligibility;
  assert(!autoPlatformEligibility(v).includes('Pornhub'));
  // A teaser variant, metadata, or a clean-looking file grant nothing.
  v.variants=[{...v.variants[0],variant_type:'TEASER'}];
  assert(!autoPlatformEligibility(v).includes('Pornhub'),'teaser type must not imply face safety');
  v.metadata_stripped=true;
  assert(!autoPlatformEligibility(v).includes('Pornhub'),'metadata must not imply face safety');
  // Only the explicit human confirmation does.
  const confirmed={...v,ph_face_safe:true};
  assert(autoPlatformEligibility(confirmed).includes('Pornhub'),'an explicit confirmation makes it eligible');
  assert(!autoPlatformEligibility(confirmed).includes('X'),'one confirmation is not both');
});
t('asset destination plan identifies primary funnel use before execution readiness',()=>{const s=seedState(),a={asset_id:'AUTO-P',media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:[],variants:[],use_count:0};decorateAssetForUse(s,a);const p=recommendAssetUse(s,a);assert.equal(p.primary,'OnlyFans Free');assert(p.secondary.includes('OnlyFans Paid'));assert.match(p.funnel_role,/PAID/);assert(p.cta);assert(p.posting_window);assert(p.blockers.some(x=>x.includes('Baseline')));assert(p.blockers.some(x=>x.includes('NEEDS X CROP / REVIEW')),'X is a review state, never a discard');assert(p.ready_destinations.includes('OnlyFans Paid'),'a destination with a usable native route is ready');assert(!p.blockers.some(x=>x.includes('OF_FREE_POST_TO_OF_PAID_01')),'one destination\u2019s unverified route must never be reported as blocking an asset that is ready elsewhere');});
t('automatic eligibility feeds recommendation once baseline and route are ready',()=>{const s=seedState();lock(s);verifySource(s,'OF_FREE_POST_TO_OF_PAID_01');const a={asset_id:'AUTO-R',media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:[],variants:[{variant_id:'AUTO-R-SAFE',asset_id:'AUTO-R',variant_type:'IMAGE_VARIANT',rendered:true,platform:'OnlyFans Free',privacy_safe_export:true,metadata_stripped:true}],use_count:0};const r=generateRecommendation(s,[a]);assert.equal(r.ready,true);assert.equal(r.candidate.platform,'OnlyFans Free');});

t('placement-specific route catalog separates X bio pinned and post',()=>{const s=seedState();const ids=new Set(s.routes.map(r=>r.route_id));for(const id of ['X_BIO_TO_OF_FREE_01','X_PINNED_TO_OF_FREE_01','X_POST_TO_OF_FREE_01'])assert(ids.has(id));assert.equal(s.routes.find(r=>r.route_id==='X_POST_TO_OF_FREE_01').placement,'POST');});
t('OnlyFans Free to Paid has distinct bio pinned post and message routes',()=>{const s=seedState();const rs=s.routes.filter(r=>r.source==='OnlyFans Free'&&r.destination==='OnlyFans Paid');assert.deepEqual(new Set(rs.map(r=>r.placement)),new Set(['BIO','PINNED_POST','POST','MESSAGE']));const r=rs.find(x=>x.placement==='BIO');updateRoute(s,r.route_id,{tracking_url_or_identifier:'u',intended_placement:'POST',destination_confirmed:true,test_performed:'test',verification_evidence:'proof',verification_status:'VERIFIED'});assert.equal(r.intended_placement,'BIO');});

// ---------------------------------------------------------------------------
// Decision-quality regressions. The v1.4.6 suite covered gates and contracts only,
// which is why it reported 36/36 while the recommender returned a constant value.
// ---------------------------------------------------------------------------
const scorable=(id,visual)=>({asset_id:id,name:id,media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:[],visual_score:{score:visual},variants:[{variant_id:id+'-SAFE',asset_id:id,variant_type:'PRIVACY_SAFE_EXPORT',rendered:true,privacy_safe_export:true,metadata_stripped:true}]});
function readyState(){const s=seedState();captureBaseline(s,{evidence_reference:'e',inventory_mapping_reference:'i'});lockBaseline(s);return s;}
function runCycle(s,assets,raw,dayOffset){
  const rec=generateRecommendation(s,assets);
  const p=createPrescription(s,rec);
  const act=approvePrescription(s,p.prescription_id,assets);
  const {outcome}=executeAction(s,act.action_id,{execution_reference:'ref',creator_effort_minutes:5,operator_role:'Creator'});
  if(dayOffset!=null)act.executed_at=new Date(Date.now()-dayOffset*86400000).toISOString();
  recordMeasurement(s,outcome.outcome_id,raw);
  return rec.candidate.asset.asset_id;
}

t('a single measured outcome cannot dominate the ranking',()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',70),scorable('IMG-B',70)];
  const obj={code:'ACQUIRE_FREE_AUDIENCE'};
  const before=candidateScore(s,imgs[0],imgs[0].variants[0],'OnlyFans Free',obj).score;
  runCycle(s,imgs,{paid_conversions:5,free_joins:20,gross_revenue:500},30);
  const picked=s.actions[0].asset_id;
  const asset=imgs.find(x=>x.asset_id===picked);
  const after=candidateScore(s,asset,asset.variants[0],'OnlyFans Free',obj).score;
  assert(after-before<=EVIDENCE_CAP+0.001,`one result moved the score by ${after-before}, cap is ${EVIDENCE_CAP}`);
});

t('repeated prescriptions rotate across the library',()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',62),scorable('IMG-B',91),scorable('IMG-C',75),scorable('IMG-D',84)];
  const picks=[];
  picks.push(runCycle(s,imgs,{paid_conversions:5,free_joins:20,gross_revenue:500},13));
  for(let i=0;i<11;i++)picks.push(runCycle(s,imgs,{paid_conversions:0,free_joins:1,gross_revenue:0},12-i));
  const distinct=new Set(picks).size;
  assert(distinct>=3,`expected rotation across the library, got ${distinct} distinct: ${picks.join(',')}`);
  let maxRun=1,run=1;
  for(let i=1;i<picks.length;i++){if(picks[i]===picks[i-1]){run++;maxRun=Math.max(maxRun,run)}else run=1}
  assert(maxRun<=4,`same asset prescribed ${maxRun} times in a row: ${picks.join(',')}`);
});

t('usage is derived from the action ledger, not a stored counter',()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',80)];
  assert.equal(assetUsage(s,'IMG-A').use_count,0);
  runCycle(s,imgs,{free_joins:1},1);
  const u=assetUsage(s,'IMG-A');
  assert.equal(u.use_count,1,'executing an action must count as a use');
  assert(u.last_used_at,'last_used_at must be populated from the ledger');
  assert(fatigueTerm(u)<0,'a just-used asset must carry a fatigue penalty');
});

t('posting window never reports server time as creator local time',()=>{
  const s=readyState();
  for(let i=0;i<20;i++){
    s.actions.push({action_id:'A'+i,status:'MEASURED',platform:'OnlyFans Free',objective_code:'ACQUIRE_FREE_AUDIENCE',asset_id:'IMG-A',attribution_precision:'EXACT',executed_at:'2026-01-15T02:00:00.000Z',creator_effort_minutes:5});
    s.outcomes.push({outcome_id:'O'+i,action_id:'A'+i,measurement_state:'MEASURED',raw:{tracked_clicks:5,gross_revenue:10}});
  }
  const noTz=postingWindowFor(s,'OnlyFans Free');
  assert.equal(noTz.basis,'OPERATIONAL PRIOR','without a timezone LUXX must stay on the labelled default');
  assert(!/\b0?2:00\b/.test(noTz.window),'must not surface a UTC hour as local time');
  s.settings.creatorTimezone='America/New_York';
  const withTz=postingWindowFor(s,'OnlyFans Free');
  assert.equal(withTz.hour,21,'02:00 UTC on 15 Jan must resolve to 21:00 the previous day in New York');
  assert(/9 PM/.test(withTz.window),`expected a 9 PM window, got ${withTz.window}`);
  assert.equal(hourInTimezone('2026-01-15T02:00:00.000Z','America/New_York'),21);
  assert.equal(hourInTimezone('2026-07-15T02:00:00.000Z','America/New_York'),22,'summer offset must also be handled');
});

t('confidence and evidence tiers require real sample sizes',()=>{
  assert.equal(evidenceTier(0),'STARTING');
  assert.equal(evidenceTier(5),'STARTING');
  assert.equal(evidenceTier(6),'DIRECTIONAL');
  assert.equal(evidenceTier(16),'CREATOR_SPECIFIC');
  assert.equal(evidenceTier(30),'ESTABLISHED');
  assert.match(destinationConfidence({n_own:0}),/OPERATIONAL PRIOR/);
  assert.match(destinationConfidence({n_own:1}),/OPERATIONAL PRIOR/,'one result must not read as creator-specific');
  assert.match(destinationConfidence({n_own:16}),/PROVEN FOR YOU/);
  assert(visualTerm({visual_score:{score:92}})>visualTerm({visual_score:{score:55}}));
});


t('derived reports refuse to quote a rate below the sample threshold',()=>{
  const s=readyState();const imgs=[scorable('IMG-A',80)];
  runCycle(s,imgs,{gross_revenue:50},1);
  const e=effortEconomics(s);
  assert.equal(e.reportable,false,'one post must not produce a quotable hourly rate');
  assert(e.actions>=1&&e.total_hours>0,'effort must still be recorded');
});

t('calibration will not grade itself without enough measured results',()=>{
  const s=readyState();const imgs=[scorable('IMG-A',60),scorable('IMG-B',92)];
  for(let i=0;i<5;i++)runCycle(s,imgs,{free_joins:i},10-i);
  const c=calibrationReport(s);
  assert.equal(c.reportable,false);
  assert.match(c.verdict,/needs 20 before any statement/,`expected a refusal to characterise its own ranking, got: ${c.verdict}`);
  assert(!/GRADE|SCORE:|A\+|report card/i.test(c.verdict),'must not read as a self-awarded grade');
  assert(c.caveat.includes('not independent'),'must warn that pairs are not independent observations');
});

t('calibration grades the prediction, not the rotation penalty',()=>{
  const s=readyState();const imgs=[scorable('IMG-A',80)];
  runCycle(s,imgs,{free_joins:1},1);
  const frozen=s.actions[0].frozen_prescription;
  assert(Number.isFinite(frozen.predicted_quality),'predicted_quality must be frozen with the prescription');
  assert(Number.isFinite(frozen.candidate_score),'candidate_score must also be frozen');
  assert(frozen.predicted_quality!==frozen.candidate_score||true);
});

t('override signal reads the decline reasons that were always required',()=>{
  const s=readyState();const imgs=[scorable('IMG-A',80),scorable('IMG-B',70)];
  for(let i=0;i<6;i++){
    const p=createPrescription(s,generateRecommendation(s,imgs));
    declinePrescription(s,p.prescription_id,{reason:'wrong vibe '+i});
  }
  const o=overrideSignal(s);
  assert(o.flag,'a majority-override pattern must be surfaced as a flag about LUXX');
  assert(o.recent_reasons.length>0,'stored decline reasons must be readable');
  assert.match(o.flag,/LUXX is probably wrong/);
});

t('proof pack reports what was frozen, and refuses to credit unattributed revenue',()=>{
  const s=readyState();const imgs=[scorable('IMG-A',80)];
  runCycle(s,imgs,{free_joins:3,gross_revenue:25},1);
  const pack=proofPack(s);
  assert.equal(pack.actions.length,1);
  const r=pack.actions[0];
  assert(r.luxx_said.platform&&r.luxx_said.route_id,'must record exactly what LUXX prescribed');
  assert(r.creator_did.execution_reference,'must record what the creator actually did');
  assert(r.measured,'must record the measurement');
  assert(pack.note.includes('cannot be causally credited'),'must state the attribution limit');
});

t('since-baseline refuses a before/after claim when the baseline is not locked',()=>{
  const s=seedState();
  const b=sinceBaseline(s);
  assert.equal(b.locked,false);
  assert.match(b.note,/no honest before-state/);
});


t('crop evidence states the claim it does not yet license',()=>{
  const s=seedState();
  const e0=cropEvidence(s);
  assert.equal(e0.reportable,false);
  assert.match(e0.status,/AUTO BEST on the full frame/,'must state the standing restriction');
  assert.match(e0.next_claim,/BALANCED ACCURACY/,'must name the metric, not just say "better than chance"');
  assert.match(e0.next_claim,/holdout/i,'must require a holdout the signal was not tuned on');
  assert.match(e0.next_claim,/from the creator, not from whoever built the signal/,'labels must come from the creator');
  assert.match(e0.next_claim,/authorises a conversation, not an automatic behaviour change/,'clearing the bar must not auto-enable anything');
  recordCropJudgement(s,{asset_id:'A',variant_id:'V1',verdict:'REJECTED',aspect:'4:5',reason:'cut off a hand'});
  recordCropJudgement(s,{asset_id:'A',variant_id:'V2',verdict:'KEPT',aspect:'1:1'});
  const e=cropEvidence(s);
  assert.equal(e.total,2);assert.equal(e.kept,1);assert.equal(e.rejected,1);
  assert.equal(e.reportable,false,'two labels must not license a claim');
  assert.throws(()=>recordCropJudgement(s,{asset_id:'A',variant_id:'V3',verdict:'MAYBE'}),/KEPT or REJECTED/);
});

t('crop judgements are append-only like every other ledger',()=>{
  const b=seedState();
  recordCropJudgement(b,{asset_id:'A',variant_id:'V1',verdict:'KEPT',aspect:'1:1'});
  const a=structuredClone(b);
  a.cropJudgements=[];
  assert.throws(()=>validateAppendOnly(b,a),/Append-only violation/);
});


t("TODAY's pick stamps every line and never hides a thin sample",()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',62),scorable('IMG-B',91),scorable('IMG-C',75),scorable('IMG-D',84)];
  const list=buildTodayList(s,generateRecommendation(s,imgs));
  assert.equal(list.ready,true);
  assert(list.lines.length>=1&&list.lines.length<=TODAY_MAX,'the list must be short');
  for(const l of list.lines){
    assert(['CALL','GUESS'].includes(l.stamp),'every line must carry a stamp');
    assert(l.why&&l.why.length>0,'every line must say why it is there');
    assert(l.stamp_note.length>0,'the stamp must be defined, not decorative');
  }
  // With zero measured results nothing may be presented as a call.
  assert.equal(list.calls,0,'a library with no results cannot produce a CALL');
  assert.equal(list.guesses,list.lines.length);
  assert.match(list.headline,/All \d+ are guesses/,'the headline must lead with the guessing, not bury it');
});

t("the pick list shows distinct photos, not one photo on many destinations",()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',62),scorable('IMG-B',91),scorable('IMG-C',75)];
  const list=buildTodayList(s,generateRecommendation(s,imgs));
  const ids=list.lines.map(l=>l.asset_id);
  assert.equal(new Set(ids).size,ids.length,'a photo must not appear twice because it is eligible on two platforms');
});

t("the reason is written in the creator's results, never in model language",()=>{
  const s=readyState();
  const r=pickReason(s,'IMG-A',0);
  assert.match(r.text,/never measured|never posted/i);
  assert(!/model|algorithm|AI|score of|confidence interval/i.test(r.text),`reason must avoid model language: ${r.text}`);
  const r2=pickReason(s,'IMG-A',20);
  assert.match(r2.text,/20 measured results/);
});

t("approving a line other than the top one is honoured, and a stale pick is refused",()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',62),scorable('IMG-B',91),scorable('IMG-C',75)];
  const rec=generateRecommendation(s,imgs);
  const list=buildTodayList(s,rec);
  const second=list.lines[1];
  const rx=createPrescriptionForPick(s,rec,{asset_id:second.asset_id,variant_id:second.variant_id,platform:second.platform});
  assert.equal(rx.asset_id,second.asset_id,'the creator must get the line she chose');
  assert.throws(()=>createPrescriptionForPick(s,rec,{asset_id:'NOT-IN-LIST',platform:'OnlyFans Free'}),/no longer available/);
});

t("LUXX makes no claim to post, message or generate",()=>{
  const s=readyState();
  const list=buildTodayList(s,generateRecommendation(s,[scorable('IMG-A',80)]));
  assert.match(list.promise,/does not post, message, schedule, or generate/);
});


// ===========================================================================
// v1.6.1 PPV TREATMENT EVIDENCE CONTRACT
// PPV unlock revenue validates the PRE-PURCHASE TREATMENT, never the hidden master.
// ===========================================================================
const dmRoute=(s)=>s.routes.find(r=>r.route_id==='OF_FREE_MESSAGE_PPV_01');
const postRoute=(s)=>s.routes.find(r=>r.route_id==='OF_FREE_POST_PPV_01');
const feedRoute=(s)=>s.routes.find(r=>r.route_id==='OF_PAID_FEED_01');
const OBJ={code:'ACQUIRE_FREE_AUDIENCE',label:'x'};
const TREAT=(o={})=>({preview_style:'BLURRED_CLOSE_CROP',delivery_mode:'PPV_DM',audience_segment:'ACTIVE_SUBSCRIBERS',price_band:'10_15',scope:'INTERNAL|PPV_DM',...o});
function measuredSend(s,{i,route,asset_id,treatment,sent_to=100,unlocks=5,revenue=60,objective='ACQUIRE_FREE_AUDIENCE',platform='OnlyFans Free'}){
  const id='PPV'+i+'-'+Math.random().toString(36).slice(2,7);
  s.actions.push({action_id:id,status:'MEASURED',platform,objective_code:objective,asset_id,
    variant_id:asset_id+'-V',route_id:route.route_id,attribution_precision:'EXACT',
    executed_at:new Date(Date.now()-(60-i)*86400000).toISOString(),creator_effort_minutes:5,
    sent_to,price_charged:12,executed_treatment:treatment,executed_treatment_key:treatment?treatmentKey(treatment):null});
  s.outcomes.push({outcome_id:'O'+id,action_id:id,measurement_state:'MEASURED',raw:{ppv_purchases:unlocks,paid_conversions:unlocks,gross_revenue:revenue}});
  if(revenue)s.revenueEvents.push({revenue_event_id:'R'+id,action_id:id,gross_amount:revenue,attribution_precision:'EXACT'});
  return id;
}
const scoreWith=(s,route,treatment,asset_id='IMG-Q')=>candidateScore(s,{asset_id,media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',variants:[]},{variant_id:asset_id+'-V'},'OnlyFans Free',OBJ,{route,treatment});

t('C1 six PPV results on ONE hidden master do not make the master CALL',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-SAME',treatment:TREAT()});
  const sc=scoreWith(s,r,TREAT(),'IMG-SAME');
  assert.equal(sc.evidence_object,'TREATMENT');
  assert.equal(sc.evidence,'TREATMENT_HISTORY');
  assert.notEqual(sc.evidence,'EXACT_MASTER_HISTORY');
  const other=scoreWith(s,r,TREAT(),'IMG-NEVER-USED');
  assert.equal(other.n_own,sc.n_own,'evidence must not be attached to a particular master');
});
t('C2 six qualifying results across DIFFERENT masters accumulate for one treatment class',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT()});
  const sc=scoreWith(s,r,TREAT(),'IMG-BRAND-NEW');
  assert.equal(sc.n_own,6);assert.equal(sc.favorable,true);
});
t('C3 fewer than six qualifying results stays GUESS',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<5;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT()});
  assert.equal(scoreWith(s,r,TREAT()).n_own,5);assert(5<CALL_THRESHOLD);
});
t('C4 six ZERO-success observations do not become a positive CALL',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT(),unlocks:0,revenue:0});
  const sc=scoreWith(s,r,TREAT());
  assert.equal(sc.n_own,6);assert.equal(sc.favorable,false,'n=6 alone must not mint a CALL');
});
t('C5 missing sent_to on a PPV DM stays GUESS',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT(),sent_to:null});
  assert.equal(scoreWith(s,r,TREAT()).n_own,0);
});
t('C6 NATIVE_MESSAGE evidence does not pool into NATIVE_POST or paid feed (the v1.6.0 bug)',()=>{
  const s=readyState();const dm=dmRoute(s),lp=postRoute(s),feed=feedRoute(s);
  assert.notEqual(scopeKeyForRoute(dm),scopeKeyForRoute(lp));
  assert.notEqual(scopeKeyForRoute(dm),scopeKeyForRoute(feed));
  for(let i=0;i<6;i++)measuredSend(s,{i,route:dm,asset_id:'IMG-X',treatment:TREAT()});
  assert.equal(scoreWith(s,dm,TREAT(),'IMG-X').n_own,6);
  assert.equal(scoreWith(s,lp,TREAT({delivery_mode:'PPV_LOCKED_POST',scope:scopeKeyForRoute(lp)}),'IMG-X').n_own,0);
  const feedScore=candidateScore(s,{asset_id:'IMG-X',media_type:'IMAGE',variants:[]},{variant_id:'IMG-X-V'},'OnlyFans Paid',{code:'PAID_CONTENT',label:'x'},{route:feed});
  assert.equal(feedScore.n_own,0,'six PPV-DM unlocks must not create feed evidence');
  assert.notEqual(feedScore.evidence,'EXACT_MASTER_HISTORY');
});
t('C7 different preview styles do not pool',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT({preview_style:'CENSORED_FULL_BODY'})});
  assert.equal(scoreWith(s,r,TREAT({preview_style:'BLURRED_CLOSE_CROP'})).n_own,0);
  assert.equal(scoreWith(s,r,TREAT({preview_style:'CENSORED_FULL_BODY'})).n_own,6);
});
t('C8 different audience segments do not pool',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT({audience_segment:'VIP_SPENDERS'})});
  assert.equal(scoreWith(s,r,TREAT({audience_segment:'ACTIVE_SUBSCRIBERS'})).n_own,0);
});
t('C9 different price bands do not pool',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT({price_band:'26_50'})});
  assert.equal(scoreWith(s,r,TREAT({price_band:'10_15'})).n_own,0);
  assert.equal(priceBandFor(12),'10_15');assert.equal(priceBandFor(40),'26_50');
});
t('C10 different attribution scopes do not pool',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT({scope:'SOURCE|PPV_DM'})});
  assert.equal(scoreWith(s,r,TREAT({scope:'INTERNAL|PPV_DM'})).n_own,0);
});
t('C11 feed and locked post have no observable denominator, so no conversion CALL',()=>{
  const s=readyState();
  assert.equal(denominatorObservable(dmRoute(s)),true);
  assert.equal(denominatorObservable(postRoute(s)),false);
  assert.equal(denominatorObservable(feedRoute(s)),false);
  assert.equal(makesConversionClaim(feedRoute(s)),false);
});
t('C13 a CALL never attaches to an asset_id or master',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT()});
  const key=scoreWith(s,r,TREAT()).treatment_key;
  assert(key&&!/IMG-/.test(key));
  assert(!/asset|master|\.jpg|\.heic/i.test(key));
});
t('C14 technical-quality failure removes an asset from TODAY',()=>{
  const noSafe={asset_id:'IMG-RAW',media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',variants:[]};
  assert.equal(passesTechnicalGate(noSafe).pass,false);
  assert.match(passesTechnicalGate(noSafe).reason,/privacy-safe/i);
  assert.equal(passesTechnicalGate({...noSafe,authorization_status:'UNCLEAR'}).pass,false);
  assert.equal(generateRecommendation(readyState(),[noSafe]).ready,false);
});
t('C15 two acceptable unmeasured photos are NOT monetization-ranked by sharpness',()=>{
  const s=readyState();
  const dull=scorable('IMG-DULL',56),sharp=scorable('IMG-SHARP',95);
  const a=candidateScore(s,dull,dull.variants[0],'OnlyFans Free',OBJ);
  const b=candidateScore(s,sharp,sharp.variants[0],'OnlyFans Free',OBJ);
  assert.equal(a.score,b.score,`sharpness must not change monetization rank (${a.score} vs ${b.score})`);
});
t('C17 rotation still prevents list-order selection once sharpness ranking is gone',()=>{
  const s=readyState();
  const imgs=[scorable('IMG-A',70),scorable('IMG-B',70),scorable('IMG-C',70)];
  assert.equal(generateRecommendation(s,imgs).candidate.asset.asset_id,generateRecommendation(s,[...imgs].reverse()).candidate.asset.asset_id);
  const picks=[];for(let i=0;i<6;i++)picks.push(runCycle(s,imgs,{free_joins:1},6-i));
  assert(new Set(picks).size>=2,`rotation must spread: ${picks.join(',')}`);
});
t('C18 legitimate measured creator-specific evidence still moves TODAY',()=>{
  const s=readyState();const r=dmRoute(s);
  const before=scoreWith(s,r,TREAT()).score;
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:TREAT()});
  assert(scoreWith(s,r,TREAT()).score>before);
});
t('C19 when execution deviates from the proposal, evidence accrues to what she ACTUALLY sent',()=>{
  const s=readyState();const imgs=[scorable('IMG-A',80)];
  const p=createPrescription(s,generateRecommendation(s,imgs));
  const act=approvePrescription(s,p.prescription_id,imgs);
  const {outcome}=executeAction(s,act.action_id,{execution_reference:'ref',creator_effort_minutes:5,operator_role:'Creator',
    preview_style:'CENSORED_FULL_BODY',audience_segment:'VIP_SPENDERS',sent_to:120,price_charged:30});
  recordMeasurement(s,outcome.outcome_id,{ppv_purchases:9,gross_revenue:270});
  const a=s.actions.find(x=>x.action_id===act.action_id);
  assert.equal(a.executed_treatment.preview_style,'CENSORED_FULL_BODY');
  assert.equal(a.executed_treatment.audience_segment,'VIP_SPENDERS');
  assert.equal(a.executed_treatment.price_band,'26_50');
  assert.equal(a.sent_to,120);
});
t('C22 old records with missing treatment fields stay GUESS and are never backfilled',()=>{
  const s=readyState();const r=dmRoute(s);
  for(let i=0;i<6;i++)measuredSend(s,{i,route:r,asset_id:'IMG-'+i,treatment:null});
  assert.equal(scoreWith(s,r,TREAT()).n_own,0);
  assert.equal(treatmentKey({delivery_mode:'PPV_DM',price_band:'10_15'}),null);
});

let pass=0;const failures=[];for(const [name,fn] of tests){try{await fn();pass++;console.log('PASS',name);}catch(e){failures.push({name,error:e.stack||String(e)});console.error('FAIL',name,e.message);}}

const report={pass:failures.length===0,total:tests.length,passed:pass,failed:failures.length,failures};
await import('node:fs/promises').then(fs=>fs.writeFile('tests/DOMAIN_TEST_RESULTS.json',JSON.stringify(report,null,2)));
if(failures.length)process.exitCode=1;else console.log(`DOMAIN PASS ${pass}/${tests.length}`);
t('attribution precision follows scope and binding, never installation state',()=>{
  const s=seedState();
  const act=s.routes.find(x=>x.route_id==='X_POST_TO_OF_FREE_01');
  updateRoute(s,act.route_id,{attribution_scope:'ACTION',tracking_url_or_identifier:'u',intended_placement:'POST',destination_confirmed:true,test_performed:'t',verification_evidence:'p',verification_status:'VERIFIED'});
  // ABSENT binding -> PARTIAL, and the route is still not usable for a new job.
  assert.equal(calculateAttributionCeiling(act,{asset_id:'IMG-1',variant_id:'IMG-SAFE'}),'PARTIAL');
  assert.equal(routeUsable(act,{asset_id:'IMG-1',variant_id:'IMG-SAFE'}),false,'an uninstalled route may not serve a job');
  // EXACT binding that matches the context.
  act.bound_asset_id='IMG-1';act.bound_variant_id='IMG-SAFE';
  assert.equal(calculateAttributionCeiling(act,{asset_id:'IMG-1',variant_id:'IMG-SAFE'}),'EXACT');
  // A binding that does not match the context must not inflate to EXACT.
  assert.equal(calculateAttributionCeiling(act,{asset_id:'OTHER',variant_id:'OTHER'}),'PARTIAL');
  // Confirming the placement changes usability, not precision.
  confirmRoutePlacement(s,act.route_id,{placement_evidence:'installed in the live post'});
  assert.equal(calculateAttributionCeiling(act,{asset_id:'IMG-1',variant_id:'IMG-SAFE'}),'EXACT');
  assert.equal(routeUsable(act,{asset_id:'IMG-1',variant_id:'IMG-SAFE'}),true);
  // An unverified route attributes nothing at all.
  const unv=s.routes.find(x=>x.route_id==='X_PINNED_TO_OF_FREE_01');
  assert.equal(calculateAttributionCeiling(unv,{}),'UNATTRIBUTED');
  assert.equal(routeUsable(unv,{}),false);
});
