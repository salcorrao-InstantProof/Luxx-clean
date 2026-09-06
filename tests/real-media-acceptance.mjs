// LUXX v1.7.0 RC3 — REAL MEDIA ACCEPTANCE  (audit part 2, section 24)
//
// This harness derives EVERY expectation from the file it is given. It contains no
// duration constant, no 451, no 7:31, no 300, no "15 minutes". It probes the source
// with ffprobe and asserts the pipeline preserved what was actually there.
//
//   LUXX_REAL_VIDEO=/path/to/creator-master.mp4 node tests/real-media-acceptance.mjs
//
// LUXX_MEDIA_LABEL names the run in the report ("real creator video" vs a synthetic
// long-form fixture) so a synthetic run can never be mistaken for the creator file.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.LUXX_REAL_VIDEO || '';
const LABEL = process.env.LUXX_MEDIA_LABEL || 'unlabelled fixture';
const IS_REAL = String(process.env.LUXX_MEDIA_IS_CREATOR_FILE || '') === '1';

const report = {
  pass: false, ran: false, label: LABEL, is_creator_file: IS_REAL,
  source: null, checks: [], failed: [], not_run_reason: null
};
function ok(id, name) { report.checks.push({ id, name, result: 'PASS' }); console.log('PASS', id, name); }
async function step(id, name, fn) {
  try { await fn(); ok(id, name); }
  catch (e) { report.failed.push({ id, name, error: String((e && e.message) || e) }); console.log('FAIL', id, name, '-', (e && e.message)); }
}

if (!SOURCE || !fss.existsSync(SOURCE)) {
  report.not_run_reason = SOURCE
    ? `LUXX_REAL_VIDEO points at ${SOURCE}, which does not exist in this environment.`
    : 'LUXX_REAL_VIDEO is not set. The creator master is not present, so real-media acceptance cannot run. It is reported NOT RUN and is never inferred from a stored artifact.';
  fss.writeFileSync(path.join(ROOT, 'tests/REAL_MEDIA_ACCEPTANCE_RESULTS.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);   // 2 = NOT RUN, distinct from 1 = FAIL
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luxx-real-media-'));
process.env.LUXX_LOCAL_STORAGE_DIR = path.join(root, 'store');
process.env.LUXX_LOCAL_AUTH_BYPASS = '1';
const FFMPEG = process.env.LUXX_FFMPEG_PATH || '/usr/bin/ffmpeg';
const FFPROBE = process.env.LUXX_FFPROBE_PATH || '/usr/bin/ffprobe';
process.env.LUXX_FFMPEG_PATH = FFMPEG;
process.env.LUXX_FFPROBE_PATH = FFPROBE;

const { CHUNK_SIZE, STORES } = await import('../netlify/lib/model.mjs');
const uploadFn = (await import('../netlify/functions/upload-chunk.mjs')).default;
const { completeUpload } = await import('../netlify/functions/upload-complete.mjs');
const { processVideoJob, choosePlan } = await import('../netlify/lib/video.mjs');
const { editVideo } = await import('../netlify/lib/media-edit.mjs');
const { store } = await import('../netlify/lib/storage.mjs');
const d = await import('../netlify/lib/domain.mjs');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const run = (bin, args) => new Promise((res, rej) => {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', c => out += c); p.stderr.on('data', c => err += c);
  p.on('close', c => c === 0 ? res(out) : rej(new Error(err.slice(-1500))));
});

// ---------------------------------------------------------------------------
// Ground truth, measured from the supplied file before LUXX ever sees it.
// ---------------------------------------------------------------------------
const bytes = await fs.readFile(SOURCE);
const sourceSha = sha(bytes);
const probeRaw = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', SOURCE]);
const probe = JSON.parse(probeRaw);
const vStream = probe.streams.find(s => s.codec_type === 'video');
const aStream = probe.streams.find(s => s.codec_type === 'audio') || null;
const fpsParts = String(vStream.r_frame_rate || '0/1').split('/').map(Number);
const truth = {
  file: path.basename(SOURCE),
  size_bytes: bytes.length,
  sha256: sourceSha,
  duration_seconds: Number(probe.format.duration),
  width: Number(vStream.width),
  height: Number(vStream.height),
  frame_rate: fpsParts[1] ? Number((fpsParts[0] / fpsParts[1]).toFixed(4)) : null,
  video_codec: vStream.codec_name,
  audio_codec: aStream ? aStream.codec_name : null,
  container: probe.format.format_name
};
report.source = truth;
report.ran = true;
console.log('SOURCE TRUTH', JSON.stringify(truth, null, 2));
assert(Number.isFinite(truth.duration_seconds) && truth.duration_seconds > 0, 'ffprobe returned no usable duration');

async function uploadFile(fp, { asset_id, media_type, platform_eligibility = [] }) {
  const src = await fs.readFile(fp), parts = Math.ceil(src.length / CHUNK_SIZE);
  for (let i = 0; i < parts; i++) {
    const b = src.subarray(i * CHUNK_SIZE, Math.min(src.length, (i + 1) * CHUNK_SIZE));
    const res = await uploadFn(new Request('http://local/api/upload-chunk', {
      method: 'POST',
      headers: { 'x-luxx-asset-id': asset_id, 'x-luxx-part': String(i), 'x-luxx-total-parts': String(parts), 'content-type': 'application/octet-stream' },
      body: b
    }));
    assert.equal(res.status, 200, `upload chunk ${i}`);
  }
  const r = await completeUpload({
    asset_id, name: path.basename(fp), type: 'video/mp4', size: src.length, parts,
    media_type, authorization_status: 'AUTHORIZED', platform_eligibility
  });
  assert(!r.error, r.error);
  return r.asset;
}

const ASSET = 'VIDEO-REAL-ACCEPT';
const assetsStore = await store(STORES.assets);
const mediaStore = await store(STORES.media);

let uploaded = await uploadFile(SOURCE, { asset_id: ASSET, media_type: 'VIDEO', platform_eligibility: ['Pornhub', 'OnlyFans Paid'] });
let processed = null;

await step('B', 'stored master SHA-256 matches the supplied source', () => {
  assert.equal(uploaded.master_sha256, truth.sha256,
    'the stored master hash must equal the hash of the file that was handed to LUXX');
});

await step('Q', 'processing reports its real outcome, never a false success', async () => {
  const res = await processVideoJob(uploaded.job_id);
  processed = res.asset;
  assert.equal(res.job.status, 'COMPLETE', `job ended ${res.job.status}: ${res.job.error || ''}`);
  assert.equal(processed.status, 'READY_FOR_REVIEW');
  assert.equal(processed.processing_error, null);
  assert(res.job.completed_at, 'a completed job records when it completed');
});

await step('C', 'the source duration is preserved exactly as probed', () => {
  assert(Math.abs(processed.analysis.duration_seconds - truth.duration_seconds) < 0.5,
    `LUXX recorded ${processed.analysis.duration_seconds}s for a ${truth.duration_seconds}s source`);
  assert.equal(processed.analysis.width, truth.width);
  assert.equal(processed.analysis.height, truth.height);
});

await step('A', 'the stored FULL MASTER is the complete source', () => {
  const fm = (processed.variants || []).find(v => v.variant_id === 'FULL-MASTER');
  assert(fm, 'a FULL-MASTER export must exist');
  assert.equal(fm.variant_type, 'FULL_MASTER');
  const len = Number(fm.final_runtime || fm.duration_seconds || 0);
  assert(Math.abs(len - truth.duration_seconds) < 1.5,
    `the full master is ${len}s for a ${truth.duration_seconds}s source`);
  assert.equal(processed.analysis.plan.master_is_full_source, true);
  assert.equal(processed.analysis.plan.full_master.start, 0);
});

await step('D', 'a long source is never truncated to five minutes', () => {
  const fm = processed.variants.find(v => v.variant_id === 'FULL-MASTER');
  const len = Number(fm.final_runtime || fm.duration_seconds || 0);
  if (truth.duration_seconds > 320) {
    assert(len > 320, `a ${truth.duration_seconds}s source produced a ${len}s "master"`);
    assert(Math.abs(len - 300) > 2, 'the 300-second truncation is back');
  }
  assert(!(processed.variants || []).some(v => v.variant_id === 'MAIN-CUT'),
    'no automatic MAIN CUT may be produced any more');
  // choosePlan rounds to millisecond precision, as it does for every window. Assert the
  // master matches the probed duration to within a single frame, which is far stricter
  // than "not truncated" and still honest about that rounding.
  const plan = choosePlan(truth.duration_seconds, { sceneTimes: [], bad: [], silence: [] });
  const frame = truth.frame_rate ? 1 / truth.frame_rate : 0.04;
  assert(Math.abs(plan.full_master.duration - truth.duration_seconds) <= frame,
    `the plan master is ${plan.full_master.duration}s for a ${truth.duration_seconds}s source`);
  assert.equal(plan.full_master.start, 0);
  assert.equal(plan.master_is_full_source, true);
});

await step('E', 'a poster frame is generated for the master', async () => {
  assert(processed.thumbnail_key, 'the asset must carry a poster key');
  const poster = await mediaStore.get(processed.thumbnail_key, { type: 'arrayBuffer' });
  assert(poster && poster.byteLength > 1000, 'the poster is empty');
  const pf = path.join(root, 'poster.jpg');
  await fs.writeFile(pf, Buffer.from(poster));
  const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', pf]);
  assert(/\d+,\d+/.test(out.trim()), `the poster is not a decodable image: ${out}`);
  assert(processed.thumbnail_frame_timestamp_or_reference, 'the poster records which frame it came from');
});

await step('G', 'ffprobe succeeds on every rendered derivative', async () => {
  for (const v of processed.variants) {
    const man = [];
    for (let i = 0; i < v.download_parts.length; i++) {
      man.push(Buffer.from(await mediaStore.get(v.download_parts[i].key || v.download_parts[i], { type: 'arrayBuffer' })));
    }
    const fp = path.join(root, `${v.variant_id}.mp4`);
    await fs.writeFile(fp, Buffer.concat(man));
    const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', fp]);
    const p = JSON.parse(out);
    assert(p.streams.some(s => s.codec_type === 'video'), `${v.variant_id} has no video stream`);
    assert(Number(p.format.duration) > 0, `${v.variant_id} has no duration`);
  }
});

await step('F+H', 'the production playback path produces a valid HLS playlist', async () => {
  for (const v of processed.variants) {
    assert(Number(v.hls_segments) > 0, `${v.variant_id} rendered no HLS segments`);
    const m3u8 = await mediaStore.get(`hls/${ASSET}/${v.variant_id}/index.m3u8`);
    assert(m3u8, `${v.variant_id} has no playlist`);
    assert(m3u8.startsWith('#EXTM3U'), `${v.variant_id} playlist is malformed`);
    assert(/#EXT-X-ENDLIST/.test(m3u8), `${v.variant_id} playlist is not a finished VOD playlist`);
    const segs = [...m3u8.matchAll(/^(seg-[^\r\n]+)$/gm)].map(m => m[1]);
    assert(segs.length > 0, `${v.variant_id} playlist lists no segments`);
    for (const s of segs.slice(0, 3)) {
      const blob = await mediaStore.get(`hls/${ASSET}/${v.variant_id}/${s}`, { type: 'arrayBuffer' });
      assert(blob && blob.byteLength > 0, `${v.variant_id} segment ${s} is missing`);
    }
  }
});

await step('I', 'every teaser is a distinct, shorter derivative, not a copy of the master', () => {
  const fm = processed.variants.find(v => v.variant_id === 'FULL-MASTER');
  const teasers = processed.variants.filter(v => v.variant_type === 'TEASER');
  assert(teasers.length > 0, 'a long source should still produce teasers');
  for (const t of teasers) {
    assert.notEqual(t.sha256, fm.sha256, `${t.variant_id} is byte-identical to the master`);
    const len = Number(t.final_runtime || t.duration_seconds || 0);
    assert(len < truth.duration_seconds, `${t.variant_id} is as long as the source`);
    assert(len <= 20.5, `${t.variant_id} is ${len}s, which is not a teaser`);
  }
});

await step('J+K+L', 'PH_TEASER refuses the full master and any legacy main cut', () => {
  const fm = processed.variants.find(v => v.variant_id === 'FULL-MASTER');
  assert.equal(d.isTeaserDerivative(fm), false, 'the full master must never satisfy PH_TEASER');
  assert.equal(d.isTeaserDerivative({ variant_id: 'MAIN-CUT', variant_type: 'MAIN_CUT' }), false);
  assert.equal(d.isTeaserDerivative({ variant_id: 'MAIN-CUT', variant_type: 'TEASER' }), false,
    'a legacy main cut relabelled as a teaser is still refused');
  const teaser = processed.variants.find(v => v.variant_type === 'TEASER');
  assert.equal(d.isTeaserDerivative(teaser), true);

  // With only a full master present the job must HOLD, never fall back to the source.
  const s = d.seedState();
  d.captureBaseline(s, { evidence_reference: 'e', inventory_mapping_reference: 'i' });
  d.lockBaseline(s);
  d.updateRoute(s, 'PH_VIDEO_DESC_TO_OF_FREE_01', {
    tracking_url_or_identifier: 'https://t.example/ph', destination_confirmed: true,
    test_performed: 'opened', verification_evidence: 'proof', verification_status: 'VERIFIED'
  });
  d.confirmRoutePlacement(s,'PH_VIDEO_DESC_TO_OF_FREE_01',{placement_evidence:'test: link installed in the live placement'});
  const masterOnly = { ...processed, variants: [fm] };
  const line = d.buildTodayPlan(s, [masterOnly], { date: '2026-09-09T15:00:00Z' })
    .lines.find(l => l.intent === 'PH_TEASER');
  assert.equal(line.kind, 'BLOCKED');
  assert.equal(line.hold_code, 'PH_TEASER_REQUIRED');
  assert(!line.variant_id, 'a blocked teaser job must carry no substituted variant');
  // A rendered teaser whose Pornhub details are not filled in is a DIFFERENT hold: the
  // teaser exists, so LUXX must not claim one is required.
  const rawTeaser = d.buildTodayPlan(s, [processed], { date: '2026-09-09T15:00:00Z' })
    .lines.find(l => l.intent === 'PH_TEASER');
  assert.equal(rawTeaser.hold_code, 'VIDEO_FIELDS_INCOMPLETE');
  assert(rawTeaser.repair_context.hold_code === 'VIDEO_FIELDS_INCOMPLETE');
  assert(rawTeaser.why.includes('teaser exists'), 'the creator is not sent hunting for a teaser she has');
  // Once those details are completed, the job resolves to the teaser and nothing else.
  const completed = {
    ...processed,
    variants: processed.variants.map(v => d.isTeaserDerivative(v) ? {
      ...v, title_direction: 'T', description_direction: 'D', cta: 'Full scene on OnlyFans Free.',
      tracking_route_id: 'PH_VIDEO_DESC_TO_OF_FREE_01',
      thumbnail_frame_timestamp_or_reference: v.thumbnail_frame_timestamp_or_reference || '0.5s',
      start_timestamp: String(v.start_seconds ?? 0), end_timestamp: String((v.start_seconds ?? 0) + Number(v.final_runtime || v.duration_seconds || 0))
    } : v)
  };
  // A second eligible asset is supplied so the day's earlier OnlyFans job does not consume
  // the only file through normal rotation.
  const filler = { asset_id: 'IMG-FILLER', name: 'filler.jpg', media_type: 'IMAGE',
    authorization_status: 'AUTHORIZED', availability: 'AVAILABLE', historical_usage_status: 'PROSPECTIVE',
    platform_eligibility: [], variants: [{ variant_id: 'F-SAFE', asset_id: 'IMG-FILLER',
      variant_type: 'PRIVACY_SAFE_EXPORT', rendered: true, privacy_safe_export: true, metadata_stripped: true }] };
  const withTeaser = d.buildTodayPlan(s, [filler, completed], { date: '2026-09-09T15:00:00Z' })
    .lines.find(l => l.intent === 'PH_TEASER');
  assert.equal(withTeaser.kind, 'ACTION', `expected the teaser to run, got ${withTeaser.hold_code || withTeaser.kind}`);
  assert.match(String(withTeaser.variant_id), /TEASER/);
  assert.notEqual(withTeaser.variant_id, 'FULL-MASTER');
});

await step('M', 'derivative lineage points at the immutable master', () => {
  for (const v of processed.variants) {
    assert.equal(v.asset_id, ASSET, `${v.variant_id} is not bound to its master asset`);
    assert(v.sha256, `${v.variant_id} has no content hash`);
  }
  assert.equal(processed.master_sha256, truth.sha256, 'the master hash is unchanged by rendering');
});

await step('N', 'a fresh read of durable storage returns the same master and derivatives', async () => {
  const reread = await assetsStore.get(`assets/${ASSET}.json`, { type: 'json' });
  assert.equal(reread.master_sha256, truth.sha256);
  assert.equal(reread.variants.length, processed.variants.length);
  const fm = reread.variants.find(v => v.variant_id === 'FULL-MASTER');
  assert(Math.abs(Number(fm.final_runtime || fm.duration_seconds) - truth.duration_seconds) < 1.5);
  // The original chunks still reassemble to the exact source bytes.
  const parts = [];
  for (let i = 0; i < reread.parts; i++) {
    parts.push(Buffer.from(await mediaStore.get(`original/${ASSET}/part-${String(i).padStart(6, '0')}`, { type: 'arrayBuffer' })));
  }
  assert.equal(sha(Buffer.concat(parts)), truth.sha256, 'the stored original no longer reassembles to the source');
});

await step('O', 'reprocessing does not create a second master or duplicate derivatives', async () => {
  const before = await assetsStore.get(`assets/${ASSET}.json`, { type: 'json' });
  const again = await processVideoJob(uploaded.job_id);
  const after = again.asset;
  assert.equal(after.master_sha256, before.master_sha256, 'a retry changed the master');
  const ids = after.variants.map(v => v.variant_id);
  assert.equal(new Set(ids).size, ids.length, 'a retry duplicated a derivative');
  assert.equal(after.variants.length, before.variants.length, 'a retry added variants');
  const all = await assetsStore.list({ prefix: 'assets/' });
  assert.equal(all.blobs.filter(b => b.key.includes(ASSET)).length, 1, 'a retry created a second asset record');
});

await step('P', 'the master stays byte-identical after a derivative edit', async () => {
  const fm = (await assetsStore.get(`assets/${ASSET}.json`, { type: 'json' }))
    .variants.find(v => v.variant_id === 'FULL-MASTER');
  const edited = await editVideo({
    asset_id: ASSET, source_variant_id: fm.variant_id,
    recipe: { trim_start: 1, trim_duration: Math.min(5, Math.max(2, truth.duration_seconds - 2)) }
  });
  assert(edited && !edited.error, edited && edited.error);
  const after = await assetsStore.get(`assets/${ASSET}.json`, { type: 'json' });
  assert.equal(after.master_sha256, truth.sha256, 'editing a derivative changed the master hash');
  const parts = [];
  for (let i = 0; i < after.parts; i++) {
    parts.push(Buffer.from(await mediaStore.get(`original/${ASSET}/part-${String(i).padStart(6, '0')}`, { type: 'arrayBuffer' })));
  }
  assert.equal(sha(Buffer.concat(parts)), truth.sha256, 'the stored original bytes changed');
  const stillFull = after.variants.find(v => v.variant_id === 'FULL-MASTER');
  assert(Math.abs(Number(stillFull.final_runtime || stillFull.duration_seconds) - truth.duration_seconds) < 1.5,
    'the full master was shortened by an unrelated edit');
  const child = after.variants.find(v => v.parent_variant_id === fm.variant_id);
  assert(child, 'the edit produced no derivative');
  assert.equal(child.asset_id, ASSET, 'the edit lineage left the master');
});

report.pass = report.failed.length === 0;
report.variants = (processed && processed.variants || []).map(v => ({
  variant_id: v.variant_id, variant_type: v.variant_type,
  seconds: Number(v.final_runtime || v.duration_seconds || 0), sha256: v.sha256, hls_segments: v.hls_segments
}));
fss.writeFileSync(path.join(ROOT, 'tests/REAL_MEDIA_ACCEPTANCE_RESULTS.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, source: truth }, null, 2));
if (!report.pass) process.exit(1);
