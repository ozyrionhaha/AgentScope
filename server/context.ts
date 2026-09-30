import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import ts from 'typescript';
import { createPatch } from 'diff';
import { Workspace } from './workspace.ts';
import type { FileRecord, Memory, Message, Project } from '../shared/contracts.ts';
import type { Store } from './storage.ts';
export const estimateTokens=(text:string)=>Math.ceil(Buffer.byteLength(text,'utf8')/3);
const terms=(text:string)=>text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(t=>t.length>2);
export function relevance(query:string,text:string){const words=new Set(terms(text));return [...new Set(terms(query))].reduce((sum,t)=>sum+(words.has(t)?1:0),0);}
export function compressOutput(raw:string,max=12000){
  if(raw.length<=max)return {text:raw,originalChars:raw.length,keptChars:raw.length,removedChars:0};
  const lines=raw.split('\n');const important=lines.filter(l=>/error|warn|fail|exception|fatal|passed|exit code/i.test(l)).slice(0,70).join('\n');
  const text=`${raw.slice(0,max/4)}\n[… output omitted; full output is in the timeline …]\n${important.slice(0,max/2)}\n${raw.slice(-max/4)}`.slice(0,max);
  return {text,originalChars:raw.length,keptChars:text.length,removedChars:raw.length-text.length};
}
export function compressConversation(messages:Message[],budget:number){
  if(estimateTokens(JSON.stringify(messages))<=budget)return {messages,removedChars:0};
  const groups:Message[][]=[];
  for(const m of messages){if(m.role==='user'||groups.length===0)groups.push([m]);else groups.at(-1)!.push(m);}
  if(groups.length<3)return {messages,removedChars:0};
  const older=groups.slice(0,-2).flat(),recent=groups.slice(-2).flat();
  const summary=older.map(m=>`${m.role.toUpperCase()}: ${compressOutput(m.content,1800).text}${m.toolCalls?`\nActions: ${JSON.stringify(m.toolCalls).slice(0,2000)}`:''}`).join('\n');
  const compressed:Message[]=[{role:'user',content:`Earlier task record (extractive, may omit details; original history remains accessible):\n${compressOutput(summary,Math.max(2000,budget*2)).text}`},...recent];
  return {messages:compressed,removedChars:Math.max(0,JSON.stringify(messages).length-JSON.stringify(compressed).length)};
}
function symbols(file:string,text:string):FileRecord['symbols']{
  if(/\.[cm]?[jt]sx?$/.test(file)){
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const found:FileRecord['symbols']=[];
    const visit=(node:ts.Node)=>{if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isMethodDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isVariableDeclaration(node))&&node.name){found.push({name:node.name.getText(source),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,end:source.getLineAndCharacterOfPosition(node.end).line+1});}ts.forEachChild(node,visit);};visit(source);return found.slice(0,500);
  }
  return text.split('\n').flatMap((line,i)=>{const m=line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:def|fn|func|class|struct|interface|function)\s+(\w+)/);return m?.[1]?[{name:m[1],line:i+1,end:i+30}]:[];});
}
export class ContextEngine {
  constructor(private store:Store){}
  async index(project:Project){
    const ws=new Workspace(project.root,this.store,project.id);const ign=ignore().add(['.git/','.agentscope/','node_modules/','dist/','build/','coverage/','.next/','vendor/','.venv/','*.lock','pnpm-lock.yaml','package-lock.json','skills/community/']);
    try{ign.add(await fs.readFile(path.join(project.root,'.gitignore'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const files:FileRecord[]=[];let reused=0;const seen=new Set<string>();const skipped:{path:string;reason:string}[]=[];
    const walk=async(dir:string)=>{
      if(files.length>=5000)return;
      for(const entry of await fs.readdir(path.join(project.root,dir),{withFileTypes:true})){
        const relative=path.posix.join(dir,entry.name);if(ign.ignores(relative+(entry.isDirectory()?'/':''))||entry.isSymbolicLink())continue;
        if(entry.isDirectory()){await walk(relative);continue;}if(!entry.isFile()||files.length>=5000)continue;
        try{const stat=await fs.stat(await ws.resolve(relative));if(stat.size>400000)continue;const {content,hash:digest}=await ws.read(relative);seen.add(relative);
          const row=this.store.db.prepare('SELECT hash,data FROM files WHERE project_id=? AND path=?').get(project.id,relative);
          if(row?.hash===digest){files.push(JSON.parse(String(row.data)) as FileRecord);reused++;continue;}
          const syms=symbols(relative,content);const record:FileRecord={path:relative,hash:digest,size:stat.size,language:path.extname(relative).slice(1)||'text',summary:`${relative} (${content.split('\n').length} lines). ${syms.slice(0,30).map(s=>`${s.name}:${s.line}`).join(', ')}\n${content.split('\n').filter(l=>/^\s*(import |from |require\(|#|\/\/|\/\*)/.test(l)).slice(0,8).join('\n')}`,symbols:syms,text:content};
          this.store.db.prepare('INSERT INTO files VALUES(?,?,?,?) ON CONFLICT(project_id,path) DO UPDATE SET hash=excluded.hash,data=excluded.data').run(project.id,relative,digest,JSON.stringify(record));files.push(record);
        }catch(e){skipped.push({path:relative,reason:e instanceof Error?e.message:String(e)});}
      }
    };await walk('');
    for(const row of this.store.db.prepare('SELECT path FROM files WHERE project_id=?').all(project.id))if(!seen.has(String(row.path)))this.store.db.prepare('DELETE FROM files WHERE project_id=? AND path=?').run(project.id,String(row.path));
    const map={files:files.length,reused,languages:[...new Set(files.map(f=>f.language))],directories:[...new Set(files.map(f=>f.path.split('/')[0]))].slice(0,60),manifests:files.filter(f=>/(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|pom\.xml|Dockerfile|compose\.ya?ml|\.github\/workflows\/)/.test(f.path)).map(f=>({path:f.path,summary:f.text.slice(0,6000)})),indexedAt:new Date().toISOString(),limited:files.length>=5000};
    this.store.put('maps',project.id,{...map,skipped});return {...map,skipped};
  }
  files(projectId:string){return this.store.db.prepare('SELECT data FROM files WHERE project_id=?').all(projectId).map(r=>JSON.parse(String(r.data)) as FileRecord);}
  search(projectId:string,query:string,limit=8){return this.files(projectId).map(file=>({file,score:relevance(query,file.text)+relevance(query,file.path)*4+relevance(query,file.summary)*2})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(({file,score})=>{const lines=file.text.split('\n');const line=lines.findIndex(l=>relevance(query,l)>0);const sym=file.symbols.find(s=>s.line<=line+1&&s.end>=line+1);const start=Math.max(0,sym?sym.line-1:line-5);const end=Math.min(lines.length,start+90,sym?Math.max(sym.end,start+15):start+50);return {path:file.path,score,hash:file.hash,start:start+1,end,symbols:file.symbols.filter(s=>s.line>=start&&s.line<=end),snippet:lines.slice(start,end).join('\n'),fullChars:file.text.length};});}
  retrieve(projectId:string,taskId:string,query:string,budget:number){
    const found=this.search(projectId,query,10);const parts:string[]=[];let originalChars=0,reused=0;
    for(const item of found){const key=`${taskId}:${item.path}:${item.start}:${item.end}`;const previous=this.store.get<{hash:string;snippet:string}>('seen',key);let value=`${item.path}:${item.start}-${item.end}\n${item.snippet}`;
      if(previous?.hash===item.hash){value=`${item.path}:${item.start}-${item.end} unchanged (hash ${item.hash.slice(0,10)}); use file_read if this excerpt is no longer in conversation.`;reused++;}else if(previous){const patch=createPatch(item.path,previous.snippet,item.snippet);if(patch.length<item.snippet.length)value=`Changed excerpt:\n${patch}`;}
      if(estimateTokens(parts.join('\n')+value)>budget)break;parts.push(value);originalChars+=item.fullChars;this.store.put('seen',key,{hash:item.hash,snippet:item.snippet});
    }
    const text=parts.join('\n\n');return {text,originalChars,selectedChars:text.length,reused,estimatedTokens:estimateTokens(text)};
  }
  memories(projectId:string,taskId:string,query:string){return this.store.all<Memory>('memories').filter(m=>m.scope==='user'||(m.scope==='project'&&m.projectId===projectId)||(m.scope==='conversation'&&m.taskId===taskId)).map(m=>({m,score:relevance(query,m.title+' '+m.content)})).filter(v=>v.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(v=>v.m);}
}
