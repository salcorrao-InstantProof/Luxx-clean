import {json} from '../lib/http.mjs';import {configured,verifySession} from '../lib/auth.mjs';
export default async req=>json({ok:true,configured:configured(),authenticated:verifySession(req)});export const config={path:'/api/session'};
