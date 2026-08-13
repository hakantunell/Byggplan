type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}
async function ensureContextSchema(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS activity_contexts(activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE)`).run()}
async function ensureConditionSchema(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS project_conditions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'manual',source_id TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run()}
async function deprecate(db:D1Database,id:string,reason:string){await db.prepare(`INSERT INTO activity_contexts(activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','studio','deprecated',?,datetime('now')) ON CONFLICT(activity_id) DO UPDATE SET surface='studio',applicability='deprecated',condition_text=excluded.condition_text,updated_at=datetime('now')`).bind(id,reason).run()}

async function moveGoverningLinks(db:D1Database,fromId:string,toId:string){
  if(!await tableExists(db,'governing_item_activity_links'))return;
  const cols=await db.prepare("PRAGMA table_info(governing_item_activity_links)").all();
  const names=new Set((cols.results as any[]).map(r=>String(r.name)));
  const rows=await db.prepare('SELECT * FROM governing_item_activity_links WHERE activity_id=?').bind(fromId).all();
  for(const row of rows.results as any[]){
    const existing=await db.prepare('SELECT id FROM governing_item_activity_links WHERE governing_item_id=? AND activity_id=? LIMIT 1').bind(row.governing_item_id,toId).first<any>();
    if(existing)continue;
    const fields=['id','governing_item_id','activity_id','link_type','mapping_source','confidence','mapping_comment','created_at','confirmed_at'].filter(x=>names.has(x));
    const values=fields.map(f=>f==='id'?crypto.randomUUID():f==='activity_id'?toId:row[f]??null);
    await db.prepare(`INSERT INTO governing_item_activity_links(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).bind(...values).run();
  }
}

async function findActivities(db:D1Database,projectId:string,title:string){
  const r=await db.prepare(`SELECT a.id,a.task_id,a.title,a.description,a.sort_order FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=? AND lower(trim(a.title))=lower(trim(?)) ORDER BY a.sort_order,a.id`).bind(projectId,title).all();
  return r.results as any[];
}

async function mergeActivities(db:D1Database,projectId:string,keeperTitle:string,removeTitle:string,newTitle?:string){
  const keepers=await findActivities(db,projectId,keeperTitle),removes=await findActivities(db,projectId,removeTitle);if(!keepers.length||!removes.length)return 0;
  const keeper=keepers[0];let changed=0;
  for(const item of removes){if(String(item.id)===String(keeper.id))continue;await moveGoverningLinks(db,String(item.id),String(keeper.id));await deprecate(db,String(item.id),`Ersatt av ”${newTitle||keeperTitle}” i strukturstädning v18.`);changed++}
  if(newTitle)await db.prepare('UPDATE activities SET title=? WHERE id=?').bind(newTitle,keeper.id).run();
  return changed;
}

async function deprecateDuplicateTitles(db:D1Database,projectId:string){
  const r=await db.prepare(`SELECT a.task_id,lower(trim(a.title)) key,COUNT(*) n FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE w.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated' GROUP BY a.task_id,lower(trim(a.title)) HAVING COUNT(*)>1`).bind(projectId).all();let retired=0;
  for(const group of r.results as any[]){const items=await db.prepare(`SELECT a.id,a.title,(SELECT COUNT(*) FROM governing_item_activity_links l WHERE l.activity_id=a.id) link_count FROM activities a WHERE a.task_id=? AND lower(trim(a.title))=? ORDER BY link_count DESC,a.sort_order,a.id`).bind(group.task_id,group.key).all().catch(()=>({results:[]} as any));const list=items.results as any[];if(!list.length)continue;const keeper=list[0];for(const duplicate of list.slice(1)){await moveGoverningLinks(db,String(duplicate.id),String(keeper.id));await deprecate(db,String(duplicate.id),`Exakt dublett av ”${duplicate.title}”, pensionerad i strukturstädning v18.`);retired++}}
  return retired;
}

async function mergeSection(db:D1Database,projectId:string,areaName:string,sourceName:string,targetName:string){
  const target=await db.prepare(`SELECT s.id FROM work_sections s JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=? AND lower(trim(w.name))=lower(trim(?)) AND lower(trim(s.name))=lower(trim(?)) LIMIT 1`).bind(projectId,areaName,targetName).first<any>();
  const source=await db.prepare(`SELECT s.id FROM work_sections s JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=? AND lower(trim(w.name))=lower(trim(?)) AND lower(trim(s.name))=lower(trim(?)) LIMIT 1`).bind(projectId,areaName,sourceName).first<any>();
  if(!target||!source||String(target.id)===String(source.id))return 0;
  const tasks=await db.prepare('SELECT id FROM tasks WHERE work_section_id=?').bind(source.id).all();for(const task of tasks.results as any[]){await db.prepare("UPDATE tasks SET work_section_id=?,section=?,updated_at=datetime('now') WHERE id=?").bind(target.id,targetName,task.id).run()}
  await db.prepare('DELETE FROM work_sections WHERE id=? AND NOT EXISTS(SELECT 1 FROM tasks WHERE work_section_id=?)').bind(source.id,source.id).run();return (tasks.results as any[]).length;
}

async function deprecateIfSpecificTaskExists(db:D1Database,projectId:string,genericTitle:string,specificTasks:string[]){
  const specific=await db.prepare(`SELECT 1 ok FROM tasks t JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=? AND lower(trim(t.title)) IN (${specificTasks.map(()=> 'lower(trim(?))').join(',')}) LIMIT 1`).bind(projectId,...specificTasks).first();if(!specific)return 0;
  const items=await findActivities(db,projectId,genericTitle);for(const item of items)await deprecate(db,String(item.id),`Generisk aktivitet ersatt av projektets konkreta modul i strukturstädning v18.`);return items.length;
}

async function convertStandingCondition(db:D1Database,projectId:string,title:string){
  const items=await findActivities(db,projectId,title);let converted=0;
  for(const item of items){const existing=await db.prepare("SELECT id FROM project_conditions WHERE project_id=? AND source_type='activity' AND source_id=? LIMIT 1").bind(projectId,item.id).first();if(!existing)await db.prepare("INSERT INTO project_conditions(id,project_id,title,description,source_type,source_id) VALUES(?,?,?,?, 'activity',?)").bind(crypto.randomUUID(),projectId,item.title,item.description||'',item.id).run();await deprecate(db,String(item.id),'Flyttad till Projektvillkor i strukturstädning v18.');converted++}
  return converted;
}

export async function cleanupProjectStructureV18(db:D1Database,projectId:string){
  await ensureContextSchema(db);await ensureConditionSchema(db);
  const result={movedTasks:0,retiredDuplicates:0,retiredGeneric:0,convertedConditions:0};
  result.retiredDuplicates+=await deprecateDuplicateTitles(db,projectId);
  result.retiredDuplicates+=await mergeActivities(db,projectId,'Kontrollera färdig stomme mot konstruktionshandlingar','Kontrollera färdig timmerstomme','Kontrollera färdig timmerstomme mot konstruktionshandling');
  result.retiredDuplicates+=await mergeActivities(db,projectId,'Kontrollera fönster och dörrar mot handling, infästning och tätning','Kontrollera infästning, funktion och tätning','Kontrollera fönster och dörrar mot handling, infästning, funktion och tätning');
  result.movedTasks+=await mergeSection(db,projectId,'Mark och grund','Vald grundlösning','Grundkonstruktion');
  result.movedTasks+=await mergeSection(db,projectId,'Tak','Vald takstomme','Takstomme');
  const va=await db.prepare(`SELECT s.id FROM work_sections s JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=? AND lower(trim(w.name))=lower('Installationer') AND lower(trim(s.name))=lower('Vatten och avlopp – val') LIMIT 1`).bind(projectId).first<any>();if(va)await db.prepare("UPDATE work_sections SET name='Yttre VA och avlopp' WHERE id=?").bind(va.id).run();
  result.retiredGeneric+=await deprecateIfSpecificTaskExists(db,projectId,'Utför vald grundkonstruktion',['Utför krypgrund','Utför platta på mark','Utför plintgrund','Utför källar-/suterrängdel']);
  result.retiredGeneric+=await deprecateIfSpecificTaskExists(db,projectId,'Montera vald bärande takkonstruktion',['Bygg åstak','Montera takstolar']);
  result.convertedConditions+=await convertStandingCondition(db,projectId,'Fuktskydda material och konstruktion under byggtid');
  return result;
}

export function registerProjectStructureCleanupV18Routes(app:RouteApp){app.post('/api/studio/projects/:projectId/structure-cleanup-v18',async c=>{const projectId=c.req.param('projectId');const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);try{return c.json({ok:true,runtime:'structure-cleanup-v18',result:await cleanupProjectStructureV18(c.env.DB,projectId)})}catch(error){console.error('structure cleanup v18 failed',error);return c.json({ok:false,error:error instanceof Error?error.message:String(error)},500)}})}
