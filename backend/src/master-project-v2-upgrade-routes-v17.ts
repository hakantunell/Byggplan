import { ensureMasterV16, registerMasterProjectV2UpgradeRoutesV16 } from './master-project-v2-upgrade-routes-v16';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureContextSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run();
}

async function mergeMasterSection(db:D1Database,masterId:string){
  const target=await db.prepare(`SELECT ws.id FROM master_work_sections ws JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND lower(trim(ws.name))=lower('Stomme') ORDER BY ws.sort_order LIMIT 1`).bind(masterId).first<any>();
  const source=await db.prepare(`SELECT ws.id FROM master_work_sections ws JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND lower(trim(ws.name))=lower('Vald stomtyp') ORDER BY ws.sort_order LIMIT 1`).bind(masterId).first<any>();
  if(!target||!source||String(target.id)===String(source.id))return;

  const tasks=await db.prepare('SELECT id,title FROM master_tasks WHERE master_work_section_id=? ORDER BY sort_order').bind(source.id).all();
  for(const task of tasks.results as any[]){
    const same=await db.prepare('SELECT id FROM master_tasks WHERE master_work_section_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(target.id,String(task.title)).first<any>();
    if(!same){
      await db.prepare('UPDATE master_tasks SET master_work_section_id=? WHERE id=?').bind(target.id,task.id).run();
      continue;
    }
    const activities=await db.prepare('SELECT id,title FROM master_activities WHERE master_task_id=? ORDER BY sort_order').bind(task.id).all();
    for(const activity of activities.results as any[]){
      const duplicate=await db.prepare('SELECT id FROM master_activities WHERE master_task_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(same.id,String(activity.title)).first<any>();
      if(!duplicate)await db.prepare('UPDATE master_activities SET master_task_id=? WHERE id=?').bind(same.id,activity.id).run();
      else await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','field','deprecated','Ersatt vid sammanslagning av stomstruktur.',datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET applicability='deprecated',updated_at=datetime('now')`).bind(String(activity.id)).run();
    }
  }
  await db.prepare('DELETE FROM master_tasks WHERE master_work_section_id=? AND NOT EXISTS(SELECT 1 FROM master_activities a WHERE a.master_task_id=master_tasks.id)').bind(source.id).run();
  await db.prepare('DELETE FROM master_work_sections WHERE id=? AND NOT EXISTS(SELECT 1 FROM master_tasks t WHERE t.master_work_section_id=master_work_sections.id)').bind(source.id).run();
}

async function deprecateDuplicateFramingActivity(db:D1Database,masterId:string){
  const preferred=await db.prepare(`SELECT a.id FROM master_activities a JOIN master_tasks t ON t.id=a.master_task_id JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND lower(trim(a.title))=lower('Res bärande stomme') LIMIT 1`).bind(masterId).first<any>();
  if(!preferred)return;
  const rows=await db.prepare(`SELECT a.id FROM master_activities a JOIN master_tasks t ON t.id=a.master_task_id JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND lower(trim(a.title))=lower('Utför timmerstomme')`).bind(masterId).all();
  for(const row of rows.results as any[]){
    await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','field','deprecated','Ersatt av "Res bärande stomme".',datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET applicability='deprecated',condition_text='Ersatt av "Res bärande stomme".',updated_at=datetime('now')`).bind(String(row.id)).run();
  }
}

async function extend(db:D1Database,masterId:string){
  await ensureContextSchema(db);
  await mergeMasterSection(db,masterId);
  await deprecateDuplicateFramingActivity(db,masterId);
  await db.prepare("UPDATE master_projects SET version=CASE WHEN version<17 THEN 17 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();
}

export async function ensureMasterV17(db:D1Database,masterId:string){
  const previous=await ensureMasterV16(db,masterId);
  await extend(db,masterId);
  return previous;
}

export function registerMasterProjectV2UpgradeRoutesV17(app:RouteApp){
  const proxy:RouteApp={post(path,handler){
    if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return;}
    app.post(path,async c=>{
      const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;
      const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;
      await extend(c.env.DB,String(data.id));
      return c.json({...data,version:17},response.status);
    });
  }};
  registerMasterProjectV2UpgradeRoutesV16(proxy);
}
