async function ensureContextSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_contexts(activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE)`).run();
}

async function deprecateActivity(db:D1Database,activityId:string,reason:string){
  await db.prepare(`INSERT INTO activity_contexts(activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','field','deprecated',?,datetime('now')) ON CONFLICT(activity_id) DO UPDATE SET applicability='deprecated',condition_text=excluded.condition_text,updated_at=datetime('now')`).bind(activityId,reason).run();
}

export async function normalizeProjectStructure(db:D1Database,projectId:string){
  await ensureContextSchema(db);
  const target=await db.prepare(`SELECT ws.id FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Stomme') ORDER BY ws.sort_order LIMIT 1`).bind(projectId).first<any>();
  const source=await db.prepare(`SELECT ws.id FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(ws.name))=lower('Vald stomtyp') ORDER BY ws.sort_order LIMIT 1`).bind(projectId).first<any>();

  if(target&&source&&String(target.id)!==String(source.id)){
    await db.prepare('UPDATE tasks SET work_section_id=?,section=? WHERE work_section_id=?').bind(target.id,'Stomme',source.id).run();
    await db.prepare('DELETE FROM work_sections WHERE id=? AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.work_section_id=work_sections.id)').bind(source.id).run();
  }

  const preferred=await db.prepare(`SELECT a.id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(a.title))=lower('Res bärande stomme') LIMIT 1`).bind(projectId).first<any>();
  if(preferred){
    const duplicates=await db.prepare(`SELECT a.id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? AND lower(trim(a.title))=lower('Utför timmerstomme')`).bind(projectId).all();
    for(const row of duplicates.results as any[])await deprecateActivity(db,String(row.id),'Ersatt av "Res bärande stomme".');
  }
}
