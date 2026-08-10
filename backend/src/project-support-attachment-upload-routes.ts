type RouteApp = {
  post: (path: string, handler: (c: any) => unknown) => void;
};

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

async function ensureAttachmentSchema(db: D1Database) {
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
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_support_attachments_resource ON project_support_attachments(resource_id,sort_order)').run();
}

async function findResource(db: D1Database, id: string) {
  const task = await db.prepare('SELECT id,project_id FROM project_task_resources WHERE id=?').bind(id).first<any>();
  if (task) return task;
  return db.prepare('SELECT id,project_id FROM project_activity_resources WHERE id=?').bind(id).first<any>();
}

export function registerProjectSupportAttachmentUploadRoutes(app: RouteApp) {
  app.post('/api/studio/support-attachments/:id', async c => {
    await ensureAttachmentSchema(c.env.DB);
    const resourceId = c.req.param('id');
    const resource = await findResource(c.env.DB, resourceId);
    if (!resource) return c.json({ ok:false, error:'Underlaget hittades inte.' },404);

    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      return c.json({ ok:false, error:'Kunde inte läsa den uppladdade filen.' },400);
    }

    const upload = form.get('file');
    if (!isUploadedFile(upload)) return c.json({ ok:false, error:'Ingen giltig fil valdes.' },400);
    if (upload.size <= 0) return c.json({ ok:false, error:'Filen är tom.' },400);
    if (upload.size > 20 * 1024 * 1024) return c.json({ ok:false, error:'Filen får vara högst 20 MB.' },413);

    const isImage = upload.type.startsWith('image/');
    const isPdf = upload.type === 'application/pdf';
    if (!isImage && !isPdf) return c.json({ ok:false, error:'Endast bilder och PDF-filer stöds just nu.' },415);
    if (!c.env.FILES || typeof c.env.FILES.put !== 'function') return c.json({ ok:false, error:'Fillagringen är inte tillgänglig i API:t.' },503);

    const id = crypto.randomUUID();
    const originalName = typeof (upload as any).name === 'string' && (upload as any).name ? (upload as any).name : (isPdf ? 'bilaga.pdf' : 'bild');
    const objectKey = `projects/${resource.project_id}/support/${resourceId}/${id}-${sanitizeFileName(originalName)}`;

    await c.env.FILES.put(objectKey, upload.stream(), {
      httpMetadata:{ contentType:upload.type || 'application/octet-stream' },
      customMetadata:{ projectId:String(resource.project_id), resourceId, originalName }
    });

    try {
      const order = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_support_attachments WHERE resource_id=?').bind(resourceId).first<any>();
      await c.env.DB.prepare(`INSERT INTO project_support_attachments(id,project_id,resource_id,object_key,original_name,content_type,size_bytes,sort_order) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(id,resource.project_id,resourceId,objectKey,originalName,upload.type || 'application/octet-stream',upload.size,Number(order?.next_order ?? 10)).run();
    } catch (error) {
      await c.env.FILES.delete(objectKey);
      throw error;
    }

    return c.json({ ok:true, attachment:{ id, originalName, contentType:upload.type, sizeBytes:upload.size, url:`/api/project-support-attachments/${id}` } },201);
  });
}
