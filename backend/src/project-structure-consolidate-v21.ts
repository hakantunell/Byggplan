import { cleanupProjectStructureV21 } from './project-structure-cleanup-v21';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

export function registerProjectStructureConsolidateV21Routes(app:RouteApp){
  app.post('/api/studio/projects/:projectId/structure-consolidate-v21',async c=>{
    const projectId=c.req.param('projectId');
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    try{
      const result=await cleanupProjectStructureV21(c.env.DB,projectId);
      const master=await c.env.DB.prepare("SELECT id,code,version FROM master_projects WHERE code='fritidshus-v2'").first<any>();
      if(master)await c.env.DB.prepare('UPDATE project_master_snapshots SET master_project_id=?,master_project_code=?,master_project_version=? WHERE project_id=?').bind(master.id,master.code,Number(master.version||21),projectId).run();
      return c.json({ok:true,runtime:'structure-consolidate-v21',masterVersion:Number(master?.version||21),result});
    }catch(error){console.error('structure consolidate v21 failed',error);return c.json({ok:false,error:error instanceof Error?error.message:String(error)},500)}
  });
}
