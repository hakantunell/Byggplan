type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
  delete: (path: string, handler: (c: any) => unknown) => void;
};

type Body = { title?: string; contentText?: string; resourceType?: string };

type AttachmentRow = {
  id: string;
  resource_id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  sort_order: number;
};

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

function sanitizeFileName(name: string) {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return safe.slice(0, 120) || 'bilaga';
}

function isUploadedFile(value: unknown): value is File {
  return Boolean(value && typeof value === 'object' &&
    typeof (value as any).arrayBuffer === 'function' &&
    typeof (value as any).stream === 'function' &&
    typeof (value as any).size === 'number' &&
    typeof (value as any).type === 'string');
}

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
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_support_attachments(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_task_resources_task ON project_task_resources(task_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_activity_resources_activity ON project_activity_resources(activity_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_support_attachments_resource ON project_support_attachments(resource_id,sort_order)').run();
}

async function attachmentsByResource(db: D1Database, resourceIds: string[]) {
  const map = new Map<string, AttachmentRow[]>();
  if (!resourceIds.length) return map;
  const placeholders = resourceIds.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT id,resource_id,original_name,content_type,size_bytes,sort_order FROM project_support_attachments WHERE resource_id IN (${placeholders}) ORDER BY resource_id,sort_order,id`).bind(...resourceIds).all();
  for (const row of rows.results as AttachmentRow[]) {
    const list = map.get(row.resource_id) ?? [];
    list.push(row);
    map.set(row.resource_id, list);
  }
  return map;
}

function decorateResources(rows: any[], attachments: Map<string, AttachmentRow[]>) {
  return rows.map(row => ({
    ...row,
    attachments: (attachments.get(row.id) ?? []).map(file => ({
      id: file.id,
      originalName: file.original_name,
      contentType: file.content_type,
      sizeBytes: Number(file.size_bytes || 0),
      url: `/api/project-support-attachments/${encodeURIComponent(file.id)}`
    }))
  }));
}

async function findResource(db: D1Database, id: string) {
  const task = await db.prepare('SELECT id,project_id FROM project_task_resources WHERE id=?').bind(id).first<any>();
  if (task) return { ...task, ownerType: 'task' as const };
  const activity = await db.prepare('SELECT id,project_id FROM project_activity_resources WHERE id=?').bind(id).first<any>();
  return activity ? { ...activity, ownerType: 'activity' as const } : null;
}

export function registerProjectSupportRoutes(app: RouteApp) {
  app.get('/api/project-support', async c => {
    const projectId = c.req.query('projectId');
    if (!projectId) return c.json({ ok:false, error:'projectId krävs.' }, 400);
    const [taskRows, activityRows] = await Promise.all([
      c.env.DB.prepare(`SELECT id,task_id,resource_type,title,content_text,sort_order FROM project_task_resources WHERE project_id=? ORDER BY task_id,sort_order,id`).bind(projectId).all(),
      c.env.DB.prepare(`SELECT id,activity_id,resource_type,title,content_text,sort_order FROM project_activity_resources WHERE project_id=? ORDER BY activity_id,sort_order,id`).bind(projectId).all()
    ]);
    const allRows = [...taskRows.results as any[], ...activityRows.results as any[]];
    const attachments = await attachmentsByResource(c.env.DB, allRows.map(row => String(row.id)));
    return c.json({
      ok:true,
      taskResources:decorateResources(taskRows.results as any[],attachments),
      activityResources:decorateResources(activityRows.results as any[],attachments)
    });
  });

  app.get('/api/studio/project-support/:ownerType/:ownerId', async c => {
    const ownerType = c.req.param('ownerType');
    const ownerId = c.req.param('ownerId');
    let rows:any;
    if (ownerType === 'task') rows = await c.env.DB.prepare('SELECT id,resource_type,title,content_text,sort_order FROM project_task_resources WHERE task_id=? ORDER BY sort_order,id').bind(ownerId).all();
    else if (ownerType === 'activity') rows = await c.env.DB.prepare('SELECT id,resource_type,title,content_text,sort_order FROM project_activity_resources WHERE activity_id=? ORDER BY sort_order,id').bind(ownerId).all();
    else return c.json({ ok:false, error:'Ogiltig underlagstyp.' },400);
    const resultRows = rows.results as any[];
    const attachments = await attachmentsByResource(c.env.DB,resultRows.map(row => String(row.id)));
    return c.json({ ok:true, resources:decorateResources(resultRows,attachments) });
  });

  app.post('/api/studio/project-support/:ownerType/:ownerId', async c => {
    await ensureSchema(c.env.DB);
    const ownerType = c.req.param('ownerType');
    const ownerId = c.req.param('ownerId');
    const body = await c.req.json<Body>().catch(() => ({}));
    const title = text(body.title);
    const contentText = typeof body.contentText === 'string' ? body.contentText.trim() : '';
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
    const title = text(body.title); const contentText = typeof body.contentText === 'string' ? body.contentText.trim() : ''; const resourceType = text(body.resourceType) || 'text';
    if (!title) return c.json({ok:false,error:'Rubrik krävs.'},400);
    const id = c.req.param('id');
    let result = await c.env.DB.prepare("UPDATE project_task_resources SET title=?,content_text=?,resource_type=?,updated_at=datetime('now') WHERE id=?").bind(title,contentText,resourceType,id).run();
    if (!result.meta.changes) result = await c.env.DB.prepare("UPDATE project_activity_resources SET title=?,content_text=?,resource_type=?,updated_at=datetime('now') WHERE id=?").bind(title,contentText,resourceType,id).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Underlaget hittades inte.'},404);
    return c.json({ok:true});
  });

  app.post('/api/studio/project-support/:id/attachments', async c => {
    await ensureSchema(c.env.DB);
    const resourceId = c.req.param('id');
    const resource = await findResource(c.env.DB,resourceId);
    if (!resource) return c.json({ok:false,error:'Underlaget hittades inte.'},404);

    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch (error) {
      console.error('Support attachment formData parse failed', error);
      return c.json({ok:false,error:'Kunde inte läsa den uppladdade filen. Försök igen.'},400);
    }
    const upload = form.get('file');
    if (!isUploadedFile(upload)) return c.json({ok:false,error:'Ingen giltig fil valdes.'},400);
    if (upload.size <= 0) return c.json({ok:false,error:'Filen är tom.'},400);
    if (upload.size > 20 * 1024 * 1024) return c.json({ok:false,error:'Filen får vara högst 20 MB.'},413);
    const isImage = upload.type.startsWith('image/');
    const isPdf = upload.type === 'application/pdf';
    if (!isImage && !isPdf) return c.json({ok:false,error:`Filtypen ${upload.type || 'okänd'} stöds inte. Endast bilder och PDF-filer stöds just nu.`},415);

    if (!c.env.FILES || typeof c.env.FILES.put !== 'function') {
      console.error('Support attachment upload missing FILES binding');
      return c.json({ok:false,error:'Fillagringen är inte tillgänglig i API:t.'},503);
    }

    const id = crypto.randomUUID();
    const originalName = typeof (upload as any).name === 'string' && (upload as any).name ? (upload as any).name : (isPdf ? 'bilaga.pdf' : 'bild');
    const safeName = sanitizeFileName(originalName);
    const objectKey = `projects/${resource.project_id}/support/${resourceId}/${id}-${safeName}`;
    await c.env.FILES.put(objectKey,upload.stream(),{
      httpMetadata:{contentType:upload.type || 'application/octet-stream'},
      customMetadata:{projectId:String(resource.project_id),resourceId,originalName}
    });
    try {
      const order = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_support_attachments WHERE resource_id=?').bind(resourceId).first<any>();
      await c.env.DB.prepare(`INSERT INTO project_support_attachments(id,project_id,resource_id,object_key,original_name,content_type,size_bytes,sort_order) VALUES(?,?,?,?,?,?,?,?)`).bind(id,resource.project_id,resourceId,objectKey,originalName,upload.type || 'application/octet-stream',upload.size,Number(order?.next_order ?? 10)).run();
    } catch (error) {
      await c.env.FILES.delete(objectKey);
      throw error;
    }
    return c.json({ok:true,attachment:{id,originalName,contentType:upload.type,sizeBytes:upload.size,url:`/api/project-support-attachments/${id}`}},201);
  });

  app.get('/api/project-support-attachments/:id', async c => {
    const attachment = await c.env.DB.prepare('SELECT object_key,original_name,content_type FROM project_support_attachments WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!attachment) return c.json({ok:false,error:'Bilagan hittades inte.'},404);
    const object = await c.env.FILES.get(attachment.object_key);
    if (!object) return c.json({ok:false,error:'Bilagefilen saknas.'},404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type',attachment.content_type || headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Content-Disposition',`inline; filename="${sanitizeFileName(attachment.original_name)}"`);
    headers.set('Cache-Control','private, max-age=300');
    return new Response(object.body,{headers});
  });

  app.delete('/api/studio/project-support-attachments/:id', async c => {
    await ensureSchema(c.env.DB);
    const id = c.req.param('id');
    const attachment = await c.env.DB.prepare('SELECT object_key FROM project_support_attachments WHERE id=?').bind(id).first<any>();
    if (!attachment) return c.json({ok:false,error:'Bilagan hittades inte.'},404);
    await c.env.FILES.delete(attachment.object_key);
    await c.env.DB.prepare('DELETE FROM project_support_attachments WHERE id=?').bind(id).run();
    return c.json({ok:true});
  });

  app.delete('/api/studio/project-support/:id', async c => {
    await ensureSchema(c.env.DB);
    const id = c.req.param('id');
    const files = await c.env.DB.prepare('SELECT object_key FROM project_support_attachments WHERE resource_id=?').bind(id).all();
    for (const row of files.results as any[]) await c.env.FILES.delete(String(row.object_key));
    await c.env.DB.prepare('DELETE FROM project_support_attachments WHERE resource_id=?').bind(id).run();
    let result = await c.env.DB.prepare('DELETE FROM project_task_resources WHERE id=?').bind(id).run();
    if (!result.meta.changes) result = await c.env.DB.prepare('DELETE FROM project_activity_resources WHERE id=?').bind(id).run();
    if (!result.meta.changes) return c.json({ok:false,error:'Underlaget hittades inte.'},404);
    return c.json({ok:true});
  });
}
