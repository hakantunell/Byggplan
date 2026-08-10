type RouteApp={delete:(path:string,handler:(c:any)=>unknown)=>void};

type SchemaTable={name:string;sql:string};

async function deleteProjectFiles(bucket:R2Bucket,projectId:string){
  if(!bucket||typeof bucket.list!=='function'||typeof bucket.delete!=='function')return;
  let cursor:string|undefined;
  do{
    const page=await bucket.list({prefix:`projects/${projectId}/`,cursor});
    const keys=page.objects.map(item=>item.key);
    if(keys.length)await bucket.delete(keys);
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
}

function describeSql(sql:string){return sql.replace(/\s+/g,' ').trim().slice(0,180)}
function quoteIdentifier(value:string){
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw new Error(`Ogiltigt SQL-identifierare: ${value}`);
  return `"${value}"`;
}

async function safeRun(db:D1Database,sql:string,projectId:string){
  try{return await db.prepare(sql).bind(projectId).run()}
  catch(error){
    const message=error instanceof Error?error.message:String(error);
    const lower=message.toLowerCase();
    if(lower.includes('no such table')||lower.includes('no such column'))return null;
    throw new Error(`Raderingssteg misslyckades: ${describeSql(sql)} :: ${message}`);
  }
}

function referencedColumns(createSql:string,targetTable:string){
  const escaped=targetTable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const columns=new Set<string>();
  const inline=new RegExp('["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\\s+[^,\\n]*?REFERENCES\\s+["`]?'+escaped+'["`]?\\s*\\(\\s*["`]?id["`]?\\s*\\)','ig');
  const tableLevel=new RegExp('FOREIGN\\s+KEY\\s*\\(\\s*["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\\s*\\)\\s*REFERENCES\\s+["`]?'+escaped+'["`]?\\s*\\(\\s*["`]?id["`]?\\s*\\)','ig');
  let match:RegExpExecArray|null;
  while((match=inline.exec(createSql)))columns.add(match[1]);
  while((match=tableLevel.exec(createSql)))columns.add(match[1]);
  return [...columns];
}

async function loadSchemaTables(db:D1Database):Promise<SchemaTable[]>{
  const result=await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all();
  return (result.results as any[]).map(row=>({name:String(row.name||''),sql:String(row.sql||'')})).filter(row=>row.name&&row.sql);
}

async function deleteReferencingRows(
  db:D1Database,
  schema:SchemaTable[],
  targetTable:string,
  targetIdsSql:string,
  projectId:string,
  stack:Set<string>
){
  if(stack.has(targetTable))return;
  const nextStack=new Set(stack);nextStack.add(targetTable);
  for(const table of schema){
    if(table.name===targetTable)continue;
    for(const column of referencedColumns(table.sql,targetTable)){
      const childIdsSql=`SELECT id FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(column)} IN (${targetIdsSql})`;
      await deleteReferencingRows(db,schema,table.name,childIdsSql,projectId,nextStack);
      await safeRun(db,`DELETE FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(column)} IN (${targetIdsSql})`,projectId);
    }
  }
}

async function deleteTechnicalResources(db:D1Database,projectId:string,schema:SchemaTable[]){
  const resourceIds='SELECT id FROM technical_resources WHERE project_id=?';
  await deleteReferencingRows(db,schema,'technical_resources',resourceIds,projectId,new Set());
  await safeRun(db,'DELETE FROM technical_resources WHERE project_id=?',projectId);
}

async function deleteCurrentProjectTasks(db:D1Database,projectId:string,schema:SchemaTable[]){
  const taskIds=`SELECT t.id FROM tasks t
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?`;
  await deleteReferencingRows(db,schema,'tasks',taskIds,projectId,new Set());
  await safeRun(db,`DELETE FROM tasks WHERE id IN (${taskIds})`,projectId);
}

async function deleteLegacyProjectTasks(db:D1Database,projectId:string,schema:SchemaTable[]){
  const taskIds='SELECT id FROM tasks WHERE project_id=?';
  await deleteReferencingRows(db,schema,'tasks',taskIds,projectId,new Set());
  await safeRun(db,`DELETE FROM tasks WHERE id IN (${taskIds})`,projectId);
}

async function deleteProjectData(db:D1Database,projectId:string){
  const schema=await loadSchemaTables(db);

  // Legacy v0/v1 data.
  await safeRun(db,`DELETE FROM files WHERE requirement_id IN (SELECT id FROM requirements WHERE project_id=?)`,projectId);
  await safeRun(db,`DELETE FROM answers WHERE requirement_id IN (SELECT id FROM requirements WHERE project_id=?)`,projectId);
  await safeRun(db,'DELETE FROM requirements WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM notifications WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM activity_events WHERE project_id=?',projectId);

  // Project documents/support.
  await safeRun(db,'DELETE FROM project_document_attachments WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_documents WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_support_attachments WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_administration_items WHERE project_id=?',projectId);

  // Governing documents.
  await safeRun(db,`DELETE FROM governing_item_activity_links WHERE governing_item_id IN (
    SELECT i.id FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE d.project_id=?
  )`,projectId);
  await safeRun(db,`DELETE FROM governing_items WHERE governing_document_id IN (SELECT id FROM governing_documents WHERE project_id=?)`,projectId);
  await safeRun(db,'DELETE FROM governing_documents WHERE project_id=?',projectId);

  // Imported control plans.
  await safeRun(db,`DELETE FROM control_plan_points WHERE control_plan_id IN (SELECT id FROM control_plan_documents WHERE project_id=?)`,projectId);
  await safeRun(db,'DELETE FROM control_plan_documents WHERE project_id=?',projectId);

  // Technical resources and every actual FK descendant in the deployed schema.
  await deleteTechnicalResources(db,projectId,schema);

  // Membership/roles.
  await safeRun(db,'DELETE FROM project_member_roles WHERE project_id=?',projectId);
  await safeRun(db,'DELETE FROM project_memberships WHERE project_id=?',projectId);

  // Current hierarchy. All real FK descendants of tasks are removed dynamically
  // before task deletion, so older/newer task child tables cannot block it.
  await deleteCurrentProjectTasks(db,projectId,schema);
  await safeRun(db,`DELETE FROM work_sections WHERE work_area_id IN (SELECT id FROM work_areas WHERE project_id=?)`,projectId);
  await safeRun(db,'DELETE FROM work_areas WHERE project_id=?',projectId);

  // Very first tasks.project_id hierarchy.
  await deleteLegacyProjectTasks(db,projectId,schema);
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
      try{result=await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run()}
      catch(error){
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
