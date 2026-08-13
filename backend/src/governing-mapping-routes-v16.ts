import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
};

async function repairWindowControlMapping(db:D1Database,projectId:string){
  const item=await db.prepare(`
    SELECT i.id
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    WHERE d.project_id=?
      AND d.document_type='control_plan'
      AND i.item_type='control'
      AND (lower(trim(i.code))='3.2' OR lower(trim(i.description))='fönster och dörrar')
    ORDER BY i.sort_order
    LIMIT 1
  `).bind(projectId).first<any>();
  if(!item)return;

  const target=await db.prepare(`
    SELECT a.id
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
      AND a.activity_type='check'
      AND lower(trim(a.title))=lower('Kontrollera fönster och dörrar mot handling, infästning och tätning')
    LIMIT 1
  `).bind(projectId).first<any>();
  if(!target)return;

  await db.prepare(`
    DELETE FROM governing_item_activity_links
    WHERE governing_item_id=?
      AND activity_id IN (
        SELECT a.id FROM activities a WHERE a.activity_type='perform'
      )
  `).bind(String(item.id)).run();

  await db.prepare(`
    INSERT OR IGNORE INTO governing_item_activity_links
      (id,governing_item_id,activity_id,link_type,created_at)
    VALUES(?,?,?,'supports',datetime('now'))
  `).bind(crypto.randomUUID(),String(item.id),String(target.id)).run();
}

async function isInvalidControlToPerform(db:D1Database,itemId:string,activityId:string){
  const row=await db.prepare(`
    SELECT i.item_type,a.activity_type
    FROM governing_items i
    JOIN activities a ON a.id=?
    WHERE i.id=?
  `).bind(activityId,itemId).first<any>();
  return row?.item_type==='control'&&row?.activity_type==='perform';
}

export function registerGoverningMappingRoutesV16(app:RouteApp){
  const proxy:RouteApp={
    get(path,handler){
      if(path!=='/api/studio/projects/:projectId/governing-mapping'){
        app.get(path,handler);
        return;
      }
      app.get(path,async c=>{
        await repairWindowControlMapping(c.env.DB,String(c.req.param('projectId')));
        return handler(c);
      });
    },
    put(path,handler){
      if(path!=='/api/studio/governing-items/:itemId/mappings/:activityId'){
        app.put(path,handler);
        return;
      }
      app.put(path,async c=>{
        const itemId=String(c.req.param('itemId'));
        const activityId=String(c.req.param('activityId'));
        if(await isInvalidControlToPerform(c.env.DB,itemId,activityId)){
          return c.json({
            ok:false,
            error:'En kontrollpunkt i ett styrdokument ska kopplas till en kontrollaktivitet, inte till en UTFÖR-aktivitet.'
          },409);
        }
        return handler(c);
      });
    }
  };
  registerGoverningMappingRoutesV15(proxy);
}
