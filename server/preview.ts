import { chromium, type Browser, type Page } from 'playwright';
import type { PreviewAction, PreviewFrame } from '../shared/design.ts';
import { safeUrl } from './browser.ts';

export function previewUrl(value:string,controlPort:number):string {
  const url=safeUrl(value);
  if(Number(url.port|| (url.protocol==='https:'?443:80))===controlPort)throw new Error('Preview cannot open the AgentScope control service.');
  return url.href;
}

export class WebPreview {
  private browser?:Promise<Browser>;
  private pages=new Map<string,{page:Page;errors:string[]}>();
  private queues=new Map<string,Promise<unknown>>();
  constructor(private controlPort:number){}
  private async serialized<T>(id:string,work:()=>Promise<T>):Promise<T>{
    const pending=(this.queues.get(id)??Promise.resolve()).catch(()=>{}).then(work);
    this.queues.set(id,pending);
    try{return await pending;}finally{if(this.queues.get(id)===pending)this.queues.delete(id);}
  }
  private async get(id:string){
    const existing=this.pages.get(id);if(existing&&!existing.page.isClosed())return existing;
    if(this.pages.size>=3)throw new Error('Close another project preview first (maximum 3).');
    this.browser??=chromium.launch({headless:true}).catch(error=>{this.browser=undefined;throw new Error(`Preview browser could not start. Run pnpm browser:install. ${error instanceof Error?error.message:''}`);});
    const context=await(await this.browser).newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1280,height:800}});
    await context.route('**/*',async route=>{try{previewUrl(route.request().url(),this.controlPort);await route.continue();}catch{await route.abort();}});
    await context.routeWebSocket('**/*',socket=>{try{const u=new URL(socket.url());u.protocol=u.protocol==='wss:'?'https:':'http:';previewUrl(u.href,this.controlPort);socket.connectToServer();}catch{socket.close();}});
    const page=await context.newPage(),errors:string[]=[];
    const record=(message:string)=>{errors.push(message.slice(0,500));if(errors.length>10)errors.shift();};
    page.on('pageerror',error=>record(error.message));page.on('console',message=>{if(message.type()==='error')record(message.text());});
    page.on('dialog',dialog=>{void dialog.dismiss();});context.on('page',popup=>{if(popup!==page)void popup.close();});
    const session={page,errors};this.pages.set(id,session);return session;
  }
  async action(id:string,input:PreviewAction){return this.serialized(id,async()=>{
    if(input.action==='navigate')previewUrl(input.url,this.controlPort);
    const {page,errors}=await this.get(id);
    if(input.action==='navigate'){errors.length=0;await page.setViewportSize({width:input.width,height:input.height});await page.goto(previewUrl(input.url,this.controlPort),{waitUntil:'domcontentloaded',timeout:20000});}
    else if(input.action==='refresh')await page.reload({waitUntil:'domcontentloaded',timeout:20000});
    else if(input.action==='click')await page.mouse.click(input.x,input.y);
    else if(input.action==='type')await page.keyboard.insertText(input.text);
    else if(input.action==='key')await page.keyboard.press(input.key);
    else if(input.action==='scroll')await page.mouse.wheel(0,input.delta);
    return {ok:true};
  });}
  async frame(id:string):Promise<PreviewFrame>{return this.serialized(id,async()=>{
    const session=this.pages.get(id);if(!session)throw new Error('Open a preview URL first.');
    const {page,errors}=session;const size=page.viewportSize()!;
    return {image:`data:image/jpeg;base64,${(await page.screenshot({type:'jpeg',quality:75,timeout:5000})).toString('base64')}`,url:page.url(),title:await page.title(),...size,errors:[...errors]};
  });}
  async closeProject(id:string){await this.serialized(id,async()=>{const session=this.pages.get(id);if(session)await session.page.context().close();this.pages.delete(id);});}
  async close(){if(this.browser)await(await this.browser).close();this.pages.clear();}
}
