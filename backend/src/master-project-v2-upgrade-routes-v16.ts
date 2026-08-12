import { ensureMasterV15, registerMasterProjectV2UpgradeRoutesV15 } from './master-project-v2-upgrade-routes-v15';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run();
}

async function setContextByTitle(db:D1Database,masterId:string,title:string,lifecycle:string,surface:string){
  const rows=await db.prepare(`SELECT a.id FROM master_activities a JOIN master_tasks t ON t.id=a.master_task_id JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND a.title=?`).bind(masterId,title).all();
  for(const row of rows.results as any[]){
    await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,?,?,'always','',datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET lifecycle_stage=excluded.lifecycle_stage,surface=excluded.surface,applicability=CASE WHEN master_activity_contexts.applicability='deprecated' THEN 'deprecated' ELSE 'always' END,updated_at=datetime('now')`).bind(String(row.id),lifecycle,surface).run();
  }
}

async function addFieldGroundCheck(db:D1Database,masterId:string){
  const task=await db.prepare(`SELECT t.id FROM master_tasks t JOIN master_work_sections ws ON ws.id=t.master_work_section_id JOIN master_work_areas wa ON wa.id=ws.master_work_area_id WHERE wa.master_project_id=? AND t.title='Kontrollera markförutsättningar' LIMIT 1`).bind(masterId).first<any>();
  if(!task)return 0;
  const title='Kontrollera faktiska markförhållanden vid schaktning';
  let activity=await db.prepare('SELECT id FROM master_activities WHERE master_task_id=? AND title=?').bind(task.id,title).first<any>();
  let created=0;
  if(!activity){
    const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_activities WHERE master_task_id=?').bind(task.id).first<any>();
    const id=crypto.randomUUID();
    await db.prepare(`INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?, 'check',1,?)`).bind(id,task.id,title,'Kontrollera när schakten är öppen att jordlager, bärighet, vattenförhållanden och andra synliga markförutsättningar stämmer tillräckligt väl med projekteringsunderlaget. Dokumentera avvikelse och stoppa eller anpassa arbetet om förutsättningarna väsentligt avviker.',Number(order?.n||10)).run();
    activity={id};created=1;
  }
  await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','field','always','',datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET lifecycle_stage='build',surface='field',applicability=CASE WHEN master_activity_contexts.applicability='deprecated' THEN 'deprecated' ELSE 'always' END,updated_at=datetime('now')`).bind(String(activity.id)).run();
  return created;
}

async function extend(db:D1Database,masterId:string){
  await ensureSchema(db);
  await setContextByTitle(db,masterId,'Säkerställ att erforderlig geoteknisk utredning finns','design','studio');
  await setContextByTitle(db,masterId,'Kontrollera radonförutsättningar och eventuell radonklass','design','studio');
  await setContextByTitle(db,masterId,'Kontrollera geotekniskt underlag och markförhållanden','design','studio');
  const created=await addFieldGroundCheck(db,masterId);
  await db.prepare("UPDATE master_projects SET version=CASE WHEN version<16 THEN 16 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();
  return created;
}

export async function ensureMasterV16(db:D1Database,masterId:string){
  const previous=await ensureMasterV15(db,masterId);
  const created=await extend(db,masterId);
  return {...previous,createdActivities:Number((previous as any)?.createdActivities||0)+created};
}

export function registerMasterProjectV2UpgradeRoutesV16(app:RouteApp){
  const proxy:RouteApp={post(path,handler){
    if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return}
    app.post(path,async c=>{
      const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;
      const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;
      const created=await extend(c.env.DB,String(data.id));
      return c.json({...data,version:16,createdActivities:Number(data.createdActivities||0)+created},response.status);
    });
  }};
  registerMasterProjectV2UpgradeRoutesV15(proxy);
}
