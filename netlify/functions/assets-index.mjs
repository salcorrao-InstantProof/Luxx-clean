import crypto from 'node:crypto';
import {json,error} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {store} from '../lib/storage.mjs';
import {STORES} from '../lib/model.mjs';

// Cheap change-detection for the 4-second poll.
//
// Previously the poll hydrated the ENTIRE Library on a timer: one blob read per asset, every
// four seconds, forever. Batching those reads made them faster; it did not change the shape.
// A blob listing already carries a per-object etag, so a single list() call is enough to tell
// whether anything changed, with zero asset reads. The client only pays for a full hydrate
// when the signature actually moves.
//
// Deliberately NOT a maintained index blob: there is nothing to keep in sync, so there is no
// drift class to debug. The listing is the source of truth.
export default async req=>{
  if(!verifySession(req))return error('Unauthorized',401);
  const s=await store(STORES.assets);
  const {blobs}=await s.list({prefix:'assets/'});
  const rows=blobs.map(b=>`${b.key}:${b.etag||''}`).sort();
  const signature=crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
  return json({
    ok:true,
    count:blobs.length,
    signature,
    // The client compares this against the number of assets it is actually holding. A mismatch
    // means something vanished from the in-memory Library without a delete, which is exactly
    // the failure that made 120+ assets disappear in v1.4.7.
    checked_at:new Date().toISOString()
  });
};
export const config={path:'/api/assets-index'};
