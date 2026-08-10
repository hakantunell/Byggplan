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

function quoteIdentifier(value:string){return `"${value.replace(/"/g,'""')}"`}

async function directProjectReferences(db:D1Database){
  const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'projects'").all();
  const refs:{table:string;column:string}[]=[];
  for(const row of tables.results as any[]){
    const table=String(row.name||'');if(!table)continue;
    const fks=await db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all();
    for(const fk of fks.results as any[]){
      if(String(fk.table)==='projects'&&fk.from)refs.push({table,column:String(fk.from)});
    }
  }
  return refs;
}

async function deleteDirectProjectReferences(db:D1Database,projectId:string){
  const refs=await directProjectReferences(db);
  // Delete direct references first. work_areas is deliberately last because it
  // owns the project tree and deleting it may cascade through sections/tasks/activities.
  refs.sort((a,b)=>Number(a.table==='work_areas')-Number(b.table==='work_areas'));
  for(const ref of refs){
    await db.prepare(`DELETE FROM ${quoteIdentifier(ref.table)} WHERE ${quoteIdentifier(ref.column)}=?`).bind(projectId).run();
  }
  return refs;
}

export function registerProjectManagementRoutes(app:RouteApp){
  app.delete('/api/studio/projects/:id',async c=>{
    const projectId=c.req.param('id');
    const project=await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);

    try{
      await deleteProjectFiles(c.env.FILES,projectId);
      const refs=await deleteDirectProjectReferences(c.env.DB,projectId);
      const result=await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();
      if(!result.meta.changes)return c.json({ok:false,error:'Projektet hittades inte.'},404);
      return c.json({ok:true,id:projectId,name:project.name,clearedReferences:refs.map(ref=>ref.table)});
    }catch(error){
      console.error('Project deletion failed',error);
      let detail=error instanceof Error?error.message:'Projektet kunde inte tas bort.';
      try{
        const refs=await directProjectReferences(c.env.DB);
        detail+=` Direkta projektreferenser: ${refs.map(ref=>`${ref.table}.${ref.column}`).join(', ')||'inga'}.`;
      }catch{}
      return c.json({ok:false,error:detail},500);
    }
  });
}
