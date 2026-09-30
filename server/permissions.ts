import type { Approval, Capability, Mode, Rule } from '../shared/contracts.ts';
import type { Store } from './storage.ts';
const match=(pattern:string,value:string)=>new RegExp(`^${pattern.split('*').map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')}$`).test(value);
export class Permissions {
  private session:Rule[]=[];
  private pending=new Map<string,{approval:Approval;resolve:(value:boolean)=>void}>();
  constructor(private store:Store){}
  rules(){return [...this.store.all<Rule>('rules'),...this.session];}
  list(){return [...this.pending.values()].map(p=>p.approval);}
  add(rule:Rule){if(rule.scope==='project'&&!rule.projectId)throw new Error('Project rules need a project.');if(rule.scope==='session')this.session.push(rule);else this.store.put('rules',rule.id,rule);}
  remove(id:string){this.session=this.session.filter(r=>r.id!==id);this.store.delete('rules',id);}
  decision(capability:Capability,target:string,projectId:string,mode:Mode):'allow'|'ask'|'deny'{
    if(mode==='ask'&&!['read','network'].includes(capability))return 'deny';
    const matching=this.rules().filter(r=>r.capability===capability&&(r.scope!=='project'||r.projectId===projectId)&&(r.exact?r.pattern===target:match(r.pattern,target)));
    if(matching.some(r=>r.decision==='deny'))return 'deny';
    if(matching.some(r=>r.decision==='ask'))return 'ask';
    if(matching.some(r=>r.decision==='allow'))return 'allow';
    return capability==='read'?'allow':'ask';
  }
  async require(request:Omit<Approval,'id'>,mode:Mode,signal:AbortSignal){
    signal.throwIfAborted();const decision=this.decision(request.capability,request.target,request.projectId,mode);
    if(decision==='deny')throw new Error(`Permission denied: ${request.capability} ${request.target}`);
    if(decision==='allow')return;
    const approval={...request,id:crypto.randomUUID()};
    const approved=await new Promise<boolean>((resolve)=>{
      const finish=(value:boolean)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.pending.delete(approval.id);resolve(value);};
      const abort=()=>finish(false);const timer=setTimeout(()=>finish(false),10*60*1000);
      this.pending.set(approval.id,{approval,resolve:finish});signal.addEventListener('abort',abort,{once:true});this.store.emit(request.taskId,'approval',approval);
    });
    signal.throwIfAborted();if(!approved)throw new Error('Action was denied or approval expired.');
  }
  respond(id:string,choice:'once'|'session'|'project'|'always'|'deny'){
    const pending=this.pending.get(id);if(!pending)throw new Error('Approval no longer pending.');
    if(['session','project','always'].includes(choice))this.add({id:crypto.randomUUID(),capability:pending.approval.capability,pattern:pending.approval.target,exact:true,decision:'allow',scope:choice==='always'?'global':choice as 'session'|'project',projectId:pending.approval.projectId});
    pending.resolve(choice!=='deny');this.store.emit(pending.approval.taskId,'approval_resolved',{id,choice});
  }
}
