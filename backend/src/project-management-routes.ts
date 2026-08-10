type RouteApp={delete:(path:string,handler:(c:any)=>unknown)=>void};

async function deleteProjectFiles(bucket:R2Bucket,projectId:string){
  if(!bucket||typeof bucket.list!=='function'||typeof bucket.delete!=='function')return;
  let cursor: string|undefined;
  do{
    const page=await bucket.list({prefix:`projects/${projectId}/`,cursor});
    const keys=page.objects.map(item=>item.key);
    if(keys.length)await bucket.delete(keys);
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
}

function describeSql(sql:string){
  return sql.replace(/\s+/g,' ').trim().slice(0,180);
}

async function safeRun(db:D1Database,sql:string,projectId:string){
  try{return await db.prepare(sql).bind(projectId).run();}
  catch(error){
    const message=error instanceof Error?error.message:String(error);
    const lower=message.toLowerCase();
    if(lower.includes('no such table')||lower.includes('no such column'))return null;
    throw new Error(`Raderingssteg misslyckades: ${describeSql(sql)} :: ${message}`);
  }
}

async function deleteProjectData(db:D1Database,projectId:string){
  // Legacy v0/v1 project tables. Some early schemas kept answers/files as
  // children of requirements and notifications as children of tasks without
  // ON DELETE CASCADE. Remove the full dependency chain explicitly.
  await safeRun(db,`DELETE FROM files WHERE requirement_id IN (
    SELECT id FROM requirements WHERE project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM answers WHERE requirement_id IN (
    SELECT id FROM requirements WHERE project_id=?
  )`,projectId);
  await safeRun(db,'DELETE FROM requirements WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM notifications WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM activity_events WHERE project_id=?',projectId);

  // Project documents and support resources: children before parents.
  await safeRun(db,'DELETE FROM project_document_attachments WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_documents WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_support_attachments WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_administration_items WHERE project_id=?',projectId);

  // Governing documents: explicitly remove link/item children first because
  // older databases may not have ON DELETE CASCADE on every foreign key.
  await safeRun(db,`DELETE FROM governing_item_activity_links WHERE governing_item_id IN (
    SELECT i.id FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    WHERE d.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM governing_items WHERE governing_document_id IN (
    SELECT id FROM governing_documents WHERE project_id=?
  )`,projectId);
  await safeRun(db,'DELETE FROM governing_documents WHERE project_id=?',projectId);

  // Imported control plans: points must be removed before their documents.
  await safeRun(db,`DELETE FROM control_plan_points WHERE control_plan_id IN (
    SELECT id FROM control_plan_documents WHERE project_id=?
  )`,projectId);
  await safeRun(db,'DELETE FROM control_plan_documents WHERE project_id=?',projectId);

  // Technical resources. Some link tables do not carry project_id themselves,
  // so remove rows through technical_resource_id before deleting the resource.
  await safeRun(db,`DELETE FROM project_task_resources WHERE technical_resource_id IN (
    SELECT id FROM technical_resources WHERE project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM project_activity_resources WHERE technical_resource_id IN (
    SELECT id FROM technical_resources WHERE project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM technical_resource_links WHERE technical_resource_id IN (
    SELECT id FROM technical_resources WHERE project_id=?
  )`,projectId);
  await safeRun(db,'DELETE FROM technical_resources WHERE project_id=?',projectId);

  // Project membership/roles commonly reference the project directly.
  await safeRun(db,'DELETE FROM project_member_roles WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_memberships WHERE project_id=?',projectId);

  // Explicitly remove activity-owned data so deletion also works with older
  // schemas where every foreign key did not yet have ON DELETE CASCADE.
  await safeRun(db,`DELETE FROM activity_documentation_entries WHERE field_id IN (
    SELECT f.id FROM activity_documentation_fields f
    JOIN activities a ON a.id=f.activity_id
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM activity_documentation_fields WHERE activity_id IN (
    SELECT a.id FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM activity_entries WHERE activity_id IN (
    SELECT a.id FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM activity_classifications WHERE activity_id IN (
    SELECT a.id FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM activity_execution_contexts WHERE activity_id IN (
    SELECT a.id FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM activity_documentation_profiles WHERE activity_id IN (
    SELECT a.id FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM governing_item_activity_links WHERE activity_id IN (
    SELECT a.id FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);

  // Current hierarchy, leaves to root.
  await safeRun(db,`DELETE FROM activities WHERE task_id IN (
    SELECT t.id FROM tasks t
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM tasks WHERE work_section_id IN (
    SELECT ws.id FROM work_sections ws
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM work_sections WHERE work_area_id IN (
    SELECT id FROM work_areas WHERE project_id=?
  )`,projectId);
  await safeRun(db,'DELETE FROM work_areas WHERE project_id=?',projectId);

  // Legacy tasks.project_id hierarchy. First clear old child tables that only
  // carry task_id (no project_id) before deleting those tasks.
  await safeRun(db,`DELETE FROM files WHERE requirement_id IN (
    SELECT r.id FROM requirements r JOIN tasks t ON t.id=r.task_id WHERE t.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM answers WHERE requirement_id IN (
    SELECT r.id FROM requirements r JOIN tasks t ON t.id=r.task_id WHERE t.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM requirements WHERE task_id IN (
    SELECT id FROM tasks WHERE project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM notifications WHERE task_id IN (
    SELECT id FROM tasks WHERE project_id=?
  )`,projectId);
  await safeRun(db,'DELETE FROM tasks WHERE project_id=?',projectId);
}

export function registerProjectManagementRoutes(app:RouteApp){
  app.delete('/api/studio/projects/:id',async c=>{
    const projectId=c.req.param('id');
    const project=await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);

    try{
      await deleteProjectFiles(c.env.FILES,projectId);
      await deleteProjectData(c.env.DB,projectId);
      let result;
      try{
        result=await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        throw new Error(`Slutsteg DELETE FROM projects misslyckades :: ${message}`);
      }
      if(!result.meta.changes)return c.json({ok:false,error:'Projektet hittades inte.'},404);
      return c.json({ok:true,id:projectId,name:project.name});
    }catch(error){
      console.error('Project deletion failed',error);
      const detail=error instanceof Error?error.message:'Projektet kunde inte tas bort.';
      return c.json({ok:false,error:detail},500);
    }
  });
}
