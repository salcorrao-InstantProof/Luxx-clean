import crypto from 'node:crypto';
export const id=(p)=>`${p}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
export const cleanId=(x)=>String(x||'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,160);
