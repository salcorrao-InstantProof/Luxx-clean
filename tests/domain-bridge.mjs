// Browser-test domain bridge.
//
// The v1.7.0 RC1 browser suite carried a hand-written Python re-implementation of the
// domain. It drifted: it still knew about #prescribeBtn and a pre-job TODAY, so the UI
// test passed against a model of LUXX that no longer existed.
//
// This bridge removes the re-implementation. The browser test posts the real state,
// the real assets and a real operation on stdin; the REAL domain module executes it and
// the new state comes back on stdout. The UI is therefore always tested against current
// behaviour, and a domain change that breaks the UI shows up as a browser-test failure.
//
// Usage:  echo '{"state":{...},"assets":[...],"op":"TODAY_PLAN","payload":{}}' | node tests/domain-bridge.mjs
import {applyCommand, seedState} from '../netlify/lib/domain.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

const state = input.state && Object.keys(input.state).length ? input.state : seedState();
const assets = Array.isArray(input.assets) ? input.assets : [];

try {
  const result = applyCommand(state, assets, input.op, input.payload || {});
  state.rev = Number(state.rev || 0) + 1;
  process.stdout.write(JSON.stringify({ok: true, result, state}));
} catch (e) {
  process.stdout.write(JSON.stringify({ok: false, error: String(e && e.message || e), state}));
}
