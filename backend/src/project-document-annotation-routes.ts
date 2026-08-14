type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
};

function sanitizeFileName(name: string) {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe.slice(0, 120) || 'foto';
}
function isUploadedFile(value: unknown): value is File {
  return Boolean(value && typeof value === 'object' && typeof (value as any).stream === 'function' && typeof (value as any).size === 'number' && typeof (value as any).type === 'string');
}
async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_document_annotations(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL,
    y REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES project_documents(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_document_annotation_notes(
    id TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(annotation_id) REFERENCES project_document_annotations(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_document_annotation_photos(
    id TEXT PRIMARY KEY,
    annotation_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(annotation_id) REFERENCES project_document_annotations(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_document_annotations_document ON project_document_annotations(document_id,page_number,created_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_document_annotation_notes_annotation ON project_document_annotation_notes(annotation_id,created_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_document_annotation_photos_annotation ON project_document_annotation_photos(annotation_id,created_at)').run();
}

async function annotationPayload(db:D1Database, documentId:string){
  const annotations=await db.prepare('SELECT id,document_id,page_number,x,y,created_at FROM project_document_annotations WHERE document_id=? ORDER BY page_number,created_at').bind(documentId).all();
  const rows=annotations.results as any[];
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id), placeholders=ids.map(()=>'?').join(',');
  const notes=await db.prepare(`SELECT id,annotation_id,note,created_at FROM project_document_annotation_notes WHERE annotation_id IN (${placeholders}) ORDER BY created_at`).bind(...ids).all();
  const photos=await db.prepare(`SELECT id,annotation_id,original_name,content_type,size_bytes,created_at FROM project_document_annotation_photos WHERE annotation_id IN (${placeholders}) ORDER BY created_at`).bind(...ids).all();
  const notesBy=new Map<string,any[]>(),photosBy=new Map<string,any[]>();
  for(const note of notes.results as any[]){const list=notesBy.get(note.annotation_id)??[];list.push({id:note.id,note:note.note,createdAt:note.created_at});notesBy.set(note.annotation_id,list)}
  for(const photo of photos.results as any[]){const list=photosBy.get(photo.annotation_id)??[];list.push({id:photo.id,originalName:photo.original_name,contentType:photo.content_type,sizeBytes:Number(photo.size_bytes||0),createdAt:photo.created_at,url:`/api/project-document-annotation-photos/${encodeURIComponent(photo.id)}`});photosBy.set(photo.annotation_id,list)}
  return rows.map(row=>({id:row.id,documentId:row.document_id,pageNumber:Number(row.page_number||1),x:Number(row.x),y:Number(row.y),createdAt:row.created_at,notes:notesBy.get(row.id)??[],photos:photosBy.get(row.id)??[]}));
}

export function registerProjectDocumentAnnotationRoutes(app:RouteApp){
  app.get('/api/project-document-annotations',async c=>{
    const documentId=c.req.query('documentId');if(!documentId)return c.json({ok:false,error:'documentId krävs.'},400);
    await ensureSchema(c.env.DB);
    return c.json({ok:true,annotations:await annotationPayload(c.env.DB,documentId)});
  });

  app.put('/api/project-document-annotations',async c=>{
    await ensureSchema(c.env.DB);
    const body=await c.req.json<{documentId?:string;pageNumber?:number;x?:number;y?:number}>().catch(()=>({}));
    const documentId=typeof body.documentId==='string'?body.documentId:'';const pageNumber=Math.max(1,Math.floor(Number(body.pageNumber)||1));const x=Number(body.x),y=Number(body.y);
    if(!documentId||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return c.json({ok:false,error:'Ogiltig dokumentposition.'},400);
    const document=await c.env.DB.prepare('SELECT id,project_id FROM project_documents WHERE id=?').bind(documentId).first<any>();if(!document)return c.json({ok:false,error:'Projektdokumentet hittades inte.'},404);
    const id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO project_document_annotations(id,project_id,document_id,page_number,x,y) VALUES(?,?,?,?,?,?)').bind(id,document.project_id,documentId,pageNumber,x,y).run();
    return c.json({ok:true,id},201);
  });

  app.put('/api/project-document-annotations/:id/notes',async c=>{
    await ensureSchema(c.env.DB);const annotationId=c.req.param('id');const body=await c.req.json<{note?:string}>().catch(()=>({}));const note=typeof body.note==='string'?body.note.trim():'';
    if(!note)return c.json({ok:false,error:'Notisen är tom.'},400);
    const exists=await c.env.DB.prepare('SELECT id FROM project_document_annotations WHERE id=?').bind(annotationId).first();if(!exists)return c.json({ok:false,error:'Markeringen hittades inte.'},404);
    const id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO project_document_annotation_notes(id,annotation_id,note) VALUES(?,?,?)').bind(id,annotationId,note).run();return c.json({ok:true,id},201);
  });

  app.put('/api/project-document-annotations/:id/photos',async c=>{
    await ensureSchema(c.env.DB);const annotationId=c.req.param('id');const annotation=await c.env.DB.prepare('SELECT id,project_id,document_id FROM project_document_annotations WHERE id=?').bind(annotationId).first<any>();if(!annotation)return c.json({ok:false,error:'Markeringen hittades inte.'},404);
    let form:FormData;try{form=await c.req.raw.formData()}catch{return c.json({ok:false,error:'Kunde inte läsa bilden.'},400)}
    const upload=form.get('file');if(!isUploadedFile(upload)||!upload.type.startsWith('image/'))return c.json({ok:false,error:'Välj en giltig bild.'},415);if(upload.size<=0)return c.json({ok:false,error:'Bilden är tom.'},400);if(upload.size>20*1024*1024)return c.json({ok:false,error:'Bilden får vara högst 20 MB.'},413);
    const id=crypto.randomUUID();const originalName=typeof (upload as any).name==='string'&&(upload as any).name?(upload as any).name:'foto.jpg';const objectKey=`projects/${annotation.project_id}/document-annotations/${annotation.document_id}/${annotationId}/${id}-${sanitizeFileName(originalName)}`;
    await c.env.FILES.put(objectKey,upload.stream(),{httpMetadata:{contentType:upload.type||'image/jpeg'},customMetadata:{projectId:String(annotation.project_id),documentId:String(annotation.document_id),annotationId,originalName}});
    try{await c.env.DB.prepare('INSERT INTO project_document_annotation_photos(id,annotation_id,object_key,original_name,content_type,size_bytes) VALUES(?,?,?,?,?,?)').bind(id,annotationId,objectKey,originalName,upload.type||'image/jpeg',upload.size).run()}catch(error){await c.env.FILES.delete(objectKey);throw error}
    return c.json({ok:true,id,url:`/api/project-document-annotation-photos/${id}`},201);
  });

  app.get('/api/project-document-annotation-photos/:id',async c=>{
    await ensureSchema(c.env.DB);const photo=await c.env.DB.prepare('SELECT object_key,original_name,content_type FROM project_document_annotation_photos WHERE id=?').bind(c.req.param('id')).first<any>();if(!photo)return c.json({ok:false,error:'Bilden hittades inte.'},404);
    const object=await c.env.FILES.get(photo.object_key);if(!object)return c.json({ok:false,error:'Bilden saknas.'},404);const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',photo.content_type||'image/jpeg');headers.set('Content-Disposition',`inline; filename="${sanitizeFileName(photo.original_name)}"`);headers.set('Cache-Control','private, max-age=300');return new Response(object.body,{headers});
  });
}
