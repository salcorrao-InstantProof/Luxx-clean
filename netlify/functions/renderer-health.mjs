import {spawn} from 'node:child_process';
import {json,error} from '../lib/http.mjs';
import {verifySession} from '../lib/auth.mjs';
import {resolveVideoBinaries} from '../lib/video.mjs';
function run(bin,args){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve((out||err).split('\n')[0]):reject(new Error((err||out||`exit ${c}`).slice(0,1000))));});}
export default async req=>{if(!verifySession(req))return error('Unauthorized',401);try{const {ffmpeg,ffprobe}=await resolveVideoBinaries();const [fv,pv]=await Promise.all([run(ffmpeg,['-version']),run(ffprobe,['-version'])]);return json({ok:true,renderer:'READY',ffmpeg:fv,ffprobe:pv,architecture:process.arch,platform:process.platform});}catch(e){return error(String(e?.message||e),500,{renderer:'NOT_READY',architecture:process.arch,platform:process.platform});}};
export const config={path:'/api/renderer-health'};
