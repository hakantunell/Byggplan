type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
  delete: (path: string, handler: (c: any) => unknown) => void;
};

type Body = { title?: string; description?: string };

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function sanitizeFileName(name: string) {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe.slice(0, 120) || 'dokument';
}
function isUploadedFile(value: unknown): value is File {
  return Boolean(value && typeof value === 'object' && typeof (value as any).stream === 'function' && typeof (value as any).size === 'number' && typeof (value as any).type === 'string');
}
async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_documents(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_document_attachments(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES project_documents(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id,sort_order,id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_document_attachments_document ON project_document_attachments(document_id,sort_order,id)').run();
}

async function listDocuments(db: D1Database, projectId: string) {
  const docs = await db.prepare('SELECT id,title,description,sort_order FROM project_documents WHERE project_id=? ORDER BY sort_order,id').bind(projectId).all();
  const rows = docs.results as any[];
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const files = await db.prepare(`SELECT id,document_id,original_name,content_type,size_bytes,sort_order FROM project_document_attachments WHERE document_id IN (${placeholders}) ORDER BY document_id,sort_order,id`).bind(...ids).all();
  const byDoc = new Map<string, any[]>();
  for (const file of files.results as any[]) {
    const list = byDoc.get(file.document_id) ?? [];
    list.push({ id:file.id, originalName:file.original_name, contentType:file.content_type, sizeBytes:Number(file.size_bytes||0), url:`/api/project-document-files/${encodeURIComponent(file.id)}` });
    byDoc.set(file.document_id,list);
  }
  return rows.map(row => ({ ...row, attachments:byDoc.get(row.id) ?? [] }));
}

export function registerProjectDocumentRoutes(app: RouteApp) {
  app.get('/api/project-documents', async c => {
    const projectId = c.req.query('projectId');
    if (!projectId) return c.json({ok:false,error:'projectId krävs.'},400);
    try { return c.json({ok:true,documents:await listDocuments(c.env.DB,projectId)}); }
    catch { await ensureSchema(c.env.DB); return c.json({ok:true,documents:await listDocuments(c.env.DB,projectId)}); }
  });

  app.post('/api/studio/project-documents', async c => {
    await ensureSchema(c.env.DB);
    const body = await c.req.json<Body & {projectId?:string}>().catch(()=>({}));
    const projectId=text(body.projectId), title=text(body.title), description=typeof body.description==='string'?body.description.trim():'';
    if(!projectId)return c.json({ok:false,error:'Projekt krävs.'},400);
    if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const id=crypto.randomUUID();
    const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_documents WHERE project_id=?').bind(projectId).first<any>();
    await c.env.DB.prepare('INSERT INTO project_documents(id,project_id,title,description,sort_order) VALUES(?,?,?,?,?)').bind(id,projectId,title,description,Number(order?.next_order??10)).run();
    return c.json({ok:true,id},201);
  });

  app.put('/api/studio/project-documents/:id', async c => {
    await ensureSchema(c.env.DB);
    const body=await c.req.json<Body>().catch(()=>({}));
    const title=text(body.title), description=typeof body.description==='string'?body.description.trim():'';
    if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const result=await c.env.DB.prepare("UPDATE project_documents SET title=?,description=?,updated_at=datetime('now') WHERE id=?").bind(title,description,c.req.param('id')).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Projektdokumentet hittades inte.'},404);
    return c.json({ok:true});
  });

  app.post('/api/studio/project-document-files/:id', async c => {
    await ensureSchema(c.env.DB);
    const documentId=c.req.param('id');
    const document=await c.env.DB.prepare('SELECT id,project_id FROM project_documents WHERE id=?').bind(documentId).first<any>();
    if(!document)return c.json({ok:false,error:'Projektdokumentet hittades inte.'},404);
    let form:FormData; try{form=await c.req.raw.formData();}catch{return c.json({ok:false,error:'Kunde inte läsa filen.'},400);}
    const upload=form.get('file');
    if(!isUploadedFile(upload))return c.json({ok:false,error:'Ingen giltig fil valdes.'},400);
    if(upload.size<=0)return c.json({ok:false,error:'Filen är tom.'},400);
    if(upload.size>20*1024*1024)return c.json({ok:false,error:'Filen får vara högst 20 MB.'},413);
    const isImage=upload.type.startsWith('image/'), isPdf=upload.type==='application/pdf';
    if(!isImage&&!isPdf)return c.json({ok:false,error:'Endast bilder och PDF-filer stöds just nu.'},415);
    if(!c.env.FILES||typeof c.env.FILES.put!=='function')return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);
    const id=crypto.randomUUID();
    const originalName=typeof (upload as any).name==='string'&&(upload as any).name?(upload as any).name:(isPdf?'dokument.pdf':'bild');
    const objectKey=`projects/${document.project_id}/documents/${documentId}/${id}-${sanitizeFileName(originalName)}`;
    await c.env.FILES.put(objectKey,upload.stream(),{httpMetadata:{contentType:upload.type||'application/octet-stream'},customMetadata:{projectId:String(document.project_id),documentId,originalName}});
    try{
      const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_document_attachments WHERE document_id=?').bind(documentId).first<any>();
      await c.env.DB.prepare('INSERT INTO project_document_attachments(id,project_id,document_id,object_key,original_name,content_type,size_bytes,sort_order) VALUES(?,?,?,?,?,?,?,?)').bind(id,document.project_id,documentId,objectKey,originalName,upload.type||'application/octet-stream',upload.size,Number(order?.next_order??10)).run();
    }catch(error){await c.env.FILES.delete(objectKey);throw error;}
    return c.json({ok:true,attachment:{id,originalName,contentType:upload.type,sizeBytes:upload.size,url:`/api/project-document-files/${id}`}},201);
  });

  app.get('/api/project-document-files/:id', async c => {
    const file=await c.env.DB.prepare('SELECT object_key,original_name,content_type FROM project_document_attachments WHERE id=?').bind(c.req.param('id')).first<any>();
    if(!file)return c.json({ok:false,error:'Filen hittades inte.'},404);
    const object=await c.env.FILES.get(file.object_key); if(!object)return c.json({ok:false,error:'Filen saknas.'},404);
    const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',file.content_type||headers.get('Content-Type')||'application/octet-stream');headers.set('Content-Disposition',`inline; filename="${sanitizeFileName(file.original_name)}"`);headers.set('Cache-Control','private, max-age=300');
    return new Response(object.body,{headers});
  });

  app.delete('/api/studio/project-document-files/:id', async c => {
    await ensureSchema(c.env.DB);
    const file=await c.env.DB.prepare('SELECT object_key FROM project_document_attachments WHERE id=?').bind(c.req.param('id')).first<any>();
    if(!file)return c.json({ok:false,error:'Filen hittades inte.'},404);
    await c.env.FILES.delete(file.object_key);await c.env.DB.prepare('DELETE FROM project_document_attachments WHERE id=?').bind(c.req.param('id')).run();return c.json({ok:true});
  });

  app.delete('/api/studio/project-documents/:id', async c => {
    await ensureSchema(c.env.DB);
    const id=c.req.param('id');
    const files=await c.env.DB.prepare('SELECT object_key FROM project_document_attachments WHERE document_id=?').bind(id).all();
    for(const row of files.results as any[])await c.env.FILES.delete(String(row.object_key));
    await c.env.DB.prepare('DELETE FROM project_document_attachments WHERE document_id=?').bind(id).run();
    const result=await c.env.DB.prepare('DELETE FROM project_documents WHERE id=?').bind(id).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Projektdokumentet hittades inte.'},404);
    return c.json({ok:true});
  });
}
