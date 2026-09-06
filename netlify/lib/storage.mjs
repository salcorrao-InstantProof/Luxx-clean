import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Content-derived etag so change detection behaves the same locally as on Netlify Blobs.
function etagFor(buf){return '"'+crypto.createHash('sha256').update(buf).digest('hex').slice(0,32)+'"';}

const LOCAL_ROOT = process.env.LUXX_LOCAL_STORAGE_DIR || '';

function safeKey(key){
  const clean=String(key||'').replaceAll('\\','/').replace(/^\/+/, '');
  if(!clean || clean.split('/').some(p=>p==='..')) throw new Error('Invalid blob key');
  return clean;
}

class LocalStore {
  constructor(name){ this.root=path.join(LOCAL_ROOT,name); }
  async set(key,value,{metadata={}}={}){
    key=safeKey(key); const fp=path.join(this.root,key); await fs.mkdir(path.dirname(fp),{recursive:true});
    let buf;
    if(typeof value==='string') buf=Buffer.from(value);
    else if(value instanceof ArrayBuffer) buf=Buffer.from(value);
    else if(ArrayBuffer.isView(value)) buf=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
    else if(value && typeof value.arrayBuffer==='function') buf=Buffer.from(await value.arrayBuffer());
    else throw new Error('Unsupported local blob value');
    // Writes are atomic: a concurrent reader must never observe a half-written blob.
    // Without this, two overlapping requests could tear the state file and the reader
    // got 'Unexpected end of JSON input' from a partially flushed write.
    const tmp=`${fp}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp,buf); await fs.rename(tmp,fp);
    const mtmp=`${fp}.meta.json.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(mtmp,JSON.stringify(metadata)); await fs.rename(mtmp,fp+'.meta.json');
    return {modified:true,etag:etagFor(buf)};
  }
  async setJSON(key,value,opts={}){ return this.set(key,JSON.stringify(value),opts); }
  async get(key,{type='text'}={}){
    key=safeKey(key); try { const b=await fs.readFile(path.join(this.root,key));
      if(type==='arrayBuffer') return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
      if(type==='blob') return new Blob([b]);
      if(type==='json'){
        const text=b.toString('utf8');
        // A zero-length read means the key exists but holds nothing usable yet. Report it
        // as absent rather than throwing a parse error out of the storage layer.
        if(!text.trim()) return null;
        return JSON.parse(text);
      }
      if(type==='stream') return new ReadableStream({start(c){c.enqueue(b);c.close();}});
      return b.toString('utf8');
    } catch(e){ if(e.code==='ENOENT') return null; throw e; }
  }
  async getWithMetadata(key,{type='text'}={}){
    const data=await this.get(key,{type}); if(data===null)return null;
    let metadata={}; try{metadata=JSON.parse(await fs.readFile(path.join(this.root,safeKey(key)+'.meta.json'),'utf8'));}catch{}
    return {data,metadata,etag:'"local"'};
  }
  async getMetadata(key){const x=await this.getWithMetadata(key); return x?{metadata:x.metadata,etag:x.etag}:null;}
  async delete(key){key=safeKey(key); await fs.rm(path.join(this.root,key),{force:true});await fs.rm(path.join(this.root,key)+'.meta.json',{force:true});}
  async list({prefix=''}={}){
    const out=[]; const base=this.root; const walk=async(d)=>{let ents=[];try{ents=await fs.readdir(d,{withFileTypes:true});}catch{return;} for(const e of ents){const fp=path.join(d,e.name);if(e.isDirectory())await walk(fp);else if(!e.name.endsWith('.meta.json')&&!e.name.includes('.tmp-')){const key=path.relative(base,fp).split(path.sep).join('/');if(key.startsWith(prefix)){let etag='"0"';try{etag=etagFor(await fs.readFile(fp))}catch{}out.push({key,etag});}}}}; await walk(base); return {blobs:out};
  }
}

export async function store(name){
  if(LOCAL_ROOT) return new LocalStore(name);
  const {getStore}=await import('@netlify/blobs');
  return getStore(name);
}
