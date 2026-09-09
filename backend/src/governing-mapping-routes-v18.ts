import { registerGoverningMappingRoutesV17 } from './governing-mapping-routes-v17';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};
const EXCEPTIONS=new Set(['not_applicable','cannot_verify','alternative_evidence']);

async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}
function kindFor(item:any){const t=String(item.item_type||'');if(t==='control'||t==='visit'||t==='measurement')return'control';if(t==='documentation'||t==='administration')return'administration';if(t==='condition'||t==='information')return'condition';return'work'}
function isHandledProjectCondition(item:any){
 const status=String(item.handling_status||'');
 const comment=String(item.handling_comment||'').toLocaleLowerCase('sv-SE');
 return status==='handled'&&(String(item.item_type||'')==='condition'||comment.includes('projektvillkor')||comment.includes('stående villkor'));
}

async function fallbackMapping(c:any,cause:unknown){
 try{
  const projectId=String(c.req.param('projectId'));
  const hasContexts=await tableExists(c.env.DB,'activity_contexts');
  const [dr,ir,ar,lr]=await Promise.all([
   c.env.DB.prepare(`SELECT id,document_type,title,issuer,reference,imported_at FROM governing_documents WHERE project_id=? ORDER BY CASE document_type WHEN 'control_plan' THEN 0 ELSE 1 END,imported_at,title`).bind(projectId).all(),
   c.env.DB.prepare(`SELECT i.id,i.governing_document_id,i.code,i.description,i.section_code,i.section_title,i.item_type,i.responsible_role,i.handling_status,i.handling_comment,COALESCE(i.source_note,'') source_note,i.sort_order FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE d.project_id=? ORDER BY d.imported_at,i.sort_order,i.id`).bind(projectId).all(),
   hasContexts
    ? c.env.DB.prepare(`SELECT a.id,a.title,a.description,a.activity_type,t.title task_title,ws.name section_name,wa.name area_name,a.sort_order activity_order,COALESCE(ac.lifecycle_stage,'build') lifecycle_stage,COALESCE(ac.surface,'field') surface,COALESCE(ac.applicability,'always') applicability,COALESCE(ac.condition_text,'') condition_text FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE wa.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated' ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all()
    : c.env.DB.prepare(`SELECT a.id,a.title,a.description,a.activity_type,t.title task_title,ws.name section_name,wa.name area_name,a.sort_order activity_order,'build' lifecycle_stage,'field' surface,'always' applicability,'' condition_text FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all(),
   hasContexts
    ? c.env.DB.prepare(`SELECT l.governing_item_id,l.activity_id,a.title activity_title FROM governing_item_activity_links l JOIN governing_items i ON i.id=l.governing_item_id JOIN governing_documents d ON d.id=i.governing_document_id JOIN activities a ON a.id=l.activity_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE d.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(projectId).all()
    : c.env.DB.prepare(`SELECT l.governing_item_id,l.activity_id,a.title activity_title FROM governing_item_activity_links l JOIN governing_items i ON i.id=l.governing_item_id JOIN governing_documents d ON d.id=i.governing_document_id JOIN activities a ON a.id=l.activity_id WHERE d.project_id=?`).bind(projectId).all()
  ]);
  const documents=dr.results as any[],items=ir.results as any[],activities=ar.results as any[],links=lr.results as any[];
  const byItem=new Map<string,any[]>(),byActivity=new Map<string,number>();
  for(const link of links){const itemId=String(link.governing_item_id),arr=byItem.get(itemId)||[];arr.push(link);byItem.set(itemId,arr);const aid=String(link.activity_id);byActivity.set(aid,(byActivity.get(aid)||0)+1)}
  const itemRows=items.map(item=>{const ls=byItem.get(String(item.id))||[],handling_kind=kindFor(item),project_condition=isHandledProjectCondition(item);return{...item,handling_kind,handling_kinds:[handling_kind],mapped_activity_count:ls.length,mapped_activity_ids:ls.map(x=>String(x.activity_id)),mapped_activity_titles:ls.map(x=>String(x.activity_title||'')).filter(Boolean).join(' || ')||null,project_condition,mapping_needs_repair:false}});
  const activityRows=activities.map(a=>({...a,governing_item_count:byActivity.get(String(a.id))||0}));
  const documentRows=documents.map(d=>{
   const rows=itemRows.filter(i=>String(i.governing_document_id)===String(d.id));
   const item_count=rows.length;
   const exception_count=rows.filter(i=>EXCEPTIONS.has(String(i.handling_status||''))).length;
   const project_condition_count=rows.filter(i=>i.project_condition&&String(i.handling_status||'')==='handled').length;
   const mapped_count=rows.filter(i=>!EXCEPTIONS.has(String(i.handling_status||''))&&!(i.project_condition&&String(i.handling_status||'')==='handled')&&Number(i.mapped_activity_count)>0).length;
   const uncovered_count=rows.filter(i=>!EXCEPTIONS.has(String(i.handling_status||''))&&!(i.project_condition&&String(i.handling_status||'')==='handled')&&Number(i.mapped_activity_count)===0).length;
   const covered_count=mapped_count+exception_count+project_condition_count;
   return{...d,item_count,mapped_count,exception_count,project_condition_count,covered_count,uncovered_count,coverage_percent:item_count?Math.round(covered_count*100/item_count):100};
  });
  const item_count=documentRows.reduce((s,d)=>s+Number(d.item_count||0),0),mapped_count=documentRows.reduce((s,d)=>s+Number(d.mapped_count||0),0),exception_count=documentRows.reduce((s,d)=>s+Number(d.exception_count||0),0),project_condition_count=documentRows.reduce((s,d)=>s+Number(d.project_condition_count||0),0),uncovered_count=documentRows.reduce((s,d)=>s+Number(d.uncovered_count||0),0),covered_count=mapped_count+exception_count+project_condition_count;
  console.error('Governing mapping primary pipeline failed; fallback used',cause);
  return c.json({ok:true,runtime:'mapping-v18-fallback',summary:{item_count,mapped_count,exception_count,project_condition_count,covered_count,uncovered_count,coverage_percent:item_count?Math.round(covered_count*100/item_count):100},documents:documentRows,items:itemRows,activities:activityRows,suggestions:{}},200);
 }catch(error){console.error('Governing mapping fallback failed',error);return c.json({ok:false,error:`Kartläggningen kunde inte läsas: ${error instanceof Error?error.message:String(error)}`},500)}
}

export function registerGoverningMappingRoutesV18(app:RouteApp){
 const proxy:RouteApp={
  get(path,handler){if(path!=='/api/studio/projects/:projectId/governing-mapping'){app.get(path,handler);return}app.get(path,async c=>{try{const response:any=await handler(c);if(response&&response.ok)return response;return fallbackMapping(c,`Primär pipeline returnerade HTTP ${response?.status||'okänt'}`)}catch(error){return fallbackMapping(c,error)}})},
  put(path,handler){app.put(path,handler)},post(path,handler){app.post(path,handler)}
 };
 registerGoverningMappingRoutesV17(proxy);
}
