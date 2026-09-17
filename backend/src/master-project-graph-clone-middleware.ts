function parseObject(raw:unknown){try{const value=JSON.parse(String(raw||'{}'));return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{} }catch{return{}}}
function norm(value:unknown){return String(value||'').trim().toLocaleLowerCase('sv-SE').replace(/\s+/g,' ')}

async function ensureGraphSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS master_graph_states(master_project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_project_id) REFERENCES master_projects(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS project_graph_states(project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
}

type ModuleTaskMeta={groupCode:string;moduleCode:string;selectionMode:string};
type TaskLinkRow={entity_id:string;master_entity_id:string;title:string;work_section_id:string};

function offsetPosition(value:unknown,index:number){
 if(!index||!value||typeof value!=='object'||Array.isArray(value))return value;
 const copy={...(value as Record<string,unknown>)};
 if(typeof copy.y==='number')copy.y=copy.y+index*140;
 else if(typeof copy.x==='number')copy.x=copy.x+index*180;
 return copy;
}

function remapMasterGraph(row:any,resolveTasks:(masterId:string)=>string[]){
 const dependencies=parseObject(row?.dependencies_json),positions=parseObject(row?.positions_json),routes=parseObject(row?.routes_json);
 const mappedDependencies:Record<string,string[]>={};
 for(const[masterChild,parents]of Object.entries(dependencies)){
  const projectChildren=resolveTasks(masterChild);
  const projectParents=[...new Set((Array.isArray(parents)?parents:[]).flatMap(id=>resolveTasks(String(id))))];
  for(const projectChild of projectChildren){
   const validParents=projectParents.filter(id=>id!==projectChild);
   mappedDependencies[projectChild]=[...new Set([...(mappedDependencies[projectChild]||[]),...validParents])];
  }
 }
 const mappedPositions:Record<string,unknown>={};
 for(const[masterId,value]of Object.entries(positions)){
  resolveTasks(masterId).forEach((projectId,index)=>{if(mappedPositions[projectId]===undefined)mappedPositions[projectId]=offsetPosition(value,index)});
 }
 const mappedRoutes:Record<string,unknown>={};
 for(const[key,value]of Object.entries(routes)){
  const[source,target]=key.split('->'),sources=resolveTasks(source),targets=resolveTasks(target);
  for(const projectSource of sources)for(const projectTarget of targets)if(projectSource!==projectTarget)mappedRoutes[`${projectSource}->${projectTarget}`]=value;
 }
 return{dependencies:mappedDependencies,positions:mappedPositions,routes:mappedRoutes};
}

async function consolidateFrameModule(db:D1Database,projectId:string,taskLinks:TaskLinkRow[],metaByMasterTask:Map<string,ModuleTaskMeta>){
 const canonical=taskLinks.find(row=>norm(row.title)==='res bärande stomme');
 if(!canonical)return'';
 const moduleRows=taskLinks.filter(row=>row.entity_id!==canonical.entity_id&&metaByMasterTask.get(String(row.master_entity_id))?.groupCode==='frame');
 for(const row of moduleRows){
  const [sourceActivities,targetActivities]=await Promise.all([
   db.prepare('SELECT id,title FROM activities WHERE task_id=? ORDER BY sort_order,id').bind(row.entity_id).all(),
   db.prepare('SELECT id,title FROM activities WHERE task_id=? ORDER BY sort_order,id').bind(canonical.entity_id).all()
  ]);
  const existingTitles=new Set((targetActivities.results as any[]).map(a=>norm(a.title)));
  for(const activity of sourceActivities.results as any[]){
   const activityId=String(activity.id),titleKey=norm(activity.title);
   if(existingTitles.has(titleKey)){
    await db.prepare("DELETE FROM project_master_node_links WHERE project_id=? AND entity_type='activity' AND entity_id=?").bind(projectId,activityId).run();
    await db.prepare('DELETE FROM activities WHERE id=?').bind(activityId).run();
   }else{
    await db.prepare('UPDATE activities SET task_id=? WHERE id=?').bind(canonical.entity_id,activityId).run();
    await db.prepare("DELETE FROM project_master_node_links WHERE project_id=? AND entity_type='activity' AND entity_id=?").bind(projectId,activityId).run();
    existingTitles.add(titleKey);
   }
  }
  await db.prepare("DELETE FROM project_master_node_links WHERE project_id=? AND entity_type='task' AND entity_id=?").bind(projectId,row.entity_id).run();
  await db.prepare('DELETE FROM tasks WHERE id=?').bind(row.entity_id).run();
  const sectionId=String(row.work_section_id||'');
  if(sectionId){
   const remains=await db.prepare('SELECT 1 ok FROM tasks WHERE work_section_id=? LIMIT 1').bind(sectionId).first();
   if(!remains){
    await db.prepare("DELETE FROM project_master_node_links WHERE project_id=? AND entity_type='work_section' AND entity_id=?").bind(projectId,sectionId).run();
    await db.prepare('DELETE FROM work_sections WHERE id=?').bind(sectionId).run();
   }
  }
 }
 return String(canonical.entity_id);
}

export async function cloneMasterGraphAfterProjectCreate(c:any,next:any){
 const path=String(c.req.path||'');
 const match=path.match(/^\/api\/studio\/master-projects\/([^/]+)\/create-project$/);
 if(c.req.method!=='POST'||!match){await next();return}
 await next();
 if(!c.res?.ok)return;
 try{
  const payload:any=await c.res.clone().json().catch(()=>null),projectId=String(payload?.project?.id||'');if(!projectId)return;
  const masterProjectId=decodeURIComponent(match[1]);await ensureGraphSchema(c.env.DB);
  const graph=await c.env.DB.prepare('SELECT dependencies_json,positions_json,routes_json FROM master_graph_states WHERE master_project_id=?').bind(masterProjectId).first<any>();
  if(!graph)return;
  const moduleRows=await c.env.DB.prepare(`SELECT t.id task_id,mm.group_code,mm.code module_code,mm.selection_mode FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id LEFT JOIN master_task_modules mtm ON mtm.master_task_id=t.id LEFT JOIN master_modules mm ON mm.id=mtm.module_id WHERE a.master_project_id=?`).bind(masterProjectId).all();
  const metaByMasterTask=new Map<string,ModuleTaskMeta>();
  for(const row of moduleRows.results as any[]){if(!row.group_code||!row.module_code)continue;metaByMasterTask.set(String(row.task_id),{groupCode:String(row.group_code),moduleCode:String(row.module_code),selectionMode:String(row.selection_mode||'single')})}
  const loadTaskLinks=async()=>{const rows=await c.env.DB.prepare(`SELECT l.entity_id,l.master_entity_id,t.title,t.work_section_id FROM project_master_node_links l JOIN tasks t ON t.id=l.entity_id WHERE l.project_id=? AND l.entity_type='task'`).bind(projectId).all();return rows.results as TaskLinkRow[]};
  let taskLinks=await loadTaskLinks();
  const canonicalFrameTask=await consolidateFrameModule(c.env.DB,projectId,taskLinks,metaByMasterTask);
  taskLinks=await loadTaskLinks();
  const taskMap=new Map<string,string>();for(const row of taskLinks)taskMap.set(String(row.master_entity_id),String(row.entity_id));
  const selectedGroupTasks=new Map<string,string[]>();
  for(const[masterTaskId,projectTaskId]of taskMap){const meta=metaByMasterTask.get(masterTaskId);if(!meta)continue;const list=selectedGroupTasks.get(meta.groupCode)||[];if(!list.includes(projectTaskId))list.push(projectTaskId);selectedGroupTasks.set(meta.groupCode,list)}
  const resolveTasks=(masterId:string):string[]=>{
   const meta=metaByMasterTask.get(masterId);
   if(meta){
    if(meta.groupCode==='frame'&&canonicalFrameTask)return[canonicalFrameTask];
    const selected=selectedGroupTasks.get(meta.groupCode)||[];
    if(meta.selectionMode==='multi')return selected;
    const direct=taskMap.get(masterId);if(direct)return[direct];
    if(meta.selectionMode==='single')return selected.slice(0,1);
    return[];
   }
   const direct=taskMap.get(masterId);return direct?[direct]:[];
  };
  const mapped=remapMasterGraph(graph,resolveTasks);
  await c.env.DB.prepare(`INSERT INTO project_graph_states(project_id,dependencies_json,positions_json,routes_json,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(project_id) DO UPDATE SET dependencies_json=excluded.dependencies_json,positions_json=excluded.positions_json,routes_json=excluded.routes_json,updated_at=datetime('now')`).bind(projectId,JSON.stringify(mapped.dependencies),JSON.stringify(mapped.positions),JSON.stringify(mapped.routes)).run();
 }catch(error){console.error('Master graph clone failed after project creation',error)}
}
