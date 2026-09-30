import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { AgentEvent } from '../shared/contracts.ts';

export class Store {
  readonly db: DatabaseSync;
  readonly events = new EventEmitter();
  constructor(readonly directory: string) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    this.db = new DatabaseSync(path.join(directory,'agentscope.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id,id);
      CREATE TABLE IF NOT EXISTS files(project_id TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,path));
      INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));`);
    this.events.setMaxListeners(100);
  }
  get<T>(kind: string, id: string): T|undefined { const row=this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id); return row?JSON.parse(String(row.data)) as T:undefined; }
  all<T>(kind: string): T[] { return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(String(r.data)) as T); }
  put<T>(kind: string,id: string,value:T) { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(value)); return value; }
  delete(kind:string,id:string) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;} }
  emit(taskId:string,type:string,data:Record<string,unknown>):AgentEvent {
    const createdAt=new Date().toISOString();
    const r=this.db.prepare('INSERT INTO events(task_id,type,data,created_at) VALUES(?,?,?,?)').run(taskId,type,JSON.stringify(data),createdAt);
    const event={id:Number(r.lastInsertRowid),taskId,type,data,createdAt};this.events.emit('event',event);return event;
  }
  history(taskId:string,after=0):AgentEvent[] { return this.db.prepare('SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id').all(taskId,after).map(r=>({id:Number(r.id),taskId:String(r.task_id),type:String(r.type),data:JSON.parse(String(r.data)) as Record<string,unknown>,createdAt:String(r.created_at)})); }
  close(){this.db.close();}
}
