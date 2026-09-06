console.log('LUXX_SIZE_SAFE_INSTALLER_DEPLOY_SENTINEL_2026_08_31');
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const required=['tests/fixtures/orient6.jpg','public/index.html','netlify/functions/health.mjs','netlify/functions/process-media-job-background.mjs','netlify/functions/renderer-health.mjs','netlify/functions/image-edit.mjs','netlify/functions/action.mjs','netlify/lib/video.mjs','netlify/lib/media-edit.mjs','netlify/lib/domain.mjs','netlify/lib/embedded-secret.mjs','tests/run-all.mjs'];
for(const f of required)if(!fs.existsSync(f))throw new Error(`Missing required build file: ${f}`);
const html=fs.readFileSync('public/index.html','utf8');
for(const marker of ['TOP HERO PICKS','TEST & ACTIVATE ROUTE','READY-TO-USE CAPTIONS / CTAs','TODAY','LIBRARY','RESULTS','OPTIMIZE EXISTING PHOTOS','cleanExactDuplicates','AUTHORIZE','Privacy Shield','WHAT LUXX LEARNED','ROUTE PERFORMANCE','AUTO BEST + SAVE','RENDER VIDEO EDIT','PLAN BRANCH SHOOT','ADD REVENUE','CUSTOM ORDER','BACKUP JSON','RESTORE / IMPORT JSON','CORRECT','CHANGE','DECLINE'])if(!html.includes(marker))throw new Error(`Missing UI capability marker: ${marker}`);
// A deploy that succeeds without credentials is a footgun even though the app fails closed:
// the site goes live, the creator opens it, and only then discovers it is unusable. Refuse the
// deploy instead. Enforced only on Netlify (NETLIFY=true) so local builds and CI still run.
if(process.env.NETLIFY==='true'&&process.env.LUXX_ALLOW_UNCONFIGURED_BUILD!=='1'){
  const missing=['LUXX_PASSCODE','LUXX_SESSION_SECRET'].filter(k=>!String(process.env[k]||'').trim());
  if(missing.length)throw new Error(
    `DEPLOY REFUSED — missing required environment variable(s): ${missing.join(', ')}.\n`+
    `Set them in Netlify > Site configuration > Environment variables, then redeploy.\n`+
    `Generate a session secret with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`+
    `Deploying without these would publish a site that cannot be logged into.`);
  if(String(process.env.LUXX_SESSION_SECRET).length<32)throw new Error('DEPLOY REFUSED — LUXX_SESSION_SECRET must be at least 32 characters.');
  console.log('LUXX credential check: LUXX_PASSCODE and LUXX_SESSION_SECRET are present.');
}
const req=createRequire(import.meta.url);
const bins={};for(const pkg of ['@ffmpeg-installer/ffmpeg','@ffprobe-installer/ffprobe']){let mod;try{mod=req(pkg)}catch(e){throw new Error(`PRODUCTION RENDERER DEPENDENCY MISSING: ${pkg}. Netlify must install dependencies before deploy. ${e.message}`)}const bin=mod?.path||mod?.default?.path;if(!bin||!fs.existsSync(bin))throw new Error(`PRODUCTION RENDERER BINARY MISSING: ${pkg} resolved to ${bin||'nothing'}`);try{fs.chmodSync(bin,0o755);execFileSync(bin,['-version'],{stdio:'ignore',timeout:15000});}catch(e){throw new Error(`PRODUCTION RENDERER BINARY NOT EXECUTABLE: ${bin}: ${e.message}`)}bins[pkg.includes('ffprobe')?'ffprobe':'ffmpeg']=bin;}
const {jpegExifOrientation,orientationFilter}=await import('./netlify/lib/media-edit.mjs');const fixture='tests/fixtures/orient6.jpg',ori=await jpegExifOrientation(fixture);if(ori!==6)throw new Error(`ORIENTATION SELFTEST PARSER FAILED: expected 6, got ${ori}`);if(orientationFilter(6)!=='transpose=1')throw new Error('ORIENTATION SELFTEST FILTER FAILED');const td=fs.mkdtempSync(path.join(os.tmpdir(),'luxx-orient-check-')),fixed=path.join(td,'fixed.jpg');try{execFileSync(bins.ffmpeg,['-y','-noautorotate','-i',fixture,'-map_metadata','-1','-vf',orientationFilter(ori)+',setsar=1','-frames:v','1','-q:v','2',fixed],{stdio:'ignore',timeout:15000});const dims=execFileSync(bins.ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0:s=x',fixed],{encoding:'utf8',timeout:15000}).trim();if(dims!=='300x400')throw new Error(`ORIENTATION SELFTEST RENDER FAILED: expected 300x400, got ${dims}`);}finally{fs.rmSync(td,{recursive:true,force:true});}
// The stamp and the promise are the product. If either disappears from the shipped UI, the
// release is not LUXX any more, so the build refuses it.
for(const marker of ["TODAY'S PICK",'stampCall','stampGuess','approvePick'])
  if(!html.includes(marker))throw new Error(`Missing TODAY'S PICK UI marker: ${marker}`);
{
  const dom=fs.readFileSync('netlify/lib/domain.mjs','utf8');
  for(const marker of ['does not post, message, schedule, or generate','CALL_THRESHOLD','stamp_note'])
    if(!dom.includes(marker))throw new Error(`Missing TODAY'S PICK contract: ${marker}`);
  // v1.6.1: PPV evidence must be treatment-scoped, and the stamp must never render alone.
  for(const marker of ['treatmentKey','scopeKeyForRoute','makesConversionClaim','denominatorObservable','executed_treatment','TREATMENT_HISTORY','passesTechnicalGate'])
    if(!dom.includes(marker))throw new Error(`Missing PPV treatment contract: ${marker}`);
  if(/score\+=visualTerm\(asset\)/.test(dom))throw new Error('visualTerm is ranking revenue again — technical quality must gate, not rank.');
  if(/score\+=Math\.max\(-5,Math\.min\(5,Number\(variant\.technical_score\)/.test(dom))throw new Error('variant.technical_score is ranking revenue again.');
  // The stamp may not render without its treatment named immediately alongside it.
  if(!html.includes('stampSubject'))throw new Error('CALL/GUESS must render with its subject named (stampSubject missing).');
  const stampUses=[...html.matchAll(/\$\{stampHtml\(l\)\}/g)];
  for(const m of stampUses){
    const after=html.slice(m.index,m.index+220);
    if(!after.includes('stampSubject'))throw new Error('A CALL/GUESS stamp renders without an immediately associated treatment/subject name.');
  }
  for(const marker of ['jobLineHtml','todayPlanHtml','checklistHtml','openBaselineCapture','openHistoricalImport','openCamSession'])
    if(!html.includes(marker))throw new Error(`Missing v1.7.0 launch surface: ${marker}`);
  for(const marker of ['WEEK1_SCHEDULE','buildTodayPlan','LAUNCH_CHECKLIST','recordBaselineSnapshot','importHistoricalPublications','recordCamSession'])
    if(!dom.includes(marker))throw new Error(`Missing v1.7.0 launch contract: ${marker}`);
  // v1.7.0 RC2 launch surface. TOMORROW_SETUP.md was a one-off pre-launch note and is
  // archived under docs/history/; the operator instructions are the files below.
  for(const f of ['RELEASE_NOTES_v1_7_0_RC3.txt','DO_THIS_FIRST.txt','READ_ME_FIRST.txt','UPGRADE_SAME_NETLIFY_SITE.txt'])
    if(!fs.existsSync(f))throw new Error(`Release-facing document missing: ${f}`);
  for(const marker of ['camAvailabilityHtml','baselineImportHtml','saveCamAvailability','runBaselineImport','openVideoReview','openRevenue','openCustom','ctaChoices','useCta','USE THIS CTA','SELECTED CTA','historyProtectedHtml','markUnavailable','playVideo','derivativeKind','openLibraryForJob','holdRecoveryHtml'])
    if(!html.includes(marker))throw new Error(`Missing v1.7.0 RC2 launch surface: ${marker}`);
  for(const marker of ['setCamAvailability','camAllowedOnDay','importBaseline','recordLibraryGap','produceStatus','isTeaserDerivative','resolveCreatorInstant','selectPrescriptionCta','diagnoseJobHold','jobRepairContext','jobRouteStatus'])
    if(!dom.includes(marker))throw new Error(`Missing v1.7.0 RC2 launch contract: ${marker}`);
  if(/CAM_WINDOW\s*=/.test(dom))throw new Error('A hard-coded cam window constant is present.');
  if(/getUTCDay\(\)/.test(html))throw new Error('The UI derives preview days from the browser UTC weekday.');
  if(html.includes('Every result you enter turns a guess into a call'))throw new Error('False copy present: not every result moves GUESS toward CALL.');
}
for(const marker of ['DELETE DUPLICATE','deleteUnusedAsset'])if(!html.includes(marker))throw new Error(`Missing duplicate-delete UI marker: ${marker}`);
if(!fs.existsSync('netlify/functions/asset-delete.mjs'))throw new Error('Missing duplicate-delete backend function: netlify/functions/asset-delete.mjs');
console.log('LUXX v1.7.0 RC3 ZERO-SURPRISE RELEASE verified: per-option caption COPY and USE THIS CTA, configurable cam availability, PRODUCE gate, treatment-scoped PPV evidence, teaser enforcement, baseline import, creator-local day resolution.');
