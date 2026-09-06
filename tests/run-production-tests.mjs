import assert from 'node:assert/strict';
process.env.LUXX_LOCAL_STORAGE_DIR='/tmp/luxx-test-unused';
const {choosePlan,scoreWindow}=await import('../netlify/lib/video.mjs');
const analysis={sceneTimes:[10,20,30,100,150,210,260,320,370,400],bad:[[60,75],[330,345]],silence:[[180,190]]};
const plan=choosePlan(420,analysis);
// THE FULL UPLOAD IS THE MASTER. RC2A truncated every source to 300s and called that the
// main cut, so a 30-minute upload silently became a 5-minute file.
assert.equal(plan.full_master.duration,420,'the master must span the whole 7-minute source');
assert.equal(plan.full_master.start,0,'the master must start at the beginning');
assert.equal(plan.master_is_full_source,true);
assert.equal(plan.main.duration,plan.full_master.duration,'the legacy alias must not reintroduce a truncation');
assert.equal(plan.teasers.length,3,'7-minute master should create 3 teasers by default');
for(const t of plan.teasers){assert(t.duration>=8&&t.duration<=20);assert(t.start>=0&&t.start+t.duration<=420.001);}
// Longer sources must not be truncated either.
for(const dur of [451,900,1800,2700]){
  const pl=choosePlan(dur,analysis);
  assert.equal(pl.full_master.duration,dur,`${dur}s source must keep its full duration`);
  assert.equal(pl.full_master.start,0);
  assert(pl.teasers.every(x=>x.start+x.duration<=dur+0.001),'a teaser must sit inside the source');
}
// A short source is still whole.
const short=choosePlan(45,analysis);
assert.equal(short.full_master.duration,45);
assert(Number.isFinite(scoreWindow(0,20,analysis)));
console.log(JSON.stringify({pass:true,test:'video-plan',plan},null,2));
