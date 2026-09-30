import { z } from 'zod';
export const id = () => crypto.randomUUID();
export const modeSchema = z.enum(['ask', 'code', 'agent', 'workflow']);
export type Mode = z.infer<typeof modeSchema>;
export const modelSchema = z.object({
  id: z.string().min(1).max(200), name: z.string().min(1).max(100), contextSize: z.number().int().min(4096).max(2000000).default(128000),
  maxOutput: z.number().int().min(128).max(128000).default(4096), temperature: z.number().min(0).max(2).optional(),
  reasoningEffort: z.enum(['none','minimal','low','medium','high','xhigh','max']).optional(), tools: z.boolean().default(true), vision: z.boolean().default(false),
  inputPrice: z.number().nonnegative().optional(), outputPrice: z.number().nonnegative().optional(), cachedPrice: z.number().nonnegative().optional()
});
export type Model = z.infer<typeof modelSchema>;
export const providerSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(100), kind: z.enum(['openai','anthropic','gemini','openrouter','ollama','compatible']),
  baseUrl: z.string().url(), models: z.array(modelSchema).min(1).max(100), enabled: z.boolean().default(true)
});
export type Provider = z.infer<typeof providerSchema>;
export interface ProviderPublic extends Provider { hasKey: boolean|null; hasHeaders: boolean|null }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown>; signature?: string }
export interface Message { role: 'user'|'assistant'|'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string; name?: string }
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export interface Usage { input: number|null; output: number|null; cached: number|null; cost: number|null; providerId: string; modelId: string }
export interface ModelResponse { text: string; toolCalls: ToolCall[]; usage: Usage; finishReason: string }
export interface Project { id: string; name: string; root: string; createdAt: string }
export interface Task { id: string; projectId: string; title: string; mode: Mode; providerId: string; modelId: string; status: 'idle'|'running'|'waiting'|'done'|'error'|'stopped'; createdAt: string; updatedAt: string; error?: string; parentId?: string }
export interface AgentEvent { id: number; taskId: string; type: string; data: Record<string, unknown>; createdAt: string }
export const capabilitySchema = z.enum(['read','write','delete','shell','network','browser','git','mcp','delegate']);
export type Capability = z.infer<typeof capabilitySchema>;
export const ruleSchema = z.object({ id: z.string(), capability: capabilitySchema, pattern: z.string().min(1).max(20000), exact: z.boolean().optional(), decision: z.enum(['allow','ask','deny']), scope: z.enum(['session','project','global']), projectId: z.string().optional() });
export type Rule = z.infer<typeof ruleSchema>;
export interface Approval { id: string; taskId: string; projectId: string; capability: Capability; target: string; description: string }
export const settingsSchema = z.object({
  maxSteps: z.number().int().min(1).max(100).default(25), contextBudget: z.number().int().min(2000).max(200000).default(16000),
  taskLimit: z.number().positive().nullable().default(null), dailyLimit: z.number().positive().nullable().default(null), monthlyWarning: z.number().positive().nullable().default(null),
  routing: z.boolean().default(false), fastProviderId: z.string().default(''), fastModelId: z.string().default(''),
  allowDelegation: z.boolean().default(false), browserEnabled: z.boolean().default(false),
  theme: z.enum(['dark','light']).default('dark'), shortcuts: z.record(z.string(),z.string()).default({'palette':'mod+k','new':'mod+shift+o','terminal':'mod+`','stop':'Escape'})
});
export type Settings = z.infer<typeof settingsSchema>;
export const memorySchema = z.object({ id: z.string(), scope: z.enum(['project','user','conversation']), projectId: z.string().optional(), taskId: z.string().optional(), title: z.string().min(1).max(200), content: z.string().min(1).max(12000), updatedAt: z.string() });
export type Memory = z.infer<typeof memorySchema>;
export const workflowSchema = z.object({id:z.string(),name:z.string().min(1).max(100),description:z.string().max(500),steps:z.array(z.object({name:z.string().min(1),prompt:z.string().min(1).max(5000),mode:modeSchema.default('code'),providerId:z.string().optional(),modelId:z.string().optional()})).min(1).max(12)});
export type Workflow = z.infer<typeof workflowSchema>;
export const mcpSchema = z.object({id:z.string().regex(/^[a-z0-9-]+$/),name:z.string().min(1),transport:z.enum(['stdio','http']),command:z.string().optional(),args:z.array(z.string()).default([]),url:z.string().url().optional(),enabled:z.boolean().default(false),projectId:z.string().optional()});
export type McpConfig = z.infer<typeof mcpSchema>;
export interface Skill { id: string; name: string; description: string; source: string; license: string; enabled: boolean; scope: 'builtin'|'global'|'project'; projectId?: string; path: string; content: string; }
export interface FileRecord { path: string; hash: string; size: number; language: string; summary: string; symbols: { name: string; line: number; end: number }[]; text: string }
