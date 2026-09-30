import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpConfig } from '../shared/contracts.ts';
import { validateEndpoint } from './providers.ts';
export class Mcp {
  private clients=new Map<string,Client>();
  async connect(config:McpConfig){
    if(!config.enabled)throw new Error('Enable this MCP server first.');
    let client=this.clients.get(config.id);if(client)return client;
    client=new Client({name:'agentscope',version:'0.1.0'},{capabilities:{}});
    const transport=config.transport==='stdio'?new StdioClientTransport({command:config.command??'',args:config.args,stderr:'pipe'}):new StreamableHTTPClientTransport(new URL(validateEndpoint(config.url??'')));
    if(config.transport==='stdio'&&!config.command)throw new Error('MCP command is required.');
    try{await client.connect(transport,{timeout:30000});}catch(error){await transport.close();throw error;}
    this.clients.set(config.id,client);return client;
  }
  async tools(config:McpConfig){const client=await this.connect(config);return client.listTools(undefined,{timeout:30000});}
  async call(config:McpConfig,name:string,args:Record<string,unknown>,signal:AbortSignal){const client=await this.connect(config);return client.callTool({name,arguments:args},undefined,{signal,timeout:120000});}
  async disconnect(id:string){const client=this.clients.get(id);this.clients.delete(id);await client?.close();}
  async close(){await Promise.allSettled([...this.clients.keys()].map(id=>this.disconnect(id)));}
}
