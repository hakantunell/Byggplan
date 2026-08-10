type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
  delete: (path: string, handler: (c: any) => unknown) => void;
};

type Body = { title?: string; completed?: boolean; valueText?: string; note?: string };

const DEFAULT_ITEMS = [
  'Startbesked finns',
  'Arbetsmiljöplan är upprättad',
  'BAS-P är utsedd',
  'BAS-U är utsedd'
];

const ADMIN_TITLE_MAP:Record<string,string> = {
  'Kontrollera att startbesked finns':'Startbesked finns',
  'Registrera BAS-P':'BAS-P är utsedd',
  'Registrera BAS-U':'BAS-U är utsedd',
  'Sätt upp arbetsmiljöplan där det krävs':'Arbetsmiljöplan är upprättad'
};

const ADMIN_TITLES = new Set([
  'Kontrollera att startbesked finns',
  'Registrera BAS-P',
  'Registrera BAS-U',
  'Genomför startmöte med byggherre och KA',
  'Sätt upp arbetsmiljöplan där det krävs',
  'Kontrollera att elinstallationsföretaget är registrerat',
  'Registrera behörighet eller redovisa vald våtrumsmetod'
]);

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_administration_items(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    value_text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_administration_project ON project_administration_items(project_id,sort_order,id)').run();
}

async function insertMissing(db:D1Database,projectId:string,title:string,sortOrder:number){
  const existing=await db.prepare('SELECT id FROM project_administration_items WHERE project_id=? AND title=?').bind(projectId,title).first();
  if(existing)return false;
  await db.prepare('INSERT INTO project_administration_items(id,project_id,title,sort_order) VALUES(?,?,?,?)')
    .bind(crypto.randomUUID(),projectId,title,sortOrder).run();
  return true;
}

async function ensureDefaults(db: D1Database, projectId: string) {
  let orderRow=await db.prepare('SELECT COALESCE(MAX(sort_order),0) AS max_order FROM project_administration_items WHERE project_id=?').bind(projectId).first<{max_order:number}>();
  let sortOrder=Number(orderRow?.max_order||0);
  for(const title of DEFAULT_ITEMS){
    sortOrder+=10;
    await insertMissing(db,projectId,title,sortOrder);
  }
}

async function syncAdministrativeActivities(db:D1Database,projectId:string){
  const rows=await db.prepare(`SELECT a.title,wa.name AS work_area
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
    ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();
  const orderRow=await db.prepare('SELECT COALESCE(MAX(sort_order),0) AS max_order FROM project_administration_items WHERE project_id=?').bind(projectId).first<{max_order:number}>();
  let sortOrder=Number(orderRow?.max_order||0);
  for(const row of rows.results as any[]){
    const sourceTitle=String(row.title||'');
    const administrative=ADMIN_TITLES.has(sourceTitle)||String(row.work_area)==='Slutkontroll och slutbesked';
    if(!administrative)continue;
    const title=ADMIN_TITLE_MAP[sourceTitle]||sourceTitle;
    sortOrder+=10;
    await insertMissing(db,projectId,title,sortOrder);
  }
}

export function registerProjectAdministrationRoutes(app: RouteApp) {
  app.get('/api/studio/project-administration', async c => {
    const projectId = text(c.req.query('projectId'));
    if (!projectId) return c.json({ok:false,error:'Projekt krävs.'},400);
    await ensureSchema(c.env.DB);
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if (!project) return c.json({ok:false,error:'Projektet hittades inte.'},404);
    await ensureDefaults(c.env.DB,projectId);
    await syncAdministrativeActivities(c.env.DB,projectId);
    const result = await c.env.DB.prepare('SELECT id,title,completed,value_text,note,sort_order FROM project_administration_items WHERE project_id=? ORDER BY sort_order,id').bind(projectId).all();
    return c.json({ok:true,items:result.results});
  });

  app.post('/api/studio/project-administration', async c => {
    await ensureSchema(c.env.DB);
    const body = await c.req.json<Body & {projectId?:string}>().catch(()=>({}));
    const projectId=text(body.projectId), title=text(body.title);
    if(!projectId)return c.json({ok:false,error:'Projekt krävs.'},400);
    if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_administration_items WHERE project_id=?').bind(projectId).first<{next_order:number}>();
    const id=crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO project_administration_items(id,project_id,title,completed,value_text,note,sort_order) VALUES(?,?,?,?,?,?,?)')
      .bind(id,projectId,title,body.completed?1:0,text(body.valueText),text(body.note),Number(order?.next_order??10)).run();
    return c.json({ok:true,id},201);
  });

  app.put('/api/studio/project-administration/:id', async c => {
    await ensureSchema(c.env.DB);
    const body=await c.req.json<Body>().catch(()=>({}));
    const title=text(body.title);
    if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const result=await c.env.DB.prepare("UPDATE project_administration_items SET title=?,completed=?,value_text=?,note=?,updated_at=datetime('now') WHERE id=?")
      .bind(title,body.completed?1:0,text(body.valueText),text(body.note),c.req.param('id')).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Den administrativa punkten hittades inte.'},404);
    return c.json({ok:true});
  });

  app.delete('/api/studio/project-administration/:id', async c => {
    await ensureSchema(c.env.DB);
    const result=await c.env.DB.prepare('DELETE FROM project_administration_items WHERE id=?').bind(c.req.param('id')).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Den administrativa punkten hittades inte.'},404);
    return c.json({ok:true});
  });
}
