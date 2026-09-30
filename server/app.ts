import express from 'express';
import type { Express, Request } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { providerSchema, settingsSchema, ruleSchema, memorySchema, workflowSchema, mcpSchema, modeSchema, type Project, type Provider, type Task, type Skill, type McpConfig, type Workflow } from '../shared/contracts.ts';
import { Store } from './storage.ts';
import { Vault } from './vault.ts';
import { Permissions } from './permissions.ts';
import { Providers, validateEndpoint, type ProviderAdapter } from './providers.ts';
import { ContextEngine } from './context.ts';
import { Skills, Plugins, defaultWorkflows, builtinPlugins } from './skills.ts';
import { Terminal } from './terminal.ts';
import { Mcp } from './mcp.ts';
import { BrowserTools } from './browser.ts';
import { ToolRegistry, gitStatus } from './tools.ts';
import { Runtime, type UsageRecord } from './runtime.ts';
import { Workspace, type Checkpoint } from './workspace.ts';
import { createPatch } from 'diff';

export async function createApp(options:{root:string;dataDirectory:string;port:number;adapter?:ProviderAdapter}){
  const store=new Store(options.dataDirectory),vault=new Vault(store),permissions=new Permissions(store),context=new ContextEngine(store),skills=new Skills(store,options.root),plugins=new Plugins(store,skills),terminal=new Terminal(store,t=>vault.redact(t)),mcp=new Mcp(),browser=new BrowserTools(store.directory);
  await skills.load();for(const workflow of defaultWorkflows)if(!store.get('workflows',workflow.id))store.put('workflows',workflow.id,workflow);
  for(const plugin of builtinPlugins)if(!store.get('plugins',plugin.id))store.put('plugins',plugin.id,plugin);
  const registry=new ToolRegistry({store,context,skills,permissions,terminal,mcp,browser});
  const runtime=new Runtime(store,options.adapter??new Providers(vault),context,registry,skills,terminal,vault);
  const app:Express=express();app.disable('x-powered-by');const session=randomBytes(32).toString('hex');
  app.use((req,res,next)=>{
    const allowed=new Set([`localhost:${options.port}`,`127.0.0.1:${options.port}`,`[::1]:${options.port}`]);
    if(!allowed.has(req.headers.host??'')){res.status(403).json({error:'Invalid local host.'});return;}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    if(req.path.startsWith('/api')){
      res.setHeader('Cache-Control','no-store');
      if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&!['http://localhost:'+options.port,'http://127.0.0.1:'+options.port].includes(req.headers.origin))){res.status(403).json({error:'Cross-origin requests are denied.'});return;}
      if(req.path!=='/api/session'){
        const token=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('agentscope_session='))?.split('=')[1]??'';
        if(token.length!==session.length||!timingSafeEqual(Buffer.from(token),Buffer.from(session))){res.status(401).json({error:'Open AgentScope locally to initialize your session.'});return;}
        if(req.method!=='GET'&&req.headers['x-agentscope']!=='1'){res.status(403).json({error:'Missing request protection header.'});return;}
      }
    }
    next();
  });
  app.use(express.json({limit:'3mb'}));
  app.get('/api/session',(_req,res)=>{res.cookie('agentscope_session',session,{httpOnly:true,sameSite:'strict',path:'/'});res.json({ok:true,vault:vault.status(),version:'0.1.0'});});
  const project=(id:string)=>{const p=store.get<Project>('projects',id);if(!p)throw new Error('Project not found.');return p;};
  const publicProviders=()=>store.all<Provider>('providers').map(p=>({...p,...vault.has(p.id)}));
  app.get('/api/state',(_req,res)=>res.json({projects:store.all('projects'),providers:publicProviders(),tasks:store.all<Task>('tasks'),settings:runtime.settings(),vault:vault.status(),approvals:permissions.list(),plugins:plugins.list(),workflows:store.all('workflows'),mcp:store.all('mcp'),skillCount:skills.list().length,skillSources:new Set(skills.list().map(s=>s.source)).size}));
  const attempts:number[]=[];
  app.post('/api/vault/unlock',async(req,res)=>{const {passphrase}=z.object({passphrase:z.string().min(12).max(1000)}).parse(req.body);const now=Date.now();while(attempts[0]&&attempts[0]<now-60000)attempts.shift();if(attempts.length>=5){res.status(429).json({error:'Too many attempts. Try again in one minute.'});return;}attempts.push(now);await vault.unlock(passphrase);attempts.length=0;res.json(vault.status());});
  app.post('/api/vault/lock',(_req,res)=>{if(runtime.busy())throw new Error('Stop active tasks before locking the vault.');vault.lock();res.json(vault.status());});
  app.post('/api/providers',(req,res)=>{const {provider,apiKey,headers}=z.object({provider:providerSchema,apiKey:z.string().max(10000).optional(),headers:z.record(z.string(),z.string()).optional()}).parse(req.body);validateEndpoint(provider.baseUrl);if(provider.models.some(m=>m.maxOutput>=m.contextSize))throw new Error('Max output must be smaller than the context window.');if(new Set(provider.models.map(m=>m.id)).size!==provider.models.length)throw new Error('Model IDs must be unique within a provider.');if(apiKey!==undefined||headers!==undefined){const previous=vault.get(provider.id);vault.set(provider.id,{apiKey:apiKey??previous.apiKey,headers:headers??previous.headers});}store.put('providers',provider.id,provider);res.json({...provider,...vault.has(provider.id)});});
  app.delete('/api/providers/:id',(req,res)=>{if(store.all<Task>('tasks').some(t=>t.providerId===req.params.id&&t.status==='running'))throw new Error('Stop tasks using this provider first.');vault.delete(req.params.id);store.delete('providers',req.params.id);res.json({ok:true});});
  app.post('/api/projects',async(req,res)=>{const {root}=z.object({root:z.string().min(1).max(2000)}).parse(req.body);const real=await fs.realpath(root);if(!(await fs.stat(real)).isDirectory())throw new Error('Choose a project directory.');const previous=store.all<Project>('projects').find(p=>p.root.toLowerCase()===real.toLowerCase());const p=previous??{id:crypto.randomUUID(),name:path.basename(real),root:real,createdAt:new Date().toISOString()};store.put('projects',p.id,p);await context.index(p);res.json(p);});
  app.get('/api/projects/:id/map',(req,res)=>res.json(store.get('maps',project(req.params.id).id)));
  app.post('/api/projects/:id/index',async(req,res)=>res.json(await context.index(project(req.params.id))));
  app.get('/api/projects/:id/search',(req,res)=>res.json(context.search(project(req.params.id).id,String(req.query.q??''),20)));
  app.get('/api/projects/:id/files',(req,res)=>res.json(context.files(project(req.params.id).id).map(f=>({path:f.path,language:f.language,size:f.size}))));
  app.get('/api/projects/:id/file',async(req,res)=>{const p=project(req.params.id);res.json(await new Workspace(p.root,store,p.id).read(z.string().parse(req.query.path)));});
  app.get('/api/projects/:id/git',async(req,res)=>res.json(await gitStatus(project(req.params.id).root)));
  app.post('/api/tasks',(req,res)=>{const input=z.object({projectId:z.string(),providerId:z.string(),modelId:z.string(),mode:modeSchema,title:z.string().optional()}).parse(req.body);res.json(runtime.create(input));});
  app.get('/api/tasks/:id',(req,res)=>res.json({task:runtime.task(req.params.id),events:store.history(req.params.id)}));
  app.post('/api/tasks/:id/run',(req,res)=>{const {prompt,workflowId}=z.object({prompt:z.string().min(1).max(64000),workflowId:z.string().optional()}).parse(req.body);const task=runtime.task(req.params.id);if(task.status==='running')throw new Error('Task is already running.');const workflow=workflowId?store.get<Workflow>('workflows',workflowId):undefined;if(workflowId&&!workflow)throw new Error('Workflow not found.');if(task.mode==='workflow'&&!workflow)throw new Error('Choose a workflow.');void runtime.run(task.id,prompt,{workflow}).catch(error=>store.emit(task.id,'error',{message:vault.redact(String(error))}));res.status(202).json({taskId:task.id});});
  app.post('/api/tasks/:id/stop',(req,res)=>{runtime.stop(req.params.id);res.json({ok:true});});
  app.get('/api/tasks/:id/events',(req,res)=>{
    runtime.task(req.params.id);res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();
    let last=Math.max(0,Number(req.headers['last-event-id']??req.query.after??0)||0);
    const write=(event:ReturnType<Store['emit']>)=>{if(event.taskId===req.params.id&&event.id>last){last=event.id;res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);}};
    const unsubscribe=runtime.listen(write);for(const event of store.history(req.params.id,last))write(event);
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);unsubscribe();});
  });
  app.get('/api/approvals',(_req,res)=>res.json(permissions.list()));
  app.post('/api/approvals/:id',(req,res)=>{permissions.respond(req.params.id,z.enum(['once','session','project','always','deny']).parse(req.body.choice));res.json({ok:true});});
  app.get('/api/rules',(_req,res)=>res.json(permissions.rules()));
  app.post('/api/rules',(req,res)=>{permissions.add(ruleSchema.parse(req.body));res.json({ok:true});});
  app.delete('/api/rules/:id',(req,res)=>{permissions.remove(req.params.id);res.json({ok:true});});
  app.get('/api/settings',(_req,res)=>res.json(runtime.settings()));
  app.post('/api/settings',(req,res)=>res.json(store.put('settings','app',settingsSchema.parse(req.body))));
  app.get('/api/skills',(req,res)=>res.json(skills.list(typeof req.query.projectId==='string'?req.query.projectId:undefined).map(({content:_,...s})=>s)));
  app.get('/api/skills/:id',(req,res)=>res.json(skills.get(req.params.id,typeof req.query.projectId==='string'?req.query.projectId:undefined)));
  app.post('/api/skills',(req,res)=>res.json(skills.save(z.object({id:z.string().optional(),content:z.string().max(100000),scope:z.enum(['global','project']),projectId:z.string().optional()}).parse(req.body))));
  app.post('/api/skills/import',async(req,res)=>{const a=z.object({directory:z.string(),scope:z.enum(['global','project']),projectId:z.string().optional()}).parse(req.body);res.json(await skills.importDirectory(a.directory,a.scope,a.projectId));});
  app.post('/api/skills/:id/toggle',(req,res)=>{skills.get(req.params.id,String(req.body.projectId??''));skills.toggle(req.params.id,z.boolean().parse(req.body.enabled));res.json({ok:true});});
  app.delete('/api/skills/:id',(req,res)=>{const skill=store.get<Skill>('skills',req.params.id);if(!skill)throw new Error('Built-in skills can be disabled, not deleted.');store.delete('skills',req.params.id);res.json({ok:true});});
  app.get('/api/memories',(req,res)=>res.json(store.all('memories').filter(m=>{const v=m as {scope:string;projectId?:string;taskId?:string};return v.scope==='user'||v.projectId===req.query.projectId||v.taskId===req.query.taskId;})));
  app.post('/api/memories',(req,res)=>{const m=memorySchema.parse(req.body);if(m.scope==='project'&&!m.projectId)throw new Error('Project memory requires a project.');if(m.scope==='conversation'&&!m.taskId)throw new Error('Conversation memory requires a task.');res.json(store.put('memories',m.id,m));});
  app.delete('/api/memories/:id',(req,res)=>{store.delete('memories',req.params.id);res.json({ok:true});});
  app.post('/api/workflows',(req,res)=>{const w=workflowSchema.parse(req.body);res.json(store.put('workflows',w.id,w));});
  app.delete('/api/workflows/:id',(req,res)=>{store.delete('workflows',req.params.id);res.json({ok:true});});
  app.post('/api/plugins/import',async(req,res)=>res.json(await plugins.install(z.string().parse(req.body.directory))));
  app.post('/api/plugins/:id/toggle',async(req,res)=>{plugins.toggle(req.params.id,z.boolean().parse(req.body.enabled));for(const server of store.all<McpConfig>('mcp'))if(!server.enabled)await mcp.disconnect(server.id);res.json({ok:true});});
  app.post('/api/mcp',async(req,res)=>{const config=mcpSchema.parse(req.body);if(config.transport==='http')validateEndpoint(config.url??'');if(config.transport==='stdio'&&!config.command)throw new Error('Enter an MCP command.');await mcp.disconnect(config.id);res.json(store.put('mcp',config.id,config));});
  app.delete('/api/mcp/:id',async(req,res)=>{await mcp.disconnect(req.params.id);store.delete('mcp',req.params.id);res.json({ok:true});});
  app.post('/api/mcp/:id/inspect',async(req,res)=>{const config=store.get<McpConfig>('mcp',req.params.id);if(!config)throw new Error('MCP server not found.');res.json(await mcp.tools(config));});
  app.get('/api/terminals',(_req,res)=>res.json(terminal.list()));
  app.post('/api/terminals',async(req,res)=>{const {projectId,command}=z.object({projectId:z.string(),command:z.string().min(1).max(16000)}).parse(req.body);const p=project(projectId);res.json(await terminal.run('manual',p.root,command,3600000,true,new AbortController().signal));});
  app.post('/api/terminals/:id/stop',(req,res)=>{terminal.stop(req.params.id);res.json({ok:true});});
  app.get('/api/usage',(_req,res)=>res.json(store.all<UsageRecord>('usage')));
  app.get('/api/checkpoints',async(req,res)=>{const checkpoints=store.all<Checkpoint>('checkpoints').filter(c=>c.projectId===req.query.projectId);const results=await Promise.all(checkpoints.map(async c=>{let current='';try{current=(await new Workspace(project(c.projectId).root,store,c.projectId).read(c.path)).content;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return {...c,diff:createPatch(c.path,c.before??'',current)};}));res.json(results);});
  app.post('/api/checkpoints/restore',async(req,res)=>{const cp=store.get<Checkpoint>('checkpoints',z.string().parse(req.body.id));if(!cp)throw new Error('Checkpoint not found.');if(store.all<Task>('tasks').some(t=>t.projectId===cp.projectId&&t.status==='running'))throw new Error('Stop active project tasks before restoring.');const p=project(cp.projectId);res.json(await new Workspace(p.root,store,p.id).restore(cp));});
  app.get('/api/screenshots/:id',async(req,res)=>{const id=z.string().uuid().parse(req.params.id);res.sendFile(path.join(store.directory,'screenshots',`${id}.png`));});
  app.post('/api/compare',(req,res)=>{const a=z.object({projectId:z.string(),prompt:z.string().min(1).max(16000),models:z.array(z.object({providerId:z.string(),modelId:z.string()})).min(2).max(4)}).parse(req.body);const parent=runtime.create({...a.models[0]!,projectId:a.projectId,mode:'ask',title:'Compare: '+a.prompt.slice(0,50)});void runtime.compare(parent.id,a.prompt,a.models).catch(error=>store.emit(parent.id,'error',{message:vault.redact(String(error))}));res.json({parent});});
  const errorHandler:express.ErrorRequestHandler=(error:unknown,_req:Request,res,next)=>{if(res.headersSent){next(error);return;}const message=error instanceof z.ZodError?'Invalid request: '+error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(';'):error instanceof Error?error.message:'Unexpected local service error.';res.status(400).json({error:vault.redact(message)});};
  app.use('/api',errorHandler);
  const close=async()=>{terminal.stopAll();await runtime.shutdown();await mcp.close();await browser.close();vault.lock();store.close();};
  return {app,store,vault,permissions,context,skills,runtime,terminal,close};
}
