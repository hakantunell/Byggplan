type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void;delete:(path:string,handler:(c:any)=>unknown)=>void};

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function safeName(name:string){return name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'').slice(0,120)||'styrdokument'}
function isFile(value:unknown):value is File{return Boolean(value&&typeof value==='object'&&typeof(value as any).stream==='function'&&typeof(value as any).size==='number')}

async function ensureSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_versions(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  version_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,
  FOREIGN KEY(document_id) REFERENCES governing_documents(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(document_id,version_no)
 )`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_document_versions_document ON governing_document_versions(document_id,version_no DESC)').run();
}

async function seedActiveVersion(db:D1Database,documentId:string){
 const count=await db.prepare('SELECT COUNT(*) count FROM governing_document_versions WHERE document_id=?').bind(documentId).first<any>();
 if(Number(count?.count||0)>0)return;
 const row=await db.prepare(`SELECT d.project_id,d.source_filename,d.source_mime_type,f.object_key,f.original_name,f.content_type,f.size_bytes
  FROM governing_documents d LEFT JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(documentId).first<any>();
 if(!row?.object_key)return;
 await db.prepare(`INSERT INTO governing_document_versions(id,document_id,project_id,version_no,version_label,status,object_key,original_name,content_type,size_bytes,note,created_at,activated_at)
  VALUES(?,?,?,?,?,'active',?,?,?,?,?,datetime('now'),datetime('now'))`).bind(
   crypto.randomUUID(),documentId,String(row.project_id),1,'Version 1',String(row.object_key),String(row.original_name||row.source_filename||'styrdokument'),String(row.content_type||row.source_mime_type||'application/octet-stream'),Number(row.size_bytes||0),'Importerad ursprungsversion'
  ).run();
}

export function registerGoverningDocumentVersionRoutes(app:RouteApp){
 app.get('/api/studio/governing-documents/:id/versions',async c=>{
  await ensureSchema(c.env.DB);const id=String(c.req.param('id'));
  const document=await c.env.DB.prepare('SELECT id,project_id,title FROM governing_documents WHERE id=?').bind(id).first<any>();
  if(!document)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);
  await seedActiveVersion(c.env.DB,id);
  const rows=await c.env.DB.prepare(`SELECT id,version_no,version_label,status,original_name,content_type,size_bytes,note,created_at,activated_at FROM governing_document_versions WHERE document_id=? ORDER BY version_no DESC`).bind(id).all();
  return c.json({ok:true,document:{id:document.id,title:document.title},versions:rows.results});
 });

 app.post('/api/studio/governing-documents/:id/version-candidates',async c=>{
  await ensureSchema(c.env.DB);const id=String(c.req.param('id'));
  const document=await c.env.DB.prepare('SELECT id,project_id,title FROM governing_documents WHERE id=?').bind(id).first<any>();
  if(!document)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);
  if(!c.env.FILES)return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);
  await seedActiveVersion(c.env.DB,id);
  let form:FormData;try{form=await c.req.raw.formData()}catch{return c.json({ok:false,error:'Kunde inte läsa uppladdningen.'},400)}
  const upload=form.get('file'),label=clean(form.get('versionLabel')),note=clean(form.get('note'));
  if(!isFile(upload)||upload.size<=0)return c.json({ok:false,error:'Välj en giltig PDF eller bild.'},400);
  if(upload.size>25*1024*1024)return c.json({ok:false,error:'Filen får vara högst 25 MB.'},413);
  const contentType=clean((upload as any).type)||'application/octet-stream';
  if(contentType!=='application/pdf'&&!contentType.startsWith('image/'))return c.json({ok:false,error:'Endast PDF och bilder stöds.'},415);
  const max=await c.env.DB.prepare('SELECT COALESCE(MAX(version_no),0) max_version FROM governing_document_versions WHERE document_id=?').bind(id).first<any>();
  const versionNo=Number(max?.max_version||0)+1,versionId=crypto.randomUUID(),originalName=clean((upload as any).name)||'styrdokument.pdf';
  const objectKey=`projects/${document.project_id}/governing/${id}/versions/${versionId}-${safeName(originalName)}`;
  await c.env.FILES.put(objectKey,(upload as any).stream(),{httpMetadata:{contentType},customMetadata:{projectId:String(document.project_id),documentId:id,versionId,originalName}});
  try{
   await c.env.DB.prepare(`INSERT INTO governing_document_versions(id,document_id,project_id,version_no,version_label,status,object_key,original_name,content_type,size_bytes,note)
    VALUES(?,?,?,?,?,'candidate',?,?,?,?,?)`).bind(versionId,id,String(document.project_id),versionNo,label||`Version ${versionNo}`,objectKey,originalName,contentType,Number((upload as any).size||0),note).run();
  }catch(error){await c.env.FILES.delete(objectKey).catch(()=>undefined);throw error}
  return c.json({ok:true,candidate:{id:versionId,versionNo,versionLabel:label||`Version ${versionNo}`,status:'candidate',originalName,sizeBytes:Number((upload as any).size||0)},safety:{projectChanged:false,activitiesChanged:false,currentVersionPreserved:true}},201);
 });

 app.delete('/api/studio/governing-documents/:id/version-candidates/:versionId',async c=>{
  await ensureSchema(c.env.DB);const id=String(c.req.param('id')),versionId=String(c.req.param('versionId'));
  const row=await c.env.DB.prepare("SELECT object_key,status FROM governing_document_versions WHERE id=? AND document_id=?").bind(versionId,id).first<any>();
  if(!row)return c.json({ok:false,error:'Kandidatversionen hittades inte.'},404);
  if(String(row.status)!=='candidate')return c.json({ok:false,error:'Endast kandidatversioner kan tas bort här.'},409);
  if(c.env.FILES&&row.object_key)await c.env.FILES.delete(String(row.object_key)).catch(()=>undefined);
  await c.env.DB.prepare('DELETE FROM governing_document_versions WHERE id=?').bind(versionId).run();
  return c.json({ok:true});
 });
}
