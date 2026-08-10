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

async function safeRun(db:D1Database,sql:string,projectId:string){
  try{return await db.prepare(sql).bind(projectId).run();}
  catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(message.toLowerCase().includes('no such table'))return null;
    throw error;
  }
}

async function deleteProjectData(db:D1Database,projectId:string){
  // Project-global data and files first.
  await safeRun(db,'DELETE FROM project_document_attachments WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_documents WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_support_attachments WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_task_resources WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_activity_resources WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_administration_items WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM governing_documents WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM control_plan_documents WHERE project_id=?',projectId);

  // Technical resources can have their own link table.
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

  // Finally remove the project tree from leaves to root.
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
}

export function registerProjectManagementRoutes(app:RouteApp){
  app.delete('/api/studio/projects/:id',async c=>{
    const projectId=c.req.param('id');
    const project=await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);

    try{
      await deleteProjectFiles(c.env.FILES,projectId);
      await deleteProjectData(c.env.DB,projectId);
      const result=await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();
      if(!result.meta.changes)return c.json({ok:false,error:'Projektet hittades inte.'},404);
      return c.json({ok:true,id:projectId,name:project.name});
    }catch(error){
      console.error('Project deletion failed',error);
      const detail=error instanceof Error?error.message:'Projektet kunde inte tas bort.';
      return c.json({ok:false,error:detail},500);
    }
  });
}
