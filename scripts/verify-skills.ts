import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseSkill } from '../server/skills.ts';
const manifest=JSON.parse(await fs.readFile('skills/manifest.json','utf8')) as {id:string;path:string;sha256:string;source:string}[];
const ids=new Set<string>();for(const entry of manifest){if(ids.has(entry.id))throw new Error(`Duplicate ${entry.id}`);ids.add(entry.id);const text=await fs.readFile(entry.path,'utf8');parseSkill(text);if(createHash('sha256').update(text).digest('hex')!==entry.sha256)throw new Error(`Integrity mismatch: ${entry.path}`);}
console.log(`${ids.size} skill manifests verified; ${new Set(manifest.map(m=>m.source)).size} sources.`);
