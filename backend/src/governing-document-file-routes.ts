type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void;delete:(path:string,handler:(c:any)=>unknown)=>void};

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function sanitizeFileName(name:string){const normalized=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');const safe=normalized.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'');return safe.slice(0,120)||'styrdokument'}
function isUploadedFile(value:unknown):value is File{return Boolean(value&&typeof value==='object'&&typeof (value as any).stream==='function'&&typeof (value as any).size==='number')}
function normalizeDocumentType(value:unknown){const candidate=clean(value);return ['control_plan','authority_decision','building_permit','technical_consultation','work_environment','other'].includes(candidate)?candidate:'other'}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_documents(
    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,document_type TEXT NOT NULL DEFAULT 'other',title TEXT NOT NULL,
    issuer TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',source_filename TEXT NOT NULL,source_mime_type TEXT NOT NULL DEFAULT '',
    source_checksum TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_files(
    document_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,size_bytes INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(document_id) REFERENCES governing_documents(id) ON DELETE CASCADE,FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_document_files_project ON governing_document_files(project_id)').run();
}

export function registerGoverningDocumentFileRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/governing-document-files',async c=>{
    await ensureSchema(c.env.DB);const projectId=c.req.param('projectId');
    const rows=await c.env.DB.prepare(`SELECT d.id,d.document_type,d.title,d.issuer,d.reference,d.status,d.imported_at,
      f.original_name,f.content_type,f.size_bytes
      FROM governing_documents d LEFT JOIN governing_document_files f ON f.document_id=d.id
      WHERE d.project_id=? ORDER BY CASE d.document_type WHEN 'control_plan' THEN 0 ELSE 1 END,d.imported_at DESC,d.title`).bind(projectId).all();
    return c.json({ok:true,documents:(rows.results as any[]).map(row=>({...row,file:row.original_name?{originalName:row.original_name,contentType:row.content_type,sizeBytes:Number(row.size_bytes||0),url:`/api/governing-document-files/${encodeURIComponent(row.id)}`} : null}))});
  });

  app.post('/api/studio/governing-document-files/import',async c=>{
    await ensureSchema(c.env.DB);
    let form:FormData;try{form=await c.req.raw.formData()}catch{return c.json({ok:false,error:'Kunde inte läsa uppladdningen.'},400)}
    const projectId=clean(form.get('projectId'));const title=clean(form.get('title'));const documentType=normalizeDocumentType(form.get('documentType'));
    const issuer=clean(form.get('issuer'));const reference=clean(form.get('reference'));const upload=form.get('file');
    if(!projectId||!title)return c.json({ok:false,error:'Projekt och titel krävs.'},400);
    if(!isUploadedFile(upload))return c.json({ok:false,error:'Välj en PDF eller bild.'},400);
    if(upload.size<=0)return c.json({ok:false,error:'Filen är tom.'},400);
    if(upload.size>25*1024*1024)return c.json({ok:false,error:'Filen får vara högst 25 MB.'},413);
    const contentType=clean((upload as any).type)||'application/octet-stream';
    if(contentType!=='application/pdf'&&!contentType.startsWith('image/'))return c.json({ok:false,error:'Endast PDF och bilder stöds.'},415);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    if(!c.env.FILES||typeof c.env.FILES.put!=='function')return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);
    const documentId=crypto.randomUUID();const originalName=clean((upload as any).name)||(contentType==='application/pdf'?'styrdokument.pdf':'styrdokument-bild');
    const objectKey=`projects/${projectId}/governing/${documentId}/${sanitizeFileName(originalName)}`;
    await c.env.FILES.put(objectKey,(upload as any).stream(),{httpMetadata:{contentType},customMetadata:{projectId,documentId,originalName}});
    try{
      await c.env.DB.prepare(`INSERT INTO governing_documents(id,project_id,document_type,title,issuer,reference,source_filename,source_mime_type,source_checksum,status)
        VALUES(?,?,?,?,?,?,?,?,?,'active')`).bind(documentId,projectId,documentType,title,issuer,reference,originalName,contentType,'').run();
      await c.env.DB.prepare(`INSERT INTO governing_document_files(document_id,project_id,object_key,original_name,content_type,size_bytes)
        VALUES(?,?,?,?,?,?)`).bind(documentId,projectId,objectKey,originalName,contentType,Number((upload as any).size||0)).run();
    }catch(error){await c.env.FILES.delete(objectKey).catch(()=>undefined);throw error}
    return c.json({ok:true,id:documentId,document:{id:documentId,title,documentType,issuer,file:{originalName,contentType,sizeBytes:Number((upload as any).size||0),url:`/api/governing-document-files/${documentId}`}}},201);
  });

  app.get('/api/governing-document-files/:id',async c=>{
    await ensureSchema(c.env.DB);const row=await c.env.DB.prepare('SELECT object_key,original_name,content_type FROM governing_document_files WHERE document_id=?').bind(c.req.param('id')).first<any>();
    if(!row)return c.json({ok:false,error:'Styrdokumentets fil hittades inte.'},404);const object=await c.env.FILES.get(row.object_key);if(!object)return c.json({ok:false,error:'Filen saknas i lagringen.'},404);
    const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',row.content_type||headers.get('Content-Type')||'application/octet-stream');headers.set('Content-Disposition',`inline; filename="${sanitizeFileName(row.original_name)}"`);headers.set('Cache-Control','private, max-age=300');return new Response(object.body,{headers});
  });

  app.delete('/api/studio/governing-document-files/:id',async c=>{
    await ensureSchema(c.env.DB);const id=c.req.param('id');const row=await c.env.DB.prepare('SELECT object_key FROM governing_document_files WHERE document_id=?').bind(id).first<any>();
    if(row?.object_key)await c.env.FILES.delete(String(row.object_key)).catch(()=>undefined);
    await c.env.DB.prepare('DELETE FROM governing_document_files WHERE document_id=?').bind(id).run();
    const result=await c.env.DB.prepare('DELETE FROM governing_documents WHERE id=?').bind(id).run();if(!result.meta.changes)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);return c.json({ok:true});
  });
}
