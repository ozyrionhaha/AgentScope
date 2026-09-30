/** Maintainer-only: reads already inspected local Git checkouts; never runs their scripts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseSkill } from '../server/skills.ts';
const sources=path.resolve(process.argv[2]??'../../work/references'),destination=path.resolve('skills/community');
const entries:{id:string;path:string;source:string;license:string;revision:string;sha256:string}[]=[];
const audit:{source:string;revision:string;included:number;excluded:{path:string;reason:string}[];patterns:string[]}[]=[];
const licenseType=(text:string)=>/Apache License[\s\S]{0,80}Version 2\.0/.test(text)?'Apache-2.0':/MIT License|Permission is hereby granted, free of charge/.test(text)?'MIT':/ISC License/.test(text)?'ISC':/Redistribution and use in source and binary forms/.test(text)?'BSD':undefined;
for(const entry of await fs.readdir(sources,{withFileTypes:true})){
  if(!entry.isDirectory())continue;const root=path.join(sources,entry.name);let remote:string,revision:string;
  try{remote=execFileSync('git',['remote','get-url','origin'],{cwd:root,encoding:'utf8'}).trim().replace(/\.git$/,'');revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{continue;}
  const report={source:remote,revision,included:0,excluded:[] as {path:string;reason:string}[],patterns:[] as string[]};
  const found:string[]=[];async function walk(dir:string){for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.name==='.git'||item.name==='node_modules'||/^(tests?|fixtures|evals?|benchmarks)$/.test(item.name)||item.isSymbolicLink())continue;const full=path.join(dir,item.name);if(item.isDirectory())await walk(full);else if(item.name==='SKILL.md')found.push(full);}}await walk(root);
  for(const file of found){
    const relative=path.relative(root,file),content=await fs.readFile(file,'utf8');let header:ReturnType<typeof parseSkill>;
    try{header=parseSkill(content);}catch{report.excluded.push({path:relative,reason:'Invalid or incompatible frontmatter'});continue;}
    let cursor=path.dirname(file),licenseFile:string|undefined,licenseText='';
    while(cursor.startsWith(root)){
      const names=await fs.readdir(cursor);const name=names.find(n=>/^licen[sc]e(?:\.(?:md|txt))?$/i.test(n));
      if(name){licenseFile=path.join(cursor,name);licenseText=await fs.readFile(licenseFile,'utf8');break;}
      if(cursor===root)break;cursor=path.dirname(cursor);
    }
    const license=licenseType(licenseText);
    if(!license||!licenseFile){report.excluded.push({path:relative,reason:licenseText?'License outside the MIT/Apache/ISC/BSD bundle policy':'No complete distributable license found'});continue;}
    const slug=`${entry.name}/${path.relative(root,path.dirname(file)).replaceAll('\\','/')}`;
    const dest=path.join(destination,slug);
    await fs.mkdir(dest,{recursive:true});
    await fs.cp(path.dirname(file),dest,{recursive:true,filter:src=>!src.split(path.sep).some(p=>['.git','node_modules','__pycache__'].includes(p))});
    await fs.copyFile(licenseFile,path.join(dest,'UPSTREAM-LICENSE.txt'));
    for(const notice of (await fs.readdir(root)).filter(n=>/^NOTICE(?:\.(txt|md))?$/i.test(n)))await fs.copyFile(path.join(root,notice),path.join(dest,'UPSTREAM-'+notice));
    await fs.writeFile(path.join(dest,'PROVENANCE.json'),JSON.stringify({source:remote,revision,path:relative,license,modified:false,notes:'Original skill assets preserved. Executable assets are inert until explicitly invoked through permission-checked tools.'},null,2));
    entries.push({id:slug,path:path.relative(process.cwd(),path.join(dest,'SKILL.md')).replaceAll('\\','/'),source:remote.replace('https://github.com/',''),license,revision,sha256:createHash('sha256').update(content).digest('hex')});report.included++;report.patterns.push(`${header.name}: ${header.description.slice(0,180)}`);
  }
  audit.push(report);console.log(remote,report.included,'bundled;',report.excluded.length,'excluded');
}
await fs.mkdir('skills',{recursive:true});await fs.writeFile('skills/community-lock.json',JSON.stringify(entries,null,2));
await fs.mkdir('docs',{recursive:true});await fs.writeFile('docs/reference-audit.json',JSON.stringify(audit,null,2));
await fs.writeFile('docs/THIRD_PARTY_SKILLS.md',`# Third-party skills\n\nPinned source assets, each distributed under its original license. AgentScope's MIT license does not replace these licenses. No upstream agent configuration, hooks, or telemetry is executed on installation. Assets are unmodified; UPSTREAM-LICENSE and PROVENANCE files are added. Some skills require separately installed tools or accounts.\n\n${audit.map(r=>`## ${r.source}\n\nRevision: \`${r.revision}\`\n\nBundled: ${r.included}. Excluded: ${r.excluded.length}.\n\n${r.excluded.map(e=>`- ${e.path}: ${e.reason}`).join('\n')}\n`).join('\n')}\n\nFull feature inventory: [reference-audit.json](reference-audit.json).\n`);
console.log(entries.length,'skills from',audit.filter(a=>a.included).length,'sources');
