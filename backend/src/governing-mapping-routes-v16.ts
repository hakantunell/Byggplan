import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
};

function semanticKinds(item:any){
  const values=Array.isArray(item?.handling_kinds)&&item.handling_kinds.length
    ? item.handling_kinds
    : [item?.handling_kind||'work'];
  return new Set(values.map((value:unknown)=>String(value)));
}

function suggestionIsCompatible(item:any,activity:any){
  if(!activity)return false;
  const kinds=semanticKinds(item);
  const activityType=String(activity.activity_type||'');

  // An execution activity is valid only when the governing item actually contains
  // a work/action requirement. A pure control item must therefore never be proposed
  // against a perform activity, regardless of wording in a new control plan.
  if(activityType==='perform')return kinds.has('work');

  // Checks and measurements are suitable for control semantics.
  if(activityType==='check'||activityType==='measurement')return kinds.has('control');

  // Documentation activities may carry administration/evidence requirements and
  // can also document a control when the governing item explicitly asks for it.
  if(activityType==='document')return kinds.has('administration')||kinds.has('evidence')||kinds.has('control');

  // Other activity types are left to the semantic matcher; the important hard
  // boundary is that pure controls cannot leak into field execution cards.
  return true;
}

function filterSuggestionsBySemantics(data:any){
  if(!data||!Array.isArray(data.items)||!Array.isArray(data.activities)||!data.suggestions)return data;
  const activityById=new Map<string,any>(data.activities.map((activity:any)=>[String(activity.id),activity]));
  for(const item of data.items){
    const suggestions=Array.isArray(data.suggestions[item.id])?data.suggestions[item.id]:[];
    data.suggestions[item.id]=suggestions.filter((suggestion:any)=>
      suggestionIsCompatible(item,activityById.get(String(suggestion.activity_id)))
    );
  }
  return data;
}

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

export function registerGoverningMappingRoutesV16(app:RouteApp){
  const proxy:RouteApp={
    get(path,handler){
      if(path!=='/api/studio/projects/:projectId/governing-mapping'){
        app.get(path,handler);
        return;
      }
      app.get(path,async c=>{
        await repairWindowControlMapping(c.env.DB,String(c.req.param('projectId')));
        const response:any=await handler(c);
        if(!response||typeof response.clone!=='function'||!response.ok)return response;
        const data:any=await response.clone().json().catch(()=>null);
        if(!data)return response;
        filterSuggestionsBySemantics(data);
        return c.json(data,response.status);
      });
    },
    put(path,handler){
      // Mapping suggestions are filtered semantically on GET. Keep PUT available for
      // explicit/manual project decisions rather than rejecting them from raw item_type,
      // because mixed work+control requirements are legitimate.
      app.put(path,handler);
    }
  };
  registerGoverningMappingRoutesV15(proxy);
}
