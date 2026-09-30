import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
export function safeUrl(value:string){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Use a public or local HTTP(S) URL without embedded credentials.');if(/^(169\.254\.|0\.|\[?fe80:|metadata\.)/.test(u.hostname))throw new Error('Metadata and link-local destinations are blocked.');if(['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.port===String(process.env.PORT??4317))throw new Error('Agent tools cannot access the workspace control service.');return u;}
export class BrowserTools {
  private browser:Browser|undefined;
  private pages=new Map<string,Page>();
  private logs=new Map<string,string[]>();
  constructor(private directory:string){}
  async page(taskId:string){if(!this.browser)this.browser=await chromium.launch({headless:true});let page=this.pages.get(taskId);if(!page){const context=await this.browser.newContext({serviceWorkers:'block',acceptDownloads:false});await context.route('**/*',async route=>{try{safeUrl(route.request().url());await route.continue();}catch{await route.abort();}});page=await context.newPage();this.pages.set(taskId,page);this.logs.set(taskId,[]);page.on('pageerror',error=>this.logs.get(taskId)?.push(error.message));page.on('console',message=>{if(message.type()==='error')this.logs.get(taskId)?.push(message.text());});}return page;}
  async action(taskId:string,action:string,args:{url?:string;selector?:string;text?:string},signal:AbortSignal){
    signal.throwIfAborted();const page=await this.page(taskId);const abort=()=>{void page.context().close();this.pages.delete(taskId);};signal.addEventListener('abort',abort,{once:true});
    try{
      if(action==='navigate')await page.goto(safeUrl(args.url??'').href,{waitUntil:'domcontentloaded',timeout:30000});
      else if(action==='click')await page.locator(args.selector??'').click({timeout:10000});
      else if(action==='fill')await page.locator(args.selector??'').fill(args.text??'',{timeout:10000});
      else if(action==='screenshot'){await fs.mkdir(path.join(this.directory,'screenshots'),{recursive:true});const id=crypto.randomUUID();await page.screenshot({path:path.join(this.directory,'screenshots',`${id}.png`),fullPage:true,timeout:10000});return {url:page.url(),screenshot:`/api/screenshots/${id}`,errors:this.logs.get(taskId)};}
      return {url:page.url(),title:await page.title(),text:(await page.locator('body').innerText({timeout:10000})).slice(0,20000),elements:await page.locator('a,button,input,textarea,select').evaluateAll(nodes=>nodes.slice(0,100).map(n=>({tag:n.tagName,text:n.textContent?.slice(0,100),id:n.id,name:n.getAttribute('name'),type:n.getAttribute('type')}))),errors:this.logs.get(taskId)};
    }finally{signal.removeEventListener('abort',abort);}
  }
  async closeTask(taskId:string){const page=this.pages.get(taskId);this.pages.delete(taskId);this.logs.delete(taskId);await page?.context().close();}
  async close(){await this.browser?.close();this.browser=undefined;this.pages.clear();}
}
