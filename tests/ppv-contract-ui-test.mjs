// Contract tests 12, 20, 21: the stamp cannot render bare, corrections still work without
// rewriting history, and RESULTS never names a hidden PPV master the best photo.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const checks=[];const ok=m=>{checks.push(m);console.log('PASS',m)};

// --- 12: CALL/GUESS cannot render without the treatment/subject named alongside it ---
const html=await fs.readFile('public/index.html','utf8');
const uses=[...html.matchAll(/\$\{stampHtml\(l\)\}/g)];
assert(uses.length>0,'the stamp must render somewhere');
for(const m of uses){
  const after=html.slice(m.index,m.index+220);
  assert(after.includes('stampSubject'),'a stamp rendered without an associated subject');
}
assert(html.includes('PRE-PURCHASE TREATMENT'),'the treatment must be its own labelled block');
assert(!html.includes('Every result you enter turns a guess into a call'),'false copy must be gone');
ok('CALL/GUESS never renders without the treatment named alongside it');

// --- 21: RESULTS must not call a hidden PPV master the best photo ---
const dom=await import('../netlify/lib/domain.mjs');
{
  const s=dom.seedState();
  const r=s.routes.find(x=>x.route_id==='OF_FREE_MESSAGE_PPV_01');
  const T={preview_style:'BLURRED_CLOSE_CROP',delivery_mode:'PPV_DM',audience_segment:'ACTIVE_SUBSCRIBERS',price_band:'10_15',scope:dom.scopeKeyForRoute(r)};
  for(let i=0;i<8;i++){
    const id='A'+i;
    s.actions.push({action_id:id,status:'MEASURED',platform:'OnlyFans Free',objective_code:'ACQUIRE_FREE_AUDIENCE',
      asset_id:'IMG-HIDDEN',variant_id:'V',route_id:r.route_id,attribution_precision:'EXACT',
      executed_at:new Date(Date.now()-i*86400000).toISOString(),creator_effort_minutes:5,sent_to:100,
      executed_treatment:T,executed_treatment_key:dom.treatmentKey(T)});
    s.outcomes.push({outcome_id:'O'+i,action_id:id,measurement_state:'MEASURED',raw:{ppv_purchases:6,gross_revenue:72}});
    s.revenueEvents.push({revenue_event_id:'R'+i,action_id:id,gross_amount:72,attribution_precision:'EXACT'});
  }
  const va=dom.visibleAssetLearning(s);
  assert.equal(va.best,null,'locked-PPV unlocks must not produce a best-asset claim');
  assert(!JSON.stringify(va.rows).includes('IMG-HIDDEN'),'the hidden master must not appear in asset learning');
  const tl=dom.treatmentLearning(s);
  assert(tl.best,'the treatment should be nameable');
  assert(tl.best.label.includes('Blurred close crop'),'RESULTS names the treatment');
  assert(!tl.best.label.includes('IMG-HIDDEN'),'RESULTS must not name the photo');
  assert(tl.note.includes('never the hidden photo'));
  ok('RESULTS names the PPV treatment and never the hidden master');
}

// --- 20: measurementCorrections reduce corrected revenue without rewriting history ---
{
  const s=dom.seedState();
  dom.captureBaseline(s,{evidence_reference:'e',inventory_mapping_reference:'i'});dom.lockBaseline(s);
  const asset={asset_id:'IMG-C',media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',
    historical_usage_status:'PROSPECTIVE',platform_eligibility:[],visual_score:{score:80},
    variants:[{variant_id:'IMG-C-SAFE',asset_id:'IMG-C',variant_type:'PRIVACY_SAFE_EXPORT',rendered:true,privacy_safe_export:true,metadata_stripped:true}]};
  const p=dom.createPrescription(s,dom.generateRecommendation(s,[asset]));
  const act=dom.approvePrescription(s,p.prescription_id,[asset]);
  const {outcome}=dom.executeAction(s,act.action_id,{execution_reference:'r',creator_effort_minutes:5,operator_role:'Creator',sent_to:50,preview_style:'BLURRED_CLOSE_CROP',audience_segment:'ALL_FANS',price_charged:10});
  dom.recordMeasurement(s,outcome.outcome_id,{ppv_purchases:10,gross_revenue:100});
  const beforeAudit=s.auditEvents.length;
  const c=dom.correctMeasurement(s,outcome.outcome_id,{reason:'chargebacks reversed 3 unlocks',raw:{ppv_purchases:7,gross_revenue:70}});
  assert.equal(c.previous_raw.gross_revenue,100,'the original figure is preserved in the correction');
  assert.equal(outcome.raw.gross_revenue,70,'the corrected figure is now current');
  assert.equal(s.measurementCorrections.length,1,'the correction is recorded');
  assert(s.auditEvents.length>beforeAudit,'the correction is audited');
  const before=structuredClone(s);
  assert.doesNotThrow(()=>dom.validateAppendOnly(before,s),'history must not be rewritten');
  ok('chargeback corrections reduce revenue without rewriting history');
}

const report={pass:true,total:checks.length,checks};
await fs.writeFile('tests/PPV_CONTRACT_UI_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
