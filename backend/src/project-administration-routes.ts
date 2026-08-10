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

async function ensureDefaults(db: D1Database, projectId: string) {
  const count = await db.prepare('SELECT COUNT(*) AS count FROM project_administration_items WHERE project_id=?').bind(projectId).first<{count:number}>();
  if (Number(count?.count || 0) > 0) return;
  let sortOrder = 10;
  for (const title of DEFAULT_ITEMS) {
    await db.prepare('INSERT INTO project_administration_items(id,project_id,title,sort_order) VALUES(?,?,?,?)')
      .bind(crypto.randomUUID(), projectId, title, sortOrder).run();
    sortOrder += 10;
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
