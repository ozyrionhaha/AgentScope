import type { Approval, McpConfig, Project, ProviderPublic, Settings, Task, Workflow } from '../shared/contracts';
export interface AppState {projects:Project[];providers:ProviderPublic[];tasks:Task[];settings:Settings;vault:{initialized:boolean;unlocked:boolean};approvals:Approval[];plugins:{id:string;name:string;description:string;enabled:boolean;version:string;author:string;skills:string[];source:string}[];workflows:Workflow[];mcp:McpConfig[];skillCount:number;skillSources:number}
export type View='workspace'|'agents'|'skills'|'workflows'|'memory'|'models'|'plugins'|'mcp'|'settings'|'usage';
export type Panel='Terminal'|'Changes'|'Browser'|'Problems'|'Timeline'|'Usage';
