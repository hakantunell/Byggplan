type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

const ADMIN_TITLES=[
  'Kontrollera att startbesked finns',
  'Registrera BAS-P',
  'Registrera BAS-U',
  'Genomför startmöte med byggherre och KA',
  'Sätt upp arbetsmiljöplan där det krävs',
  'Kontrollera att elinstallationsföretaget är registrerat',
  'Registrera behörighet eller redovisa vald våtrumsmetod'
];

async function safeAlter(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const message=String(error);if(!message.includes('duplicate column name'))throw error}}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_execution_contexts(
    activity_id TEXT PRIMARY KEY,
    context TEXT NOT NULL CHECK(context IN ('field','administrative')),
    source TEXT NOT NULL DEFAULT 'system',
    executor_type TEXT NOT NULL DEFAULT 'self',
    executor_label TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await safeAlter(db,`ALTER TABLE activity_execution_contexts ADD COLUMN executor_type TEXT NOT NULL DEFAULT 'self'`);
  await safeAlter(db,`ALTER TABLE activity_execution_contexts ADD COLUMN executor_label TEXT`);
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_execution_context_context ON activity_execution_contexts(context)').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_classifications(
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('documentation','control_plan','requirement')),
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'project',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(activity_id,category,code),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_classifications_activity ON activity_classifications(activity_id)').run();
}

async function classifyProject(db:D1Database,projectId:string){
  const titlePlaceholders=ADMIN_TITLES.map(()=>'?').join(',');
  const params=[...ADMIN_TITLES,projectId];
  await db.prepare(`INSERT INTO activity_execution_contexts(activity_id,context,source,executor_type,updated_at)
    SELECT a.id,
      CASE WHEN a.title IN (${titlePlaceholders}) OR wa.name='Slutkontroll och slutbesked' THEN 'administrative' ELSE 'field' END,
      'system','self',datetime('now')
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
    ON CONFLICT(activity_id) DO UPDATE SET
      context=excluded.context,
      source='system',
      updated_at=datetime('now')
    WHERE activity_execution_contexts.source<>'manual'`).bind(...params).run();

  await db.prepare(`UPDATE activities SET required=0 WHERE id IN (
    SELECT ec.activity_id
    FROM activity_execution_contexts ec
    JOIN activities a ON a.id=ec.activity_id
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=? AND ec.context='administrative'
  )`).bind(projectId).run();
}

async function addGoverningMetadata(db:D1Database,projectId:string,items:any[]){
  const classifications=await db.prepare(`SELECT ac.activity_id,ac.category,ac.code,ac.label,ac.source
    FROM activity_classifications ac
    JOIN activities a ON a.id=ac.activity_id
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=? AND ac.category IN ('control_plan','requirement')
    ORDER BY ac.activity_id,ac.category,ac.label`).bind(projectId).all();
  const byActivity=new Map<string,any[]>();
  for(const row of classifications.results as any[]){
    const list=byActivity.get(String(row.activity_id))||[];
    list.push({category:row.category,code:row.code,label:row.label,source:row.source});
    byActivity.set(String(row.activity_id),list);
  }
  return items.map(item=>({...item,governing_documents:byActivity.get(String(item.activity_id))||[]}));
}

export function registerProjectExecutionContextRoutes(app:RouteApp){
  app.get('/api/project-execution-contexts',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=c.req.query('projectId');
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    await classifyProject(c.env.DB,projectId);
    const rows=await c.env.DB.prepare(`SELECT ec.activity_id,ec.context,ec.source,ec.executor_type,ec.executor_label,a.title,a.description,a.activity_type,
      t.title AS task_title,ws.name AS section_name,wa.name AS work_area
      FROM activity_execution_contexts ec
      JOIN activities a ON a.id=ec.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();
    const items=await addGoverningMetadata(c.env.DB,projectId,rows.results as any[]);
    return c.json({ok:true,items});
  });

  app.get('/api/studio/activities/:id/execution-context',async c=>{
    await ensureSchema(c.env.DB);
    const id=c.req.param('id');
    const activity=await c.env.DB.prepare(`SELECT a.id,wa.project_id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE a.id=?`).bind(id).first<any>();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    await classifyProject(c.env.DB,String(activity.project_id));
    const item=await c.env.DB.prepare('SELECT activity_id,context,source,executor_type,executor_label FROM activity_execution_contexts WHERE activity_id=?').bind(id).first<any>();
    const enriched=(await addGoverningMetadata(c.env.DB,String(activity.project_id),[item||{activity_id:id,context:'field',source:'system',executor_type:'self',executor_label:null}]))[0];
    return c.json({ok:true,item:enriched});
  });

  app.put('/api/studio/activities/:id/execution-context',async c=>{
    await ensureSchema(c.env.DB);
    const body=await c.req.json<{context?:string;executorType?:string;executorLabel?:string|null}>().catch(()=>({}));
    if(body.context!==undefined&&body.context!=='field'&&body.context!=='administrative')return c.json({ok:false,error:'Context måste vara field eller administrative.'},400);
    if(body.executorType!==undefined&&body.executorType!=='self'&&body.executorType!=='third_party')return c.json({ok:false,error:'Utförare måste vara self eller third_party.'},400);
    const activity=await c.env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(c.req.param('id')).first();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const existing=await c.env.DB.prepare('SELECT context,executor_type,executor_label FROM activity_execution_contexts WHERE activity_id=?').bind(c.req.param('id')).first<any>();
    const context=body.context??existing?.context??'field';
    const executorType=body.executorType??existing?.executor_type??'self';
    const executorLabel=executorType==='third_party'?(body.executorLabel??existing?.executor_label??null):null;
    await c.env.DB.prepare(`INSERT INTO activity_execution_contexts(activity_id,context,source,executor_type,executor_label,updated_at)
      VALUES(?,?,'manual',?,?,datetime('now'))
      ON CONFLICT(activity_id) DO UPDATE SET context=excluded.context,source='manual',executor_type=excluded.executor_type,executor_label=excluded.executor_label,updated_at=datetime('now')`)
      .bind(c.req.param('id'),context,executorType,executorLabel).run();
    if(context==='administrative')await c.env.DB.prepare('UPDATE activities SET required=0 WHERE id=?').bind(c.req.param('id')).run();
    return c.json({ok:true});
  });
}
