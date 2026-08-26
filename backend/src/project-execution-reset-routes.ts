type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}
async function projectActivityIds(db:D1Database,projectId:string){const r=await db.prepare(`SELECT a.id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=?`).bind(projectId).all();return (r.results as any[]).map(row=>String(row.id))}
async function projectTaskIds(db:D1Database,projectId:string){const r=await db.prepare(`SELECT t.id FROM tasks t JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=?`).bind(projectId).all();return (r.results as any[]).map(row=>String(row.id))}
async function selectKeysByActivity(db:D1Database,table:string,activityIds:string[]){if(!activityIds.length||!await tableExists(db,table))return[] as string[];const out:string[]=[];for(let i=0;i<activityIds.length;i+=75){const ids=activityIds.slice(i,i+75);const r=await db.prepare(`SELECT object_key FROM ${table} WHERE activity_id IN (${ids.map(()=>'?').join(',')}) AND object_key IS NOT NULL`).bind(...ids).all();for(const row of r.results as any[])if(row.object_key)out.push(String(row.object_key))}return out}
async function selectFormalKeys(db:D1Database,activityIds:string[]){if(!activityIds.length||!await tableExists(db,'activity_documentation_entries')||!await tableExists(db,'activity_documentation_fields'))return[] as string[];const out:string[]=[];for(let i=0;i<activityIds.length;i+=75){const ids=activityIds.slice(i,i+75);const r=await db.prepare(`SELECT e.object_key FROM activity_documentation_entries e JOIN activity_documentation_fields f ON f.id=e.field_id WHERE f.activity_id IN (${ids.map(()=>'?').join(',')}) AND e.object_key IS NOT NULL`).bind(...ids).all();for(const row of r.results as any[])if(row.object_key)out.push(String(row.object_key))}return out}
async function deleteByIds(db:D1Database,table:string,column:string,ids:string[]){if(!ids.length||!await tableExists(db,table))return 0;let changed=0;for(let i=0;i<ids.length;i+=75){const batch=ids.slice(i,i+75);const r=await db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${batch.map(()=>'?').join(',')})`).bind(...batch).run();changed+=Number(r.meta.changes||0)}return changed}
async function deleteFormalEntries(db:D1Database,activityIds:string[]){if(!activityIds.length||!await tableExists(db,'activity_documentation_entries')||!await tableExists(db,'activity_documentation_fields'))return 0;let changed=0;for(let i=0;i<activityIds.length;i+=75){const ids=activityIds.slice(i,i+75);const r=await db.prepare(`DELETE FROM activity_documentation_entries WHERE field_id IN (SELECT id FROM activity_documentation_fields WHERE activity_id IN (${ids.map(()=>'?').join(',')}))`).bind(...ids).run();changed+=Number(r.meta.changes||0)}return changed}
async function deleteR2Keys(bucket:R2Bucket|undefined,keys:string[]){if(!bucket||!keys.length)return 0;let deleted=0;for(let i=0;i<keys.length;i+=100){const batch=[...new Set(keys.slice(i,i+100))];await bucket.delete(batch);deleted+=batch.length}return deleted}

export function registerProjectExecutionResetRoutes(app:RouteApp){
 app.post('/api/studio/projects/:projectId/reset-execution',async c=>{
  const projectId=String(c.req.param('projectId'));
  const project=await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>();
  if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
  const body=await c.req.json<{confirmProjectName?:string}>().catch(()=>({}));
  if(String(body.confirmProjectName||'').trim()!==String(project.name||'').trim())return c.json({ok:false,error:'Projektets namn stämmer inte. Återställningen avbröts.'},400);
  try{
   const activityIds=await projectActivityIds(c.env.DB,projectId),taskIds=await projectTaskIds(c.env.DB,projectId);
   const fileKeys=[...await selectFormalKeys(c.env.DB,activityIds),...await selectKeysByActivity(c.env.DB,'activity_own_documentation_files',activityIds)];
   const counts:Record<string,number>={};
   counts.documentationEntries=await deleteFormalEntries(c.env.DB,activityIds);
   counts.ownDocumentationFiles=await deleteByIds(c.env.DB,'activity_own_documentation_files','activity_id',activityIds);
   counts.ownDocumentationNotes=await deleteByIds(c.env.DB,'activity_own_documentation','activity_id',activityIds);
   counts.activityEntries=await deleteByIds(c.env.DB,'activity_entries','activity_id',activityIds);
   if(await tableExists(c.env.DB,'governing_item_attestations')){const r=await c.env.DB.prepare('DELETE FROM governing_item_attestations WHERE project_id=?').bind(projectId).run();counts.attestations=Number(r.meta.changes||0)}
   counts.taskReviews=await deleteByIds(c.env.DB,'task_reviews','task_id',taskIds);
   counts.notifications=await deleteByIds(c.env.DB,'notifications','task_id',taskIds);
   if(taskIds.length&&await tableExists(c.env.DB,'tasks')){for(let i=0;i<taskIds.length;i+=75){const ids=taskIds.slice(i,i+75);await c.env.DB.prepare(`UPDATE tasks SET status='todo',updated_at=datetime('now') WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).run()}}
   counts.files=await deleteR2Keys(c.env.FILES,fileKeys);
   return c.json({ok:true,projectId,counts,preserved:['project_structure','activity_definitions','governing_documents','project_documents','project_information','project_conditions','governing_mapping']});
  }catch(error){console.error('project execution reset failed',error);return c.json({ok:false,error:`Projektåterställningen misslyckades: ${error instanceof Error?error.message:String(error)}`},500)}
 });
}
