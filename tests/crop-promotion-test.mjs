import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const html=await fs.readFile('public/index.html','utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];
const fit=src.match(/function variantFit\(a,v\)\{[\s\S]*?\n/)[0];
const bestFn=src.match(/function bestThumbVariant\(a\)\{[\s\S]*?\n/)[0];
const mod=new Function(`${fit}\n${bestFn}\nreturn {variantFit,bestThumbVariant}`)();
const V=(id,aspect,mode)=>({variant_id:id,thumbnail_key:'k/'+id,orientation_verified:true,privacy_safe_export:true,metadata_stripped:true,created_at:'2026-01-01T00:00:00Z',recipe:{processing_version:'ORIENTATION_VERIFIED_V3',aspect,mode,crop_verified:true}});

const both={media_type:'IMAGE',variants:[V('CROP','4:5','AUTO_BEST'),V('FULL','ORIGINAL','AUTO_BEST')]};
assert.equal(mod.bestThumbVariant(both).variant_id,'FULL','full frame must win over a verified crop');

const cropOnly={media_type:'IMAGE',variants:[V('CROP','9:16','AUTO_BEST')]};
assert.equal(mod.bestThumbVariant(cropOnly),null,'a crop must never be auto-selected as BEST VERSION even when it is the only derivative');

assert(mod.variantFit(both,V('CROP','1:1','AUTO_BEST'))<0,'crops must score below zero for auto-promotion');
assert(mod.variantFit(both,V('FULL','ORIGINAL','AUTO_BEST'))>0,'full frame must remain promotable');

const report={pass:true,test:'crop-promotion',checks:['full frame beats verified crop','crop alone is never auto-promoted','crop fit is negative']};
await fs.writeFile('tests/CROP_PROMOTION_RESULTS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
