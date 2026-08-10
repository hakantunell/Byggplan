type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
  delete: (path: string, handler: (c: any) => unknown) => void;
};

type ResourceBody = {
  title?: string;
  content?: string;
  resourceType?: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function ensureSupportSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_task_resources(
    id TEXT PRIMARY KEY,
    master_task_id TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'text',
    title TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(master_task_id) REFERENCES master_tasks(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_resources(
    id TEXT PRIMARY KEY,
    master_activity_id TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'text',
    title TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_master_task_resources_task ON master_task_resources(master_task_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_master_activity_resources_activity ON master_activity_resources(master_activity_id,sort_order)').run();
}

async function nextOrder(db: D1Database, table: string, parentColumn: string, parentId: string) {
  const row = await db.prepare(`SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM ${table} WHERE ${parentColumn}=?`).bind(parentId).first<{next_order:number}>();
  return Number(row?.next_order ?? 10);
}

export function registerMasterSupportRoutes(app: RouteApp) {
  app.get('/api/studio/master-tasks/:id/work-resources', async c => {
    await ensureSupportSchema(c.env.DB);
    const id = c.req.param('id');
    const parent = await c.env.DB.prepare('SELECT id FROM master_tasks WHERE id=?').bind(id).first();
    if (!parent) return c.json({ok:false,error:'Momentet hittades inte.'},404);
    const rows = await c.env.DB.prepare('SELECT id,master_task_id,resource_type,title,content_text,sort_order,created_at,updated_at FROM master_task_resources WHERE master_task_id=? ORDER BY sort_order,id').bind(id).all();
    return c.json({ok:true,resources:rows.results});
  });

  app.post('/api/studio/master-tasks/:id/work-resources', async c => {
    await ensureSupportSchema(c.env.DB);
    const id = c.req.param('id');
    const parent = await c.env.DB.prepare('SELECT id FROM master_tasks WHERE id=?').bind(id).first();
    if (!parent) return c.json({ok:false,error:'Momentet hittades inte.'},404);
    const body = await c.req.json<ResourceBody>().catch(() => ({}));
    const title = text(body.title) || 'Beskrivning';
    const content = typeof body.content === 'string' ? body.content : '';
    const resourceType = text(body.resourceType) || 'text';
    const resourceId = crypto.randomUUID();
    const sortOrder = await nextOrder(c.env.DB,'master_task_resources','master_task_id',id);
    await c.env.DB.prepare('INSERT INTO master_task_resources(id,master_task_id,resource_type,title,content_text,sort_order) VALUES(?,?,?,?,?,?)').bind(resourceId,id,resourceType,title,content,sortOrder).run();
    return c.json({ok:true,id:resourceId},201);
  });

  app.put('/api/studio/master-task-resources/:id', async c => {
    await ensureSupportSchema(c.env.DB);
    const body = await c.req.json<ResourceBody>().catch(() => ({}));
    const title = text(body.title);
    if (!title) return c.json({ok:false,error:'Rubrik krävs.'},400);
    const content = typeof body.content === 'string' ? body.content : '';
    const result = await c.env.DB.prepare("UPDATE master_task_resources SET title=?,content_text=?,updated_at=datetime('now') WHERE id=?").bind(title,content,c.req.param('id')).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Arbetsunderlaget hittades inte.'},404);
    return c.json({ok:true});
  });

  app.delete('/api/studio/master-task-resources/:id', async c => {
    await ensureSupportSchema(c.env.DB);
    const result = await c.env.DB.prepare('DELETE FROM master_task_resources WHERE id=?').bind(c.req.param('id')).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Arbetsunderlaget hittades inte.'},404);
    return c.json({ok:true});
  });

  app.get('/api/studio/master-activities/:id/detail-resources', async c => {
    await ensureSupportSchema(c.env.DB);
    const id = c.req.param('id');
    const parent = await c.env.DB.prepare('SELECT id FROM master_activities WHERE id=?').bind(id).first();
    if (!parent) return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const rows = await c.env.DB.prepare('SELECT id,master_activity_id,resource_type,title,content_text,sort_order,created_at,updated_at FROM master_activity_resources WHERE master_activity_id=? ORDER BY sort_order,id').bind(id).all();
    return c.json({ok:true,resources:rows.results});
  });

  app.post('/api/studio/master-activities/:id/detail-resources', async c => {
    await ensureSupportSchema(c.env.DB);
    const id = c.req.param('id');
    const parent = await c.env.DB.prepare('SELECT id FROM master_activities WHERE id=?').bind(id).first();
    if (!parent) return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const body = await c.req.json<ResourceBody>().catch(() => ({}));
    const title = text(body.title) || 'Beskrivning';
    const content = typeof body.content === 'string' ? body.content : '';
    const resourceType = text(body.resourceType) || 'text';
    const resourceId = crypto.randomUUID();
    const sortOrder = await nextOrder(c.env.DB,'master_activity_resources','master_activity_id',id);
    await c.env.DB.prepare('INSERT INTO master_activity_resources(id,master_activity_id,resource_type,title,content_text,sort_order) VALUES(?,?,?,?,?,?)').bind(resourceId,id,resourceType,title,content,sortOrder).run();
    return c.json({ok:true,id:resourceId},201);
  });

  app.put('/api/studio/master-activity-resources/:id', async c => {
    await ensureSupportSchema(c.env.DB);
    const body = await c.req.json<ResourceBody>().catch(() => ({}));
    const title = text(body.title);
    if (!title) return c.json({ok:false,error:'Rubrik krävs.'},400);
    const content = typeof body.content === 'string' ? body.content : '';
    const result = await c.env.DB.prepare("UPDATE master_activity_resources SET title=?,content_text=?,updated_at=datetime('now') WHERE id=?").bind(title,content,c.req.param('id')).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Detaljunderlaget hittades inte.'},404);
    return c.json({ok:true});
  });

  app.delete('/api/studio/master-activity-resources/:id', async c => {
    await ensureSupportSchema(c.env.DB);
    const result = await c.env.DB.prepare('DELETE FROM master_activity_resources WHERE id=?').bind(c.req.param('id')).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Detaljunderlaget hittades inte.'},404);
    return c.json({ok:true});
  });
}
