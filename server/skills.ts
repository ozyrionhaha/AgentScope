import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { Skill, Workflow } from '../shared/contracts.ts';
import { workflowSchema, mcpSchema } from '../shared/contracts.ts';
import { relevance } from './context.ts';
import type { Store } from './storage.ts';
const headerSchema=z.object({name:z.string().min(1).max(160),description:z.string().min(1).max(5000)});
export function parseSkill(content:string){const front=content.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(!front?.[1])throw new Error('SKILL.md needs YAML frontmatter with name and description.');return headerSchema.parse(parse(front[1],{maxAliasCount:20}));}
export class Skills {
  private bundled:Skill[]=[];
  constructor(private store:Store,private root:string){}
  async load(){
    const manifest=JSON.parse(await fs.readFile(path.join(this.root,'skills','manifest.json'),'utf8')) as {id:string;path:string;source:string;license:string}[];
    const bundled:Skill[]=[];
    for(let i=0;i<manifest.length;i+=32){
      bundled.push(...await Promise.all(manifest.slice(i,i+32).map(async entry=>{const file=path.resolve(this.root,entry.path);const content=await fs.readFile(file,'utf8');const header=parseSkill(content);return {...header,...entry,path:file,content,scope:'builtin' as const,enabled:true};})));
    }
    this.bundled=bundled;
  }
  list(projectId?:string){const overrides=this.store.get<Record<string,boolean>>('settings','skills')??{};return [...this.bundled,...this.store.all<Skill>('skills')].filter(s=>s.scope!=='project'||s.projectId===projectId).map(s=>({...s,enabled:overrides[s.id]??s.enabled}));}
  select(query:string,projectId:string){return this.list(projectId).filter(s=>s.enabled).map(s=>({s,score:relevance(query,s.name.replace(/-/g,' '))*4+relevance(query,s.description)+(s.source==='ozy'?0.5:0)})).filter(v=>v.score>=2).sort((a,b)=>b.score-a.score).slice(0,3).map(v=>v.s);}
  get(id:string,projectId?:string){const available=this.list(projectId);const skill=available.find(s=>s.id===id)??available.find(s=>s.name===id);if(!skill)throw new Error('Skill not found.');return skill;}
  toggle(id:string,enabled:boolean){const values=this.store.get<Record<string,boolean>>('settings','skills')??{};values[id]=enabled;this.store.put('settings','skills',values);}
  save(input:{id?:string;content:string;scope:'global'|'project';projectId?:string}){const header=parseSkill(input.content);if(input.scope==='project'&&!input.projectId)throw new Error('Choose a project for this skill.');if(input.id&&this.bundled.some(s=>s.id===input.id))throw new Error('Duplicate a built-in skill before editing it.');const skill:Skill={...header,id:input.id??crypto.randomUUID(),content:input.content,scope:input.scope,projectId:input.projectId,enabled:true,source:'custom',license:'User supplied',path:''};this.store.put('skills',skill.id,skill);return skill;}
  async importDirectory(directory:string,scope:'global'|'project',projectId?:string){
    const source=await fs.realpath(directory);const content=await fs.readFile(path.join(source,'SKILL.md'),'utf8');parseSkill(content);
    const id=crypto.randomUUID(),target=path.join(this.store.directory,'skills',id);let bytes=0;
    const walk=async(dir:string)=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Skill imports cannot contain symlinks.');if(entry.name==='.git'||entry.name==='node_modules')continue;const full=path.join(dir,entry.name);if(entry.isDirectory())await walk(full);else{const stat=await fs.stat(full);bytes+=stat.size;if(bytes>25_000_000)throw new Error('Skill exceeds 25 MB.');}}};await walk(source);
    await fs.cp(source,target,{recursive:true,filter:src=>!src.split(path.sep).some(p=>p==='.git'||p==='node_modules')});
    const skill=this.save({id,content,scope,projectId});skill.path=path.join(target,'SKILL.md');this.store.put('skills',id,skill);return skill;
  }
  async resource(id:string,relative:string,projectId:string){const skill=this.get(id,projectId);if(!skill.enabled)throw new Error('Skill is disabled.');if(!skill.path)throw new Error('This skill has no resources.');const root=path.dirname(skill.path),target=path.resolve(root,relative);if(path.relative(root,target).startsWith('..')||path.isAbsolute(relative))throw new Error('Resource escapes its skill.');const real=await fs.realpath(target);if(path.relative(root,real).startsWith('..'))throw new Error('Resource symlink escapes its skill.');const stat=await fs.stat(real);if(stat.size>500000)throw new Error('Resource exceeds text limit.');return fs.readFile(real,'utf8');}
}
export const pluginSchema=z.object({id:z.string().regex(/^[a-z0-9-]+$/),name:z.string().min(1),version:z.string(),description:z.string(),author:z.string(),license:z.string(),skills:z.array(z.string()).default([]),mcp:z.array(mcpSchema).default([]),workflows:z.array(workflowSchema).default([])});
export type Plugin=z.infer<typeof pluginSchema>&{enabled:boolean;source:string};
export const builtinPlugins:Plugin[]=[
  {id:'ozy-engineering',name:'Engineering essentials',version:'1.0.0',description:'Debugging, code review, tests, refactoring, and Git. Ready to work in any repository.',author:'ozy',license:'MIT',skills:['debugging','coding','code-review','testing','refactoring','repository-analysis','git','github'].map(s=>`ozy/${s}`),mcp:[],workflows:[],enabled:true,source:'bundled'},
  {id:'ozy-web-studio',name:'Web studio',version:'1.0.0',description:'Frontend and backend development, API testing, authentication, and browser verification.',author:'ozy',license:'MIT',skills:['frontend','backend','rest-apis','api-testing','browser-testing','authentication','websockets'].map(s=>`ozy/${s}`),mcp:[],workflows:[],enabled:true,source:'bundled'},
  {id:'ozy-operations',name:'Operations desk',version:'1.0.0',description:'Docker, deployments, SQL, migrations, logs, and continuous delivery.',author:'ozy',license:'MIT',skills:['docker','deployment','sql','migrations','logs','cicd','environment'].map(s=>`ozy/${s}`),mcp:[],workflows:[],enabled:true,source:'bundled'},
  {id:'ozy-community',name:'Games & communities',version:'1.0.0',description:'Minecraft server plugins and Discord bots, with lifecycle, permissions, and testing guidance.',author:'ozy',license:'MIT',skills:['minecraft-plugins','discord-bots'].map(s=>`ozy/${s}`),mcp:[],workflows:[],enabled:true,source:'bundled'}
];
export class Plugins {
  constructor(private store:Store,private skills:Skills){}
  list(){return this.store.all<Plugin>('plugins');}
  async install(directory:string){
    const root=await fs.realpath(directory),manifest=pluginSchema.parse(JSON.parse(await fs.readFile(path.join(root,'agentscope.plugin.json'),'utf8')));
    if(this.store.get('plugins',manifest.id))throw new Error('A plugin with this ID is already installed.');
    const paths=await Promise.all(manifest.skills.map(async relative=>{const target=await fs.realpath(path.resolve(root,relative));if(path.relative(root,target).startsWith('..')||path.isAbsolute(relative))throw new Error('Plugin skill path escapes its directory.');parseSkill(await fs.readFile(path.join(target,'SKILL.md'),'utf8'));return target;}));
    const ids:string[]=[];for(const source of paths){const skill=await this.skills.importDirectory(source,'global');ids.push(skill.id);}
    const plugin={...manifest,skills:ids,enabled:true,source:root};
    this.store.transaction(()=>{for(const server of manifest.mcp)this.store.put('mcp',`${manifest.id}-${server.id}`,{...server,id:`${manifest.id}-${server.id}`,enabled:false});for(const workflow of manifest.workflows)this.store.put('workflows',`${manifest.id}-${workflow.id}`,{...workflow,id:`${manifest.id}-${workflow.id}`});this.store.put('plugins',manifest.id,plugin);});return plugin;
  }
  toggle(id:string,enabled:boolean){const plugin=this.store.get<Plugin>('plugins',id);if(!plugin)throw new Error('Plugin not found.');for(const skill of plugin.skills)this.skills.toggle(skill,enabled);for(const mcp of plugin.mcp){const key=`${id}-${mcp.id}`;const record=this.store.get<Record<string,unknown>>('mcp',key);if(record&&!enabled)this.store.put('mcp',key,{...record,enabled:false});}this.store.put('plugins',id,{...plugin,enabled});}
}
export const defaultWorkflows:Workflow[]=[
  {id:'ship-a-change',name:'Ship a change',description:'Inspect, implement, test, and review a focused change.',steps:[{name:'Understand',mode:'ask',prompt:'Inspect the repository and identify the smallest changes needed for the user request. Return a grounded implementation brief with relevant files and validation commands.'},{name:'Implement',mode:'code',prompt:'Implement the requested change using the preceding brief. Preserve existing changes and make focused edits.'},{name:'Verify',mode:'code',prompt:'Run the relevant tests for the implemented change. Inspect failures, fix problems, and review the resulting diff. Report actual evidence and any remaining limitations.'}]},
  {id:'security-review',name:'Security review',description:'Trace trust boundaries and verify actionable findings.',steps:[{name:'Map boundaries',mode:'ask',prompt:'Map untrusted inputs, authorization checks, secrets, and sensitive data flows. Cite file paths and line numbers.'},{name:'Review',mode:'ask',prompt:'Review the mapped boundaries for exploitable defects. Verify each finding against the source. Rank by impact and include concrete remediation; avoid speculative findings.'}]},
  {id:'debug-and-fix',name:'Debug & fix',description:'Reproduce a failure, repair its cause, and verify the result.',steps:[{name:'Investigate',mode:'code',prompt:'Reproduce the reported issue and identify its root cause. Use logs and focused tests. Do not make speculative edits.'},{name:'Fix & test',mode:'code',prompt:'Fix the established root cause with the smallest sound change. Add or run a regression test and inspect the final diff.'}]}
];
