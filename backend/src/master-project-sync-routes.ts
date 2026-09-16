type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

type GraphState={dependencies:Record<string,string[]>;positions:Record<string,unknown>;routes:Record<string,unknown>};

function parseObject(raw:unknown){try{const value=JSON.parse(String(raw||'{}'));return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{} }catch{return{}}}

async function ensureSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS project_master_snapshots(project_id TEXT PRIMARY KEY,master_project_id TEXT NOT NULL,master_project_code TEXT NOT NULL,master_project_version INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS project_master_node_links(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,entity_type TEXT NOT NULL CHECK(entity_type IN ('work_area','work_section','task','activity')),entity_id TEXT NOT NULL,master_entity_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(project_id,entity_type,entity_id),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS master_graph_states(master_project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_project_id) REFERENCES master_projects(id) ON DELETE CASCADE)`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS project_graph_states(project_id TEXT PRIMARY KEY,dependencies_json TEXT NOT NULL DEFAULT '{}',positions_json TEXT NOT NULL DEFAULT '{}',routes_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
}

async function link(db:D1Database,projectId:string,type:string,entityId:string,masterId:string){
 await db.prepare(`INSERT INTO project_master_node_links(id,project_id,entity_type,entity_id,master_entity_id) VALUES(?,?,?,?,?) ON CONFLICT(project_id,entity_type,entity_id) DO UPDATE SET master_entity_id=excluded.master_entity_id`).bind(crypto.randomUUID(),projectId,type,entityId,masterId).run();
}

function remapGraph(row:any,taskMap:Map<string,string>):GraphState{
 const dependencies=parseObject(row?.dependencies_json),positions=parseObject(row?.positions_json),routes=parseObject(row?.routes_json);
 const mappedDependencies:Record<string,string[]>={};
 for(const[projectChild,parents]of Object.entries(dependencies)){
  const masterChild=taskMap.get(projectChild);if(!masterChild)continue;
  mappedDependencies[masterChild]=(Array.isArray(parents)?parents:[]).map(id=>taskMap.get(String(id))).filter((id):id is string=>Boolean(id));
 }
 const mappedPositions:Record<string,unknown>={};
 for(const[projectId,value]of Object.entries(positions)){const masterId=taskMap.get(projectId);if(masterId)mappedPositions[masterId]=value}
 const mappedRoutes:Record<string,unknown>={};
 for(const[key,value]of Object.entries(routes)){
  const[source,target]=key.split('->');const masterSource=taskMap.get(source),masterTarget=taskMap.get(target);
  if(masterSource&&masterTarget)mappedRoutes[`${masterSource}->${masterTarget}`]=value;
 }
 return{dependencies:mappedDependencies,positions:mappedPositions,routes:mappedRoutes};
}

export function registerMasterProjectSyncRoutes(app:RouteApp){
 app.post('/api/studio/master-projects/:masterProjectId/sync-from-project/:projectId',async c=>{
  await ensureSchema(c.env.DB);
  const masterProjectId=String(c.req.param('masterProjectId')),projectId=String(c.req.param('projectId'));
  const master=await c.env.DB.prepare('SELECT id,code,version,status FROM master_projects WHERE id=?').bind(masterProjectId).first<any>();
  if(!master)return c.json({ok:false,error:'Masterprojektet hittades inte.'},404);
  if(String(master.status)!=='active')return c.json({ok:false,error:'Endast ett aktivt masterprojekt kan synkas.'},409);
  const snapshot=await c.env.DB.prepare('SELECT master_project_id FROM project_master_snapshots WHERE project_id=?').bind(projectId).first<any>();
  if(!snapshot)return c.json({ok:false,error:'Projektet saknar koppling till ett masterprojekt och kan inte användas som synkkälla.'},409);
  if(String(snapshot.master_project_id)!==masterProjectId)return c.json({ok:false,error:'Projektet är skapat från ett annat masterprojekt.'},409);
  const graphRow=await c.env.DB.prepare('SELECT dependencies_json,positions_json,routes_json FROM project_graph_states WHERE project_id=?').bind(projectId).first<any>();
  if(!graphRow)return c.json({ok:false,error:'Projektet saknar sparad graph state. Öppna och spara Grafisk plan innan Master synkas.'},409);

  const [areaRows,sectionRows,taskRows,activityRows,linkRows]=await Promise.all([
   c.env.DB.prepare('SELECT id,name,sort_order FROM work_areas WHERE project_id=? ORDER BY sort_order,id').bind(projectId).all(),
   c.env.DB.prepare(`SELECT s.id,s.work_area_id,s.name,s.sort_order FROM work_sections s JOIN work_areas a ON a.id=s.work_area_id WHERE a.project_id=? ORDER BY a.sort_order,s.sort_order,s.id`).bind(projectId).all(),
   c.env.DB.prepare(`SELECT t.id,t.work_section_id,t.title,t.description,t.sort_order FROM tasks t JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas a ON a.id=s.work_area_id WHERE a.project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,t.id`).bind(projectId).all(),
   c.env.DB.prepare(`SELECT a.id,a.task_id,a.title,a.description,a.activity_type,a.required,a.sort_order,COALESCE(ac.lifecycle_stage,'build') lifecycle_stage,COALESCE(ac.surface,'field') surface,COALESCE(ac.applicability,'always') applicability,COALESCE(ac.condition_text,'') condition_text FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE w.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated' ORDER BY w.sort_order,s.sort_order,t.sort_order,a.sort_order,a.id`).bind(projectId).all(),
   c.env.DB.prepare('SELECT id,entity_type,entity_id,master_entity_id FROM project_master_node_links WHERE project_id=?').bind(projectId).all()
  ]);
  const areas=areaRows.results as any[],sections=sectionRows.results as any[],tasks=taskRows.results as any[],activities=activityRows.results as any[],links=linkRows.results as any[];
  const existing=new Map<string,string>();for(const row of links)existing.set(`${row.entity_type}:${row.entity_id}`,String(row.master_entity_id));
  const areaMap=new Map<string,string>(),sectionMap=new Map<string,string>(),taskMap=new Map<string,string>(),activityMap=new Map<string,string>();
  let createdAreas=0,createdSections=0,createdTasks=0,createdActivities=0,deletedActivities=0,deletedTasks=0,deletedSections=0,deletedAreas=0;

  for(const source of areas){
   let masterId=existing.get(`work_area:${source.id}`)||'';
   if(masterId){const row=await c.env.DB.prepare('SELECT id FROM master_work_areas WHERE id=? AND master_project_id=?').bind(masterId,masterProjectId).first();if(!row)masterId=''}
   if(!masterId){masterId=crypto.randomUUID();createdAreas++;await c.env.DB.prepare("INSERT INTO master_work_areas(id,master_project_id,number,name,sort_order) VALUES(?,?,'',?,?)").bind(masterId,masterProjectId,source.name,Number(source.sort_order||0)).run()}
   else await c.env.DB.prepare('UPDATE master_work_areas SET name=?,sort_order=? WHERE id=?').bind(source.name,Number(source.sort_order||0),masterId).run();
   areaMap.set(String(source.id),masterId);await link(c.env.DB,projectId,'work_area',String(source.id),masterId);
  }
  for(const source of sections){
   const masterAreaId=areaMap.get(String(source.work_area_id));if(!masterAreaId)continue;
   let masterId=existing.get(`work_section:${source.id}`)||'';
   if(masterId){const row=await c.env.DB.prepare('SELECT id FROM master_work_sections WHERE id=?').bind(masterId).first();if(!row)masterId=''}
   if(!masterId){masterId=crypto.randomUUID();createdSections++;await c.env.DB.prepare("INSERT INTO master_work_sections(id,master_work_area_id,number,name,sort_order) VALUES(?,?,'',?,?)").bind(masterId,masterAreaId,source.name,Number(source.sort_order||0)).run()}
   else await c.env.DB.prepare('UPDATE master_work_sections SET master_work_area_id=?,name=?,sort_order=? WHERE id=?').bind(masterAreaId,source.name,Number(source.sort_order||0),masterId).run();
   sectionMap.set(String(source.id),masterId);await link(c.env.DB,projectId,'work_section',String(source.id),masterId);
  }
  for(const source of tasks){
   const masterSectionId=sectionMap.get(String(source.work_section_id));if(!masterSectionId)continue;
   let masterId=existing.get(`task:${source.id}`)||'';
   if(masterId){const row=await c.env.DB.prepare('SELECT id FROM master_tasks WHERE id=?').bind(masterId).first();if(!row)masterId=''}
   if(!masterId){masterId=crypto.randomUUID();createdTasks++;await c.env.DB.prepare('INSERT INTO master_tasks(id,master_work_section_id,title,description,sort_order) VALUES(?,?,?,?,?)').bind(masterId,masterSectionId,source.title,source.description||'',Number(source.sort_order||0)).run()}
   else await c.env.DB.prepare('UPDATE master_tasks SET master_work_section_id=?,title=?,description=?,sort_order=? WHERE id=?').bind(masterSectionId,source.title,source.description||'',Number(source.sort_order||0),masterId).run();
   taskMap.set(String(source.id),masterId);await link(c.env.DB,projectId,'task',String(source.id),masterId);
  }
  for(const source of activities){
   const masterTaskId=taskMap.get(String(source.task_id));if(!masterTaskId)continue;
   let masterId=existing.get(`activity:${source.id}`)||'';
   if(masterId){const row=await c.env.DB.prepare('SELECT id FROM master_activities WHERE id=?').bind(masterId).first();if(!row)masterId=''}
   if(!masterId){masterId=crypto.randomUUID();createdActivities++;await c.env.DB.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,?,?)').bind(masterId,masterTaskId,source.title,source.description||'',source.activity_type||'perform',Number(source.required??1),Number(source.sort_order||0)).run()}
   else await c.env.DB.prepare('UPDATE master_activities SET master_task_id=?,title=?,description=?,activity_type=?,required=?,sort_order=? WHERE id=?').bind(masterTaskId,source.title,source.description||'',source.activity_type||'perform',Number(source.required??1),Number(source.sort_order||0),masterId).run();
   await c.env.DB.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET lifecycle_stage=excluded.lifecycle_stage,surface=excluded.surface,applicability=excluded.applicability,condition_text=excluded.condition_text,updated_at=datetime('now')`).bind(masterId,source.lifecycle_stage,source.surface,'always',source.condition_text||'').run();
   activityMap.set(String(source.id),masterId);await link(c.env.DB,projectId,'activity',String(source.id),masterId);
  }

  const currentIds={work_area:new Set(areas.map(x=>String(x.id))),work_section:new Set(sections.map(x=>String(x.id))),task:new Set(tasks.map(x=>String(x.id))),activity:new Set(activities.map(x=>String(x.id)))};
  for(const row of links.filter(x=>String(x.entity_type)==='activity'))if(!currentIds.activity.has(String(row.entity_id))){await c.env.DB.prepare('DELETE FROM master_activity_contexts WHERE master_activity_id=?').bind(row.master_entity_id).run();await c.env.DB.prepare('DELETE FROM master_activities WHERE id=?').bind(row.master_entity_id).run();await c.env.DB.prepare('DELETE FROM project_master_node_links WHERE id=?').bind(row.id).run();deletedActivities++}
  for(const row of links.filter(x=>String(x.entity_type)==='task'))if(!currentIds.task.has(String(row.entity_id))){const activityIds=await c.env.DB.prepare('SELECT id FROM master_activities WHERE master_task_id=?').bind(row.master_entity_id).all();for(const a of activityIds.results as any[])await c.env.DB.prepare('DELETE FROM master_activity_contexts WHERE master_activity_id=?').bind(a.id).run();await c.env.DB.prepare('DELETE FROM master_activities WHERE master_task_id=?').bind(row.master_entity_id).run();try{await c.env.DB.prepare('DELETE FROM master_task_modules WHERE master_task_id=?').bind(row.master_entity_id).run()}catch{}await c.env.DB.prepare('DELETE FROM master_tasks WHERE id=?').bind(row.master_entity_id).run();await c.env.DB.prepare('DELETE FROM project_master_node_links WHERE id=?').bind(row.id).run();deletedTasks++}
  for(const row of links.filter(x=>String(x.entity_type)==='work_section'))if(!currentIds.work_section.has(String(row.entity_id))){const child=await c.env.DB.prepare('SELECT COUNT(*) count FROM master_tasks WHERE master_work_section_id=?').bind(row.master_entity_id).first<any>();if(Number(child?.count||0)===0){await c.env.DB.prepare('DELETE FROM master_work_sections WHERE id=?').bind(row.master_entity_id).run();deletedSections++}await c.env.DB.prepare('DELETE FROM project_master_node_links WHERE id=?').bind(row.id).run()}
  for(const row of links.filter(x=>String(x.entity_type)==='work_area'))if(!currentIds.work_area.has(String(row.entity_id))){const child=await c.env.DB.prepare('SELECT COUNT(*) count FROM master_work_sections WHERE master_work_area_id=?').bind(row.master_entity_id).first<any>();if(Number(child?.count||0)===0){await c.env.DB.prepare('DELETE FROM master_work_areas WHERE id=?').bind(row.master_entity_id).run();deletedAreas++}await c.env.DB.prepare('DELETE FROM project_master_node_links WHERE id=?').bind(row.id).run()}

  const masterGraph=remapGraph(graphRow,taskMap);
  await c.env.DB.prepare(`INSERT INTO master_graph_states(master_project_id,dependencies_json,positions_json,routes_json,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(master_project_id) DO UPDATE SET dependencies_json=excluded.dependencies_json,positions_json=excluded.positions_json,routes_json=excluded.routes_json,updated_at=datetime('now')`).bind(masterProjectId,JSON.stringify(masterGraph.dependencies),JSON.stringify(masterGraph.positions),JSON.stringify(masterGraph.routes)).run();
  await c.env.DB.prepare("UPDATE master_projects SET version=version+1,updated_at=datetime('now') WHERE id=?").bind(masterProjectId).run();
  const updated=await c.env.DB.prepare('SELECT version FROM master_projects WHERE id=?').bind(masterProjectId).first<any>();
  await c.env.DB.prepare('UPDATE project_master_snapshots SET master_project_version=? WHERE project_id=?').bind(Number(updated?.version||master.version),projectId).run();
  return c.json({ok:true,masterProjectId,projectId,version:Number(updated?.version||master.version),graphSynced:true,created:{areas:createdAreas,sections:createdSections,tasks:createdTasks,activities:createdActivities},deleted:{areas:deletedAreas,sections:deletedSections,tasks:deletedTasks,activities:deletedActivities},counts:{areas:areas.length,sections:sections.length,tasks:tasks.length,activities:activities.length}});
 });
}
