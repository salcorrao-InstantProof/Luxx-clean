import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const packagePath=path.join(root,'package.json');
const req=createRequire(packagePath);

function fail(msg){
  console.error(`[LUXX_ROOT_DEPENDENCY_PROOF] FAIL: ${msg}`);
  process.exit(2);
}

const packages=['@ffmpeg-installer/ffmpeg','@ffprobe-installer/ffprobe'];

for(const name of packages){
  try{
    console.log(`[LUXX_ROOT_DEPENDENCY_PROOF] ${name} module: ${req.resolve(name)}`);
  }catch(e){
    fail(`${name} cannot resolve from root package.json: ${e.message}`);
  }
}

let ffmpegPath,ffprobePath;
try{
  const f=req('@ffmpeg-installer/ffmpeg');
  const p=req('@ffprobe-installer/ffprobe');
  ffmpegPath=f?.path || f?.default?.path;
  ffprobePath=p?.path || p?.default?.path;
}catch(e){
  fail(`installer module load failed: ${e.message}`);
}

for(const [label,bin] of [['ffmpeg',ffmpegPath],['ffprobe',ffprobePath]]){
  if(!bin||typeof bin!=='string') fail(`${label} resolved to invalid path: ${String(bin)}`);
  if(!fs.existsSync(bin)) fail(`${label} binary missing at ${bin}`);
  try{
    fs.chmodSync(bin,0o755);
    const out=execFileSync(bin,['-version'],{
      encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
      timeout:15000
    });
    console.log(`[LUXX_ROOT_DEPENDENCY_PROOF] ${label} path: ${bin}`);
    console.log(`[LUXX_ROOT_DEPENDENCY_PROOF] ${label} version: ${String(out).split(/\r?\n/)[0]}`);
  }catch(e){
    fail(`${label} not executable at ${bin}: ${e.message}`);
  }
}

console.log('[LUXX_ROOT_DEPENDENCY_PROOF] PASS');
