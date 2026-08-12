import { ensureMasterV13, registerMasterProjectV2UpgradeRoutesV13 } from './master-project-v2-upgrade-routes-v13';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};
type Seed={title:string;type:string;lifecycle?:string;surface?:string;description?:string};

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run();
}
function defaults(type:string){return{lifecycle:type==='administration'?'administration':type==='perform'?'build':'control',surface:type==='administration'?'studio':'field'}}
async function setContext(db:D1Database,id:string,type:string,lifecycle?:string,surface?:string,applicability='always'){
  const d=defaults(type);await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,?,?,?, '',datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET lifecycle_stage=excluded.lifecycle_stage,surface=excluded.surface,applicability=excluded.applicability,updated_at=datetime('now')`).bind(id,lifecycle||d.lifecycle,surface||d.surface,applicability).run();
}
async function addToTask(db:D1Database,masterId:string,taskTitle:string,s:Seed){
  const task=await db.prepare(`SELECT t.id FROM master_tasks t JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND t.title=? LIMIT 1`).bind(masterId,taskTitle).first<any>();if(!task)return 0;
  let row=await db.prepare('SELECT id,activity_type FROM master_activities WHERE master_task_id=? AND title=?').bind(task.id,s.title).first<any>();let id=row?.id?String(row.id):'';let created=0;
  if(!id){const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_activities WHERE master_task_id=?').bind(task.id).first<any>();id=crypto.randomUUID();await db.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,1,?)').bind(id,task.id,s.title,s.description||'',s.type,Number(order?.n||10)).run();created=1}else await db.prepare(`UPDATE master_activities SET activity_type=?,description=CASE WHEN ?<>'' THEN ? ELSE description END WHERE id=?`).bind(s.type,s.description||'',s.description||'',id).run();
  await setContext(db,id,s.type,s.lifecycle,s.surface,'always');return created;
}
async function deprecate(db:D1Database,masterId:string,title:string){
  const rows=await db.prepare(`SELECT a.id,a.activity_type,mac.lifecycle_stage,mac.surface FROM master_activities a JOIN master_tasks t ON t.id=a.master_task_id JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id LEFT JOIN master_activity_contexts mac ON mac.master_activity_id=a.id WHERE wa.master_project_id=? AND a.title=?`).bind(masterId,title).all();
  for(const row of rows.results as any[]){const d=defaults(String(row.activity_type));await setContext(db,String(row.id),String(row.activity_type),String(row.lifecycle_stage||d.lifecycle),String(row.surface||d.surface),'deprecated')}
  return (rows.results as any[]).length;
}

async function extend(db:D1Database,masterId:string){await ensureSchema(db);let created=0;
  created+=await addToTask(db,masterId,'Dokumentera bärande konstruktion',{title:'Upprätta, samla och kontrollera konstruktionsdokumentation för bärande konstruktion',type:'administration',lifecycle:'design',surface:'studio',description:'Samla eller upprätta konstruktionsdokumentationen och kontrollera i samma moment att den omfattar funktion, dimensioneringsförutsättningar, tillämpliga regelverk, relevanta exponerings- och korrosivitetsklasser samt dimensioneringskontroll.'});
  created+=await addToTask(db,masterId,'Kontrollera VVS-utformning och funktion',{title:'Kontrollera golvbrunnar, blindledningar, varmvattentemperatur och legionellarisk',type:'check',description:'Kontrollera i ett sammanhållet moment att erforderliga golvbrunnar finns, att blindledningar undviks och att varmvattentemperatur och övrig utformning inte medför legionellarisk.'});

  const retired=[
    'Kontrollera gällande lov, startbesked och projekthandlingar',
    'Kontrollera utsättning, referenshöjd och kända ledningar',
    'Sätt upp arbetsmiljöplan på arbetsplatsen före byggstart',
    'Dokumentera att BAS-P och BAS-U har erforderlig kompetens för uppdraget',
    'Ordna säker avfallshantering och sortering',
    'Upprätta eller samla konstruktionsdokumentation för bärande konstruktion',
    'Kontrollera att konstruktionsdokumentationen omfattar dimensioneringsförutsättningar och dimensioneringskontroll',
    'Kontrollera golvbrunnar, blindledningar och varmvattentemperatur',
    'Kontrollera att legionellarisk har beaktats i VVS-installationen',
    'Kontrollera åsar, sparrar och bärande takkonstruktion mot konstruktionshandling',
    'Montera brandvarnare och övrig föreskriven brandsäkerhetsutrustning',
    'Montera erforderlig taksäkerhet',
    'Kontrollera färdig byggnad mot lov och projekthandlingar'
  ];
  for(const title of retired)await deprecate(db,masterId,title);
  await db.prepare("UPDATE master_projects SET version=CASE WHEN version<14 THEN 14 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();return created;
}

export async function ensureMasterV14(db:D1Database,masterId:string){const previous=await ensureMasterV13(db,masterId);const created=await extend(db,masterId);return{...previous,createdActivities:Number((previous as any)?.createdActivities||0)+created}}
export function registerMasterProjectV2UpgradeRoutesV14(app:RouteApp){const proxy:RouteApp={post(path,handler){if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return}app.post(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;const created=await extend(c.env.DB,String(data.id));return c.json({...data,version:14,createdActivities:Number(data.createdActivities||0)+created},response.status)})}};registerMasterProjectV2UpgradeRoutesV13(proxy)}
