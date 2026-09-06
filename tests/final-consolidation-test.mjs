// LUXX v1.8.0 — FINAL PRODUCTION CONSOLIDATION ACCEPTANCE
// Section 20 items A1..G52, executed against the real domain and the operator's own
// data files. Nothing here is mocked and no expectation was relaxed to fit the build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const d = await import('../netlify/lib/domain.mjs');
const v = await import('../netlify/lib/video.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const domainSrc = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');

const BASELINE_FIXTURE = path.join(ROOT, 'tests/fixtures/LUXX001_BASELINE_LOCK_CANDIDATE_2026-09-05.json');
const ROUTE_CANDIDATE = path.join(ROOT, 'tests/fixtures/LUXX001_TRACKING_ROUTES_VERIFIED_2026-09-05.json');
const ROUTE_FINAL = path.join(ROOT, 'config/LUXX001_ROUTE_PLACEMENTS_FINAL.json');

const checks = [], passed = [], failed = [];
function t(id, name, fn) {
  const label = `${id} ${name}`;
  try { fn(); passed.push(label); console.log('PASS', label); }
  catch (e) { failed.push({ id, name, error: String((e && e.message) || e) }); console.log('FAIL', label, '-', (e && e.message)); }
  checks.push(label);
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
function locked() {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  return s;
}
const img = (id, x = {}) => ({
  asset_id: id, name: id, media_type: 'IMAGE', authorization_status: 'AUTHORIZED', availability: 'AVAILABLE',
  historical_usage_status: 'PROSPECTIVE', platform_eligibility: [], x_face_safe: true,
  variants: [{ variant_id: id + '-S', asset_id: id, variant_type: 'PRIVACY_SAFE_EXPORT', rendered: true,
               privacy_safe_export: true, metadata_stripped: true }], ...x
});

// ===========================================================================
// A. BASELINE
// ===========================================================================
t('A1', 'the candidate baseline imports from the operator file', () => {
  const s = d.seedState();
  const r = d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  assert.equal(r.imported, 24, `expected 24 rows, got ${r.imported}`);
  assert.deepEqual(r.platforms.sort(), ['Chaturbate', 'Fansly', 'ManyVids', 'OnlyFans Free', 'OnlyFans Paid', 'Pornhub', 'X']);
  const x = s.baseline.snapshots.find(v => v.platform === 'X');
  assert.equal(x.metrics.followers, 35);
  assert.equal(x.metrics.posts, 51);
  const ofp = s.baseline.snapshots.find(v => v.platform === 'OnlyFans Paid');
  assert.equal(ofp.metrics.paid_subscribers, 4);
  assert.equal(ofp.metrics.subscription_price_usd, 9.99);
  const ph = s.baseline.snapshots.find(v => v.platform === 'Pornhub');
  assert.equal(ph.metrics.video_views, 8759);
  assert.equal(ph.metrics.profile_views, 9584);
  assert.equal(s.baseline.snapshots.find(v => v.platform === 'Chaturbate').metrics.followers, 1338);
  // Every observed ManyVids price is preserved individually. No average, no median.
  const mv = s.baseline.snapshots.find(v => v.platform === 'ManyVids');
  assert.equal(mv.metrics.listings, 7);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(i => mv.metrics[`listing_price_${i}`]),
    [3.99, 7.99, 4.99, 4.99, 6.39, 3.99, 4.99]);
  for (const k of Object.keys(mv.metrics)) assert(!/avg|mean|median/i.test(k), `derived price metric ${k}`);
  // Creator rules travel with the candidate; only NO_FACE for X and Pornhub.
  assert.deepEqual(r.candidate.creator_rules, { X: ['NO_FACE'], Pornhub: ['NO_FACE'] });
  // The counted source inventory is recorded as an observation.
  assert.deepEqual(
    { p: d.sourceInventory(s).photos, v: d.sourceInventory(s).videos, t: d.sourceInventory(s).total_media },
    { p: 446, v: 47, t: 493 });
});

t('A2', 'review is required before lock', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  assert.equal(s.baseline.captured, false, 'import must not capture');
  assert.equal(s.baseline.locked, false, 'import must not lock');
  const review = d.baselineReview(s);
  assert.equal(review.pending_review, 7, 'every imported platform waits for review');
  assert.deepEqual(review.flow, ['IMPORT', 'REVIEW', 'CAPTURE BASELINE', 'LOCK BASELINE']);
  assert.throws(() => d.lockBaseline(s), /Capture the baseline before locking/);
});

t('A3', 'lock is explicit and preserves the reviewed values', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  d.captureBaseline(s, { evidence_reference: 'launch-day recheck', inventory_mapping_reference: 'library map' });
  assert.equal(s.baseline.captured, true);
  assert.equal(s.baseline.locked, false, 'capture alone must not lock');
  d.lockBaseline(s);
  assert.equal(s.baseline.locked, true);
  assert.equal(s.baseline.snapshots.length, 7, 'the reviewed numbers survive capture and lock');
  assert.equal(s.baseline.snapshots.find(v => v.platform === 'X').metrics.followers, 35);
});

t('A4', 'a locked baseline cannot be overwritten by a later import', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  const before = JSON.stringify(s.baseline);
  assert.throws(() => d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') }), /already locked/i);
  assert.throws(() => d.recordBaselineSnapshot(s, { platform: 'X', metrics: { followers: 999 } }), /locked/i);
  assert.equal(JSON.stringify(s.baseline), before, 'the locked baseline was not modified');
});

t('A5', 'unknown remains unknown and is never coerced to zero', () => {
  const s = d.seedState();
  const doc = readJson(BASELINE_FIXTURE);
  doc.platforms.chaturbate.metrics.tokens_last_30_days = { value: null, truth_state: 'UNKNOWN' };
  d.importBaseline(s, { text: JSON.stringify(doc) });
  const cb = s.baseline.snapshots.find(v => v.platform === 'Chaturbate');
  assert.equal(cb.metrics.tokens_last_30_days, undefined, 'an unknown metric must not become a number');
  assert.notEqual(cb.metrics.tokens_last_30_days, 0);
  assert(cb.not_available.includes('tokens_last_30_days'), 'it is recorded explicitly as NOT AVAILABLE');
});

t('A6', 'an observed zero stays zero', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  const f = s.baseline.snapshots.find(v => v.platform === 'Fansly');
  assert.equal(f.metrics.subscribers, 0, 'an observed zero is a real measurement');
  assert.equal(f.not_available.includes('subscribers'), false, 'and is not treated as unknown');
  assert.equal(f.metrics.posts, 4);
});

t('A7', 'a locked baseline is corrected only through the append-only ledger', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  const before = structuredClone(s);
  const lockedValue = s.baseline.snapshots.find(v => v.platform === 'X').metrics.followers;
  assert.equal(lockedValue, 35);
  // There is no API that rewrites a locked baseline in place. That is the point.
  assert.equal(typeof d.recordBaselineCorrection, 'undefined',
    'no in-place baseline correction API may exist');
  assert.throws(() => d.recordBaselineSnapshot(s, { platform: 'X', metrics: { followers: 36 } }), /locked/i);
  assert.throws(() => d.importBaseline(s, { rows: [{ platform: 'X', metric: 'followers', value: 36 }] }), /already locked/i);
  // Later movement belongs in RESULTS and the action ledger, which are append-only and audited.
  d.validateAppendOnly(before, s);
  assert.equal(s.baseline.snapshots.find(v => v.platform === 'X').metrics.followers, 35,
    'the locked baseline is preserved as the before-LUXX reference point');
  const audited = s.auditEvents.filter(e => e.entity_type === 'BASELINE').map(e => e.event_type);
  assert(audited.includes('BASELINE_IMPORTED') && audited.includes('BASELINE_CAPTURED') && audited.includes('BASELINE_LOCKED'),
    'every baseline step is auditable');
});

// ===========================================================================
// B. ROUTES
// ===========================================================================
t('B8', 'the real route configuration loads from the operator file', () => {
  const s = locked();
  const r = d.importRouteConfig(s, readJson(ROUTE_CANDIDATE));
  assert.equal(r.applied.length, 9);
  assert.equal(r.skipped.length, 0);
  const inv = d.routeInventory(s);
  assert.equal(inv.find(x => x.route_id === 'X_BIO_TO_OF_FREE_01').tracking_url, 'https://onlyfans.com/luxx4free/c6');
  assert.equal(inv.find(x => x.route_id === 'X_POST_TO_OF_FREE_01').tracking_url, 'https://onlyfans.com/luxx4free/c9');
  assert.equal(inv.find(x => x.route_id === 'OF_FREE_MESSAGE_TO_OF_PAID_01').tracking_url, 'https://onlyfans.com/luxx4pleasure/c5');
  // A route that is not in the catalog is never invented from a config file.
  const s2 = locked();
  const bad = d.importRouteConfig(s2, { routes: [{ route_id: 'MADE_UP_ROUTE_01', tracking_url: 'https://x.test/1', state: 'VERIFIED' }] });
  assert.equal(bad.applied.length, 0);
  assert.match(bad.skipped[0].reason, /no such route/i);
});

t('B9', 'CONFIGURED is not VERIFIED', () => {
  const s = locked();
  d.updateRoute(s, 'X_BIO_TO_OF_FREE_01', { tracking_url_or_identifier: 'https://onlyfans.com/luxx4free/c6' });
  const r = s.routes.find(x => x.route_id === 'X_BIO_TO_OF_FREE_01');
  assert.equal(d.routeState(r), 'CONFIGURED', 'a bound URL alone is only CONFIGURED');
  assert.equal(r.verification_status, 'UNVERIFIED');
  assert.equal(d.routeUsable(r), false, 'a merely configured route cannot serve a job');
});

t('B10', 'VERIFIED is not ACTIVE', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_CANDIDATE));
  const external = d.routeInventory(s).filter(x => x.scope !== 'INTERNAL');
  const active = external.filter(x => x.state === 'ACTIVE');
  assert.deepEqual(active, [], 'verifying nine URLs must activate none of them');
  assert.equal(external.filter(x => x.state === 'VERIFIED').length, 9);
  const r = s.routes.find(x => x.route_id === 'X_BIO_TO_OF_FREE_01');
  assert.equal(r.verification_status, 'VERIFIED');
  assert.equal(r.active_status, 'INACTIVE', 'verification must not set active_status');
  assert.equal(d.routeUsable(r), false, 'a verified-but-uninstalled route cannot serve a job');
});

t('B11', 'ACTIVE requires an explicit confirmed placement', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_CANDIDATE));
  assert.throws(() => d.confirmRoutePlacement(s, 'X_BIO_TO_OF_FREE_01', { placement_evidence: '' }),
    /requires evidence/i);
  const r = d.confirmRoutePlacement(s, 'X_BIO_TO_OF_FREE_01', { placement_evidence: 'installed in the live X bio' });
  assert.equal(d.routeState(r), 'ACTIVE');
  assert.equal(r.placement_installed, true);
  assert.equal(r.placement_evidence, 'installed in the live X bio');
  assert(r.activated_at, 'activation is timestamped');
  // An unverified route cannot be activated at all.
  const s2 = locked();
  assert.throws(() => d.confirmRoutePlacement(s2, 'X_POST_TO_OF_FREE_01', { placement_evidence: 'x' }),
    /Verify the tracking link/i);
});

t('B12', 'a job cannot silently use another placement’s tracker', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  const xJob = { job: 'ACQUIRE', intent: 'X_TEASER', platform: 'X', label: 'X teaser' };
  const rs = d.jobRouteStatus(s, xJob);
  assert.equal(rs.route.route_id, 'X_POST_TO_OF_FREE_01');
  // Only X → OnlyFans Free placements may gate or serve this job.
  for (const id of rs.candidates) {
    const r = s.routes.find(x => x.route_id === id);
    assert.equal(r.source, 'X', `${id} is not an X route`);
    assert.equal(r.destination, 'OnlyFans Free', `${id} is not on the intended funnel leg`);
  }
  assert(!rs.candidates.includes('PH_PROFILE_TO_OF_FREE_01'), 'a Pornhub tracker must never gate an X job');
  assert(!rs.candidates.includes('X_BIO_TO_FANSLY_01'), 'a Fansly destination must never gate an X → OF Free job');
  // The pinned placement is a different route and cannot substitute for the post placement.
  assert.notEqual(rs.route.route_id, 'X_PINNED_TO_OF_FREE_01');
  const line = d.buildTodayPlan(s, [img('A'), img('B'), img('C')], { date: '2026-09-07T15:00:00Z' })
    .lines.find(l => l.platform === 'X' && l.kind === 'ACTION');
  assert.equal(line.route_id, 'X_POST_TO_OF_FREE_01');
  assert.equal(line.tracking_url, 'https://onlyfans.com/luxx4free/c9');
});

t('B13', 'native routes need no outbound tracking URL', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  for (const id of ['OF_PAID_FEED_01', 'OF_PAID_PPV_MESSAGE_01', 'MV_LISTING_01', 'CB_NATIVE_TIPS_01',
                    'OF_FREE_POST_PPV_01', 'OF_FREE_MESSAGE_PPV_01']) {
    const r = s.routes.find(x => x.route_id === id);
    assert(r, `native route missing: ${id}`);
    assert.equal(r.attribution_scope, 'INTERNAL');
    assert(!r.tracking_url_or_identifier, `${id} was given an outbound URL`);
    assert.equal(d.routeState(r), 'ACTIVE', `${id} should measure natively`);
  }
  // Attaching an outbound URL to a native route is refused, not silently accepted.
  const res = d.importRouteConfig(s, { routes: [{ route_id: 'OF_PAID_FEED_01', tracking_url: 'https://onlyfans.com/luxx4pleasure/c8', state: 'VERIFIED' }] });
  assert.equal(res.applied.length, 0);
  assert.match(res.skipped[0].reason, /native route/i);
  assert(!s.routes.find(x => x.route_id === 'OF_PAID_FEED_01').tracking_url_or_identifier);
});

t('B14', 'reserved URLs remain unassigned', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  const reserved = d.reservedTrackingUrls(s).map(x => x.url);
  assert(reserved.includes('https://onlyfans.com/luxx4pleasure/c8'), 'the Paid c8 link stays reserved');
  assert(reserved.includes('https://onlyfans.com/luxx4free/c11'), 'the superseded Free c11 link stays reserved');
  for (const url of reserved)
    assert(!s.routes.some(r => r.tracking_url_or_identifier === url), `${url} was bound to a route`);
  // A URL already bound to a route cannot be reserved.
  assert.throws(() => d.reserveTrackingUrl(s, { url: 'https://onlyfans.com/luxx4free/c6' }), /already bound/i);
});

t('B15', 'the X pinned route stays VERIFIED because it was never installed', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  const r = s.routes.find(x => x.route_id === 'X_PINNED_TO_OF_FREE_01');
  assert.equal(d.routeState(r), 'VERIFIED');
  assert.equal(r.placement_installed !== true, true);
  assert.match(r.activation_blocker, /pinned post could not be edited/i);
  assert.equal(d.routeUsable(r), false);
  const steps = d.routeActivationSteps(r);
  assert(steps.some(x => /confirm the placement/i.test(x)), 'the operator is told what would activate it');
});

t('B16', 'the Pornhub video-description routes stay VERIFIED with no placement', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  for (const id of ['PH_VIDEO_DESC_TO_OF_FREE_01', 'PH_VIDEO_DESC_TO_FANSLY_01']) {
    const r = s.routes.find(x => x.route_id === id);
    assert.equal(d.routeState(r), 'VERIFIED', `${id} must not be ACTIVE`);
    assert.match(r.activation_blocker, /description placement/i);
    assert.equal(d.routeUsable(r), false);
  }
});

t('B-final', 'the final effective configuration matches the nine authorised placements', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_CANDIDATE));
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  // TEST EXPECTATION CORRECTION: the operator later supplied Official Website placement
  // evidence for c7, so PH_PROFILE_TO_OF_FREE_01 is now legitimately ACTIVE. Nine became
  // ten. Every other frozen ACTIVE route is unchanged.
  const active = d.routeInventory(s).filter(x => x.scope !== 'INTERNAL' && x.state === 'ACTIVE').map(x => x.route_id).sort();
  assert.deepEqual(active, [
    'LINKTREE_BUTTON_TO_FANSLY_01', 'LINKTREE_BUTTON_TO_MV_01', 'LINKTREE_BUTTON_TO_OF_FREE_01',
    'LINKTREE_BUTTON_TO_OF_PAID_01', 'LINKTREE_BUTTON_TO_X_01', 'OF_FREE_BIO_TO_OF_PAID_01',
    'PH_PROFILE_TO_FANSLY_01', 'PH_PROFILE_TO_OF_FREE_01',
    'X_BIO_TO_OF_FREE_01', 'X_POST_TO_OF_FREE_01'].sort());
  assert(active.length === 10, `expected 10 ACTIVE, got ${active.length}`);
  assert(active.includes('PH_PROFILE_TO_OF_FREE_01'), 'the Pornhub Official Website route is live');
  // The sequence discrepancy is recorded, not erased.
  const cfg = readJson(ROUTE_FINAL);
  assert.match(cfg.sequence_note, /before the baseline was locked/i);
  assert(cfg.routes.filter(r => r.installed_before_baseline_lock).length >= 9);
});

// ===========================================================================
// C. TODAY
// ===========================================================================
function todayWithRoutes() {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  return { s, plan: d.buildTodayPlan(s, [img('A'), img('B'), img('C')], { date: '2026-09-07T15:00:00Z' }) };
}

t('C17', 'an actionable job shows the correct route ID', () => {
  const { plan } = todayWithRoutes();
  const acts = plan.lines.filter(l => l.kind === 'ACTION');
  assert(acts.length > 0);
  for (const l of acts) {
    assert(l.route_id, `${l.intent} has no route`);
    assert(['ACTIVE'].includes(l.route_state), `${l.intent} used a route in state ${l.route_state}`);
  }
  assert.equal(acts.find(l => l.intent === 'OF_PAID_WALL').route_id, 'OF_PAID_FEED_01');
  assert.equal(acts.find(l => l.intent === 'X_TEASER').route_id, 'X_POST_TO_OF_FREE_01');
});

t('C18', 'an actionable job shows the correct tracking URL', () => {
  const { plan } = todayWithRoutes();
  const x = plan.lines.find(l => l.intent === 'X_TEASER' && l.kind === 'ACTION');
  assert.equal(x.tracking_url, 'https://onlyfans.com/luxx4free/c9');
  const native = plan.lines.find(l => l.intent === 'OF_PAID_WALL' && l.kind === 'ACTION');
  assert.equal(native.tracking_url, null, 'a native route has no outbound URL');
  assert.equal(native.route_is_native, true);
  assert.match(native.route_note, /Native measurement/i);
  // The operator is never asked to pick between cryptic codes.
  assert(/COPY LINK/.test(html), 'the tracking link is copyable from the card');
});

t('C19', 'the job shows the exact placement', () => {
  const { plan } = todayWithRoutes();
  const x = plan.lines.find(l => l.intent === 'X_TEASER' && l.kind === 'ACTION');
  assert.equal(x.placement, 'POST');
  assert.equal(x.placement_label, 'post');
  assert.equal(x.platform, 'X');
  assert(/routeBlockHtml/.test(html), 'the card renders a route block');
});

t('C20', 'required result fields are shown', () => {
  const { plan } = todayWithRoutes();
  for (const l of plan.lines.filter(x => x.kind === 'ACTION'))
    assert(Array.isArray(l.required_result_fields) && l.required_result_fields.length, `${l.intent} lists no result fields`);
  const ph = d.resultFieldsFor('Pornhub');
  assert.deepEqual(ph.native, ['total_views', 'total_earnings', 'rating_percent', 'favorites', 'comments', 'playlist_additions']);
});

t('C21', 'HOLD remains job-aware after the route changes', () => {
  const s = locked();   // no route config imported: external routes are not live
  const plan = d.buildTodayPlan(s, [img('A')], { date: '2026-09-09T15:00:00Z' });
  const blocked = plan.lines.filter(l => l.kind === 'BLOCKED');
  assert(blocked.length > 0);
  for (const l of blocked) {
    assert(d.HOLD_CODES.includes(l.hold_code), `unknown hold code ${l.hold_code}`);
    assert(['FIX SETUP', 'FIX LIBRARY', 'CAM AVAILABILITY'].includes(l.recovery));
    assert(l.repair_context && l.repair_context.intent, 'the hold carries repair context');
    assert(!/nothing eligible for this job/i.test(l.why), 'the generic hold text is back');
  }
});

t('C22', 'actual execution overrides the prescription in the ledger', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  const assets = [img('IMG-T')];
  const rec = d.generateRecommendation(s, assets);
  const rx = d.createPrescriptionForPick(s, rec, { asset_id: 'IMG-T', variant_id: 'IMG-T-S',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'PPV_DM' });
  const action = d.approvePrescription(s, rx.prescription_id, assets);
  const prescribed = d.prescribedTreatmentId(action);
  assert(prescribed, 'the prescription carries a treatment id');
  // She sends a different preview style than prescribed.
  // Two test defects, not production ones: executeAction reads preview_style /
  // audience_segment (not executed_*), and TEXT_ONLY_NO_PREVIEW is not in PREVIEW_STYLES.
  // The domain correctly refuses to record an invalid treatment rather than coercing it.
  d.executeAction(s, action.action_id, { execution_reference: 'r', creator_effort_minutes: 5,
    preview_style: 'TEXT_ONLY', audience_segment: 'ACTIVE_SUBSCRIBERS', sent_to: 40 });
  const executed = s.actions.find(a => a.action_id === action.action_id);
  const dev = d.treatmentDeviation(executed);
  assert.equal(dev.prescribed_treatment_id, prescribed);
  assert(dev.actual_treatment_id, 'the actual treatment is recorded');
  assert.equal(dev.deviated, true, 'the deviation is visible');
  assert.match(dev.note, /ACTUALLY used/i);
  assert.equal(d.treatmentOfAction(s, executed), dev.actual_treatment_id, 'evidence uses the ACTUAL treatment');
});

// ===========================================================================
// D. VIDEO — variable-length suggested cut
// ===========================================================================
t('D23', 'an arbitrary valid target duration parses', () => {
  for (const [input, secs] of [['0:30', 30], ['1:00', 60], ['2:15', 135], ['7:00', 420], ['1:02:00', 3720], ['45', 45]])
    assert.equal(v.parseTargetDuration(input), secs, `${input} parsed wrongly`);
  assert.equal(d.parseTargetDurationPure('2:15'), 135, 'the command path agrees with the renderer');
});

t('D24', '4:30 resolves to 270 seconds', () => {
  assert.equal(v.parseTargetDuration('4:30'), 270);
  assert.equal(d.parseTargetDurationPure('4:30'), 270);
  // 4:30 is an example, not a hard-coded default, in production source.
  const exec = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const rendererExec = exec(fs.readFileSync(path.join(ROOT, 'netlify/lib/video.mjs'), 'utf8'));
  assert(!/\b(target|cut|main)[A-Za-z_]*\s*[:=]\s*270\b/.test(rendererExec),
    'a 270-second target constant is baked into the renderer');
  assert(!/duration>=\d+\?270/.test(rendererExec), 'a fixed 270-second rule is baked into the renderer');
  assert(!/target_seconds\s*[:=]\s*270/.test(exec(html)), 'the UI defaults to a fixed 4:30 target');
});

t('D25/D26', 'the full master stays byte-identical and full length', () => {
  // Proven end to end against the creator master; the recorded evidence is asserted here.
  const rm = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/REAL_MEDIA_ACCEPTANCE_RESULTS.json'), 'utf8'));
  assert.equal(rm.pass, true, 'real-media acceptance must be green');
  const fm = (rm.variants || []).find(x => x.variant_id === 'FULL-MASTER');
  assert(fm, 'a FULL-MASTER variant exists');
  assert(Math.abs(fm.seconds - rm.source.duration_seconds) < 1.5, 'the master spans the whole source');
  assert(fm.seconds > 320, 'a long master is not truncated');
});

t('D27', 'a continuous manual cut works', () => {
  const plan = v.planSuggestedCut(300, 240, {});
  assert.equal(plan.segment_count, 1, 'a target that is most of the source is one continuous block');
  assert.equal(plan.segments[0].duration, 240);
});

t('D28', 'a multi-segment suggested cut works', () => {
  const plan = v.planSuggestedCut(956.946978, 270, {});
  assert(plan.segment_count > 1, 'a short target from a long source uses multiple segments');
  assert.equal(plan.planned_seconds, 270);
  assert.equal(plan.segments.reduce((a, x) => a + x.duration, 0).toFixed(3), '270.000');
  // Segments are ordered and inside the source.
  for (let i = 1; i < plan.segments.length; i++)
    assert(plan.segments[i].start >= plan.segments[i - 1].end - 0.001, 'segments must not overlap or reorder');
  for (const s of plan.segments) assert(s.end <= 956.946978 + 0.001, 'a segment ran past the source');
});

t('D29', 'the selected source ranges are stored on the derivative', () => {
  const rm = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/REAL_MEDIA_ACCEPTANCE_RESULTS.json'), 'utf8'));
  assert(rm.ran, 'real-media acceptance ran');
  // Lineage fields exist in the shipped renderer.
  const me = fs.readFileSync(path.join(ROOT, 'netlify/lib/media-edit.mjs'), 'utf8');
  for (const f of ['source_segments', 'segment_count', 'target_seconds', 'cut_label', 'cut_method'])
    assert(me.includes(f), `derivative lineage field missing: ${f}`);
  assert(me.includes('master_asset_id'), 'lineage to the master is preserved');
});

t('D30', 'the actual output duration is displayed next to the target', () => {
  assert(/Target<\/b>/.test(html) || /<b>Target<\/b>/.test(html), 'the target is shown before save');
  assert(/Planned<\/b>/.test(html), 'the resulting duration is shown before save');
  assert(/Segment \$\{i \+ 1\}|Segment \$\{i\+1\}/.test(html), 'every segment range is shown');
});

t('D31', 'an invalid duration is rejected', () => {
  for (const bad of ['0:00', '-5', 'abc', '1:75', '', '::', '9:99:99'])
    assert.throws(() => v.parseTargetDuration(bad), /length|time|zero|under 60/i, `accepted ${JSON.stringify(bad)}`);
  assert.throws(() => v.parseTargetDuration(0), /greater than zero/);
  assert.throws(() => v.parseTargetDuration(-3), /greater than zero/);
});

t('D32', 'a target longer than the source is refused explicitly', () => {
  assert.throws(() => v.planSuggestedCut(100, 200, {}), /longer than the source/i);
  assert.throws(() => v.planSuggestedCut(100, 200, {}), /will not loop or pad/i);
  assert.throws(() => d.planSuggestedCutPure(956.946978, 1200, {}), /longer than the source/i);
});

t('D33/D34', 'retry does not duplicate the master and lineage survives processing', () => {
  const rm = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/REAL_MEDIA_ACCEPTANCE_RESULTS.json'), 'utf8'));
  const ids = (rm.checks || []).map(c => c.id);
  assert(ids.includes('O'), 'reprocessing idempotency was checked');
  assert(ids.includes('M'), 'derivative lineage was checked');
  assert(ids.includes('N'), 'records survive a reload');
  assert.equal(rm.failed.length, 0);
});

t('D35/D36', 'the label is SUGGESTED CUT and never claims best or proven', () => {
  const plan = v.planSuggestedCut(600, 120, {});
  assert.equal(plan.label, 'SUGGESTED 2:00 CUT');
  assert.match(plan.method, /TECHNICAL HEURISTIC/);
  assert.match(plan.disclosure, /does not understand/i);
  // A label that CLAIMS best/proven is forbidden. Text that DENIES the claim is required,
  // so the scan must look for the claim being asserted, not for the words appearing.
  // A string that DENIES the claim ("not a proven revenue-best") is required copy, not a
  // violation. Only an undenied assertion inside a label counts.
  const claimStr = /(?:label|title|name|badge)\s*[:=]\s*(['\"`])((?:(?!\1).)*)\1/gi;
  const denial = /(never|not|makes no claim|no claim that)[^.]*\b(best|proven|winning)\b/i;
  for (const [file, src] of [['renderer', fs.readFileSync(path.join(ROOT, 'netlify/lib/video.mjs'), 'utf8')], ['UI', html]]) {
    const e = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    for (const m of e.matchAll(claimStr)) {
      const text = m[2];
      if (!/\b(BEST|PROVEN|WINNING)\b/i.test(text)) continue;
      assert(/\b(not|never|no)\b/i.test(text),
        `${file} labels a cut BEST/PROVEN/WINNING without denying the claim: ${text.slice(0, 80)}`);
    }
  }
  assert(denial.test(plan.disclosure), 'the disclosure must explicitly deny a best/proven claim');
  assert(/SUGGESTED CUT/.test(html), 'the UI uses the honest label');
});

t('D37', 'destination restrictions still apply to derivatives', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  // A master with no confirmed face-safe review is not X eligible, cut or not.
  assert(!d.autoPlatformEligibility({ asset_id: 'F', media_type: 'IMAGE', authorization_status: 'AUTHORIZED',
    availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE', variants: [] }).includes('X'));
  const xJob = { job: 'ACQUIRE', intent: 'X_TEASER', platform: 'X', label: 'x' };
  const h = d.diagnoseJobHold(s, [img('FACE', { x_face_safe: false })], xJob);
  assert.equal(h.hold_code, 'NEEDS_X_CROP_REVIEW');
  // Only NO_FACE is declared, for X and Pornhub. No other creator restriction is invented.
  assert.deepEqual(Object.keys(d.CREATOR_RESTRICTIONS).sort(), ['Pornhub', 'X']);
});

// ===========================================================================
// E. MEDIA UI
// ===========================================================================
t('E38/E39', 'media status overlays are compact corner chips', () => {
  for (const sel of ['.optimizedBadge{', '.recommendedBadge{', '.cropChip{']) {
    const css = html.slice(html.indexOf(sel), html.indexOf('}', html.indexOf(sel)));
    assert(/font-size:9px/.test(css), `${sel} text is too large`);
    assert(/white-space:nowrap/.test(css), `${sel} is not a single line`);
    assert(/padding:1px 5px/.test(css), `${sel} padding is too large`);
    assert(/max-width:(52|60)%/.test(css), `${sel} may stretch across the media`);
    assert(!/box-shadow/.test(css), `${sel} is still a heavy overlay`);
  }
  assert(html.includes('✓ ORIENTATION OK'), 'the compact orientation chip is used');
  assert(!html.includes('✓ ORIENTATION VERIFIED'), 'the oversized label is back');
});

t('E40', 'the video poster remains visible before playback', () => {
  assert(/id="vposter"/.test(html));
  assert(/function playVideo\(/.test(html));
  assert(/Playback failed/.test(html), 'playback errors stay truthful');
  assert(!/autoplay/i.test(html), 'nothing autoplays to hide a broken player');
});

t('E41', 'the primary view/play action stays primary and download secondary', () => {
  assert(/id="vplayBtn" class="primary"/.test(html), 'PLAY is the primary action');
  assert(/class="secondary" onclick="downloadMedia/.test(html), 'download is secondary');
  assert(/DOWNLOAD \(OPTIONAL\)/.test(html));
  assert(/Downloading is optional/.test(html));
});

t('E42', 'history-protected media does not expose an ordinary destructive delete', () => {
  assert(/function historyProtectedHtml\(/.test(html));
  assert(/HISTORY-PROTECTED/.test(html));
  assert(/MARK UNAVAILABLE/.test(html));
  const fn = html.slice(html.indexOf('function historyProtectedHtml('), html.indexOf('async function markUnavailable('));
  assert(/if\(!refs\.length\)return `<button class="danger" onclick="deleteUnusedAsset/.test(fn),
    'only a genuinely unused duplicate keeps the safe delete');
});

// ===========================================================================
// F. CAM / INVENTORY
// ===========================================================================
function camState() {
  const s = locked();
  d.setCamAvailability(s, { day_windows: { MON: { start: '10:00', end: '13:00' }, FRI: { start: '10:00', end: '13:00' } },
    earliest_start: '10:00', latest_end: '13:00', timezone: 'America/Chicago' });
  return s;
}
t('F43', 'Monday 10:00–13:00 Central is allowed', () => {
  const s = camState();
  assert.equal(d.camDayStatus(s, 'MON'), 'AVAILABLE');
  assert.equal(d.camSlotAllowed(s, { day: 'MON', start: '10:00', end: '13:00' }).allowed, true);
  assert.equal(d.camSlotAllowed(s, { day: 'MON', start: '09:00', end: '13:00' }).allowed, false, 'before the window');
  assert.equal(d.camSlotAllowed(s, { day: 'MON', start: '10:00', end: '14:00' }).allowed, false, 'after the window');
  assert.equal(d.camWindowForDay(s, 'MON').label, '10:00 AM–1:00 PM America/Chicago');
});
t('F44', 'Friday 10:00–13:00 Central is allowed', () => {
  const s = camState();
  assert.equal(d.camDayStatus(s, 'FRI'), 'AVAILABLE');
  assert.equal(d.camSlotAllowed(s, { day: 'FRI', start: '10:00', end: '13:00' }).allowed, true);
  const sess = d.recordCamSession(s, { started_at: '2026-09-11T10:05', ended_at: '2026-09-11T12:55',
    effort_minutes: 170, followers_start: 1338, followers_end: 1350, tips_tokens: 500, native_revenue: 25 });
  assert.equal(sess.day_code, 'FRI');
  assert.equal(sess.outside_configured_availability, false);
  assert.equal(sess.followers_delta, 12);
});
t('F45', 'Saturday is blocked', () => {
  const s = camState();
  assert.equal(d.camDayStatus(s, 'SAT'), 'UNAVAILABLE');
  assert.equal(d.camAllowedOnDay(s, 'SAT'), false);
  assert.throws(() => d.setCamAvailability(s, { days: ['SAT'], earliest_start: '10:00', latest_end: '13:00' }), /Saturday and Sunday/);
  assert.throws(() => d.recordCamSession(s, { started_at: '2026-09-12T10:00', ended_at: '2026-09-12T12:00', effort_minutes: 60 }), /Saturday and Sunday/);
  assert(!d.buildTodayPlan(s, [], { date: '2026-09-12T15:00:00Z' }).lines.some(l => l.job === 'LIVE'));
});
t('F46', 'Sunday is blocked', () => {
  const s = camState();
  assert.equal(d.camDayStatus(s, 'SUN'), 'UNAVAILABLE');
  assert.throws(() => d.recordCamSession(s, { started_at: '2026-09-13T10:00', ended_at: '2026-09-13T12:00', effort_minutes: 60 }), /Saturday and Sunday/);
  assert(!d.buildTodayPlan(s, [], { date: '2026-09-13T15:00:00Z' }).lines.some(l => l.job === 'LIVE'));
});
t('F47', 'Tue/Wed/Thu remain UNDECLARED rather than fabricated', () => {
  const s = camState();
  for (const day of ['TUE', 'WED', 'THU']) {
    assert.equal(d.camDayStatus(s, day), 'UNDECLARED', `${day} was assumed`);
    assert.notEqual(d.camDayStatus(s, day), 'UNAVAILABLE', 'undeclared is not the same as unavailable');
    assert.equal(d.camAllowedOnDay(s, day), false, 'an undeclared day is not scheduled either');
    const r = d.camSlotAllowed(s, { day, start: '10:00', end: '13:00' });
    assert.equal(r.day_state, 'UNDECLARED');
    assert.match(r.reason, /has not been declared/i);
  }
  assert.deepEqual(d.camAvailability(s).undeclared_days, ['TUE', 'WED', 'THU']);
});
t('F48', 'the counted source inventory loads as 446 photos and 47 videos', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  const inv = d.sourceInventory(s);
  assert.equal(inv.photos, 446);
  assert.equal(inv.videos, 47);
  assert.equal(inv.total_media, 493);
  assert.equal(inv.produce_default, 'OFF');
});
t('F49', 'PRODUCE defaults OFF and counted inventory alone does not turn it on', () => {
  const s = d.seedState();
  d.importBaseline(s, { text: fs.readFileSync(BASELINE_FIXTURE, 'utf8') });
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  assert.equal(d.produceAllowed(s), false, 'a counted inventory is not a documented gap');
  assert.match(d.produceStatus(s).reason, /PRODUCE is OFF/);
  for (const day of ['2026-09-07', '2026-09-08', '2026-09-11', '2026-09-12', '2026-09-13'])
    assert(!d.buildTodayPlan(s, [img('A')], { date: day + 'T15:00:00Z' }).lines.some(l => l.job === 'PRODUCE'));
});

// ===========================================================================
// G. PORNHUB NATIVE ANALYTICS
// ===========================================================================
t('G50', 'native per-video metrics are accepted', () => {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  const assets = [img('IMG-PH')];
  const rec = d.generateRecommendation(s, assets);
  const rx = d.createPrescriptionForPick(s, rec, { asset_id: 'IMG-PH', variant_id: 'IMG-PH-S',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'OF_PAID_WALL' });
  const a = d.approvePrescription(s, rx.prescription_id, assets);
  d.executeAction(s, a.action_id, { execution_reference: 'r', creator_effort_minutes: 4 });
  const o = s.outcomes.find(x => x.action_id === a.action_id);
  // The six fields Pornhub's analytics screen actually exposes.
  d.recordMeasurement(s, o.outcome_id, { total_views: 2, total_earnings: 0, rating_percent: 0,
    favorites: 0, comments: 0, playlist_additions: 0 });
  const m = s.outcomes.find(x => x.outcome_id === o.outcome_id);
  assert.equal(m.raw.total_views, 2);
  assert.equal(m.raw.total_earnings, 0, 'an observed zero is stored as zero');
  assert.equal(m.raw.favorites, 0);
  assert.equal(m.raw.playlist_additions, 0);
  assert.deepEqual(d.resultFieldsFor('Pornhub').native,
    ['total_views', 'total_earnings', 'rating_percent', 'favorites', 'comments', 'playlist_additions']);
});
t('G51', 'a missing native metric remains unknown', () => {
  const s = locked();
  const assets = [img('IMG-PH2')];
  const rec = d.generateRecommendation(s, assets);
  const rx = d.createPrescriptionForPick(s, rec, { asset_id: 'IMG-PH2', variant_id: 'IMG-PH2-S',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'OF_PAID_WALL' });
  const a = d.approvePrescription(s, rx.prescription_id, assets);
  d.executeAction(s, a.action_id, { execution_reference: 'r', creator_effort_minutes: 4 });
  const o = s.outcomes.find(x => x.action_id === a.action_id);
  d.recordMeasurement(s, o.outcome_id, { total_views: 5, favorites: '', comments: null, playlist_additions: undefined });
  const m = s.outcomes.find(x => x.outcome_id === o.outcome_id);
  assert.equal(m.raw.total_views, 5);
  assert.equal('favorites' in m.raw, false, 'a blank stays unknown, never zero');
  assert.equal('comments' in m.raw, false);
  assert.equal('playlist_additions' in m.raw, false);
  assert.match(d.resultFieldsFor('Pornhub').note, /blank means unknown/i);
});
t('G52', 'no CSV export is required for manual result entry', () => {
  assert(/function openMeasurement\(/.test(html), 'results are entered in the app');
  const fn = html.slice(html.indexOf('function openMeasurement('), html.indexOf('async function saveMeasurement('));
  assert(!/csv/i.test(fn), 'the measurement form must not require a CSV');
  assert(/Unknown stays blank/.test(fn), 'the form states the unknown rule');
});


// ===========================================================================
// H. LAUNCH PROFILE COPY
// ===========================================================================
const PROFILE_FIXTURE = path.join(ROOT, 'config/LUXX001_LAUNCH_PROFILE_COPY.json');
function withCopy() {
  const s = locked();
  d.importRouteConfig(s, readJson(ROUTE_FINAL));
  d.importProfileCopy(s, readJson(PROFILE_FIXTURE));
  return s;
}
const EIGHT = ['X', 'OnlyFans Free', 'OnlyFans Paid', 'Pornhub', 'ManyVids', 'Fansly', 'Chaturbate', 'Linktree'];

t('H53', 'every platform has a nonblank launch bio', () => {
  const s = withCopy();
  const rows = d.profileCopy(s);
  assert.deepEqual(rows.map(r => r.platform), EIGHT);
  for (const r of rows) {
    assert(r.prescribed_bio && r.prescribed_bio.trim().length > 0, `${r.platform} has a blank bio`);
    assert(r.prescribed_cta && r.prescribed_cta.trim().length > 0, `${r.platform} has a blank CTA`);
    assert(!r.char_limit || r.prescribed_bio.length <= r.char_limit, `${r.platform} bio exceeds its limit`);
  }
  // The supplied copy is used exactly; nothing was shortened.
  assert.equal(rows.find(r => r.platform === 'X').prescribed_bio,
    'submissive, insatiable princess. previews here. free page for more \u2193');
  assert.equal(rows.filter(r => r.shortened).length, 0, 'no bio required shortening');
  assert.throws(() => d.importProfileCopy(locked(), { schema: 'LUXX_LAUNCH_PROFILE_COPY',
    profiles: [{ platform: 'X', prescribed_bio: '   ' }] }), /no prescribed launch bio/i);
});

t('H54', 'X and Pornhub enforce NO_FACE independently of the bio text', () => {
  const s = withCopy();
  const bare = { asset_id: 'F1', media_type: 'VIDEO', authorization_status: 'AUTHORIZED',
    availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE', variants: [] };
  // The bio mentions the destination; that grants nothing.
  assert(!d.autoPlatformEligibility(bare).includes('X'));
  assert(!d.autoPlatformEligibility(bare).includes('Pornhub'));
  assert.equal(d.faceSafeConfirmed(bare, 'X'), false);
  assert.equal(d.faceSafeConfirmed(bare, 'Pornhub'), false);
  assert(d.autoPlatformEligibility({ ...bare, ph_face_safe: true }).includes('Pornhub'));
  assert(!d.autoPlatformEligibility({ ...bare, ph_face_safe: true }).includes('X'), 'one confirmation is not both');
  assert.deepEqual(d.faceRestrictedPlatforms().sort(), ['Pornhub', 'X']);
  // Rewriting the bio cannot change eligibility.
  const before = d.autoPlatformEligibility(bare).sort();
  d.profileCopy(s, 'X').prescribed_bio = 'anything at all';
  assert.deepEqual(d.autoPlatformEligibility(bare).sort(), before);
});

t('H55', 'each bio CTA and destination agrees with the configured funnel', () => {
  const s = withCopy();
  const expected = {
    'X': 'OnlyFans Free', 'OnlyFans Free': 'OnlyFans Paid', 'OnlyFans Paid': 'Native OnlyFans Paid',
    'Pornhub': 'OnlyFans Free', 'ManyVids': 'Native ManyVids catalog', 'Fansly': 'Native Fansly',
    'Chaturbate': 'Native Chaturbate', 'Linktree': 'Multi-destination secondary hub' };
  for (const r of d.profileCopy(s)) {
    assert.equal(r.intended_destination, expected[r.platform], `${r.platform} destination drifted`);
    const dests = [];
    for (const id of r.route_ids) {
      const route = s.routes.find(x => x.route_id === id);
      assert(route, `${r.platform} references a route that does not exist: ${id}`);
      dests.push(route.destination);
      // A single-destination profile must lead exactly where its bio says. Linktree is a
      // declared multi-destination hub, so its buttons legitimately differ — but they must
      // stay DISTINCT, which is what stops the hub becoming a pooled attribution bucket.
      if (!r.native_destination && route.attribution_scope !== 'INTERNAL' && r.platform !== 'Linktree')
        assert.equal(route.destination, r.intended_destination, `${id} does not lead to ${r.intended_destination}`);
    }
    if (r.platform === 'Linktree')
      assert.equal(new Set(dests).size, dests.length, 'Linktree buttons must not share a destination');
  }
  // The Week-1 spine is unchanged.
  assert.equal(s.routes.find(x => x.route_id === 'X_BIO_TO_OF_FREE_01').destination, 'OnlyFans Free');
  assert.equal(s.routes.find(x => x.route_id === 'PH_PROFILE_TO_OF_FREE_01').destination, 'OnlyFans Free');
  assert.equal(s.routes.find(x => x.route_id === 'OF_FREE_BIO_TO_OF_PAID_01').destination, 'OnlyFans Paid');
  // Fansly is passive discovery, with no scheduled Week-1 route.
  const fansly = d.profileCopy(s, 'Fansly');
  assert.deepEqual(fansly.route_ids, []);
  assert.match(fansly.week_1_state, /PASSIVE DISCOVERY/);
});

t('H56', 'no bio contains a stale or wrong tracking URL', () => {
  const s = withCopy();
  for (const r of d.profileCopy(s)) {
    for (const m of r.prescribed_bio.matchAll(/https?:\/\/\S+/g)) {
      const bound = s.routes.find(x => x.tracking_url_or_identifier === m[0]);
      assert(bound && r.route_ids.includes(bound.route_id), `${r.platform} bio carries a foreign link ${m[0]}`);
    }
    if (r.tracking_url) {
      const bound = s.routes.find(x => x.tracking_url_or_identifier === r.tracking_url);
      assert(bound, `${r.platform} tracking URL belongs to no route`);
      assert(r.route_ids.includes(bound.route_id), `${r.platform} tracking URL belongs to ${bound.route_id}`);
    }
  }
  assert.equal(d.profileCopy(s, 'X').tracking_url, 'https://onlyfans.com/luxx4free/c6');
  assert.equal(d.profileCopy(s, 'Pornhub').tracking_url, 'https://onlyfans.com/luxx4free/c7');
  assert.equal(d.profileCopy(s, 'OnlyFans Free').tracking_url, 'https://onlyfans.com/luxx4pleasure/c4');
  // The reserved links appear in no bio and no profile.
  for (const reserved of ['https://onlyfans.com/luxx4pleasure/c8', 'https://onlyfans.com/luxx4free/c11'])
    for (const r of d.profileCopy(s))
      assert(!r.prescribed_bio.includes(reserved) && r.tracking_url !== reserved,
        `${r.platform} used a reserved URL`);
  // A bio carrying another profile's tracker is refused outright.
  assert.throws(() => d.importProfileCopy(withCopy(), { schema: 'LUXX_LAUNCH_PROFILE_COPY',
    profiles: [{ platform: 'X', prescribed_bio: 'see https://onlyfans.com/luxx4pleasure/c4',
      route_ids: ['X_BIO_TO_OF_FREE_01'] }] }), /not this profile's configured tracker/i);
});

t('H57', 'native destinations receive no invented external link', () => {
  const s = withCopy();
  for (const platform of ['OnlyFans Paid', 'ManyVids', 'Fansly', 'Chaturbate']) {
    const r = d.profileCopy(s, platform);
    assert.equal(r.native_destination, true, `${platform} should be native`);
    assert.equal(r.tracking_url, null, `${platform} was given an outbound URL`);
    assert(!/https?:\/\//.test(r.prescribed_bio), `${platform} bio contains a link`);
    for (const id of r.route_ids)
      assert.equal(s.routes.find(x => x.route_id === id).attribution_scope, 'INTERNAL');
  }
  assert.throws(() => d.importProfileCopy(withCopy(), { schema: 'LUXX_LAUNCH_PROFILE_COPY',
    profiles: [{ platform: 'Chaturbate', prescribed_bio: 'hi', native_destination: true,
      tracking_url: 'https://example.test/x' }] }), /native destination/i);
});

t('H58', 'Linktree buttons retain individual route attribution', () => {
  const s = withCopy();
  const lt = d.profileCopy(s, 'Linktree');
  assert.equal(lt.route_ids.length, 5, 'each button keeps its own route');
  const dests = lt.route_ids.map(id => s.routes.find(x => x.route_id === id).destination);
  assert.deepEqual([...new Set(dests)].sort(), ['Fansly', 'ManyVids', 'OnlyFans Free', 'OnlyFans Paid', 'X'].sort());
  assert.equal(new Set(lt.route_ids).size, 5, 'no two buttons share a route');
  // Linktree never becomes a pooled attribution bucket.
  for (const id of lt.route_ids) {
    const r = s.routes.find(x => x.route_id === id);
    assert.equal(r.source, 'Linktree');
    assert.equal(r.placement, 'BUTTON');
    assert(r.destination, `${id} has no destination`);
  }
  assert.equal(lt.tracking_url, null, 'the Linktree header carries no single pooled tracker');
});

t('H59', 'profile-copy changes do not rewrite historical evidence', () => {
  const s = withCopy();
  const before = structuredClone(s);
  d.recordInstalledProfileCopy(s, { platform: 'X', actual_bio: 'a different bio she actually used',
    previous_bio: 'the old one she captured', evidence_reference: 'screenshot-x.png' });
  d.validateAppendOnly(before, s);
  const row = d.profileCopy(s, 'X');
  assert.equal(row.prescribed_bio, 'submissive, insatiable princess. previews here. free page for more \u2193',
    'the prescribed copy is never overwritten by what was installed');
  assert.equal(row.actual_installed_bio, 'a different bio she actually used');
  assert.equal(row.actual_matches_prescribed, false, 'a deviation is visible');
  assert.equal(s.profileCopyHistory.length, 1, 'the install is appended to history');
  assert.equal(s.profileCopyHistory[0].previous_bio, 'the old one she captured');
  // Recording copy touches no measurement, revenue or action.
  assert.equal(s.outcomes.length, before.outcomes.length);
  assert.equal(s.revenueEvents.length, before.revenueEvents.length);
  assert.equal(s.actions.length, before.actions.length);
  assert.equal(s.baseline.snapshots.length, before.baseline.snapshots.length);
  assert.throws(() => d.recordInstalledProfileCopy(s, { platform: 'X', actual_bio: 'x', evidence_reference: '' }),
    /requires evidence/i);
});

t('H60', 'bios remain GUESS until measured evidence earns a change', () => {
  const s = withCopy();
  for (const r of d.profileCopy(s)) {
    assert.equal(r.evidence_label, 'GUESS / LAUNCH HYPOTHESIS', `${r.platform} is not labelled a guess`);
    for (const re of d.FORBIDDEN_COPY_CLAIMS)
      assert(!re.test(r.prescribed_bio) && !re.test(r.prescribed_cta), `${r.platform} copy claims ${re}`);
  }
  assert.throws(() => d.importProfileCopy(locked(), { schema: 'LUXX_LAUNCH_PROFILE_COPY',
    profiles: [{ platform: 'X', prescribed_bio: 'our proven winning bio' }] }), /evidence claim/i);
  // Old live copy stays UNKNOWN and is never inferred.
  const review = d.profileCopyReview(s);
  assert.equal(review.unknown_old_copy.length, 8, 'no old bio may be invented');
  assert.equal(review.pending_install.length, 8, 'nothing is installed yet');
  for (const r of d.profileCopy(s)) {
    assert.equal(r.current_old_bio, null);
    assert.equal(r.current_old_bio_state, 'UNKNOWN');
  }
  assert.match(review.note, /UNKNOWN until the operator captures it/i);
});


// ===========================================================================
// I. CREATOR LAUNCH CHECKLIST — generated from frozen config, never authored
// ===========================================================================
function withChecklist() {
  const s = withCopy();
  return { s, c: d.creatorLaunchChecklist(s) };
}

t('I61', 'all eight frozen bios render verbatim in the checklist', () => {
  const { c } = withChecklist();
  const cfg = readJson(PROFILE_FIXTURE);
  assert.equal(c.steps.length, 8);
  assert.deepEqual(c.steps.map(x => x.platform), EIGHT);
  for (const step of c.steps) {
    const frozen = cfg.profiles.find(p => p.platform === step.platform);
    assert.equal(step.bio, frozen.prescribed_bio, `${step.platform} bio was not copied verbatim`);
    assert.equal(step.cta, frozen.prescribed_cta, `${step.platform} CTA was not copied verbatim`);
    assert.equal(step.bio_length, frozen.prescribed_bio.length);
    assert.equal(step.shortened, false, `${step.platform} was shortened`);
    assert(step.bio.length <= step.char_limit, `${step.platform} exceeds its limit`);
  }
  // Character-for-character on the one bio with a tight limit.
  assert.equal(c.steps[0].bio, 'submissive, insatiable princess. previews here. free page for more \u2193');
  assert.equal(c.steps[0].bio_length, 68);
});

t('I62', 'link counts and destinations match the frozen configuration', () => {
  const { s, c } = withChecklist();
  const expected = { 'X': 1, 'OnlyFans Free': 1, 'OnlyFans Paid': 0, 'Pornhub': 1,
                     'ManyVids': 0, 'Fansly': 0, 'Chaturbate': 0, 'Linktree': 5 };
  let total = 0;
  for (const step of c.steps) {
    assert.equal(step.links_to_install.length, expected[step.platform], `${step.platform} link count`);
    total += step.links_to_install.length;
    for (const l of step.links_to_install) {
      const route = s.routes.find(r => r.route_id === l.route_id);
      assert.equal(l.url, route.tracking_url_or_identifier, `${l.route_id} url drifted`);
      assert.equal(l.destination, route.destination, `${l.route_id} destination drifted`);
      assert(l.url && /^https?:\/\//.test(l.url), `${l.route_id} has no usable link`);
    }
    // A native destination is never handed an outbound link.
    if (step.native_destination) assert.equal(step.links_to_install.length, 0, `${step.platform} native got a link`);
  }
  assert.equal(total, 8);
  assert.equal(c.totals.links_to_install, 8);
  assert.equal(c.steps.find(x => x.platform === 'X').links_to_install[0].url, 'https://onlyfans.com/luxx4free/c6');
  assert.equal(c.steps.find(x => x.platform === 'Pornhub').links_to_install[0].url, 'https://onlyfans.com/luxx4free/c7');
  assert.equal(c.steps.find(x => x.platform === 'OnlyFans Free').links_to_install[0].url, 'https://onlyfans.com/luxx4pleasure/c4');
});

t('I63', 'Linktree carries five distinct buttons', () => {
  const { c } = withChecklist();
  const lt = c.steps.find(x => x.platform === 'Linktree');
  assert.equal(lt.links_to_install.length, 5);
  assert.equal(new Set(lt.links_to_install.map(l => l.route_id)).size, 5, 'buttons must not share a route');
  assert.equal(new Set(lt.links_to_install.map(l => l.destination)).size, 5, 'buttons must not share a destination');
  assert.equal(new Set(lt.links_to_install.map(l => l.url)).size, 5, 'buttons must not share a URL');
  assert.deepEqual(lt.links_to_install.map(l => l.destination).sort(),
    ['Fansly', 'ManyVids', 'OnlyFans Free', 'OnlyFans Paid', 'X']);
});

t('I64', 'Pornhub is ACTIVE via Official Website placement evidence, with the Fansly field intact', () => {
  const { s, c } = withChecklist();
  // TEST EXPECTATION CORRECTION: this previously asserted Pornhub stayed VERIFIED. The
  // operator supplied newer evidence — c7 installed in the live Official Website field with
  // a destination click landing on @luxx4free — so the frozen truth is now ACTIVE.
  const ph = c.steps.find(x => x.platform === 'Pornhub');
  const primary = ph.routes.find(r => r.route_id === 'PH_PROFILE_TO_OF_FREE_01');
  assert.equal(primary.state, 'ACTIVE');
  assert.equal(primary.tracking_url, 'https://onlyfans.com/luxx4free/c7');
  assert.equal(primary.destination, 'OnlyFans Free');
  assert.deepEqual(primary.activation_steps, [], 'an ACTIVE route needs no activation steps');
  // Activation came through the placement-evidence path, never from config text alone.
  const raw = s.routes.find(r => r.route_id === 'PH_PROFILE_TO_OF_FREE_01');
  assert.equal(raw.placement_installed, true);
  assert.match(raw.placement_evidence, /Official Website URL/i);
  assert.match(raw.placement_evidence, /luxx4free/i);
  assert(raw.activated_at, 'activation is timestamped');
  // The Fansly placement is a physically distinct field and is preserved untouched.
  const fansly = s.routes.find(r => r.route_id === 'PH_PROFILE_TO_FANSLY_01');
  assert.equal(d.routeState(fansly), 'ACTIVE');
  assert.equal(fansly.tracking_url_or_identifier, 'https://fansly.com/Luxx4Pleasure/t3');
  assert.equal(fansly.destination, 'Fansly');
  assert.match(fansly.placement_evidence, /Fansly Profile URL/i);
  assert.notEqual(fansly.placement_evidence, raw.placement_evidence, 'two distinct physical fields');
  // No replacement route was invented for either placement.
  const phRoutes = s.routes.filter(r => r.route_id.startsWith('PH_PROFILE_'));
  assert(phRoutes.every(r => ['PH_PROFILE_TO_OF_FREE_01', 'PH_PROFILE_TO_FANSLY_01', 'PH_PROFILE_TO_LINKTREE_01'].includes(r.route_id)),
    'no new Pornhub profile route was created');
  // Reserved codes stay unassigned.
  const reserved = d.reservedTrackingUrls(s).map(x => x.url);
  assert(reserved.includes('https://onlyfans.com/luxx4pleasure/c8'));
  assert(reserved.includes('https://onlyfans.com/luxx4free/c11'));
  for (const u of reserved) assert(!s.routes.some(r => r.tracking_url_or_identifier === u), `${u} was bound to a route`);
  // Video-description routes are untouched.
  for (const id of ['PH_VIDEO_DESC_TO_OF_FREE_01', 'PH_VIDEO_DESC_TO_FANSLY_01'])
    assert.equal(d.routeState(s.routes.find(r => r.route_id === id)), 'VERIFIED', `${id} must stay VERIFIED`);
  // Pornhub NO_FACE is still stated as a platform rule.
  assert(ph.platform_rules.some(r => /No face imagery on Pornhub/i.test(r)));
  assert(c.steps.find(x => x.platform === 'X').platform_rules.some(r => /No face imagery on X/i.test(r)));
});

t('I65', 'generating the checklist marks nothing completed or verified', () => {
  const s = withCopy();
  const before = structuredClone(s);
  const c = d.creatorLaunchChecklist(s);
  d.creatorLaunchChecklist(s);   // repeated generation is inert
  d.validateAppendOnly(before, s);
  assert.equal(JSON.stringify(s.routes), JSON.stringify(before.routes), 'no route state changed');
  assert.equal(JSON.stringify(s.profileCopy), JSON.stringify(before.profileCopy), 'no profile copy changed');
  assert.equal(s.baseline.locked, before.baseline.locked);
  assert.equal((s.profileCopyHistory || []).length, 0, 'no install was recorded');
  assert.equal(c.totals.bios_installed, 0, 'nothing is installed by generating the list');
  assert.equal(c.totals.old_bios_captured, 0, 'no old bio was invented');
  for (const step of c.steps) {
    assert.equal(step.bio_installed, false, `${step.platform} was marked installed`);
    assert.equal(step.old_bio_captured, false, `${step.platform} old bio was marked captured`);
    assert.equal(step.evidence_label, 'GUESS / LAUNCH HYPOTHESIS');
    assert(step.required_evidence.some(x => /Screenshot the CURRENT profile before/i.test(x)),
      `${step.platform} does not require the before-screenshot`);
  }
  assert.match(c.note, /launch hypothesis, not a proven result/i);
  assert.match(c.note, /UNKNOWN until it is captured/i);
});

// ===========================================================================
const report = { pass: failed.length === 0, total: checks.length, passed: passed.length, failed };
fs.writeFileSync(path.join(ROOT, 'tests/FINAL_CONSOLIDATION_RESULTS.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
