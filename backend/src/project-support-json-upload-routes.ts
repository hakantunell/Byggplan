type RouteApp = {
  post: (path: string, handler: (c: any) => unknown) => void;
};

type JsonUploadBody = {
  probe?: boolean;
  name?: string;
  contentType?: string;
  dataBase64?: string;
};

function sanitizeFileName(name: string) {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return safe.slice(0, 120) || 'bilaga';
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

export function registerProjectSupportJsonUploadRoutes(app: RouteApp) {
  app.post('/api/u/:id', async c => {
    await ensureAttachmentSchema(c.env.DB);
    const resourceId = c.req.param('id');
    const resource = await findResource(c.env.DB, resourceId);
    if (!resource) return c.json({ ok:false, error:'Underlaget hittades inte.' }, 404);

    const body = await c.req.json<JsonUploadBody>().catch(() => null);
    if (body?.probe === true) {
      return c.json({ ok:true, probe:true, route:'u' });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const contentType = typeof body?.contentType === 'string' ? body.contentType.trim() : '';
    const dataBase64 = typeof body?.dataBase64 === 'string' ? body.dataBase64.trim() : '';
    if (!name || !dataBase64) return c.json({ ok:false, error:'Filnamn eller filinnehåll saknas.' }, 400);

    const isImage = contentType.startsWith('image/');
    const isPdf = contentType === 'application/pdf';
    if (!isImage && !isPdf) return c.json({ ok:false, error:`Filtypen ${contentType || 'okänd'} stöds inte. Endast bilder och PDF-filer stöds just nu.` }, 415);

    if (dataBase64.length > 28 * 1024 * 1024) return c.json({ ok:false, error:'Filen får vara högst 20 MB.' }, 413);

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(dataBase64);
    } catch {
      return c.json({ ok:false, error:'Filinnehållet kunde inte avkodas.' }, 400);
    }
    if (!bytes.byteLength) return c.json({ ok:false, error:'Filen är tom.' }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return c.json({ ok:false, error:'Filen får vara högst 20 MB.' }, 413);

    if (!c.env.FILES || typeof c.env.FILES.put !== 'function') {
      return c.json({ ok:false, error:'Fillagringen är inte tillgänglig i API:t.' }, 503);
    }

    const id = crypto.randomUUID();
    const safeName = sanitizeFileName(name);
    const objectKey = `projects/${resource.project_id}/support/${resourceId}/${id}-${safeName}`;
    await c.env.FILES.put(objectKey, bytes, {
      httpMetadata:{ contentType },
      customMetadata:{ projectId:String(resource.project_id), resourceId, originalName:name }
    });

    try {
      const order = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_support_attachments WHERE resource_id=?').bind(resourceId).first<any>();
      await c.env.DB.prepare(`INSERT INTO project_support_attachments(id,project_id,resource_id,object_key,original_name,content_type,size_bytes,sort_order) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(id,resource.project_id,resourceId,objectKey,name,contentType,bytes.byteLength,Number(order?.next_order ?? 10)).run();
    } catch (error) {
      await c.env.FILES.delete(objectKey);
      throw error;
    }

    return c.json({ ok:true, attachment:{ id, originalName:name, contentType, sizeBytes:bytes.byteLength, url:`/api/project-support-attachments/${id}` } }, 201);
  });
}
