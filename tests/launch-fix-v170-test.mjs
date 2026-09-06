// LUXX v1.7.0 RC2 — MONDAY LAUNCH FIX
// Focused checks for every behaviour named in the RC2 patch order (A..V).
// These run against the real domain module. Nothing here is asserted by editing a
// JSON artifact: every check below actually executes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const d = await import('../netlify/lib/domain.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const passed = [];
const failed = [];
function t(name, fn) {
  try { fn(); passed.push(name); console.log('PASS', name); }
  catch (e) { failed.push({ name, error: String(e && e.message || e) }); console.log('FAIL', name, '-', e && e.message); }
  checks.push(name);
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function ready() {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  return s;
}
const img = (id, visual = 70) => ({
  asset_id: id, name: id + '.jpg', media_type: 'IMAGE', authorization_status: 'AUTHORIZED',
  availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE', platform_eligibility: [],
  visual_score: { score: visual },
  variants: [{ variant_id: id + '-SAFE', asset_id: id, variant_type: 'PRIVACY_SAFE_EXPORT', rendered: true, privacy_safe_export: true, metadata_stripped: true }]
});
// A Pornhub-eligible video whose only rendered derivative is the FULL main cut.
function phVideo(id, { teaser = false } = {}) {
  const base = {
    variant_id: id + '-MAIN', asset_id: id, variant_type: 'MAIN_CUT', rendered: true,
    privacy_safe_export: true, metadata_stripped: true, platform: 'Pornhub',
    duration_seconds: 300, final_runtime: 300, start_timestamp: '0', end_timestamp: '300',
    thumbnail_frame_timestamp_or_reference: '0.5s', title_direction: 'T', description_direction: 'D',
    cta: 'Open the full drop.', tracking_route_id: 'PH_VIDEO_DESC_TO_OF_FREE_01'
  };
  const variants = [base];
  if (teaser) variants.push({ ...base, variant_id: id + '-TEASER', variant_type: 'TEASER', duration_seconds: 30, final_runtime: 30, end_timestamp: '30' });
  return {
    asset_id: id, name: id + '.mp4', media_type: 'VIDEO', authorization_status: 'AUTHORIZED',
    availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE',
    platform_eligibility: ['Pornhub'], analysis: { duration_seconds: 451 }, variants
  };
}
function verifyPh(s) {
  d.updateRoute(s, 'PH_VIDEO_DESC_TO_OF_FREE_01', {
    tracking_url_or_identifier: 'https://track.example/ph', destination_confirmed: true,
    test_performed: 'opened from a live description', verification_evidence: 'screenshot',
    verification_status: 'VERIFIED'
  });
  d.confirmRoutePlacement(s,'PH_VIDEO_DESC_TO_OF_FREE_01',{placement_evidence:'test: link installed in the live placement'});
}
const WEEKDAY_FULL = { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], earliest_start: '09:00', latest_end: '13:00', timezone: 'America/Chicago' };
// Real calendar days in launch week: Mon 2026-09-07 .. Sun 2026-09-13.
const DAY = { MON: '2026-09-07', TUE: '2026-09-08', WED: '2026-09-09', THU: '2026-09-10', FRI: '2026-09-11', SAT: '2026-09-12', SUN: '2026-09-13' };
const at = (day, hhmm = '15:00') => `${DAY[day]}T${hhmm}:00Z`;

// ---------------------------------------------------------------------------
// A + B — weekend LIVE is impossible from every direction
// ---------------------------------------------------------------------------
t('A. Saturday LIVE is impossible', () => {
  const s = ready();
  d.setCamAvailability(s, WEEKDAY_FULL);
  const plan = d.buildTodayPlan(s, [img('IMG-A')], { date: at('SAT') });
  assert.equal(plan.day, 'SAT');
  assert.equal(plan.cam_day, false, 'Saturday must never be a cam day');
  assert(!plan.lines.some(l => l.job === 'LIVE'), 'Saturday must carry no LIVE line');
  assert.equal(d.camAllowedOnDay(s, 'SAT'), false);
  assert.throws(() => d.setCamAvailability(s, { ...WEEKDAY_FULL, days: ['SAT'] }), /Saturday and Sunday/);
  assert.throws(() => d.recordCamSession(s, {
    started_at: '2026-09-12T15:00:00Z', ended_at: '2026-09-12T17:00:00Z', effort_minutes: 120
  }), /Saturday and Sunday/);
});

t('B. Sunday LIVE is impossible', () => {
  const s = ready();
  d.setCamAvailability(s, WEEKDAY_FULL);
  const plan = d.buildTodayPlan(s, [img('IMG-A')], { date: at('SUN') });
  assert.equal(plan.day, 'SUN');
  assert.equal(plan.cam_day, false);
  assert(!plan.lines.some(l => l.job === 'LIVE'));
  assert.equal(d.camAllowedOnDay(s, 'SUN'), false);
  assert.throws(() => d.setCamAvailability(s, { ...WEEKDAY_FULL, days: ['MON', 'SUN'] }), /Saturday and Sunday/);
  assert.throws(() => d.recordCamSession(s, {
    started_at: '2026-09-13T15:00:00Z', ended_at: '2026-09-13T17:00:00Z', effort_minutes: 120
  }), /Saturday and Sunday/);
});

// ---------------------------------------------------------------------------
// C — a LIVE slot outside the configured window is refused
// ---------------------------------------------------------------------------
t('C. LIVE cannot be scheduled outside configured creator availability', () => {
  const s = ready();
  d.setCamAvailability(s, { days: ['TUE', 'FRI'], earliest_start: '09:00', latest_end: '13:00', timezone: 'America/Chicago' });
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '09:00', end: '12:00' }).allowed, true);
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '10:00', end: '13:00' }).allowed, true);
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '08:00', end: '11:00' }).allowed, false, 'before the window');
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '11:00', end: '14:00' }).allowed, false, 'after the window');
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '20:00', end: '23:00' }).allowed, false, 'the old hard-coded evening block');
  assert.equal(d.camSlotAllowed(s, { day: 'WED', start: '09:00', end: '12:00' }).allowed, false, 'an unconfigured weekday');
  assert.equal(d.camSlotAllowed(s, { day: 'SAT', start: '09:00', end: '12:00' }).allowed, false);
  // A weekday session outside the window is still recordable, but flagged as a deviation.
  const rec = d.recordCamSession(s, {
    started_at: '2026-09-08T21:00:00Z', ended_at: '2026-09-08T23:00:00Z', effort_minutes: 120
  });
  assert.equal(rec.outside_configured_availability, true);
  assert.match(rec.deviation_note, /window/i);
  // LIVE only shows up on configured weekdays.
  assert.equal(d.buildTodayPlan(s, [], { date: at('TUE') }).cam_day, true);
  assert.equal(d.buildTodayPlan(s, [], { date: at('WED') }).cam_day, false);
});

// ---------------------------------------------------------------------------
// D — nothing configured means nothing invented
// ---------------------------------------------------------------------------
t('D. no configured cam availability means no invented LIVE time', () => {
  const s = ready();
  const avail = d.camAvailability(s);
  assert.equal(avail.configured, false);
  assert.match(avail.label, /SETUP REQUIRED — CAM AVAILABILITY NOT FINALIZED/);
  const src = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');
  assert(!/CAM_WINDOW\s*=/.test(src), 'the hard-coded CAM_WINDOW constant must be gone');
  assert(!/8:00–11:00 PM|8–11 PM Central/.test(src), 'the hard-coded evening cam block must be gone');
  for (const code of ['MON', 'TUE', 'WED', 'THU', 'FRI']) {
    const plan = d.buildTodayPlan(s, [img('IMG-A')], { date: at(code) });
    assert.equal(plan.cam_day, false, `${code}: cam day without configuration`);
    assert.equal(plan.cam_setup_required, true);
    const live = plan.lines.find(l => l.job === 'LIVE');
    assert(live, `${code}: the creator should still be told why nothing is scheduled`);
    assert.equal(live.kind, 'SETUP_REQUIRED');
    assert.equal(live.actionable, false, 'LIVE must not be an actionable scheduled job yet');
    assert(!/\d\s*(AM|PM)/i.test(live.label), 'no clock time may appear');
    assert(!/evening|PM/i.test(live.stamp_note || ''), 'must not silently choose evening hours');
  }
  // Availability alone is never evidence.
  d.setCamAvailability(s, WEEKDAY_FULL);
  const live = d.buildTodayPlan(s, [], { date: at('MON') }).lines.find(l => l.job === 'LIVE');
  assert.equal(live.stamp, 'GUESS', 'a configured time is still a GUESS');
  assert.match(live.stamp_note, /not a proven best time/i);
  assert.match(d.camSummary(s).time_claim, /GUESS \/ DEFAULT/);
});

// ---------------------------------------------------------------------------
// E + F — Pornhub teaser is mechanically enforced
// ---------------------------------------------------------------------------
t('E. PH_TEASER cannot select a MAIN CUT or a full scene', () => {
  assert.equal(d.isTeaserDerivative({ variant_type: 'MAIN_CUT' }), false);
  assert.equal(d.isTeaserDerivative({ variant_type: 'FULL_SCENE' }), false);
  assert.equal(d.isTeaserDerivative({ variant_id: 'MAIN-CUT', variant_type: 'TEASER' }), false);
  assert.equal(d.isTeaserDerivative({ variant_type: 'PRIVACY_SAFE_EXPORT' }), false, 'a generic eligible derivative is not a teaser');
  assert.equal(d.isTeaserDerivative(null), false);
  assert.equal(d.isTeaserDerivative({ variant_type: 'TEASER' }), true);
  assert.equal(d.isTeaserDerivative({ variant_type: 'TRAILER' }), true);
  const s = ready(); verifyPh(s);
  const job = { platform: 'Pornhub', intent: 'PH_TEASER' };
  const rec = d.generateRecommendation(s, [phVideo('VID-FULL')]);
  assert.equal(rec.ready, true, 'a Pornhub-eligible full video is still a valid candidate elsewhere');
  assert(rec.candidates.some(c => c.platform === 'Pornhub'), 'the full video is Pornhub-eligible');
  assert(!rec.candidates.some(c => d.candidateFitsJob(s, c, job)), 'no full-length candidate may satisfy PH_TEASER');
  const plan = d.buildTodayPlan(s, [phVideo('VID-FULL')], { date: at('WED') });
  const ph = plan.lines.find(l => l.intent === 'PH_TEASER');
  assert.equal(ph.kind, 'BLOCKED', 'must not silently fall back to the full video');
  assert(!ph.asset_id, 'a blocked teaser job must not carry a chosen asset');
});

t('F. no valid Pornhub teaser derivative means HOLD / FIX LIBRARY', () => {
  const s = ready(); verifyPh(s);
  const blocked = d.buildTodayPlan(s, [phVideo('VID-FULL')], { date: at('WED') }).lines.find(l => l.intent === 'PH_TEASER');
  assert.equal(blocked.hold, true);
  assert.equal(blocked.hold_code, 'PH_TEASER_REQUIRED');
  assert.equal(blocked.hold_label, 'HOLD — PH TEASER REQUIRED');
  assert.equal(blocked.recovery, 'FIX LIBRARY');
  assert.match(blocked.why, /never substituted/i);
  assert.deepEqual(blocked.repair_context.permitted_media_types, ['VIDEO']);
  assert.equal(blocked.repair_context.requires_derivative, 'TEASER_OR_TRAILER');
  // With a real teaser derivative present the job resolves to that derivative.
  const s2 = ready(); verifyPh(s2);
  const ok = d.buildTodayPlan(s2, [phVideo('VID-T', { teaser: true })], { date: at('WED') }).lines.find(l => l.intent === 'PH_TEASER');
  assert.equal(ok.kind, 'ACTION', 'a real teaser derivative must satisfy the job');
  assert.match(String(ok.variant_id), /TEASER/);
});

// ---------------------------------------------------------------------------
// G — Week-1 PPV belongs on OnlyFans Paid
// ---------------------------------------------------------------------------
t('G. Week 1 PPV routes to OnlyFans Paid, never OnlyFans Free', () => {
  const s = ready();
  for (const code of ['WED', 'SAT', 'SUN']) {
    for (const job of d.scheduleForDay(code)) {
      if (job.intent === 'PPV_DM' || job.intent === 'PPV_BUNDLE') {
        assert.equal(job.platform, 'OnlyFans Paid', `${code} PPV must target OnlyFans Paid`);
      }
    }
  }
  const all = Object.values(d.WEEK1_SCHEDULE).flat();
  assert(!all.some(j => (j.intent === 'PPV_DM' || j.intent === 'PPV_BUNDLE') && j.platform === 'OnlyFans Free'),
    'no PPV job anywhere in the week may target OnlyFans Free');
  // And the resolved route is the Paid native PPV message route.
  const line = d.buildTodayPlan(s, [img('IMG-P')], { date: at('WED') }).lines.find(l => l.intent === 'PPV_DM');
  assert.equal(line.kind, 'ACTION');
  assert.equal(line.platform, 'OnlyFans Paid');
  assert.equal(line.route_id, 'OF_PAID_PPV_MESSAGE_01');
});

// ---------------------------------------------------------------------------
// H + I + J — PPV copy is treatment-scoped everywhere it is written
// ---------------------------------------------------------------------------
function ppvPrescription() {
  const s = ready();
  const rec = d.generateRecommendation(s, [img('IMG-P')]);
  const rx = d.createPrescriptionForPick(s, rec, { asset_id: 'IMG-P', variant_id: 'IMG-P-SAFE', platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'PPV_DM' });
  return { s, rx };
}
const ASSET_EVIDENCE_REGRESSIONS = [
  /measured results on this asset/i,
  /measured results on this photo/i,
  /strongest option across .* measured results on this asset/i,
  /proven photo/i, /winning photo/i, /best-?selling photo/i
];
function assertNoAssetEvidenceLanguage(text, where) {
  for (const re of ASSET_EVIDENCE_REGRESSIONS) {
    assert(!re.test(text), `${where} still contains asset-scoped PPV evidence language: ${re}`);
  }
}

t('H. PPV READY TO APPROVE copy stays attached to the pre-purchase treatment', () => {
  const { s, rx } = ppvPrescription();
  assert.equal(rx.route_id, 'OF_PAID_PPV_MESSAGE_01');
  assert.equal(rx.evidence_object, 'TREATMENT');
  assert(rx.proposed_treatment, 'a PPV prescription must carry the treatment the fan will see');
  assert.match(rx.reason_summary, /pre-purchase treatment/i);
  assert.match(rx.data_confidence, /treatment/i);
  assertNoAssetEvidenceLanguage(rx.reason_summary + ' ' + rx.data_confidence, 'READY TO APPROVE');
  const line = d.buildTodayList(s, d.generateRecommendation(s, [img('IMG-P')])).lines.find(l => l.stamp_object === 'TREATMENT');
  assert(line, 'the PPV line must exist');
  assert.equal(line.stamp_subject, line.treatment_label, 'the stamp names the treatment, not the photo');
  assertNoAssetEvidenceLanguage(`${line.stamp_note} ${line.why}`, 'TODAY job card');
  assert.match(line.why, /treatment/i);
});

t('I. the frozen PPV prescription stays treatment-scoped', () => {
  const { s, rx } = ppvPrescription();
  const a = d.approvePrescription(s, rx.prescription_id, [img('IMG-P')]);
  const frozen = a.frozen_prescription;
  assert.equal(frozen.evidence_object, 'TREATMENT');
  assert(frozen.proposed_treatment_key, 'the frozen snapshot carries the treatment key');
  assert(!/asset_id|filename/i.test(String(frozen.proposed_treatment_key)), 'the treatment key must not contain asset identity');
  assert.equal(d.treatmentKey(frozen.proposed_treatment), frozen.proposed_treatment_key);
  assertNoAssetEvidenceLanguage(`${frozen.reason_summary} ${frozen.data_confidence}`, 'frozen prescription');
});

t('J. PPV RESULTS and receipt language stays treatment-scoped', () => {
  const s = ready();
  const note = d.treatmentLearning(s).note;
  assert.match(note, /pre-purchase treatment/i);
  assertNoAssetEvidenceLanguage(note, 'RESULTS treatment learning');
  assertNoAssetEvidenceLanguage(d.visibleAssetLearning(s).note, 'RESULTS visible-asset learning');
  const reason = d.pickReason(s, 'IMG-P', 20, Date.now(), 'TREATMENT');
  assert.match(reason.text, /treatment/i);
  assertNoAssetEvidenceLanguage(reason.text, 'pick reason');
  // The asset-scoped wording survives where the audience really did see the file.
  assert.match(d.pickReason(s, 'IMG-P', 20, Date.now(), 'ASSET').text, /measured results/);
  // Nothing in the shipped source claims a hidden master is a proven seller.
  for (const f of ['netlify/lib/domain.mjs', 'public/index.html']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert(!/strongest option across \$\{n\} measured results/.test(src), `${f}: RC1 asset-evidence phrase still present`);
    assert(!/(proven|winning|best-selling) photo/i.test(src.replace(/never (say|call)[^\n]*/gi, '')), `${f}: proven-photo language present`);
  }
});

// ---------------------------------------------------------------------------
// K + L — six is necessary, never sufficient
// ---------------------------------------------------------------------------
function ppvHistory(s, { n = 6, sent_to = 100, unlocks = 0, revenue = 0 } = {}) {
  const dm = s.routes.find(r => r.route_id === 'OF_PAID_PPV_MESSAGE_01');
  const T = { preview_style: 'BLURRED_CLOSE_CROP', delivery_mode: 'PPV_DM', audience_segment: 'ACTIVE_SUBSCRIBERS', price_band: 'NONE', scope: d.scopeKeyForRoute(dm) };
  for (let i = 0; i < n; i++) {
    s.actions.push({
      action_id: 'K' + i, status: 'MEASURED', platform: 'OnlyFans Paid', objective_code: 'PAID_CONTENT',
      asset_id: 'IMG-HIDDEN', variant_id: 'V', route_id: dm.route_id, attribution_precision: 'EXACT',
      sent_to, executed_at: new Date(Date.now() - i * 86400000).toISOString(), creator_effort_minutes: 5,
      executed_treatment: T, executed_treatment_key: d.treatmentKey(T)
    });
    s.outcomes.push({ outcome_id: 'KO' + i, action_id: 'K' + i, measurement_state: 'MEASURED', raw: { ppv_purchases: unlocks, gross_revenue: revenue } });
    if (revenue) s.revenueEvents.push({ revenue_event_id: 'KR' + i, action_id: 'K' + i, gross_amount: revenue, attribution_precision: 'EXACT' });
  }
  return T;
}

t('K. six zero-unlock comparable PPV observations remain GUESS', () => {
  const s = ready();
  const T = ppvHistory(s, { n: 6, sent_to: 100, unlocks: 0, revenue: 0 });
  const dm = s.routes.find(r => r.route_id === 'OF_PAID_PPV_MESSAGE_01');
  const sc = d.candidateScore(s, { asset_id: 'IMG-HIDDEN', media_type: 'IMAGE', variants: [] }, { variant_id: 'V' }, 'OnlyFans Paid', { code: 'PAID_CONTENT' }, { route: dm, treatment: T });
  assert.equal(sc.n_own, 6, 'six comparable observations were counted');
  assert.equal(sc.favorable, false, 'six dead sends are not favourable evidence');
  const line = d.buildTodayList(s, { ready: true, candidates: [{ asset: { asset_id: 'IMG-HIDDEN', media_type: 'IMAGE' }, variant: { variant_id: 'V' }, platform: 'OnlyFans Paid', route: dm, objective: { code: 'PAID_CONTENT', label: 'x' }, score: sc, cta: { text: 'c' }, timing: { window: 'w' } }] }).lines[0];
  assert.equal(line.stamp, 'GUESS', 'reaching n=6 must never mint a CALL on its own');
  assert.equal(d.CALL_THRESHOLD, 6, 'the qualifying sample threshold is unchanged');
});

t('L. a PPV DM with no recorded sent_to remains GUESS', () => {
  const s = ready();
  ppvHistory(s, { n: 6, sent_to: 0, unlocks: 4, revenue: 40 });
  const dm = s.routes.find(r => r.route_id === 'OF_PAID_PPV_MESSAGE_01');
  const T = { preview_style: 'BLURRED_CLOSE_CROP', delivery_mode: 'PPV_DM', audience_segment: 'ACTIVE_SUBSCRIBERS', price_band: 'NONE', scope: d.scopeKeyForRoute(dm) };
  const sc = d.candidateScore(s, { asset_id: 'IMG-HIDDEN', media_type: 'IMAGE', variants: [] }, { variant_id: 'V' }, 'OnlyFans Paid', { code: 'PAID_CONTENT' }, { route: dm, treatment: T });
  assert.equal(sc.n_own, 0, 'an observation without a denominator does not qualify');
  const learning = d.treatmentLearning(s);
  assert.equal(learning.best, null, 'no treatment may be named best without a denominator');
  assert.equal(d.denominatorObservable(dm), true, 'a PPV DM does have an observable denominator to record');
});

// ---------------------------------------------------------------------------
// M — technical score never ranks money
// ---------------------------------------------------------------------------
t('M. visual technical score does not influence live monetization ranking', () => {
  const s = ready();
  const low = img('IMG-LOW', 41), high = img('IMG-HIGH', 96);
  const rec = d.generateRecommendation(s, [low, high]);
  const score = id => rec.candidates.find(c => c.asset.asset_id === id && c.platform === 'OnlyFans Paid').score;
  assert.equal(score('IMG-LOW').score, score('IMG-HIGH').score,
    'a 41 and a 96 technical score must produce the same candidate score when nothing else differs');
  assert.equal(score('IMG-LOW').quality, score('IMG-HIGH').quality);
  // visualTerm still exists for the LIBRARY display, and is provably not wired into scoring.
  assert(typeof d.visualTerm === 'function');
  assert.notEqual(d.visualTerm({ visual_score: { score: 96 } }), d.visualTerm({ visual_score: { score: 41 } }));
  const src = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function candidateScore'), src.indexOf('export function evidenceTier'))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');   // executable lines only
  assert(!/visualTerm\(/.test(body), 'candidateScore must not call visualTerm');
  assert(!/technical_score/.test(body), 'candidateScore must not read a technical score');
  assert(!/visual_score/.test(body), 'candidateScore must not read the visual score');
  assert(/visualTerm\(\)/.test(src.slice(src.indexOf('export function candidateScore'), src.indexOf('export function evidenceTier'))),
    'the comment explaining why the ranking path was removed should stay');
});

// ---------------------------------------------------------------------------
// N + O — PRODUCE stays off until a gap is documented
// ---------------------------------------------------------------------------
t('N. PRODUCE does not appear merely because the schedule has room', () => {
  const s = ready();
  const status = d.produceStatus(s);
  assert.equal(status.active, false);
  assert.match(status.reason, /PRODUCE is OFF/);
  for (const code of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
    const plan = d.buildTodayPlan(s, [img('IMG-A')], { date: at(code) });
    assert(plan.lines.length < plan.cap, `${code}: this day genuinely has spare capacity`);
    assert(!plan.lines.some(l => l.job === 'PRODUCE'), `${code}: PRODUCE appeared with no documented gap`);
    assert.equal(plan.produce.active, false);
  }
  assert(!Object.values(d.WEEK1_SCHEDULE).flat().some(j => j.job === 'PRODUCE'), 'no PRODUCE job is hard-coded into the week');
});

t('O. PRODUCE requires a documented Library/funnel gap', () => {
  const s = ready();
  assert.throws(() => d.recordLibraryGap(s, { gap_type: 'INVENTED_GAP', evidence_reference: 'x', counted_have: 0, counted_needed: 3 }), /Unknown gap type/);
  assert.throws(() => d.recordLibraryGap(s, { gap_type: 'PPV_INVENTORY', evidence_reference: '', counted_have: 0, counted_needed: 3 }), /evidence reference/);
  assert.throws(() => d.recordLibraryGap(s, { gap_type: 'PPV_INVENTORY', evidence_reference: 'library review 9/6', counted_have: 9, counted_needed: 3 }), /not a gap/);
  assert.equal(d.produceAllowed(s), false);
  const g = d.recordLibraryGap(s, { gap_type: 'X_FACE_SAFE_TEASER', evidence_reference: 'library review 2026-09-06', counted_have: 2, counted_needed: 7, notes: 'counted after the full upload' });
  assert.equal(g.shortfall, 5);
  assert.equal(d.produceAllowed(s), true);
  const plan = d.buildTodayPlan(s, [img('IMG-A')], { date: at('MON') });
  const produce = plan.lines.find(l => l.job === 'PRODUCE');
  assert(produce, 'a documented gap may now justify a PRODUCE job');
  assert.equal(produce.gap_id, g.gap_id);
  assert.match(produce.why, /X_FACE_SAFE_TEASER/);
  assert.match(produce.why, /library review 2026-09-06/);
  assert.match(produce.stamp_note, /not because the schedule had room/);
  assert.match(d.produceStatus(s).note, /NO NEW SHOOT NEEDED/);
});

// ---------------------------------------------------------------------------
// P — creator-local day resolution
// ---------------------------------------------------------------------------
t('P. day preview uses the creator timezone, not raw UTC', () => {
  const s = ready();
  // 2026-09-14 01:30 UTC is still Sunday 8:30 PM in Chicago.
  const sundayNightCentral = '2026-09-14T01:30:00Z';
  assert.equal(new Date(sundayNightCentral).getUTCDay(), 1, 'UTC has already rolled over to Monday');
  assert.equal(d.dayCodeFor(sundayNightCentral, 'America/Chicago'), 'SUN', 'the creator is still on Sunday');
  assert.equal(d.buildTodayPlan(s, [], { date: sundayNightCentral }).day, 'SUN');
  assert.equal(d.creatorLocalDateParts(sundayNightCentral, 'America/Chicago').iso_date, '2026-09-13');
  assert.equal(d.todayTimezone(s), 'America/Chicago', 'the pilot timezone is the default');
  assert.equal(d.todayTimezone({ settings: { creatorTimezone: 'Europe/London' } }), 'Europe/London');
  // The whole preview strip resolves in creator-local time.
  for (const code of ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']) {
    assert.equal(d.buildTodayPlan(s, [], { day_code: code }).day, code);
    assert.equal(d.dayCodeFor(d.dateForDayCode(code, { from: sundayNightCentral }), 'America/Chicago'), code);
  }
  const ui = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert(!/getUTCDay\(\)/.test(ui), 'the UI must not derive preview days from the browser UTC weekday');
});

// ---------------------------------------------------------------------------
// Q..U — baseline import
// ---------------------------------------------------------------------------
const IMPORT_JSON = JSON.stringify({
  schema: 'LUXX_BASELINE_IMPORT_V1', captured_on: '2026-09-06',
  rows: [
    { platform: 'X', metric: 'followers', value: 36, unit: 'count', evidence_reference: 'x-followers.png' },
    { platform: 'X', metric: 'posts', value: 51, evidence_reference: 'x-posts.png' },
    { platform: 'Pornhub', metric: 'full_videos', value: 9, evidence_reference: 'ph.png' },
    { platform: 'OnlyFans Paid', metric: 'active_subscribers', value: 4, evidence_reference: 'ofp.png' },
    { platform: 'OnlyFans Paid', metric: 'revenue_last_30_days', value: 'NOT_AVAILABLE', evidence_reference: 'ofp.png', notes: 'dashboard does not expose it' },
    { platform: 'Chaturbate', metric: 'followers', value: 1343, evidence_reference: 'cb.png' },
    { platform: 'Linktree', metric: 'buttons', value: 5, evidence_reference: 'lt.png' }
  ]
});

t('Q. baseline import populates the review state', () => {
  const s = ready0();
  const r = d.importBaseline(s, { text: IMPORT_JSON });
  assert.equal(r.imported, 7);
  assert.deepEqual(r.platforms.sort(), ['Chaturbate', 'Linktree', 'OnlyFans Paid', 'Pornhub', 'X'].sort());
  const x = s.baseline.snapshots.find(v => v.platform === 'X');
  assert.equal(x.metrics.followers, 36);
  assert.equal(x.metrics.posts, 51);
  assert.equal(x.source, 'IMPORT');
  assert.equal(x.review_state, 'IMPORTED_PENDING_REVIEW');
  assert.equal(x.evidence_reference, 'x-followers.png', 'evidence references survive the import');
  const review = d.baselineReview(s);
  assert.equal(review.pending_review, 5);
  assert.deepEqual(review.flow, ['IMPORT', 'REVIEW', 'CAPTURE BASELINE', 'LOCK BASELINE']);
  // CSV is accepted too.
  const s2 = ready0();
  const csv = d.importBaseline(s2, { text: 'platform,metric,value,unit,evidence_reference,notes\nX,followers,36,count,shot.png,\nFansly,followers,NOT_AVAILABLE,count,shot.png,new account\n' });
  assert.equal(csv.imported, 2);
  assert.equal(s2.baseline.snapshots.find(v => v.platform === 'Fansly').not_available[0], 'followers');
  // Old reference seeds are never promoted into the launch baseline.
  assert(s.accounts.some(a => /1,343/.test(a.seed || '')), 'the reference seed still exists on the account');
  assert(!s.baseline.snapshots.some(v => v.source === 'SEED'), 'no seed was promoted into the baseline');
});

t('R. baseline import preserves NOT AVAILABLE instead of converting it to zero', () => {
  const s = ready0();
  d.importBaseline(s, { text: IMPORT_JSON });
  const ofp = s.baseline.snapshots.find(v => v.platform === 'OnlyFans Paid');
  assert.equal(ofp.metrics.active_subscribers, 4);
  assert.equal('revenue_last_30_days' in ofp.metrics, false, 'an unavailable metric must not become a number');
  assert.equal(ofp.metrics.revenue_last_30_days, undefined);
  assert.notEqual(ofp.metrics.revenue_last_30_days, 0, 'NOT AVAILABLE must never be recorded as zero');
  assert(ofp.not_available.includes('revenue_last_30_days'), 'it is recorded explicitly as NOT AVAILABLE');
  for (const token of ['NOT_AVAILABLE', 'NOT AVAILABLE', 'N/A', '']) {
    const s2 = ready0();
    d.importBaseline(s2, { rows: [{ platform: 'Fansly', metric: 'followers', value: token }] });
    const f = s2.baseline.snapshots.find(v => v.platform === 'Fansly');
    assert.equal(f.metrics.followers, undefined, `${token || 'empty'} became a number`);
    assert(f.not_available.includes('followers'), `${token || 'empty'} was not preserved as NOT AVAILABLE`);
  }
  // A value that is neither a number nor a recognised unavailable token is rejected, not guessed.
  assert.throws(() => d.importBaseline(ready0(), { rows: [{ platform: 'X', metric: 'followers', value: 'about forty' }] }), /neither a number nor NOT_AVAILABLE/);
});

t('S. baseline import does not automatically capture or lock', () => {
  const s = ready0();
  const r = d.importBaseline(s, { text: IMPORT_JSON });
  assert.equal(s.baseline.captured, false, 'import must not capture');
  assert.equal(s.baseline.locked, false, 'import must not lock');
  assert.equal(r.auto_locked, false);
  assert.equal(r.review_required, true);
  assert.match(r.next_step, /REVIEW.*CAPTURE BASELINE.*LOCK BASELINE/);
  assert.equal(d.generateRecommendation(s, [img('IMG-A')]).ready, false, 'an unlocked baseline still blocks prescriptions');
});

t('T. baseline import cannot overwrite an already locked baseline', () => {
  const s = ready();
  assert.equal(s.baseline.locked, true);
  const before = JSON.stringify(s.baseline);
  assert.throws(() => d.importBaseline(s, { text: IMPORT_JSON }), /already locked/i);
  assert.throws(() => d.importBaseline(s, { text: IMPORT_JSON }), /will not overwrite a locked baseline/i);
  assert.equal(JSON.stringify(s.baseline), before, 'the locked baseline was not modified');
  assert.throws(() => d.recordBaselineSnapshot(s, { platform: 'X', metrics: { followers: 999 } }), /locked/i);
});

t('U. the imported baseline follows IMPORT -> REVIEW -> CAPTURE -> LOCK', () => {
  const s = ready0();
  d.importBaseline(s, { text: IMPORT_JSON });
  assert.equal(d.baselineReview(s).pending_review > 0, true, 'REVIEW step exists and is pending');
  assert.throws(() => d.lockBaseline(s), /Capture the baseline before locking/);
  d.captureBaseline(s, { evidence_reference: 'launch-day screenshots 2026-09-07', inventory_mapping_reference: 'library map', snapshots: s.baseline.snapshots });
  assert.equal(s.baseline.captured, true);
  assert.equal(s.baseline.locked, false, 'capture alone must not lock');
  d.lockBaseline(s);
  assert.equal(s.baseline.locked, true);
  const kinds = s.auditEvents.filter(e => e.entity_type === 'BASELINE').map(e => e.event_type);
  assert(kinds.includes('BASELINE_IMPORTED') && kinds.includes('BASELINE_CAPTURED') && kinds.includes('BASELINE_LOCKED'),
    'every step of the flow is audited in order');
  assert(kinds.indexOf('BASELINE_IMPORTED') < kinds.indexOf('BASELINE_CAPTURED'));
  assert(kinds.indexOf('BASELINE_CAPTURED') < kinds.indexOf('BASELINE_LOCKED'));
});

function ready0() { return d.seedState(); }

// ---------------------------------------------------------------------------
// V — the browser suite drives the real job-based controls
// ---------------------------------------------------------------------------
t('V. the browser UI test uses the real job-based controls, not stale #prescribeBtn', () => {
  const bt = fs.readFileSync(path.join(ROOT, 'tests/browser-tests.py'), 'utf8');
  const ra = fs.readFileSync(path.join(ROOT, 'tests/browser-real-api.py'), 'utf8');
  // Scan EXECUTABLE lines only. The suites document what RC1 used to drive, and a
  // comment describing a removed control is not the same as still driving it.
  const DOCSTRING = new RegExp('^\\s*' + '"'.repeat(3) + '[\\s\\S]*?' + '"'.repeat(3), 'm');
  const executable = src => src.replace(DOCSTRING, '')
    .split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  for (const [name, rawSrc] of [['browser-tests.py', bt], ['browser-real-api.py', ra]]) {
    const src = executable(rawSrc);
    assert(!/(?:locator|wait_for_selector|query_selector|click|fill)\(\s*['"]#prescribeBtn/.test(src),
      `${name} still drives the removed #prescribeBtn control`);
    assert(/USE THIS/.test(src), `${name} must drive the job-based USE THIS control`);
    assert(/mediaCard/.test(src), `${name} must use the current .mediaCard selector`);
    assert(/SET UP \/ VERIFY/.test(src), `${name} must use the current route verification control`);
    assert(!/EDIT \/ VERIFY/.test(src), `${name} uses a route button label that no longer exists`);
    assert(!/UPLOAD \+ SAVE'/.test(src), `${name} uses an upload button label that no longer exists`);
    assert(!/\/mnt\/data\//.test(src), `${name} still depends on an absolute machine-specific path`);
    assert(!/executable_path='\/usr\/bin\/chromium'/.test(src), `${name} still hard-codes a chromium path`);
  }
  const ui = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert(/id="prescribeBtn"/.test(ui) === false || /FIX SETUP/.test(ui), 'prescribeBtn, if present, is the HOLD fix-setup control only');
  const defs = new Set([...ui.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  const refs = new Set([...ui.matchAll(/on(?:click|change|input)="([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  const missing = [...refs].filter(r => !defs.has(r));
  assert.deepEqual(missing, [], `inline handlers with no definition: ${missing.join(', ')}`);
  assert(/nav class="nav"/.test(ui));
  const nav = ui.match(/<nav class="nav">([\s\S]*?)<\/nav>/)[1];
  assert.equal((nav.match(/data-view=/g) || []).length, 3, 'primary navigation must stay at exactly three tabs');
});

// ---------------------------------------------------------------------------
const report = { pass: failed.length === 0, total: checks.length, passed: passed.length, failed };
fs.writeFileSync(path.join(ROOT, 'tests/LAUNCH_FIX_V170_RESULTS.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
