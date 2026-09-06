import crypto from 'node:crypto';
import {cookieMap} from './http.mjs';
import {EMBEDDED_PASSCODE,EMBEDDED_SESSION_SECRET} from './embedded-secret.mjs';
const COOKIE='luxx_session';
const MAX_AGE=60*60*24*30;
function secret(){return process.env.LUXX_SESSION_SECRET||EMBEDDED_SESSION_SECRET||''}
function passcode(){return process.env.LUXX_PASSCODE||EMBEDDED_PASSCODE||''}
function sign(payload){return crypto.createHmac('sha256',secret()).update(payload).digest('base64url')}
export function configured(){return !!(secret()&&passcode())}
export function makeSession(){const payload=Buffer.from(JSON.stringify({v:1,exp:Date.now()+MAX_AGE*1000})).toString('base64url');return payload+'.'+sign(payload)}
export function sessionCookie(value){return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`}
export function clearCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}
export function verifySession(req){if(process.env.LUXX_LOCAL_AUTH_BYPASS==='1')return true;if(!configured())return false;const token=cookieMap(req)[COOKIE]||'';const [payload,sig]=token.split('.');if(!payload||!sig)return false;const a=Buffer.from(sig),b=Buffer.from(sign(payload));if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return false;try{const p=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return p.exp>Date.now();}catch{return false}}
export function verifyPasscode(value){if(!configured())return false;const a=crypto.createHash('sha256').update(String(value||'')).digest(),b=crypto.createHash('sha256').update(passcode()).digest();return crypto.timingSafeEqual(a,b)}
