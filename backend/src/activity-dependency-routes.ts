type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  post:(path:string,handler:(c:any)=>unknown)=>void;
  delete:(path:string,handler:(c:any)=>unknown)=>void;
};

type DependencyType='administrative'|'activity';

type DependencyRow={
  id:string;
  activity_id:string;
  dependency_type:DependencyType;
  required_admin_code:string|null;
  required_activity_id:string|null;
  hard:number;
  label:string;
  source:string;
};

const PRE_START_AREA='Etablering och byggstart';
const STARTBESKED_CODE='startbesked';
const STARTBESKED_LABEL='Startbesked finns';

function clean(value:unknown){return typeof value==='string'?value.trim():''}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_execution_contexts(
    activity_id TEXT PRIMARY KEY,
    context TEXT NOT NULL CHECK(context IN ('field','administrative')),
    source TEXT NOT NULL DEFAULT 'system',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_dependencies(
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    dependency_type TEXT NOT NULL CHECK(dependency_type IN ('administrative','activity')),
    required_admin_code TEXT,
    required_activity_id TEXT,
    hard INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY(required_activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    UNIQUE(activity_id,dependency_type,required_admin_code,required_activity_id)
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_dependencies_activity ON activity_dependencies(activity_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_dependencies_required_activity ON activity_dependencies(required_activity_id)').run();
}

async function projectIdForActivity(db:D1Database,activityId:string){
  const row=await db.prepare(`SELECT wa.project_id
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE a.id=?`).bind(activityId).first<{project_id:string}>();
  return row?.project_id??null;
}

async function seedStartbeskedLocks(db:D1Database,projectId:string){
  await ensureSchema(db);
  const rows=await db.prepare(`SELECT a.id
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    LEFT JOIN activity_execution_contexts ec ON ec.activity_id=a.id
    WHERE wa.project_id=?
      AND wa.name<>?
      AND COALESCE(ec.context,'field')='field'`).bind(projectId,PRE_START_AREA).all();
  for(const row of rows.results as any[]){
    const activityId=String(row.id);
    const id=`dep:${activityId}:admin:${STARTBESKED_CODE}`;
    await db.prepare(`INSERT OR IGNORE INTO activity_dependencies
      (id,activity_id,dependency_type,required_admin_code,hard,label,source)
      VALUES(?,?,'administrative',?,1,?,'system:startbesked')`)
      .bind(id,activityId,STARTBESKED_CODE,STARTBESKED_LABEL).run();
  }
}

async function administrativeCompleted(db:D1Database,projectId:string,code:string){
  try{
    const row=await db.prepare(`SELECT completed FROM project_administration_items
      WHERE project_id=? AND (code=? OR (?='startbesked' AND title='Startbesked finns'))
      ORDER BY completed DESC LIMIT 1`).bind(projectId,code,code).first<{completed:number}>();
    return Boolean(row?.completed);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(message.toLowerCase().includes('no such table')||message.toLowerCase().includes('no such column'))return false;
    throw error;
  }
}

async function dependencyState(db:D1Database,projectId:string,dependency:DependencyRow){
  if(dependency.dependency_type==='administrative'){
    const code=dependency.required_admin_code??'';
    const fulfilled=code?await administrativeCompleted(db,projectId,code):false;
    return {fulfilled,label:dependency.label||code||'Administrativ förutsättning'};
  }
  const requiredId=dependency.required_activity_id??'';
  if(!requiredId)return {fulfilled:false,label:dependency.label||'Tidigare aktivitet'};
  const row=await db.prepare(`SELECT COALESCE(e.done,0) AS done,a.title
    FROM activities a LEFT JOIN activity_entries e ON e.activity_id=a.id WHERE a.id=?`)
    .bind(requiredId).first<any>();
  return {fulfilled:Boolean(row?.done),label:dependency.label||String(row?.title||'Tidigare aktivitet')};
}

async function locksForProject(db:D1Database,projectId:string){
  await seedStartbeskedLocks(db,projectId);
  const rows=await db.prepare(`SELECT d.id,d.activity_id,d.dependency_type,d.required_admin_code,
      d.required_activity_id,d.hard,d.label,d.source
    FROM activity_dependencies d
    JOIN activities a ON a.id=d.activity_id
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=? ORDER BY a.sort_order,d.created_at`).bind(projectId).all();
  const byActivity=new Map<string,any>();
  for(const dependency of rows.results as any[] as DependencyRow[]){
    const state=await dependencyState(db,projectId,dependency);
    let item=byActivity.get(dependency.activity_id);
    if(!item){item={activityId:dependency.activity_id,locked:false,blockers:[]};byActivity.set(dependency.activity_id,item)}
    if(!state.fulfilled){
      const blocker={id:dependency.id,type:dependency.dependency_type,label:state.label,hard:Boolean(dependency.hard),source:dependency.source};
      item.blockers.push(blocker);
      if(dependency.hard)item.locked=true;
    }
  }
  return [...byActivity.values()];
}

async function hardBlockersForActivity(db:D1Database,activityId:string){
  const projectId=await projectIdForActivity(db,activityId);
  if(!projectId)return {projectId:null,blockers:[] as any[]};
  const locks=await locksForProject(db,projectId);
  const lock=locks.find(item=>item.activityId===activityId);
  return {projectId,blockers:(lock?.blockers??[]).filter((item:any)=>item.hard)};
}

export async function activityDependencyGuard(c:any,next:()=>Promise<void>){
  if(c.req.method!=='PUT')return next();
  const path=new URL(c.req.url).pathname;
  const match=path.match(/^\/api\/activities\/([^/]+)$/);
  if(!match)return next();
  const activityId=decodeURIComponent(match[1]);
  const entry=await c.env.DB.prepare('SELECT done FROM activity_entries WHERE activity_id=?').bind(activityId).first<{done:number}>();
  if(entry?.done)return next();
  const {blockers}=await hardBlockersForActivity(c.env.DB,activityId);
  if(blockers.length){
    return c.json({ok:false,error:`Aktiviteten är låst: ${blockers.map(item=>item.label).join(', ')} saknas.`,locked:true,blockers},409);
  }
  return next();
}

export function registerActivityDependencyRoutes(app:RouteApp){
  app.get('/api/activity-locks',async c=>{
    const projectId=clean(c.req.query('projectId'));
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    return c.json({ok:true,items:await locksForProject(c.env.DB,projectId)});
  });

  app.get('/api/studio/activity-dependencies',async c=>{
    const projectId=clean(c.req.query('projectId'));
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    await seedStartbeskedLocks(c.env.DB,projectId);
    const result=await c.env.DB.prepare(`SELECT d.id,d.activity_id,d.dependency_type,d.required_admin_code,
        d.required_activity_id,d.hard,d.label,d.source
      FROM activity_dependencies d
      JOIN activities a ON a.id=d.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();
    return c.json({ok:true,items:result.results});
  });

  app.post('/api/studio/activity-dependencies',async c=>{
    await ensureSchema(c.env.DB);
    const body=await c.req.json<any>().catch(()=>({}));
    const activityId=clean(body.activityId),dependencyType=clean(body.dependencyType) as DependencyType;
    if(!activityId)return c.json({ok:false,error:'Aktivitet krävs.'},400);
    if(dependencyType!=='administrative'&&dependencyType!=='activity')return c.json({ok:false,error:'Ogiltig beroendetyp.'},400);
    const requiredAdminCode=dependencyType==='administrative'?clean(body.requiredAdminCode):'';
    const requiredActivityId=dependencyType==='activity'?clean(body.requiredActivityId):'';
    if(dependencyType==='administrative'&&!requiredAdminCode)return c.json({ok:false,error:'Administrativ kod krävs.'},400);
    if(dependencyType==='activity'&&!requiredActivityId)return c.json({ok:false,error:'Föregående aktivitet krävs.'},400);
    const id=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO activity_dependencies
      (id,activity_id,dependency_type,required_admin_code,required_activity_id,hard,label,source)
      VALUES(?,?,?,?,?,?,?,'manual')`)
      .bind(id,activityId,dependencyType,requiredAdminCode||null,requiredActivityId||null,body.hard===false?0:1,clean(body.label)).run();
    return c.json({ok:true,id},201);
  });

  app.delete('/api/studio/activity-dependencies/:id',async c=>{
    await ensureSchema(c.env.DB);
    const result=await c.env.DB.prepare('DELETE FROM activity_dependencies WHERE id=?').bind(c.req.param('id')).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Beroendet hittades inte.'},404);
    return c.json({ok:true});
  });
}
