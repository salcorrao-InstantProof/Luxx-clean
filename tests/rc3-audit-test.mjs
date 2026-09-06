// LUXX v1.7.0 RC3 — ZERO-SURPRISE RELEASE AUDIT, PART 1 REGRESSIONS
//
// One check per confirmed defect from the audit ledger. Each asserts the FIXED
// behaviour and, where the defect was a silent one, asserts that the specific broken
// shape cannot come back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const d = await import('../netlify/lib/domain.mjs');
const v = await import('../netlify/lib/video.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const checks = [], passed = [], failed = [];
function t(name, fn) {
  try { fn(); passed.push(name); console.log('PASS', name); }
  catch (e) { failed.push({ name, error: String((e && e.message) || e) }); console.log('FAIL', name, '-', (e && e.message)); }
  checks.push(name);
}

const img = (id, extra = {}) => ({
  asset_id: id, name: id + '.jpg', media_type: 'IMAGE', authorization_status: 'AUTHORIZED',
  availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE', platform_eligibility: [],
  variants: [{ variant_id: id + '-SAFE', asset_id: id, variant_type: 'PRIVACY_SAFE_EXPORT',
               rendered: true, privacy_safe_export: true, metadata_stripped: true }], ...extra
});
function ready() {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  return s;
}
const DAY = { MON: '2026-09-07', TUE: '2026-09-08', WED: '2026-09-09', THU: '2026-09-10',
              FRI: '2026-09-11', SAT: '2026-09-12', SUN: '2026-09-13' };
const at = (c) => `${DAY[c]}T15:00:00Z`;
function verify(s, id) {
  d.updateRoute(s, id, { tracking_url_or_identifier: 'https://t.example/' + id, destination_confirmed: true,
    test_performed: 'opened and confirmed destination', verification_evidence: 'screenshot',
    verification_status: 'VERIFIED' });
  // VERIFIED proves the link lands; only a confirmed live placement makes it ACTIVE and
  // therefore usable by a job. These checks are about job selection, so they install it.
  d.confirmRoutePlacement(s, id, { placement_evidence: 'test: link installed in the live placement' });
}

// ---------------------------------------------------------------------------
// D-01 BLOCKER — CAPTURE BASELINE destroyed the reviewed numbers
// ---------------------------------------------------------------------------
t('D-01 CAPTURE BASELINE promotes the reviewed snapshots instead of erasing them', () => {
  const s = d.seedState();
  d.importBaseline(s, { rows: [
    { platform: 'X', metric: 'followers', value: 36, evidence_reference: 'x.png' },
    { platform: 'Chaturbate', metric: 'followers', value: 1343, evidence_reference: 'cb.png' },
    { platform: 'OnlyFans Paid', metric: 'revenue_last_30_days', value: 'NOT_AVAILABLE', evidence_reference: 'ofp.png', notes: 'not exposed' }
  ]});
  assert.equal(s.baseline.snapshots.length, 3);
  // Exactly what the UI sends: no snapshots argument at all.
  d.captureBaseline(s, { evidence_reference: 'launch-day screenshots', inventory_mapping_reference: 'library map' });
  assert.equal(s.baseline.snapshots.length, 3, 'capture must not wipe the reviewed snapshots');
  const x = s.baseline.snapshots.find(v => v.platform === 'X');
  assert.equal(x.metrics.followers, 36, 'the exact imported value survives capture');
  assert.equal(x.evidence_reference, 'x.png', 'evidence references survive capture');
  assert.equal(x.review_state, 'REVIEWED_AND_CAPTURED');
  const ofp = s.baseline.snapshots.find(v => v.platform === 'OnlyFans Paid');
  assert(ofp.not_available.includes('revenue_last_30_days'), 'NOT AVAILABLE survives capture');
  assert.equal(ofp.metrics.revenue_last_30_days, undefined, 'and is still never a zero');
  d.lockBaseline(s);
  assert.equal(s.baseline.snapshots.length, 3, 'the locked baseline carries the real numbers');
  assert.deepEqual(d.baselineCoverage(s).captured.sort(), ['Chaturbate', 'OnlyFans Paid', 'X']);
  const captured = s.auditEvents.filter(e => e.event_type === 'BASELINE_CAPTURED')[0];
  assert.equal(captured.data.snapshot_count, 3, 'the audit records what was actually captured');
  // Passing an explicit list still replaces, so a deliberate correction is still possible.
  const s2 = d.seedState();
  d.importBaseline(s2, { rows: [{ platform: 'X', metric: 'followers', value: 1 }] });
  d.captureBaseline(s2, { evidence_reference: 'e', inventory_mapping_reference: 'i', snapshots: [] });
  assert.equal(s2.baseline.snapshots.length, 0, 'an explicit empty list is still honoured');
});

// ---------------------------------------------------------------------------
// D-02 MAJOR — a wall post is not a locked PPV post
// ---------------------------------------------------------------------------
t('D-02 an OnlyFans Free wall job is never served by the locked-PPV post route', () => {
  const s = ready();
  const assets = [img('IMG-A'), img('IMG-B')];
  for (const code of ['TUE', 'THU']) {
    const line = d.buildTodayPlan(s, assets, { date: at(code) }).lines.find(l => l.job === 'MONETIZE');
    assert.notEqual(line.route_id, 'OF_FREE_POST_PPV_01', `${code}: a wall job took the locked PPV post route`);
    assert.notEqual(line.route_id, 'OF_FREE_MESSAGE_PPV_01', `${code}: a wall job took the PPV DM route`);
  }
  const feed = s.routes.find(r => r.route_id === 'OF_FREE_POST_PPV_01');
  const job = { platform: 'OnlyFans Free', intent: 'OF_WALL_VALUE' };
  const fake = { platform: 'OnlyFans Free', route: feed, asset: { asset_id: 'X' }, variant: null };
  assert.equal(d.candidateFitsJob(s, fake, job), false, 'PPV_LOCKED_POST must not satisfy a wall job');
  // Once the intended placement is verified, the wall job runs on it.
  verify(s, 'OF_FREE_POST_TO_OF_PAID_01');
  const line = d.buildTodayPlan(s, assets, { date: at('TUE') }).lines.find(l => l.job === 'MONETIZE');
  assert.equal(line.kind, 'ACTION');
  assert.equal(line.route_id, 'OF_FREE_POST_TO_OF_PAID_01');
});

// ---------------------------------------------------------------------------
// D-03 MAJOR — one destination's unverified route blocked assets ready elsewhere
// ---------------------------------------------------------------------------
t('D-03 an OF Paid ready asset is not blocked by an unrelated OF Free route', () => {
  const s = ready();
  const a = img('IMG-P');
  const plan = d.recommendAssetUse(s, a);
  assert(plan.ready_destinations.includes('OnlyFans Paid'), 'OF Paid has a usable native route at seed');
  for (const b of plan.blockers) {
    assert(!b.includes('OF_FREE_POST_TO_OF_PAID_01'),
      'the OF Free -> OF Paid route must never be reported as gating an OF Paid job');
  }
  // The OF Paid native wall job runs on its own route.
  const line = d.buildTodayPlan(s, [a], { date: at('MON') }).lines.find(l => l.intent === 'OF_PAID_WALL');
  assert.equal(line.kind, 'ACTION');
  assert.equal(line.route_id, 'OF_PAID_FEED_01');
  // With nothing usable anywhere, the blocker names every eligible destination honestly.
  const s2 = ready();
  for (const r of s2.routes) { r.verification_status = 'UNVERIFIED'; r.active_status = 'INACTIVE'; }
  const p2 = d.recommendAssetUse(s2, img('IMG-Q'));
  assert.deepEqual(p2.ready_destinations, []);
  assert(p2.blockers.some(x => /No verified route yet for/.test(x)));
});

// ---------------------------------------------------------------------------
// §8 / §22 — every audited job maps to its own route, and only its own
// ---------------------------------------------------------------------------
t('§22 every Week-1 job resolves to the route the funnel says it should', () => {
  const expected = {
    OF_PAID_WALL: 'OF_PAID_FEED_01',
    OF_LIGHT_SUPPORT: 'OF_PAID_FEED_01',
    PPV_DM: 'OF_PAID_PPV_MESSAGE_01',
    PPV_BUNDLE: 'OF_PAID_PPV_MESSAGE_01',
    OF_WALL_REENGAGE: 'OF_FREE_POST_TO_OF_PAID_01',
    OF_WALL_VALUE: 'OF_FREE_POST_TO_OF_PAID_01',
    X_TEASER: 'X_POST_TO_OF_FREE_01',
    ONE_DISCOVERY: 'X_POST_TO_OF_FREE_01',
    PH_TEASER: 'PH_VIDEO_DESC_TO_OF_FREE_01'
  };
  const s = ready();
  for (const id of ['X_POST_TO_OF_FREE_01', 'PH_VIDEO_DESC_TO_OF_FREE_01', 'OF_FREE_POST_TO_OF_PAID_01']) verify(s, id);
  const seen = new Set();
  for (const code of Object.keys(DAY)) {
    for (const job of d.scheduleForDay(code)) {
      const rs = d.jobRouteStatus(s, job);
      assert.equal(rs.route && rs.route.route_id, expected[job.intent],
        `${code} ${job.intent}: resolved ${rs.route && rs.route.route_id}, expected ${expected[job.intent]}`);
      seen.add(job.intent);
      // No unrelated destination may appear among the routes that gate this job.
      const dest = d.intendedDestinationFor(job);
      if (dest) for (const rid of rs.candidates) {
        assert.equal(s.routes.find(r => r.route_id === rid).destination, dest,
          `${job.intent}: ${rid} is not on the intended funnel leg`);
      }
    }
  }
  assert(seen.size >= 8, 'every scheduled intent was audited');
});

// ---------------------------------------------------------------------------
// D-04 / §6 — specific HOLD states with the correct recovery action
// ---------------------------------------------------------------------------
t('§6 HOLD names the real reason and sends the creator to the right place', () => {
  const job = { job: 'MONETIZE', intent: 'OF_PAID_WALL', platform: 'OnlyFans Paid', label: 'wall' };
  // baseline not locked
  const s0 = d.seedState();
  let h = d.diagnoseJobHold(s0, [img('A')], job);
  assert.equal(h.hold_code, 'BASELINE_NOT_LOCKED');
  assert.equal(h.hold_label, 'HOLD — BASELINE NOT LOCKED');
  assert.equal(h.recovery, 'FIX SETUP');
  // paid feed route not ready
  const s1 = ready();
  const feed = s1.routes.find(r => r.route_id === 'OF_PAID_FEED_01');
  feed.verification_status = 'UNVERIFIED'; feed.active_status = 'INACTIVE';
  h = d.diagnoseJobHold(s1, [img('A')], job);
  assert.equal(h.hold_code, 'PAID_FEED_ROUTE_NOT_READY');
  assert.equal(h.hold_label, 'HOLD — OF PAID FEED ROUTE NOT READY');
  assert.equal(h.recovery, 'FIX SETUP');
  assert.deepEqual(h.route_ids, ['OF_PAID_FEED_01']);
  // authorization
  const s2 = ready();
  h = d.diagnoseJobHold(s2, [img('A', { authorization_status: 'UNCLEAR' })], job);
  assert.equal(h.hold_code, 'AUTHORIZATION_REQUIRED');
  assert.equal(h.recovery, 'FIX LIBRARY');
  // privacy-safe derivative
  const s3 = ready();
  const noSafe = img('A'); noSafe.variants = [{ variant_id: 'V', asset_id: 'A', variant_type: 'RAW', rendered: true }];
  h = d.diagnoseJobHold(s3, [noSafe], job);
  assert.equal(h.hold_code, 'PRIVACY_SAFE_NOT_READY');
  assert.equal(h.hold_label, 'HOLD — PRIVACY-SAFE VERSION NOT READY');
  // video still processing
  const s4 = ready();
  const proc = { ...img('V1'), media_type: 'VIDEO', status: 'PROCESSING', platform_eligibility: ['OnlyFans Paid'] };
  h = d.diagnoseJobHold(s4, [proc], job);
  assert.equal(h.hold_code, 'PROCESSING_INCOMPLETE');
  // PH teaser
  const s5 = ready(); verify(s5, 'PH_VIDEO_DESC_TO_OF_FREE_01');
  const phJob = { job: 'ACQUIRE', intent: 'PH_TEASER', platform: 'Pornhub', label: 'teaser' };
  const full = { ...img('V2'), media_type: 'VIDEO', status: 'READY_FOR_REVIEW', platform_eligibility: ['Pornhub'] };
  h = d.diagnoseJobHold(s5, [full], phJob);
  assert.equal(h.hold_code, 'PH_TEASER_REQUIRED');
  assert.equal(h.hold_label, 'HOLD — PH TEASER REQUIRED');
  assert.equal(h.recovery, 'FIX LIBRARY');
  // no qualifying media at all
  const s6 = ready();
  h = d.diagnoseJobHold(s6, [], job);
  assert.equal(h.hold_code, 'NO_QUALIFYING_MEDIA');
  // Nothing anywhere may still emit the RC2A generic string.
  const s7 = ready();
  for (const code of Object.keys(DAY)) {
    for (const l of d.buildTodayPlan(s7, [img('A')], { date: at(code) }).lines) {
      if (l.kind !== 'BLOCKED') continue;
      assert(d.HOLD_CODES.includes(l.hold_code), `${code}: unknown hold code ${l.hold_code}`);
      assert(!/nothing eligible for this job/i.test(l.why), `${code}: generic hold text is back`);
      assert(['FIX SETUP', 'FIX LIBRARY', 'CAM AVAILABILITY'].includes(l.recovery));
    }
  }
});

// ---------------------------------------------------------------------------
// §7 — LIBRARY repair is job-aware
// ---------------------------------------------------------------------------
t('§7 opening LIBRARY from a HOLD carries the exact job context', () => {
  const s = ready(); verify(s, 'PH_VIDEO_DESC_TO_OF_FREE_01');
  const full = { ...img('V2'), media_type: 'VIDEO', status: 'READY_FOR_REVIEW', platform_eligibility: ['Pornhub'],
    variants: [{ variant_id: 'FULL-MASTER', asset_id: 'V2', variant_type: 'FULL_MASTER', rendered: true,
                 privacy_safe_export: true, metadata_stripped: true }] };
  const line = d.buildTodayPlan(s, [full], { date: at('WED') }).lines.find(l => l.intent === 'PH_TEASER');
  const ctx = line.repair_context;
  assert.equal(ctx.intent, 'PH_TEASER');
  assert.equal(ctx.platform, 'Pornhub');
  assert.deepEqual(ctx.permitted_media_types, ['VIDEO'], 'a Pornhub teaser job is not a photo job');
  assert.equal(ctx.requires_derivative, 'TEASER_OR_TRAILER');
  assert.equal(ctx.hold_code, 'PH_TEASER_REQUIRED');
  assert(ctx.route_ids.includes('PH_VIDEO_DESC_TO_OF_FREE_01'));
  assert(ctx.rejection_reasons.length > 0);
  // A PPV job is not automatically a video job.
  const ppv = d.buildTodayPlan(ready(), [], { date: at('SAT') }).lines.find(l => l.intent === 'PPV_DM');
  assert.deepEqual(ppv.repair_context.permitted_media_types, ['IMAGE', 'VIDEO'],
    'generic PPV must not mean video only');
});

// ---------------------------------------------------------------------------
// D-05 / §9 — X face workflow is a review state, never a discard
// ---------------------------------------------------------------------------
t('§9 X is NEEDS X CROP / REVIEW, and the master stays usable everywhere else', () => {
  const s = ready();
  for (const id of ['X_POST_TO_OF_FREE_01', 'X_PINNED_TO_OF_FREE_01', 'X_BIO_TO_OF_FREE_01']) verify(s, id);
  const a = img('IMG-FACE');                       // no face review yet
  const xJob = { job: 'ACQUIRE', intent: 'X_TEASER', platform: 'X', label: 'X teaser' };
  const h = d.diagnoseJobHold(s, [a], xJob);
  assert.equal(h.hold_code, 'NEEDS_X_CROP_REVIEW');
  assert.equal(h.hold_label, 'NEEDS X CROP / REVIEW');
  assert.equal(h.recovery, 'FIX LIBRARY');
  assert(h.x_review_candidates.includes('IMG-FACE'), 'the reviewable asset is named');
  assert(!/discard|unusable|reject/i.test(h.why), 'the asset is not described as unusable');
  // The master is untouched and still eligible elsewhere.
  assert.deepEqual(d.autoPlatformEligibility(a), ['OnlyFans Free', 'OnlyFans Paid', 'Fansly']);
  assert(d.recommendAssetUse(s, a).blockers.some(x => x.includes('NEEDS X CROP / REVIEW')));
  // Nothing auto-approves X. Only an explicit human confirmation adds it.
  assert(!d.autoPlatformEligibility(a).includes('X'));
  const reviewed = img('IMG-OK', { x_face_safe: true });
  assert(d.autoPlatformEligibility(reviewed).includes('X'), 'a confirmed face-safe version becomes X eligible');
  // Two assets: MON has both a paid-wall job and an X job, and one asset cannot serve both.
  assert.equal(d.buildTodayPlan(s, [reviewed, img('IMG-OK2', { x_face_safe: true })], { date: at('MON') })
    .lines.find(l => l.platform === 'X').kind, 'ACTION');
  // No invented face-detection confidence anywhere.
  const src = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');
  assert(!/face_confidence|face_score|faceDetect/i.test(src + html), 'no fake face-detection confidence');
});

// ---------------------------------------------------------------------------
// D-06 / §12 / §15 — the full upload is the master
// ---------------------------------------------------------------------------
t('§12 the full upload is the master at every duration; no automatic 5-minute cut', () => {
  const analysis = { sceneTimes: [10, 60, 120, 240, 300, 400], bad: [], silence: [] };
  for (const dur of [45, 420, 451, 900, 1800, 3600]) {
    const plan = v.choosePlan(dur, analysis);
    assert.equal(plan.full_master.duration, dur, `${dur}s source was truncated`);
    assert.equal(plan.full_master.start, 0);
    assert.equal(plan.master_is_full_source, true);
    assert.notEqual(plan.full_master.duration, 300, `${dur}s source produced a 5-minute master`);
    assert(plan.teasers.length >= 1, 'short derivatives still exist for the jobs that need them');
    for (const te of plan.teasers) {
      assert(te.start >= 0 && te.start + te.duration <= dur + 0.001);
      assert(te.duration <= 20, 'a teaser stays short');
    }
  }
  // No fixed-duration assumption survives in the video pipeline.
  const vs = fs.readFileSync(path.join(ROOT, 'netlify/lib/video.mjs'), 'utf8');
  const exec = vs.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert(!/mainLen\s*=\s*duration>=360\?300/.test(exec), 'the 300-second rule is back');
  assert(!/\b451\b/.test(exec), 'a fixed 451-second assumption is back');
  // A legacy MAIN_CUT is still refused as a teaser and is never called the master.
  assert.equal(d.isTeaserDerivative({ variant_type: 'MAIN_CUT' }), false);
  assert.equal(d.isTeaserDerivative({ variant_type: 'FULL_MASTER' }), false);
  assert.equal(d.isTeaserDerivative({ variant_id: 'FULL-MASTER', variant_type: 'TEASER' }), true);
  assert(/LEGACY MAIN CUT — NOT THE MASTER/.test(html), 'a legacy main cut is labelled as not the master');
});

// ---------------------------------------------------------------------------
// D-08 / D-09 / §13 / §14 — video preview and actions
// ---------------------------------------------------------------------------
t('§13/§14 VIEW shows a real poster and PLAY, and download is optional', () => {
  assert(/function playVideo\(/.test(html), 'PLAY is its own step');
  assert(/id="vposter"/.test(html), 'a poster frame is rendered before playback');
  assert(!/<video controls playsinline style="width:100%;max-height:65vh;background:#000" src="\/api\/hls/.test(html),
    'the bare unplayable HLS element is gone');
  assert(/Playback failed/.test(html), 'playback errors are reported truthfully');
  assert(!/autoplay/i.test(html), 'nothing autoplays to hide a broken player');
  assert(/function derivativeKind\(/.test(html));
  for (const kind of ['FULL MASTER', 'TEASER', 'TRAILER', 'EDIT', 'OTHER DERIVATIVE']) {
    assert(html.includes(`'${kind}'`) || html.includes(`>${kind}<`) || html.includes(kind),
      `derivative kind not identified: ${kind}`);
  }
  assert(/DOWNLOAD \(OPTIONAL\)/.test(html), 'download is presented as optional');
  assert(/Downloading is optional/.test(html));
});

// ---------------------------------------------------------------------------
// D-10 / §20 — a bad file cannot kill the batch
// ---------------------------------------------------------------------------
t('§20 bulk upload isolates each file, retries once and reports failures', () => {
  const fn = html.slice(html.indexOf('async function uploadSelected()'), html.indexOf('function openAsset(id)'));
  assert(/for\s*\(let attempt=1;attempt<=2/.test(fn), 'each file gets one retry');
  assert(/catch\(e\)\{/.test(fn), 'a failing file is caught rather than ending the batch');
  assert(/failed\.push\(/.test(fn), 'the failed file is identified');
  assert(/File \$\{fi\+1\} of \$\{files\.length\}/.test(fn), 'the current file is visible');
  assert(/saved · \$\{failed\.length\} failed/.test(fn), 'progress reflects real state');
  assert(/await load\(\)/.test(fn), 'completed files persist and appear incrementally');
  assert(/Batch finished/.test(fn), 'the batch always terminates with a summary');
  assert(/duplicates\+\+/.test(fn), 'an exact duplicate is skipped, not retried forever');
  // The old shape: a single un-guarded loop with no per-file recovery.
  assert(!/for\(let i=0;i<parts;i\+\+\)\{prog\.textContent=`\$\{f\.name\}: uploading/.test(html),
    'the un-guarded RC2A upload loop is gone');
});

// ---------------------------------------------------------------------------
// D-11 / §18 — history-protected delete UX
// ---------------------------------------------------------------------------
t('§18 a history-protected asset offers MARK UNAVAILABLE, not a delete that must fail', () => {
  assert(/function historyProtectedHtml\(/.test(html));
  assert(/function historyReferences\(/.test(html));
  assert(/HISTORY-PROTECTED/.test(html));
  assert(/MARK UNAVAILABLE/.test(html));
  assert(/async function markUnavailable\(/.test(html));
  assert(/availability:'UNAVAILABLE'/.test(html), 'the action really sets unavailable');
  assert(/never erases anything with history/.test(html), 'the reason is explained');
  // A normal DELETE DUPLICATE is still offered for a genuinely unused duplicate.
  const fn = html.slice(html.indexOf('function historyProtectedHtml('), html.indexOf('async function markUnavailable('));
  assert(/if\(!refs\.length\)return `<button class="danger" onclick="deleteUnusedAsset/.test(fn),
    'unused duplicates keep the safe delete');
  for (const ref of ['historicalPublications', 'prescriptions', 'actions', 'use_count'])
    assert(html.includes(ref), `history reference not considered: ${ref}`);
});

// ---------------------------------------------------------------------------
// D-12 / §10 — compact overlays
// ---------------------------------------------------------------------------
t('§10 the orientation badge is a compact one-line chip', () => {
  assert(html.includes('✓ ORIENTATION OK'), 'the compact label is used');
  assert(!html.includes('✓ ORIENTATION VERIFIED'), 'the oversized label is gone');
  const css = html.slice(html.indexOf('.optimizedBadge{'), html.indexOf('}', html.indexOf('.optimizedBadge{')));
  assert(/top:6px;left:6px/.test(css), 'upper-left with minimal offset');
  assert(/font-size:9px/.test(css), 'small text');
  assert(/padding:1px 5px/.test(css), 'minimal padding');
  assert(/white-space:nowrap/.test(css), 'single line');
  assert(/max-width:60%/.test(css), 'it cannot materially cover the image');
  assert(!/box-shadow/.test(css));
  // Other overlays were audited to the same standard.
  for (const sel of ['.recommendedBadge{', '.cropChip{']) {
    const c = html.slice(html.indexOf(sel), html.indexOf('}', html.indexOf(sel)));
    assert(/font-size:9px/.test(c) && /white-space:nowrap/.test(c), `${sel} is still oversized`);
  }
});

// ---------------------------------------------------------------------------
// D-13 / §3 — no dead controls, no duplicate ids, every handler reachable
// ---------------------------------------------------------------------------
t('§3 every control resolves, nothing is dead, no duplicate ids', () => {
  for (const dead of ['makeRx', 'openQuickChange', 'quickDecline', 'privacyHtml'])
    assert(!html.includes(dead + '('), `dead control still present: ${dead}`);
  const defs = new Set([...html.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  const refs = new Set([...html.matchAll(/on(?:click|change|input)=["'][^"']*?([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  assert.deepEqual([...refs].filter(r => !defs.has(r)), [], 'inline handler with no definition');
  const ids = [...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
  const counts = {}; ids.forEach(i => counts[i] = (counts[i] || 0) + 1);
  assert.deepEqual(Object.entries(counts).filter(([, n]) => n > 1), [], 'duplicate element ids');
  for (const bound of ['loginBtn', 'setupBtn', 'roleBtn'])
    assert(html.includes(`id="${bound}"`), `listener bound to a missing element: ${bound}`);
  const nav = html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)[1];
  assert.equal((nav.match(/data-view=/g) || []).length, 3, 'primary navigation must stay at three tabs');
});

// ---------------------------------------------------------------------------
// §4 — state machines have no dead or impossible states
// ---------------------------------------------------------------------------
t('§4 the audited state machines still move end to end', () => {
  // BASELINE: imported -> reviewed -> captured -> locked
  const s = d.seedState();
  d.importBaseline(s, { rows: [{ platform: 'X', metric: 'followers', value: 36, evidence_reference: 'x' }] });
  assert.equal(d.baselineReview(s).pending_review, 1);
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  assert.equal(s.baseline.captured, true);
  d.lockBaseline(s);
  assert.throws(() => d.importBaseline(s, { rows: [{ platform: 'X', metric: 'followers', value: 1 }] }), /already locked/i);

  // ROUTE: not configured -> configured -> verified -> active
  const r = s.routes.find(x => x.route_id === 'X_POST_TO_OF_FREE_01');
  assert.equal(r.verification_status, 'UNVERIFIED');
  assert.throws(() => d.updateRoute(s, r.route_id, { verification_status: 'VERIFIED' }), /requires identifier/);
  verify(s, r.route_id);
  assert.equal(r.active_status, 'ACTIVE');
  d.updateRoute(s, r.route_id, { verification_status: 'UNVERIFIED' });
  assert.equal(r.active_status, 'INACTIVE', 'a route can be taken back out of service');

  // PRESCRIPTION: proposed -> selected -> revised -> approved -> executed -> measured -> corrected
  const s2 = ready();
  const assets = [img('IMG-S')];
  const rec = d.generateRecommendation(s2, assets);
  const rx = d.createPrescriptionForPick(s2, rec, { asset_id: 'IMG-S', variant_id: 'IMG-S-SAFE',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'OF_PAID_WALL' });
  const sel = d.selectPrescriptionCta(s2, { prescription_id: rx.prescription_id, cta_index: 1 });
  assert.equal(s2.prescriptions.find(x => x.prescription_id === rx.prescription_id).status, 'REVISED');
  const act = d.approvePrescription(s2, sel.prescription_id, assets);
  d.executeAction(s2, act.action_id, { execution_reference: 'ref', creator_effort_minutes: 5 });
  const out = s2.outcomes.find(o => o.action_id === act.action_id);
  d.recordMeasurement(s2, out.outcome_id, { views: 10 });
  d.correctMeasurement(s2, out.outcome_id, { reason: 'corrected', raw: { views: 12 } });
  assert.equal(s2.measurementCorrections.length, 1);
  assert.equal(s2.outcomes.find(o => o.outcome_id === out.outcome_id).raw.views, 12);

  // CAM: not configured -> configured -> executed
  const s3 = ready();
  assert.equal(d.camAvailability(s3).configured, false);
  d.setCamAvailability(s3, { days: ['TUE', 'FRI'], earliest_start: '09:00', latest_end: '13:00', timezone: 'America/Chicago' });
  const cam = d.recordCamSession(s3, { started_at: '2026-09-11T09:05', ended_at: '2026-09-11T12:10', effort_minutes: 185 });
  assert.equal(cam.day_code, 'FRI');
  assert.equal(cam.outside_configured_availability, false);

  // HISTORICAL: normal -> referenced -> history-protected
  const s4 = ready();
  const h = d.createHistoricalPublication(s4, { asset_id: 'IMG-S', platform: 'Pornhub', external_reference: 'ref' });
  assert.equal(h.status, 'HISTORICAL_BASELINE');
  d.setHistoricalReview(s4, { historical_publication_id: h.historical_publication_id, review_status: 'KEEP' });
  assert.equal(s4.historicalPublications[0].review_status, 'KEEP');
});

// ---------------------------------------------------------------------------
// §11 / §23 — the contracts that must NOT change
// ---------------------------------------------------------------------------
t('§11/§23 technical score and the PPV evidence contract are unchanged', () => {
  const s = ready();
  const rec = d.generateRecommendation(s, [img('LOW', { visual_score: { score: 41 } }), img('HIGH', { visual_score: { score: 97 } })]);
  const sc = id => rec.candidates.find(c => c.asset.asset_id === id && c.platform === 'OnlyFans Paid').score;
  assert.equal(sc('LOW').score, sc('HIGH').score, 'a technical score must not money-rank TODAY');
  assert.equal(d.CALL_THRESHOLD, 6);
  const src = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function candidateScore'), src.indexOf('export function evidenceTier'))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert(!/visual_score|technical_score|visualTerm\(/.test(body));
  for (const phrase of [/measured results on this asset/i, /proven photo/i, /winning photo/i, /best-?selling photo/i, /the AI likes/i]) {
    const clean = t => t.split('\n').filter(l => !l.trim().startsWith('//') && !/never|must not|Do not/.test(l)).join('\n');
    assert(!phrase.test(clean(src)), `PPV language regression in domain: ${phrase}`);
    assert(!phrase.test(clean(html)), `PPV language regression in UI: ${phrase}`);
  }
  // DM and feed still never pool.
  const dm = s.routes.find(r => r.route_id === 'OF_PAID_PPV_MESSAGE_01');
  const feed = s.routes.find(r => r.route_id === 'OF_PAID_FEED_01');
  assert.notEqual(d.scopeKeyForRoute(dm), d.scopeKeyForRoute(feed));
  assert.equal(d.denominatorObservable(feed), false);
});

// ---------------------------------------------------------------------------
const report = { pass: failed.length === 0, total: checks.length, passed: passed.length, failed };
fs.writeFileSync(path.join(ROOT, 'tests/RC3_AUDIT_RESULTS.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
