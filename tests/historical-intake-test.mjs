import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const d=await import('../netlify/lib/domain.mjs');
const checks=[];const ok=m=>{checks.push(m);console.log('PASS',m)};

const PH_ROW={platform:'Pornhub',title:'Lake House Afternoon',url:'https://www.pornhub.com/view_video.php?viewkey=ph000000001',
  published_at:'2025-11-14',runtime_seconds:451,views:2140,likes:88,current_description:'Full scene.',
  current_cta_link:'https://onlyfans.com/creator001free',usage_status:'HISTORICAL',notes:'batch BATCH-LAKE'};
const MV_ROW={platform:'ManyVids',title:'Booksmart Tease Set',url:'https://www.manyvids.com/Video/000000/booksmart-tease',
  published_at:'2026-02-02',runtime_seconds:612,sales:7,revenue:104.93,current_price:14.99,usage_status:'HISTORICAL'};

{ // import + preservation
  const s=d.seedState();
  const r=d.importHistoricalPublications(s,[PH_ROW,MV_ROW,{platform:'NotAPlatform',title:'bad'}]);
  assert.equal(r.imported,2);assert.equal(r.errors.length,1,'a bad row is reported, never silently dropped');
  assert.match(r.errors[0].error,/Unknown platform/);
  const ph=s.historicalPublications.find(x=>x.platform==='Pornhub');
  assert.equal(ph.status,'HISTORICAL_BASELINE');assert.equal(ph.views,2140);
  assert.equal(ph.match_confirmed,false,'nothing is linked on import');
  const mv=s.historicalPublications.find(x=>x.platform==='ManyVids');
  assert.equal(mv.revenue,104.93);assert.equal(mv.current_price,14.99);assert.equal(mv.sales,7);
  ok('Pornhub and ManyVids rows import with stats preserved and nothing auto-linked');
}
{ // CSV
  const csv='platform,title,url,published_at,runtime_seconds,views\nPornhub,"Lake House, Afternoon",https://x/1,2025-11-14,451,2140\nManyVids,Booksmart,https://x/2,2026-02-02,612,\n';
  const rows=d.parseHistoricalCsv(csv);
  assert.equal(rows.length,2);
  assert.equal(rows[0].title,'Lake House, Afternoon','quoted commas survive');
  assert.equal(rows[1].views,undefined,'blank cells are omitted, not zeroed');
  const s=d.seedState();
  assert.equal(d.importHistoricalPublications(s,rows).imported,2);
  ok('CSV paste imports, including quoted commas and blank cells');
}
{ // matching suggests, never auto-links
  const s=d.seedState();
  const {ids}=d.importHistoricalPublications(s,[PH_ROW]);
  const assets=[
    {asset_id:'VID-1',name:'lake house afternoon.mp4',analysis:{duration_seconds:451},batch_id:'BATCH-LAKE'},
    {asset_id:'VID-2',name:'kitchen morning.mp4',analysis:{duration_seconds:120}},
    {asset_id:'VID-3',name:'lake house afternoon alt.mp4',analysis:{duration_seconds:449}}];
  const sug=d.suggestHistoricalMatch(s,assets,ids[0]);
  assert.equal(sug.requires_confirmation,true,'confirmation is always required');
  assert.equal(sug.suggested.asset_id,'VID-1','best candidate surfaces first');
  assert(sug.candidates.length>=2);
  assert.equal(s.historicalPublications[0].asset_id,null,'suggesting must not link');
  // Exact title + exact runtime + batch hint is legitimately strong. It STILL requires confirmation.
  assert.equal(sug.confidence,'STRONG','an exact title, runtime and batch match is a strong suggestion');
  // A genuinely ambiguous pair must not read as strong.
  const s2=d.seedState();
  const amb=d.importHistoricalPublications(s2,[{platform:'Pornhub',title:'Shower Set',runtime_seconds:300,url:'https://x/9'}]);
  const twins=[{asset_id:'VID-9',name:'shower set two.mp4',analysis:{duration_seconds:302}},
               {asset_id:'VID-10',name:'shower set three.mp4',analysis:{duration_seconds:299}}];
  const ambSug=d.suggestHistoricalMatch(s2,twins,amb.ids[0]);
  assert.equal(ambSug.confidence,'AMBIGUOUS',`two near-identical candidates must be ambiguous, got ${ambSug.confidence}`);
  assert.equal(ambSug.requires_confirmation,true);
  assert.match(ambSug.note,/will not link this without you choosing/);
  assert.equal(s2.historicalPublications[0].asset_id,null,'an ambiguous match is never applied');
  assert.throws(()=>d.linkHistoricalToMaster(s,{historical_publication_id:ids[0],asset_id:'VID-1'}),/explicit confirmation/);
  const linked=d.linkHistoricalToMaster(s,{historical_publication_id:ids[0],asset_id:'VID-1',confirmed:true});
  assert.equal(linked.asset_id,'VID-1');assert.equal(linked.match_confirmed,true);
  ok('matching suggests with reasons, refuses to link without explicit confirmation');
}
{ // review verdicts never rewrite history
  const s=d.seedState();
  const {ids}=d.importHistoricalPublications(s,[PH_ROW]);
  const before=structuredClone(s.historicalPublications[0]);
  d.setHistoricalReview(s,{historical_publication_id:ids[0],review_status:'RE-EDIT',notes:'cut a trailer from this'});
  const after=s.historicalPublications[0];
  assert.equal(after.review_status,'RE-EDIT');
  assert.equal(after.title,before.title);assert.equal(after.url,before.url);assert.equal(after.views,before.views);
  assert.equal(after.status,'HISTORICAL_BASELINE','the historical record is not deleted or rewritten');
  assert.throws(()=>d.setHistoricalReview(s,{historical_publication_id:ids[0],review_status:'DELETE'}),/KEEP, RE-EDIT, REPLACE or RETIRE/);
  ok('KEEP / RE-EDIT / REPLACE / RETIRE sets a verdict without altering the record');
}
const report={pass:true,total:checks.length,checks};
await fs.writeFile('tests/HISTORICAL_INTAKE_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
