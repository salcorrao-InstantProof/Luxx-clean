import {json,error,readJson} from '../lib/http.mjs';
import {configured,verifyPasscode,makeSession,sessionCookie} from '../lib/auth.mjs';
export default async req=>{if(req.method!=='POST')return error('Method not allowed',405);if(!configured())return error('LUXX server is not configured. Set LUXX_PASSCODE and LUXX_SESSION_SECRET in Netlify.',503,{setup_required:true});const body=await readJson(req);if(!verifyPasscode(body?.passcode))return error('Incorrect passcode',401);return json({ok:true},200,{'set-cookie':sessionCookie(makeSession())});};
export const config={path:'/api/login',rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip']}};
