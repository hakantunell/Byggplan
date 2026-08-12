import { registerMasterProjectV2UpgradeRoutesV10 } from './master-project-v2-upgrade-routes-v10';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};
type Seed={title:string;type:string;lifecycle?:string;surface?:string;applicability?:string;condition?:string;description?:string};

async function ensureSchema(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run()}
function defaults(s:Seed){return{lifecycle:s.lifecycle||(s.type==='administration'?'administration':s.type==='perform'?'build':'control'),surface:s.surface||(s.type==='administration'?'studio':'field'),applicability:s.applicability||'always',condition:s.condition||''}}
async function addToTask(db:D1Database,masterId:string,taskTitle:string,s:Seed){
 const task=await db.prepare(`SELECT t.id FROM master_tasks t JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND t.title=? LIMIT 1`).bind(masterId,taskTitle).first<any>();if(!task)return 0;
 let row=await db.prepare('SELECT id,activity_type FROM master_activities WHERE master_task_id=? AND title=?').bind(task.id,s.title).first<any>();let id=row?.id?String(row.id):'';let created=0;
 if(!id){const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_activities WHERE master_task_id=?').bind(task.id).first<any>();id=crypto.randomUUID();await db.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,1,?)').bind(id,task.id,s.title,s.description||'',s.type,Number(order?.n||10)).run();created=1}
 else if(String(row.activity_type)!==s.type)await db.prepare('UPDATE master_activities SET activity_type=?,description=CASE WHEN ?<>\'\' THEN ? ELSE description END WHERE id=?').bind(s.type,s.description||'',s.description||'',id).run();
 const m=defaults(s);await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET lifecycle_stage=excluded.lifecycle_stage,surface=excluded.surface,applicability=excluded.applicability,condition_text=excluded.condition_text,updated_at=datetime('now')`).bind(id,m.lifecycle,m.surface,m.applicability,m.condition).run();return created;
}

async function extend(db:D1Database,masterId:string){await ensureSchema(db);let created=0;
 created+=await addToTask(db,masterId,'Planera etablering och arbetsplats',{title:'Fuktskydda material och konstruktion under byggtid',type:'perform',description:'Skydda byggmaterial och öppna konstruktioner mot nederbörd, markfukt och annan oönskad uppfuktning under byggskedet.'});
 created+=await addToTask(db,masterId,'Färdigställ klimatskal',{title:'Utför fasad och väggtäckning enligt handling',type:'perform',description:'Montera projektets fasad eller annan väggtäckning med erforderliga anslutningar och tätningar.'});
 created+=await addToTask(db,masterId,'Dokumentera byggnadens brandskydd',{title:'Montera brandvarnare och övrig föreskriven brandsäkerhetsutrustning',type:'perform',description:'Montera brandvarnare samt brandsläckare, brandfilt, spistimer eller annan utrustning när detta krävs av projektets handlingar.'});
 created+=await addToTask(db,masterId,'Samla slutdokumentation',{title:'Samla våtrumsintyg och dokumentation för tätskikt',type:'administration',surface:'studio'});
 created+=await addToTask(db,masterId,'Samla slutdokumentation',{title:'Samla imkanalprotokoll eller motsvarande dokumentation',type:'administration',surface:'studio'});
 await db.prepare("UPDATE master_projects SET version=CASE WHEN version<11 THEN 11 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();return created;
}

export async function ensureMasterV11(db:D1Database,masterId:string){return extend(db,masterId)}
export function registerMasterProjectV2UpgradeRoutesV11(app:RouteApp){const proxy:RouteApp={post(path,handler){if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return}app.post(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;const created=await extend(c.env.DB,String(data.id));return c.json({...data,version:11,createdActivities:Number(data.createdActivities||0)+created},response.status)})}};registerMasterProjectV2UpgradeRoutesV10(proxy)}
