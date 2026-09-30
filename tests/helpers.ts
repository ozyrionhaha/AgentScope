import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/storage.ts';
export async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'agentscope-test-'));const project=path.join(root,'project');await fs.mkdir(project);const store=new Store(path.join(root,'data'));return {root,project,store,async close(){store.close();await cleanup(root);}};}
export async function cleanup(root:string){const real=path.resolve(root),tmp=path.resolve(os.tmpdir());if(!real.startsWith(tmp+path.sep)||!path.basename(real).startsWith('agentscope-test-'))throw new Error('Unsafe test cleanup target.');await fs.rm(real,{recursive:true,force:true,maxRetries:5});}
