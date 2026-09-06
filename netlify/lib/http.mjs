export function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}})}
export function error(message,status=400,extra={}){return json({ok:false,error:message,...extra},status)}
export async function readJson(req){try{return await req.json()}catch{return null}}
export function cookieMap(req){const out={};for(const part of (req.headers.get('cookie')||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;}
