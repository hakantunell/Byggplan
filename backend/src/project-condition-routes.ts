type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_conditions(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_contexts(
    activity_id TEXT PRIMARY KEY,
    lifecycle_stage TEXT NOT NULL DEFAULT 'build',
    surface TEXT NOT NULL DEFAULT 'field',
    applicability TEXT NOT NULL DEFAULT 'always',
    condition_text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
}

export function registerProjectConditionRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/project-conditions',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=c.req.param('projectId');
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);

    const conditions:any[]=[];
    const tables=await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('governing_documents','governing_items')").all();
    if((tables.results as any[]).length>=2){
      const result=await c.env.DB.prepare(`
        SELECT i.id,i.code,i.description,i.section_code,i.section_title,i.item_type,
               i.handling_status,i.handling_comment,
               d.id governing_document_id,d.title governing_document_title,d.document_type,d.issuer,d.reference,d.imported_at
        FROM governing_items i
        JOIN governing_documents d ON d.id=i.governing_document_id
        WHERE d.project_id=?
          AND i.handling_status='handled'
          AND COALESCE(i.handling_comment,'') LIKE 'Hanteras som ett bestående projektvillkor%'
        ORDER BY d.imported_at,i.sort_order,i.id
      `).bind(projectId).all();
      for(const row of result.results as any[])conditions.push({...row,condition_kind:'governing',title:row.description,source_type:'governing'});
    }

    const manual=await c.env.DB.prepare(`SELECT id,title,description,source_type,source_id,created_at,updated_at FROM project_conditions WHERE project_id=? ORDER BY created_at,id`).bind(projectId).all();
    for(const row of manual.results as any[])conditions.push({
      ...row,code:'',section_code:'',section_title:row.source_type==='activity'?'Projektspecifik instruktion':'Projektvillkor',
      governing_document_id:'',governing_document_title:row.source_type==='activity'?'Från projektaktivitet':'Projektspecifikt',
      document_type:'project',issuer:'',reference:'',condition_kind:'project_specific'
    });

    return c.json({ok:true,conditions});
  });

  app.post('/api/studio/projects/:projectId/project-conditions',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=c.req.param('projectId');
    const body=await c.req.json<{title?:string;description?:string}>().catch(()=>({}));
    const title=String(body.title||'').trim();if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const id=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO project_conditions(id,project_id,title,description,source_type) VALUES(?,?,?,?, 'manual')`).bind(id,projectId,title,String(body.description||'').trim()).run();
    return c.json({ok:true,id},201);
  });

  app.post('/api/studio/projects/:projectId/project-conditions/from-activity/:activityId',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=c.req.param('projectId'),activityId=c.req.param('activityId');
    const activity=await c.env.DB.prepare(`SELECT a.id,a.title,a.description FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE a.id=? AND wa.project_id=?`).bind(activityId,projectId).first<any>();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte i projektet.'},404);
    const existing=await c.env.DB.prepare(`SELECT id FROM project_conditions WHERE project_id=? AND source_type='activity' AND source_id=? LIMIT 1`).bind(projectId,activityId).first<any>();
    let id=existing?.id?String(existing.id):crypto.randomUUID();
    if(!existing){
      await c.env.DB.prepare(`INSERT INTO project_conditions(id,project_id,title,description,source_type,source_id) VALUES(?,?,?,?, 'activity',?)`).bind(id,projectId,String(activity.title),String(activity.description||''),activityId).run();
    }
    await c.env.DB.prepare(`INSERT INTO activity_contexts(activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','studio','deprecated','Flyttad till projektvillkor.',datetime('now')) ON CONFLICT(activity_id) DO UPDATE SET applicability='deprecated',surface='studio',condition_text='Flyttad till projektvillkor.',updated_at=datetime('now')`).bind(activityId).run();
    return c.json({ok:true,id,title:String(activity.title)});
  });
}
