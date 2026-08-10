type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
  delete: (path: string, handler: (c: any) => unknown) => void;
};

type Body = { title?: string; contentText?: string; resourceType?: string };

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_task_resources(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'text',
    title TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_activity_resources(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'text',
    title TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_task_resources_task ON project_task_resources(task_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_activity_resources_activity ON project_activity_resources(activity_id,sort_order)').run();
}

export function registerProjectSupportRoutes(app: RouteApp) {
  app.get('/api/project-support', async c => {
    await ensureSchema(c.env.DB);
    const projectId = c.req.query('projectId');
    if (!projectId) return c.json({ ok:false, error:'projectId krävs.' }, 400);
    const [taskRows, activityRows] = await Promise.all([
      c.env.DB.prepare(`SELECT id,task_id,resource_type,title,content_text,sort_order FROM project_task_resources WHERE project_id=? ORDER BY task_id,sort_order,id`).bind(projectId).all(),
      c.env.DB.prepare(`SELECT id,activity_id,resource_type,title,content_text,sort_order FROM project_activity_resources WHERE project_id=? ORDER BY activity_id,sort_order,id`).bind(projectId).all()
    ]);
    return c.json({ ok:true, taskResources:taskRows.results, activityResources:activityRows.results });
  });

  app.get('/api/studio/project-support/:ownerType/:ownerId', async c => {
    await ensureSchema(c.env.DB);
    const ownerType = c.req.param('ownerType');
    const ownerId = c.req.param('ownerId');
    if (ownerType === 'task') {
      const rows = await c.env.DB.prepare('SELECT id,resource_type,title,content_text,sort_order FROM project_task_resources WHERE task_id=? ORDER BY sort_order,id').bind(ownerId).all();
      return c.json({ ok:true, resources:rows.results });
    }
    if (ownerType === 'activity') {
      const rows = await c.env.DB.prepare('SELECT id,resource_type,title,content_text,sort_order FROM project_activity_resources WHERE activity_id=? ORDER BY sort_order,id').bind(ownerId).all();
      return c.json({ ok:true, resources:rows.results });
    }
    return c.json({ ok:false, error:'Ogiltig underlagstyp.' },400);
  });

  app.post('/api/studio/project-support/:ownerType/:ownerId', async c => {
    await ensureSchema(c.env.DB);
    const ownerType = c.req.param('ownerType');
    const ownerId = c.req.param('ownerId');
    const body = await c.req.json<Body>().catch(() => ({}));
    const title = text(body.title);
    const contentText = text(body.contentText);
    const resourceType = text(body.resourceType) || 'text';
    if (!title) return c.json({ ok:false,error:'Rubrik krävs.' },400);
    const id = crypto.randomUUID();
    if (ownerType === 'task') {
      const owner = await c.env.DB.prepare(`SELECT t.id,wa.project_id FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE t.id=?`).bind(ownerId).first<any>();
      if (!owner) return c.json({ok:false,error:'Momentet hittades inte.'},404);
      const order = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_task_resources WHERE task_id=?').bind(ownerId).first<any>();
      await c.env.DB.prepare('INSERT INTO project_task_resources(id,project_id,task_id,resource_type,title,content_text,sort_order) VALUES(?,?,?,?,?,?,?)').bind(id,owner.project_id,ownerId,resourceType,title,contentText,Number(order?.next_order ?? 10)).run();
    } else if (ownerType === 'activity') {
      const owner = await c.env.DB.prepare(`SELECT a.id,wa.project_id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE a.id=?`).bind(ownerId).first<any>();
      if (!owner) return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
      const order = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_activity_resources WHERE activity_id=?').bind(ownerId).first<any>();
      await c.env.DB.prepare('INSERT INTO project_activity_resources(id,project_id,activity_id,resource_type,title,content_text,sort_order) VALUES(?,?,?,?,?,?,?)').bind(id,owner.project_id,ownerId,resourceType,title,contentText,Number(order?.next_order ?? 10)).run();
    } else return c.json({ok:false,error:'Ogiltig underlagstyp.'},400);
    return c.json({ok:true,id},201);
  });

  app.put('/api/studio/project-support/:id', async c => {
    await ensureSchema(c.env.DB);
    const body = await c.req.json<Body>().catch(() => ({}));
    const title = text(body.title); const contentText = text(body.contentText); const resourceType = text(body.resourceType) || 'text';
    if (!title) return c.json({ok:false,error:'Rubrik krävs.'},400);
    const id = c.req.param('id');
    let result = await c.env.DB.prepare("UPDATE project_task_resources SET title=?,content_text=?,resource_type=?,updated_at=datetime('now') WHERE id=?").bind(title,contentText,resourceType,id).run();
    if (!result.meta.changes) result = await c.env.DB.prepare("UPDATE project_activity_resources SET title=?,content_text=?,resource_type=?,updated_at=datetime('now') WHERE id=?").bind(title,contentText,resourceType,id).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Underlaget hittades inte.'},404);
    return c.json({ok:true});
  });

  app.delete('/api/studio/project-support/:id', async c => {
    await ensureSchema(c.env.DB);
    const id = c.req.param('id');
    let result = await c.env.DB.prepare('DELETE FROM project_task_resources WHERE id=?').bind(id).run();
    if (!result.meta.changes) result = await c.env.DB.prepare('DELETE FROM project_activity_resources WHERE id=?').bind(id).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Underlaget hittades inte.'},404);
    return c.json({ok:true});
  });
}
