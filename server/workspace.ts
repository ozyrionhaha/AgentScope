import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyPatch, createPatch } from 'diff';
import type { Store } from './storage.ts';
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const sensitive=/(^|\/)(\.git|\.agentscope|\.ssh|\.aws|\.azure)(\/|$)|(^|\/)(\.env(?:\.|$)|\.npmrc$|\.pypirc$|credentials(?:\.json)?$|id_rsa(?:\.|$)|id_ed25519(?:\.|$))|\.(pem|key|p12|pfx)$/i;
export class Workspace {
  constructor(readonly root:string,private store:Store,readonly projectId:string){}
  async resolve(relative:string,allowSecret=false):Promise<string>{
    if(!relative||relative.includes('\0')||path.isAbsolute(relative)||relative.includes(':'))throw new Error('Use a relative workspace path.');
    const normalized=relative.replace(/\\/g,'/');
    if(!allowSecret&&sensitive.test(normalized))throw new Error('Protected credential or internal path.');
    const root=await fs.realpath(this.root),target=path.resolve(root,relative),rel=path.relative(root,target);
    if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Path is outside this project.');
    let cursor=root;
    for(const part of rel.split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,part);
      try{const s=await fs.lstat(cursor);if(s.isSymbolicLink())throw new Error('Symbolic links and junctions are not permitted.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    }
    return target;
  }
  async read(file:string){const target=await this.resolve(file);const stat=await fs.stat(target);if(!stat.isFile()||stat.size>2_000_000)throw new Error('Read text files up to 2 MB.');const content=await fs.readFile(target,'utf8');if(content.includes('\0'))throw new Error('Binary files are not supported by text tools.');return {path:file,content,hash:hash(content)};}
  async write(file:string,content:string,expectedHash:string|null,taskId:string){
    if(Buffer.byteLength(content)>2_000_000)throw new Error('File exceeds 2 MB.');
    const target=await this.resolve(file);let before:string|null=null;
    try{before=(await this.read(file)).content;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if((before===null?null:hash(before))!==expectedHash)throw new Error('File changed since it was read. Read it again before editing.');
    const key=`${taskId}:${file}`;const existing=this.store.get<Checkpoint>('checkpoints',key);
    const checkpoint:Checkpoint=existing??{id:key,taskId,projectId:this.projectId,path:file,before,afterHash:null,createdAt:new Date().toISOString()};
    this.store.put('checkpoints',key,checkpoint);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await this.resolve(file);
    const temp=`${target}.agentscope-${crypto.randomUUID()}.tmp`;
    try{await fs.writeFile(temp,content,{flag:'wx',mode:0o600});await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
    this.store.put('checkpoints',key,{...checkpoint,afterHash:hash(content)});
    return {path:file,hash:hash(content),diff:createPatch(file,before??'',content)};
  }
  async patch(file:string,patch:string,expectedHash:string,taskId:string){const read=await this.read(file);if(read.hash!==expectedHash)throw new Error('Stale file hash.');const updated=applyPatch(read.content,patch);if(updated===false)throw new Error('Patch does not apply exactly. Re-read the file.');return this.write(file,updated,expectedHash,taskId);}
  async remove(file:string,expectedHash:string,taskId:string){const old=await this.read(file);if(old.hash!==expectedHash)throw new Error('Stale file hash.');const key=`${taskId}:${file}`;const existing=this.store.get<Checkpoint>('checkpoints',key);this.store.put('checkpoints',key,{...existing,id:key,taskId,projectId:this.projectId,path:file,before:existing?existing.before:old.content,afterHash:null,createdAt:existing?.createdAt??new Date().toISOString()});await fs.unlink(await this.resolve(file));return {deleted:file};}
  async restore(checkpoint:Checkpoint){
    if(checkpoint.projectId!==this.projectId)throw new Error('Checkpoint belongs to another project.');
    let current:string|null=null;try{current=(await this.read(checkpoint.path)).content;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if((current===null?null:hash(current))!==checkpoint.afterHash)throw new Error('This file has later changes. Compare before restoring to preserve your work.');
    const target=await this.resolve(checkpoint.path);
    if(checkpoint.before===null)await fs.rm(target,{force:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,checkpoint.before);}
    this.store.delete('checkpoints',checkpoint.id);return {restored:checkpoint.path};
  }
}
export interface Checkpoint { id:string;taskId:string;projectId:string;path:string;before:string|null;afterHash:string|null;createdAt:string }
