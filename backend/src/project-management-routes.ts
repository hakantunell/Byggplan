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

export function registerProjectManagementRoutes(app:RouteApp){
  app.delete('/api/studio/projects/:id',async c=>{
    const projectId=c.req.param('id');
    const project=await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);

    try{
      await deleteProjectFiles(c.env.FILES,projectId);
      const result=await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();
      if(!result.meta.changes)return c.json({ok:false,error:'Projektet hittades inte.'},404);
      return c.json({ok:true,id:projectId,name:project.name});
    }catch(error){
      console.error('Project deletion failed',error);
      return c.json({ok:false,error:error instanceof Error?error.message:'Projektet kunde inte tas bort.'},500);
    }
  });
}
