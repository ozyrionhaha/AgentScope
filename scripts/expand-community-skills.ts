/** Append licensed, deduplicated skills from local upstream checkouts. Never executes upstream code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { parseSkill } from '../server/skills.ts';

interface Entry { id:string; path:string; source:string; license:string; revision?:string; sha256:string }
interface Audit { source:string; revision:string; included:number; excluded:{path:string;reason:string}[] }
const root = path.resolve(process.argv[2] ?? '../../work/more-skills');
const manifest = JSON.parse(await fs.readFile('skills/manifest.json','utf8')) as Entry[];
const initialCount = manifest.length;
const names = new Set<string>(), hashes = new Set<string>();
const canonicalName = (s:string) => s.toLowerCase().replace(/[ _]+/g,'-');
const hash = (s:string) => createHash('sha256').update(s.replaceAll('\r\n','\n').trim()).digest('hex');
for(const entry of manifest){const text=await fs.readFile(entry.path,'utf8'); names.add(canonicalName(parseSkill(text).name));hashes.add(hash(text));}
const ignored = new Set(['.git','node_modules','__pycache__','.venv','tests','test','fixtures','evals','benchmarks','.hermes','.vibe','.agents','.cursor']);
async function walk(directory:string):Promise<string[]>{
  const files:string[]=[];
  for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(ignored.has(entry.name)||entry.isSymbolicLink())continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())files.push(...await walk(file));else if(entry.name==='SKILL.md')files.push(file);
  }
  return files;
}
const licenseType = (text:string) => /Apache License[\s\S]{0,100}Version 2\.0/.test(text)?'Apache-2.0':/Permission is hereby granted, free of charge/.test(text)?'MIT':/ISC License/.test(text)?'ISC':/Redistribution and use in source and binary forms/.test(text)?'BSD':/Creative Commons Attribution 4\.0 International/.test(text)?'CC-BY-4.0':undefined;
const audits:Audit[]=[];
const order=['K-Dense-AI-claude-scientific-skills','Jeffallan-claude-skills','alirezarezvani-claude-skills','microsoft-skills','anthropics-knowledge-work-plugins','affaan-m-everything-claude-code','softaworks-agent-toolkit','wshobson-agents','JayRHa-AgentSkills','ComposioHQ-awesome-claude-skills','davila7-claude-code-templates','sickn33-agentic-awesome-skills'];
await fs.mkdir('docs/licenses',{recursive:true});
const apacheFile=path.resolve('docs/licenses/Apache-2.0.txt');
await fs.writeFile(apacheFile,await (await fetch('https://www.apache.org/licenses/LICENSE-2.0.txt')).text());
const ccFile=path.resolve('docs/licenses/CC-BY-4.0.txt');
await fs.writeFile(ccFile,await (await fetch('https://creativecommons.org/licenses/by/4.0/legalcode.txt')).text());

for(const directory of order){
  const checkout=path.join(root,directory);
  const source=execFileSync('git',['remote','get-url','origin'],{cwd:checkout,encoding:'utf8'}).trim().replace(/\.git$/,'');
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
  const report:Audit={source,revision,included:0,excluded:[]};
  const scanRoot=directory==='sickn33-agentic-awesome-skills'?path.join(checkout,'skills'):checkout;
  const directoryCache=new Map<string,string[]>();
  const directoryNames=async(dir:string)=>{let value=directoryCache.get(dir);if(!value){value=await fs.readdir(dir);directoryCache.set(dir,value);}return value;};
  for(const file of await walk(scanRoot)){
    const relative=path.relative(checkout,file).replaceAll('\\','/');
    const exclude=(reason:string)=>report.excluded.push({path:relative,reason});
    const text=await fs.readFile(file,'utf8');
    let header:ReturnType<typeof parseSkill>,metadata:Record<string,unknown>;
    try{header=parseSkill(text);metadata=parse(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!,{maxAliasCount:20}) as Record<string,unknown>;}catch{exclude('Invalid skill frontmatter');continue;}
    if(names.has(canonicalName(header.name))||hashes.has(hash(text))){exclude('Duplicate skill name or content');continue;}
    if(text.length>500000){exclude('Skill instructions exceed 500 KB');continue;}
    const declared=String(metadata.license??'');
    if(/proprietary|\b(?:A?GPL)|noncommercial|\bNC\b|polyform|FSL-|unknown|not declared/i.test(declared)){exclude('Restricted or unresolved declared license');continue;}
    let cursor=path.dirname(file),licenseFile:string|undefined,license:string|undefined;
    const notices:string[]=[];
    while(true){
      const files=await directoryNames(cursor);
      const legal=files.filter(n=>/^(?:LICENSE(?:-CONTENT)?|COPYING|NOTICE)(?:\.(?:md|txt))?$/i.test(n));
      notices.push(...legal.map(n=>path.join(cursor,n)));
      if(!licenseFile){
        const chosen=legal.find(n=>/^LICENSE-CONTENT$/i.test(n))??legal.find(n=>/^(LICENSE|COPYING)(?:\.|$)/i.test(n));
        if(chosen){licenseFile=path.join(cursor,chosen);license=licenseType(await fs.readFile(licenseFile,'utf8'));}
      }
      if(cursor===checkout)break;
      cursor=path.dirname(cursor);
    }
    // This upstream declares Apache-2.0 in its README rather than a root LICENSE.
    if(!licenseFile&&directory==='ComposioHQ-awesome-claude-skills'){
      const readme=await fs.readFile(path.join(checkout,'README.md'),'utf8');
      if(readme.includes('This repository is licensed under the Apache License 2.0.')){license='Apache-2.0';licenseFile=apacheFile;notices.push(path.join(checkout,'README.md'));}
    }
    if(!license||!licenseFile){exclude('No complete supported upstream license');continue;}
    if(declared&&!/complete terms|^LICENSE$/i.test(declared)){
      const declaredType=/Apache/i.test(declared)?'Apache-2.0':/\bMIT\b/i.test(declared)?'MIT':/\bBSD\b/i.test(declared)?'BSD':/CC.BY|creativecommons.org\/licenses\/by\/4.0/i.test(declared)?'CC-BY-4.0':undefined;
      if(!declaredType||declaredType!==license){exclude('Declared license requires separate upstream review');continue;}
    }
    if(directory==='sickn33-agentic-awesome-skills'){
      const sourceField=String(metadata.source??'community');
      if(!['community','self','personal'].includes(sourceField)&&path.dirname(licenseFile)===checkout){exclude('Third-party adaptation requires its original license notice');continue;}
      if(['cloud-penetration-testing','active-directory-attacks','owasp-top-10','react-patterns'].includes(header.name)){exclude('Separate upstream attribution/license exception');continue;}
      notices.push(path.join(checkout,'docs/sources/sources.md'));
    }
    let bytes=0,unsafe=false;
    async function inspectAssets(dir:string){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(ignored.has(e.name))continue;const p=path.join(dir,e.name);if(e.isSymbolicLink()){unsafe=true;continue;}if(e.isDirectory())await inspectAssets(p);else bytes+=(await fs.stat(p)).size;}}
    await inspectAssets(path.dirname(file));
    if(unsafe||bytes>25_000_000){exclude(unsafe?'Contains symbolic links requiring manual review':'Skill package exceeds 25 MB');continue;}
    const id=`${directory}/${path.relative(checkout,path.dirname(file)).replaceAll('\\','/')}`;
    const dest=path.resolve('skills/community',id);await fs.mkdir(dest,{recursive:true});
    await fs.cp(path.dirname(file),dest,{recursive:true,filter:p=>!p.split(path.sep).some(part=>ignored.has(part))});
    await fs.copyFile(licenseFile,path.join(dest,'UPSTREAM-LICENSE.txt'));
    for(const [i,notice] of [...new Set(notices)].entries())await fs.copyFile(notice,path.join(dest,`UPSTREAM-NOTICE-${i}-${path.basename(notice)}`));
    if(license==='CC-BY-4.0')await fs.copyFile(ccFile,path.join(dest,'CC-BY-4.0.txt'));
    await fs.writeFile(path.join(dest,'PROVENANCE.json'),JSON.stringify({source,revision,path:relative,license,modified:false,author:metadata.author??metadata.source??source.split('/').at(-2),notes:'Original instructions and local assets retained. No install hooks or scripts executed.'},null,2));
    manifest.push({id,path:path.relative(process.cwd(),path.join(dest,'SKILL.md')).replaceAll('\\','/'),source:source.replace('https://github.com/',''),license,revision,sha256:createHash('sha256').update(text).digest('hex')});
    names.add(canonicalName(header.name));hashes.add(hash(text));report.included++;
  }
  audits.push(report);console.log(`${source}: +${report.included}; skipped ${report.excluded.length}`);
}
await fs.writeFile('skills/manifest.json',JSON.stringify(manifest,null,2));
await fs.writeFile('skills/community-lock.json',JSON.stringify(manifest.filter(e=>e.source!=='ozy'),null,2));
await fs.writeFile('docs/skill-expansion-audit.json',JSON.stringify(audits,null,2));
const report=`# Expanded community skill library\n\nAdded ${manifest.length-initialCount} third-party skills. Installed total: ${manifest.length}, including ${manifest.filter(e=>e.source!=='ozy').length} third-party skills from ${new Set(manifest.filter(e=>e.source!=='ozy').map(e=>e.source)).size} repositories. No new AgentScope-authored skills were added.\n\nDuplicate names and content were skipped. Each included skill retains its source commit, original assets, copyright/license notices, and SHA-256 checksum. Skills with unresolved/restricted licenses, invalid frontmatter, symlink packages, or oversized assets are listed in the [audit](skill-expansion-audit.json). Packages are installed as instructions and resources; external services and software may still require setup.\n\n| Source | Added | Pinned revision |\n| --- | ---: | --- |\n${audits.map(a=>`| [${a.source.replace('https://github.com/','')}](${a.source}) | ${a.included} | ${a.revision} |`).join('\n')}\n\nCC-BY-4.0 content remains under that license, with original attribution and a complete license copy. It is not relicensed as MIT. Source content is unchanged.\n`;
await fs.writeFile('docs/COMMUNITY_SKILLS.md',report);
console.log(JSON.stringify({added:manifest.length-initialCount,total:manifest.length,external:manifest.filter(e=>e.source!=='ozy').length,sources:new Set(manifest.map(e=>e.source)).size}));
