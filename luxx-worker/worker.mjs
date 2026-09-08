// LUXX video worker
import { store } from './netlify/lib/storage.mjs';
import { STORES } from './netlify/lib/model.mjs';
import { processVideoJob } from './netlify/lib/video.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const POLL_MS = Number(process.env.LUXX_WORKER_POLL_MS || 10000);
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const attempted = new Map();
const MAX_ATTEMPTS = 2;

function log(...parts) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...parts);
}

async function preflight() {
  for (const [name, args] of [['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
    try {
      const { stdout } = await run(name, args);
      log(name, stdout.split('\n')[0].slice(0, 60));
    } catch {
      console.error(`\n${name} is not installed. Run:  apt install -y ffmpeg\n`);
      process.exit(1);
    }
  }
  if (!process.env.LUXX_BLOBS_SITE_ID || !process.env.LUXX_BLOBS_TOKEN) {
    console.error('\nLUXX_BLOBS_SITE_ID and LUXX_BLOBS_TOKEN must be set. See start.sh\n');
    process.exit(1);
  }
  try {
    const jobs = await store(STORES.jobs);
    await jobs.list({ prefix: 'jobs/' });
    log('connected to storage');
  } catch (e) {
    console.error('\nCould not reach storage. Check the token and site id.');
    console.error(String(e && e.message || e), '\n');
    process.exit(1);
  }
  const { stdout } = await run('df', ['-h', '/']);
  log('disk:', stdout.trim().split('\n').pop().split(/\s+/).slice(1, 5).join(' '));
}

function claimable(job) {
  const status = String(job.status || '');
  if (status === 'QUEUED' || status === 'CONTINUE') return true;
  if (status === 'RUNNING') {
    const moved = Date.parse(job.updated_at || job.created_at || 0) || 0;
    return moved > 0 && Date.now() - moved > 10 * 60 * 1000;
  }
  return false;
}

async function findJob() {
  const jobs = await store(STORES.jobs);
  const { blobs } = await jobs.list({ prefix: 'jobs/' });
  const candidates = [];
  for (const b of blobs || []) {
    let job = null;
    try { job = await jobs.get(b.key, { type: 'json' }); } catch { continue; }
    if (!job || job.kind !== 'AUTO_VIDEO') continue;
    if (!claimable(job)) continue;
    if ((attempted.get(job.job_id) || 0) >= MAX_ATTEMPTS) continue;
    candidates.push(job);
  }
  candidates.sort((a, b) =>
    (Date.parse(a.created_at || 0) || 0) - (Date.parse(b.created_at || 0) || 0));
  return candidates[0] || null;
}

async function claim(job) {
  const jobs = await store(STORES.jobs);
  const key = `jobs/${job.job_id}.json`;
  const fresh = await jobs.get(key, { type: 'json' });
  if (!fresh || !claimable(fresh)) return false;
  fresh.status = 'RUNNING';
  fresh.claimed_by = WORKER_ID;
  fresh.worker_accepted_at = new Date().toISOString();
  fresh.updated_at = new Date().toISOString();
  fresh.trigger_error = null;
  await jobs.setJSON(key, fresh);
  const check = await jobs.get(key, { type: 'json' });
  return !!check && check.claimed_by === WORKER_ID;
}

async function tick() {
  const job = await findJob();
  if (!job) return false;
  if (!await claim(job)) { log('another worker took', job.job_id); return true; }
  const started = Date.now();
  log(`processing ${job.asset_id}  (job ${job.job_id})`);
  attempted.set(job.job_id, (attempted.get(job.job_id) || 0) + 1);
  try {
    const result = await processVideoJob(job.job_id);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    const status = result?.job?.status || 'UNKNOWN';
    const variants = (result?.asset?.variants || []).length;
    if (status === 'COMPLETE') {
      log(`done in ${secs}s — ${variants} file${variants === 1 ? '' : 's'} written`);
      attempted.delete(job.job_id);
    } else if (status === 'CONTINUE') {
      log(`partway in ${secs}s, will continue`);
      attempted.delete(job.job_id);
    } else {
      log(`finished as ${status} after ${secs}s: ${String(result?.asset?.processing_error || result?.job?.error || '').slice(0, 160)}`);
    }
  } catch (e) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    log(`failed after ${secs}s: ${String(e && e.message || e).slice(0, 200)}`);
  }
  return true;
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => { if (!stopping) { stopping = true; log('stopping after this job'); } });

await preflight();
log(`worker ${WORKER_ID} ready — watching for videos`);

while (!stopping) {
  let worked = false;
  try {
    worked = await tick();
  } catch (e) {
    log('poll error:', String(e && e.message || e).slice(0, 160));
  }
  if (!worked && !stopping) await new Promise(r => setTimeout(r, POLL_MS));
}
log('stopped');
