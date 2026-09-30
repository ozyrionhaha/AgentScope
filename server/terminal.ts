import { spawn, type ChildProcess } from 'node:child_process';
import type { Store } from './storage.ts';
export interface TerminalSession { id:string;taskId:string;command:string;pid:number|undefined;status:'running'|'done'|'stopped';exitCode:number|null;output:string;startedAt:string;truncated:boolean }
export class Terminal {
  private processes=new Map<string,ChildProcess>();
  constructor(private store:Store,private redact:(text:string)=>string){}
  list(){return this.store.all<TerminalSession>('terminals');}
  async run(taskId:string,root:string,command:string,timeout:number,background:boolean,signal:AbortSignal){
    signal.throwIfAborted();
    const child=spawn(process.platform==='win32'?'powershell.exe':'/bin/sh',process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',command]:['-c',command],{cwd:root,windowsHide:true,detached:process.platform!=='win32',env:this.environment(),stdio:['ignore','pipe','pipe']});
    const session:TerminalSession={id:crypto.randomUUID(),taskId,command,pid:child.pid,status:'running',exitCode:null,output:'',startedAt:new Date().toISOString(),truncated:false};
    this.processes.set(session.id,child);this.store.put('terminals',session.id,session);this.store.emit(taskId,'terminal_started',{sessionId:session.id,command});
    const output=(data:Buffer)=>{const text=this.redact(data.toString());session.output+=text;if(session.output.length>2_000_000){session.output=session.output.slice(-2_000_000);session.truncated=true;}this.store.put('terminals',session.id,session);this.store.emit(taskId,'terminal_output',{sessionId:session.id,text:text.slice(-32000)});};
    child.stdout?.on('data',output);child.stderr?.on('data',output);
    const abort=()=>this.stop(session.id);signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>this.stop(session.id),timeout);
    const finished=new Promise<TerminalSession>((resolve,reject)=>{
      child.on('error',error=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.processes.delete(session.id);session.status='done';session.output+=error.message;this.store.put('terminals',session.id,session);reject(error);});
      child.on('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.processes.delete(session.id);if(session.status==='running')session.status='done';session.exitCode=code;this.store.put('terminals',session.id,session);this.store.emit(taskId,'terminal_done',{sessionId:session.id,exitCode:code});resolve(session);});
    });
    if(background){void finished.catch(error=>this.store.emit(taskId,'error',{message:this.redact(String(error))}));return session;}
    return finished;
  }
  private environment(){const allowed=['PATH','Path','PATHEXT','SYSTEMROOT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','LANG','TERM'];return Object.fromEntries(allowed.filter(k=>process.env[k]).map(k=>[k,process.env[k]!]));}
  stop(id:string){const child=this.processes.get(id);if(!child)return;const session=this.store.get<TerminalSession>('terminals',id);if(session){session.status='stopped';this.store.put('terminals',id,session);}if(child.pid){if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}}}
  stopTask(taskId:string){for(const s of this.list())if(s.taskId===taskId&&s.status==='running')this.stop(s.id);}
  stopAll(){for(const id of this.processes.keys())this.stop(id);}
}
