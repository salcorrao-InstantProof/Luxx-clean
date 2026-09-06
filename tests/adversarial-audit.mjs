// §41 SECOND ADVERSARIAL AUDIT — read the finished app as if someone else wrote it.
import fs from 'node:fs'; import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(ROOT+'/public/index.html','utf8');
const domain=fs.readFileSync(ROOT+'/netlify/lib/domain.mjs','utf8');
const d=await import(ROOT+'/netlify/lib/domain.mjs');
const findings=[];
const F=(sev,what)=>findings.push(`${sev}: ${what}`);

// 1. Dead controls / unreachable functionality (recount independently).
const defs=[...html.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]);
const body=html.split('<script>').slice(1).join('<script>').split('</script>')[0];
for(const fn of defs){
  const uses=(body.match(new RegExp('\\b'+fn.replace(/\$/g,'\\$')+'\\b','g'))||[]).length;
  const inline=(html.match(new RegExp('on(?:click|change|input)="[^"]*\\b'+fn.replace(/\$/g,'\\$')+'\\b','g'))||[]).length;
  if(uses<=1&&inline===0)F('DEAD?',`function ${fn} is referenced only by its own definition`);
}
// 2. Duplicate ids.
const ids=[...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m=>m[1]);
const c={};ids.forEach(i=>c[i]=(c[i]||0)+1);
for(const [k,v] of Object.entries(c))if(v>1)F('DUP-ID',`${k} x${v}`);
// 3. Inline handlers with no definition.
const refs=new Set([...html.matchAll(/on(?:click|change|input)="[^"]*?([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
for(const r of refs)if(!defs.includes(r)&&!['JSON','Number','String','alert','confirm','render','esc'].includes(r))F('MISSING',`handler ${r}`);
// 4. Job -> route: no unrelated route may gate or serve any job, on any day.
const s=d.seedState();d.captureBaseline(s,{evidence_reference:'e',inventory_mapping_reference:'i'});d.lockBaseline(s);
for(const id of ['X_POST_TO_OF_FREE_01','PH_VIDEO_DESC_TO_OF_FREE_01','OF_FREE_POST_TO_OF_PAID_01']){
  d.updateRoute(s,id,{tracking_url_or_identifier:'u',destination_confirmed:true,test_performed:'t',verification_evidence:'p',verification_status:'VERIFIED'});
  // A verified link is not an installed one. The route/job audit needs ACTIVE routes.
  d.confirmRoutePlacement(s,id,{placement_evidence:'audit: link installed in the live placement'});
}
const EXPECT={OF_PAID_WALL:'OF_PAID_FEED_01',OF_LIGHT_SUPPORT:'OF_PAID_FEED_01',PPV_DM:'OF_PAID_PPV_MESSAGE_01',
  PPV_BUNDLE:'OF_PAID_PPV_MESSAGE_01',OF_WALL_REENGAGE:'OF_FREE_POST_TO_OF_PAID_01',OF_WALL_VALUE:'OF_FREE_POST_TO_OF_PAID_01',
  X_TEASER:'X_POST_TO_OF_FREE_01',ONE_DISCOVERY:'X_POST_TO_OF_FREE_01',PH_TEASER:'PH_VIDEO_DESC_TO_OF_FREE_01'};
for(const code of ['MON','TUE','WED','THU','FRI','SAT','SUN'])
  for(const job of d.scheduleForDay(code)){
    const r=d.jobRouteStatus(s,job).route;
    if(!r||r.route_id!==EXPECT[job.intent])F('ROUTE',`${code} ${job.intent} -> ${r&&r.route_id}`);
  }
// 5. Every HOLD must carry a known code and a valid recovery, every day, in every state.
const img=(id,x={})=>({asset_id:id,name:id,media_type:'IMAGE',authorization_status:'AUTHORIZED',availability:'AVAILABLE',
  historical_usage_status:'PROSPECTIVE',platform_eligibility:[],variants:[{variant_id:id+'-S',asset_id:id,
  variant_type:'PRIVACY_SAFE_EXPORT',rendered:true,privacy_safe_export:true,metadata_stripped:true}],...x});
const worlds={'empty':[], 'one asset':[img('A')], 'unauthorized':[img('U',{authorization_status:'UNCLEAR'})],
  'quarantined':[img('Q',{availability:'QUARANTINED'})], 'no safe derivative':[{...img('N'),variants:[{variant_id:'V',asset_id:'N',variant_type:'RAW',rendered:true}]}],
  'many':[img('A'),img('B'),img('C'),img('D')]};
for(const [name,assets] of Object.entries(worlds))
  for(const st of [s,d.seedState()])
    for(const day of ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']){
      const plan=d.buildTodayPlan(st,assets,{date:day+'T15:00:00Z'});
      for(const l of plan.lines){
        if(l.kind!=='BLOCKED')continue;
        if(!d.HOLD_CODES.includes(l.hold_code))F('HOLD',`${name}/${plan.day}: unknown code ${l.hold_code}`);
        if(!['FIX SETUP','FIX LIBRARY','CAM AVAILABILITY'].includes(l.recovery))F('HOLD',`${name}/${plan.day}: bad recovery ${l.recovery}`);
        if(!l.why||l.why.length<20)F('HOLD',`${name}/${plan.day}: unhelpful why`);
        if(!l.repair_context||!l.repair_context.intent)F('HOLD',`${name}/${plan.day}: no repair context`);
        if(l.asset_id)F('HOLD',`${name}/${plan.day}: a blocked line carries an asset`);
      }
      if(plan.lines.some(l=>l.job==='LIVE'&&['SAT','SUN'].includes(plan.day)))F('CAM',`${plan.day} carries a LIVE line`);
      if(plan.lines.some(l=>l.job==='PRODUCE')&&!d.produceAllowed(st))F('PRODUCE',`${plan.day} PRODUCE with no gap`);
      if(plan.lines.length>plan.cap)F('CAP',`${plan.day} exceeded its cap`);
    }
// 6. Video/master confusion.
// A legacy MAIN-CUT may still be READ for backward compatibility; it may never be
// produced, ranked above the full master, or described as the master.
{
  const lines=html.split('\n').filter(l=>l.includes('MAIN-CUT'));
  for(const l of lines){
    const legacyRead=/variant_id==='MAIN-CUT'/.test(l)||/LEGACY MAIN CUT — NOT THE MASTER/.test(l);
    if(!legacyRead)F('MASTER','a non-legacy MAIN-CUT reference survives: '+l.trim().slice(0,90));
  }
  if(/label:'MAIN_CUT'|id:'MAIN-CUT'/.test(fs.readFileSync(ROOT+'/netlify/lib/video.mjs','utf8')))
    F('MASTER','the pipeline still PRODUCES a MAIN-CUT');
  if(/n\+=4;else if\(v\.variant_id==='MAIN-CUT'\)n\+=2/.test(html)===false&&/MAIN-CUT/.test(html))
    F('MASTER','a legacy main cut may outrank the full master');
}
const v=await import(ROOT+'/netlify/lib/video.mjs');
for(const dur of [61,300,301,420,902,1800,5400]){
  const p=v.choosePlan(dur,{sceneTimes:[],bad:[],silence:[]});
  if(p.full_master.duration!==dur)F('MASTER',`${dur}s truncated to ${p.full_master.duration}s`);
  if(p.teasers.some(t=>t.start+t.duration>dur+0.01))F('MASTER',`${dur}s teaser exceeds the source`);
}
// 7. X workflow.
if(d.autoPlatformEligibility(img('X1')).includes('X'))F('X','X eligibility granted without a face-safe review');
if(!d.autoPlatformEligibility(img('X2',{x_face_safe:true})).includes('X'))F('X','a confirmed face-safe asset is not X eligible');
if(!/NEEDS X CROP \/ REVIEW/.test(domain))F('X','the review state is gone');
// 8. Baseline loss.
{const b=d.seedState();d.importBaseline(b,{rows:[{platform:'X',metric:'followers',value:36,evidence_reference:'e'}]});
 d.captureBaseline(b,{evidence_reference:'e',inventory_mapping_reference:'i'});d.lockBaseline(b);
 if(b.baseline.snapshots.length!==1)F('BASELINE','capture/lock lost the reviewed snapshot');
 if(b.baseline.snapshots[0].metrics.followers!==36)F('BASELINE','the captured value changed');}
// 9. History loss.
{const h=d.seedState();d.captureBaseline(h,{evidence_reference:'e',inventory_mapping_reference:'i'});d.lockBaseline(h);
 const before=structuredClone(h);
 d.createHistoricalPublication(h,{asset_id:'A',platform:'Pornhub',external_reference:'r'});
 try{d.validateAppendOnly(before,h)}catch(e){F('HISTORY','append-only rejected a legitimate append: '+e.message)}}
// 10. False/mock-only tests: any suite that writes PASS without executing anything.
for(const f of fs.readdirSync(ROOT+'/tests')){
  if(!f.endsWith('.mjs')&&!f.endsWith('.py'))continue;
  const src=fs.readFileSync(ROOT+'/tests/'+f,'utf8');
  if(/pass['"]?\s*[:=]\s*true/i.test(src)&&!/assert|expect/i.test(src))F('TEST',`${f} asserts pass without assertions`);
}
// 11. Stale docs.
for(const f of ['DO_THIS_FIRST.txt','READ_ME_FIRST.txt','DEPLOY_THIS_ZIP_ONLY.txt','UPGRADE_SAME_NETLIFY_SITE.txt']){
  const t=fs.readFileSync(ROOT+'/'+f,'utf8');
  if(!/Monday, September 7, 2026/.test(t))F('DOCS',`${f} launch date`);
  if(/\bv1\.(3|4|5|6)\.\d/.test(t))F('DOCS',`${f} superseded release`);
}
// 12. Navigation.
const nav=html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)[1];
if((nav.match(/data-view=/g)||[]).length!==3)F('NAV','primary navigation drifted');
const report={pass:findings.length===0,total_findings:findings.length,findings};
fs.writeFileSync(path.join(ROOT,'tests/ADVERSARIAL_AUDIT_RESULTS.json'),JSON.stringify(report,null,2));
console.log(findings.length?findings.join('\n'):'NO FINDINGS');
console.log(JSON.stringify(report,null,2));
if(findings.length)process.exit(1);
