async function ensureContextSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_contexts(activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE)`).run();
}

async function deprecateActivity(db:D1Database,activityId:string,reason:string){
  await db.prepare(`INSERT INTO activity_contexts(activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','studio','deprecated',?,datetime('now')) ON CONFLICT(activity_id) DO UPDATE SET surface='studio',applicability='deprecated',condition_text=excluded.condition_text,updated_at=datetime('now')`).bind(activityId,reason).run();
}

async function preferSpecificTimberActivity(db:D1Database,projectId:string){
  const specific=await db.prepare(`SELECT a.id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Stomme') AND lower(trim(a.title))=lower('Res timmerstomme enligt konstruktionshandling') LIMIT 1`).bind(projectId).first<any>();
  if(!specific)return;
  const generic=await db.prepare(`SELECT a.id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Stomme') AND lower(trim(a.title))=lower('Res vald bärande stomme')`).bind(projectId).all();
  for(const row of generic.results as any[])await deprecateActivity(db,String(row.id),'Ersatt i timmerprojekt av "Res timmerstomme enligt konstruktionshandling".');
}

async function mergeFramingTasks(db:D1Database,projectId:string){
  const preferred=await db.prepare(`SELECT t.id FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Stomme') AND lower(trim(t.title))=lower('Res bärande stomme') ORDER BY t.sort_order LIMIT 1`).bind(projectId).first<any>();
  const source=await db.prepare(`SELECT t.id FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Stomme') AND lower(trim(t.title))=lower('Utför timmerstomme') ORDER BY t.sort_order LIMIT 1`).bind(projectId).first<any>();
  if(!preferred||!source||String(preferred.id)===String(source.id))return;

  const activities=await db.prepare('SELECT id,title FROM activities WHERE task_id=? ORDER BY sort_order').bind(source.id).all();
  for(const activity of activities.results as any[]){
    const duplicate=await db.prepare('SELECT id FROM activities WHERE task_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(preferred.id,String(activity.title)).first<any>();
    if(duplicate){
      await deprecateActivity(db,String(activity.id),'Dublett vid sammanslagning av momentet "Utför timmerstomme" med "Res bärande stomme".');
      continue;
    }
    await db.prepare('UPDATE activities SET task_id=? WHERE id=?').bind(preferred.id,activity.id).run();
  }

  const remaining=await db.prepare(`SELECT COUNT(*) AS n FROM activities a LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE a.task_id=? AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(source.id).first<any>();
  if(Number(remaining?.n||0)===0){
    await db.prepare('DELETE FROM activities WHERE task_id=?').bind(source.id).run();
    await db.prepare('DELETE FROM tasks WHERE id=?').bind(source.id).run();
  }
}

export async function normalizeProjectStructure(db:D1Database,projectId:string){
  if(!projectId)return;
  await ensureContextSchema(db);
  const target=await db.prepare(`SELECT ws.id FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Stomme') ORDER BY ws.sort_order LIMIT 1`).bind(projectId).first<any>();
  const source=await db.prepare(`SELECT ws.id FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Vald stomtyp') ORDER BY ws.sort_order LIMIT 1`).bind(projectId).first<any>();

  if(target&&source&&String(target.id)!==String(source.id)){
    await db.prepare('UPDATE tasks SET work_section_id=?,section=? WHERE work_section_id=?').bind(target.id,'Stomme',source.id).run();
    await db.prepare('DELETE FROM work_sections WHERE id=? AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.work_section_id=work_sections.id)').bind(source.id).run();
  }

  await mergeFramingTasks(db,projectId);
  await preferSpecificTimberActivity(db,projectId);
}
