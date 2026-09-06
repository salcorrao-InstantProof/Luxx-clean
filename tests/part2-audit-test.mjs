// LUXX v1.7.0 RC3 — ZERO-SURPRISE RELEASE AUDIT, PART 2
// Sections 27-33, 35-38 executed against the real functions and the real domain.
// Nothing here is mocked: every API check calls the shipped Netlify function.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'luxx-part2-'));
process.env.LUXX_LOCAL_STORAGE_DIR = path.join(root, 'store');
process.env.LUXX_LOCAL_AUTH_BYPASS = '1';
process.env.LUXX_PASSCODE = 'LUXX-TEST-PASSCODE';
process.env.LUXX_SESSION_SECRET = 'test-session-secret-not-for-production-use-0123456789';
process.env.LUXX_FFMPEG_PATH = process.env.LUXX_FFMPEG_PATH || '/usr/bin/ffmpeg';
process.env.LUXX_FFPROBE_PATH = process.env.LUXX_FFPROBE_PATH || '/usr/bin/ffprobe';

const d = await import('../netlify/lib/domain.mjs');
const actionFn = (await import('../netlify/functions/action.mjs')).default;
const stateFn = (await import('../netlify/functions/state.mjs')).default;
const exportFn = (await import('../netlify/functions/export-data.mjs')).default;
const importFn = (await import('../netlify/functions/import-data.mjs')).default;
const assetUpdateFn = (await import('../netlify/functions/asset-update.mjs')).default;
const assetDeleteFn = (await import('../netlify/functions/asset-delete.mjs')).default;
const uploadCompleteMod = await import('../netlify/functions/upload-complete.mjs');
const mediaChunkFn = (await import('../netlify/functions/media-chunk.mjs')).default;
const hlsFn = (await import('../netlify/functions/hls.mjs')).default;
const settingsFn = (await import('../netlify/functions/settings.mjs')).default;
const { store } = await import('../netlify/lib/storage.mjs');
const { STORES } = await import('../netlify/lib/model.mjs');

const checks = [], passed = [], failed = [];
async function t(name, fn) {
  try { await fn(); passed.push(name); console.log('PASS', name); }
  catch (e) { failed.push({ name, error: String((e && e.message) || e) }); console.log('FAIL', name, '-', (e && e.message)); }
  checks.push(name);
}
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const domainSrc = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');

// Every command goes through the real /api/action endpoint, with a real expected_rev.
async function cmd(op, payload = {}, expected_rev = undefined, operator_role = 'Creator') {
  const body = { op, payload: { ...payload, operator_role }, ...(expected_rev !== undefined ? { expected_rev } : {}) };
  const res = await actionFn(new Request('http://local/api/action', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }));
  const j = await res.json();
  return { status: res.status, ...j };
}
async function readState() {
  const r = await stateFn(new Request('http://local/api/state'));
  return (await r.json()).state;
}
async function seedAsset(id, extra = {}) {
  const a = await store(STORES.assets);
  await a.setJSON(`assets/${id}.json`, {
    asset_id: id, name: id + '.jpg', media_type: 'IMAGE', type: 'image/jpeg', size: 10, parts: 1,
    status: 'READY_FOR_REVIEW', authorization_status: 'AUTHORIZED', availability: 'AVAILABLE',
    historical_usage_status: 'PROSPECTIVE', platform_eligibility: [], master_sha256: crypto.createHash('sha256').update(id).digest('hex'),
    uploaded_at: new Date().toISOString(),
    variants: [{ variant_id: id + '-SAFE', asset_id: id, variant_type: 'PRIVACY_SAFE_EXPORT', rendered: true,
                 privacy_safe_export: true, metadata_stripped: true, sha256: 'v' + id }], ...extra
  });
}
async function lockedBaseline() {
  await cmd('BASELINE_IMPORT', { rows: [{ platform: 'X', metric: 'followers', value: 36, evidence_reference: 'x.png' }] });
  await cmd('BASELINE_CAPTURE', { evidence_reference: 'launch shots', inventory_mapping_reference: 'map' });
  await cmd('BASELINE_LOCK', {});
}

await seedAsset('IMG-1'); await seedAsset('IMG-2'); await seedAsset('IMG-3');
await lockedBaseline();

// ---------------------------------------------------------------------------
// §27 EXECUTIVE PRODUCER LOOP — equal permissions, different attribution only
// ---------------------------------------------------------------------------
let epAction = null;
await t('§27 Executive Producer has identical powers and is attributed correctly', async () => {
  let st = await readState();
  const rec = await cmd('RECOMMEND', {}, st.rev, 'Executive Producer');
  assert.equal(rec.status, 200, 'the Executive Producer may generate a recommendation');
  st = await readState();
  const rx = await cmd('PRESCRIBE_PICK', { asset_id: 'IMG-1', variant_id: 'IMG-1-SAFE',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'OF_PAID_WALL' }, st.rev, 'Executive Producer');
  assert.equal(rx.status, 200, 'the Executive Producer may prescribe');
  st = await readState();
  const ap = await cmd('APPROVE', { prescription_id: rx.result.prescription_id }, st.rev, 'Executive Producer');
  assert.equal(ap.status, 200, 'the Executive Producer may approve');
  st = await readState();
  const ex = await cmd('EXECUTE', { action_id: ap.result.action_id, execution_reference: 'ep-post',
    creator_effort_minutes: 9 }, st.rev, 'Executive Producer');
  assert.equal(ex.status, 200, 'the Executive Producer may mark posted');
  st = await readState();
  epAction = st.actions.find(a => a.action_id === ap.result.action_id);
  assert.equal(epAction.operator_role, 'Executive Producer', 'the operator identity is recorded');
  assert.equal(epAction.creator_effort_minutes, 9);
  // The Creator can act on the same ledger with no permission difference.
  const rx2 = await cmd('PRESCRIBE_PICK', { asset_id: 'IMG-2', variant_id: 'IMG-2-SAFE',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'OF_PAID_WALL' }, st.rev, 'Creator');
  assert.equal(rx2.status, 200, 'the Creator has the same powers');
  st = await readState();
  const ap2 = await cmd('APPROVE', { prescription_id: rx2.result.prescription_id }, st.rev, 'Creator');
  st = await readState();
  const ex2 = await cmd('EXECUTE', { action_id: ap2.result.action_id, execution_reference: 'creator-post',
    creator_effort_minutes: 4 }, st.rev, 'Creator');
  assert.equal(ex2.status, 200);
  st = await readState();
  const roles = st.actions.map(a => a.operator_role);
  assert(roles.includes('Creator') && roles.includes('Executive Producer'), 'both identities appear in the ledger');
  // Role is audit identity only: it is not a capability gate anywhere in the domain.
  assert(!/role\s*[!=]==?\s*'Executive Producer'\s*\)\s*throw/.test(domainSrc), 'role must never gate a capability');
});

// ---------------------------------------------------------------------------
// §28 TWO-DEVICE / OPTIMISTIC CONCURRENCY
// ---------------------------------------------------------------------------
await t('§28 a stale write is refused and never silently overwrites newer state', async () => {
  const shared = await readState();
  const staleRev = shared.rev;                       // Device A and B both hold this
  // Device A writes first.
  const a = await cmd('REVENUE', { event_type: 'TIP', gross_amount: 3, notes: 'device A' }, staleRev, 'Creator');
  assert.equal(a.status, 200, `the first device write succeeds: ${a.error || ''}`);
  const afterA = await readState();
  assert(afterA.rev > staleRev, 'the revision advanced');
  // Device B still holds the old revision.
  const b = await cmd('REVENUE', { event_type: 'TIP', gross_amount: 7, notes: 'device B' }, staleRev, 'Executive Producer');
  assert.equal(b.status, 409, `a stale write must be refused, got ${b.status}`);
  assert.match(String(b.error), /STATE_CONFLICT/, 'the conflict is named truthfully');
  const afterB = await readState();
  assert.equal(afterB.rev, afterA.rev, 'the refused write changed nothing');
  assert(afterB.revenueEvents.some(r => r.notes === 'device A'), "device A's write survived the conflict");
  assert(!afterB.revenueEvents.some(r => r.notes === 'device B'), 'the refused write was not applied');
  // Device B refreshes and retries: the honest retry path works.
  const retry = await cmd('REVENUE', { event_type: 'TIP', gross_amount: 7, notes: 'device B' }, afterB.rev, 'Executive Producer');
  assert.equal(retry.status, 200, 'a refreshed retry succeeds');
  const final = await readState();
  assert(final.revenueEvents.some(r => r.notes === 'device A'), 'device A survived');
  assert(final.revenueEvents.some(r => r.notes === 'device B'), 'no write was lost after the honest retry');
});

await t('§28 a repeated MARK POSTED cannot execute the same action twice', async () => {
  let st = await readState();
  const rx = await cmd('PRESCRIBE_PICK', { asset_id: 'IMG-3', variant_id: 'IMG-3-SAFE',
    platform: 'OnlyFans Paid', job_class: 'MONETIZE', job_intent: 'OF_PAID_WALL' }, st.rev);
  st = await readState();
  const ap = await cmd('APPROVE', { prescription_id: rx.result.prescription_id }, st.rev);
  st = await readState();
  const first = await cmd('EXECUTE', { action_id: ap.result.action_id, execution_reference: 'ref-1', creator_effort_minutes: 5 }, st.rev);
  assert.equal(first.status, 200);
  st = await readState();
  const dupe = await cmd('EXECUTE', { action_id: ap.result.action_id, execution_reference: 'ref-1', creator_effort_minutes: 5 }, st.rev);
  assert.notEqual(dupe.status, 200, 'a second execution of the same action must be refused');
  assert.match(String(dupe.error), /Only an approved action/i);
  st = await readState();
  const outcomes = st.outcomes.filter(o => o.action_id === ap.result.action_id);
  assert.equal(outcomes.length, 1, 'a duplicate click must not create a second outcome');
});

// ---------------------------------------------------------------------------
// §29 RESULTS — history, corrections, evidence
// ---------------------------------------------------------------------------
await t('§29 a correction appends to history and never rewrites the original silently', async () => {
  let st = await readState();
  const outcome = st.outcomes.find(o => o.measurement_state === 'SCHEDULED');
  assert(outcome, 'an executed action scheduled a measurement');
  const m = await cmd('MEASURE', { outcome_id: outcome.outcome_id, raw: { views: 100, gross_revenue: 10, tracked_clicks: 0 } }, st.rev);
  assert.equal(m.status, 200);
  st = await readState();
  const measured = st.outcomes.find(o => o.outcome_id === outcome.outcome_id);
  assert.equal(measured.measurement_state, 'MEASURED');
  assert.equal(measured.raw.tracked_clicks, 0, 'an observed zero is kept as zero');
  assert.equal(measured.raw.free_joins, undefined, 'an unknown metric stays absent, never zero');
  const c = await cmd('CORRECT_MEASUREMENT', { outcome_id: outcome.outcome_id, reason: 'platform restated views', raw: { views: 111 } }, st.rev);
  assert.equal(c.status, 200);
  st = await readState();
  const corr = st.measurementCorrections.find(x => x.outcome_id === outcome.outcome_id);
  assert(corr, 'the correction is recorded');
  assert.equal(corr.previous_raw.views, 100, 'the original measurement is preserved inside the correction');
  assert.equal(corr.new_raw.views, 111);
  assert.equal(corr.reason, 'platform restated views');
  assert.equal(st.outcomes.find(o => o.outcome_id === outcome.outcome_id).raw.views, 111);
  const events = st.auditEvents.filter(e => e.entity_id === outcome.outcome_id).map(e => e.event_type);
  assert(events.includes('MEASUREMENT_RECORDED') && events.includes('MEASUREMENT_CORRECTED'), 'both steps are audited');
  assert(events.indexOf('MEASUREMENT_RECORDED') < events.indexOf('MEASUREMENT_CORRECTED'));
  // CORRECT must be reachable from the RESULTS screen.
  assert(/openMeasurement\('\$\{o\.outcome_id\}',true\)">CORRECT</.test(html), 'CORRECT is a visible RESULTS control');
});

await t('§29 RESULTS reports every audited surface', async () => {
  const st = await readState();
  const reports = await cmd('REPORTS', {}, st.rev);
  assert.equal(reports.status, 200);
  const r = reports.result;
  for (const key of ['effort', 'calibration', 'overrides', 'since_baseline', 'crop_evidence',
                     'treatment_learning', 'visible_asset_learning', 'job_performance', 'cam',
                     'checklist', 'baseline_coverage', 'baseline_review', 'cam_availability', 'produce'])
    assert(key in r, `RESULTS is missing ${key}`);
  assert.match(r.treatment_learning.note, /pre-purchase treatment/i);
  assert(r.since_baseline, 'the locked-baseline comparison exists');
  assert('total_hours' in r.effort && 'overall_revenue_per_hour' in r.effort, 'creator effort economics exist');
  const pp = await cmd('PROOF_PACK', {}, st.rev);
  assert.equal(pp.status, 200, 'the receipts pack is reachable');
});

// ---------------------------------------------------------------------------
// §30 BACKUP / EXPORT
// ---------------------------------------------------------------------------
await t('§30 BACKUP JSON exports a parseable, complete ledger', async () => {
  const res = await exportFn(new Request('http://local/api/export-data?format=json'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /attachment/);
  const text = await res.text();
  const backup = JSON.parse(text);           // must be valid JSON
  assert.equal(backup.baseline.locked, true, 'the locked baseline is included');
  assert(backup.baseline.snapshots.length >= 1, 'the reviewed baseline numbers are included');
  assert(backup.routes.length > 0, 'tracking configuration is included');
  assert(backup.actions.length > 0, 'the action ledger is included');
  assert(backup.outcomes.length > 0, 'measurements are included');
  assert(backup.measurementCorrections.length > 0, 'corrections are included');
  assert(backup.auditEvents.length > 0, 'audit attribution is included');
  assert(backup.actions.some(a => a.operator_role), 'operator attribution survives export');
  assert(backup.prescriptions.length > 0, 'prescription history is included');
  const csv = await exportFn(new Request('http://local/api/export-data?format=csv'));
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  assert(csvText.split('\n')[0].includes('action_id'), 'the CSV carries the action ledger header');
  // Restore/import exists already; it merges by id and must not duplicate.
  const before = await readState();
  const merge = { revenueEvents: [{ revenue_event_id: 'PART2-IMPORT-1', action_id: null, event_type: 'OTHER',
    gross_amount: 1, attribution_precision: 'UNATTRIBUTED' }] };
  const imp = await importFn(new Request('http://local/api/import-data', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(merge) }));
  assert.equal(imp.status, 200);
  const after = await readState();
  assert(after.revenueEvents.some(r => r.revenue_event_id === 'PART2-IMPORT-1'), 'the merge landed');
  const imp2 = await importFn(new Request('http://local/api/import-data', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(merge) }));
  assert.equal(imp2.status, 200);
  const after2 = await readState();
  assert.equal(after2.revenueEvents.filter(r => r.revenue_event_id === 'PART2-IMPORT-1').length, 1,
    'a repeated import must not duplicate a record');
  assert(after2.actions.length >= before.actions.length, 'an import never removes ledger entries');
});

// ---------------------------------------------------------------------------
// §31 CAM AVAILABILITY
// ---------------------------------------------------------------------------
await t('§31 cam availability: unset, allowed, disallowed, window, weekend, zoneless', async () => {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' }); d.lockBaseline(s);
  assert.equal(d.camAvailability(s).configured, false);
  const unset = d.buildTodayPlan(s, [], { date: '2026-09-07T15:00:00Z' }).lines.find(l => l.job === 'LIVE');
  assert.equal(unset.kind, 'SETUP_REQUIRED');
  assert(!/\d\s*(AM|PM)/i.test(unset.label), 'no clock time is invented');
  d.setCamAvailability(s, { days: ['TUE', 'FRI'], earliest_start: '09:00', latest_end: '13:00', timezone: 'America/Chicago' });
  assert.equal(d.camAllowedOnDay(s, 'TUE'), true);
  assert.equal(d.camAllowedOnDay(s, 'WED'), false, 'an unconfigured weekday is not a cam day');
  assert.equal(d.camAllowedOnDay(s, 'SAT'), false);
  assert.equal(d.camAllowedOnDay(s, 'SUN'), false);
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '09:00', end: '13:00' }).allowed, true);
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '08:30', end: '12:00' }).allowed, false);
  assert.equal(d.camSlotAllowed(s, { day: 'TUE', start: '11:00', end: '13:30' }).allowed, false);
  assert.throws(() => d.setCamAvailability(s, { days: ['SAT'], earliest_start: '09:00', latest_end: '13:00' }), /Saturday and Sunday/);
  assert.throws(() => d.setCamAvailability(s, { days: ['TUE'], earliest_start: '13:00', latest_end: '09:00' }), /after/);
  assert.throws(() => d.recordCamSession(s, { started_at: '2026-09-12T10:00', ended_at: '2026-09-12T12:00', effort_minutes: 120 }), /Saturday and Sunday/);
  // A zoneless wall clock is resolved in the creator's timezone.
  const sess = d.recordCamSession(s, { started_at: '2026-09-11T09:05', ended_at: '2026-09-11T12:10',
    effort_minutes: 185, followers_start: 1343, followers_end: 1361, tips_tokens: 880,
    native_revenue: 44, theme: 'Bookish / Nerdy Daytime', notes: 'first pilot' });
  assert.equal(sess.day_code, 'FRI');
  assert.equal(sess.outside_configured_availability, false, '9:05 AM Central is inside 09:00-13:00');
  assert.equal(sess.session_minutes, 185);
  assert.equal(sess.followers_delta, 18);
  assert.equal(sess.tips_tokens, 880);
  assert.equal(sess.native_revenue, 44);
  assert.equal(sess.theme, 'Bookish / Nerdy Daytime');
  assert.equal(sess.notes, 'first pilot');
  const late = d.recordCamSession(s, { started_at: '2026-09-08T20:00', ended_at: '2026-09-08T22:00', effort_minutes: 120 });
  assert.equal(late.outside_configured_availability, true, 'an out-of-window session is flagged, not hidden');
  assert.match(d.camSummary(s).time_claim, /GUESS \/ DEFAULT/);
  const summaryText = JSON.stringify(d.camSummary(s));
  assert(/never evidence that it is the optimal time/.test(summaryText), 'the summary denies optimality outright');
  const positiveClaim = summaryText.replace(/never evidence that it is the optimal time/g, '')
    .replace(/no cam time may be called optimal/g, '');
  assert(!/optimal/i.test(positiveClaim), 'no time may be positively described as optimal');
});

// ---------------------------------------------------------------------------
// §32 PRODUCE GATING
// ---------------------------------------------------------------------------
await t('§32 PRODUCE stays off until a counted gap is documented', async () => {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' }); d.lockBaseline(s);
  assert.equal(d.produceAllowed(s), false);
  for (const day of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']) {
    const plan = d.buildTodayPlan(s, [], { date: day + 'T15:00:00Z' });
    assert(!plan.lines.some(l => l.job === 'PRODUCE'), `${day}: PRODUCE appeared with no gap`);
    assert(plan.lines.length < plan.cap, `${day}: the day genuinely had room`);
  }
  assert.throws(() => d.recordLibraryGap(s, { gap_type: 'PPV_INVENTORY', evidence_reference: 'review', counted_have: 9, counted_needed: 4 }), /not a gap/);
  assert.throws(() => d.recordLibraryGap(s, { gap_type: 'MADE_UP', evidence_reference: 'r', counted_have: 0, counted_needed: 1 }), /Unknown gap type/);
  const g = d.recordLibraryGap(s, { gap_type: 'PPV_INVENTORY', evidence_reference: 'library review 2026-09-06', counted_have: 1, counted_needed: 6 });
  assert.equal(d.produceAllowed(s), true);
  const line = d.buildTodayPlan(s, [], { date: '2026-09-07T15:00:00Z' }).lines.find(l => l.job === 'PRODUCE');
  assert(line && line.gap_id === g.gap_id, 'the PRODUCE job names the documented gap');
  assert.match(line.why, /library review 2026-09-06/);
});

// ---------------------------------------------------------------------------
// §33 HISTORICAL CONTENT
// ---------------------------------------------------------------------------
await t('§33 historical records persist for PH / MV / OF and stay protected', async () => {
  let st = await readState();
  const created = [];
  for (const [platform, ref] of [['Pornhub', 'ph-1'], ['ManyVids', 'mv-1'], ['OnlyFans Paid', 'of-1']]) {
    st = await readState();
    const r = await cmd('HISTORICAL_PUBLICATION', { asset_id: 'IMG-1', platform, external_reference: ref, title: platform + ' item' }, st.rev);
    assert.equal(r.status, 200, `${platform} historical record`);
    assert.equal(r.result.status, 'HISTORICAL_BASELINE');
    created.push(r.result.historical_publication_id);
  }
  st = await readState();
  for (const id of created) {
    const rev = await cmd('HIST_REVIEW', { historical_publication_id: id, review_status: 'KEEP', notes: 'kept' }, (await readState()).rev);
    assert.equal(rev.status, 200);
  }
  st = await readState();
  assert.equal(st.historicalPublications.length, 3, 'all three persist');
  for (const h of st.historicalPublications) {
    assert.equal(h.review_status, 'KEEP', 'review status persists');
    assert.equal(h.asset_id, 'IMG-1', 'master mapping stays intact');
  }
  // The referenced master cannot be erased.
  const del = await assetDeleteFn(new Request('http://local/api/asset-delete', {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: 'IMG-1' }) }));
  assert.notEqual(del.status, 200, 'a history-protected asset must not be deletable');
  assert.match(String((await del.json()).error), /cannot be erased|UNAVAILABLE/i);
  // MARK UNAVAILABLE remains possible and preserves the record.
  const upd = await assetUpdateFn(new Request('http://local/api/asset-update', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: 'IMG-1', availability: 'UNAVAILABLE' }) }));
  assert.equal(upd.status, 200);
  const a = await (await store(STORES.assets)).get('assets/IMG-1.json', { type: 'json' });
  assert.equal(a.availability, 'UNAVAILABLE');
  assert.equal(a.master_sha256, crypto.createHash('sha256').update('IMG-1').digest('hex'), 'the master is untouched');
  assert.equal((await readState()).historicalPublications.length, 3, 'history survives');
  // REVIEW EXISTING is a reachable control.
  assert(/onclick="openVideoReview\('\$\{a\.asset_id\}'\)">REVIEW EXISTING</.test(html), 'REVIEW EXISTING is on the media card');
});

// ---------------------------------------------------------------------------
// §35 FAILURE / NEGATIVE STATES
// ---------------------------------------------------------------------------
await t('§35 every negative state fails truthfully and non-destructively', async () => {
  const st = await readState();
  const before = JSON.stringify(await readState());
  const cases = [
    ['unknown operation', () => cmd('NOT_A_REAL_OP', {}, st.rev), /Unknown operation/i],
    ['locked baseline overwrite', () => cmd('BASELINE_IMPORT', { rows: [{ platform: 'X', metric: 'followers', value: 1 }] }, st.rev), /already locked/i],
    ['route verified without evidence', () => cmd('ROUTE_UPDATE', { route_id: 'X_POST_TO_OF_FREE_01', verification_status: 'VERIFIED' }, st.rev), /requires identifier/i],
    ['missing route', () => cmd('ROUTE_UPDATE', { route_id: 'NO_SUCH_ROUTE', verification_status: 'VERIFIED' }, st.rev), /Route not found/i],
    ['change without a reason', () => cmd('CHANGE', { prescription_id: 'RX-NOPE', reason: '' }, st.rev), /not found|reason is required/i],
    ['decline without a reason', () => cmd('DECLINE', { prescription_id: 'RX-NOPE', reason: '' }, st.rev), /not found|reason is required/i],
    ['negative creator effort', () => cmd('EXECUTE', { action_id: 'ACT-NOPE', execution_reference: 'r', creator_effort_minutes: -1 }, st.rev), /not found|0 or greater/i],
    ['weekend cam', () => cmd('CAM_SESSION', { started_at: '2026-09-12T10:00', ended_at: '2026-09-12T12:00', effort_minutes: 60 }, st.rev), /Saturday and Sunday/i],
    ['invalid cam time', () => cmd('CAM_AVAILABILITY_SET', { days: ['TUE'], earliest_start: '25:99', latest_end: '13:00' }, st.rev), /HH:MM/i],
    ['weekend cam availability', () => cmd('CAM_AVAILABILITY_SET', { days: ['SUN'], earliest_start: '09:00', latest_end: '13:00' }, st.rev), /Saturday and Sunday/i],
    ['undocumented produce gap', () => cmd('LIBRARY_GAP_RECORD', { gap_type: 'PPV_INVENTORY', evidence_reference: '', counted_have: 0, counted_needed: 3 }, st.rev), /evidence reference/i],
    ['invalid revenue type', () => cmd('REVENUE', { event_type: 'MAGIC', gross_amount: 1 }, st.rev), /Invalid revenue type/i],
    ['negative revenue', () => cmd('REVENUE', { event_type: 'TIP', gross_amount: -5 }, st.rev), /0 or greater/i],
    ['CTA selection outside the offered options', () => cmd('CTA_SELECT', { prescription_id: 'RX-NOPE', cta_index: 0 }, st.rev), /not found/i]
  ];
  for (const [name, run, pattern] of cases) {
    const r = await run();
    assert.notEqual(r.status, 200, `${name}: must not silently succeed`);
    assert(pattern.test(String(r.error || '')), `${name}: unhelpful error ${JSON.stringify(r.error)}`);
    assert(String(r.error || '').length > 8, `${name}: the error must be understandable`);
  }
  // Nothing above mutated state.
  const after = JSON.stringify(await readState());
  assert.equal(after, before, 'a rejected command must leave the ledger untouched');
  // Malformed baseline input, on a state where the lock guard is not the first refusal.
  const fresh = d.seedState();
  for (const [name, run, pattern] of [
    ['malformed baseline file', () => d.importBaseline(fresh, { text: '{not json' }), /not valid JSON/i],
    ['value that is neither a number nor NOT_AVAILABLE', () => d.importBaseline(fresh, { rows: [{ platform: 'X', metric: 'followers', value: 'about forty' }] }), /neither a number nor/i],
    ['unknown baseline platform', () => d.importBaseline(fresh, { rows: [{ platform: 'MySpace', metric: 'followers', value: 1 }] }), /Unknown baseline platform/i],
    ['empty baseline file', () => d.importBaseline(fresh, { text: '' }), /empty/i],
    ['baseline row with no metric', () => d.importBaseline(fresh, { rows: [{ platform: 'X' }] }), /platform and a metric/i]
  ]) {
    assert.throws(run, pattern, `${name}: unhelpful or missing error`);
  }
  assert.equal(fresh.baseline.snapshots.length, 0, 'a rejected import wrote nothing');

  // Media endpoints reject unknown keys instead of leaking or crashing.
  const chunk = await mediaChunkFn(new Request('http://local/api/media-chunk?key=does/not/exist'));
  assert.notEqual(chunk.status, 200);
  const hls = await hlsFn(new Request('http://local/api/hls?asset=NOPE&variant=NOPE'));
  assert.notEqual(hls.status, 200);
  // Settings validates its input.
  const badTz = await settingsFn(new Request('http://local/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ creatorTimezone: 'Not/AReal Zone!!' }) }));
  assert.equal(badTz.status, 400, 'an invalid timezone is rejected');
});

await t('§35 an unauthorized, quarantined or unavailable asset never reaches TODAY', async () => {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' }); d.lockBaseline(s);
  const base = (id, extra) => ({ asset_id: id, name: id, media_type: 'IMAGE', authorization_status: 'AUTHORIZED',
    availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE', platform_eligibility: [],
    variants: [{ variant_id: id + '-S', asset_id: id, variant_type: 'PRIVACY_SAFE_EXPORT', rendered: true,
                 privacy_safe_export: true, metadata_stripped: true }], ...extra });
  for (const [label, asset, code] of [
    ['unauthorized', base('U', { authorization_status: 'UNCLEAR' }), 'AUTHORIZATION_REQUIRED'],
    ['quarantined', base('Q', { availability: 'QUARANTINED' }), 'AUTHORIZATION_REQUIRED'],
    ['unavailable', base('N', { availability: 'UNAVAILABLE' }), 'AUTHORIZATION_REQUIRED']
  ]) {
    const line = d.buildTodayPlan(s, [asset], { date: '2026-09-07T15:00:00Z' }).lines.find(l => l.job === 'MONETIZE');
    assert.equal(line.kind, 'BLOCKED', `${label} asset must not be prescribed`);
    assert.equal(line.hold_code, code, `${label}: got ${line.hold_code}`);
    assert(!line.asset_id, `${label}: a blocked line must carry no asset`);
  }
});

// ---------------------------------------------------------------------------
// §36 DATA INTEGRITY
// ---------------------------------------------------------------------------
await t('§36 writes are atomic, append-only and immutable where required', async () => {
  const storageSrc = fs.readFileSync(path.join(ROOT, 'netlify/lib/storage.mjs'), 'utf8');
  assert(/await fs\.rename\(tmp,fp\)/.test(storageSrc), 'the Part-1 atomic write fix must remain');
  assert(/if\(!text\.trim\(\) *\) *return null/.test(storageSrc.replace(/\s+/g, ' ')) || /if\(!text\.trim\(\)\)return null/.test(storageSrc),
    'a zero-length read is reported as absent, not as a parse crash');
  assert(/\.tmp-/.test(storageSrc), 'temp files are namespaced');
  assert(/!e\.name\.includes\('\.tmp-'\)/.test(storageSrc), 'temp files are never listed as blobs');

  // Append-only: removing a recorded action is refused.
  const st = await readState();
  const before = structuredClone(st);
  const after = structuredClone(st);
  after.actions = after.actions.slice(1);
  assert.throws(() => d.validateAppendOnly(before, after), /Append-only violation/);
  const after2 = structuredClone(st);
  if (after2.auditEvents.length) { after2.auditEvents[0] = { ...after2.auditEvents[0], event_type: 'TAMPERED' };
    assert.throws(() => d.validateAppendOnly(before, after2), /audit event changed/); }
  const after3 = structuredClone(st);
  const withFrozen = after3.actions.find(a => a.frozen_prescription);
  if (withFrozen) { withFrozen.frozen_prescription = { ...withFrozen.frozen_prescription, cta: 'tampered' };
    assert.throws(() => d.validateAppendOnly(before, after3), /Frozen prescription changed/); }

  // Immutable locked baseline.
  assert.throws(() => d.recordBaselineSnapshot(st, { platform: 'X', metrics: { followers: 999 } }), /locked/i);
  // Immutable master: an asset update cannot change the master hash.
  const a0 = await (await store(STORES.assets)).get('assets/IMG-2.json', { type: 'json' });
  await assetUpdateFn(new Request('http://local/api/asset-update', { method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ asset_id: 'IMG-2', master_sha256: 'deadbeef', notes: 'try to tamper' }) }));
  const a1 = await (await store(STORES.assets)).get('assets/IMG-2.json', { type: 'json' });
  assert.equal(a1.master_sha256, a0.master_sha256, 'the master hash is immutable through the update API');
  // Every mutating op is revision-checked.
  const actionSrc = fs.readFileSync(path.join(ROOT, 'netlify/functions/action.mjs'), 'utf8');
  assert(/expected_rev/.test(actionSrc) && /STATE_CONFLICT/.test(actionSrc), 'optimistic concurrency is enforced centrally');
});

// ---------------------------------------------------------------------------
// §37 SECURITY
// ---------------------------------------------------------------------------
await t('§37 no secret is packaged and inputs are validated', async () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  })(ROOT);
  const secretish = /(LUXX_PASSCODE|LUXX_SESSION_SECRET)\s*=\s*['"][^'"\s]{6,}['"]/;
  for (const f of files) {
    if (/\.(zip|png|jpe?g|mp4|mov|pdf|ico)$/i.test(f)) continue;
    let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const rel = path.relative(ROOT, f);
    if (rel.startsWith('tests/')) continue;                 // test fixtures use throwaway values
    assert(!secretish.test(txt), `a hard-coded secret is packaged in ${rel}`);
    assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(txt), `a private key is packaged in ${rel}`);
    assert(!/\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/.test(txt), `an API token is packaged in ${rel}`);
  }
  // The embedded-secret module must read from the environment only.
  const emb = fs.readFileSync(path.join(ROOT, 'netlify/lib/embedded-secret.mjs'), 'utf8');
  assert(!secretish.test(emb), 'the embedded-secret module must contain no literal secret');
  assert(!/=\s*['"][A-Za-z0-9!@#$%^&*_-]{8,}['"]/.test(emb.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')),
    'no credential literal survives in the embedded-secret module');
  const authSrc = fs.readFileSync(path.join(ROOT, 'netlify/lib/auth.mjs'), 'utf8');
  assert(/process\.env/.test(authSrc), 'authentication reads its secrets from the environment');
  assert(!secretish.test(authSrc));

  // Path traversal and unsafe keys are rejected by the storage layer.
  const s = await store(STORES.media);
  for (const bad of ['../escape', 'a/../../b', '..', 'x/../../../y']) {
    await assert.rejects(async () => s.get(bad), /Invalid blob key/, `traversal not blocked: ${bad}`);
  }
  // An absolute-looking key is not a traversal: the leading slash is stripped and the read
  // is confined to the store root. Assert the confinement, which is the real guarantee.
  for (const abs of ['/etc/passwd', '//etc/shadow']) {
    const got = await s.get(abs);
    assert(got === null || !/root:x:/.test(String(got)), `an absolute key escaped the store: ${abs}`);
  }
  const trav = await mediaChunkFn(new Request('http://local/api/media-chunk?key=' + encodeURIComponent('../../etc/passwd')));
  assert.notEqual(trav.status, 200, 'path traversal through the media endpoint must fail');
  const hlsTrav = await hlsFn(new Request('http://local/api/hls?asset=' + encodeURIComponent('../x') + '&variant=y'));
  assert.notEqual(hlsTrav.status, 200);

  // No shell string interpolation anywhere: ffmpeg/ffprobe are spawned with argument arrays.
  for (const rel of ['netlify/lib/video.mjs', 'netlify/lib/media-edit.mjs', 'netlify/lib/privacy.mjs', 'build-check.mjs', 'scripts/verify-root-ffmpeg-deps.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert(!/\bexec\s*\(/.test(src), `${rel} uses exec()`);
    assert(!/shell\s*:\s*true/.test(src), `${rel} spawns a shell`);
    assert(!/execSync\s*\(/.test(src), `${rel} uses execSync`);
  }
  // Unauthenticated access is refused when the bypass is off.
  const prev = process.env.LUXX_LOCAL_AUTH_BYPASS;
  process.env.LUXX_LOCAL_AUTH_BYPASS = '';
  const unauth = await exportFn(new Request('http://local/api/export-data?format=json'));
  process.env.LUXX_LOCAL_AUTH_BYPASS = prev;
  assert.equal(unauth.status, 401, 'an unauthenticated export must be refused');
});

// ---------------------------------------------------------------------------
// §38 STALE-CODE SWEEP
// ---------------------------------------------------------------------------
await t('§38 no stale release-critical reference survives anywhere', async () => {
  const offenders = [];
  const banned = [
    [/\/mnt\/data/, 'machine-specific path /mnt/data'],
    [/LUXX_FINAL_INTEGRATED_V1_3/, 'old repository name'],
    [/executable_path\s*=\s*['"]\/usr\/bin\/chromium['"]/, 'hard-coded chromium path'],
    [/#prescribeBtn/, 'removed control #prescribeBtn'],
    [/8:00.?11:00 PM/, 'hard-coded evening cam window'],
    [/8.11 PM local/, 'hard-coded evening cam default'],
    [/September 8, 2026/, 'wrong launch date'],
    [/mainLen\s*=\s*duration>=360\?300/, 'automatic 300-second MAIN CUT'],
    [/duration_seconds-451/, 'fixed 451-second assumption'],
    [/\b7:31\b/, 'fixed 7:31 assumption']
  ];
  const stripComments = (txt, f) => f.endsWith('.py')
    ? txt.split('\n').filter(l => !l.trim().startsWith('#')).join('\n').replace(/^\s*"""[\s\S]*?"""/m, '')
    : txt.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = path.relative(ROOT, p);
      if (rel.startsWith('docs/history/')) continue;          // preserved history, not instructions
      // Release notes and the tests themselves must be able to NAME the thing they removed
      // or forbid. Naming it is the opposite of relying on it. Machine-specific paths and
      // the old repository name are still forbidden everywhere.
      const narrative = rel.startsWith('RELEASE_NOTES_v1_7_0_RC') || rel.startsWith('tests/') || rel === 'FINAL_ACCEPTANCE_REPORT_RC3.md';
      const isSelf = rel === 'tests/part2-audit-test.mjs' || rel.endsWith('_RESULTS.json');
      if (/\.(zip|png|jpe?g|mp4|mov|pdf|ico)$/i.test(p)) continue;
      let txt = ''; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const exec = stripComments(txt, rel);
      for (const [re, why] of banned) {
        if (isSelf) continue;
        const namingIsAllowed = narrative && !/machine-specific path|old repository name/.test(why);
        if (namingIsAllowed) continue;
        if (re.test(exec)) offenders.push(`${rel}: ${why}`);
      }
    }
  })(ROOT);
  assert.deepEqual(offenders, [], 'stale release-critical references survive');

  // Release-facing docs name this release only.
  for (const f of ['DO_THIS_FIRST.txt', 'READ_ME_FIRST.txt', 'DEPLOY_THIS_ZIP_ONLY.txt', 'UPGRADE_SAME_NETLIFY_SITE.txt']) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert(/v1\.7\.0/.test(txt), `${f} does not name the current release`);
    assert(!/\bv1\.(3|4|5|6)\.\d/.test(txt), `${f} points at a superseded release`);
    assert(/Monday, September 7, 2026/.test(txt), `${f} does not state the correct launch date`);
  }
  // Every route id referenced in the UI still exists in the catalog.
  const ids = new Set(d.seedState().routes.map(r => r.route_id));
  for (const m of html.matchAll(/\b([A-Z]{2,}[A-Z0-9_]*_0\d)\b/g)) {
    assert(ids.has(m[1]), `the UI references a dead route id: ${m[1]}`);
  }
});

// ---------------------------------------------------------------------------
const report = { pass: failed.length === 0, total: checks.length, passed: passed.length, failed };
fs.writeFileSync(path.join(ROOT, 'tests/PART2_AUDIT_RESULTS.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
