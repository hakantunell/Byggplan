import { ensureMasterV2CanonicalStructure } from './master-project-module-routes';
import { ensureMasterV11, registerMasterProjectV2UpgradeRoutesV11 } from './master-project-v2-upgrade-routes-v11';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

export async function ensureMasterV12(db:D1Database,masterId:string){
  const repaired=await ensureMasterV2CanonicalStructure(db,masterId);
  const createdActivities=await ensureMasterV11(db,masterId);
  await db.prepare("UPDATE master_projects SET version=CASE WHEN version<12 THEN 12 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();
  return{createdActivities,repaired};
}

export function registerMasterProjectV2UpgradeRoutesV12(app:RouteApp){
  const proxy:RouteApp={post(path,handler){
    if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return}
    app.post(path,async c=>{
      const master=await c.env.DB.prepare("SELECT id FROM master_projects WHERE code='fritidshus-v2'").first<any>();
      if(master)await ensureMasterV2CanonicalStructure(c.env.DB,String(master.id));
      const response:any=await handler(c);
      if(!response||typeof response.clone!=='function'||!response.ok)return response;
      const data:any=await response.clone().json().catch(()=>null);
      if(!data?.id)return response;
      const repaired=await ensureMasterV2CanonicalStructure(c.env.DB,String(data.id));
      await c.env.DB.prepare("UPDATE master_projects SET version=CASE WHEN version<12 THEN 12 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(String(data.id)).run();
      return c.json({...data,version:12,repaired},response.status);
    });
  }};
  registerMasterProjectV2UpgradeRoutesV11(proxy);
}
