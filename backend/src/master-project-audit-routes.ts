import {sessionUser} from './auth-session';
import {isSystemAdmin} from './workspace-access';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};
type AuditKind='current'|'confirmed_duplicate'|'module_review'|'stale_base';
type ProjectTaskRef={id:string;title:string;masterEntityId:string};
type AuditTask={id:string;title:string;description:string;areaId:string;areaName:string;sectionId:string;sectionName:string;moduleCode:string;moduleName:string;activityCount:number;linkedToSource:boolean;kind:AuditKind;cleanupCandidate:boolean;sameTitleProjectTask:ProjectTaskRef|null};

const LEGACY_REPLACEMENTS=new Map<string,string>([
 ['log|utför timmerstomme','res bärande stomme'],
 ['purlin|bygg åstak','bygg åstak och bärande takkonstruktion'],
 ['municipal_water|anslut kommunalt vatten','förlägg och anslut servisledning för vatten'],
 ['shared_water|anslut gemensamt vatten','förlägg och anslut servisledning för vatten']
]);

function norm(value:unknown){return String(value||'').trim().toLocaleLowerCase('sv-SE').replace(/\s+/g,' ')}
function canonicalScore(row:any){let score=0;if(String(row.module_code||''))score+=10;if(norm(row.section_name).startsWith('vald '))score+=5;if(Number(row.linked_to_source)===1)score+=1;return score}
async function authorize(c:any){const user=await sessionUser(c);if(!user)return{response:c.json({ok:false,error:'Du måste vara inloggad.'},401)};if(!await isSystemAdmin(c.env.DB,user))return{response:c.json({ok:false,error:'Endast systemadministratör kan analysera eller städa Masterprojekt.'},403)};return{user}}
async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}

async function audit(db:D1Database,masterProjectId:string,projectId:string){
 const [master,snapshot]=await Promise.all([
  db.prepare('SELECT id,code,name,version,status FROM master_projects WHERE id=?').bind(masterProjectId).first<any>(),
  db.prepare('SELECT master_project_id,master_project_code,master_project_version FROM project_master_snapshots WHERE project_id=?').bind(projectId).first<any>()
 ]);
 if(!master)return{status:404,error:'Masterprojektet hittades inte.'} as const;
 if(String(master.status)!=='active')return{status:409,error:'Endast ett aktivt Masterprojekt kan analyseras.'} as const;
 if(!snapshot)return{status:409,error:'Projektet saknar Masterkoppling och kan inte användas som jämförelsekälla.'} as const;
 if(String(snapshot.master_project_id)!==masterProjectId)return{status:409,error:'Projektet är skapat från ett annat Masterprojekt.'} as const;

 let selectedModuleCodes:string[]=[];
 if(await tableExists(db,'project_master_module_selections')){const rows=await db.prepare('SELECT module_code FROM project_master_module_selections WHERE project_id=? ORDER BY module_code').bind(projectId).all();selectedModuleCodes=(rows.results as any[]).map(r=>String(r.module_code))}
 const projectRows=await db.prepare(`SELECT t.id,t.title,COALESCE(l.master_entity_id,'') master_entity_id FROM tasks t JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas a ON a.id=s.work_area_id LEFT JOIN project_master_node_links l ON l.project_id=? AND l.entity_type='task' AND l.entity_id=t.id WHERE a.project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,t.id`).bind(projectId,projectId).all();
 const projectByTitle=new Map<string,ProjectTaskRef>();
 for(const row of projectRows.results as any[]){const k=norm(row.title);if(!k)continue;const next={id:String(row.id),title:String(row.title),masterEntityId:String(row.master_entity_id||'')},current=projectByTitle.get(k);if(!current||(!current.masterEntityId&&next.masterEntityId))projectByTitle.set(k,next)}
 const masterRows=await db.prepare(`SELECT t.id,t.title,t.description,s.id section_id,s.name section_name,a.id area_id,a.name area_name,COALESCE(mm.code,'') module_code,COALESCE(mm.name,'') module_name,(SELECT COUNT(*) FROM master_activities ma WHERE ma.master_task_id=t.id) activity_count,CASE WHEN EXISTS(SELECT 1 FROM project_master_node_links l WHERE l.project_id=? AND l.entity_type='task' AND l.master_entity_id=t.id) THEN 1 ELSE 0 END linked_to_source FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id LEFT JOIN master_task_modules mtm ON mtm.master_task_id=t.id LEFT JOIN master_modules mm ON mm.id=mtm.module_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,t.id`).bind(projectId,masterProjectId).all();
 const rawMasterRows=masterRows.results as any[];
 const canonicalByTitle=new Map<string,any>();
 for(const row of rawMasterRows){const key=norm(row.title);if(!key)continue;const current=canonicalByTitle.get(key);if(!current||canonicalScore(row)>canonicalScore(current))canonicalByTitle.set(key,row)}
 const tasks:AuditTask[]=rawMasterRows.map(row=>{
  const id=String(row.id),linkedToSource=Number(row.linked_to_source)===1,moduleCode=String(row.module_code||''),title=String(row.title||'');
  const legacyReplacementTitle=LEGACY_REPLACEMENTS.get(`${moduleCode}|${norm(title)}`)||'';
  const sameTitleProjectTask=projectByTitle.get(norm(title))||null,replacementProjectTask=legacyReplacementTitle?projectByTitle.get(legacyReplacementTitle)||null:null,matchingProjectTask=sameTitleProjectTask||replacementProjectTask;
  const canonicalMaster=canonicalByTitle.get(norm(title));
  const duplicateOfCanonical=Boolean(canonicalMaster&&String(canonicalMaster.id)!==id&&String(canonicalMaster.module_code||''));
  const representedByOther=Boolean(!linkedToSource&&matchingProjectTask?.masterEntityId&&matchingProjectTask.masterEntityId!==id);
  let kind:AuditKind;
  if(duplicateOfCanonical)kind='confirmed_duplicate';else if(linkedToSource)kind='current';else if(representedByOther)kind='confirmed_duplicate';else if(moduleCode)kind='module_review';else kind='stale_base';
  return{id,title,description:String(row.description||''),areaId:String(row.area_id),areaName:String(row.area_name||''),sectionId:String(row.section_id),sectionName:String(row.section_name||''),moduleCode,moduleName:String(row.module_name||''),activityCount:Number(row.activity_count||0),linkedToSource,kind,cleanupCandidate:kind==='confirmed_duplicate'||kind==='stale_base',sameTitleProjectTask:matchingProjectTask};
 });
 const count=(kind:AuditKind)=>tasks.filter(t=>t.kind===kind).length;
 return{status:200,data:{ok:true,master:{id:String(master.id),code:String(master.code||''),name:String(master.name||''),version:Number(master.version||0)},sourceProject:{id:projectId,snapshotVersion:Number(snapshot.master_project_version||0),selectedModuleCodes},summary:{total:tasks.length,current:count('current'),confirmedDuplicates:count('confirmed_duplicate'),moduleReview:count('module_review'),staleBase:count('stale_base'),cleanupCandidates:tasks.filter(t=>t.cleanupCandidate).length},tasks}} as const;
}

export function registerMasterProjectAuditRoutes(app:RouteApp){
 app.get('/api/studio/master-projects/:masterProjectId/audit-against-project/:projectId',async c=>{const auth=await authorize(c);if(auth.response)return auth.response;try{const result=await audit(c.env.DB,String(c.req.param('masterProjectId')),String(c.req.param('projectId')));if('error'in result)return c.json({ok:false,error:result.error},result.status);return c.json(result.data)}catch(error){console.error('Master audit failed',error);return c.json({ok:false,error:`Masteranalysen misslyckades: ${error instanceof Error?error.message:String(error)}`},500)}});
 app.post('/api/studio/master-projects/:masterProjectId/cleanup-against-project/:projectId',async c=>{const auth=await authorize(c);if(auth.response)return auth.response;const masterProjectId=String(c.req.param('masterProjectId')),projectId=String(c.req.param('projectId'));try{const result=await audit(c.env.DB,masterProjectId,projectId);if('error'in result)return c.json({ok:false,error:result.error},result.status);const candidates=result.data.tasks.filter(t=>t.cleanupCandidate);if(!candidates.length)return c.json({ok:true,masterProjectId,projectId,version:result.data.master.version,deletedTasks:[],deletedCount:0,message:'Inga säkra städkandidater hittades.'});const ids=candidates.map(t=>t.id),placeholders=ids.map(()=>'?').join(',');await c.env.DB.batch([
  c.env.DB.prepare(`DELETE FROM master_activity_contexts WHERE master_activity_id IN (SELECT id FROM master_activities WHERE master_task_id IN (${placeholders}))`).bind(...ids),
  c.env.DB.prepare(`DELETE FROM master_activities WHERE master_task_id IN (${placeholders})`).bind(...ids),
  c.env.DB.prepare(`DELETE FROM master_task_modules WHERE master_task_id IN (${placeholders})`).bind(...ids),
  c.env.DB.prepare(`DELETE FROM master_tasks WHERE id IN (${placeholders})`).bind(...ids)
 ]);
 await c.env.DB.prepare(`DELETE FROM master_work_sections WHERE id IN (SELECT s.id FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=?) AND NOT EXISTS (SELECT 1 FROM master_tasks t WHERE t.master_work_section_id=master_work_sections.id)`).bind(masterProjectId).run();
 await c.env.DB.prepare(`DELETE FROM master_work_areas WHERE master_project_id=? AND NOT EXISTS (SELECT 1 FROM master_work_sections s WHERE s.master_work_area_id=master_work_areas.id)`).bind(masterProjectId).run();
 await c.env.DB.prepare("UPDATE master_projects SET version=version+1,updated_at=datetime('now') WHERE id=?").bind(masterProjectId).run();const updated=await c.env.DB.prepare('SELECT version FROM master_projects WHERE id=?').bind(masterProjectId).first<any>();const version=Number(updated?.version||result.data.master.version+1);await c.env.DB.prepare('UPDATE project_master_snapshots SET master_project_version=? WHERE project_id=? AND master_project_id=?').bind(version,projectId,masterProjectId).run();return c.json({ok:true,masterProjectId,projectId,version,deletedCount:candidates.length,deletedTasks:candidates.map(t=>({id:t.id,title:t.title,kind:t.kind,moduleCode:t.moduleCode,areaName:t.areaName,sectionName:t.sectionName}))});}catch(error){console.error('Master cleanup failed',error);return c.json({ok:false,error:`Masterstädningen misslyckades: ${error instanceof Error?error.message:String(error)}`},500)}});
}
