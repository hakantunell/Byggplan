function parseObject(raw:unknown){try{const value=JSON.parse(String(raw||'{}'));return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{} }catch{return{}}}

async function ensureGraphSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS master_graph_states(master_project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_project_id) REFERENCES master_projects(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS project_graph_states(project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
}

function remapMasterGraph(row:any,taskMap:Map<string,string>){
 const dependencies=parseObject(row?.dependencies_json),positions=parseObject(row?.positions_json),routes=parseObject(row?.routes_json);
 const mappedDependencies:Record<string,string[]>={};
 for(const[masterChild,parents]of Object.entries(dependencies)){
  const projectChild=taskMap.get(masterChild);if(!projectChild)continue;
  mappedDependencies[projectChild]=(Array.isArray(parents)?parents:[]).map(id=>taskMap.get(String(id))).filter((id):id is string=>Boolean(id));
 }
 const mappedPositions:Record<string,unknown>={};
 for(const[masterId,value]of Object.entries(positions)){const projectId=taskMap.get(masterId);if(projectId)mappedPositions[projectId]=value}
 const mappedRoutes:Record<string,unknown>={};
 for(const[key,value]of Object.entries(routes)){
  const[source,target]=key.split('->');const projectSource=taskMap.get(source),projectTarget=taskMap.get(target);
  if(projectSource&&projectTarget)mappedRoutes[`${projectSource}->${projectTarget}`]=value;
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
  const rows=await c.env.DB.prepare("SELECT entity_id,master_entity_id FROM project_master_node_links WHERE project_id=? AND entity_type='task'").bind(projectId).all();
  const taskMap=new Map<string,string>();for(const row of rows.results as any[])taskMap.set(String(row.master_entity_id),String(row.entity_id));
  const mapped=remapMasterGraph(graph,taskMap);
  await c.env.DB.prepare(`INSERT INTO project_graph_states(project_id,dependencies_json,positions_json,routes_json,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(project_id) DO UPDATE SET dependencies_json=excluded.dependencies_json,positions_json=excluded.positions_json,routes_json=excluded.routes_json,updated_at=datetime('now')`).bind(projectId,JSON.stringify(mapped.dependencies),JSON.stringify(mapped.positions),JSON.stringify(mapped.routes)).run();
 }catch(error){console.error('Master graph clone failed after project creation',error)}
}
