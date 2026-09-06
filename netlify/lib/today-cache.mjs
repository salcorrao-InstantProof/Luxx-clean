import crypto from 'node:crypto';
import {store} from './storage.mjs';
import {STORES} from './model.mjs';

// TODAY as a stored object with a generation.
//
// Until now the daily prescription was recomputed by scanning every asset on every command,
// including the RECOMMEND that fires on page load and after every mutation. The 4s poll got
// cheap in v1.5.0; this was the remaining expensive path, and it was the larger of the two.
//
// The generation is the pair of things a prescription actually depends on:
//   - the library signature (asset keys + etags, from one list() call, zero asset reads)
//   - state.rev, which increments on every ledger write (actions, outcomes, prescriptions,
//     revenue, routes, baseline, settings)
// If neither moved, the prescription cannot have changed, so the cached object is returned and
// no asset is read at all.
//
// SCALE NOTE: list() is cheap relative to N reads, but it is NOT free. It enumerates every key,
// so at several thousand objects the listing itself becomes the bill. The next step, when that
// happens, is a stored generation counter bumped by writers, with the listing kept only as a
// periodic reconciliation check. Deliberately not built yet: a maintained counter introduces a
// drift class, and drift is worse than a listing until the listing actually hurts.
export async function librarySignature(){
  const s=await store(STORES.assets);
  const {blobs}=await s.list({prefix:'assets/'});
  const rows=blobs.map(b=>`${b.key}:${b.etag||''}`).sort();
  return {signature:crypto.createHash('sha256').update(rows.join('\n')).digest('hex'),count:blobs.length};
}

export function generationFor(librarySig,rev){
  return crypto.createHash('sha256').update(`${librarySig}|${Number(rev||0)}`).digest('hex').slice(0,32);
}

const KEY='today.json';

export async function readCachedToday(generation){
  try{
    const s=await store(STORES.state);
    const c=await s.get(KEY,{type:'json'});
    if(!c||c.generation!==generation)return null;
    return c;
  }catch{return null}
}

export async function writeCachedToday(generation,payload,meta={}){
  try{
    const s=await store(STORES.state);
    await s.setJSON(KEY,{generation,...payload,computed_at:new Date().toISOString(),...meta});
  }catch{/* cache is an optimisation, never a correctness dependency */}
}
