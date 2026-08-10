type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

const ADMIN_TITLES=new Set([
  'Kontrollera att startbesked finns',
  'Registrera BAS-P',
  'Registrera BAS-U',
  'Genomför startmöte med byggherre och KA',
  'Sätt upp arbetsmiljöplan där det krävs',
  'Kontrollera att elinstallationsföretaget är registrerat',
  'Registrera behörighet eller redovisa vald våtrumsmetod'
]);

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_execution_contexts(
    activity_id TEXT PRIMARY KEY,
    context TEXT NOT NULL CHECK(context IN ('field','administrative')),
    source TEXT NOT NULL DEFAULT 'system',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_execution_context_context ON activity_execution_contexts(context)').run();
}

async function classifyProject(db:D1Database,projectId:string){
  const rows=await db.prepare(`SELECT a.id,a.title,wa.name AS work_area
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?`).bind(projectId).all();
  for(const row of rows.results as any[]){
    const administrative=ADMIN_TITLES.has(String(row.title)) || String(row.work_area)==='Slutkontroll och slutbesked';
    const existing=await db.prepare('SELECT source FROM activity_execution_contexts WHERE activity_id=?').bind(row.id).first<any>();
    if(existing?.source==='manual')continue;
    await db.prepare(`INSERT INTO activity_execution_contexts(activity_id,context,source,updated_at)
      VALUES(?,?, 'system', datetime('now'))
      ON CONFLICT(activity_id) DO UPDATE SET context=excluded.context,source='system',updated_at=datetime('now')`)
      .bind(row.id,administrative?'administrative':'field').run();
  }
}

export function registerProjectExecutionContextRoutes(app:RouteApp){
  app.get('/api/project-execution-contexts',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=c.req.query('projectId');
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    await classifyProject(c.env.DB,projectId);
    const rows=await c.env.DB.prepare(`SELECT ec.activity_id,ec.context,ec.source,a.title,a.description,a.activity_type,
      t.title AS task_title,ws.name AS section_name,wa.name AS work_area
      FROM activity_execution_contexts ec
      JOIN activities a ON a.id=ec.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();
    return c.json({ok:true,items:rows.results});
  });

  app.put('/api/studio/activities/:id/execution-context',async c=>{
    await ensureSchema(c.env.DB);
    const body=await c.req.json<{context?:string}>().catch(()=>({}));
    if(body.context!=='field'&&body.context!=='administrative')return c.json({ok:false,error:'Context måste vara field eller administrative.'},400);
    const activity=await c.env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(c.req.param('id')).first();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    await c.env.DB.prepare(`INSERT INTO activity_execution_contexts(activity_id,context,source,updated_at)
      VALUES(?,?,'manual',datetime('now'))
      ON CONFLICT(activity_id) DO UPDATE SET context=excluded.context,source='manual',updated_at=datetime('now')`)
      .bind(c.req.param('id'),body.context).run();
    return c.json({ok:true});
  });
}
