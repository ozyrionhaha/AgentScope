import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT??4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535.');
const application=await createApp({root,dataDirectory:path.resolve(process.env.AGENTSCOPE_DATA_DIR??path.join(root,'.agentscope')),port});
if(process.argv.includes('--dev')){
  const {createServer}=await import('vite');
  const vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});application.app.use(vite.middlewares);
}else{
  application.app.use((_req,res,next)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");next();});
  application.app.use(express.static(path.join(root,'dist')));application.app.get('/{*path}',(_req,res)=>res.sendFile(path.join(root,'dist','index.html')));
}
const server=application.app.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({level:'info',event:'ready',url:`http://127.0.0.1:${port}`,privacy:'Local service; telemetry disabled'})));
let closing=false;async function shutdown(){if(closing)return;closing=true;server.close();server.closeAllConnections();await application.close();process.exit(0);}
process.on('SIGINT',()=>{void shutdown();});process.on('SIGTERM',()=>{void shutdown();});
