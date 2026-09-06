// SUNDAY LAUNCH GATES. These are the checks that decide whether Monday runs on the app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const d=await import('../netlify/lib/domain.mjs');
const checks=[];const ok=m=>{checks.push(m);console.log('PASS',m)};

const mkImg=(id)=>({asset_id:id,name:id+'.jpg',media_type:'IMAGE',authorization_status:'AUTHORIZED',
  availability:'AVAILABLE',historical_usage_status:'PROSPECTIVE',platform_eligibility:[],visual_score:{score:78},
  variants:[{variant_id:id+'-SAFE',asset_id:id,variant_type:'PRIVACY_SAFE_EXPORT',rendered:true,privacy_safe_export:true,metadata_stripped:true}]});
function ready(){const s=d.seedState();d.captureBaseline(s,{evidence_reference:'e',inventory_mapping_reference:'i'});d.lockBaseline(s);return s;}

// ---------------- GATE 1: Monday..Sunday show JOBS, not a warehouse ----------------
{
  const s=ready();
  const imgs=['A','B','C','D','E','F','G','H'].map(x=>mkImg('IMG-'+x));
  const days=['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'];
  for(const day of days){
    const plan=d.buildTodayPlan(s,imgs,{date:day+'T15:00:00Z'});
    const cap=plan.cam_day?d.MAX_JOBS_CAM:d.MAX_JOBS_NORMAL;
    assert(plan.lines.length<=cap,`${plan.day}: ${plan.lines.length} lines exceeds cap ${cap}`);
    assert(plan.lines.length>0,`${plan.day}: produced no jobs`);
    for(const l of plan.lines){
      assert(d.JOB_CLASSES.includes(l.job),`${plan.day}: line has no job class`);
      assert(l.label,'every job line must say what the job is');
      assert(l.stamp==='GUESS'||l.stamp==='CALL','every line carries a stamp');
    }
    assert.match(plan.schedule_basis,/not creator-specific proof/,'the schedule must be labelled a default');
  }
  // Nothing is a cam day until the creator's own availability is configured, and no
  // LIVE time is ever invented in the meantime.
  for(const day of days){
    const plan=d.buildTodayPlan(s,imgs,{date:day+'T15:00:00Z'});
    assert.equal(plan.cam_day,false,`${plan.day}: cam day before availability is configured`);
    assert.equal(plan.cam_setup_required,true,`${plan.day}: must report cam setup required`);
    assert(!plan.lines.some(l=>l.kind==='LIVE_SESSION'),`${plan.day}: scheduled a LIVE session with no configured availability`);
    for(const l of plan.lines)assert(!/\d\s*(AM|PM)/i.test(l.label||''),`${plan.day}: invented a clock time in a job label`);
  }
  const monBefore=d.buildTodayPlan(s,imgs,{date:'2026-09-07T15:00:00Z'});
  const notice=monBefore.lines.find(l=>l.job==='LIVE');
  assert(notice&&notice.kind==='SETUP_REQUIRED'&&notice.actionable===false,'a weekday must show a non-actionable SETUP REQUIRED cam notice');
  assert.match(notice.label,/CAM AVAILABILITY NOT FINALIZED/);
  assert(monBefore.lines.length<=4,'a normal day is capped at 4');
  assert(monBefore.lines.some(l=>l.job==='MONETIZE')&&monBefore.lines.some(l=>l.job==='ACQUIRE'),'Monday has both jobs');

  // Once configured, LIVE appears only on the configured weekdays, inside that window.
  d.setCamAvailability(s,{days:['TUE','FRI'],earliest_start:'09:00',latest_end:'13:00',timezone:'America/Chicago'});
  const fri=d.buildTodayPlan(s,imgs,{date:'2026-09-11T15:00:00Z'});
  assert.equal(fri.cam_day,true,'a configured weekday is a cam day');
  assert(fri.lines.some(l=>l.job==='LIVE'&&l.kind==='LIVE_SESSION'),'a configured weekday must contain the LIVE job');
  assert(fri.lines.length<=5,'cam day capped at 5');
  assert.match(fri.lines.find(l=>l.job==='LIVE').label,/9:00 AM–1:00 PM/,'the LIVE label uses the configured window');
  const wed=d.buildTodayPlan(s,imgs,{date:'2026-09-09T15:00:00Z'});
  assert.equal(wed.cam_day,false,'an unconfigured weekday is not a cam day');
  for(const weekend of ['2026-09-12','2026-09-13']){
    const w=d.buildTodayPlan(s,imgs,{date:weekend+'T15:00:00Z'});
    assert.equal(w.cam_day,false,'weekend can never be a cam day');
    assert(!w.lines.some(l=>l.job==='LIVE'),'weekend must carry no LIVE line at all');
  }
  ok('GATE 1 — every day Mon..Sun returns jobs within cap, never a warehouse list, and cam days come only from configured availability');
}

// ---------------- GATE 2: PPV evidence contract holds ----------------
{
  const s=ready();
  const dm=s.routes.find(r=>r.route_id==='OF_FREE_MESSAGE_PPV_01');
  const feed=s.routes.find(r=>r.route_id==='OF_PAID_FEED_01');
  const T={preview_style:'BLURRED_CLOSE_CROP',delivery_mode:'PPV_DM',audience_segment:'ACTIVE_SUBSCRIBERS',price_band:'10_15',scope:d.scopeKeyForRoute(dm)};
  for(let i=0;i<6;i++){
    s.actions.push({action_id:'G'+i,status:'MEASURED',platform:'OnlyFans Free',objective_code:'ACQUIRE_FREE_AUDIENCE',
      asset_id:'IMG-HIDDEN',variant_id:'V',route_id:dm.route_id,attribution_precision:'EXACT',sent_to:100,
      executed_at:new Date(Date.now()-i*86400000).toISOString(),creator_effort_minutes:5,
      executed_treatment:T,executed_treatment_key:d.treatmentKey(T)});
    s.outcomes.push({outcome_id:'GO'+i,action_id:'G'+i,measurement_state:'MEASURED',raw:{ppv_purchases:6,gross_revenue:72}});
    s.revenueEvents.push({revenue_event_id:'GR'+i,action_id:'G'+i,gross_amount:72,attribution_precision:'EXACT'});
  }
  const sc=d.candidateScore(s,{asset_id:'IMG-HIDDEN',media_type:'IMAGE',variants:[]},{variant_id:'V'},'OnlyFans Free',{code:'ACQUIRE_FREE_AUDIENCE'},{route:dm,treatment:T});
  assert.equal(sc.evidence_object,'TREATMENT','six PPV results must never CALL the hidden photo');
  assert.notEqual(sc.evidence,'EXACT_MASTER_HISTORY');
  const feedScore=d.candidateScore(s,{asset_id:'IMG-HIDDEN',media_type:'IMAGE',variants:[]},{variant_id:'V'},'OnlyFans Paid',{code:'PAID_CONTENT'},{route:feed});
  assert.equal(feedScore.n_own,0,'DM evidence must not leak into the feed');
  // missing denominator
  const s2=ready();
  for(let i=0;i<6;i++){
    s2.actions.push({action_id:'N'+i,status:'MEASURED',platform:'OnlyFans Free',objective_code:'ACQUIRE_FREE_AUDIENCE',
      asset_id:'IMG-X',variant_id:'V',route_id:dm.route_id,attribution_precision:'EXACT',sent_to:null,
      executed_at:new Date().toISOString(),creator_effort_minutes:5,executed_treatment:T,executed_treatment_key:d.treatmentKey(T)});
    s2.outcomes.push({outcome_id:'NO'+i,action_id:'N'+i,measurement_state:'MEASURED',raw:{ppv_purchases:6}});
  }
  assert.equal(d.candidateScore(s2,{asset_id:'IMG-X',media_type:'IMAGE',variants:[]},{variant_id:'V'},'OnlyFans Free',{code:'ACQUIRE_FREE_AUDIENCE'},{route:dm,treatment:T}).n_own,0,'missing sent_to stays GUESS');
  ok('GATE 2 — six PPV results never CALL the photo; no denominator stays GUESS; no DM→feed leak');
}

// ---------------- GATE 3: actual execution overrides the proposal ----------------
{
  const s=ready();
  const imgs=[mkImg('IMG-A')];
  const p=d.createPrescription(s,d.generateRecommendation(s,imgs));
  const act=d.approvePrescription(s,p.prescription_id,imgs);
  const {outcome}=d.executeAction(s,act.action_id,{execution_reference:'r',creator_effort_minutes:6,operator_role:'Creator',
    preview_style:'CENSORED_FULL_BODY',audience_segment:'VIP_SPENDERS',price_charged:35,sent_to:88});
  d.recordMeasurement(s,outcome.outcome_id,{ppv_purchases:11,gross_revenue:385});
  const a=s.actions.find(x=>x.action_id===act.action_id);
  assert.equal(a.executed_treatment.preview_style,'CENSORED_FULL_BODY');
  assert.equal(a.executed_treatment.audience_segment,'VIP_SPENDERS');
  assert.equal(a.executed_treatment.price_band,'26_50');
  assert.equal(a.sent_to,88);
  const tl=d.treatmentLearning(s);
  assert(tl.rows.some(r=>r.key===a.executed_treatment_key),'RESULTS must credit the ACTUAL treatment');
  ok('GATE 3 — changing preview/segment/price at send time credits what was actually done');
}

// ---------------- GATE 4: route identity stays distinct ----------------
{
  const s=d.seedState();
  const need=['X_BIO_TO_OF_FREE_01','X_PINNED_TO_OF_FREE_01','X_POST_TO_OF_FREE_01',
    'PH_PROFILE_TO_OF_FREE_01','PH_VIDEO_DESC_TO_OF_FREE_01',
    'OF_FREE_BIO_TO_OF_PAID_01','OF_FREE_PINNED_TO_OF_PAID_01','OF_FREE_POST_TO_OF_PAID_01','OF_FREE_MESSAGE_TO_OF_PAID_01',
    'OF_PAID_FEED_01','OF_PAID_PPV_MESSAGE_01','CB_NATIVE_TIPS_01'];
  for(const id of need)assert(s.routes.some(r=>r.route_id===id),`missing Week-1 route ${id}`);
  const ids=new Set(s.routes.map(r=>r.route_id));
  assert.equal(ids.size,s.routes.length,'route IDs must be unique');
  const xs=s.routes.filter(r=>r.source==='X'&&r.destination==='OnlyFans Free');
  assert.equal(new Set(xs.map(r=>r.placement)).size,xs.length,'X placements must not share a tracking identity');
  assert(!s.routes.some(r=>/reddit|stripchat/i.test(r.route_id)),'no Reddit/Stripchat routes');
  // A route cannot go ACTIVE without a real verification
  const r=s.routes.find(x=>x.route_id==='X_BIO_TO_OF_FREE_01');
  assert.throws(()=>d.updateRoute(s,r.route_id,{verification_status:'VERIFIED'}),/verification requires/i);
  assert.equal(s.routes.find(x=>x.route_id==='X_BIO_TO_OF_FREE_01').active_status,'INACTIVE');
  ok('GATE 4 — X / Pornhub / OF-Free placements keep distinct route IDs and cannot self-activate');
}

// ---------------- Checklist persistence, baseline coverage, cam ----------------
{
  const s=d.seedState();
  d.ensureChecklist(s);
  assert.equal(s.launchChecklist.length,d.LAUNCH_CHECKLIST.length,'all 23 steps present');
  assert.equal(s.launchChecklist[0].id,'BACKUP_BEFORE','order is preserved');
  d.setChecklistItem(s,{id:'TIMEZONE',done:true,by:'Executive Producer'});
  const again=d.ensureChecklist(s);
  assert.equal(again.find(x=>x.id==='TIMEZONE').done,true,'completion survives re-initialisation');
  assert.equal(d.checklistProgress(s).done,1);
  assert.equal(d.checklistProgress(s).next.id,'BACKUP_BEFORE');
  ok('checklist remembers completion state and keeps its order');
}
{
  const s=d.seedState();
  const cov0=d.baselineCoverage(s);
  assert.equal(cov0.captured.length,0,'nothing is pre-filled as a measured baseline');
  assert.equal(cov0.missing.length,7);
  d.recordBaselineSnapshot(s,{platform:'X',metrics:{followers:36,posts:51,'':''},evidence_reference:'x-before.png'});
  assert.equal(d.baselineCoverage(s).captured[0],'X');
  assert.equal(s.baseline.snapshots[0].metrics.followers,36);
  d.captureBaseline(s,{evidence_reference:'e',inventory_mapping_reference:'i'});d.lockBaseline(s);
  assert.throws(()=>d.recordBaselineSnapshot(s,{platform:'X',metrics:{followers:99}}),/locked/i);
  ok('baseline is per-platform, never pre-filled, and frozen once locked');
}
{
  const s=d.seedState();
  d.recordCamSession(s,{started_at:'2026-09-11T20:00:00-05:00',ended_at:'2026-09-11T23:00:00-05:00',
    effort_minutes:180,followers_start:1343,followers_end:1381,tips_tokens:4200,native_revenue:210});
  const sum=d.camSummary(s);
  assert.equal(sum.sessions,1);assert.equal(sum.followers_gained,38);
  assert.equal(sum.revenue_per_hour,70);
  assert.equal(sum.reportable,false,'one session is a pilot, not a finding');
  assert.match(s.camSessions[0].attribution_note,/does not infer OnlyFans signups/);
  assert(!s.routes.some(r=>r.source==='Chaturbate'&&r.attribution_scope!=='INTERNAL'),'no external link is placed into Chaturbate');
  ok('cam sessions record native metrics and invent no downstream attribution');
}
const report={pass:true,total:checks.length,checks};
await fs.writeFile('tests/LAUNCH_GATES_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
