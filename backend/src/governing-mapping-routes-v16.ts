import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
};

function norm(value:unknown){
  return String(value||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
}

function semanticKinds(item:any){
  const values=Array.isArray(item?.handling_kinds)&&item.handling_kinds.length
    ? item.handling_kinds
    : [item?.handling_kind||'work'];
  return new Set(values.map((value:unknown)=>String(value)));
}

function addKind(item:any,kind:string){
  const kinds=semanticKinds(item);
  kinds.add(kind);
  item.handling_kinds=[...kinds];
  if(!item.handling_kind)item.handling_kind=kind;
}

function normalizeMixedSemantics(data:any){
  if(!data||!Array.isArray(data.items))return data;
  for(const item of data.items){
    const text=norm(`${item.description||''} ${item.section_title||''}`);

    // Normative wording that requires something to be built, arranged, installed,
    // prepared, stored or sorted contains a real work/action requirement even when
    // the imported source row was broadly classified as a control point.
    if(/\bska\b.*\b(utföras|placeras|förberedas|anordnas|ordnas|installeras|monteras|förvaras|sorteras)\b/.test(text)
      || /\bfår inte\b.*\b(eldas|ledas|användas|placeras)\b/.test(text)){
      addKind(item,'work');
    }

    // Requirements that execution shall follow applications, drawings, permits or
    // manufacturer instructions also need an explicit verification dimension.
    if(/\b(utföras|placeras|installeras|monteras)\b.*\benligt\b.*\b(ansökan|handling|ritning|tillstånd|anvisning|anvisningar|branschregler)\b/.test(text)){
      addKind(item,'work');
      addKind(item,'control');
    }

    // Ongoing care/inspection requirements belong to operation/management and may
    // legitimately be represented by a documentation/management activity.
    if(/\b(skötsel|skötas|drift|underhåll|underhållas)\b/.test(text)){
      addKind(item,'operation');
    }
  }
  return data;
}

function suggestionIsCompatible(item:any,activity:any){
  if(!activity)return false;
  const kinds=semanticKinds(item);
  const activityType=String(activity.activity_type||'');

  // An execution activity is valid only when the governing item actually contains
  // a work/action requirement. A pure control item must therefore never be proposed
  // against a perform activity, regardless of wording in a new control plan.
  if(activityType==='perform')return kinds.has('work');

  // Checks and measurements are suitable both for ordinary controls and for
  // administrative verification in Studio (for example checking that required
  // pre-start documentation has been arranged).
  if(activityType==='check'||activityType==='measurement')return kinds.has('control')||kinds.has('administration');

  // Documentation activities may carry administration/evidence requirements,
  // document controls, and represent operation/management requirements.
  if(activityType==='document')return kinds.has('administration')||kinds.has('evidence')||kinds.has('control')||kinds.has('operation');

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
        normalizeMixedSemantics(data);
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
