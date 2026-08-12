import { ensureMasterV14, registerMasterProjectV2UpgradeRoutesV14 } from './master-project-v2-upgrade-routes-v14';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

async function finalize(db:D1Database,masterId:string){
 await db.prepare("UPDATE master_projects SET version=CASE WHEN version<15 THEN 15 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();
}

export async function ensureMasterV15(db:D1Database,masterId:string){
 const result=await ensureMasterV14(db,masterId);
 await finalize(db,masterId);
 return result;
}

export function registerMasterProjectV2UpgradeRoutesV15(app:RouteApp){
 const proxy:RouteApp={post(path,handler){
  if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return}
  app.post(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;await finalize(c.env.DB,String(data.id));return c.json({...data,version:15},response.status)})
 }};
 registerMasterProjectV2UpgradeRoutesV14(proxy);
}
