import { ensureMasterV25 } from './master-project-v2-upgrade-routes-v25';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

function normalized(value:unknown){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ')}
function isGeneric(value:unknown){const text=normalized(value);return !text||text.includes('generell aktivitet')||text.includes('generell kontrollpunkt')||text.includes('kopplas till styrdokument')}

export function registerProjectTaskDescriptionRefreshRoutes(app:RouteApp){
 app.post('/api/studio/projects/:projectId/refresh-master-task-descriptions',async c=>{
  const projectId=c.req.param('projectId');
  try{
   const snapshot=await c.env.DB.prepare('SELECT master_project_id,master_project_code FROM project_master_snapshots WHERE project_id=?').bind(projectId).first<any>();
   if(!snapshot)return c.json({ok:false,error:'Projektet har ingen Master-snapshot.'},409);
   let master=await c.env.DB.prepare('SELECT id,code,version FROM master_projects WHERE id=?').bind(snapshot.master_project_id).first<any>();
   if(!master)master=await c.env.DB.prepare('SELECT id,code,version FROM master_projects WHERE code=?').bind(snapshot.master_project_code).first<any>();
   if(!master)return c.json({ok:false,error:'Masterprojektet hittades inte.'},409);
   if(String(master.code)==='fritidshus-v2'){await ensureMasterV25(c.env.DB,String(master.id));master=await c.env.DB.prepare('SELECT id,code,version FROM master_projects WHERE id=?').bind(master.id).first<any>()}

   const masterRows=await c.env.DB.prepare(`SELECT t.id,t.title,t.description,s.name section_name FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas w ON w.id=s.master_work_area_id WHERE w.master_project_id=? ORDER BY t.id`).bind(master.id).all();
   const projectRows=await c.env.DB.prepare(`SELECT t.id,t.title,t.description,s.name section_name FROM tasks t JOIN work_sections s ON s.id=t.work_section_id JOIN work_areas w ON w.id=s.work_area_id WHERE w.project_id=? ORDER BY t.id`).bind(projectId).all();
   const links=await c.env.DB.prepare("SELECT entity_id,master_entity_id FROM project_master_node_links WHERE project_id=? AND entity_type='task'").bind(projectId).all();
   const linked=new Map((links.results as any[]).map(r=>[String(r.entity_id),String(r.master_entity_id)]));
   const masters=masterRows.results as any[];
   const byId=new Map(masters.map(r=>[String(r.id),r]));
   const byTitle=new Map<string,any[]>();
   for(const row of masters){const key=normalized(row.title);const list=byTitle.get(key)||[];list.push(row);byTitle.set(key,list)}
   let updated=0,linkedRecovered=0,skippedCustom=0,unmatched=0;
   for(const row of projectRows.results as any[]){
    if(!isGeneric(row.description)){skippedCustom++;continue}
    let source=byId.get(linked.get(String(row.id))||'');
    if(!source){const candidates=byTitle.get(normalized(row.title))||[];source=candidates.find(x=>normalized(x.section_name)===normalized(row.section_name))||(candidates.length===1?candidates[0]:undefined)}
    if(!source||!String(source.description||'').trim()){unmatched++;continue}
    await c.env.DB.prepare("UPDATE tasks SET description=?,updated_at=datetime('now') WHERE id=?").bind(String(source.description),row.id).run();updated++;
    if(!linked.has(String(row.id))){await c.env.DB.prepare("INSERT OR IGNORE INTO project_master_node_links(id,project_id,entity_type,entity_id,master_entity_id) VALUES(?,?,'task',?,?)").bind(crypto.randomUUID(),projectId,row.id,source.id).run();linkedRecovered++}
   }
   return c.json({ok:true,masterVersion:Number(master.version||0),updated,linkedRecovered,skippedCustom,unmatched});
  }catch(error){console.error('Task description refresh failed',error);return c.json({ok:false,error:error instanceof Error?error.message:String(error)},500)}
 })
}
