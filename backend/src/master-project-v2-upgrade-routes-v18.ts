import { ensureMasterV17, registerMasterProjectV2UpgradeRoutesV17 } from './master-project-v2-upgrade-routes-v17';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureContextSchema(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run()}
async function deprecate(db:D1Database,id:string,reason:string){await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','field','deprecated',?,datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET applicability='deprecated',condition_text=excluded.condition_text,updated_at=datetime('now')`).bind(id,reason).run()}

async function mergeSection(db:D1Database,masterId:string,areaName:string,sourceName:string,targetName:string){
  const target=await db.prepare(`SELECT s.id FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? AND lower(trim(a.name))=lower(trim(?)) AND lower(trim(s.name))=lower(trim(?)) LIMIT 1`).bind(masterId,areaName,targetName).first<any>();
  const source=await db.prepare(`SELECT s.id FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? AND lower(trim(a.name))=lower(trim(?)) AND lower(trim(s.name))=lower(trim(?)) LIMIT 1`).bind(masterId,areaName,sourceName).first<any>();
  if(!target||!source||String(target.id)===String(source.id))return;
  await db.prepare('UPDATE master_tasks SET master_work_section_id=? WHERE master_work_section_id=?').bind(target.id,source.id).run();
  await db.prepare('DELETE FROM master_work_sections WHERE id=? AND NOT EXISTS(SELECT 1 FROM master_tasks WHERE master_work_section_id=?)').bind(source.id,source.id).run();
}

async function deprecateKnownDuplicates(db:D1Database){
  const known=[
    ['7fe43669-b1f3-4e3e-a10c-8ca06de904f5','Dublett av ”Kontrollera att aktuella projekthandlingar finns tillgängliga”.'],
    ['d43f9116-2a6b-40be-80e3-b4e00d7ec6e1','Dublett av konstruktionsdokumentationsaktiviteten.'],
    ['aef397f3-bbd5-4c74-b988-eaa45716343b','Dublett av VVS-/legionellakontrollen.']
  ];
  for(const [id,reason] of known){if(await db.prepare('SELECT id FROM master_activities WHERE id=?').bind(id).first())await deprecate(db,id,reason)}
}

async function mergeSemanticActivity(db:D1Database,masterId:string,keeperTitle:string,removeTitle:string,newTitle:string){
  const keeper=await db.prepare(`SELECT a.id FROM master_activities a JOIN master_tasks t ON t.id=a.master_task_id JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas w ON w.id=s.master_work_area_id WHERE w.master_project_id=? AND lower(trim(a.title))=lower(trim(?)) ORDER BY a.sort_order,a.id LIMIT 1`).bind(masterId,keeperTitle).first<any>();
  const remove=await db.prepare(`SELECT a.id FROM master_activities a JOIN master_tasks t ON t.id=a.master_task_id JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas w ON w.id=s.master_work_area_id WHERE w.master_project_id=? AND lower(trim(a.title))=lower(trim(?)) ORDER BY a.sort_order,a.id LIMIT 1`).bind(masterId,removeTitle).first<any>();
  if(!keeper||!remove||String(keeper.id)===String(remove.id))return;
  await db.prepare('UPDATE master_activities SET title=? WHERE id=?').bind(newTitle,keeper.id).run();
  await deprecate(db,String(remove.id),`Ersatt av ”${newTitle}” i Master v18.`);
}

async function extend(db:D1Database,masterId:string){
  await ensureContextSchema(db);
  await mergeSection(db,masterId,'Mark och grund','Vald grundlösning','Grundkonstruktion');
  await mergeSection(db,masterId,'Tak','Vald takstomme','Takstomme');
  const va=await db.prepare(`SELECT s.id FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? AND lower(trim(a.name))=lower('Installationer') AND lower(trim(s.name))=lower('Vatten och avlopp – val') LIMIT 1`).bind(masterId).first<any>();if(va)await db.prepare("UPDATE master_work_sections SET name='Yttre VA och avlopp' WHERE id=?").bind(va.id).run();
  await deprecateKnownDuplicates(db);
  await mergeSemanticActivity(db,masterId,'Kontrollera färdig stomme mot konstruktionshandlingar','Kontrollera färdig timmerstomme','Kontrollera färdig timmerstomme mot konstruktionshandling');
  await mergeSemanticActivity(db,masterId,'Kontrollera fönster och dörrar mot handling, infästning och tätning','Kontrollera infästning, funktion och tätning','Kontrollera fönster och dörrar mot handling, infästning, funktion och tätning');
  await db.prepare("UPDATE master_projects SET version=CASE WHEN version<18 THEN 18 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();
}

export async function ensureMasterV18(db:D1Database,masterId:string){const previous=await ensureMasterV17(db,masterId);await extend(db,masterId);return previous}

export function registerMasterProjectV2UpgradeRoutesV18(app:RouteApp){const proxy:RouteApp={post(path,handler){if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return;}app.post(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;await extend(c.env.DB,String(data.id));return c.json({...data,version:18},response.status)})}};registerMasterProjectV2UpgradeRoutesV17(proxy)}
