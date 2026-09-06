// LUXX v1.7.0 RC2A — CREATOR CTA SELECTION FIX
// Focused checks A..L for the ready-to-use caption selection UX.
//
// This is a creator UX fix. These tests also assert that the things it must NOT touch
// were not touched: PPV treatment evidence, GUESS/CALL, navigation, scoring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const d = await import('../netlify/lib/domain.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const checks = [], passed = [], failed = [];
function t(name, fn) {
  try { fn(); passed.push(name); console.log('PASS', name); }
  catch (e) { failed.push({ name, error: String((e && e.message) || e) }); console.log('FAIL', name, '-', (e && e.message)); }
  checks.push(name);
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const img = (id) => ({
  asset_id: id, name: id + '.jpg', media_type: 'IMAGE', authorization_status: 'AUTHORIZED',
  availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE', platform_eligibility: [],
  variants: [{ variant_id: id + '-SAFE', asset_id: id, variant_type: 'PRIVACY_SAFE_EXPORT',
               rendered: true, privacy_safe_export: true, metadata_stripped: true }]
});
function prescribed(platform = 'OnlyFans Paid', intent = 'OF_PAID_WALL') {
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  const assets = [img('IMG-A')];
  const rec = d.generateRecommendation(s, assets);
  const rx = d.createPrescriptionForPick(s, rec, {
    asset_id: 'IMG-A', variant_id: 'IMG-A-SAFE', platform, job_class: 'MONETIZE', job_intent: intent
  });
  return { s, rx, assets };
}

// The exact markup the READY TO APPROVE card renders, evaluated for real rather than
// pattern-matched, so a broken template fails here instead of in the browser.
function renderCtaChoices(x) {
  const src = html.slice(html.indexOf('function ctaChoices(x){'), html.indexOf('async function useCta('));
  const fn = new Function('esc', src + '; return ctaChoices;')(
    s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]))
  );
  return fn(x);
}

// ---------------------------------------------------------------------------
// A / B / C / D — what the card must render
// ---------------------------------------------------------------------------
t('A. READY TO APPROVE renders every available CTA option', () => {
  const { rx } = prescribed();
  assert(rx.cta_options.length >= 2, 'this prescription must offer alternates to be a useful test');
  const out = renderCtaChoices(rx);
  for (const opt of rx.cta_options.slice(0, 3)) {
    const escd = opt.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
    assert(out.includes(escd), `option not rendered: ${opt}`);
  }
  assert.equal((out.match(/class="ctaOption/g) || []).length, Math.min(3, rx.cta_options.length));
  // Alternates are no longer buried behind a disclosure the creator has to open.
  assert(!/<details>/.test(out), 'alternate captions must not be hidden inside a details element');
});

t('B. every CTA option carries its own COPY', () => {
  const { rx } = prescribed();
  const out = renderCtaChoices(rx);
  const copies = (out.match(/data-cta-copy="\d+"/g) || []);
  assert.equal(copies.length, Math.min(3, rx.cta_options.length), 'one COPY per option');
  rx.cta_options.slice(0, 3).forEach((opt, i) => {
    assert(out.includes(`data-cta-copy="${i}"`), `no COPY for option ${i}`);
  });
  // COPY must copy only that caption, and must not require selecting it first.
  const calls = [...out.matchAll(/onclick="copyCaption\(([^)]*)\)"/g)].map(m => m[1]);
  assert.equal(calls.length, Math.min(3, rx.cta_options.length));
  calls.forEach((arg, i) => {
    const text = JSON.parse(arg.replace(/&quot;/g, '"'));
    assert.equal(text, rx.cta_options[i], `COPY ${i} copies the wrong caption`);
  });
});

t('C. every non-selected CTA option carries USE THIS CTA', () => {
  const { rx } = prescribed();
  const out = renderCtaChoices(rx);
  const uses = (out.match(/data-cta-use="\d+"/g) || []);
  assert.equal(uses.length, Math.min(3, rx.cta_options.length) - 1,
    'every option except the selected one is directly switchable');
  assert(out.includes('USE THIS CTA'));
  for (let i = 1; i < Math.min(3, rx.cta_options.length); i++) {
    assert(new RegExp(`useCta\\('${rx.prescription_id}',${i}\\)`).test(out),
      `option ${i} does not switch directly to itself`);
  }
  // The creator must not be pushed through the generic CHANGE form to switch caption.
  assert(!/openChange\(/.test(out), 'switching a caption must not require the CHANGE workflow');
});

t('D. the default CTA is initially selected and marked', () => {
  const { rx } = prescribed();
  assert.equal(rx.cta, rx.cta_options[0], 'option 1 is preselected');
  assert.equal(rx.cta_selected_index, 0);
  assert.equal(rx.cta_selection_source, 'DEFAULT_FIRST_OPTION');
  const out = renderCtaChoices(rx);
  assert.equal((out.match(/ctaSelected/g) || []).length, 1, 'exactly one option is marked selected');
  assert(out.includes('SELECTED CTA'), 'the selected caption is visibly marked');
  assert(!/data-cta-use="0"/.test(out), 'the already-selected option offers no USE THIS CTA');
  assert(out.includes('id="todayCaption"'), 'the selected caption keeps the caption anchor');
});

// ---------------------------------------------------------------------------
// E / F / G — what selecting actually does
// ---------------------------------------------------------------------------
t('E. selecting an alternate CTA updates the visible selected state', () => {
  const { s, rx } = prescribed();
  const next = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 2 });
  assert.equal(next.cta, rx.cta_options[2]);
  const out = renderCtaChoices(next);
  assert.equal((out.match(/ctaSelected/g) || []).length, 1, 'still exactly one selected marker');
  const selectedBlock = out.split('ctaOption ctaSelected')[1].split('</div>')[0];
  assert(selectedBlock.includes('SELECTED CTA'));
  assert(!/data-cta-use="2"/.test(out), 'the newly selected option offers no USE THIS CTA');
  assert(/data-cta-use="0"/.test(out), 'the previous default is now switchable back');
});

t('F. the selected alternate CTA is stored on the prescription revision', () => {
  const { s, rx } = prescribed();
  const next = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 1 });
  assert.notEqual(next.prescription_id, rx.prescription_id, 'a selection creates a revision, not an edit in place');
  assert.equal(next.revision_of, rx.prescription_id);
  assert.equal(next.status, 'PRESCRIBED');
  assert.equal(next.cta, rx.cta_options[1], 'the exact chosen caption text is stored');
  assert.equal(next.cta_selected_index, 1);
  assert.equal(next.cta_selection_source, 'CREATOR_SELECTED');
  assert.deepEqual(next.cta_options, rx.cta_options, 'the other options remain available to switch to');
  assert.match(next.change_reason, /Creator selected ready-to-use caption 2 of 3/);
  // Selecting by exact text is equivalent to selecting by index.
  const { s: s2, rx: rx2 } = prescribed();
  const byText = d.selectPrescriptionCta(s2, { prescription_id: rx2.prescription_id, cta: rx2.cta_options[2] });
  assert.equal(byText.cta_selected_index, 2);
  // Free text is refused here: an arbitrary caption is a CHANGE, not a selection.
  assert.throws(() => d.selectPrescriptionCta(s2, { prescription_id: byText.prescription_id, cta: 'something I made up' }),
    /not one of the options/);
  assert.throws(() => d.selectPrescriptionCta(s2, { prescription_id: byText.prescription_id, cta_index: 9 }),
    /not one of the options/);
});

t('G. switching again keeps history truthful and erases nothing', () => {
  const { s, rx } = prescribed();
  const first = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 1 });
  const second = d.selectPrescriptionCta(s, { prescription_id: first.prescription_id, cta_index: 2 });

  const chain = s.prescriptions;
  assert.equal(chain.length, 3, 'three lines: original, first selection, second selection');
  assert.equal(chain[0].prescription_id, rx.prescription_id);
  assert.equal(chain[0].status, 'REVISED');
  assert.equal(chain[0].cta, rx.cta_options[0], 'the original line still carries the caption it originally had');
  assert.equal(chain[1].status, 'REVISED');
  assert.equal(chain[1].cta, rx.cta_options[1], 'the superseded selection is preserved exactly');
  assert.equal(chain[2].prescription_id, second.prescription_id);
  assert.equal(chain[2].status, 'PRESCRIBED');
  assert.equal(chain[2].cta, rx.cta_options[2]);
  assert.equal(chain[2].revision_of, first.prescription_id, 'the revision chain is intact');

  // Only one line is live at a time.
  assert.equal(chain.filter(x => x.status === 'PRESCRIBED').length, 1);

  // Reselecting what is already selected must not manufacture a revision.
  const noop = d.selectPrescriptionCta(s, { prescription_id: second.prescription_id, cta_index: 2 });
  assert.equal(noop.prescription_id, second.prescription_id);
  assert.equal(s.prescriptions.length, 3, 'a no-op selection creates no history');

  // The audit ledger records every revision and nothing was rewritten.
  const revisions = s.auditEvents.filter(e => e.event_type === 'PRESCRIPTION_REVISED');
  assert.equal(revisions.length, 2);
  assert.match(revisions[0].data.reason, /Creator selected ready-to-use caption/);
});

// ---------------------------------------------------------------------------
// H / I — the flows this must not break
// ---------------------------------------------------------------------------
t('H. APPROVE still works after selecting an alternate CTA, and freezes that caption', () => {
  const { s, rx, assets } = prescribed();
  const chosen = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 2 });
  const action = d.approvePrescription(s, chosen.prescription_id, assets);
  assert.equal(action.status, 'APPROVED');
  assert.equal(action.frozen_prescription.cta, rx.cta_options[2], 'the chosen caption is frozen with the prescription');
  assert.equal(action.frozen_prescription.cta_selected_index, 2);
  assert.equal(action.frozen_prescription.cta_selection_source, 'CREATOR_SELECTED');
  // Later execution can identify which caption was actually selected.
  const out = d.executeAction(s, action.action_id, { execution_reference: 'ref-1', creator_effort_minutes: 6 });
  const executed = s.actions.find(a => a.action_id === action.action_id);
  assert.equal(executed.status, 'EXECUTED');
  assert.equal(executed.frozen_prescription.cta, rx.cta_options[2]);
  assert(out, 'execution returns its record');
  // Approving a superseded line is still refused.
  assert.throws(() => d.approvePrescription(s, rx.prescription_id, assets), /Only a prescribed item can be approved/);
});

t('I. CHANGE and DECLINE still work, before and after a CTA selection', () => {
  const { s, rx } = prescribed();
  const chosen = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 1 });
  const revised = d.changePrescription(s, chosen.prescription_id, {
    reason: 'creator rewrote the caption herself', changes: { cta: 'A caption she typed herself.' }
  });
  assert.equal(revised.cta, 'A caption she typed herself.', 'the generic CHANGE path still accepts free text');
  assert.equal(revised.change_reason, 'creator rewrote the caption herself');
  assert.equal(s.prescriptions.find(x => x.prescription_id === chosen.prescription_id).status, 'REVISED');
  assert.throws(() => d.changePrescription(s, revised.prescription_id, { reason: '' }), /Change reason is required/);

  const declined = d.declinePrescription(s, revised.prescription_id, { reason: 'not today' });
  assert.equal(declined.status, 'DECLINED');
  assert.equal(declined.decline_reason, 'not today');
  assert.throws(() => d.declinePrescription(s, revised.prescription_id, { reason: '' }), /Decline reason is required/);
  // A declined line cannot then have its caption selected.
  assert.throws(() => d.selectPrescriptionCta(s, { prescription_id: revised.prescription_id, cta_index: 0 }),
    /Only a prescribed item/);
});

// ---------------------------------------------------------------------------
// J / K — the contracts this must leave alone
// ---------------------------------------------------------------------------
t('J. the PPV treatment evidence contract is unchanged by CTA selection', () => {
  const { s, rx, assets } = prescribed('OnlyFans Paid', 'PPV_DM');
  assert.equal(rx.route_id, 'OF_PAID_PPV_MESSAGE_01');
  assert.equal(rx.evidence_object, 'TREATMENT');
  const before = { key: rx.proposed_treatment_key, treatment: JSON.stringify(rx.proposed_treatment), summary: rx.reason_summary };
  const chosen = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 2 });
  assert.equal(chosen.evidence_object, 'TREATMENT', 'the evidence object is untouched');
  assert.equal(chosen.proposed_treatment_key, before.key, 'the treatment key is untouched by a caption change');
  assert.equal(JSON.stringify(chosen.proposed_treatment), before.treatment);
  assert.equal(chosen.reason_summary, before.summary);
  assert(!/cta|caption/i.test(String(chosen.proposed_treatment_key)), 'a caption is not part of treatment identity');
  assert.match(chosen.reason_summary, /pre-purchase treatment/i);
  // Selecting a caption creates no revenue, no outcome and no evidence of any kind.
  assert.equal(s.outcomes.length, 0);
  assert.equal(s.revenueEvents.length, 0);
  const action = d.approvePrescription(s, chosen.prescription_id, assets);
  assert.equal(action.frozen_prescription.proposed_treatment_key, before.key);
});

t('K. GUESS/CALL logic is unchanged, and no CTA is ever called a winner', () => {
  assert.equal(d.CALL_THRESHOLD, 6);
  const { s, rx } = prescribed();
  const chosen = d.selectPrescriptionCta(s, { prescription_id: rx.prescription_id, cta_index: 1 });
  const list = d.buildTodayList(s, d.generateRecommendation(s, [img('IMG-A')]));
  assert(list.lines.every(l => l.stamp === 'GUESS'), 'selecting a caption cannot mint a CALL');
  assert.equal(chosen.evidence_n_own, rx.evidence_n_own, 'evidence count is untouched');
  assert.equal(chosen.candidate_score, rx.candidate_score, 'the candidate score is untouched');
  assert.equal(chosen.predicted_quality, rx.predicted_quality);
  assert.match(rx.cta_basis, /Not yet ranked by your results/);

  // No CTA scoring, winner labels, ranking or analytics surface was introduced.
  const domainSrc = fs.readFileSync(path.join(ROOT, 'netlify/lib/domain.mjs'), 'utf8');
  for (const banned of [/cta_score/i, /best_cta/i, /winning cta/i, /cta_performance/i, /ctaLearning/i, /rankCtas?/i]) {
    assert(!banned.test(domainSrc), `CTA scoring surface introduced: ${banned}`);
    assert(!banned.test(html), `CTA scoring surface introduced in the UI: ${banned}`);
  }
  const nav = html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)[1];
  assert.equal((nav.match(/data-view=/g) || []).length, 3, 'primary navigation must stay at three tabs');
  // The selection stays inside the READY TO APPROVE card. No new modal was introduced.
  const uiBlock = html.slice(html.indexOf('function ctaChoices(x){'), html.indexOf('async function copyCaption('));
  assert(!/modal\(/.test(uiBlock), 'caption selection must not open a new modal');
});

// ---------------------------------------------------------------------------
// L — the release matrix contract still holds for the pieces this touches
// ---------------------------------------------------------------------------
t('L. the surrounding release contract is intact', () => {
  // Cam availability, PRODUCE gating and the weekend block are untouched by this fix.
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  assert.equal(d.camAvailability(s).configured, false);
  assert.equal(d.produceAllowed(s), false);
  d.setCamAvailability(s, { days: ['TUE', 'FRI'], earliest_start: '09:00', latest_end: '13:00', timezone: 'America/Chicago' });
  assert.equal(d.camAllowedOnDay(s, 'SAT'), false);
  assert.equal(d.camAllowedOnDay(s, 'SUN'), false);
  assert.equal(d.camAllowedOnDay(s, 'FRI'), true);
  for (const day of Object.keys(d.WEEK1_SCHEDULE)) {
    for (const job of d.WEEK1_SCHEDULE[day]) {
      assert.notEqual(job.job, 'LIVE');
      assert.notEqual(job.job, 'PRODUCE');
      if (job.intent === 'PPV_DM' || job.intent === 'PPV_BUNDLE') assert.equal(job.platform, 'OnlyFans Paid');
    }
  }
  // The append-only ledger still refuses to lose a prescription's frozen snapshot.
  const { s: s2, rx, assets } = prescribed();
  const before = structuredClone(s2);
  const chosen = d.selectPrescriptionCta(s2, { prescription_id: rx.prescription_id, cta_index: 1 });
  d.approvePrescription(s2, chosen.prescription_id, assets);
  d.validateAppendOnly(before, s2);
});

// ---------------------------------------------------------------------------
const report = { pass: failed.length === 0, total: checks.length, passed: passed.length, failed };
fs.writeFileSync(path.join(ROOT, 'tests/CTA_SELECTION_RESULTS.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
