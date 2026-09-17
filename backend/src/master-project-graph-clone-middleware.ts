function parseObject(raw:unknown){try{const value=JSON.parse(String(raw||'{}'));return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{} }catch{return{}}}

async function ensureGraphSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS master_graph_states(master_project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_project_id) REFERENCES master_projects(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS project_graph_states(project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
}

type ModuleTaskMeta={groupCode:string;moduleCode:string;selectionMode:string};

function remapMasterGraph(row:any,resolveTask:(masterId:string)=>string|undefined){
 const dependencies=parseObject(row?.dependencies_json),positions=parseObject(row?.positions_json),routes=parseObject(row?.routes_json);
 const mappedDependencies:Record<string,string[]>={};
 for(const[masterChild,parents]of Object.entries(dependencies)){
  const projectChild=resolveTask(masterChild);if(!projectChild)continue;
  const mappedParents=(Array.isArray(parents)?parents:[]).map(id=>resolveTask(String(id))).filter((id):id is string=>Boolean(id)&&id!==projectChild);
  mappedDependencies[projectChild]=[...new Set([...(mappedDependencies[projectChild]||[]),...mappedParents])];
 }
 const mappedPositions:Record<string,unknown>={};
 for(const[masterId,value]of Object.entries(positions)){const projectId=resolveTask(masterId);if(projectId&&mappedPositions[projectId]===undefined)mappedPositions[projectId]=value}
 const mappedRoutes:Record<string,unknown>={};
 for(const[key,value]of Object.entries(routes)){
  const[source,target]=key.split('->');const projectSource=resolveTask(source),projectTarget=resolveTask(target);
  if(projectSource&&projectTarget&&projectSource!==projectTarget)mappedRoutes[`${projectSource}->${projectTarget}`]=value;
 }
 return{dependencies:mappedDependencies,positions:mappedPositions,routes:mappedRoutes};
}

export async function cloneMasterGraphAfterProjectCreate(c:any,next:any){
 const path=String(c.req.path||'');
 const match=path.match(/^\/api\/studio\/master-projects\/([^/]+)\/create-project$/);
 if(c.req.method!=='POST'||!match){await next();return}
 await next();
 if(!c.res?.ok)return;
 try{
  const payload:any=await c.res.clone().json().catch(()=>null);const projectId=String(payload?.project?.id||'');if(!projectId)return;
  const masterProjectId=decodeURIComponent(match[1]);await ensureGraphSchema(c.env.DB);
  const graph=await c.env.DB.prepare('SELECT dependencies_json,positions_json,routes_json FROM master_graph_states WHERE master_project_id=?').bind(masterProjectId).first<any>();
  if(!graph)return;
  const [linkRows,moduleRows]=await Promise.all([
   c.env.DB.prepare("SELECT entity_id,master_entity_id FROM project_master_node_links WHERE project_id=? AND entity_type='task'").bind(projectId).all(),
   c.env.DB.prepare(`SELECT t.id task_id,mm.group_code,mm.code module_code,mm.selection_mode FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id LEFT JOIN master_task_modules mtm ON mtm.master_task_id=t.id LEFT JOIN master_modules mm ON mm.id=mtm.module_id WHERE a.master_project_id=?`).bind(masterProjectId).all()
  ]);
  const taskMap=new Map<string,string>();for(const row of linkRows.results as any[])taskMap.set(String(row.master_entity_id),String(row.entity_id));
  const metaByMasterTask=new Map<string,ModuleTaskMeta>();
  for(const row of moduleRows.results as any[]){if(!row.group_code||!row.module_code)continue;metaByMasterTask.set(String(row.task_id),{groupCode:String(row.group_code),moduleCode:String(row.module_code),selectionMode:String(row.selection_mode||'single')})}
  const selectedGroupTask=new Map<string,string>();
  for(const[masterTaskId,projectTaskId]of taskMap){const meta=metaByMasterTask.get(masterTaskId);if(meta?.selectionMode==='single')selectedGroupTask.set(meta.groupCode,projectTaskId)}
  const resolveTask=(masterId:string)=>{
   const direct=taskMap.get(masterId);if(direct)return direct;
   const meta=metaByMasterTask.get(masterId);if(meta?.selectionMode==='single')return selectedGroupTask.get(meta.groupCode);
   return undefined;
  };
  const mapped=remapMasterGraph(graph,resolveTask);
  await c.env.DB.prepare(`INSERT INTO project_graph_states(project_id,dependencies_json,positions_json,routes_json,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(project_id) DO UPDATE SET dependencies_json=excluded.dependencies_json,positions_json=excluded.positions_json,routes_json=excluded.routes_json,updated_at=datetime('now')`).bind(projectId,JSON.stringify(mapped.dependencies),JSON.stringify(mapped.positions),JSON.stringify(mapped.routes)).run();
 }catch(error){console.error('Master graph clone failed after project creation',error)}
}
