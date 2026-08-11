type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void;delete:(path:string,handler:(c:any)=>unknown)=>void};

type AnalysisItem={code?:string;description?:string;sectionCode?:string;sectionTitle?:string;itemType?:string;responsibleRole?:string;evidenceRequired?:string;handlingStatus?:string;handlingComment?:string;sourceNote?:string};

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function sanitizeFileName(name:string){const normalized=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');const safe=normalized.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'');return safe.slice(0,120)||'styrdokument'}
function isUploadedFile(value:unknown):value is File{return Boolean(value&&typeof value==='object'&&typeof (value as any).stream==='function'&&typeof (value as any).size==='number')}
function normalizeDocumentType(value:unknown){const candidate=clean(value);return ['control_plan','authority_decision','building_permit','technical_consultation','work_environment','other'].includes(candidate)?candidate:'other'}
function normalizeItemType(value:unknown){const candidate=clean(value);return ['control','visit','documentation','measurement','condition','information','administration','other'].includes(candidate)?candidate:'other'}
function normalizeHandlingStatus(value:unknown){const candidate=clean(value);return ['unhandled','in_progress','handled','not_applicable','cannot_verify','alternative_evidence'].includes(candidate)?candidate:'unhandled'}
async function addColumnIfMissing(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.toLowerCase().includes('duplicate column'))throw error}}

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
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_items(
    id TEXT PRIMARY KEY,governing_document_id TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',description TEXT NOT NULL,
    section_code TEXT NOT NULL DEFAULT '',section_title TEXT NOT NULL DEFAULT '',item_type TEXT NOT NULL DEFAULT 'other',
    responsible_role TEXT NOT NULL DEFAULT '',evidence_required TEXT NOT NULL DEFAULT '',handling_status TEXT NOT NULL DEFAULT 'unhandled',
    handling_comment TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(governing_document_id) REFERENCES governing_documents(id) ON DELETE CASCADE)`).run();
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN source_note TEXT NOT NULL DEFAULT ''");
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_document_files_project ON governing_document_files(project_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_items_document ON governing_items(governing_document_id,sort_order)').run();
}

export function registerGoverningDocumentFileRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/governing-document-files',async c=>{
    await ensureSchema(c.env.DB);const projectId=c.req.param('projectId');
    const rows=await c.env.DB.prepare(`SELECT d.id,d.document_type,d.title,d.issuer,d.reference,d.status,d.imported_at,
      f.original_name,f.content_type,f.size_bytes,
      (SELECT COUNT(*) FROM governing_items i WHERE i.governing_document_id=d.id) AS item_count
      FROM governing_documents d LEFT JOIN governing_document_files f ON f.document_id=d.id
      WHERE d.project_id=? ORDER BY CASE d.document_type WHEN 'control_plan' THEN 0 ELSE 1 END,d.imported_at DESC,d.title`).bind(projectId).all();
    return c.json({ok:true,documents:(rows.results as any[]).map(row=>({...row,item_count:Number(row.item_count||0),file:row.original_name?{originalName:row.original_name,contentType:row.content_type,sizeBytes:Number(row.size_bytes||0),url:`/api/governing-document-files/${encodeURIComponent(row.id)}`} : null}))});
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

  app.post('/api/studio/governing-documents/:id/analyze',async c=>{
    await ensureSchema(c.env.DB);const id=c.req.param('id');
    const document=await c.env.DB.prepare('SELECT id,project_id,title,document_type FROM governing_documents WHERE id=?').bind(id).first<any>();
    if(!document)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);
    const body=await c.req.json<{items?:AnalysisItem[];analyzer?:string}>().catch(()=>({}));
    const items=Array.isArray(body.items)?body.items:[];
    if(!items.length)return c.json({ok:false,error:'Analysen innehåller inga styrande poster.'},400);
    const count=await c.env.DB.prepare('SELECT COUNT(*) AS count FROM governing_items WHERE governing_document_id=?').bind(id).first<{count:number}>();
    if(Number(count?.count||0)>0)return c.json({ok:false,error:'Dokumentet är redan analyserat. Granska eller kartlägg befintliga poster i stället.',existingItems:Number(count?.count||0)},409);
    let created=0;
    for(let index=0;index<items.length;index+=1){
      const item=items[index];const description=clean(item.description);if(!description)continue;
      await c.env.DB.prepare(`INSERT INTO governing_items(
        id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,
        handling_status,handling_comment,sort_order,source_note)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          crypto.randomUUID(),id,clean(item.code),description,clean(item.sectionCode),clean(item.sectionTitle),normalizeItemType(item.itemType),
          clean(item.responsibleRole),clean(item.evidenceRequired),normalizeHandlingStatus(item.handlingStatus),clean(item.handlingComment),(index+1)*10,clean(item.sourceNote)
        ).run();created+=1;
    }
    await c.env.DB.prepare("UPDATE governing_documents SET status='active',updated_at=datetime('now') WHERE id=?").bind(id).run();
    return c.json({ok:true,id,createdItems:created,analyzer:clean(body.analyzer)||'reviewed-structure'});
  });

  app.post('/api/studio/governing-documents/:id/prepare-linking',async c=>{
    await ensureSchema(c.env.DB);const id=c.req.param('id');const body=await c.req.json<{projectId?:string}>().catch(()=>({}));const projectId=clean(body.projectId);
    const row=await c.env.DB.prepare('SELECT id,project_id,status FROM governing_documents WHERE id=?').bind(id).first<any>();
    if(!row)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);
    if(projectId&&String(row.project_id)!==projectId)return c.json({ok:false,error:'Styrdokumentet tillhör inte valt projekt.'},409);
    const file=await c.env.DB.prepare('SELECT document_id FROM governing_document_files WHERE document_id=?').bind(id).first();
    if(!file)return c.json({ok:false,error:'Styrdokumentet saknar originalfil.'},409);
    await c.env.DB.prepare("UPDATE governing_documents SET status='review',updated_at=datetime('now') WHERE id=?").bind(id).run();
    return c.json({ok:true,message:'Dokumentet är markerat för granskning. Nästa steg är att tolka krav och kontrollpunkter och matcha dem mot befintliga aktiviteter innan något skapas.'});
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
